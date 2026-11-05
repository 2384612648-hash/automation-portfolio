import sqlite3
import tempfile
import unittest
from pathlib import Path
from deploy.transfer import snapshot, restore, digest
from server import Store


class TransferTests(unittest.TestCase):
    def test_live_wal_snapshot_preserves_records_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            original = root / 'original.sqlite3'
            store = Store(original)
            keeper = sqlite3.connect(original)  # Keep the WAL active during snapshot.
            try:
                item = store.put(dict(title='中文摘录', url='https://example.com/one', note='第一行\n第二行', tags=['阅读'], kind='article', starred=True, is_read=True))
                store.trash(item['id'])
                store.put(dict(title='active', url='https://example.com/two', tags=[], kind='article'))
                backup = root / 'backup.sqlite3'
                info = snapshot(original, backup)
                self.assertEqual((info['total'], info['active'], info['trash']), (2, 1, 1))
                restored = root / 'new/station.sqlite3'
                restore(backup, restored, info['sha256'])
                self.assertEqual(Store(restored).all(), store.all())
                before = digest(restored)
                with self.assertRaises(FileExistsError):
                    restore(backup, restored, info['sha256'])
                self.assertEqual(digest(restored), before)
                with self.assertRaises(FileExistsError):
                    snapshot(original, backup)
            finally:
                keeper.close()

    def test_corruption_and_missing_source_never_create_destination(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'bad'; target = root / 'target'
            source.write_bytes(b'not sqlite')
            with self.assertRaises(ValueError):
                restore(source, target, 'wrong hash')
            with self.assertRaises(sqlite3.DatabaseError):
                restore(source, target, digest(source))
            with self.assertRaises(FileNotFoundError):
                snapshot(root / 'missing', target)
            self.assertFalse(target.exists())

    def test_sidecar_blocks_restore(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'source'; target = root / 'target'
            Store(source)
            info = snapshot(source, root / 'backup')
            Path(str(target) + '-wal').write_bytes(b'existing')
            with self.assertRaises(FileExistsError):
                restore(root / 'backup', target, info['sha256'])
            self.assertFalse(target.exists())
