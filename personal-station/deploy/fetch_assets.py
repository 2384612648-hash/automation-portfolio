"""Fetch pinned Linux amd64 assets excluded from Git. Run before Docker build."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def fetch(url, target, digest):
    if target.is_file() and hashlib.sha256(target.read_bytes()).hexdigest() == digest:
        return
    target.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={'User-Agent': 'zero-assets/0.5.1'})
    with urllib.request.urlopen(request, timeout=120) as response:
        data = response.read()
    if hashlib.sha256(data).hexdigest() != digest:
        raise RuntimeError('SHA-256 mismatch: ' + target.name)
    target.write_bytes(data)


def main():
    model_dir = ROOT / 'models/en-zh'
    manifest = json.loads((model_dir / 'manifest.json').read_text(encoding='utf-8'))
    base = 'https://huggingface.co/' + manifest['repository'] + '/resolve/' + manifest['revision'] + '/'
    for item in manifest['files']:
        fetch(base + item['file'], model_dir / item['file'], item['sha256'])
    release = json.loads((ROOT / 'bin/mihomo-release.json').read_text(encoding='utf-8'))
    binary = ROOT / 'bin/mihomo'
    if not binary.is_file() or hashlib.sha256(binary.read_bytes()).hexdigest() != release['binary_sha256']:
        compressed = ROOT / 'bin/mihomo.gz'
        try:
            fetch(release['source'], compressed, release['compressed_sha256'])
            data = gzip.decompress(compressed.read_bytes())
            if hashlib.sha256(data).hexdigest() != release['binary_sha256']:
                raise RuntimeError('mihomo SHA-256 mismatch')
            binary.write_bytes(data)
        finally:
            compressed.unlink(missing_ok=True)
    os.chmod(binary, 0o755)
    subprocess.run([sys.executable, '-m', 'pip', 'download', '--only-binary=:all:',
                    '--platform', 'manylinux_2_28_x86_64', '--platform', 'manylinux_2_27_x86_64',
                    '--platform', 'manylinux2014_x86_64', '--python-version', '313',
                    '--implementation', 'cp', '--abi', 'cp313',
                    '--dest', str(ROOT / 'vendor/wheels'), 'ctranslate2==4.8.4',
                    'sentencepiece==0.2.2', 'numpy==2.5.4', 'pyyaml==6.0.3'], check=True)
    print('Linux amd64 assets ready; model and mihomo hashes verified.')


if __name__ == '__main__':
    main()
