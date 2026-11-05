import sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from feed_service import FeedService
from translation_service import cache_key, needs_translation
from live_data import LiveService, market, parse_bars
from datetime import date, timedelta

class TranslationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.feeds=FeedService(Path(self.tmp.name)/'feeds.sqlite3')
        with self.feeds.connect() as db:
            db.execute("INSERT INTO articles(id,url,title,topics,importance,first_seen) VALUES('test','https://example.com/a','Scientists develop new batteries',?,'medium','2026-11-01')", ('["science"]',))
    def tearDown(self):self.feeds.close();self.tmp.cleanup()
    def test_persist_original_and_search_chinese(self):
        with patch.object(self.feeds.translator,'translate',return_value=['科学家研发新电池']):
            self.assertTrue(self.feeds.translator.run_batch());self.assertFalse(self.feeds.translator.run_batch())
        row=self.feeds.query({'period':['all']})['items'][0]
        self.assertEqual(row['title'],'科学家研发新电池');self.assertEqual(row['original_title'],'Scientists develop new batteries')
        self.assertEqual(self.feeds.query({'q':['电池'],'period':['all']})['total'],1)
        with self.feeds.connect() as db:
            self.assertEqual(db.execute("SELECT title FROM articles").fetchone()[0],row['original_title'])
            db.execute("UPDATE articles SET title='Scientists develop safer batteries'")
        self.assertEqual(self.feeds.query({'period':['all']})['items'][0]['translation_status'],'pending')
    def test_failure_backoff_and_chinese_passthrough(self):
        with patch.object(self.feeds.translator,'translate',side_effect=RuntimeError('offline')) as call:
            self.assertTrue(self.feeds.translator.run_batch());self.assertFalse(self.feeds.translator.run_batch());self.assertEqual(call.call_count,1)
        row=self.feeds.query({'period':['all']})['items'][0]
        self.assertEqual(row['title'],'翻译暂不可用');self.assertEqual(row['translation_status'],'retry')
        self.assertFalse(needs_translation('国产机器人发布新版 ROS 2 系统'));self.assertTrue(needs_translation('A new robot learns complex tasks'))
        self.assertNotEqual(cache_key('A title'),cache_key('Another title'))
    def test_history_validates_dates_and_keeps_more_than_260(self):
        rows=[[(date(2024,1,1)+timedelta(days=i)).isoformat(),1,2,3,1,10] for i in range(1200)]
        self.assertEqual(len(parse_bars(rows)),1200)
        with patch('live_data.fetch_json',return_value={'data':{'us.INX':{'day':rows}}}) as fetch:
            result=market('sp500','2024-06-01');self.assertTrue(all(b['date']<'2024-06-01' for b in result['bars']));self.assertIn(',day,,2024-06-01,1200,',fetch.call_args.args[0])
        for bad in ['2024-99-01','2024-01-01,https://evil','../','2024-1-1']:
            with self.assertRaises(ValueError):LiveService().get_market('sp500',bad)
