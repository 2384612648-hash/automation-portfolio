import sys
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from live_data import parse_bars, parse_feed, LiveCache, LiveService


class LiveTests(unittest.TestCase):
    def test_ohlc_rejects_corrupt_and_nonfinite_prices(self):
        data = parse_bars([
            ['2026-10-02', '2', '3', '4', '1', '100'],
            ['2026-10-01', '2', '1', '3', '1', '100'],
            ['bad-date', '1', '1', '1', '1', '1'],
            ['2026-10-03', '2', '3', '1', '2', '100'],
            ['2026-10-04', 'nan', '3', '4', '1', '100']])
        self.assertEqual([b['date'] for b in data], ['2026-10-01', '2026-10-02'])
        self.assertEqual(data[-1]['close'], 3)

    def test_rss_title_only_safe_links_dates_and_duplicates(self):
        xml = b'''<rss><channel><item><title>Alpha &amp; beta</title><link>https://example.com/a</link><pubDate>Tue, 27 Oct 2026 10:00:00 +0800</pubDate><description>Not included</description></item><item><title>Duplicate</title><link>https://example.com/a</link></item><item><title>Script</title><link>javascript:alert(1)</link></item><item><title>Unknown time</title><link>https://example.com/b</link><pubDate>bad</pubDate></item></channel></rss>'''
        rows = parse_feed(xml, 'test')
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]['title'], 'Alpha & beta')
        self.assertNotIn('description', rows[0])
        self.assertIsNone(rows[1]['published_at'])
        with self.assertRaises(ValueError):
            parse_feed(xml, 'test', ['chinanews.com.cn'])
        with self.assertRaises(ValueError):
            parse_feed(b'<!DOCTYPE rss [<!ENTITY x SYSTEM "file:///secret">]><rss/>', 'test')

    def test_cache_retains_timestamp_on_failure_and_retries(self):
        cache = LiveCache()
        with patch('live_data.time.monotonic', return_value=100):
            first = cache.get('a', 60, lambda: {'price': 2})
        with patch('live_data.time.monotonic', return_value=120):
            self.assertEqual(cache.get('a', 60, lambda: self.fail('Should use cache')), first)
        def broken(): raise OSError('offline')
        with patch('live_data.time.monotonic', return_value=161):
            failed = cache.get('a', 60, broken)
        self.assertEqual(failed['status'], 'stale')
        self.assertEqual(failed['data'], first['data'])
        self.assertEqual(failed['fetched_at'], first['fetched_at'])
        with patch('live_data.time.monotonic', return_value=222):
            recovered = cache.get('a', 60, lambda: {'price': 3})
        self.assertEqual(recovered['status'], 'ok')
        self.assertEqual(recovered['data']['price'], 3)
        self.assertEqual(LiveCache().get('x', 60, broken)['status'], 'error')

    def test_source_allowlist_does_not_fetch_user_urls(self):
        with patch('live_data.fetch_bytes') as fetch:
            with self.assertRaises(KeyError): LiveService().get('market', 'https://127.0.0.1')
            with self.assertRaises(KeyError): LiveService().get('news', '../../secret')
            fetch.assert_not_called()
