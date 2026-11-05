"""Read an authorized subscription from stdin; configure the local ZERO API without printing secrets."""
import json
import sys
import time
from urllib.request import Request, build_opener, ProxyHandler


def configure(url, base='http://127.0.0.1:8765'):
    opener = build_opener(ProxyHandler({}))
    def get(path):
        with opener.open(base + path, timeout=30) as response:
            return json.load(response)
    token = get('/api/state')['token']
    def post(path, body):
        request = Request(base + path, data=json.dumps(body).encode(), method='POST',
            headers={'Content-Type':'application/json','X-Station-Token':token})
        with opener.open(request, timeout=100) as response:
            return json.load(response)
    state = post('/api/proxy', {'action':'subscription','url':url})
    if not state['running']:
        post('/api/proxy', {'action':'start'})
    post('/api/proxy', {'action':'test'})
    for _ in range(100):
        time.sleep(1)
        state = get('/api/proxy')
        if not state['test']['running']:
            break
    good = [n for n in state['node_details'] if n['name'] != 'DIRECT' and n['delay'] is not None]
    if not good:
        post('/api/proxy', {'action':'mode','mode':'direct'})
        print(json.dumps({'subscription_saved':True,'nodes':len(state['node_details'])-1,'reachable':0,'proxy_enabled':False}))
        return False
    best = min(good,key=lambda x:x['delay'])
    post('/api/proxy', {'action':'node','name':best['name']})
    final = post('/api/proxy', {'action':'mode','mode':'rule'})
    enabled = final['running'] and final['mode']=='rule' and final['selected']==best['name']
    post('/api/feeds/refresh', {})
    print(json.dumps({'subscription_saved':True,'nodes':len(state['node_details'])-1,'reachable':len(good),
        'selected_delay_ms':best['delay'],'proxy_enabled':enabled}))
    return enabled


if __name__ == '__main__':
    url = sys.stdin.read(4097).strip()
    if not url or len(url)>4096:
        print('Private subscription input missing or invalid')
        raise SystemExit(1)
    try:
        ok=configure(url)
    except Exception:
        print('Subscription setup incomplete; review the proxy page. No private URL printed.')
        raise SystemExit(1)
    raise SystemExit(0 if ok else 2)
