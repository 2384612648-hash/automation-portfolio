"""Personal Station: local web app, Python standard library only."""
from __future__ import annotations

import argparse
import json
import os
import secrets
import sqlite3
import sys
import threading
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit, parse_qs
from live_data import LiveService
from feed_service import FeedService
from proxy_service import ProxyService
from backup_service import BackupService

ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
MAX_BODY = 12 * 1024 * 1024
KINDS = {"article", "video", "project", "other"}


class Invalid(ValueError):
    pass


class Duplicate(Invalid):
    pass


def now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def clean_text(value, name, limit, required=False):
    if not isinstance(value, str):
        raise Invalid(f"{name}需要是文字")
    value = value.strip()
    if required and not value:
        raise Invalid(f"请填写{name}")
    if len(value) > limit:
        raise Invalid(f"{name}最多 {limit} 个字符")
    return value


def validate(data):
    if not isinstance(data, dict):
        raise Invalid("收藏格式不正确")
    url = clean_text(data.get("url", ""), "链接", 4096, True)
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
            raise ValueError()
        _ = parsed.port
        if any(c.isspace() or ord(c) < 32 for c in url):
            raise ValueError()
    except ValueError:
        raise Invalid("请输入完整的 http:// 或 https:// 链接")
    title = clean_text(data.get("title", ""), "标题", 300, True)
    note = clean_text(data.get("note", ""), "备注", 20000)
    tags = data.get("tags", [])
    if not isinstance(tags, list):
        raise Invalid("标签需要是列表")
    if len(tags) > 20:
        raise Invalid("最多添加 20 个标签")
    tags = list(dict.fromkeys(clean_text(tag, "标签", 40, True) for tag in tags))
    kind = data.get("kind", "other")
    if not isinstance(kind, str) or kind not in KINDS:
        raise Invalid("收藏类型不正确")
    for key in ("starred", "is_read"):
        if not isinstance(data.get(key, False), bool):
            raise Invalid("收藏状态不正确")
    return dict(url=url, title=title, note=note, tags=tags, kind=kind,
                starred=data.get("starred", False), is_read=data.get("is_read", False))


def url_key(url):
    parts = urlsplit(url)
    # Keep query strings and fragments: they can point to different content.
    return parts._replace(scheme=parts.scheme.lower(), netloc=parts.netloc.lower(), path=parts.path or "/").geturl()


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.execute("""CREATE TABLE IF NOT EXISTS bookmarks (
                id TEXT PRIMARY KEY, url_key TEXT NOT NULL,
                payload TEXT NOT NULL, deleted_at TEXT
            )""")
            db.execute("CREATE UNIQUE INDEX IF NOT EXISTS unique_live_url ON bookmarks(url_key) WHERE deleted_at IS NULL")

    @contextmanager
    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db:
                yield db
        finally:
            db.close()

    def all(self):
        with self.connect() as db:
            return [json.loads(row[0]) for row in db.execute("SELECT payload FROM bookmarks ORDER BY rowid DESC")]

    def put(self, data, identifier=None):
        data = validate(data)
        with self.lock, self.connect() as db:
            old = None
            if identifier:
                row = db.execute("SELECT payload FROM bookmarks WHERE id=? AND deleted_at IS NULL", (identifier,)).fetchone()
                if not row:
                    raise KeyError(identifier)
                old = json.loads(row[0])
            item = dict(data, id=identifier or str(uuid.uuid4()), created_at=old["created_at"] if old else now(), updated_at=now(), deleted_at=None)
            try:
                if old:
                    db.execute("UPDATE bookmarks SET url_key=?,payload=? WHERE id=?", (url_key(item["url"]), json.dumps(item, ensure_ascii=False), item["id"]))
                else:
                    db.execute("INSERT INTO bookmarks VALUES(?,?,?,NULL)", (item["id"], url_key(item["url"]), json.dumps(item, ensure_ascii=False)))
            except sqlite3.IntegrityError:
                raise Duplicate("这个链接已经收录过了，请在信息库中查找")
            return item

    def trash(self, identifier, restore=False):
        with self.lock, self.connect() as db:
            row = db.execute("SELECT payload FROM bookmarks WHERE id=?", (identifier,)).fetchone()
            if not row:
                raise KeyError(identifier)
            item = json.loads(row[0])
            item["deleted_at"] = None if restore else now()
            item["updated_at"] = now()
            try:
                db.execute("UPDATE bookmarks SET payload=?,deleted_at=? WHERE id=?", (json.dumps(item, ensure_ascii=False), item["deleted_at"], identifier))
            except sqlite3.IntegrityError:
                raise Duplicate("已有相同链接的收藏，暂时无法恢复这一条")
            return item

    def import_items(self, incoming):
        if not isinstance(incoming, dict) or incoming.get("format") != "personal-station" or incoming.get("version") != 1:
            raise Invalid("请选择本站导出的 JSON 文件（版本 1）")
        records = incoming.get("bookmarks")
        if not isinstance(records, list) or len(records) > 20000:
            raise Invalid("导入文件格式不正确，或超过 20000 条收藏")
        validated = []
        for index, raw in enumerate(records):
            try:
                item = validate(raw)
                for key in ("created_at", "updated_at", "deleted_at"):
                    value = raw.get(key)
                    if value is not None:
                        if not isinstance(value, str) or len(value) > 40:
                            raise Invalid("日期格式不正确")
                        datetime.fromisoformat(value.replace("Z", "+00:00"))
                item.update(created_at=raw.get("created_at") or now(), updated_at=raw.get("updated_at") or now(), deleted_at=raw.get("deleted_at"))
                validated.append(item)
            except (ValueError, TypeError) as exc:
                raise Invalid(f"第 {index + 1} 条收藏无法导入：{exc}")
        added, skipped = 0, 0
        with self.lock, self.connect() as db:
            keys = {row[0] for row in db.execute("SELECT url_key FROM bookmarks")}
            for item in validated:
                key = url_key(item["url"])
                if key in keys:
                    skipped += 1
                    continue
                item["id"] = str(uuid.uuid4())
                db.execute("INSERT INTO bookmarks VALUES(?,?,?,?)", (item["id"], key, json.dumps(item, ensure_ascii=False), item["deleted_at"]))
                keys.add(key)
                added += 1
        return {"added": added, "skipped": skipped}


def remote_origin(value):
    """An exact HTTPS origin behind an authenticated reverse proxy, not authentication."""
    if not value:
        return ""
    parsed = urlsplit(value)
    if (parsed.scheme != "https" or not parsed.hostname or parsed.username
            or parsed.password or parsed.path or parsed.query or parsed.fragment
            or any(c.isspace() or ord(c) < 32 for c in value)):
        raise ValueError("Remote origin must be an exact https://hostname[:port] without a path")
    _ = parsed.port
    return value


def make_server(host, port, data_dir, public_origin="", background=False):
    public_origin = remote_origin(public_origin)
    remote_authority = urlsplit(public_origin).netloc
    store = Store(Path(data_dir) / "station.sqlite3")
    live_service = LiveService()
    proxy_service = ProxyService(Path(data_dir) / 'proxy')
    feed_service = FeedService(Path(data_dir) / 'feeds.sqlite3', proxy_service)
    backup_service = BackupService(data_dir, store.path, feed_service.path)
    token = secrets.token_urlsafe(32)

    class Handler(SimpleHTTPRequestHandler):
        server_version = "PersonalStation/0.1"

        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(PUBLIC), **kwargs)

        def log_message(self, fmt, *args):
            # Log method/path only; never saved notes, request bodies or tokens.
            print(f"[{now()}] {fmt % args}", flush=True)

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("X-Frame-Options", "DENY")
            self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
            self.send_header("Cache-Control", "no-store" if self.path.startswith("/api/") else "no-cache")
            super().end_headers()

        def valid_host(self):
            try:
                authority = self.headers.get("Host", "")
                if remote_authority and authority == remote_authority:
                    return True
                name = urlsplit("http://" + authority).hostname
                return name in {"127.0.0.1", "localhost", "::1", host} or host == "0.0.0.0"
            except ValueError:
                return False

        def reply(self, status, value):
            body = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if self.command != "HEAD":
                try:
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                    pass

        def send_backup(self, target):
            size = target.stat().st_size
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", str(size))
            self.send_header("Content-Disposition", 'attachment; filename="' + target.name + '"')
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            if self.command == "HEAD":
                return
            try:
                with open(target, "rb") as handle:
                    while True:
                        chunk = handle.read(65536)
                        if not chunk:
                            break
                        self.wfile.write(chunk)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def do_GET(self):
            if not self.valid_host():
                return self.reply(403, {"error": "访问地址不被允许"})
            path = urlsplit(self.path).path
            if path == "/api/health":
                return self.reply(200, {"app": "personal-station", "version": "0.6.0"})
            if path == "/api/state":
                return self.reply(200, {"bookmarks": store.all(), "token": token})
            if path == '/api/feeds/digest':
                return self.reply(200, feed_service.digest())
            if path == '/api/feeds/sources':
                return self.reply(200, feed_service.sources())
            if path == '/api/feeds':
                try:
                    return self.reply(200, feed_service.query(parse_qs(urlsplit(self.path).query)))
                except ValueError:
                    return self.reply(400, {'error':'筛选参数无效'})
            if path == '/api/proxy':
                return self.reply(200, proxy_service.status())
            if path == '/api/live/status':
                return self.reply(200, live_service.status())
            if path.startswith('/api/live/'):
                resource = path.rsplit('/', 1)[-1]
                key = parse_qs(urlsplit(self.path).query).get('id', [''])[0]
                if resource == 'news' and key in ('latest','finance','world','tech'):
                    topic={'latest':'','finance':'economy','world':'world','tech':'tech'}[key]
                    result=feed_service.query({'period':['all'],'topic':[topic]})
                    items=[dict(item,source=' / '.join(s['name'] for s in item['sources'])) for item in result['items']]
                    successes=[s['last_success'] for s in feed_service.sources()['sources'] if s['last_success'] and (not topic or s['topic']==topic)]
                    return self.reply(200, {'status':'ok' if successes else 'error','fetched_at':max(successes) if successes else None,
                        'data':{'source':'服务器持续订阅','items':items},'error':None})
                try:
                    return self.reply(200, live_service.get(resource, key, parse_qs(urlsplit(self.path).query).get('before', [''])[0]))
                except ValueError:
                    return self.reply(400, {'error': '历史日期无效'})
                except KeyError:
                    return self.reply(404, {'error': '未知的数据源或标的'})
            if path == "/api/export":
                return self.reply(200, {"format": "personal-station", "version": 1, "exported_at": now(), "bookmarks": store.all()})
            if path == "/api/backups":
                return self.reply(200, {"backups": backup_service.entries(), "status": backup_service.status()})
            if path.startswith("/api/backups/"):
                name = path[len("/api/backups/"):]
                target = backup_service.find(name)
                if not target:
                    return self.reply(404, {"error": "备份不存在，可能已被保留策略清理"})
                return self.send_backup(target)
            if path.startswith("/api/"):
                return self.reply(404, {"error": "接口不存在"})
            try:
                target = (PUBLIC / unquote(path).lstrip("/")).resolve()
                target.relative_to(PUBLIC.resolve())
                if target.is_dir() and path != "/":
                    raise ValueError()
                if target.name.startswith("."):
                    raise ValueError()
            except ValueError:
                return self.reply(404, {"error": "文件不存在"})
            return super().do_HEAD() if self.command == "HEAD" else super().do_GET()

        def do_HEAD(self):
            return self.do_GET()

        def mutate(self):
            if not self.valid_host() or self.headers.get("X-Station-Token") != token:
                return self.reply(403, {"error": "页面连接已过期，请刷新后重试"})
            origin = self.headers.get("Origin")
            authority = self.headers.get("Host", "")
            allowed_origins = {public_origin} if public_origin else set()
            if authority != remote_authority:
                allowed_origins.add("http://" + authority)
            if origin and origin not in allowed_origins:
                return self.reply(403, {"error": "不允许跨站修改数据"})
            if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
                return self.reply(415, {"error": "请求需要使用 JSON 格式"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if length <= 0 or length > MAX_BODY:
                    return self.reply(413, {"error": "文件过大，最大支持 12 MB"})
                payload = json.loads(self.rfile.read(length))
                path = urlsplit(self.path).path
                if not isinstance(payload, dict):
                    raise Invalid('请求格式不正确')
                if self.command == 'POST' and path == '/api/proxy':
                    return self.reply(200, proxy_service.action(payload))
                if self.command == 'POST' and path == '/api/feeds/refresh':
                    return self.reply(202, feed_service.refresh())
                if self.command == 'POST' and path == '/api/feeds/sources':
                    return self.reply(201, feed_service.add_source(payload))
                if self.command == 'PUT' and path.startswith('/api/feeds/sources/'):
                    return self.reply(200, feed_service.source_enabled(path.rsplit('/',1)[-1], payload.get('enabled')))
                if self.command == 'PUT' and path.startswith('/api/feeds/items/'):
                    return self.reply(200, feed_service.update_article(path.rsplit('/',1)[-1],payload))
                if self.command == "POST" and path == "/api/backups":
                    try:
                        return self.reply(201, backup_service.create())
                    except (OSError, sqlite3.Error):
                        return self.reply(500, {"error": "备份写入失败，请检查数据卷剩余空间与权限"})
                if self.command == "POST" and path == "/api/bookmarks":
                    return self.reply(201, store.put(payload))
                if self.command == "POST" and path == "/api/import":
                    return self.reply(200, store.import_items(payload))
                parts = path.strip("/").split("/")
                if len(parts) == 3 and parts[:2] == ["api", "bookmarks"]:
                    if self.command == "PUT":
                        return self.reply(200, store.put(payload, parts[2]))
                    if self.command == "DELETE":
                        return self.reply(200, store.trash(parts[2]))
                if len(parts) == 4 and parts[:2] == ["api", "bookmarks"] and parts[3] == "restore" and self.command == "POST":
                    return self.reply(200, store.trash(parts[2], restore=True))
                return self.reply(404, {"error": "接口不存在"})
            except Duplicate as exc:
                return self.reply(409, {"error": str(exc)})
            except (Invalid, json.JSONDecodeError, UnicodeDecodeError, ValueError) as exc:
                return self.reply(400, {"error": str(exc)})
            except KeyError:
                return self.reply(404, {"error": "这条收藏已不存在，请刷新页面"})
            except sqlite3.Error:
                return self.reply(500, {"error": "数据库暂时不可用，请稍后重试"})
            except (OSError, TimeoutError):
                return self.reply(502, {'error':'网络或代理暂不可用，未暴露私密地址，请稍后重试'})

        do_POST = mutate
        do_PUT = mutate
        do_DELETE = mutate

    server = ThreadingHTTPServer((host, port), Handler)
    server.daemon_threads = True
    server.feed_service = feed_service
    server.proxy_service = proxy_service
    server.live_service = live_service
    original_close = server.server_close
    def close_services():
        backup_service.close()
        live_service.close()
        feed_service.close()
        proxy_service.close()
        original_close()
    server.server_close = close_services
    if background:
        proxy_service.launch()
        feed_service.start()
        live_service.start()
        backup_service.start()
    return server


def main():
    parser = argparse.ArgumentParser(description="零域 ZERO · 个人数字空间")
    parser.add_argument("--host", default=os.environ.get("STATION_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("STATION_PORT", "8765")))
    parser.add_argument("--data-dir", default=os.environ.get("STATION_DATA_DIR", str(ROOT / "data")))
    parser.add_argument("--public-origin", default=os.environ.get("STATION_PUBLIC_ORIGIN", ""),
                        help="Exact HTTPS origin of a trusted authenticated proxy; does not enable login")
    args = parser.parse_args()
    if not (PUBLIC / "app.js").is_file():
        sys.exit("Missing public/app.js. Run npm install and npm run build first.")
    server = make_server(args.host, args.port, args.data_dir, args.public_origin, background=True)
    print(f"ZERO: http://{args.host}:{server.server_port} | Data: {Path(args.data_dir).resolve()}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Station stopped.", flush=True)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
