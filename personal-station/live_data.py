"""Read-only, fixed-source market and RSS adapters. No credentials or user URLs."""
import json
import math
import re
import threading
import time
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

SYMBOLS = {
    'sp500': ('us.INX', '标普 500', '美股指数', '点', 'America/New_York'),
    'nasdaq': ('us.IXIC', '纳斯达克综合', '美股指数', '点', 'America/New_York'),
    'dow': ('us.DJI', '道琼斯工业', '美股指数', '点', 'America/New_York'),
    'hsi': ('hkHSI', '恒生指数', '港股指数', '点', 'Asia/Hong_Kong'),
    'shanghai': ('sh000001', '上证指数', 'A 股指数', '点', 'Asia/Shanghai'),
    'shenzhen': ('sz399001', '深证成指', 'A 股指数', '点', 'Asia/Shanghai'),
    'chinext': ('sz399006', '创业板指', 'A 股指数', '点', 'Asia/Shanghai'),
    'csi300': ('sh000300', '沪深 300', 'A 股指数', '点', 'Asia/Shanghai'),
}
FEEDS = {
    'latest': ('即时', '中国新闻网', 'https://www.chinanews.com.cn/rss/scroll-news.xml'),
    'finance': ('财经', '中国新闻网', 'https://www.chinanews.com.cn/rss/finance.xml'),
    'world': ('国际', '中国新闻网', 'https://www.chinanews.com.cn/rss/world.xml'),
    'tech': ('科技', 'IT之家', 'https://www.ithome.com/rss/'),
}

def stamp():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')

def fetch_bytes(url):
    # Only callers above construct URLs; endpoints never accept arbitrary URLs.
    with urlopen(Request(url, headers={'User-Agent': 'ZeroPersonalStation/1.0', 'Accept': '*/*'}), timeout=10) as response:
        data = response.read(2_000_001)
    if len(data) > 2_000_000:
        raise ValueError('数据源响应过大')
    return data

def fetch_json(url):
    return json.loads(fetch_bytes(url))

def positive(value):
    result = float(value)
    if not math.isfinite(result) or result <= 0:
        raise ValueError('无效价格')
    return result

def parse_bars(rows):
    bars = {}
    for row in rows:
        try:
            date = datetime.strptime(row[0], '%Y-%m-%d').date().isoformat()
            o, c, h, low = map(positive, row[1:5])
            if low > min(o, c) or h < max(o, c) or h < low:
                continue
            volume = float(row[5])
            if not math.isfinite(volume) or volume < 0:
                continue
            bars[date] = dict(date=date, open=o, close=c, high=h, low=low, volume=volume)
        except (ValueError, TypeError, IndexError):
            continue
    if not bars:
        raise ValueError('数据源没有有效 K 线')
    return [bars[d] for d in sorted(bars)]

def market(key, before=""):
    if before:
        if not re.fullmatch(r"20\d{2}-\d{2}-\d{2}|19\d{2}-\d{2}-\d{2}", before):
            raise ValueError("历史日期无效")
        datetime.strptime(before, "%Y-%m-%d")
    symbol, name, kind, unit, zone = SYMBOLS[key]
    # Unadjusted prices for honest comparison with quotes; ETF distributions not reinvested.
    raw = fetch_json('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + symbol + ',day,,' + before + ',1200,')
    entry = raw['data'][symbol]
    rows = entry.get('day', [])
    bars = parse_bars(rows) if rows else []
    if before: bars = [b for b in bars if b['date'] < before]
    if not bars and not before: raise ValueError('行情为空')
    return dict(id=key, name=name, kind=kind, unit=unit, timezone=zone, bars=bars, has_more=bool(bars) and len(rows)>=1000,
                source='腾讯财经', source_url='https://gu.qq.com/' + symbol,
                frequency='日线 · 未复权 · 当日可能未收盘', delay='公开行情，延迟未承诺')

def forex():
    start = (datetime.now(timezone.utc).date() - timedelta(days=400)).isoformat()
    rows = fetch_json('https://api.frankfurter.dev/v2/rates?base=USD&quotes=CNY,EUR,JPY&providers=ECB&from=' + start)
    series = {key: {} for key in ['CNY', 'EUR', 'JPY']}
    for row in rows:
        if row.get('base') != 'USD' or row.get('quote') not in series:
            continue
        date = datetime.strptime(row['date'], '%Y-%m-%d').date().isoformat()
        series[row['quote']][date] = positive(row['rate'])
    if any(not rows for rows in series.values()):
        raise ValueError('汇率数据不完整')
    return dict(base='USD', series={key: [dict(date=d, value=v[d]) for d in sorted(v)] for key, v in series.items()},
                source='Frankfurter / ECB', source_url='https://frankfurter.dev/', frequency='每日参考汇率，不是盘中报价')

def safe_link(url):
    try:
        parts = urlsplit(url)
        return parts.scheme in ('https', 'http') and bool(parts.hostname) and not parts.username and not parts.password and not any(c.isspace() for c in url)
    except ValueError:
        return False

def parse_feed(data, source, allowed_hosts=None):
    # ElementTree does not load external entities; additionally reject DTD/entity declarations.
    if re.search(br'<!\s*(DOCTYPE|ENTITY)', data, re.I):
        raise ValueError('不支持的订阅格式')
    root = ET.fromstring(data)
    items, seen = [], set()
    for item in root.findall('.//item'):
        title = (item.findtext('title') or '').strip()[:300]
        link = (item.findtext('link') or '').strip()
        if not title or not safe_link(link) or link in seen:
            continue
        host = urlsplit(link).hostname.lower()
        if allowed_hosts and not any(host == domain or host.endswith('.' + domain) for domain in allowed_hosts):
            continue
        seen.add(link)
        raw_date = (item.findtext('pubDate') or '').strip()
        try:
            date = parsedate_to_datetime(raw_date)
            date = date.isoformat() if date.tzinfo else None
        except (ValueError, TypeError, OverflowError):
            date = None
        items.append(dict(title=title, url=link, published_at=date, source=source))
    if not items:
        raise ValueError('订阅源暂时没有可读条目')
    items.sort(key=lambda item: datetime.fromisoformat(item['published_at']).timestamp() if item['published_at'] else 0, reverse=True)
    return items[:40]

def news(key):
    label, source, url = FEEDS[key]
    hosts = ['ithome.com'] if key == 'tech' else ['chinanews.com.cn', 'chinanews.com']
    return dict(id=key, label=label, source=source, source_url=url, items=parse_feed(fetch_bytes(url), source, hosts))

class LiveCache:
    """Per-key single flight; failed refreshes retain last success and its timestamp."""
    def __init__(self):
        self.entries = {}
        self.locks = {}
        self.guard = threading.Lock()

    def get(self, key, ttl, loader, force=False):
        with self.guard:
            if len(self.entries) >= 256 and key not in self.entries:
                oldest = min(self.entries, key=lambda k: self.entries[k][0])
                self.entries.pop(oldest, None)
            lock = self.locks.setdefault(key, threading.Lock())
        with lock:
            old = self.entries.get(key)
            if not force and old and time.monotonic() < old[0]:
                return old[1]
            try:
                result = dict(status='ok', fetched_at=stamp(), data=loader(), error=None)
                wait = ttl
            except Exception:
                result = dict(status='stale' if old and old[1]['data'] else 'error',
                              fetched_at=old[1]['fetched_at'] if old else None,
                              data=old[1]['data'] if old else None,
                              error='数据源暂时无法连接，稍后会自动重试。')
                wait = 60
            self.entries[key] = (time.monotonic() + wait, result)
            return result

class LiveService:
    def __init__(self):
        self.cache = LiveCache()
        self.stop = threading.Event()
        self.thread = None
        self.refresh_lock = threading.Lock()
        self.last_hour = None
        self.last_started = None
        self.last_completed = None
        self.refreshing = False
        self.last_results = {}

    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self.loop, name='market-hourly-refresh', daemon=True)
            self.thread.start()

    def close(self):
        self.stop.set()

    def run_due(self, now=None):
        now = time.time() if now is None else now
        hour = int(now // 3600)
        if hour == self.last_hour or not self.refresh_lock.acquire(blocking=False):
            return False
        try:
            if hour == self.last_hour:
                return False
            self.last_hour = hour
            self.last_started = stamp()
            self.refreshing = True
            keys = list(SYMBOLS)
            def refresh(key):
                return self.cache.get('market:' + key + ':', 60, lambda: market(key), force=True)
            with ThreadPoolExecutor(max_workers=3) as pool:
                values = list(pool.map(refresh, keys))
            fx = self.cache.get('forex', 3600, forex, force=True)
            self.last_results = {key: value['status'] for key, value in zip(keys, values)}
            self.last_results['forex'] = fx['status']
            self.last_completed = stamp()
            return True
        finally:
            self.refreshing = False
            self.refresh_lock.release()

    def loop(self):
        while not self.stop.is_set():
            try:
                self.run_due()
            except Exception:
                pass  # Each source reports its own stale/error result; next hour retries.
            self.stop.wait(15)

    def status(self):
        return dict(running=bool(self.thread and self.thread.is_alive()), refreshing=self.refreshing,
                    last_started=self.last_started, last_completed=self.last_completed,
                    next_update=(int(time.time() // 3600) + 1) * 3600,
                    interval_minutes=60, resources=dict(self.last_results))

    def get_market(self, key, before=''):
        if key not in SYMBOLS:
            raise KeyError(key)
        if before:
            if not re.fullmatch(r'(19|20)\d{2}-\d{2}-\d{2}', before): raise ValueError('历史日期无效')
            datetime.strptime(before, '%Y-%m-%d')
        return self.cache.get('market:' + key + ':' + before, 86400 if before else 60, lambda: market(key, before))

    def overview(self):
        # A bounded pool keeps independent sources responsive without request fan-out per client.
        keys = list(SYMBOLS)
        with ThreadPoolExecutor(max_workers=4) as pool:
            values = list(pool.map(self.get_market, keys))
        result = []
        for key, value in zip(keys, values):
            payload = dict(value)
            if payload['data']:
                data = dict(payload['data'])
                bars = data.pop('bars')
                data.update(last=bars[-1], previous=bars[-2] if len(bars) > 1 else None, sparkline=[{'date':b['date'],'value':b['close']} for b in bars[-30:]])
                payload['data'] = data
            result.append(dict(id=key, name=SYMBOLS[key][1], **payload))
        return result

    def get(self, resource, key, before=''):
        if resource == 'market':
            return self.get_market(key, before)
        if resource == 'overview':
            return self.cache.get('overview', 60, self.overview)
        if resource == 'forex':
            return self.cache.get('forex', 3600, forex)
        if resource == 'news' and key in FEEDS:
            return self.cache.get('news:' + key, 300, lambda: news(key))
        raise KeyError(resource)
