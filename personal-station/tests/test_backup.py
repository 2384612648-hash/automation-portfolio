import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
import zipfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from backup_service import BackupService
from server import make_server


def create_database(path, script):
    db = sqlite3.connect(path)
    db.executescript(script)
    db.commit()
    db.close()


class BackupServiceTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='backup-test-')
        self.dir = Path(self.tmp.name)
        self.station = self.dir / 'station.sqlite3'
        self.feeds = self.dir / 'feeds.sqlite3'
        create_database(self.station, """
            CREATE TABLE bookmarks(id TEXT PRIMARY KEY, payload TEXT, deleted_at TEXT);
            INSERT INTO bookmarks VALUES('1','{}',NULL);
            INSERT INTO bookmarks VALUES('2','{}','2026-01-01T00:00:00+00:00');
        """)
        create_database(self.feeds, """
            CREATE TABLE articles(id TEXT PRIMARY KEY);
            CREATE TABLE sources(id TEXT PRIMARY KEY);
            INSERT INTO articles VALUES('a');
            INSERT INTO articles VALUES('b');
            INSERT INTO sources VALUES('s');
        """)

    def tearDown(self):
        self.tmp.cleanup()

    def test_create_writes_consistent_zip_with_manifest(self):
        service = BackupService(self.dir, self.station, self.feeds)
        entry = service.create()
        path = self.dir / 'backups' / entry['name']
        self.assertTrue(path.is_file())
        with zipfile.ZipFile(path) as archive:
            self.assertEqual(set(archive.namelist()), {'station.sqlite3', 'feeds.sqlite3', 'manifest.json'})
            manifest = json.loads(archive.read('manifest.json'))
            self.assertEqual(manifest['format'], 'zero-backup')
            self.assertEqual(manifest['counts'], {'bookmarks': 1, 'trash': 1, 'articles': 2, 'sources': 1})
            self.assertEqual(manifest['files'], ['station.sqlite3', 'feeds.sqlite3'])
        extract = self.dir / 'extract'
        extract.mkdir()
        with zipfile.ZipFile(path) as archive:
            archive.extract('station.sqlite3', extract)
        db = sqlite3.connect(extract / 'station.sqlite3')
        try:
            self.assertEqual(db.execute('SELECT count(*) FROM bookmarks').fetchone()[0], 2)
        finally:
            db.close()
        self.assertEqual(entry['counts']['articles'], 2)

    def test_retention_keeps_newest_files(self):
        service = BackupService(self.dir, self.station, self.feeds, keep=2)
        for _ in range(4):
            service.create()
        entries = service.entries()
        self.assertEqual(len(entries), 2)
        self.assertEqual(entries, sorted(entries, key=lambda item: item['name'], reverse=True))

    def test_missing_database_is_skipped(self):
        service = BackupService(self.dir, self.station, self.dir / 'missing.sqlite3')
        entry = service.create()
        self.assertEqual(entry['files'], ['station.sqlite3'])
        with zipfile.ZipFile(self.dir / 'backups' / entry['name']) as archive:
            self.assertNotIn('feeds.sqlite3', archive.namelist())

    def test_find_rejects_traversal_and_unknown_names(self):
        service = BackupService(self.dir, self.station, self.feeds)
        entry = service.create()
        self.assertIsNotNone(service.find(entry['name']))
        self.assertIsNone(service.find('../station.sqlite3'))
        self.assertIsNone(service.find('zero-backup-20260101T000000Z.zip'))
        self.assertIsNone(service.find(''))


class BackupApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='backup-api-')
        self.server = make_server('127.0.0.1', 0, self.tmp.name)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.server.server_port
        self.token = self.request('GET', '/api/state')[1]['token']

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.tmp.cleanup()

    def request(self, method, path, data=None, headers=None, raw=False):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=20)
        merged = {'Content-Type': 'application/json', 'X-Station-Token': getattr(self, 'token', '')}
        merged.update(headers or {})
        connection.request(method, path, json.dumps(data) if data is not None else None, merged)
        response = connection.getresponse()
        body = response.read()
        status = response.status
        response_headers = dict(response.getheaders())
        connection.close()
        if raw:
            return status, body, response_headers
        try:
            return status, json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return status, body

    def test_list_create_and_download(self):
        status, data = self.request('GET', '/api/backups')
        self.assertEqual(status, 200)
        self.assertEqual(data['backups'], [])
        self.assertEqual(data['status']['keep'], 7)

        self.assertEqual(self.request('POST', '/api/backups', {}, {'X-Station-Token': 'bad'})[0], 403)
        status, entry = self.request('POST', '/api/backups', {})
        self.assertEqual(status, 201)
        self.assertTrue(entry['name'].startswith('zero-backup-'))

        status, listing = self.request('GET', '/api/backups')
        self.assertEqual(status, 200)
        self.assertEqual(listing['status']['count'], 1)
        self.assertEqual(listing['backups'][0]['name'], entry['name'])

        status, body, headers = self.request('GET', '/api/backups/' + entry['name'], raw=True)
        self.assertEqual(status, 200)
        self.assertEqual(headers['Content-Type'], 'application/zip')
        self.assertIn('attachment; filename=', headers['Content-Disposition'])
        self.assertTrue(body.startswith(b'PK'))

        self.assertEqual(self.request('GET', '/api/backups/zero-backup-20200101T000000Z.zip')[0], 404)
        self.assertEqual(self.request('GET', '/api/backups/not-a-backup.zip')[0], 404)

    def test_download_rejects_traversal(self):
        status, _, _ = self.request('GET', '/api/backups/..%2F..%2Fserver.py', raw=True)
        self.assertEqual(status, 404)


if __name__ == '__main__':
    unittest.main()
