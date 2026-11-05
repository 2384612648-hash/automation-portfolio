import sys,unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from live_data import LiveService,SYMBOLS

class HourlyTests(unittest.TestCase):
    def test_hour_boundary_forces_refresh_without_browser(self):
        service=LiveService()
        with patch('live_data.market',return_value={'bars':[]}) as market,patch('live_data.forex',return_value={'series':{}}) as forex:
            self.assertTrue(service.run_due(3599))
            self.assertEqual(market.call_count,len(SYMBOLS));self.assertEqual(forex.call_count,1)
            self.assertFalse(service.run_due(3599.9))
            self.assertTrue(service.run_due(3600))
            self.assertEqual(market.call_count,len(SYMBOLS)*2);self.assertEqual(forex.call_count,2)
            self.assertFalse(service.run_due(3615))
        self.assertEqual(len(service.status()['resources']),9)
        self.assertFalse(service.status()['refreshing'])
        self.assertIsNotNone(service.status()['last_completed'])

    def test_failed_hour_keeps_last_success_and_next_hour_recovers(self):
        service=LiveService()
        with patch('live_data.market',return_value={'bars':[{'date':'2026-10-30','close':1}]}),patch('live_data.forex',return_value={'series':{}}):
            service.run_due(0)
        first=service.cache.entries['market:sp500:'][1]
        with patch('live_data.market',side_effect=OSError()),patch('live_data.forex',side_effect=OSError()):
            service.run_due(3600)
        stale=service.cache.entries['market:sp500:'][1]
        self.assertEqual(stale['data'],first['data']);self.assertEqual(stale['fetched_at'],first['fetched_at'])
        self.assertEqual(service.status()['resources']['sp500'],'stale')
        with patch('live_data.market',return_value={'bars':[]}),patch('live_data.forex',return_value={'series':{}}):
            service.run_due(7200)
        self.assertEqual(service.status()['resources']['forex'],'ok')

    def test_update_status_is_read_only_and_thread_lifecycle(self):
        service=LiveService()
        with patch.object(service,'run_due',return_value=False):
            service.start();self.assertTrue(service.status()['running']);service.close();service.thread.join(1)
        self.assertFalse(service.status()['running'])
