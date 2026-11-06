import {$,$$} from './shared.js';
import {motionAllowed} from './hud.js';

// The transparent 3D loops are prerendered; the light field uses real-time WebGL.
export function mountNocturne(root) {
  const hero=$('.zn-hero',root),orbit=$('.zn-orbit',root),prism=$('.zn-prism',root),slider=$('#nocturne-frame',root);
  const ox=orbit.getContext('2d'),px=prism.getContext('2d'),images=[new Image(),new Image()];
  let dead=false,visible=true,frame=0,x=.5,y=.5,scroll=0,raf=0,last=0,dirty=true;
  let gl=null,program=null,buffer=null,shaders=[],locations={};
  const canvas=$('.zn-shader',root);
  function paint(ctx,img,f){if(!ctx||!img.complete||!img.naturalWidth)return;ctx.clearRect(0,0,384,384);ctx.drawImage(img,f%6*192,Math.floor(f/6)*192,192,192,0,0,384,384);}
  function frames(){paint(ox,images[0],frame);paint(px,images[1],(frame+9)%48);root.dataset.frame=frame;slider.value=frame;$('.zn-hero-index',root).textContent=String(frame+1).padStart(2,'0')+' / 48';}
  images.forEach((img,i)=>{img.onload=()=>{if(!dead)frames();};img.src='/assets/'+(i?'data-prism':'rose-orbit')+'-atlas.webp';});
  const vertex='attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
  const fragment=`precision mediump float;
uniform vec2 r;uniform vec2 m;uniform float t;
void main(){vec2 uv=gl_FragCoord.xy/r;vec2 p=(uv-.5)*vec2(r.x/r.y,1.);p+=vec2((m.x-.5)*.08,(m.y-.5)*.05);float wave=sin(p.x*3.6+p.y*2.+t*.14)*.13;float ribbon=exp(-abs(p.y+.14+wave)*35.);float arc=exp(-abs(length((p-vec2(.44,-.04))*vec2(.7,1.))-.32)*95.);float halo=exp(-length(p-vec2(.50,-.04))*4.)*.16;float fine=pow(max(0.,sin(p.x*20.-p.y*6.+t*.1)),30.)*.05;float light=ribbon*.07+arc*.16+halo+fine*halo;gl_FragColor=vec4(vec3(.93,.59,.76)*light,light*.7);}`;
  function compile(type,source){const s=gl.createShader(type);shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('Shader compilation failed');return s;}
  function releaseGL(){if(!gl)return;if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);shaders.forEach(s=>gl.deleteShader(s));buffer=program=null;shaders=[];}
  try {
    gl=canvas.getContext('webgl',{alpha:true,antialias:false,powerPreference:'low-power'});if(!gl)throw Error('WebGL unavailable');
    program=gl.createProgram();gl.attachShader(program,compile(gl.VERTEX_SHADER,vertex));gl.attachShader(program,compile(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('Shader link failed');
    gl.useProgram(program);buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
    const pos=gl.getAttribLocation(program,'a');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);for(const n of ['r','m','t'])locations[n]=gl.getUniformLocation(program,n);root.dataset.shader='ready';
  }catch{releaseGL();canvas.hidden=true;root.dataset.shader='fallback';}
  function shader(t){if(!program||gl.isContextLost())return;const b=canvas.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,1.3),w=Math.round(b.width*d),h=Math.round(b.height*d);if(!w||!h)return;if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;gl.viewport(0,0,w,h);}gl.useProgram(program);gl.uniform2f(locations.r,w,h);gl.uniform2f(locations.m,x,y);gl.uniform1f(locations.t,motionAllowed()?t/1000:0);gl.drawArrays(gl.TRIANGLES,0,6);}
  function run(t){raf=0;if(dead)return;const active=motionAllowed()&&visible&&!document.hidden;if(dirty||(active&&t-last>=65)){if(dirty)frames();shader(t);dirty=false;last=t;}if(active&&program)raf=requestAnimationFrame(run);}
  function schedule(){dirty=true;if(!raf&&!dead)raf=requestAnimationFrame(run);}
  function scrub(){frame=((Math.round(x*29+scroll))%48+48)%48;schedule();}
  function pointer(e){if(!motionAllowed()||e.pointerType==='touch')return;const b=hero.getBoundingClientRect();x=Math.max(0,Math.min(1,(e.clientX-b.left)/b.width));y=Math.max(0,Math.min(1,(e.clientY-b.top)/b.height));scrub();}
  function wheel(e){if(!motionAllowed())return;scroll+=Math.sign(e.deltaY)*2;scrub();}
  function scrolling(){if(!motionAllowed())return;scroll=Math.round(-hero.getBoundingClientRect().top/15);scrub();}
  function manual(e){frame=Number(e.target.value);schedule();}
  function motion(){if(!motionAllowed()){$$('.zn-depth',root).forEach(el=>el.style.transform='');if(raf)cancelAnimationFrame(raf);raf=0;}schedule();}
  function loss(e){e.preventDefault();canvas.hidden=true;root.dataset.shader='fallback';releaseGL();}
  canvas.addEventListener('webglcontextlost',loss);hero.addEventListener('pointermove',pointer,{passive:true});hero.addEventListener('wheel',wheel,{passive:true});slider.addEventListener('input',manual);
  window.addEventListener('scroll',scrolling,{passive:true});document.addEventListener('zero:motion',motion);document.addEventListener('visibilitychange',motion);
  const tilt=[];
  $$('.zn-depth',root).forEach(el=>{const move=e=>{if(!motionAllowed()||e.pointerType==='touch')return;const b=el.getBoundingClientRect();el.style.transform='perspective(800px) rotateX('+((.5-(e.clientY-b.top)/b.height)*6)+'deg) rotateY('+(((e.clientX-b.left)/b.width-.5)*7)+'deg)';};const leave=()=>el.style.transform='';el.addEventListener('pointermove',move);el.addEventListener('pointerleave',leave);tilt.push([el,move,leave]);});
  const resize=new ResizeObserver(schedule);resize.observe(hero);const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible&&raf){cancelAnimationFrame(raf);raf=0;}if(visible)schedule();});observer.observe(hero);schedule();
  return()=>{dead=true;if(raf)cancelAnimationFrame(raf);resize.disconnect();observer.disconnect();hero.removeEventListener('pointermove',pointer);hero.removeEventListener('wheel',wheel);slider.removeEventListener('input',manual);canvas.removeEventListener('webglcontextlost',loss);window.removeEventListener('scroll',scrolling);document.removeEventListener('zero:motion',motion);document.removeEventListener('visibilitychange',motion);tilt.forEach(([el,move,leave])=>{el.removeEventListener('pointermove',move);el.removeEventListener('pointerleave',leave);});images.forEach(i=>i.onload=null);releaseGL();gl?.getExtension('WEBGL_lose_context')?.loseContext();};
}
