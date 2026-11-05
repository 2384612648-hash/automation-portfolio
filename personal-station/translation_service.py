"""Offline English news-title translation. Original articles are never overwritten."""
import hashlib
import os
import re
import threading
import time
from pathlib import Path

MODEL_VERSION = 'opus-en-zh-dcd22168-int8-v1'
SOURCE_NAMES = {'BBC · World': '英国广播公司 · 国际', 'The Guardian · World': '卫报 · 国际', 'IEEE Spectrum · Robotics': 'IEEE 机器人', 'arXiv · Robotics': 'arXiv · 机器人', 'arXiv · AI': 'arXiv · 人工智能', 'arXiv · Systems and Control': 'arXiv · 系统与控制', 'BBC World': '英国广播公司 · 国际', 'The Guardian World': '卫报 · 国际', 'GitHub Blog': 'GitHub 官方博客', 'Hacker News': '黑客新闻', 'MIT News': '麻省理工新闻', 'IEEE Spectrum Robotics': 'IEEE 机器人', 'Nature': '自然期刊'}

def needs_translation(text):
    chinese = len(re.findall(r'[\u3400-\u9fff]', text))
    latin = len(re.findall(r'[A-Za-z]', text))
    return latin >= 8 and chinese < max(4, latin * .12)

def cache_key(text):
    return hashlib.sha256((MODEL_VERSION + '\n' + text).encode()).hexdigest()

class TitleTranslator:
    def __init__(self, connect):
        self.connect = connect
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.thread = None
        self.model = None
        self.error = None
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS translations(key TEXT PRIMARY KEY,original TEXT,translated TEXT,status TEXT,attempts INTEGER DEFAULT 0,next_attempt REAL DEFAULT 0)')

    def start(self):
        if not self.thread:
            self.thread = threading.Thread(target=self.loop, daemon=True, name='news-translator')
            self.thread.start()

    def close(self):
        self.stop.set()
        self.wake.set()

    def translate(self, titles):
        if self.model is None:
            import ctranslate2
            import sentencepiece
            path = Path(os.environ.get('STATION_TRANSLATION_MODEL', str(Path(__file__).parent / 'models/en-zh')))
            self.source = sentencepiece.SentencePieceProcessor(model_file=str(path / 'source.spm'))
            self.target = sentencepiece.SentencePieceProcessor(model_file=str(path / 'target.spm'))
            self.model = ctranslate2.Translator(str(path), device='cpu', compute_type='int8', inter_threads=1, intra_threads=2)
        tokens = [self.source.encode(t, out_type=str) + ['</s>'] for t in titles]
        outputs = self.model.translate_batch(tokens, beam_size=4, max_decoding_length=256, repetition_penalty=1.1)
        results = []
        for output in outputs:
            text = self.target.decode(output.hypotheses[0]).strip()
            text = re.sub(r'(?<=[\u3400-\u9fff]) +(?=[\u3400-\u9fff])', '', text)
            results.append(text if re.search(r'[\u3400-\u9fff]', text) and len(text) <= 600 else None)
        return results

    def run_batch(self):
        with self.connect() as db:
            rows = db.execute('SELECT title FROM articles ORDER BY published_at DESC,first_seen DESC').fetchall()
            pending = []
            seen = set()
            for row in rows:
                title = row['title']
                if not needs_translation(title): continue
                key = cache_key(title)
                if key in seen: continue
                seen.add(key)
                old = db.execute('SELECT status,next_attempt FROM translations WHERE key=?', (key,)).fetchone()
                if old and (old['status'] == 'ready' or old['next_attempt'] > time.time()): continue
                pending.append((key, title))
                if len(pending) == 8: break
        if not pending: return False
        try:
            results = self.translate([title for _,title in pending])
            self.error = None
        except Exception:
            self.error = '翻译引擎暂不可用'
            results = [None] * len(pending)
        with self.connect() as db:
            for (key,title),translated in zip(pending,results):
                db.execute('INSERT INTO translations(key,original,translated,status,attempts,next_attempt) VALUES(?,?,?,?,1,?) ON CONFLICT(key) DO UPDATE SET translated=excluded.translated,status=excluded.status,attempts=translations.attempts+1,next_attempt=excluded.next_attempt',
                           (key,title,translated,'ready' if translated else 'retry',0 if translated else time.time()+3600))
        return True

    def loop(self):
        while not self.stop.is_set():
            try: more = self.run_batch()
            except Exception: more = False
            self.wake.wait(.1 if more else 30)
            self.wake.clear()

    def localize(self, rows):
        with self.connect() as db:
            for row in rows:
                original = row['title']
                if needs_translation(original):
                    cached = db.execute('SELECT translated,status FROM translations WHERE key=?',(cache_key(original),)).fetchone()
                    row['original_title'] = original
                    row['translation_status'] = 'ready' if cached and cached['status'] == 'ready' else 'retry' if cached else 'pending'
                    row['title'] = cached['translated'] if row['translation_status'] == 'ready' else '翻译暂不可用' if cached else '中文翻译中'
                else:
                    row['translation_status'] = 'original'
                for source in row.get('sources', []):
                    source['name'] = SOURCE_NAMES.get(source['name'], source['name'])
        self.wake.set()
        return rows
