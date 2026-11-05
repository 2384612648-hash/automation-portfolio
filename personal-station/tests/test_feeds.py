import json
import gzip
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from datetime import datetime, timezone
from feed_service import FeedService, parse_items, parsed_date
from safe_http import public_target, fetch_public
from proxy_service import ProxyService


RSS=b'<rss><channel><item><title>Robot control release</title><link>https://example.com/a?utm_source=test</link><pubDate>Sun, 01 Nov 2026 01:00:00 +0000</pubDate></item></channel></rss>'


class FeedTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.service=FeedService(Path(self.temp.name)/'feeds.sqlite3')

    def tearDown(self):
        self.service.close();self.temp.cleanup()

    def source(self):
        with self.service.connect() as db:
            return dict(db.execute('SELECT * FROM sources LIMIT 1').fetchone())

    def test_atom_rdf_dates_empty_and_xml_rejection(self):
        atom=b'<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>AI update</title><link href="https://example.com/atom"/><published>2026-10-31T04:00:00Z</published></entry></feed>'
        self.assertEqual(parse_items(atom)[0]['url'],'https://example.com/atom')
        rdf=b'<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://purl.org/rss/1.0/"><item><title>Science</title><link>https://example.com/science</link></item></rdf:RDF>'
        self.assertEqual(parse_items(rdf)[0]['published_at'],None)
        self.assertEqual(parse_items(b'<rss><channel/></rss>'),[])
        for data in (b'<html/>',b'<!DOCTYPE rss><rss/>'):
            with self.assertRaises(ValueError):parse_items(data)
        self.assertIsNone(parsed_date('2099-01-01T00:00:00Z'))
        self.assertIsNone(parsed_date('2026-10-31T00:00:00'))

    def test_html_doctype_inside_cdata_is_text_but_xml_dtd_is_rejected(self):
        feed = '<rss><channel><item><title>GitHub update</title><link>https://example.com/news</link><description><![CDATA[<!DOCTYPE html><html>Article</html>]]></description></item></channel></rss>'
        for encoding in ('utf-8', 'utf-16'):
            self.assertEqual(parse_items(feed.encode(encoding))[0]['title'], 'GitHub update')
            for dtd in ('<!DOCTYPE rss SYSTEM "https://example.com/external.dtd">', '<!DOCTYPE rss [<!ENTITY test "expanded">]>'):
                with self.assertRaises(ValueError):
                    parse_items((dtd + '<rss><channel/></rss>').encode(encoding))

    def test_persistence_dedup_manual_tags_and_failed_refresh(self):
        source=self.source()
        with patch('feed_service.fetch_public',return_value=(200,RSS,{'etag':'v1'})):
            self.service.collect_one(source);self.service.collect_one(source)
        result=self.service.query({'period':['all']})
        self.assertEqual(result['total'],1)
        item=result['items'][0]
        self.assertEqual(item['url'],'https://example.com/a')
        self.assertIn('robotics',item['topics'])
        self.service.update_article(item['id'],{'importance':'high','is_read':True,'starred':True})
        with patch('feed_service.fetch_public',side_effect=OSError('private URL must never leak')):
            self.service.collect_one(self.source())
        reread=FeedService(self.service.path).query({'period':['all'],'importance':['high'],'state':['starred']})
        self.assertEqual(reread['total'],1)
        self.assertEqual(reread['items'][0]['is_read'],1)
        self.assertEqual(self.service.query({'period':['all'],'state':['unread']})['total'],0)
        self.assertNotIn('private URL',json.dumps(self.service.sources()))
        self.assertIsNotNone(self.source()['last_success'])

    def test_private_destinations_and_bad_subscription_are_rejected(self):
        for url in ('http://127.0.0.1/','https://100.64.0.1/','http://169.254.169.254/','https://user:pass@example.com/','file:///secret'):
            with self.assertRaises(ValueError):public_target(url)
        # Mixed public/private DNS answers are rejected before connecting.
        with patch('safe_http.socket.getaddrinfo',return_value=[(2,1,6,'',('8.8.8.8',443)),(2,1,6,'',('10.0.0.1',443))]):
            with self.assertRaises(ValueError):public_target('https://example.test/')

    def test_proxy_status_never_exposes_url_or_secret(self):
        service=ProxyService(Path(self.temp.name)/'proxy',binary=Path(self.temp.name)/'absent')
        service.settings['subscription_url']='https://example.com/private?token=secret-value'
        status=json.dumps(service.status())
        self.assertNotIn('secret-value',status)
        self.assertNotIn(service.secret,status)
        with self.assertRaises(ValueError):service.action({'action':'subscription','url':'http://127.0.0.1/'})
        service.close()

    def test_304_preserves_content_and_empty_source_is_success(self):
        source=self.source()
        with patch('feed_service.fetch_public',return_value=(200,RSS,{})):self.service.collect_one(source)
        with patch('feed_service.fetch_public',return_value=(304,b'',{})):self.service.collect_one(self.source())
        self.assertEqual(self.service.query({'period':['all']})['total'],1)

        with patch('feed_service.fetch_public',return_value=(200,b'<rss><channel/></rss>',{})):self.service.collect_one(self.source())
        self.assertIsNone(self.source()['error'])
        self.assertEqual(self.source()['item_count'],0)
        self.assertEqual(self.service.query({'period':['all']})['total'],1)

    def test_compressed_feed_limits_and_truncation(self):
        from unittest.mock import MagicMock
        response=MagicMock(status=200)
        response.getheader.side_effect=lambda k: 'gzip' if k=='Content-Encoding' else None
        response.getheaders.return_value=[('Content-Encoding','gzip'),('ETag','abc')]
        connection=MagicMock()
        connection.getresponse.return_value=response
        with patch('safe_http.public_target',return_value=(__import__('urllib.parse',fromlist=['urlsplit']).urlsplit('https://example.test/rss'),443,'8.8.8.8')), patch('safe_http.PinnedHTTPS',return_value=connection):
            response.read.return_value=gzip.compress(RSS)
            self.assertEqual(fetch_public('https://example.test/rss')[1],RSS)
            response.read.return_value=gzip.compress(b'x'*10000)
            with self.assertRaises(ValueError):fetch_public('https://example.test/rss',limit=1000)
            response.read.return_value=gzip.compress(RSS)[:-5]
            with self.assertRaises(ValueError):fetch_public('https://example.test/rss')

    def test_classification_migration_preserves_manual_state(self):
        with self.service.connect() as db:
            db.execute("UPDATE sources SET topic='ai' WHERE id='ithome'")
            source=dict(db.execute("SELECT * FROM sources WHERE id='ithome'").fetchone())
        data=b'<rss><channel><item><title>New game announced</title><link>https://example.com/game</link></item></channel></rss>'
        with patch('feed_service.fetch_public',return_value=(200,data,{})):self.service.collect_one(source)
        item=self.service.query({'period':['all']})['items'][0]
        self.service.update_article(item['id'],{'importance':'high','is_read':True,'starred':True})
        with self.service.connect() as db:db.execute("DELETE FROM feed_meta WHERE key='classification-v2'")
        migrated=FeedService(self.service.path)
        result=migrated.query({'period':['all'],'topic':['tech']})
        self.assertEqual(result['total'],1)
        self.assertNotIn('ai',result['items'][0]['topics'])
        self.assertEqual(result['items'][0]['effective_importance'],'high')
        self.assertEqual(result['items'][0]['is_read'],1)
        self.assertEqual(result['items'][0]['starred'],1)
        self.assertEqual(migrated.query({'period':['1d']})['total'],0)
        self.assertEqual(migrated.query({'period':['1d'],'time_field':['collected']})['total'],1)
        migrated.close()


if __name__=='__main__':unittest.main()
