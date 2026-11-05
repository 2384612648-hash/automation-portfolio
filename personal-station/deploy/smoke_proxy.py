import json
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from proxy_service import ProxyService

with tempfile.TemporaryDirectory(prefix='zero-proxy-smoke-') as directory:
    service=ProxyService(directory,binary=Path(__file__).resolve().parents[1]/'bin/mihomo')
    try:
        service.start()
        assert service.status()['running']
        assert service.status()['mode']=='direct'
        payload=json.dumps({'proxies':[{'name':'Fixture','type':'http','server':'127.0.0.1','port':9}]}).encode()
        with patch('proxy_service.fetch_public',return_value=(200,payload,{})):
            result=service.import_subscription('https://example.com/subscription-test')
        assert 'Fixture' in result['nodes'],result
        service.action({'action':'node','name':'Fixture'})
        service.action({'action':'mode','mode':'rule'})
        assert service.available_for_fetch()
        service.action({'action':'mode','mode':'direct'})
        with patch('proxy_service.fetch_public',return_value=(200,b'invalid',{})):
            try:service.import_subscription('https://example.com/invalid')
            except ValueError:pass
            else:raise AssertionError('invalid subscription accepted')
        assert service.status()['configured'] and 'Fixture' in service.status()['nodes']
        service.action({'action':'stop'})
        assert not service.status()['running']
        service.action({'action':'start'})
        assert service.status()['running']
        print(json.dumps({'proxy_smoke':'passed','version':service.status()['version'],'subscription_fixture':'validated without real node traffic'}))
    finally:service.close()
