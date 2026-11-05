"""Upload Git-tracked source to a separate staging directory; never deploys."""
import argparse
from pathlib import Path
import re
import shlex
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('server', help='SSH user@host')
    parser.add_argument('--identity')
    parser.add_argument('--host-key-alias')
    parser.add_argument('--destination', default='services/zero-incoming',
                        help='path relative to the SSH user home')
    parser.add_argument('--assets', action='store_true', help='include fetched Linux runtime assets')
    args = parser.parse_args()
    if not re.fullmatch(r'[A-Za-z0-9_.-]+@[A-Za-z0-9_.-]+', args.server):
        parser.error('Use user@hostname or user@IPv4')
    if not re.fullmatch(r'[A-Za-z0-9_/-]+', args.destination) or any(
            part in ('', '.', '..') for part in args.destination.split('/')):
        parser.error('Use a normal relative destination without ..')
    source = subprocess.check_output(['git', 'ls-files', '-z', '.'], cwd=ROOT)
    files = [ROOT / item.decode('utf-8') for item in source.split(b'\0') if item]
    if args.assets:
        files += [ROOT / 'bin/mihomo']
        files += list((ROOT / 'models/en-zh').glob('*'))
        files += list((ROOT / 'vendor/wheels').glob('*.whl'))
        if not (ROOT / 'bin/mihomo').is_file() or not list((ROOT / 'vendor/wheels').glob('*.whl')):
            parser.error('Run python deploy/fetch_assets.py before --assets')
    if not files:
        parser.error('No tracked source; stage the reviewed source with git add first')
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15']
    if args.identity:
        ssh += ['-i', args.identity, '-o', 'IdentitiesOnly=yes']
    if args.host_key_alias:
        ssh += ['-o', 'HostKeyAlias=' + args.host_key_alias]
    path = shlex.quote(args.destination)
    remote = 'mkdir -p -- ' + path + ' && tar -xf - -C ' + path
    with tempfile.TemporaryFile() as archive:
        with tarfile.open(fileobj=archive, mode='w') as bundle:
            for file in sorted(set(files)):
                if file.is_file():
                    def stable_time(info):
                        info.mtime = 0
                        return info
                    bundle.add(file, arcname=file.relative_to(ROOT).as_posix(), filter=stable_time)
        archive.seek(0)
        subprocess.run(ssh + [args.server, remote], stdin=archive, check=True)
    print('Uploaded to ~/' + args.destination + '; run its deploy/upgrade.sh with sudo after review.')


if __name__ == '__main__':
    main()
