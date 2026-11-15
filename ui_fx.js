/* 山河 V4.21 交互细节：按压回弹、数字滚动、骨架屏、人物卡翻面、卡片堆叠、手机底部抽屉。
   独立文件，只读页面，不改游戏状态。尊重“减少动态效果”系统设置。 */
(function(){
 'use strict';
 var RM=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
 var $=function(id){ return document.getElementById(id); };

 /* ---------- 07 数字滚动：顶栏银钱、年龄变化时数字滚过去 ---------- */
 var NUM=/-?\d[\d,]*(?:\.\d+)?/g;
 function nums(t){ return (t.match(NUM)||[]).map(function(x){ return parseFloat(x.replace(/,/g,'')); }); }
 function rollNum(el){
  var last=el.textContent, raf=0, wrote=null;
  new MutationObserver(function(){
   var now=el.textContent; if(now===wrote||now===last) return;
   var a=nums(last), b=nums(now), from=last; last=now;
   if(RM||!a.length||a.length!==b.length){ el.classList.remove('fx-roll'); void el.offsetWidth; el.classList.add('fx-roll'); return; }
   var same=true; for(var i=0;i<a.length;i++) if(a[i]!==b[i]) same=false; if(same) return;
   var tpl=now, dec=(now.match(NUM)||[]).map(function(x){ var d=x.split('.')[1]; return d?d.length:0; });
   cancelAnimationFrame(raf); var t0=performance.now(), D=520;
   (function step(t){
    var k=Math.min(1,(t-t0)/D), e=1-Math.pow(1-k,3), j=0;
    wrote=k>=1?now:tpl.replace(NUM,function(){ var v=a[j]+(b[j]-a[j])*e, s=v.toFixed(dec[j]); j++; return s; });
    if(k>=1) wrote=null;
    el.textContent=k>=1?now:wrote;
    if(k<1) raf=requestAnimationFrame(step);
   })(t0);
   el.classList.remove('fx-roll'); void el.offsetWidth; el.classList.add('fx-roll');
  }).observe(el,{childList:true,characterData:true,subtree:true});
 }

 /* ---------- 08 骨架屏：老照片没加载完时显示纸色流光 ---------- */
 var seen=typeof WeakSet!=='undefined'?new WeakSet():null, cache={};
 function bgUrl(el){ var m=(el.style.backgroundImage||'').match(/url\(["']?([^"')]+)["']?\)/) || (el.style.getPropertyValue('--ph')||'').match(/url\(["']?([^"')]+)["']?\)/); return m&&m[1]; }
 function skel(root){
  var list=(root||document).querySelectorAll('img, .pav.ph, .act-ph, .es-it, .ar-it, .evg-it, #pgHero');
  for(var i=0;i<list.length;i++){
   var el=list[i]; if(seen){ if(seen.has(el)) continue; seen.add(el); } else { if(el.__sk) continue; el.__sk=1; }
   if(el.tagName==='IMG'){
    if(el.complete&&el.naturalWidth) continue;
    el.classList.add('fx-sk');
    var done=function(){ this.classList.remove('fx-sk'); this.classList.add('fx-in'); };
    el.addEventListener('load',done,{once:true}); el.addEventListener('error',done,{once:true});
    continue;
   }
   var u=bgUrl(el); if(!u||cache[u]===1) continue;
   (function(el,u){
    el.classList.add('fx-sk');
    var im=new Image(); im.onload=im.onerror=function(){ cache[u]=1; el.classList.remove('fx-sk'); el.classList.add('fx-in'); };
    im.src=u;
   })(el,u);
  }
 }

 /* ---------- 09 人物卡翻面：打开人物档案时，肖像翻过去露出生平 ---------- */
 var lastPv=null;
 document.addEventListener('click',function(e){
  var c=e.target.closest&&e.target.closest('.who-card, .person, .net-item, [data-who], [data-np]');
  if(!c) return; var pv=c.querySelector('.pav'); if(pv) lastPv={bg:pv.style.backgroundImage, pos:pv.style.backgroundPosition, ch:pv.classList.contains('ph')?'':pv.textContent};
  if(c.classList.contains('who-card')&&!RM){ c.classList.remove('fx-tap'); void c.offsetWidth; c.classList.add('fx-tap'); }
 },true);
 function flipProfile(){
  var tag=$('dlgTag'), body=$('dlgBody'); if(!tag||!body||tag.textContent.trim()!=='人物档案') return;
  if(body.querySelector('.fx-flip')||!lastPv) return;
  var info=body.firstElementChild; if(!info||info.tagName==='BUTTON') return;
  var wrap=document.createElement('div'); wrap.className='fx-flip'+(lastPv.bg?'':' seal');
  var front=document.createElement('div'); front.className='fx-face fx-front';
  if(lastPv.bg){ front.style.backgroundImage=lastPv.bg; front.style.backgroundPosition=lastPv.pos||'50% 25%'; } else front.textContent=lastPv.ch||'';
  var back=document.createElement('div'); back.className='fx-face fx-back';
  var hint=document.createElement('span'); hint.className='fx-hint'; hint.textContent='点肖像翻面';
  body.insertBefore(wrap,info); back.appendChild(info); wrap.appendChild(front); wrap.appendChild(back); wrap.appendChild(hint);
  wrap.setAttribute('role','button'); wrap.setAttribute('tabindex','0'); wrap.setAttribute('aria-label','翻看生平');
  var flip=function(){ wrap.classList.toggle('on'); };
  wrap.addEventListener('click',flip); wrap.addEventListener('keydown',function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); flip(); } });
  setTimeout(function(){ wrap.classList.add('on'); }, RM?0:650);
 }

 /* ---------- 11 卡片堆叠：档案里的亲历大事先叠成一摞，点开铺平 ---------- */
 function stack(){
  var rows=document.querySelectorAll('.arc-strip .es-row');
  for(var i=0;i<rows.length;i++){
   var r=rows[i], n=r.children.length;
   if(n<3){ r.classList.remove('fx-stack'); continue; }
   if(r.__fxs===n) continue; r.__fxs=n;
   if(!r.classList.contains('fx-open')) r.classList.add('fx-stack');
   for(var k=0;k<n;k++){ r.children[k].style.setProperty('--k',k); r.children[k].style.setProperty('--rot',(k%2?1:-1)*Math.min(6,1.5+k)+'deg'); }
   r.style.setProperty('--n',Math.min(n,6)); r.setAttribute('data-n',n);
   if(!r.__fxb){ r.__fxb=1;
    r.addEventListener('click',function(e){
     if(this.classList.contains('fx-stack')){ e.preventDefault(); e.stopPropagation(); this.classList.remove('fx-stack'); this.classList.add('fx-open'); }
    },true);
   }
  }
 }

 /* ---------- 12 底部抽屉：手机上弹窗从底部滑出，带把手；纯信息弹窗可下拉收起 ---------- */
 function sheet(){
  var mask=$('mask'); if(!mask) return; var dlg=mask.querySelector('.dialog'); if(!dlg) return;
  if(!dlg.querySelector('.fx-grab')){ var g=document.createElement('i'); g.className='fx-grab'; g.setAttribute('aria-hidden','true'); dlg.insertBefore(g,dlg.firstChild); }
  var y0=0, dy=0, drag=false;
  function closer(){
   var bs=[].slice.call($('dlgBody').querySelectorAll('button')).filter(function(b){ return !b.disabled; });
   if(bs.length!==1) return null; var t=bs[0].textContent.trim();
   return /^(收起|关闭|知道了|好|返回)/.test(t)?bs[0]:null;
  }
  dlg.addEventListener('touchstart',function(e){
   if(window.innerWidth>760||dlg.scrollTop>0||!closer()) return; drag=true; y0=e.touches[0].clientY; dy=0; dlg.style.transition='none';
  },{passive:true});
  dlg.addEventListener('touchmove',function(e){ if(!drag) return; dy=Math.max(0,e.touches[0].clientY-y0); dlg.style.transform='translate3d(0,'+dy+'px,0)'; },{passive:true});
  dlg.addEventListener('touchend',function(){
   if(!drag) return; drag=false; dlg.style.transition=''; dlg.style.transform='';
   if(dy>110){ var b=closer(); if(b) b.click(); }
  });
 }

 /* ---------- 启动 ---------- */
 function boot(){
  ['hudCash','hudAge','hudJobs'].forEach(function(id){ var el=$(id); if(el) rollNum(el); });
  sheet();
  var pend=0;
  var mo=new MutationObserver(function(){ if(pend) return; pend=requestAnimationFrame(function(){ pend=0; skel(); stack(); flipProfile(); }); });
  var g=$('game')||document.body; mo.observe(g,{childList:true,subtree:true});
  var m=$('mask'); if(m) mo.observe(m,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
  skel(); stack();
  window.__FX={skel:skel,stack:stack,flip:flipProfile};
 }
 if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
