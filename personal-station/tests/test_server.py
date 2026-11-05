import http.client
import json
import tempfile
import threading
import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import make_server, Store, remote_origin


class StationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix="station-test-")
        self.server = make_server("127.0.0.1", 0, self.tmp.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        self.token = self.request("GET", "/api/state")[1]["token"]

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, path, data=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port)
        merged = {"Content-Type": "application/json", "X-Station-Token": getattr(self, "token", "")}
        merged.update(headers or {})
        connection.request(method, path, json.dumps(data) if data is not None else None, merged)
        response = connection.getresponse()
        raw = response.read()
        status = response.status
        connection.close()
        try:
            return status, json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return status, raw

    def sample(self, **kwargs):
        return {"title": "中文收藏 <script>", "url": "https://example.org/notes?topic=ai#one", "note": "第一行\n第二行", "tags": ["AI", "C++"], "kind": "article", "starred": False, "is_read": False, **kwargs}

    def test_feed_api_persistence_today_and_request_guards(self):
        from unittest.mock import patch
        service=self.server.feed_service
        with service.connect() as db:
            source=dict(db.execute("SELECT * FROM sources WHERE id='ithome'").fetchone())
        rss=b'<rss><channel><item><title>New game</title><link>https://example.com/game</link></item></channel></rss>'
        with patch('feed_service.fetch_public',return_value=(200,rss,{})):service.collect_one(source)
        status,result=self.request('GET','/api/feeds?period=all&topic=tech')
        self.assertEqual(status,200);self.assertEqual(result['total'],1)
        identifier=result['items'][0]['id']
        self.assertEqual(self.request('GET','/api/live/news?id=tech')[1]['data']['items'][0]['id'],identifier)
        for path,payload in [('/api/proxy',{'action':'stop'}),('/api/feeds/refresh',{}),('/api/feeds/sources',{})]:
            self.assertEqual(self.request('POST',path,payload,{'X-Station-Token':'invalid'})[0],403)
            self.assertEqual(self.request('POST',path,payload,{'Origin':'https://elsewhere.test'})[0],403)
        self.assertEqual(self.request('PUT','/api/feeds/items/'+identifier,{'importance':'high','starred':True})[0],200)
        self.assertEqual(self.request('GET','/api/feeds?period=all&importance=high&state=starred')[1]['total'],1)
        self.assertEqual(self.request('PUT','/api/feeds/sources/ithome',{'enabled':False})[0],200)
        self.assertEqual(self.request('GET','/api/feeds?period=all')[1]['total'],1)
        self.assertEqual(self.request('GET','/api/feeds?page=bad')[0],400)
        for bad in ('period=bogus','time_field=bogus','state=bogus','sort=bogus','importance=urgent'):
            self.assertEqual(self.request('GET','/api/feeds?'+bad)[0],400,bad)
        clamped=self.request('GET','/api/feeds?period=all&page=99')[1]
        self.assertEqual(clamped['page'],clamped['pages'])
        self.assertEqual(len(clamped['items']),1)
        self.assertEqual(self.request('GET','/api/state')[1]['bookmarks'],[])

    def test_crud_and_persistence(self):
        status, rejected = self.request("POST", "/api/bookmarks", self.sample(tags="not-a-list"))
        self.assertEqual(status, 400)
        self.assertIn("标签需要是列表", rejected["error"])
        status, item = self.request("POST", "/api/bookmarks", self.sample())
        self.assertEqual(status, 201)
        status, saved = self.request("PUT", "/api/bookmarks/" + item["id"], {**item, "starred": True, "is_read": True})
        self.assertEqual(status, 200)
        self.assertTrue(saved["starred"])
        self.assertEqual(item["created_at"], saved["created_at"])
        independent = Store(Path(self.tmp.name) / "station.sqlite3")
        self.assertEqual(independent.all()[0]["note"], "第一行\n第二行")
        self.assertEqual(self.request("DELETE", "/api/bookmarks/" + item["id"], {})[0], 200)
        self.assertIsNotNone(independent.all()[0]["deleted_at"])
        self.assertEqual(self.request("POST", "/api/bookmarks/" + item["id"] + "/restore", {})[0], 200)
        self.assertIsNone(independent.all()[0]["deleted_at"])

    def test_duplicate_does_not_overwrite_and_restore_conflict(self):
        _, first = self.request("POST", "/api/bookmarks", self.sample(url="https://example.org"))
        self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(url="https://EXAMPLE.org/", title="changed"))[0], 409)
        self.assertEqual(self.request("GET", "/api/state")[1]["bookmarks"][0]["title"], first["title"])
        self.request("DELETE", "/api/bookmarks/" + first["id"], {})
        self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(url="https://example.org/"))[0], 201)
        self.assertEqual(self.request("POST", "/api/bookmarks/" + first["id"] + "/restore", {})[0], 409)
        self.assertEqual(len(self.request("GET", "/api/state")[1]["bookmarks"]), 2)

    def test_import_validates_all_before_writing_and_roundtrip(self):
        payload = {"format":"personal-station", "version":1, "bookmarks":[self.sample(), self.sample(url="javascript:alert(1)")]}
        self.assertEqual(self.request("POST", "/api/import", payload)[0], 400)
        self.assertEqual(self.request("GET", "/api/state")[1]["bookmarks"], [])
        payload["bookmarks"] = [self.sample()]
        self.assertEqual(self.request("POST", "/api/import", payload)[1], {"added":1,"skipped":0})
        exported = self.request("GET", "/api/export")[1]
        self.assertEqual(self.request("POST", "/api/import", exported)[1], {"added":0,"skipped":1})
        second_dir = Path(self.tmp.name) / "migrated"
        second = Store(second_dir / "station.sqlite3")
        self.assertEqual(second.import_items(exported), {"added":1,"skipped":0})
        self.assertEqual(second.all()[0]["created_at"], exported["bookmarks"][0]["created_at"])

    def test_request_and_url_guards(self):
        self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(), {"X-Station-Token":"invalid"})[0],403)
        self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(), {"Origin":"https://elsewhere.test"})[0],403)
        self.assertEqual(self.request("GET", "/api/state", headers={"Host":"elsewhere.test"})[0],403)
        for changes in ({"url":"file:///C:/secret"},{"url":"https://user:secret@example.org"},{"title":""},{"kind":[]},{"tags":[123]}, {"starred":"yes"}):
            self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(**changes))[0],400)
        for path in ("/../server.py", "/%2e%2e/server.py", "/..%5cserver.py", "/api/missing"):
            self.assertEqual(self.request("GET", path)[0],404)
            self.assertEqual(self.request("HEAD", path)[0],404)
        self.assertEqual(self.request("GET", "/")[0],200)

    def test_private_https_proxy_origin(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.server = make_server("127.0.0.1", 0, self.tmp.name, "https://laptop.example.ts.net")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        remote = {"Host": "laptop.example.ts.net", "Origin": "https://laptop.example.ts.net"}
        status, state = self.request("GET", "/api/state", headers=remote)
        self.assertEqual(status, 200)
        self.token = state["token"]
        self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(), remote)[0], 201)
        # Proxies may rewrite Host to localhost while preserving the browser Origin.
        self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(url="https://example.org/two"),
                                      {"Origin": remote["Origin"]})[0], 201)
        for origin in ("https://attacker.test", "http://laptop.example.ts.net", "https://laptop.example.ts.net.evil.test"):
            self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(), {**remote, "Origin": origin})[0], 403)
        self.assertEqual(self.request("GET", "/api/state", headers={"Host": "laptop.example.ts.net:444"})[0], 403)
        self.assertEqual(self.request("POST", "/api/bookmarks", self.sample(),
                                      {"Origin": "https://evil.test", "X-Forwarded-Host": "evil.test", "X-Forwarded-Proto": "https"})[0], 403)

    def test_remote_origin_validation(self):
        for value in ("http://example.org", "https://example.org/path", "https://user@example.org", "https://example.org?query", "https://example.org#fragment", "https://example.org:invalid"):
            with self.assertRaises(ValueError):
                remote_origin(value)


if __name__ == "__main__":
    unittest.main()
