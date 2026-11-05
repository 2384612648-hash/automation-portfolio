import { $, esc, icon, toast } from './shared.js';

const size=value=>{if(value==null)return '—';const n=Math.max(0,Number(value)||0);for(const [unit,scale] of [['TB',1024**4],['GB',1024**3],['MB',1024**2],['KB',1024]])if(n>=scale)return (n/scale).toFixed(1)+' '+unit;return Math.round(n)+' B';};
const date=value=>value?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';

export function mountProxy(root,api){
  let dead=false,busy=false,loading=false,state=null,previous=null,visible=60,signature='';
  root.innerHTML=`
  <div class="page-heading proxy-heading"><div class="proxy-title"><h1>代理</h1><span class="proxy-scope">信息流</span><span id="proxy-state" class="proxy-state" role="status">连接中</span></div><button class="button secondary" id="proxy-power" disabled>启动</button></div>
  <section class="module-panel proxy-dashboard">
    <div class="proxy-topline"><div class="proxy-segments" role="group" aria-label="代理模式"><button data-mode="rule" aria-pressed="false">代理</button><button data-mode="direct" aria-pressed="false">直连</button></div><button class="icon-button" id="proxy-reload" title="刷新状态" aria-label="刷新状态">${icon('restore')}</button></div>
    <div class="proxy-metrics"><div class="proxy-metric proxy-current"><span>当前节点</span><strong id="proxy-current">—</strong></div><div class="proxy-metric"><span>下载</span><strong id="proxy-down">—</strong><span id="proxy-down-rate"></span></div><div class="proxy-metric"><span>上传</span><strong id="proxy-up">—</strong><span id="proxy-up-rate"></span></div><div class="proxy-metric"><span>连接</span><strong id="proxy-connections">—</strong></div></div>
    <p id="proxy-error" class="proxy-error" role="alert" hidden></p>
  </section>
  <section class="module-panel proxy-sub-panel"><details id="proxy-subscription-panel"><summary><span>订阅</span><span id="proxy-sub-status">未配置</span></summary><div class="proxy-sub-body"><div id="proxy-quota" class="proxy-quota" hidden></div><form id="proxy-subscription" class="proxy-form"><label for="proxy-url">订阅地址</label><div class="proxy-url-row"><input id="proxy-url" name="url" type="password" required autocomplete="new-password" spellcheck="false" maxlength="4096" placeholder="HTTPS 订阅 URL"><button class="button primary" type="submit">保存</button><button class="button secondary" type="button" id="proxy-update">更新订阅</button></div></form><div class="proxy-sub-footer"><span id="proxy-updated"></span><details class="proxy-help"><summary>帮助</summary><p>支持 Clash / mihomo 订阅与 HTTPS 自定义端口。仅代理零域信息流；停止后尝试直连。测速是连接延迟，不是下载速度。订阅地址只保存于服务器。</p></details></div></div></details></section>
  <section class="module-panel proxy-node-panel"><div class="section-title"><h2>节点 <span id="proxy-count" class="proxy-count"></span></h2><button class="button secondary" id="proxy-test">全部测速</button></div><div class="proxy-node-tools"><label class="search-box">${icon('search')}<input id="proxy-search" type="search" placeholder="搜索节点" aria-label="搜索节点"></label><select id="proxy-sort" aria-label="节点排序"><option value="default">默认排序</option><option value="delay">延迟优先</option><option value="name">名称排序</option></select></div><div class="proxy-node-grid" id="proxy-nodes" aria-label="选择代理节点"></div><button class="button subtle proxy-more" id="proxy-more" hidden>显示更多</button></section>`;
  function filtered(){let nodes=state?.node_details||[];const query=$('#proxy-search',root).value.trim().toLowerCase();nodes=nodes.filter(n=>n.name!=='DIRECT'&&(!query||n.name.toLowerCase().includes(query)));const sort=$('#proxy-sort',root).value;if(sort==='delay')nodes=[...nodes].sort((a,b)=>(a.delay??Infinity)-(b.delay??Infinity));if(sort==='name')nodes=[...nodes].sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));return nodes;}
  function renderNodes(force=false){
    const nodes=filtered();$('#proxy-count',root).textContent=nodes.length;
    const next=JSON.stringify([nodes,state?.selected,state?.running,visible,busy,state?.test?.running]);if(!force&&signature===next)return;signature=next;
    const focused=document.activeElement?.closest('[data-node]');const focusName=focused?.dataset.node,focusAction=focused?.dataset.nodeAction;
    $('#proxy-nodes',root).innerHTML=nodes.length?nodes.slice(0,visible).map(n=>{const selected=n.name===state.selected;return '<article class="proxy-node '+(selected?'selected':'')+'"><button class="proxy-node-select" data-node="'+esc(n.name)+'" data-node-action="select" aria-pressed="'+selected+'" '+(!state.running||busy?'disabled':'')+'><span class="proxy-node-name">'+esc(n.name)+'</span><span class="proxy-node-bottom"><span>'+esc(n.type)+'</span><span class="proxy-node-check">'+(selected?icon('check'):'')+'</span></span></button><button class="proxy-delay '+(n.delay!=null?(n.delay<300?'fast':n.delay<800?'medium':'slow'):n.tested_at?'failed':'')+'" data-node="'+esc(n.name)+'" data-node-action="test" title="测试连接延迟" aria-label="测速：'+esc(n.name)+'" '+(!state.running||busy||state.test?.running?'disabled':'')+'>'+(n.delay!=null?n.delay+' ms':n.tested_at?'超时':'测速')+'</button></article>';}).join(''):'<div class="proxy-empty">'+(state?.configured?(state.running?'没有匹配节点':'启动后显示节点'):'添加订阅后显示节点')+'</div>';
    $('#proxy-more',root).hidden=visible>=nodes.length;
    if(focusName){const target=[...root.querySelectorAll('[data-node]')].find(e=>e.dataset.node===focusName&&e.dataset.nodeAction===focusAction);target?.focus({preventScroll:true});}
  }
  function render(sample=false){
    const s=state;$('#proxy-state',root).textContent=s.running?'运行中':s.installed?'已停止':'未安装';$('#proxy-state',root).classList.toggle('online',s.running);
    const power=$('#proxy-power',root);power.textContent=s.running?'停止':'启动';power.disabled=busy||!s.installed;power.classList.toggle('primary',!s.running);power.classList.toggle('secondary',s.running);
    root.querySelectorAll('[data-mode]').forEach(b=>{b.setAttribute('aria-pressed',b.dataset.mode===s.mode);b.disabled=busy||!s.running;});
    $('#proxy-current',root).textContent=s.mode==='direct'?'DIRECT':s.selected;$('#proxy-current',root).title=s.selected;
    const t=s.traffic;$('#proxy-down',root).textContent=size(t?.download);$('#proxy-up',root).textContent=size(t?.upload);$('#proxy-connections',root).textContent=t?.connections??'—';
    if(sample){for(const [field,id] of [['download','down'],['upload','up']]){let rate='';if(t&&previous&&t.sampled_at>previous.sampled_at&&t[field]>=previous[field])rate=size((t[field]-previous[field])/(t.sampled_at-previous.sampled_at))+'/s';$('#proxy-'+id+'-rate',root).textContent=rate;}previous=t;}
    $('#proxy-error',root).textContent=s.error||'';$('#proxy-error',root).hidden=!s.error;
    const usage=s.usage||{},hasUsed=usage.upload!=null||usage.download!=null,used=(usage.upload||0)+(usage.download||0),total=usage.total;
    $('#proxy-sub-status',root).textContent=s.configured?(hasUsed?size(used)+(total?' / '+size(total):' 已用'):'已配置'):'未配置';
    const quota=$('#proxy-quota',root);quota.hidden=!hasUsed&&!usage.expire;quota.innerHTML=(hasUsed?'<span>已用 '+size(used)+(total?' / '+size(total):'')+'</span>':'')+(usage.expire?'<span>到期 '+esc(new Date(usage.expire*1000).toLocaleDateString('zh-CN'))+'</span>':'')+(total?'<progress max="'+Number(total)+'" value="'+Math.min(used,total)+'" aria-label="订阅流量"></progress>':'');
    $('#proxy-updated',root).textContent=s.last_update?'更新于 '+date(s.last_update):'';$('#proxy-update',root).disabled=busy||!s.configured;
    $('#proxy-test',root).textContent=s.test?.running?'测速 '+s.test.done+'/'+s.test.total:'全部测速';$('#proxy-test',root).disabled=busy||!s.running||!s.configured||s.test?.running;
    if(!s.configured)$('#proxy-subscription-panel',root).open=true;
    renderNodes();
  }
  async function load(){if(dead||loading)return;loading=true;try{const s=await api('proxy');if(dead)return;state=s;render(true);}finally{loading=false;}}
  async function act(payload,message){if(busy)return;busy=true;if(state)render();root.querySelectorAll('#proxy-subscription button').forEach(b=>b.disabled=true);try{await api('proxy',{method:'POST',body:JSON.stringify(payload)});if(!dead){if(message)toast(message);while(loading&&!dead)await new Promise(resolve=>setTimeout(resolve,30));await load();}}catch(e){if(!dead)toast(e.message,true);}finally{busy=false;if(!dead){root.querySelectorAll('#proxy-subscription button').forEach(b=>b.disabled=false);if(state)render();}}}
  $('#proxy-power',root).onclick=()=>act({action:state?.running?'stop':'start'});
  root.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>act({action:'mode',mode:b.dataset.mode}));
  $('#proxy-reload',root).onclick=()=>load().catch(e=>toast(e.message,true));
  $('#proxy-subscription',root).onsubmit=e=>{e.preventDefault();const url=$('#proxy-url',root).value;$('#proxy-url',root).value='';act({action:'subscription',url},'订阅已保存');};
  $('#proxy-update',root).onclick=()=>act({action:'refresh'},'订阅已更新');
  $('#proxy-test',root).onclick=()=>act({action:'test'});
  $('#proxy-nodes',root).onclick=e=>{const b=e.target.closest('[data-node]');if(!b)return;act({action:b.dataset.nodeAction==='test'?'test':'node',name:b.dataset.node});};
  $('#proxy-search',root).oninput=()=>{visible=60;renderNodes();};$('#proxy-sort',root).onchange=()=>renderNodes();$('#proxy-more',root).onclick=()=>{visible+=60;renderNodes();};
  load().catch(e=>{if(!dead){$('#proxy-state',root).textContent='连接失败';toast(e.message,true);}});
  const timer=setInterval(()=>{if(!dead&&!busy&&!document.hidden)load().catch(()=>{});},4000);
  return()=>{dead=true;clearInterval(timer);};
}
