import gzip
import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.parse import urlsplit
from safe_http import public_target, fetch_public, PinnedHTTPS
from proxy_service import ProxyService, subscription_usage


class ProxyDashboardTests(unittest.TestCase):
    def test_custom_https_port_keeps_destination_restrictions(self):
        dns=[(2,1,6,'',('8.8.8.8',5000))]
        with patch('safe_http.socket.getaddrinfo',return_value=dns):
            self.assertEqual(public_target('https://example.test:5000/sub',True,True)[1],5000)
            with self.assertRaises(ValueError):public_target('https://example.test:5000/rss')
            for url in ('http://example.test:5000/sub','https://example.test:0/sub','https://example.test:65536/sub'):
                with self.assertRaises(ValueError):public_target(url,True,True)
        for addr in ('127.0.0.1','10.1.1.1','100.64.0.1','169.254.169.254'):
            with patch('safe_http.socket.getaddrinfo',return_value=[(2,1,6,'',(addr,5000))]):
                with self.assertRaises(ValueError):public_target('https://example.test:5000/sub',True,True)

    def test_custom_port_host_header_and_redirect_validation(self):
        conn=MagicMock();response=MagicMock(status=200)
        response.getheader.return_value=None;response.getheaders.return_value=[];response.read.return_value=b'proxies: []';conn.getresponse.return_value=response
        target=(urlsplit('https://example.test:5000/sub'),5000,'8.8.8.8')
        with patch('safe_http.public_target',return_value=target),patch('safe_http.PinnedHTTPS',return_value=conn):
            self.assertEqual(fetch_public('https://example.test:5000/sub',https_only=True,allow_custom_port=True)[0],200)
            self.assertEqual(conn.request.call_args.kwargs['headers']['Host'],'example.test:5000')
        response.status=302;response.getheader.return_value='https://127.0.0.1:5000/sub'
        with patch('safe_http.public_target',side_effect=[target,ValueError('blocked')]),patch('safe_http.PinnedHTTPS',return_value=conn):
            with self.assertRaises(ValueError):fetch_public('https://example.test:5000/sub',https_only=True,allow_custom_port=True)
        self.assertTrue(conn.close.called)

    def test_dashboard_allowlist_and_background_latency(self):
        with tempfile.TemporaryDirectory() as directory:
            svc=ProxyService(directory,binary=Path(directory)/'absent')
            svc.settings['subscription_url']='https://example.test:5000/sub?token=do-not-return'
            svc.running=lambda:True
            def api(path,method='GET',payload=None,timeout=5):
                if '/healthcheck?' in path:
                    self.assertIn('generate_204',path);self.assertNotIn('do-not-return',path);return {'delay':123}
                if path=='/proxies':return {'proxies':{'节点选择':{'all':['DIRECT','a/b'],'now':'a/b'},'a/b':{'type':'Shadowsocks','password':'never-return','server':'private-node'}}}
                if path=='/version':return {'version':'fixture'}
                if path=='/connections':return {'uploadTotal':15,'downloadTotal':30,'connections':[{'metadata':{'destinationIP':'never-return'}}]}
                return {'all':['DIRECT','a/b'],'now':'a/b'}
            svc.api=api
            try:
                svc.test_nodes('a/b')
                for _ in range(100):
                    if not svc.test_state['running']:break
                    time.sleep(.01)
                status=svc.status();text=json.dumps(status)
                for secret in ('do-not-return','never-return','private-node',svc.secret):self.assertNotIn(secret,text)
                self.assertEqual(status['node_details'][1]['delay'],123)
                self.assertEqual(status['traffic']['connections'],1)
                with self.assertRaises(ValueError):svc.test_nodes('invalid')
            finally:
                svc.running=lambda:False;svc.close()

    def test_usage_only_parses_known_nonnegative_numbers(self):
        self.assertEqual(subscription_usage({'subscription-userinfo':'upload=4; download=9; total=100; expire=1234; token=secret'}),{'upload':4,'download':9,'total':100,'expire':1234})
        self.assertEqual(subscription_usage({'subscription-userinfo':'upload=-1; download=oops; total=999999999999999999999999'}),{})

    def test_https_proxy_tunnel_precedes_socket_and_retains_tls_hostname(self):
        connection=PinnedHTTPS('example.test','8.8.8.8',443,proxy=True)
        raw=MagicMock();context=MagicMock();connection._context=context
        with patch('safe_http.socket.create_connection',return_value=raw),patch.object(connection,'_tunnel') as tunnel:
            connection.connect()
        self.assertEqual(connection._tunnel_host,'8.8.8.8')
        tunnel.assert_called_once()
        context.wrap_socket.assert_called_once_with(raw,server_hostname='example.test')


if __name__=='__main__':unittest.main()
