"""Consistent local snapshots of the station databases, with retention.

Snapshots live next to the live data in data/backups, so they travel with the
Docker volume. Each zip holds point-in-time copies of the bookmark and feed
databases plus a manifest; proxy credentials are deliberately excluded.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path

NAME_RE = re.compile(r'^zero-backup-\d{8}T\d{6}Z(?:-\d+)?\.zip$')
DEFAULT_KEEP = 7
DEFAULT_INTERVAL = 24 * 3600


def _utc_iso(timestamp=None):
    moment = datetime.fromtimestamp(timestamp, timezone.utc) if timestamp else datetime.now(timezone.utc)
    return moment.isoformat(timespec='seconds')


class BackupService:
    """Creates zip snapshots and keeps the newest keep files."""

    def __init__(self, data_dir, station_db, feeds_db, keep=DEFAULT_KEEP, interval=DEFAULT_INTERVAL):
        self.root = Path(data_dir) / 'backups'
        self.error = None
        try:
            self.root.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self.error = '无法创建备份目录：' + str(exc)
        self.station_db = Path(station_db)
        self.feeds_db = Path(feeds_db)
        self.keep = max(1, int(keep))
        self.interval = max(3600, int(interval))
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread = None

    # -- reading -------------------------------------------------------
    def entries(self):
        items = []
        for path in self.root.glob('zero-backup-*.zip'):
            if not NAME_RE.match(path.name):
                continue
            try:
                stat = path.stat()
            except OSError:
                continue
            items.append({'name': path.name, 'size': stat.st_size, 'created_at': _utc_iso(stat.st_mtime), '_mtime': stat.st_mtime})
        items.sort(key=lambda item: (item['_mtime'], item['name']), reverse=True)
        for item in items:
            item.pop('_mtime', None)
        return items

    def status(self):
        items = self.entries()
        return {
            'count': len(items),
            'keep': self.keep,
            'interval_hours': round(self.interval / 3600, 1),
            'newest': items[0] if items else None,
            'error': self.error,
        }

    def find(self, name):
        """Return the path for a known snapshot name, or None (no traversal)."""
        if not name or not NAME_RE.match(name):
            return None
        path = self.root / name
        return path if path.is_file() else None

    # -- writing -------------------------------------------------------
    def create(self):
        with self.lock:
            stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
            name = 'zero-backup-' + stamp + '.zip'
            counter = 1
            while (self.root / name).exists():
                name = 'zero-backup-' + stamp + '-' + str(counter) + '.zip'
                counter += 1
            target = self.root / name
            work = self.root / ('.work-' + name)
            temp = self.root / ('.tmp-' + name)
            work.mkdir()
            try:
                included = []
                for label, source in (('station.sqlite3', self.station_db), ('feeds.sqlite3', self.feeds_db)):
                    if not source.is_file():
                        continue
                    destination = work / label
                    self._copy_database(source, destination)
                    included.append(label)
                manifest = {
                    'format': 'zero-backup',
                    'version': 1,
                    'app': 'personal-station',
                    'created_at': _utc_iso(),
                    'files': included,
                    'counts': self._counts(work),
                }
                (work / 'manifest.json').write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
                with zipfile.ZipFile(temp, 'w', zipfile.ZIP_DEFLATED) as archive:
                    for file in sorted(work.iterdir()):
                        archive.write(file, file.name)
                os.replace(temp, target)
                self.prune()
                self.error = None
                return {
                    'name': target.name,
                    'size': target.stat().st_size,
                    'created_at': _utc_iso(target.stat().st_mtime),
                    'counts': manifest['counts'],
                    'files': included,
                }
            except Exception as exc:
                self.error = '备份失败：' + str(exc)
                raise
            finally:
                for leftover in (temp, work / 'manifest.json'):
                    try:
                        leftover.unlink()
                    except OSError:
                        pass
                for file in work.glob('*.sqlite3'):
                    try:
                        file.unlink()
                    except OSError:
                        pass
                try:
                    work.rmdir()
                except OSError:
                    pass

    def _copy_database(self, source, destination):
        # SQLite's backup API produces a consistent copy even while WAL is active.
        reader = sqlite3.connect('file:' + source.as_posix() + '?mode=ro', uri=True, timeout=20)
        try:
            writer = sqlite3.connect(destination)
            try:
                reader.backup(writer)
            finally:
                writer.close()
        finally:
            reader.close()

    def _counts(self, work):
        counts = {}
        station = work / 'station.sqlite3'
        if station.is_file():
            db = sqlite3.connect(station)
            try:
                counts['bookmarks'] = db.execute('SELECT count(*) FROM bookmarks WHERE deleted_at IS NULL').fetchone()[0]
                counts['trash'] = db.execute('SELECT count(*) FROM bookmarks WHERE deleted_at IS NOT NULL').fetchone()[0]
            except sqlite3.Error:
                pass
            finally:
                db.close()
        feeds = work / 'feeds.sqlite3'
        if feeds.is_file():
            db = sqlite3.connect(feeds)
            try:
                counts['articles'] = db.execute('SELECT count(*) FROM articles').fetchone()[0]
                counts['sources'] = db.execute('SELECT count(*) FROM sources').fetchone()[0]
            except sqlite3.Error:
                pass
            finally:
                db.close()
        return counts

    def prune(self):
        items = [self.root / entry['name'] for entry in self.entries()]
        for old in items[self.keep:]:
            try:
                old.unlink()
            except OSError:
                pass

    # -- scheduling ----------------------------------------------------
    def start(self):
        if self.thread:
            return
        self.thread = threading.Thread(target=self.loop, daemon=True, name='backup-daily')
        self.thread.start()

    def loop(self):
        # Give startup (package import, first feed collection) a little room first.
        self.stop_event.wait(30)
        while not self.stop_event.is_set():
            try:
                items = self.entries()
                if items:
                    age = time.time() - datetime.fromisoformat(items[0]['created_at']).timestamp()
                else:
                    age = None
                if age is None or age >= self.interval:
                    self.create()
            except Exception:
                pass  # status exposes the last error; the next check retries
            self.stop_event.wait(1800)

    def close(self):
        self.stop_event.set()
