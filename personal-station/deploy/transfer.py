"""Portable SQLite snapshot, first-install restore and explicit release packaging."""
import argparse
import hashlib
import json
import shutil
import sqlite3
import tempfile
import zipfile
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(block)
    return value.hexdigest()


def inspect_db(path):
    with closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True)) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('Database integrity check failed')
        total, trash = db.execute('SELECT COUNT(*), COALESCE(SUM(deleted_at IS NOT NULL),0) FROM bookmarks').fetchone()
        return {'total': total, 'active': total - trash, 'trash': trash}


def snapshot(source, target):
    source, target = Path(source), Path(target)
    if not source.is_file():
        raise FileNotFoundError(source)
    target.parent.mkdir(parents=True, exist_ok=True)
    # Reserve exclusively; never replace an earlier backup or a live database.
    with target.open('xb'):
        pass
    try:
        with closing(sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True)) as src:
            with closing(sqlite3.connect(target)) as dst:
                src.backup(dst)
                dst.execute('PRAGMA journal_mode=DELETE')
        counts = inspect_db(target)
        return {'sha256': digest(target), **counts}
    except Exception:
        target.unlink(missing_ok=True)  # Only the file exclusively created above.
        raise


def restore(source, target, expected):
    source, target = Path(source), Path(target)
    if digest(source) != expected:
        raise ValueError('SHA256 mismatch; restore cancelled')
    inspect_db(source)
    for suffix in ('', '-wal', '-shm', '-journal'):
        if Path(str(target) + suffix).exists():
            raise FileExistsError('Destination already contains a database; no overwrite allowed')
    return snapshot(source, target)


def verify(folder):
    folder = Path(folder).resolve()
    manifest = json.loads((folder / 'migration/manifest.json').read_text(encoding='utf-8'))
    for name, expected in manifest['files'].items():
        path = (folder / name).resolve()
        if not path.is_relative_to(folder) or digest(path) != expected:
            raise ValueError('Missing, altered or unsafe file: ' + name)
    counts = inspect_db(folder / 'migration/station.sqlite3')
    if counts != manifest['counts']:
        raise ValueError('Database counts differ from manifest')
    return manifest


def pack(output, source):
    output = Path(output)
    # Deliberate allowlist: no logs, Tailscale credentials, .env or runtime state.
    files = ['server.py', 'live_data.py', 'feed_service.py', 'feed_sources.py',
             'safe_http.py', 'proxy_service.py', 'translation_service.py',
             'backup_service.py', 'Dockerfile', 'compose.yaml', '.dockerignore',
             '.env.example', 'README.md', 'SERVER_SETUP.md', 'WORKFLOW.md',
             'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'build.mjs']
    with tempfile.TemporaryDirectory(prefix='zero-release-') as temp:
        stage = Path(temp)
        for name in files:
            shutil.copy2(ROOT / name, stage / name)
        for name in ('public', 'src', 'deploy', 'tests', 'bin', 'models', 'vendor'):
            shutil.copytree(ROOT / name, stage / name, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        info = snapshot(source, stage / 'migration/station.sqlite3')
        manifest = {'format': 'zero-migration-v1', 'created_utc': datetime.now(timezone.utc).isoformat(),
                    'counts': {k: info[k] for k in ('total', 'active', 'trash')},
                    'files': {p.relative_to(stage).as_posix(): digest(p) for p in sorted(stage.rglob('*')) if p.is_file()}}
        (stage / 'migration/manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
        verify(stage)
        output.parent.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(output, 'x', zipfile.ZIP_DEFLATED) as archive:
            for path in sorted(stage.rglob('*')):
                if path.is_file():
                    archive.write(path, path.relative_to(stage).as_posix())
    print(json.dumps({'file': str(output), 'sha256': digest(output), 'counts': manifest['counts']}, ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    p = sub.add_parser('pack'); p.add_argument('output'); p.add_argument('--database', default=str(ROOT / 'data/station.sqlite3'))
    p = sub.add_parser('verify'); p.add_argument('folder', nargs='?', default=str(ROOT))
    p = sub.add_parser('backup'); p.add_argument('output'); p.add_argument('--database', default='/data/station.sqlite3')
    p = sub.add_parser('restore'); p.add_argument('source'); p.add_argument('--target', default='/data/station.sqlite3'); p.add_argument('--sha256', required=True)
    args = parser.parse_args()
    if args.action == 'pack': pack(args.output, args.database)
    elif args.action == 'verify': print(json.dumps(verify(args.folder)['counts']))
    elif args.action == 'backup': print(json.dumps(snapshot(args.database, args.output)))
    else: print(json.dumps(restore(args.source, args.target, args.sha256)))


if __name__ == '__main__':
    main()
