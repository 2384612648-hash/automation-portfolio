"""Bounded public HTTP fetches, with DNS pinning and redirect validation."""
import http.client
import ipaddress
import socket
import ssl
import zlib
from urllib.parse import urlsplit, urljoin


def public_target(url, https_only=False, allow_custom_port=False):
    p = urlsplit(url)
    if (p.scheme not in (('https',) if https_only else ('http', 'https')) or not p.hostname
            or p.username or p.password or p.fragment or len(url) > 4096
            or any(ord(c) < 33 for c in url)):
        raise ValueError('需要有效的公开 HTTPS/RSS 地址，不能含账号密码或片段')
    port = p.port if p.port is not None else (443 if p.scheme == 'https' else 80)
    if not 1 <= port <= 65535:
        raise ValueError('端口必须介于 1–65535')
    if port not in (80, 443) and not (allow_custom_port and p.scheme == 'https'):
        raise ValueError('仅支持标准 HTTP/HTTPS 端口')
    addresses = list(dict.fromkeys(r[4][0] for r in socket.getaddrinfo(p.hostname, port, type=socket.SOCK_STREAM)))
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise ValueError('不能抓取内网、回环或保留地址')
    return p, port, addresses[0]


class PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, hostname, address, port, proxy=False):
        super().__init__(hostname, port, timeout=15, context=ssl.create_default_context())
        self.address = address
        self.via_proxy = proxy

    def connect(self):
        if self.via_proxy:
            self.set_tunnel(self.address, self.port)
        self.sock = socket.create_connection(('127.0.0.1', 7890) if self.via_proxy else (self.address, self.port), self.timeout)
        if self.via_proxy:
            self._tunnel()
        self.sock = self._context.wrap_socket(self.sock, server_hostname=self.host)


def fetch_public(url, headers=None, limit=2_000_000, proxy=False, https_only=False, allow_custom_port=False):
    """GET only. No ambient environment proxy; no URL in errors/logs."""
    for _ in range(5):
        p, port, address = public_target(url, https_only, allow_custom_port)
        host_header = p.hostname.encode('idna').decode('ascii')
        if ':' in host_header:
            host_header = '[' + host_header + ']'
        if port != (443 if p.scheme == 'https' else 80):
            host_header += ':' + str(port)
        request_headers = {'User-Agent': 'ZeroPersonalStation/1.1 personal RSS reader', 'Accept-Encoding': 'identity', 'Host': host_header}
        request_headers.update(headers or {})
        target = (p.path or '/') + ('?' + p.query if p.query else '')
        if p.scheme == 'https':
            conn = PinnedHTTPS(p.hostname, address, port, proxy)
        else:
            conn = http.client.HTTPConnection('127.0.0.1' if proxy else address, 7890 if proxy else port, timeout=15)
            if proxy:
                iphost = '[' + address + ']' if ':' in address else address
                target = 'http://' + iphost + target
        try:
            conn.request('GET', target, headers=request_headers)
            response = conn.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader('Location')
                if not location:
                    raise ValueError('跳转地址缺失')
                url = urljoin(url, location)
                continue
            if response.status == 304:
                return 304, b'', dict(response.getheaders())
            if response.status != 200:
                raise ValueError('上游返回 HTTP ' + str(response.status))
            body = response.read(limit + 1)
            if len(body) > limit:
                raise ValueError('响应超过大小限制')
            encoding = (response.getheader('Content-Encoding') or '').lower()
            if encoding in ('gzip','deflate'):
                decoder = zlib.decompressobj(16 + zlib.MAX_WBITS if encoding == 'gzip' else zlib.MAX_WBITS)
                body = decoder.decompress(body, limit + 1)
                if len(body) > limit or decoder.unconsumed_tail or not decoder.eof:
                    raise ValueError('解压响应超限或不完整')
            elif encoding not in ('','identity'):
                raise ValueError('不支持的压缩格式')
            return 200, body, {k.lower(): v for k, v in response.getheaders()}
        finally:
            conn.close()
    raise ValueError('跳转次数过多')
