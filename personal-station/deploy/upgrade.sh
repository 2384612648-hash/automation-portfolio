#!/usr/bin/env bash
set -Eeuo pipefail
test "$(id -u)" -eq 0 || { echo 'Run with sudo'; exit 1; }
incoming="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
target="${ZERO_TARGET_DIR:-$(dirname "$incoming")/zero}"
test "$incoming" != "$target" || { echo 'Use a separate incoming directory'; exit 1; }
test -f "$target/.env"
owner="$(stat -c '%u:%g' "$target")"
cd "$incoming"
version="$(python3 -c 'import json; print(json.load(open("package.json"))["version"])')"
docker image inspect zero-station:local >/dev/null
echo '1/5 Build using existing local image (no Docker Hub pull)'
docker build --pull=false --network=none -f deploy/Dockerfile.update -t zero-station:upgrade .
echo '2/5 Check proxy, translation, snapshot and restored databases using temporary data'
docker run --rm --network=none --entrypoint python zero-station:upgrade -m deploy.verify_image
echo '3/5 Preserve previous image; keep live data and .env'
docker tag zero-station:local zero-station:previous
rollback() {
  trap - ERR
  echo 'Upgrade failed; restoring previous image'
  docker tag zero-station:previous zero-station:local
  cd "$target"
  docker compose up -d --no-build --pull never zero
  exit 1
}
trap rollback ERR
docker tag zero-station:upgrade zero-station:local
echo '4/5 Recreate zero and check version'
cd "$target"
docker compose up -d --no-build --pull never zero
healthy=0
for ((attempt=1; attempt<=30; attempt++)); do
  if curl -fs --max-time 3 http://127.0.0.1:8765/api/health | python3 -c 'import json,sys; assert json.load(sys.stdin)["version"]==sys.argv[1]' "$version" 2>/dev/null; then
    healthy=1
    break
  fi
  sleep 2
done
test "$healthy" = 1
echo '5/5 Sync reviewed source; keep data, .env and proxy settings'
python3 - "$incoming" "$target" <<'PY'
import shutil
import sys
from pathlib import Path
src, dst = map(Path, sys.argv[1:])
for name in ['server.py', 'live_data.py', 'feed_service.py', 'feed_sources.py',
             'safe_http.py', 'proxy_service.py', 'translation_service.py',
             'backup_service.py', 'Dockerfile', 'compose.yaml', 'package.json',
             'package-lock.json', 'build.mjs', 'README.md', 'SERVER_SETUP.md',
             'THIRD_PARTY_NOTICES.md', 'WORKFLOW.md']:
    if (src / name).is_file():
        shutil.copy2(src / name, dst / name)
for name in ['src', 'public', 'deploy', 'bin', 'tests', 'models', 'vendor']:
    shutil.copytree(src / name, dst / name, dirs_exist_ok=True,
                    ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
PY
chown -R "$owner" "$target"
trap - ERR
curl -fsS --max-time 5 http://127.0.0.1:8765/api/health
echo
echo 'Upgrade complete. Verify bookmarks, server snapshots and the existing proxy state.'
