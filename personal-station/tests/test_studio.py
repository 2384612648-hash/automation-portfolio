import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timezone
from feed_service import FeedService

class StudioTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.service=FeedService(Path(self.tmp.name)/'feed.sqlite3')
    def tearDown(self):
        self.service.close();self.tmp.cleanup()
    def test_hourly_schedule_respects_pauses_and_retries_next_hour(self):
        with self.service.connect() as db:
            db.execute("UPDATE sources SET enabled=0")
            db.execute("UPDATE sources SET enabled=1 WHERE id='ithome'")
        with patch('feed_service.fetch_public',return_value=(200,b'<rss><channel/></rss>',{})) as fetch,patch('feed_service.time.time',return_value=7201):
            self.service.collect_due();self.service.collect_due();self.assertEqual(fetch.call_count,1)
        with patch('feed_service.fetch_public',side_effect=OSError()) as fetch,patch('feed_service.time.time',return_value=10801):
            self.service.collect_due();self.service.collect_due();self.assertEqual(fetch.call_count,1)
        with self.service.connect() as db:
            row=db.execute("SELECT * FROM sources WHERE id='ithome'").fetchone();self.assertEqual(row['next_attempt'],14400);self.assertEqual(row['failures'],1)
    def test_today_digest_uses_shanghai_day_priority_and_source_diversity(self):
        entries=[('yesterday','2026-10-31T15:59:59+00:00','high',None,'ithome'),('midnight','2026-10-31T16:00:00+00:00','low','high','ithome'),('unknown',None,'high',None,'ithome'),('future','2026-11-01T04:00:01+00:00','high',None,'ithome'),('one','2026-11-01T01:00:00+00:00','medium',None,'ithome'),('two','2026-11-01T02:00:00+00:00','medium',None,'ithome'),('other','2026-11-01T03:00:00+00:00','medium',None,'custom')]
        with self.service.connect() as db:
            db.execute("INSERT INTO sources(id,name,topic,kind,interval_minutes) VALUES('custom','custom','world','news',60)")
            for name,date,level,override,source in entries:
                db.execute('INSERT INTO articles(id,url,title,published_at,topics,importance,reason,override_level) VALUES(?,?,?,?,?,?,?,?)',(name,'https://example.com/'+name,name,date,'["world"]',level,'rule',override))
                db.execute('INSERT INTO article_sources VALUES(?,?)',(name,source))
        result=self.service.digest(datetime(2026,11,1,4,tzinfo=timezone.utc))
        self.assertEqual(result['today_total'],4);self.assertEqual(result['date'],'2026-11-01')
        self.assertEqual([r['id'] for r in result['items']],['midnight','other','two'])
        self.assertEqual(result['items'][0]['highlight_reason'],'手动标记重点')
    def test_hourly_migration_preserves_custom_disabled_source_and_article_state(self):
        with self.service.connect() as db:
            db.execute("DELETE FROM feed_meta WHERE key='hourly-v1'")
            db.execute("UPDATE sources SET enabled=0,interval_minutes=15 WHERE id='ithome'")
        other=FeedService(self.service.path)
        with other.connect() as db:
            row=db.execute("SELECT enabled,interval_minutes FROM sources WHERE id='ithome'").fetchone();self.assertEqual(tuple(row),(0,60))
        other.close()
