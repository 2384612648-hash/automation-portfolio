"""Offline image smoke check. Uses temporary data; never mounts the live volume."""
import json
import sqlite3
import tempfile
import zipfile
from pathlib import Path

from server import make_server


def main():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        server = make_server('127.0.0.1', 0, directory)
        try:
            server.proxy_service.start()
            assert server.proxy_service.status()['running'], 'proxy failed to start'
            assert len(server.feed_service.sources()['sources']) >= 15
            assert server.feed_service.translator.translate(['Global markets fall'])[0]
            # make_server exposes the services used by the API; create the same
            # consistent two-database snapshot through a separate instance.
            from backup_service import BackupService
            backup = BackupService(root, root / 'station.sqlite3', root / 'feeds.sqlite3')
            entry = backup.create()
            with zipfile.ZipFile(root / 'backups' / entry['name']) as archive:
                assert archive.testzip() is None
                manifest = json.loads(archive.read('manifest.json'))
                assert set(manifest['files']) == {'station.sqlite3', 'feeds.sqlite3'}
                restore = root / 'restore'
                restore.mkdir()
                for name in manifest['files']:
                    archive.extract(name, restore)
                    with sqlite3.connect(restore / name) as db:
                        assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
            print('Isolated proxy, translation, snapshot and restore checks passed')
        finally:
            server.server_close()


if __name__ == '__main__':
    main()
