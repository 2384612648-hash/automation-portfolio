"""Persistent RSS/Atom collection; no browser needed and no full article scraping."""
import hashlib
import json
import re
import sqlite3
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit, parse_qsl, urlencode
from concurrent.futures import ThreadPoolExecutor
from feed_sources import DEFAULT_SOURCES, TOPICS, SOURCE_KINDS, classify
from safe_http import fetch_public, public_target
from translation_service import TitleTranslator, SOURCE_NAMES


def utc():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def canonical(url):
    p = urlsplit(url.strip())
    if p.scheme not in ('https','http') or not p.hostname or p.username or p.password or any(c.isspace() for c in url):
        raise ValueError('invalid link')
    query = urlencode([(k,v) for k,v in parse_qsl(p.query, keep_blank_values=True) if not k.lower().startswith('utm_') and k not in ('fbclid','gclid')])
    return urlunsplit((p.scheme.lower(), p.netloc.lower(), p.path or '/', query, ''))


def parsed_date(value):
    if not value:
        return None
    try:
        try:
            date = datetime.fromisoformat(value.strip().replace('Z','+00:00'))
        except ValueError:
            date = parsedate_to_datetime(value)
        if not date.tzinfo:
            return None
        date = date.astimezone(timezone.utc)
        # Future/corrupt publication dates must not masquerade as recent news.
        if date > datetime.now(timezone.utc) + timedelta(hours=24) or date.year < 1990:
            return None
        return date.isoformat(timespec='seconds')
    except (ValueError, TypeError, OverflowError):
        return None


class FeedTreeBuilder(ET.TreeBuilder):
    def doctype(self, name, pubid, system):
        raise ValueError('不接受 XML DTD/实体')


def parse_items(data):
    # Reject actual XML DTDs, while allowing inert HTML inside CDATA.
    root = ET.fromstring(data, parser=ET.XMLParser(target=FeedTreeBuilder()))
    if root.tag.rsplit('}',1)[-1] not in ('rss','feed','RDF'):
        raise ValueError('不是 RSS/Atom')
    rows, seen = [], set()
    for entry in root.iter():
        if entry.tag.rsplit('}',1)[-1] not in ('item','entry'):
            continue
        fields = {}
        link = ''
        for child in entry:
            key = child.tag.rsplit('}',1)[-1]
            if key == 'link':
                if child.get('rel','alternate') == 'alternate':
                    link = child.get('href') or child.text or link
            else:
                fields[key] = ''.join(child.itertext()).strip()
        title = re.sub(r'\s+',' ', fields.get('title','')).strip()[:300]
        try:
            url = canonical(link)
        except (ValueError, AttributeError):
            continue
        if not title or url in seen:
            continue
        seen.add(url)
        date = parsed_date(fields.get('pubDate') or fields.get('published') or fields.get('date') or fields.get('updated'))
        rows.append({'title':title,'url':url,'published_at':date})
    rows.sort(key=lambda x:x['published_at'] or '', reverse=True)
    return rows[:200]


class FeedService:
    def __init__(self, path, proxy=None):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.proxy = proxy
        self.stop_event = threading.Event()
        self.wake_event = threading.Event()
        self.cycle_lock = threading.Lock()
        self.thread = None
        self.last_manual = 0
        with self.connect() as db:
            db.execute('PRAGMA journal_mode=WAL')
            db.executescript('''
                CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,name TEXT,url TEXT,topic TEXT,kind TEXT,interval_minutes INTEGER,enabled INTEGER DEFAULT 1,last_attempt TEXT,last_success TEXT,next_attempt REAL DEFAULT 0,etag TEXT,last_modified TEXT,error TEXT,failures INTEGER DEFAULT 0,item_count INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS articles(id TEXT PRIMARY KEY,url TEXT UNIQUE,title TEXT,published_at TEXT,first_seen TEXT,last_seen TEXT,topics TEXT,importance TEXT,reason TEXT,override_level TEXT,is_read INTEGER DEFAULT 0,starred INTEGER DEFAULT 0);
                CREATE TABLE IF NOT EXISTS article_sources(article_id TEXT,source_id TEXT,PRIMARY KEY(article_id,source_id));
                CREATE INDEX IF NOT EXISTS articles_published ON articles(published_at);
                CREATE INDEX IF NOT EXISTS articles_seen ON articles(first_seen);
            ''')
            for row in DEFAULT_SOURCES:
                db.execute('INSERT OR IGNORE INTO sources(id,name,url,topic,kind,interval_minutes) VALUES(?,?,?,?,?,?)', row)
            db.execute('CREATE TABLE IF NOT EXISTS feed_meta(key TEXT PRIMARY KEY,value TEXT)')
            if not db.execute("SELECT 1 FROM feed_meta WHERE key='hourly-v1'").fetchone():
                db.execute('UPDATE sources SET interval_minutes=60,next_attempt=0')
                db.execute("INSERT INTO feed_meta VALUES('hourly-v1','done')")
            if not db.execute("SELECT 1 FROM feed_meta WHERE key='classification-v2'").fetchone():
                db.execute("UPDATE sources SET topic='tech' WHERE id='ithome' AND topic='ai'")
                for article in db.execute('SELECT id,title FROM articles').fetchall():
                    topics=[];level='low';reason='一般信息'
                    for source in db.execute('SELECT s.topic,s.kind FROM sources s JOIN article_sources x ON s.id=x.source_id WHERE x.article_id=?',(article['id'],)).fetchall():
                        labels,importance,why=classify(article['title'],source['topic'],source['kind'])
                        topics=list(dict.fromkeys(topics+labels))
                        if ['low','medium','high'].index(importance)>=['low','medium','high'].index(level):level,reason=importance,why
                    db.execute('UPDATE articles SET topics=?,importance=?,reason=? WHERE id=?',(json.dumps(topics),level,reason,article['id']))
                db.execute("INSERT INTO feed_meta VALUES('classification-v2','done')")

        self.translator = TitleTranslator(self.connect)

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=20)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def start(self):
        if self.thread:
            return
        self.thread = threading.Thread(target=self.loop, daemon=True, name='rss-collector')
        self.thread.start()
        self.translator.start()

    def close(self):
        self.translator.close()
        self.stop_event.set()
        self.wake_event.set()

    def loop(self):
        while not self.stop_event.is_set():
            try:
                self.collect_due()
            except Exception:
                pass  # Individual source state exposes errors; collector remains alive.
            self.wake_event.wait(30)
            self.wake_event.clear()

    def collect_due(self):
        if not self.cycle_lock.acquire(blocking=False):
            return
        try:
            with self.connect() as db:
                hour = str(int(time.time() // 3600))
                previous = db.execute("SELECT value FROM feed_meta WHERE key='last-hour'").fetchone()
                if not previous or previous[0] != hour:
                    db.execute('UPDATE sources SET next_attempt=0 WHERE enabled=1')
                    db.execute("INSERT INTO feed_meta VALUES('last-hour',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (hour,))
                sources = [dict(x) for x in db.execute('SELECT * FROM sources WHERE enabled=1 AND next_attempt<=?',(time.time(),))]
            with ThreadPoolExecutor(max_workers=3) as pool:
                list(pool.map(self.collect_one, sources))
        finally:
            self.cycle_lock.release()

    def collect_one(self, source):
        headers = {}
        if source['etag']: headers['If-None-Match'] = source['etag']
        if source['last_modified']: headers['If-Modified-Since'] = source['last_modified']
        moment = utc()
        try:
            use_proxy = bool(self.proxy and self.proxy.available_for_fetch())
            status, data, response_headers = fetch_public(source['url'], headers, proxy=use_proxy)
            rows = parse_items(data) if status != 304 else None
            with self.connect() as db:
                if rows is not None:
                    for item in rows:
                        identifier = hashlib.sha256(item['url'].encode()).hexdigest()[:24]
                        topics, level, reason = classify(item['title'],source['topic'],source['kind'])
                        db.execute('''INSERT INTO articles(id,url,title,published_at,first_seen,last_seen,topics,importance,reason)
                            VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,last_seen=excluded.last_seen,published_at=COALESCE(excluded.published_at,articles.published_at)''',
                            (identifier,item['url'],item['title'],item['published_at'],moment,moment,json.dumps(topics),level,reason))
                        existing = db.execute('SELECT topics FROM articles WHERE id=?',(identifier,)).fetchone()
                        merged = list(dict.fromkeys(json.loads(existing[0])+topics))
                        db.execute('UPDATE articles SET topics=? WHERE id=?',(json.dumps(merged),identifier))
                        db.execute('INSERT OR IGNORE INTO article_sources VALUES(?,?)',(identifier,source['id']))
                db.execute('UPDATE sources SET last_attempt=?,last_success=?,next_attempt=?,etag=?,last_modified=?,error=NULL,failures=0,item_count=? WHERE id=?',
                    (moment,moment,(int(time.time() // 3600)+1)*3600,response_headers.get('etag',source['etag']),response_headers.get('last-modified',source['last_modified']),len(rows) if rows is not None else source['item_count'],source['id']))
        except Exception as exc:
            failure = source['failures'] + 1
            error = '订阅格式不可读' if isinstance(exc,(ET.ParseError,UnicodeError)) else '抓取失败（网络、地址或上游响应），保留历史内容'
            with self.connect() as db:
                db.execute('UPDATE sources SET last_attempt=?,next_attempt=?,error=?,failures=? WHERE id=?',(moment,(int(time.time() // 3600)+1)*3600,error,failure,source['id']))

    def sources(self):
        with self.connect() as db:
            rows = [dict(x) for x in db.execute('SELECT id,name,url,topic,kind,interval_minutes,enabled,last_attempt,last_success,next_attempt,error,failures,item_count FROM sources ORDER BY rowid')]
            total = db.execute('SELECT COUNT(*) FROM articles').fetchone()[0]
        for row in rows: row['name'] = SOURCE_NAMES.get(row['name'], row['name'])
        return {'sources':rows,'topics':TOPICS,'kinds':SOURCE_KINDS,'total':total,'running':bool(self.thread and self.thread.is_alive()),'collecting':self.cycle_lock.locked(),'next_update':(int(time.time() // 3600)+1)*3600,'interval_minutes':60,'timezone':'Asia/Shanghai'}

    def digest(self, moment=None):
        moment = moment or datetime.now(timezone.utc)
        local = moment.astimezone(timezone(timedelta(hours=8)))
        start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat(timespec='seconds')
        end = moment.astimezone(timezone.utc).isoformat(timespec='seconds')
        with self.connect() as db:
            rows = [dict(x) for x in db.execute("SELECT *,COALESCE(override_level,importance) AS effective_importance FROM articles WHERE published_at>=? AND published_at<=? ORDER BY CASE COALESCE(override_level,importance) WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,published_at DESC",(start,end))]
            unread = db.execute('SELECT COUNT(*) FROM articles WHERE is_read=0').fetchone()[0]
            for row in rows:
                row['topics']=json.loads(row['topics'])
                row['sources']=[dict(x) for x in db.execute('SELECT s.id,s.name,s.kind FROM sources s JOIN article_sources x ON x.source_id=s.id WHERE x.article_id=?',(row['id'],))]
        counts={}; selected=[];seen=set()
        for row in rows:
            key=re.sub(r'[^\w]','',row['title'].lower())
            source=row['sources'][0]['id'] if row['sources'] else 'unknown'
            if key in seen or counts.get(source,0)>=2:continue
            row['highlight_reason']='手动标记重点' if row['override_level']=='high' else row['reason']
            selected.append(row);seen.add(key);counts[source]=counts.get(source,0)+1
            if len(selected)==5:break
        topics={key:sum(key in row['topics'] for row in rows) for key in TOPICS}
        selected = self.translator.localize(selected)
        return {'date':local.date().isoformat(),'timezone':'Asia/Shanghai','items':selected,'today_total':len(rows),'unread':unread,'topics':topics,'method':'按重要程度、发布时间和来源分散度筛选；仅代表已收集内容。'}

    def refresh(self):
        if time.monotonic()-self.last_manual < 60:
            return {'queued':False,'message':'已安排刷新，请稍候；手动检查间隔至少一分钟'}
        self.last_manual = time.monotonic()
        with self.connect() as db:
            db.execute('UPDATE sources SET next_attempt=0 WHERE enabled=1')
        self.wake_event.set()
        return {'queued':True,'message':'已安排后台刷新，关闭页面也会继续'}

    def add_source(self, payload):
        url = payload.get('url','')
        if not isinstance(url,str):raise ValueError('请输入公开 RSS 地址')
        url = url.strip()
        public_target(url)
        if urlsplit(url).query:
            raise ValueError('RSS 地址不接受带查询参数的私密链接；代理订阅请使用代理页')
        name = str(payload.get('name','')).strip()[:80]
        topic, kind = payload.get('topic','general'),payload.get('kind','news')
        if not name or topic not in TOPICS or kind not in SOURCE_KINDS:
            raise ValueError('请填写来源名称和有效分类')
        with self.connect() as db:
            if db.execute('SELECT count(*) FROM sources').fetchone()[0]>=60:
                raise ValueError('最多 60 个来源')
            if db.execute('SELECT id FROM sources WHERE url=?',(url,)).fetchone():
                raise ValueError('这个来源已存在')
            identifier = uuid.uuid4().hex[:16]
            db.execute('INSERT INTO sources(id,name,url,topic,kind,interval_minutes) VALUES(?,?,?,?,?,60)',(identifier,name,url,topic,kind))
        self.wake_event.set()
        return {'id':identifier}

    def source_enabled(self, identifier, enabled):
        if not isinstance(enabled,bool): raise ValueError('状态不正确')
        with self.connect() as db:
            if not db.execute('SELECT id FROM sources WHERE id=?',(identifier,)).fetchone(): raise KeyError(identifier)
            db.execute('UPDATE sources SET enabled=?,next_attempt=0 WHERE id=?',(int(enabled),identifier))
        self.wake_event.set()
        return {'enabled':enabled}

    def update_article(self, identifier, data):
        updates, args = [], []
        for key in ('is_read','starred'):
            if key in data:
                if not isinstance(data[key],bool): raise ValueError('状态不正确')
                updates.append(key+'=?');args.append(int(data[key]))
        if 'importance' in data:
            value=data['importance']
            if value not in ('auto','high','medium','low'): raise ValueError('重要程度无效')
            updates.append('override_level=?');args.append(None if value=='auto' else value)
        if not updates: raise ValueError('没有修改内容')
        with self.connect() as db:
            if not db.execute('SELECT id FROM articles WHERE id=?',(identifier,)).fetchone(): raise KeyError(identifier)
            db.execute('UPDATE articles SET '+','.join(updates)+' WHERE id=?',args+[identifier])
        return {'updated':True}

    def query(self, params):
        get=lambda k,d='':params.get(k,[d])[0]
        period=get('period','7d')
        if period not in ('1d','7d','30d','all','unknown'):
            raise ValueError('时间范围无效')
        time_field=get('time_field','published')
        if time_field not in ('published','collected'):
            raise ValueError('时间口径无效')
        state=get('state')
        if state not in ('','unread','starred'):
            raise ValueError('阅读状态无效')
        importance=get('importance')
        if importance and importance not in ('high','medium','low'):
            raise ValueError('重要程度无效')
        sort=get('sort')
        if sort not in ('','time','importance'):
            raise ValueError('排序方式无效')
        clauses,args=[],[]
        query=get('q')[:200]
        if query:
            clauses.append("(title LIKE ? OR EXISTS(SELECT 1 FROM translations t WHERE t.original=a.title AND t.status='ready' AND t.translated LIKE ?))");args.extend(['%'+query+'%']*2)
        topic=get('topic')
        if topic in TOPICS:
            clauses.append('topics LIKE ?');args.append('%"'+topic+'"%')
        if importance:
            clauses.append('COALESCE(override_level,importance)=?');args.append(importance)
        source=get('source')
        if source:
            clauses.append('EXISTS(SELECT 1 FROM article_sources x WHERE x.article_id=a.id AND x.source_id=?)');args.append(source)
        kind=get('kind')
        if kind in SOURCE_KINDS:
            clauses.append('EXISTS(SELECT 1 FROM article_sources x JOIN sources s ON x.source_id=s.id WHERE x.article_id=a.id AND s.kind=?)');args.append(kind)
        if state=='unread':clauses.append('is_read=0')
        if state=='starred':clauses.append('starred=1')
        field='first_seen' if time_field=='collected' else 'published_at'
        if period in ('1d','7d','30d'):
            clauses.append(field+'>=?');args.append((datetime.now(timezone.utc)-timedelta(days=int(period[:-1]))).isoformat(timespec='seconds'))
        elif period=='unknown':clauses.append('published_at IS NULL')
        where=' WHERE '+' AND '.join(clauses) if clauses else ''
        page=max(1,min(10000,int(get('page','1'))))
        sort="CASE COALESCE(override_level,importance) WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END," if sort=='importance' else ''
        order=sort+field+' DESC,first_seen DESC'
        with self.connect() as db:
            total=db.execute('SELECT count(*) FROM articles a'+where,args).fetchone()[0]
            pages=max(1,(total+29)//30)
            page=min(page,pages)
            rows=[dict(x) for x in db.execute('SELECT * FROM articles a'+where+' ORDER BY '+order+' LIMIT 30 OFFSET ?',args+[(page-1)*30])]
            for row in rows:
                row['topics']=json.loads(row['topics'])
                row['effective_importance']=row['override_level'] or row['importance']
                row['sources']=[dict(s) for s in db.execute('SELECT s.id,s.name,s.kind FROM sources s JOIN article_sources x ON x.source_id=s.id WHERE x.article_id=?',(row['id'],))]
        rows = self.translator.localize(rows)
        return {'items':rows,'total':total,'page':page,'pages':pages,'collected_at':utc()}
