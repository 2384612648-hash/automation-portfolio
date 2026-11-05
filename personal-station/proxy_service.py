"""Private mihomo supervisor and a minimal dashboard API."""
import copy
import json
import os
import secrets
import ssl
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote, urlencode
from urllib.request import Request, build_opener, ProxyHandler
from safe_http import fetch_public, public_target

DELAY_URL = 'https://www.gstatic.com/generate_204'


def subscription_usage(headers):
    result = {}
    for field in headers.get('subscription-userinfo', '').split(';'):
        key, sep, value = field.strip().partition('=')
        if sep and key in ('upload', 'download', 'total', 'expire'):
            try:
                number = int(value)
                if 0 <= number <= 2**63 - 1:
                    result[key] = number
            except ValueError:
                pass
    return result


class ProxyService:
    def __init__(self, directory, binary=None):
        self.root = Path(directory)
        self.root.mkdir(parents=True, exist_ok=True)
        self.root.chmod(0o700)
        self.binary = Path(binary or os.environ.get('STATION_MIHOMO_BIN', '/app/bin/mihomo'))
        self.lock = threading.RLock()
        self.test_lock = threading.Lock()
        self.proc = None
        self.stopping = threading.Event()
        self.error = None
        self.thread = None
        self.delays = {}
        self.test_state = {'running': False, 'done': 0, 'total': 0}
        settings = self.root / 'settings.json'
        self.settings = json.loads(settings.read_text(encoding='utf-8')) if settings.exists() else {
            'enabled': True, 'mode': 'direct', 'subscription_url': '', 'last_update': None,
            'last_attempt': 0, 'selected': 'DIRECT', 'usage': {}}
        secret = self.root / 'controller.secret'
        if not secret.exists():
            self.write(secret, secrets.token_urlsafe(40).encode())
        self.secret = secret.read_text(encoding='utf-8')
        self.save()

    def write(self, path, data):
        temp = path.with_name(path.name + '.tmp')
        with open(temp, 'wb') as f:
            os.chmod(temp, 0o600)
            f.write(data)
        os.replace(temp, path)

    def save(self):
        self.write(self.root / 'settings.json', json.dumps(self.settings, ensure_ascii=False).encode())

    def config(self):
        result = {'mixed-port': 7890, 'allow-lan': False, 'bind-address': '127.0.0.1',
            'mode': self.settings['mode'], 'log-level': 'silent',
            'external-controller': '127.0.0.1:9090', 'secret': self.secret, 'ipv6': False,
            'tun': {'enable': False}, 'profile': {'store-selected': True},
            'proxy-groups': [{'name': '节点选择', 'type': 'select', 'proxies': ['DIRECT']}],
            'rules': ['IP-CIDR,127.0.0.0/8,DIRECT,no-resolve', 'IP-CIDR,10.0.0.0/8,DIRECT,no-resolve',
                'IP-CIDR,172.16.0.0/12,DIRECT,no-resolve', 'IP-CIDR,192.168.0.0/16,DIRECT,no-resolve',
                'IP-CIDR,100.64.0.0/10,DIRECT,no-resolve', 'DOMAIN-SUFFIX,ts.net,DIRECT', 'MATCH,节点选择']}
        if (self.root / 'subscription.yaml').exists():
            result['proxy-providers'] = {'subscription': {'type': 'file', 'path': './subscription.yaml',
                'health-check': {'enable': False}}}
            result['proxy-groups'][0]['use'] = ['subscription']
        return result

    def write_config(self):
        self.write(self.root / 'config.json', json.dumps(self.config(), ensure_ascii=False).encode())

    def api(self, path, method='GET', payload=None, timeout=5):
        request = Request('http://127.0.0.1:9090' + path,
            data=json.dumps(payload).encode() if payload is not None else None,
            headers={'Authorization': 'Bearer ' + self.secret, 'Content-Type': 'application/json'}, method=method)
        with build_opener(ProxyHandler({})).open(request, timeout=timeout) as r:
            body = r.read(4_000_001)
            if len(body) > 4_000_000:
                raise ValueError('内核响应过大')
            return json.loads(body) if body else {}

    def running(self):
        return bool(self.proc and self.proc.poll() is None)

    def start(self):
        if not self.binary.is_file():
            return
        with self.lock:
            if self.running():
                return
            self.write_config()
            self.proc = subprocess.Popen([str(self.binary), '-d', str(self.root), '-f', str(self.root / 'config.json')],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(35):
                if self.proc.poll() is not None:
                    break
                try:
                    self.api('/version')
                    group = self.api('/proxies/' + quote('节点选择', safe=''))
                    selected = self.settings.get('selected', 'DIRECT')
                    if selected not in group.get('all', []):
                        selected = 'DIRECT'
                    self.api('/proxies/' + quote('节点选择', safe=''), 'PUT', {'name': selected})
                    self.settings['selected'] = selected
                    self.error = None
                    return
                except Exception:
                    time.sleep(.15)
            self.stop()
            raise ValueError('内核启动失败，请检查订阅或服务状态')

    def stop(self):
        with self.lock:
            if self.running():
                self.proc.terminate()
                try:
                    self.proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    self.proc.kill()
                    self.proc.wait(timeout=3)
            self.proc = None

    def launch(self):
        if self.thread:
            return
        def loop():
            while not self.stopping.is_set():
                try:
                    with self.lock:
                        if self.settings['enabled'] and not self.running():
                            self.start()
                        if self.settings.get('subscription_url') and time.time() - self.settings.get('last_attempt', 0) > 21600:
                            self.import_subscription(self.settings['subscription_url'])
                except Exception:
                    self.error = self.error or '代理启动或订阅刷新失败'
                self.stopping.wait(30)
        self.thread = threading.Thread(target=loop, daemon=True, name='proxy-supervisor')
        self.thread.start()

    def close(self):
        self.stopping.set()
        self.stop()

    def available_for_fetch(self):
        return self.running() and self.settings['mode'] == 'rule' and self.settings.get('selected') != 'DIRECT'

    def status(self):
        with self.lock:
            nodes = []
            details = []
            selected = self.settings.get('selected', 'DIRECT')
            version = None
            traffic = None
            if self.running():
                try:
                    proxies = self.api('/proxies').get('proxies', {})
                    if (self.root / 'subscription.yaml').exists():
                        for proxy in self.api('/providers/proxies/subscription').get('proxies', []):
                            proxies[proxy['name']] = proxy
                    group = proxies.get('节点选择', {})
                    nodes = group.get('all', [])
                    selected = group.get('now', 'DIRECT')
                    self.settings['selected'] = selected
                    version = self.api('/version').get('version')
                    with self.test_lock:
                        for name in nodes:
                            proxy = proxies.get(name, {})
                            measured = self.delays.get(name)
                            details.append({'name': name, 'type': proxy.get('type', 'Proxy'),
                                'delay': measured.get('delay') if measured else None,
                                'tested_at': measured.get('tested_at') if measured else None})
                    try:
                        connections = self.api('/connections')
                        traffic = {'upload': connections.get('uploadTotal', 0),
                            'download': connections.get('downloadTotal', 0),
                            'connections': len(connections.get('connections') or []), 'sampled_at': time.time()}
                    except Exception:
                        pass
                except Exception:
                    self.error = '内核响应暂不可用'
            with self.test_lock:
                test_state = dict(self.test_state)
            return {'installed': self.binary.is_file(), 'running': self.running(), 'enabled': self.settings['enabled'],
                'mode': self.settings['mode'], 'configured': bool(self.settings.get('subscription_url')),
                'last_update': self.settings.get('last_update'), 'nodes': nodes, 'node_details': details,
                'selected': selected, 'version': version, 'error': self.error,
                'usage': self.settings.get('usage', {}), 'traffic': traffic, 'test': test_state}

    def select(self, name):
        if not isinstance(name, str):
            raise ValueError('节点无效')
        if not self.running():
            raise ValueError('请先启动代理')
        group = self.api('/proxies/' + quote('节点选择', safe=''))
        if name not in group.get('all', []):
            raise ValueError('该节点不存在')
        self.api('/proxies/' + quote('节点选择', safe=''), 'PUT', {'name': name})
        self.settings['selected'] = name
        self.save()

    def test_nodes(self, name=None):
        if not self.running():
            raise ValueError('请先启动代理')
        group = self.api('/proxies/' + quote('节点选择', safe=''))
        names = [n for n in group.get('all', []) if n != 'DIRECT']
        if name is not None:
            if not isinstance(name, str) or name not in names:
                raise ValueError('该节点不可测试')
            names = [name]
        if not names:
            raise ValueError('请先添加订阅')
        if len(names) > 600:
            raise ValueError('节点过多，请搜索后单独测速')
        with self.test_lock:
            if self.test_state['running']:
                return {'queued': False}
            self.test_state = {'running': True, 'done': 0, 'total': len(names)}
        def measure(node):
            if self.stopping.is_set() or not self.running():
                return
            delay = None
            try:
                data = self.api('/providers/proxies/subscription/' + quote(node, safe='') + '/healthcheck?' + urlencode({
                    'url': DELAY_URL, 'timeout': 5000, 'expected': '204'}), timeout=7)
                value = data.get('delay')
                if isinstance(value, int) and value > 0:
                    delay = value
            except Exception:
                pass
            with self.test_lock:
                self.delays[node] = {'delay': delay, 'tested_at': time.time()}
                self.test_state['done'] += 1
        def run():
            try:
                with ThreadPoolExecutor(max_workers=5) as pool:
                    list(pool.map(measure, names))
            finally:
                with self.test_lock:
                    self.test_state['running'] = False
        threading.Thread(target=run, daemon=True, name='proxy-delay').start()
        return {'queued': True}

    def import_subscription(self, url):
        if not isinstance(url, str):
            raise ValueError('请输入订阅 URL')
        url = url.strip()
        with self.lock:
            if not self.binary.is_file():
                raise ValueError('代理内核尚未安装')
            self.settings['last_attempt'] = time.time()
            self.save()
            previous_settings = copy.deepcopy(self.settings)
            path = self.root / 'subscription.yaml'
            previous = path.read_bytes() if path.exists() else None
            changed = False
            try:
                public_target(url, https_only=True, allow_custom_port=True)
                _, data, headers = fetch_public(url, headers={'User-Agent': 'clash.meta'}, limit=5_000_000,
                    https_only=True, allow_custom_port=True)
                text = data.decode('utf-8-sig')
                if not ('proxies:' in text or '"proxies"' in text):
                    raise ValueError('需要 Clash/mihomo 格式订阅')
                self.stop()
                changed = True
                self.write(path, data)
                self.write_config()
                check = subprocess.run([str(self.binary), '-t', '-d', str(self.root), '-f', str(self.root / 'config.json')],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=20)
                if check.returncode:
                    raise ValueError('订阅格式校验失败')
                self.start()
                group = self.api('/proxies/' + quote('节点选择', safe=''))
                if not any(n != 'DIRECT' for n in group.get('all', [])):
                    raise ValueError('订阅中没有节点')
                self.settings['subscription_url'] = url
                self.settings['last_update'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
                self.settings['usage'] = subscription_usage(headers)
                self.error = None
                with self.test_lock:
                    self.delays = {}
                self.save()
                if not self.settings['enabled']:
                    self.stop()
                return self.status()
            except Exception as exc:
                self.settings = previous_settings
                if changed:
                    self.stop()
                    if previous is not None:
                        self.write(path, previous)
                    elif path.exists():
                        path.unlink()
                    self.write_config()
                    if self.settings['enabled']:
                        try:
                            self.start()
                        except Exception:
                            pass
                if isinstance(exc, ssl.SSLCertVerificationError):
                    message = '订阅 HTTPS 证书无效'
                elif isinstance(exc, ValueError):
                    message = str(exc) if str(exc).startswith(('需要', '订阅', '不能', '仅支持', '端口', '上游返回', '跳转', '响应', '解压', '不支持')) else '订阅地址或格式无效'
                else:
                    message = '订阅连接失败，请稍后重试'
                self.error = message + '，原配置保留'
                self.save()
                raise ValueError(self.error) from None

    def action(self, data):
        with self.lock:
            action = data.get('action')
            if action == 'subscription':
                return self.import_subscription(data.get('url', ''))
            if action == 'refresh':
                if not self.settings.get('subscription_url'):
                    raise ValueError('请先添加订阅')
                return self.import_subscription(self.settings['subscription_url'])
            if action == 'test':
                return self.test_nodes(data.get('name'))
            if action == 'start':
                if not self.binary.is_file():
                    raise ValueError('代理内核尚未安装')
                self.start()
                self.settings['enabled'] = True
            elif action == 'stop':
                self.settings['enabled'] = False
                self.stop()
            elif action == 'mode':
                mode = data.get('mode')
                if mode not in ('rule', 'direct'):
                    raise ValueError('模式无效')
                if not self.running():
                    raise ValueError('请先启动代理')
                self.api('/configs', 'PATCH', {'mode': mode})
                self.settings['mode'] = mode
            elif action == 'node':
                self.select(data.get('name'))
            else:
                raise ValueError('未知代理操作')
            self.save()
            self.write_config()
            return self.status()
