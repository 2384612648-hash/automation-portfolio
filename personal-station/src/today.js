import {$,esc,icon} from './shared.js';
import {mountReading} from './reading.js';
import {mountMarkets} from './markets.js';
import {mountNocturne} from './nocturne.js';

export function mountToday(root,saveNews) {
  let dead=false,cleanReading=null,cleanMarkets=null;
  const controller=new AbortController();
  root.innerHTML=`<div class="nocturne-home">
    <section class="zn-hero" aria-label="零域个人空间">
      <img class="zn-robot" src="/assets/robot-hand.webp" width="1100" height="733" alt="概念图：机械手托起玻璃球" fetchpriority="high">
      <canvas class="zn-shader" aria-hidden="true"></canvas>
      <div class="zn-hero-copy"><div class="zn-eyebrow">零域<span>PERSONAL SPACE</span></div><h1>Stay<br><em>curious.</em></h1><button class="zn-explore" type="button" aria-label="浏览订阅" data-browse>${icon('down')}</button></div>
      <canvas class="zn-orbit" width="384" height="384" role="img" aria-label="玫瑰金环形雕塑，可用视角滑杆切换动画帧"></canvas>
      <div class="zn-hero-foot"><span>C++ / ROS 2 / ROBOTICS</span><div class="zn-scrub"><label for="nocturne-frame">视角</label><input id="nocturne-frame" type="range" min="0" max="47" value="0" aria-label="雕塑动画帧"></div><span class="zn-hero-index">01 / 48</span></div>
    </section>
    <div class="zn-content">
      <nav class="zn-entry-strip" aria-label="常用入口">
        <a href="https://docs.ros.org/en/jazzy/" target="_blank" rel="noopener noreferrer">${icon('code')}<span>ROS 2</span>${icon('external')}</a>
        <a href="https://en.cppreference.com/w/" target="_blank" rel="noopener noreferrer">${icon('code')}<span>C++</span>${icon('external')}</a>
        <a href="#all">${icon('bookmark')}<span>阅读收藏</span>${icon('arrow')}</a>
        <button type="button" data-markets>${icon('graph')}<span>行情 / 汇率</span>${icon('arrow')}</button>
      </nav>
      <div class="zn-editorial">
        <section class="zn-reading" aria-labelledby="nocturne-feed-title"><div class="zn-section-head"><h2 id="nocturne-feed-title">订阅。</h2><a href="#feeds" class="zn-small-link">信息流 ${icon('arrow')}</a></div><span id="today-brief-status" class="zn-update" role="status">正在读取订阅…</span><div id="today-highlights" aria-live="polite"></div><a class="zn-library-link" href="#starred"><span>${icon('bookmark')}星标库</span>${icon('arrow')}</a></section>
        <a class="zn-piano zn-depth" href="#tools/metronome" aria-label="打开钢琴节拍器"><img src="/assets/piano-prism.webp" width="760" height="507" alt="概念图：钢琴琴键上的玫瑰色玻璃棱镜" loading="lazy"><div class="zn-piano-copy"><h2>节拍器。</h2><span class="zn-round" aria-hidden="true">▷</span></div></a>
      </div>
      <div class="zn-lower">
        <section class="zn-tools" aria-labelledby="nocturne-tools-title"><div class="zn-section-head"><h2 id="nocturne-tools-title">工具台。</h2><a href="#tools" class="zn-small-link">14 个工具 ${icon('arrow')}</a></div><div class="zn-tool-grid"><a class="zn-tool" href="#tools/json">${icon('code')}<span>JSON</span>${icon('arrow')}</a><a class="zn-tool" href="#tools/diff">${icon('diff')}<span>文本</span>${icon('arrow')}</a><a class="zn-tool" href="#tools/pdf">${icon('file')}<span>PDF</span>${icon('arrow')}</a><a class="zn-tool" href="#tools/image">${icon('image')}<span>图片</span>${icon('arrow')}</a></div></section>
        <section class="zn-server zn-depth" aria-label="服务器与数据"><div class="zn-server-top"><span>我的服务器</span><span class="zn-server-status" role="status">正在连接</span></div><canvas class="zn-prism" width="384" height="384" role="img" aria-label="层叠数据棱镜"></canvas><div class="zn-server-bottom"><h2>数据中心。</h2><div><button type="button" class="zn-icon" data-open-data aria-label="数据快照与导出">${icon('database')}</button><a href="#proxy" class="zn-icon" aria-label="服务器代理">${icon('shield')}</a></div></div><span class="zn-server-version"></span></section>
      </div>
      <details class="zn-more" id="nocturne-markets"><summary>一言与行情 ${icon('down')}</summary><div id="reading-module"></div><div id="markets-module"></div></details>
      <footer><span>zero<span class="zn-footer-dot"> / </span>零域</span><span class="zn-today-date">${esc(new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long',timeZone:'Asia/Shanghai'}))}</span><button class="zn-icon" type="button" aria-label="回到顶部" data-top>${icon('up')}</button></footer>
    </div>
  </div>`;
  const home=$('.nocturne-home',root),cleanArt=mountNocturne(home),more=$('.zn-more',root);
  function expanded(){if(more.open&&!cleanReading){cleanReading=mountReading($('#reading-module',root));cleanMarkets=mountMarkets($('#markets-module',root));}}
  more.addEventListener('toggle',expanded);
  $('[data-markets]',root).onclick=()=>{more.open=true;expanded();more.scrollIntoView({block:'start',behavior:'instant'});};
  $('[data-browse]',root).onclick=()=>$('.zn-reading',root).scrollIntoView({block:'start',behavior:'instant'});
  $('[data-top]',root).onclick=()=>window.scrollTo({top:0,behavior:'instant'});
  $('[data-open-data]',root).onclick=()=>$('#data-button').click();
  async function get(path){const response=await fetch('/api/'+path,{signal:controller.signal});if(!response.ok)throw Error();return response.json();}
  async function digest(){try{const v=await get('feeds/digest');if(dead)return;$('#today-brief-status',root).textContent='今日 '+v.today_total+' 条';$('#today-highlights',root).innerHTML=v.items.length?v.items.slice(0,3).map((n,i)=>'<article class="zn-story"><span class="zn-source">'+esc(n.sources[0]?.name||'RSS')+'</span><h3><a class="zn-story-title" href="'+esc(n.url)+'" target="_blank" rel="noopener noreferrer">'+esc(n.title)+icon('external')+'</a></h3>'+(n.original_title?'<details class="translation-detail"><summary>机译 · 原标题</summary><p lang="en">'+esc(n.original_title)+'</p></details>':'')+'<div class="zn-story-foot"><time>'+esc(new Date(n.published_at).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'}))+'</time><button class="zn-save" type="button" data-digest-save="'+i+'" aria-label="收录文章">'+icon('plus')+'</button></div></article>').join(''):'<div class="zn-feed-empty">今日暂无新信息<a href="#feeds">查看全部订阅 '+icon('arrow')+'</a></div>';root.querySelectorAll('[data-digest-save]').forEach(b=>b.onclick=()=>{const n=v.items[Number(b.dataset.digestSave)];saveNews({...n,source:n.sources.map(s=>s.name).join(' / ')});});}catch{if(!dead){$('#today-brief-status',root).textContent='暂时无法更新';$('#today-highlights',root).innerHTML='<div class="zn-feed-empty"><button class="button secondary" type="button" data-digest-retry>重试</button><a href="#feeds">查看信息流</a></div>';$('[data-digest-retry]',root).onclick=digest;}}}
  async function status(){try{const health=await get('health');if(!dead){$('.zn-server-status',root).textContent='已连接';$('.zn-server-version',root).textContent='v'+health.version;}}catch{if(!dead)$('.zn-server-status',root).textContent='连接中断';}}
  digest();status();const timer=setInterval(()=>{if(!document.hidden){digest();status();}},60000);
  return()=>{dead=true;clearInterval(timer);controller.abort();more.removeEventListener('toggle',expanded);cleanArt();cleanReading?.();cleanMarkets?.();};
}
