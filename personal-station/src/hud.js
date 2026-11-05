import {$} from './shared.js';
const motionQuery=typeof matchMedia==='function'?matchMedia('(prefers-reduced-motion: reduce)'):{matches:true};
let disabled=false;
try{disabled=localStorage.getItem('zero:motion')==='off';}catch{}
export const motionAllowed=()=>!disabled&&!motionQuery.matches;
export function mountHud(){
  const art=document.createElement('div');art.className='hud-atmosphere';art.setAttribute('aria-hidden','true');
  art.innerHTML='<div class="hud-grid"></div><svg class="hud-beams" viewBox="0 0 1440 1000" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="hud-beam"><stop stop-color="#00e5ff" stop-opacity="0"/><stop offset=".65" stop-color="#00e5ff"/><stop offset="1" stop-color="#ff9d53" stop-opacity="0"/></linearGradient></defs><path d="M-160 600C250 120 490 820 940 130S1350 290 1650-100"/><path d="M-110 920C200 380 650 1200 1080 510S1410 700 1580 160"/></svg>';
  document.body.prepend(art);
  const button=document.createElement('button');button.id='motion-toggle';button.className='motion-toggle icon-button';button.type='button';
  $('.theme-select').before(button);
  function apply(){const reduced=!motionAllowed();document.documentElement.dataset.motion=reduced?'off':'on';button.setAttribute('aria-pressed',String(!reduced));button.title=reduced?'开启动效':'暂停动效';button.setAttribute('aria-label',button.title);button.innerHTML=reduced?'<span aria-hidden="true">▷</span>':'<span aria-hidden="true">Ⅱ</span>';document.dispatchEvent(new Event('zero:motion'));}
  button.onclick=()=>{disabled=!disabled;try{localStorage.setItem('zero:motion',disabled?'off':'on');}catch{}apply();};motionQuery.addEventListener('change',apply);apply();
  const states=new Map();let frame=0,last=0;const fine=matchMedia('(hover:hover) and (pointer:fine)');
  function animate(now){const dt=Math.min((now-last)/1000||.016,.032);last=now;let moving=false;
    for(const [el,s] of states){if(!el.isConnected){states.delete(el);continue;}for(const axis of ['x','y']){s['v'+axis]+=(180*(s['t'+axis]-s[axis])-19*s['v'+axis])*dt;s[axis]+=s['v'+axis]*dt;}
      el.style.transform='perspective(1000px) rotateX('+s.y.toFixed(3)+'deg) rotateY('+s.x.toFixed(3)+'deg)';
      if(Math.abs(s.x-s.tx)+Math.abs(s.y-s.ty)+Math.abs(s.vx)+Math.abs(s.vy)>.025)moving=true;else if(!s.tx&&!s.ty){el.style.transform='';states.delete(el);}
    }frame=moving?requestAnimationFrame(animate):0;
  }
  function schedule(){if(!frame&&motionAllowed()&&!document.hidden){last=performance.now();frame=requestAnimationFrame(animate);}}
  document.addEventListener('pointermove',e=>{if(!fine.matches||!motionAllowed())return;const el=e.target.closest('.tool-card,.signal-panel');if(!el)return;const r=el.getBoundingClientRect(),x=(e.clientX-r.left)/r.width,y=(e.clientY-r.top)/r.height;el.style.setProperty('--pointer-x',(x*100)+'%');el.style.setProperty('--pointer-y',(y*100)+'%');let s=states.get(el);if(!s){s={x:0,y:0,vx:0,vy:0,tx:0,ty:0};states.set(el,s);}s.tx=(x-.5)*3;s.ty=(.5-y)*3;schedule();});
  document.addEventListener('pointerout',e=>{const el=e.target.closest('.tool-card,.signal-panel');if(el&&!el.contains(e.relatedTarget)&&states.has(el)){const s=states.get(el);s.tx=s.ty=0;schedule();}});
  function reset(){if(frame)cancelAnimationFrame(frame);frame=0;for(const el of states.keys())el.style.transform='';states.clear();}
  document.addEventListener('zero:motion',()=>{if(!motionAllowed())reset();});
  document.addEventListener('visibilitychange',()=>{document.documentElement.dataset.visibility=document.hidden?'hidden':'visible';if(document.hidden)reset();});
  const nav=$('#navigation'),indicator=document.createElement('span');indicator.className='nav-tracker';indicator.setAttribute('aria-hidden','true');nav.before(indicator);
  function track(){const active=$('.nav-item.active',nav);if(!active)return;const a=active.getBoundingClientRect(),p=nav.parentElement.getBoundingClientRect();indicator.style.height=a.height+'px';indicator.style.transform='translateY('+(a.top-p.top)+'px)';}
  new MutationObserver(track).observe(nav,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});new ResizeObserver(track).observe(nav);window.addEventListener('resize',track);track();
}

export function mountSignal(root){
  root.innerHTML='<section class="signal-panel" aria-labelledby="signal-title"><div class="signal-heading"><h2 id="signal-title">信息脉络</h2><span class="signal-badge">每小时同步</span></div><div class="signal-stage"><canvas aria-hidden="true"></canvas><span class="signal-corner tl"></span><span class="signal-corner tr"></span><span class="signal-corner bl"></span><span class="signal-corner br"></span></div><div class="signal-metrics"><div><strong id="signal-count">—</strong><span>已收集</span></div><div><strong id="signal-sources">—</strong><span>正常来源</span></div><div><strong id="signal-next">—</strong><span>下次更新</span></div></div><div id="signal-state" class="signal-state" role="status">连接采集器</div></section>';
  const panel=$('.signal-panel',root),stage=$('.signal-stage',root),canvas=$('canvas',root),context=canvas.getContext('2d');let dead=false,frame=0,last=0,time=0,visible=true,width=0,height=0,px=0,py=0,tx=0,ty=0,vx=0,vy=0,pulse=-5;const requests=new Set();
  function project(x,y,z){const az=-.3+px*.14,ay=.48+py*.12,cs=Math.cos(az),sn=Math.sin(az),xx=x*cs-y*sn,yy=x*sn+y*cs;const zz=yy*Math.sin(ay)+z*Math.cos(ay),scale=440/(440-zz);return {x:width/2+xx*scale,y:height/2+(yy*Math.cos(ay)-z*Math.sin(ay))*scale,z:zz};}
  function render(){if(!context||!width)return;const c=context,dark=document.documentElement.dataset.theme!=='light',cyan=dark?'0,229,255':'0,104,124',orange=dark?'255,160,92':'163,76,19',size=Math.min(width*.29,height*.55);c.clearRect(0,0,width,height);
    c.save();c.translate(width/2,height/2);c.strokeStyle='rgba('+cyan+',.12)';c.lineWidth=1;for(const r of [size*.78,size*1.14,size*1.48]){c.beginPath();c.ellipse(0,0,r,r*.56,-.22,0,Math.PI*2);c.stroke();}
    c.rotate(time*.08);for(let i=0;i<72;i++){const a=i*Math.PI/36,r=size*1.5;c.beginPath();c.strokeStyle='rgba('+cyan+','+(i%6===0?.38:.16)+')';c.moveTo(Math.cos(a)*r,Math.sin(a)*r*.56);c.lineTo(Math.cos(a)*(r+(i%6===0?7:3)),Math.sin(a)*(r+(i%6===0?7:3))*.56);c.stroke();}c.restore();
    const sheets=[];for(let i=0;i<100;i++){const a=i/100*Math.PI*2,flow=a+time*.13,beat=Math.sin(a*3-time*2.1)*.045+Math.exp(-Math.pow((time-pulse)*2.6,2))*.15,x=Math.cos(a)*size*(1+beat),y=Math.sin(2*a)*size*.34,z=Math.sin(a)*size*.24,tilt=flow*1.5;const center=project(x,y,z),corners=[[-5,-17],[5,-17],[5,17],[-5,17]].map(([u,v])=>project(x+u*Math.cos(tilt)-v*Math.sin(tilt)*.36,y+u*Math.sin(tilt)+v*Math.cos(tilt)*.36,z+v*.65));sheets.push({center,corners,hot:Math.sin(a-time*.7)>.78});}sheets.sort((a,b)=>a.center.z-b.center.z);
    for(const s of sheets){const alpha=.18+(s.center.z/size+.3)*.55,col=s.hot?orange:cyan;c.beginPath();s.corners.forEach((p,i)=>i?c.lineTo(p.x,p.y):c.moveTo(p.x,p.y));c.closePath();c.fillStyle='rgba('+col+','+(alpha*.23)+')';c.strokeStyle='rgba('+col+','+Math.min(.9,alpha+.2)+')';c.lineWidth=s.hot?1.4:.8;c.fill();c.stroke();}
    for(let i=0;i<6;i++){const a=time*(.11+i*.006)+i*Math.PI/3,p=project(Math.cos(a)*size*1.6,Math.sin(a)*size*.52,0);c.fillStyle='rgba('+cyan+',.75)';c.fillRect(p.x-1.5,p.y-1.5,3,3);}
    const ring=(time-pulse)*1.2;if(ring>=0&&ring<1){c.beginPath();c.ellipse(width/2,height/2,size*(.4+ring*1.4),size*(.25+ring*.7),-.2,0,Math.PI*2);c.strokeStyle='rgba('+orange+','+((1-ring)*.7)+')';c.stroke();}
  }
  function run(now){frame=0;if(dead||!visible||document.hidden||!motionAllowed())return;const interval=innerWidth<750?1000/30:1000/60;if(now-last>=interval){const dt=Math.min((now-last)/1000||.025,.06);last=now;time+=dt;vx+=(110*(tx-px)-17*vx)*dt;vy+=(110*(ty-py)-17*vy)*dt;px+=vx*dt;py+=vy*dt;render();}frame=requestAnimationFrame(run);}
  function play(){if(frame)cancelAnimationFrame(frame);frame=0;if(!dead&&visible&&!document.hidden&&motionAllowed()){last=performance.now();frame=requestAnimationFrame(run);}else render();}
  const resize=new ResizeObserver(()=>{width=stage.clientWidth;height=stage.clientHeight;const d=Math.min(devicePixelRatio||1,1.5);canvas.width=width*d;canvas.height=height*d;context?.setTransform(d,0,0,d,0,0);render();});resize.observe(stage);
  const intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;play();});intersection.observe(stage);
  stage.onpointermove=e=>{if(e.pointerType==='touch')return;const r=stage.getBoundingClientRect();tx=(e.clientX-r.left)/r.width-.5;ty=(e.clientY-r.top)/r.height-.5;};stage.onpointerleave=()=>{tx=ty=0;};stage.onclick=()=>{if(motionAllowed())pulse=time;};
  const theme=new MutationObserver(render);theme.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});document.addEventListener('visibilitychange',play);document.addEventListener('zero:motion',play);
  async function get(path){const controller=new AbortController();requests.add(controller);const timeout=setTimeout(()=>controller.abort(),15000);try{const r=await fetch('/api/'+path,{signal:controller.signal});if(!r.ok)throw Error();return await r.json();}finally{clearTimeout(timeout);requests.delete(controller);}}
  async function status(){const values=await Promise.allSettled([get('feeds/sources'),get('live/status')]);if(dead)return;const feeds=values[0].status==='fulfilled'?values[0].value:null,market=values[1].status==='fulfilled'?values[1].value:null;
    if(feeds){const enabled=feeds.sources.filter(s=>s.enabled),good=enabled.filter(s=>s.last_success&&!s.error).length;$('#signal-count',root).textContent=feeds.total.toLocaleString('zh-CN');$('#signal-sources',root).textContent=good+'/'+enabled.length;$('#signal-next',root).textContent=new Date(feeds.next_update*1000).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai'});panel.dataset.state=good===enabled.length?'ok':'partial';}
    $('#signal-state',root).textContent=!feeds?'状态暂不可用':feeds.collecting||market?.refreshing?'正在同步':(feeds.running&&market?.running?'自动同步已开启':'后台状态待确认');
  }
  status();const timer=setInterval(()=>{if(!document.hidden)status();},60000);play();return()=>{dead=true;clearInterval(timer);if(frame)cancelAnimationFrame(frame);requests.forEach(r=>r.abort());resize.disconnect();intersection.disconnect();theme.disconnect();document.removeEventListener('visibilitychange',play);document.removeEventListener('zero:motion',play);};
}
