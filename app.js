(function(){
"use strict";
var doGovern; /* V4.16.1：跨段落共享 */
var renderRebel; /* V4.16.1 跨段落共享 */
var rebelAct; /* V4.16.1 跨段落共享 */
var powerAct; /* V4.16.1 跨段落共享 */
var renderPowers; /* V4.16.1 跨段落共享 */

var $=function(id){return document.getElementById(id);};
var NAMES=['王守备','李把总','张委员','刘道台','陈掌柜','赵主事','孙参将','周知府','吴道员','郑同知'];
function randName(){ return NAMES[Math.floor(Math.random()*NAMES.length)]; }
function clamp(n,lo,hi){lo=lo===undefined?0:lo;hi=hi===undefined?100:hi;return Math.max(lo,Math.min(hi,Math.round(n)));}
function rnd(a,b){return a+Math.random()*(b-a);}
function pick(a){return a[Math.floor(Math.random()*a.length)];}
var EXP_MAX=100; /* V4.18：AP_MAX 已移除 */

/* ================= V4.17：统一游戏时钟（日历核心） =================
   全游戏唯一的时间来源。s.cal.ord 为“自 1840-01-01 起的第几天”（1840-01-01 = 0）。
   年、月、日一律由序数推导；s.year 只作为旧系统的兼容镜像，由年末结算推进并与序数保持一致。 */
var CAL_START_YEAR=1840, CAL_END_YEAR=1972;
var CAL_MDAYS=[31,28,31,30,31,30,31,31,30,31,30,31];
var _calYearStart={};
function calIsLeap(y){ y=+y; return (y%4===0&&y%100!==0)||(y%400===0); }
function calMonthDays(y,m){ return (m===2&&calIsLeap(y))?29:CAL_MDAYS[m-1]; }
function calYearDays(y){ return calIsLeap(y)?366:365; }
function calYearStart(y){
 if(_calYearStart[y]!==undefined) return _calYearStart[y];
 var n=0, yy;
 if(y>=CAL_START_YEAR){ for(yy=CAL_START_YEAR;yy<y;yy++) n+=calYearDays(yy); }
 else { for(yy=y;yy<CAL_START_YEAR;yy++) n-=calYearDays(yy); }
 _calYearStart[y]=n; return n;
}
function calOrd(y,m,d){
 y=+y; m=+m||1; d=+d||1;
 var n=calYearStart(y);
 for(var mm=1;mm<m;mm++) n+=calMonthDays(y,mm);
 return n+(d-1);
}
function calFromOrd(n){
 n=Math.floor(+n);
 var y=CAL_START_YEAR+Math.floor(n/365.2425);
 while(calYearStart(y)>n) y--;
 while(calYearStart(y+1)<=n) y++;
 var r=n-calYearStart(y), m=1;
 while(r>=calMonthDays(y,m)){ r-=calMonthDays(y,m); m++; }
 return {y:y,m:m,d:r+1,ord:n};
}
function calFmt(o){ return o?(o.y+'年'+o.m+'月'+o.d+'日'):'—'; }
function calFmtOrd(n){ return calFmt(calFromOrd(n)); }
var CAL_END_ORD=calOrd(CAL_END_YEAR,12,31);

/* 时钟状态补齐与旧档迁移：没有日期的旧档迁移到“当年 1 月 1 日”。 */
function calEnsure(st){
 if(!st) return null;
 var y=Math.round(+st.year||CAL_START_YEAR);
 if(!st.cal||typeof st.cal!=='object'||typeof st.cal.ord!=='number'||!isFinite(st.cal.ord)){
  st.cal={ord:calOrd(y,1,1),lastSettledYear:y-1,finished:false};
 }else if(!(CLOCK&&CLOCK.settling)&&calFromOrd(st.cal.ord).y!==y){
  /* s.year 是旧系统读取的年份镜像；两者不一致时以 s.year 为准重新对齐到该年 1 月 1 日。 */
  st.cal.ord=calOrd(y,1,1);
 }
 if(typeof st.cal.lastSettledYear!=='number') st.cal.lastSettledYear=y-1;
 if('speedPref' in st.cal) delete st.cal.speedPref;   /* V4.18.6：不再有速度 */
 st.cal.finished=!!st.cal.finished;
 if(!st.cooldowns||typeof st.cooldowns!=='object'||Array.isArray(st.cooldowns)) st.cooldowns={};
 if(!Array.isArray(st.jobs)) st.jobs=[];
 if(typeof st.jobSeq!=='number') st.jobSeq=0;
 if(Object.prototype.hasOwnProperty.call(st,'ap')) delete st.ap; /* V4.18：行动点已彻底移除 */
 return st.cal;
}
function calTodayOrd(){ return (s&&s.cal&&typeof s.cal.ord==='number')?s.cal.ord:calOrd((s&&s.year)||CAL_START_YEAR,1,1); }
function calToday(){ return calFromOrd(calTodayOrd()); }
/* 事件日期是否已到（只比较日期，不关心年份是否相同）。 */
function calDue(y,m,d){ if(!s) return false; if(!s.cal) return true; return calOrd(y,m||1,d||1)<=s.cal.ord; }

/* ================= V4.18：行动冷却与持续行动（核心） =================
   s.cooldowns = {行动键: 可再次执行的日期序数}
   s.jobs = [{id,key,label,fx,start,end,data}]：持续行动，到期由每日处理自动结算且只结算一次。 */
var JOB_FX={};
/* V4.18 修复（V4.16.1 遗留）：gAdd / initPowers / rankTitleOf 原本只声明在 V3.0、V2.9 的嵌套段落里，
   V4.6、V4.9 等外层段落直接调用会抛 ReferenceError（例如文官点「办公」的具体选项）。这里在主作用域做代理。 */
function gAdd(k,v){ return window.__gAdd?window.__gAdd(k,v):undefined; }
function initPowers(){ return window.__initPowers?window.__initPowers():undefined; }
function rankTitleOf(){ return window.rankTitleOf?window.rankTitleOf():''; }  /* 持续行动完成时的效果：JOB_FX[名称](s, job) → 结果文字 */
function actFactor(){
 if(!s) return 1;
 var ability=((+s.skill||0)-40)/400;             /* 能力越高越快 */
 var rankF=Math.min(7,Math.max(0,+s.rank||0))*0.015; /* 职位越高，可调动的人手越多 */
 var top=(s.isThrone||s.isLeader)?0.05:0;
 var N=s.natl||{};
 var chaos=(50-(((+N.稳定||50)+(+N.秩序||50))/2))/200; /* 政局越乱越慢 */
 var f=1-ability-rankF-top+chaos;
 return Math.max(0.7,Math.min(1.35,f));
}
function actDays(base){ return Math.max(1,Math.round((+base||1)*actFactor())); }
function jobOf(key){
 if(!s||!Array.isArray(s.jobs)) return null;
 for(var i=0;i<s.jobs.length;i++){ if(s.jobs[i].key===key) return s.jobs[i]; }
 return null;
}
/* 返回 null 表示可执行；否则 {kind:'job'|'cool', days, until, label} */
function actBusy(key){
 if(!s) return null;
 calEnsure(s);
 var today=s.cal.ord, j=jobOf(key);
 if(j) return {kind:'job',days:Math.max(0,j.end-today),until:j.end,label:j.label};
 var r=s.cooldowns[key];
 if(typeof r==='number'&&r>today) return {kind:'cool',days:r-today,until:r};
 return null;
}
function actBusyText(b){
 if(!b) return '';
 if(b.kind==='job') return '进行中 · 预计 '+calFmtOrd(b.until)+' 完成（还需 '+b.days+' 天）';
 return '冷却中 · 还需 '+b.days+' 天（'+calFmtOrd(b.until)+' 可再行）';
}
/* 处理函数里的硬校验：界面禁用只是提示，真正的拦截在这里。 */
function actGate(key,label){
 if(!s) return false;
 calEnsure(s);
 if(s.dead){ calToast('人已不在，诸事皆休。'); return false; }
 if(s.cal.finished){ calToast('历史已经走到 1972 年末，本局已经结算。'); return false; }
 var b=actBusy(key);
 if(b){ calToast((label?'「'+label+'」':'此事')+actBusyText(b)); return false; }
 return true;
}
/* 开始冷却：返回实际冷却天数（已按能力/职位/政局修正）。 */
function actCool(key,baseDays){
 if(!s) return 0;
 calEnsure(s);
 var n=actDays(baseDays);
 s.cooldowns[key]=s.cal.ord+n;
 return n;
}
/* 开始持续行动：到期自动结算 fx；结算后可附加 cool 天的冷却。 */
function jobStart(key,opt){
 if(!s) return null;
 calEnsure(s);
 opt=opt||{};
 var n=actDays(opt.days||30);
 s.jobSeq=(s.jobSeq||0)+1;
 var j={id:s.jobSeq,key:key,label:opt.label||key,fx:opt.fx||'',start:s.cal.ord,end:s.cal.ord+n,data:opt.data||{}};
 s.jobs.push(j);
 s.cooldowns[key]=j.end+Math.max(0,Math.round(opt.cool||0));
 return j;
}
/* 每日：结算到期的持续行动。先移出队列再结算，保证只结算一次。 */
function jobsProcess(){
 if(!s||!Array.isArray(s.jobs)||!s.jobs.length) return 0;
 var today=s.cal.ord, done=0;
 for(var i=0;i<s.jobs.length;){
  var j=s.jobs[i];
  if(j.end<=today){
   s.jobs.splice(i,1);
   var text='';
   try{ var f=JOB_FX[j.fx]; text=f?(f(s,j)||''):''; }catch(e){ text=''; }
   ['skill','fame','power','trust'].forEach(function(k){ if(typeof s[k]==='number') s[k]=clamp(s[k]); });
   try{ log('【完成】'+j.label+'（'+calFmtOrd(j.start)+'起，历时 '+(j.end-j.start)+' 天）'+(text?'：'+text:'。')); }catch(e){}
   done++;
  }else i++;
 }
 return done;
}
/* 历史事件日期：[月,日,是否为近似]。确定的用史实日期；只知年份/月份的取合理月份（第三项为 1）。 */
var EVENT_DATES={
 opium:[6,28],          /* 1840-06 英军封锁珠江口，战事正式展开 */
 nanjing42:[8,29],      /* 1842-08-29 签订《南京条约》 */
 taiping:[1,11],        /* 1851-01-11 金田起义 */
 secondopium56:[10,8],  /* 1856-10-08 亚罗号事件 */
 ziqiang:[1,20],        /* 1861-01-20 设立总理各国事务衙门 */
 taipingfall64:[7,19],  /* 1864-07-19 天京陷落 */
 saihai75:[5,3,1],      /* 1875 年春，左宗棠受命督办新疆军务（近似） */
 sinoFrench84:[8,23],   /* 1884-08-23 马江海战 */
 jiawu:[7,25],          /* 1894-07-25 丰岛海战 */
 wuxu:[6,11],           /* 1898-06-11 《明定国是诏》 */
 boxer:[6,21],          /* 1900-06-21 清廷宣战诏书 */
 boxer01:[9,7],         /* 1901-09-07 《辛丑条约》 */
 abolish_exam05:[9,2],  /* 1905-09-02 诏停科举 */
 xinhai:[10,10],        /* 1911-10-10 武昌起义 */
 minguo:[1,1],          /* 1912-01-01 中华民国成立 */
 huguo15:[12,25],       /* 1915-12-25 云南宣布独立，护国战争爆发 */
 warlord16:[6,6],       /* 1916-06-06 袁世凯去世 */
 may4:[5,4],            /* 1919-05-04 */
 beifa:[7,9],           /* 1926-07-09 北伐誓师 */
 split:[4,12],          /* 1927-04-12 */
 northeast28:[12,29],   /* 1928-12-29 东北易帜 */
 '918':[9,18],          /* 1931-09-18 */
 changzheng:[10,10],    /* 1934-10 中央红军开始长征 */
 zunyi35:[1,15],        /* 1935-01-15 遵义会议 */
 xian:[12,12],          /* 1936-12-12 */
 q7:[7,7],              /* 1937-07-07 */
 wuhan:[6,11,1],        /* 1938 年 6 月武汉会战外围作战展开（近似） */
 baituan:[8,20],        /* 1940-08-20 */
 henan42:[10,1,1],      /* 1942 年秋河南灾荒全面暴露（近似） */
 '1945':[8,15],         /* 1945-08-15 日本宣布投降 */
 civilwar46:[6,26],     /* 1946-06-26 中原突围，全面内战爆发 */
 constitution47:[1,1],  /* 1947-01-01 公布《中华民国宪法》 */
 campaign48:[9,12],     /* 1948-09-12 辽沈战役开始 */
 founding49:[10,1],     /* 1949-10-01 */
 korean50:[10,19],      /* 1950-10-19 志愿军入朝 */
 plan53:[1,1],          /* 1953 年起实施第一个五年计划 */
 transformation56:[12,1,1], /* 1956 年底社会主义改造基本完成（近似） */
 greatleap58:[5,5],     /* 1958-05-05 八大二次会议 */
 leap58:[8,29],         /* 1958-08-29 北戴河会议人民公社决议 */
 cultural66:[5,16],     /* 1966-05-16 */
 un71:[10,25]           /* 1971-10-25 联大第2758号决议 */
};
/* 战后替代路线事件沿用同年真实事件的日期，保证“分支”与“史实”在同一时间点出现。 */
var ALT_EVENT_DATES={1949:[10,1],1950:[10,19],1953:[1,1],1956:[12,1],1966:[5,16],1971:[10,25]};
function evDateOf(ev){
 if(!ev) return [1,1];
 if(ev.m&&ev.d) return [ev.m,ev.d];
 var t=EVENT_DATES[ev.id];
 return t?[t[0],t[1]]:[1,1];
}
function evDue(ev){ var d=evDateOf(ev); return calDue(ev.y,d[0],d[1]); }
var ACT_HINT_TEXT='每件事都要花时间：按钮上标着大约天数；确认后日历随即推进。';
var FAC_ACT_NAME={organize:'经营派系',contest:'竞争职位',reconcile:'协商和解',split:'推动分裂',succession:'权力更迭'};
var FAC_ACT_DAYS={organize:30,contest:90,reconcile:60,split:180,succession:180};
/* 轻提示：冷却拦截、自动暂停等都用它，不依赖存档卡是否可见。 */
var _calToastTimer=null;
function calToast(t){
 try{
  var el=document.getElementById('calToast');
  if(!el){ el=document.createElement('div'); el.id='calToast'; el.className='cal-toast'; document.body.appendChild(el); }
  el.textContent=t; el.classList.add('on');
  if(_calToastTimer) clearTimeout(_calToastTimer);
  _calToastTimer=setTimeout(function(){ try{ el.classList.remove('on'); }catch(e){} },2600);
 }catch(e){}
}

/* ================= V4.18.5：数值基础（货币、收支、兵额、国势参考值） =================
   内部记账单位：两（以 1840 年代库平银的购买力为准，“实值两”）。
   界面按日期换算成当时的通行货币显示：
     1840–1911 银两（1895 年后随物价上涨，1911 年约 1.5 倍）；1912–1935.10 银元；
     1935.11–1948.8 法币（抗战起按物价指数通胀，近似值）；1948.8–1949.5 金圆券；1949.5 起人民币（按 1955 年新币折算）。
   所有收入、开支、礼金、借贷都按“实值两”计算，因此跨年代的数值可比；只有显示数字随币制与通胀变化。 */
var CUR_FABI=[[1935.84,1],[1937.5,1],[1938.5,1.4],[1939.5,2.3],[1940.5,5],[1941.5,13],[1942.5,40],[1943.5,125],[1944.5,430],[1945.6,1800],[1946.5,5000],[1947.5,30000],[1948.0,100000],[1948.63,4000000]];
var CUR_GY=[[1948.63,1],[1948.85,1.4],[1949.0,20],[1949.25,1500],[1949.41,100000]];
function curInterp(pts,y){
 if(y<=pts[0][0]) return pts[0][1];
 for(var i=1;i<pts.length;i++){
  if(y<=pts[i][0]){ var a=pts[i-1],b=pts[i],t=(y-a[0])/(b[0]-a[0]); return Math.exp(Math.log(a[1])+(Math.log(b[1])-Math.log(a[1]))*t); }
 }
 return pts[pts.length-1][1];
}
function curOf(ord){
 var o=calFromOrd(typeof ord==='number'?ord:calTodayOrd());
 var y=o.y+(o.m-1)/12+(o.d-1)/365;
 if(y<1895) return {n:'银两',u:'两',k:1};
 if(y<1912) return {n:'银两',u:'两',k:1+0.5*(y-1895)/17};
 if(y<1935.84) return {n:'银元',u:'元',k:2.1+0.9*(y-1912)/23.84};
 if(y<1948.63) return {n:'法币',u:'元',k:3*curInterp(CUR_FABI,y)};
 if(y<1949.41) return {n:'金圆券',u:'元',k:4*curInterp(CUR_GY,y)};
 return {n:'人民币',u:'元',k:10};
}
function fmtNum(n,dec){ return n.toFixed(dec).replace(/\.0+$/,'').replace(/(\.\d*?)0+$/,'$1'); }
/* 金额显示：M(实值两[, 日期序数]) → “4 两 2 钱” / “12.5 元” / “3.4 万元” */
function M(v,ord){
 v=+v||0;
 var neg=v<0; v=Math.abs(v);
 var c=curOf(ord), n=v*c.k, t;
 if(c.u==='两'){
  if(n>=1e8) t=fmtNum(n/1e8,2)+' 亿两';
  else if(n>=1e4) t=fmtNum(n/1e4,n>=1e6?0:1)+' 万两';
  else if(n>=100) t=Math.round(n)+' 两';
  else if(n>=1){ var l=Math.floor(n+1e-9), q=Math.round((n-l)*10); if(q===10){l++;q=0;} t=l+' 两'+(q?' '+q+' 钱':''); }
  else { var qq=Math.floor(n*10+1e-9), f=Math.round((n*10-qq)*10); if(f===10){qq++;f=0;} t=(qq?qq+' 钱':'')+(f?(qq?' ':'')+f+' 分':'')||'0'; if(!qq&&!f) t='不足 1 分'; }
 }else{
  if(n>=1e8) t=fmtNum(n/1e8,2)+' 亿元';
  else if(n>=1e4) t=fmtNum(n/1e4,n>=1e6?0:1)+' 万元';
  else if(n>=100) t=Math.round(n)+' 元';
  else t=fmtNum(n,1)+' 元';
 }
 if(v===0) t=(c.u==='两')?'0 两':'0 元';
 return (neg?'-':'')+t;
}
function curName(ord){ var c=curOf(ord); return c.n+(c.n==='人民币'?'（按1955年新币折算）':''); }

/* ---- 个人收入（实值两/月）：按身份线 × 品级；各阵营、年代不同 ---- */
var LIVE_LINE={soldier:'mil',officer:'mil',official:'civ',merchant:'biz',student:'stu',activist:'pol'};
var PAY_TAB={
 qing:{ mil:[[['饷银',1.5],['饷米折银',0.5]],[['俸银',1.5],['养廉',7.5]],[['俸银',2],['养廉',10]],[['俸银',3],['养廉',40]],[['俸银',5],['养廉',125]],[['俸银',7],['养廉',165]],[['俸银',13],['养廉',1100]],[['俸银',15],['恩俸与冰炭敬',200]]],
        civ:[[['工食银',0.5],['规费',2.5]],[['俸银',3.3],['养廉',7]],[['俸银',3.8],['养廉',85]],[['俸银',8.8],['养廉',190]],[['俸银',8.8],['养廉',250]],[['俸银',12.9],['养廉',580]],[['俸银',14.2],['养廉',1100]],[['俸银',15],['恩俸与冰炭敬',200]]] },
 beiyang:{ mil:[2.8,20,36,120,260,400,600,1000], civ:[8,30,60,120,240,400,600,1000] },
 kmt:{ mil:[3.3,17,30,80,150,230,300,400], civ:[5,20,40,100,140,200,270,330] },
 prc:{ mil:[3.5,5,7,10,15,25,40,60], civ:[3.5,5,7,10,15,25,40,60] },
 cpcSupply:[0.3,0.5,0.7,1,1.5,2,3,4],
 biz:[1.5,5,12,30,60,100,160,250],
 stu:[0.6,1,8,25,40,60,100,150],
 pol:[0.5,1.5,4,8,15,25,40,60]
};
/* 衙署开支：清代养廉银要支付幕友束脩与衙门公费（文官约六成）、营务公费（武官约三成），这部分不是个人可支配收入 */
var YAMEN_SHARE={civ:0.6,mil:0.3};
/* 抗战与内战时期，领薪水的人实际收入大幅缩水（按实值计） */
function wageErosion(y){
 if(y<1938) return 1; if(y<1940) return 0.8; if(y<1942) return 0.5; if(y<1944) return 0.28; if(y<1946) return 0.22; if(y<1948) return 0.3; if(y<1950) return 0.2; return 1;
}
function livePayItems(x){
 if(!x) return [];
 var R=Math.max(0,Math.min(7,x.rank||0)), y=x.year, line=LIVE_LINE[x.role]||'civ', out=[];
 if(x.isThrone){ return [['内务府供奉',3000]]; }
 if(x.isLeader){ return [['公费特支与俸给',600]]; }
 if(x.pendingFaction&&x.faction==='civil'&&R===0&&line!=='biz'&&line!=='stu'){ /* 尚未加入本阵营，靠零工 */ }
 var fac=x.faction;
 if(fac==='cpc'||(y>=1950&&(fac==='local'||fac==='civil')&&(line==='mil'||line==='civ'))){
  if(fac==='cpc'&&y<1956){ out.push(['供给制津贴',PAY_TAB.cpcSupply[R]]); }
  else { var pt=PAY_TAB.prc[line==='mil'?'mil':'civ']; out.push([line==='mil'?'军饷（薪金制）':'工资（行政级别）',pt[R]]); }
  return out;
 }
 if(line==='mil'||line==='civ'){
  var era=(fac==='qing'||(fac==='local'&&y<1912)||(fac==='civil'&&y<1912))?'qing':(y<1928?'beiyang':(y<1950?'kmt':'prc'));
  if(fac==='civil'&&line==='civ'){ out.push(['薪俸',PAY_TAB.stu[R]*wageErosion(y)]); return out; }
  var tab=PAY_TAB[era][line];
  if(era==='qing'){ tab[R].forEach(function(it){ out.push([it[0],it[1]]); }); }
  else { var e=wageErosion(y); out.push([line==='mil'?'军饷':'薪俸',tab[R]*e]); }
  return out;
 }
 if(line==='biz') return [['铺面进项',PAY_TAB.biz[R]]];
 if(line==='stu') return [[R<=1?'学堂膏火/抄写':'薪俸',PAY_TAB.stu[R]*(R>=2?wageErosion(y):1)]];
 return [['组织津贴与稿费',PAY_TAB.pol[R]]];
}
/* 家口：22 岁成家，24 岁起约每三年添一口，最多三个孩子；50 岁后子女陆续自立 */
function liveHousehold(x){
 var age=(x.year||1840)-(x.birth||1820), n=1;
 if(age>=22) n++;
 if(age>=24) n+=Math.min(3,1+Math.floor((age-24)/3));
 if(age>=50) n-=Math.min(3,Math.floor((age-47)/3));
 return Math.max(1,Math.min(5,n));
}
var REGION_COST={'江浙':1.15,'直隶':1.1,'两广':1.1,'湘鄂':1.0,'四川':0.9,'关外':1.0};
function liveCostItems(x){
 if(!x) return [];
 var R=Math.max(0,Math.min(7,x.rank||0)), n=liveHousehold(x), rf=REGION_COST[x.region]||1, out=[];
 if(x.isThrone){ return [['宫廷用度',2500]]; }
 var supply=(x.faction==='cpc'&&x.year<1956);          /* 供给制：本人吃穿由组织供给 */
 var barracks=(LIVE_LINE[x.role]==='mil'&&R===0);       /* 兵丁住营房、吃大锅饭 */
 var food=0.55*(1+0.25*R)*(supply?Math.max(0,n-1):(barracks?n-0.6:n));
 out.push(['口粮',food*rf]);
 var house=[0.15,0.4,1.2,3,6,10,18,30][R]*rf;
 if(!supply&&!barracks) out.push(['房租居所',house]);
 out.push(['衣物柴炭杂用',0.25*(supply?Math.max(0.5,n-1):n)*(1+0.3*R)]);
 var soc=[0,0.1,0.8,3,8,15,30,60][R]; if(x.isLeader) soc=80;
 if(soc) out.push(['应酬人情',soc]);
 var serv=[0,0,0,2,5,10,20,40][R]; if(x.isLeader) serv=40;
 if(serv&&!supply) out.push(['仆役车马',serv]);
 var yl=0; livePayItems(x).forEach(function(p){ if(p[0]==='养廉') yl+=p[1]; });
 var ln=LIVE_LINE[x.role]==='mil'?'mil':'civ';
 if(yl) out.push([ln==='civ'?'幕友束脩与衙署公费':'营务公费',yl*YAMEN_SHARE[ln]]);
 return out;
}
function sumItems(a){ var t=0; a.forEach(function(i){ t+=+i[1]||0; }); return t; }

/* ---- 编制兵额（按品级）：把总约百人、千总二三百、管带一营约五百、镇/师约万人 ---- */
var UNIT_EST=[12,100,250,600,5000,12000,40000,150000];
/* 打点、礼金（按对方/上级的品级，实值两） */
var GIFT_BY_LV=[0.5,2,6,15,40,100,250,600];
function giftCost(lv){ lv=Math.max(0,Math.min(7,Math.round(+lv||0))); return GIFT_BY_LV[lv]; }
/* 公费（职位可支配的公款，实值两/月） */
var FUND_MONTH=[0,3,10,30,200,600,2000,8000];

/* ---- 国势参考值（插值） ---- */
var REF_POP=[[1840,4.12],[1850,4.30],[1864,3.80],[1873,3.58],[1890,3.80],[1900,4.00],[1911,4.10],[1920,4.30],[1930,4.50],[1937,4.80],[1945,4.80],[1949,5.42],[1953,5.88],[1957,6.47],[1960,6.62],[1962,6.73],[1964,7.05],[1966,7.45],[1970,8.30],[1972,8.72]];  /* 亿人 */
var REF_REV=[[1840,4000],[1850,4200],[1860,5000],[1870,6000],[1885,7700],[1894,8100],[1900,8800],[1908,23000],[1911,30000],[1916,19500],[1925,20000],[1931,22700],[1936,40000],[1940,15000],[1945,15000],[1948,12000],[1950,65000],[1952,184000],[1957,310000],[1960,572000],[1962,313000],[1965,473000],[1970,663000],[1972,766000]]; /* 万两（实值）/年 */
var REF_ARMY=[[1840,80],[1855,100],[1865,110],[1875,90],[1895,85],[1905,70],[1911,60],[1916,100],[1922,140],[1928,220],[1933,200],[1937,200],[1941,380],[1945,560],[1948,645],[1950,550],[1953,420],[1958,240],[1965,300],[1969,610],[1972,600]]; /* 万人：全国常备武装（各方合计，估算） */
function refAt(tab,y){
 if(y<=tab[0][0]) return tab[0][1];
 for(var i=1;i<tab.length;i++){ if(y<=tab[i][0]){ var a=tab[i-1],b=tab[i]; return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]); } }
 return tab[tab.length-1][1];
}
function fmtMen(n){ n=Math.max(0,Math.round(+n||0)); if(n>=10000) return fmtNum(n/10000,n>=100000?0:1)+' 万人'; if(n>=1000) return (Math.round(n/100)*100)+' 人'; return n+' 人'; }
/* 某省驻军：全国兵额 ÷ 省数 × 本地兵力指数，再按控制方修正（日占区为日军与伪军合计） */
function garrisonOf(ctrl,str,y){
 y=y||((s&&s.year)||1840);
 var tot=refAt(REF_ARMY,y)*10000, per=tot/26;
 var f=Math.max(0.3,(+str||45)/45);
 if(ctrl==='japan') per=y>=1937?70000:20000;
 return Math.round(per*f/100)*100;
}

/* ================= 阵营 ================= */
var FAC={
 qing:{name:'大清帝国',min:1840,color:'#8a8272',
  ladder:['兵丁 / 书吏','把总 / 县丞','千总 / 知县','参将 / 知府','总兵 / 道员','提督 / 布政使','巡抚 / 总督','军机大臣']},
 beiyang:{name:'北洋政府',min:1912,color:'#6b7a8f',
  ladder:['士兵 / 科员','排长 / 股长','连长 / 科长','营团长 / 处长','旅师长 / 司长','军长 / 督军','巡阅使 / 内阁要员','北洋最高领袖']},
 kmt:{name:'国民党 / 南京国民政府',min:1924,color:'#496076',
  ladder:['基层党员','干事','科长','县党部负责人 / 团长','处长 / 师长','厅长 / 军长','中央委员 / 集团军总司令','政府核心']},
 cpc:{name:'中国共产党',min:1921,color:'#a23a2c',
  ladder:['普通党员','支部干部','县级干部','地委干部 / 团级指挥员','省委干部 / 师级干部','中央委员','中央领导人','最高领导人']},
 local:{name:'地方军政势力',min:1840,color:'#b08d55',
  ladder:['团练 / 帮众','哨官 / 掌柜','营官 / 乡绅','团总 / 县长','旅长 / 行政专员','师长 / 省府委员','军长 / 省主席','地方实力派领袖']},
 civil:{name:'民间社会 / 独立人士',min:1840,color:'#7d8b76',
  ladder:['普通民众','学徒 / 学生','教员 / 记者 / 商人','校长 / 主编 / 商会理事','地方知名人士','社会组织负责人','全国知名人士','时代影响者']}
};

/* ================= 结社 / 会党 ================= */
var CLUBS={
 none:{name:'未入会',min:0,fee:0,desc:'单打独斗，无靠山，也无牵连。'},
 qingbang:{name:'青帮',min:1840,fee:2,desc:'漕运码头上的帮会。讲辈分、讲义气，也讲规矩；一句话能办成官面上办不成的事。'},
 shanghui:{name:'商会',min:1840,fee:8,desc:'绸缎、票号、洋行凑起来的圈子。钱能开口，也能替人说话。'},
 xingzhong:{name:'兴中会',min:1894,fee:2,desc:'孙中山在檀香山立的第一面旗。人少，胆子大，被官府视为乱党。'},
 baohuang:{name:'保皇会',min:1899,fee:2,desc:'康梁一派。保皇上、行立宪，在海外华侨里募款。'},
 guangfu:{name:'光复会',min:1904,fee:2,desc:'江浙的革命团社。办报、联络会党，也做暗杀。'},
 tongmeng:{name:'同盟会',min:1905,fee:2,desc:'东京成立的全国性革命组织，孙中山为总理。“驱除鞑虏，恢复中华”。'}
};

/* ================= 直属上级（按阵营 × 身份） ================= */
var SUP={
 qing:{
  soldier:{t:'把总',n:'王守备',d:'四十来岁的绿营把总，抽旱烟，最关心兵饷几时到、点名时人够不够。'},
  officer:{t:'营官',n:'李标统',d:'营里的实权人物。湘淮军起家，肯提拔自己人，也怕手下人做大。'},
  official:{t:'知县',n:'陈墨林',d:'科举出身的老州县，理词讼、催钱粮，对上官客气，对下民严。'},
  student:{t:'山长',n:'周勉之',d:'书院山长，讲经史，也偷偷看《海国图志》。'},
  merchant:{t:'票号掌柜',n:'赵德昌',d:'日升昌的老掌柜，账目一清二楚，人情也一清二楚。'},
  activist:{t:'会党头目',n:'刘三',d:'码头上说话算数的人，讲究“义气”二字，也讲究价钱。'}
 },
 beiyang:{
  soldier:{t:'班长',n:'孙班长',d:'北洋新军里带一个班的老人，枪法准，话不多。'},
  officer:{t:'营长',n:'马营长',d:'北洋新军出身，讲操典、讲装备，打心底看不上旧军。'},
  official:{t:'县长',n:'吴知事',d:'北洋县知事，换过三个都督，位置一直没动。'},
  student:{t:'校长',n:'黄校长',d:'新式学堂的校长，留日回来，讲“教育救国”。'},
  merchant:{t:'银行买办',n:'沈买办',d:'替洋行做事的买办，消息比官厅还灵。'},
  activist:{t:'报馆主笔',n:'郁主笔',d:'报纸主笔，笔头子硬，封过两回馆。'}
 },
 kmt:{
  soldier:{t:'班长',n:'何班长',d:'黄埔出身的班长，一口一个“总理遗训”。'},
  officer:{t:'团长',n:'郑团长',d:'中央军嫡系团长，打过硬仗，看重服从与战功。'},
  official:{t:'县长',n:'林县长',d:'江苏省的县长，办公桌上有《建国大纲》，抽屉里有账本。'},
  student:{t:'训导主任',n:'钱主任',d:'学校的训导主任，管纪律，也管学生看什么书。'},
  merchant:{t:'实业经理',n:'王经理',d:'纱厂经理，跟政府打交道是一把好手。'},
  activist:{t:'党部干事',n:'邹干事',d:'县党部干事，管宣传、发展党员、盯着可疑的人。'}
 },
 cpc:{
  soldier:{t:'班长',n:'赵班长',d:'老兵，1934 年跟着队伍走出来，脚上有冻伤。'},
  officer:{t:'连长',n:'石连长',d:'连指导员出身，打仗前先讲形势，打完再讲教训。'},
  official:{t:'区长',n:'刘区长',d:'边区的区长，减租减息、组织民兵，事无巨细都要管。'},
  student:{t:'教员',n:'艾教员',d:'识字班的教员，白天教书，晚上开会。'},
  merchant:{t:'合作社主任',n:'孟主任',d:'合作社主任，管盐、布、药材，也管情报。'},
  activist:{t:'交通员',n:'小周',d:'跑交通的，送信、带路、掩护过人，从不问信里写了什么。'}
 },
 local:{
  soldier:{t:'哨官',n:'胡哨官',d:'团练哨官，手底下五十号人，枪是各人自带的。'},
  officer:{t:'营官',n:'程营官',d:'地方军里的营官，认人不认旗，谁给饷听谁的。'},
  official:{t:'县知事',n:'宋知事',d:'地方推出来的知事，本乡本土，说话算数。'},
  student:{t:'书院教习',n:'范教习',d:'书院教习，教四书，也教算学。'},
  merchant:{t:'商会会长',n:'崔会长',d:'商会会长，管着本地的盐、米、当铺。'},
  activist:{t:'乡董',n:'高乡董',d:'乡里的董事，修桥铺路、调解械斗，都由他出面。'}
 },
 civil:{
  soldier:{t:'团丁头目',n:'贺把头',d:'民团的小头目，护商护村，谁出钱护谁。'},
  officer:{t:'团总',n:'巩团总',d:'地方民团团总，枪比县里还多。'},
  official:{t:'县衙书吏',n:'葛书吏',d:'县衙里办文案的老书吏，公文怎么写他最清楚。'},
  student:{t:'报社编辑',n:'闻编辑',d:'报馆编辑，改稿子时最爱删形容词。'},
  merchant:{t:'铺面老板',n:'袁老板',d:'街面上开杂货铺的老板，货源、赊账、人情都归他管。'},
  activist:{t:'学界前辈',n:'吕先生',d:'学界前辈，办过学堂，坐过牢，说话慢但有人听。'}
 }
};

/* ================= 人物 ================= */
var PEOPLE={
 qing:[
  {n:'道光帝',y:[1820,1850],cl:'皇权',st:'守成',d:'清宣宗，鸦片战争时期在位。',rank:6},
  {n:'林则徐',y:[1838,1850],cl:'禁烟派',st:'强硬',d:'主持虎门销烟，主张严禁鸦片。',rank:2},
  {n:'琦善',y:[1838,1854],cl:'主和派',st:'妥协',d:'鸦片战争期间主持对英交涉。',rank:2},
  {n:'咸丰帝',y:[1850,1861],cl:'皇权',st:'摇摆',d:'在位期间爆发太平天国与第二次鸦片战争。',rank:6},
  {n:'曾国藩',y:[1852,1872],cl:'湘系',st:'稳健',d:'湘军创建者。他将团练分为保甲与练勇，建成兵为将有的湘军。',rank:3},
  {n:'奕訢',y:[1853,1898],cl:'洋务派',st:'开明',d:'恭亲王，长期主持总理衙门。',rank:4},
  {n:'慈禧',y:[1861,1908],cl:'后党',st:'权谋',d:'晚清实际执政者。',rank:7},
  {n:'李鸿章',y:[1862,1901],cl:'淮系',st:'务实',d:'淮军与北洋水师缔造者。',rank:3},
  {n:'左宗棠',y:[1860,1885],cl:'湘系',st:'强硬',d:'率军收复新疆。',rank:3},
  {n:'张之洞',y:[1884,1909],cl:'洋务派',st:'开明',d:'创办汉阳铁厂、自强学堂。',rank:3},
  {n:'光绪帝',y:[1875,1908],cl:'帝党',st:'维新',d:'支持戊戌变法，实权有限。',rank:5},
  {n:'袁世凯',y:[1895,1911],cl:'北洋系',st:'权谋',d:'北洋新军统帅。戊戌变法期间，光绪曾召见他试图掌握军权。',rank:4},
  {n:'载沣',y:[1908,1911],cl:'皇族',st:'保守',d:'清末摄政王。',rank:6}
 ],
 beiyang:[
  {n:'袁世凯',y:[1912,1916],cl:'北洋核心',st:'权谋',d:'北洋领袖。南北议和中，革命党许诺事成后推举他为总统。',rank:5},
  {n:'段祺瑞',y:[1912,1926],cl:'皖系',st:'强硬',d:'皖系首领，多次出任国务总理。',rank:4},
  {n:'冯国璋',y:[1912,1919],cl:'直系',st:'稳健',d:'直系重要人物，曾任代理大总统。',rank:3},
  {n:'曹锟',y:[1916,1924],cl:'直系',st:'贪婪',d:'直系首领，贿选当上大总统。',rank:4},
  {n:'吴佩孚',y:[1918,1927],cl:'直系',st:'强硬',d:'直系名将。北伐时是国民革命军第一个打击目标。',rank:3},
  {n:'张作霖',y:[1916,1928],cl:'奉系',st:'枭雄',d:'奉系首领，东北王。',rank:5},
  {n:'孙传芳',y:[1924,1927],cl:'直系',st:'务实',d:'五省联军总司令。',rank:3}
 ],
 kmt:[
  {n:'孙中山',y:[1894,1925],cl:'元老',st:'理想',d:'国民党创始人，三民主义倡导者。',rank:5},
  {n:'蒋介石',y:[1924,1945],cl:'黄埔系',st:'权谋',d:'黄埔军校校长，北伐时任国民革命军总司令。',rank:4},
  {n:'汪精卫',y:[1924,1940],cl:'改组派',st:'摇摆',d:'国民党重要政治人物，后投日。',rank:4},
  {n:'李宗仁',y:[1926,1945],cl:'桂系',st:'务实',d:'桂系领袖，台儿庄战役指挥者。',rank:3},
  {n:'何应钦',y:[1926,1945],cl:'黄埔系',st:'圆滑',d:'军政部长。',rank:3},
  {n:'陈诚',y:[1928,1945],cl:'土木系',st:'忠诚',d:'蒋介石亲信，土木系核心。',rank:4},
  {n:'白崇禧',y:[1926,1945],cl:'桂系',st:'精明',d:'桂系名将，有“小诸葛”之称。',rank:3},
  {n:'戴笠',y:[1932,1945],cl:'军统',st:'阴狠',d:'军统负责人。',rank:4}
 ],
 cpc:[
  {n:'陈独秀',y:[1921,1927],cl:'早期领导',st:'激进',d:'中共早期主要领导人。',rank:5},
  {n:'李大钊',y:[1921,1927],cl:'早期领导',st:'坚定',d:'中共主要创始人之一，1927年遇害。',rank:4},
  {n:'毛泽东',y:[1927,1945],cl:'中央',st:'战略',d:'农村包围城市路线的代表。',rank:5},
  {n:'周恩来',y:[1926,1945],cl:'中央',st:'务实',d:'长期主持统战与外交。',rank:5},
  {n:'朱德',y:[1927,1945],cl:'军事',st:'沉稳',d:'八路军总司令。',rank:4},
  {n:'彭德怀',y:[1930,1945],cl:'军事',st:'刚烈',d:'八路军副总指挥，百团大战指挥者。',rank:4}
 ],
 local:[
  {n:'曾国藩',y:[1852,1872],cl:'湘系',st:'稳健',d:'湘军统帅。',rank:3},
  {n:'李鸿章',y:[1862,1901],cl:'淮系',st:'务实',d:'淮军与北洋体系奠基者。',rank:3},
  {n:'张作霖',y:[1916,1928],cl:'奉系',st:'枭雄',d:'东北实际统治者。',rank:4},
  {n:'阎锡山',y:[1911,1960],cl:'晋系',st:'圆滑',d:'统治山西三十余年。',rank:3},
  {n:'冯玉祥',y:[1920,1930],cl:'西北军',st:'多变',d:'西北军领袖。',rank:3}
 ],
 civil:[
  {n:'梁启超',y:[1895,1929],cl:'维新派',st:'开明',d:'近代思想家，戊戌变法领导人之一。',rank:2},
  {n:'严复',y:[1895,1921],cl:'启蒙',st:'深沉',d:'翻译《天演论》。',rank:2},
  {n:'秋瑾',y:[1904,1907],cl:'革命派',st:'刚烈',d:'近代革命者，1907年就义。',rank:2},
  {n:'张謇',y:[1895,1926],cl:'实业派',st:'务实',d:'状元办厂。',rank:2},
  {n:'蔡元培',y:[1912,1940],cl:'教育',st:'包容',d:'曾任北京大学校长。',rank:2},
  {n:'鲁迅',y:[1918,1936],cl:'新文化',st:'批判',d:'现代文学家。',rank:2},
  {n:'胡适',y:[1917,1945],cl:'新文化',st:'温和',d:'新文化运动代表。',rank:2}
 ]
};

/* 战后人物：覆盖1945—1972阶段，避免人物系统在抗战胜利后断档。 */
PEOPLE.kmt.forEach(function(p){
 if(p.n==='蒋介石') p.y=[1924,1972];
 if(p.n==='李宗仁') p.y=[1926,1965];
 if(p.n==='陈诚') p.y=[1928,1965];
 if(p.n==='白崇禧') p.y=[1926,1966];
});
PEOPLE.cpc.forEach(function(p){
 if(p.n==='毛泽东') p.y=[1927,1972];
 if(p.n==='周恩来') p.y=[1926,1972];
 if(p.n==='朱德') p.y=[1927,1972];
 if(p.n==='彭德怀') p.y=[1930,1972];
});
PEOPLE.cpc.push(
 {n:'刘少奇',y:[1921,1969],cl:'中央',st:'务实',d:'中共重要领导人，曾任国家主席。',rank:4},
 {n:'邓小平',y:[1927,1972],cl:'中央',st:'干练',d:'长期参与党政军工作，战后担任重要领导职务。',rank:4},
 {n:'陈云',y:[1930,1972],cl:'财经',st:'谨慎',d:'长期负责财经工作，重视经济管理。',rank:4},
 {n:'林彪',y:[1927,1971],cl:'军事',st:'谨慎',d:'重要军事将领，曾任国防部长。',rank:4}
);
PEOPLE.kmt.push(
 {n:'宋子文',y:[1925,1971],cl:'财政',st:'精明',d:'国民政府重要财政与外交人物。',rank:3},
 {n:'陈立夫',y:[1928,1972],cl:'党务',st:'谨慎',d:'国民党重要党务人物。',rank:3}
);
PEOPLE.civil.push(
 {n:'钱学森',y:[1935,1972],cl:'科学',st:'严谨',d:'航天与工程技术专家。',rank:2},
 {n:'郭沫若',y:[1920,1972],cl:'文化',st:'多才',d:'文学家、历史学家与社会活动家。',rank:2},
 {n:'巴金',y:[1920,1972],cl:'文学',st:'真诚',d:'现代文学作家。',rank:2},
 {n:'冰心',y:[1919,1972],cl:'文学',st:'温和',d:'现代作家与翻译家。',rank:2}
);
PEOPLE.local.push(
 {n:'傅作义',y:[1920,1972],cl:'地方军政',st:'务实',d:'华北重要军事将领，参与北平和平解放。',rank:3},
 {n:'龙云',y:[1920,1962],cl:'滇系',st:'圆融',d:'云南地方实力派代表人物。',rank:3}
);

function leaderOf(fac,y){
 switch(fac){
  case 'qing':return y<1850?'道光帝':y<1862?'咸丰帝':y<1875?'同治帝':y<1909?'慈禧':y<1912?'载沣':'袁世凯';
  case 'beiyang':return y<1916?'袁世凯':y<1920?'段祺瑞':y<1924?'曹锟':y<1928?'张作霖':'蒋介石';
  case 'kmt':return y<1925?'孙中山':'蒋介石';
  case 'cpc':return y<1927?'陈独秀':y<1935?'博古':'毛泽东';
  case 'local':return y<1872?'曾国藩':y<1901?'李鸿章':y<1928?'张作霖':'阎锡山';
  default:return '无';
 }
}

/* ================= 省份列表（与 DataV 数据一致） ================= */
var PROVINCES=[
 '北京市','天津市','河北省','山西省','内蒙古自治区',
 '辽宁省','吉林省','黑龙江省',
 '上海市','江苏省','浙江省','安徽省','福建省','江西省','山东省',
 '河南省','湖北省','湖南省','广东省','广西壮族自治区','海南省',
 '重庆市','四川省','贵州省','云南省','西藏自治区',
 '陕西省','甘肃省','青海省','宁夏回族自治区','新疆维吾尔自治区',
 '台湾省','香港特别行政区','澳门特别行政区'
];

/* 省份简称（地图标签用） */
var SHORT_NAME={
 '北京市':'北京','天津市':'天津','河北省':'河北','山西省':'山西','内蒙古自治区':'内蒙',
 '辽宁省':'辽宁','吉林省':'吉林','黑龙江省':'黑龙江',
 '上海市':'上海','江苏省':'江苏','浙江省':'浙江','安徽省':'安徽','福建省':'福建','江西省':'江西','山东省':'山东',
 '河南省':'河南','湖北省':'湖北','湖南省':'湖南','广东省':'广东','广西壮族自治区':'广西','海南省':'海南',
 '重庆市':'重庆','四川省':'四川','贵州省':'贵州','云南省':'云南','西藏自治区':'西藏',
 '陕西省':'陕西','甘肃省':'甘肃','青海省':'青海','宁夏回族自治区':'宁夏','新疆维吾尔自治区':'新疆',
 '台湾省':'台湾','香港特别行政区':'香港','澳门特别行政区':'澳门'
};

/* 控制方配色 */
var CTRL_COLOR={qing:'#8a8272',beiyang:'#6b7a8f',kmt:'#496076',cpc:'#a23a2c',local:'#b08d55',japan:'#6d4a4a',russia:'#7c6a58',britain:'#5c6b58',france:'#7b6a86',usa:'#5f7285',dutch:'#7d6a4f',germany:'#6b5f52',siam:'#8a7a5c',nepal:'#948a70',afghan:'#8b7a68',mongolia:'#9a8f7c'};
window.__NAMES=CTRL_NAME;
window.__CLAMP=function(n,lo,hi){return clamp(n,lo,hi);};
window.__RENDER=function(){try{render();}catch(e){}};
window.__RENDERMAP=function(){try{renderMap();}catch(e){}};
var CTRL_NAME={qing:'清',beiyang:'北洋',kmt:'国民党',cpc:'中共',local:'地方',japan:'日本',russia:'沙俄',britain:'英国',france:'法国',usa:'美国',dutch:'荷兰',germany:'德国',siam:'暹罗',nepal:'尼泊尔',afghan:'阿富汗',mongolia:'蒙古'};

/* 某省在某年的默认控制方 */
function getDefaultCtrl(prov, year){
 var isNE=['辽宁省','吉林省','黑龙江省'].indexOf(prov)>=0;
 var isNorth=['北京市','天津市','河北省','山西省','山东省'].indexOf(prov)>=0;
 var isEast=['上海市','江苏省','浙江省','安徽省'].indexOf(prov)>=0;
 var remote=['新疆维吾尔自治区','西藏自治区','内蒙古自治区','广西壮族自治区','云南省','贵州省','青海省','宁夏回族自治区','甘肃省'].indexOf(prov)>=0;

 if(isNE && year>=1931) return 'japan';
 if(isNorth && year>=1937) return 'japan';
 if(isEast && year>=1937) return 'japan';

 if(year<1912) return remote?'local':'qing';
 if(year<1928) return remote?'local':'beiyang';
 return remote?'local':'kmt';
}

/* ================= 地图：在线加载阿里云 DataV 真实省界 ================= */
var GEO_URL=null;  /* 省界改为本地 china.js 提供，离线可用 */
var mapFeatures=null;
var mapLoading=false;
var MAP_BOX={w:760,h:480};
var GEO_MIN_LNG=68, GEO_MAX_LNG=152, GEO_MIN_LAT=5, GEO_MAX_LAT=58;
var MAP_SCALE=MAP_BOX.w/(GEO_MAX_LNG-GEO_MIN_LNG);
var MAP_PADDING_TOP=(MAP_BOX.h-(GEO_MAX_LAT-GEO_MIN_LAT)*MAP_SCALE)/2;

function geoToSvg(lng,lat){
 return [
  (lng-GEO_MIN_LNG)*MAP_SCALE,
  (GEO_MAX_LAT-lat)*MAP_SCALE+MAP_PADDING_TOP
 ];
}

function geometryToPath(geometry){
 var rings=[];
 if(geometry.type==='Polygon'){
  rings=geometry.coordinates;
 }else if(geometry.type==='MultiPolygon'){
  geometry.coordinates.forEach(function(poly){
   poly.forEach(function(ring){rings.push(ring);});
  });
 }
 if(!rings.length) return '';

 var d='';
 rings.forEach(function(ring){
  var first=true;
  ring.forEach(function(coord){
   var p=geoToSvg(coord[0],coord[1]);
   d+=(first?'M':'L')+p[0].toFixed(1)+','+p[1].toFixed(1);
   first=false;
  });
  d+='Z';
 });
 return d;
}

function computeCentroid(geometry){
 var minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 var rings=[];
 if(geometry.type==='Polygon'){rings=geometry.coordinates;}
 else if(geometry.type==='MultiPolygon'){
  var best=null,bestLen=0;
  geometry.coordinates.forEach(function(poly){
   if(poly[0].length>bestLen){bestLen=poly[0].length;best=poly;}
  });
  if(best)rings=[best];
 }
 rings.forEach(function(ring){
  ring.forEach(function(c){
   var p=geoToSvg(c[0],c[1]);
   if(p[0]<minX)minX=p[0];
   if(p[0]>maxX)maxX=p[0];
   if(p[1]<minY)minY=p[1];
   if(p[1]>maxY)maxY=p[1];
  });
 });
 if(minX===Infinity)return [0,0];
 return [(minX+maxX)/2,(minY+maxY)/2];
}

function loadChinaMap(callback){
 if(mapFeatures){callback();return;}
 if(mapLoading)return;
 mapLoading=true;

 var note=$('worldNote');
 if(note)note.textContent='正在加载省界数据...';

 Promise.resolve(window.GEO_DATA)
  .then(function(geo){
   if(!geo||!geo.features)throw new Error('bad data');
   mapFeatures=[];
   geo.features.forEach(function(f){
    if(!f.name)return;
    var name=f.name;
    if(name.indexOf('南海')>=0)return;
    var d=geometryToPath(f.geometry);
    if(!d)return;
    var ct=computeCentroid(f.geometry);
    var bbox=[0,0,0,0];
    mapFeatures.push({name:name,path:d,cx:ct[0],cy:ct[1]});
   });
   mapLoading=false;
   callback();
  })
  .catch(function(err){
   mapLoading=false;
   if(note)note.textContent='地图加载失败：'+(err&&err.message||'网络错误')+'。请确认通过 http/https 访问。';
  });
}

/* ================= 历史事件 ================= */
var EVENTS=[
{id:'opium',y:1840,t:'鸦片战争',who:['qing','local','civil'],d:'英舰抵粤，朝廷和战不定。',
 opts:[
  {t:'赴粤抗英',d:'主动请缨南下。',fac:['qing','local'],risk:1,run:function(s,w){if(w){s.fame+=8;s.skill+=5;s.trust+=6;s.alt+=1;return '你在虎门协助布防，上司在奏报中提到你。';}s.fame-=2;s.trust-=3;return '英舰火力远超预料，你负伤撤出。';}},
  {t:'避乱观望',d:'不卷入战事。',run:function(s){s.trust+=2;s.skill+=2;return '你按兵不动，保住了手中的人。';}}
 ]},
{id:'taiping',y:1851,t:'太平天国运动',who:['qing','local','civil'],d:'金田起义。咸丰命曾国藩“帮同办理本省团练”，本意只是民间防卫，曾国藩却将团练分为保甲与练勇，建成兵为将有的湘军。',
 opts:[
  {t:'办团练，但不越境作战',d:'严格按朝廷本意。',fac:['qing','local'],risk:1,run:function(s,w){if(w){s.trust+=9;s.skill+=5;return '你严守界限，朝廷对你放心。';}s.fame-=2;return '太平军蔓延数省，你困守一地。';}},
  {t:'效法曾国藩，练可跨省作战的乡勇',d:'突破团练本意。',fac:['qing','local'],risk:1,run:function(s,w){if(w){s.skill+=9;s.fame+=8;s.power+=6;s.alt+=2;return '你建成一支劲旅，地方权力开始转移。';}s.fame-=4;s.trust-=7;return '清廷猜忌，收回你的兵权。';}},
  {t:'建议“化整为零，各村自守”',d:'避免地方坐大。',run:function(s){s.trust+=3;s.fame-=2;return '你的建议被采纳，但也意味着放弃掌军机会。';}}
 ]},
{id:'ziqiang',y:1861,t:'洋务运动',who:['qing','local','civil'],d:'1867年同文馆之争：奕訢要求增设天文算学馆并招收科甲正途出身者，顽固派以“有违传统治国之道”反对。',
 opts:[
  {t:'支持奕訢，扩大同文馆',d:'正面回应质疑。',fac:['qing','local','civil'],risk:1,run:function(s,w){if(w){s.skill+=9;s.power+=7;s.fame+=4;s.alt+=1;return '你站在洋务派一边，同文馆最终办了起来。';}s.power-=3;s.fame-=2;return '顽固派攻讦，你被贴上“用夷变夏”标签。';}},
  {t:'与顽固派妥协，只办技术',d:'“中体西用”。',fac:['qing','local','civil'],run:function(s){s.trust+=5;s.skill+=4;s.power+=2;return '你选择退让，洋务被限制在器物层面。';}},
  {t:'上疏斥洋务为“奇技淫巧”',d:'附和顽固派。',run:function(s){s.fame-=5;s.trust+=3;return '顽固派视你为同道，开明官员敬而远之。';}}
 ]},
{id:'jiawu',y:1894,t:'甲午战争',who:['qing','local','civil'],d:'北洋水师覆没，淮军败退。',
 opts:[
  {t:'出海决战',d:'与日本联合舰队交锋。',fac:['qing'],risk:1,run:function(s,w){if(w){s.fame+=11;s.skill+=8;s.trust+=8;s.alt+=2;return '你沉着指挥，重创日舰。';}s.fame+=2;s.skill+=4;s.trust-=5;return '战舰中弹起火，你落水后被救起。';}},
  {t:'上书言变法',d:'认为败在制度。',fac:['qing','civil'],risk:1,run:function(s,w){if(w){s.power+=9;s.fame+=5;s.alt+=1;return '你的条陈在士林中流传。';}s.power-=2;s.trust-=3;return '你的主张被斥为危言耸听。';}}
 ]},
{id:'wuxu',y:1898,t:'戊戌变法',who:['qing','civil'],d:'光绪召见袁世凯试图掌握军权，袁世凯随后向荣禄告密，成为政变关键一环。',
 opts:[
  {t:'站在光绪一边，推动激进改革',d:'支持康梁。',fac:['qing','civil'],risk:1,run:function(s,w){if(w){s.power+=10;s.fame+=7;s.skill+=4;s.alt+=2;return '你在新政中办事得力。';}s.power-=7;s.fame+=3;s.trust-=9;return '政变发生，你被革职查办。';}},
  {t:'表面附和，暗中与慈禧联系',d:'走钢丝。',fac:['qing','civil'],risk:1,run:function(s,w){if(w){s.power+=6;s.trust+=5;return '政变后你未被深究。';}s.fame-=6;s.trust-=7;return '两边都不信任你。';}},
  {t:'效忠慈禧，揭发维新派',d:'站后党。',fac:['qing'],risk:1,run:function(s,w){if(w){s.trust+=9;s.power+=5;return '你因“忠谨”受重用。';}s.fame-=8;return '士林视你为告密者。';}}
 ]},
{id:'boxer',y:1900,t:'庚子事变',who:['qing','local','civil'],d:'八国联军入京。',
 opts:[
  {t:'抗击联军',d:'服从宣战诏。',fac:['qing','local'],risk:1,run:function(s,w){if(w){s.fame+=10;s.skill+=7;s.trust+=6;s.alt+=2;return '你部顽强阻击。';}s.fame-=4;s.trust-=5;return '你部几乎打光。';}},
  {t:'东南互保',d:'与督抚抗命。',fac:['qing','local'],rmin:2,risk:1,run:function(s,w){if(w){s.power+=9;s.fame+=7;s.alt+=2;return '你参与东南互保，保全了地方。';}s.trust-=7;return '你的举动被视为抗命。';}}
 ]},
{id:'xinhai',y:1911,t:'辛亥革命',who:['qing','local','civil','beiyang'],d:'武昌起义后十余省独立。南北议和：革命党许诺推举袁世凯为总统，换取北洋军倒戈逼清帝退位。',
 opts:[
  {t:'联络新军，参加武昌起义',d:'你已入革命团体，城里枪声一响就动。',club:['tongmeng','guangfu','xingzhong'],risk:1,run:function(s,w){
    if(w){s.fame+=16;s.power+=13;s.skill+=7;s.alt+=4;s.trust+=4;return '10月10日夜，你在楚望台军械库外接应，把子弹一箱箱搬进工事。城里的新军连夜反正。';}
    s.fame-=6;s.trust-=8;s.alt+=1;return '起义提前走漏了风声，你在混乱中被迫转移，几个人再没回来。';}},
  {t:'在报上鼓吹，替革命筹款',d:'读书人能做的，是笔和钱。',fac:['civil'],risk:1,run:function(s,w){
    if(w){s.fame+=9;s.power+=8;s.skill+=5;s.alt+=2;s.cash+=30;return '你的文章被几家报纸转载，募来的款子分三批送到汉口。';}
    s.fame-=3;s.trust-=4;return '租界巡捕封了报馆，你连夜换了住处。';}},
  {t:'举义响应',d:'站革命一边。',fac:['qing','local','beiyang'],risk:1,run:function(s,w){if(w){s.fame+=12;s.power+=10;s.alt+=3;return '你率部响应起义。';}s.fame-=5;s.trust-=6;return '起义失败，你被迫流亡。';}},
  {t:'支持南北议和',d:'接受与袁世凯的妥协。',fac:['beiyang','local','qing'],rmin:2,risk:1,run:function(s,w){if(w){s.power+=9;s.trust+=7;s.alt+=2;return '你在议和与逼宫中发挥作用。';}s.fame-=3;return '议和拖延，你两边不讨好。';}},
  {t:'效忠清廷',d:'坚持镇压。',fac:['qing','local'],risk:1,run:function(s,w){if(w){s.trust+=8;s.skill+=5;return '你镇压了辖区起事。';}s.fame-=7;s.trust-=8;return '你的部队溃散。';}}
 ]},
{id:'minguo',y:1912,t:'中华民国成立',who:['beiyang','kmt','civil','local'],d:'清帝退位，袁世凯接掌中央。',
 opts:[
  {t:'依附袁世凯',d:'押注最强军力。',fac:['beiyang','local'],risk:1,run:function(s,w){if(w){s.power+=8;s.trust+=7;return '你被编入北洋序列。';}s.trust-=5;return '你被排挤。';}},
  {t:'投身议会政治',d:'相信制度。',fac:['civil','kmt'],risk:1,run:function(s,w){if(w){s.power+=9;s.fame+=7;return '你在议会中崭露头角。';}s.power-=4;return '议会屡遭解散。';}}
 ]},
{id:'may4',y:1919,t:'五四运动',who:['civil','kmt','qing','local'],d:'巴黎和会失败，学生走上街头。',
 opts:[
  {t:'投身学运',d:'办刊物、演讲。',fac:['civil','kmt'],risk:1,run:function(s,w){if(w){s.fame+=10;s.power+=7;s.alt+=2;return '你成为学生活跃分子。';}s.fame+=3;s.trust-=4;return '你被当局传讯。';}},
  {t:'报端发声',d:'以文字影响舆论。',fac:['civil'],run:function(s){s.fame+=8;s.skill+=5;s.power+=4;return '你的文章引起广泛讨论。';}}
 ]},
{id:'beifa',y:1926,t:'北伐战争',who:['kmt','cpc','beiyang','local'],d:'国民革命军约10万人，面对吴佩孚、孙传芳、张作霖共约70万。广东革命政府确定“集中兵力、各个击破”：先打吴佩孚，后打孙传芳，最后消灭张作霖。',
 opts:[
  {t:'支持“先打吴佩孚”',d:'各个击破。',fac:['kmt','cpc','local','beiyang'],risk:1,run:function(s,w){if(w){s.fame+=11;s.skill+=8;s.trust+=8;s.alt+=3;return '两湖战场进展顺利，吴佩孚部基本被歼。';}s.fame-=3;s.skill+=4;return '吴佩孚部抵抗激烈。';}},
  {t:'主张同时进攻孙传芳',d:'分兵冒进。',fac:['kmt','cpc','local','beiyang'],risk:1,run:function(s,w){if(w){s.fame+=6;s.power+=5;return '你冒险分兵，局部占了上风。';}s.fame-=6;s.trust-=7;return '兵力分散，被孙传芳各个击破。';}}
 ]},
{id:'split',y:1927,t:'国共分裂',who:['kmt','cpc'],d:'四一二清党。',
 opts:[
  {t:'参与清党',d:'选择国民党。',fac:['kmt'],risk:1,run:function(s,w){if(w){s.trust+=10;s.power+=8;s.alt+=2;return '你立场鲜明。';}s.fame-=5;return '你被怀疑立场不纯。';}},
  {t:'转入地下',d:'选择共产党。',fac:['cpc'],risk:1,run:function(s,w){if(w){s.power+=11;s.fame+=7;s.trust+=7;s.alt+=3;return '你在血雨腥风中转入地下。';}s.fame+=3;s.trust-=7;return '你与组织失去联系数月。';}}
 ]},
{id:'918',y:1931,t:'九一八事变',who:['kmt','cpc','local','civil','beiyang'],d:'关东军占领沈阳。',
 opts:[
  {t:'请缨北上',d:'要求开赴东北。',fac:['kmt','cpc','local'],risk:1,run:function(s,w){if(w){s.fame+=11;s.power+=6;s.alt+=3;return '你率部出关。';}s.fame+=4;s.trust-=5;return '上级拒绝你的请求。';}},
  {t:'服从不抵抗',d:'执行命令。',fac:['kmt','beiyang','local'],run:function(s){s.trust+=6;s.fame-=7;return '你执行了命令，部队撤出。';}}
 ]},
{id:'changzheng',y:1934,t:'长征',who:['cpc'],d:'第五次反围剿失败，中央红军突围。',
 opts:[
  {t:'随军长征',d:'走完这条路。',fac:['cpc'],risk:1,run:function(s,w){if(w){s.skill+=10;s.trust+=12;s.fame+=8;s.alt+=3;return '你走完了长征。';}s.skill+=5;s.fame+=3;s.trust+=3;return '你负伤掉队，靠老乡掩护才追上。';}},
  {t:'留守南方',d:'坚持游击。',fac:['cpc'],risk:1,run:function(s,w){if(w){s.skill+=7;s.fame+=6;s.trust+=7;s.alt+=2;return '你在南方三年游击战中幸存。';}s.fame+=2;s.trust-=4;return '根据地被反复清剿。';}}
 ]},
{id:'xian',y:1936,t:'西安事变',who:['kmt','cpc'],d:'张杨扣留蒋介石。',
 opts:[
  {t:'和平解决',d:'力主谈判。',fac:['cpc','kmt'],risk:1,run:function(s,w){if(w){s.power+=9;s.fame+=8;s.alt+=3;return '你为和平解决奔走。';}s.power-=3;return '你的主张被认为软弱。';}},
  {t:'武力讨伐',d:'严惩叛逆。',fac:['kmt'],risk:1,run:function(s,w){if(w){s.trust+=5;s.power+=4;return '你主张强硬。';}s.fame-=4;s.trust-=5;return '你的立场成了把柄。';}}
 ]},
{id:'q7',y:1937,t:'全面抗战',who:['kmt','cpc','local','civil','beiyang','qing'],d:'卢沟桥事变。',
 opts:[
  {t:'开赴前线',d:'参加正面战场。',fac:['kmt','cpc','local','beiyang'],risk:1,run:function(s,w){if(w){s.fame+=14;s.skill+=9;s.trust+=9;s.alt+=4;return '你部血战数月。';}s.fame+=6;s.skill+=5;s.alt+=2;return '你部伤亡过半。';}},
  {t:'后方动员',d:'负责兵员物资。',fac:['civil','kmt','cpc','local'],run:function(s){s.fame+=8;s.power+=6;s.skill+=4;return '你组织的动员网络高效运转。';}}
 ]},
{id:'wuhan',y:1938,t:'武汉会战',who:['kmt','cpc','local'],d:'日军沿长江推进。',
 opts:[
  {t:'死守外围',d:'在万家岭硬拼。',fac:['kmt','local'],risk:1,run:function(s,w){if(w){s.fame+=12;s.skill+=8;s.trust+=8;s.alt+=3;return '你部合围日军一个师团。';}s.fame+=4;s.skill+=4;s.trust-=4;return '阵地被突破。';}},
  {t:'袭扰补给线',d:'配合正面。',fac:['cpc','local'],risk:1,run:function(s,w){if(w){s.fame+=9;s.skill+=6;s.power+=5;s.alt+=2;return '你部多次破袭日军运输线。';}s.fame+=2;s.skill+=3;return '日军报复扫荡。';}}
 ]},
{id:'baituan',y:1940,t:'百团大战',who:['cpc','kmt'],d:'八路军在华北发动破袭。',
 opts:[
  {t:'参加破袭',d:'攻击交通线。',fac:['cpc'],risk:1,run:function(s,w){if(w){s.fame+=11;s.skill+=8;s.trust+=8;s.alt+=3;return '你部连续破袭成功。';}s.fame+=4;s.skill+=4;s.trust-=3;return '作战暴露实力。';}},
  {t:'配合策应',d:'正面牵制。',fac:['kmt','local'],risk:1,run:function(s,w){if(w){s.fame+=8;s.skill+=6;s.trust+=5;s.alt+=2;return '你部牵制了日军数个师团。';}s.fame+=2;s.trust-=2;return '攻势准备不足。';}}
 ]},
{id:'1945',y:1945,t:'抗战胜利',who:['kmt','cpc','local','civil','beiyang','qing'],d:'日本投降。此后怎么走，没人拿着剧本。',
 opts:[
  {t:'受降接收',d:'代表我方受降。',fac:['kmt','cpc','local'],rmin:2,run:function(s){s.fame+=10;s.power+=8;s.trust+=7;return '你在受降仪式上签下名字。';}},
  {t:'安抚地方',d:'重建开始。',run:function(s){s.fame+=6;s.skill+=5;s.power+=3;return '你着手清点伤亡、救济难民。';}}
 ]}
];

/* 1945年后的时代事件：使历史推进在战后仍有内容，覆盖至1972年。 */
EVENTS.push(
 {id:'civilwar46',y:1946,t:'全面内战',who:['kmt','cpc','local','civil'],d:'停战谈判破裂，国共双方在多地重新交战。',opts:[
  {t:'主张政治协商',d:'尽力避免战火扩大。',fac:['kmt','civil','local'],run:function(s){s.power+=5;s.fame+=4;return '你奔走于地方与各方之间，希望保住城市与民生。';}},
  {t:'投入军事动员',d:'为所属阵营筹措兵员与物资。',fac:['kmt','cpc','local'],risk:1,run:function(s,w){if(w){s.trust+=6;s.fame+=5;return '动员与运输工作顺利完成。';}s.cash=Math.max(0,s.cash-10);s.trust-=3;return '征集受阻，地方怨气渐起。';}}
 ]},
 {id:'constitution47',y:1947,t:'行宪与土地改革',who:['kmt','cpc','local','civil'],d:'国民政府公布宪法；与此同时，各地土地制度与社会秩序持续剧烈变化。',opts:[
  {t:'推动地方自治与法治',d:'以制度稳定地方。',fac:['kmt','civil','local'],run:function(s){s.power+=5;s.trust+=4;s.skill+=2;return '你推动地方议事与行政整顿，短期内进展有限。';}},
  {t:'参与土地与基层改革',d:'回应乡村社会诉求。',fac:['cpc','local','civil'],run:function(s){s.fame+=5;s.power+=4;s.trust+=2;return '你参与基层改革，乡村社会结构随之变化。';}}
 ]},
 {id:'campaign48',y:1948,t:'战略决战',who:['kmt','cpc','local'],d:'辽沈、淮海、平津等战役相继展开，战争走向发生根本变化。',opts:[
  {t:'全力投入前线',d:'承担作战或后勤任务。',fac:['kmt','cpc','local'],risk:1,run:function(s,w){if(w){s.skill+=7;s.fame+=7;s.trust+=4;return '你在战役中完成任务，部队与物资得到保全。';}s.skill+=3;s.trust-=5;return '战局不利，部队损失惨重。';}},
  {t:'保护城市与民众',d:'优先维持秩序、救济难民。',fac:['local','civil','kmt','cpc'],run:function(s){s.fame+=6;s.trust+=3;return '你组织救济与疏散，尽力减少平民伤亡。';}}
 ]},
 {id:'founding49',y:1949,t:'中华人民共和国成立',who:['kmt','cpc','local','civil'],d:'中华人民共和国成立，国共政权格局发生根本变化。',opts:[
  {t:'参与新政权建设',d:'投身行政、经济或社会重建。',fac:['cpc','civil','local'],run:function(s){s.power+=7;s.fame+=5;s.trust+=5;return '你参与接管与恢复工作，新的制度逐步建立。';}},
  {t:'随国民政府转移',d:'继续维持原有组织与联系。',fac:['kmt'],run:function(s){s.trust+=4;s.skill+=3;return '你随组织转移，开始在新的环境中维持工作。';}},
  {t:'保持地方中立',d:'优先避免地方冲突。',fac:['local','civil'],run:function(s){s.fame+=3;s.trust+=4;return '你努力维持地方秩序，避免无谓冲突。';}}
 ]},
 {id:'korean50',y:1950,t:'抗美援朝',who:['cpc','civil','local'],d:'中国人民志愿军入朝作战，国内开展大规模后勤与社会动员。',opts:[
  {t:'承担前线或后勤任务',d:'参与军事与运输保障。',fac:['cpc','local'],risk:1,run:function(s,w){if(w){s.skill+=6;s.fame+=5;s.trust+=5;return '你完成了艰苦的运输与保障任务。';}s.skill+=3;s.trust-=3;return '任务完成得不理想，人员与物资损失不小。';}},
  {t:'组织生产与救护',d:'支援前线。',fac:['civil'],run:function(s){s.fame+=5;s.skill+=3;return '你组织募捐、生产或救护，支援前线。';}}
 ]},
 {id:'plan53',y:1953,t:'第一个五年计划',who:['cpc','civil','local'],d:'国家开始实施第一个五年计划，工业化建设成为重要任务。',opts:[
  {t:'投身工业建设',d:'参与工厂、铁路或技术工作。',fac:['cpc','civil','local'],run:function(s){s.skill+=6;s.power+=3;s.fame+=3;return '你参与工业建设，新的工厂与铁路逐渐投产。';}},
  {t:'发展地方商业与供给',d:'保障城乡物资流通。',fac:['civil','local'],run:function(s){s.cash+=20;s.fame+=3;return '你维持地方供销与物资流通，生活逐渐稳定。';}}
 ]},
 {id:'transformation56',y:1956,t:'社会主义改造基本完成',who:['cpc','civil','local'],d:'农业、手工业和资本主义工商业的社会主义改造基本完成。',opts:[
  {t:'参与公私合营与行业调整',d:'适应新的经济组织形式。',fac:['civil','local','cpc'],run:function(s){s.power+=4;s.skill+=4;return '你参与行业改组，原有经营方式发生变化。';}},
  {t:'专注技术与教育',d:'在专业领域继续工作。',fac:['civil','cpc'],run:function(s){s.skill+=6;s.fame+=2;return '你转向技术或教育工作，积累专业经验。';}}
 ]},
 {id:'greatleap58',y:1958,t:'大跃进',who:['cpc','civil','local'],d:'大跃进运动展开，工业与农业生产指标快速提高，基层也面临巨大压力。',opts:[
  {t:'如实上报生产情况',d:'坚持实事求是。',fac:['cpc','civil','local'],risk:1,run:function(s,w){if(w){s.trust+=5;s.fame+=3;return '你尽力如实上报，避免虚报带来的决策偏差。';}s.trust-=4;return '真实情况未能得到重视，基层压力仍在增加。';}},
  {t:'盲目追求高指标',d:'以运动式方式推进。',fac:['cpc','local'],run:function(s){s.power+=3;s.trust-=6;s.fame-=3;return '短期声势很大，但资源错配与基层困难逐渐显现。';}}
 ]},
 {id:'cultural66',y:1966,t:'文化大革命开始',who:['cpc','civil','local'],d:'文化大革命开始，社会秩序、教育科研与行政体系受到严重冲击。',opts:[
  {t:'尽力保护人员与资料',d:'避免冲突扩大。',fac:['cpc','civil','local'],risk:1,run:function(s,w){if(w){s.trust+=3;s.fame+=4;return '你设法保护部分人员与资料，减少了局部损失。';}s.fame-=4;s.trust-=5;return '局势失控，你的保护行动未能奏效。';}},
  {t:'保持低调，避免卷入',d:'谨慎自保。',fac:['cpc','civil','local'],run:function(s){s.trust+=2;s.power-=2;return '你减少公开活动，尽量维持日常工作。';}}
 ]},
 {id:'un71',y:1971,t:'中国恢复联合国合法席位',who:['cpc','civil'],d:'中华人民共和国恢复在联合国的合法席位，外交环境出现重要变化。',opts:[
  {t:'参与外交与国际交流',d:'推动对外联系。',fac:['cpc','civil'],run:function(s){s.power+=4;s.fame+=4;s.skill+=2;return '你参与对外交流，国际联系逐渐恢复。';}},
  {t:'专注国内建设',d:'把精力放在生产与教育。',fac:['cpc','civil'],run:function(s){s.skill+=4;s.trust+=2;return '你继续从事国内建设工作。';}}
 ]}
);

/* ================= 请教选项（按年份嵌入真实事件） ================= */
var LESSON_TOPICS={
 1840:[
  {t:'主张驰援广东，与英人正面决战',d:'参考林则徐的强硬立场。',ok:1,run:function(s){s.fame+=4;s.skill+=3;return '对方认可你的勇气，但也提醒你英舰火力远非旧式水师可比。';}},
  {t:'建议先了解英人船炮虚实，再定和战',d:'参考“师夷长技”的务实思路。',ok:1,run:function(s){s.skill+=5;s.power+=3;return '对方欣赏你的审慎，与你讨论起夷情与海防。';}},
  {t:'主张立即断绝一切对外通商，闭关自守',d:'以天朝上国自居，拒绝了解外部。',ok:0,run:function(s){s.relDelta=-6;s.skill-=2;return '对方摇头：英人已到门口，闭眼不看只会败得更快。你的空谈让他失望。';}}
 ],
 1851:[
  {t:'效法曾国藩，把团练练成能跨省作战的军队',d:'突破“不得远行征调”的旧例。',ok:1,run:function(s){s.skill+=5;s.power+=4;return '对方压低声音：朝廷既要用人，又怕人坐大，这条路走得通，但每一步都要拿捏。';}},
  {t:'严守团练本分，只保乡里',d:'按咸丰本意行事。',ok:1,run:function(s){s.trust+=5;return '对方点头：这样至少不会招来朝廷的猜忌。';}},
  {t:'建议朝廷立刻裁撤所有团练，专靠八旗绿营',d:'迷信经制之兵。',ok:0,run:function(s){s.relDelta=-5;return '对方苦笑：八旗绿营若能战，何至于此？你的建议被视为不通时务。';}}
 ],
 1861:[
  {t:'支持奕訢，同文馆增设天文算学馆并招收正途出身者',d:'正面回应顽固派。',ok:1,run:function(s){s.skill+=5;s.power+=4;return '对方眼中一亮：你肯替洋务说话，难得。但顽固派不会善罢甘休。';}},
  {t:'只学技术，不碰科举正途',d:'“中体西用”的折中路线。',ok:1,run:function(s){s.trust+=4;s.skill+=3;return '对方沉吟：稳妥，但也意味着洋务永远只能停在器物层面。';}},
  {t:'附和顽固派，斥西学为“奇技淫巧”',d:'以传统治国之道为名反对洋务。',ok:0,run:function(s){s.relDelta=-7;s.fame-=3;return '对方脸色一沉：你也在说这种话？中国还要不要自强的？此后他冷淡了许多。';}}
 ],
 1898:[
  {t:'支持光绪，推动废八股、裁冗官等激进改革',d:'站在维新派一边。',ok:1,run:function(s){s.power+=5;s.fame+=3;return '对方压低声音：皇上确有决心，但慈禧还在颐和园。你要想清楚站哪边。';}},
  {t:'建议先抓军权，争取袁世凯的新军',d:'戊戌变法中光绪确实召见过袁世凯。',ok:1,run:function(s){s.skill+=4;s.power+=3;return '对方沉默片刻：袁世凯这个人，能用，但不可全信。你记下了这句话。';}},
  {t:'建议维新派立刻包围颐和园，武力胁迫慈禧交权',d:'低估后党实力，高估维新派军力。',ok:0,run:function(s){s.relDelta=-8;s.power-=3;return '对方惊得站起来：你疯了？维新派手里一兵一卒都没有，这是自寻死路。';}}
 ],
 1911:[
  {t:'支持南北议和，以推举袁世凯为条件换取清帝退位',d:'历史上最终走的路。',ok:1,run:function(s){s.power+=5;s.trust+=3;return '对方点头：这是目前最快推翻清朝的办法，但共和的果实恐怕保不住。';}},
  {t:'主张革命党绝不与袁世凯妥协，继续北伐',d:'革命理想主义路线。',ok:1,run:function(s){s.fame+=4;s.skill+=3;return '对方叹道：说得痛快，可革命党手里没有足够的兵。理想和现实之间，你得选。';}},
  {t:'建议请日本出兵“协助”革命党推翻清朝',d:'引外力介入内争的错误思路。',ok:0,run:function(s){s.relDelta=-9;s.fame-=4;return '对方拂袖：请日本人来？你知不知道他们在东北做了什么？这话不要再提。';}}
 ],
 1926:[
  {t:'坚持“先打吴佩孚，后打孙传芳，最后打张作霖”的既定方针',d:'集中兵力、各个击破。',ok:1,run:function(s){s.skill+=5;s.trust+=4;return '对方赞许：对，军阀内部矛盾可以用，但拳头不能分散。';}},
  {t:'主张同时向孙传芳和张作霖开战，一举统一',d:'分兵冒进。',ok:0,run:function(s){s.relDelta=-6;s.trust-=3;return '对方皱眉：北伐军只有十万人，对面七十万。分兵等于自杀。';}},
  {t:'建议北伐军先停下来巩固后方，等军阀自己内讧',d:'保守观望，错失战机。',ok:0,run:function(s){s.relDelta=-4;return '对方摇头：等他们内讧？他们也在等你犯错。战机不等人。';}}
 ]
};

/* ================= 状态 ================= */
var s=null, world=null;
window.__S=function(){return s;};
window.__W=function(){return world;};
var SAVE_KEY='shanhe_v15';

function persist(){if(!s)return;try{localStorage.setItem(SAVE_KEY,JSON.stringify({s:s,world:world}));}catch(e){}}
window.__LOG=function(t){ try{ log(t); }catch(e){} };
function log(t){
 var _d=(s.cal&&typeof s.cal.ord==='number')?calFmtOrd(s.cal.ord):(s.year+'年');
 s.logs.unshift('<div class="le"><b>'+_d+'</b>　'+t+'</div>');
 s.logs=s.logs.slice(0,60);
 $('logs').innerHTML=s.logs.join('');
 persist();
}

/* ================= 世界 ================= */
function initWorld(year){
 var w={year:year,pstate:{},powers:{
  qing:{v:80,n:'清'},beiyang:{v:0,n:'北洋'},kmt:{v:0,n:'国民党'},
  cpc:{v:0,n:'中共'},local:{v:40,n:'地方'},japan:{v:10,n:'日本'}
 },regions:{},log:[]};
 PROVINCES.forEach(function(p){
  w.regions[p]={ctrl:getDefaultCtrl(p,year),str:rnd(30,55)};
 });
 if(year>=1912){w.powers.qing.v=0;w.powers.beiyang.v=70;}
 if(year>=1921)w.powers.cpc.v=12;
 if(year>=1924)w.powers.kmt.v=22;
 if(year>=1928){w.powers.kmt.v=72;w.powers.beiyang.v=30;}
 if(year>=1931)w.powers.japan.v=45;
 if(year>=1937){w.powers.japan.v=65;w.powers.kmt.v=60;}
 return w;
}

function advancePeople(year){
 if(!world.pstate)world.pstate={};
 var L=[];
 Object.keys(PEOPLE).forEach(function(fac){
  (PEOPLE[fac]||[]).forEach(function(p){
   if(year<p.y[0]||year>p.y[1])return;
   var st=world.pstate[p.n];
   if(st&&(st.state==='dead'||st.state==='fallen'))return;
   var LD=leaderOf(fac,year); if(p.n===LD)return;
   var big=(p.rank||0)>=3;
   if(Math.random()<(big?0.02:0.012)){
    world.pstate[p.n]={state:'dead',note:'病故'};
    L.push(p.n+'病故，'+year+'年。');
   }else if(Math.random()<(big?0.035:0.03)){
    world.pstate[p.n]={state:'fallen',note:'失势'};
    L.push(p.n+(big?'下野，权力被架空。':'在一场权力变动中失势，被解除职务。'));
   }else if(!big&&Math.random()<0.05){
    world.pstate[p.n]={state:'promoted',note:'升迁'};
    L.push(p.n+'得到提拔，位置更重了。');
   }
  });
 });
 return L;
}

function advanceWorld(year){
 var L=[];
 if(year===1912){
  world.powers.qing.v=0;world.powers.beiyang.v=70;
  PROVINCES.forEach(function(p){
   if(world.regions[p]&&world.regions[p].ctrl==='qing')world.regions[p].ctrl='beiyang';
  });
  L.push('清帝退位，北洋接掌中央。');
 }
 if(year===1921){world.powers.cpc.v=12;L.push('中国共产党成立。');}
 if(year===1926){world.powers.kmt.v=55;world.powers.beiyang.v=45;L.push('北伐战争爆发。');}
 if(year===1928){
  ['辽宁省','吉林省','黑龙江省'].forEach(function(p){
   if(world.regions[p])world.regions[p].ctrl='kmt';
  });
  world.powers.kmt.v=72;world.powers.beiyang.v=30;
  L.push('东北易帜。');
 }
 if(year===1931){
  ['辽宁省','吉林省','黑龙江省'].forEach(function(p){
   if(world.regions[p]){world.regions[p].ctrl='japan';world.regions[p].str=70;}
  });
  world.powers.japan.v=45;
  L.push('九一八事变，日本侵占东北。');
 }
 if(year===1937){
  world.powers.japan.v=65;world.powers.kmt.v=60;
  ['北京市','天津市','河北省','山西省','山东省','上海市','江苏省','浙江省','安徽省'].forEach(function(p){
   if(world.regions[p]){world.regions[p].ctrl='japan';world.regions[p].str=65;}
  });
  L.push('七七事变，全面抗战爆发。');
 }
 if(year===1945){
  world.powers.japan.v=0;
  PROVINCES.forEach(function(p){
   if(world.regions[p]&&world.regions[p].ctrl==='japan')world.regions[p].ctrl='kmt';
  });
  L.push('日本投降。');
 }
 return L;
}

/* ================= 经验 ================= */
function addExp(attr,amount){
 var slow=Math.max(0.18,1-s[attr]/140);
 s.exp[attr]=(s.exp[attr]||0)+amount*slow;
 while(s.exp[attr]>=EXP_MAX&&s[attr]<100){
  var nb=Math.floor(s[attr]/20)*20+20;
  if(s[attr]>=nb-20&&s[attr]<nb&&s.breakthrough[attr]<nb){s.exp[attr]=EXP_MAX-1;break;}
  s[attr]=clamp(s[attr]+1);s.exp[attr]-=EXP_MAX;
 }
}

/* ================= 人物按职位筛选 ================= */
function pstateOf(n){
 if(!world||!world.pstate)return null;
 return world.pstate[n]||null;
}

var _visiblePeopleV29=visiblePeople;
visiblePeople=function(){
 var list=_visiblePeopleV29();
 if(s&&(s.isThrone||s.isLeader)){
  list=list.filter(function(p){ return !/帝$|太后$/.test(p.n) || (s.isThrone&&p.n===s.name); });
 }
 return list;
};
function visiblePeople(){
 var all=(PEOPLE[s.faction]||[]).filter(function(p){
  var st=pstateOf(p.n);
  if(st&&st.state==='dead')return false;
  return s.year>=p.y[0]&&s.year<=p.y[1];
 });
 var L=leaderOf(s.faction,s.year);
 var out=[];
 all.forEach(function(p){
  if(p.n===L){if(s.rank>=3)out.unshift({n:L,cl:'最高层',st:'—',d:'当前该阵营最高领导人。',rank:3});return;}
  if(s.rank>=p.rank)out.push(p);
 });
 return out;
}

function getRel(n){return s.rel[n]===undefined?50:s.rel[n];}
function setRel(n,v){s.rel[n]=clamp(v);}

/* ================= 互动 ================= */
function openInteraction(name,kind){
 if(!s)return;
 if(!actGate('meet:'+kind+':'+name,({visit:'拜访',learn:'请教',work:'共事'}[kind]||'')+name))return;
 var ps=visiblePeople();
 var p=null;
 for(var i=0;i<ps.length;i++){if(ps[i].n===name){p=ps[i];break;}}
 if(!p)return;

 var ev=EVENTS.find(function(e){return e.y===s.year;});
 var ctx=ev?('【'+ev.t+'】之际，'):(s.year+'年，');
 var kindName={visit:'拜访',learn:'请教',work:'共事'}[kind];

 $('dlgTag').textContent=kindName+' · '+p.n;
 $('dlgTitle').textContent=ctx+'你会怎么做？';
 $('dlgDesc').textContent=p.d+'（派系：'+(p.cl||'—')+' · 性格：'+(p.st||'—')+' · 关系：'+getRel(p.n)+'）';

 var body=$('dlgBody');body.innerHTML='';

 if(kind==='learn'){
  var topics=LESSON_TOPICS[s.year];
  if(topics){
   topics.forEach(function(o){
    var b=document.createElement('button');
    b.className='choice';
    b.innerHTML='<b>'+o.t+'</b><div class="sub">'+o.d+'</div>';
    b.onclick=function(){doLearn(p,o);};
    body.appendChild(b);
   });
  }else{
   [ {t:'虚心请教实务',d:'放低姿态，请对方指点。',ok:1,run:function(s){s.skill+=3;return '对方耐心指点了几句。';}},
     {t:'提出己见，与之切磋',d:'先说出自己的判断。',ok:1,run:function(s){s.skill+=2;s.power+=1;return '对方认真听了，给了你一些反馈。';}}
   ].forEach(function(o){
    var b=document.createElement('button');b.className='choice';
    b.innerHTML='<b>'+o.t+'</b><div class="sub">'+o.d+'</div>';
    b.onclick=function(){doLearn(p,o);};body.appendChild(b);
   });
  }
 }else if(kind==='visit'){
  [ {t:'备礼登门，按规矩说话',d:'礼节周全。',key:'flatter'},
    {t:'直言时局，坦陈己见',d:'不绕弯子。',key:'direct'},
    {t:'只叙旧谊，不谈公事',d:'闲话家常。',key:'neutral'}
  ].forEach(function(o){
   var b=document.createElement('button');b.className='choice';
   b.innerHTML='<b>'+o.t+'</b><div class="sub">'+o.d+'</div>';
   b.onclick=function(){doVisit(p,o);};body.appendChild(b);
  });
 }else{
  [ {t:'全力配合，甘居副手',d:'做好执行。',key:'neutral'},
    {t:'争取主导，提出方案',d:'主动担当。',key:'direct'},
    {t:'留有余地，见机行事',d:'审慎周旋。',key:'flatter'}
  ].forEach(function(o){
   var b=document.createElement('button');b.className='choice';
   b.innerHTML='<b>'+o.t+'</b><div class="sub">'+o.d+'</div>';
   b.onclick=function(){doWork(p,o);};body.appendChild(b);
  });
 }

 var cancel=document.createElement('button');
 cancel.className='choice';cancel.style.textAlign='center';cancel.innerHTML='<b>取消</b>';
 cancel.onclick=function(){$('mask').classList.add('hidden');};
 body.appendChild(cancel);
 $('mask').classList.remove('hidden');
}

var PREF={
 '守成':{flatter:1.1,direct:0.8,neutral:1.0},'强硬':{flatter:0.5,direct:1.3,neutral:0.8},
 '妥协':{flatter:1.2,direct:0.6,neutral:1.0},'稳健':{flatter:1.0,direct:1.1,neutral:1.2},
 '开明':{flatter:0.7,direct:1.2,neutral:1.2},'权谋':{flatter:1.3,direct:0.7,neutral:1.0},
 '务实':{flatter:0.8,direct:1.0,neutral:1.3},'维新':{flatter:0.7,direct:1.2,neutral:1.1},
 '理想':{flatter:0.6,direct:1.2,neutral:0.8},'圆滑':{flatter:1.2,direct:0.8,neutral:1.1},
 '枭雄':{flatter:1.0,direct:1.0,neutral:1.3},'贪婪':{flatter:1.3,direct:0.6,neutral:1.1},
 '忠诚':{flatter:1.0,direct:1.0,neutral:1.1},'精明':{flatter:0.9,direct:1.1,neutral:1.3},
 '阴狠':{flatter:0.9,direct:0.9,neutral:1.2},'激进':{flatter:0.5,direct:1.3,neutral:1.0},
 '坚定':{flatter:0.7,direct:1.2,neutral:1.1},'战略':{flatter:0.8,direct:1.1,neutral:1.3},
 '深沉':{flatter:0.8,direct:1.1,neutral:1.1},'刚烈':{flatter:0.5,direct:1.3,neutral:1.0},
 '批判':{flatter:0.5,direct:1.3,neutral:0.9},'温和':{flatter:1.0,direct:1.0,neutral:1.0},
 '包容':{flatter:0.9,direct:1.1,neutral:1.0},'多变':{flatter:1.1,direct:0.9,neutral:1.2},
 '—':{flatter:1.0,direct:1.0,neutral:1.0}
};
function pref(p,k){var m=PREF[p.st]||PREF['—'];return m[k]||1.0;}

function doVisit(p,o){
 if(!actGate('meet:visit:'+p.n,'拜访'+p.n))return;
 var d=Math.round(6*pref(p,o.key)+rnd(-5,7)+(getRel(p.n)>75?1:0));
 setRel(p.n,getRel(p.n)+d);
 addExp('trust',d>0?5:2);
 actCool('meet:visit:'+p.n,15);
 showResult(p.n,'拜访',d,o.key==='direct'?'你的直率让对方有些意外。':'');
}

function doLearn(p,o){
 if(!actGate('meet:learn:'+p.n,'请教'+p.n))return;
 var d=o.ok?Math.round(4+rnd(1,5)):Math.round(o.relDelta||-6);
 setRel(p.n,getRel(p.n)+d);
 if(o.ok){addExp('skill',8);addExp('power',2);}
 else{addExp('skill',2);}
 actCool('meet:learn:'+p.n,30);
 showResult(p.n,'请教',d,o.run(s));
}

function doWork(p,o){
 if(!actGate('meet:work:'+p.n,'共事'+p.n))return;
 var d=Math.round(6*pref(p,o.key)+rnd(-5,7));
 setRel(p.n,getRel(p.n)+d);
 addExp('fame',d>0?6:3);addExp('trust',d>0?4:2);
 actCool('meet:work:'+p.n,30);
 showResult(p.n,'共事',d,'');
}

function showResult(name,kind,delta,extraText){
 var body=$('dlgBody');body.innerHTML='';
 var cls=delta>0?'up':delta<0?'down':'';
 var sign=delta>0?'+':'';
 var text='';
 if(delta>=8)text=name+'对你颇为受用。';
 else if(delta>=3)text=name+'点了点头，表示认可。';
 else if(delta>=-2)text=name+'反应平淡。';
 else if(delta>=-6)text=name+'面露不悦。';
 else text=name+'明显被触怒了。';

 var html='<div class="resultbox">'+
  '<div>'+text+'</div>'+
  '<div style="margin-top:6px">关系 <span class="'+cls+'">'+sign+delta+'</span> → '+getRel(name)+'</div>'+
  (extraText?'<div style="margin-top:4px;color:var(--muted)">'+extraText+'</div>':'')+
  '</div>'+
  '<button class="choice" id="resClose" style="text-align:center"><b>知道了</b></button>';

 body.innerHTML=html;
 document.getElementById('resClose').onclick=function(){
  $('mask').classList.add('hidden');
  persist();render();
 };
}

/* ================= 行动 ================= */
function doAction(a){
 if(!s||!actGate('act:'+a,'此事'))return;
 if(a==='train'){
  var ok=s.role==='soldier'||s.role==='officer';
  if(!ok){log('你没有军队身份，无法操练。');return;}
  addExp('skill',9);addExp('fame',3);
  log('你坚持操练。');
 }else if(a==='study'){addExp('skill',11);log('你利用空闲时间读书。');}
 else if(a==='politics'){
  var ok2=s.rank>=1||visiblePeople().some(function(p){return getRel(p.n)>=55;});
  if(!ok2){log('你位份太低，也没有政治盟友。');return;}
  addExp('power',10);
  if(Math.random()<0.2){addExp('trust',-3);log('你积极活动，影响力上升，但引起警觉。');}
  else{addExp('trust',1);log('你参与政治事务。');}
 }else if(a==='govern'){
  var ok3=s.role==='official'||s.role==='merchant'||s.faction==='local'||s.faction==='civil';
  if(!ok3){log('你当前的身份不适合治理办事。');return;}
  addExp('fame',10);addExp('skill',4);addExp('trust',3);
  log('你处理公务，政绩渐显。');
 }else if(a==='earn'){
  var earn=0, where='';
  if(s.role==='merchant'){
   var g=s.faction==='local'||s.faction==='civil'?rnd(22,48):rnd(16,36);
   earn=g; where='跑了一趟货，账上多了 ';
  }else if(s.role==='student'){earn=rnd(6,16);where='替人抄书、写状纸，得 ';}
  else if(s.role==='official'){earn=rnd(10,26);where='经手公事，落下 ';}
  else if(s.role==='activist'){earn=rnd(5,15);where='替报馆写稿、代人通信，得 ';}
  else {earn=Math.round(rnd(8,20)*(s.rank+1));where='例饷与杂差，得 ';}
  earn=Math.round(earn);s.cash+=earn;
  log(where+earn+' 两。');
 }else if(a==='gift'){
  if(s.cash<40){log('你拿不出 40 两的礼。');return;}
  s.cash-=40;
  var gain=Math.round(rnd(6,12));
  s.supRel=clamp(supRel()+gain);
  addExp('trust',7);
  log('你备了份礼送到'+supOf().t+'府上，'+supOf().t+'收下了。上下之间松动了一些。');
 }else if(a==='buy'){
  if(s.cash<110){log('110 两的枪械，你买不起。');return;}
  s.cash-=110;
  addExp('fame',9);addExp('skill',4);s.fund+=20;
  log('你添了几支快枪、两箱子弹，又转手分给同僚，身价立时不同。');
 }else if(a==='fund'){
  if(s.cash<50){log('你拿不出 50 两。');return;}
  s.cash-=50;s.fund+=50;addExp('trust',5);addExp('power',3);
  log('你把 50 两输捐进公费，账房记了你的名。');
 }else if(a==='network'){
  var ps=visiblePeople();
  if(!ps.length){log('你没结识到什么要紧人物。');}
  else{var p=pick(ps);setRel(p.n,getRel(p.n)+9);addExp('trust',4);addExp('power',2);log('你设法接近'+p.n+'。');}
 }
 ['skill','fame','power','trust'].forEach(function(k){s[k]=clamp(s[k]);});
 actCool('act:'+a,15);
 persist();render();
}

/* ================= 上级与结社互动 ================= */
function handleSup(kind){
 var _sk='sup:'+kind;
 if(!actGate(_sk,({visit:'拜访上级',gift:'给上级送礼',ask:'请示提拔'})[kind]))return;
 var u=supOf();
 if(kind==='visit'){
  var d=Math.round(rnd(4,9));
  s.supRel=clamp(supRel()+d);addExp('trust',4);actCool(_sk,20);
  log('你去'+u.t+'处坐了半日。'+u.t+'说了些场面上的话，也提点你两句。');
 }else if(kind==='gift'){
  var _gc=giftCost(Math.min(7,(s.rank||0)+1));
  if(s.cash<_gc){flash('礼金不够：给'+u.t+'备礼约需 '+M(_gc)+'，手上只有 '+M(s.cash));render();return;}
  s.cash-=_gc;
  var g=Math.round(rnd(6,12));
  s.supRel=clamp(supRel()+g);addExp('trust',6);actCool(_sk,30);
  log('你把 '+M(_gc)+' 的礼送进'+u.t+'府里，回话比往日客气。');
 }else if(kind==='ask'){
  var R=s.rank;
  if(R>=7){log('你已至顶层。');render();return;}
  var _pb=(window.__netPatron?window.__netPatron():0);
  var avg=(s.skill+s.fame+s.power+s.trust)/4+_pb;
  actCool(_sk,90);
  var okAvg=avg>=GATE[R+1], okRel=supRel()>=45, okFee=s.cash>=(FEE[R+1]||0);
  if(!okAvg||!okRel||!okFee){
   var why=[];
   if(!okAvg)why.push('资历还浅（四项均分 '+avg.toFixed(1)+(_pb?'，含关系保举 +'+_pb:'')+' / 需 '+GATE[R+1]+'）');
   if(!okRel)why.push(''+u.t+'对你还不放心（好感 '+supRel()+' / 需 45）');
   if(!okFee)why.push('打点银钱不够（需 '+M(FEE[R+1]||0)+'）');
   log('你向上请示。'+u.t+'含糊地说了句“再等等”：'+why.join('、')+'。');
   s.supRel=clamp(supRel()-2);
  }else{
   var fee=FEE[R+1]||0;
   s.cash-=fee;
   var o=FAC[s.faction].ladder[R];s.rank++;
   log('你向上请示。'+u.t+'拍了板，你由「'+o+'」升为「'+FAC[s.faction].ladder[s.rank]+'」'+(fee?'，打点 '+M(fee):'')+'。');
  }
 }
 render();persist();
}

function handleClub(kind){
 if(!s.clubJoined||!CLUBS[s.club])return;
 var _ck='club:'+kind;
 if(!actGate(_ck,({act:'会中办事',donate:'捐输',arm:'联络新军'})[kind]))return;
 var c=CLUBS[s.club];
 if(kind==='act'){
  s.clubRel=clamp(s.clubRel+Math.round(rnd(5,11)));
  addExp('power',5);actCool(_ck,30);
  var texts={
   tongmeng:['你参加了一次秘密会议，屋里二十几个人，桌上摊着地图。','你替同盟会送了一封信，穿过三道岗哨。','你在会里听孙中山讲三民主义，散会时有人在门口记名。'],
   guangfu:['光复会的人又办了一份小报，你帮着递送。','你在茶楼与几位同志接头，说的是“起义”两个字。'],
   xingzhong:['兴中会的同志筹了一笔款，数目不大，来路危险。'],
   baohuang:['保皇会开会，讲的是立宪、请愿、皇上圣明。'],
   qingbang:['帮里开香堂，你按辈分给老头子磕了头。','码头上的纠纷由你来断，两边都给了面子。'],
   shanghui:['商会议事，你在席上替自己的行当说了几句。']
  };
  var arr=texts[s.club]||['会里的事办完了，人情也走到位了。'];
  log(pick(arr)+'（'+c.name+' 认可 +）');
 }else if(kind==='donate'){
  var _dc=[1,2,5,10,25,50,100,200][Math.max(0,Math.min(7,s.rank||0))];
  if(s.cash<_dc){flash('捐输需 '+M(_dc)+'，手上只有 '+M(s.cash));render();return;}
  s.cash-=_dc;
  s.clubRel=clamp(s.clubRel+9);addExp('fame',4);actCool(_ck,60);
  log('你向'+c.name+'捐输 '+M(_dc)+'，名册上添了你的名字。');
 }else if(kind==='arm'){
  if(s.cash<1.5){flash('联络新军要请客打点，约需 '+M(1.5)+'，你手头只有 '+M(s.cash));render();return;}
  s.cash-=1.5;actCool(_ck,90);
  if(Math.random()<0.45){
   s.clubRel=clamp(s.clubRel+12);s.relDelta=(s.relDelta||0);
   s.alt=Math.min(99,s.alt+1);addExp('power',7);addExp('skill',4);
   log('你联络的几位新军士兵答应“到时候听号令”。这条线埋下了。');
  }else{
   s.clubRel=clamp(s.clubRel-6);addExp('skill',3);
   log('新军里的人不肯点头，还有人说漏了嘴。风声有点紧。');
  }
 }
 render();persist();
}

/* ================= 晋升 ================= */
var GATE=[0,25,36,48,60,72,83,92];
/* 升到第 i 级需要的“打点银钱”（官场规矩：越往上越贵） */
var FEE=[0,0,10,80,300,800,2000,5000]; /* V4.18.5：实值两；捐纳与打点越往上越贵 */
/* 升到第 i 级需要的直属上级好感 */
var SUP_REQ=[0,0,0,0,0,45,57,69];

function supOf(){
 if(!s)return null;
 var m=SUP[s.faction]||SUP.civil;
 return m[s.role]||m.soldier||m.activist;
}
function supRel(){return s.supRel===undefined?50:s.supRel;}
function tryPromote(){
 if(s.rank>=7){log('你已在最高层级。');return;}
 var avg=(s.skill+s.fame+s.power+s.trust)/4+(window.__netPatron?window.__netPatron():0);
 if(avg<GATE[s.rank+1]){
  log('资历不够：升「'+FAC[s.faction].ladder[s.rank+1]+'」需要四项属性（能力/声望/政治/上级信任）的平均值 ≥'+GATE[s.rank+1]+'，你现在是 '+avg.toFixed(1)+'。');
  return;
 }
 var need=SUP_REQ[s.rank+1]||0;
 if(need&&supRel()<need){
  log('上级不点头：升这一级需要'+supOf().t+'好感 ≥'+need+'，现在 '+supRel()+'。去打点或送礼。');
  return;
 }
 var fee=FEE[s.rank+1]||0;
 if(fee>0){
  if(s.cash<fee){log('按例晋升「'+FAC[s.faction].ladder[s.rank+1]+'」需打点银钱 '+M(fee)+'，你还差 '+M(fee-s.cash)+'。');return;}
  s.cash-=fee;
 }
 var old=FAC[s.faction].ladder[s.rank];s.rank++;
 log('你由「'+old+'」晋升为「'+FAC[s.faction].ladder[s.rank]+'」'+(fee?'，打点花去 '+M(fee):'')+'。');
}


/* ================= V2.6：历史不是定局 ================= */
function verdict(){
 var N=s.natl;
 var win=null, why='';
 if(N.军事>=58 && N.民心>=55) win='强权统一';
 else if(N.民心>=60 && N.财政>=45) win='民心所向';
 else if(N.军事<38) win='外患深入';
 else win='割据分治';
 var owner;
 if(win==='强权统一'||win==='民心所向'){
  owner = N.军事>=58 ? '北方强人' : '南京方面';
  if(s.faction==='cpc' && N.民心>=55) owner='延安方面';
 }else if(win==='外患深入') owner='外军占领区';
 else owner='各路实力派';
 var d;
 if(s.year<1949) d='1945年，日本投降。此后天下没有按旧剧本走——'+(owner)+'正在成形。';
 else d=s.year+'年，局面已经落定：'+win+'。'+owner+'站到了台前。';
 if(s.faction==='cpc'&&win==='民心所向') d+=' 你所在的那支队伍，走到了它想要的地方。';
 if(s.faction==='kmt'&&win==='强权统一') d+=' 你所在的政府，把这场仗打赢了。';
 if(s.faction==='kmt'&&win==='民心所向') d+=' 但民心没有站在你这边，南京丢了人心。';
 return {t:'结局 · '+win,d:d};
}

/* ================= 渲染 ================= */
function render(){
 if(!s)return;
 var F=FAC[s.faction],rank=Math.max(0,Math.min(7,s.rank));s.rank=rank;

 if(s.pendingFaction){$('tFac').textContent='民间（待加入'+FAC[s.pendingFaction].name+'）';$('tFac').className='tag warn';}
 else{$('tFac').textContent=F.name;$('tFac').className='tag';}
 $('tAge').textContent=(s.year-s.birth)+'岁';
 $('tAlt').textContent='影响 '+s.alt;
 $('hName').textContent=s.name;
 $('hRole').textContent=roleName(s.role)+' · '+s.origin;
 $('hYear').textContent=s.year+'年';

 ['skill','fame','power','trust'].forEach(function(k){
  $('v'+cap(k)).textContent=s[k];
  $('b'+cap(k)).style.width=clamp(s[k])+'%';
  var e=s.exp[k]||0;
  $('e'+cap(k)).style.width=Math.min(100,e)+'%';
  $('x'+cap(k)).textContent=Math.floor(e)+'/100';
 });

 $('tAp').textContent=(s.jobs&&s.jobs.length)?('在建工程 '+s.jobs.length+' 项'):'';
 $('rName').textContent=(window.rankTitleOf?window.rankTitleOf():F.ladder[rank]);
 var avg=(s.skill+s.fame+s.power+s.trust)/4;
 var next=rank>=7?null:GATE[rank+1];
 if(next===null){$('rNext').textContent='最高层级';$('rBar').style.width='100%';}
 else{$('rNext').textContent='下一级：四项均分（能力/声望/政治/信任）≥'+next+'，当前 '+avg.toFixed(1);$('rBar').style.width=Math.max(0,Math.min(100,((avg-GATE[rank])/(next-GATE[rank]))*100))+'%';}

 $('tCash').textContent='现银 '+M(s.cash);
 $('tCash').className='tag';
 $('tFund').textContent='公费 '+M(s.fund);
 renderLadder();renderSup();renderClub();

 var L=leaderOf(s.faction,s.year);
 $('hierarchy').innerHTML='<b>最高领导：</b>'+L+'<br><b>你的职位：</b>'+(window.rankTitleOf?window.rankTitleOf():F.ladder[rank])+(s.pendingFaction?'<br><span style="color:var(--red)">待加入：'+FAC[s.pendingFaction].name+'（'+FAC[s.pendingFaction].min+'年）</span>':'');

 var ps=visiblePeople();
 ps.forEach(function(p){if(s.rel[p.n]===undefined)s.rel[p.n]=50;});
 $('peopleBox').innerHTML=ps.map(function(p){
  var r=getRel(p.n),cls=r>=70?'hi':r<=30?'lo':'';
  var st=pstateOf(p.n);
  var stTag=st&&st.state==='fallen'?'<span class="clq" style="color:var(--seal)">已失势</span>':st&&st.state==='promoted'?'<span class="clq" style="color:var(--pos)">已升迁</span>':'';
  return '<div class="person"><div class="phead"><b>'+p.n+'</b>'+stTag+
   '<span class="clq">'+(p.cl||'—')+'</span><span class="rel '+cls+'">'+r+'</span></div>'+
   '<div class="pdesc">'+p.d+'</div>'+
   '<div class="pbtns">'+
   '<button class="btn sm" data-n="'+p.n+'" data-k="visit" data-cd="meet:visit:'+p.n+'">拜访</button>'+
   '<button class="btn sm" data-n="'+p.n+'" data-k="learn" data-cd="meet:learn:'+p.n+'">请教</button>'+
   '<button class="btn sm" data-n="'+p.n+'" data-k="work" data-cd="meet:work:'+p.n+'">共事</button>'+
   '</div></div>';
 }).join('');

 $('powers').innerHTML=Object.keys(world.powers).map(function(k){
  var p=world.powers[k];
  return '<div class="pwr"><b>'+p.n+'</b><div class="pb"><i style="width:'+p.v+'%"></i></div><em>'+Math.round(p.v)+'</em></div>';
 }).join('');

 renderMap();
 $('logs').innerHTML=s.logs.join('');
}

function cap(k){return k.charAt(0).toUpperCase()+k.slice(1);}

/* ---------- 晋升之路 ---------- */
function renderLadder(){
 var el=$('ladderBox');if(!el||!s)return;
 var _pb=(window.__netPatron?window.__netPatron():0);
 var F=FAC[s.faction],avg=(s.skill+s.fame+s.power+s.trust)/4+_pb,cur=s.rank;
 var html='<ul class="ladder">';
 for(var i=0;i<F.ladder.length;i++){
  var need=GATE[i],fee=FEE[i],sreq=SUP_REQ[i];
  var cls=i===cur?'now':i<cur?'past':(avg>=need?'ready':'lock');
  var cond='四项均分≥'+need;
  if(fee)cond+=' · 打点 '+M(fee);
  if(sreq)cond+=' · 上级好感≥'+sreq;
  var mark=i===cur?'你在这一级':i<cur?'已过':(avg>=need&&(!sreq||supRel()>=sreq)?'已达门槛':'未达');
  html+='<li class="'+cls+'"><b>'+(i+1)+'. '+F.ladder[i]+'</b><span class="cond">'+cond+'</span><em>'+mark+'</em></li>';
 }
 html+='</ul>';
 var nx=cur<7?F.ladder[cur+1]:null;
 if(nx){
  var d1=Math.max(0,GATE[cur+1]-avg), d2=Math.max(0,(FEE[cur+1]||0)-s.cash), d3=Math.max(0,(SUP_REQ[cur+1]||0)-supRel());
  var gaps=[];
  gaps.push(d1>0?'四项均分还差 '+d1.toFixed(1):'四项均分已够');
  gaps.push(d2>0?'打点还差 '+M(d2):'打点钱够了');
  if(_pb)gaps.push('关系保举已计入 +'+_pb);
  if(SUP_REQ[cur+1])gaps.push(d3>0?'上级好感差 '+d3:'上级已认可');
  html+='<p class="small muted" style="margin:6px 0 0">下一级「'+nx+'」：'+gaps.join('；')+'。</p>';
 }else{html+='<p class="small muted" style="margin:6px 0 0">已至顶层。</p>';}
 el.innerHTML=html;
}

/* ---------- 直属上级 ---------- */
function renderSup(){
 var el=$('supBox');if(!el||!s)return;
 var u=supOf(),r=supRel(),cls=r>=70?'hi':r<=30?'lo':'';
 el.innerHTML='<div class="person"><div class="phead"><b>'+u.t+' · '+u.n+'</b>'+
  '<span class="clq">直属上级</span><span class="rel '+cls+'">'+r+'</span></div>'+
  '<div class="pdesc">'+u.d+'</div>'+
  '<div class="pbtns">'+
  '<button class="btn sm" data-sup="visit" data-cd="sup:visit">拜访</button>'+
  '<button class="btn sm" data-sup="gift" data-cd="sup:gift">送礼（'+M(giftCost(Math.min(7,(s.rank||0)+1)))+'）</button>'+
  '<button class="btn sm" data-sup="ask" data-cd="sup:ask">请示提拔</button>'+
  '</div></div>';
}

/* ---------- 组织与结社 ---------- */
function renderClub(){
 var el=$('clubBox');if(!el||!s)return;
 var c=CLUBS[s.club]||CLUBS.none,html='';
 if(!s.clubJoined){
  if(s.club==='none'){html='<p class="small muted">你还未入会。乱世里，没有同乡、同门、同党，办不成事。</p>';}
  else{html='<p class="small muted">你打算加入「'+c.name+'」，它在 '+s.clubSince+' 年成立，现在还成不了事。</p>';}
 }else{
  html='<div class="person"><div class="phead"><b>'+c.name+'</b>'+
   '<span class="clq">'+s.clubSince+'年入会</span><span class="rel '+(s.clubRel>=70?'hi':s.clubRel<=30?'lo':'')+'">'+s.clubRel+'</span></div>'+
   '<div class="pdesc">'+c.desc+'</div>'+
   '<div class="small muted">年会费 '+M(c.fee)+' · 组织活动可提升资历与声望</div>'+
   '<div class="pbtns">'+
   '<button class="btn sm" data-club="act" data-cd="club:act">办事</button>'+
   '<button class="btn sm" data-club="donate" data-cd="club:donate">捐输（'+M([1,2,5,10,25,50,100,200][Math.max(0,Math.min(7,s.rank||0))])+'）</button>'+
   (['tongmeng','guangfu','xingzhong'].indexOf(s.club)>=0?'<button class="btn sm" data-club="arm" data-cd="club:arm">联络新军</button>':'')+
   '</div></div>';
 }
 el.innerHTML=html;
}

/* ================= 地图渲染 ================= */
function renderWorld(){
 var wl=$('worldLayer');
 if(!wl||!window.WORLD_DATA||!window.WORLD_DATA.rings)return;
 if(wl.dataset.sig===worldSig())return;
 var frag='';
 window.WORLD_DATA.rings.forEach(function(r){
  var d='';
  r.c.forEach(function(p,i){
   var q=geoToSvg(p[0],p[1]);
   d+=(i?'L':'M')+q[0].toFixed(1)+','+q[1].toFixed(1);
  });
  d+='Z';
  var own=(world&&world.owner&&world.owner[r.n])||null;
  var fill=own?(CTRL_COLOR[own]||'#bdb8ab'):'#e7e0d0';
  var op=own?'0.92':'1';
  frag+='<path class="wnode" data-name="'+r.n+'" d="'+d+'" fill="'+fill+'" fill-opacity="'+op+'" stroke="#f7f4ec" stroke-width="0.8"/>';
 });
 // 每个国家只取面积最大的一块放名字
 var best={};
 window.WORLD_DATA.rings.forEach(function(r){
  var xs=r.c.map(function(p){return p[0];}), ys=r.c.map(function(p){return p[1];});
  var w=(Math.max.apply(null,xs)-Math.min.apply(null,xs))*(Math.max.apply(null,ys)-Math.min.apply(null,ys));
  if(!best[r.n]||best[r.n].w<w) best[r.n]={w:w,n:r.n,cx:(Math.max.apply(null,xs)+Math.min.apply(null,xs))/2,cy:(Math.max.apply(null,ys)+Math.min.apply(null,ys))/2};
 });
 Object.keys(best).forEach(function(k){
  var b=best[k];
  if(b.w<6)return;
  var q=geoToSvg(b.cx,b.cy);
  frag+='<text x="'+q[0].toFixed(1)+'" y="'+q[1].toFixed(1)+'" text-anchor="middle" font-size="10" fill="#9a927f">'+k+'</text>';
 });
 wl.innerHTML=frag;
 wl.dataset.sig=worldSig();
 wl.querySelectorAll('path.wnode').forEach(function(p){
  p.style.cursor='pointer';
  p.addEventListener('click',function(ev){ ev.stopPropagation(); openCountry(p.getAttribute('data-name')); });
 });
}

var VIEW={x:45,y:36,w:570,h:353};   // 初始视野：中国本境
var VIEW_MAX={x:0,y:0,w:760,h:480};

function worldSig(){
 var o=(world&&world.owner)||{};
 return Object.keys(o).sort().map(function(k){return k+o[k];}).join('|');
}

function applyView(){
 var svg=$('chinaMap');
 if(!svg)return;
 var vb=VIEW;
 var boxAR=VIEW.w/VIEW.h;
 // 让视野比例贴合容器，避免拉伸
 var rect=svg.getBoundingClientRect();
 if(rect&&rect.width&&rect.height){
  var ar=rect.width/rect.height;
  if(ar>boxAR){ var nh=VIEW.w/ar; vb={x:VIEW.x,y:VIEW.y+(VIEW.h-nh)/2,w:VIEW.w,h:nh}; }
  else{ var nw=VIEW.h*ar; vb={x:VIEW.x+(VIEW.w-nw)/2,y:VIEW.y,w:nw,h:VIEW.h}; }
 }
 svg.setAttribute('viewBox',vb.x.toFixed(1)+' '+vb.y.toFixed(1)+' '+vb.w.toFixed(1)+' '+vb.h.toFixed(1));
}

function clampView(){
 VIEW.w=Math.max(120,Math.min(760,VIEW.w));
 VIEW.h=VIEW.w*(VIEW_MAX.h/VIEW_MAX.w);
 VIEW.x=Math.max(0,Math.min(760-VIEW.w,VIEW.x));
 VIEW.y=Math.max(0,Math.min(480-VIEW.h,VIEW.y));
}

function initMapPan(){
 // V4.0：地图不再拖动/缩放，否则点不中省份与邻国
 VIEW={x:40,y:30,w:580,h:360};
 applyView();
}


function renderMap(){
 renderWorld();
 var layer=$('regionLayer');
 if(!layer)return;
 layer.innerHTML='';

 if(!mapFeatures){
  var loading=document.createElementNS('http://www.w3.org/2000/svg','text');
  loading.setAttribute('x','300');
  loading.setAttribute('y','200');
  loading.setAttribute('text-anchor','middle');
  loading.setAttribute('font-size','13');
  loading.setAttribute('fill','#8a887e');
  loading.textContent=mapLoading?'地图数据加载中...':'等待地图数据...';
  layer.appendChild(loading);
  return;
 }

 mapFeatures.forEach(function(f){
  var ctrl='qing';
  if(world&&world.owner&&world.owner[f.name]){
   ctrl=world.owner[f.name];
  }else if(world&&world.regions&&world.regions[f.name]){
   ctrl=world.regions[f.name].ctrl;
  }else{
   ctrl=getDefaultCtrl(f.name,s?s.year:1840);
  }
  var color=CTRL_COLOR[ctrl]||'#bdb8ab';

  var g=document.createElementNS('http://www.w3.org/2000/svg','g');
  g.setAttribute('class','region');

  var path=document.createElementNS('http://www.w3.org/2000/svg','path');
  path.setAttribute('d',f.path);
  path.setAttribute('fill',color);
  path.setAttribute('stroke','#f7f4ec');
  path.setAttribute('stroke-width','0.7');
  path.setAttribute('opacity','0.9');
  g.appendChild(path);

  // 面积足够的省才显示名称
  var short=SHORT_NAME[f.name]||f.name;
  var label=document.createElementNS('http://www.w3.org/2000/svg','text');
  label.setAttribute('x',f.cx);
  label.setAttribute('y',f.cy);
  label.setAttribute('text-anchor','middle');
  label.setAttribute('font-size','9');
  label.setAttribute('fill','#fff');
  label.setAttribute('font-weight','600');
  label.setAttribute('pointer-events','none');
  label.textContent=short;
  g.appendChild(label);

  g.addEventListener('click',function(){
   var info=(world&&world.regions&&world.regions[f.name])||{ctrl:ctrl,str:40};
   openRegion({n:f.name,cx:f.cx,cy:f.cy},info);
  });

  layer.appendChild(g);
 });

 $('legend').innerHTML=Object.keys(CTRL_COLOR).map(function(k){
  return '<span><i class="dot" style="background:'+CTRL_COLOR[k]+'"></i>'+CTRL_NAME[k]+'</span>';
 }).join('');
 $('worldNote').textContent=world&&world.log.length?world.log[world.log.length-1]:'世界按历史惯性运转。';
 initMapPan();
}

/* ================= 区域详情 ================= */
function openRegion(reg,info){
 $('dlgTag').textContent='区域 · '+reg.n;
 $('dlgTitle').textContent=reg.n;
 var ctrlName=CTRL_NAME[info.ctrl]||info.ctrl;
 $('dlgDesc').textContent='控制方：'+ctrlName+'　|　驻军约 '+fmtMen(garrisonOf(info.ctrl,info.str))+'（兵力指数 '+Math.round(info.str)+'）';
 var body=$('dlgBody');body.innerHTML='';

 var p=document.createElement('p');
 p.className='small';
 p.textContent='该区域目前处于'+ctrlName+'控制之下，驻军约 '+fmtMen(garrisonOf(info.ctrl,info.str))+'（按当年全国兵额与本地兵力指数估算）。';
 body.appendChild(p);

 if(info.ctrl===s.faction||(s.pendingFaction&&info.ctrl===s.pendingFaction)){
  var b2=document.createElement('button');
  b2.className='choice';
  var _rgKey='region:'+reg.n, _rgBusy=actBusy(_rgKey);
  b2.innerHTML='<b>整饬本地防务</b><div class="sub">加强该区域驻军（兵力指数 +8）；约 '+dayCost(_rgKey,30)+' 天。</div>'+(_rgBusy?'<div class="chance" style="color:var(--red)">'+actBusyText(_rgBusy)+'</div>':'');
  if(_rgBusy)b2.disabled=true;
  b2.onclick=function(){
   if(!actGate(_rgKey,'整饬'+reg.n+'防务'))return;
   info.str=Math.min(100,info.str+8);
   addExp('skill',4);addExp('power',3);
   actCool(_rgKey,60);
   log('你在'+reg.n+'整饬防务。');
   $('mask').classList.add('hidden');
   persist();render();
  };
  body.appendChild(b2);
 }

 var close=document.createElement('button');
 close.className='choice';close.style.textAlign='center';
 close.innerHTML='<b>关闭</b>';close.onclick=function(){$('mask').classList.add('hidden');};
 body.appendChild(close);
 $('mask').classList.remove('hidden');
}

/* ================= 事件 ================= */
function maybeEvent(){
 var ev=null;
 for(var i=0;i<EVENTS.length;i++){if(EVENTS[i].y===s.year&&!s.evDone[EVENTS[i].id]&&evDue(EVENTS[i])){ev=EVENTS[i];break;}}
 if(!ev){if(s.curEventYear!==s.year)$('curEvent').textContent=s.year+'年 · 局势相对平静。';return;}
 s.evDone[ev.id]=true;s.curEventYear=s.year;
 $('curEvent').textContent=ev.t+'：'+ev.d;
 showEvent(ev);
}

function showEvent(ev){
 $('dlgTag').textContent='历史抉择 · '+((s&&s.cal&&ev.y===s.year)?calFmtOrd(s.cal.ord):(ev.y+'年'));
 $('dlgTitle').textContent=ev.t;$('dlgDesc').textContent=ev.d;
 var body=$('dlgBody');body.innerHTML='';
 if(ev.who&&ev.who.indexOf(s.faction)<0){
  var b=document.createElement('button');b.className='choice';
  b.innerHTML='<b>旁观</b><div class="sub">你所在的阵营不在这场博弈的中心。</div>';
  b.onclick=function(){log('【'+ev.t+'】你只能旁观。');addExp('skill',2);$('mask').classList.add('hidden');persist();render();};
  body.appendChild(b);
 }else{
  ev.opts.forEach(function(o){
   if(o.fac&&o.fac.indexOf(s.faction)<0)return;
   if(o.club&&(!s.clubJoined||o.club.indexOf(s.club)<0))return;
   if(o.cond&&!o.cond())return;
   var ok=true,why='';
   if(o.rmin!==undefined&&s.rank<o.rmin){ok=false;why='需要第'+(o.rmin+1)+'级及以上';}
   if(o.req){var reqNames={skill:'能力',fame:'声望',power:'政治影响',trust:'上级信任'};var unmet=[];Object.keys(o.req).forEach(function(k){var need=Number(o.req[k])||0;if((Number(s[k])||0)<need)unmet.push((reqNames[k]||k)+'≥'+need+'（当前'+(Number(s[k])||0)+'）');});if(unmet.length){ok=false;why='条件未达标：'+unmet.join('、');}}
   var b=document.createElement('button');b.className='choice';
   var hint='';
   if(!ok)hint='<div class="chance" style="color:var(--red)">'+why+'</div>';
   else if(o.risk){var base=s.skill*0.4+s.fame*0.2+s.power*0.15+s.trust*0.25;
    hint='<div class="chance">成功率约'+Math.round(Math.max(10,Math.min(90,10+base/100*80)))+'%</div>';}
   b.innerHTML='<b>'+o.t+'</b><div class="sub">'+o.d+'</div>'+hint;
   if(!ok)b.disabled=true;
   else b.onclick=function(){chooseEvent(ev,o);};
   body.appendChild(b);
  });
 }
 $('mask').classList.remove('hidden');
}

function chooseEvent(ev,o){
 var base=s.skill*0.4+s.fame*0.2+s.power*0.15+s.trust*0.25;
 var win=o.risk?Math.random()<Math.max(0.1,Math.min(0.9,0.1+base/100*0.8)):true;
 var text='';try{text=o.run(s,win);}catch(e){text='局势变化超出预料。';}
 ['skill','fame','power','trust'].forEach(function(k){s[k]=clamp(s[k]);});
 log('【'+ev.t+'】'+text);
 try{ if(!Array.isArray(s.histRec))s.histRec=[]; s.histRec.push({ord:calTodayOrd(),y:s.year,id:ev.id,t:ev.t,c:o.t}); if(s.histRec.length>200)s.histRec=s.histRec.slice(-200); }catch(e){}
 $('mask').classList.add('hidden');tryPromote();persist();render();
}

/* ================= 推进 ================= */
function advance(){
 if(!s||s.dead)return;
 s.year++; try{if(window.__yearTick)window.__yearTick();}catch(e){}
 if(s.pendingFaction&&s.year>=FAC[s.pendingFaction].min){
  var target=s.pendingFaction;s.faction=target;s.pendingFaction=null;s.rank=Math.min(s.rank,2);
  log('【'+s.year+'年】'+FAC[target].name+'正式成立。你以民间身份积累的资历得到部分认可，正式加入。');
 }
 var wl=advanceWorld(s.year).concat(advancePeople(s.year));
 wl.forEach(function(t){world.log.push(t);log('世界局势：'+t);});
 /* —— 结社年度结算 —— */
 if(s.club&&s.club!=='none'&&CLUBS[s.club]){
  var C=CLUBS[s.club];
  if(!s.clubJoined&&s.year>=C.min){
   s.clubJoined=true;s.clubSince=C.min;
   log('【'+s.year+'年】'+C.name+'在此时已经成气候，你正式入会。');
  }else if(s.clubJoined){
   if(s.cash>=C.fee){s.cash-=C.fee;
    if(Math.random()<0.55){s.clubRel=clamp(s.clubRel+3);}
   }else{
    s.clubRel=clamp(s.clubRel-8);
    log('你交不出'+C.name+'的会费（'+M(C.fee)+'），会里对你有些看法。');
   }
  }
 }
 /* —— 公费随职位增长 —— */
 s.fund+=Math.round((s.rank+1)*rnd(6,14));
 if(s.year-s.birth>30)addExp('skill',2);
 render(); /* V4.17：历史事件改由时钟按日期触发，不再在年初一次性弹出 */
 if(!s.dead&&checkDeath()){s.dead=true;s.deadYear=s.year;s.deathCause=s.deathCause||'年迈';endGame('你走完了自己的一生。');return;}
 persist();
}

function checkDeath(){
 var age=s.year-s.birth,p=0;
 if(age>=85)p=0.55;else if(age>=80)p=0.35;else if(age>=75)p=0.2;
 else if(age>=70)p=0.09;else if(age>=65)p=0.03;
 return p>0&&Math.random()<p;
}

function endGame(reason){
 var F=FAC[s.faction],rank=s.rank;
 $('dlgTag').textContent='人生终章';
 $('dlgTitle').textContent=s.name+' · '+s.year+'年';
 $('dlgDesc').textContent=reason;
 var lv=s.alt>=20?'历史改写者':s.alt>=12?'历史的参与者':s.alt>=5?'时代的见证者':'时代的过客';
 $('dlgBody').innerHTML='<div class="small" style="line-height:2">'+
  '<div><b>阵营：</b>'+F.name+'</div><div><b>最终身份：</b>'+rankTitleOf()+'</div>'+
  '<div><b>属性：</b>能力'+s.skill+' · 声望'+s.fame+' · 政治'+s.power+' · 信任'+s.trust+'</div>'+
  '<div><b>历史影响：</b>'+s.alt+'（'+lv+'）</div>'+
  '<div style="margin-top:6px;color:var(--muted)">'+(s.year-s.birth)+'岁，'+s.year+'年。</div></div>'+
  '<button class="choice" id="endRestart" style="text-align:center"><b>重新开始</b></button>';
 $('mask').classList.remove('hidden');
 document.getElementById('endRestart').onclick=function(){
  $('mask').classList.add('hidden');s=null;world=null;
  $('game').classList.add('hidden');$('setup').classList.remove('hidden');
 };
 persist();
}

/* ================= 建角 ================= */
function fillYears(){
 var fac=$('fFac').value,min=FAC[fac].min;
 var starts=[];for(var y=1840;y<=1949;y++)starts.push(y);
 var def=Math.max(1840,min);
 $('fStart').innerHTML=starts.map(function(y){return '<option value="'+y+'"'+(y===def?' selected':'')+'>'+y+'</option>';}).join('');
 var births=[];for(var y2=1820;y2<=1948;y2++)births.push(y2);
 var defB=Math.max(1820,def-20);
 $('fBirth').innerHTML=births.map(function(y){return '<option value="'+y+'"'+(y===defB?' selected':'')+'>'+y+'</option>';}).join('');
 syncBirth();
}
function syncBirth(){
 var start=+$('fStart').value,sel=$('fBirth'),cur=+sel.value;
 if(cur>=start){
  var valid=Array.prototype.slice.call(sel.options).map(function(o){return +o.value;})
   .filter(function(y){return y<start;}).sort(function(a,b){return b-a;})[0];
  sel.value=String(valid!==undefined?valid:start-1);
 }
 updateHint();
}
function updateHint(){
 var fac=$('fFac').value,start=+$('fStart').value,min=FAC[fac].min,h=$('hint');
 if(start<min){h.innerHTML='注意：「'+FAC[fac].name+'」于'+min+'年成立。你将从'+start+'年起以民间身份生活，到'+min+'年自动加入。';h.style.color='var(--red)';}
 else{h.textContent='「'+FAC[fac].name+'」自'+min+'年起可加入。';h.style.color='var(--muted)';}
}

function fillClubs(){
 var el=$('fClub');if(!el)return;
 var out=['<option value="none">不入会</option>'];
 Object.keys(CLUBS).forEach(function(k){
  if(k==='none')return;
  var c=CLUBS[k];
  out.push('<option value="'+k+'">'+c.name+'（'+c.min+'年成立）</option>');
 });
 el.innerHTML=out.join('');
}

function init(){
 var fac=$('fFac').value,start=+$('fStart').value,birth=+$('fBirth').value;
 if(!birth || birth>=start || birth<1800){ birth = start - 20; }
 if(birth>=start){alert('出生年份需早于开始年份。');return;}
 var F=FAC[fac],pending=start<F.min;
 s={name:($('fName').value||'').trim()||'无名氏',birth:birth,year:start,
  faction:pending?'civil':fac,pendingFaction:pending?fac:null,
  role:$('fRole').value,origin:$('fOrigin').value,
  skill:25,fame:10,power:5,trust:50,
  exp:{skill:0,fame:0,power:0,trust:0},breakthrough:{skill:0,fame:0,power:0,trust:0},
  rank:0,alt:0,logs:[],rel:{},evDone:{},dead:false,
  institution:null,institutionYear:null,institutionHistory:[],
  constitution:{stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty',history:[]},
  cash:80,fund:20,supRel:50,club:'none',clubRel:50,clubSince:null,clubJoined:false,paidFee:{} };
 var cashMap={'皇室家庭':3000,'乡绅家庭':800,'商人家庭':500,'军人家庭':160,'知识分子家庭':200,'普通家庭':120};
 s.cash=cashMap[s.origin]||120;
 var addRole={soldier:60,officer:120,official:90,student:20,merchant:320,activist:40}[s.role]||0;
 s.cash+=addRole;
 s.fund=Math.round(s.cash*0.15)+(s.rank||0)*0;
 var clubSel=$('fClub')?$('fClub').value:'none';
 if(clubSel&&clubSel!=='none'&&CLUBS[clubSel]&&CLUBS[clubSel].min<=start){
  s.club=clubSel;s.clubJoined=true;s.clubSince=CLUBS[clubSel].min;
 }else if(clubSel&&clubSel!=='none'){s.club=clubSel;s.clubJoined=false;s.clubSince=CLUBS[clubSel].min;}
 var rb={soldier:{skill:5,fame:2},officer:{skill:8,trust:5},official:{skill:5,power:5},
  student:{skill:8,fame:3},merchant:{fame:6,power:3},activist:{power:6,skill:3}}[s.role]||{};
 for(var k in rb)s[k]+=rb[k];
 var ob={'皇室家庭':{fame:15,power:15,skill:2},'乡绅家庭':{fame:4},'军人家庭':{skill:4},'商人家庭':{fame:3,power:2},'知识分子家庭':{skill:4,power:2}}[s.origin]||{};
 for(var k2 in ob)s[k2]+=ob[k2];
 world=initWorld(start);
 $('setup').classList.add('hidden');$('game').classList.remove('hidden');
 if(pending)log('你以'+s.origin+'出身，'+start+'年，'+F.name+'尚未成立，你以民间身份生活。');
 else if(s.isThrone) log('你以'+s.origin+'出身登上大位，'+s.year+'年起，天下事由你定。');
 else if(s.isLeader) log('你以'+s.origin+'出身坐到本阵营的首席，'+s.year+'年起，方向由你拿主意。');
 else log('你以'+s.origin+'出身，成为'+roleName(s.role)+'，加入'+F.name+'。');
 calEnsure(s);
 render();persist();

 // 触发地图加载
 loadChinaMap(function(){
  renderMap();
 });
}

/* ================= 绑定 ================= */
$('fFac').addEventListener('change',fillYears);
$('fStart').addEventListener('change',syncBirth);
$('btnBegin').onclick=init;
document.querySelectorAll('[data-act]').forEach(function(b){b.addEventListener('click',function(){doAction(b.dataset.act);});});
$('peopleBox').addEventListener('click',function(e){
 var b=e.target.closest('[data-n]');if(b)openInteraction(b.dataset.n,b.dataset.k);
});
$('supBox').addEventListener('click',function(e){
 var b=e.target.closest('[data-sup]');if(b)handleSup(b.dataset.sup);
});
$('clubBox').addEventListener('click',function(e){
 var b=e.target.closest('[data-club]');if(b)handleClub(b.dataset.club);
});
$('btnPromote').onclick=function(){var _o=s.rank;tryPromote();if(s.rank===_o)flash('暂时升不上去，原因见编年史与「晋升之路」。');render();persist();};
function slotKey(k){return 'shanhe_slot_'+k;}
function packSave(){
 return {v:'1.7',ts:Date.now(),name:s.name,year:s.year,rank:s.rank,faction:s.faction,s:s,world:world};
}
function slotText(k){
 var raw=localStorage.getItem(slotKey(k));
 if(!raw)return '空';
 try{var d=JSON.parse(raw);return (d.name||'无名')+' · '+(d.date||((d.year||'?')+'年'))+' · '+(d.v||'');}
 catch(e){return '损坏';}
}
function refreshSlots(){
 var k=$('slotSel')?$('slotSel').value:'auto';
 if($('slotInfo'))$('slotInfo').textContent='当前槽：'+slotText(k);
}
function applySave(d){
 if(!d||!d.s||!FAC[d.s.faction])throw new Error('bad');
 s=d.s;world=d.world||initWorld(s.year);
 s.exp=s.exp||{skill:0,fame:0,power:0,trust:0};
 s.breakthrough=s.breakthrough||{skill:0,fame:0,power:0,trust:0};
 s.rel=s.rel||{};s.evDone=s.evDone||{};s.logs=s.logs||[];s.alt=s.alt||0;
 if(s.pendingFaction===undefined)s.pendingFaction=null;
 if(s.cash===undefined)s.cash=120;
 if(s.fund===undefined)s.fund=20;
 if(s.supRel===undefined)s.supRel=50;
 if(s.club===undefined)s.club='none';
 if(s.clubRel===undefined)s.clubRel=50;
 if(s.clubJoined===undefined)s.clubJoined=false;
 if(!world.regions){world=initWorld(s.year);}
 PROVINCES.forEach(function(p){
  if(!world.regions[p])world.regions[p]={ctrl:getDefaultCtrl(p,s.year),str:rnd(30,55)};
 });
 if(!world.pstate)world.pstate={};
 $('setup').classList.add('hidden');$('game').classList.remove('hidden');$('mask').classList.add('hidden');
 render();loadChinaMap(function(){renderMap();});
}
$('slotSel').addEventListener('change',refreshSlots);
$('btnSave').onclick=function(){
 if(!s)return;
 var k=$('slotSel').value;
 try{localStorage.setItem(slotKey(k),JSON.stringify(packSave()));refreshSlots();flash('已存入 '+(k==='auto'?'自动存档':'槽 '+k));}
 catch(e){flash('保存失败');}
};
$('btnLoad').onclick=function(){
 var k=$('slotSel').value;
 try{var raw=localStorage.getItem(slotKey(k));if(!raw){flash('这个槽是空的');return;}
  applySave(JSON.parse(raw));refreshSlots();flash('已读取 '+(k==='auto'?'自动存档':'槽 '+k));}
 catch(e){flash('读取失败');}
};
$('btnDel').onclick=function(){
 var k=$('slotSel').value;
 if(!localStorage.getItem(slotKey(k))){flash('这个槽是空的');return;}
 if(!confirm('删除这个存档？'))return;
 localStorage.removeItem(slotKey(k));refreshSlots();flash('已删除');
};
$('btnExport').onclick=function(){
 if(!s){flash('还没有角色');return;}
 var blob=new Blob([JSON.stringify(packSave(),null,1)],{type:'application/json'});
 var a=document.createElement('a');
 a.href=URL.createObjectURL(blob);
 a.download='shanhe_'+(s.name||'save')+'_'+s.year+'.json';
 document.body.appendChild(a);a.click();document.body.removeChild(a);
 flash('已导出');
};
$('btnImport').onclick=function(){$('fileImport').click();};
$('fileImport').addEventListener('change',function(){
 var f=this.files&&this.files[0];if(!f)return;
 var rdr=new FileReader();
 rdr.onload=function(){
  try{applySave(JSON.parse(rdr.result));flash('已导入');}
  catch(e){flash('这个文件读不出来');}
 };
 rdr.readAsText(f,'utf-8');
 this.value='';
});
$('btnLoad').onclick=function(){
 var k=$('slotSel')?$('slotSel').value:'auto';
 try{
  var raw=localStorage.getItem(slotKey(k));
  if(!raw&&k==='auto') raw=localStorage.getItem(SAVE_KEY); // 兼容旧版自动存档
  if(!raw){flash('这个槽是空的');return;}
  applySave(JSON.parse(raw));
  refreshSlots();flash('已读取 '+(k==='auto'?'自动存档':'槽 '+k));
 }catch(e){flash('读取失败：存档格式不兼容或文件损坏');}
};
$('btnReset').onclick=function(){
 if(confirm('确定重新开始吗？')){s=null;world=null;$('game').classList.add('hidden');$('setup').classList.remove('hidden');$('mask').classList.add('hidden');$('saveMsg').textContent='';}
};
$('mask').addEventListener('click',function(e){if(e.target===$('mask'))$('mask').classList.add('hidden');});
function flash(t){$('saveMsg').textContent=' '+t;setTimeout(function(){$('saveMsg').textContent='';},1600);}
function roleName(r){return {soldier:'普通士兵',officer:'基层军官',official:'基层文官',student:'学生',merchant:'商人',activist:'革命活动者'}[r]||'平民';}

fillYears();
fillClubs();
if($('slotSel'))$('slotSel').addEventListener('change',refreshSlots);

/* ================= V2.0：部队 / 派系 / 人际 / 报纸 / 国势 / 结局 ================= */
var CLIQUES = {
 qing:   [{n:'湘淮旧部',d:'靠军功与乡谊起家，讲实务，瞧不上京里的清议。',b:'士气'},
          {n:'清流士林',d:'翰林与御史的圈子，讲名节，弹章能杀人。',b:'声望'},
          {n:'洋务新派',d:'办厂、办船政、办电报的人，手里有洋人和机器。',b:'军械'}],
 beiyang:[{n:'皖系',d:'段祺瑞一脉，重兵工与参战军。',b:'军械'},
          {n:'直系',d:'冯国璋、曹锟一脉，占着长江与京畿富庶地方。',b:'军饷'},
          {n:'奉系',d:'张作霖的关外兵马，财大气粗，最讲义气。',b:'士气'}],
 kmt:    [{n:'黄埔系',d:'校长门生，讲究服从与战功，中央军的骨架。',b:'军械'},
          {n:'CC系',d:'党务系统，管组织、管人事、管审查。',b:'声望'},
          {n:'地方实力派',d:'各省挂青天白日旗的地方军头，听调不听编。',b:'军饷'}],
 cpc:    [{n:'苏区派',d:'从江西苏区打出来的人，讲群众工作与游击。',b:'士气'},
          {n:'白区派',d:'搞地下工作与统战的人，路子野，消息灵。',b:'声望'},
          {n:'军事派',d:'带兵的人，讲兵力与阵地。',b:'军械'}],
 local:  [{n:'本乡团练',d:'同乡、同族、同祠堂，守的是自己那一亩三分地。',b:'士气'},
          {n:'帮会势力',d:'码头、烟馆、盐场里的关系网。',b:'军饷'}],
 civil:  [{n:'实业派',d:'办厂、办银行、办报的人，认钱也认国运。',b:'军饷'},
          {n:'教育派',d:'学堂、师范、报刊的圈子，讲启蒙。',b:'声望'},
          {n:'地方士绅',d:'县里的公事靠他们张罗，官府也得给面子。',b:'声望'}]
};

var NAT_KEYS = [['稳定','政治稳定'],['经济','经济'],['军事','军事'],['财政','财政'],['秩序','社会秩序'],['民心','民心'],['国际','国际地位'],['工业','工业化']];

function initExt(){
 if(!s) return;
 if(!s.unit) s.unit={troops:0,mor:55,sup:55};
 if(typeof s.unit.troops!=='number') s.unit.troops=0;
 if(s.clique===undefined) s.clique=null;
 if(!s.natl) s.natl={稳定:62,经济:38,军事:45,财政:40,秩序:55,民心:50,国际:30,工业:15};
 if(!s.rel2) s.rel2={};
 if(!s.paper) s.paper=null;
 if(!s.ending) s.ending=null;
}

function isMil(){ return ['soldier','officer'].indexOf(s.role)>=0 || /军|兵|团长|师长|旅长/.test(FAC[s.faction].ladder[s.rank]||''); }

/* ---------- 部队 ---------- */
function unitAct(kind){
 if(!s) return;
 if(!isMil()){flash('你不是带兵的人，没有部伍可以调动。');render();return;}
 if(!actGate('unit:'+kind,({rec:'招募',drill:'部队操练',fight:'开拔作战'})[kind]))return;
 var U=s.unit, R=Math.max(0,Math.min(7,s.rank||0)), est=UNIT_EST[R];
 if(kind==='rec'){
  if(U.troops>=est*1.1){flash('所部 '+fmtMen(U.troops)+'，已超编制（约 '+fmtMen(est)+'），上头不会再给兵额。');render();return;}
  var n=Math.max(3,Math.round(est*0.1)), cost=Math.round(n*3*100)/100, fund=+s.fund||0;
  if(fund+(+s.cash||0)<cost){flash('招募 '+fmtMen(n)+' 需安家银约 '+M(cost)+'（公费 '+M(fund)+'，现银 '+M(s.cash||0)+'）');render();return;}
  var fromFund=Math.min(fund,cost); s.fund=fund-fromFund; s.cash=(+s.cash||0)-(cost-fromFund);
  U.troops+=n;U.mor=clamp(U.mor+2);actCool('unit:rec',20);
  log('你挂旗招兵，来了 '+n+' 个吃粮的人，发安家银 '+M(cost)+'（所部共 '+fmtMen(U.troops)+'）。');
 }else if(kind==='drill'){
  var g=Math.round(rnd(6,11));
  U.mor=clamp(U.mor+g); U.sup=clamp(U.sup-Math.round(rnd(1,3))); addExp('skill',4);
  actCool('unit:drill',30);
  log('部队操练一月：列队、装弹、上刺刀；士气 +'+g+'。');
 }else if(kind==='fight'){
  var en=Math.round(Math.max(10,U.troops)*rnd(0.6,1.5));
  var ratio=Math.max(10,U.troops)/Math.max(10,en);
  var p=clamp(0.2+0.25*Math.min(2,ratio)+U.mor/400+U.sup/400+s.skill/400+(s.clique?0.05:0),0.08,0.9);
  var win=Math.random()<p;
  var loss=Math.round(U.troops*(win?rnd(0.03,0.08):rnd(0.08,0.18)));
  U.troops=Math.max(0,U.troops-loss);
  U.mor=clamp(U.mor+(win?Math.round(rnd(4,9)):-Math.round(rnd(6,13))));
  U.sup=clamp(U.sup-Math.round(rnd(8,16)));
  actCool('unit:fight',45);
  if(win){
   addExp('skill',6);addExp('fame',8);s.trust=clamp(s.trust+Math.round(rnd(2,5)));s.alt+=1;
   log('【开拔】与约 '+fmtMen(en)+' 的敌军接战，伤亡 '+fmtMen(loss)+'，阵地拿下来了。'+(s.isThrone||s.isLeader?'捷报送进京，朝野都在看你的下一道旨意。':'上面对你有了印象。'));
  }else{
   s.trust=clamp(s.trust-Math.round(rnd(3,7)));addExp('fame',2);
   log('【开拔】与约 '+fmtMen(en)+' 的敌军接战失利，伤亡 '+fmtMen(loss)+'，退到二十里外收拢队伍；'+(s.isThrone||s.isLeader?'败报压不住，御史已经在拟参你的折子。':'上峰的电报很难看。'));
  }
  if(U.troops<=0){log('你的队伍打散了，剩下的人把枪埋在土里回了乡。');}
 }
 persist();render();
}

/* ---------- 派系 ---------- */
function joinClique(i){
 var list=CLIQUES[s.faction]||[];
 if(!list[i])return;
 if(s.clique===list[i].n){log('你已经在「'+list[i].n+'」里了。');return;}
 if(!actGate('clique','改投派系'))return;
 s.clique=list[i].n;actCool('clique',180);
 s.trust=clamp(s.trust+(i===0?3:1));
 log('你递了帖子，进了「'+list[i].n+'」。'+(list[i].d||''));
 persist();render();
}

/* ---------- 人际（三维关系） ---------- */
function relOf(n){
 if(!s.rel2[n]) s.rel2[n]={f:getRel(n),i:40,c:50};
 return s.rel2[n];
}
function relAct(name,kind){
 var _rk='rel:'+kind+':'+name;
 if(!actGate(_rk,({gift:'送礼',talk:'深谈',stand:'公开表态'})[kind]))return;
 var R=relOf(name);
 if(kind==='gift'){
  var _rg=giftCost(Math.min(7,(s.rank||0)+1));
  if(s.cash<_rg){flash('礼金不够：约需 '+M(_rg)+'，手上只有 '+M(s.cash));render();return;}
  s.cash-=_rg;R.f=clamp(R.f+6);R.i=clamp(R.i+8);s.rel[name]=clamp(getRel(name)+4);actCool(_rk,30);
  log('你把 '+M(_rg)+' 封成红纸包送到'+name+'府上，话没多说。对方记了这份人情。');
 }else if(kind==='talk'){
  R.f=clamp(R.f+3);R.c=clamp(R.c+2);actCool(_rk,20);addExp('power',3);
  log('你陪'+name+'坐了半宿，从时局说到米价，话说得投机，也留了余地。');
 }else if(kind==='stand'){
  R.c=clamp(R.c-9);R.f=clamp(R.f-3);s.fame+=2;s.alt+=1;actCool(_rk,60);
  log('你在公开场合说了不中听的话，'+name+'脸色沉下去。你的名声传得更快，路也更窄。');
 }
 persist();render();
}

/* ---------- 国势 ---------- */
function natlTick(){
 var N=s.natl;
 NAT_KEYS.forEach(function(k){
  var v=N[k[0]];
  N[k[0]]=clamp(v+rnd(-3,3));
 });
 if(s.year>=1851&&s.year<=1864){N.稳定=clamp(N.稳定-2);N.秩序=clamp(N.秩序-2);}
 if(s.year>=1894&&s.year<=1895){N.军事=clamp(N.军事-4);N.国际=clamp(N.国际-5);}
 if(s.year>=1900){N.财政=clamp(N.财政-2);}
 if(s.year>=1911&&s.year<=1928){N.稳定=clamp(N.稳定-2);N.军事=clamp(N.军事+1);}
 if(s.year>=1931){N.国际=clamp(N.国际-3);N.军事=clamp(N.军事+2);}
 if(s.year>=1937){N.民心=clamp(N.民心-4);N.秩序=clamp(N.秩序-4);N.军事=clamp(N.军事+3);}
 if(s.alt>=6){N.稳定=clamp(N.稳定-1);}
}

/* ---------- 报纸 ---------- */
function makePaper(){
 var heads=[];
 var ev=null;for(var i=0;i<EVENTS.length;i++){if(EVENTS[i].y===s.year){ev=EVENTS[i];break;}}if(ev)heads.push('【'+ev.t+'】'+(ev.d||''));
 if(s.clique)heads.push('《时评》'+s.clique+'在'+s.year+'年的人事变动');
 var big=(world.pstate?Object.keys(world.pstate).filter(function(k){return world.pstate[k].state;}).length:0);
 if(big)heads.push('名流动态：近年已有 '+big+' 位要人下野或身故');
 var N=s.natl;
 heads.push('国势：财政 '+N.财政+'、民心 '+N.民心+'、军事 '+N.军事);
 heads.push('物价：米一石约 '+M(2.2)+'；你的月入约 '+M(sumItems(livePayItems(s))));
 s.paper={year:s.year,heads:heads.slice(0,4)};
}

/* ---------- 结局 ---------- */
function checkEnding(){
 if(s.ending)return;
 var end=null;
 if(s.dead) end={t:'身故',d:'你死在'+(s.deadYear||s.year)+'年，'+(s.deathCause||'世事无常')+'。'};
 else if(s.year>=1945) end=verdict();
 if(end){
  var sum=[];
  sum.push('能力 '+s.skill+'、声望 '+s.fame+'、政治 '+s.power+'、上级信任 '+s.trust);
  sum.push('职位：'+(window.rankTitleOf?window.rankTitleOf():FAC[s.faction].ladder[s.rank])+(s.clique?'（'+s.clique+'）':''));
  sum.push('现银 '+M(s.cash)+'，影响 '+s.alt);
  end.sum=sum;
  s.ending=end;
  log('【结局】'+end.t+'——'+end.d);
 }
}

function yearTick(){
 initExt();
 natlTick();
 makePaper();
 checkEnding();
 if(isMil()&&s.rank>=1&&s.unit.troops<UNIT_EST[Math.min(7,s.rank)]*0.5){ s.unit.troops=Math.round(UNIT_EST[Math.min(7,s.rank)]*rnd(0.7,0.85)); log('上头按你的品级拨补兵员，所部现有 '+fmtMen(s.unit.troops)+'。'); }
}

/* ---------- 渲染 ---------- */
function bar(label,v){
 v=clamp(v);
 return '<div style="display:flex;align-items:center;gap:8px;margin:3px 0"><span style="width:64px;color:var(--ink-2);font-size:12px">'+label+'</span>'+
  '<span style="flex:1;height:6px;background:var(--track);position:relative"><span style="position:absolute;left:0;top:0;bottom:0;width:'+v+'%;background:var(--data)"></span></span>'+
  '<span style="width:28px;text-align:right;font-size:12px;color:var(--ink-1)">'+Math.round(v)+'</span></div>';
}

function renderExt(){
 if(!s)return; initExt();
 var showMil=isMil();
 $('cardUnit').style.display=showMil?'':'none';
 if(showMil){
  var U=s.unit;
  $('unitBox').innerHTML='<p class="small" style="margin:0 0 6px">所部 '+fmtMen(U.troops)+'（编制约 '+fmtMen(UNIT_EST[Math.max(0,Math.min(7,s.rank||0))])+'）· 士气 '+Math.round(U.mor)+' · 补给 '+Math.round(U.sup)+'</p>'+
   bar('士气',U.mor)+bar('补给',U.sup)+
   '<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">'+
   ((s.rank||0)>=1?'<button class="btn sm" data-u="rec" data-cd="unit:rec">招募（每人安家银 '+M(3)+'）</button>':'<span class="small muted">兵丁不能招兵，升到把总/排长以上才有部伍可带。</span>')+
   '<button class="btn sm" data-u="drill" data-cd="unit:drill">部队操练</button>'+
   '<button class="btn sm" data-u="fight" data-cd="unit:fight">开拔作战</button></div>';
  [].forEach.call($('unitBox').querySelectorAll('[data-u]'),function(b){b.onclick=function(){unitAct(b.getAttribute('data-u'));};});
 }

 var cl=CLIQUES[s.faction]||[];
 $('cardClique').style.display=cl.length?'':'none';
 if(cl.length){
  var h='<p class="small muted" style="margin:0 0 6px">当前：'+(s.clique?'<b>'+s.clique+'</b>':'未入任何派系')+'</p>';
  cl.forEach(function(c,i){
   h+='<div class="pcard"><div style="display:flex;justify-content:space-between;align-items:center"><b>'+c.n+'</b>'+
      '<button class="btn sm" data-cl="'+i+'"'+(s.clique===c.n?'':' data-cd="clique"')+'>'+(s.clique===c.n?'已在其中':'加入')+'</button></div>'+
      '<p class="small muted" style="margin:4px 0 0">'+c.d+'</p></div>';
  });
  $('cliqueBox').innerHTML=h;
  [].forEach.call($('cliqueBox').querySelectorAll('[data-cl]'),function(b){b.onclick=function(){joinClique(+b.getAttribute('data-cl'));};});
 }

 var ps=visiblePeople().filter(function(p){ return (p.rank||0)<=reachRank() && relOf(p.n).f>=80; }).slice(0,4);
 if(!ps.length){
  var _sp=supOf(); if(_sp) ps.push({n:_sp.n,cl:'直属上级',rank:0});
  if(reachRank()>=4){ var _L=leaderOf(s.faction,s.year); if(_L) ps.push({n:_L,cl:'本阵营最高层',rank:9}); }
 }
 $('cardRel').style.display=(ps.length||v4talents().some(function(p){return p.rel>=80;}))?'':'none';
 if(ps.length){
  var hr='';
  ps.forEach(function(p){
   var R=relOf(p.n);
   hr+='<div class="pcard"><div style="display:flex;justify-content:space-between;align-items:center"><b>'+p.n+'</b><span class="small muted">'+p.cl+'</span></div>'+
    '<p class="small muted" style="margin:4px 0">好感 '+Math.round(R.f)+' · 利益 '+Math.round(R.i)+' · 立场 '+Math.round(R.c)+'</p>'+
    '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
    '<button class="btn sm" data-rn="'+p.n+'" data-rk="gift" data-cd="rel:gift:'+p.n+'">送礼</button>'+
    '<button class="btn sm" data-rn="'+p.n+'" data-rk="talk" data-cd="rel:talk:'+p.n+'">深谈</button>'+
    '<button class="btn sm" data-rn="'+p.n+'" data-rk="stand" data-cd="rel:stand:'+p.n+'">公开表态</button></div></div>';
  });
  $('relBox').innerHTML=hr;
  [].forEach.call($('relBox').querySelectorAll('[data-rk]'),function(b){b.onclick=function(){relAct(b.getAttribute('data-rn'),b.getAttribute('data-rk'));};});
 }

 $('cardPaper').style.display=s.paper?'':'none';
 if(s.paper){
  var ph='<p class="small muted" style="margin:0 0 6px">民国纪事 · '+s.paper.year+' 年号</p><ul style="margin:0;padding-left:18px">';
  s.paper.heads.forEach(function(t){ph+='<li class="small" style="margin:3px 0">'+t+'</li>';});
  ph+='</ul>';
  $('paperBox').innerHTML=ph;
 }

 $('cardNatl').style.display='';
 var nh='<div style="display:grid;grid-template-columns:1fr 1fr;gap:0 16px">';
 NAT_KEYS.forEach(function(k){nh+=bar(k[1],s.natl[k[0]]);});
 nh+='</div>';
 $('natlBox').innerHTML=nh;

 $('cardEnd').style.display=s.ending?'':'none';
 if(s.ending){
  var eh='<p><b>'+s.ending.t+'</b></p><p class="small">'+s.ending.d+'</p><ul class="small">';
  s.ending.sum.forEach(function(t){eh+='<li>'+t+'</li>';});
  eh+='</ul><button class="btn sm" id="btnAgain">重开一生</button>';
  $('endBox').innerHTML=eh;
  var bg=$('btnAgain'); if(bg)bg.onclick=function(){localStorage.removeItem(slotKey('auto'));location.reload();};
 }
}

window.__yearTick=yearTick;
var _renderBase=render;
render=function(){ _renderBase(); try{renderExt();}catch(e){} };
var _advBase=advance;
advance=function(){ _advBase(); try{renderExt();}catch(e){} };
var _doBase=doAction;
doAction=function(a){ _doBase(a); };

var _packBase=packSave;
packSave=function(){ var o=_packBase(); o.v='2.0'; return o; };

/* ================= V1.9：身体 / 年龄 / 任免 ================= */
var REGION = {
 '直隶':{d:'天子脚下，官场最密，也最讲门第。',fame:4,power:3,cash:40},
 '江浙':{d:'米粮与洋货的码头，钱好赚，报也好看。',power:4,skill:2,cash:90},
 '两广':{d:'通商最早的地方，风气开得也最早。',fame:2,power:4,cash:60},
 '湘鄂':{d:'九省通衢，兵与读书人都多。',skill:5,fame:2,cash:10},
 '四川':{d:'天府之国，自成一体，出川要下决心。',skill:2,fame:3,cash:60},
 '关外':{d:'地广人稀，马贼与垦荒者同处一处。',skill:4,fame:1,cash:80}
};
var ROLE_MIN = {soldier:1840, officer:1840, official:1840, merchant:1840, student:1898, activist:1894};

function regionOf(){ return s && s.region && REGION[s.region] ? REGION[s.region] : null; }

function gateRoles(){
 var start = +($('fStart').value || 1840);
 var sel = $('fRole');
 [].forEach.call(sel.options, function(o){
  var min = ROLE_MIN[o.value] || 1840;
  o.disabled = start < min;
  o.textContent = o.textContent.replace(/（.*）$/, '') + (start < min ? '（' + min + '年后）' : '');
 });
 if(sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].disabled){
  for(var i=0;i<sel.options.length;i++){ if(!sel.options[i].disabled){ sel.selectedIndex=i; break; } }
 }
}

/* ---------- 健康与年龄 ---------- */
function healthTick(){
 if(!s) return;
 var age = s.year - s.birth;
 if(typeof s.health !== 'number') s.health = 100;
 var dec = 0;
 if(age>=65) dec += 2; else if(age>=55) dec += 1.2; else if(age>=45) dec += 0.6;
 if(s.health<60) dec += 0.8;
 s.health = clamp(s.health - dec + (Math.random()<0.25?2:0));
 if(s.health<45 && Math.random()<0.22){
  var ill = ['风寒久咳','疟疾','胃病','旧伤复发','肺疾'][Math.floor(Math.random()*5)];
  s.health = clamp(s.health - 6);
  s.illness = ill;
  log('【身体】'+ill+'缠了一阵，你连着几天起不了床。');
 }
 if(s.health>=70) s.illness = null;
 if(s.health<=0 || (age>=72 && Math.random()<0.18 && s.health<35)){
  s.dead = true; s.deadYear = s.year; s.deathCause = s.illness ? '久病不起' : '年迈';
  log('【身故】'+s.year+'年，你病重不起，'+(s.illness||'身体撑不住了')+'。');
  try{ endGame('你走完了自己的一生。'); }catch(e){}
 }
}

/* ---------- 任免 ---------- */
function officeTick(){
 if(!s || s.dead) return;
 if(s.rank>0 && s.trust<22 && Math.random()<0.16){
  s.rank--; s.trust=clamp(s.trust+4);
  log('【任免】上峰一纸公文下来，你被降为「'+(window.rankTitleOf?window.rankTitleOf():FAC[s.faction].ladder[s.rank])+'」。');
  s.paper && s.paper.heads.push('人事：'+s.name+'被降职');
 }
 if(s.rank>=4 && !s.clique && Math.random()<0.12){
  s.rank-=2; s.alt+=0;
  log('【任免】你在派系里没有根，几个要缺被人拿走，你被「调任闲职」——实际是摘了印。');
 }
 if(s.rank===0 && s.trust>70 && Math.random()<0.10){
  s.rank=1;
  log('【任免】上头点名，把你提到了「'+FAC[s.faction].ladder[1]+'」。');
 }
}

function renderBody(){
 if(!s) return;
 var el = $('cardBody'); if(!el) return;
 el.style.display = '';
 var age = s.year - s.birth;
 var h = s.health===undefined?100:s.health;
 $('bodyBox').innerHTML =
  '<p class="small" style="margin:0 0 6px">'+age+' 岁 · 出生地 '+(s.region||'未知')+(s.illness?' · 在病中（'+s.illness+'）':'')+'</p>' +
  bar('健康', h);
}

/* ---------- 初始化接线 ---------- */
setTimeout(function(){
 var fs = $('fStart'); if(fs){ fs.addEventListener('change', gateRoles); gateRoles(); }
 var ff = $('fFac'); if(ff){ ff.addEventListener('change', gateRoles); }
 var rb = $('btnBegin');
 if(rb){ rb.onclick = function(){ init(); }; }
 var fs2 = $('fBirth'); if(fs2){ fs2.addEventListener('change', syncBirth); }
}, 0);

var _origInit = init;
init = function(){
 _origInit.apply(null, arguments);
 try{
  var reg = ($('fRegion') && $('fRegion').value) || '直隶';
  var R = REGION[reg] || {};
  s.region = reg;
  s.skill += R.skill || 0;
  s.fame += R.fame || 0;
  s.power += R.power || 0;
  s.cash += R.cash || 0;
  s.health = 100;
  s.illness = null;
  log('你生于'+reg+'。'+(R.d||''));
  persist(); render();
 }catch(e){}
};

var _yearTickV19 = window.__yearTick;
window.__yearTick = function(){
 if(_yearTickV19) try{_yearTickV19();}catch(e){}
 try{ healthTick(); officeTick(); }catch(e){}
};

var _renderExtV19 = renderExt;
renderExt = function(){
 _renderExtV19.apply(null, arguments);
 try{ renderBody(); }catch(e){}
};

var _packV19 = packSave;
packSave = function(){
 var o = _packV19.apply(null, arguments);
 o.v = '1.9';
 return o;
};

/* ================= V1.3：人物档案 ================= */
var PROFILES = {
 '道光帝':{t:'节俭到抠门，遇事犹豫，最怕花钱也最怕丢脸。',c:'守成',r:'1820年即位；1840年英舰北上，他先主战，后主抚。',k:'清'},
 '咸丰帝':{t:'身子弱，性子急，听不得坏消息。',c:'守成',r:'1850年即位，内忧外患一起来。',k:'清'},
 '慈禧太后':{t:'极精于权术，对任何人的忠心都只信三分。',c:'守成',r:'1861年辛酉政变后垂帘，此后近五十年是宫里真正说话的人。',k:'清'},
 '李鸿章':{t:'务实，能忍，愿意背骂名换事情办成。',c:'洋务',r:'淮军起家，办轮船招商局与北洋水师；《马关条约》《辛丑条约》都压在他手上。',k:'清'},
 '曾国藩':{t:'慢而稳，极重自省，带兵先带人心。',c:'理学',r:'办湘军平太平天国，后任两江总督、直隶总督。',k:'清'},
 '左宗棠':{t:'火气大，认死理，看不起只会说不会做的人。',c:'主战',r:'办楚军，西征收复新疆，主张海防塞防并重。',k:'清'},
 '袁世凯':{t:'极会用人也极会用人性弱点，说话算一半。',c:'北洋',r:'小站练兵起家，1911年逼清帝退位，1915年称帝失败。',k:'北洋'},
 '段祺瑞':{t:'冷硬、执拗，认军纪也认枪。',c:'皖系',r:'北洋三杰之一，主政多年，主张参战与武力统一。',k:'北洋'},
 '张作霖':{t:'江湖气重，讲交情，翻脸比翻书快。',c:'奉系',r:'绿林出身，统东北三省，1928年皇姑屯遇炸。',k:'北洋'},
 '孙中山':{t:'热得能烧人，理想主义，失败多少次都不改口。',c:'革命',r:'1894年兴中会，1905年同盟会，1912年任临时大总统，晚年改组国民党、联俄联共。',k:'国民党 / 南京国民政府'},
 '蒋介石':{t:'自律到刻板，极重嫡系与命令链条。',c:'黄埔系',r:'黄埔校长起家，1927年清党，抗战时名义统率全国。',k:'国民党 / 南京国民政府'},
 '汪精卫':{t:'文章极好，胆子极小，容易在压力下转向。',c:'和谈',r:'早年刺客出身，抗战时出走南京组伪政权。',k:'国民党 / 南京国民政府'},
 '毛泽东':{t:'善于从最坏处打算，也善于等。',c:'农村包围城市',r:'井冈山、长征、延安；1945年中共七大确立领导地位。',k:'中国共产党'},
 '周恩来':{t:'极会做人，说话留三分余地，事情却办得干净。',c:'统战',r:'黄埔政治部主任出身，长期负责谈判与组织工作。',k:'中国共产党'},
 '朱德':{t:'像个老兵，脾气温，带兵讲实在。',c:'军事',r:'南昌起义、井冈山会师，长期任总司令。',k:'中国共产党'},
 '彭德怀':{t:'直，硬，有话当面说。',c:'军事',r:'平江起义，百团大战指挥者之一。',k:'中国共产党'},
 '刘湘':{t:'地方观念极重，先保川，再论国。',c:'地方',r:'四川军阀首领，1937年率川军出川抗战。',k:'地方军政势力'},
 '张謇':{t:'信实业救国，做事一板一眼。',c:'实业',r:'状元下海，办大生纱厂与南通地方自治。',k:'民间社会 / 独立人士'},
 '蔡元培':{t:'温和而有骨头，尊重读书人的脾气。',c:'教育',r:'北大校长，主张思想自由、兼容并包。',k:'民间社会 / 独立人士'},
 '陈独秀':{t:'锋芒毕露，宁折不弯。',c:'启蒙',r:'《新青年》主笔，五四运动的核心人物之一。',k:'民间社会 / 独立人士'}
};

/* ---------- 身份决定够得着谁 ---------- */
function reachRank(){
 if(!s) return 0;
 var r = s.rank;
 if(s.fame>=70) r += 1;
 if(s.club && s.club!=='none' && s.clubRel>=70) r += 1;
 if(s.alt>=8) r += 1;
 return Math.min(7, r);
}

function profileOf(name){
 if(PROFILES[name]) return PROFILES[name];
 var hit=null;
 Object.keys(PEOPLE).forEach(function(f){ (PEOPLE[f]||[]).forEach(function(x){ if(x.n===name) hit=x; }); });
 if(hit) return {t:hit.st||'性情不详',c:hit.cl||'未明',r:hit.d||'档案不全。',k:''};
 var supHit=null;
 Object.keys(SUP).forEach(function(f){ Object.keys(SUP[f]||{}).forEach(function(r){ var x=SUP[f][r]; if(x&&x.n===name) supHit=x; }); });
 if(supHit){
  return {t:['话不多，办事稳','脾气急，重面子','圆滑，谁都不肯全得罪','读过书，爱讲道理','行伍出身，只认实在的'][name.length%5],
          c:'体制内', r:supHit.d||'档案不详。', k:s?FAC[s.faction].name:''};
 }
 var p=null;
 Object.keys(PEOPLE).forEach(function(f){
  (PEOPLE[f]||[]).forEach(function(x){ if(x.n===name) p=x; });
 });
 var t=['话不多，办事稳','脾气急，重面子','圆滑，谁都不肯全得罪','读过书，爱讲道理','行伍出身，只认实在的'][name.length%5];
 var c=p?(p.rank>=3?'实权':'中层'):'未明';
 var r=p?('在当前阵营中处于第 '+(p.rank+1)+' 层，'+p.y[0]+'—'+p.y[1]+' 年间在世。'):'档案不全，只知道他眼下在位。';
 return {t:t,c:c,r:r,k:p?p.f:''};
}

function openProfile(name){
 var P2=profileOf(name);
 var R=relOf(name);
 $('dlgTag').textContent='人物档案';
 $('dlgTitle').textContent=name;
 $('dlgDesc').textContent='';
 $('dlgBody').innerHTML=
  '<div class="small" style="line-height:1.9">'+
  '<div><b>性格：</b>'+P2.t+'</div>'+
  '<div><b>立场：</b>'+P2.c+'</div>'+
  '<div><b>履历：</b>'+P2.r+'</div>'+
  '<div><b>对你的印象：</b>好感 '+Math.round(R.f)+' · 利益 '+Math.round(R.i)+' · 立场差 '+(100-Math.round(R.c))+'</div>'+
  '</div>'+
  '<button class="choice" id="bioClose" style="text-align:center"><b>收起</b></button>';
 $('mask').classList.remove('hidden');
 $('bioClose').onclick=function(){ $('mask').classList.add('hidden'); };
}

var _relActV13 = relAct;
relAct = function(name, kind){
 if(kind==='bio'){ openProfile(name); return; }
 return _relActV13(name, kind);
};

var _renderExtV13 = renderExt;
renderExt = function(){
 _renderExtV13.apply(null, arguments);
 try{
  var box=$('relBox'); if(!box) return;
  var cards=box.querySelectorAll('.pcard');
  [].forEach.call(cards,function(c){
   if(c.querySelector('[data-rk="bio"]')) return;
   var nm=c.querySelector('b').textContent;
   var wrap=c.querySelector('div[style*="flex"]:last-child')||c;
   var b=document.createElement('button');
   b.className='btn sm'; b.setAttribute('data-rk','bio'); b.setAttribute('data-rn',nm); b.textContent='档案';
   b.onclick=function(){ openProfile(nm); };
   wrap.appendChild(b);
   var P2=profileOf(nm);
   var line=document.createElement('p');
   line.className='small'; line.style.margin='2px 0 4px'; line.style.color='#8a8175';
   line.textContent='性格：'+P2.t.slice(0,18)+'… · 立场：'+P2.c;
   c.insertBefore(line, wrap);
  });
 }catch(e){}
};

/* ---------- 同期人物名录 ---------- */
function renderWho(){
 var el=$('cardWho'); if(!el||!s) return;
 var acc={}, out=[];
 Object.keys(PEOPLE).forEach(function(f){
  (PEOPLE[f]||[]).forEach(function(p){
   if(s.year<p.y[0]||s.year>p.y[1]) return;
   var st=world&&world.pstate?world.pstate[p.n]:null;
   if(st&&(st.state==='dead'||st.state==='fallen')) return;
   if(acc[p.n]) return; acc[p.n]=1;
   out.push({n:p.n,f:f,rank:p.rank||0,cl:p.cl,st:p.st,d:p.d});
  });
 });
 out.sort(function(x,y){return (y.rank||0)-(x.rank||0);});
 var reach=reachRank();
 var near=out.filter(function(p){return p.rank<=reach;});
 var far=out.filter(function(p){return p.rank>reach;});
 out=near.slice(0,8);
 el.style.display='';
 if(!out.length){
  $('whoBox').innerHTML='<p class="small muted" style="margin:0">以你眼下的身份（'+(s?(window.rankTitleOf?window.rankTitleOf():''):'')+'），还搭不上这些人的门路。先在本营里熬出个样子来。</p>';
  return;
 }
 far=far.slice(0,4);
 var h='<div style="display:flex;flex-wrap:wrap;gap:6px">';
 out.forEach(function(p){
  h+='<button class="btn sm" data-who="'+p.n+'">'+p.n+'<span style="color:var(--ink-3)"> · '+(FAC[p.f]?FAC[p.f].name.split(' ')[0]:'')+'</span></button>';
 });
 h+='</div>';
 if(far.length){
  h+='<p class="small muted" style="margin:8px 0 4px">够不着的人：</p><div style="display:flex;flex-wrap:wrap;gap:6px;opacity:.45">';
  far.forEach(function(p){ h+='<span class="small" style="border:1px solid var(--line);padding:3px 7px">'+p.n+'</span>'; });
  h+='</div>';
 }
 h+='<p class="small muted" style="margin:8px 0 0">点人名看档案；共 '+out.length+' 位你能接触到的人。</p>';
 $('whoBox').innerHTML=h;
 [].forEach.call($('whoBox').querySelectorAll('[data-who]'),function(b){ b.onclick=function(){ openProfile(b.getAttribute('data-who')); }; });
}

var _renderExtWho = renderExt;
renderExt = function(){
 _renderExtWho.apply(null, arguments);
 try{ renderWho(); }catch(e){}
};

/* ================= V2.4：性格、报纸、国势反噬 ================= */
function temperOf(name){
 var P2=profileOf(name);
 return (P2.c||'')+' '+(P2.t||'');
}
function isHard(name){ return /强硬|刚|烈|直/.test(temperOf(name)); }
function isSmooth(name){ return /圆滑|权谋|权术|会做人|留三分/.test(temperOf(name)); }
function isBookish(name){ return /读|书|文人|学|教育|启蒙/.test(temperOf(name)); }

var _relActV24 = relAct;
relAct = function(name, kind){
 if(kind==='bio') return _relActV24(name, kind);
 if(!s) return _relActV24(name, kind);
 var R=relOf(name);
 var hard=isHard(name), smooth=isSmooth(name), book=isBookish(name);
 var before=JSON.stringify(R);
 _relActV24(name, kind);
 if(kind==='gift' && hard){ R.f=clamp(R.f-3); log('【性情】'+name+'把钱推回来一半：「有事说事，别来这套。」'); }
 if(kind==='stand'){
  if(hard){ R.f=clamp(R.f-6); log('【性情】'+name+'当场翻脸，比你想的严重。'); }
  if(smooth){ R.f=clamp(R.f+4); log('【性情】'+name+'笑着把话圆了回去，只当没听见。'); }
 }
 if(kind==='talk' && book){ R.f=clamp(R.f+3); s.skill=Math.min(999,s.skill+1); log('【性情】'+name+'谈起旧书与时局，你这趟没白坐。'); }
 persist();
};

/* ---------- 报纸：真的写当年的事 ---------- */
function makePaper(){
 var heads=[];
 var ev=null;
 for(var i=0;i<EVENTS.length;i++){ if(EVENTS[i].y===s.year){ ev=EVENTS[i]; break; } }
 if(ev) heads.push('【'+ev.t+'】'+(ev.d||''));
 var N=s.natl;
 if(N.民心<35) heads.push('民食艰难：多县报荒，饥民聚于城外');
 else if(N.财政<25) heads.push('库空如洗：各部欠薪已逾三月');
 else if(N.军事<30) heads.push('海上失利：水师又折一舰，京中大哗');
 else if(N.工业>60) heads.push('实业新讯：工厂增至数百家，电线北通');
 var dead=[],fell=[];
 if(world&&world.pstate) Object.keys(world.pstate).forEach(function(k){
  var st=world.pstate[k];
  if(st.state==='dead') dead.push(k);
  else if(st.state==='fallen') fell.push(k);
 });
 if(dead.length) heads.push('讣闻：'+dead.slice(-2).join('、')+' 相继谢世');
 if(fell.length) heads.push('人事：'+fell.slice(-2).join('、')+' 去职');
 var mine=[];
 if(s.clique) mine.push('你在'+s.clique+'中的地位'+(s.trust>=60?'渐稳':'仍受观望'));
 if(s.rank>=3) mine.push('本报记者注意到，'+s.name+'近来在'+FAC[s.faction].ladder[s.rank]+'任上颇为活跃');
 if(s.health<40) mine.push('本埠：'+s.name+'患病，已多日不见客');
 if(!mine.length) mine.push('本埠：米价一石 '+(2+s.year/60).toFixed(1)+' 元，盐价持平');
 var pool=[];
 if(s.year<1860) pool.push('粤海关报：夷商又请增口岸，督抚未复');
 else if(s.year<1895) pool.push('洋务：机器局新到一批洋匠，局中添了几台车床');
 else if(s.year<1911) pool.push('新政：各省学堂次第开办，留学东洋者日多');
 else if(s.year<1928) pool.push('南北和议又起波澜，京中人心浮动');
 else pool.push('前方战报：我军据河而守，日军攻势渐缓');
 pool.push('米价一石 '+(2+s.year/60).toFixed(1)+' 元；'+(s.year<1900?'银元':'法币')+'行市看涨');
 pool.push('江湖传闻：'+(s.club&&s.club!=='none'?CLUBS[s.club].name+'的人近来走动频繁':'会党与商帮在码头上走动频繁'));
 heads=heads.concat(pool).concat(mine);
 var seen={}, uni=[];
 heads.forEach(function(t){ var k=t.replace(/[0-9.]+/g,'#'); if(seen[k])return; seen[k]=1; uni.push(t); });
 heads=uni.slice(0,4);
 s.paper={year:s.year,heads:heads};
}

/* ---------- 国势反噬 ---------- */
function backlash(){
 var N=s.natl;
 if(N.民心<32 && Math.random()<0.5){
  log('【时局】饥民聚众抢米，县衙调兵弹压，你听见城外枪声。');
  N.秩序=clamp(N.秩序-5); s.alt+=1;
 }
 if(N.财政<25 && Math.random()<0.45 && s.rank>=1){
  s.trust=clamp(s.trust-4);
  log('【时局】饷银拖欠，部下当面跟你诉苦，你只能先拿话顶着。');
  if(s.unit) s.unit.mor=clamp(s.unit.mor-6);
 }
 if(N.军事<30 && Math.random()<0.4){
  log('【时局】前线又丢了阵地，京里开始找人担责。');
  N.国际=clamp(N.国际-2);
 }
 if(N.工业>55 && Math.random()<0.35 && s.role==='merchant'){
  s.cash+=rnd(20,60)|0;
  log('【时局】新开的纱厂销路不错，你的账上多了一笔。');
 }
}

var _yearTickV24 = window.__yearTick;
window.__yearTick = function(){
 if(_yearTickV24) try{_yearTickV24();}catch(e){}
 try{ backlash(); }catch(e){}
};

/* ================= V2.5：随机开局 · 术语释义 · 地位与领袖 ================= */
var TIPS={
 '操练':'练兵。有军职才做得动，涨能力与上级信任；兵荒年份会硬塞新兵给你。',
 '进修':'读书、学西学，直接提升综合能力。',
 '活动':'应酬、跑关系。涨声望，需要职位或盟友才办得成。',
 '办事':'处理公务。文官与地方官才吃得上，涨上级信任与政治影响。',
 '人脉':'结识人。能搭上谁，取决于你的身份高低。',
 '谋生':'副业挣钱。文官、商人最拿手。',
 '打点':'给上官送钱送礼，直接抬上司信任（好感）；银钱不够做不了。',
 '添置':'买田、买宅、买照相器物。花银钱换声望。',
 '输捐':'报效公费，抬营务，账房会记你一功。',
 '联络新军':'去新军营里串门、递话、摸底。成了涨政治影响与声望；被查出来会掉信任，甚至被抓。',
 '拜把子':'换帖结义。成了关系更硬，出事有人替你说话；性格不合会被拒。',
 '请示提拔':'向上级开口要资格：先看四项属性均值，再看上级好感，最后看打点银钱。',
 '国策':'以领袖身份定本年方针：练新军、兴学、办厂、加税、借外债、禁烟，都会改写国势。',
 '定国策':'每年一次。你定的方针会立即改国势，并影响来年的风险。'
};
function tipWrap(key,label){return '<span class="tips" data-tip="'+String(TIPS[key]||'').replace(/"/g,'&quot;')+'">'+label+'</span>';}
function decorateTips(){
 var map={'train':'操练','study':'进修','politics':'活动','govern':'办事','network':'人脉',
  'earn':'谋生','gift':'打点','invest':'添置','donate':'输捐',
  'contactArmy':'联络新军','sworn':'拜把子','promote':'请示提拔'};
 [].forEach.call(document.querySelectorAll('[data-act]'),function(b){
  var k=map[b.getAttribute('data-act')];
  if(k&&!b.querySelector('.tips')){
   var span=document.createElement('span');
   span.className='tips';span.setAttribute('data-tip',TIPS[k]||'');
   span.innerHTML=b.innerHTML;b.innerHTML='';b.appendChild(span);
  }
 });
 var pb=document.getElementById('btnPromote');
 if(pb&&!pb.querySelector('.tips')){pb.innerHTML=tipWrap('请示提拔',pb.innerHTML);}
 var pol=document.getElementById('btnPolicy');
 if(pol&&!pol.querySelector('.tips')){pol.innerHTML=tipWrap('定国策',pol.innerHTML);}
}
var _renderV25=render;
render=function(){ _renderV25(); try{decorateTips();}catch(e){} };

/* ---------- 随机开局 ---------- */
function randomStart(){
 var facs=['qing','beiyang','kmt','cpc','local','civil'];
 var fac=facs[Math.floor(Math.random()*facs.length)];
 var F=FAC[fac]||FAC.qing;
 var minY=Math.max(1840,F.min||1840);
 var maxY=Math.min(1938,minY+55);
 var start=minY+Math.floor(Math.random()*(maxY-minY+1));
 var birth=start-Math.floor(16+Math.random()*20);
 var fit={qing:['soldier','officer','official','merchant','student'],beiyang:['soldier','officer','official','merchant','student'],
  kmt:['officer','official','student','activist'],cpc:['officer','official','student','activist'],
  local:['soldier','officer','official','merchant'],civil:['student','merchant','official','activist']};
 var roles=(fit[fac]||fit.civil).filter(function(k){ return start>=(ROLE_MIN[k]||1840); });
 var role=roles[Math.floor(Math.random()*roles.length)]||'soldier';
 var regs=Object.keys(REGION);
 var clubs=['none'];
 Object.keys(CLUBS).forEach(function(k){if(k!=='none'&&start>=CLUBS[k].min)clubs.push(k);});
 var sur='沈李王张刘陈杨赵周吴徐孙胡朱高林何郭马罗曾左'.split('');
 var giv='砚山堂洲舟生青岚亭松竹梅溪岩川河海之远'.split('');
 var nm=pick(sur)+pick(giv);
 $('fName').value=nm;
 $('fFac').value=fac;
 fillYears();
 $('fBirth').value=String(birth);
 $('fStart').value=String(start);
 gateRoles();
 $('fRole').value=role;
 $('fRegion').value=pick(regs);
 var origins=[].slice.call($('fOrigin').options).map(function(o){return o.value;});
 $('fOrigin').value=pick(origins);
 $('fClub').value=pick(clubs);
 $('fTier').value=pick(['low','low','mid','high']);
 var hint=$('rollHint');
 if(hint) hint.textContent='掷出：'+nm+' · '+start+'年 · '+F.name+' · '+roleName(role)+' · '+$('fTier').selectedOptions[0].textContent.split('：')[0];
}

/* ---------- 起始地位 ---------- */
var TIER_RANK={low:0,mid:2,high:5,leader:7};
var _initV25=init;
init=function(){
 var tier=($('fTier')||{}).value||'low';
 _initV25();
 if(!s||s.dead) return;
 s.rank=TIER_RANK[tier]===undefined?0:TIER_RANK[tier];
 s.isLeader=(tier==='leader');
 if(tier==='mid'){ s.cash+=150; s.trust=clamp(s.trust+6); }
 if(tier==='high'){ s.cash+=600; s.trust=clamp(s.trust+12); s.fame=clamp(s.fame+8); s.power=clamp(s.power+8); }
 if(tier==='leader'){
  s.cash+=2000; s.fund+=600; s.trust=90; s.fame=clamp(s.fame+30); s.power=clamp(s.power+30);
  s.leaderYear=s.year;
  if(s.faction==='qing'){
   s.leaderPersona = s.year<1862?'咸丰帝':s.year<1875?'同治帝':s.year<1909?'慈禧太后':'宣统帝';
   s.leaderTitle = '皇帝（'+s.leaderPersona+'）';
  }else{
   s.leaderPersona = s.name;
   s.leaderTitle = FAC[s.faction].ladder[7];
  }
  log('【就位】'+s.year+'年，你坐上了「'+rankTitleOf()+'」的位子，本阵营的方向由你定。');
 }
 render();persist();
};
$('btnBegin').onclick=init;

/* ---------- 领袖：自己人就是最高领导 ---------- */
var _leaderOfV25=leaderOf;
leaderOf=function(fac,y){
 if(s&&s.isLeader&&(s.faction===fac||s.pendingFaction===fac)) return (s.leaderPersona||s.name);
 return _leaderOfV25(fac,y);
};

/* ---------- 国策 ---------- */
var POLICIES=[
 {k:'army',t:'练新军',d:'募兵、买洋枪，军力涨得快，但银子烧得也快。',eff:function(){s.natl.军事+=7;s.natl.财政-=6;s.natl.民心-=2;log('【国策】你下令编练新军，营务一下子紧了起来。');}},
 {k:'edu',t:'兴学堂',d:'办新式学堂、译洋书。民心与工业慢涨，财政小亏。',eff:function(){s.natl.民心+=6;s.natl.工业+=4;s.natl.财政-=4;log('【国策】你批了办学章程，各县开始腾房子、请教习。');}},
 {k:'factory',t:'办实业',d:'修路、开矿、设厂。工业大涨，对民心有折损。',eff:function(){s.natl.工业+=9;s.natl.经济+=5;s.natl.民心-=3;log('【国策】你准了矿务与铁路的章程，洋匠与机器一起进了城。');}},
 {k:'tax',t:'加税筹饷',d:'财政立刻好看，民心与秩序都掉。',eff:function(){s.natl.财政+=10;s.natl.民心-=8;s.natl.秩序-=4;log('【国策】你加征了厘金，库房满了，街上的骂声也多了。');}},
 {k:'debt',t:'借外债',d:'财政缓一口气，国际地位受损。',eff:function(){s.natl.财政+=12;s.natl.国际-=6;log('【国策】你跟洋行签了借款，抵押的是一段铁路。');}},
 {k:'ban',t:'禁烟',d:'民心与秩序涨，洋人不满，关税受损。',eff:function(){s.natl.民心+=5;s.natl.秩序+=5;s.natl.国际-=3;s.natl.财政-=4;log('【国策】你下令查烟馆，抓了几个大烟贩，也得罪了几个洋商。');}},
 {k:'trim',t:'裁撤冗员',d:'财政省下钱，官场里恨你的人变多。',eff:function(){s.natl.财政+=6;s.trust=clamp(s.trust-8);s.alt=Math.max(0,s.alt-1);log('【国策】你裁了几个闲衙门，名单贴出去那天没人跟你打招呼。');}}
];
function openPolicy(){
 if(!s||!s.isLeader||s.dead) return;
 $('dlgTag').textContent='国策 · '+s.year+'年';
 $('dlgTitle').textContent='今年怎么走';
 $('dlgDesc').textContent='你坐在「'+rankTitleOf()+'」的位子上，方针由你定——每一条都会立刻改写国势。';
 var body=$('dlgBody'); body.innerHTML='';
 POLICIES.forEach(function(p,i){
  var b=document.createElement('button');
  b.className='choice';
  b.innerHTML='<b>'+p.t+'</b><div class="sub">'+p.d+'</div>';
  b.onclick=function(){
   try{p.eff();}catch(e){}
   ['军事','财政','民心','秩序','经济','工业','国际'].forEach(function(k){s.natl[k]=clamp(s.natl[k]);});
   $('mask').classList.add('hidden');
   render();persist();
  };
  body.appendChild(b);
 });
 $('mask').classList.remove('hidden');
}

/* ---------- 年度钩子：领袖每年必须定国策 ---------- */
var _tickV25=window.__yearTick;
window.__yearTick=function(){
 if(_tickV25) try{_tickV25();}catch(e){}
 if(s&&s.isLeader&&!s.dead) try{ dlgOpen('policy',s.year); }catch(e){}   /* V4.19：进弹窗队列，不再覆盖别的弹窗 */
};

/* ---------- 性能：地图只在必要时重画 ---------- */
var _renderMapV25=renderMap, _lastMapSig='';
renderMap=function(){
 var regions=(world&&world.regions)||{}, owners=(world&&world.owner)||{};
 var sig=(s?s.year:'0')+'|'+(s?s.faction:'')+'|'+(mapFeatures?mapFeatures.length:0)+'|'+
  Object.keys(regions).sort().map(function(k){var r=regions[k]||{};return k+':'+(r.ctrl||'')+':'+(r.str||0);}).join(';')+'|'+
  Object.keys(owners).sort().map(function(k){return k+':'+owners[k];}).join(';');
 if(sig===_lastMapSig&&document.querySelector('#regionLayer path')) return;
 _lastMapSig=sig;
 _renderMapV25();
};
document.addEventListener('DOMContentLoaded',function(){
 var rb=$('btnRandom'); if(rb) rb.onclick=randomStart;
});
if($('btnRandom')) $('btnRandom').onclick=randomStart;

/* ---------- V2.6：1949 的天下大势 ---------- */
/* V4.19：天下大势弹窗进入弹窗队列（年初常与定国策、年度报告同时出现，过去会互相覆盖） */
function verdictDlg(){
 if(!s||s.dead) return false;
 var v=verdict();
 $('dlgTag').textContent='天下大势 · '+s.year+'年';
 $('dlgTitle').textContent=v.t.replace('结局 · ','');
 $('dlgDesc').textContent=v.d;
 var body=$('dlgBody'); body.innerHTML='';
 var b=document.createElement('button'); b.className='choice';
 b.innerHTML='<b>看下去</b><div class="sub">历史没有结束，你还在这条线上。</div>';
 b.onclick=function(){ $('mask').classList.add('hidden'); render(); persist(); };
 body.appendChild(b);
 $('mask').classList.remove('hidden');
 return true;
}
var _tickV26=window.__yearTick;
window.__yearTick=function(){
 if(_tickV26) try{_tickV26();}catch(e){}
 if(!s||s.dead) return;
 if(!s.verdictShown && s.year>=1949){
  s.verdictShown=1;
  try{ dlgOpen('verdict',s.year); }catch(e){}
 }
};

/* ================= V2.7：浮层释义 + 历史分支 ================= */
(function(){
 var box=null;
 function ensure(){
  if(!box) box=document.getElementById('tipFloat');
  return box;
 }
 function show(el,x,y){
  var b=ensure(); if(!b) return;
  var t=el.getAttribute('data-tip'); if(!t) return;
  b.textContent=t;
  b.style.left=Math.min(window.innerWidth-320, Math.max(8, x-140))+'px';
  b.style.top=(y-b.offsetHeight-14>0)?(y-b.offsetHeight-14)+'px':(y+18)+'px';
  b.classList.add('on');
  b.style.top=Math.max(8, Math.min(window.innerHeight-b.offsetHeight-8, y-b.offsetHeight-14))+'px';
 }
 function hide(){ var b=ensure(); if(b) b.classList.remove('on'); }
 document.addEventListener('mouseover',function(e){
  var el=e.target.closest&&e.target.closest('[data-tip]');
  if(el) show(el,e.clientX,e.clientY); else hide();
 },true);
 document.addEventListener('mousemove',function(e){
  var el=e.target.closest&&e.target.closest('[data-tip]');
  var b=ensure(); if(el&&b&&b.classList.contains('on')) show(el,e.clientX,e.clientY);
 },true);
 document.addEventListener('mouseleave',hide,true);
 window.addEventListener('scroll',hide,true);
/* ================= V2.8：上级随官阶 / 生而帝位 / 开局一致性 / 更多分支 ================= */
var SUP_HIGH={
 qing:[
  {t:'道台',n:'瑞观察',d:'辖下几个府的顶头上司，问你最多的一句是“钱从哪来”。'},
  {t:'藩司',n:'裕藩台',d:'一省的财政与人事都在他手上，朝里有人，也怕担事。'},
  {t:'军机大臣',n:'文军机',d:'军机处里走路最慢、说话最准的那位。'},
  {t:'首席军机',n:'庆亲王',d:'朝中第一人，见你只谈两件事：洋人和钱。'},
  {t:'太后 / 皇上',n:'御前',d:'你已经在天子的眼皮底下办事，能管你的人只剩下最上面那几个。'}
 ],
 beiyang:[
  {t:'道尹',n:'吴道尹',d:'北洋的道尹，跟过三位都督，谁也不得罪。'},
  {t:'省长',n:'张省长',d:'北洋省长，手里有兵有税。'},
  {t:'内阁总长',n:'交通总长',d:'中央各部里最肥的位子。'},
  {t:'总理',n:'国务总理',d:'北洋内阁的总理，换得比天气还勤。'},
  {t:'大总统',n:'总统府',d:'离你只差一步的人。'}
 ],
 kmt:[
  {t:'省党部委员',n:'李委员',d:'省党部里管人事的那位。'},
  {t:'厅长',n:'何厅长',d:'中央政府的厅长，抗战后方也照样讲排场。'},
  {t:'部长',n:'张部长',d:'部长级，能直接上签呈。'},
  {t:'行政院要员',n:'行政院',d:'院里的红人。'},
  {t:'委员长',n:'侍从室',d:'你的事情已经进了侍从室的卷宗。'}
 ],
 cpc:[
  {t:'县委书记',n:'王书记',d:'基层工作的老手。'},
  {t:'地委书记',n:'赵书记',d:'一方的主官。'},
  {t:'省委书记',n:'周书记',d:'手上有兵、有粮、有干部。'},
  {t:'中央局',n:'中央局',d:'中央局里管人管事的那几位。'},
  {t:'中央',n:'中央',d:'你的意见已经能进中央的会议。'}
 ],
 local:[
  {t:'县政府',n:'县府幕友',d:'替你应付省里、也替你捎话。'},
  {t:'省府',n:'省府要人',d:'省府里说得上话的人。'},
  {t:'督军府',n:'督军幕僚',d:'督军身边的人。'},
  {t:'跨省联盟',n:'联省代表',d:'几省之间的联络人。'},
  {t:'各方推举',n:'众望所归',d:'再往上，就是别人来求你。'}
 ],
 civil:[
  {t:'报馆社长',n:'周社长',d:'报馆的老板，也替你撑场面。'},
  {t:'学会会长',n:'钱会长',d:'学术或行业的头面人物。'},
  {t:'社会名流',n:'沈名流',d:'跨界的名人，消息最灵。'},
  {t:'全国性团体',n:'联合会',d:'全国性团体的主要负责人。'},
  {t:'时代影响者',n:'时代',d:'你已经不需要一个具体的上级了。'}
 ]
};

var _supOfV28=supOf;
supOf=function(){
 if(!s) return _supOfV28();
 if(s.isThrone) return {t:'无',n:'诸臣之上',d:'你坐在最上面，没有人管得了你——只有天下管得了你。'};
 var r=s.rank||0,tier=0;
 if(r>=6) tier=4; else if(r>=5) tier=3; else if(r>=4) tier=2; else if(r>=3) tier=1; else tier=0;
 if(tier===0) return _supOfV28();
 var list=SUP_HIGH[s.faction]||SUP_HIGH.civil;
 return list[Math.min(list.length-1, tier-1)];
};

/* ---------- 生而帝位 ---------- */
var _initV28=init;
init=function(){
 var tier=($('fTier')||{}).value||'low';
 _initV28();
 if(!s||s.dead) return;
 if(tier==='throne'){
  s.isLeader=true; s.isThrone=true; s.rank=7;
  s.cash+=4000; s.fund+=1200; s.trust=96; s.fame=clamp(s.fame+45); s.power=clamp(s.power+45);
  if(s.faction==='qing'){
   s.leaderPersona=s.year<1862?'咸丰帝':s.year<1875?'同治帝':s.year<1909?'光绪帝':'宣统帝';
  }else if(s.faction==='beiyang'){ s.leaderPersona='大总统'; }
  else { s.leaderPersona=s.name; }
  log('【出身】'+s.year+'年，你生在这个国家的最高处——'+s.leaderPersona+'。你不需要向上爬，只需要不被掀翻。');
 }
 render();persist();
};
$('btnBegin').onclick=init;

/* ---------- 开局一致性：身份、地位与阵营互斥 ---------- */
var _gateV28=gateRoles;
gateRoles=function(){
 var start=+(($('fStart')||{}).value||1840);
 var fac=($('fFac')||{}).value||'qing';
 var fit={qing:['soldier','officer','official','merchant','student'],beiyang:['soldier','officer','official','merchant','student'],
  kmt:['officer','official','student','activist'],cpc:['officer','official','student','activist'],
  local:['soldier','officer','official','merchant'],civil:['student','merchant','official','activist']};
 var allow=fit[fac]||fit.civil;
 var sel=$('fRole');
 [].forEach.call(sel.options,function(o){
  var min=ROLE_MIN[o.value]||1840;
  var badTime=start<min, badFac=allow.indexOf(o.value)<0;
  o.disabled=badTime||badFac;
  var base=o.textContent.replace(/（.*）$/,'');
  o.textContent=base+(badTime?'（'+min+'年后）':badFac?'（本阵营无此身份）':'');
 });
 if(sel.options[sel.selectedIndex]&&sel.options[sel.selectedIndex].disabled){
  for(var i=0;i<sel.options.length;i++){if(!sel.options[i].disabled){sel.selectedIndex=i;break;}}
 }
 var ts=$('fTier');
 if(ts){
  [].forEach.call(ts.options,function(o){
   var isThrone=o.value==='throne';
   var ok=!isThrone||(fac==='qing'&&start<1912)||(fac==='beiyang');
   o.disabled=!ok; o.hidden=!ok;
   if(!ok&&o.textContent.indexOf('（此阵营无）')<0) o.textContent=o.textContent+'（此阵营无）';
  });
  if(ts.options[ts.selectedIndex]&&ts.options[ts.selectedIndex].disabled) ts.value='low';
 }
};
['fFac','fStart','fRole'].forEach(function(id){
 var e=$(id); if(e) e.addEventListener('change',function(){try{gateRoles();}catch(err){}});
});

/* ---------- 更多“辛亥式”分支 ---------- */
(function(){
doGovern=_doGovernBase; /* V4.16.1：挂到主作用域，供后续版本包装 */
powerAct=_powerAct_base; /* V4.16.1 共享 */
rebelAct=_rebelAct_base; /* V4.16.1 共享 */
renderPowers=_renderPowers_base; /* V4.16.1 共享 */
renderRebel=_renderRebel_base; /* V4.16.1 共享 */
 var add={
  jiawu:{t:'把水师的银子先挪去练新军',d:'船已经沉了，人还能再练。',fac:['qing','local'],risk:1,
   cond:function(){return (s.rank>=3)||(s.track&&(s.track.army||0)>=1);},
   run:function(st,w){if(w){st.natl.军事=clamp(st.natl.军事+6);st.trust=clamp(st.trust-4);st.alt+=2;return '你把残部的银子扣下来另编一军，骂名和兵都归了你。';}st.trust=clamp(st.trust-10);return '账没做平，御史弹了你一本。';}},
  boxer:{t:'暗中保全本城，不去勤王',d:'太后要的是全天下跟她一起疯，你不打算陪。',fac:['qing','local'],risk:1,
   cond:function(){return s.rank>=2;},
   run:function(st,w){if(w){st.natl.秩序=clamp(st.natl.秩序+4);st.fame+=8;st.trust=clamp(st.trust-8);return '你没奉诏，城里的洋人和商户都记了你这份情。';}st.trust=clamp(st.trust-16);st.fame=clamp(st.fame-6);return '事情败露，京里把你当成二臣。';}},
  may4:{t:'替学生递话给报馆',d:'你自己不能上街，但可以让话上街。',fac:['civil','kmt'],risk:1,
   cond:function(){return (s.track&&(s.track.edu||0)>=1)||s.fame>=30;},
   run:function(st,w){if(w){st.fame+=10;st.power+=5;st.alt+=2;return '你的话第二天就上了头版，署名的却是别人。';}st.trust=clamp(st.trust-6);return '递话的人被抓了，认得你的人开始躲你。';}}
 };
 for(var i=0;i<EVENTS.length;i++){
  var ev=EVENTS[i];
  if(!ev||ev.__v28) continue;
  var extra=add[ev.id];
  if(extra){ ev.__v28=1; ev.opts.unshift(extra); }
 }
/* ================= V2.9：称谓一致 / 帝位锁场 / 随机开局校验 ================= */
function rankTitleOf(){
 if(!s) return '';
 if(s.isThrone) return s.year<1912?'皇帝':'元首';
 if(s.isLeader){
  if(s.faction==='qing') return '摄政 / 秉国';
  if(s.faction==='beiyang') return '大总统';
  if(s.faction==='kmt') return '国民政府主席';
  if(s.faction==='cpc') return '中央负责人';
  if(s.faction==='local') return '地方领袖';
  return '时代影响者';
 }
 return FAC[s.faction].ladder[Math.max(0,Math.min(7,s.rank))];
}
window.rankTitleOf=rankTitleOf;

/* 帝位：身份/出身/结社不再让人选，避免“皇帝还是军机大臣”这种矛盾 */
function applyThroneLock(){
 var isT=($('fTier')||{}).value==='throne';
 var ro=$('fRole'),og=$('fOrigin'),cl=$('fClub');
 if(ro){ ro.disabled=isT; if(isT){ ro.value='official'; } }
 if(og){
  var royal=null;
  [].forEach.call(og.options,function(o){ if(o.value==='皇室家庭') royal=o; });
  if(!royal){ royal=document.createElement('option'); royal.value='皇室家庭'; royal.textContent='皇室家庭'; og.appendChild(royal); }
  og.disabled=isT;
  if(isT){ royal.hidden=false; royal.disabled=false; og.value='皇室家庭'; }
  else{ royal.hidden=true; royal.disabled=true; if(og.value==='皇室家庭') og.value='普通家庭'; }
 }
 if(cl){ cl.disabled=isT; if(isT) cl.value='none'; }
}
['fTier'].forEach(function(id){var e=$(id); if(e) e.addEventListener('change',applyThroneLock);});
var _gateV29=gateRoles;
gateRoles=function(){ _gateV29(); try{applyThroneLock();}catch(e){} };

/* 称呼与职位一致：渲染后统一改写 */
var _supV29=supOf;
supOf=function(x,y){
 if(s&&(s.isLeader||s.isThrone)) return {n:'—',cl:'无',st:'—',d:'这位置之上没有人了。',rank:0,__none:true};
 return _supV29(x,y);
};
var _renderV29=render;
render=function(){
 _renderV29();
 if(!s) return;
 var t=rankTitleOf();
 if(s.isLeader||s.isThrone){
  var sb=$('supBox');
  if(sb){
   sb.innerHTML='<div class="small muted" style="margin:0">这个位子之上没有人了——如今的决断，由你自己担。</div>';
  }
 }
 var rn=$('rName'); if(rn) rn.textContent=t;
 var hh=$('hierarchy');
 if(hh){
  var L=leaderOf(s.faction,s.year);
  var lead = s.isThrone? ('你（'+t+'）') : (s.isLeader? ('你（首席，'+t+'）') : L);
  hh.innerHTML='<b>最高领导：</b>'+lead+'<br><b>你的职位：</b>'+t+(s.pendingFaction?'<br><span style="color:var(--red)">待加入：'+FAC[s.pendingFaction].name+'（'+FAC[s.pendingFaction].min+'年）</span>':'');
 }
};

/* 结局/报纸里的称谓也统一 */
var _endV29=endGame;
endGame=function(reason){
 if(s) s.__titleCache=rankTitleOf();
 _endV29(reason);
 try{
  var box=$('dlgBody'), t=rankTitleOf();
  box.innerHTML=box.innerHTML.replace(/<b>最终职位：<\/b>[^<]*/, '<b>最终身份：</b>'+t);
 }catch(e){}
};

/* 随机开局：地位与身份不打架 */
var _randV29=randomStart;
randomStart=function(){
 _randV29();
 var tier=$('fTier').value;
 if(tier==='high'||tier==='leader'||tier==='throne'){
  var ro=$('fRole');
  if(ro.value==='soldier'||ro.value==='student'||ro.value==='activist'){
   for(var i=0;i<ro.options.length;i++){ if(!ro.options[i].disabled && (ro.options[i].value==='officer'||ro.options[i].value==='official')){ ro.selectedIndex=i; break; } }
  }
 }
 applyThroneLock();
};

/* ---------- 更完整的开局自检 ---------- */
function setupGuard(){
 var fac=($('fFac')||{}).value||'qing';
 var start=+(($('fStart')||{}).value||1840);
 var min=(FAC[fac]&&FAC[fac].min)||1840;
 var sY=start;
 var cl=$('fClub');
 if(cl){
  [].forEach.call(cl.options,function(o){
   var m=0, mt=/（(\d{4})年成立）/.exec(o.textContent); if(mt) m=+mt[1];
   var ban=m>sY;
   o.disabled=ban;
   var base=o.textContent.replace(/（未成立）$/,'');
   o.textContent=base+(ban?'（未成立）':'');
  });
  if(cl.options[cl.selectedIndex]&&cl.options[cl.selectedIndex].disabled) cl.value='none';
 }
 var bd=$('fBirth');
 if(bd){
  var minAge={throne:14,leader:14,high:20,mid:16,low:12}[($('fTier')||{}).value||'low']||12;
  [].forEach.call(bd.options,function(o){
   var age=sY-(+o.value), ban=age<minAge;
   o.disabled=ban;
   var base=o.textContent.replace(/（年龄不符）$/,'');
   o.textContent=base+(ban?'（年龄不符）':'');
  });
  if(bd.options[bd.selectedIndex]&&bd.options[bd.selectedIndex].disabled){
   for(var i=0;i<bd.options.length;i++){ if(!bd.options[i].disabled){ bd.selectedIndex=i; break; } }
  }
 }
 var ts=$('fTier'), ro=$('fRole');
 if(ts){
  [].forEach.call(ts.options,function(o){
   var need=o.value==='leader'||o.value==='throne';
   var ok=!need||start>=min;
   var isThrone=o.value==='throne';
   var throneOk=!isThrone||((fac==='qing'&&start<1912)||fac==='beiyang');
   o.disabled=!(ok&&throneOk);
   o.hidden=!(ok&&throneOk);
   var base=o.textContent.replace(/（此阵营无）|（本阵营未立国）$/,'');
   o.textContent=base+(throneOk?'':'（此阵营无）')+(ok?'':'（本阵营未立国）');
  });
  if(ts.options[ts.selectedIndex]&&ts.options[ts.selectedIndex].disabled) ts.value='low';
 }
 if(ro){
  var tier=ts?ts.value:'low';
  [].forEach.call(ro.options,function(o){
   var v=o.value, ban=false;
   if(tier==='high'&&(v==='soldier'||v==='student'||v==='activist')) ban=true;
   if((tier==='leader'||tier==='throne')&&(v!=='officer'&&v!=='official')) ban=true;
   if(o.dataset&&o.dataset.orig){} 
   o.disabled=o.disabled||ban;
   var base=o.textContent.replace(/（与地位不符）$/,'');
   o.textContent=base+(ban?'（与地位不符）':'');
  });
  if(ro.options[ro.selectedIndex]&&ro.options[ro.selectedIndex].disabled){
   for(var i=0;i<ro.options.length;i++){if(!ro.options[i].disabled){ro.selectedIndex=i;break;}}
  }
 }
 applyThroneLock();
}
['fFac','fStart','fTier','fRole'].forEach(function(id){var e=$(id); if(e) e.addEventListener('change',setupGuard);});
setTimeout(function(){try{setupGuard();}catch(e){}},0);

/* ================= V3.0：治理、列强与内乱 ================= */
var POWERS=[
 {n:'英吉利',p:88,r:45,aim:'通商、鸦片与租界'},
 {n:'沙俄',p:76,r:38,aim:'东北与蒙古的铁路'},
 {n:'日本',p:44,r:35,aim:'朝鲜与满洲'},
 {n:'法兰西',p:62,r:40,aim:'中南半岛与教案'},
 {n:'德意志',p:50,r:35,aim:'胶州湾与军械生意'},
 {n:'美利坚',p:58,r:50,aim:'门户开放与商船'}
];
function initPowers(){
 if(!s.__powers){ s.__powers={}; }
 POWERS.forEach(function(P){
  if(!s.__powers[P.n]) s.__powers[P.n]={p:P.p,r:P.r,war:false};
 });
}
function powTick(){
 initPowers();
 var y=s.year;
 POWERS.forEach(function(P){
  var o=s.__powers[P.n];
  var drift=(y>=1895&&P.n==='日本')?1.2:(y>=1860&&P.n==='沙俄'?0.8:0.25);
  o.p=clamp(o.p+drift+rnd(-1,1));
  o.r=clamp(o.r-(o.war?2:0.3)+rnd(-0.8,0.8));
 });
 if(Math.random()<0.06){ // 偶发摩擦
  var P0=POWERS[Math.floor(Math.random()*POWERS.length)], o0=s.__powers[P0.n];
  o0.r=clamp(o0.r-6);
  log('【外事】'+P0.n+'的兵船在口岸游弋，商民聚在衙门口要个说法。');
 }
}

/* ---------- 内乱 ---------- */
var REBEL_NAMES=['白莲教余部','捻党','饥民','会党起事','团练哗变','苗民','回民','河工'];
function rebelTick(){
 if(s.__rebel) return;
 var risk=0.30-((s.natl.民心||50)-50)/300;
 if(s.year>=1851&&s.year<=1868) risk+=0.18;
 if((s.natl.财政||40)<28) risk+=0.12;
 if(Math.random()<Math.max(0.08,risk)){
  var place=stratName();
  s.__rebel={n:REBEL_NAMES[Math.floor(Math.random()*REBEL_NAMES.length)],arm:Math.round(rnd(2000,20000)*(1+(1940-s.year)/200)/100)*100,place:place};
  log('【内乱】'+place+'一带的'+s.__rebel.n+'聚了约 '+fmtMen(s.__rebel.arm)+'，破了县城。');
 }
}
function stratName(){
 var names=['皖北','豫西','湘南','桂北','川东','直隶南境','闽西','山东曹州','陕南','赣南'];
 return names[Math.floor(Math.random()*names.length)];
}

/* ---------- 行动体系：按身份换一套 ---------- */
var ACT_SETS={
 throne:[
  {k:'memorial',t:'批折子',d:'看各省的题本，一并把人事与钱粮过一遍。'},
  {k:'appoint',t:'用人',d:'简放大员，扶起自己的人。'},
  {k:'mobilize',t:'调兵',d:'调动各路兵马。'},
  {k:'treasury',t:'开库',d:'国库节流、加税或兴办实业。'},
  {k:'tour',t:'出巡',d:'去一趟地方，让人看看。'}
 ],
 high:[
  {k:'office',t:'办公',d:'把衙门里的事办利索。'},
  {k:'lobby',t:'交际',d:'串门子，递帖子，结交要人。'},
  {k:'petition',t:'递折子',d:'把你想做的事往上面递。'},
  {k:'inspect',t:'巡查',d:'下去走一圈，看看底下在做什么。'},
  {k:'earn',t:'谋生',d:'顺便把自己的日子过下去。'},
  {k:'rest',t:'休整',d:'少折腾，养精神。'}
 ],
 low:[
  {k:'work',t:'做工',d:'卖力气换饭钱。'},
  {k:'gossip',t:'打听',d:'在茶馆听消息。'},
  {k:'befriend',t:'结交',d:'认识能说得上话的人。'},
  {k:'drill',t:'操练',d:'练自己的身子与手艺。'},
  {k:'rest',t:'休整',d:'少折腾，养精神。'}
 ]
};
/* V4.18.5：每个身份都有自己的本行，按钮只放这个身份真正能做的事 */
var ROLE_MAIN={official:{k:'office',t:'办事',d:'处理衙门、账务或地方公务。'},merchant:{k:'earn',t:'谋生',d:'跑货、承办差事、拓展门路。'},
 student:{k:'study',t:'进修',d:'读书、投考、译书写稿。'},activist:{k:'organize',t:'组织',d:'传单、联络、募款，有风险。'}};
function actSetOf(){
 if(!s) return ACT_SETS.low;
 if(s.isThrone||s.isLeader) return ACT_SETS.throne;
 var mil=s.role==='soldier'||s.role==='officer';
 if(s.rank>=3){
  return ACT_SETS.high.map(function(it){
   if(it.k!=='office')return it;
   if(s.role==='official'||s.role==='merchant')return it;
   if(mil)return {k:'drill',t:'操练',d:'整训队伍、改善纪律与战备。'};
   return ROLE_MAIN[s.role]||{k:'befriend',t:'结交',d:'以社会关系和专业人脉扩大影响。'};
  });
 }
 var set=ACT_SETS.low.slice();
 if(ROLE_MAIN[s.role]) set.unshift(ROLE_MAIN[s.role]);
 return set;
}
function gAdd(k,v){ if(!s.natl) s.natl={稳定:62,经济:38,军事:45,财政:40,秩序:55,民心:50,国际:30,工业:15}; s.natl[k]=clamp((s.natl[k]||0)+v); }
window.__gAdd=gAdd; window.__initPowers=initPowers; /* V4.18：导出给主作用域代理（见文件顶部） */
function _doGovernBase(k){
 if(!s||!actGate('gov:'+k,'此事')) return;
 var r=Math.random();
 actCool('gov:'+k,15);
 if(k==='memorial'){
  gAdd('秩序',Math.round(rnd(1,3)));gAdd('财政',Math.round(rnd(0,2)));s.power+=Math.round(rnd(1,4));addExp('power',3);
  log('【批折】你连夜看了'+Math.round(rnd(12,40))+'本折子，'+(r<0.8?'两江的漕粮挪了挪，没出大岔子。':'有人在折子里夹带私货，你把名字记下了。'));
 } else if(k==='appoint'){
  s.trust=clamp(s.trust+Math.round(rnd(1,4)));s.alt+=Math.round(rnd(1,3));gAdd('秩序',1);
  log('【用人】你把'+randName()+'放到了要紧的位置上，'+(r<0.75?'他磕头谢恩，说愿效死力。':'人还没出京，就有人递话来说他不干净。'));
 } else if(k==='mobilize'){
  gAdd('军事',Math.round(rnd(1,4)));gAdd('秩序',-Math.round(rnd(0,2)));
  if(s.unit){ s.unit.mor=clamp(s.unit.mor+Math.round(rnd(2,6))); }
  log('【调兵】'+(r<0.7?'新军拔营，'+(s.__rebel?('往'+s.__rebel.place+'压过去。'):'在城下列队操演，百姓挤着看。'):'粮台没跟上，兵在道上闹了两天。'));
 } else if(k==='treasury'){
  var gain=Math.round(rnd(200,900));
  s.cash+=gain;gAdd('财政',Math.round(rnd(2,5)));gAdd('民心',-Math.round(rnd(1,4)));
  log('【开库】你从内帑与厘金里抠出 '+gain+' 两；'+(r<0.6?'户部的人脸色不好看。':'底下加了一层捐，民间开始骂。'));
 } else if(k==='tour'){
  s.fame+=Math.round(rnd(2,6));gAdd('民心',Math.round(rnd(1,3)));gAdd('秩序',Math.round(rnd(0,2)));
  log('【出巡】你走了一趟'+(s.region||'畿辅')+'，'+(r<0.7?'沿途百姓跪了一片，士气像涨了一点。':'地方官把该藏的都藏了，你只看见粉饰过的街面。'));
 } else if(k==='office'){
  addExp('skill',4);s.trust=clamp(s.trust+Math.round(rnd(1,3)));gAdd('秩序',1);
  log('【办公】你在签押房里坐到三更，'+(r<0.8?'案上的事清了大半。':'一件积案翻出来，牵出一串人。'));
 } else if(k==='lobby'){
  s.fame+=Math.round(rnd(1,3));s.power+=Math.round(rnd(1,2));
  log('【交际】你在'+['会馆','戏园','同乡的席面'][Math.floor(r*3)]+'上坐了一晚，'+(r<0.8?'认识了几张能用的脸。':'听了一耳朵闲话，都是不能写的。'));
 } else if(k==='petition'){
  s.power+=Math.round(rnd(1,3));gAdd('民心',1);
  log('【递折】你的折子递上去了，'+(r<0.7?'上面批了「知道了」三个字。':'留中不发，你也不知道是福是祸。'));
 } else if(k==='inspect'){
  s.fame+=Math.round(rnd(1,3));gAdd('秩序',Math.round(rnd(1,3)));
  log('【巡查】你查了两个县，'+(r<0.7?'仓里的米数与册上对得上。':'亏空比册上多三成，县官跪着不敢抬头。'));
 } else if(k==='earn'){
  var c=Math.round(rnd(8,30));s.cash+=c;
  log('【谋生】这一天挣了 '+c+' 两，'+(r<0.8?'够家里吃用。':'还搭进去一顿饭钱。'));
 } else if(k==='work'){
  var c2=Math.round(rnd(2,9));s.cash+=c2;addExp('skill',1);
  log('【做工】挣了 '+c2+' 两。手上的活没停，'+(r<0.8?'天黑前收工。':'东家还欠着半个月工钱。'));
 } else if(k==='gossip'){
  s.fame+=1;
  log('【打听】茶馆里在传：'+(s.__rebel?('官军要去'+s.__rebel.place+'剿'+s.__rebel.n):'洋人的船又靠了岸')+'。');
 } else if(k==='befriend'){
  s.fame+=Math.round(rnd(0,2));s.trust=clamp(s.trust+1);
  log('【结交】你请人喝了一壶，'+(r<0.8?'话算是说上了。':'对方只应了个虚字。'));
 } else if(k==='drill'){
  addExp('skill',3);
  log('【操练】你练了一身汗，手上的准头又稳了一点。');
 } else if(k==='rest'){
  s.health=clamp((s.health||100)+Math.round(rnd(1,3)));
  log('【歇着】你把门关了三天，'+(r<0.7?'精神好多了。':'脑子里的事还是放不下。'));
 }
 s.mood=(s.mood||'')+(r<0.5?'·':'');
 try{render();}catch(e){}
}


/* ---------- 渲染：重写行动按钮 ---------- */
function renderActs(){
 if(!s) return;
 var boxes=document.querySelectorAll('.acts'); if(!boxes.length) return;
 var box=boxes[0];
 var set=actSetOf();
 var kk=(s.isThrone||s.isLeader?'throne':(s.rank>=3?'high':'low'))+'_'+(s.role||'')+'_'+(s.rank||0);
 for(var q=1;q<boxes.length;q++){ boxes[q].innerHTML=''; }
 if(box.getAttribute('data-set')===kk && box.children.length===set.length) return;
 box.innerHTML='';
 set.forEach(function(it,i){
  var b=document.createElement('button');
  b.className='act'; b.setAttribute('data-act',it.k); b.setAttribute('data-cd','gov:'+it.k);
  var sp=document.createElement('span'); sp.className='tips'; sp.setAttribute('data-tip',it.d);
  sp.innerHTML='<b>'+it.t+'</b><span>'+it.d.slice(0,12)+'</span>';
  b.appendChild(sp);
  b.addEventListener('click',function(){ doGovern(it.k); });
  box.appendChild(b);
 });
 box.setAttribute('data-set',kk);
}

/* ---------- 列强与内乱卡片 ---------- */
function ensureCards(){
 if(!document.getElementById('cardPowers')){
  var p=document.createElement('div'); p.className='card'; p.id='cardPowers';
  p.innerHTML='<h2>列强</h2><div id="powersBody"></div>';
  var g=document.getElementById('cardGuoShi')||document.getElementById('cardNation');
  if(g&&g.parentNode){ g.parentNode.insertBefore(p,g); } else { document.querySelector('.main>div').appendChild(p); }
 }
 if(!document.getElementById('cardRebel')){
  var r=document.createElement('div'); r.className='card'; r.id='cardRebel';
  r.innerHTML='<h2>内乱</h2><div id="rebelBody"></div>';
  var P=document.getElementById('cardPowers');
  if(P&&P.parentNode) P.parentNode.insertBefore(r,P.nextSibling);
 }
 if(!document.getElementById('cardCompare')){
  var c=document.createElement('div'); c.className='card'; c.id='cardCompare';
  c.innerHTML='<h2>国力对比</h2><p class="small muted" style="margin:0 0 8px">我方与列强的陆海军力与工业底子，数字越大越硬。</p><div class="powers" style="grid-template-columns:1fr" id="cmpBox"></div>';
  var Q=document.getElementById('cardPowers');
  if(Q&&Q.parentNode) Q.parentNode.insertBefore(c,Q.nextSibling);
 }
 if(!document.getElementById('cardWar')){
  var w=document.createElement('div'); w.className='card'; w.id='cardWar';
  w.innerHTML='<h2>战事</h2><div id="warBox"></div>';
  var C=document.getElementById('cardCompare');
  if(C&&C.parentNode) C.parentNode.insertBefore(w,C.nextSibling);
 }
}
function _renderPowers_base(){
 ensureCards(); initPowers();
 var h='<p class="small muted" style="margin:0 0 8px">列强各有实力与对你的态度。可交涉、借款、购舰，也可以翻脸。</p>';
 h+='<div class="vpw">';
 POWERS.forEach(function(P){
  var o=s.__powers[P.n];
  h+='<div class="vpwrow"><b>'+P.n+'</b><span class="small muted">'+P.aim+'</span>'+
   '<div class="vpwbar"><i style="width:'+Math.round(o.p)+'%"></i></div>'+
   '<span class="small">'+Math.round(o.p)+' 实力 · '+Math.round(o.r)+' 关系'+(o.war?' · <b style="color:var(--red)">交兵</b>':'')+'</span>'+
   '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:4px">'+
   '<button class="btn sm" data-pw="talk" data-n="'+P.n+'" data-cd="pw:talk:'+P.n+'">交涉</button>'+
   '<button class="btn sm" data-pw="loan" data-n="'+P.n+'" data-cd="pw:loan:'+P.n+'">借款</button>'+
   '<button class="btn sm" data-pw="buy" data-n="'+P.n+'" data-cd="pw:buy:'+P.n+'">购舰</button>'+
   '<button class="btn sm" data-pw="war" data-n="'+P.n+'" data-cd="pw:war:'+P.n+'">'+(o.war?'和谈':'宣战')+'</button>'+
   '</div></div>';
 });
 h+='</div>';
 $('powersBody').innerHTML=h;
 [].forEach.call($('powersBody').querySelectorAll('[data-pw]'),function(b){
  b.onclick=function(){ powerAct(b.getAttribute('data-pw'),b.getAttribute('data-n')); };
 });
}

function _powerAct_base(k,n){
 if(!s) return;
 initPowers(); var o=s.__powers[n];
 if(k==='talk'){
  var d=Math.round(rnd(3,9)); o.r=clamp(o.r+d); actCool('pw:talk:'+n,30);
  log('【外事】你与'+n+'的使节谈了两轮，关系 +'+d+'。');
 } else if(k==='loan'){
  var m=Math.round(stateRev()*rnd(0.05,0.15)); stateRes(m); o.r=clamp(o.r+6); gAdd('财政',3); gAdd('民心',-2); actCool('pw:loan:'+n,180);
  log('【外事】向'+n+'借款约 '+M(m*1e4)+'，以关税、盐税作抵。银子入了国库，账本上的窟窿换了个名字。');
 } else if(k==='buy'){
  var _bc=Math.round(stateRev()*0.04); var _E=econEnsure(s);
  if(_E.state.res<_bc){ flash('国库存银不足：购械约需 '+M(_bc*1e4)+'，库存 '+M(_E.state.res*1e4)); return; }
  stateRes(-_bc); gAdd('军事',Math.round(rnd(2,5))); o.r=clamp(o.r+2); actCool('pw:buy:'+n,90);
  log('【外事】从'+n+'购入枪炮一批，耗银约 '+M(_bc*1e4)+'，军力上涨。');
 } else if(k==='war'){
  actCool('pw:war:'+n,60);
  if(!o.war){
   o.war=true;o.r=clamp(o.r-40);
   log('【开战】你对'+n+'宣战。朝野震动，'+(s.rank>=6?'无人能劝住你。':'有大臣跪在阶下不肯起。'));
  } else {
   if(Math.random()<0.5){ o.war=false;o.r=clamp(o.r+10); gAdd('民心',-3);
    log('【和谈】与'+n+'议和，割地赔款，字是签了。');
   } else { o.r=clamp(o.r+4); log('【和谈】对方只肯停火三个月，条件还没谈拢。'); }
  }
 }
 try{render();}catch(e){}
}

function _renderRebel_base(){
 ensureCards();
 var R=s.__rebel;
 if(!R){ $('rebelBody').innerHTML='<p class="small muted" style="margin:0">眼下还算太平。乱子往往在几个县里先冒头。</p>'; return; }
 $('rebelBody').innerHTML='<p class="small" style="margin:0 0 6px"><b>'+R.place+' · '+R.n+'</b> 聚了 '+R.arm+' 人。</p>'+
  '<div style="display:flex;gap:6px;flex-wrap:wrap">'+
  '<button class="btn sm" data-rb="kill">派兵镇压</button>'+
  '<button class="btn sm" data-rb="amnesty">招抚</button>'+
  '<button class="btn sm" data-rb="ignore">先不管</button></div>';
 [].forEach.call($('rebelBody').querySelectorAll('[data-rb]'),function(b){
  b.onclick=function(){ rebelAct(b.getAttribute('data-rb')); };
 });
}

function _rebelAct_base(k){
 var R=s.__rebel; if(!R) return;
 if(k==='kill'){
  var win=Math.random()<0.55+((s.natl.军事||45)-40)/200;
  if(win){ log('【平乱】'+R.place+'的'+R.n+'被压下去了，斩首'+Math.round(R.arm/3)+'级。'); gAdd('秩序',5); gAdd('民心',-4); s.fame+=3; }
  else { log('【平乱】官军在'+R.place+'吃了败仗，'+R.n+'的气焰更盛。'); gAdd('秩序',-4); gAdd('军事',-3); }
 } else if(k==='amnesty'){
  if(Math.random()<0.6){ log('【招抚】你许了免粮，'+R.n+'散了七成，余部编入乡勇。'); gAdd('民心',5); gAdd('秩序',2); }
  else { log('【招抚】条件没谈拢，' + R.n + '把来使赶了回来。'); gAdd('秩序',-2); }
 } else {
  log('【放任】你把折子压下了，'+R.place+'的乱子还在烧。'); gAdd('秩序',-5); gAdd('民心',-3);
 }
 s.__rebel=null; try{render();}catch(e){}
}


/* ---------- 年度：世界与人心的变化 ---------- */
var _ytV30=window.__yearTick;
window.__yearTick=function(){
 try{ if(_ytV30) _ytV30(); }catch(e){}
 try{
  powTick(); rebelTick();
  if(s&&s.__rebel && Math.random()<0.5){ s.__rebel.arm=Math.round(s.__rebel.arm*1.2); }
 }catch(e){}
 try{ renderPowers(); renderRebel(); }catch(e){}
 /* V4.17：旧版“年终回顾”弹窗改由时钟的年度报告统一展示，避免重复弹出 */
};

/* ---------- 年终回顾：改成“这一年你干了什么” ---------- */
function yearReview(){
 if(!s) return;
 var rows=[];
 rows.push('国势：政治稳定 '+Math.round(s.natl.稳定)+' · 经济 '+Math.round(s.natl.经济)+' · 军事 '+Math.round(s.natl.军事)+' · 民心 '+Math.round(s.natl.民心));
 rows.push('财政 '+Math.round(s.natl.财政)+' · 社会秩序 '+Math.round(s.natl.秩序)+' · 工业化 '+Math.round(s.natl.工业)+' · 国际地位 '+Math.round(s.natl.国际));
 rows.push('你的现银 '+M(s.cash)+' · 声望 '+Math.round(s.fame)+' · 影响 '+Math.round(s.power));
 if(s.__rebel) rows.push('未平：'+s.__rebel.place+' 的 '+s.__rebel.n+'（约 '+fmtMen(s.__rebel.arm)+'）');
 var wars=POWERS.filter(function(P){return s.__powers&&s.__powers[P.n]&&s.__powers[P.n].war;}).map(function(P){return P.n;});
 if(wars.length) rows.push('交兵中：'+wars.join('、'));
 $('dlgTag').textContent='这一年 · '+s.year+'年';
 $('dlgTitle').textContent=(s.isThrone?'御笔亲批的一年':(s.isLeader?'你处理的一年':'这一年'));
 $('dlgDesc').textContent=s.isThrone?'天下的事都堆在你案上，翻过去就是另一年。':'一年过去了，账要算清楚。';
 $('dlgBody').innerHTML='<div class="small" style="line-height:1.9">'+rows.join('<br>')+'</div>'+
  '<button class="choice" id="revOk"><b>知道了，过下去</b></button>';
 $('mask').classList.remove('hidden');
 $('revOk').onclick=function(){ $('mask').classList.add('hidden'); };
}

/* ---------- 统一渲染钩子 ---------- */
var _renderV30=render;
render=function(){
 _renderV30();
 try{
  renderActs();
  var ttl=document.getElementById('actTitle'), hint=document.getElementById('actHint');
  var hr=document.getElementById('hRole');
  if(hr) hr.textContent=(s.isThrone?('皇帝 · '+s.origin):(s.isLeader?('首席 · '+s.origin):(roleName(s.role)+' · '+s.origin)));
  if(ttl) ttl.textContent = s.isThrone?'朝政':(s.isLeader?'朝议':(s.rank>=3?'公务':'生计'));
  if(hint) hint.textContent = ACT_HINT_TEXT;
 }catch(e){}
 try{ renderPowers(); }catch(e){}
 try{ renderRebel(); }catch(e){}
};
setTimeout(function(){ try{ if(document.getElementById('setupCard')) {} }catch(e){} },0);

})();

})();

/* ---------- 历史分支记忆 ---------- */
function track(k,n){ if(!s) return; if(!s.track) s.track={}; s.track[k]=(s.track[k]||0)+(n||1); }
var _tickV27=window.__yearTick;
window.__yearTick=function(){
 if(_tickV27) try{_tickV27();}catch(e){}
 if(!s||s.dead) return;
 /* 领袖国策会被记住：轨迹影响国势自然走向 */
 if(s.track){
  if((s.track.army||0)>=3){ s.natl.军事=clamp(s.natl.军事+1); }
  if((s.track.edu||0)>=3){ s.natl.民心=clamp(s.natl.民心+1); }
  if((s.track.tax||0)>=3){ s.natl.民心=clamp(s.natl.民心-1); s.natl.财政=clamp(s.natl.财政+1); }
 }
};


/* 国策入账 */
(function(){
 POLICIES.forEach(function(p){
  var old=p.eff;
  p.eff=function(){ var r=old.apply(null,arguments); track(p.k,1); return r; };
 });
})();

/* ---------- 1911：新军听谁的 ---------- */
(function(){
 for(var i=0;i<EVENTS.length;i++){
  var ev=EVENTS[i];
  if(ev.y===1911 && !ev.__patched){
   ev.__patched=true;
   ev.opts.unshift({
    t:'新军拥你为主', d:'你这几年练的兵，认的是你这个人。', fac:['qing','beiyang','local'], risk:1,
    cond:function(){ return s.isLeader||s.rank>=3||(s.track&&(s.track.army||0)>=2); },
    run:function(st,win){
     if(win){ st.alt+=4; st.power+=14; st.fame+=10; st.rank=Math.min(7,st.rank+1);
      return '你的部队没有听朝廷调遣，而是把枪口转向了该转的方向。各省随后宣布独立。'; }
     st.trust=clamp(st.trust-12); st.power=clamp(st.power-6);
     return '有两个营没有跟你走，消息漏了出去，京里已经点了你的名。';
    }
   });
  }
 }
})();


/* ================= V3.1：邻国与领土变更 ================= */
function countryName(n){ return n; }
function closeDlg(){ var m=document.getElementById('mask'); if(m) m.classList.add('hidden'); }
function vlog(msg){ try{ if(typeof log==='function') log(msg); else { var w=document.getElementById('worldNote'); if(w) w.textContent=msg; } }catch(e){} }

function openCountry(n){
 var s=(window.__S?window.__S():null);
 var own=(world&&world.owner&&world.owner[n])||null;
 var power=null;
 if(window.WORLD_DATA&&window.WORLD_DATA.rings){
  for(var i=0;i<window.WORLD_DATA.rings.length;i++){
   if(window.WORLD_DATA.rings[i].n===n){ power=window.WORLD_DATA.rings[i].p; break; }
  }
 }
 var label=own?(CTRL_NAME[own]||own):(CTRL_NAME[power]||power||'地方势力');
 $('dlgTag').textContent='邻邦 · '+n;
 $('dlgTitle').textContent=n;
 $('dlgDesc').textContent='归属：'+label;
 var body=$('dlgBody'); body.innerHTML='';

 var p=document.createElement('p'); p.className='small';
 if(own==='qing'){
  p.textContent='此地已并入版图，地方官正在编户、量田、点丁。';
 }else if(own){
  p.textContent='此地现由'+label+'控制。';
 }else{
  p.textContent='此地是'+label+'的势力范围，与我方有通商与边界往来。';
 }
 body.appendChild(p);

 if(s&&!s.dead){
  if(own!=='qing'&&s.year>=1840){
   var b=document.createElement('button');
   b.className='choice';
   b.innerHTML='<b>调兵攻取</b><div class="sub">国库拨军费约 '+M(stateRev()*0.02*1e4)+'；军事越强越容易得手。约 '+dayCost('country:attack',60)+' 天。</div>';
   b.onclick=function(){
    closeDlg();
    if(!actGate('country:attack','调兵攻取')){ render(); return; }
    if(econEnsure(s).state.res<stateRev()*0.02){ flash('国库拿不出开拔军费（约 '+M(stateRev()*0.02*1e4)+'）'); render(); return; }
    actCool('country:attack',90); stateRes(-stateRev()*0.02);
    var odds=Math.max(8,Math.min(72, 18 + (s.skill||0)*0.35 + ((world&&world.guo&&world.guo.mil)||40)*0.35 + (s.power||0)*0.12));
    var win=Math.random()*100<odds;
    world.owner=world.owner||{};
    if(win){
     world.owner[n]='qing';
     s.fame=clamp(s.fame+9); s.power=clamp(s.power+10); s.alt=clamp((s.alt||0)+2);
     if(world.guo){ world.guo.terr=(world.guo.terr||0)+1; }
     vlog('【开边】'+n+'归入版图，你派去的兵在那里立了旗。');
    }else{
     s.fame=clamp(s.fame-5); s.trust=clamp(s.trust-6);
     if(world.guo){ world.guo.mil=clamp((world.guo.mil||40)-4); }
     vlog('【开边】'+n+'没打下来，折了两营人，京里有人开始算这笔账。');
    }
    renderMap(); render();
   };
   body.appendChild(b);
  }
  if(own==='qing'){
   var b2=document.createElement('button');
   b2.className='choice';
   b2.innerHTML='<b>设治抚民</b><div class="sub">安抚新附之地，涨民心。同一地方约 '+actDays(60)+' 天办一次。</div>';
   b2.onclick=function(){
    closeDlg();
    if(!actGate('country:settle:'+n,'设治抚民')){ render(); return; }
    actCool('country:settle:'+n,60); s.fame=clamp(s.fame+4);
    if(world.guo){ world.guo.min=clamp((world.guo.min||50)+3); }
    vlog('【设治】'+n+'设了县治，老百姓把旗子插在了自家门口。');
    render();
   };
   body.appendChild(b2);
  }
 }

 var close=document.createElement('button');
 close.className='choice'; close.innerHTML='<b>收起</b>';
 close.onclick=closeDlg;
 body.appendChild(close);
 $('mask').classList.remove('hidden');
}
window.openCountry=openCountry;

/* 年份推进时，边界可能被蚕食 */
(function(){
 var prev=window.__yearTick;
 window.__yearTick=function(){
  var s=(window.__S?window.__S():null);
  if(prev) try{prev();}catch(e){}
  try{
   if(!s||s.dead||!world||!world.owner) return;
   var mil=(world.guo&&world.guo.mil)||45;
   var risk=mil<38?0.34:(mil<48?0.18:0.06);
   if(Math.random()<risk){
    var border=['辽宁省','吉林省','黑龙江省','山东省','云南省','广西壮族自治区','新疆维吾尔自治区','西藏自治区','内蒙古自治区'];
    var pick=border[Math.floor(Math.random()*border.length)];
    var owners=['japan','russia','britain','france'];
    var who=owners[Math.floor(Math.random()*owners.length)];
    world.owner[pick]=who;
    vlog('【失地】'+pick+'被'+CTRL_NAME[who]+'的兵占了。');
    if(world.guo) world.guo.mil=clamp((world.guo.mil||45)-3);
    renderMap();
   }
  }catch(e){}
 };
})();


/* ================= V3.2：战争与国力对比 ================= */
function __S2(){ return window.__S?window.__S():null; }
function __W2(){ var w=window.__W?window.__W():null; if(!w){ w={guo:{}}; window.__WORLD_FALLBACK=w; } return w; }
var __CN2MAP={qing:'清',beiyang:'北洋',kmt:'国民党',cpc:'中共',local:'地方',japan:'日本',russia:'沙俄',britain:'英国',france:'法国',usa:'美国',dutch:'荷兰',germany:'德国',siam:'暹罗',nepal:'尼泊尔',afghan:'阿富汗',mongolia:'蒙古'};
function __CN2(k){ var n=window.__NAMES||{}; return n[k]||__CN2MAP[k]||k; }
function __CL2(n,lo,hi){ return window.__CLAMP?window.__CLAMP(n,lo,hi):n; }
function __RN2(){ return window.__RENDER?window.__RENDER():null; }
function __RM2(){ return window.__RENDERMAP?window.__RENDERMAP():null; }
function __LOG2(m){ try{ if(window.__LOG){ window.__LOG(m); return; } }catch(e){} var w=document.getElementById('worldNote'); if(w) w.textContent=m; }

var POW_MIL={japan:44,russia:76,britain:88,france:62,usa:58,dutch:40,siam:30,nepal:18,afghan:20,mongolia:12};

function settleWar(){
 var w=__W2(), s=__S2();
 if(!w.war||!s) return;
 var war=w.war; war.t++;
 var myMil=((w.guo&&w.guo.mil)||45)+(s.skill||0)*0.1;
 var enemy=POW_MIL[war.p]||50;
 var prob=Math.max(0.08,Math.min(0.9, 0.5+(myMil-enemy)/120));
 if(Math.random()<prob){
  war.score+=2; w.guo.mil=__CL2((w.guo.mil||45)+1);
  __LOG2('【战报】'+__CN2(war.p)+'的一处要塞被拿下，前线折子上写着「士气可用」。');
 }else{
  war.score-=1; w.guo.mil=__CL2((w.guo.mil||45)-2); w.guo.fin=__CL2((w.guo.fin||40)-2);
  __LOG2('【战报】'+__CN2(war.p)+'的舰队压过来，沿海丢了两个口子。');
 }
 if(war.score>=4){
  w.guo.terr=(w.guo.terr||0)+1;
  __LOG2('【和约】对方遣使求和，条款照着我们的意思写。');
  w.war=null; refreshWarCard(); __RM2();
 }else if(war.score<=-4){
  w.guo.mil=__CL2((w.guo.mil||45)-6);
  __LOG2('【败绩】这一仗打不下去了，只能割地赔款。');
  w.war=null; refreshWarCard(); __RM2();
 }
}

function refreshWarCard(){
 var box=document.getElementById('warBox'); if(!box) return;
 var w=__W2();
 if(!w.war){ box.innerHTML='<p class="small muted">眼下没有对外战事。点中国形势图上的邻国，可以兴兵入侵或宣战。</p>'; return; }
 var p=w.war.p;
 box.innerHTML='<p class="small">正在与 <b>'+__CN2(p)+'</b> 交战　第 '+w.war.t+' 年　'+(w.war.score>0?'我方占优':(w.war.score<0?'吃紧':'胶着'))+'</p>'+
  '<div class="pwbar" style="margin:5px 0 8px"><i style="width:'+Math.max(8,Math.min(92,50+w.war.score*10))+'%;background:#a23a2c"></i></div>'+
  '<button class="btn sm" id="btnTruce">遣使议和</button>';
 var b=document.getElementById('btnTruce'); if(b) b.onclick=truceWar;
}

function truceWar(){
 var w=__W2();
 if(!w.war) return;
 __LOG2('【议和】双方各退一步，仗先停下，条款留着以后再算。');
 w.war=null; refreshWarCard(); __RM2(); __RN2();
}

window.__truce=truceWar;
window.__declWar=function(p){ var w=__W2(); w.war={p:p,t:1,score:0}; __LOG2('【宣战】朝廷下旨，与'+__CN2(p)+'开战。'); refreshWarCard(); __RM2(); };

/* 邻国：加「兴兵侵入」与实力对比 */
(function(){
 var base=window.openCountry;
 window.openCountry=function(n){
  base(n);
  var s=__S2(); if(!s||s.dead) return;
  var body=document.getElementById('dlgBody'); if(!body) return;
  var own=(__W2().owner&&__W2().owner[n])||null;
  var power='japan';
  if(window.WORLD_DATA&&window.WORLD_DATA.rings){
   for(var i=0;i<window.WORLD_DATA.rings.length;i++){ if(window.WORLD_DATA.rings[i].n===n){ power=window.WORLD_DATA.rings[i].p; break; } }
  }
  var myMil=((__W2().guo&&__W2().guo.mil)||45);
  var info=document.createElement('p');
  info.className='small muted';
  info.style.margin='2px 0 8px';
  info.textContent='该国军力约 '+(POW_MIL[power]||50)+'，我方军事 '+myMil+'。';
  body.insertBefore(info, body.firstChild);

  if(own!=='qing'){
   var attack=document.createElement('button');
   attack.className='choice';
   attack.innerHTML='<b>兴兵侵入</b><div class="sub">胜了就换旗；约 '+dayCost('country:attack',60)+' 天。成功率约 '+Math.max(10,Math.min(70, Math.round(16+(s.skill||0)*0.3+myMil*0.4)))+'%。</div>';
   attack.onclick=function(){
    closeDlg();
    if(!actGate('country:attack','兴兵侵入')){ __RN2(); return; }
    actCool('country:attack',90);
    var odds=Math.max(10,Math.min(70, 16+(s.skill||0)*0.3+myMil*0.4));
    var w=__W2(); w.owner=w.owner||{};
    if(Math.random()*100<odds){
     w.owner[n]='qing';
     s.fame=__CL2(s.fame+8); s.power=__CL2(s.power+8);
     __LOG2('【入侵】'+n+'被我军打下，地图上那块换了旗。');
    }else{
     s.fame=__CL2(s.fame-4); s.trust=__CL2(s.trust-4);
     if(w.guo) w.guo.mil=__CL2((w.guo.mil||45)-3);
     __LOG2('【入侵】'+n+'打得很硬，我军退了回来。');
    }
    __RM2(); __RN2();
   };
   body.insertBefore(attack, body.firstChild);

   var war=document.createElement('button');
   war.className='choice';
   war.innerHTML='<b>正式宣战</b><div class="sub">进入战争状态，每年自动打一场，直到一方认输。</div>';
   war.onclick=function(){ closeDlg(); window.__declWar(power); __RN2(); };
   body.insertBefore(war, body.firstChild);
  }
 };
})();

/* 每年结算战事 */
(function(){
 var prev=window.__yearTick;
 window.__yearTick=function(){
  if(prev) try{prev();}catch(e){}
  try{ settleWar(); refreshWarCard(); }catch(e){}
 };
})();

/* 国力对比 */
function renderCompare(){
 var box=document.getElementById('cmpBox'); if(!box) return;
 var s=__S2(), w=__W2(); var g=w.guo||{};
 var mine=Math.round(((g.mil||45)*0.5+((s&&s.skill)||0)*0.35+((g.ind||15))*0.25));
 var rows=[['我方（清）',mine,'#a23a2c'],['日本',44,'#6d4a4a'],['沙俄',76,'#7c6a58'],['英国',88,'#5c6b58'],['法国',62,'#7b6a86'],['美国',58,'#5f7285']];
 box.innerHTML=rows.map(function(r){
  return '<div class="pwr"><b>'+r[0]+'</b><span class="pb"><i style="width:'+Math.max(4,Math.round(r[1]/90*100))+'%;background:'+r[2]+'"></i></span><em>'+r[1]+'</em></div>';
 }).join('');
}
window.__renderCompare=renderCompare;

(function(){
 var prev=window.__RENDERX;
})();

/* 每次渲染后刷新战事卡与对比卡 */
(function(){
 var prev=window.__yearTick;
 window.__yearTick=window.__yearTick;
 var r0=window.__RENDER;
 window.__RENDER=function(){ if(r0) r0(); try{ refreshWarCard(); renderCompare(); }catch(e){} };
})();


/* 列强卡上的「宣战」也接入战争系统（文档级委托，重渲染不掉） */
(function(){
 var MAP={'英吉利':'britain','沙俄':'russia','日本':'japan','法兰西':'france','德意志':'germany','美利坚':'usa'};
 if(document.__warHook) return;
 document.__warHook=1;
 document.addEventListener('click',function(e){
  var b=e.target&&e.target.closest?e.target.closest('[data-pw="war"]'):null;
  if(!b) return;
  var key=MAP[b.getAttribute('data-n')]||null;
  if(!key) return;
  if(window.__CAL&&window.__CAL.spending&&window.__CAL.spending()) return; /* V4.18.5：正在办别的事 */
  var w=__W2();
  if(w.war&&w.war.p===key) return;
  setTimeout(function(){ window.__declWar(key); },30);
 },true);
})();
setTimeout(function(){ try{ refreshWarCard(); renderCompare(); }catch(e){} }, 400);
// 战事与国力面板由状态变更/渲染钩子刷新，避免定时重建 DOM 引起闪烁。


/* ================= V4.0 ================= */
function V4W(){ return (window.__W?window.__W():{})||{}; }
function V4S(){ return window.__S?window.__S():null; }
var V4CNMAP={qing:'清',beiyang:'北洋',kmt:'国民党',cpc:'中共',local:'地方',japan:'日本',russia:'沙俄',britain:'英国',france:'法国',usa:'美国',dutch:'荷兰',germany:'德国',siam:'暹罗',nepal:'尼泊尔',afghan:'阿富汗',mongolia:'蒙古'};
function V4CN(k){ return V4CNMAP[k]||(window.__NAMES&&window.__NAMES[k])||k; }
function V4C(n,a,b){ return window.__CLAMP?window.__CLAMP(n,a,b):n; }
function V4R(){ if(window.__RENDER) window.__RENDER(); }
function V4RM(){ if(window.__RENDERMAP) window.__RENDERMAP(); }
function V4L(t){ try{ window.__LOG&&window.__LOG(t); }catch(e){} }

/* --- 人才池：有能力也有混饭的 --- */
var TALENTS=[
 {n:'李鸿章',s:92,bad:0,d:'办洋务最落地，也最会给自己留后手。'},
 {n:'张之洞',s:88,bad:0,d:'讲学问，办铁厂却比谁都会算账。'},
 {n:'左宗棠',s:86,bad:0,d:'脾气大，能打仗，粮饷账目一笔不差。'},
 {n:'刘铭传',s:80,bad:0,d:'淮军悍将，办地方很有章法。'},
 {n:'胡雪岩',s:76,bad:1,d:'能筹款，也能把亏空藏得很深。'},
 {n:'张謇',s:74,bad:0,d:'状元下海，实业与算式都实在。'},
 {n:'郭嵩焘',s:74,bad:0,d:'懂洋务，说话不合时宜，朝里没朋友。'},
 {n:'岑春煊',s:72,bad:0,d:'敢参人，得罪半个朝廷，办事不拖。'},
 {n:'刘永福',s:72,bad:0,d:'黑旗军，能守边，缺饷也不散。'},
 {n:'陈宝箴',s:70,bad:0,d:'地方新政办得不虚。'},
 {n:'丁宝桢',s:70,bad:0,d:'办事扎实，不会讨好人。'},
 {n:'赵尔巽',s:68,bad:0,d:'老吏，慢而不错。'},
 {n:'吴大澂',s:66,bad:0,d:'学问好，打仗一般，边务上很硬。'},
 {n:'孙家鼎',s:64,bad:0,d:'谨慎能守成，不能开创。'},
 {n:'翁同龢',s:60,bad:1,d:'讲气节，银子的事算不明白。'},
 {n:'康有为',s:62,bad:1,d:'话极大，事难落地。'},
 {n:'赵有德',s:32,bad:2,d:'捐班出身，字都写不周正，最会递帖子。'},
 {n:'钱思礼',s:28,bad:2,d:'会办寿宴、会写贺表，办事一塌糊涂。'},
 {n:'王守仁',s:26,bad:2,d:'名字好听，履历都是族里人编的。'},
 {n:'杨崇伊',s:30,bad:2,d:'专递弹章，谁给银子替谁说话。'}
];

function v4talents(){ var w=V4W(); if(!w.talents) w.talents=[]; return w.talents; }

function v4appoint(){
 var s=V4S(); if(!s||!actGate('gov:appoint','用人')) return;
 var w=V4W();
 if(!w.pool||!w.pool.length) w.pool=TALENTS.slice();
 var picks=[]; var pool=w.pool.slice();
 for(var i=0;i<3&&pool.length;i++) picks.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
 w.pool=pool;
 var mask=document.getElementById('mask'), body=document.getElementById('dlgBody');
 document.getElementById('dlgTag').textContent='用人';
 document.getElementById('dlgTitle').textContent='三个人递了履历上来';
 document.getElementById('dlgDesc').textContent='挑一个放到要紧处。才具高的不一定老实，老实的未必顶用。';
 body.innerHTML='';
 picks.forEach(function(p){
  var grade=p.s>=80?'干练':(p.s>=60?'可用':(p.s>=45?'平庸':'不济'));
  var b=document.createElement('button');
  b.className='choice';
  b.innerHTML='<b>'+p.n+'</b><div class="sub">'+p.d+'</div>'+
    '<div class="small" style="margin-top:4px">才具：'+grade+'（'+p.s+'）　操守：'+(p.bad>=2?'可疑':(p.bad===1?'一般':'可靠'))+'</div>';
  b.onclick=function(){
   if(!actGate('gov:appoint','用人')){ mask.classList.add('hidden'); return; }
   actCool('gov:appoint',60);
   v4talents().push({n:p.n,s:p.s,bad:p.bad,d:p.d,rel:45,rank:s.rank||0});
   s.alt+=1; s.trust=V4C(s.trust+Math.round(p.s/30),0,100);
   if(p.bad>=2){ stateRes(-Math.round(p.s*0.5));
     V4L('【用人】你把'+p.n+'放了上去。第一件事是办酒席，账走的是官银。'); }
   else { V4L('【用人】'+p.n+'磕头谢恩，说愿效死力。'); }
   mask.classList.add('hidden'); V4R();
  };
  body.appendChild(b);
 });
 var c=document.createElement('button'); c.className='choice'; c.innerHTML='<b>都不用了</b>';
 c.onclick=function(){ mask.classList.add('hidden'); };
 body.appendChild(c);
 mask.classList.remove('hidden');
}

function v4mobilize(){
 var s=V4S(); if(!s||!actGate('gov:mobilize','调兵')) return;
 var w=V4W(); var g=w.guo=w.guo||{};
 var mask=document.getElementById('mask'), body=document.getElementById('dlgBody');
 document.getElementById('dlgTag').textContent='调兵';
 document.getElementById('dlgTitle').textContent='调哪一路兵，往哪去';
 document.getElementById('dlgDesc').textContent='绿营便宜但不经打，新军能打但烧钱，禁军动了京城就空。';
 body.innerHTML='';
 var opts=[
  {t:'调绿营出省',d:'省钱，战力和军纪一般。',run:function(){ g.mil=V4C((g.mil||45)+1,0,100); g.ord=V4C((g.ord||55)-2,0,100); stateRes(-Math.round(stateRev()*0.004)); V4L('【调兵】绿营拔营，开拔银约 '+M(stateRev()*0.004*1e4)+'，沿途县令叫苦。'); }},
  {t:'调新军北上',d:'战力强，银子粮草烧得快。',run:function(){ g.mil=V4C((g.mil||45)+3,0,100); g.fin=V4C((g.fin||40)-3,0,100); stateRes(-Math.round(stateRev()*0.01)); V4L('【调兵】新军开拔，铁路运兵，耗银约 '+M(stateRev()*0.01*1e4)+'，粮台追着要钱。'); }},
  {t:'禁军守京不动',d:'稳住京师，对外没动静。',run:function(){ g.ord=V4C((g.ord||55)+3,0,100); g.mil=V4C((g.mil||45)-1,0,100); V4L('【调兵】禁军把城门看了起来，京里安静，外边的事更难办。'); }}
 ];
 opts.forEach(function(o){
  var b=document.createElement('button'); b.className='choice';
  b.innerHTML='<b>'+o.t+'</b><div class="sub">'+o.d+'</div>';
  b.onclick=function(){ if(!actGate('gov:mobilize','调兵')){ mask.classList.add('hidden'); return; } actCool('gov:mobilize',45); o.run(); mask.classList.add('hidden'); V4R(); };
  body.appendChild(b);
 });
 var c=document.createElement('button'); c.className='choice'; c.innerHTML='<b>收起</b>';
 c.onclick=function(){ mask.classList.add('hidden'); };
 body.appendChild(c);
 mask.classList.remove('hidden');
}

/* 拦截「用人 / 调兵」按钮，改走新弹窗 */
document.addEventListener('click',function(e){
 var b=e.target.closest&&e.target.closest('[data-act]');
 if(!b) return;
 var k=b.getAttribute('data-act');
 if(k==='appoint'){ e.preventDefault(); e.stopPropagation(); v4appoint(); }
 else if(k==='mobilize'){ e.preventDefault(); e.stopPropagation(); v4mobilize(); }
},true);

/* --- 人际卡只收好感 80 以上；人才好感≥80 也进人际 --- */
function v4renderRel(){
 var box=document.getElementById('relBox'); if(!box||!V4S()) return;
 var s=V4S(); var st=v4talents().filter(function(p){return p.rel>=80;});
 var wrap=document.getElementById('v4TalentRel');
 if(!wrap){
  wrap=document.createElement('div'); wrap.id='v4TalentRel';
  box.parentNode.appendChild(wrap);
 }
 if(!st.length){ wrap.innerHTML=''; return; }
 wrap.innerHTML='<p class="small muted" style="margin:8px 0 4px">已拔擢的人（好感 80 以上）</p>'+
  st.map(function(p){
   return '<div class="pcard"><div style="display:flex;justify-content:space-between"><b>'+p.n+'</b><span class="small muted">好感 '+Math.round(p.rel)+'</span></div>'+
    '<p class="small muted" style="margin:3px 0">'+p.d+'</p></div>';
  }).join('');
}

/* --- 人才卡：在「历史人物」卡下方 --- */
function v4renderTalentCard(){
 var host=document.getElementById('peopleBox');
 if(!host||!V4S()) return;
 var box=document.getElementById('v4TalentBox');
 if(!box){
  box=document.createElement('div'); box.id='v4TalentBox';
  box.style.marginTop='10px';
  host.parentNode.appendChild(box);
 }
 var st=v4talents();
 var sig=st.map(function(p){return [p.n,p.s,p.bad,Math.round(p.rel),p.rank||0].join(':');}).join('|');
 if(box.dataset.sig===sig) return;
 box.dataset.sig=sig;
 if(!st.length){ var empty='<p class="small muted">还没有自己拔擢起来的人，用「用人」选几个。</p>'; if(box.innerHTML!==empty)box.innerHTML=empty; return; }
 box.innerHTML='<p class="small muted" style="margin:6px 0 5px">麾下人才（提拔按对方品级打点）</p>'+
  st.map(function(p,i){
   return '<div class="pcard"><div style="display:flex;justify-content:space-between;align-items:center"><b>'+p.n+'</b>'+
    '<button class="btn sm" data-upp="'+i+'"'+(p.rel>=96?' disabled':'')+'>提拔</button></div>'+
    '<p class="small muted" style="margin:3px 0">才具 '+p.s+'　操守 '+(p.bad>=2?'可疑':(p.bad===1?'一般':'可靠'))+'　好感 '+Math.round(p.rel)+'</p></div>';
  }).join('')+'<button class="btn sm" id="v4More">再用一人</button>';
 box.querySelectorAll('[data-upp]').forEach(function(b){
  b.onclick=function(){
   var s=V4S(); var p=v4talents()[+b.getAttribute('data-upp')];
   if(!s||!p) return;
   var _tc=giftCost(Math.min(7,(p.rank||0)+1));
   if(s.cash<_tc){ flash('提拔要打点约 '+M(_tc)+'，你手上只有 '+M(s.cash)); V4R(); return; }
   s.cash-=_tc; p.rel=V4C(p.rel+12,0,100); p.rank=Math.min(7,(p.rank||0)+1); s.trust=V4C(s.trust+3,0,100);
   V4L('【拔擢】'+p.n+'又进了一级，来谢的时候带了两盒茶叶。'); V4R();
  };
 });
 var m=document.getElementById('v4More'); if(m) m.onclick=v4appoint;
}

/* --- 皇帝界面：实力放名字边、删晋升卡、国势上移 --- */
function v4layout(){
 var s=V4S(); if(!s) return;
 var w=V4W(); var g=w.guo||{};
 var hero=document.querySelector('.hero');
 if(hero){
  var tag=document.getElementById('v4Power');
  if(!tag){ tag=document.createElement('span'); tag.id='v4Power'; tag.className='tag'; }
  var h1=hero.querySelector('h1')||document.getElementById('hName');
  if(h1&&tag.parentNode!==h1.parentNode) h1.parentNode.insertBefore(tag,h1.nextSibling);
  var mine=Math.round(((g.mil||45)*0.55)+((s.skill||0)*0.3)+((g.ind||15)*0.25));
  tag.textContent='兵力 '+mine+' · 军事 '+(g.mil||45)+' · 财政 '+(g.fin||40);
 }
 var cards=[].slice.call(document.querySelectorAll('.card'));
 var ladder=null, nation=null;
 cards.forEach(function(c){
  var h=c.querySelector('h2'); if(!h) return;
  if(h.textContent==='晋升之路') ladder=c;
  if(h.textContent==='国势') nation=c;
 });
 var high=(s.isThrone||s.isLeader);
 if(ladder){
  ladder.style.display=high?'none':'';
  if(high&&nation&&nation.nextElementSibling!==ladder){ ladder.parentNode.insertBefore(nation,ladder); }
 }
 var unit=document.getElementById('cardUnit');
 if(unit){ var uh=unit.querySelector('h2'); if(uh) uh.textContent='兵力 / 粮草'; }
}

/* --- 战事图：按天推进，可指挥 --- */
function v4warPanel(){
 var box=document.getElementById('warBox'); if(!box) return;
 var w=V4W(); var s=V4S();
 if(!w||!w.war){ box.innerHTML='<p class="small muted">眼下没有对外战事。点地图上的邻国，可以兴兵入侵或宣战。</p>'; return; }
 var war=w.war;
 if(!war.my) war.my={n:Math.max(10,Math.round(((w.guo&&w.guo.mil)||45)*0.8+((s&&s.skill)||0)*0.6)),mor:72,sup:70};
 if(!war.en) war.en={n:({japan:44,russia:76,britain:88,france:62,usa:58,dutch:40,siam:30,nepal:18,afghan:20,mongolia:12})[war.p]||50,mor:72};
 if(war.day===undefined) war.day=0;
 if(typeof war.startOrd==='number'&&!war.done) war.day=Math.max(0,calTodayOrd()-war.startOrd);
 var my=war.my, en=war.en;
 var rows=
  '<div class="pwr"><b>我军</b><span class="pb"><i style="width:'+Math.min(100,my.n)+'%;background:#a23a2c"></i></span><em>'+fmtMen(my.n*1000)+'</em></div>'+
  '<div class="pwr"><b>士气</b><span class="pb"><i style="width:'+Math.max(0,my.mor)+'%;background:#6b7a8f"></i></span><em>'+Math.round(my.mor)+'</em></div>'+
  '<div class="pwr"><b>粮草</b><span class="pb"><i style="width:'+Math.max(0,my.sup||0)+'%;background:#8a7a5c"></i></span><em>'+Math.round(my.sup||0)+'</em></div>'+
  '<div class="pwr"><b>'+V4CN(war.p)+'</b><span class="pb"><i style="width:'+Math.min(100,en.n)+'%;background:#6d4a4a"></i></span><em>'+fmtMen(en.n*1000)+'</em></div>';
 if(war.done){
  box.innerHTML='<p class="small">此役已定：'+(war.done==='win'?'我军胜，对方割地求和。':'我军败，只能签和约。')+'　历时 '+Math.round(war.day/30)+' 个月</p>'+
   (war.logs||[]).slice(-4).map(function(x){return '<div class="small muted">· '+x+'</div>';}).join('')+
   '<button class="btn sm" id="v4CloseWar" style="margin-top:6px">收兵回朝</button>';
  var b=document.getElementById('v4CloseWar');
  if(b) b.onclick=function(){ w.war=null; v4warPanel(); V4RM(); V4R(); };
  return;
 }
 box.innerHTML='<p class="small">与 <b>'+V4CN(war.p)+'</b> 交兵　第 '+war.day+' 天（约第 '+(Math.floor(war.day/30)+1)+' 个月）</p>'+
  (war.place?'<p class="small muted" style="margin:2px 0 6px">战场：'+war.place+'</p>':'')+
  rows+
  '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:9px 0 6px">'+
   '<button class="btn sm" data-wc="attack" data-cd="war:cmd">进攻</button>'+
   '<button class="btn sm" data-wc="hold" data-cd="war:cmd">固守</button>'+
   '<button class="btn sm" data-wc="flank" data-cd="war:cmd">包抄</button>'+
   '<button class="btn sm" data-wc="supply" data-cd="war:cmd">调粮</button>'+
   '<button class="btn sm" data-wc="retreat">撤退</button>'+
  '</div>'+
  '<div class="small muted" style="max-height:110px;overflow:auto">'+(war.logs||[]).slice(-5).map(function(x){return '· '+x;}).join('<br>')+'</div>';
 box.querySelectorAll('[data-wc]').forEach(function(b){
  b.onclick=function(){ v4battle(b.getAttribute('data-wc')); };
 });
}

function v4battle(cmd){
 var w=V4W(), s=V4S(); var war=w&&w.war; if(!war||war.done) return;
 if(!actGate('war:cmd','前线指挥')) return;
 var my=war.my, en=war.en;
 /* V4.18：每道军令需要约两周落实；交兵天数一律按游戏日历计算 */
 actCool('war:cmd',Math.round(12+Math.random()*10));
 if(typeof war.startOrd!=='number') war.startOrd=calTodayOrd()-(war.day||0);
 war.day=Math.max(0,calTodayOrd()-war.startOrd);
 var msg=[];
 if(cmd==='attack'){
  var kill=Math.round(my.n*0.10*(my.mor/70)+Math.random()*4);
  en.n=Math.max(0,en.n-kill); en.mor=V4C(en.mor-5,0,100);
  var loss=Math.round(Math.max(1,en.n*0.05)+Math.random()*3);
  my.n=Math.max(0,my.n-loss); my.mor=V4C(my.mor-3,0,100);
  msg.push('进攻：推进十余里，毙伤敌约 '+fmtMen(kill*1000)+'，我折约 '+fmtMen(loss*1000)+'。');
 } else if(cmd==='hold'){
  my.mor=V4C(my.mor+3,0,100); en.mor=V4C(en.mor-2,0,100);
  var l2=Math.round(Math.max(0,en.n*0.03)); my.n=Math.max(0,my.n-l2);
  msg.push('固守：挖壕据守，敌军试探损失约 '+fmtMen(l2*1000)+'。');
 } else if(cmd==='flank'){
  if(Math.random()<0.55){ var k2=Math.round(my.n*0.16); en.n=Math.max(0,en.n-k2); en.mor=V4C(en.mor-9,0,100); msg.push('包抄得手：一口吃掉对方约 '+fmtMen(k2*1000)+'，阵脚乱了。'); }
  else { var k3=Math.round(my.n*0.12); my.n=Math.max(0,my.n-k3); my.mor=V4C(my.mor-8,0,100); msg.push('包抄被识破，反被切了后路，折约 '+fmtMen(k3*1000)+'。'); }
 } else if(cmd==='supply'){
  stateRes(-Math.round(stateRev()*0.01)); my.sup=V4C((my.sup||60)+12,0,100); my.mor=V4C(my.mor+5,0,100);
  if(w.guo) w.guo.fin=V4C((w.guo.fin||40)-2,0,100);
  msg.push('调粮：后方送来一批，军心稳了，户部又添亏空。');
 } else if(cmd==='retreat'){
  war.done='lose'; msg.push('撤退：这一仗算没打，退守原防。');
 }
 if(!war.done){
  my.sup=V4C((my.sup||70)-5,0,100);
  if(my.sup<30){ my.mor=V4C(my.mor-5,0,100); }
  if(my.n<=2||my.mor<=0){ war.done='lose'; }
  if(en.n<=2||en.mor<=0){ war.done='win'; }
 }
 war.logs=(war.logs||[]).concat(msg);
 if(war.done==='win'){
  if(w.guo){ w.guo.terr=(w.guo.terr||0)+1; w.guo.mil=V4C((w.guo.mil||45)+2,0,100); }
  v4L('【战果】'+V4CN(war.p)+'认输求和，割地赔款由我们提。');
 } else if(war.done==='lose'){
  if(w.guo){ w.guo.mil=V4C((w.guo.mil||45)-5,0,100); }
  v4L('【战果】仗打不下去，只能签和约。');
 }
 v4warPanel(); V4RM();
}

/* 宣战入口：改成按天计的战事 */
window.__declWarV4=function(p){
 var w=V4W();
 w.war={p:p,day:0,startOrd:calTodayOrd(),logs:['朝廷下旨，与'+V4CN(p)+'开战。'],place:'边境'};
 v4warPanel(); V4RM(); V4R();
};

/* 挂到渲染后 */
(function(){
 var r0=window.__RENDER;
 window.__RENDER=function(){
  try{ r0&&r0(); }catch(e){}
  try{ v4layout(); v4renderTalentCard(); v4renderRel(); v4warPanel(); }catch(e){}
 };
 setTimeout(function(){ try{ window.__RENDER(); }catch(e){} },600);
 // 战事与人际面板由状态变更/渲染钩子刷新，避免周期性替换 DOM。
})();


/* V4.1：地图上的国家弹窗不再给宣战入口 */
(function(){
 var prev=window.openCountry;
 if(!prev||prev.__noWar) return;
 window.openCountry=function(n){
  prev(n);
  var body=document.getElementById('dlgBody'); if(!body) return;
  [].slice.call(body.querySelectorAll('.choice')).forEach(function(b){
   if(b.textContent.indexOf('正式宣战')>=0) b.parentNode.removeChild(b);
  });
 };
 window.openCountry.__noWar=1;
})();

/* V4.1：战事卡常驻，开战后自动滚过去 */
(function(){
 var prevPanel=v4warPanel;
 window.__v4War=prevPanel;
 refreshWarCard=function(){ prevPanel(); };
 var oldPanel=v4warPanel;
 v4warPanel=function(){
  var box=document.getElementById('warBox'); if(!box) return;
  var w=V4W();
  oldPanel();
  var card=document.getElementById('cardWar');
  if(card){ card.style.display=''; var h=card.querySelector('h2'); if(h) h.textContent='战事图'; }
  if(w.war&&!w.war.__seen){
   w.war.__seen=1;
   setTimeout(function(){ try{ card.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} },80);
  }
 };
})();


/* ================= V4.1 控制台 / 分页 ================= */
(function(){
 var CATS={
  gov:['朝政','时代纪事','国势','晋升之路','组织与结社','派系','近事日志'],
  ppl:['历史人物','人际','同期人物','麾下人才'],
  mil:['兵力 / 粮草','本部','列强','国力对比','战事','战事图','内乱'],
  arc:['身体','年度报纸','存档','个人编年史','结局','创建角色']
 };
 function catOf(title){
  for(var k in CATS){ if(CATS[k].indexOf(title)>=0) return k; }
  return 'gov';
 }
 function cards(){ return [].slice.call(document.querySelectorAll('#game .card')); }
 function applyTab(tab){
  cards().forEach(function(c){
   var h=c.querySelector('h2'); if(!h) return;
   var t=h.textContent.trim();
   var cat=window.__tabCat?window.__tabCat(c,t):catOf(t);
   if(c.dataset.cat!==cat) c.dataset.cat=cat;
   var hide=!(tab==='all'||(' '+cat+' ').indexOf(' '+tab+' ')>=0);
   if(c.classList.contains('tabhide')!==hide) c.classList.toggle('tabhide',hide);
  });
  // 地图：时局、军政、全览
  var map=document.querySelector('.main>div:nth-child(2)');
  if(map){var mh=!(tab==='all'||tab==='mil'||tab==='pol');if(map.classList.contains('tabhide')!==mh)map.classList.toggle('tabhide',mh);}
  var setup=document.getElementById('setupCard');
  if(setup) setup.style.display=(tab==='all'||tab==='arc')?'':'none';
 }
 var cur='gov';
 function bindTabs(){
  var nav=document.getElementById('tabs'); if(!nav||nav.dataset.b) return;
  nav.dataset.b='1';
  nav.addEventListener('click',function(e){
   var b=e.target.closest('button[data-tab]'); if(!b) return;
   cur=b.getAttribute('data-tab');
   [].slice.call(nav.querySelectorAll('button')).forEach(function(x){ x.classList.toggle('on',x===b); });
   applyTab(cur);
  });
 }
 function hud(){
  var s=window.__S&&window.__S(); if(!s) return;
  var w=(window.__W&&window.__W())||{};
  function set(id,v){ var e=document.getElementById(id); if(e&&e.textContent!==String(v)) e.textContent=v; }
  set('hudName', s.name||'—');
  var RN={soldier:'士兵',officer:'军官',official:'文官',student:'学生',merchant:'商人',revolutionary:'革命者'};
  var role=s.isThrone?'皇帝':(s.isLeader?'领袖':(s.roleName||RN[s.role]||s.role||'—'));
  set('hudRole', role+(s.tierName?' · '+s.tierName:''));
  var FACN={qing:'清',beiyang:'北洋',kmt:'国民党',cpc:'中共',local:'地方',civil:'民间'};
  var age=(s.age!==undefined&&s.age!==null)?s.age:(s.birth?(s.year-s.birth):'—');
  set('hudYear', s.cal?calFmtOrd(s.cal.ord):((s.year||'—')+'年'));
  set('hudAge', age+'岁');
  set('hudFac', FACN[s.faction]||s.faction||'—');
  set('hudCash', M(s.cash||0));
  set('hudPlace', s.region||s.place||'—');
 }
 function run(){
  bindTabs(); hud();
  var started=!!(window.__S&&window.__S());
  var nav=document.getElementById('tabs');
  if(nav){var nd=started?'flex':'none';if(nav.style.display!==nd)nav.style.display=nd;}
  var hudEl=document.getElementById('hud');
  if(hudEl){var hd=started?'':'none';if(hudEl.style.display!==hd)hudEl.style.display=hd;}
  if(!started)document.body.style.paddingTop='0'; /* V4.17：开局后由时间栏布局函数统一计算 */
  if(!started){
   cards().forEach(function(c){ c.classList.remove('tabhide'); });
   var map=document.querySelector('.main>div:nth-child(2)'); if(map) map.classList.add('tabhide');
   var st=document.getElementById('setup'); if(st){ st.classList.remove('hidden'); st.style.display=''; }
   var gm=document.getElementById('game'); if(gm) gm.classList.add('hidden');
   return;
  }
  var st2=document.getElementById('setup'); if(st2){ st2.classList.add('hidden'); st2.style.display='none'; }
  var gm2=document.getElementById('game'); if(gm2) gm2.classList.remove('hidden');
  applyTab(cur);
 }
 setTimeout(run,700);
 setInterval(function(){ try{ hud(); applyTab(cur); var nav=document.getElementById('tabs'); var st=!!(window.__S&&window.__S()); if(nav) nav.style.display=st?'flex':'none'; var he=document.getElementById('hud'); if(he) he.style.display=st?'':'none'; }catch(e){} },1000);
 var r0=window.__RENDER;
 window.__RENDER=function(){ try{ r0&&r0(); }catch(e){} setTimeout(run,30); };
})();

/* V4.16.1：主作用域闭合移至文件末尾，修复 chooseEvent 未定义 */

/* ========== V4.1c 独立修正尾巴 ========== */
(function(){
 if(window.__V41C) return; window.__V41C=1;

 function S(){ try{ return window.__S?window.__S():null; }catch(e){ return null; } }

 /* 第一个分页名跟着身份走 */
 function fixTab(){
  var nav=document.querySelector('#tabs button[data-tab="gov"]'); if(!nav) return;
  var s=S(); var name='朝政';
  if(s){
   if(s.isThrone) name='朝政';
   else if(s.isLeader) name='朝议';
   else if((s.rank||0)>=3) name='公务';
   else name='生计';
  }
  if(nav.textContent!==name) nav.textContent=name;
 }
 setInterval(fixTab,700); fixTab();

 /* 皇帝/元首：晋升之路不显示 */
 function fixLadder(){
  var s=S(); if(!s) return;
  var hide=!!(s.isThrone||s.isLeader);
  [].slice.call(document.querySelectorAll('.card')).forEach(function(c){
   var h=c.querySelector('h2'); if(!h) return;
   if(h.textContent.trim()!=='晋升之路') return;
   if(hide){ if(c.style.display!=='none') c.style.display='none'; c.dataset.hiddenBy='throne'; }
   else if(c.dataset.hiddenBy==='throne'){ c.style.display=''; delete c.dataset.hiddenBy; }
  });
 }
 setInterval(fixLadder,700); fixLadder();

 /* 任何弹窗里的「正式宣战」一律剥掉 */
 function stripWar(){
  var box=document.getElementById('dlgBody'); if(!box) return;
  [].slice.call(box.querySelectorAll('.choice')).forEach(function(b){
   var t=b.textContent||'';
   if(t.indexOf('正式宣战')>=0||t.indexOf('调兵攻取')>=0||t.indexOf('兴兵侵入')>=0){ b.remove(); }
  });
 }
 var mo=new MutationObserver(function(){ stripWar(); });
 document.addEventListener('DOMContentLoaded',function(){
  var box=document.getElementById('dlgBody');
  if(box) mo.observe(box,{childList:true,subtree:true,characterData:true});
 });
 setTimeout(function(){ var box=document.getElementById('dlgBody'); if(box) mo.observe(box,{childList:true,subtree:true,characterData:true}); },600);
 document.addEventListener('click',function(){ setTimeout(stripWar,80); },true);

 /* 战事卡：补敌方士气与战况（不改内部函数，直接改 DOM） */
 function warText(){
  var box=document.getElementById('warBox'); if(!box) return;
  if(box.querySelector('.v41c-battle')) return;
  var w=null; try{ w=window.__W?window.__W():null; }catch(e){}
  if(!w||!w.war||w.war.done) return;
  var my=w.war.my||{}, en=w.war.en||{};
  var r=Math.max(0.05,Math.min(3,(my.n||1)/Math.max(1,en.n||1)));
  var mood=r>1.6?'我军压着打':(r>1.1?'我军略占上风':(r>0.9?'僵持':(r>0.5?'我军吃力':'我军顶不住')));
  var d=w.war.day||0;
  var html='<div class="v41c-battle" style="margin:4px 0 8px">'+
   '<div class="small" style="color:var(--ink-2);margin-bottom:4px">战况：<b>'+mood+'</b>　交兵 '+Math.floor(d/30)+' 个月 '+(d%30)+' 天</div>'+
   '<div class="pwr"><b>敌方士气</b><span class="pb"><i style="width:'+Math.max(0,Math.min(100,en.mor||0))+'%;background:#7d4f4f"></i></span><em>'+Math.round(en.mor||0)+'</em></div>'+
   '</div>';
  box.insertAdjacentHTML('afterbegin',html);
 }
 setInterval(warText,900);
})();

/* ========== V4.1d 补 v4L 日志别名 ========== */
window.v4L = window.v4L || function(t){
 try{
  if(typeof window.__LOG==='function'){ window.__LOG(String(t)); return; }
  var st=window.__S?window.__S():null;
  if(st&&st.logs){ st.logs.push(String(t)); }
 }catch(e){}
};

/* ========== V4.2 统一：身份分层 / 交接 / 关系网 ========== */
(function(){
 if(window.__V42U) return; window.__V42U=1;

 function ST(){ try{ return window.__S?window.__S():null; }catch(e){ return null; } }
 function R (t){ try{ window.__LOG&&window.__LOG(String(t)); }catch(e){} }
 function relOf(s,n){ if(s.rel[n]===undefined) s.rel[n]=50; return s.rel[n]; }
 function hash(str){ var h=0; for(var i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))%100000; } return h; }

 function tier(){
  var s=ST(); if(!s) return 0;
  if(s.isThrone||s.isLeader) return 3;
  if((s.rank||0)>=4) return 2;
  if((s.rank||0)>=2) return 1;
  return 0;
 }

 /* ---- 1) 身份：只打两个标记，靠 CSS 隐藏，不做逐帧开关 ---- */
 function markCards(){
  document.querySelectorAll('.card').forEach(function(c){
   var h=c.querySelector('h2'); if(!h||c.dataset.role) return;
   var t=h.textContent.trim();
   if(t==='列强') c.dataset.role='powers';
   else if(t==='战事'||t==='战事图') c.dataset.role='war';
   else if(t==='国力对比') c.dataset.role='compare';
   else if(t==='内乱') c.dataset.role='rebel';
   else if(t==='兵力 / 粮草'||t==='同棚几个人'||t==='本队'||t==='本部'||t==='禁军') c.dataset.role='own';
  });
  document.body.classList.remove('t0','t1','t2','t3');
  document.body.classList.add('t'+tier());
 }

 /* ---- 2) 兵马卡：按身份改名 + 小兵只留名册 ---- */
 var XING='赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨'.split('');
 var MING=['大柱','石头','福生','老栓','三宝','阿贵','小六','来喜','有田','春生','二狗','满仓'];
 var NOTE=['枪法还稳，就是胆小','话少，站岗能站一夜','爱赌，饷银月月光','识几个字，会写家信','家里五口人全靠他',
           '打过两年仗，脸上有疤','饭量大，力气也大','嘴甜，会伺候人','睡得死，哨上得盯着','老实，叫他做啥就做啥'];
 var OWNNAME=['同棚几个人','本哨','本标','禁军'];
 function fixOwn(){
  var s=ST(); if(!s) return;
  var c=document.querySelector('[data-role="own"]'); if(!c) return;
  var t=tier(), h=c.querySelector('h2');
  if(t===0&&h&&h.textContent.trim()!==OWNNAME[0]) h.textContent=OWNNAME[0];
  var box=c.querySelector('#v42men');
  if(t===0){
   if(box) return;
   box=document.createElement('div'); box.id='v42men';
   var seed=hash((s.name||'')+s.year), men='';
   for(var i=0;i<5;i++){
    men+='<div class="pcard" style="padding:6px 8px"><b>'+XING[(seed+i*7)%XING.length]+MING[(seed+i*13)%MING.length]+
     '</b> <span class="small muted">'+(18+((seed+i*3)%14))+' 岁 · '+NOTE[(seed+i*11)%NOTE.length]+'</span></div>';
   }
   box.innerHTML='<div class="small muted" style="margin:6px 0 4px">名册（5 人）——你管不着别人，就这几个跟你一棚。</div>'+men;
   c.appendChild(box);
  }else if(box){ box.remove(); }
 }

 /* ---- 3) 关系网（只在人数/数值变化时重画） ---- */
 function netSig(){
  var s=ST(); if(!s) return '';
  var ns=[].slice.call(document.querySelectorAll('#peopleBox [data-n]')).map(function(b){return b.getAttribute('data-n');});
  var uniq=[]; ns.forEach(function(n){ if(uniq.indexOf(n)<0) uniq.push(n); });
  return uniq.map(function(n){ return n+':'+Math.round(relOf(s,n)); }).join('|');
 }
 function netCard(){
  var anchor=document.getElementById('peopleBox'); if(!anchor) return;
  var host=document.getElementById('v42net');
  if(!host){
   host=document.createElement('div'); host.className='card'; host.id='v42net'; host.style.marginTop='12px';
   anchor.closest('.card').parentNode.insertBefore(host, anchor.closest('.card').nextSibling);
  }
  var sig=netSig(); if(host.dataset.sig===sig) return;
  host.dataset.sig=sig;
  var s=ST(); if(!s) return;
  var rows=[];
  sig.split('|').filter(Boolean).forEach(function(x){
   var p=x.split(':'); rows.push({n:p[0], r:+p[1]});
  });
  if(!rows.length){ host.innerHTML='<h2>关系网</h2><p class="small muted">还没有搭得上话的人。</p>'; return; }
  rows.sort(function(a,b){ return b.r-a.r; });
  var mine=rows.filter(function(x){return x.r>=60;}), rest=rows.filter(function(x){return x.r<60;});
  host.innerHTML='<h2>关系网</h2>'+
   '<div class="small muted" style="margin:4px 0 3px">你的人了（好感≥60，'+mine.length+' 人）</div><div class="v42net">'+
   (mine.length?mine.map(function(x){return '<span class="v42chip hi">'+x.n+'<em>'+x.r+'</em></span>';}).join(''):'<span class="small muted">一个都没有。</span>')+
   '</div><div class="small muted" style="margin:10px 0 3px">点头之交</div><div class="v42net">'+
   (rest.length?rest.map(function(x){return '<span class="v42chip'+(x.r<=30?' lo':'')+'">'+x.n+'<em>'+x.r+'</em></span>';}).join(''):'<span class="small muted">无。</span>')+
   '</div>';
 }

 /* ---- 4) 一处总刷新：监听 #game 变化，节流执行 ---- */
 var pending=false;
 function refresh(){
  if(pending) return; pending=true;
  requestAnimationFrame(function(){
   pending=false;
   try{ markCards(); fixOwn(); }catch(e){}
  });
 }
 var mo=new MutationObserver(refresh);
 function bind(){
  var g=document.getElementById('game');
  if(g&&!g.dataset.mo){ g.dataset.mo='1'; mo.observe(g,{childList:true,subtree:true}); }
  refresh();
 }
 setTimeout(bind,600); setInterval(bind,2000);

 /* ---- 5) 结识：限三次闲聊，好感即时反映 ---- */
 var BUSY=false;
 var INTRO=['读过几年私塾，字写得比你说得还好听','原籍直隶，逃荒来的，话里带北边口音','在衙门里做过杂役，最会看人下菜碟',
            '当过兵，退下来在城里摆个摊','说话慢，急了会结巴','爱笑，笑起来眼睛就没了','烟袋不离手，一说话先咳三声',
            '老婆管得严，每月只给两百文酒钱'];
 var CHAT=['“你这人也实在，跟那些人不一样。”','“前日上头又换了章程，谁也没弄明白。”','“我家里还有个老弟，托人找个差事。”',
           '“这年头，能吃饱就算过得不差。”','“你说的那个事，我再打听打听。”','“别看我这样，年轻时也想过出人头地。”'];
 function who(){
  try{ if(window.__V425pick) return window.__V425pick(); }catch(e){}
  var ns=[]; document.querySelectorAll('#peopleBox [data-n]').forEach(function(b){ var n=b.getAttribute('data-n'); if(ns.indexOf(n)<0) ns.push(n); });
  var men=[].slice.call(document.querySelectorAll('#v42men .pcard b')).map(function(b){return b.textContent;});
  men.forEach(function(n){ if(ns.indexOf(n)<0) ns.push(n); });
  return ns.length?ns[Math.floor(Math.random()*ns.length)]:'本街的刘秀才'; }

 function openMeet(name){
  if(BUSY) return; BUSY=true;
  var s=ST();
  var left=3;
  var d=document.createElement('div');
  d.id='v42meet';
  d.style.cssText='position:fixed;inset:0;background:rgba(20,22,18,.55);z-index:82;display:flex;align-items:center;justify-content:center;padding:14px';
  d.innerHTML='<div style="background:#fdfaf2;max-width:470px;width:100%;padding:18px;border-top:3px solid #a33">'+
   '<div class="small muted">结识</div><h3 style="margin:6px 0 2px">'+name+'</h3>'+
   '<p class="small" style="color:#5c5346;margin:2px 0 6px">'+INTRO[hash(name)%INTRO.length]+'</p>'+
   '<p class="small muted" id="v42rel" style="margin:0 0 10px"></p>'+
   '<div style="display:grid;gap:8px">'+
    '<button class="btn" data-m="chat">坐下聊两句（此次拜会可聊 3 次）</button>'+
    '<button class="btn" data-m="gift">送点东西（20 两，好感 +8）</button>'+
    '<button class="btn" data-m="out">告辞</button>'+
   '</div><div id="v42say" class="small" style="margin-top:10px;color:var(--ink-2)"></div></div>';
  document.body.appendChild(d);
  function paint(){
   var r=Math.round(relOf(ST(),name));
   d.querySelector('#v42rel').textContent='眼下的交情 '+r+'（到 60 才算你这边的人）　还能聊 '+left+' 次';
  }
  paint();
  d.addEventListener('click',function(e){
   var b=e.target.closest('[data-m]'); if(!b) return;
   var a=b.getAttribute('data-m'), st=ST();
   if(a==='chat'){
    if(left<=0){ d.querySelector('#v42say').textContent='话说到这儿，再坐着就尴尬了。'; return; }
    left--;
    st.rel[name]=Math.min(100,relOf(st,name)+4);
    d.querySelector('#v42say').textContent=CHAT[Math.floor(Math.random()*CHAT.length)];
    paint(); refresh();
   }else if(a==='gift'){
    if(st.cash>=20){ st.cash-=20; st.rel[name]=Math.min(100,relOf(st,name)+8); R('【结交】你送了'+name+'一份薄礼。'); }
    else d.querySelector('#v42say').textContent='摸了摸口袋，银子不够。';
    paint(); refresh();
   }else{ d.remove(); BUSY=false; }
  });
 }

 document.addEventListener('click',function(e){
  var b=e.target.closest('[data-act="befriend"]');
  if(!b) return;
  return; /* V4.18.5：结交改为在选项里直接结识一人，记入新关系网，不再弹出旧拜会框 */
  setTimeout(function(){ openMeet(who()); },240);
 },true);

 /* 每年人物主动上门（复用结识弹窗的样式，独立实现） */
 var lastY=null;
 var mo2=new MutationObserver(function(){});
 setInterval(function(){
  var s=ST(); if(!s) return;
  if(lastY===null){ lastY=s.year; return; }
  if(s.year===lastY) return;
  lastY=s.year;
  if(Math.random()>0.3) return;
  var n=who(), st=ST(), r=relOf(st,n);
  R('【人事】'+n+'今年来找过你。');
  st.rel[n]=Math.min(100,r+2);
  refresh();
 },1500);

 refresh();

})();


/* ========== V4.2.5 关系网收纳结识过的人 ========== */
(function(){
 if(window.__V425) return; window.__V425=1;
 function ST(){ try{ return window.__S?window.__S():null; }catch(e){ return null; } }
 function relOf(s,n){ if(s.rel[n]===undefined)s.rel[n]=50; return s.rel[n]; }

 /* 结识过的人记进 s.met */
 var mo=new MutationObserver(function(){
  var d=document.getElementById('v42meet');
  if(!d||d.dataset.saved) return;
  d.dataset.saved='1';
  var s=ST(); if(!s) return;
  var name=(d.querySelector('h3')||{}).textContent||'';
  if(!name) return;
  if(!s.met) s.met=[];
  if(s.met.indexOf(name)<0){ s.met.push(name); if(s.rel[name]===undefined) s.rel[name]=50; }
 });
 mo.observe(document.body,{childList:true});

 /* 关系网：把 s.met 也算进来 */
 var paint=setInterval(function(){
  if(window.__V4185NET) return; /* V4.18.5：关系网由新卡片绘制 */
  var s=ST(); if(!s) return;
  var host=document.getElementById('v42net');
  if(!host){
   var anchor=document.getElementById('peopleBox'); if(!anchor) return;
   var card=anchor.closest('.card'); if(!card) return;
   host=document.createElement('div'); host.className='card'; host.id='v42net'; host.style.marginTop='12px';
   card.parentNode.insertBefore(host, card.nextSibling);
  }
  var names=[];
  document.querySelectorAll('#peopleBox [data-n]').forEach(function(b){ var n=b.getAttribute('data-n'); if(names.indexOf(n)<0)names.push(n); });
  (s.met||[]).forEach(function(n){ if(names.indexOf(n)<0) names.push(n); });
  if(!names.length){
   if(host.dataset.empty!=='1'){ host.dataset.empty='1'; host.innerHTML='<h2>关系网</h2><p class="small muted">还没有人。去「结交」碰一个，或者跟同棚的处好关系。</p>'; }
   return;
  }
  host.dataset.empty='0';
  var sig=names.map(function(n){return n+':'+Math.round(relOf(s,n));}).join('|');
  if(host.dataset.sig===sig) return;
  host.dataset.sig=sig;
  var rows=names.map(function(n){return {n:n,r:Math.round(relOf(s,n))};}).sort(function(a,b){return b.r-a.r;});
  var mine=rows.filter(function(x){return x.r>=60;}), rest=rows.filter(function(x){return x.r<60;});
  host.innerHTML='<h2>关系网</h2>'+
   '<div class="small muted" style="margin:4px 0 3px">你的人了（好感≥60，'+mine.length+' 人）</div><div class="v42net">'+
   (mine.length?mine.map(function(x){return '<span class="v42chip hi">'+x.n+'<em>'+x.r+'</em></span>';}).join(''):'<span class="small muted">一个都没有。</span>')+
   '</div><div class="small muted" style="margin:10px 0 3px">点头之交</div><div class="v42net">'+
   (rest.length?rest.map(function(x){return '<span class="v42chip'+(x.r<=30?' lo':'')+'">'+x.n+'<em>'+x.r+'</em></span>';}).join(''):'<span class="small muted">无。</span>')+
   '</div>';
 },1200);

 /* 结交时若没熟人，就从同棚名册里挑 */
 var pick=setInterval(function(){
  if(window.__V425pick) return;
  window.__V425pick=function(){
   var s=ST(); if(!s) return '本街的刘秀才';
   var ns=(s.met||[]).slice();
   document.querySelectorAll('#peopleBox [data-n]').forEach(function(b){ var n=b.getAttribute('data-n'); if(ns.indexOf(n)<0)ns.push(n); });
   var men=[].slice.call(document.querySelectorAll('#v42men .pcard b')).map(function(b){return b.textContent;});
   men.forEach(function(n){ if(ns.indexOf(n)<0)ns.push(n); });
   return ns.length?ns[Math.floor(Math.random()*ns.length)]:'本街的刘秀才';
  };
  clearInterval(pick);
 },1500);
})();

/* ========== V4.2.6 移出 DOM + 军制命名 ========== */
(function(){
 if(window.__V426) return; window.__V426=1;
 function ST(){ try{ return window.__S?window.__S():null; }catch(e){ return null; } }
 function tier(){ var s=ST(); if(!s) return 0; if(s.isThrone||s.isLeader) return 3; if((s.rank||0)>=4) return 2; if((s.rank||0)>=2) return 1; return 0; }

 /* 军职 / 文职 / 商途 / 党人，各有一套叫法 */
 function roleLine(s){
  var r=s.role||'';
  if(s.isThrone||s.isLeader) return 'top';
  if(r==='soldier'||r==='officer') return 'mil';
  if(r==='merchant') return 'biz';
  if(r==='activist') return 'pol';
  return 'civ';
 }
 var OWN={
  mil:['同棚','本哨','本标','禁军'],
  civ:['本房','本司','本衙','内阁'],
  biz:['铺子','字号','总号','本号'],
  pol:['同伙','小组','本部','本党'],
  top:['禁军','禁军','禁军','禁军']
 };
 var TIP={
  mil:['你只管得着棚里这十来个人：他们的枪、他们的饷、他们夜里睡没睡。',
       '你带一个哨，百来号人。名册认得全，饷银认得清。',
       '你统一个标，营务、军械、粮台都要过你的手。',
       '天下兵马由你调。'],
  civ:['你在一房书办里抄写，上头说什么就是什么。',
       '你管一个司的事，文书堆到房梁。',
       '你坐一衙，刑名钱谷都要听你一句。',
       '内阁的折子由你批。'],
  biz:['铺子里就你和两个伙计。',
       '字号有几处分号，账要你过目。',
       '总号的银钱进出，你一句话定。',
       '天下的买卖都看着你的牌子。'],
  pol:['同伙几个人，说的事也不大。',
       '你带一个小组，传单从你这儿发。',
       '本部的事由你定。',
       '全党听你的。'],
  top:['','','','']
 };

 /* ---- 移出/放回 DOM ---- */
 var stash={};
 function cardsByRole(){
  var out={};
  [].slice.call(document.querySelectorAll('#game .card')).forEach(function(c){
   var h=c.querySelector('h2'); if(!h) return;
   var t=h.textContent.trim(), role=null;
   if(t==='列强') role='powers';
   else if(t==='战事'||t==='战事图') role='war';
   else if(t==='国力对比') role='compare';
   else if(t==='内乱') role='rebel';
   else if(/^(兵力 \/ 粮草|同棚.*|本哨|本标|禁军|本房|本司|本衙|内阁|铺子|字号|总号|本号|同伙|小组|本部|本党)$/.test(t)) role='own';
   if(role) out[role]=c;
  });
  return out;
 }

 function apply(){
  var t=tier(), s=ST(); if(!s) return;
  var want=(t>=2);          /* 列强/战事/国力对比/内乱 只有提督以上看得到 */
  var map=cardsByRole();

  ['powers','war','compare','rebel'].forEach(function(r){
   var c=map[r];
   if(c){
    if(want){
     if(stash[r]){ /* 已挂出 */ }
    }else{
     stash[r]={node:c,next:c.nextSibling};
     c.remove();
    }
   }else if(want&&stash[r]){
    var rec=stash[r];
    var g=document.getElementById('game');
    if(g){ g.insertBefore(rec.node, rec.next&&rec.next.parentNode===g?rec.next:null); }
    delete stash[r];
   }
  });

  /* 兵马卡重命名 + 小兵只留名册 */
  var own=map.own||(stash.own&&stash.own.node);
  if(own){
   var key=roleLine(s), name=OWN[key][t], h=own.querySelector('h2');
   if(h&&h.textContent.trim()!==name) h.textContent=name;
   own.classList.toggle('low', t===0);
   var box=own.querySelector('#v42men');
   if(t===0){
    if(!box){
     box=document.createElement('div'); box.id='v42men';
     var seed=0, nm=s.name||'';
     for(var i=0;i<nm.length;i++) seed=(seed*31+nm.charCodeAt(i))%100000;
     var XING='赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨'.split(''), MING=['大柱','石头','福生','老栓','三宝','阿贵','小六','来喜','有田','春生','二狗','满仓'];
     var NOTE=['枪法还稳，就是胆小','话少，站岗能站一夜','爱赌，饷银月月光','识几个字，会写家信','家里五口人全靠他','打过两年仗，脸上有疤','饭量大，力气也大','嘴甜，会伺候人','睡得死，哨上得盯着','老实，叫他做啥就做啥'];
     var men='';
     for(var k=0;k<5;k++){
      men+='<div class="pcard" style="padding:6px 8px"><b>'+XING[(seed+k*7)%XING.length]+MING[(seed+k*13)%MING.length]+'</b> '+
       '<span class="small muted">'+(18+((seed+k*3)%14))+' 岁 · '+NOTE[(seed+k*11)%NOTE.length]+'</span></div>';
     }
     box.innerHTML='<div class="small muted" style="margin:6px 0 4px">'+TIP[key][0]+'</div>'+men;
     own.appendChild(box);
    }
   }else if(box){ box.remove(); }
  }

  /* 分页第一个词 */
  var gov=document.querySelector('#tabs button[data-tab="gov"]');
  if(gov){
   var gname=s.isThrone||s.isLeader?'朝政':((s.rank||0)>=3?'公务':'生计');
   if(gov.textContent!==gname) gov.textContent=gname;
  }
  var mil=document.querySelector('#tabs button[data-tab="mil"]');
  if(mil){
   var mname=(s.role==='soldier'||s.role==='officer'||t===3)?['身边','哨上','军务','军国'][t]:'军情';
   if(mil.textContent!==mname) mil.textContent=mname;
  }
 }

 var last=null;
 function tick(){
  var s=ST(); if(!s) return;
  var sig=[tier(), s.role, s.rank, s.isThrone?1:0, s.isLeader?1:0].join('_');
  if(sig===last){ return; }
  last=sig;
  try{ apply(); }catch(e){}
 }
 var mo=new MutationObserver(tick);
 var g=document.getElementById('game');
 if(g) mo.observe(g,{childList:true});
 setInterval(tick,1500); tick();


})(); /* V4.2.6 段落结束（V4.16.1 修正位置） */
/* ================= V4.3：可分歧的战后历史与完整性修复 ================= */
function ensureAltHistory(){
 if(!s)return;
 if(!s.natl)s.natl={稳定:62,经济:38,军事:45,财政:40,秩序:55,民心:50,国际:30,工业:15};
 if(!s.altHistory)s.altHistory={kmt:0,cpc:0,peace:0,choices:[],resolved:false,path:null};
 if(!Array.isArray(s.institutionHistory))s.institutionHistory=[];
 if(!s.constitution)s.constitution={stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty',history:[]};
 if(!Array.isArray(s.constitution.history))s.constitution.history=[];
 ['stateStructure','executive','politicalOrder'].forEach(function(k){if(!s.constitution[k])s.constitution[k]=({stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty'})[k];});
 if(!world.altPath)world.altPath=null;
 if(!world.altHistory)world.altHistory={};
 /* V4.19：1948 年之后开局（或读入未经 1948 年判定的存档），战后走向按史实落定为中共取得全国政权 */
 if(!s.altHistory.resolved&&!world.altPath&&s.year>1948){
  s.altHistory.resolved=true;s.altHistory.path='cpc_victory';s.altHistory.resolvedYear=s.year;s.altHistory.auto=1;world.altPath='cpc_victory';
 }
}
function altDelta(key,n){
 ensureAltHistory();
 s.altHistory[key]=(s.altHistory[key]||0)+n;
}
function recordAltChoice(ev,o,win){
 if(!s||!ev||!o)return;
 ensureAltHistory();
 var id=ev.id||'', t=o.t||'';
 var delta={kmt:0,cpc:0,peace:0};
 if(id==='q7'&&t==='后方动员'){delta.kmt=1;delta.peace=1;s.natl.秩序+=2;s.natl.民心+=2;}
 if(id==='wuhan'&&t==='死守外围'){delta.kmt=1;s.natl.军事+=2;}
 if(id==='918'&&t==='请缨北上'){delta.kmt=1;s.natl.军事+=1;}
 if(id==='1945'&&t==='受降接收'){delta.kmt=1;delta.peace=1;s.natl.国际+=2;s.natl.稳定+=1;}
 if(id==='civilwar46'&&t==='主张政治协商'){delta.kmt=2;delta.peace=3;s.natl.稳定+=5;s.natl.民心+=4;s.natl.军事-=2;}
 if(id==='constitution47'&&t==='推动地方自治与法治'){delta.kmt=3;delta.peace=2;s.natl.稳定+=5;s.natl.民心+=5;s.natl.国际+=2;}
 if(id==='constitution47'&&t==='参与土地与基层改革'){delta.cpc=2;s.natl.民心+=4;s.natl.秩序+=1;}
 if(id==='campaign48'&&t==='保护城市与民众'){delta.kmt=2;delta.peace=2;s.natl.民心+=4;s.natl.秩序+=3;}
 if(id==='campaign48'&&t==='全力投入前线'){if(s.faction==='cpc')delta.cpc=2;else if(s.faction==='kmt')delta.kmt=1;}
 if(id==='split'&&t==='转入地下')delta.cpc=1;
 if(id==='changzheng'&&t==='随军长征')delta.cpc=1;
 if(id==='baituan'&&t==='参加破袭')delta.cpc=1;
 if(id==='xian'&&t==='和平解决'){delta.peace=1;s.natl.稳定+=1;}
 if(win===false){delta.kmt=Math.floor(delta.kmt/2);delta.cpc=Math.floor(delta.cpc/2);delta.peace=Math.floor(delta.peace/2);}
 s.altHistory.kmt+=delta.kmt;s.altHistory.cpc+=delta.cpc;s.altHistory.peace+=delta.peace;
 if(delta.kmt||delta.cpc||delta.peace){
  s.altHistory.choices.push({year:s.year,event:id,choice:t,success:!!win,delta:delta});
  s.altHistory.choices=s.altHistory.choices.slice(-40);
 }
 ['稳定','经济','军事','财政','秩序','民心','国际','工业'].forEach(function(k){s.natl[k]=clamp(s.natl[k]);});
}
var _chooseEventV43=chooseEvent;
chooseEvent=function(ev,o){
 var old=o.run, captured=false;
 o.run=function(state,win){var out=old(state,win);recordAltChoice(ev,o,win);captured=true;return out;};
 try{_chooseEventV43(ev,o);}finally{o.run=old;}
 if(!captured)recordAltChoice(ev,o,true);
};

/* 领袖可通过制度改革、反腐、土地与军事政策改变战后政治条件。 */
POLICIES.push(
 {k:'constitution',t:'推行宪政与地方自治',d:'建立可问责的行政体系，扩大地方议会与司法独立。稳定、民心和国际评价提高。',eff:function(){s.natl.稳定+=8;s.natl.民心+=7;s.natl.国际+=5;s.natl.财政-=3;altDelta('kmt',3);altDelta('peace',2);log('【国策】你推动宪政与地方自治，政府开始接受制度约束，地方精英与社会团体获得参与空间。');}},
 {k:'anticorruption',t:'整肃贪腐与财政纪律',d:'清查军政采购、稳定币制、公开财政。财政与民心提高。',eff:function(){s.natl.财政+=8;s.natl.民心+=6;s.natl.稳定+=4;s.natl.军事-=1;altDelta('kmt',2);log('【国策】你整顿财政与军政采购，短期触动既得利益，长期有助于恢复政府信用。');}},
 {k:'landreform',t:'渐进土地改革',d:'以补偿、减租和土地登记缓和农村矛盾。民心提高，财政承压。',eff:function(){s.natl.民心+=9;s.natl.秩序+=3;s.natl.财政-=4;altDelta('kmt',2);altDelta('peace',1);log('【国策】你以补偿和渐进方式推进土地改革，试图在不摧毁生产秩序的前提下回应农民诉求。');}},
 {k:'negotiation',t:'推动停战与联合谈判',d:'以政治协商降低内战烈度。稳定与民心提高，军事优势暂时下降。',eff:function(){s.natl.稳定+=7;s.natl.民心+=5;s.natl.军事-=5;altDelta('kmt',2);altDelta('peace',4);log('【国策】你授权代表推动停战谈判，战线暂时降温，政治妥协成为可能。');}}
);
var _openPolicyV43=openPolicy;
openPolicy=function(){
 ensureAltHistory();
 _openPolicyV43();
};

function resolvePostwarPath(){
 ensureAltHistory();
 if(s.altHistory.resolved)return world.altPath;
 var N=s.natl,H=s.altHistory;
 var reform=N.稳定>=48&&N.民心>=52&&N.财政>=34&&N.秩序>=45;
 var kmtScore=H.kmt+(reform?2:0);
 var cpcScore=H.cpc+(N.民心<42?2:0);
 var peaceScore=H.peace+(N.稳定>=55?2:0);
 var path;
 if(kmtScore>=6&&reform)path='kmt_constitutional';
 else if(peaceScore>=5&&kmtScore>=3)path='coalition';
 else if(cpcScore>=kmtScore)path='cpc_victory';
 else path='fragmented';
 H.resolved=true;H.path=path;H.resolvedYear=s.year;world.altPath=path;
 world.altHistory={kmt:kmtScore,cpc:cpcScore,peace:peaceScore,metrics:Object.assign({},N)};
 var desc={
  kmt_constitutional:'国民政府在战后完成关键改革：整肃财政、推进土地与宪政改革，国共全面内战未演变为全国性政权更替。1949年将进入宪政转型路线。',
  coalition:'停战派与地方力量取得空间，双方接受联合谈判。中国没有在1949年立即完成统一，进入联合政府与地方整合阶段。',
  cpc_victory:'战后政治与军事条件有利于中共取得全国性胜利，1949年中华人民共和国成立。',
  fragmented:'双方都未能建立稳定优势，地方实力派与区域政府继续存在，中国进入长期分治与重组阶段。'
 };
 log('【战后路线判定】'+desc[path]);
 return path;
}
var _advanceWorldV43=advanceWorld;
advanceWorld=function(year){
 var out=_advanceWorldV43(year);
 if(year===1948)resolvePostwarPath();
 if(year===1949){
  ensureAltHistory();
  var path=world.altPath||resolvePostwarPath();
  if(path==='kmt_constitutional'){
   world.powers.kmt.v=82;world.powers.cpc.v=12;world.powers.local.v=22;
   PROVINCES.forEach(function(p){if(world.regions[p]&&world.regions[p].ctrl!=='japan')world.regions[p].ctrl='kmt';});
   out.push('宪政转型路线形成：国民政府通过改革保住全国执政地位，未发生中华人民共和国成立这一历史结果。');
  }else if(path==='coalition'){
   world.powers.kmt.v=52;world.powers.cpc.v=38;world.powers.local.v=48;
   out.push('联合政府路线形成：南北双方停战谈判，多个区域保留自治安排。');
  }else if(path==='fragmented'){
   world.powers.kmt.v=42;world.powers.cpc.v=40;world.powers.local.v=65;
   out.push('长期分治路线形成：中央权威不足，地方政权继续存在。');
  }else{
   world.powers.cpc.v=82;world.powers.kmt.v=18;
   PROVINCES.forEach(function(p){if(world.regions[p]&&world.regions[p].ctrl!=='japan')world.regions[p].ctrl='cpc';});
   out.push('中共取得全国性胜利，中华人民共和国成立。');
  }
 }
 if(year>=1950&&world.altPath==='kmt_constitutional'){
  world.powers.kmt.v=Math.min(95,world.powers.kmt.v+1);
  world.powers.cpc.v=Math.max(5,world.powers.cpc.v-1);
 }
 return out;
};

var _maybeEventV43=maybeEvent;
maybeEvent=function(){
 if(!s)return;
 ensureAltHistory();
 var path=world.altPath||s.altHistory.path;
 if(s.year===1949&&path&&path!=='cpc_victory'){
  if(!calDue(1949,ALT_EVENT_DATES[1949][0],ALT_EVENT_DATES[1949][1]))return; /* V4.17：按日期触发 */
  var id='alt1949_'+path;if(s.evDone[id])return;
  s.evDone[id]=true;
  var ev;
  if(path==='kmt_constitutional')ev={id:id,y:1949,t:'宪政转型与和平统一',d:'此前的改革改变了政治走向：政府保住执政地位，开始兑现宪政承诺；反对派、地方力量与社会团体将决定改革能否持续。',opts:[
   {t:'召开跨党派制宪会议',d:'以选举、议会和司法制度巩固改革。',fac:['kmt','civil','local'],run:function(x){x.natl.稳定+=5;x.natl.国际+=4;x.fame+=5;x.power+=5;return '制宪会议召开，政治竞争逐步转入制度框架。';}},
   {t:'优先整合地方与军队',d:'先确保中央命令能够落实。',fac:['kmt','local'],run:function(x){x.natl.军事+=4;x.natl.秩序+=3;x.trust+=4;return '地方军政力量接受整编，但制度改革的速度有所放缓。';}}
  ]};
  else if(path==='coalition')ev={id:id,y:1949,t:'南北和谈与联合政府',d:'停战谈判进入关键阶段。联合政府、区域自治与军队整编成为议题。',opts:[
   {t:'支持联合政府',d:'通过政治协商避免全国性决战。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.稳定+=5;x.natl.民心+=4;x.power+=5;return '联合政府框架初步形成，但各方仍需就军队与财政达成协议。';}},
   {t:'推动地方自治协议',d:'先解决各省权力与财政分配。',fac:['local','civil','kmt'],run:function(x){x.natl.秩序+=5;x.natl.稳定+=3;x.fame+=4;return '地方自治协议签署，中央与地方进入长期磨合。';}}
  ]};
  else ev={id:id,y:1949,t:'区域分治与长期重组',d:'中央力量不足以统一全国，各地进入新的政治协商与区域竞争。',opts:[
   {t:'推动区域停火',d:'先保护城市与民众。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.秩序+=4;x.natl.民心+=3;x.fame+=3;return '区域停火协议减少了部分冲突，但统一仍遥遥无期。';}},
   {t:'巩固本地行政',d:'优先维持辖区治理。',fac:['kmt','cpc','local'],run:function(x){x.natl.稳定+=3;x.natl.财政+=2;x.power+=3;return '本地行政暂时稳定，跨区域协商仍未取得突破。';}}
  ]};
  $('curEvent').textContent=ev.t+'：'+ev.d;showEvent(ev);return;
 }
 if(path&&path!=='cpc_victory'){
  var altEvents={
   1950:{t:path==='kmt_constitutional'?'土地改革与战后重建':'停战监督与战后重建',d:'战后社会重建进入关键阶段，土地、财政、军队整编与民生恢复仍待解决。',opts:[
    {t:'优先恢复民生与生产',d:'把财政资源投向粮食、交通和公共卫生。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.民心+=5;x.natl.经济+=4;x.fame+=3;return '民生与生产逐渐恢复，社会信心有所回升。';}},
    {t:'优先整编军队',d:'降低军阀化风险，建立统一指挥。',fac:['kmt','cpc','local'],run:function(x){x.natl.军事+=4;x.natl.稳定+=2;x.trust+=3;return '军队整编取得进展，但财政压力依然存在。';}}
   ]},
   1953:{t:'国家建设计划',d:'政府推动交通、教育、工业与农业基础建设。',opts:[
    {t:'投资工业与交通',d:'提高长期生产能力。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.工业+=6;x.natl.经济+=5;x.natl.财政-=2;x.skill+=4;return '铁路、港口和工厂项目陆续开工。';}},
    {t:'优先发展教育与公共卫生',d:'提升人力资本与社会稳定。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.民心+=5;x.natl.秩序+=3;x.skill+=5;return '学校与公共卫生网络逐步扩展。';}}
   ]},
   1956:{t:'宪政巩固与社会改革',d:'制度运行进入检验期，改革需要在效率、自由与社会公平之间取得平衡。',opts:[
    {t:'强化议会监督',d:'约束行政权力。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.稳定+=5;x.natl.国际+=3;x.power+=4;return '议会监督逐渐制度化，政府决策更加透明。';}},
    {t:'扩大基层公共服务',d:'改善城乡教育、医疗和基础设施。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.民心+=5;x.natl.秩序+=2;x.fame+=4;return '公共服务覆盖面扩大，地方治理获得更多支持。';}}
   ]},
   1966:{t:'教育、科研与产业升级',d:'国家面临现代化转型，教育科研体系成为长期竞争力的关键。',opts:[
    {t:'保护学术与教育自主',d:'保障学校、研究机构持续运作。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.工业+=4;x.natl.国际+=4;x.skill+=6;return '教育科研保持连续发展，技术人才逐渐成长。';}},
    {t:'集中资源发展重工业',d:'以国家项目带动工业体系。',fac:['kmt','cpc','local'],run:function(x){x.natl.工业+=7;x.natl.财政-=4;x.natl.经济+=2;return '重工业项目扩张，但资源配置压力上升。';}}
   ]},
   1971:{t:'国际地位与外交布局',d:'国际格局变化，为中国参与国际组织与区域外交提供新机会。',opts:[
    {t:'积极争取国际承认与合作',d:'扩大贸易、外交和科技交流。',fac:['kmt','cpc','civil'],run:function(x){x.natl.国际+=7;x.natl.经济+=3;x.power+=3;return '国际合作网络扩大，对外贸易与交流取得进展。';}},
    {t:'优先巩固区域安全',d:'把资源投入边境与周边外交。',fac:['kmt','cpc','local'],run:function(x){x.natl.稳定+=3;x.natl.军事+=2;x.trust+=3;return '周边安全局势趋稳，但外交拓展相对谨慎。';}}
   ]}
  };
  var a=altEvents[s.year];
  if(a&&ALT_EVENT_DATES[s.year]&&!calDue(s.year,ALT_EVENT_DATES[s.year][0],ALT_EVENT_DATES[s.year][1]))return; /* V4.17：未到日期 */
  if(a){var key='alt_event_'+s.year;if(s.evDone[key])return;s.evDone[key]=true;var ev2={id:key,y:s.year,t:a.t,d:a.d,who:['kmt','cpc','civil','local'],opts:a.opts};$('curEvent').textContent=ev2.t+'：'+ev2.d;showEvent(ev2);return;}
 }
 _maybeEventV43();
};

/* 战后路线显示在结局与年报中；1945年不再提前写入终局。 */
var _verdictV43=verdict;
verdict=function(){
 ensureAltHistory();
 var path=world.altPath||s.altHistory.path;
 if(path==='kmt_constitutional')return {t:'结局 · 宪政改革路线',d:'你参与推动的改革改变了战后走向。国民政府保住执政地位，中华人民共和国未在1949年成立；此后国家能否走向稳定民主，仍取决于制度能否持续兑现。'};
 if(path==='coalition')return {t:'结局 · 联合政府路线',d:'国共双方通过谈判避免立即决出胜负，中国进入联合政府与区域自治并存的阶段。'};
 if(path==='fragmented')return {t:'结局 · 长期分治路线',d:'中央权威不足，各区域势力继续竞争，中国进入长期分治与重组。'};
 if(path==='cpc_victory')return {t:'结局 · 中共取得全国政权',d:'战后政治与军事条件推动中共取得全国性胜利，中华人民共和国成立。'};
 return _verdictV43();
};
checkEnding=function(){
 if(!s||s.ending)return;
 var end=null;
 if(s.dead)end={t:'身故',d:'你死在'+(s.deadYear||s.year)+'年，'+(s.deathCause||'世事无常')+'。'};
 else if(s.year>1972)end=verdict();
 if(end){
  end.sum=['能力 '+s.skill+'、声望 '+s.fame+'、政治 '+s.power+'、上级信任 '+s.trust,'职位：'+(window.rankTitleOf?window.rankTitleOf():FAC[s.faction].ladder[s.rank])+(s.clique?'（'+s.clique+'）':''),'现银 '+M(s.cash)+'，影响 '+s.alt];
  s.ending=end;log('【结局】'+end.t+'——'+end.d);
 }
};

/* 存档兼容：新字段可在旧档中安全补齐；自动存档与手动槽同步。 */
var _applySaveV43=applySave;
applySave=function(d){
 _applySaveV43(d);
 if(s){ensureAltHistory();if(s.year<=1972)s.ending=null;}
};
var _persistV43=persist;
persist=function(){
 _persistV43();
 if(!s)return;
 try{localStorage.setItem(slotKey('auto'),JSON.stringify(packSave()));}catch(e){}
};
$('btnSave').onclick=function(){
 if(!s)return;
 var k=$('slotSel')?$('slotSel').value:'auto';
 try{localStorage.setItem(slotKey(k),JSON.stringify(packSave()));refreshSlots();flash('已保存到'+(k==='auto'?'自动存档':'槽 '+k));}
 catch(e){flash('保存失败：浏览器存储空间不足或权限受限');}
};
$('btnLoad').onclick=function(){
 var k=$('slotSel')?$('slotSel').value:'auto';
 try{
  var raw=localStorage.getItem(slotKey(k));
  if(!raw&&k==='auto')raw=localStorage.getItem(SAVE_KEY);
  if(!raw){flash('这个槽是空的');return;}
  var d=JSON.parse(raw);if(!d||!d.s||!FAC[d.s.faction]||!Number.isFinite(+d.s.year))throw new Error('存档结构无效');
  applySave(d);refreshSlots();flash('已读取 '+(k==='auto'?'自动存档':'槽 '+k));
 }catch(e){flash('读取失败：存档损坏或版本不兼容');}
};

/* 移动端/桌面端均阻止意外横向溢出；触控按钮保证足够点击面积。 */
(function(){
 var css='html,body{max-width:100%;overflow-x:hidden}button,.btn,.act,.choice{touch-action:manipulation}button:focus-visible,.btn:focus-visible,.choice:focus-visible{outline:2px solid #a23a2c;outline-offset:2px}@media(max-width:760px){.grid2{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.card,.main,.wide{min-width:0}.powers{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}.person,.evt,.resultbox{overflow-wrap:anywhere}#hud .hud-m{min-width:0}.mapwrap{max-width:100%;overflow:hidden}.dialog{width:min(100%,640px);margin:auto}.choice{min-height:48px}}@media(max-width:360px){.grid2{grid-template-columns:1fr}.powers{grid-template-columns:1fr}.brand h1{font-size:23px}.stamp{font-size:9px}}';
 var st=document.createElement('style');st.id='v43ResponsiveFix';st.textContent=css;document.head.appendChild(st);
})();


/* ================= V4.4：1949年前的制度道路与宪制实验 =================
 * 以制度组合而非“国名换皮”模拟国家结构；制度选择改变治理指标与政治联盟，
 * 不直接保证胜利。所有选择均写入角色存档，旧存档自动兼容。
 */
var INSTITUTION_MODELS={
 us_federal:{name:'美国式总统制联邦共和国',short:'总统制联邦',desc:'总统与国会分别产生，行政、立法、司法分权制衡；省（邦）保留宪法列举之外的自治权限。',pros:'权力制衡、地方参与、政策连续性较强。',risks:'行政与议会可能僵局；联邦与地方权限冲突；政党极化会拖慢决策。',effects:{稳定:2,财政:1,民心:2,国际:2},scores:{kmt:2,peace:1}},
 westminster:{name:'英国式议会内阁制',short:'议会内阁制',desc:'议会多数党组成内阁，首相对议会负责；国家元首主要承担礼仪与宪制职能。可设计为君主立宪或议会共和。',pros:'行政与议会多数协调时效率高；政府可通过议会问责更替。',risks:'多数党过强可能压缩监督；碎片化议会可能频繁倒阁。',effects:{稳定:1,民心:2,国际:1},scores:{kmt:1,peace:2}},
 swiss_council:{name:'瑞士式联邦委员会制',short:'联邦委员会制',desc:'由议会选出合议制联邦委员会，重要政党与地区共同参与；公民可通过公投和倡议影响政策。',pros:'包容多元地区、协商政治、政策连续性较好。',risks:'决策速度较慢；需要成熟地方自治、政党妥协和公民组织。',effects:{稳定:3,民心:2,秩序:2},scores:{peace:3}},
 french_parliament:{name:'法国第三共和国式议会共和制',short:'议会共和制',desc:'总统为国家元首，内阁依赖议会信任；议会是政治中心，采用共和制而非世袭君主。',pros:'共和合法性、议会监督、政府可和平更替。',risks:'党派林立时内阁不稳；军队与行政系统可能成为政治仲裁者。',effects:{民心:2,国际:1,稳定:1},scores:{peace:2,kmt:1}},
 weimar_dual:{name:'魏玛式双首长半总统制',short:'半总统制',desc:'民选总统与对议会负责的总理并存，兼顾直接民意与议会责任；紧急权力必须设严格期限与司法、议会复核。',pros:'双重民主授权，可在危机中维持国家连续性。',risks:'总统与议会可能争夺合法性；紧急权力若缺少约束会侵蚀宪政。',effects:{稳定:1,军事:1,国际:1},scores:{kmt:1,peace:1}},
 constitutional_monarchy:{name:'英国／日本式君主立宪制',short:'君主立宪',desc:'保留君主作为国家象征，政府由议会多数或责任内阁产生；君主不得自行掌握日常行政与军令。',pros:'可为旧王朝转型提供连续性与象征妥协。',risks:'皇室、军部和内阁权限边界若不清晰，可能出现双重权力中心。',effects:{稳定:2,秩序:1,国际:1},scores:{kmt:1,peace:1}},
 soviet_party:{name:'苏维埃式一党领导体制',short:'苏维埃一党体制',desc:'以党组织和苏维埃代表机关构成政治体系，强调集中动员、计划经济与组织领导。',pros:'集中资源、快速动员、统一政策执行。',risks:'权力监督不足、政策纠错困难、地方与社会反馈渠道受限。',effects:{军事:3,工业:2,秩序:1},scores:{cpc:3}},
 federal_union:{name:'地方自治联邦／邦联路线',short:'自治联邦',desc:'中央只掌外交、国防、关税等共同事务，省区拥有广泛自治；可逐步从邦联过渡到联邦。',pros:'适合地区差异大、地方实力强的国家，以协商换取统一。',risks:'中央财政与军令薄弱；地方可能拒绝共同政策，甚至走向分裂。',effects:{稳定:1,民心:2,秩序:2},scores:{peace:2}}
};
function chooseInstitution(key,year){
 ensureAltHistory();var m=INSTITUTION_MODELS[key];if(!m)return;
 s.institution=key;s.institutionYear=year||s.year;
 s.institutionHistory.push({year:s.year,key:key,name:m.name});
 s.institutionHistory=s.institutionHistory.slice(-12);
 Object.keys(m.effects).forEach(function(k){s.natl[k]=clamp((s.natl[k]||0)+m.effects[k]);});
 Object.keys(m.scores).forEach(function(k){s.altHistory[k]=(s.altHistory[k]||0)+m.scores[k];});
 log('【制度选择】你确立「'+m.name+'」方向。制度本身不会自动带来成功，后续仍取决于法治、财政、军队国家化、选举可信度与政治妥协。');
}
function institutionOption(key){var m=INSTITUTION_MODELS[key];return {t:'选择'+m.name,d:m.desc+' 优点：'+m.pros+' 风险：'+m.risks,fac:['beiyang','kmt','civil','local','qing'],run:function(x){chooseInstitution(key,x.year);return '你提出以「'+m.name+'」作为国家制度蓝本，并开始争取各方支持。';}};}
/* 1912年共和建国节点允许玩家选择制度蓝图；并非每种制度都必然成功。 */
var _wuxuEvent=EVENTS.find(function(e){return e.id==='wuxu';});
if(_wuxuEvent){_wuxuEvent.opts.push({t:'推动君主立宪与责任内阁',d:'保留君主作为国家象征，设立民选议会、责任内阁、独立法院与地方自治，限制皇权和军权。',fac:['qing','civil'],risk:1,run:function(x,win){if(win){chooseInstitution('constitutional_monarchy',x.year);x.power+=5;x.fame+=4;x.alt+=2;return '新政派提出以宪法限制皇权、由内阁向议会负责。改革获得部分支持，但保守势力与军权问题仍未解决。';}x.trust-=5;return '改革遭到强烈阻力，支持者被迫转入地下。';}});}
var _minguoEvent=EVENTS.find(function(e){return e.id==='minguo';});
if(_minguoEvent){
 _minguoEvent.d+=' 新共和国必须回答一个问题：权力如何产生、如何受约束、中央与省份如何分权？';
 ['us_federal','westminster','swiss_council','french_parliament','weimar_dual','constitutional_monarchy','soviet_party','federal_union'].forEach(function(k){_minguoEvent.opts.push(institutionOption(k));});
}
/* 领袖也可在之后通过国策转向；不要求玩家恰好参与1912年事件。 */
Object.keys(INSTITUTION_MODELS).forEach(function(key){
 var m=INSTITUTION_MODELS[key];
 POLICIES.push({k:'institution_'+key,t:'制度蓝图：'+m.short,d:m.desc,eff:function(){chooseInstitution(key,s.year);}});
});
/* 五项历史沙盘能力：战局改写、制度变更、事件分歧、政体组合、跨年蝴蝶效应。 */
function applyCounterfactualChoice(ev,o,win){
 if(!s||!world||!ev||!o)return;
 if(!s.altHistory.flags)s.altHistory.flags={};
 var f=s.altHistory.flags, t=o.t||'';
 if(ev.id==='jiawu'&&t==='出海决战'&&win){f.sinoJapaneseWarReversal=true;world.powers.qing.v=Math.min(95,world.powers.qing.v+8);world.powers.japan.v=Math.max(5,world.powers.japan.v-8);}
 if(ev.id==='xinhai'&&win&&(t==='举义响应'||t==='支持南北议和')){f.republicSettlement=true;world.powers.qing.v=Math.max(0,world.powers.qing.v-15);world.powers.beiyang.v=Math.min(95,world.powers.beiyang.v+5);}
 if(ev.id==='beifa'&&t==='支持“先打吴佩孚”'&&win){f.northernExpeditionSuccess=true;world.powers.kmt.v=Math.min(95,world.powers.kmt.v+7);world.powers.beiyang.v=Math.max(5,world.powers.beiyang.v-8);}
 if(ev.id==='xian'&&t==='和平解决'&&win){f.crossPartyTruce=true;s.natl.稳定=clamp(s.natl.稳定+3);s.natl.秩序=clamp(s.natl.秩序+2);}
 if(ev.id==='q7'&&t==='后方动员'){f.wartimeCivilMobilization=true;world.powers.japan.v=Math.max(5,world.powers.japan.v-2);}
 if(ev.id==='1945'&&t==='安抚地方'){f.postwarReconstructionEarly=true;s.natl.民心=clamp(s.natl.民心+2);}
}
var _chooseEventV44=chooseEvent;
chooseEvent=function(ev,o){
 var old=o.run;
 o.run=function(state,win){var result=old(state,win);applyCounterfactualChoice(ev,o,win);return result;};
 try{return _chooseEventV44(ev,o);}finally{o.run=old;}
};
/* 如果早期已建立可信的议会制度并维持社会稳定，1927年可能出现政治妥协而非必然分裂。 */
var _maybeEventV44=maybeEvent;
maybeEvent=function(){
 if(s&&s.year===1927&&s.institution&&['us_federal','westminster','swiss_council','french_parliament','weimar_dual'].indexOf(s.institution)>=0&&s.natl&&s.natl.稳定>=58&&s.natl.民心>=52){
  var splitEvent=EVENTS.find(function(e){return e.id==='split';});
  if(splitEvent&&!s.evDone.split){
   splitEvent.t='政治协商与制度竞争';
   splitEvent.d='共和制度与地方议会为政治妥协提供了空间。各派仍有重大分歧，但是否走向全面决裂不再是唯一可能。';
   splitEvent.opts=[
    {t:'签署跨党派政治协定',d:'承认合法反对派、明确军队国家化与选举规则。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.稳定=clamp(x.natl.稳定+5);x.natl.民心=clamp(x.natl.民心+5);x.alt+=3;x.altHistory.peace+=3;x.altHistory.kmt+=1;return '各方签署政治协定，冲突风险下降，但地方实力与意识形态分歧仍需长期处理。';}},
    {t:'允许地方试点自治与联合执政',d:'先在部分省份建立跨党派地方政府。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.秩序=clamp(x.natl.秩序+4);x.natl.稳定=clamp(x.natl.稳定+3);x.altHistory.peace+=2;return '地方联合治理试点启动，中央与地方开始以制度协商取代部分武装竞争。';}},
    {t:'拒绝妥协，维持党派对抗',d:'坚持以政治力量解决权力归属。',fac:['kmt','cpc'],run:function(x){x.natl.稳定=clamp(x.natl.稳定-5);x.natl.秩序=clamp(x.natl.秩序-3);return '谈判破裂，制度框架未能约束各方。';}}
   ];
  }
 }
 return _maybeEventV44();
};
/* 在1948路线判定前保留制度选择的历史记录；制度只改变条件，不锁死结果。 */
var _resolvePathV44=resolvePostwarPath;
resolvePostwarPath=function(){
 ensureAltHistory();
 if(!s.altHistory.resolved&&s.institution){
  var m=INSTITUTION_MODELS[s.institution];
  if(m){
   /* 制度运行质量由国势决定：制度纸面设计不能替代财政、民心与行政能力。 */
   var capacity=((s.natl.稳定||0)+(s.natl.财政||0)+(s.natl.秩序||0))/3;
   if(capacity>=58){s.altHistory.peace+=1;if(s.institution!=='soviet_party')s.altHistory.kmt+=1;}
   if(capacity<38){s.altHistory.peace=Math.max(0,s.altHistory.peace-1);}
  }
 }
 return _resolvePathV44();
};


/* ================= V4.5：三维宪制组合（1949年前） =================
 * 国家结构、行政—立法关系、政治组织方式分开选择；三者组合形成制度。
 * 参考比较宪制研究：总统/议会/半总统制按行政机关对议会的责任关系区分；
 * 单一/联邦按地方权力是否受宪法保障区分。游戏效果为抽象模拟，不是现实优劣定论。
 */
var CONSTITUTION_AXES={
 stateStructure:{title:'国家结构',items:{
  unitary:{name:'单一制国家',desc:'中央拥有最终宪制权力，可下放地方自治。',pros:'统一财政、军令与全国政策协调较容易。',risk:'过度集权会压缩地方参与并加剧中央—地方矛盾。',effects:{稳定:2,财政:2,秩序:1},score:{kmt:1}},
  federal:{name:'联邦制国家',desc:'中央与省/邦权力由宪法划分，地方自治不能被中央单方面撤销。',pros:'适应地区差异、保护地方参与。',risk:'中央与地方可能争夺税权、军权和政策权限。',effects:{民心:2,稳定:1,财政:-1},score:{peace:2}},
  confederal:{name:'邦联制国家',desc:'各省/成员邦保留主权性权力，中央主要负责共同外交、防务与关税。',pros:'较容易吸纳地方实力派加入共同框架。',risk:'共同政府执行力弱，可能出现拒绝履约或分离。',effects:{民心:1,秩序:-1,军事:-2},score:{peace:2}}
 }},
 executive:{title:'政府组织',items:{
  presidential:{name:'总统制',desc:'总统兼任国家元首与政府首脑，行政和立法分别取得授权，任期相对固定。',pros:'行政首长责任清晰、权力分立。',risk:'总统与议会多数不同阵营时可能陷入僵局。',effects:{稳定:1,军事:1,国际:1},score:{kmt:1}},
  parliamentary:{name:'议会内阁制',desc:'内阁由议会多数产生并对议会负责，可因不信任案更替。',pros:'行政立法协调，政府可被议会问责。',risk:'议会碎片化可能导致联合政府脆弱或频繁倒阁。',effects:{民心:2,稳定:1},score:{peace:2}},
  semi_presidential:{name:'半总统制',desc:'民选总统与对议会负责的总理并存，权限由宪法明确划分。',pros:'兼顾总统授权与议会责任。',risk:'双重合法性可能造成总统、总理与议会冲突。',effects:{稳定:1,国际:1},score:{peace:1,kmt:1}},
  council:{name:'合议委员会制',desc:'由议会选出多人组成集体行政委员会，按协商或轮值方式领导政府。',pros:'避免权力过度集中，利于多党和地区协商。',risk:'决策较慢，危机时责任归属不够清晰。',effects:{稳定:2,民心:1,秩序:1},score:{peace:3}},
  monarchy:{name:'君主立宪责任内阁制',desc:'君主作为国家象征，政府由议会多数或责任内阁产生，君主不直接掌握日常行政。',pros:'为旧王朝和平转型提供制度连续性。',risk:'皇室、军部与内阁权限不清会形成双重权力中心。',effects:{稳定:1,秩序:1,国际:1},score:{kmt:1,peace:1}}
 }},
 politicalOrder:{title:'政治组织方式',items:{
  multiparty:{name:'多党竞争',desc:'允许多个政党合法组织、竞选并轮替执政。',pros:'扩大代表性与政策纠错渠道。',risk:'政党极化、金钱政治和碎片化可能降低治理效率。',effects:{民心:2,国际:2},score:{peace:2}},
  coalition:{name:'多党联合／协商政治',desc:'通过比例代表、联合内阁或常设协商机制组织执政。',pros:'有利于吸纳不同地区和政治力量。',risk:'谈判成本高，联合政府可能因分歧而失灵。',effects:{稳定:2,民心:1},score:{peace:3}},
  one_party:{name:'一党领导体制',desc:'一个执政党居于政治领导地位，国家机关与党组织形成制度化关系。',pros:'组织动员与政策贯彻能力较强。',risk:'反对意见和独立监督不足时，纠错成本上升。',effects:{军事:2,工业:1,秩序:1},score:{cpc:2}},
  consultative:{name:'跨党派协商／有限竞争',desc:'保留不同政治团体参与和协商机制，但执政权竞争受到制度约束。',pros:'在政治转型期可降低冲突、形成妥协。',risk:'若缺少真实问责，协商可能流于形式。',effects:{稳定:2,秩序:1},score:{peace:2,kmt:1}}
 }}
};
function ensureConstitution(){
 ensureAltHistory();
 if(!s.constitution)s.constitution={stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty',history:[]};
 if(!Array.isArray(s.constitution.history))s.constitution.history=[];
}
function constitutionSummary(){
 ensureConstitution();var c=s.constitution;
 return [CONSTITUTION_AXES.stateStructure.items[c.stateStructure].name,CONSTITUTION_AXES.executive.items[c.executive].name,CONSTITUTION_AXES.politicalOrder.items[c.politicalOrder].name].join(' + ');
}
function setConstitutionAxis(axis,key){
 ensureConstitution();var group=CONSTITUTION_AXES[axis],item=group&&group.items[key];if(!item)return false;
 var old=s.constitution[axis];if(old===key)return true;
 s.constitution[axis]=key;
 s.constitution.history.push({year:s.year,axis:axis,key:key,from:old});s.constitution.history=s.constitution.history.slice(-30);
 Object.keys(item.effects).forEach(function(k){s.natl[k]=clamp((s.natl[k]||0)+item.effects[k]);});
 Object.keys(item.score).forEach(function(k){s.altHistory[k]=(s.altHistory[k]||0)+item.score[k];});
 if(axis==='stateStructure'&&key==='federal')s.altHistory.peace+=1;
 if(axis==='politicalOrder'&&key==='multiparty')s.altHistory.peace+=1;
 log('【宪制调整】'+group.title+'改为「'+item.name+'」。'+item.desc);
 return true;
}
function openConstitutionPanel(){
 if(!s||s.dead)return;ensureConstitution();
 $('dlgTag').textContent='国家制度设计 · '+s.year+'年';
 $('dlgTitle').textContent='设计属于你的国家';
 $('dlgDesc').textContent='三个维度可以独立组合。制度蓝图不会自动保证成功，执行能力、军队国家化、财政、法治与政治妥协同样重要。';
 var body=$('dlgBody');body.innerHTML='';
 Object.keys(CONSTITUTION_AXES).forEach(function(axis){
  var g=CONSTITUTION_AXES[axis],wrap=document.createElement('section');wrap.className='constitution-group';
  var h=document.createElement('h3');h.textContent=g.title;wrap.appendChild(h);
  Object.keys(g.items).forEach(function(key){
   var it=g.items[key],b=document.createElement('button');b.className='choice constitution-choice';
   b.innerHTML='<b>'+it.name+(s.constitution[axis]===key?'（当前）':'')+'</b><div class="sub">'+it.desc+'</div><div class="sub">优势：'+it.pros+' 风险：'+it.risk+'</div>';
   b.onclick=function(){setConstitutionAxis(axis,key);openConstitutionPanel();render();persist();};wrap.appendChild(b);
  });body.appendChild(wrap);
 });
 var foot=document.createElement('p');foot.className='small muted';foot.textContent='当前制度组合：'+constitutionSummary();body.appendChild(foot);
 var close=document.createElement('button');close.className='btn';close.textContent='完成';close.onclick=function(){$('mask').classList.add('hidden');};body.appendChild(close);
 $('mask').classList.remove('hidden');
}
function installConstitutionEntry(){
 if(document.getElementById('btnConstitution'))return;
 var b=document.createElement('button');b.id='btnConstitution';b.className='btn';b.textContent='制度设计';
 b.style.cssText='position:fixed;right:12px;bottom:16px;z-index:45;box-shadow:0 3px 14px #0002';
 b.onclick=openConstitutionPanel;document.body.appendChild(b);
}
/* 旧版八种蓝图兼容映射为三维组合；后续玩家仍可分别调整任一维度。 */
var _chooseInstitutionV45=chooseInstitution;
chooseInstitution=function(key,year){
 _chooseInstitutionV45(key,year);ensureConstitution();
 var map={
  us_federal:{stateStructure:'federal',executive:'presidential',politicalOrder:'multiparty'},
  westminster:{stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty'},
  swiss_council:{stateStructure:'federal',executive:'council',politicalOrder:'coalition'},
  french_parliament:{stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty'},
  weimar_dual:{stateStructure:'unitary',executive:'semi_presidential',politicalOrder:'multiparty'},
  constitutional_monarchy:{stateStructure:'unitary',executive:'monarchy',politicalOrder:'multiparty'},
  soviet_party:{stateStructure:'unitary',executive:'council',politicalOrder:'one_party'},
  federal_union:{stateStructure:'confederal',executive:'council',politicalOrder:'coalition'}
 };
 var preset=map[key];if(preset){Object.keys(preset).forEach(function(axis){if(s.constitution[axis]!==preset[axis])setConstitutionAxis(axis,preset[axis]);});}
};
/* 1949年前关键分歧：宪制组合影响政治协商、中央整合和战后路线，不锁定单一结局。 */
var _maybeEventV45=maybeEvent;
maybeEvent=function(){
 if(s&&s.year===1927&&s.constitution){
  var c=s.constitution,plural=c.politicalOrder==='multiparty'||c.politicalOrder==='coalition'||c.politicalOrder==='consultative';
  var federal=c.stateStructure==='federal'||c.stateStructure==='confederal';
  if(plural&&federal&&s.natl.稳定>=48&&s.natl.民心>=45){
   var e=EVENTS.find(function(x){return x.id==='split';});
   if(e&&!s.evDone.split){e.t='联邦协商与政治整合';e.d='各省自治与多党协商制度为政治妥协提供了框架，但军队、税权和意识形态冲突仍可能使协定破裂。';
    e.opts=[
     {t:'召开全国制宪与省区协商会议',d:'以宪法划分中央与省区权限，并制定军队国家化时间表。',fac:['kmt','cpc','civil','local'],run:function(x){x.natl.稳定=clamp(x.natl.稳定+5);x.natl.民心=clamp(x.natl.民心+4);x.altHistory.peace+=4;x.altHistory.flags.federalConvention=true;return '制宪会议通过临时权限清单，地方自治与中央统一进入谈判阶段。';}},
     {t:'先行建立联合内阁',d:'让主要党派进入中央政府，军政改革分阶段推进。',fac:['kmt','cpc','civil'],run:function(x){x.natl.稳定=clamp(x.natl.稳定+4);x.natl.财政=clamp(x.natl.财政-2);x.altHistory.peace+=4;x.altHistory.flags.coalitionCabinet=true;return '联合内阁成立，但各党对军队和财政的控制权仍有分歧。';}},
     {t:'中央强行收回地方权限',d:'以统一军令和财政为先，暂缓联邦协商。',fac:['kmt','beiyang'],run:function(x){x.natl.秩序=clamp(x.natl.秩序+2);x.natl.稳定=clamp(x.natl.稳定-5);x.altHistory.kmt+=2;return '中央加强控制，短期执行力提高，但地方反弹风险增加。';}}
    ];
   }
  }
 }
 return _maybeEventV45();
};
var _resolvePathV45=resolvePostwarPath;
resolvePostwarPath=function(){
 ensureConstitution();var c=s.constitution;
 var plural=c.politicalOrder==='multiparty'||c.politicalOrder==='coalition'||c.politicalOrder==='consultative';
 var federal=c.stateStructure==='federal'||c.stateStructure==='confederal';
 var execPeace=c.executive==='parliamentary'||c.executive==='council'||c.executive==='semi_presidential';
 if(!s.altHistory.resolved){if(plural)s.altHistory.peace+=1;if(federal)s.altHistory.peace+=1;if(c.politicalOrder==='one_party')s.altHistory.cpc+=1;if(c.executive==='presidential')s.altHistory.kmt+=1;if(execPeace)s.altHistory.peace+=1;}
 return _resolvePathV45();
};
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',installConstitutionEntry);else installConstitutionEntry();
setTimeout(installConstitutionEntry,500);

/* V4.16.1：V4.3 段落现处于主作用域 */



/* ================= V4.6：制度落地与身份权限 =================
 * 制度不再只是数值标签：按年影响治理；身份决定能提出、执行或批准什么。
 */
(function(){
 function V46S(){return (window.__S?window.__S():null)||s||null;}
 function V46W(){return (window.__W?window.__W():null)||world||{};}
 function V46Clamp(n){return typeof clamp==='function'?clamp(n):Math.max(0,Math.min(100,n));}
 function V46Leader(x){return !!(x&&(x.isLeader||x.isThrone));}
 function V46Official(x){return !!(x&&x.role==='official');}
 function V46Military(x){return !!(x&&(x.role==='officer'||x.role==='soldier'));}
 function V46Merchant(x){return !!(x&&x.role==='merchant');}
 function V46Rank(x){return x?Number(x.rank||0):0;}
 function V46CanAdmin(x){return V46Leader(x)||(V46Official(x)&&V46Rank(x)>=3);}
 function V46CanCommand(x){return V46Leader(x)||(V46Military(x)&&V46Rank(x)>=4);}
 function V46CanEnvoy(x){return V46Leader(x)||(V46Official(x)&&V46Rank(x)>=5)||V46Merchant(x);}
 function V46Note(msg){try{if(typeof log==='function')log(msg);}catch(e){}}
 function V46Ensure(x){
  if(!x)return null;
  if(!x.natl)x.natl={稳定:55,经济:40,军事:40,财政:40,秩序:50,民心:50,国际:30,工业:15};
  if(!x.constitution)x.constitution={stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty',history:[],active:false};
  if(!Array.isArray(x.constitution.history))x.constitution.history=[];
  if(!Array.isArray(x.constitution.proposals))x.constitution.proposals=[];
  if(x.constitution.history.length)x.constitution.active=true;
  return x.constitution;
 }
 function V46Add(x,k,n){x.natl[k]=V46Clamp((x.natl[k]||0)+n);}
 function V46RoleText(x){
  if(V46Leader(x))return '国家最高决策者：可批准国策、宪制变更、宣战与媾和。';
  if(V46Official(x)&&V46Rank(x)>=5)return '高级文官：可处理行政事务、奉命交涉并提出宪制/外交建议；不能自行宣战或改宪。';
  if(V46Official(x))return '文官：可办理行政、地方治理与呈报建议；不能代表国家宣战或决定国策。';
  if(V46Military(x)&&V46Rank(x)>=4)return '高级军官：可指挥已获授权的战役、训练与防务；不能自行发动国家战争。';
  if(V46Military(x))return '军人：可操练、执行上级命令与参与既有战事；不能自行调动国家军队或宣战。';
  if(V46Merchant(x))return '商人：可经商、融资、采购民用物资与进行商业交涉；无权决定外交、军购或战争。';
  if(x&&(['student','activist'].indexOf(x.role)>=0))return '学生／社会活动者：可办学、宣传、组织社团、请愿与推动公共议题；不能直接执行国家权力。';
  return '平民身份：可谋生、学习、结交与参与社会活动；国家决策须通过请愿、组织或晋升渠道。';
 }
 window.__V46Authority={isLeader:V46Leader,canAdmin:V46CanAdmin,canCommand:V46CanCommand,canEnvoy:V46CanEnvoy,roleText:V46RoleText};

 // 旧版存档补字段；新开局默认制度尚未正式施行，只有完成制度改革后才产生年度治理效果。
 var oldEnsure=ensureConstitution;
 ensureConstitution=function(){oldEnsure();var c=V46Ensure(V46S());if(c&&!c.history.length&&!(V46S().institutionHistory||[]).length)c.active=false;};

 // 宪制设计：最高决策者可施行；高级文官可提案；其他身份只读并可通过社会行动积累影响。
 var oldSetAxis=setConstitutionAxis;
 setConstitutionAxis=function(axis,key){
  var x=V46S();if(!V46Leader(x)){V46Note('【权限不足】只有国家最高决策者可以正式修改宪制。你可以通过请愿、议会活动或晋升争取影响力。');return false;}
  var ok=oldSetAxis(axis,key);if(ok){var c=V46Ensure(x);c.active=true;}return ok;
 };
 var oldChoose=chooseInstitution;
 chooseInstitution=function(key,year){
  var x=V46S();
  if(!V46Leader(x)){
   V46Ensure(x);x.constitution.proposals.push({year:year||x.year,key:key,by:x.role,rank:x.rank||0});
   x.constitution.proposals=x.constitution.proposals.slice(-20);
   x.power=V46Clamp((x.power||0)+(V46Official(x)?4:(V46Merchant(x)?1:3)));
   x.fame=V46Clamp((x.fame||0)+2);
   V46Note('【制度提案】你提出制度蓝图，但尚无权替国家正式立宪。提案已记录；需要取得政府授权、进入制宪会议或成为最高决策者后才能施行。');
   return false;
  }
  var result=oldChoose(key,year);V46Ensure(x).active=true;return result;
 };

 // 国家制度面板：非领袖角色不能点击即改国体；高级文官可以递交正式提案。
 var oldOpenConstitution=openConstitutionPanel;
 openConstitutionPanel=function(){
  var x=V46S();if(!x||x.dead)return;
  V46Ensure(x);
  if(V46Leader(x)){oldOpenConstitution();return;}
  var tag=document.getElementById('dlgTag'),title=document.getElementById('dlgTitle'),desc=document.getElementById('dlgDesc'),body=document.getElementById('dlgBody'),mask=document.getElementById('mask');
  if(!body||!mask)return;
  tag.textContent='国家制度 · '+x.year+'年';title.textContent='制度现状与权限';
  desc.textContent=V46RoleText(x)+' 制度改革需要获得合法授权，不能由个人身份越权决定。';body.innerHTML='';
  var p=document.createElement('p');p.className='small';p.textContent='当前制度组合：'+constitutionSummary();body.appendChild(p);
  Object.keys(CONSTITUTION_AXES).forEach(function(axis){
   var g=CONSTITUTION_AXES[axis],h=document.createElement('h3');h.textContent=g.title;body.appendChild(h);
   Object.keys(g.items).forEach(function(key){var it=g.items[key],row=document.createElement('div');row.className='constitution-group';row.innerHTML='<b>'+it.name+'</b><div class="sub">'+it.desc+'</div>';body.appendChild(row);});
  });
  if(V46Official(x)&&V46Rank(x)>=5){
   var propose=document.createElement('button');propose.className='btn primary';propose.textContent='向政府递交宪制改革建议';
   propose.setAttribute('data-cd','cons:propose');propose.onclick=function(){if(!actGate('cons:propose','递交宪制改革建议'))return;actCool('cons:propose',180);x.constitution.proposals.push({year:x.year,kind:'constitutional_reform',by:x.role,rank:x.rank});x.constitution.proposals=x.constitution.proposals.slice(-20);x.power=V46Clamp((x.power||0)+3);V46Note('【修宪建议】你的改革建议已递交，是否采纳取决于政府授权与政治支持。');mask.classList.add('hidden');if(window.__RENDER)window.__RENDER();if(typeof persist==='function')persist();};body.appendChild(propose);
  }
  var close=document.createElement('button');close.className='btn';close.textContent='关闭';close.onclick=function(){mask.classList.add('hidden');};body.appendChild(close);mask.classList.remove('hidden');
 };

 // 身份专属国策权限：直接调用函数也无法绕过。
 var oldGovern=doGovern;
 doGovern=function(k){
  var x=V46S();
  var sovereignOnly=['memorial','appoint','mobilize','treasury','tour'];
  if(sovereignOnly.indexOf(k)>=0&&!V46Leader(x)){V46Note('【权限不足】此项属于国家最高决策权，普通官员、军人和商人不能直接执行。');return;}
  if(k==='office'&&!(V46Official(x)||V46Merchant(x)||V46Leader(x))){V46Note('【权限不足】你没有文职或商业事务身份，不能办理这类事务。');return;}
  if(k==='drill'&&!V46CanCommand(x)&&!V46Military(x)){V46Note('【权限不足】只有军人可以进行军事操练。');return;}
  oldGovern(k);
 };

 // 列强交涉区：商人只能做商业交涉；高级文官可奉命出使；借国债、购军火、宣战和媾和均属国家权力。
 var oldRenderPowers=renderPowers;
 renderPowers=function(){
  oldRenderPowers();var x=V46S(),box=document.getElementById('powersBody');if(!x||!box)return;
  var sovereign=V46Leader(x),merchant=V46Merchant(x),envoy=V46CanEnvoy(x);
  [].forEach.call(box.querySelectorAll('[data-pw]'),function(b){
   var k=b.getAttribute('data-pw');
   if(k==='talk'&&!envoy)b.remove();
   else if(k==='talk'&&merchant)b.textContent='商贸洽谈';
   else if(k==='talk'&&!sovereign)b.textContent='奉命交涉';
   if(k==='loan'&&!sovereign)b.remove();
   if(k==='buy'&&!sovereign)b.remove();
   if(k==='war'&&!sovereign)b.remove();
  });
  var note=document.createElement('p');note.className='small muted';note.textContent=V46RoleText(x);box.appendChild(note);
 };
 var oldPowerAct=powerAct;
 powerAct=function(k,n){
  var x=V46S();
  if(k==='war'&&!V46Leader(x)){V46Note('【越权阻止】宣战与媾和属于国家主权行为，商人、普通官员和军官都不能自行决定。');return;}
  if((k==='loan'||k==='buy')&&!V46Leader(x)){V46Note('【权限不足】国家借外债与军购必须由最高决策者批准。');return;}
  if(k==='talk'&&!V46CanEnvoy(x)){V46Note('【权限不足】你没有外交或商业交涉身份。');return;}
  if(k==='talk'&&V46Merchant(x)){
   initPowers();var p=x.__powers[n];if(!p)return;actCool('pw:talk:'+n,30);var gain=Math.round(rnd(2,6));p.r=V46Clamp(p.r+gain);x.cash=(x.cash||0)+Math.round(rnd(1,4)*((x.rank||0)+1)*100)/100;x.fame=V46Clamp((x.fame||0)+1);V46Note('【商贸】你与'+n+'的商行谈成一笔生意，商业关系改善，个人收入增加；这不代表国家外交立场改变。');if(window.__RENDER)window.__RENDER();if(typeof persist==='function')persist();return;
  }
  if(k==='talk'&&!V46Leader(x)&&!(V46Official(x)&&V46Rank(x)>=5)){V46Note('【权限不足】只有高级文官或国家领袖可以奉命进行外交交涉。');return;}
  oldPowerAct(k,n);
 };

 // 历史事件选项也执行身份校验：不能因为选项挂在事件里就让商人越权发动战争。
 var oldChooseEventV46=chooseEvent;
 chooseEvent=function(ev,o){
  var x=V46S(),t=(o&&o.t)||'';
  var peaceful=/反对|拒绝|劝阻|制止|避免|停战|议和|和平|谈判|斡旋/.test(t);
  if(!V46Leader(x)&&/宣战|开战|发动战争/.test(t)){V46Note('【权限不足】你可以表达立场或推动谈判，但宣战必须由国家最高决策者批准。');return;}
  if(!V46Leader(x)&&!V46CanCommand(x)&&!peaceful&&/调兵|出兵|攻取|率军|镇压|军事解决|起兵|武装夺取|组织军队/.test(t)){V46Note('【权限不足】该选项涉及调动军队或执行军事行动，你当前身份无权下令。');return;}
  oldChooseEventV46(ev,o);
 };

 // 所有旧版宣战入口统一设权；防止地图、旧按钮或脚本直接调用绕过界面限制。
 var oldDecl=window.__declWar;
 window.__declWar=function(p){var x=V46S();if(!V46Leader(x)){V46Note('【越权阻止】你没有国家最高决策权，不能对他国宣战。请通过军政上级或政府提交建议。');return false;}return oldDecl?oldDecl(p):false;};
 var oldDeclV4=window.__declWarV4;
 window.__declWarV4=function(p){var x=V46S();if(!V46Leader(x)){V46Note('【越权阻止】军官可以执行已批准的作战命令，但不能自行发动国家战争。');return false;}return oldDeclV4?oldDeclV4(p):false;};

 // 地图扩张/侵入也属于国家军令，只有最高决策者能下令；军官只能执行已批准战役。
 var oldOpenCountry=window.openCountry;
 if(oldOpenCountry){window.openCountry=function(n){oldOpenCountry(n);var x=V46S(),body=document.getElementById('dlgBody');if(!body||!x)return;
  if(!V46Leader(x)){
   [].forEach.call(body.querySelectorAll('button.choice'),function(b){if(/调兵攻取|兴兵侵入|正式宣战/.test(b.textContent))b.remove();});
   var info=document.createElement('p');info.className='small muted';info.textContent=V46Military(x)&&V46Rank(x)>=4?'你是高级军官，可以申请作战授权；跨境用兵仍须国家批准。':'跨境军事行动由国家最高决策机关批准。当前身份可通过本职行动影响国势。';body.insertBefore(info,body.firstChild);
  }
 };}

 // 平乱按权限分工：领袖可决策；高级军官可执行镇压命令；高级文官可组织招抚；其他身份只能提出建议。
 var oldRebelAct=rebelAct;
 rebelAct=function(k){var x=V46S();
  if(k==='kill'&&!V46Leader(x)&&!(V46Military(x)&&V46Rank(x)>=4)){V46Note('【权限不足】镇压行动须由国家批准，或由获得授权的高级军官执行。');return;}
  if(k==='amnesty'&&!V46Leader(x)&&!(V46Official(x)&&V46Rank(x)>=3)){V46Note('【权限不足】招抚需要行政授权；你可以向上级建议。');return;}
  if(k==='ignore'&&!V46Leader(x)&&!(V46Official(x)&&V46Rank(x)>=3)){V46Note('【权限不足】你无权决定国家对内乱的处置政策。');return;}
  oldRebelAct(k);
 };

 // 平乱按钮按身份呈现，避免无权限角色看到可执行的国家命令。
 var oldRenderRebel=renderRebel;
 renderRebel=function(){oldRenderRebel();var x=V46S(),box=document.getElementById('rebelBody');if(!x||!box||!x.__rebel)return;
  [].forEach.call(box.querySelectorAll('[data-rb]'),function(b){var k=b.getAttribute('data-rb');if(k==='kill'&&!V46Leader(x)&&!(V46Military(x)&&V46Rank(x)>=4))b.remove();if(k==='amnesty'&&!V46Leader(x)&&!(V46Official(x)&&V46Rank(x)>=3))b.remove();if(k==='ignore'&&!V46Leader(x)&&!(V46Official(x)&&V46Rank(x)>=3))b.remove();});
  var n=document.createElement('p');n.className='small muted';n.textContent=V46RoleText(x);box.appendChild(n);
 };

 // 年度制度运转：不同宪制产生不同的治理收益与制度性风险，而非只加一次属性。
 function constitutionYearTick(){
  var x=V46S();if(!x||x.dead)return;var c=V46Ensure(x);if(!c.active)return;
  var y=x.year||0,ss=c.stateStructure,ex=c.executive,po=c.politicalOrder;
  if(ss==='federal'&&y%2===0){V46Add(x,'民心',1);if((x.natl.财政||0)<28&&(x.natl.稳定||0)<42){V46Add(x,'稳定',-1);V46Note('【联邦摩擦】中央财政不足，各省对分担军费与税收产生争议。');}}
  if(ss==='confederal'&&y%2===0){V46Add(x,'民心',1);if((x.natl.军事||0)<45|| (x.natl.财政||0)<35){V46Add(x,'秩序',-1);V46Add(x,'军事',-1);V46Note('【邦联协调】成员省区未能及时落实共同防务与财政承诺。');}}
  if(ss==='unitary'&&y%2===0){V46Add(x,'秩序',1);if((x.natl.民心||0)<30)V46Add(x,'稳定',-1);}
  if(ex==='presidential'&&y%3===0){if((x.natl.稳定||0)<42||(x.trust||0)<35){V46Add(x,'稳定',-2);V46Note('【行政僵局】总统与议会／地方政治力量对预算或任命发生冲突。');}else V46Add(x,'稳定',1);}
  if(ex==='parliamentary'&&y%3===0){if((x.natl.稳定||0)<38){V46Add(x,'稳定',-2);V46Note('【内阁危机】议会多数分裂，政府面临不信任案与改组压力。');}else V46Add(x,'民心',1);}
  if(ex==='semi_presidential'&&y%3===0){if((x.natl.稳定||0)<42&&(x.trust||0)<42){V46Add(x,'稳定',-2);V46Note('【双重行政冲突】总统与总理对军政权限产生争执。');}else V46Add(x,'国际',1);}
  if(ex==='council'&&y%3===0){V46Add(x,'稳定',1);V46Add(x,'秩序',1);if((x.natl.军事||0)<35)V46Add(x,'军事',-1);}
  if(ex==='monarchy'&&y%3===0){if((x.trust||0)<35){V46Add(x,'秩序',-2);V46Note('【王室—内阁摩擦】君主、军部与责任内阁的权限边界受到质疑。');}else V46Add(x,'稳定',1);}
  if(po==='multiparty'&&y%3===0){if((x.natl.稳定||0)<35){V46Add(x,'稳定',-1);V46Note('【党争】政党极化使议会协商和预算通过变得困难。');}else V46Add(x,'民心',1);}
  if(po==='coalition'&&y%3===0){V46Add(x,'稳定',1);if((x.natl.财政||0)<30){V46Add(x,'财政',-1);V46Note('【联合政府】各党就预算分配谈判过久，财政案延迟。');}}
  if(po==='one_party'&&y%2===0){V46Add(x,'军事',1);V46Add(x,'秩序',1);if((x.natl.民心||0)<30){V46Add(x,'稳定',-2);V46Note('【反馈不足】社会意见缺乏有效表达渠道，政策纠错成本上升。');}}
  if(po==='consultative'&&y%3===0){V46Add(x,'稳定',1);V46Add(x,'民心',1);}
 }
 var prevTick=window.__yearTick;
 window.__yearTick=function(){if(prevTick)prevTick();constitutionYearTick();};

 // 制度状态卡：将三维制度、当前治理效果与玩家权限放到主界面。
 function renderInstitutionCard(){
  var x=V46S();if(!x||!document.getElementById('game'))return;
  var card=document.getElementById('cardInstitutionOps');
  if(!card){card=document.createElement('div');card.className='card';card.id='cardInstitutionOps';card.innerHTML='<h2>制度运转</h2><div id="institutionOpsBody"></div>';
   var anchor=document.getElementById('cardGuoShi')||document.getElementById('cardNation')||document.querySelector('.main .card');
   if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(card,anchor.nextSibling);else document.querySelector('.main')?.appendChild(card);
  }
  var c=V46Ensure(x),body=document.getElementById('institutionOpsBody');if(!body)return;
  var active=c.active?'已施行':'尚未正式施行（改革提案阶段）';
  var pending=(c.proposals||[]).length;
  body.innerHTML='<p class="small">'+constitutionSummary()+'</p><p class="small muted">状态：'+active+' · 制度提案记录：'+pending+'项</p><p class="small">'+V46RoleText(x)+'</p>';
 }
 var prevRender=window.__RENDER;
 window.__RENDER=function(){if(prevRender)prevRender();try{renderInstitutionCard();}catch(e){}};
 setTimeout(function(){try{renderInstitutionCard();}catch(e){}},700);

 // UI入口对所有身份可见，但非领袖进入只读/提案界面。
 var prevInstall=installConstitutionEntry;
 installConstitutionEntry=function(){prevInstall();var b=document.getElementById('btnConstitution');if(b){var x=V46S();b.textContent=V46Leader(x)?'制度设计':'查看制度';}};
 setTimeout(function(){try{installConstitutionEntry();}catch(e){}},800);
})();



/* ================= V4.7：权限闭环与存档防护 =================
 * 补齐提案审议、军令授权流程，并修复旧/异常存档中的宪制键值。
 */
(function(){
 function S(){return window.__S?window.__S():null;}
 function note(t){try{if(typeof log==='function')log(t);}catch(e){}}
 function isLeader(x){return !!(x&&(x.isLeader||x.isThrone));}
 function isMilitary(x){return !!(x&&(x.role==='officer'||x.role==='soldier'));}
 function rank(x){return Number(x&&x.rank||0);}
 function save(){try{if(typeof persist==='function')persist();}catch(e){}}
 function render(){try{if(window.__RENDER)window.__RENDER();else if(typeof render==='function')render();}catch(e){}}
 function validOrder(x,type){
  var list=x&&Array.isArray(x.authorizedOrders)?x.authorizedOrders:[];
  return list.some(function(o){return o&&o.type===type&&Number(o.expires)>=Number(x.year)&&Number(o.year)<=Number(x.year);});
 }
 function ensureOrders(x){if(x&&!Array.isArray(x.authorizedOrders))x.authorizedOrders=[];return x&&x.authorizedOrders;}

 // 1) 存档健壮性：未知/损坏制度键值回退到安全默认值，避免制度面板渲染崩溃。
 var ensure46=ensureConstitution;
 ensureConstitution=function(){
  ensure46();var x=S();if(!x)return;
  if(!x.constitution)x.constitution={};
  var c=x.constitution;
  var defaults={stateStructure:'unitary',executive:'parliamentary',politicalOrder:'multiparty'};
  Object.keys(defaults).forEach(function(axis){
   if(!CONSTITUTION_AXES[axis]||!CONSTITUTION_AXES[axis].items[c[axis]])c[axis]=defaults[axis];
  });
  if(!Array.isArray(c.history))c.history=[];
  if(!Array.isArray(c.proposals))c.proposals=[];
  if(typeof c.active!=='boolean')c.active=c.history.length>0||!!(x.institutionHistory&&x.institutionHistory.length);
  ensureOrders(x);
 };
 var oldSummary=constitutionSummary;
 constitutionSummary=function(){
  ensureConstitution();var c=(S()||{}).constitution||{};
  return [CONSTITUTION_AXES.stateStructure.items[c.stateStructure].name,CONSTITUTION_AXES.executive.items[c.executive].name,CONSTITUTION_AXES.politicalOrder.items[c.politicalOrder].name].join(' + ');
 };

 // 2) 提案闭环：最高决策者可以审议并采纳具名制度蓝图；一般性提案只作参考，不自动改宪。
 var open46=openConstitutionPanel;
 openConstitutionPanel=function(){
  var x=S();if(!x){open46();return;}ensureConstitution();
  open46();
  if(!isLeader(x))return;
  var body=document.getElementById('dlgBody');if(!body)return;
  var proposals=x.constitution.proposals||[];
  var section=document.createElement('section');section.className='constitution-group';
  var h=document.createElement('h3');h.textContent='待审议制度提案（'+proposals.length+'）';section.appendChild(h);
  if(!proposals.length){var empty=document.createElement('p');empty.className='small muted';empty.textContent='目前没有待审议提案。';section.appendChild(empty);}
  proposals.forEach(function(p,i){
   var row=document.createElement('div');row.className='constitution-group';
   var label=document.createElement('p');label.className='small';
   var model=p&&p.key&&INSTITUTION_MODELS[p.key];
   label.textContent=(p.year||'—')+'年 · '+(p.by||'未知身份')+' · '+(model?model.name:(p.kind==='constitutional_reform'?'原则性宪制改革建议':'制度建议'));
   row.appendChild(label);
   if(model){
    var approve=document.createElement('button');approve.className='btn sm primary';approve.textContent='采纳并施行此蓝图';
    approve.onclick=function(){
     if(!isLeader(S()))return;
     chooseInstitution(p.key,x.year);
     x.constitution.proposals.splice(i,1);save();note('【提案审议】已采纳'+model.name+'，制度变更已写入历史。');
     document.getElementById('mask')?.classList.add('hidden');render();
    };row.appendChild(approve);
   }else{
    var explain=document.createElement('p');explain.className='small muted';explain.textContent='该提案未指定具体制度组合。请在上方三个维度中自行选择，不会自动替你修改宪制。';row.appendChild(explain);
   }
   var reject=document.createElement('button');reject.className='btn sm';reject.textContent='归档此提案';
   reject.onclick=function(){if(!isLeader(S()))return;x.constitution.proposals.splice(i,1);save();openConstitutionPanel();};row.appendChild(reject);
   section.appendChild(row);
  });
  var close=body.querySelector('button.btn:last-child');
  if(close)body.insertBefore(section,close);else body.appendChild(section);
 };

 // 3) 明确的军令授权：领袖发出当年有效的平乱命令，高级军官才可执行；不能凭军衔自行发动行动。
 var rebel46=rebelAct;
 rebelAct=function(k){
  var x=S();if(!x)return;
  ensureOrders(x);
  if(k==='authorize_kill'){
   if(!isLeader(x)){note('【权限不足】只有国家最高决策者可以签发平乱军令。');return;}
   if(!x.__rebel){note('当前没有需要处理的内乱。');return;}
   if(!actGate('order:rebel','签发平乱军令'))return;
   actCool('order:rebel',30);
   x.authorizedOrders=x.authorizedOrders.filter(function(o){return o&&o.type!=='rebel_suppression';});
   x.authorizedOrders.push({type:'rebel_suppression',year:x.year,expires:x.year,issuedBy:x.name||'国家最高决策者'});
   note('【军令】已签发本年度平乱授权。高级军官可在有效期内执行一次。');save();render();return;
  }
  if(k==='kill'&&!isLeader(x)){
   if(!(isMilitary(x)&&rank(x)>=4&&validOrder(x,'rebel_suppression'))){note('【越权阻止】高级军官必须先取得本年度有效的平乱军令，不能自行决定镇压。');return;}
   if(!actGate('order:exec','执行平乱军令'))return;
   actCool('order:exec',30);
   var result=rebel46(k);
   x.authorizedOrders=x.authorizedOrders.filter(function(o){return !o||o.type!=='rebel_suppression';});
   save();render();return result;
  }
  return rebel46(k);
 };
 var renderRebel46=renderRebel;
 renderRebel=function(){
  renderRebel46();var x=S(),box=document.getElementById('rebelBody');if(!x||!box||!x.__rebel)return;
  var kill=box.querySelector('[data-rb="kill"]');
  if(!isLeader(x)){
   if(!(isMilitary(x)&&rank(x)>=4&&validOrder(x,'rebel_suppression'))&&kill)kill.remove();
  }else if(!box.querySelector('[data-rb="authorize_kill"]')){
   var auth=document.createElement('button');auth.className='btn sm';auth.setAttribute('data-rb','authorize_kill');auth.textContent='签发军令（授权高级军官镇压）';
   var controls=box.querySelector('div');if(controls)controls.appendChild(auth);else box.appendChild(auth);
   auth.onclick=function(){rebelAct('authorize_kill');};
  }
 };

 // 4) 历史事件中的军事行动必须由国家领导者决定；高级军官不能借事件选项绕过军令流程。
 var chooseEvent46=chooseEvent;
 chooseEvent=function(ev,o){
  var x=S(),t=(o&&o.t)||'';
  var tactical=/调兵|出兵|攻取|率军|镇压|军事解决|起兵|武装夺取|发动进攻|军事占领/.test(t);
  var peaceful=/反对|拒绝|劝阻|制止|避免|停战|议和|和平|谈判|斡旋|请愿|倡议|协商/.test(t);
  if(!isLeader(x)&&tactical&&!peaceful){note('【越权阻止】该历史事件选项涉及国家军事行动，须由国家最高决策者批准。军官可通过已签发的具体军令执行战役。');return;}
  return chooseEvent46(ev,o);
 };

 // 5) 提案和授权在自动存档中保留；旧存档载入后由 ensureConstitution 自动补齐字段。
 var oldPersist=persist;
 persist=function(){var x=S();if(x){ensureConstitution();ensureOrders(x);}return oldPersist.apply(this,arguments);};
})();

/* ================= V4.9：取消经验条，年度行动改为自主决策 ================= */
(function(){
 // 经验不再累积到隐藏进度条；行动效果直接反映到属性，旧存档无需迁移。
 addExp=function(attr,amount){
  if(!s||!attr)return;
  var delta=Number(amount)||0;
  var gain=delta===0?0:(delta>0?Math.max(1,Math.round(delta/4)):Math.min(-1,Math.round(delta/4)));
  s[attr]=clamp((Number(s[attr])||0)+gain);
 };

 // V4.18.5：点开事项后选具体做法；确认后按所需天数推进日历（时间成本），取消冷却。
 // 金额一律按“实值两”计算（见文件顶部 V4.18.5 数值基础），界面按当时币制显示。
 function R_(x){ return Math.max(0,Math.min(7,x.rank||0)); }
 function skillF(x){ return 0.8+(+x.skill||0)/100; }
 function earnCap(x){ return [8,25,80,300,800,2000,5000,15000][R_(x)]; }
 function sideFee(x){ return [0.8,2,5,12,25,40,60,90][R_(x)]; }
 function netAdd(type){ try{ return window.__netNew?window.__netNew(type):null; }catch(e){ return null; } }
 function netInfoLine(x){ try{ return window.__netInfo?window.__netInfo():''; }catch(e){ return ''; } }
 function stateRes(d){ try{ if(window.__stateRes) return window.__stateRes(d); }catch(e){} return 0; }
 function stateRev(){ try{ return window.__stateRev?window.__stateRev():5000; }catch(e){ return 5000; } }
 function pay(x,v){ x.cash=(+x.cash||0)+v; return v; }
 function spend(x,v,why){ if((+x.cash||0)<v){ flash((why||'银钱不足')+'：需要 '+M(v)+'，手上只有 '+M(x.cash||0)); return false; } x.cash-=v; return true; }
 /* 每项：[名称, 说明, 基准天数, 效果函数(x, 天数) → 结果文字 / false 表示放弃（不耗时间）] */
 var annualChoices={
  memorial:{title:'朝政重点',items:[
   ['整顿钱粮与漕运','清查账册、疏通漕运，优先稳住财政与秩序。',10,function(x){gAdd('财政',3);gAdd('秩序',2);addExp('power',4);addExp('trust',3);stateRes(stateRev()*0.01);return '户部报来的亏空缩了一截，漕船按期北上。';}],
   ['赈济灾民与平抑粮价','动用国库赈济，缓和民怨，但财政吃紧。',15,function(x){var c=stateRev()*0.02;stateRes(-c);gAdd('民心',5);gAdd('秩序',2);gAdd('财政',-2);addExp('fame',4);return '拨出赈银约 '+M(c*1e4)+'，粥厂开了，灾民没有大规模流散。';}],
   ['严查地方官员贪腐','派人核账、追查亏空，可能得罪地方势力。',20,function(x){gAdd('秩序',4);gAdd('财政',2);gAdd('民心',Math.random()<.65?2:-2);addExp('power',4);addExp('trust',-2);stateRes(stateRev()*0.005);return '追回一批亏空，也结下不少仇家。';}]
  ]},
  appoint:{title:'人事安排',items:[
   ['任用能吏','优先提拔有办事能力、熟悉地方事务的人。',15,function(x){addExp('trust',4);addExp('power',3);gAdd('秩序',3);return '几个能吏补了要缺。';}],
   ['安插亲信','把关键位置交给可靠的自己人，巩固权力。',15,function(x){addExp('power',5);addExp('trust',2);gAdd('秩序',-1);return '要害位置换上了自己人。';}],
   ['兼顾各派平衡','在不同派系之间分配职位，减少公开冲突。',20,function(x){addExp('trust',3);gAdd('稳定',3);gAdd('财政',-1);return '各派都分到一杯羹，吵声小了。';}]
  ]},
  mobilize:{title:'军事部署',items:[
   ['整训军队','整顿编制、训练与军纪，提升军队战备。',30,function(x){gAdd('军事',4);gAdd('财政',-2);stateRes(-stateRev()*0.01);if(x.unit)x.unit.mor=clamp((x.unit.mor||50)+5);addExp('skill',3);return '各营整训完毕，军纪有起色。';}],
   ['加强地方防务','修筑防线、补充守备，优先保护重要城镇。',20,function(x){gAdd('军事',2);gAdd('秩序',3);gAdd('财政',-1);stateRes(-stateRev()*0.005);return '要隘添了炮台与守兵。';}],
   ['调兵平乱','集中兵力应对境内动荡；若无内乱，则改为巡防。',30,function(x){gAdd('军事',2);gAdd('秩序',x.__rebel?4:1);gAdd('民心',x.__rebel?-2:1);if(x.__rebel)x.__rebel.arm=Math.max(0,x.__rebel.arm-Math.round(x.__rebel.arm*.2));return x.__rebel?'官军压向'+x.__rebel.place+'，乱众折损两成。':'各路兵马巡防一圈，地方无事。';}]
  ]},
  treasury:{title:'财政方针',items:[
   ['节流清欠','削减非必要开支、清理积欠，财政稳步改善。',15,function(x){gAdd('财政',4);gAdd('民心',1);gAdd('军事',-1);var c=stateRev()*0.015;stateRes(c);return '各衙门裁撤冗费，年省约 '+M(c*1e4)+'。';}],
   ['增加商税与厘金','扩大税源，短期收入增加，但商民负担加重。',15,function(x){var c=stateRev()*0.03;stateRes(c);gAdd('财政',4);gAdd('民心',-3);return '新增厘卡与商税，国库进项约 '+M(c*1e4)+'，商民怨声四起。';}],
   ['拨款兴办实业','投入工矿、交通与生产建设，约一年见效；同一时间只能主持一项。',10,null]
  ]},
  tour:{title:'出巡安排',items:[
   ['深入灾区与基层','查看民情、处理积案，改善地方治理。',45,function(x){gAdd('民心',4);gAdd('秩序',3);addExp('fame',3);x.health=clamp((x.health||100)-2);return '沿途见了饿殍，也开了仓。';}],
   ['巡视军营与边防','检查军备和军纪，提振军心。',45,function(x){gAdd('军事',3);gAdd('秩序',2);addExp('trust',2);return '各营列队受阅，军心一振。';}],
   ['举行公开典礼','展示权威、安定人心，但实际问题解决有限。',20,function(x){gAdd('稳定',3);gAdd('民心',2);addExp('fame',4);stateRes(-stateRev()*0.003);return '典礼办得体面，花费不小。';}]
  ]},
  office:{title:'公务重点',items:[
   ['清理积案、提高行政效率','集中处理诉讼、文书与积压公务。',15,function(x){gAdd('秩序',1);addExp('skill',4);addExp('trust',3);return '案上的事清了大半。';}],
   ['赈济与修缮地方','动用公费组织救济、修桥补路。',20,function(x){var c=Math.min(x.fund||0,[2,5,15,40,120,300,800,2000][R_(x)]);x.fund=(x.fund||0)-c;gAdd('民心',1);addExp('fame',4);return c>0?'动用公费 '+M(c)+'，修了桥，搭了粥棚。':'公费见底，只能动员乡里出工出料。';}],
   ['清查田赋与地方账目','核实税册、追查亏空，可能得罪人；按例有些规费。',20,function(x){gAdd('财政',1);addExp('power',3);var f=pay(x,sideFee(x)*rnd(0.3,0.8));return '查出几处隐田，按例得规费 '+M(f)+'。';}]
  ]},
  lobby:{title:'交际方向',items:[
   ['拜访同僚与上级','经营官场关系，争取支持。',10,function(x){x.supRel=clamp(supRel()+Math.round(rnd(3,7)));addExp('trust',4);addExp('power',2);var c=giftCost(R_(x))*0.3;x.cash=Math.max(0,(x.cash||0)-c);return '递了帖子，吃了几席酒，花去 '+M(c)+'。';}],
   ['联络地方士绅','争取地方社会支持，结识一位士绅。',10,function(x){var p=netAdd('gentry');addExp('fame',2);return p?'在祠堂议事时结识了'+p+'。':'几位士绅客气地应付了你。';}],
   ['结交改革派与实务人才','扩大政策与专业人脉，增加政治影响。',12,function(x){var p=netAdd('scholar');addExp('power',4);addExp('skill',2);return p?'与'+p+'谈了半夜新政。':'新派的人对你还有戒心。';}]
  ]},
  petition:{title:'上呈主张',items:[
   ['请求减税赈灾','向上级提出减免赋税、赈济灾民的方案。',10,function(x){gAdd('民心',1);addExp('fame',3);return '折子递上去，批了“知道了”。';}],
   ['建议整顿吏治','提出考核官员、清查地方弊政的办法。',10,function(x){gAdd('秩序',1);addExp('power',3);addExp('trust',-1);return '上面留中不发，同僚看你的眼神变了。';}],
   ['建议兴学与实业','推动学校、工厂和交通建设。',10,function(x){addExp('skill',3);addExp('power',2);return '条陈写了万余字，被人传抄。';}]
  ]},
  inspect:{title:'巡查重点',items:[
   ['巡查仓储与粮价','核验粮仓、平抑粮价，防止灾年失控。',20,function(x){gAdd('民心',1);gAdd('秩序',1);addExp('fame',2);return '仓里的米数与册上对得上。';}],
   ['检查税务与账册','查清税收流失和账目问题。',20,function(x){gAdd('财政',1);addExp('power',2);addExp('skill',2);return '亏空比册上多三成，县官跪着不敢抬头。';}],
   ['走访军营与基层','听取基层官兵和百姓意见。',20,function(x){addExp('fame',3);if(x.unit)x.unit.mor=clamp((x.unit.mor||50)+3);return '听了一肚子牢骚，也记下了几个名字。';}]
  ]},
  earn:{title:'谋生方式',items:[
   ['经营买卖','押上手头现银跑一趟货，赚赔各凭行情与眼光。',30,function(x){var cap=Math.min(Math.max(0,x.cash||0),earnCap(x));if(cap<1){flash('本钱不足：至少要有 '+M(1)+' 现银才能押货');return false;}var r=rnd(-0.12,0.14)+(+x.skill||0)/1000+(window.__netHas&&window.__netHas('deal',60)?0.02:0);var g=Math.round(cap*r*100)/100;x.cash+=g;addExp('skill',3);return '押货 '+M(cap)+'，'+(g>=0?'净赚 '+M(g):'折本 '+M(-g))+'。';}],
   ['承办差事','接些文书、账务或跑腿差事，收入较稳。',15,function(x){var f=pay(x,sideFee(x)*rnd(0.7,1.3)*skillF(x));addExp('trust',2);return '差事办完，得 '+M(f)+'。';}],
   ['拓展长期门路','备礼请客，结识一位商界朋友，为后续经营铺路。',20,function(x){var c=giftCost(R_(x));if(!spend(x,c,'备礼不够'))return false;var p=netAdd('merchant');addExp('power',2);addExp('fame',2);return '花去 '+M(c)+' 请客送礼'+(p?'，结识了'+p:'')+'。';}]
  ]},
  work:{title:'做工',items:[
   ['进作坊做工','按日计工钱，收入稳定，生活压力较小。',15,function(x,d){var w=pay(x,d*0.09*skillF(x));addExp('skill',2);return '做满 '+d+' 天，工钱 '+M(w)+'。';}],
   ['外出承揽短工','码头、工地、车行的短工，工钱高低不定，也伤身子。',10,function(x,d){var w=d*rnd(0.04,0.18);var cheat=Math.random()<0.15;if(cheat)w*=0.3;pay(x,w);x.health=clamp((x.health||100)-1);addExp('skill',2);return (cheat?'工头卷了半数工钱，只拿到 ':'挣得 ')+M(w)+'。';}],
   ['学一门手艺','跟师傅当学徒，只有很少的饭钱，换来手艺。',30,function(x,d){var w=pay(x,d*0.02);addExp('skill',10);return '学了 '+d+' 天，手上有了准头；饭钱 '+M(w)+'。';}]
  ]},
  gossip:{title:'打听消息',items:[
   ['打听官府动向','了解地方政策、官员更替与政局变化。',5,function(x){x.cash=Math.max(0,(x.cash||0)-0.05);addExp('power',2);var i=netInfoLine(x);return '在茶馆坐了几天（茶钱 '+M(0.05)+'）。'+(i||'听到的多是捕风捉影。');}],
   ['打听市场行情','了解物价、货源和商路消息。',5,function(x){var g=pay(x,rnd(0.05,0.4)*(R_(x)+1));addExp('skill',2);return '摸清了几样货的行情，转手赚了 '+M(g)+'。';}],
   ['打听社会民情','了解乡里矛盾、灾情与百姓诉求。',5,function(x){addExp('fame',2);return '乡里人愿意跟你说实话了。';}]
  ]},
  befriend:{title:'结交',items:[
   ['结交同乡','经营乡里关系，遇事多一条门路。',7,function(x){var c=giftCost(R_(x))*0.3;x.cash=Math.max(0,(x.cash||0)-c);var p=netAdd('tongxiang');addExp('trust',2);return '请了一桌（'+M(c)+'），'+(p?'和'+p+'攀上了乡谊。':'只喝出个面熟。');}],
   ['结交读书人与教员','扩大知识与信息来源。',7,function(x){var p=netAdd('scholar');addExp('skill',2);return p?'在书肆里认识了'+p+'。':'读书人对你客气而疏远。';}],
   ['结交商贾与行会','拓展生意和社会资源。',7,function(x){var c=giftCost(R_(x))*0.3;x.cash=Math.max(0,(x.cash||0)-c);var p=netAdd('merchant');addExp('power',2);return '酒席花去 '+M(c)+(p?'，结识了'+p+'。':'。');}]
  ]},
  drill:{title:'操练',items:[
   ['加强队列与纪律','提升基本训练和组织能力。',20,function(x){addExp('skill',4);if(x.unit)x.unit.mor=clamp((x.unit.mor||50)+3);return '操场上站了一阵，队列像样了。';}],
   ['练习射击与战术','专注实战技能，消耗一些弹药。',20,function(x){var c=0.3*(R_(x)+1);if((x.fund||0)>=c)x.fund-=c;else x.cash=Math.max(0,(x.cash||0)-c);addExp('skill',6);gAdd('军事',1);return '打掉弹药约 '+M(c)+'，准头稳了。';}],
   ['整顿营务与装备','改善军需和队伍管理。',30,function(x){addExp('trust',4);if(x.unit)x.unit.sup=clamp((x.unit.sup||50)+4);return '账目与军械清点了一遍。';}]
  ]},
  drillCivil:{title:'强身习武',items:[
   ['习拳练武','每天早起练拳脚，强身健体。',20,function(x){x.health=clamp((x.health||100)+3);addExp('skill',3);return '练了些日子，身子骨硬朗了些。';}],
   ['学骑射与枪法','花钱买些弹药，跟老兵学放枪。',20,function(x){if(!spend(x,0.5,'弹药钱不够'))return false;addExp('skill',5);return '花了 '+M(0.5)+' 的弹药，打得准了。';}],
   ['结伴晨练','和熟人一起练，顺便拉近关系。',15,function(x){x.health=clamp((x.health||100)+2);var n=window.__netTouch?window.__netTouch(4):'';addExp('trust',1);return n?'和'+n+'天天在河边练拳，熟络了。':'一个人练了半月。';}]
  ]},
  rest:{title:'休整',items:[
   ['在家休养','恢复身体，减少风险。',10,function(x){x.health=clamp((x.health||100)+8);return '睡足了觉，精神回来了。';}],
   ['陪伴家人','稳住家庭生活与个人状态。',15,function(x){x.health=clamp((x.health||100)+5);addExp('trust',1);return '陪家里人过了些日子。';}],
   ['闭门读书','休整同时补充知识。',20,function(x){x.health=clamp((x.health||100)+3);addExp('skill',4);return '读完了两部书。';}]
  ]},
  study:{title:'进修',items:[
   ['读书进修','经史或新学，按部就班地读。',30,function(x){addExp('skill',8);return '读完了几部书，笔记写了半本。';}],
   ['投考学堂 / 拜师','交束脩或学费，换取系统的学习。',60,function(x){var c=[1,3,6,10,15,20,30,40][R_(x)];if(!spend(x,c,'学费不够'))return false;addExp('skill',14);addExp('fame',2);return '交了 '+M(c)+' 的学费，学得扎实。';}],
   ['译书写稿','替书局译书、给报馆写稿，挣些稿费。',20,function(x,d){var w=pay(x,d*0.06*skillF(x));addExp('fame',3);addExp('skill',2);return '稿费 '+M(w)+'，文章也有人读了。';}]
  ]},
  organize:{title:'组织活动',items:[
   ['散发传单','夜里张贴、散发传单，名声起来，风险也大。',10,function(x){addExp('fame',5);addExp('power',2);var r=window.__netRisk?window.__netRisk(0.12,'散发传单被巡警盯上'):'';return '传单贴满了三条街。'+(r||'');}],
   ['联络同志','串联可靠的人，结识一位同志。',15,function(x){var p=netAdd('comrade');addExp('power',3);x.clubRel=clamp((x.clubRel||50)+3);return p?'经人介绍，与'+p+'接上了头。':'几处联络点都断了线。';}],
   ['募集经费','向同情者募款，大部分交组织，自己留些路费。',20,function(x){var g=rnd(1,4)*(R_(x)+1);var keep=Math.round(g*0.2*100)/100;x.cash+=keep;x.fund=(x.fund||0)+g-keep;x.clubRel=clamp((x.clubRel||50)+4);addExp('fame',2);return '募得 '+M(g)+'，交组织 '+M(g-keep)+'，留路费 '+M(keep)+'。';}]
  ]}
 };
 var annualNames={memorial:'批折子',appoint:'用人',mobilize:'调兵',treasury:'开库',tour:'出巡',office:'办公',lobby:'交际',petition:'递折子',inspect:'巡查',earn:'谋生',work:'做工',gossip:'打听',befriend:'结交',drill:'操练',rest:'休整',study:'进修',organize:'组织'};
 function isMilX(x){ return x.role==='soldier'||x.role==='officer'; }
 function cfgOf(k,x){ if(k==='drill'&&!isMilX(x)) return annualChoices.drillCivil; return annualChoices[k]; }
 /* 权限：返回 null 表示可以做，否则返回原因（界面上会把按钮置灰并写明原因） */
 function denyReason(k,x){
  var leader=!!(x.isThrone||x.isLeader),official=x.role==='official',merchant=x.role==='merchant';
  if(['memorial','appoint','mobilize','treasury','tour'].indexOf(k)>=0&&!leader) return '此项属于国家最高决策权';
  if(k==='office'&&!(official||merchant||leader)) return '你当前身份不能办理这类公务';
  if(x.cal&&x.cal.finished) return '本局已在1972年末结算';
  if(x.dead) return '人已不在';
  return null;
 }
 function allowed(k,x){ var r=denyReason(k,x); if(r){ flash('权限不足：'+r); return false; } return true; }
 window.__actDeny=function(k){ var x=S_(); return x?denyReason(k,x):null; };
 function S_(){ return window.__S?window.__S():null; }
 /* 每个事项的天数范围（按钮上显示“约 N 天”） */
 var GOV_DAYS={};
 Object.keys(annualChoices).forEach(function(k){ var ds=annualChoices[k].items.map(function(it){return it[2];}); GOV_DAYS[k]=[Math.min.apply(null,ds),Math.max.apply(null,ds)]; });
 GOV_DAYS.drill=[15,30];
 var BUILD_DAYS=360;
 JOB_FX.menu=function(x,job){
  var d=job.data||{},cfg=annualChoices[d.k],it=cfg&&cfg.items[d.i];
  if(!it||!it[3])return '';
  it[3](x,0);
  return it[0]+' 已见成效';
 };
 JOB_FX.build=function(x,job){
  gAdd('工业',5);gAdd('经济',3);addExp('fame',2);
  return '工厂与道路陆续投产，工业与经济上升';
 };
 window.__GOV_COOL=GOV_DAYS;window.__GOV_DAYS=GOV_DAYS;window.__GOV_ONGOING={};
 function govLabel(k){return annualNames[k]||'此事';}
 window.__govLabel=govLabel;
 function buildBusy(){ var x=S_(); if(!x||!Array.isArray(x.jobs)) return null; for(var i=0;i<x.jobs.length;i++){ if(x.jobs[i].fx==='build') return x.jobs[i]; } return null; }
 function openMenu(k){
  if(!s)return;
  if(!allowed(k,s))return;
  if(!actGate('gov:'+k,govLabel(k)))return;
  var cfg=cfgOf(k,s);if(!cfg){flash('这个行动暂时没有可选方案');return;}
  var mask=document.getElementById('mask'),tag=document.getElementById('dlgTag'),title=document.getElementById('dlgTitle'),desc=document.getElementById('dlgDesc'),body=document.getElementById('dlgBody');
  if(!mask||!body)return;
  tag.textContent='行动决策 · '+calFmt(calToday());
  title.textContent=cfg.title;
  desc.textContent='选定后立即办理，日历随之推进相应天数（天数随能力、职位、人脉与时局浮动）；期间生活开销照常扣除，历史事件照常发生。';
  body.innerHTML='';
  cfg.items.forEach(function(it,i){
   var b=document.createElement('button');b.className='choice';b.style.marginBottom='8px';
   var isBuild=(k==='treasury'&&i===2);
   var days=isBuild?it[2]:dayCost('gov:'+k,it[2]);
   var bb=isBuild?buildBusy():null;
   var extra=isBuild?('<div class="chance">筹办约 '+days+' 天；工程约 '+actDays(BUILD_DAYS)+' 天建成，先从国库拨付约 '+M(stateRev()*0.05*1e4)+'</div>'):('<div class="chance">约 '+days+' 天</div>');
   if(bb){ extra+='<div class="chance" style="color:var(--red)">已有一项工程在建，预计 '+calFmtOrd(bb.end)+' 完工</div>'; b.disabled=true; }
   b.innerHTML='<b>'+it[0]+'</b><div class="small muted" style="margin-top:4px">'+it[1]+'</div>'+extra;
   b.onclick=function(){
    if(!s||!actGate('gov:'+k,govLabel(k))){mask.classList.add('hidden');return;}
    if(isBuild){
     if(buildBusy()){ flash('已有一项工程在建'); return; }
     var c=stateRev()*0.05; stateRes(-c); gAdd('财政',-2);
     s.jobSeq=(s.jobSeq||0)+1;
     var j=jobStart('build:'+s.jobSeq,{label:'兴办实业（工矿与交通建设）',days:BUILD_DAYS,fx:'build',data:{k:k,i:i,paid:c}});
     actCool('gov:'+k,it[2]);
     log('【'+govLabel(k)+'】从国库拨付约 '+M(c*1e4)+' 兴办实业，预计 '+calFmtOrd(j.end)+' 建成。');
    }else{
     var d=dayCost('gov:'+k,it[2]);
     var result=it[3](s,d);
     if(result===false){return;}
     actCool('gov:'+k,it[2]);
     log('【'+govLabel(k)+'】'+it[0]+(typeof result==='string'&&result?'：'+result:'。'));
    }
    s.lastAnnualChoice={year:s.year,ord:calTodayOrd(),action:k,choice:it[0]};
    mask.classList.add('hidden');
    if(typeof persist==='function')persist();
    if(window.__RENDER)window.__RENDER();else if(typeof render==='function')render();
   };
   body.appendChild(b);
  });
  var cancel=document.createElement('button');cancel.className='btn';cancel.textContent='暂不决定';cancel.onclick=function(){mask.classList.add('hidden');};body.appendChild(cancel);
  mask.classList.remove('hidden');
 }
 doGovern=function(k){openMenu(k);};


 // 去掉界面上的经验条和经验数字，属性数值直接显示。
 var st=document.createElement('style');
 st.textContent='.statsrow .bar.exp,.statsrow .x{display:none!important}.statsrow .st{padding-bottom:8px}';
 document.head.appendChild(st);
 var hint=document.getElementById('actHint');if(hint)hint.textContent=ACT_HINT_TEXT;
 // 兼容旧存档：不再依赖经验字段，避免旧经验进度继续影响游戏。
 if(s){s.exp={skill:0,fame:0,power:0,trust:0};s.breakthrough=s.breakthrough||{};}
})();

// V4.9：渲染后保持新版年度决策说明，不被旧版提示覆盖。
(function(){
 var renderV49=render;
 render=function(){
  renderV49();
  var hint=document.getElementById('actHint');
  if(hint)hint.textContent=ACT_HINT_TEXT;
 };
})();


/* ================= V4.10：重大历史事件动态抉择 ================= */
(function(){
 // 新增事件均按年份触发；每个事件的选择池会按身份筛选，再结合个人属性随机抽取。
 EVENTS.push(
  {id:'nanjing42',y:1842,t:'《南京条约》与通商口岸',who:['qing','local','civil'],d:'战败和约即将签订，沿海口岸、关税与地方秩序都面临重整。你需要判断如何应对新的局面。',opts:[
   {t:'建议整顿海防与炮台',d:'从沿海防务和军备入手。',fac:['qing','local'],affinity:'skill',req:{skill:38},risk:1,run:function(x,w){if(w){x.skill+=5;x.trust+=4;x.power+=2;return '你的海防建议得到部分采纳，沿海防务开始整顿。';}x.trust-=4;return '经费与权限不足，方案被搁置。';}},
   {t:'推动通商口岸的商贸布局',d:'利用新口岸发展贸易与税源。',fac:['local','civil'],affinity:'power',req:{power:32},run:function(x){x.cash+=35;x.fame+=3;x.power+=3;return '你协助建立新的商贸渠道，地方收入有所增加。';}},
   {t:'上书要求厘清条约与关税',d:'以文书和交涉争取制度空间。',fac:['qing','civil'],affinity:'skill',req:{skill:48},risk:1,run:function(x,w){if(w){x.power+=6;x.fame+=4;return '你的条陈被收入议论，成为后续交涉的参考。';}x.trust-=3;return '奏折未获回应。';}},
   {t:'先安抚地方商民',d:'避免口岸变化引发骚乱。',fac:['qing','local','civil'],affinity:'fame',req:{fame:28},run:function(x){x.fame+=5;x.trust+=2;return '你组织商民协商，地方秩序暂时稳定。';}}
  ]},
  {id:'secondopium56',y:1856,t:'第二次鸦片战争',who:['qing','local','civil'],d:'英法联军扩大军事压力，朝廷内部对战和与改革的争论再次激化。',opts:[
   {t:'组织沿江防务',d:'协调地方守备与军需。',fac:['qing','local'],affinity:'skill',req:{skill:42},risk:1,run:function(x,w){if(w){x.skill+=6;x.trust+=3;return '沿江防务得到加强。';}x.fame-=2;x.trust-=3;return '守备准备不足，防线很快被突破。';}},
   {t:'主张尽快议和以保存实力',d:'避免战事继续扩大。',fac:['qing','civil','local'],affinity:'trust',req:{trust:42},run:function(x){x.trust+=4;x.fame-=1;return '你主张保存实力，暂时避免了更大损失。';}},
   {t:'推动学习西方军工与船政',d:'将危机转为制度与技术改革契机。',fac:['qing','civil'],affinity:'power',req:{power:38,skill:35},risk:1,run:function(x,w){if(w){x.power+=6;x.skill+=5;return '你的建议得到开明官员支持。';}x.trust-=4;return '保守势力阻挠，改革暂时搁浅。';}},
   {t:'协助地方疏散与赈济',d:'保护百姓与粮道。',fac:['local','civil'],affinity:'fame',req:{fame:32},run:function(x){x.fame+=5;x.cash=Math.max(0,x.cash-8);return '疏散和赈济有序进行，百姓对你评价提高。';}}
  ]},
  {id:'taipingfall64',y:1864,t:'天京陷落与战后善后',who:['qing','local','civil'],d:'太平天国运动进入尾声，江南地区亟待恢复生产、安置流民并处理地方军权。',opts:[
   {t:'主持战后赈济与复业',d:'恢复田亩、商路和基层秩序。',fac:['qing','local','civil'],affinity:'fame',req:{fame:35},run:function(x){x.fame+=6;x.trust+=3;x.cash=Math.max(0,x.cash-12);return '你组织复垦与赈济，地方逐渐恢复生气。';}},
   {t:'推动裁撤勇营、收归兵权',d:'避免地方军队长期坐大。',fac:['qing'],affinity:'power',req:{power:52,trust:45},risk:1,run:function(x,w){if(w){x.power+=5;x.trust+=5;return '部分军队改编，中央对地方的控制有所恢复。';}x.trust-=7;return '将领抵制裁撤，你与地方军头关系恶化。';}},
   {t:'保留地方团练以维持治安',d:'以稳定优先。',fac:['qing','local'],affinity:'trust',req:{trust:38},run:function(x){x.trust+=4;x.power+=2;return '地方治安暂时稳定，但兵为将有的格局延续。';}},
   {t:'兴办义学与地方善堂',d:'从教育和社会救济入手。',fac:['civil','local'],affinity:'skill',req:{skill:35},run:function(x){x.fame+=4;x.skill+=3;return '义学与善堂逐步恢复，地方社会得到喘息。';}}
  ]},
  {id:'saihai75',y:1875,t:'海防与塞防之争',who:['qing','local','civil'],d:'朝廷讨论经费应优先用于西北边疆还是东南海防，有限财力迫使各方作出取舍。',opts:[
   {t:'主张优先经营西北',d:'支持边疆用兵与新疆善后。',fac:['qing','local'],affinity:'skill',req:{skill:42,trust:35},run:function(x){x.power+=4;x.trust+=3;return '你的意见支持了西北经略与边疆善后。';}},
   {t:'主张优先建设海军',d:'集中资源发展海防与船政。',fac:['qing','local'],affinity:'power',req:{power:40,skill:38},run:function(x){x.skill+=4;x.power+=4;x.cash=Math.max(0,x.cash-10);return '海防建设得到更多关注，但地方财政承压。';}},
   {t:'提出分阶段兼顾两线',d:'以预算与风险评估协调争论。',fac:['qing','civil'],affinity:'skill',req:{skill:55},risk:1,run:function(x,w){if(w){x.fame+=4;x.power+=5;return '你的折中方案获得部分认可。';}x.trust-=2;return '各派互不相让，方案未能通过。';}},
   {t:'联络地方士绅筹措经费',d:'以地方资源补充国库。',fac:['local','civil'],affinity:'fame',req:{fame:40,power:28},run:function(x){x.cash+=20;x.fame+=3;return '地方士绅愿意捐输，但也要求更多地方话语权。';}}
  ]},
  {id:'sinoFrench84',y:1884,t:'中法战争',who:['qing','local','civil'],d:'中法在越南及中国东南沿海发生战争，边防、外交和军费调度都受到考验。',opts:[
   {t:'协助前线防务',d:'参与军需、布防或作战协调。',fac:['qing','local'],affinity:'skill',req:{skill:45},risk:1,run:function(x,w){if(w){x.skill+=6;x.fame+=4;return '前线部署有所改善。';}x.trust-=4;return '前线指挥混乱，行动未能奏效。';}},
   {t:'推动外交斡旋',d:'争取停战并减少损失。',fac:['qing','civil'],affinity:'power',req:{power:42,trust:35},risk:1,run:function(x,w){if(w){x.power+=6;x.trust+=3;return '你的联络为谈判争取了空间。';}x.fame-=2;return '外交斡旋未能改变战局。';}},
   {t:'组织沿海民团与救护',d:'保护地方居民和交通。',fac:['local','civil'],affinity:'fame',req:{fame:30},run:function(x){x.fame+=5;x.trust+=2;return '民团与救护网络发挥作用。';}},
   {t:'上书整顿军制与军费',d:'指出旧式军政体系的问题。',fac:['qing','civil'],affinity:'skill',req:{skill:52,power:30},run:function(x){x.power+=4;x.skill+=3;return '你的建议进入地方军政改革讨论。';}}
  ]},
  {id:'boxer01',y:1901,t:'《辛丑条约》与赔款善后',who:['qing','local','civil'],d:'巨额赔款、驻兵与外交限制压在清廷身上，地方财政和社会生活承受长期影响。',opts:[
   {t:'推动核减冗费、整理财政',d:'从预算和税务入手缓解压力。',fac:['qing','local'],affinity:'skill',req:{skill:42,power:35},run:function(x){x.power+=4;x.trust+=2;return '地方账目有所整理，但财政困局仍在。';}},
   {t:'组织地方实业与商路恢复',d:'扩大生产与税源。',fac:['local','civil'],affinity:'fame',req:{fame:32,skill:30},run:function(x){x.cash+=25;x.fame+=4;return '地方实业逐步恢复，商路重新活跃。';}},
   {t:'向上级争取减轻基层摊派',d:'避免赔款压力层层转嫁。',fac:['qing','local','civil'],affinity:'trust',req:{trust:48},risk:1,run:function(x,w){if(w){x.fame+=5;x.trust+=2;return '基层摊派有所减轻。';}x.trust-=4;return '上级认为你不顾大局，要求照章摊派。';}},
   {t:'倡议新式学堂与人才培养',d:'以教育改革应对危局。',fac:['civil','qing'],affinity:'skill',req:{skill:48},run:function(x){x.skill+=5;x.fame+=2;return '新式学堂得到更多关注。';}}
  ]},
  {id:'abolish_exam05',y:1905,t:'废除科举',who:['qing','civil','local'],d:'延续千年的科举制度走向终结，新式学堂、留学与新式官僚体系迅速扩张。',opts:[
   {t:'转入新式学堂任教或求学',d:'以新知识建立职业道路。',fac:['civil','qing','local'],affinity:'skill',req:{skill:35},run:function(x){x.skill+=6;x.fame+=2;return '你进入新式教育体系，获得新的知识与人脉。';}},
   {t:'推动地方兴学',d:'筹款设立学堂、培养新式人才。',fac:['local','civil'],affinity:'fame',req:{fame:32,power:25},run:function(x){x.fame+=5;x.power+=3;return '地方学堂逐步建立。';}},
   {t:'协助旧式士人转型',d:'帮助失去科举路径的人寻找新出路。',fac:['qing','civil'],affinity:'trust',req:{trust:35},run:function(x){x.trust+=4;x.fame+=3;return '你帮助一批旧式士人进入新式行政和教育岗位。';}},
   {t:'投身报刊与公共讨论',d:'参与新思想传播。',fac:['civil'],affinity:'skill',req:{skill:42},run:function(x){x.fame+=5;x.power+=3;return '你的文章和演讲逐渐获得影响。';}}
  ]},
  {id:'huguo15',y:1915,t:'护国运动',who:['beiyang','kmt','local','civil'],d:'袁世凯称帝引发反对，云南率先举兵，各地军政力量面临站队压力。',opts:[
   {t:'公开反对帝制',d:'联络反袁力量。',fac:['beiyang','local','civil','kmt'],affinity:'fame',req:{fame:40,power:32},risk:1,run:function(x,w){if(w){x.fame+=7;x.power+=5;x.alt+=1;return '反帝制立场扩大了你的政治声望。';}x.trust-=6;return '表态过早，你受到上级压力。';}},
   {t:'维持中立、保护辖区',d:'避免地方卷入战争。',fac:['beiyang','local'],affinity:'trust',req:{trust:42},run:function(x){x.trust+=4;x.fame-=1;return '你暂时保住地方秩序，但政治影响有限。';}},
   {t:'为护国军筹措粮械',d:'承担后勤与联络。',fac:['local','kmt'],affinity:'skill',req:{skill:42},risk:1,run:function(x,w){if(w){x.fame+=5;x.trust+=3;return '粮械顺利送达，护国军获得支援。';}x.cash=Math.max(0,x.cash-10);return '运输受阻，物资未能及时送达。';}},
   {t:'劝说各方恢复共和',d:'以政治协商结束危机。',fac:['civil','beiyang','local'],affinity:'power',req:{power:45,trust:35},run:function(x){x.power+=5;x.fame+=3;return '你参与了恢复共和的地方协商。';}}
  ]},
  {id:'warlord16',y:1916,t:'袁世凯去世与权力真空',who:['beiyang','local','kmt','civil'],d:'中央权威骤然削弱，北洋派系和地方实力派开始重新计算自身利益。',opts:[
   {t:'促成地方军政联合',d:'建立临时协商机制。',fac:['local','beiyang'],affinity:'power',req:{power:42},run:function(x){x.power+=5;x.trust+=2;return '地方军政联合暂时形成。';}},
   {t:'向直属上级表明忠诚',d:'避免在派系斗争中失去位置。',fac:['beiyang','local'],affinity:'trust',req:{trust:45},run:function(x){x.trust+=5;x.power+=2;return '你保住了现有职位，但自主空间有限。';}},
   {t:'推动恢复国会与责任内阁',d:'尝试以制度约束军人政治。',fac:['civil','kmt'],affinity:'skill',req:{skill:48,power:38},risk:1,run:function(x,w){if(w){x.fame+=5;x.power+=6;return '你的制度主张得到部分舆论支持。';}x.trust-=3;return '军政强人不愿接受约束。';}},
   {t:'避免站队，保护民生',d:'优先稳定辖区。',fac:['local','civil'],affinity:'fame',req:{fame:35},run:function(x){x.fame+=4;x.trust+=2;return '你避免了地方卷入更大冲突。';}}
  ]},
  {id:'northeast28',y:1928,t:'东北易帜',who:['kmt','beiyang','local','civil'],d:'张学良宣布东北改旗易帜，形式上的全国统一出现新的可能。',opts:[
   {t:'协助接收与整合地方行政',d:'推动制度、军队和财政接轨。',fac:['kmt','local'],affinity:'skill',req:{skill:45,power:38},run:function(x){x.power+=5;x.trust+=4;return '行政整合有序推进。';}},
   {t:'维护东北地方自主',d:'争取保留地方治理空间。',fac:['beiyang','local'],affinity:'power',req:{power:50,trust:38},risk:1,run:function(x,w){if(w){x.power+=6;x.fame+=3;return '地方自治空间得到部分保留。';}x.trust-=5;return '中央压力增大，你的主张未能落实。';}},
   {t:'促成军队和平改编',d:'避免武装冲突。',fac:['kmt','beiyang','local'],affinity:'trust',req:{trust:45},run:function(x){x.trust+=5;x.skill+=2;return '军队改编较为平稳。';}},
   {t:'借统一之机推动法治建设',d:'以制度巩固统一。',fac:['civil','kmt'],affinity:'skill',req:{skill:52,power:40},run:function(x){x.fame+=4;x.power+=5;return '地方议事与司法制度改革得到推进。';}}
  ]},
  {id:'zunyi35',y:1935,t:'遵义会议前后的路线调整',who:['cpc'],d:'中央红军在长征途中面临军事与组织危机，领导路线和指挥方式需要调整。',opts:[
   {t:'支持调整军事指挥',d:'强调从实际战况出发改变指挥。',fac:['cpc'],affinity:'skill',req:{skill:48,trust:38},risk:1,run:function(x,w){if(w){x.skill+=6;x.trust+=5;x.power+=3;return '新的指挥思路逐渐得到执行。';}x.trust-=3;return '你缺乏足够组织影响，意见没有进入决策层。';}},
   {t:'承担联络与情报工作',d:'为部队转移提供信息。',fac:['cpc'],affinity:'skill',req:{skill:38},run:function(x){x.skill+=4;x.trust+=4;return '情报与联络工作帮助队伍避开部分风险。';}},
   {t:'维护组织团结、避免公开冲突',d:'先确保队伍继续行动。',fac:['cpc'],affinity:'trust',req:{trust:45},run:function(x){x.trust+=5;x.fame+=2;return '你协助稳定基层队伍。';}},
   {t:'提出基层补给与行军调整',d:'改善部队生存条件。',fac:['cpc'],affinity:'fame',req:{fame:30,skill:35},run:function(x){x.skill+=3;x.fame+=3;return '补给安排有所改善。';}}
  ]},
  {id:'henan42',y:1942,t:'河南灾荒与战时救济',who:['kmt','cpc','local','civil'],d:'战时灾荒、交通阻断和行政失灵叠加，粮食救济成为地方社会的紧迫问题。',opts:[
   {t:'组织粮食赈济与灾民转移',d:'协调粮食、交通和临时安置。',fac:['local','civil','kmt','cpc'],affinity:'fame',req:{fame:35,trust:30},run:function(x){x.fame+=6;x.cash=Math.max(0,x.cash-12);return '你组织了赈济和转移，减少了部分灾民损失。';}},
   {t:'调查囤积与粮价操纵',d:'查明粮商、仓储与运输问题。',fac:['kmt','local','civil'],affinity:'skill',req:{skill:48,power:35},risk:1,run:function(x,w){if(w){x.power+=5;x.fame+=4;return '调查揭开部分囤积问题，粮价有所回落。';}x.trust-=4;return '调查受到地方势力阻挠。';}},
   {t:'向上级争取减免征粮',d:'减轻灾区征收压力。',fac:['kmt','local','cpc'],affinity:'trust',req:{trust:48},risk:1,run:function(x,w){if(w){x.fame+=5;x.trust+=2;return '上级同意局部调整征粮安排。';}x.trust-=3;return '请求未获批准。';}},
   {t:'组织民间互助与医疗救护',d:'发动社会力量救助灾民。',fac:['civil','local','cpc'],affinity:'fame',req:{fame:30},run:function(x){x.fame+=4;x.skill+=2;return '民间互助网络缓解了部分灾情。';}}
  ]},
  {id:'leap58',y:1958,t:'人民公社化',who:['cpc','local','civil'],d:'北戴河会议通过在农村建立人民公社的决议，公社化运动迅速铺开。高指标与大规模组织变动交织，基层生产、粮食征购和公共生活受到深刻影响。',opts:[
   {t:'如实上报产量与基层困难',d:'避免虚报浮夸，反映实际情况。',fac:['cpc','local'],affinity:'trust',req:{trust:52,skill:42},risk:1,run:function(x,w){if(w){x.fame+=5;x.trust+=3;return '基层真实情况得到部分重视。';}x.trust-=5;return '你的报告被认为消极，受到批评。';}},
   {t:'推动因地制宜安排生产',d:'减少一刀切，保留生产弹性。',fac:['cpc','local'],affinity:'skill',req:{skill:48,power:32},run:function(x){x.skill+=4;x.fame+=3;return '部分生产安排得以调整。';}},
   {t:'组织公共食堂与集体生产',d:'积极执行新的组织方式。',fac:['cpc','local'],affinity:'trust',req:{trust:38},run:function(x){x.trust+=3;x.power+=2;return '你参与了基层组织调整，执行效率有所提高，但资源压力也在积累。';}},
   {t:'优先保护口粮与基层仓储',d:'把粮食安全放在首位。',fac:['local','cpc'],affinity:'fame',req:{fame:38,skill:35},run:function(x){x.fame+=4;x.cash=Math.max(0,x.cash-5);return '你设法保留部分口粮储备。';}}
  ]},
  {id:'cultural66',y:1966,t:'文化大革命开始',who:['cpc','civil','local'],d:'政治运动迅速扩展，学校、机关和社会组织受到冲击，个人与家庭面临复杂抉择。',opts:[
   {t:'尽力保护同事与学生',d:'减少冲突，保存人员和基本秩序。',fac:['cpc','civil','local'],affinity:'fame',req:{fame:42,trust:35},risk:1,run:function(x,w){if(w){x.fame+=5;x.trust+=2;return '你帮助一些人暂避冲击，尽可能维持日常工作。';}x.trust-=4;return '局势失控，你的保护行动受到阻挠。';}},
   {t:'谨慎服从组织安排',d:'避免公开冲突，保护自身岗位。',fac:['cpc','local'],affinity:'trust',req:{trust:42},run:function(x){x.trust+=3;x.fame-=2;return '你暂时保住岗位，但许多事务已无法正常开展。';}},
   {t:'保存档案与专业资料',d:'尽可能保护知识、设备和文献。',fac:['civil','cpc'],affinity:'skill',req:{skill:48},run:function(x){x.skill+=4;x.fame+=2;return '部分档案与专业资料得到保存。';}},
   {t:'协助维持基层生产与公共服务',d:'避免社会生活全面停摆。',fac:['local','cpc'],affinity:'power',req:{power:40,trust:38},run:function(x){x.power+=3;x.fame+=3;return '基层生产与公共服务在困难中维持。';}}
  ]},
  {id:'un71',y:1971,t:'中华人民共和国恢复联合国合法席位',who:['cpc','civil','local'],d:'中国在联合国的代表权问题得到解决，外交空间与国际交往出现新的局面。',opts:[
   {t:'参与对外联络与外交事务',d:'拓展国际沟通渠道。',fac:['cpc','civil'],affinity:'power',req:{power:45,skill:40},run:function(x){x.power+=5;x.fame+=3;return '你参与了对外联络，国际交往渠道逐渐拓展。';}},
   {t:'推动外贸与技术交流',d:'把外交变化转化为发展机会。',fac:['local','civil','cpc'],affinity:'skill',req:{skill:45},run:function(x){x.cash+=25;x.skill+=3;return '你推动了贸易与技术信息交流。';}},
   {t:'开展公共宣传与国际形势教育',d:'向社会解释国际局势变化。',fac:['cpc','civil','local'],affinity:'fame',req:{fame:38},run:function(x){x.fame+=4;x.power+=2;return '相关宣传和教育工作逐步开展。';}},
   {t:'协助恢复学术与文化交流',d:'推动专业人员和文化团体重新建立联系。',fac:['civil','cpc'],affinity:'skill',req:{skill:52,power:32},run:function(x){x.skill+=4;x.fame+=3;return '学术与文化交流出现新的空间。';}}
  ]}
 );
 // 同一年若原版已有事件（如1958、1966、1971），把新增选项合并进去，避免年份匹配时被前一个事件遮挡。
 /* V4.19：只合并同一 id 的事件（1966、1971 原版与扩充版同名）。不同 id 的同年事件各自按日期触发：
    1958 年的大跃进（5-05）与人民公社化（8-29）原先被并成一个，人民公社化的选项提前在 5 月一并弹出，
    V4.11/V4.12 挂在 leap58 上的长期因果与身份选项也因此失效。 */
 var yearMap={};
 EVENTS=EVENTS.filter(function(ev){
  var y=String(ev.id||ev.y);
  if(!yearMap[y]){yearMap[y]=ev;return true;}
  var base=yearMap[y];base.opts=(base.opts||[]).concat(ev.opts||[]);
  base.who=Array.from(new Set((base.who||[]).concat(ev.who||[])));
  return false;
 });

 function eventKey(ev){return String(ev.id||ev.y);}
 function statScore(x,key){return Math.max(0,Math.min(100,Number(x[key])||0));}
 function eligibleOptions(ev,x){return (ev.opts||[]).filter(function(o){if(o.fac&&o.fac.indexOf(x.faction)<0)return false;if(o.role){var rr=Array.isArray(o.role)?o.role:[o.role],actual=(x.isLeader||x.isThrone)?'leader':x.role;if(rr.indexOf(actual)<0)return false;}if(o.club&&(!x.clubJoined||o.club.indexOf(x.club)<0))return false;if(o.cond&&!o.cond())return false;return true;});}
 function weightedPick(pool,x,count){
  var left=pool.slice(),picked=[];
  while(left.length&&picked.length<count){
   var total=left.reduce(function(n,o){var k=o.affinity||'skill';return n+1+statScore(x,k)/25;},0),r=Math.random()*total,idx=0;
   for(;idx<left.length;idx++){r-=1+statScore(x,left[idx].affinity||'skill')/25;if(r<=0)break;}
   if(idx>=left.length)idx=left.length-1;picked.push(left.splice(idx,1)[0]);
  }
  return picked;
 }
 var oldShowEvent=showEvent;
 showEvent=function(ev){
  if(!s||!ev||!ev.opts)return oldShowEvent(ev);
  var x=s,key=eventKey(ev);x.eventOffers=x.eventOffers||{};
  var pool=eligibleOptions(ev,x),indexes=x.eventOffers[key];
  if(!Array.isArray(indexes)){
   var offerLimit=ev.id==='xian'?5:(['q7','wuhan','baituan','1945','henan42'].indexOf(ev.id)>=0?4:3);
   var picked=weightedPick(pool,x,Math.min(offerLimit,pool.length));
   var actualRole=(x.isLeader||x.isThrone)?'leader':x.role;
   var rolePool=pool.filter(function(o){return o.role&&(Array.isArray(o.role)?o.role:[o.role]).indexOf(actualRole)>=0;});
   if(rolePool.length&&!picked.some(function(o){return !!o.role;})){picked[picked.length-1]=weightedPick(rolePool,x,1)[0];}
   indexes=picked.map(function(o){return ev.opts.indexOf(o);});
   x.eventOffers[key]=indexes;
  }
  var offered=indexes.map(function(i){return ev.opts[i];}).filter(Boolean);
  // 保持阵营旁观机制；若本阵营没有任何可用选项，则交由原逻辑显示旁观。
  if(!offered.length)return oldShowEvent(ev);
  var view={};Object.keys(ev).forEach(function(k){view[k]=ev[k];});view.opts=offered;
  return oldShowEvent(view);
 };
 var oldChooseEvent=chooseEvent;
 chooseEvent=function(ev,o){
  if(o&&o.req){var names={skill:'能力',fame:'声望',power:'政治影响',trust:'上级信任'},miss=[];Object.keys(o.req).forEach(function(k){var n=Number(o.req[k])||0;if((Number(s[k])||0)<n)miss.push((names[k]||k)+'需要'+n+'，当前'+(Number(s[k])||0));});if(miss.length){flash('条件未达到：'+miss.join('；'));return;}}
  return oldChooseEvent(ev,o);
 };
 // 新档与旧档均可用；每次事件选项抽取后保存，重新打开不会刷新抽签。
 var oldPersist=persist;
 persist=function(){if(s)s.eventOffers=s.eventOffers||{};return oldPersist.apply(this,arguments);};
})();


/* ================= V4.11：跨年代历史遗产与长期因果 ================= */
(function(){
 if(!Array.isArray(EVENTS))return;
 // 历史遗产写入存档：玩家的早期选择会改变后续年代可见的事件选项。
 function flags(){if(!s)return {};s.historyFlags=s.historyFlags||{};return s.historyFlags;}
 function mark(key){flags()[key]=true;}
 function has(key){return !!(s&&s.historyFlags&&s.historyFlags[key]);}
 function findEvent(id){return EVENTS.find(function(e){return e.id===id;});}
 function addLegacyOption(id,o){var e=findEvent(id);if(e&&e.opts&&!e.opts.some(function(x){return x.id===o.id;}))e.opts.push(o);}
 // 标记的是玩家采取的政策方向；成功率仍按原事件判定，属性结果也仍由原 run 函数结算。
 var paths=[
  {event:'nanjing42',match:'整顿海防',flag:'coastal_defense'},
  {event:'nanjing42',match:'通商口岸',flag:'open_trade'},
  {event:'nanjing42',match:'厘清条约',flag:'treaty_diplomacy'},
  {event:'saihai75',match:'经营西北',flag:'northwest_priority'},
  {event:'saihai75',match:'建设海军',flag:'navy_priority'},
  {event:'saihai75',match:'分阶段兼顾',flag:'balanced_defense'},
  {event:'abolish_exam05',match:'新式学堂',flag:'modern_education'},
  {event:'abolish_exam05',match:'地方兴学',flag:'local_education'},
  {event:'abolish_exam05',match:'旧式士人',flag:'traditional_scholars'},
  {event:'huguo15',match:'反对帝制',flag:'republican_stance'},
  {event:'huguo15',match:'恢复共和',flag:'constitutional_republic'},
  {event:'warlord16',match:'军政联合',flag:'regional_military_union'},
  {event:'warlord16',match:'恢复国会',flag:'parliamentary_reform'},
  {event:'q7',match:'开赴前线',flag:'frontline_service'},
  {event:'q7',match:'后方动员',flag:'wartime_mobilization'},
  {event:'leap58',match:'如实上报',flag:'truthful_reporting'},
  {event:'leap58',match:'因地制宜',flag:'flexible_production'},
  {event:'leap58',match:'保护口粮',flag:'grain_reserve'},
  {event:'cultural66',match:'保护同事',flag:'protected_people'},
  {event:'cultural66',match:'保存档案',flag:'saved_archives'},
  {event:'cultural66',match:'公共服务',flag:'maintained_services'}
 ];
 var previousChoose=chooseEvent;
 chooseEvent=function(ev,o){
  if(ev&&o){var id=String(ev.id||'');paths.forEach(function(p){if(p.event===id&&String(o.t||'').indexOf(p.match)>=0)mark(p.flag);});}
  return previousChoose(ev,o);
 };
 // 1840年代的海防/通商选择，影响1875年争论中的政策空间。
 addLegacyOption('saihai75',{id:'legacy_coast',t:'延续早年海防整顿方案',d:'承接1842年提出的沿海防务规划；早期投入使你更熟悉海防事务。',fac:['qing','local'],affinity:'skill',req:{skill:38},cond:function(){return has('coastal_defense');},run:function(x){x.skill+=3;x.power+=3;return '早期海防规划成为论证依据，沿海防务获得持续投入。';}});
 addLegacyOption('saihai75',{id:'legacy_trade',t:'以口岸税源支持两线防务',d:'利用早年通商布局形成的税源，尝试平衡海防与边防。',fac:['qing','local','civil'],affinity:'power',req:{power:38},cond:function(){return has('open_trade');},run:function(x){x.cash=Math.max(0,x.cash-5);x.power+=4;return '口岸税源为防务预算提供补充，但贸易利益也要求稳定环境。';}});
 // 1905年的教育选择，为1919年的社会动员提供知识与组织基础。
 addLegacyOption('may4',{id:'legacy_education',t:'依托新式教育网络组织青年讨论',d:'承接1905年兴学与新式学堂积累的师生网络。',fac:['civil','kmt'],affinity:'skill',req:{skill:38},cond:function(){return has('modern_education')||has('local_education');},run:function(x){x.fame+=4;x.power+=4;x.skill+=2;return '既有学校网络迅速组织起讲演、刊物与联络活动。';}});
 addLegacyOption('may4',{id:'legacy_scholars',t:'联合转型士人与新知识群体',d:'早年协助旧式士人转型，使传统地方网络与新式社团建立联系。',fac:['civil','qing','local'],affinity:'trust',req:{trust:38},cond:function(){return has('traditional_scholars');},run:function(x){x.trust+=3;x.fame+=4;return '不同教育背景的人士形成合作，地方舆论网络扩大。';}});
 // 共和立场与地方军政联合，会影响东北易帜时的整合/自治谈判。
 addLegacyOption('northeast28',{id:'legacy_republic',t:'以恢复共和的承诺推动和平整合',d:'承接护国运动时期形成的共和立场。',fac:['kmt','beiyang','local','civil'],affinity:'fame',req:{fame:38,power:32},cond:function(){return has('republican_stance')||has('constitutional_republic');},run:function(x){x.fame+=3;x.power+=4;x.trust+=2;return '共和承诺为谈判提供共同语言，改旗易帜过程更易获得支持。';}});
 addLegacyOption('northeast28',{id:'legacy_regional_union',t:'以地方军政协商换取和平改编',d:'承接1916年促成地方军政联合的经验。',fac:['beiyang','local','kmt'],affinity:'power',req:{power:42,trust:35},cond:function(){return has('regional_military_union');},run:function(x){x.power+=4;x.trust+=4;return '既有协商网络帮助各方谈妥军队改编与地方权限。';}});
 addLegacyOption('northeast28',{id:'legacy_parliament',t:'提出恢复议会监督的统一方案',d:'承接早年责任内阁与国会改革主张。',fac:['civil','kmt'],affinity:'skill',req:{skill:48,power:38},cond:function(){return has('parliamentary_reform');},run:function(x){x.power+=5;x.fame+=3;return '统一方案加入议会监督条款，获得部分政治力量支持。';}});
 // 抗战时期的前线/后方选择，影响1942年救济和1945年接收善后。
 addLegacyOption('henan42',{id:'legacy_wartime_relief',t:'沿用战时后方动员网络开展赈济',d:'承接抗战初期的后方动员经验。',fac:['kmt','cpc','local','civil'],affinity:'fame',req:{fame:32,skill:32},cond:function(){return has('wartime_mobilization')||has('frontline_service');},run:function(x){x.fame+=4;x.trust+=3;x.cash=Math.max(0,x.cash-6);return '既有运输、联络和救护网络投入赈济，灾民转移效率提高。';}});
 addLegacyOption('1945',{id:'legacy_rebuild',t:'以战时动员体系转入战后重建',d:'将抗战期间形成的运输、医疗与基层组织网络用于复员和重建。',fac:['kmt','cpc','local','civil'],affinity:'skill',req:{skill:38},cond:function(){return has('wartime_mobilization')||has('frontline_service');},run:function(x){x.skill+=3;x.fame+=4;x.cash+=8;return '部分战时组织转为复员、交通修复与难民安置力量。';}});
 // 1958年的基层治理选择，会改变1966年可用的缓冲手段。
 addLegacyOption('cultural66',{id:'legacy_grain',t:'启用此前保留的粮食储备与基层账册',d:'承接1958年保护口粮、如实报告或灵活生产的做法。',fac:['cpc','local'],affinity:'skill',req:{skill:38},cond:function(){return has('grain_reserve')||has('truthful_reporting')||has('flexible_production');},run:function(x){x.trust+=3;x.fame+=3;x.cash=Math.max(0,x.cash-4);return '基层储备与真实账册为困难时期的供应和协调留下余地。';}});
 // 1966年保存下来的档案、人员和公共服务网络，影响1971年后的交流恢复。
 addLegacyOption('un71',{id:'legacy_archive',t:'以保存下来的档案与专业队伍恢复学术交流',d:'承接此前保存专业资料、保护人员的努力。',fac:['civil','cpc'],affinity:'skill',req:{skill:45},cond:function(){return has('saved_archives')||has('protected_people')||has('maintained_services');},run:function(x){x.skill+=4;x.fame+=3;x.power+=2;return '保存下来的资料和专业人员成为恢复学术、文化交流的重要基础。';}});
 // 旧档兼容：不覆盖已有历史记录，仅补齐新字段。
 if(s)s.historyFlags=s.historyFlags||{};
 var oldPersist=persist;
 persist=function(){if(s)s.historyFlags=s.historyFlags||{};return oldPersist.apply(this,arguments);};
})();


/* ================= V4.12：身份专属历史道路 =================
 * 同一历史节点因职业身份而出现不同职责、风险和长期后果。
 * role: soldier/officer/official/merchant/student/activist/leader
 */
(function(){
 if(!Array.isArray(EVENTS))return;
 function event(id){return EVENTS.find(function(e){return e.id===id;});}
 function add(id,o){var e=event(id);if(e&&e.opts&&!e.opts.some(function(x){return x.id===o.id;}))e.opts.push(o);}
 function flags(){if(!s)return {};s.historyFlags=s.historyFlags||{};return s.historyFlags;}
 function has(k){return !!(s&&s.historyFlags&&s.historyFlags[k]);}
 var routes=[
  // 普通士兵：强调基层作战、生存、伤员救护与复员安置。
  {event:'secondopium56',match:'基层守备',flag:'soldier_guard'},
  {event:'q7',match:'战地救护',flag:'soldier_medic'},
  // 军官：强调参谋、训练、编制与指挥责任。
  {event:'sinoFrench84',match:'军官参谋',flag:'officer_staff'},
  {event:'q7',match:'整训部队',flag:'officer_training'},
  // 文官：强调行政、财政、档案和救济执行。
  {event:'boxer01',match:'核查赔款账目',flag:'official_audit'},
  {event:'henan42',match:'建立灾情行政档案',flag:'official_relief'},
  // 商人：强调贸易、运输、供给与资本网络。
  {event:'nanjing42',match:'建立商号与运输网络',flag:'merchant_network'},
  {event:'boxer01',match:'组织商会恢复供应',flag:'merchant_supply'},
  // 学生：强调求学、研究、刊物与专业服务。
  {event:'abolish_exam05',match:'建立学生自治与研究社团',flag:'student_society'},
  {event:'may4',match:'以学生身份组织公开讲演',flag:'student_speech'},
  // 活动家：强调社会组织、工农联络和公共动员。
  {event:'may4',match:'组织社会互助团体',flag:'activist_network'},
  {event:'split',match:'维持地下联络与救济',flag:'activist_underground'},
  // 最高决策者：承担制度与国家层面的选择。
  {event:'xinhai',match:'主持权力交接与临时章程',flag:'leader_transition'},
  {event:'1945',match:'提出全国重建纲领',flag:'leader_rebuild'},
  {event:'leap58',match:'调整政策指标与基层考核',flag:'leader_policy_review'}
 ];
 var priorChoose=chooseEvent;
 chooseEvent=function(ev,o){
  if(o&&o.role){var allowed=Array.isArray(o.role)?o.role:[o.role],actual=(s&&(s.isLeader||s.isThrone))?'leader':(s&&s.role);if(allowed.indexOf(actual)<0){flash('该选项仅适用于对应身份，当前身份无法执行。');return;}}
  if(ev&&o){routes.forEach(function(r){if(ev.id===r.event&&String(o.t||'').indexOf(r.match)>=0)flags()[r.flag]=true;});}
  return priorChoose(ev,o);
 };
 // 士兵：在1856年承担基层守备，或在1937年参加战地救护；战后可转入复员安置。
 add('secondopium56',{id:'role_soldier_guard',role:'soldier',t:'以普通士兵身份坚守基层阵地',d:'你负责壕沟、哨位和弹药搬运。战功不一定显赫，但基层守备经验会留下来。',affinity:'skill',req:{skill:28},risk:1,run:function(x,w){if(w){x.skill+=5;x.fame+=2;x.trust+=2;return '你守住了阵地和补给点，基层士兵开始信任你的判断。';}x.health=Math.max(1,(x.health||100)-8);x.fame+=1;return '阵地失守，你带着少数同伴撤出，留下了伤病。';}});
 add('q7',{id:'role_soldier_medic',role:'soldier',t:'担任战地救护与伤员转运',d:'不直接决定战役方向，而是在火线后方救护、搬运伤员。',affinity:'fame',req:{fame:25},run:function(x){x.fame+=5;x.trust+=3;x.health=Math.min(100,(x.health||100)+2);return '你救护伤员并熟悉战地医疗，战友和百姓记住了你。';}});
 add('1945',{id:'role_soldier_demob',role:'soldier',t:'以老兵身份协助复员与安置',d:'把战时经验用于安置伤兵、清点装备和恢复家乡生产。',affinity:'trust',req:{trust:30},cond:function(){return has('soldier_guard')||has('soldier_medic');},run:function(x){x.fame+=4;x.skill+=3;x.cash+=5;return '你协助战友返乡与复员，逐渐获得地方社会的信任。';}});
 // 军官：负责训练和参谋，不等同于普通士兵的执行路线。
 add('sinoFrench84',{id:'role_officer_staff',role:'officer',t:'以军官身份进入参谋系统',d:'负责绘制防区、协调军需和拟定撤守方案，成绩取决于组织与判断。',affinity:'skill',req:{skill:42,trust:32},risk:1,run:function(x,w){if(w){x.skill+=6;x.power+=3;x.trust+=3;return '参谋方案减少了部队混乱，你获得独立负责一段防区的机会。';}x.trust-=3;x.skill+=2;return '命令传达失误，参谋责任被追究。';}});
 add('q7',{id:'role_officer_training',role:'officer',t:'整训部队并建立轮换制度',d:'以军官身份负责训练、补给纪律和伤员轮换。',affinity:'skill',req:{skill:48,power:30},run:function(x){x.skill+=5;x.trust+=4;x.power+=2;return '部队训练和轮换制度有所改善，保存了部分战斗力。';}});
 add('1945',{id:'role_officer_reorg',role:'officer',t:'主持部队整编与军官复员',d:'战后处理番号、装备、军官任用和部队去向。',affinity:'power',req:{power:38,trust:35},cond:function(){return has('officer_staff')||has('officer_training');},run:function(x){x.power+=4;x.skill+=3;x.trust+=2;return '你参与整编与复员，形成一批长期军政人脉。';}});
 // 文官：制度执行与行政档案形成长期治理能力。
 add('boxer01',{id:'role_official_audit',role:'official',t:'核查赔款摊派与地方财政账目',d:'你以文官身份逐项核对税册、摊派和地方支出。',affinity:'skill',req:{skill:40,trust:32},run:function(x){x.skill+=5;x.power+=3;x.cash+=8;return '账目逐渐清晰，你积累了财政和行政方面的专业声誉。';}});
 add('henan42',{id:'role_official_relief',role:'official',t:'建立灾情行政档案与分区救济名册',d:'按县、乡、灾情和粮食缺口登记，减少救济物资错配。',affinity:'skill',req:{skill:45,power:32},run:function(x){x.skill+=4;x.fame+=4;x.trust+=2;return '救济名册提高了物资分配效率，也为后续地方治理留下数据。';}});
 add('un71',{id:'role_official_exchange',role:'official',t:'负责外事文书与行政接待',d:'以行政官员身份处理代表团接待、文书翻译和跨部门协调。',affinity:'trust',req:{trust:38,skill:42},run:function(x){x.skill+=3;x.power+=4;x.fame+=2;return '你熟悉了涉外行政流程，成为部门间协调的可靠人选。';}});
 // 商人：商业资本、运输和供应链会影响财政与地方声望。
 add('nanjing42',{id:'role_merchant_network',role:'merchant',t:'建立商号与运输网络',d:'利用口岸变化联络货栈、船户和外地商号，承担价格与治安风险。',affinity:'power',req:{power:25},run:function(x){x.cash+=55;x.power+=4;x.fame+=2;return '商号和运输网络逐渐成形，你获得资金，也开始承担地方供应责任。';}});
 add('boxer01',{id:'role_merchant_supply',role:'merchant',t:'组织商会恢复供应与平抑物价',d:'联络同行恢复粮食、布匹和日用品供应，避免囤积引发冲突。',affinity:'fame',req:{fame:28,power:32},run:function(x){x.cash=Math.max(0,x.cash-12);x.fame+=6;x.trust+=2;return '商会承担了部分供应成本，民间评价提高，但利润受到挤压。';}});
 add('un71',{id:'role_merchant_trade',role:'merchant',t:'拓展对外贸易与技术采购',d:'以商人身份联络外贸渠道、设备和技术信息。',affinity:'power',req:{power:40,skill:32},run:function(x){x.cash+=45;x.skill+=2;x.power+=3;return '新贸易渠道带来资金和技术信息，但也需要承担市场风险。';}});
 // 学生：从新式教育到公共知识生产，只有1898年后开局者能经历。
 add('abolish_exam05',{id:'role_student_society',role:'student',t:'建立学生自治与研究社团',d:'组织读书会、实验小组和校内自治活动，培养专业与协作能力。',affinity:'skill',req:{skill:32},run:function(x){x.skill+=6;x.fame+=3;x.power+=2;return '社团逐渐稳定，你建立起跨校的师生联系。';}});
 add('may4',{id:'role_student_speech',role:'student',t:'以学生身份组织公开讲演',d:'联系学校、社团和报刊，围绕公共议题开展讨论。',affinity:'fame',req:{fame:28,skill:35},cond:function(){return has('student_society');},run:function(x){x.fame+=5;x.power+=4;x.trust-=1;return '讲演吸引了青年参与，你的公共影响扩大，也引来校方关注。';}});
 add('un71',{id:'role_student_exchange',role:'student',t:'争取恢复专业学习与学术交流',d:'以学生或青年研究者身份参与专业资料整理和学术交流。',affinity:'skill',req:{skill:48},run:function(x){x.skill+=5;x.fame+=2;return '你重新接触专业资料和学术网络，知识积累得到恢复。';}});
 // 活动家：社会组织和基层联络路线与学生的校园路线区分。
 add('may4',{id:'role_activist_network',role:'activist',t:'组织社会互助团体与基层联络',d:'从工人、店员和街坊互助入手，建立跨社区联络网络。',affinity:'power',req:{power:30,fame:28},run:function(x){x.power+=5;x.fame+=4;x.trust-=1;return '互助网络扩大了你的社会影响，但也使你更容易受到当局注意。';}});
 add('split',{id:'role_activist_underground',role:'activist',t:'维持地下联络与救济',d:'在政治冲突中保护联络渠道，优先帮助受牵连者和家属。',affinity:'trust',req:{trust:30,skill:35},cond:function(){return has('activist_network');},risk:1,run:function(x,w){if(w){x.trust+=5;x.power+=4;x.fame+=2;return '联络线和互助点得以保存，组织在困难中延续。';}x.trust-=5;x.health=Math.max(1,(x.health||100)-4);return '联络点遭到破坏，你被迫转移并失去一部分关系。';}});
 add('henan42',{id:'role_activist_relief',role:'activist',t:'发动跨村互助与灾民安置',d:'不依赖单一行政系统，动员民间团体开展转运、募捐和照护。',affinity:'fame',req:{fame:35,power:32},run:function(x){x.fame+=5;x.power+=3;x.cash=Math.max(0,x.cash-5);return '民间互助网络帮助灾民转移，你获得基层社会的信任。';}});
 // 领袖：国家层面的制度与政策责任，不与普通官员/将领选项混用。
 add('xinhai',{id:'role_leader_transition',role:'leader',t:'主持权力交接与临时章程',d:'以最高决策者身份处理退位、临时政府和军政权力交接。',affinity:'power',req:{power:42,trust:38},risk:1,run:function(x,w){if(w){x.power+=6;x.fame+=4;x.trust+=3;return '临时权力安排获得主要力量接受，政权交接相对平稳。';}x.trust-=6;x.power-=3;return '权力交接缺乏共识，地方和军队开始各行其是。';}});
 add('1945',{id:'role_leader_rebuild',role:'leader',t:'提出全国重建纲领',d:'从财政、交通、复员、教育和地方治理安排战后重建优先次序。',affinity:'power',req:{power:48,skill:42},cond:function(){return has('leader_transition')||xLeaderEligible();},run:function(x){x.power+=5;x.fame+=4;x.cash-=10;return '重建纲领形成跨部门任务，短期财政承压，但行政协调能力增强。';}});
 function xLeaderEligible(){return !!(s&&(s.isLeader||s.isThrone));}
 add('leap58',{id:'role_leader_policy_review',role:'leader',t:'调整政策指标与基层考核',d:'以最高决策者身份修正层层加码的指标，建立困难上报和政策复核机制。',affinity:'trust',req:{power:52,trust:45},risk:1,run:function(x,w){if(w){x.trust+=5;x.fame+=3;x.power+=2;return '政策复核机制得到部分落实，基层报告渠道有所恢复。';}x.trust-=5;x.fame-=2;return '调整遭遇阻力，基层仍承受过高指标压力。';}});
 // 身份专属的长期遗产：前期选择会解锁同身份后续年代的延续性方案。
 add('boxer01',{id:'legacy_merchant_1901',role:'merchant',t:'沿用早年商号网络组织赔款后的地方供应',d:'承接1842年建立的商号与运输网络。',affinity:'power',req:{power:35},cond:function(){return has('merchant_network');},run:function(x){x.cash+=18;x.fame+=3;return '旧有商路帮助地方恢复供应，你的商业信用进一步扩大。';}});
 add('may4',{id:'legacy_student_1919',role:'student',t:'依托学生研究社团发行专题刊物',d:'承接1905年建立的自治与研究社团。',affinity:'skill',req:{skill:40},cond:function(){return has('student_society');},run:function(x){x.skill+=3;x.fame+=4;x.power+=2;return '研究社团转化为刊物和公共讨论网络。';}});
 add('1945',{id:'legacy_official_1945',role:'official',t:'以既有财政审计经验清理战后账目',d:'承接1901年积累的财政核查经验。',affinity:'skill',req:{skill:45,power:35},cond:function(){return has('official_audit');},run:function(x){x.skill+=4;x.trust+=3;x.cash+=6;return '财政审计经验帮助清理接收账目和地方欠款。';}});
 // 兼容旧存档：新字段按需创建，不覆盖既有路线记录。
 if(s)s.historyFlags=s.historyFlags||{};
})();

/* ================= V4.13：派系斗争、职位竞争、组织分裂与权力更迭 =================
 * 组织政治系统：派系联盟、真实职位席位、竞争任免、组织分裂/复合、领导继承。
 * 不同身份拥有不同政治资源；旧存档按需迁移，不覆盖已有游戏进度。
 */
(function(){
 'use strict';
 function S(){return window.__S?window.__S():null;}
 function note(t){try{if(typeof log==='function')log(t);}catch(e){}}
 function save(){try{if(typeof persist==='function')persist();}catch(e){}}
 function draw(){try{if(window.__RENDER)window.__RENDER();}catch(e){}}
 function clamp(n,a,b){return Math.max(a,Math.min(b,Math.round(Number(n)||0)));}
 function leader(x){return !!(x&&(x.isLeader||x.isThrone||x.internalPolitics&&x.internalPolitics.isFactionLeader));}
 function role(x){return leader(x)?'leader':(x.role||'official');}
 function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
 var GROUPS={
  qing:[['守旧与宗室派','强调皇权、秩序与旧有官僚体系'],['洋务与自强派','主张练兵、兴办实业和有限制度改革'],['地方督抚派','重视地方财政、军队与辖区自主']],
  beiyang:[['中央统合派','主张强化中央政府与统一军令'],['军事强人派','依靠军队、地盘和私人效忠维持权力'],['议会共和派','强调国会、责任内阁与文官政治']],
  kmt:[['党务组织派','重视党务系统、组织纪律与干部任用'],['军事实力派','依靠军队、战功和军事资源扩大影响'],['宪政改革派','主张法治、地方自治与制度化监督']],
  cpc:[['组织路线派','强调组织建设、纪律和集中协调'],['基层动员派','重视群众工作、地方实践与基层反馈'],['务实治理派','强调生产、财政、行政和政策纠偏']],
  local:[['本地乡绅派','依托地方声望、乡团与传统关系'],['军队实力派','依靠武装、军饷和指挥系统'],['商贸自治派','重视商会、税源、交通与地方自治']],
  civil:[['知识与教育派','依靠学校、报刊、专业知识和公共讨论'],['工商自治派','依靠商会、行业组织与地方经济'],['社会互助派','依靠社团、基层网络与社会声望']]
 };
 var ROLE_LABEL={soldier:'士兵',officer:'军官',official:'文官',merchant:'商人',student:'学生',activist:'活动家',leader:'领袖'};
 var POSITIONS=[
  {id:'org',name:'组织/部门负责人',rank:1,roles:['official','student','activist','merchant','officer','leader']},
  {id:'admin',name:'行政主管',rank:2,roles:['official','leader']},
  {id:'mil',name:'军事主管',rank:2,roles:['officer','soldier','leader']},
  {id:'finance',name:'财政与资源主管',rank:2,roles:['official','merchant','leader']},
  {id:'core',name:'核心决策委员',rank:4,roles:['official','officer','merchant','activist','leader']},
  {id:'chief',name:'最高负责人',rank:6,roles:['leader']}
 ];
 function addHistory(p,txt){p.history.unshift({year:S()?S().year:0,text:txt});p.history=p.history.slice(0,40);}
 function freshFactions(x){return (GROUPS[x.faction]||GROUPS.civil).map(function(g,i){return {id:'g'+i,name:g[0],desc:g[1],support:[38,34,28][i],loyalty:[62,58,55][i],influence:[35,30,25][i],stance:['稳健','进取','改革'][i]};});}
 function ensure(x){
  if(!x)return null;
  var p=x.internalPolitics;
  if(!p||typeof p!=='object')p=x.internalPolitics={year:x.year,cohesion:65,split:false,splitName:'',leaderName:'现任最高负责人',succession:0,history:[],factions:freshFactions(x),positions:[],aligned:'g0',vacancySince:null,crisis:false};
  if(!Array.isArray(p.factions)||!p.factions.length)p.factions=freshFactions(x);
  if(!Array.isArray(p.history))p.history=[];
  if(!Array.isArray(p.positions))p.positions=[];
  if(typeof p.cohesion!=='number')p.cohesion=65;
  if(typeof p.succession!=='number')p.succession=0;
  if(!p.aligned||!p.factions.some(function(f){return f.id===p.aligned;}))p.aligned=p.factions[0].id;
  p.factions.forEach(function(f){f.support=clamp(f.support,0,100);f.loyalty=clamp(f.loyalty,0,100);f.influence=clamp(f.influence,0,100);});
  // 将早期简化版的“分裂标记”迁移为可追踪的独立派系。
  if(p.split&&!p.factions.some(function(f){return /^g_split(?:\d+)?$/.test(f.id);})){var base=p.factions.filter(function(f){return f.id===p.aligned;})[0]||p.factions[0];p.factions.push({id:'g_split',name:p.splitName||'分裂派',desc:'由路线冲突与权力争议形成的独立组织中心。',support:clamp(base.support-8,12,70),loyalty:42,influence:clamp(base.influence-5,10,65),stance:'另立路线'});}
  if(!p.positions.length){p.positions=POSITIONS.map(function(pos,i){var occupied=(i===5)?!!leader(x):i===0?true:false;return {id:pos.id,name:pos.name,rank:pos.rank,incumbent:occupied?(i===5?x.name:'现任负责人'):'',factionId:i===5?p.aligned:(i===0?p.aligned:'g'+(i%Math.min(3,p.factions.length))),vacant:!occupied,contested:false};});}
  // 保持新增席位结构兼容旧存档。
  POSITIONS.forEach(function(pos){if(!p.positions.some(function(q){return q.id===pos.id;}))p.positions.push({id:pos.id,name:pos.name,rank:pos.rank,incumbent:'',factionId:p.aligned,vacant:true,contested:false});});
  p.positions.forEach(function(q){if(typeof q.vacant!=='boolean')q.vacant=!q.incumbent;});
  return p;
 }
 function actualGroup(x){var p=ensure(x);return p.factions.filter(function(f){return f.id===p.aligned;})[0]||p.factions[0];}
 function playerWeight(x){return (x.power||0)*.30+(x.fame||0)*.18+(x.skill||0)*.16+(x.trust||0)*.24+(x.rank||0)*5;}
 function roleBonus(x,kind){var r=role(x);var map={
  organize:{leader:7,official:6,officer:4,activist:6,student:4,merchant:5,soldier:2},
  contest:{leader:5,official:7,officer:7,activist:3,student:2,merchant:5,soldier:2},
  reconcile:{leader:6,official:7,officer:3,activist:6,student:5,merchant:4,soldier:2},
  split:{leader:7,official:3,officer:6,activist:5,student:3,merchant:2,soldier:2},
  succession:{leader:8,official:5,officer:7,activist:2,student:1,merchant:3,soldier:3}
 };return (map[kind]||{})[r]||0;}
 function eligible(x,action){var r=role(x),rank=x.rank||0;if(action==='organize')return true;if(action==='contest')return rank>=1||['student','activist','merchant'].indexOf(r)>=0;if(action==='split')return ['leader','official','officer','activist'].indexOf(r)>=0;if(action==='reconcile')return true;if(action==='succession')return leader(x)||rank>=5;return false;}
 function positionFor(x){var r=role(x);return POSITIONS.filter(function(p){return p.roles.indexOf(r)>=0&&p.rank>(x.rank||0)&&p.id!=='chief';}).sort(function(a,b){return a.rank-b.rank;})[0]||POSITIONS.filter(function(p){return p.roles.indexOf(r)>=0&&p.id!=='chief';}).slice(-1)[0]||POSITIONS[0];}
 function action(kind,positionId){
  var x=S();if(!x)return;var p=ensure(x),g=actualGroup(x);var cdKey='fac:'+kind,noCd=false;if(!actGate(cdKey,FAC_ACT_NAME[kind]||'组织政治'))return;if(!eligible(x,kind)){note('以当前身份和职位，你暂时没有资格采取这项政治行动。');return;}
  var r=role(x),result='',roll=Math.random();
  if(kind==='organize'){
   var b=roleBonus(x,kind);g.influence=clamp(g.influence+5+b,0,100);g.support=clamp(g.support+4+Math.floor((x.fame||0)/35),0,100);g.loyalty=clamp(g.loyalty+3,0,100);p.cohesion=clamp(p.cohesion+2,0,100);x.power=clamp(x.power+2,0,100);x.trust=clamp(x.trust+1,0,100);
   result='你以'+(ROLE_LABEL[r]||'成员')+'身份经营派系：'+g.name+'的组织影响与支持上升。';
  }else if(kind==='contest'){
   var pos=p.positions.filter(function(q){return q.id===positionId;})[0]||p.positions.filter(function(q){return q.vacant&&q.rank>(x.rank||0);})[0]||p.positions.filter(function(q){return q.id===positionFor(x).id;})[0];
   if(!pos){note('当前没有适合你竞争的职位。');return;}
   var spec=POSITIONS.filter(function(q){return q.id===pos.id;})[0]||{roles:['official']};
   if(spec.roles.indexOf(r)<0){note('该职位不符合你的身份任职范围。');return;}
   if(pos.rank>(x.rank||0)+1){note('资历不足，暂时无法越级竞争该职位。');return;}
   var incumbency=pos.vacant?8:-8;var support=g.support*.24+g.influence*.20+g.loyalty*.10+(x.trust||0)*.14+(x.fame||0)*.10+(x.skill||0)*.10+(x.power||0)*.12+roleBonus(x,'contest')+incumbency+(x.rank||0)*2;
   var chance=Math.max(8,Math.min(92,Math.round(25+(support-35)*1.15)));
   if(Math.random()*100<chance){var displaced=pos.incumbent;pos.incumbent=x.name;pos.factionId=g.id;pos.vacant=false;pos.contested=false;x.rank=clamp(Math.max(x.rank||0,pos.rank),0,7);x.power=clamp(x.power+5,0,100);x.fame=clamp(x.fame+3,0,100);g.support=clamp(g.support+5,0,100);g.influence=clamp(g.influence+4,0,100);p.cohesion=clamp(p.cohesion-2,0,100);result='职位竞争成功：你取得「'+pos.name+'」席位'+(displaced&&displaced!==x.name?'，原任者'+displaced+'被调离。':'。')+'支持你的派系扩大影响，其他派系开始重新结盟。';}
   else{pos.contested=true;x.trust=clamp(x.trust-4,0,100);x.fame=clamp(x.fame-2,0,100);g.loyalty=clamp(g.loyalty-3,0,100);p.cohesion=clamp(p.cohesion-4,0,100);result='你竞争「'+pos.name+'」失败。现任者暂时守住席位，支持你的派系受到牵连。';}
  }else if(kind==='reconcile'){
   var score=(x.trust||0)*.30+(x.fame||0)*.14+(x.skill||0)*.12+g.loyalty*.18+p.cohesion*.12+roleBonus(x,kind)+Math.random()*24;
   if(score>=68){p.cohesion=clamp(p.cohesion+12,0,100);p.factions.forEach(function(f){f.loyalty=clamp(f.loyalty+4,0,100);});x.trust=clamp(x.trust+3,0,100);if(p.split&&p.cohesion>=55){p.split=false;p.splitName='';p.factions=p.factions.filter(function(f){return f.id!=='g_split';});if(p.aligned==='g_split')p.aligned=p.factions[0].id;}result='各派接受共同议事、职位分配与资源协调方案，组织凝聚度明显回升。'+(p.split?' 分裂派同意恢复统一组织。':'');}
   else{p.cohesion=clamp(p.cohesion-4,0,100);x.trust=clamp(x.trust-2,0,100);result='和解谈判未能形成可执行的权力分享方案，各派互相指责，组织凝聚度下降。';}
  }else if(kind==='split'){
   if(p.split){result='组织已经分裂，当前应先通过谈判、资源交换或权力分享推动复合。';noCd=true;}
   else if(p.cohesion<=42||g.support>=58||leader(x)){
    var newId='g_split';var n=2;while(p.factions.some(function(f){return f.id===newId;})){newId='g_split'+n++;}
    var newFaction={id:newId,name:g.name+'分裂派',desc:'由路线分歧、干部任用与资源分配争议形成的独立组织中心。',support:clamp(g.support-12,18,62),loyalty:42,influence:clamp(g.influence-8,12,55),stance:'另立路线'};p.factions.push(newFaction);p.split=true;p.splitName=newFaction.name;p.cohesion=clamp(p.cohesion-14,0,100);g.support=clamp(g.support-8,0,100);newFaction.support=clamp(newFaction.support+12,0,100);p.aligned=newFaction.id;x.power=clamp(x.power+3,0,100);result='组织正式分裂：「'+newFaction.name+'」建立独立决策中心。你转入新派系，获得自主空间，但资源、合法性与跨派协调能力受损。';
   }else{p.cohesion=clamp(p.cohesion-6,0,100);g.loyalty=clamp(g.loyalty-4,0,100);result='你推动路线决裂，但支持不足。组织尚未正式分裂，内部猜疑却进一步加深。';}
  }else if(kind==='succession'){
   var vacancy=p.positions.filter(function(q){return q.id==='chief';})[0]||p.positions[p.positions.length-1];
   var incumbent=leader(x);var chance=Math.max(5,Math.min(95,Math.round((x.power||0)*.22+(x.fame||0)*.12+(x.trust||0)*.18+g.support*.20+g.influence*.13+(x.rank||0)*3+roleBonus(x,kind)-18)));
   if(incumbent){p.succession=clamp(p.succession+10,0,100);p.cohesion=clamp(p.cohesion+3,0,100);result='你主持权力交接程序，推动派系协商继任人选；继承稳定度提高。';}
   else if(p.crisis||!vacancy||vacancy.vacant||p.succession>=40){if(Math.random()*100<chance){if(vacancy){vacancy.incumbent=x.name;vacancy.vacant=false;vacancy.factionId=g.id;}x.isLeader=true;x.internalPolitics.isFactionLeader=true;p.leaderName=x.name;p.succession=clamp(p.succession+18,0,100);x.power=clamp(x.power+8,0,100);x.fame=clamp(x.fame+5,0,100);p.crisis=false;p.factions.forEach(function(f){f.loyalty=clamp(f.loyalty+(f.id===g.id?8:-5),0,100);});result='权力更迭成功：主要派系接受你成为新的最高负责人。旧班底、反对派和地方力量将重新评估忠诚。';}else{p.cohesion=clamp(p.cohesion-8,0,100);x.trust=clamp(x.trust-6,0,100);result='权力交接竞争失败。现有领导集团仍掌握多数支持，你被视为潜在挑战者。';}}
   else{ note('目前没有最高职位空缺或继承危机；只有进入核心层级后才能发起权力交接。');return;}
  }
  if(!noCd)actCool(cdKey,FAC_ACT_DAYS[kind]||60);
  addHistory(p,result);note('【组织政治】'+result);save();draw();openPanel();
 }
 function openPanel(){
  var x=S();if(!x)return;var p=ensure(x),body=document.getElementById('dlgBody');if(!body)return;
  document.getElementById('dlgTag').textContent='组织政治';document.getElementById('dlgTitle').textContent='派系斗争与权力格局';document.getElementById('dlgDesc').textContent='职位不是自动升级：你需要建立支持、争取席位、处理路线冲突，并在继承危机中争取权力。';body.innerHTML='';
  var intro=document.createElement('div');intro.className='constitution-group';intro.innerHTML='<b>组织凝聚度：'+p.cohesion+'/100</b><div class="bar"><i style="width:'+p.cohesion+'%"></i></div><p class="small">'+(p.split?'<span style="color:var(--red)">组织分裂中：存在多个决策中心</span>':'组织目前维持统一')+' · '+(p.crisis?'最高层继承危机':'最高层暂无公开继承危机')+'</p><p class="small">身份：'+esc(ROLE_LABEL[role(x)]||role(x))+' · 当前职位：'+esc(window.rankTitleOf?window.rankTitleOf():'第'+(x.rank||0)+'级')+' · 政治权重：'+Math.round(playerWeight(x))+'</p><p class="small">最高负责人：'+esc(p.leaderName||'尚未明确')+' · 继承稳定度：'+p.succession+'/100</p>';
  body.appendChild(intro);
  var fh=document.createElement('div');fh.className='constitution-group';fh.innerHTML='<b>派系力量</b>';body.appendChild(fh);
  p.factions.slice().sort(function(a,b){return b.support-a.support;}).forEach(function(f){var row=document.createElement('div');row.className='constitution-group';row.innerHTML='<b>'+esc(f.name)+'</b><p class="small">'+esc(f.desc)+'</p><div class="small">支持 '+f.support+' · 影响 '+f.influence+' · 忠诚 '+f.loyalty+(p.aligned===f.id?' · <b>你当前依靠</b>':'')+'</div><div class="bar"><i style="width:'+f.support+'%"></i></div>';
   var join=document.createElement('button');join.className='btn sm';join.textContent=p.aligned===f.id?'当前依靠派系':'转而依靠该派系';join.disabled=p.aligned===f.id||!!actBusy('fac:align');if(p.aligned!==f.id&&actBusy('fac:align'))join.textContent+='（'+actBusyText(actBusy('fac:align'))+'）';join.onclick=function(){if(!actGate('fac:align','转投派系'))return;actCool('fac:align',60);var old=actualGroup(x);old.loyalty=clamp(old.loyalty-4,0,100);p.aligned=f.id;f.loyalty=clamp(f.loyalty+8,0,100);f.support=clamp(f.support+3,0,100);x.power=clamp(x.power+2,0,100);addHistory(p,'你转而依靠「'+f.name+'」，原有盟友关系受到影响。');note('【派系交涉】你转而依靠「'+f.name+'」。');save();draw();openPanel();};row.appendChild(join);body.appendChild(row);});
  var ph=document.createElement('div');ph.className='constitution-group';ph.innerHTML='<b>职位与任免</b><p class="small muted">席位空缺、现任者、所属派系都会影响竞争。职位竞争成功才会实际占据席位。</p>';body.appendChild(ph);
  p.positions.forEach(function(pos){var line=document.createElement('div');line.className='small';var faction=p.factions.filter(function(f){return f.id===pos.factionId;})[0];line.style.margin='7px 0';line.innerHTML='<b>'+esc(pos.name)+'</b>（第'+pos.rank+'级） · '+(pos.vacant?'<span style="color:var(--red)">空缺</span>':'现任：'+esc(pos.incumbent||'未知'))+' · '+esc(faction?faction.name:'未归属');ph.appendChild(line);});
  var actions=document.createElement('div');actions.className='constitution-group';actions.innerHTML='<b>政治行动（每项按天耗时，确认后日历推进）</b>';body.appendChild(actions);
  function btn(label,desc,fn,disabled,key){var bz=key?actBusy(key):null;var b=document.createElement('button');b.className='choice';b.disabled=!!disabled||!!bz;b.innerHTML='<b>'+label+'</b><div class="sub">'+desc+'</div>'+(bz?'<div class="chance" style="color:var(--red)">'+actBusyText(bz)+'</div>':'');b.onclick=fn;actions.appendChild(b);}
  btn('经营派系、扩大支持','召开会议、发展成员、协调资源。不同身份的组织能力不同。',function(){action('organize');},!eligible(x,'organize'),'fac:organize');
  var candidate=p.positions.filter(function(q){var spec=POSITIONS.filter(function(z){return z.id===q.id;})[0];return spec&&spec.roles.indexOf(role(x))>=0&&q.rank<=(x.rank||0)+1&&q.id!=='chief';}).sort(function(a,b){return a.rank-b.rank;})[0];
  btn('竞争职位：'+(candidate?candidate.name:'暂无合适席位'),'挑战现任者或填补空缺；失败会损害信任、声望和组织凝聚。',function(){action('contest',candidate&&candidate.id);},!candidate||!eligible(x,'contest'),'fac:contest');
  btn('协商派系和解','以职位分享、路线妥协和资源分配降低组织分裂风险。',function(){action('reconcile');},!eligible(x,'reconcile'),'fac:reconcile');
  btn(p.split?'巩固分裂派系':'推动组织分裂','分裂可能获得独立路线，但将损失整体资源、协调能力与合法性。',function(){action('split');},!eligible(x,'split')||p.split,'fac:split');
  btn('参与最高权力更迭','需要继承危机、最高职位空缺或较高继承稳定度；领袖可主持交接。',function(){action('succession');},!eligible(x,'succession')||(!leader(x)&&!p.crisis&&p.succession<40&&!p.positions.some(function(q){return q.id==='chief'&&q.vacant;})),'fac:succession');
  var hist=document.createElement('div');hist.className='constitution-group';hist.innerHTML='<b>政治记录</b>'+(p.history.length?p.history.slice(0,10).map(function(h){return '<p class="small">'+h.year+'年：'+esc(h.text)+'</p>';}).join(''):'<p class="small muted">尚无派系政治记录。</p>');body.appendChild(hist);
  var close=document.createElement('button');close.className='btn block';close.textContent='关闭';close.onclick=function(){document.getElementById('mask').classList.add('hidden');};body.appendChild(close);document.getElementById('mask').classList.remove('hidden');
 }
 function tick(){
  var x=S();if(!x)return;var p=ensure(x);if(p.year===x.year)return;p.year=x.year;
  p.factions.forEach(function(f){f.support=clamp(f.support+(Math.random()*3-1.5),0,100);f.influence=clamp(f.influence+(Math.random()*2.4-1.2),0,100);});
  var supports=p.factions.map(function(f){return f.support;}),gap=Math.max.apply(null,supports)-Math.min.apply(null,supports);
  if(gap>38)p.cohesion=clamp(p.cohesion-2,0,100);else if(gap<18&&!p.split)p.cohesion=clamp(p.cohesion+1,0,100);
  // 长期失和、战败/政局变动会让继承危机更容易爆发。
  if(p.cohesion<30&&!p.crisis&&Math.random()<.16){p.crisis=true;p.succession=clamp(p.succession+12,0,100);addHistory(p,'派系长期失和，最高层出现继承与权威危机。');note('【组织危机】派系矛盾扩大，最高层继承安排受到质疑。');}
  if(!p.split&&p.cohesion<22&&Math.random()<.22){var base=actualGroup(x),id='g_split';var n=2;while(p.factions.some(function(f){return f.id===id;}))id='g_split'+n++;var nf={id:id,name:base.name+'分裂派',desc:'因路线、干部任用与资源分配冲突而形成。',support:clamp(base.support-4,20,65),loyalty:38,influence:clamp(base.influence-5,12,60),stance:'另立路线'};p.factions.push(nf);p.split=true;p.splitName=nf.name;addHistory(p,'组织内部矛盾激化，'+nf.name+'建立独立决策中心。');note('【组织分裂】'+nf.name+'形成，原组织的协调能力与资源分配受到冲击。');}
  if(p.split&&p.cohesion>72){p.split=false;p.splitName='';p.factions=p.factions.filter(function(f){return f.id!=='g_split'&&!/^g_split\d+$/.test(f.id);});if(!p.factions.some(function(f){return f.id===p.aligned;}))p.aligned=p.factions[0].id;addHistory(p,'各派重新接受共同议事机制，组织恢复统一。');}
  if(x.year%8===0&&x.rank>=5&&!leader(x)&&!p.crisis){p.succession=clamp(p.succession+2,0,100);}
 }
 function renderCard(){
  var x=S();if(!x)return;var p=ensure(x),main=document.querySelector('#game .main > div');if(!main)return;var card=document.getElementById('cardFactionPolitics');if(!card){card=document.createElement('div');card.className='card';card.id='cardFactionPolitics';main.insertBefore(card,main.children[3]||null);}
  var top=p.factions.slice().sort(function(a,b){return b.support-a.support;}).slice(0,4);
  card.innerHTML='<h2>派系与权力格局</h2><p class="small">组织凝聚 '+p.cohesion+'/100 · '+(p.split?'<span style="color:var(--red)">组织分裂中</span>':'组织统一')+' · '+(p.crisis?'<span style="color:var(--red)">继承危机</span>':'继承稳定度 '+p.succession+'/100')+'</p>'+top.map(function(f){return '<div class="small" style="margin:5px 0"><b>'+esc(f.name)+'</b>　支持 '+f.support+'　影响 '+f.influence+'<div class="bar"><i style="width:'+f.support+'%"></i></div></div>';}).join('')+'<p class="small muted">职位竞争、派系结盟、组织分裂与最高权力交接会持续影响你的政治前途。</p><button class="btn sm primary" id="btnFactionPolitics">进入组织政治</button>';
  var b=document.getElementById('btnFactionPolitics');if(b)b.onclick=openPanel;
 }
 var oldRender=window.__RENDER;window.__RENDER=function(){if(oldRender)oldRender();try{renderCard();}catch(e){}};
 var oldTick=window.__yearTick;window.__yearTick=function(){if(oldTick)oldTick();try{tick();}catch(e){}};
 var oldPersist=persist;persist=function(){var x=S();if(x)ensure(x);return oldPersist.apply(this,arguments);};
 if(S())ensure(S());
})();


/* ================= V4.14：历史事件扩充与西安事变深化 =================
 * 重点：把1936年西安事变做成多方博弈节点，并补充1939、1941、1944年关键事件。
 * 事件仅在角色存活并推进到对应年份时触发；不会让晚于事件年份开局的存档倒退触发。
 */
(function(){
 if(!Array.isArray(EVENTS))return;
 function ev(id){return EVENTS.find(function(e){return e.id===id;});}
 function add(id,o){var e=ev(id);if(e&&e.opts&&!e.opts.some(function(x){return x.id===o.id;}))e.opts.push(o);}
 var xian=ev('xian');
 if(xian){
  xian.who=['kmt','cpc','local','civil','beiyang'];
  xian.d='1936年12月12日，张学良、杨虎城在西安扣留蒋介石，要求停止内战、一致抗日。南京内部出现主战与谈判之争；中共在事变发生后获悉并派周恩来赴西安协商。宋美龄、宋子文随后赴西安斡旋，蒋介石于12月25日获释，张学良随行返宁后被扣留。';
 }
 // 西安事变：把历史中的不同决策中心拆成玩家可参与的多条路径。
 add('xian',{id:'xian_kmt_negotiate',t:'促成南京方面与西安方面谈判',d:'通过宋氏兄妹、地方实力派和中间人士建立沟通，避免军事冲突扩大。',fac:['kmt'],affinity:'trust',req:{trust:34,power:30},risk:1,run:function(x,w){if(w){x.trust+=5;x.power+=5;x.fame+=3;return '你推动双方保持联络，南京方面谈判派获得更多空间。';}x.trust-=4;return '南京内部强硬派占据上风，谈判渠道一度中断。';}});
 add('xian',{id:'xian_kmt_airstrike',t:'支持南京方面军事施压',d:'主张以军事推进迫使西安方面让步；这会显著增加蒋介石遭遇不测、内战扩大和中央分裂的风险。',fac:['kmt'],affinity:'power',req:{power:45,trust:38},risk:1,run:function(x,w){if(w){x.power+=4;x.trust+=2;x.fame-=5;return '军事压力暂时增强，但中央内部裂痕扩大，政治代价沉重。';}x.power-=4;x.trust-=6;return '军事行动受阻，强硬路线反而削弱了你的政治信用。';}});
 add('xian',{id:'xian_cpc_zhou',t:'支持周恩来赴西安开展和平谈判',d:'事变发生后，中共派代表赴西安，争取停止内战、共同抗日，并避免蒋介石被杀或南京大举进攻。',fac:['cpc'],affinity:'skill',req:{skill:38,trust:30},risk:1,run:function(x,w){if(w){x.power+=6;x.fame+=5;x.trust+=4;return '你协助谈判代表沟通各方，和平解决的政治空间扩大。';}x.trust-=3;x.fame-=1;return '各方互疑，谈判进展缓慢，军事压力持续上升。';}});
 add('xian',{id:'xian_cpc_front',t:'公开推动停止内战、一致抗日',d:'通过声明、联络和群众工作争取全国舆论支持，但需避免把事变误判为可以轻易扩大的军事行动。',fac:['cpc'],affinity:'fame',req:{fame:32},run:function(x){x.fame+=5;x.power+=3;return '停止内战、一致抗日的主张得到更多社会关注。';}});
 add('xian',{id:'xian_local_mediator',t:'以地方军政关系居中斡旋',d:'利用地方势力与西安、南京之间的联系，争取停火和谈判时间。',fac:['local','beiyang'],affinity:'power',req:{power:34,trust:32},risk:1,run:function(x,w){if(w){x.power+=5;x.trust+=4;return '地方中间人渠道发挥作用，双方暂缓进一步军事行动。';}x.trust-=4;return '各方怀疑你的真实立场，斡旋未能取得进展。';}});
 add('xian',{id:'xian_local_neutral',t:'保持地方中立并保护交通粮道',d:'避免卷入南京与西安的军事对峙，优先保护辖区居民、铁路和粮食运输。',fac:['local','beiyang'],affinity:'trust',req:{trust:28},run:function(x){x.trust+=3;x.fame+=2;x.cash=Math.max(0,x.cash-4);return '你维持了辖区秩序，但未能左右中央层面的政治谈判。';}});
 add('xian',{id:'xian_civil_petition',t:'组织社会团体呼吁和平抗日',d:'联络学校、商会和报刊，要求停止内战并保障谈判安全。',fac:['civil'],affinity:'fame',req:{fame:28,skill:30},run:function(x){x.fame+=5;x.power+=2;return '社会团体的呼吁扩大了和平解决的舆论压力。';}});
 add('xian',{id:'xian_civil_press',t:'通过报刊核实消息、反对谣言',d:'在消息混乱时尽量区分事实与传闻，避免煽动报复和扩大恐慌。',fac:['civil'],affinity:'skill',req:{skill:34},run:function(x){x.skill+=4;x.fame+=3;return '审慎报道降低了部分社会恐慌，你的公共信誉有所提高。';}});
 // 七类身份在同一事件中承担不同职责，且只有匹配身份的选项才会进入抽签池。
 add('xian',{id:'xian_role_soldier',role:'soldier',t:'以士兵身份执行警戒并避免误伤',d:'守住关键道路和驻地，防止冲突扩大；你不能决定谈判条件，但能影响现场是否失控。',fac:['kmt','cpc','local','beiyang'],affinity:'trust',req:{trust:26},risk:1,run:function(x,w){if(w){x.trust+=4;x.fame+=2;return '你控制了现场纪律，避免了不必要的交火。';}x.health=Math.max(1,(x.health||100)-6);x.trust-=2;return '现场发生混乱，你在冲突中受伤。';}});
 add('xian',{id:'xian_role_officer',role:'officer',t:'以军官身份协调部队停火与警戒线',d:'在命令来源复杂的情况下，核实军令、控制部队行动，避免误判引发交火。',fac:['kmt','cpc','local','beiyang'],affinity:'skill',req:{skill:40,trust:32},risk:1,run:function(x,w){if(w){x.skill+=4;x.trust+=4;x.power+=2;return '部队保持克制，谈判代表获得了必要的安全空间。';}x.trust-=5;x.skill+=1;return '部队协调失败，局部冲突使上级对你产生不满。';}});
 add('xian',{id:'xian_role_official',role:'official',t:'以文官身份拟定停战与政治协商备忘录',d:'整理各方诉求，区分可立即执行的停火安排与需要后续协商的政治承诺。',fac:['kmt','cpc','civil','local'],affinity:'skill',req:{skill:42,power:30},run:function(x){x.skill+=4;x.power+=3;x.trust+=2;return '备忘录使各方诉求更清晰，但最终承诺仍需政治领袖确认。';}});
 add('xian',{id:'xian_role_merchant',role:'merchant',t:'以商人身份维持西安城内粮食与药品供应',d:'协调商号、车队和仓储，避免政治危机演变为民生危机。',fac:['kmt','cpc','local','civil'],affinity:'power',req:{power:28},run:function(x){x.cash=Math.max(0,x.cash-8);x.fame+=4;x.trust+=2;return '粮食和药品供应基本维持，你的商号获得社会信任，但承担了额外成本。';}});
 add('xian',{id:'xian_role_student',role:'student',t:'以学生身份发起停止内战、救亡图存的请愿',d:'组织校园讨论和公开请愿，推动各方把抗日与民生置于党派冲突之上。',fac:['civil','kmt','cpc'],affinity:'fame',req:{fame:28,skill:30},run:function(x){x.fame+=5;x.power+=3;x.trust-=1;return '请愿活动扩大了青年舆论影响，也使你受到当局关注。';}});
 add('xian',{id:'xian_role_activist',role:'activist',t:'以社会活动家身份保护难民与政治受牵连者',d:'组织临时救助、联络家属并劝阻报复行动。',fac:['civil','kmt','cpc','local'],affinity:'fame',req:{fame:30,power:28},run:function(x){x.fame+=4;x.trust+=3;x.cash=Math.max(0,x.cash-5);return '救助网络在紧张局势中发挥作用，地方社会对你的信任上升。';}});
 add('xian',{id:'xian_role_leader',role:'leader',t:'以最高决策者身份主持全国性停战与抗日协商',d:'尝试把西安事变转化为全国政治谈判，处理军队指挥、政治承诺与各方安全保障。',fac:['kmt','cpc','local','beiyang'],affinity:'power',req:{power:52,trust:45,skill:42},risk:1,run:function(x,w){if(w){x.power+=6;x.fame+=5;x.trust+=4;return '你推动形成跨阵营协商框架，暂时降低了全国性内战风险。';}x.power-=5;x.trust-=5;return '各方拒绝接受你的安排，中央权威与个人声望同时受损。';}});
 // 西安事变后果：张学良随蒋返宁后遭长期扣留，避免把“获释”误写成政治自由。
 add('xian',{id:'xian_aftermath',t:'就张学良返宁后的处置提出意见',d:'蒋介石于12月25日获释；张学良随行返南京后被扣留。你可主张审慎处理、公开审判或长期软禁，三者会影响国民党内部与东北军关系。',fac:['kmt','local','civil'],affinity:'trust',req:{power:36,trust:35},risk:1,run:function(x,w){if(w){x.trust+=3;x.fame+=2;return '你主张依法与审慎处置，暂时缓和了部分东北军将领的不满。';}x.trust-=4;x.power-=2;return '处置争议加深，相关军政关系继续恶化。';}});
 // 新增1939年长沙会战（第一、二、三次长沙会战中的首战发生于1939年）。
 if(!ev('changsha39'))EVENTS.push({id:'changsha39',y:1939,t:'第一次长沙会战',who:['kmt','cpc','local','civil'],d:'日军进攻长沙方向，国民政府军在湘北组织防御与反击。战场胜负、城市居民疏散和交通补给都影响战局。',opts:[
  {id:'cs39_defend',t:'组织湘北纵深防御',d:'依托地形和交通节点迟滞日军。',fac:['kmt','local'],affinity:'skill',req:{skill:38},risk:1,run:function(x,w){if(w){x.skill+=5;x.fame+=4;x.trust+=3;return '防线组织较为有序，部队争取到反击时间。';}x.skill+=2;x.health=Math.max(1,(x.health||100)-5);return '防线承压，部队付出较大代价。';}},
  {id:'cs39_supply',t:'保障军粮、医疗与道路运输',d:'把重点放在持续作战能力和伤员救治。',fac:['local','civil','kmt'],affinity:'power',req:{power:28},run:function(x){x.fame+=4;x.trust+=3;x.cash=Math.max(0,x.cash-6);return '补给与救护网络维持运转，前线得到持续支援。';}},
  {id:'cs39_cpc',t:'开展敌后联络与情报协作',d:'在敌后开展交通、情报和群众联络工作。',fac:['cpc'],affinity:'skill',req:{skill:35},run:function(x){x.skill+=4;x.power+=3;return '敌后联络为战区提供了部分情报与交通支持。';}},
  {id:'cs39_civil',t:'组织居民疏散与临时救济',d:'避免平民被卷入战火，保护医院、学校和难民。',fac:['civil','local'],affinity:'fame',req:{fame:28},run:function(x){x.fame+=5;x.cash=Math.max(0,x.cash-4);return '居民得到有序疏散，地方社会网络发挥了作用。';}}
 ]});
 // 1941年皖南事变：作为国共关系急剧恶化的重要节点。
 if(!ev('newfourth41'))EVENTS.push({id:'newfourth41',y:1941,t:'皖南事变与国共关系危机',who:['kmt','cpc','local','civil'],d:'新四军军部及所属部队在皖南遭国民政府军围攻，国共关系急剧恶化。停战、交涉、军队整编与政治宣传成为各方争议焦点。',opts:[
  {id:'nf41_negotiate',t:'推动双方恢复军事联络与政治交涉',d:'避免局部冲突升级为全面破裂。',fac:['kmt','cpc'],affinity:'trust',req:{trust:38,power:32},risk:1,run:function(x,w){if(w){x.trust+=4;x.power+=3;return '双方保留了部分交涉渠道，但政治互信仍然脆弱。';}x.trust-=5;return '交涉受阻，双方宣传与军事对峙进一步升级。';}},
  {id:'nf41_reorg',t:'接受军队整编与指挥权谈判',d:'围绕番号、驻地、补给和指挥权寻求妥协。',fac:['kmt','cpc'],affinity:'power',req:{power:42,skill:35},risk:1,run:function(x,w){if(w){x.power+=4;x.trust+=2;return '军队整编问题获得有限技术性进展。';}x.power-=3;x.trust-=4;return '双方无法接受对方条件，整编谈判破裂。';}},
  {id:'nf41_local',t:'保护地方居民并维持交通补给',d:'避免冲突地区出现报复、断粮和难民潮。',fac:['local','civil'],affinity:'fame',req:{fame:30},run:function(x){x.fame+=4;x.trust+=3;x.cash=Math.max(0,x.cash-5);return '地方救助网络减轻了居民损失，但政治危机仍未解决。';}},
  {id:'nf41_press',t:'公开调查事件经过并呼吁克制',d:'核实伤亡、命令和交涉过程，减少谣言与报复动员。',fac:['civil'],affinity:'skill',req:{skill:40},run:function(x){x.skill+=3;x.fame+=4;return '调查材料引发社会关注，双方都面临舆论压力。';}}
 ]});
 // 1944年豫湘桂会战：军事崩溃与后方治理并重。
 if(!ev('ichigo44'))EVENTS.push({id:'ichigo44',y:1944,t:'豫湘桂会战与战局危机',who:['kmt','local','civil','cpc'],d:'日军发动大规模攻势，国民政府军在河南、湖南、广西等地遭遇严重挫折，交通线、空军基地与地方治理受到冲击。',opts:[
  {id:'ichi44_redeploy',t:'调整部署，保存有生力量',d:'避免无序溃退，优先保留可重建的部队。',fac:['kmt','local'],affinity:'skill',req:{skill:42,trust:34},risk:1,run:function(x,w){if(w){x.skill+=4;x.trust+=3;return '部队有序转移，保留了部分骨干力量。';}x.fame-=3;x.trust-=4;return '撤退混乱，部队与地方社会都遭受损失。';}},
  {id:'ichi44_supply',t:'保护难民、粮仓与交通枢纽',d:'将民生和后勤放在首位，减少战区次生灾害。',fac:['civil','local','kmt'],affinity:'fame',req:{fame:32,power:28},run:function(x){x.fame+=5;x.trust+=2;x.cash=Math.max(0,x.cash-7);return '难民安置和粮食转运有所改善，地方仍承受巨大压力。';}},
  {id:'ichi44_guerrilla',t:'组织敌后破袭与情报支援',d:'利用地方网络袭扰交通、传递情报并协助群众转移。',fac:['cpc','local'],affinity:'power',req:{power:34,skill:32},run:function(x){x.power+=4;x.skill+=3;return '敌后网络为交通破袭和居民转移提供支援。';}},
  {id:'ichi44_review',t:'推动战后军政责任调查',d:'记录指挥、补给和征调问题，为战后整顿保留依据。',fac:['civil','kmt'],affinity:'skill',req:{skill:48},run:function(x){x.skill+=4;x.fame+=3;return '调查档案逐步形成，军政系统面临改革压力。';}}
 ]});
 // 抗战胜利后，增加重庆谈判、军队整编与社会复员等选项。
 add('1945',{id:'v414_chongqing',t:'推动重庆谈判与政治协商',d:'围绕和平建国、政治改革、军队整编与地方权力安排展开谈判。',fac:['kmt','cpc','civil','local'],affinity:'trust',req:{trust:38,power:35},risk:1,run:function(x,w){if(w){x.power+=5;x.fame+=4;x.trust+=3;return '政治协商取得阶段性进展，但军队与地方权力问题仍未解决。';}x.trust-=4;return '双方互不信任，谈判难以形成可执行安排。';}});
 add('1945',{id:'v414_demob',t:'优先复员军队、安置难民与恢复生产',d:'把战时动员转入和平时期，处理军人就业、交通修复和难民返乡。',fac:['kmt','cpc','local','civil'],affinity:'fame',req:{fame:32,skill:32},run:function(x){x.fame+=4;x.skill+=3;x.cash=Math.max(0,x.cash-8);return '复员和生产恢复启动，但财政与就业压力仍然很大。';}});
 add('1945',{id:'v414_army_nationalize',t:'推动军队国家化与统一指挥',d:'尝试把各派军队纳入统一编制、预算和文官监督。',fac:['kmt','cpc','local'],affinity:'power',req:{power:48,trust:42,skill:38},risk:1,run:function(x,w){if(w){x.power+=5;x.trust+=3;return '军队整编获得有限进展，仍需解决实际控制权与军饷来源。';}x.trust-=5;x.power-=2;return '各方不愿交出军权，统一指挥方案受挫。';}});
})();


/* ================= V4.15：连续历史事件、多分支因果与动态世界状态 =================
 * 以西安事变为关键分水岭，串联1937—1948年的战争、合作、社会与战后政治进程。
 * 历史链状态和世界指标写入存档；所有效果为游戏抽象模型，不宣称历史必然如此。
 */
(function(){
 if(!Array.isArray(EVENTS))return;
 function event(id){return EVENTS.find(function(e){return e.id===id;});}
 function add(id,o){var e=event(id);if(e&&e.opts&&!e.opts.some(function(x){return x.id===o.id;}))e.opts.push(o);}
 function clampN(v,a,b){return Math.max(a,Math.min(b,Number(v)||0));}
 function ensure(x){
  if(!x)return null;
  if(!x.historyChain||typeof x.historyChain!=='object')x.historyChain={};
  var h=x.historyChain;
  if(!h.flags||typeof h.flags!=='object')h.flags={};
  if(!h.outcomes||typeof h.outcomes!=='object')h.outcomes={};
  if(!h.log||!Array.isArray(h.log))h.log=[];
  if(!h.world||typeof h.world!=='object')h.world={};
  var w=h.world, defaults={stability:52,economy:42,warPressure:28,diplomacy:32,socialCohesion:50,international:30,lastYear:x.year||1840};
  Object.keys(defaults).forEach(function(k){if(w[k]===undefined||!isFinite(Number(w[k])))w[k]=defaults[k];});
  ['stability','economy','warPressure','diplomacy','socialCohesion','international'].forEach(function(k){w[k]=clampN(w[k],0,100);});
  w.lastYear=Math.max(1840,Math.floor(Number(w.lastYear)||Number(x.year)||1840));
  h.log=h.log.filter(function(a){return a&&typeof a==='object';}).slice(0,30);
  if(!x.natl)x.natl={稳定:62,经济:38,军事:45,财政:40,秩序:55,民心:50,国际:30,工业:15};
  return h;
 }
 function has(k){return !!(s&&s.historyChain&&s.historyChain.flags[k]);}
 function note(t){if(!s)return;var h=ensure(s);h.log.unshift({year:s.year,text:t});h.log=h.log.slice(0,30);if(typeof log==='function')log('【历史进程】'+t);}
 function setFlag(k,v){var h=ensure(s);if(h)h.flags[k]=v===undefined?true:v;}
 function markChoice(ev,o,success){
  if(!s||!ev||!o)return;var id=String(ev.id||''),oid=String(o.id||''),title=String(o.t||'');
  var h=ensure(s);h.outcomes[id]={option:oid,title:title,year:s.year,success:success!==false};
  if(id==='xian'){
   // 只有真正推动停战/谈判且执行成功的选择，才能解锁“和平解决”后续链。
   // 现场警戒、民生供应、地方中立和事后处置不等于政治谈判成功。
   var peace=['xian_kmt_negotiate','xian_cpc_zhou','xian_cpc_front','xian_local_mediator','xian_civil_petition','xian_role_officer','xian_role_official','xian_role_student','xian_role_leader'];
   if(peace.indexOf(oid)>=0&&success!==false){
    setFlag('xian_peace');h.world.warPressure-=8;h.world.diplomacy+=7;h.world.socialCohesion+=4;
    if(s.altHistory)s.altHistory.peace=(s.altHistory.peace||0)+2;
    note('西安事变的停战与谈判努力取得进展，停止内战与共同抗日获得政治空间；双方互信仍需后续维系。');
   }else if(oid==='xian_kmt_airstrike'||title==='武力讨伐'){
    setFlag('xian_hardline');h.world.warPressure+=12;h.world.diplomacy-=6;h.world.socialCohesion-=7;
    note('西安事变走向强硬对抗，军事冲突与中央分裂风险上升。');
   }else{
    setFlag('xian_unresolved');h.world.warPressure+=success===false?5:3;h.world.diplomacy-=success===false?4:2;
    note(success===false?'西安事变中的谈判或协调未能奏效，政治安排仍未形成，后续合作存在较大不确定性。':'你采取了现场、民生或中立行动，但这不足以单独构成政治和解；后续合作仍存在不确定性。');
   }
  }
  if(id==='q7'){
   if(oid==='chain_1937_united'){setFlag('united_front');h.world.warPressure-=5;h.world.socialCohesion+=6;h.world.diplomacy+=4;note('第二次国共合作与抗日民族统一战线进入制度化协作阶段。');}
   if(oid==='chain_1937_parallel'){setFlag('parallel_command');h.world.warPressure+=3;h.world.socialCohesion-=2;note('各方保留独立指挥体系，协作有限，战区协调成本上升。');}
   if(oid==='chain_1937_refuse'){setFlag('front_fracture');h.world.warPressure+=9;h.world.socialCohesion-=8;h.world.diplomacy-=5;note('政治妥协空间收窄，抗战协作受到内部冲突牵制。');}
  }
  if(id==='wuhan'){
   if(oid==='chain_1938_joint'){setFlag('wartime_coordination');h.world.socialCohesion+=4;h.world.warPressure-=2;note('跨区域战区协调网络形成，撤退、补给和情报开始共享。');}
   if(oid==='chain_1938_local'){setFlag('wartime_fragmented');h.world.socialCohesion-=3;note('战区各自为战，地方自主性提高，但整体调度效率下降。');}
  }
  if(id==='newfourth41'){
   if(oid==='chain_1941_channel'&&success!==false){setFlag('皖南后续缓和');h.world.diplomacy+=5;h.world.socialCohesion+=3;h.world.warPressure-=2;note('皖南事变后仍保留军事与政治联络渠道，危机未立即消失，但扩大冲突受到抑制。');}
   else if(oid==='chain_1941_channel'){setFlag('皖南后续恶化');h.world.diplomacy-=4;h.world.warPressure+=4;note('保留联络渠道的尝试失败，皖南事变后的交涉空间进一步收窄。');}
   if(oid==='chain_1941_escalate'){setFlag('皖南后续恶化');h.world.diplomacy-=7;h.world.socialCohesion-=6;h.world.warPressure+=6;note('皖南事变后交涉渠道中断，国共关系进一步恶化。');}
  }
  if(id==='1945'){
   if(oid==='chain_1945_framework'&&success!==false){setFlag('postwar_talks');h.world.diplomacy+=8;h.world.stability+=4;h.world.warPressure-=5;note('战时协商经验被带入重庆谈判，和平建国与军队整编进入议程。');}
   else if(oid==='chain_1945_framework'){setFlag('postwar_talks_failed');h.world.diplomacy-=4;h.world.warPressure+=3;note('重庆谈判框架未能落实，政治互信与执行机制仍然不足。');}
   if(oid==='chain_1945_power'){setFlag('postwar_power_first');h.world.warPressure+=5;h.world.stability-=3;note('各方优先争取军政控制权，战后谈判的互信基础变弱。');}
  }
  if(id==='civilwar46'){
   if(oid==='chain_1946_implement'&&success!==false){setFlag('ceasefire_implemented');h.world.warPressure-=12;h.world.stability+=7;h.world.economy+=4;note('停战监督、交通恢复与联合整编开始落实，全面内战风险下降。');}
   else if(oid==='chain_1946_implement'){setFlag('ceasefire_failed');h.world.warPressure+=8;h.world.stability-=4;h.world.economy-=3;note('停战监督与整编协议未能执行，地方冲突重新升级。');}
   if(oid==='chain_1946_breakdown'){setFlag('ceasefire_failed');h.world.warPressure+=12;h.world.stability-=7;h.world.economy-=5;note('停战与整编协议破裂，冲突扩大，经济与社会承压。');}
  }
  if(id==='campaign48'){
   if(oid==='chain_1948_negotiated'&&success!==false){setFlag('1948_local_truce');h.world.warPressure-=8;h.world.socialCohesion+=4;note('局部停火与城市保护安排形成，战局出现谈判窗口。');}
   else if(oid==='chain_1948_negotiated'){setFlag('1948_talks_failed');h.world.warPressure+=4;h.world.socialCohesion-=2;note('城市停火与交接谈判未能约束前线，战局继续恶化。');}
   if(oid==='chain_1948_decisive'){setFlag('1948_decisive_battle');h.world.warPressure+=5;note('各方押注军事决战，短期战局变化加快，社会成本也同步增加。');}
  }
  ['stability','economy','warPressure','diplomacy','socialCohesion','international'].forEach(function(k){h.world[k]=clampN(h.world[k],0,100);});
 }

 // 1937：西安事变的处理方式影响第二次国共合作的深度。
 add('q7',{id:'chain_1937_united',t:'落实第二次国共合作与抗日民族统一战线',d:'承接西安事变和平解决后的政治承诺，推动红军改编、战区协作、情报联络与社会动员。',fac:['kmt','cpc','local','civil'],affinity:'trust',req:{trust:34,power:30},cond:function(){return has('xian_peace')&&!has('xian_hardline');},run:function(x){x.trust+=4;x.fame+=4;x.power+=3;return '你参与推动合作机制落地，统一战线扩大，但军事指挥与政治互信仍需磨合。';}});
 add('q7',{id:'chain_1937_parallel',t:'保留各自指挥体系，建立有限战区联络',d:'不强求统一指挥，先从战区联络、交通协作和伤员救治入手。',fac:['kmt','cpc','local','civil'],affinity:'skill',req:{skill:34},cond:function(){return has('xian_peace')||has('xian_unresolved');},run:function(x){x.skill+=4;x.trust+=2;return '各方建立有限协作，降低了前线摩擦，但统一调度能力有限。';}});
 add('q7',{id:'chain_1937_refuse',t:'拒绝政治妥协，优先处理内部军事对抗',d:'把内部安全置于跨阵营协作之前，短期强化本方控制，长期可能削弱抗战合力。',fac:['kmt','cpc'],affinity:'power',req:{power:42,trust:36},cond:function(){return has('xian_hardline');},risk:1,run:function(x,w){if(w){x.power+=3;x.trust+=2;return '你巩固了本方控制，但跨阵营协作空间进一步缩小。';}x.power-=3;x.trust-=5;return '内部对抗消耗资源，前线协作更加困难。';}});

 // 1938：武汉会战的战区协调和撤退方案，承接1937年的合作深度。
 add('wuhan',{id:'chain_1938_joint',t:'建立跨阵营战区协调与联合后勤机制',d:'在武汉会战压力下共享交通情报、伤员转运和物资节点，减少重复征调。',fac:['kmt','cpc','local','civil'],affinity:'skill',req:{skill:40,trust:34},cond:function(){return has('united_front')||has('parallel_command');},run:function(x){x.skill+=4;x.fame+=3;x.trust+=3;return '跨区域联络网帮助部队与居民有序转移，后勤效率有所提高。';}});
 add('wuhan',{id:'chain_1938_local',t:'优先保障地方自治与居民撤离',d:'在中央协调不足时，依靠地方政府、商会和社会团体组织疏散与物资转运。',fac:['local','civil','kmt'],affinity:'fame',req:{fame:30},cond:function(){return has('front_fracture')||has('parallel_command');},run:function(x){x.fame+=4;x.trust+=2;x.cash=Math.max(0,x.cash-5);return '地方社会网络承担更多责任，居民疏散改善，但跨区协调仍有缺口。';}});

 // 1939长沙会战：把1938年形成的组织能力转化为前线与民生韧性。
 add('changsha39',{id:'chain_1939_network',t:'沿用战区联络网组织湘北补给与居民疏散',d:'如果此前建立跨阵营或地方协作网络，可把它用于粮运、医疗和交通修复。',fac:['kmt','cpc','local','civil'],affinity:'skill',req:{skill:36},cond:function(){return has('wartime_coordination')||has('wartime_fragmented')||has('united_front');},run:function(x){x.skill+=3;x.fame+=4;x.trust+=2;return '既有联络网络帮助前线补给与居民疏散，但战区仍承受持续压力。';}});

 // 1941皖南事变：并非自动和解，只有满足条件才有缓和路线。
 add('newfourth41',{id:'chain_1941_channel',t:'保留危机联络渠道，建立事件调查与停火机制',d:'西安事变后的合作基础若仍存在，可尝试通过第三方联络、事件调查和战区停火机制避免全面破裂。',fac:['kmt','cpc','civil','local'],affinity:'trust',req:{trust:42,power:34},cond:function(){return has('united_front')&&!has('front_fracture');},risk:1,run:function(x,w){if(w){x.trust+=4;x.power+=2;return '双方同意保留部分联络渠道，局势暂时缓和，但历史矛盾没有消失。';}x.trust-=4;return '调查与停火安排未能取得共识，危机继续发酵。';}});
 add('newfourth41',{id:'chain_1941_escalate',t:'中断联络并采取强硬宣传与军事部署',d:'若此前合作脆弱或西安事变走向强硬，双方可能把对方视为主要安全威胁。',fac:['kmt','cpc'],affinity:'power',req:{power:38},cond:function(){return has('xian_hardline')||has('front_fracture')||has('皖南后续恶化');},run:function(x){x.power+=2;x.trust-=4;x.fame-=1;return '本方控制短期加强，但共同抗战的政治协作进一步受损。';}});

 // 1942：河南灾荒将战时治理能力转化为真实的社会后果。
 add('henan42',{id:'chain_1942_relief',t:'启动跨地区粮食、运输与医疗救济网络',d:'此前的战区协调、地方自治或商贸运输网络可以转为灾荒救济。',fac:['kmt','cpc','local','civil'],affinity:'fame',req:{fame:32,skill:34},cond:function(){return has('wartime_coordination')||has('merchant_network')||has('official_relief')||has('wartime_mobilization');},run:function(x){x.fame+=5;x.trust+=3;x.cash=Math.max(0,x.cash-8);if(x.natl){x.natl.民心+=3;x.natl.秩序+=2;}return '粮食与医疗救济网络投入灾区，缓解部分次生灾害，但资源缺口仍然巨大。';}});

 // 1945：战时协作和危机处置方式决定谈判起点。
 add('1945',{id:'chain_1945_framework',t:'沿用战时协商框架推动政治协商与联合政府',d:'若此前合作与联络网络保存下来，可把共同抗战时期的政治沟通转化为战后谈判机制。',fac:['kmt','cpc','local','civil'],affinity:'trust',req:{trust:40,power:36},cond:function(){return has('united_front')&&!has('front_fracture')&&!has('皖南后续恶化');},risk:1,run:function(x,w){if(w){x.power+=5;x.trust+=4;x.fame+=3;return '双方同意继续政治协商，军队整编与地方自治进入正式议程。';}x.trust-=4;return '协商机制未能恢复，双方对彼此意图仍然疑虑重重。';}});
 add('1945',{id:'chain_1945_power',t:'优先争取战略要地、军队与接收权',d:'若战时合作已经破裂，各方更可能把接收、军队和交通控制视为首要任务。',fac:['kmt','cpc','local'],affinity:'power',req:{power:40},cond:function(){return has('front_fracture')||has('皖南后续恶化')||has('xian_hardline');},run:function(x){x.power+=3;x.trust-=2;return '接收与军队部署加快，但地方冲突和战后政治互信问题加重。';}});

 // 1946—1948：把谈判、停战与内战走向纳入条件分支。
 add('civilwar46',{id:'chain_1946_implement',t:'落实停战监督、交通恢复与军队整编协议',d:'若重庆谈判和战时协作留下制度基础，尝试执行停战令、恢复交通并建立联合监督。',fac:['kmt','cpc','local','civil'],affinity:'trust',req:{trust:45,power:38,skill:36},cond:function(){return has('postwar_talks')||has('united_front');},risk:1,run:function(x,w){if(w){x.trust+=4;x.fame+=3;if(x.natl){x.natl.稳定+=4;x.natl.经济+=2;}return '停战监督和交通恢复取得进展，全面内战并非唯一可能。';}x.trust-=5;return '执行机制遭到破坏，地方冲突重新升级。';}});
 add('civilwar46',{id:'chain_1946_breakdown',t:'拒绝共同监督，转入全面军事竞争',d:'如果战后政治协商缺乏基础，或停战执行失败，各方可能重新以军事手段争夺主导权。',fac:['kmt','cpc'],affinity:'power',req:{power:38},cond:function(){return has('postwar_power_first')||has('ceasefire_failed')||has('front_fracture');},run:function(x){x.power+=3;x.trust-=3;if(x.natl)x.natl.稳定-=3;return '军事竞争加剧，政治谈判空间进一步收窄。';}});
 add('campaign48',{id:'chain_1948_negotiated',t:'推动重点城市停火与区域政治谈判',d:'若此前停战机制仍然存在，可争取城市保护、战俘交换和地方交接安排。',fac:['kmt','cpc','local','civil'],affinity:'trust',req:{trust:48,power:40},cond:function(){return has('ceasefire_implemented')||has('postwar_talks');},risk:1,run:function(x,w){if(w){x.trust+=4;x.fame+=3;if(x.natl){x.natl.稳定+=4;x.natl.民心+=3;}return '部分地区形成停火与交接安排，战后政治重组出现谈判空间。';}x.trust-=4;return '地方谈判未能约束前线，各方继续争夺战略主动。';}});
 add('campaign48',{id:'chain_1948_decisive',t:'集中力量进行战略决战',d:'当停战机制失效时，军事决战成为各方更可能采取的路径。',fac:['kmt','cpc','local'],affinity:'skill',req:{skill:40,power:38},cond:function(){return has('ceasefire_failed')||has('postwar_power_first')||has('front_fracture');},risk:1,run:function(x,w){if(w){x.skill+=4;x.power+=3;return '军事部署取得阶段性成果，但社会与财政成本仍然沉重。';}x.trust-=4;x.fame-=2;return '决战受挫，军队和地方社会都付出代价。';}});

 // 世界状态每年变化：以国家指标、历史分支和战争阶段共同驱动。
 function annualWorld(){
  if(!s)return;var h=ensure(s),w=h.world,n=s.natl||{},year=Number(s.year)||1840;
  if(Number(w.lastYear)===year)return;
  var prev=Number(w.lastYear)||year-1,steps=Math.max(1,Math.min(5,year-prev));
  for(var i=0;i<steps;i++){
   var y=prev+i+1;
   var warBase=(y>=1931&&y<=1945)?1.1:((y>=1946&&y<=1949)?1.5:0.05);
   var peaceBonus=has('united_front')?-.45:0;
   if(has('front_fracture')||has('皖南后续恶化'))peaceBonus+=.65;
   if(has('ceasefire_implemented'))peaceBonus-=.8;
   if(has('ceasefire_failed')||has('postwar_power_first'))peaceBonus+=.8;
   w.warPressure=clampN(w.warPressure+warBase+peaceBonus,0,100);
   var natSt=(Number(n.稳定)||50),natEco=(Number(n.经济)||40),natPe=(Number(n.民心)||50),natIntl=(Number(n.国际)||30);
   w.stability=clampN(w.stability+(natSt-50)*.025+(has('postwar_talks')?.12:0)-(w.warPressure-45)*.012,0,100);
   w.economy=clampN(w.economy+(natEco-40)*.025-(w.warPressure-35)*.018+(has('wartime_coordination')?.08:0),0,100);
   w.diplomacy=clampN(w.diplomacy+(natIntl-30)*.02+(has('xian_peace')?.12:0)-(has('xian_hardline')?.12:0),0,100);
   w.socialCohesion=clampN(w.socialCohesion+(natPe-50)*.02+(has('united_front')?.1:0)-(has('front_fracture')?.13:0),0,100);
   w.international=clampN(w.international+(natIntl-30)*.018+(y>=1942&&y<=1945?.15:0),0,100);
  }
  w.lastYear=year;
  // 世界局势反向影响国家指标，避免它只是一组装饰数字。
  if(s.natl){
   if(w.stability<28)s.natl.秩序=clampN((s.natl.秩序||50)-1,0,100);
   if(w.economy<25)s.natl.财政=clampN((s.natl.财政||40)-1,0,100);
   if(w.socialCohesion>68&&year>=1937)s.natl.民心=clampN((s.natl.民心||50)+1,0,100);
   if(w.warPressure>72&&year>=1937&&year<=1949)s.natl.经济=clampN((s.natl.经济||40)-1,0,100);
  }
  // 只对世界力量做小幅趋势修正，保留原有 advanceWorld 的地区控制模拟。
  if(world&&world.powers){
   var p=world.powers;
   if(p.kmt&&typeof p.kmt.v==='number')p.kmt.v=clampN(p.kmt.v+(w.stability-50)*.006,0,100);
   if(p.cpc&&typeof p.cpc.v==='number')p.cpc.v=clampN(p.cpc.v+(w.socialCohesion-50)*.006,0,100);
   if(p.local&&typeof p.local.v==='number')p.local.v=clampN(p.local.v+(50-w.stability)*.004,0,100);
  }
  if(year===1937||year===1941||year===1945||year===1946||year===1949||year===1972){
   note('世界状态更新：稳定 '+Math.round(w.stability)+'、经济韧性 '+Math.round(w.economy)+'、战争压力 '+Math.round(w.warPressure)+'、外交空间 '+Math.round(w.diplomacy)+'、社会凝聚 '+Math.round(w.socialCohesion)+'。');
  }
 }
 function renderWorldCard(){
  if(!s)return;var h=ensure(s),w=h.world,main=document.querySelector('#game .main > div');if(!main)return;
  var card=document.getElementById('cardDynamicWorld');if(!card){card=document.createElement('div');card.className='card';card.id='cardDynamicWorld';main.insertBefore(card,main.children[4]||null);}
  function meter(label,val){val=Math.round(clampN(val,0,100));return '<div class="small" style="display:flex;align-items:center;gap:8px;margin:6px 0"><span style="width:78px">'+label+'</span><span class="bar" style="flex:1"><i style="width:'+val+'%"></i></span><b style="width:28px;text-align:right">'+val+'</b></div>';}
  var recent=h.log.slice(0,3).map(function(a){return '<p class="small">'+a.year+'年：'+String(a.text).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];})+'</p>';}).join('');
  card.innerHTML='<h2>动态世界局势</h2><p class="small muted">世界指标会随你的历史选择、国家治理与年代环境逐年变化，并反向影响国家指标。</p>'+meter('政治稳定',w.stability)+meter('经济韧性',w.economy)+meter('战争压力',w.warPressure)+meter('外交空间',w.diplomacy)+meter('社会凝聚',w.socialCohesion)+meter('国际环境',w.international)+'<div class="constitution-group"><b>近期历史因果</b>'+(recent||'<p class="small muted">尚无重大分支记录。</p>')+'</div>';
 }
 var oldChoose=chooseEvent;
 chooseEvent=function(ev,o){
  if(!ev||!o)return oldChoose(ev,o);
  var original=o.run;
  if(typeof original==='function')o.run=function(x,w){var result=original(x,w);markChoice(ev,o,w!==false);return result;};
  try{return oldChoose(ev,o);}finally{if(typeof original==='function')o.run=original;}
 };
 var oldTick=window.__yearTick;
 window.__yearTick=function(){if(oldTick)oldTick();try{annualWorld();}catch(e){}};
 var oldRender=window.__RENDER;
 window.__RENDER=function(){if(oldRender)oldRender();try{renderWorldCard();}catch(e){}};
 var oldPersist=persist;
 persist=function(){if(s)ensure(s);return oldPersist.apply(this,arguments);};
 var oldApplySave=applySave;
 applySave=function(d){var r=oldApplySave.apply(this,arguments);try{ensure(s);}catch(e){}return r;};
 if(s)ensure(s);
})();

/* ================= V4.17：实时日历推进 / V4.18：行动冷却界面 =================
   一个时钟、一个循环：按真实流逝的毫秒累积，逐日推进（绝不跳日、绝不重复）。
   每日：持续行动结算、到期历史事件；每月 1 日：自动存档与月度钩子；
   每年 12 月 31 日结束：年度结算（lastSettledYear 保证每年只结算一次）并弹出年度报告；
   1972 年 12 月 31 日结束：最终历史结算，时钟停止。 */
var CLOCK={speed:0,acc:0,last:0,timer:null,settling:false,evOrd:null,wasBlocked:false,needRender:false,uiOrd:null,uiAt:0,pauseReason:''};
var SPEED_DPS=[0,1,5,20];              /* 每真实秒推进的游戏日数 */
var SPEED_NAME=['暂停','正常','快速','极速'];
var IMPORTANT_TAGS=['【内乱】','【开战】','【战果】','【身故】','【组织危机】','【组织分裂】','【失地】','【和约】','【败绩】','【战后路线判定】','【结局】'];

function calSnap(){
 if(!s) return null;
 var N=s.natl||{}, n={};
 NAT_KEYS.forEach(function(k){ n[k[0]]=Math.round(+N[k[0]]||0); });
 return {y:s.year,natl:n,cash:Math.round(+s.cash||0),skill:+s.skill||0,fame:+s.fame||0,power:+s.power||0,trust:+s.trust||0,
  rank:+s.rank||0,alt:+s.alt||0,troops:(s.unit&&+s.unit.troops)||0,
  title:(window.rankTitleOf?window.rankTitleOf():((FAC[s.faction]||{}).ladder||[])[s.rank]||'')};
}
function logText(html){ return String(html||'').replace(/<[^>]+>/g,'').replace(/^\s+/,''); }
/* 时钟补齐（新开局、读档、旧档迁移都会走到这里） */
function calInitState(fresh){
 if(!s) return;
 var had=!!(s.cal&&typeof s.cal.ord==='number');
 if(fresh){ s.cal=null; s.cooldowns={}; s.jobs=[]; s.histRec=[]; s.yearReports=[]; }
 calEnsure(s);
 if(!Array.isArray(s.histRec)) s.histRec=[];
 if(!Array.isArray(s.yearReports)) s.yearReports=[];
 if(!s.cal.yearSnap||s.cal.yearSnap.y!==s.year) s.cal.yearSnap=calSnap();
 if(s.cal.finished&&s.cal.finalEnding) s.ending=s.cal.finalEnding;
 return had;
}

/* ---------- 年度结算（每年只执行一次） ---------- */
function calYearEnd(Y){
 if(!s||s.dead) return false;
 if(s.cal.lastSettledYear>=Y) return false;   /* 重复调用直接忽略 */
 s.cal.lastSettledYear=Y;                       /* 先落标记，即使后续某个钩子出错也不会重算 */
 var snap=s.cal.yearSnap||calSnap();
 var head=s.logs[0];
 CLOCK.settling=true;
 try{ advance(); }catch(e){}
 finally{ CLOCK.settling=false; }
 if(s.dead){ return true; }
 if(s.year!==Y+1) s.year=Y+1;                  /* 年份镜像必须与日历一致 */
 var settle=[];
 for(var i=0;i<s.logs.length&&s.logs[i]!==head;i++) settle.push(logText(s.logs[i]));
 var rep=calBuildReport(Y,snap,settle.reverse());
 s.cal.pendingReport=rep;
 s.yearReports.push({y:Y,natl:rep.after.natl,ev:rep.events.slice(0,5),title:rep.after.title,cash:rep.after.cash});
 if(s.yearReports.length>140) s.yearReports=s.yearReports.slice(-140);
 s.cal.yearSnap=calSnap();
 CLOCK.needRender=true;
 if(window.__yearEndHook) try{ window.__yearEndHook(Y); }catch(e){}
 return true;
}
function calBuildReport(Y,snap,settle){
 var after=calSnap();
 var evs=(s.histRec||[]).filter(function(r){return r.y===Y;}).map(function(r){return calFmtOrd(r.ord).replace(/^\d+年/,'')+' '+r.t+'：'+r.c;});
 var evTags=(s.histRec||[]).filter(function(r){return r.y===Y;}).map(function(r){return '【'+r.t+'】';});
 var big=[];
 (s.logs||[]).forEach(function(h){
  var t=logText(h);
  if(t.indexOf(Y+'年')!==0||!/【[^】]+】/.test(t)||t.indexOf('【历法】')>=0) return;
  for(var i=0;i<evTags.length;i++){ if(t.indexOf(evTags[i])>=0) return; } /* 抉择已在上方列出 */
  big.push(t.replace(/^\d+年/,''));
 });
 return {y:Y,before:snap,after:after,events:evs,big:big.slice(0,8).reverse(),settle:(settle||[]).slice(0,10),jobs:(s.jobs||[]).length};
}
function calReportHTML(r){
 if(!r) return '';
 function dl(a,b){ var d=Math.round(b-a); return d>0?'<span class="up">+'+d+'</span>':(d<0?'<span class="down">'+d+'</span>':'<span class="muted">±0</span>'); }
 var h='';
 h+='<div class="yr-sec"><b>国家变化</b><div class="yr-grid">';
 NAT_KEYS.forEach(function(k){ var a=(r.before&&r.before.natl&&r.before.natl[k[0]])||0, b=r.after.natl[k[0]]||0; h+='<span>'+k[1]+' '+b+' '+dl(a,b)+'</span>'; });
 h+='</div></div>';
 var B=r.before||r.after, A=r.after;
 h+='<div class="yr-sec"><b>个人变化</b><div class="yr-grid">'+
  '<span>能力 '+Math.round(A.skill)+' '+dl(B.skill,A.skill)+'</span><span>声望 '+Math.round(A.fame)+' '+dl(B.fame,A.fame)+'</span>'+
  '<span>政治 '+Math.round(A.power)+' '+dl(B.power,A.power)+'</span><span>信任 '+Math.round(A.trust)+' '+dl(B.trust,A.trust)+'</span>'+
  '<span>现银 '+M(A.cash)+' '+dl(B.cash,A.cash)+'</span><span>影响 '+A.alt+' '+dl(B.alt,A.alt)+'</span></div>'+
  (A.title!==B.title?'<p class="small">职位：'+B.title+' → <b>'+A.title+'</b></p>':'<p class="small muted">职位：'+A.title+'</p>')+'</div>';
 if(r.events.length) h+='<div class="yr-sec"><b>本年抉择</b><ul>'+r.events.map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul></div>';
 if(r.big.length) h+='<div class="yr-sec"><b>本年纪事</b><ul>'+r.big.map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul></div>';
 if(r.settle.length) h+='<div class="yr-sec"><b>年终结算</b><ul>'+r.settle.map(function(t){return '<li>'+t.replace(/^\d+年\d+月\d+日\s*/,'')+'</li>';}).join('')+'</ul></div>';
 if(r.jobs) h+='<p class="small muted">尚有 '+r.jobs+' 项持续行动跨年进行。</p>';
 return h;
}
function calShowReport(){
 if(!s||!s.cal.pendingReport) return false;
 var r=s.cal.pendingReport; s.cal.pendingReport=null;
 $('dlgTag').textContent='年度报告 · '+r.y+'年';
 $('dlgTitle').textContent=r.y+'年度报告';
 $('dlgDesc').textContent=r.y+'年12月31日结束，年度结算已完成。看完后，正在办理的事或静待会接着走完。';
 $('dlgBody').innerHTML='<div class="yr-report">'+calReportHTML(r)+'</div><button class="choice" id="yrOk" style="text-align:center"><b>知道了，进入'+(r.y+1)+'年</b></button>';
 $('mask').classList.remove('hidden');
 var b=document.getElementById('yrOk'); if(b) b.onclick=function(){ $('mask').classList.add('hidden'); };
 return true;
}

/* ---------- 最终结算：1972 年 12 月 31 日 ---------- */
function calFinal(){
 if(!s||s.cal.finished) return false;
 s.cal.finished=true;
 s.cal.lastSettledYear=CAL_END_YEAR;
 CLOCK.speed=0;
 var snap=s.cal.yearSnap||calSnap();
 var rep=calBuildReport(CAL_END_YEAR,snap,[]);
 s.yearReports.push({y:CAL_END_YEAR,natl:rep.after.natl,ev:rep.events.slice(0,5),title:rep.after.title,cash:rep.after.cash});
 var v={t:'结局',d:''}; try{ v=verdict(); }catch(e){}
 var lv=s.alt>=20?'历史改写者':s.alt>=12?'历史的参与者':s.alt>=5?'时代的见证者':'时代的过客';
 var sum=['能力 '+s.skill+'、声望 '+s.fame+'、政治 '+s.power+'、上级信任 '+s.trust,
  '职位：'+rep.after.title+(s.clique?'（'+s.clique+'）':''),
  '现银 '+M(s.cash)+'，历史影响 '+s.alt+'（'+lv+'）',
  '亲历并作出抉择的历史事件 '+(s.histRec||[]).length+' 件，经历年度结算 '+s.yearReports.length+' 次'];
 s.ending={t:v.t,d:'1972年12月31日，'+(v.d||''),sum:sum,final:true};
 s.cal.finalEnding=s.ending;
 try{ log('【结局】'+s.ending.t+'——历史走到了1972年末。'); }catch(e){}
 var recs=(s.histRec||[]).slice(-15).map(function(r){return '<li>'+calFmtOrd(r.ord)+' '+r.t+'：'+r.c+'</li>';}).join('');
 $('dlgTag').textContent='历史终章 · 1972年12月31日';
 $('dlgTitle').textContent=s.name+' · 本局历史总结';
 $('dlgDesc').textContent=s.ending.d;
 $('dlgBody').innerHTML='<div class="yr-report">'+
  '<div class="yr-sec"><b>你的一生</b><ul>'+sum.map(function(t){return '<li>'+t+'</li>';}).join('')+'<li>'+s.birth+'年生，1972年末时 '+(CAL_END_YEAR-s.birth)+' 岁</li></ul></div>'+
  (recs?'<div class="yr-sec"><b>你亲历的历史关头（最近 15 件）</b><ul>'+recs+'</ul></div>':'')+
  '<div class="yr-sec"><b>1972年度报告</b>'+calReportHTML(rep)+'</div></div>'+
  '<button class="choice" id="finRestart" style="text-align:center"><b>重新开始</b></button>'+
  '<button class="choice" id="finStay" style="text-align:center"><b>留下来翻看档案</b></button>';
 $('mask').classList.remove('hidden');
 var r1=document.getElementById('finRestart'); if(r1) r1.onclick=function(){ $('mask').classList.add('hidden'); s=null; world=null; $('game').classList.add('hidden'); $('setup').classList.remove('hidden'); };
 var r2=document.getElementById('finStay'); if(r2) r2.onclick=function(){ $('mask').classList.add('hidden'); };
 persist();
 CLOCK.needRender=true;
 return true;
}

/* ---------- 每月 / 每日 ---------- */
function calMonthTick(now){
 /* 战事随时间消耗粮草：战争不再只在玩家点按钮时才“过日子”。 */
 try{
  if(world&&world.war&&world.war.my&&!world.war.done){
   world.war.my.sup=Math.max(0,(+world.war.my.sup||0)-3);
   if(world.war.my.sup<25) world.war.my.mor=Math.max(0,(+world.war.my.mor||0)-2);
  }
 }catch(e){}
 if(window.__monthTick) try{ window.__monthTick(now); }catch(e){}
 persist();                       /* 自动存档：每月一次，不是每天 */
 CLOCK.needRender=true;
}
function calDayTick(now){
 if(jobsProcess()>0) CLOCK.needRender=true;
 if(window.__dayTick) try{ window.__dayTick(now); }catch(e){}
}

/* 推进恰好一天。返回 true 表示日期前进了一天。 */
function calStepDay(){
 if(!s||s.dead) return false;
 if(!s.cal) calInitState(false);
 var c=s.cal;
 if(c.finished) return false;
 if(c.ord>=CAL_END_ORD){ calFinal(); return false; }
 var head=s.logs[0];
 var before=calFromOrd(c.ord);
 c.ord+=1;
 var now=calFromOrd(c.ord);
 if(now.y!==before.y){ calYearEnd(before.y); if(!s.dead&&s.year!==now.y) s.year=now.y; head=s.logs[0]; }   /* V4.18.6：年终结算产生的纪事已写进年度报告，不再触发「重大事件」暂停 */
 if(s.dead){ CLOCK.speed=0; CLOCK.needRender=true; return true; }
 if(now.d===1) calMonthTick(now);
 calDayTick(now);
 /* 重大事件自动暂停 */
 for(var i=0;i<s.logs.length&&s.logs[i]!==head;i++){
  var t=logText(s.logs[i]);
  for(var k=0;k<IMPORTANT_TAGS.length;k++){
   if(t.indexOf(IMPORTANT_TAGS[k])>=0){ calPause('重大事件：'+t.replace(/^\d+年\d+月\d+日\s*/,'').slice(0,40)); i=s.logs.length; break; }
  }
 }
 return true;
}
function calAdvanceDays(n){ var k=0; for(var i=0;i<n;i++){ if(!calStepDay()) break; k++; } return k; }

/* ---------- 速度与暂停 ---------- */
function calSetSpeed(v){
 v=Math.max(0,Math.min(3,Math.round(+v||0)));
 if(!s){ CLOCK.speed=0; return; }
 calEnsure(s);
 if(v>0&&(s.dead||s.cal.finished)){ calToast(s.dead?'人已不在，时间不再为你流动。':'历史已经走到 1972 年末。'); v=0; }
 CLOCK.speed=v; CLOCK.acc=0; CLOCK.last=Date.now();
 if(v>0){ s.cal.speedPref=v; CLOCK.pauseReason=''; }
 calClockUI(true);
}
function calPause(reason){ if(CLOCK.speed>0){ CLOCK.speed=0; CLOCK.acc=0; CLOCK.pauseReason=reason||''; if(reason) calToast(reason+' —— 时间已暂停'); } }
function calBlocked(){
 var m=document.getElementById('mask');
 if(m&&m.classList&&!m.classList.contains('hidden')) return '事件待处理';
 if(document.getElementById('v42meet')) return '拜会中';
 return '';
}
/* 年度报告、到期历史事件：只在没有其它弹窗时处理，避免互相覆盖。 */
function calFlush(){
 if(!s) return;
 if(s.cal.pendingReport){ calShowReport(); return; }
 if(s.dead||s.cal.finished) return;
 if(CLOCK.evOrd!==s.cal.ord||CLOCK.wasBlocked){
  CLOCK.evOrd=s.cal.ord;
  try{ maybeEvent(); }catch(e){}
 }
}
function calLoop(){
 var now=Date.now(), dt=CLOCK.last?Math.max(0,now-CLOCK.last):0; CLOCK.last=now;
 if(!s){ CLOCK.acc=0; return; }
 if(!s.cal) calInitState(false);
 var blocked=calBlocked();
 if(!blocked){ calFlush(); blocked=calBlocked(); }
 CLOCK.wasBlocked=!!blocked;
 var hidden=(typeof document.hidden==='boolean')&&document.hidden;
 if(CLOCK.speed>0&&!blocked&&!hidden&&!s.dead&&!s.cal.finished){
  CLOCK.acc+=Math.min(dt,250);                 /* 后台/卡顿后最多补 0.25 秒，不会一下推进几个月 */
  var per=1000/SPEED_DPS[CLOCK.speed], steps=0;
  while(CLOCK.acc>=per&&steps<12){
   CLOCK.acc-=per; steps++;
   calStepDay();
   if(!calBlocked()) calFlush();   /* 当天到期的事件/年度报告在当天弹出，不会拖到下一帧 */
   if(CLOCK.speed===0||s.dead||s.cal.finished||calBlocked()||s.cal.pendingReport){ CLOCK.acc=0; break; }
  }
 }else CLOCK.acc=0;
 if(CLOCK.needRender){ CLOCK.needRender=false; try{ if(window.__RENDER) window.__RENDER(); else render(); }catch(e){} }
 calClockUI(false);
}

/* ---------- 界面：顶部时间栏、冷却标注、进行中的事务 ---------- */
function calShort(ord){ var o=calFromOrd(ord), t=calToday(); return (o.y===t.y?'':o.y+'年')+o.m+'月'+o.d+'日'; }
function calDecorate(){
 if(!s) return;
 var els=document.querySelectorAll('[data-cd]');
 for(var i=0;i<els.length;i++){
  var el=els[i], key=el.getAttribute('data-cd'), b=actBusy(key), note=el.querySelector('.cdnote');
  if(b){
   if(!el.disabled){ el.disabled=true; el.setAttribute('data-cdoff','1'); }
   var txt=b.kind==='job'?('进行中 · '+calShort(b.until)+'完成'):('冷却 '+b.days+' 天 · '+calShort(b.until)+'可行');
   if(!note){ note=document.createElement('span'); note.className='cdnote'; el.appendChild(note); }
   if(note.textContent!==txt) note.textContent=txt;
   el.title=actBusyText(b);
  }else{
   if(el.getAttribute('data-cdoff')){ el.disabled=false; el.removeAttribute('data-cdoff'); }
   if(note) note.parentNode.removeChild(note);
   if(el.title) el.title='';
  }
 }
}
function calRenderJobs(){
 if(!s) return;
 var t=document.getElementById('actTitle'); if(!t) return;
 var card=t.closest?t.closest('.card'):null; if(!card) return;
 var box=document.getElementById('calJobs');
 if(!box){ box=document.createElement('div'); box.id='calJobs'; box.className='cal-jobs'; card.appendChild(box); }
 var today=s.cal.ord, h='';
 (s.jobs||[]).forEach(function(j){
  var tot=Math.max(1,j.end-j.start), pct=Math.max(0,Math.min(100,Math.round((today-j.start)/tot*100)));
  h+='<div class="cal-job"><div class="small"><b>'+j.label+'</b> · 预计 '+calFmtOrd(j.end)+' 完成（还需 '+Math.max(0,j.end-today)+' 天）</div><div class="bar"><i style="width:'+pct+'%"></i></div></div>';
 });
 var cools=Object.keys(s.cooldowns||{}).filter(function(k){ return s.cooldowns[k]>today&&!jobOf(k); });
 if(cools.length) h+='<div class="small muted" style="margin-top:4px">冷却中 '+cools.length+' 项（按钮上标有可再行日期）</div>';
 if(!h) h='<div class="small muted">眼下没有进行中的持续行动。</div>';
 if(box.innerHTML!==h) box.innerHTML=h;
}
function calClockUI(force){
 if(!s||!s.cal) return;
 var now=Date.now();
 var dayChanged=CLOCK.uiOrd!==s.cal.ord;
 if(!force&&!dayChanged&&now-CLOCK.uiAt<400) return;
 CLOCK.uiOrd=s.cal.ord;
 var d=calFmtOrd(s.cal.ord);
 var e=document.getElementById('hudYear'); if(e&&e.textContent!==d) e.textContent=d;
 var hy=document.getElementById('hYear'); if(hy&&hy.textContent!==d) hy.textContent=d;
 var blocked=calBlocked();
 var sp=document.getElementById('hudSpeed');
 if(sp){
  var txt=s.cal.finished?'已结束':(s.dead?'已终':(CLOCK.speed===0?'已暂停':(blocked?('等待处理 · '+SPEED_NAME[CLOCK.speed]):(SPEED_NAME[CLOCK.speed]+' · '+SPEED_DPS[CLOCK.speed]+'天/秒'))));
  if(sp.textContent!==txt) sp.textContent=txt;
  sp.className='hud-spd'+(CLOCK.speed===0||blocked?' paused':'');
 }
 var bs=document.querySelectorAll('#hudClock [data-spd]');
 for(var i=0;i<bs.length;i++){ var on=(+bs[i].getAttribute('data-spd'))===CLOCK.speed; if(bs[i].classList.contains('on')!==on) bs[i].classList.toggle('on',on); }
 var hj=document.getElementById('hudJobs'); if(hj){ var jt=(s.jobs||[]).length+' 项'; if(hj.textContent!==jt) hj.textContent=jt; }
 /* 冷却标注、进行中列表、布局较重：最多每 250 毫秒刷新一次（渲染时强制刷新） */
 if(force||now-CLOCK.uiAt>=250){ CLOCK.uiAt=now; calDecorate(); calRenderJobs(); calLayout(); }
}
function calLayout(){
 var hud=document.getElementById('hud'), tabs=document.getElementById('tabs');
 if(!hud||!tabs||!window.matchMedia) return;
 if(window.matchMedia('(max-width:760px)').matches){
  if(tabs.style.top) tabs.style.top='';
  var mp=(hud.offsetHeight||70)+'px'; if(s&&document.body.style.paddingTop!==mp) document.body.style.paddingTop=mp;
  return;
 }
 var h=hud.offsetHeight||44;
 var top=h+'px'; if(tabs.style.top!==top) tabs.style.top=top;
 var pad=(h+(tabs.offsetHeight||40)+2)+'px';
 if(s&&document.body.style.paddingTop!==pad) document.body.style.paddingTop=pad;
}
function calBindUI(){
 var box=document.getElementById('hudClock');
 if(box&&!box.getAttribute('data-bound')){
  box.setAttribute('data-bound','1');
  box.addEventListener('click',function(e){
   var b=e.target.closest?e.target.closest('[data-spd]'):null; if(!b) return;
   calSetSpeed(+b.getAttribute('data-spd'));
  });
 }
 if(!document.__calKey){
  document.__calKey=1;
  document.addEventListener('keydown',function(e){
   if(!s||e.code!=='Space') return;
   var tg=(e.target&&e.target.tagName)||'';
   var inClock=!!(e.target&&e.target.closest&&e.target.closest('#hudClock'));
   if((!inClock&&/INPUT|TEXTAREA|SELECT|BUTTON/.test(tg))||calBlocked()) return;
   e.preventDefault();
   calSetSpeed(CLOCK.speed>0?0:(s.cal.speedPref||1));
  });
 }
}

/* ---------- 接线：开局 / 读档 / 存档 / 结局 ---------- */
var _initV417=init;
init=function(){
 _initV417.apply(null,arguments);
 if(!s) return;
 calInitState(true);
 CLOCK.speed=0; CLOCK.evOrd=null;
 log('【历法】'+calFmtOrd(s.cal.ord)+'。时间只随你做的事推进：每件事标着约需天数；想让日子过去，点顶部「静待时日」。');
 try{ if(window.__RENDER) window.__RENDER(); }catch(e){}
 calClockUI(true);
};
var _applySaveV417=applySave;
applySave=function(d){
 var r=_applySaveV417.apply(this,arguments);
 if(s){
  var had=calInitState(false);
  if(!had) log('【历法】旧存档没有日期，已迁移到 '+calFmtOrd(s.cal.ord)+'。');
  CLOCK.speed=0; CLOCK.acc=0; CLOCK.evOrd=null;   /* 读档后一律暂停 */
  try{ if(window.__RENDER) window.__RENDER(); }catch(e){}
  calClockUI(true);
 }
 return r;
};
var _packV417=packSave;
packSave=function(){
 var o=_packV417.apply(null,arguments);
 o.v='4.18';
 if(s&&s.cal){ o.date=calFmtOrd(s.cal.ord); o.ord=s.cal.ord; }
 return o;
};
/* 列强交涉：处理函数层面的冷却校验（权限校验在内层 V4.6 包装里） */
var _powerActV418=powerAct;
powerAct=function(k,n){
 if(!actGate('pw:'+k+':'+n,({talk:'交涉',loan:'借款',buy:'购舰',war:'宣战/和谈'})[k]||'外事')) return;
 return _powerActV418.apply(this,arguments);
};
var _checkEndingV417=checkEnding;
checkEnding=function(){
 if(s&&s.cal&&s.cal.finished&&s.cal.finalEnding){ s.ending=s.cal.finalEnding; return; }
 return _checkEndingV417.apply(null,arguments);
};
JOB_FX.unitDrill=function(x,job){
 if(!x.unit) return '';
 var g=Math.round(rnd(6,11));
 x.unit.mor=clamp(x.unit.mor+g); x.unit.sup=clamp(x.unit.sup-Math.round(rnd(1,3))); x.skill=clamp((+x.skill||0)+1);
 return '弟兄们骂娘，动作倒是整齐了；士气 +'+g;
};
var _renderV417=render;
render=function(){ _renderV417.apply(null,arguments); try{ calClockUI(true); }catch(e){} };
window.__CAL={
 isLeap:calIsLeap,monthDays:calMonthDays,ord:calOrd,fromOrd:calFromOrd,fmt:calFmt,END_ORD:CAL_END_ORD,
 stepDay:calStepDay,advanceDays:calAdvanceDays,setSpeed:calSetSpeed,loop:calLoop,clock:CLOCK,
 yearEnd:calYearEnd,final:calFinal,flush:calFlush,today:calToday,
 busy:actBusy,gate:actGate,cool:actCool,jobStart:jobStart,jobsProcess:jobsProcess,factor:actFactor,days:actDays,evDue:evDue
};
window.__actBusy=actBusy;
window.__doGovern=function(k){ return doGovern(k); }; /* 供测试与外部按钮调用，仍走全部权限与冷却校验 */
window.__powerAct=function(k,n){ return powerAct(k,n); };
CLOCK.last=Date.now();
CLOCK.timer=setInterval(function(){ try{ calLoop(); }catch(e){ if(window.console) console.error(e); } },100);
setTimeout(calBindUI,0);
document.addEventListener('DOMContentLoaded',calBindUI);
window.addEventListener&&window.addEventListener('resize',function(){ try{ calLayout(); }catch(e){} });

/* ================= V4.18.5：时间成本、结果提示、生计收支、关系网、分页 =================
   1) 取消冷却：每个行动显示“约 N 天”，确认后日历立刻按天推进 N 天（逐日走同一条每日/每月/年末管线）。
      推进途中若弹出历史抉择或年度报告，推进停在当天；处理完弹窗后自动接着走完剩余天数，所以每个行动耗时恒为 N 天。
   2) 每次行动/抉择后弹出结果：耗时、起止日期、收入、支出、属性与关系变化——全部由前后状态比对得出。
   3) 生计：每月 1 日按身份、品级、地区、家口结算上月俸饷与开销；入不敷出转为欠债，欠债有利息与后果。
   4) 关系网：拜访、送礼、请托、引荐、借贷、求情；关系影响晋升、办事效率、消息、庇护与借款；人会记得你做过的事；久不往来会淡。 */

/* ---------- 0. 小工具 ---------- */
var V4185=true;
function _r2(v){ return Math.round((+v||0)*100)/100; }
function econEnsure(x){
 x=x||s; if(!x) return null;
 if(!x.econ||typeof x.econ!=='object') x.econ={};
 var E=x.econ;
 if(typeof E.debt!=='number'||!isFinite(E.debt)) E.debt=0;
 if(!Array.isArray(E.loans)) E.loans=[];
 if(!Array.isArray(E.hist)) E.hist=[];
 if(typeof E.brokeMonths!=='number') E.brokeMonths=0;
 if(!E.state||typeof E.state.res!=='number') E.state={res:Math.round(refAt(REF_REV,x.year||1840)*0.25)};
 return E;
}
function loanTotal(x){ x=x||s; var t=0; ((x&&x.econ&&x.econ.loans)||[]).forEach(function(l){ t+=+l.amt||0; }); return t; }
function stateRev(){ return refAt(REF_REV,(s&&s.year)||1840); }
function stateRes(d){ var E=econEnsure(s); if(!E) return 0; E.state.res=Math.round((E.state.res+(+d||0))*10)/10; return E.state.res; }
window.__stateRev=stateRev; window.__stateRes=stateRes;

/* ---------- 1. 时间成本：各类行动的天数 ---------- */
var DUR_FIX={
 'meet:visit':3,'meet:learn':7,'meet:work':15,'sup:visit':2,'sup:gift':2,'sup:ask':5,
 'club:act':7,'club:donate':1,'club:arm':15,'unit:rec':20,'unit:drill':30,'unit:fight':45,'clique':10,
 'rel:gift':2,'rel:talk':3,'rel:stand':5,'pw:talk':20,'pw:loan':60,'pw:buy':45,'pw:war':10,
 'country:attack':60,'country:settle':30,'region':30,'gov:appoint':15,'gov:mobilize':20,'cons:propose':30,
 'order:rebel':5,'order:exec':30,'fac:organize':20,'fac:contest':30,'fac:reconcile':20,'fac:split':30,'fac:succession':30,'fac:align':10,
 'act':15,'net:visit':3,'net:gift':2,'net:favor':7,'net:intro':10,'net:loan':3,'net:plead':10,'net:repay':2,'promote':3
};
var DUR_LABEL={
 'meet:visit':'拜访','meet:learn':'请教','meet:work':'共事','sup:visit':'拜访上级','sup:gift':'给上级送礼','sup:ask':'请示提拔',
 'club:act':'会中办事','club:donate':'捐输','club:arm':'联络新军','unit:rec':'招募','unit:drill':'部队操练','unit:fight':'开拔作战','clique':'改投派系',
 'rel:gift':'送礼','rel:talk':'深谈','rel:stand':'公开表态','pw:talk':'交涉','pw:loan':'借款','pw:buy':'购械','pw:war':'宣战/和谈',
 'country:attack':'用兵','country:settle':'设治抚民','region':'整饬防务','cons:propose':'递交宪制建议','order:rebel':'签发平乱军令','order:exec':'执行平乱军令',
 'fac:organize':'经营派系','fac:contest':'竞争职位','fac:reconcile':'协商和解','fac:split':'推动分裂','fac:succession':'权力更迭','fac:align':'转投派系',
 'net:visit':'拜访','net:gift':'送礼','net:favor':'请托','net:intro':'请人引荐','net:loan':'借贷','net:plead':'求情','net:repay':'还钱','war:cmd':'前线指挥','promote':'打点升迁'
};
var SOCIAL_KEYS=/^(gov:(lobby|befriend|gossip|earn|petition|office)|net:|meet:|sup:)/;
function durKey(key){
 key=String(key||'');
 var p=key.split(':');
 if(p.length>=2&&DUR_FIX[p[0]+':'+p[1]]!==undefined) return p[0]+':'+p[1];
 if(DUR_FIX[p[0]]!==undefined) return p[0];
 return null;
}
/* 人脉越广，跑关系、打听、做买卖越省时间：关系 ≥70 的熟人每人 −3%，最多 −15% */
var NET_ALLY_MEMO=null;   /* 界面批量标注天数时缓存一次，避免每个按钮都遍历关系网 */
function netSpeed(key){
 if(!SOCIAL_KEYS.test(String(key||''))) return 1;
 var a=NET_ALLY_MEMO!==null?NET_ALLY_MEMO:netAllies(70);
 return 1-Math.min(0.15,0.03*a);
}
/* 实际耗时（天）：基准天数 × 能力/职位/时局系数（actFactor）× 人脉系数 */
function dayCost(key,base){
 var dk=durKey(key);
 var b=(dk&&String(key).indexOf('gov:')!==0)?DUR_FIX[dk]:(+base||(dk?DUR_FIX[dk]:15));
 if(String(key).indexOf('war:cmd')===0) b=+base||15;
 if(String(key).indexOf('gov:')===0&&DUR_FIX[dk]!==undefined&&(dk==='gov:appoint'||dk==='gov:mobilize')) b=DUR_FIX[dk];
 return Math.max(1,Math.round(b*actFactor()*netSpeed(key)));
}
/* 按钮上的预计天数（data-cd 键） */
function dayHint(key){
 key=String(key||'');
 if(key.indexOf('gov:')===0){
  var k=key.slice(4), r=(window.__GOV_DAYS||{})[k];
  if(!r) return '';
  var a=dayCost(key,r[0]), b=dayCost(key,r[1]);
  return a===b?('约 '+a+' 天'):('约 '+a+'–'+b+' 天');
 }
 var dk=durKey(key); if(!dk) return '';
 return '约 '+dayCost(key,DUR_FIX[dk])+' 天';
}
window.__dayHint=dayHint; window.__dayCost=dayCost;

/* ---------- 2. 取消冷却：只保留“持续工程”占用（兴办实业等） ---------- */
var GATE_LABEL={};
actBusy=function(key){
 if(!s) return null;
 calEnsure(s);
 var j=jobOf(key);
 if(j) return {kind:'job',days:Math.max(0,j.end-s.cal.ord),until:j.end,label:j.label};
 return null;
};
actBusyText=function(b){
 if(!b) return '';
 return '进行中 · 预计 '+calFmtOrd(b.until)+' 完成（还需 '+b.days+' 天）';
};
actGate=function(key,label){
 if(!s) return false;
 calEnsure(s);
 if(label) GATE_LABEL[key]=label;
 if(s.dead){ calToast('人已不在，诸事皆休。'); return false; }
 if(s.cal.finished){ calToast('历史已经走到 1972 年末，本局已经结算。'); return false; }
 if(SP.cur){ calToast('正在办理「'+SP.cur.label+'」，'+calFmtOrd(SP.cur.to)+' 办完。'); return false; }
 var b=actBusy(key);
 if(b){ calToast((label?'「'+label+'」':'此事')+actBusyText(b)); return false; }
 return true;
};
/* 旧接口 actCool(键, 天数)：现在表示“这件事要花 N 天”，登记后由时间推进器执行 */
actCool=function(key,baseDays){
 if(!s) return 0;
 calEnsure(s);
 var n=dayCost(key,baseDays);
 if(SP.cur) return n;              /* 推进途中（如事件抉择）不再叠加新的耗时 */
 var lab=GATE_LABEL[key]||DUR_LABEL[durKey(key)]||(key.indexOf('gov:')===0&&window.__govLabel?window.__govLabel(key.slice(4)):'')||'此事';
 if(lab==='此事'&&key.indexOf('gov:')===0) lab=(window.__govLabel&&window.__govLabel(key.slice(4)))||lab;
 if(!SP.req||n>SP.req.n) SP.req={n:n,key:key,label:lab};
 if(!SP.pre) SP.pre=SP.lastPre||spSnap();
 return n;
};
var _jobStartV4185=jobStart;
jobStart=function(key,opt){
 var j=_jobStartV4185.apply(this,arguments);
 if(s&&s.cooldowns) delete s.cooldowns[key];   /* 工程本身不再附带冷却 */
 return j;
};

/* ---------- 3. 时间推进器 + 结果提示 ---------- */
var SP={pre:null,lastPre:null,req:null,cur:null,popup:null};
function spSnap(){
 if(!s) return null;
 var rel={}, k; for(k in (s.rel||{})) rel[k]=s.rel[k];
 var natl={}; for(k in (s.natl||{})) natl[k]=s.natl[k];
 var E=s.econ||{};
 var F=s.frac||{}; function ev(k){ return (+s[k]||0)+(+F[k]||0); }
 return {ord:s.cal?s.cal.ord:0,cash:+s.cash||0,debt:+E.debt||0,loans:loanTotal(),skill:ev('skill'),fame:ev('fame'),power:ev('power'),trust:ev('trust'),
  health:(s.health===undefined?100:+s.health),rank:+s.rank||0,title:rankTitleOf(),supRel:supRel(),clubRel:+s.clubRel||0,
  troops:(s.unit&&+s.unit.troops)||0,mor:(s.unit&&+s.unit.mor)||0,fund:+s.fund||0,alt:+s.alt||0,rel:rel,natl:natl,
  head:(s.logs||[])[0],res:(E.state&&E.state.res)||0,net:Object.keys(s.net||{}).length};
}
function spWorth(){ return (+s.cash||0)-((s.econ&&+s.econ.debt)||0)-loanTotal(); }
function logsSince(head,max){
 var out=[]; if(!s) return out;
 for(var i=0;i<s.logs.length&&s.logs[i]!==head;i++) out.push(logText(s.logs[i]).replace(/^\d+年\d+月\d+日\s*/,''));
 return out.reverse().slice(-(max||12));
}
function spMark(){ if(!SP.cur&&s) SP.lastPre=spSnap(); }
/* 开始推进：处理完行动当时的效果后调用 */
function spBegin(){
 if(!SP.req||!s) return false;
 var q=SP.req, pre=SP.pre||SP.lastPre||spSnap();
 SP.req=null; SP.pre=null;
 var post=spSnap();
 var c={key:q.key,label:q.label,n:q.n,from:s.cal.ord,to:Math.min(CAL_END_ORD,s.cal.ord+q.n),pre:pre,post:post,inc:0,exp:0,months:[],evLogs:[],head:post.head,actLogs:logsSince(pre.head,8)};
 var dw=(post.cash-post.debt-post.loans)-(pre.cash-pre.debt-pre.loans);
 if(dw>0) c.inc+=dw; else c.exp+=-dw;
 SP.cur=c;
 /* 行动当时打开的普通弹窗（如派系面板）一并收起；历史抉择/年度报告不受影响 */
 try{ var tg=($('dlgTag').textContent||''); if(!$('mask').classList.contains('hidden')&&!/历史抉择|年度报告|历史终章|人生终章/.test(tg)) $('mask').classList.add('hidden'); }catch(e){}
 CLOCK.acc=0;
 spRun();
 return true;
}
/* 逐日推进；遇到弹窗就停在当天，弹窗处理完由时钟循环接着推进 */
function spRun(){
 var c=SP.cur; if(!c||!s) return;
 var guard=0;
 if(CLOCK.wasBlocked&&!calBlocked()){ calFlush(); }        /* 当天还有到期的事件/报告，先处理 */
 CLOCK.wasBlocked=false;
 while(s&&!s.dead&&!s.cal.finished&&s.cal.ord<c.to&&guard<4000){
  if(calBlocked()){ CLOCK.wasBlocked=true; return; }
  guard++;
  var w0=spWorth();
  var ok=calStepDay();
  if(!ok) break;
  var dw=spWorth()-w0-(c.mNet||0); c.mNet=0;      /* 月结的收支已按明细计入，这里只计其余变动 */
  if(dw>0.004) c.inc+=dw; else if(dw<-0.004) c.exp+=-dw;
  if(!calBlocked()) calFlush();
 }
 if(calBlocked()){ CLOCK.wasBlocked=true; return; }
 spFinish();
}
function spFinish(){
 var c=SP.cur; if(!c) return;
 SP.cur=null;
 c.end=s?s.cal.ord:c.to;
 if(s) c.after=spSnap();
 /* 对账：途中事件抉择等带来的银钱变动也计入，使“收入 − 支出”等于净资产实际变化 */
 if(c.after){ var tw=(c.after.cash-c.after.debt-c.after.loans)-(c.pre.cash-c.pre.debt-c.pre.loans), resid=tw-(c.inc-c.exp);
  if(resid>0.004) c.inc+=resid; else if(resid<-0.004) c.exp+=-resid; }
 CLOCK.acc=0; CLOCK.last=Date.now(); CLOCK.needRender=true;
 if(s&&!s.dead&&!(s.cal.finished&&calBlocked())) spPopup(c,false);
 try{ persist(); }catch(e){}
}
function dSign(v,unit){ v=Math.round(v*10)/10; return (v>0?'+':'')+v+(unit||''); }
function spDiffLines(a,b){
 var L=[];
 [['skill','能力'],['fame','声望'],['power','政治影响'],['trust','上级信任'],['health','健康'],['alt','历史影响']].forEach(function(k){
  var d=Math.round((b[k[0]]-a[k[0]])*10)/10; if(Math.abs(d)>=0.1) L.push(k[1]+' '+dSign(Math.abs(d)>=1?Math.round(d):d)+(Math.abs(d)<1?'（积累中）':''));
 });
 if(b.title!==a.title) L.push('职位：'+a.title+' → '+b.title);
 if(Math.abs(b.troops-a.troops)>=1) L.push('所部兵员 '+(b.troops>a.troops?'+':'')+Math.round(b.troops-a.troops)+'（现 '+fmtMen(b.troops)+'）');
 if(Math.abs(b.mor-a.mor)>=1) L.push('士气 '+dSign(Math.round(b.mor-a.mor)));
 if(Math.abs(b.fund-a.fund)>=0.05) L.push('公费 '+(b.fund>a.fund?'+':'-')+M(Math.abs(b.fund-a.fund)));
 if(Math.abs(b.debt-a.debt)>=0.05) L.push('欠债 '+(b.debt>a.debt?'+':'-')+M(Math.abs(b.debt-a.debt))+'（现 '+M(b.debt)+'）');
 if(Math.abs(b.loans-a.loans)>=0.05) L.push('借款 '+(b.loans>a.loans?'+':'-')+M(Math.abs(b.loans-a.loans))+'（未还 '+M(b.loans)+'）');
 if(s&&s.isLeader&&Math.abs(b.res-a.res)>=1) L.push('国库存银 '+(b.res>a.res?'+':'-')+M(Math.abs(b.res-a.res)*1e4));
 var rl=[];
 if(b.supRel!==a.supRel){ var u=supOf(); rl.push({n:(u?u.t+u.n:'上级'),d:b.supRel-a.supRel}); }
 Object.keys(b.rel).forEach(function(n){ var d=(b.rel[n]||0)-((a.rel[n]===undefined)?50:a.rel[n]); if(a.rel[n]===undefined&&b.rel[n]===50) return; if(Math.abs(d)>=1) rl.push({n:n,d:d}); });
 if(b.clubRel!==a.clubRel&&s&&s.clubJoined) rl.push({n:(CLUBS[s.club]||{}).name||'结社',d:b.clubRel-a.clubRel});
 rl.sort(function(x,y){return Math.abs(y.d)-Math.abs(x.d);});
 rl.slice(0,5).forEach(function(r){ L.push('与'+r.n+'关系 '+dSign(Math.round(r.d))); });
 if(rl.length>5) L.push('另有 '+(rl.length-5)+' 人关系变化');
 var nd=[]; NAT_KEYS.forEach(function(k){ var d=(b.natl[k[0]]||0)-(a.natl[k[0]]||0); if(Math.abs(d)>=1) nd.push(k[1]+' '+dSign(Math.round(d))); });
 if(nd.length) L.push('国势：'+nd.join('，'));
 if(b.net>a.net) L.push('关系网新添 '+(b.net-a.net)+' 人');
 return L;
}
function spPopup(c,instant){
 if(!s) return;
 var a=c.pre, b=c.after||spSnap();
 var lines=spDiffLines(a,b);
 var head='';
 if(!instant){
  head='耗时 '+(c.end-c.from)+' 天（'+calFmtOrd(c.from)+'—'+calFmtOrd(c.end).replace(/^\d+年/,function(m){ return calFromOrd(c.end).y===calFromOrd(c.from).y?'':m; })+'）';
  if(c.end-c.from<c.n&&(s.cal.finished||s.dead)) head+='，历史已到终点，未走完预定的 '+c.n+' 天';
 }else head='当即生效';
 var money=[];
 if(c.inc>=0.005) money.push('收入 '+M(c.inc));
 if(c.exp>=0.005) money.push('支出 '+M(c.exp));
 var h='<div class="rp"><p class="rp-head">'+head+(money.length?'，'+money.join('，'):'')+'</p>';
 if(c.months&&c.months.length){
  h+='<div class="rp-sec"><b>期间生计结算</b><ul>'+c.months.map(function(m){ return '<li>'+m+'</li>'; }).join('')+'</ul></div>';
 }
 h+=lines.length?('<div class="rp-sec"><b>变化</b><ul>'+lines.map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul></div>'):'<p class="small muted">没有明显变化。</p>';
 var acts=(c.actLogs||[]).filter(function(t){ return t&&!/^【历法】/.test(t); });
 if(acts.length) h+='<div class="rp-sec"><b>经过</b><ul>'+acts.slice(-5).map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul></div>';
 if(!instant){
  var mid=logsSince(c.head,40).filter(function(t){ return /【[^】]+】/.test(t)&&!/【生计】/.test(t); });
  if(mid.length) h+='<div class="rp-sec"><b>这些天里</b><ul>'+mid.slice(-6).map(function(t){return '<li>'+t+'</li>';}).join('')+'</ul></div>';
 }
 h+='</div><button class="choice" id="rpOk" style="text-align:center"><b>知道了</b></button>';
 SP.popup={tag:(instant?'结果':'办完了')+' · '+calFmtOrd(s.cal.ord),title:c.label,html:h};
 spShowPopup();
}
function spShowPopup(){
 if(!SP.popup||calBlocked()) return false;
 var p=SP.popup; SP.popup=null;
 $('dlgTag').textContent=p.tag; $('dlgTitle').textContent=p.title; $('dlgDesc').textContent='';
 $('dlgBody').innerHTML=p.html;
 $('mask').classList.remove('hidden');
 var ok=document.getElementById('rpOk'); if(ok) ok.onclick=function(){ $('mask').classList.add('hidden'); };
 try{ if(window.__RENDER) window.__RENDER(); }catch(e){}
 return true;
}
/* 没有耗时的抉择（历史事件、晋升等）也给出结果：点击前后比对 */
function spInstant(label){
 if(!s||!SP.lastPre||SP.cur||SP.req) return false;
 var a=SP.lastPre, b=spSnap();
 SP.lastPre=null;
 var lines=spDiffLines(a,b);
 var dw=(b.cash-b.debt-b.loans)-(a.cash-a.debt-a.loans);
 if(!lines.length&&Math.abs(dw)<0.005) return false;
 var c={label:label||'结果',pre:a,after:b,inc:dw>0?dw:0,exp:dw<0?-dw:0,actLogs:logsSince(a.head,6)};
 spPopup(c,true);
 return true;
}
/* 推进中的事件抉择不单独弹出，记入本次行动的“这些天里” */
function spTick(){
 if(SP.req&&!SP.cur) spBegin();
 if(SP.cur){ if(!calBlocked()) spRun(); return true; }
 if(SP.popup) spShowPopup();
 return false;
}
/* 点击：捕获阶段记下点击前的状态；冒泡阶段若登记了耗时就开始推进，否则若状态有变就弹出结果 */
function spClickCapture(e){
 if(!s||SP.cur) return;
 var t=e.target&&e.target.closest?e.target.closest('button,[data-n],[data-act]'):null;
 if(!t) return;
 if(t.closest('#hudClock')||t.closest('#tabs')) return;
 SP.lastPre=spSnap();
 SP.lastLabel=(t.querySelector&&t.querySelector('b')?t.querySelector('b').textContent:t.textContent||'').replace(/\s+/g,' ').trim().slice(0,24);
 SP.lastTag=($('dlgTag')&&$('dlgTag').textContent)||'';
}
function spClickBubble(e){
 if(!s) return;
 if(SP.req&&!SP.cur){ spBegin(); return; }
 if(SP.cur) return;
 if(SP.lastPre){
  var tag=SP.lastTag||'';
  var lab=/历史抉择/.test(tag)?('抉择：'+(SP.lastLabel||'')):(SP.lastLabel||'结果');
  if(!$('mask').classList.contains('hidden')&&!/rpOk/.test(String(e.target&&e.target.id))){ SP.lastPre=null; return; }  /* 打开了新的选择框：等真正选定后再比对 */
  spInstant(lab);
 }
}
window.addEventListener('click',spClickCapture,true);
window.addEventListener('click',spClickBubble,false);
var _calLoopV4185=calLoop;
calLoop=function(){
 if(s&&spTick()){ if(CLOCK.needRender){ CLOCK.needRender=false; try{ if(window.__RENDER) window.__RENDER(); else render(); }catch(e){} } calClockUI(false); return; }
 _calLoopV4185();
};

/* ---------- 4. 生计：每月结算 ---------- */
var ORIGIN_ALLOW={'普通家庭':0.3,'乡绅家庭':3,'商人家庭':2.5,'军人家庭':0.8,'知识分子家庭':1.5,'皇室家庭':30};
function econItems(x){
 var pay=livePayItems(x).map(function(p){return [p[0],+p[1]||0];});
 var cost=liveCostItems(x).map(function(p){return [p[0],+p[1]||0];});
 var age=(x.year||1840)-(x.birth||1820);
 if((x.role==='student'||x.role==='activist')&&(x.rank||0)<=1&&age<28&&ORIGIN_ALLOW[x.origin]) pay.push(['家中接济',ORIGIN_ALLOW[x.origin]]);
 /* 底层人家：妻子纺织、做零活补贴家用（清末民初普通家庭的常态） */
 if(!x.isLeader&&!x.isThrone&&liveHousehold(x)>=2){
  if((x.year||1840)>=1950&&(x.rank||0)<=5) pay.push(['配偶工资',3.5]);            /* 1950 年代起城镇多为双职工 */
  else if((x.rank||0)<=2) pay.push(['家人帮补（纺织、零活）',0.6]);
 }
 var E=econEnsure(x);
 (E.loans||[]).forEach(function(l){ cost.push(['借款利息（'+l.from+'）',(+l.amt||0)*(+l.rate||0)]); });
 if(E.debt>0) cost.push(['欠债利息',E.debt*0.03]);
 return {pay:pay,cost:cost};
}
function econMonth(now){
 if(!s||s.dead) return;
 var E=econEnsure(s), it=econItems(s);
 var prev=calFromOrd(s.cal.ord-1);
 var pay=it.pay.map(function(p){
  if(p[0]==='铺面进项'){ var r=Math.random(); var v=r<0.1?-p[1]*rnd(0.2,0.8):p[1]*rnd(0.4,1.6); return [v<0?'铺面亏折':p[0],v]; }
  return p;
 });
 var inc=0, exp=0;
 pay.forEach(function(p){ if(p[1]>=0) inc+=p[1]; else exp+=-p[1]; });
 it.cost.forEach(function(c){ exp+=c[1]; });
 inc=_r2(inc); exp=_r2(exp);
 s.cash=_r2((+s.cash||0)+inc-exp);
 /* 公费：职位可支配的公款，不是个人收入 */
 var line=LIVE_LINE[s.role];
 if((line==='mil'||line==='civ'||s.isLeader)&&!s.pendingFaction) s.fund=_r2((+s.fund||0)+FUND_MONTH[Math.max(0,Math.min(7,s.rank||0))]);
 var note='';
 if(s.cash<0){ E.debt=_r2(E.debt-s.cash); s.cash=0; E.brokeMonths++; note='入不敷出，欠债增至 '+M(E.debt); }
 else if(E.debt>0){
  var keep=exp; var payoff=Math.min(E.debt,Math.max(0,s.cash-keep));
  if(payoff>0){ E.debt=_r2(E.debt-payoff); s.cash=_r2(s.cash-payoff); note='还了欠债 '+M(payoff)+(E.debt>0?'，尚欠 '+M(E.debt):'，债已还清'); }
  if(E.debt<=0) E.brokeMonths=0;
 }else E.brokeMonths=0;
 /* 借款到期 */
 E.loans.forEach(function(l){
  if(s.cal.ord>=l.due&&!l.late){ l.late=true; netRelAdd(l.from,-12,'借款到期未还'); }
  if(l.late&&s.cal.ord>=l.due+90&&!l.defaulted){
   l.defaulted=true; netRelAdd(l.from,-25,'你借钱逾期三个月不还'); netGrudge(l.from); s.fame=clamp((s.fame||0)-2);
   Object.keys(s.net||{}).forEach(function(n){ var p=s.net[n]; if(n!==l.from&&p.can&&p.can.indexOf('loan')>=0) relSetN(n,relGetN(n)-3); });
   log('【生计】欠'+l.from+'的钱逾期三月未还，'+l.from+'四处说你不讲信用。');
  }
 });
 /* 逾期一年仍不还：债主告官，借款转为欠债（按 3 分月息计） */
 E.loans=E.loans.filter(function(l){
  if(l.defaulted&&s.cal.ord>=l.due+365){ E.debt=_r2(E.debt+l.amt); netRemember(l.from,'把你告到官里，借款转为欠债'); log('【生计】'+l.from+'告到官里，'+M(l.amt)+'的借款转为欠债。'); return false; }
  return true;
 });
 /* 欠债的后果：月开销 3 倍以上伤身伤名，12 倍以上债主上门 */
 if(E.debt>0){
  var shield=netShield();
  if(E.debt>exp*3&&!shield&&now&&now.m%2===0) s.fame=clamp((s.fame||0)-1);
  if(E.debt>exp*6&&!shield) s.health=clamp((s.health||100)-1);
  if(E.debt>Math.max(30,exp*24)){
   /* 债台高筑：债主告官，变卖家产抵债，七成债务就此了结，名声与身体都受重创 */
   var sh2=netShield();
   var cut=_r2(E.debt*(sh2?0.8:0.7)); E.debt=_r2(E.debt-cut); s.cash=0;
   s.fame=clamp((s.fame||0)-6); s.trust=clamp((s.trust||0)-4); s.health=clamp((s.health||100)-4); s.supRel=clamp(supRel()-5);
   E.bankrupt=(E.bankrupt||0)+1;
   log('【破产】债主告到官里，变卖家产抵去 '+M(cut)+' 的债'+(sh2?'（'+sh2+'从中说合，少吃了些亏）':'')+'，尚欠 '+M(E.debt)+'。');
   if(sh2) netRemember(sh2,'在你破产时从中说合');
  }else if(E.debt>exp*12&&Math.random()<0.5){
   if(shield){ log('【生计】债主上门，'+shield+'出面担保，暂且宽限。'); netRemember(shield,'替你挡了债主'); }
   else{ s.trust=clamp((s.trust||0)-2); s.supRel=clamp(supRel()-2); log('【生计】债主堵在门口，欠债 '+M(E.debt)+'，脸面丢尽。'); }
  }
 }
 /* 国库：按财政指数盈亏（万两） */
 var sr=stateRev(); E.state.res=Math.round((E.state.res+sr/12*(((s.natl&&s.natl.财政)||40)-48)/150)*10)/10;
 var rec={y:prev.y,m:prev.m,inc:inc,exp:exp,cash:s.cash,debt:E.debt,pay:pay.map(function(p){return [p[0],_r2(p[1])];}),cost:it.cost.map(function(c){return [c[0],_r2(c[1])];})};
 E.last=rec; E.hist.push({y:prev.y,m:prev.m,inc:inc,exp:exp}); if(E.hist.length>24) E.hist=E.hist.slice(-24);
 if(window.__econHook) try{ window.__econHook(prev.y,prev.m); }catch(e){}
 if(SP.cur){ SP.cur.inc+=inc; SP.cur.exp+=exp; SP.cur.mNet=(SP.cur.mNet||0)+(inc-exp); }
 if(SP.cur) SP.cur.months.push(prev.y+'年'+prev.m+'月：收入 '+M(inc)+'，开销 '+M(exp)+(note?'；'+note:''));
 if(note&&!SP.cur) log('【生计】'+prev.m+'月结算：收入 '+M(inc)+'，开销 '+M(exp)+'；'+note+'。');
 /* 关系：久不往来会淡 */
 netDecay(now);
}
var _calMonthTickV4185=calMonthTick;
calMonthTick=function(now){
 try{ econMonth(now); }catch(e){ if(window.console) console.error(e); }
 return _calMonthTickV4185.apply(this,arguments);
};
window.__econMonth=econMonth; window.__econItems=econItems;

/* ---------- 5. 关系网 ---------- */
var NET_CAN={promote:'保举',protect:'庇护',info:'消息',intro:'引荐',loan:'借贷',deal:'生意',skill:'指点',heal:'延医'};
var NET_TYPES={
 tongxiang:{can:['info','intro'],lv:[0,2],t:function(y){return ['同乡','族中长辈','老街坊'];}},
 scholar:{can:['info','skill','intro'],lv:[1,3],t:function(y){return y<1905?['塾师','书院生员','举人']:(y<1949?['学堂教员','报馆编辑','大学教授']:['中学教师','编辑','研究员']);}},
 merchant:{can:['loan','deal'],lv:[1,4],t:function(y){return y<1912?['票号掌柜','钱庄东家','行栈老板']:(y<1949?['钱庄经理','银行襄理','洋行买办']:['供销社主任','商店经理','工厂厂长']);}},
 gentry:{can:['protect','intro','loan'],lv:[2,4],t:function(y){return y<1912?['乡绅','族长','团练首事']:(y<1949?['乡绅','县参议员','商会董事']:['公社书记','大队长','老干部']);}},
 official:{can:['info','protect'],lv:[1,4],t:function(y){return y<1912?['县衙书吏','刑名师爷','巡检']:(y<1949?['科员','警察分局长','县府秘书']:['科长','公安干部','办公室主任']);}},
 military:{can:['protect','info'],lv:[1,4],t:function(y){return y<1912?['把总','营官','哨官']:(y<1949?['连长','营长','团副']:['连长','武装部长','团政委']);}},
 comrade:{can:['info','protect','intro'],lv:[0,3],t:function(y){return y<1912?['会党兄弟','同志','联络人']:['同志','交通员','老战友'];}},
 doctor:{can:['heal'],lv:[1,3],t:function(y){return y<1912?['郎中','药铺掌柜']:['医生','西医'];}}
};
var NET_XING='王李张刘陈杨黄赵周吴徐孙胡朱高林何郭马罗梁宋郑谢韩唐冯于董萧程曹袁邓许傅沈曾彭吕苏卢蒋蔡贾丁魏薛叶阎余潘杜戴夏钟汪田任姜范方石姚谭廖邹熊金陆郝孔白崔康毛邱秦江史顾侯邵孟龙万段雷钱汤尹黎易常武乔贺赖龚文'.split('');
var NET_MING=['子敬','伯谦','仲甫','季常','少卿','云亭','鹤年','汉臣','守之','慎斋','秉文','立夫','志远','绍棠','兰生','启明','德馨','荣甫','禹门','树人','健侯','耀庭','维新','怀瑾','雨农','觉民','砚秋','敬亭','梦麟','少川','佩之','翰卿','振声','济川','慕韩','月樵'];
function netEnsure(x){ x=x||s; if(!x.net||typeof x.net!=='object'||Array.isArray(x.net)) x.net={}; return x.net; }
function supName(){ var u=supOf&&supOf(); return u?u.n:''; }
function relGetN(n){ if(n===supName()) return supRel(); return getRel(n); }
function relSetN(n,v){ if(n===supName()){ s.supRel=clamp(v); return; } s.rel[n]=clamp(v); }
function netP(n,init){
 var N=netEnsure(s);
 if(!N[n]){ N[n]=init||{t:'',lv:0,can:[],kind:'contact',mem:[],last:s.cal.ord,since:s.cal.ord,owe:0,grudge:0}; }
 var p=N[n]; if(!Array.isArray(p.mem)) p.mem=[]; if(!Array.isArray(p.can)) p.can=[]; if(typeof p.last!=='number') p.last=s.cal.ord;
 return p;
}
function netRemember(n,t){ if(!n||!s) return; var p=netP(n); p.mem.unshift({o:s.cal.ord,t:t}); if(p.mem.length>16) p.mem.length=16; p.last=s.cal.ord; }
function netGrudge(n){ var p=netP(n); p.grudge=(p.grudge||0)+1; }
function netRelAdd(n,d,why){ relSetN(n,relGetN(n)+d); if(why) netRemember(n,why+'（关系 '+dSign(d)+'）'); }
function histOf(n){ var all=[]; Object.keys(PEOPLE).forEach(function(f){ (PEOPLE[f]||[]).forEach(function(p){ if(p.n===n) all.push(p); }); }); return all[0]||null; }
/* 关系网成员：直属上级 + 有往来的人（结交、引荐、互动过的历史人物、同棚弟兄） */
function netNames(){
 var N=netEnsure(s), out=[], sn=supName();
 if(sn) out.push(sn);
 Object.keys(N).forEach(function(n){ if(n!==sn&&!N[n].gone) out.push(n); });
 return out;
}
function netInfoOf(n){
 var sn=supName();
 if(n===sn){ var u=supOf(); var p=netP(n); p.kind='sup'; p.t=u.t; p.lv=Math.min(7,(s.rank||0)+1); p.can=['promote','protect','info','intro']; return p; }
 var q=netP(n);
 if(q.kind==='hist'&&!q.t){ var h=histOf(n); q.t=(h&&h.cl)||'历史人物'; q.lv=(h&&h.rank!==undefined)?Math.max(2,h.rank+2):4; q.can=['promote','intro','protect']; }
 return q;
}
function stanceOf(r){ return r>=85?'至交':r>=70?'亲近':r>=55?'友善':r>=40?'平常':r>=25?'冷淡':'敌视'; }
function netAllies(min){ if(!s) return 0; var c=0; netNames().forEach(function(n){ if(relGetN(n)>=(min||70)) c++; }); return c; }
function netHas(cap,min){ if(!s) return null; var names=netNames(); for(var i=0;i<names.length;i++){ var p=netInfoOf(names[i]); if(p.can.indexOf(cap)>=0&&relGetN(names[i])>=(min||60)) return names[i]; } return null; }
window.__netHas=netHas;
/* 晋升：比你位高、关系≥70 的人肯替你说话，每人抵 1.5 分（有“保举”能力再 +1），合计最多 6 分；请托保举另加 3 分（一年内有效） */
function netPatronBonus(){
 if(!s) return 0;
 var b=0;
 netNames().forEach(function(n){ var p=netInfoOf(n); if(p.lv>(s.rank||0)&&relGetN(n)>=70){ b+=1.5+(p.can.indexOf('promote')>=0?1:0); } });
 b=Math.min(6,b);
 var E=econEnsure(s); if(E.patron&&E.patron.until>=s.cal.ord) b+=3;
 return Math.round(b*10)/10;
}
window.__netPatron=netPatronBonus;
/* 庇护：请托得到的庇护（一年），或关系≥80 且有“庇护”能力的人 */
function netShield(){
 if(!s) return null;
 var E=econEnsure(s); if(E.shield&&E.shield.until>=s.cal.ord) return E.shield.n;
 var names=netNames(); for(var i=0;i<names.length;i++){ var p=netInfoOf(names[i]); if(p.can.indexOf('protect')>=0&&relGetN(names[i])>=80) return names[i]; }
 return null;
}
/* 风险行动：被抓的几率，庇护者可以把人捞出来 */
window.__netRisk=function(p,why){
 if(Math.random()>=p) return '';
 var sh=netShield();
 if(sh){ netRemember(sh,'把你从巡警手里保了出来'); relSetN(sh,relGetN(sh)-3); return '（'+why+'，'+sh+'出面作保，没出大事。）'; }
 s.health=clamp((s.health||100)-6); s.trust=clamp((s.trust||0)-5); s.cash=Math.max(0,(s.cash||0)-0.5);
 econEnsure(s).hit={o:s.cal.ord,trust:5};
 return '（'+why+'，被拘了几天，罚银 '+M(0.5)+'，挨了打。）';
};
function netUnique(){ for(var g=0;g<60;g++){ var n=pick(NET_XING)+pick(NET_MING); if(!s.net[n]&&s.rel[n]===undefined&&n!==supName()) return n; } return pick(NET_XING)+pick(NET_MING)+'甫'; }
/* 新结识一人；返回“身份 姓名” */
function netNew(type,lvBoost,via){
 if(!s) return null;
 var T=NET_TYPES[type]||NET_TYPES.tongxiang;
 var n=netUnique(), lv=Math.round(rnd(T.lv[0],T.lv[1]))+(lvBoost||0);
 lv=Math.max(0,Math.min(7,lv));
 var titles=T.t(s.year||1840);
 var p=netP(n,{t:pick(titles),lv:lv,can:T.can.slice(),kind:'contact',type:type,mem:[],last:s.cal.ord,since:s.cal.ord,owe:0,grudge:0});
 s.rel[n]=Math.round(rnd(48,58));
 netRemember(n,via?('经'+via+'引荐相识'):'初次相识');
 return p.t+n;
}
window.__netNew=netNew;
/* 结伴：给关系网里随机一人加关系 */
window.__netTouch=function(d){ var ns=netNames().filter(function(n){return n!==supName();}); if(!ns.length) return ''; var n=pick(ns); netRelAdd(n,d||3,'结伴同练'); return n; };
/* 打听：有“消息”门路（关系≥60）或身居高位才能打听到下一件大事的日子 */
function nextEventInfo(){
 if(!s) return null;
 var best=null, today=s.cal.ord;
 for(var i=0;i<EVENTS.length;i++){
  var ev=EVENTS[i]; if(s.evDone[ev.id]) continue;
  var d=evDateOf(ev), o=calOrd(ev.y,d[0],d[1]);
  if(o>=today&&o-today<=400&&(!best||o<best.o)) best={o:o,t:ev.t};
 }
 return best;
}
window.__netInfo=function(){
 var src=netHas('info',60), hi=(s.rank||0)>=4||s.isLeader;
 var nx=nextEventInfo();
 if(!src&&!hi){ return s.__rebel?'听说'+s.__rebel.place+'一带不太平。':''; }
 var who=src?('从'+src+'那里得知：'):'从邸报与公文里看出：';
 if(src) netRemember(src,'给你透了消息');
 if(nx) return who+'约在'+calFmtOrd(nx.o).replace(/\d+日$/,'')+'前后恐有大事（'+nx.t+'），宜早作准备。';
 return who+(s.__rebel?(s.__rebel.place+'的'+s.__rebel.n+'约有 '+fmtMen(s.__rebel.arm)+'，官军正在调动。'):'眼下上面没有大动作。');
};
/* 久不往来就淡：两个月没联系，关系每月向 50 回落 1（至交隔月回落）；仇怨每三个月消 1 */
function netDecay(now){
 if(!s) return;
 var today=s.cal.ord;
 /* 生老病死：结识二十五年以上的旧识，每月约千分之八的机会故去 */
 Object.keys(s.net||{}).forEach(function(n){
  var p=s.net[n]; if(p.gone||p.kind!=='contact') return;
  if(today-(p.since||today)>25*365&&Math.random()<0.008){ p.gone=true; netRemember(n,'故去'); log('【人事】旧识'+n+'（'+(p.t||'')+'）故去了。'); }
 });
 netNames().forEach(function(n){
  var p=netInfoOf(n), r=relGetN(n), idle=today-(p.last||today);
  if(idle<60) return;
  if(r>55){ if(r>=85&&now&&now.m%2) return; relSetN(n,r-1); }
  else if(r<45&&now&&now.m%3===0){ relSetN(n,r+1); }
 });
}
/* 人记得你：送礼/拜访的效果受过往恩怨影响 */
function netMemF(n){ var p=netInfoOf(n); return Math.max(0.3,1+0.1*Math.min(3,p.owedYou||0)-0.4*Math.min(1,p.grudge||0)); }
function netTrouble(){
 var E=econEnsure(s), t=[];
 E.loans.forEach(function(l){ if(l.late) t.push({k:'loan',l:l}); });
 if(E.debt>0) t.push({k:'debt'});
 if(E.hit&&s.cal.ord-E.hit.o<=120) t.push({k:'hit'});
 return t;
}
/* 关系网行动：返回 null 表示可做，否则返回原因 */
function netWhy(n,act){
 var p=netInfoOf(n), r=relGetN(n);
 if(SP.cur) return '正在办别的事';
 if(act==='visit'||act==='gift') return null;
 if(act==='favor'){ if(r<60) return '请托需关系≥60（现 '+r+'）'; var f=p.can.filter(function(c){return c!=='loan'&&c!=='intro'&&(c!=='promote'||p.lv>(s.rank||0));}); if(!f.length) return '此人帮不上这类忙'; return null; }
 if(act==='intro'){ if(p.can.indexOf('intro')<0) return '此人没有引荐的门路'; if(r<65) return '引荐需关系≥65（现 '+r+'）'; return null; }
 if(act==='loan'){ if(p.can.indexOf('loan')<0) return '此人不放债'; if((p.grudge||0)>0) return '你欠债不还的事他记着'; if(r<55) return '借贷需关系≥55（现 '+r+'）'; if(econEnsure(s).loans.some(function(l){return l.from===n;})) return '前一笔借款未还清'; return null; }
 if(act==='plead'){ if(p.can.indexOf('protect')<0) return '此人说不上话'; if(r<70) return '求情需关系≥70（现 '+r+'）'; if(!netTrouble().length) return '眼下没有需要求情的事'; return null; }
 return null;
}
function netLoanAmt(n){ var p=netInfoOf(n); return _r2([5,15,50,150,500,1500,5000,20000][Math.max(0,Math.min(7,p.lv))]*relGetN(n)/100); }
function netAct(n,act,sub){
 if(!s||!n) return;
 var why=netWhy(n,act); if(why){ flash(why); return; }
 var key='net:'+act+':'+n, p=netInfoOf(n);
 if(!actGate(key,(DUR_LABEL['net:'+act]||'')+n)) return;
 var r=relGetN(n), d, txt='';
 if(act==='visit'){
  var c=_r2(0.1*(p.lv+1)); s.cash=Math.max(0,(s.cash||0)-c);
  d=Math.round(rnd(3,7)*netMemF(n)); relSetN(n,r+d); netRemember(n,'登门叙谈（关系 '+dSign(d)+'）');
  if(p.kind==='sup') addExp('trust',4);
  txt='去'+n+'处坐了半日，带了些茶点（'+M(c)+'）。';
 }else if(act==='gift'){
  var g=giftCost(p.lv); if((s.cash||0)<g){ flash('礼金不够：给'+p.t+'备礼约需 '+M(g)); return; }
  s.cash-=g; d=Math.round(rnd(6,12)*netMemF(n)); relSetN(n,r+d); netRemember(n,'收下你送的礼（'+M(g)+'，关系 '+dSign(d)+'）');
  p.owedYou=(p.owedYou||0)+(g>=giftCost(p.lv)?0.5:0);
  txt='送去 '+M(g)+' 的礼，'+n+'收下了。';
 }else if(act==='favor'){
  var cap=sub;
  if(cap==='promote'){ econEnsure(s).patron={n:n,until:s.cal.ord+365}; addExp('trust',4); txt=n+'答应在上头替你说话（一年内晋升门槛 −3）。'; }
  else if(cap==='info'){ txt=window.__netInfo()||(n+'说眼下没什么风声。'); }
  else if(cap==='deal'){ var gain=_r2(rnd(0.5,2)*((s.rank||0)+1)*(1+p.lv/4)); s.cash=(s.cash||0)+gain; addExp('skill',2); txt=n+'介绍了一笔生意，你从中得 '+M(gain)+'。'; }
  else if(cap==='protect'){ econEnsure(s).shield={n:n,until:s.cal.ord+365}; txt=n+'答应遇事替你出头（一年内有效）。'; }
  else if(cap==='skill'){ addExp('skill',10); txt=n+'指点了你半月，受益匪浅。'; }
  else if(cap==='heal'){ var hc=_r2(0.3*(p.lv+1)); s.cash=Math.max(0,(s.cash||0)-hc); s.health=clamp((s.health||100)+10); txt=n+'替你看了病，药钱 '+M(hc)+'。'; }
  else return;
  var cost=r>=85?0:4; relSetN(n,r-cost); p.owe=(p.owe||0)+1; netRemember(n,'替你'+(NET_CAN[cap]||'办事')+'，你欠下一份人情'+(cost?'（关系 -'+cost+'）':''));
 }else if(act==='intro'){
  var types=p.type?[p.type]:['scholar','official','gentry']; if(p.kind==='sup') types=['official','military','gentry'];
  var nn=netNew(pick(types),1,n); relSetN(n,r-3); netRemember(n,'为你引荐了'+nn+'（关系 -3）');
  var hp=visiblePeople().filter(function(h){ return !s.net[h.n]&&getRel(h.n)<=55; });
  if(p.lv>=4&&hp.length&&Math.random()<0.5){ var h=pick(hp); s.rel[h.n]=Math.max(getRel(h.n),58); netP(h.n).kind='hist'; netRemember(h.n,'经'+n+'引荐得见'); txt='经'+n+'引荐，你见到了'+h.n+'，也结识了'+nn+'。'; }
  else txt='经'+n+'引荐，结识了'+nn+'。';
 }else if(act==='loan'){
  var amt=netLoanAmt(n), rate=r>=75?0.01:0.02;
  var E=econEnsure(s); E.loans.push({from:n,amt:amt,rate:rate,since:s.cal.ord,due:s.cal.ord+365});
  s.cash=(s.cash||0)+amt; netRemember(n,'借给你 '+M(amt)+'，月息 '+Math.round(rate*100)+' 分，一年为期');
  txt='向'+n+'借得 '+M(amt)+'，月息 '+Math.round(rate*100)+' 分，'+calFmtOrd(s.cal.ord+365)+'到期。';
 }else if(act==='plead'){
  var tr=netTrouble()[0], E2=econEnsure(s);
  if(tr.k==='loan'){ tr.l.due=s.cal.ord+180; tr.l.late=false; if(tr.l.from!==n){ relSetN(tr.l.from,relGetN(tr.l.from)+5); netRemember(tr.l.from,n+'替你担保，宽限半年'); } txt=n+'出面担保，'+tr.l.from+'的借款宽限半年。'; }
  else if(tr.k==='debt'){ var cover=_r2(Math.min(E2.debt,netLoanAmt(n)*0.6+5)); E2.debt=_r2(E2.debt-cover); E2.loans.push({from:n,amt:cover,rate:0,since:s.cal.ord,due:s.cal.ord+730}); txt=n+'替你垫还了 '+M(cover)+' 的债，不要利息，两年内还。'; }
  else { var back=Math.ceil((E2.hit.trust||4)/2); s.trust=clamp((s.trust||0)+back); E2.hit=null; txt=n+'替你在上头求了情，挽回些信任。'; }
  relSetN(n,r-6); p.owe=(p.owe||0)+1; netRemember(n,'替你求情（关系 -6）');
 }
 actCool(key,DUR_FIX['net:'+act]);
 log('【人情】'+txt);
 persist(); render();
}
function netRepay(i){
 var E=econEnsure(s), l=E.loans[i]; if(!l) return;
 if(!actGate('net:repay:'+l.from,'还钱给'+l.from)) return;
 if((s.cash||0)<l.amt){ flash('现银不够：还清需 '+M(l.amt)+'，手上 '+M(s.cash||0)); return; }
 s.cash=_r2(s.cash-l.amt); E.loans.splice(i,1);
 var d=l.late?2:5; relSetN(l.from,relGetN(l.from)+d);
 var p=netP(l.from); p.owedYou=(p.owedYou||0)+0.5;
 netRemember(l.from,(l.late?'你迟了些，总算把钱还上':'你按期还清借款')+'（关系 +'+d+'）');
 actCool('net:repay:'+l.from,2);
 log('【人情】还清'+l.from+'的借款 '+M(l.amt)+'。');
 persist(); render();
}
window.__netAct=netAct; window.__netRepay=netRepay; window.__netWhy=netWhy;
/* 互动造成的关系变化自动记入此人的“往来记录” */
function netDiffMemory(a,b,label){
 if(!a||!b||!s) return;
 Object.keys(b.rel).forEach(function(n){
  var was=(a.rel[n]===undefined)?50:a.rel[n], d=b.rel[n]-was;
  if(Math.abs(d)<1) return;
  var p=s.net&&s.net[n];
  if(!p){ if(!histOf(n)) return; p=netP(n); p.kind='hist'; }
  if(p.mem[0]&&p.mem[0].o===s.cal.ord&&/关系/.test(p.mem[0].t)) return;   /* 本次已有具体记录 */
  netRemember(n,(label||'往来')+'（关系 '+dSign(Math.round(d))+'）');
 });
 if(b.supRel!==a.supRel){ var sn=supName(); var sp=s.net&&s.net[sn]; if(!(sp&&sp.mem[0]&&sp.mem[0].o===s.cal.ord)) netRemember(sn,(label||'往来')+'（关系 '+dSign(b.supRel-a.supRel)+'）'); }
}
var _spPopupV4185=spPopup;
spPopup=function(c,instant){ try{ netDiffMemory(c.pre,c.after||spSnap(),c.label); }catch(e){} return _spPopupV4185(c,instant); };

/* 关系网卡片 */
function netCardHTML(){
 var names=netNames();
 var rows=names.map(function(n){ return {n:n,p:netInfoOf(n),r:relGetN(n)}; }).sort(function(a,b){ return (b.p.kind==='sup')-(a.p.kind==='sup')||b.r-a.r; });
 var allies=rows.filter(function(x){return x.r>=70;}).length, foes=rows.filter(function(x){return x.r<30;}).length;
 var pb=netPatronBonus(), sh=netShield();
 var h='<p class="small muted" style="margin:0 0 6px">共 '+rows.length+' 人 · 亲近 '+allies+' · 敌视 '+foes+
  ' · 晋升保举 +'+pb+' · 跑关系省时 '+Math.round((1-netSpeed('net:visit'))*100)+'%'+(sh?' · 有人庇护：'+sh:'')+'</p>';
 if(!rows.length) return h+'<p class="small muted">还没有往来的人。去「结交」认识人，或拜访历史人物。</p>';
 var total=rows.length;
 if(!NET_UI.all&&rows.length>10) rows=rows.slice(0,10);
 rows.forEach(function(x){
  var p=x.p, today=s.cal.ord, idle=today-(p.last||today);
  var cans=p.can.map(function(c){return '<span class="net-can">'+NET_CAN[c]+'</span>';}).join('');
  var btns='', whys=[];
  [['visit','拜访'],['gift','送礼'],['favor','请托'],['intro','引荐'],['loan','借贷'],['plead','求情']].forEach(function(a){
   if((a[0]==='loan'&&p.can.indexOf('loan')<0)||(a[0]==='intro'&&p.can.indexOf('intro')<0)||(a[0]==='plead'&&p.can.indexOf('protect')<0)) return;
   var w=netWhy(x.n,a[0]);
   var extra=a[0]==='gift'?'（'+M(giftCost(p.lv))+'）':(a[0]==='loan'&&!w?'（'+M(netLoanAmt(x.n))+'）':'');
   btns+='<button class="btn sm" data-net="'+a[0]+'" data-nn="'+x.n+'" data-cd="net:'+a[0]+':'+x.n+'"'+(w?' disabled title="'+w+'"':'')+'>'+a[1]+extra+'</button>';
   if(w&&a[0]!=='visit'&&a[0]!=='gift') whys.push(a[1]+'：'+w);
  });
  h+='<div class="net-row"><div class="net-top"><b class="net-name" data-np="'+x.n+'">'+x.n+'</b><span class="small muted">'+(p.t||'')+'</span>'+
   '<span class="net-st s'+(x.r>=70?'hi':x.r<40?'lo':'mid')+'">'+stanceOf(x.r)+' '+x.r+'</span></div>'+
   '<div class="bar"><i style="width:'+x.r+'%"></i></div>'+
   '<div class="small muted">能帮你：'+(cans||'—')+' · 上次往来 '+(idle<=0?'今天':idle+' 天前')+(p.grudge?' · <span style="color:var(--red)">记着你的旧账</span>':'')+'</div>'+
   '<div class="pbtns">'+btns+'<button class="btn sm" data-np="'+x.n+'">往来记录</button></div>'+
   (whys.length?'<div class="net-why">'+whys.join('；')+'</div>':'')+'</div>';
 });
 if(total>10) h+='<button class="btn sm" data-netall="1" style="margin-top:6px">'+(NET_UI.all?'只看前 10 人':'显示全部 '+total+' 人')+'</button>';
 return h;
}
var NET_UI={all:false};
function netRender(){
 if(!s) return;
 var old=document.getElementById('v42net'); if(old&&old.parentNode) old.parentNode.removeChild(old);
 var card=document.getElementById('cardNet');
 if(!card){
  var anchor=document.getElementById('peopleBox'); if(!anchor) return;
  var host=anchor.closest?anchor.closest('.card'):null; if(!host||!host.parentNode) return;
  card=document.createElement('div'); card.className='card'; card.id='cardNet';
  card.innerHTML='<h2>关系网</h2><div id="netBox"></div>';
  host.parentNode.insertBefore(card,host);
  card.addEventListener('click',function(e){
   var b=e.target.closest('[data-net]'); if(b&&!b.disabled){ var a=b.getAttribute('data-net'), n=b.getAttribute('data-nn'); if(a==='favor') netFavorMenu(n); else netAct(n,a); return; }
   var q=e.target.closest('[data-np]'); if(q){ netProfile(q.getAttribute('data-np')); return; }
   var al=e.target.closest('[data-netall]'); if(al){ NET_UI.all=!NET_UI.all; netRender(); }
  });
 }
 var box=document.getElementById('netBox'), html=netCardHTML();
 if(box&&box.innerHTML!==html) box.innerHTML=html;
}
function netFavorMenu(n){
 var p=netInfoOf(n), body=$('dlgBody');
 $('dlgTag').textContent='请托 · '+n; $('dlgTitle').textContent='托'+n+'办什么事？';
 $('dlgDesc').textContent='请托会用掉人情（关系 −4，至交不减），约 '+dayCost('net:favor',DUR_FIX['net:favor'])+' 天。';
 body.innerHTML='';
 p.can.forEach(function(c){
  if(c==='loan'||c==='intro') return;
  var dis=(c==='promote'&&p.lv<=(s.rank||0));
  var d={promote:'请他在上头替你说话：一年内晋升门槛 −3。',info:'打听下一件大事的风声。',deal:'介绍一笔生意。',protect:'一年内遇事替你出头（欠债、被拘时可挡一挡）。',skill:'请他指点学问或手艺：能力提升。',heal:'请他看病：健康 +10，付些药钱。'}[c];
  var b=document.createElement('button'); b.className='choice';
  b.innerHTML='<b>'+NET_CAN[c]+'</b><div class="sub">'+d+'</div>'+(dis?'<div class="chance" style="color:var(--red)">他的位置不比你高，保举无从谈起</div>':'');
  if(dis) b.disabled=true; else b.onclick=function(){ netAct(n,'favor',c); };
  body.appendChild(b);
 });
 var x=document.createElement('button'); x.className='btn'; x.textContent='算了'; x.onclick=function(){ $('mask').classList.add('hidden'); }; body.appendChild(x);
 $('mask').classList.remove('hidden');
}
function netProfile(n){
 var p=netInfoOf(n), r=relGetN(n), body=$('dlgBody');
 $('dlgTag').textContent='人物档案'; $('dlgTitle').textContent=n+(p.t?' · '+p.t:'');
 $('dlgDesc').textContent='关系 '+r+'（'+stanceOf(r)+'）· 地位约第 '+(p.lv+1)+' 级 · 能帮你：'+(p.can.map(function(c){return NET_CAN[c];}).join('、')||'—')+(p.owe?' · 你欠他 '+p.owe+' 份人情':'');
 var mem=(p.mem||[]).map(function(m){ return '<li>'+calFmtOrd(m.o)+'　'+m.t+'</li>'; }).join('');
 body.innerHTML='<div class="rp"><div class="rp-sec"><b>往来记录</b>'+(mem?'<ul>'+mem+'</ul>':'<p class="small muted">还没有往来。</p>')+'</div></div>';
 if(p.kind==='hist'){ var st=document.createElement('button'); st.className='choice'; st.setAttribute('data-cd','rel:stand:'+n); st.innerHTML='<b>公开表态</b><div class="sub">当众说出与他不同的主张：声望上升，关系受损。约 '+dayCost('rel:stand',5)+' 天。</div>'; st.onclick=function(){ relAct(n,'stand'); try{ netGrudge(n); }catch(e){} }; body.appendChild(st); }
 var x=document.createElement('button'); x.className='choice'; x.style.textAlign='center'; x.innerHTML='<b>关闭</b>'; x.onclick=function(){ $('mask').classList.add('hidden'); }; body.appendChild(x);
 $('mask').classList.remove('hidden');
}
window.__netProfile=netProfile; window.__netFavor=netFavorMenu;

/* 历史人物的拜访/请教/共事：结果并入统一结果提示，不再单独弹窗 */
showResult=function(name,kind,delta,extraText){
 $('mask').classList.add('hidden');
 var t=delta>=8?name+'对你颇为受用。':delta>=3?name+'点了点头，表示认可。':delta>=-2?name+'反应平淡。':delta>=-6?name+'面露不悦。':name+'明显被触怒了。';
 try{ var p=netP(name); if(!p.kind||p.kind==='contact'){ if(histOf(name)) p.kind='hist'; } }catch(e){}
 log('【'+kind+'】'+t+(extraText?extraText:''));
 persist(); render();
};

/* ---------- 6. 生计卡（只放个人生计） ---------- */
function liveRender(){
 if(!s) return;
 var card=document.getElementById('cardLive');
 if(!card){
  var act=document.getElementById('actTitle'); var ac=act&&act.closest?act.closest('.card'):null; if(!ac||!ac.parentNode) return;
  card=document.createElement('div'); card.className='card'; card.id='cardLive';
  card.innerHTML='<h2>生计账簿</h2><div id="liveBox"></div>';
  ac.parentNode.insertBefore(card,ac.nextSibling);
  card.addEventListener('click',function(e){ var b=e.target.closest('[data-repay]'); if(b&&!b.disabled) netRepay(+b.getAttribute('data-repay')); });
 }
 var E=econEnsure(s), it=econItems(s), inc=sumItems(it.pay), exp=sumItems(it.cost), n=liveHousehold(s);
 var fmt=function(a){ return a.map(function(p){ return '<tr><td>'+p[0]+'</td><td class="num">'+M(p[1])+'</td></tr>'; }).join(''); };
 var h='<div class="live-top"><div><span class="small muted">现银</span><b>'+M(s.cash||0)+'</b></div>'+
  '<div><span class="small muted">每月进项</span><b class="up">'+M(inc)+'</b></div>'+
  '<div><span class="small muted">每月开销</span><b class="down">'+M(exp)+'</b></div>'+
  '<div><span class="small muted">月结余</span><b class="'+(inc-exp>=0?'up':'down')+'">'+(inc-exp<0?'-':'')+M(Math.abs(inc-exp))+'</b></div></div>';
 h+='<p class="small muted" style="margin:6px 0">职位：'+rankTitleOf()+' · 家口 '+n+' 人 · 居 '+(s.region||'—')+' · 通行 '+curName()+(E.debt>0?' · <span style="color:var(--red)">欠债 '+M(E.debt)+'（月息 3 分）</span>':'')+'</p>';
 h+='<div class="live-cols"><table class="live-t"><tr><th colspan="2">每月进项（估）</th></tr>'+(fmt(it.pay)||'<tr><td colspan="2" class="muted">无固定进项</td></tr>')+'</table>'+
  '<table class="live-t"><tr><th colspan="2">每月开销（估）</th></tr>'+fmt(it.cost)+'</table></div>';
 if(E.loans.length){
  h+='<div class="small" style="margin-top:6px"><b>借款</b>'+E.loans.map(function(l,i){ return '<div class="live-loan">'+l.from+' · '+M(l.amt)+' · 月息 '+Math.round(l.rate*100)+' 分 · '+calFmtOrd(l.due)+'到期'+(l.late?' <span style="color:var(--red)">已逾期</span>':'')+
   ' <button class="btn sm" data-repay="'+i+'" data-cd="net:repay:'+l.from+'"'+((s.cash||0)<l.amt?' disabled title="现银不够"':'')+'>还清</button>'+((s.cash||0)<l.amt?'<span class="net-why">现银不够还清</span>':'')+'</div>'; }).join('')+'</div>';
 }
 if(E.last) h+='<p class="small muted" style="margin:6px 0 0">上月（'+E.last.y+'年'+E.last.m+'月）实收 '+M(E.last.inc)+'，实支 '+M(E.last.exp)+'。每月 1 日自动结算；入不敷出转为欠债。</p>';
 else h+='<p class="small muted" style="margin:6px 0 0">每月 1 日自动结算上月收支；入不敷出转为欠债，欠债伤身、伤名，严重时债主上门。</p>';
 if(s.unit&&isMil()) h+='<p class="small muted" style="margin:2px 0 0">公费（不是私产，可用于招募等）：'+M(s.fund||0)+'</p>';
 var box=document.getElementById('liveBox'); if(box&&box.innerHTML!==h) box.innerHTML=h;
}

/* ---------- 7. 军情卡 + 国势参考值 ---------- */
var REGION_PROV={'直隶':'河北省','江浙':'江苏省','两广':'广东省','湘鄂':'湖北省','四川':'四川省','关外':'辽宁省'};
function milRender(){
 if(!s||!world) return;
 var card=document.getElementById('cardMilInfo');
 if(!card){
  var g=document.getElementById('cardUnit'); if(!g||!g.parentNode) return;
  card=document.createElement('div'); card.className='card'; card.id='cardMilInfo';
  card.innerHTML='<h2>军情</h2><div id="milInfoBox"></div>';
  g.parentNode.insertBefore(card,g);
 }
 var y=s.year, tot=refAt(REF_ARMY,y)*10000, hi=(s.rank||0)>=4||s.isLeader||isMil();
 var prov=REGION_PROV[s.region]||'河北省', R=(world.regions||{})[prov]||{ctrl:s.faction,str:45};
 var gar=garrisonOf(R.ctrl,R.str,y);
 var h='<p class="small" style="margin:0 0 4px">全国各方常备武装合计约 <b>'+fmtMen(tot)+'</b>（'+y+'年估算）。</p>';
 h+='<p class="small" style="margin:0 0 4px">'+(s.region||'本地')+'（'+prov.replace(/省|市/,'')+'）驻军'+(hi?'约 <b>'+fmtMen(gar)+'</b>':'，'+'茶馆里说有'+fmtMen(Math.round(gar/10000+0.5)*10000)+'上下（传闻）')+'，属'+(CTRL_NAME[R.ctrl]||R.ctrl)+'。</p>';
 if(s.unit&&isMil()){
  var est=UNIT_EST[Math.max(0,Math.min(7,s.rank||0))];
  h+='<p class="small" style="margin:0 0 4px">你的部伍：实有 '+fmtMen(s.unit.troops)+' / 编制约 '+fmtMen(est)+'。</p>';
 }
 if(s.__rebel) h+='<p class="small" style="margin:0 0 4px;color:var(--red)">未平之乱：'+s.__rebel.place+'的'+s.__rebel.n+'，约 '+fmtMen(s.__rebel.arm)+'。</p>';
 if(s.isLeader||(s.rank||0)>=5){
  var list=Object.keys(world.regions||{}).map(function(p){ var r=world.regions[p]; return {p:p,n:garrisonOf(r.ctrl,r.str,y),c:r.ctrl}; }).sort(function(a,b){return b.n-a.n;}).slice(0,5);
  h+='<div class="small muted">重兵所在：'+list.map(function(x){ return x.p.replace(/省|市|自治区|特别行政区|壮族|回族|维吾尔/g,'')+' '+fmtMen(x.n); }).join('，')+'</div>';
 }else h+='<div class="small muted">再往上的兵力部署，你这个位置看不到。</div>';
 var box=document.getElementById('milInfoBox'); if(box&&box.innerHTML!==h) box.innerHTML=h;
}
function natlExtra(){
 var box=document.getElementById('natlBox'); if(!box||!s) return;
 var ex=document.getElementById('natlRef');
 var y=s.year, E=econEnsure(s);
 var h='<div class="small" style="margin-top:6px;line-height:1.8">人口约 <b>'+fmtNum(refAt(REF_POP,y),2)+' 亿</b> · 全年财政收入约 <b>'+M(refAt(REF_REV,y)*1e4)+'</b> · 全国常备武装约 <b>'+fmtMen(refAt(REF_ARMY,y)*10000)+'</b>'+
  (s.isLeader?'<br>国库存银约 <b>'+M(E.state.res*1e4)+'</b>（随财政指数盈亏）':'')+'<br><span class="muted">币制：'+curName()+'；数值为历史估算，见说明。</span></div>';
 if(!ex){ ex=document.createElement('div'); ex.id='natlRef'; box.appendChild(ex); }
 if(ex.innerHTML!==h) ex.innerHTML=h;
 if(ex.parentNode!==box) box.appendChild(ex);
}

/* ---------- 8. 分页：每页只放自己的内容 ---------- */
var TAB_TITLE={
 '晋升之路':'gov','生计账簿':'gov',
 '关系网':'ppl','历史人物':'ppl','同期人物':'ppl','组织与结社':'ppl','派系':'ppl','人际':'ppl','麾下人才':'ppl',
 '军情':'mil','兵力 / 粮草':'mil','列强':'mil','国力对比':'mil','战事':'mil','战事图':'mil','内乱':'mil',
 '时代纪事':'pol','国势':'pol','制度运转':'pol','派系与权力格局':'pol','动态世界局势':'pol','年度报纸':'pol','中国形势图':'pol mil',
 '身体':'arc','个人编年史':'arc','存档':'arc','结局':'arc'
};
window.__tabCat=function(card,title){
 if(!card) return 'all';
 var id=card.id||'';
 if(card.querySelector('#hName')||card.querySelector('#actTitle')||id==='cardLive') return 'gov';
 if(id==='cardUnit'||id==='cardMilInfo'||card.getAttribute('data-role')==='own') return 'mil';
 if(id==='cardNet'||card.querySelector('#peopleBox')) return 'ppl';
 if(card.querySelector('#slotSel')||card.querySelector('#logs')) return 'arc';
 if(card.querySelector('#chinaMap')) return 'pol mil';
 if(card.querySelector('#curEvent')) return 'pol';
 return TAB_TITLE[title]||'all';
};

/* ---------- 9. 按钮上的预计天数（取代冷却标注） ---------- */
calDecorate=function(){
 if(!s) return;
 NET_ALLY_MEMO=netAllies(70);
 try{ calDecorateInner(); }finally{ NET_ALLY_MEMO=null; }
};
function calDecorateInner(){
 var els=document.querySelectorAll('[data-cd]');
 for(var i=0;i<els.length;i++){
  var el=els[i], key=el.getAttribute('data-cd'), b=actBusy(key), note=el.querySelector('.cdnote');
  var txt='';
  if(b){ if(!el.disabled){ el.disabled=true; el.setAttribute('data-cdoff','1'); } txt='进行中 · '+calShort(b.until)+'完成'; el.title=actBusyText(b); }
  else{
   if(el.getAttribute('data-cdoff')){ el.disabled=false; el.removeAttribute('data-cdoff'); }
   var act=el.getAttribute('data-act'), deny=act&&window.__actDeny?window.__actDeny(act):null;
   if(deny){ txt='不可：'+deny; if(!el.disabled){ el.disabled=true; el.setAttribute('data-denied','1'); } el.title=deny; }
   else { if(el.getAttribute('data-denied')){ el.disabled=false; el.removeAttribute('data-denied'); } txt=dayHint(key); }
  }
  if(txt){ if(!note){ note=document.createElement('span'); note.className='cdnote dur'; el.appendChild(note); } if(note.textContent!==txt) note.textContent=txt; }
  else if(note) note.parentNode.removeChild(note);
 }
}
calRenderJobs=function(){
 if(!s) return;
 var t=document.getElementById('actTitle'); if(!t) return;
 var card=t.closest?t.closest('.card'):null; if(!card) return;
 var box=document.getElementById('calJobs');
 if(!box){ box=document.createElement('div'); box.id='calJobs'; box.className='cal-jobs'; card.appendChild(box); }
 var today=s.cal.ord, h='';
 (s.jobs||[]).forEach(function(j){
  var tot=Math.max(1,j.end-j.start), pct=Math.max(0,Math.min(100,Math.round((today-j.start)/tot*100)));
  h+='<div class="cal-job"><div class="small"><b>'+j.label+'</b> · 预计 '+calFmtOrd(j.end)+' 完成（还需 '+Math.max(0,j.end-today)+' 天）</div><div class="bar"><i style="width:'+pct+'%"></i></div></div>';
 });
 if(!h) h='';   /* V4.18.6：无在建工程时不重复说明（卡片顶部已有） */
 if(box.innerHTML!==h) box.innerHTML=h;
};
ACT_HINT_TEXT='每件事都要花时间：按钮上标着大约天数（随能力、职位、人脉与时局浮动）；确认后日历随即推进，期间每月照常结算生计。';
/* 原先的“提示”写在存档卡里，别的分页看不见；改为浮动提示 */
var _flashV4185=flash;
flash=function(t){ try{ _flashV4185(t); }catch(e){} calToast(t); };

/* ---------- 10. 晋升：关系保举 ---------- */
FEE=[0,0,10,80,300,800,2000,5000];
/* ---------- 11. 能力/声望成长：越往上越慢，按实际投入的时间累积 ---------- */
addExp=function(attr,amount){
 if(!s||!attr) return;
 var v=+s[attr]||0, a=+amount||0;
 if(!s.frac||typeof s.frac!=='object') s.frac={};
 var g=a>0?a*0.1*Math.max(0.15,1-v/110):a*0.12;
 var t=(s.frac[attr]||0)+g, whole=t>0?Math.floor(t):Math.ceil(t);
 s.frac[attr]=t-whole;
 if(whole) s[attr]=clamp(v+whole);
};

/* ---------- 12. 开局与旧档迁移 ---------- */
var START_CASH={'皇室家庭':5000,'乡绅家庭':60,'商人家庭':40,'军人家庭':6,'知识分子家庭':12,'普通家庭':3};
var START_ROLE={soldier:1,officer:6,official:4,student:2,merchant:25,activist:1};
var START_TIER={0:0,2:60,5:1500,7:20000};
function realisticStart(){
 if(!s) return;
 var R=Math.max(0,Math.min(7,s.rank||0));
 var c=(START_CASH[s.origin]||3)+(START_ROLE[s.role]||0)+(START_TIER[R]||0);
 if(s.isThrone) c=200000; else if(s.isLeader) c=Math.max(c,20000);
 c*=({'江浙':1.3,'两广':1.2,'关外':1.1,'四川':1.0,'直隶':1.1,'湘鄂':0.9})[s.region]||1;
 s.cash=_r2(c);
 s.fund=_r2(FUND_MONTH[R]*3);
 if(s.unit){ s.unit.troops=isMil()?Math.round(UNIT_EST[R]*rnd(0.75,0.95)):0; }
 econEnsure(s); netEnsure(s);
 s.econ.state={res:Math.round(refAt(REF_REV,s.year)*0.25)};
 delete s.cooldowns;
}
function migrate4185(fresh){
 if(!s) return;
 calEnsure(s);
 if(s.cooldowns&&Object.keys(s.cooldowns).length){ s.cooldownsDropped=Object.keys(s.cooldowns).length; }
 s.cooldowns={};
 econEnsure(s); netEnsure(s);
 if(!s.frac) s.frac={};
 /* 旧档的人际名单（s.met）并入关系网 */
 (s.met||[]).forEach(function(n){ if(!s.net[n]){ var p=netP(n); p.t='旧识'; p.lv=1; p.can=['info']; } });
 if(s.unit&&isMil()&&(s.unit.troops||0)<UNIT_EST[Math.max(0,Math.min(7,s.rank||0))]*0.3&&!s.unit.v4185){ s.unit.troops=Math.round(UNIT_EST[Math.max(0,Math.min(7,s.rank||0))]*0.8); }
 if(s.unit) s.unit.v4185=1;
 s.v4185=1;
}
var _initV4185=init;
init=function(){
 _initV4185.apply(null,arguments);
 if(!s) return;
 realisticStart(); migrate4185(true);
 try{ s.cal.yearSnap=calSnap(); }catch(e){}   /* 年度报告的“年初”以写实的起始现银为准 */
 SP.req=null; SP.cur=null; SP.pre=null; SP.popup=null;
 try{ if(window.__RENDER) window.__RENDER(); }catch(e){}
};
var _applySaveV4185=applySave;
applySave=function(d){
 SP.req=null; SP.cur=null; SP.pre=null; SP.popup=null;
 var r=_applySaveV4185.apply(this,arguments);
 if(s){ migrate4185(false); try{ if(window.__RENDER) window.__RENDER(); }catch(e){} }
 return r;
};
var _packV4185=packSave;
packSave=function(){ var o=_packV4185.apply(null,arguments); o.v='4.18.6'; return o; };

/* ---------- 13. 渲染接线 ---------- */
var _renderV4185=render;
render=function(){
 _renderV4185.apply(null,arguments);
 if(!s) return;
 try{ econEnsure(s); netEnsure(s); }catch(e){}
 try{ liveRender(); }catch(e){ if(window.console) console.error(e); }
 try{ netRender(); }catch(e){ if(window.console) console.error(e); }
 try{ milRender(); }catch(e){ if(window.console) console.error(e); }
 try{ natlExtra(); }catch(e){}
 try{ var cr=document.getElementById('cardRel'); if(cr) cr.style.display='none'; }catch(e){}   /* 旧“人际”卡并入关系网 */
 try{
  var hc=document.getElementById('hudCash'); if(hc){ var t=M(s.cash||0)+((s.econ&&s.econ.debt>0)?' · 欠 '+M(s.econ.debt):''); if(hc.textContent!==t) hc.textContent=t; }
  var tc=document.getElementById('tCash'); if(tc){ tc.textContent='现银 '+M(s.cash||0); tc.className=(s.econ&&s.econ.debt>0)?'tag warn':'tag'; }
  var tf=document.getElementById('tFund'); if(tf) tf.textContent='公费 '+M(s.fund||0);
  var ta=document.getElementById('tAp'); if(ta) ta.textContent=(s.jobs&&s.jobs.length)?('在建工程 '+s.jobs.length+' 项'):'';
 }catch(e){}
 try{ calDecorate(); calRenderJobs(); }catch(e){}
};
window.__V4185={sp:SP,snap:spSnap,mark:spMark,begin:spBegin,run:spRun,tick:spTick,instant:spInstant,econMonth:econMonth,netNames:netNames,netAct:netAct,netWhy:netWhy,
 dayCost:dayCost,dayHint:dayHint,patron:netPatronBonus,shield:netShield,M:M,curOf:curOf,garrisonOf:garrisonOf,refAt:refAt,REF:{pop:REF_POP,rev:REF_REV,army:REF_ARMY},
 pay:livePayItems,cost:liveCostItems,household:liveHousehold,netNew:netNew,netRender:netRender,liveRender:liveRender};
/* 测试与外部调用：先 mark（记下点击前状态），再执行行动，再 flush（开始推进） */
/* window.__CAL 在 V4.17 段落里按旧函数取值，这里换成 V4.18.5 的版本 */
window.__CAL.loop=calLoop; window.__CAL.busy=actBusy; window.__CAL.gate=actGate; window.__CAL.cool=actCool; window.__actBusy=actBusy;
window.__CAL.mark=spMark;
window.__CAL.flushSpend=function(){ if(SP.req&&!SP.cur) spBegin(); else if(SP.cur) spRun(); return !SP.cur; };
window.__CAL.spending=function(){ return SP.cur?{label:SP.cur.label,from:SP.cur.from,to:SP.cur.to,n:SP.cur.n}:null; };

/* ================= V4.18.6：取消实时时钟，时间只随行动与「静待时日」推进 =================
   - 不再有暂停/正常/快速/极速与空格键；CLOCK.speed 恒为 0，calLoop 只负责弹出到期事件、续跑行动、刷新界面。
   - 「静待时日」：7 天 / 30 天 / 到下个月初 / 到下一个历史事件，逐日走同一条每日/每月/年末管线（与行动相同的推进器）。
     途中遇到历史抉择或重大事件（内乱、开战等）即提前停下；年度报告照常弹出，看完后接着等。
   - 旧档里的速度偏好（s.cal.speedPref）一律忽略。 */
calSetSpeed=function(){ CLOCK.speed=0; CLOCK.acc=0; if(s&&s.cal) delete s.cal.speedPref; try{ calClockUI(true); }catch(e){} };
document.__calKey=1;   /* 不再绑定空格键 */
var _calPauseV4186=calPause;
calPause=function(reason){
 CLOCK.speed=0; CLOCK.acc=0;
 if(SP.cur&&SP.cur.key==='wait'&&s&&SP.cur.to>s.cal.ord){ SP.cur.to=s.cal.ord; SP.cur.label='静待时日（因'+String(reason||'要事').slice(0,30)+'提前停下）'; }
};
var _showEventV4186=showEvent;
showEvent=function(ev){
 if(SP.cur&&SP.cur.key==='wait'&&s&&SP.cur.to>s.cal.ord){ SP.cur.to=s.cal.ord; SP.cur.label='静待时日（'+(ev&&ev.t?ev.t:'历史抉择')+'）'; }
 return _showEventV4186.apply(this,arguments);
};
function waitNextEventOrd(){
 if(!s||!s.cal) return null;
 var today=s.cal.ord, best=null;
 for(var i=0;i<EVENTS.length;i++){
  var ev=EVENTS[i]; if(s.evDone[ev.id]) continue;
  var d=evDateOf(ev), o=calOrd(ev.y,d[0],d[1]);
  if(o>today&&o<=CAL_END_ORD&&(!best||o<best.o)) best={o:o,t:ev.t};
 }
 return best;
}
function waitOptions(){
 if(!s||!s.cal) return [];
 var t=calFromOrd(s.cal.ord), nm=t.m===12?calOrd(t.y+1,1,1):calOrd(t.y,t.m+1,1), ne=waitNextEventOrd(), left=CAL_END_ORD-s.cal.ord;
 var o=[
  {k:'d7',label:'静待 7 天',n:7},
  {k:'d30',label:'静待 30 天',n:30},
  {k:'month',label:'到下个月初',n:nm-s.cal.ord,sub:calFmtOrd(nm)},
  {k:'event',label:'到下一个历史事件',n:ne?ne.o-s.cal.ord:0,sub:ne?(calFmtOrd(ne.o)+' · '+ne.t):'此后没有已知的历史事件'}
 ];
 o.forEach(function(x){ x.n=Math.max(0,Math.min(x.n,left)); if(!x.sub) x.sub=x.n?('到 '+calFmtOrd(s.cal.ord+x.n)):''; });
 return o;
}
function waitWhy(){
 if(!s) return '尚未开局';
 if(s.dead) return '人已不在';
 if(s.cal&&s.cal.finished) return '历史已到 1972 年末';
 if(SP.cur) return '正在办理「'+SP.cur.label+'」';
 if(calBlocked()) return '有事待处理';
 return '';
}
function waitStart(k){
 try{ if(!$('mask').classList.contains('hidden')&&/^静待时日/.test($('dlgTag').textContent||'')) $('mask').classList.add('hidden'); }catch(e){}
 var why=waitWhy(); if(why){ calToast(why+'，不能静待。'); return false; }
 var op=waitOptions().filter(function(x){ return x.k===k; })[0];
 if(!op||op.n<=0){ calToast('没有可等的日子。'); return false; }
 SP.req={n:op.n,key:'wait',label:op.k==='event'?'静待时日（到下一个历史事件）':op.label};
 SP.pre=SP.lastPre||spSnap();
 $('mask').classList.add('hidden');
 return spBegin();
}
function waitMenu(){
 var why=waitWhy(); if(why){ calToast(why+'，不能静待。'); return; }
 $('dlgTag').textContent='静待时日 · '+calFmtOrd(s.cal.ord);
 $('dlgTitle').textContent='静待时日';
 $('dlgDesc').textContent='什么也不做，让日子过去。每月生计照常结算；遇到历史抉择或重大变故会提前停下。';
 var body=$('dlgBody'); body.innerHTML='';
 waitOptions().forEach(function(op){
  var b=document.createElement('button'); b.className='choice'; b.setAttribute('data-wait',op.k);
  b.innerHTML='<b>'+op.label+(op.n?'<span class="cdnote dur">'+op.n+' 天</span>':'')+'</b><div class="sub">'+op.sub+'</div>';
  if(!op.n) b.disabled=true;
  b.onclick=function(){ waitStart(op.k); };
  body.appendChild(b);
 });
 var c=document.createElement('button'); c.className='choice'; c.style.textAlign='center'; c.innerHTML='<b>不等了</b>';
 c.onclick=function(){ $('mask').classList.add('hidden'); SP.lastPre=null; };
 body.appendChild(c);
 $('mask').classList.remove('hidden');
}
var _calClockUIV4186=calClockUI;
calClockUI=function(force){
 _calClockUIV4186.apply(this,arguments);
 if(!s||!s.cal) return;
 var sp=document.getElementById('hudSpeed');
 if(sp){
  var b=calBlocked();
  var txt=s.cal.finished?'已结束':(s.dead?'已终':(SP.cur?('办理中 · 至 '+calShort(SP.cur.to)):(b?'等待处理':'')));
  if(sp.textContent!==txt) sp.textContent=txt;
  var cl='hud-spd'+(txt?' on':'');
  if(sp.className!==cl) sp.className=cl;
 }
 var wb=document.getElementById('btnWait');
 if(wb){ var dis=!!waitWhy(); if(wb.disabled!==dis) wb.disabled=dis; }
};
(function(){
 function bind(){
  var wb=document.getElementById('btnWait');
  if(wb&&!wb.getAttribute('data-bound')){ wb.setAttribute('data-bound','1'); wb.addEventListener('click',function(){ waitMenu(); }); }
 }
 setTimeout(bind,0); document.addEventListener('DOMContentLoaded',bind);
})();
var _initV4186=init;
init=function(){ var r=_initV4186.apply(this,arguments); CLOCK.speed=0; if(s&&s.cal) delete s.cal.speedPref; try{ window.scrollTo(0,0); }catch(e){} return r; };   /* 开局后回到页首：手机上开局按钮在表单底部 */
var _applySaveV4186=applySave;
applySave=function(){ var r=_applySaveV4186.apply(this,arguments); CLOCK.speed=0; CLOCK.acc=0; if(s&&s.cal) delete s.cal.speedPref; return r; };   /* 旧档的速度偏好一律忽略 */
CLOCK.speed=0;
window.__CAL.setSpeed=calSetSpeed;
window.__CAL.wait=waitStart; window.__CAL.waitOptions=waitOptions; window.__CAL.waitMenu=waitMenu; window.__CAL.nextEventOrd=waitNextEventOrd;

/* ================= V4.18.6 第二步：事件照片、年代背景、动效 =================
   - PHOTOS：照片说明（中文描述、年份、作者、许可、Commons 来源），由 tests/photo_data.py 生成；文件在 img/。
     事件 id 对应 <id>、<id>_2、<id>_3；era_* 为年代背景。
   - 历史事件弹窗顶部显示照片：铺满宽度、16:9、可左右切换（按钮 / 滑动 / 方向键），下方小字署名与来源；
     只加载当前与下一张；加载失败的照片直接去掉，全部失败则整块隐藏。
   - 时代纪事里列出已发生、有照片的事件，可点开再看。
   - 开局题头与顶栏按当前年代换背景（深色遮罩，文字对比度见 tests/test_photos.py）。
   - 动效只用 DESIGN.md 的令牌；prefers-reduced-motion 下由样式表统一降为 0ms。 */
var PHOTOS={"opium":{"f":"img/opium.jpg","d":"1841 年 1 月，东印度公司铁甲蒸汽船“复仇女神号”与英舰小艇在穿鼻洋击毁清军水师战船。","y":"1843 年绘","a":"爱德华·邓肯（Edward Duncan）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ADestroying_Chinese_war_junks%2C_by_E._Duncan_%281843%29.jpg"},"nanjing42":{"f":"img/nanjing42.jpg","d":"1842 年 8 月，《南京条约》在英舰“皋华丽号”上签字用印。","y":"1846 年刊印","a":"约翰·普拉特绘，约翰·伯内特刻版","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AThe_Signing_of_the_Treaty_of_Nanking.jpg"},"taiping":{"f":"img/taiping.jpg","d":"湘军攻复安庆。安庆之战是太平天国由盛转衰的转折。","y":"1886 年绘","a":"吴友如","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ARegaining_the_Provincial_City_Anqing2.jpg"},"secondopium56":{"f":"img/secondopium56.jpg","d":"1860 年英法联军攻占大沽炮台之后。炮台内，清军守兵的遗体还横在阵地上。","y":"1860 年","a":"费利斯·比托（Felice Beato）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AAfter_the_Capture_of_the_Taku_Forts_1860.jpg","p":"50% 55%"},"ziqiang":{"f":"img/ziqiang.jpg","d":"江南制造局搬运火炮。洋务运动时期最大的军工厂。原照为 1900 年前所摄，此为 2009 年翻拍。","y":"1900 年前","a":"原摄影者不详","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AGun_transportation_at_Jiangnan_Arsenal.jpg"},"taipingfall64":{"f":"img/taipingfall64.jpg","d":"清军攻破天京（南京）。太平天国自此覆亡。","y":"19 世纪","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AThird_Battle_of_Nanking.jpg"},"saihai75":{"f":"img/saihai75.jpg","d":"清军与回军在渭河作战。西北战事是塞防之议的背景。","y":"1886—1890 年间绘","a":"庆宽","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ABattle_at_the_Wei_River_%28Weihe%29.jpg"},"jiawu":{"f":"img/jiawu.jpg","d":"北洋水师旗舰“定远”号。参加黄海海战，1895 年在威海卫被鱼雷击伤后自毁。","y":"1884—1895 年间","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ADingyuan_%28ship%2C_1884%29_-_NH_1926_-_cropped.jpg"},"wuxu":{"f":"img/wuxu.jpg","d":"康有为像。戊戌变法的主要推动者，变法失败后流亡海外。","y":"年份不详","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AKang-youwei2-large.jpg","p":"50% 22%"},"boxer":{"f":"img/boxer.jpg","d":"八国联军中的英属印度第十六孟加拉骑兵在北京天坛。","y":"1900 年","a":"佚名（理查森爵士相册）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AIndian_troops_at_Temple_of_Heaven_Peking_1900.jpg"},"boxer01":{"f":"img/boxer01.jpg","d":"《辛丑条约》签字现场。条约规定赔款四亿五千万两。","y":"1901 年 9 月 7 日","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3A%E3%80%8A%E8%BE%9B%E4%B8%91%E6%9D%A1%E7%BA%A6%E3%80%8B%E7%AD%BE%E5%AD%97%E6%97%B6%E7%9A%84%E6%83%85%E6%99%AF.jpg"},"abolish_exam05":{"f":"img/abolish_exam05.jpg","d":"南京江南贡院的号舍。考生在这样的隔间里连考数日，1905 年科举停废后空置。今景。","y":"2001 年 4 月摄","a":"Dr. Meierhofer","l":"CC BY-SA 3.0","s":"https://commons.wikimedia.org/wiki/File%3APr%C3%BCfungszellen-Nanking.jpg","u":"https://creativecommons.org/licenses/by-sa/3.0/deed.zh","m":"已缩放、压缩","p":"50% 85%"},"xinhai":{"f":"img/xinhai.jpg","d":"武昌起义中的革命军士兵。","y":"1911 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ARevolutionary_soldiers_at_Wuchang.jpg"},"minguo":{"f":"img/minguo.jpg","d":"1912 年 1 月 1 日，孙中山就任临时大总统后与总统府职员合影。","y":"1912 年 1 月 1 日","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3A1912%E5%B9%B41%E6%9C%881%E6%97%A5%EF%BC%8C%E5%AD%99%E4%B8%AD%E5%B1%B1%E5%B0%B1%E8%81%8C%E4%B8%AD%E5%8D%8E%E6%B0%91%E5%9B%BD%E4%B8%B4%E6%97%B6%E5%A4%A7%E6%80%BB%E7%BB%9F%E5%90%8E%E4%B8%8E%E6%80%BB%E7%BB%9F%E5%BA%9C%E8%81%8C%E5%91%98%E5%90%88%E5%BD%B1.jpg","p":"50% 35%"},"huguo15":{"f":"img/huguo15.jpg","d":"蔡锷像。1915 年底他在云南起兵讨袁，护国战争由此开始。","y":"1916 年以前","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ACai_E.jpg","p":"50% 15%"},"warlord16":{"f":"img/warlord16.jpg","d":"袁世凯戎装像。他 1916 年 6 月死后，北洋分裂为各派军阀。","y":"约 1912 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AYuan_Shikai_in_uniform.jpg","p":"50% 20%"},"may4":{"f":"img/may4.jpg","d":"1919 年 5 月 4 日，北京十三所学校约三千名学生在天安门前集会，反对巴黎和会的山东决议。","y":"1919 年 5 月 4 日","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AChinese_protestors_march_against_the_Treaty_of_Versailles_%28May_4%2C_1919%29.jpg"},"beifa":{"f":"img/beifa.jpg","d":"北伐战争图片拼合：蒋介石检阅国民革命军、北上行军的部队、炮兵作战等。原照摄于 1926—1928 年，2012 年拼合。","y":"1926—1928 年","a":"Futuretrillionaire（拼合）","l":"CC BY-SA 3.0","s":"https://commons.wikimedia.org/wiki/File%3ANorthern_Expedition_collage.jpg","u":"https://creativecommons.org/licenses/by-sa/3.0/deed.zh","m":"已缩放、压缩","p":"50% 35%"},"split":{"f":"img/split.jpg","d":"“清党”中被捕押走的共产党人。","y":"1927 年 4 月","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ACommunist_purge.jpg"},"northeast28":{"f":"img/northeast28.jpg","d":"张学良。这一年年底，他宣布东北易帜，服从南京国民政府。","y":"1928 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AZhang_Xueliang%2C_1928.jpg","p":"50% 8%"},"918":{"f":"img/918.jpg","d":"日军骑兵开进沈阳。","y":"1931 年 9 月","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AMukden_1931_japan_shenyang.jpg"},"changzheng":{"f":"img/changzheng.jpg","d":"红军干部向长征后的队伍讲话。","y":"1930 年代","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ALong-march.jpg"},"zunyi35":{"f":"img/zunyi35.jpg","d":"遵义会议会址。1935 年 1 月，中共中央政治局在此开会，调整了军事领导。今景。","y":"2005 年 8 月 8 日摄","a":"小小新手","l":"CC BY-SA 3.0","s":"https://commons.wikimedia.org/wiki/File%3AZunyiMeeting.jpg","u":"https://creativecommons.org/licenses/by-sa/3.0/deed.zh","m":"已缩放、压缩"},"xian":{"f":"img/xian.jpg","d":"事变前两个月的合影：张学良（左）、杨虎城（中）、蒋介石（右）。","y":"1936 年 10 月","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AZhang_Xueliang%2C_Yang_Hucheng_and_Chiang_Kai-shek.jpg","p":"50% 35%"},"q7":{"f":"img/q7.jpg","d":"第二十九军在前线作战。","y":"1937 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AArmy_29_Fighting_1937.jpg"},"wuhan":{"f":"img/wuhan.jpg","d":"武汉外围的中国军队机枪阵地。","y":"1938 年","a":"唐古樵","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AWuhan_1938.jpg"},"changsha39":{"f":"img/changsha39.jpg","d":"第一次长沙会战中的日军士兵。","y":"1939 年 9 月","a":"日本陆军","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AIJA%2C_Battle_of_Changsha%2C_China%2C_September_1939.jpg","p":"50% 40%"},"baituan":{"f":"img/baituan.jpg","d":"八路军攻占娘子关。","y":"1940 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AHundred_Regiments_Offensive_1940.jpg"},"newfourth41":{"f":"img/newfourth41.jpg","d":"新四军政治部职员，手执纸烟者为部长林植夫。","y":"1938 年刊","a":"《大美画报》","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3A%E6%96%B0%E5%9B%9B%E5%86%9B%E6%94%BF%E6%B2%BB%E9%83%A8%E8%81%8C%E5%91%98.png","p":"50% 35%"},"henan42":{"f":"img/henan42.jpg","d":"河南大饥荒。饿极的灾民啃食树皮。","y":"1943 年","a":"哈里森·福尔曼（Harrison Forman）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AAgsphoto_11239_full.jpg","p":"50% 30%"},"ichigo44":{"f":"img/ichigo44.jpg","d":"日军在粤汉铁路沿线冲锋。豫湘桂战役中国军队大溃退。","y":"1944 年 7 月","a":"《读卖新闻》","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AJapanese_troops_performing_a_close_combat_attack_on_Y%C3%BCeh-Han_Railroad.jpg"},"1945":{"f":"img/1945.jpg","d":"南京受降：中国战区受降主官何应钦在日军投降书上签字。","y":"1945 年 9 月 9 日","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AHe_Yinqin_signs_1945.jpg"},"civilwar46":{"f":"img/civilwar46.jpg","d":"四平战役中的共产党军队阵地。","y":"1946 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ABattle_of_Siping03.jpg"},"constitution47":{"f":"img/constitution47.jpg","d":"1946 年 12 月 25 日国民大会通过的《中华民国宪法》，1947 年 1 月 1 日公布。","y":"1946 年","a":"国史馆","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3A1946_National_Assembly_Constitution.jpg","p":"50% 12%"},"campaign48":{"f":"img/campaign48.jpg","d":"淮海战役中，解放军华东坦克大队配合步兵进攻。","y":"1948 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3APLAHuaihai.jpg"},"founding49":{"f":"img/founding49.jpg","d":"开国大典，毛泽东在天安门城楼宣告中华人民共和国中央人民政府成立。","y":"1949 年 10 月 1 日","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AMao_Proclaiming_New_China.JPG","p":"50% 35%"},"korean50":{"f":"img/korean50.jpg","d":"长津湖战役中，美军陆战一师的车队穿过志愿军防线突围。","y":"1950 年 12 月","a":"彼得·麦克唐纳（美国海军陆战队）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AChosin.jpg"},"plan53":{"f":"img/plan53.jpg","d":"长春第一汽车制造厂职工欢庆第一批解放牌汽车出厂。","y":"1956 年","a":"袁苓","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AChinese_people%27s_pride.jpg","p":"50% 40%"},"greatleap58":{"f":"img/greatleap58.jpg","d":"大炼钢铁的土高炉。","y":"1958 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ABackyard_furnace2.jpg","p":"50% 40%"},"cultural66":{"f":"img/cultural66.jpg","d":"天安门广场上等待接见的红卫兵。","y":"1966 年 9 月 15 日","a":"孟昭瑞","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ARed_Guards_in_Tian%27anmen_Square.jpg","p":"50% 55%"},"era_qing":{"f":"img/era_qing.jpg","d":"广州，英国领事馆的本地卫队，远处是六榕寺花塔。","y":"1871 年","a":"约翰·汤姆森（John Thomson）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ATARTAR_SOLDIERS.jpg","c":"广州的领事馆卫队"},"era_qing_city":{"f":"img/era_qing_city.jpg","d":"广州西关浆栏街，沿街多是药材铺。","y":"约 1873 年","a":"约翰·汤姆森（John Thomson）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3APHYSIC_STREET%2C_CANTON.jpg","c":"广州浆栏街"},"era_republic":{"f":"img/era_republic.jpg","d":"上海南京路。","y":"1930 年代","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AShanghai_Nanking_Road_1930s.jpeg","c":"上海南京路"},"era_war":{"f":"img/era_war.jpg","d":"台儿庄战役中的巷战。","y":"1938 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ATaierzhuang.jpg","c":"台儿庄巷战"},"era_newchina":{"f":"img/era_newchina.jpg","d":"中苏专家在建设中的武汉长江大桥上。","y":"1957 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AChinese_and_Soviet_engineers_on_the_Wuhan_Yangtze_River_Bridge.jpg","c":"建设中的武汉长江大桥"},"ziqiang_2":{"f":"img/ziqiang_2.jpg","d":"福州船政局全景，左宗棠、沈葆桢创办的近代造船厂。","y":"1898 年前","a":"约翰·汤姆森（John Thomson）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AFOOCHOW_ARSENAL.jpg"},"ziqiang_3":{"f":"img/ziqiang_3.jpg","d":"李鸿章，洋务运动的主要主持者。此照摄于他去世的那一年。","y":"1901 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ALi_Hongzhang_1901.jpg","p":"50% 12%"},"taiping_2":{"f":"img/taiping_2.jpg","d":"曾国藩像。他组建湘军，主持对太平天国的战事。","y":"1871 年 3 月","a":"吴嘉善","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AZeng_Guofan_Photograph.jpg","p":"50% 30%"},"jiawu_2":{"f":"img/jiawu_2.jpg","d":"瑞典讽刺漫画：赴日议和的李鸿章。","y":"1895 年 3 月","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3APolitical_cartoon_of_Li_Hongzhang_1895.png","p":"50% 50%"},"xinhai_2":{"f":"img/xinhai_2.jpg","d":"汉阳的革命军总司令部（一说在古琴台）。","y":"1911 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ARevolutionary_army_headquarters_at_Hanyang.jpg","p":"50% 40%"},"warlord16_2":{"f":"img/warlord16_2.jpg","d":"北洋陆军操练。","y":"1910 年代","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AMilitary_training_of_the_Beiyang_Army.jpg"},"q7_3":{"f":"img/q7_3.jpg","d":"南京，魏特琳（Minnie Vautrin）和她在金陵女子文理学院收容的难民。","y":"1937 年","a":"侵华日军南京大屠杀遇难同胞纪念馆藏","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AMinnie_Vautrin_helped_the_refugees_in_1937.jpg","p":"50% 45%"},"wuhan_2":{"f":"img/wuhan_2.jpg","d":"1938 年 6 月黄河花园口决堤，以水阻敌，豫皖苏大片村庄被淹。","y":"1938 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3A1938_Yellow_River_flood.jpg"},"wuhan_3":{"f":"img/wuhan_3.jpg","d":"台儿庄附近，中国士兵伏在被毁的日军卡车旁，前景是一匹死马。","y":"1938 年 4 月","a":"罗伯特·卡帕（Robert Capa）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ATaierzhuangBattlephoto.jpg"},"henan42_2":{"f":"img/henan42_2.jpg","d":"1938 年黄河决堤后的难民群。原为日方宣传照片，原题称难民“为日军所救”。","y":"1938 年","a":"佚名（日方宣传照）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ARefugees_of_Yellow_River_Flood.JPG"},"campaign48_2":{"f":"img/campaign48_2.jpg","d":"解放军进入上海南京路。","y":"1949 年 5 月 25 日","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3APLA_Troops_entered_to_Nanjing_Road%2C_Shanghai.jpg"},"plan53_2":{"f":"img/plan53_2.jpg","d":"中苏专家在建设中的武汉长江大桥上。大桥是“一五”计划的重点工程。","y":"1957 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AChinese_and_Soviet_engineers_on_the_Wuhan_Yangtze_River_Bridge.jpg"},"transformation56":{"f":"img/transformation56.jpg","d":"建设中的武汉长江大桥。","y":"1957 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AWuhan_Yangtze_River_Bridge_in_construction.jpg"},"leap58":{"f":"img/leap58.jpg","d":"土法炼钢的小高炉。","y":"1958 年","a":"佚名","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3ABackyard_furnace4.jpg","p":"50% 55%"},"boxer_2":{"f":"img/boxer_2.jpg","d":"天津美国领事馆前的美国海军陆战队，随后随西摩尔联军北上。","y":"1900 年","a":"肯扬·考克斯（Kenyon Cox）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3AUS_Marines_at_American_Consulate%2C_Tianjin%2C_1900_%28CHANDLESS_0%29.jpeg"},"un71":{"f":"img/un71.jpg","d":"尼克松抵达北京，与周恩来握手。中国恢复联合国席位后不到四个月。","y":"1972 年 2 月 21 日","a":"白宫摄影办公室","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File:President_Richard_Nixon_and_Premier_Chou_En-Lai_Shake_Hands_at_the_Nixons%27_Arrival_in_Peking,_China_-_DPLA_-_315dbcc0e8b46e1bc678fde12bef9eb8.jpg"},"secondopium56_2":{"f":"img/secondopium56_2.jpg","d":"大沽北炮台一角，攻破后即刻拍摄。阵亡的守兵倒在炮位与壕沟里。","y":"1860 年 8 月 21 日","a":"费利斯·比托（Felice Beato）","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File:Felice_Beato_-_Interior_of_the_Angle_of_Taku_North_Fort_Immediately_After_Its_Capture_by_Storm_-_Google_Art_Project.jpg","p":"50% 60%"},"era_war_2":{"f":"img/era_war_2.jpg","d":"日军轰炸机轰炸重庆。","y":"1940 年 6 月 16 日","a":"《朝日新闻》","l":"公有领域","s":"https://commons.wikimedia.org/wiki/File%3A%E8%BD%9F%E7%82%B8%E9%87%8D%E6%85%B6_%28cropped%29.jpg","c":"日机轰炸重庆"}};
/* 同一年的事件在 V4.10 段被合并（大跃进与人民公社化 → 大跃进），照片跟着并过去 */
var PH_ALIAS={};   /* V4.19：人民公社化（leap58）恢复为独立事件，照片各归各的 */
var PH={title:null,list:[],i:0,bad:{},els:null,era:'',lastDate:'',obs:null,galSig:'',galAll:false};
function phList(id){
 var a=[]; if(!id) return a; id=String(id);
 if(/^era_/.test(id)) return a;
 [id].concat(PH_ALIAS[id]||[]).forEach(function(b){
  [b,b+'_2',b+'_3'].forEach(function(k){ if(PHOTOS[k]&&!PH.bad[PHOTOS[k].f]) a.push(PHOTOS[k]); });
 });
 return a;
}
function phEsc(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function phReduced(){ try{ return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches); }catch(e){ return false; } }
function phCapHTML(p){
 var lic=p.u?'<a href="'+phEsc(p.u)+'" target="_blank" rel="noopener license">'+phEsc(p.l)+'</a>':phEsc(p.l);
 var seg=[phEsc(p.y),phEsc(p.a),lic+(p.m?'，'+phEsc(p.m):'')];
 return '<span class="ph-d">'+phEsc(p.d)+'</span>'+
  '<span class="ph-m">'+seg.map(function(t,i){ return '<span class="ph-i'+(i===1?' ph-a':'')+'">'+t+'</span>'; }).join('<span class="ph-sep"> · </span>')+
  '<span class="ph-sep"> · </span><span class="ph-i ph-src"><a href="'+phEsc(p.s)+'" target="_blank" rel="noopener">来源</a></span></span>';
}
function phSvg(dir){
 return '<svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" focusable="false"><path d="'+(dir<0?'M11.5 3.5 6 9l5.5 5.5':'M6.5 3.5 12 9l-5.5 5.5')+'" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
}
function phClear(){
 var f=document.getElementById('dlgMedia');
 PH.title=null; PH.list=[]; PH.i=0; PH.els=null;
 if(f){ f.hidden=true; f.innerHTML=''; f.removeAttribute('data-n'); }
}
function phMount(list,title){
 var f=document.getElementById('dlgMedia'); if(!f) return false;
 list=(list||[]).filter(function(p){ return !PH.bad[p.f]; });
 if(!list.length){ phClear(); return false; }
 var keep=(PH.title===title&&PH.list.length)?Math.min(PH.i,list.length-1):0;
 PH.title=title; PH.list=list; PH.i=0;
 f.innerHTML=''; f.hidden=false; f.setAttribute('data-n',String(list.length));
 var frame=document.createElement('div'); frame.className='ph-frame';
 var track=document.createElement('div'); track.className='ph-track';
 var imgs=[];
 list.forEach(function(p,i){
  var sl=document.createElement('div'); sl.className='ph-slide';
  var im=document.createElement('img'); im.alt=p.d; im.setAttribute('loading','lazy'); im.setAttribute('decoding','async');
  im.setAttribute('data-src',p.f); if(p.p) im.style.objectPosition=p.p;
  im.onload=function(){ im.classList.add('on'); };
  im.onerror=function(){ PH.bad[p.f]=1; if(PH.title===title) phMount(PH.list,title); };
  sl.appendChild(im); track.appendChild(sl); imgs.push(im);
 });
 frame.appendChild(track);
 var prev=null,next=null,count=null;
 if(list.length>1){
  prev=document.createElement('button'); prev.type='button'; prev.className='ph-nav prev'; prev.setAttribute('aria-label','上一张'); prev.innerHTML=phSvg(-1);
  next=document.createElement('button'); next.type='button'; next.className='ph-nav next'; next.setAttribute('aria-label','下一张'); next.innerHTML=phSvg(1);
  count=document.createElement('span'); count.className='ph-count';
  prev.onclick=function(e){ if(e&&e.stopPropagation) e.stopPropagation(); phGo(PH.i-1); };
  next.onclick=function(e){ if(e&&e.stopPropagation) e.stopPropagation(); phGo(PH.i+1); };
  frame.appendChild(prev); frame.appendChild(next); frame.appendChild(count);
  phSwipe(frame,track);
 }
 var cap=document.createElement('figcaption'); cap.className='ph-cap';
 f.appendChild(frame); f.appendChild(cap);
 PH.els={frame:frame,track:track,imgs:imgs,prev:prev,next:next,count:count,cap:cap};
 try{ if(PH.obs) PH.obs.takeRecords(); }catch(e){}
 phGo(keep,true);
 return true;
}
function phLoad(i){
 var E=PH.els; if(!E||!E.imgs[i]) return;
 var im=E.imgs[i], src=im.getAttribute('data-src');
 if(src&&!im.getAttribute('src')){ im.setAttribute('src',src); if(im.complete&&im.naturalWidth) im.classList.add('on'); }
}
function phGo(i,instant){
 var E=PH.els, n=PH.list.length; if(!E||!n) return;
 i=Math.max(0,Math.min(n-1,i)); PH.i=i;
 if(instant){ E.track.style.transition='none'; }
 E.track.style.transform='translateX('+(-100*i)+'%)';
 if(instant){ try{ void E.track.offsetWidth; }catch(e){} E.track.style.transition=''; }
 phLoad(i); phLoad(i+1);
 E.cap.innerHTML=phCapHTML(PH.list[i]);
 if(E.count) E.count.textContent=(i+1)+' / '+n;
 if(E.prev) E.prev.disabled=(i===0);
 if(E.next) E.next.disabled=(i===n-1);
}
function phSwipe(frame,track){
 var x0=null,y0=0,dx=0,id=null,w=1,horiz=false;
 function down(e){ if(e.button>0) return; if(e.target&&e.target.closest&&e.target.closest('.ph-nav')) return;
  x0=e.clientX; y0=e.clientY; dx=0; id=e.pointerId; horiz=false; w=frame.getBoundingClientRect().width||1; }
 function move(e){ if(x0===null||e.pointerId!==id) return; dx=e.clientX-x0; var dy=e.clientY-y0;
  if(!horiz&&Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){ horiz=true; try{ frame.setPointerCapture(id); }catch(er){} }
  if(horiz){ var n=PH.list.length, edge=(PH.i===0&&dx>0)||(PH.i===n-1&&dx<0);
   track.style.transition='none'; track.style.transform='translateX(calc('+(-100*PH.i)+'% + '+Math.round(edge?dx/3:dx)+'px))'; } }
 function up(e){ if(x0===null||e.pointerId!==id) return; track.style.transition='';
  var t=Math.max(40,w*0.18); if(horiz&&dx<=-t) phGo(PH.i+1); else if(horiz&&dx>=t) phGo(PH.i-1); else phGo(PH.i);
  x0=null; horiz=false; }
 frame.addEventListener('pointerdown',down); frame.addEventListener('pointermove',move);
 frame.addEventListener('pointerup',up); frame.addEventListener('pointercancel',up);
}
/* 弹窗：标题换了（别的弹窗复用了同一个框）或关闭，就把照片撤掉；关闭时留一个淡出的影子 */
function phGhost(mask){
 if(phReduced()||!mask||!mask.cloneNode||!document.body) return;
 var dlg=mask.querySelector&&mask.querySelector('.dialog'); var st=dlg?dlg.scrollTop:0;
 var g=mask.cloneNode(true); g.removeAttribute('id'); g.classList.remove('hidden'); g.classList.add('mask-ghost'); g.setAttribute('aria-hidden','true');
 var all=g.querySelectorAll('[id]'); for(var i=0;i<all.length;i++) all[i].removeAttribute('id');
 document.body.appendChild(g);
 var gd=g.querySelector('.dialog'); if(gd) gd.scrollTop=st;
 setTimeout(function(){ if(g.parentNode) g.parentNode.removeChild(g); },260);
}
function phObserve(){
 if(PH.obs||typeof MutationObserver==='undefined') return;
 var mask=document.getElementById('mask'), tt=document.getElementById('dlgTitle'); if(!mask||!tt) return;
 PH.obs=new MutationObserver(function(recs){
  var closed=false;
  recs.forEach(function(r){ if(r.type==='attributes'&&r.target===mask&&String(r.oldValue||'').indexOf('hidden')<0) closed=true; });
  var hiddenNow=mask.classList.contains('hidden');
  if(closed&&hiddenNow){
   try{ phGhost(mask); }catch(e){}
   phClear(); return;
  }
  if(PH.title!==null&&(tt.textContent!==PH.title||closed)) phClear();
 });
 PH.obs.observe(mask,{attributes:true,attributeFilter:['class'],attributeOldValue:true});
 PH.obs.observe(tt,{childList:true,characterData:true,subtree:true});
}
function phForEvent(ev){
 if(!ev||!ev.id) return false;
 var mask=document.getElementById('mask'); if(!mask||mask.classList.contains('hidden')) return false;
 var tt=document.getElementById('dlgTitle'); if(tt&&tt.textContent!==ev.t) return false;
 return phMount(phList(ev.id),ev.t);
}
var _showEventPh=showEvent;
showEvent=function(ev){
 var r=_showEventPh.apply(this,arguments);
 try{ phObserve(); phForEvent(ev); }catch(e){}
 return r;
};
/* 时代纪事：已发生、有照片的事件，点开再看 */
function phFirstEvent(id){ for(var i=0;i<EVENTS.length;i++){ if(EVENTS[i].id===id) return EVENTS[i]; } return null; }
function phView(id){
 var ev=phFirstEvent(id); if(!ev) return false;
 if(!$('mask').classList.contains('hidden')) return false;
 var rec=null; (s&&s.histRec||[]).forEach(function(r){ if(r.id===id) rec=r; });
 $('dlgTag').textContent='历史影像 · '+(rec?calFmtOrd(rec.ord):(ev.y+'年'));
 $('dlgTitle').textContent=ev.t; $('dlgDesc').textContent=ev.d;
 var body=$('dlgBody'); body.innerHTML='';
 if(rec){ var p=document.createElement('p'); p.className='small'; p.textContent='你当时的选择：'+rec.c; body.appendChild(p); }
 var c=document.createElement('button'); c.className='choice'; c.style.textAlign='center'; c.innerHTML='<b>关闭</b>';
 c.onclick=function(){ $('mask').classList.add('hidden'); };
 body.appendChild(c);
 $('mask').classList.remove('hidden');
 phObserve(); phMount(phList(id),ev.t);
 return true;
}
function phGalleryRender(){
 var box=document.getElementById('evGallery'); if(!box) return;
 if(!s||!s.evDone){ if(PH.galSig!==''){ box.innerHTML=''; PH.galSig=''; } return; }
 var seen={}, items=[];
 EVENTS.forEach(function(ev){
  if(seen[ev.id]||!s.evDone[ev.id]) return; seen[ev.id]=1;
  var n=phList(ev.id).length; if(!n) return;
  var d=evDateOf(ev); items.push({ev:ev,o:calOrd(ev.y,d[0],d[1]),n:n});
 });
 items.sort(function(a,b){ return b.o-a.o; });
 var sig=items.map(function(x){ return x.ev.id+':'+x.n; }).join(',')+'|'+PH.galAll;
 if(sig===PH.galSig) return; PH.galSig=sig;
 if(!items.length){ box.innerHTML=''; return; }
 var LIM=6, show=PH.galAll?items:items.slice(0,LIM);
 var h='<h3>亲历的历史 · 影像</h3>';
 show.forEach(function(x){ h+='<button type="button" class="evg-row" data-ev="'+phEsc(x.ev.id)+'"><span class="evg-y">'+x.ev.y+'</span><span class="evg-t">'+phEsc(x.ev.t)+'</span><span class="evg-n">'+x.n+' 张</span></button>'; });
 if(items.length>LIM) h+='<button type="button" class="btn sm evg-more">'+(PH.galAll?'只看最近 '+LIM+' 件':'全部 '+items.length+' 件')+'</button>';
 box.innerHTML=h;
 if(box.querySelectorAll){
  var rows=box.querySelectorAll('.evg-row');
  for(var i=0;i<rows.length;i++) rows[i].onclick=function(){ phView(this.getAttribute('data-ev')); };
  var more=box.querySelector('.evg-more'); if(more) more.onclick=function(){ PH.galAll=!PH.galAll; phGalleryRender(); };
 }
}
/* 年代背景 */
function phEraOf(y,m,d){
 var k=y*10000+(m||1)*100+(d||1);
 if(k<18950101) return 'era_qing';
 if(k<19120101) return 'era_qing_city';
 if(k<19370707) return 'era_republic';
 if(k<19400101) return 'era_war';
 if(k<19450815) return 'era_war_2';
 if(k<19491001) return 'era_republic';
 return 'era_newchina';
}
function phEraApply(key){
 var p=PHOTOS[key]; if(!p||PH.era===key) return;
 PH.era=key;
 try{ document.documentElement.style.setProperty('--era-img','url("'+p.f+'")'); document.documentElement.setAttribute('data-era',key); }catch(e){}
 var t='题图：'+phEsc(p.c||p.d)+'<span class="ph-sep"> · </span>'+phEsc(p.y)+'<span class="ph-sep"> · </span>'+phEsc(String(p.a).replace(/（[^）]*）/g,''))+
  '<span class="ph-sep"> · </span>'+phEsc(p.l)+'<span class="ph-sep"> · </span><a class="ph-src" href="'+phEsc(p.s)+'" target="_blank" rel="noopener">来源</a>';
 ['eraCredit','eraCreditGame'].forEach(function(id){ var el=document.getElementById(id); if(el) el.innerHTML=t; });
}
function phEraSync(){
 if(s&&s.cal&&typeof s.cal.ord==='number'){ var t=calFromOrd(s.cal.ord); phEraApply(phEraOf(t.y,t.m,t.d)); return; }
 var f=document.getElementById('fStart'); var y=f?parseInt(f.value,10):1840; if(!(y>0)) y=1840;
 phEraApply(phEraOf(y,1,1));
}
/* 日期变化：主时刻的翻动 */
function phDateTick(){
 var el=document.getElementById('hudYear'); if(!el) return;
 var t=el.textContent||'';
 if(PH.lastDate&&t&&t!==PH.lastDate&&!phReduced()){
  el.classList.remove('flip'); try{ void el.offsetWidth; }catch(e){} el.classList.add('flip');
 }
 PH.lastDate=t;
}
/* 制度按钮：从浮动改为放进「制度运转」卡片 */
function phConstitutionInFlow(){
 var b=document.getElementById('btnConstitution'), card=document.getElementById('cardInstitutionOps');
 if(!b||!card) return;
 if(b.parentNode!==card){ card.appendChild(b); }
 if(b.style&&b.style.position) b.style.cssText='';
}
var _calClockUIPh=calClockUI;
calClockUI=function(){
 var r=_calClockUIPh.apply(this,arguments);
 try{ phDateTick(); phEraSync(); }catch(e){}
 return r;
};
var _renderPh=render;
render=function(){
 var r=_renderPh.apply(this,arguments);
 try{ phGalleryRender(); phEraSync(); phConstitutionInFlow(); }catch(e){}
 return r;
};
(function(){
 function bind(){
  try{ phObserve(); phEraSync(); }catch(e){}
  var fs=document.getElementById('fStart');
  if(fs&&!fs.getAttribute('data-era')){ fs.setAttribute('data-era','1'); fs.addEventListener('change',function(){ if(!s||!s.cal) phEraSync(); }); }
  var tabs=document.getElementById('tabs');
  if(tabs&&!tabs.getAttribute('data-fade')){
   tabs.setAttribute('data-fade','1');
   tabs.addEventListener('click',function(e){
    var b=e.target&&e.target.closest?e.target.closest('button[data-tab]'):null; if(!b||phReduced()) return;
    var g=document.getElementById('game'); if(!g) return;
    g.classList.remove('tab-in'); try{ void g.offsetWidth; }catch(er){} g.classList.add('tab-in');
    setTimeout(function(){ g.classList.remove('tab-in'); },260);
   });
  }
  if(!document.__phKey){
   document.__phKey=1;
   document.addEventListener('keydown',function(e){
    var f=document.getElementById('dlgMedia'), m=document.getElementById('mask');
    if(!f||f.hidden||!m||m.classList.contains('hidden')||PH.list.length<2) return;
    if(e.key==='ArrowLeft'){ phGo(PH.i-1); } else if(e.key==='ArrowRight'){ phGo(PH.i+1); }
   });
  }
 }
 setTimeout(bind,0); document.addEventListener('DOMContentLoaded',bind);
})();
window.__PH={events:function(){ return EVENTS.map(function(e){ return {id:e.id,y:e.y,t:e.t}; }); },photos:PHOTOS,list:phList,eraOf:phEraOf,view:phView,go:function(i){ phGo(i); },state:PH,gallery:phGalleryRender,clear:phClear};

/* ================= V4.19：世界自主运行——国家 AI、动态外交、国际关系 =================
   - 六个列强（英、法、俄/苏、德、日、美）各有国力、经济、军事、国内稳定、政体、性格与时代目标。
   - 国家 AI 挂在统一的日推进流程上：每月 1 日（calMonthTick）评估一次局势，每国至多作一项决策。
     s.intl.last 记下已决策的月份（年*12+月-1），先落标记再计算：同一个月绝不重复，跨多月静待时每月各一次。
   - 史实锚点（战争、同盟、协约、条约、政体更迭）按日期在日推进中发生，并给相关两国的关系设上下限（锁）；
     AI 只能在锁的范围内演化，不会与史实冲突得离谱。战后（1949—）涉华锚点只在“中共胜利”路线下生效。
   - 与中国的关系即 s.__powers[...].r（军政页“列强”同一套数字）；涉华动向会改变国势，并按玩家身份产生后果。
   - 不做 AI 自主宣战与战争结算（留给 V4.20）：紧张度 s.intl.t 与 window.__INTL.warRisk() 是接口。 */
var INTL_KEYS=['br','fr','ru','de','jp','us'];
var INTL_ALL=['br','cn','de','fr','jp','ru','us'];
var INTL_POW={br:'英吉利',ru:'沙俄',jp:'日本',fr:'法兰西',de:'德意志',us:'美利坚'};
var INTL_PERF={n:0,total:0,max:0};
function intlNowMs(){ try{ if(typeof performance!=='undefined'&&performance.now) return performance.now(); }catch(e){} return Date.now(); }
function intlPK(a,b){ return a<b?a+'|'+b:b+'|'+a; }
function intlCl(v,lo,hi){ v=+v; if(!isFinite(v)) v=lo; return Math.max(lo,Math.min(hi,Math.round(v*10)/10)); }
function intlPath(){ return (world&&world.altPath)||(s&&s.altHistory&&s.altHistory.path)||null; }
function intlPRC(){ var p=intlPath(); return !p||p==='cpc_victory'; }
var INTL_PRC_ORD=calOrd(1949,10,1);
function intlCnName(ord){
 var o=calFromOrd(ord), y=o.y;
 if(y<1912) return '清廷';
 if(y<1928) return '北京政府';
 if(ord<INTL_PRC_ORD) return '国民政府';
 return intlPRC()?'中国政府':'中华民国政府';
}
function intlName(k,ord){
 if(ord===undefined) ord=s&&s.cal?s.cal.ord:0;
 var y=calFromOrd(ord).y;
 if(k==='br') return '英国'; if(k==='fr') return '法国'; if(k==='us') return '美国'; if(k==='jp') return '日本';
 if(k==='ru') return y<1917?'俄国':(y<1922?'苏俄':'苏联');
 if(k==='de') return y<1871?'普鲁士':(y<1945?'德国':(y<1949?'德国占领区':'西德'));
 if(k==='cn') return intlCnName(ord);
 return k;
}
/* 政体：[起始年, 名称, 意识形态组]；组用于同类亲近、异类疏远 */
var INTL_REGIME={
 br:[[1840,'君主立宪','lib']],
 fr:[[1840,'七月王朝','mon'],[1848,'第二共和国','lib'],[1852,'第二帝国','mon'],[1870,'第三共和国','lib'],[1940,'维希政权','fasc'],[1944,'临时政府','lib'],[1946,'第四共和国','lib'],[1958,'第五共和国','lib']],
 ru:[[1840,'沙皇专制','mon'],[1917,'苏维埃政权','comm']],
 de:[[1840,'普鲁士王国','mon'],[1871,'德意志帝国','mon'],[1919,'魏玛共和国','lib'],[1933,'纳粹独裁','fasc'],[1945,'盟国占领','none'],[1949,'联邦共和国','lib']],
 jp:[[1840,'幕府锁国','mon'],[1868,'明治政府','mon'],[1890,'帝国议会','mon'],[1932,'军部专政','fasc'],[1945,'盟军占领','none'],[1952,'议会民主','lib']],
 us:[[1840,'联邦共和国','lib']]
};
function intlRegime(k,y){
 if(k==='cn'){ if(y<1912) return ['帝制','mon']; if(y<1928) return ['北京政府','lib']; if(y<1950||!intlPRC()) return ['国民政府','mon']; return ['人民共和国','comm']; }
 var a=INTL_REGIME[k]||[[0,'—','none']], r=a[0];
 for(var i=0;i<a.length;i++){ if(y>=a[i][0]) r=a[i]; }
 return [r[1],r[2]];
}
/* 国力参考曲线（游戏估算，0—100），AI 的扩军、改革、制裁在其上下浮动 */
var INTL_REF={
 br:[[1840,95],[1870,92],[1900,85],[1914,80],[1918,75],[1939,65],[1945,55],[1950,50],[1972,42]],
 fr:[[1840,75],[1870,72],[1871,60],[1914,65],[1918,58],[1939,55],[1940,15],[1944,30],[1950,45],[1972,50]],
 ru:[[1840,70],[1855,60],[1880,65],[1904,66],[1906,52],[1917,30],[1922,35],[1930,55],[1941,60],[1945,80],[1955,85],[1972,90]],
 de:[[1840,45],[1866,58],[1871,75],[1900,82],[1914,85],[1918,45],[1925,45],[1933,50],[1939,80],[1942,85],[1945,5],[1949,20],[1955,40],[1972,55]],
 jp:[[1840,20],[1868,22],[1895,45],[1905,58],[1920,62],[1937,70],[1941,72],[1945,15],[1952,25],[1960,40],[1972,60]],
 us:[[1840,35],[1865,45],[1898,60],[1918,80],[1929,82],[1941,90],[1945,100],[1972,95]]
};
function intlCurve(pts,y){
 if(y<=pts[0][0]) return pts[0][1];
 for(var i=1;i<pts.length;i++){ if(y<=pts[i][0]){ var a=pts[i-1],b=pts[i]; return a[1]+(b[1]-a[1])*(y-a[0])/(b[0]-a[0]); } }
 return pts[pts.length-1][1];
}
function intlStep(pts,y){ var v=pts[0][1]; for(var i=0;i<pts.length;i++){ if(y>=pts[i][0]) v=pts[i][1]; } return v; }
/* 性格：进取 agg、重商 trade、务实 prag、活跃 act（再叠加时代修正与每局的随机偏差） */
var INTL_PERS={br:{agg:50,trade:85,prag:75,act:60},fr:{agg:55,trade:60,prag:55,act:50},ru:{agg:70,trade:30,prag:45,act:50},
 de:{agg:60,trade:60,prag:60,act:45},jp:{agg:40,trade:45,prag:60,act:30},us:{agg:30,trade:85,prag:70,act:40}};
function intlPersAdj(k,y){
 var a={agg:0,trade:0,prag:0,act:0};
 if(k==='jp'){ if(y<1854){a.act=-25;a.agg=-25;} else if(y>=1868&&y<1931){a.agg=20;a.act=20;} else if(y>=1931&&y<1945){a.agg=45;a.act=25;a.prag=-20;} else if(y>=1952){a.agg=-25;a.trade=25;a.act=10;} }
 if(k==='de'){ if(y>=1933&&y<1945){a.agg=35;a.prag=-25;a.act=15;} else if(y>=1949){a.agg=-30;a.trade=15;} }
 if(k==='ru'){ if(y>=1917&&y<1922){a.act=-30;} else if(y>=1945){a.agg=5;a.act=15;} }
 if(k==='us'){ if(y>=1898&&y<1919){a.agg=10;a.act=15;} else if(y>=1941){a.agg=15;a.act=30;} }
 if(k==='fr'&&y>=1940&&y<1944) a.act=-40;
 return a;
}
function intlPers(k,y){
 var b=INTL_PERS[k], adj=intlPersAdj(k,y), pv=(s&&s.intl&&s.intl.n[k]&&s.intl.n[k].pv)||{}, o={};
 ['agg','trade','prag','act'].forEach(function(f){ o[f]=Math.max(0,Math.min(100,b[f]+adj[f]+(+pv[f]||0))); });
 return o;
}
/* 不能自主行动的时期：战败占领、维希、锁国（只做内政） */
function intlActive(k,ord){
 var y=calFromOrd(ord).y;
 if(k==='de'&&ord>=calOrd(1945,5,8)&&ord<calOrd(1949,9,21)) return false;
 if(k==='jp'&&ord>=calOrd(1945,9,2)&&ord<calOrd(1952,4,28)) return false;
 if(k==='fr'&&ord>=calOrd(1940,6,22)&&ord<calOrd(1944,8,25)) return false;
 if(k==='ru'&&ord>=calOrd(1917,11,7)&&ord<calOrd(1921,3,1)) return false;
 return true;
}
function intlForeign(k,ord){ return !(k==='jp'&&calFromOrd(ord).y<1854)&&intlActive(k,ord); }
/* 时代目标：[起, 止, 说明, 类别, 对象] */
var INTL_GOALS={
 br:[[1840,1900,'维护在华通商与海上优势','trade','cn'],[1900,1919,'维持均势，防范德国','security','de'],[1919,1939,'守住帝国与在华利益','trade','cn'],[1939,1946,'击败轴心国','security','de'],[1946,1973,'战后重建，依托美国','security','ru']],
 fr:[[1840,1871,'经营安南，扩大在华商务与传教','expand','cn'],[1871,1914,'对德复仇，收回阿尔萨斯—洛林','revanche','de'],[1914,1919,'击败德国','security','de'],[1919,1940,'防范德国复兴','security','de'],[1940,1946,'光复本土','security','de'],[1946,1973,'重建与独立外交','trade','us']],
 ru:[[1840,1905,'向远东扩张：黑龙江与满洲','expand','cn'],[1905,1917,'巩固远东，防范日本','security','jp'],[1917,1941,'巩固政权，防范资本主义包围','ideology','de'],[1941,1946,'击败德国','security','de'],[1946,1973,'与美国争衡','ideology','us']],
 de:[[1840,1871,'统一德意志','expand','fr'],[1871,1897,'维持大陆均势','security','fr'],[1897,1914,'推行“世界政策”，经营胶州湾','expand','cn'],[1914,1919,'赢得大战','security','fr'],[1919,1933,'修改和约，恢复国力','revanche','fr'],[1933,1945,'扩张与复仇','expand','ru'],[1945,1973,'复兴与西方一体化','trade','us']],
 jp:[[1840,1854,'锁国自守','security','br'],[1854,1868,'应对开国危机','security','us'],[1868,1895,'富国强兵，经略朝鲜','expand','cn'],[1895,1931,'经营满蒙','expand','cn'],[1931,1945,'独霸东亚','expand','cn'],[1945,1952,'占领下的重建','trade','us'],[1952,1973,'经济复兴','trade','us']],
 us:[[1840,1899,'通商与传教','trade','cn'],[1899,1941,'在华“门户开放”','trade','cn'],[1941,1946,'击败轴心国','security','jp'],[1946,1973,'遏制共产主义','ideology','ru']]
};
function intlGoal(k,y){ var g=INTL_GOALS[k]||[]; for(var i=0;i<g.length;i++){ if(y>=g[i][0]&&y<g[i][1]) return g[i]; } return g[g.length-1]||[0,0,'—','trade','cn']; }
/* 两国关系的时代基调（史实背景，0—100）；AI 的决策在其附近演化 */
var INTL_CLIMATE={
 'br|fr':[[1840,45],[1854,65],[1857,60],[1880,45],[1898,35],[1904,72],[1940,50],[1944,75]],
 'br|ru':[[1840,35],[1853,15],[1857,35],[1878,30],[1907,62],[1917,30],[1941,62],[1946,25],[1955,30]],
 'br|de':[[1840,60],[1871,55],[1898,42],[1906,32],[1919,40],[1925,52],[1936,40],[1939,8],[1949,65]],
 'br|jp':[[1840,50],[1868,55],[1902,78],[1923,50],[1931,38],[1937,28],[1941,6],[1952,55]],
 'br|us':[[1840,45],[1871,55],[1898,68],[1917,78],[1941,85]],
 'fr|ru':[[1840,45],[1853,20],[1857,45],[1892,72],[1917,30],[1935,50],[1939,35],[1941,55],[1946,40],[1966,48]],
 'de|fr':[[1840,45],[1866,35],[1870,10],[1871,20],[1919,22],[1925,38],[1933,22],[1939,6],[1945,20],[1950,50],[1963,72]],
 'fr|jp':[[1840,50],[1907,58],[1931,40],[1940,30],[1945,40],[1952,55]],
 'fr|us':[[1840,60],[1917,72],[1941,65],[1949,70],[1966,58]],
 'de|ru':[[1840,60],[1879,50],[1890,42],[1907,35],[1914,6],[1918,30],[1922,58],[1933,28],[1939,50],[1941,4],[1945,15],[1949,22],[1970,40]],
 'jp|ru':[[1840,45],[1875,50],[1895,30],[1904,6],[1905,30],[1907,50],[1917,30],[1925,40],[1931,28],[1938,18],[1941,40],[1945,10],[1956,35]],
 'ru|us':[[1840,60],[1867,62],[1905,50],[1917,30],[1933,45],[1941,62],[1946,22],[1963,30],[1969,35]],
 'de|jp':[[1840,50],[1895,38],[1914,15],[1919,40],[1936,70],[1945,50],[1952,58]],
 'de|us':[[1840,60],[1898,50],[1917,10],[1919,40],[1933,35],[1941,6],[1945,30],[1949,72]],
 'jp|us':[[1840,45],[1854,50],[1868,58],[1905,55],[1908,50],[1924,42],[1931,35],[1937,28],[1941,4],[1945,30],[1952,75]],
 'br|cn':[[1840,30],[1861,42],[1902,45],[1928,45],[1937,55],[1941,65],[1945,60],[1949,40],[1954,45],[1967,30],[1972,50]],
 'cn|fr':[[1840,40],[1856,30],[1861,42],[1884,20],[1886,40],[1928,45],[1945,50],[1949,30],[1964,50]],
 'cn|ru':[[1840,45],[1858,30],[1881,40],[1900,28],[1905,40],[1917,42],[1924,55],[1929,30],[1932,45],[1937,60],[1945,55],[1950,80],[1958,65],[1960,40],[1963,28],[1969,12],[1970,20]],
 'cn|de':[[1840,50],[1861,52],[1897,32],[1914,40],[1921,58],[1928,62],[1938,40],[1941,20],[1945,40],[1949,40],[1972,50]],
 'cn|jp':[[1840,50],[1871,50],[1874,40],[1894,15],[1895,35],[1905,38],[1915,22],[1919,30],[1928,25],[1931,12],[1937,4],[1945,30],[1952,30],[1972,55]],
 'cn|us':[[1840,52],[1844,55],[1899,58],[1908,62],[1928,60],[1937,65],[1941,75],[1945,70],[1949,20],[1950,8],[1954,15],[1969,22],[1971,35],[1972,50]]
};
var INTL_ALT_CN={br:58,fr:52,ru:35,de:48,jp:40,us:70};   /* 非“中共胜利”路线下 1949 年后与中国的基调 */
function intlClimate(a,b,y){
 var k=intlPK(a,b), t=INTL_CLIMATE[k], v=t?intlStep(t,y):50;
 if((a==='cn'||b==='cn')&&y>=1949&&!intlPRC()){ var o=a==='cn'?b:a; v=INTL_ALT_CN[o]||50; }
 var ra=intlRegime(a,y)[1], rb=intlRegime(b,y)[1];
 if(ra===rb&&ra!=='none') v+=4;
 if(y>=1945&&((ra==='comm')!==(rb==='comm'))&&ra!=='none'&&rb!=='none') v-=6;
 return Math.max(2,Math.min(95,v));
}
/* 陆上接壤（或隔一条边境线对峙）的两国，与对峙的地点 */
function intlFront(a,b,y){
 switch(intlPK(a,b)){
  case 'cn|ru': return y<1917?'黑龙江与新疆边境':(y<1949?'外蒙古与新疆边境':'中苏边境');
  case 'cn|jp': return y<1895?'朝鲜':(y<1945?'南满与华北':'');
  case 'cn|fr': return y>=1885&&y<1954?'中越边境':'';
  case 'br|cn': return y<1947?'滇缅与西藏边境':'';
  case 'jp|ru': return y<1905?'朝鲜与满洲':'库页岛与远东';
  case 'de|ru': return y<1945?'东欧边境':(y>=1949?'两德边界':'');
  case 'de|fr': return '莱茵河沿岸';
 }
 return '';
}
/* 结盟传统：英国 1902 年前“光荣孤立”、美国 1941 年前不结同盟、日本开国前不结盟 */
var INTL_ALLY_FROM={br:1902,us:1941,jp:1868,fr:1840,ru:1840,de:1840};
/* 同一国对同一对象的同类决策，至少隔这么多天 */
var INTL_CD={improve:300,trade:540,ally:720,nap:720,pressure:365,sanction:720,armup:300,reform:420,loan:720,mediate:365,border:365};
function intlCdOk(k,a,x,ord){ var I=s.intl; if(!I.cd) I.cd={}; var v=I.cd[k+a+(x||'')]; return v===undefined||ord-v>=INTL_CD[a]; }

/* ---------- 史实锚点 ----------
   k: war 交战 / clash 武装冲突 / hostile 敌对 / ally 同盟 / entente 协约 / nap 互不侵犯 / event 一次性（条约、政体更迭）
   ab: [a,b] 或 [[a,b],[a,c]...]；f/u: 起止 [年,月,日]；d: 一次性改变关系；st: 政体更迭时的国内稳定；prc: 只在“中共胜利”路线下 */
var INTL_HIST=[
 {id:'opium1',k:'war',ab:[['br','cn']],f:[1840,6,28],u:[1842,8,29],t:'第一次鸦片战争：英军封锁珠江口。',te:'《南京条约》签订，割香港岛，开放五口通商。'},
 {id:'crimea',k:'war',ab:[['ru','br'],['ru','fr']],f:[1854,3,28],u:[1856,3,30],t:'克里米亚战争：英、法对俄宣战。',te:'《巴黎和约》签订，克里米亚战争结束。'},
 {id:'opium2',k:'war',ab:[['br','cn'],['fr','cn']],f:[1856,10,8],u:[1860,10,24],t:'第二次鸦片战争：英国借“亚罗号事件”开衅，法国随后出兵。',te:'《北京条约》签订，第二次鸦片战争结束。'},
 {id:'aigun',k:'event',ab:[['ru','cn']],f:[1858,5,28],d:-10,t:'《瑷珲条约》：黑龙江以北约六十万平方公里划归俄国。'},
 {id:'peking60',k:'event',ab:[['ru','cn']],f:[1860,11,14],d:-8,t:'中俄《北京条约》：乌苏里江以东约四十万平方公里划归俄国。'},
 {id:'fpwar',k:'war',ab:[['fr','de']],f:[1870,7,19],u:[1871,5,10],t:'普法战争爆发。',te:'《法兰克福和约》签订，法国割让阿尔萨斯—洛林。'},
 {id:'reich',k:'event',ab:[['de','fr']],f:[1871,1,18],st:70,t:'德意志帝国在凡尔赛宫宣告成立。'},
 {id:'meiji',k:'event',ab:[['jp','us']],f:[1868,1,3],st:45,t:'日本王政复古，明治政府成立。'},
 {id:'sinofr',k:'war',ab:[['fr','cn']],f:[1884,8,23],u:[1885,6,9],t:'中法战争：法舰在马尾袭击福建水师。',te:'《中法新约》签订，中法战争结束。'},
 {id:'franru',k:'ally',ab:[['fr','ru']],f:[1894,1,4],u:[1917,11,7],t:'法俄同盟正式生效。',te:'俄国退出大战，法俄同盟瓦解。'},
 {id:'jiawu',k:'war',ab:[['jp','cn']],f:[1894,7,25],u:[1895,4,17],t:'甲午战争：日舰在丰岛海面袭击清军运兵船。',te:'《马关条约》签订：割台湾、澎湖，赔款二亿两。'},
 {id:'triple',k:'event',ab:[['ru','jp'],['de','jp'],['fr','jp']],f:[1895,4,23],d:-12,tn:20,t:'俄、德、法三国干涉，迫使日本退还辽东半岛。'},
 {id:'boxer',k:'war',ab:[['br','cn'],['fr','cn'],['ru','cn'],['de','cn'],['jp','cn'],['us','cn']],f:[1900,6,21],u:[1901,9,7],t:'八国联军侵华，攻陷天津、北京。',te:'《辛丑条约》签订，赔款四亿五千万两。'},
 {id:'angjp',k:'ally',ab:[['br','jp']],f:[1902,1,30],u:[1923,8,17],t:'英日同盟在伦敦缔结。',te:'英日同盟终止。'},
 {id:'rujp',k:'war',ab:[['jp','ru']],f:[1904,2,8],u:[1905,9,5],t:'日俄战争：日舰夜袭旅顺口。战场在中国东北。',te:'《朴茨茅斯和约》签订，日本取得南满权益。'},
 {id:'cordiale',k:'entente',ab:[['br','fr']],f:[1904,4,8],u:[1973,1,1],t:'英法签订《英法协约》。'},
 {id:'angru',k:'entente',ab:[['br','ru']],f:[1907,8,31],u:[1917,11,7],t:'英俄签订协约，三国协约成形。',te:'俄国革命，英俄协约失效。'},
 {id:'ww1br',k:'war',ab:[['br','de'],['fr','de'],['jp','de']],f:[1914,8,4],u:[1918,11,11],t:'第一次世界大战：英、法对德作战，日本随后对德宣战并进攻青岛。',te:'德国签署停战协定，第一次世界大战结束。'},
 {id:'ww1ru',k:'war',ab:[['ru','de']],f:[1914,8,1],u:[1918,3,3],t:'德国对俄宣战。',te:'苏俄与德国签订《布列斯特和约》，退出大战。'},
 {id:'21tiao',k:'event',ab:[['jp','cn']],f:[1915,5,25],d:-14,tn:15,t:'日本以最后通牒迫使北京政府接受“二十一条”中大部分条款。'},
 {id:'ww1us',k:'war',ab:[['us','de']],f:[1917,4,6],u:[1918,11,11],t:'美国对德宣战。',te:'美德停战。'},
 {id:'ww1cn',k:'war',ab:[['cn','de']],f:[1917,8,14],u:[1918,11,11],t:'北京政府对德、奥宣战。',te:'中德战争状态随大战停战结束。'},
 {id:'oct17',k:'event',ab:[['ru','de']],f:[1917,11,7],st:15,t:'俄国十月革命，布尔什维克夺取政权。'},
 {id:'versail',k:'event',ab:[['jp','cn']],f:[1919,6,28],d:-8,t:'《凡尔赛和约》将德国在山东的权益转给日本，中国代表拒绝签字。'},
 {id:'ussr',k:'event',ab:[['ru','us']],f:[1922,12,30],st:45,t:'苏联成立。'},
 {id:'ninep',k:'event',ab:[['jp','cn'],['us','cn']],f:[1922,2,6],d:5,t:'华盛顿会议签订《九国公约》，日本同意归还山东。'},
 {id:'cnru24',k:'event',ab:[['ru','cn']],f:[1924,5,31],d:10,t:'中苏建交，苏联放弃沙俄在华部分特权。'},
 {id:'cer29',k:'clash',ab:[['ru','cn']],f:[1929,7,17],u:[1929,12,22],t:'中东路事件：中苏在东北边境发生武装冲突。',te:'中苏签订《伯力协定》，中东路恢复原状。'},
 {id:'mukden',k:'hostile',ab:[['jp','cn']],f:[1931,9,18],u:[1937,7,7],t:'九一八事变，日本关东军占领东北。',te:''},
 {id:'hitler',k:'event',ab:[['de','fr']],f:[1933,1,30],st:55,t:'希特勒出任德国总理。'},
 {id:'jpleague',k:'event',ab:[['jp','us'],['jp','br']],f:[1933,3,27],d:-6,t:'日本退出国际联盟。'},
 {id:'antikom',k:'entente',ab:[['de','jp']],f:[1936,11,25],u:[1940,9,27],t:'德日签订《反共产国际协定》。',te:''},
 {id:'sinojp',k:'war',ab:[['jp','cn']],f:[1937,7,7],u:[1945,9,2],t:'七七事变，中日全面战争爆发。',te:'日本签署投降书，中日战争结束。'},
 {id:'cnrunap',k:'nap',ab:[['ru','cn']],f:[1937,8,21],u:[1945,8,14],t:'中苏签订《互不侵犯条约》，苏联开始援华。',te:''},
 {id:'molotov',k:'nap',ab:[['de','ru']],f:[1939,8,23],u:[1941,6,22],t:'苏德签订《互不侵犯条约》。',te:''},
 {id:'ww2eu',k:'war',ab:[['br','de']],f:[1939,9,3],u:[1945,5,8],t:'第二次世界大战：英、法对德宣战。',te:'德国无条件投降，欧洲战事结束。'},
 {id:'ww2fr',k:'war',ab:[['fr','de']],f:[1939,9,3],u:[1940,6,22],t:'法国对德宣战。',te:'法国战败投降，维希政权成立。'},
 {id:'axis',k:'ally',ab:[['de','jp']],f:[1940,9,27],u:[1945,5,8],t:'德、意、日在柏林签订三国同盟条约。',te:''},
 {id:'rujpnap',k:'nap',ab:[['ru','jp']],f:[1941,4,13],u:[1945,8,8],t:'苏日签订《中立条约》。',te:''},
 {id:'barb',k:'war',ab:[['ru','de']],f:[1941,6,22],u:[1945,5,8],t:'德国入侵苏联。',te:''},
 {id:'pacific',k:'war',ab:[['us','jp'],['br','jp']],f:[1941,12,7],u:[1945,9,2],t:'日军偷袭珍珠港，太平洋战争爆发。',te:'日本投降，太平洋战争结束。'},
 {id:'usde41',k:'war',ab:[['us','de']],f:[1941,12,11],u:[1945,5,8],t:'德国对美宣战。',te:''},
 {id:'unitedn',k:'ally',ab:[['us','cn'],['br','cn']],f:[1942,1,1],u:[1945,9,2],t:'中、美、英、苏等二十六国签署《联合国家宣言》。',te:''},
 {id:'extrat',k:'event',ab:[['us','cn'],['br','cn']],f:[1943,1,11],d:8,t:'美、英与中国签约，放弃在华治外法权。'},
 {id:'paris44',k:'event',ab:[['fr','de']],f:[1944,8,25],st:40,t:'巴黎光复。'},
 {id:'rujp45',k:'war',ab:[['ru','jp']],f:[1945,8,8],u:[1945,9,2],t:'苏联对日宣战，出兵中国东北。',te:''},
 {id:'cnru45',k:'event',ab:[['ru','cn']],f:[1945,8,14],d:4,t:'国民政府与苏联签订《中苏友好同盟条约》。'},
 {id:'un45',k:'event',ab:[['us','cn'],['br','cn']],f:[1945,10,24],d:3,t:'联合国成立，中国为安理会常任理事国。'},
 {id:'coldwar',k:'hostile',ab:[['us','ru']],f:[1947,3,12],u:[1973,1,1],t:'杜鲁门主义出台，冷战开始。'},
 {id:'nato',k:'ally',ab:[['us','br'],['us','fr'],['br','fr']],f:[1949,4,4],u:[1973,1,1],t:'北大西洋公约组织成立。'},
 {id:'frg',k:'event',ab:[['de','us']],f:[1949,5,23],st:55,t:'德意志联邦共和国成立。'},
 {id:'prcus',k:'hostile',prc:1,ab:[['us','cn']],f:[1949,10,1],u:[1971,7,15],t:'中华人民共和国成立，美国拒不承认新政府。',te:'基辛格秘密访华后，美方宣布尼克松将访华。'},
 {id:'ukprc',k:'event',prc:1,ab:[['br','cn']],f:[1950,1,6],d:6,t:'英国承认中华人民共和国。'},
 {id:'cnru50',k:'ally',prc:1,ab:[['ru','cn']],f:[1950,2,14],u:[1960,7,16],t:'《中苏友好同盟互助条约》在莫斯科签订。',te:'苏联撤走在华专家，中苏同盟名存实亡。'},
 {id:'korea',k:'war',prc:1,ab:[['us','cn']],f:[1950,10,19],u:[1953,7,27],t:'中国人民志愿军入朝，与美军交战。',te:'朝鲜停战协定签订。'},
 {id:'usjp51',k:'ally',ab:[['us','jp']],f:[1951,9,8],u:[1973,1,1],t:'《美日安全保障条约》签订。'},
 {id:'jpsov',k:'event',ab:[['jp','us']],f:[1952,4,28],st:60,t:'《旧金山和约》生效，日本恢复主权。'},
 {id:'frgnato',k:'ally',ab:[['de','us'],['de','br'],['de','fr']],f:[1955,5,9],u:[1973,1,1],t:'联邦德国加入北约。'},
 {id:'cuba',k:'event',ab:[['us','ru']],f:[1962,10,22],d:-8,tn:35,t:'古巴导弹危机。'},
 {id:'sinosov',k:'hostile',prc:1,ab:[['ru','cn']],f:[1963,7,14],u:[1973,1,1],t:'中苏公开论战，两党关系破裂。'},
 {id:'frprc',k:'event',prc:1,ab:[['fr','cn']],f:[1964,1,27],d:15,t:'中法建交。'},
 {id:'zhenbao',k:'clash',prc:1,ab:[['ru','cn']],f:[1969,3,2],u:[1969,9,11],t:'珍宝岛事件：中苏边境爆发武装冲突。',te:'周恩来与柯西金在北京机场会晤，边境局势暂缓。'},
 {id:'nixon',k:'event',prc:1,ab:[['us','cn']],f:[1972,2,21],d:12,t:'尼克松访华，中美发表《上海公报》。'},
 {id:'ukamb',k:'event',prc:1,ab:[['br','cn']],f:[1972,3,13],d:6,t:'中英升格为大使级外交关系。'},
 {id:'cnjp72',k:'event',prc:1,ab:[['jp','cn']],f:[1972,9,29],d:15,t:'中日发表联合声明，两国建交。'}
];
INTL_HIST.forEach(function(h){ h.fo=calOrd(h.f[0],h.f[1],h.f[2]); h.uo=h.u?calOrd(h.u[0],h.u[1],h.u[2]):0; });
var INTL_LOCK_TXT={war:'交战',clash:'武装冲突',hostile:'敌对',ally:'同盟',entente:'协约',nap:'互不侵犯'};
var INTL_LOCK_RANK={war:6,clash:5,hostile:4,ally:3,entente:2,nap:1};
function intlHistOn(h,ord){ if(h.prc&&!intlPRC()) return false; return h.k!=='event'&&ord>=h.fo&&ord<h.uo; }
function intlHasPair(h,a,b){ for(var i=0;i<h.ab.length;i++){ var p=h.ab[i]; if((p[0]===a&&p[1]===b)||(p[0]===b&&p[1]===a)) return true; } return false; }
/* 当前两国之间最强的史实锁（或玩家自己宣战造成的交战） */
function intlLock(a,b,ord){
 if(ord===undefined) ord=s.cal.ord;
 var best=null;
 for(var i=0;i<INTL_HIST.length;i++){ var h=INTL_HIST[i]; if(intlHistOn(h,ord)&&intlHasPair(h,a,b)&&(!best||INTL_LOCK_RANK[h.k]>INTL_LOCK_RANK[best.k])) best=h; }
 if(!best&&(a==='cn'||b==='cn')){ var o=a==='cn'?b:a, P=s.__powers&&s.__powers[INTL_POW[o]]; if(P&&P.war) best={k:'war',id:'player',t:'你方宣战'}; }
 return best;
}

/* ---------- 状态 ---------- */
function intlRand(){
 var I=s.intl, a=(I.rs|0)+0x6D2B79F5|0; I.rs=a;
 var t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
 return ((t^t>>>14)>>>0)/4294967296;
}
function intlMonthKey(o){ return o.y*12+o.m-1; }
function intlRel(a,b){
 if(a===b) return 100;
 if(a==='cn'||b==='cn'){ initPowers(); var o=a==='cn'?b:a, P=s.__powers[INTL_POW[o]]; return P?(+P.r||0):50; }
 var v=s.intl.r[intlPK(a,b)]; return v===undefined?50:v;
}
function intlSetRel(a,b,v){
 v=intlCl(v,0,100);
 if(a==='cn'||b==='cn'){ initPowers(); var o=a==='cn'?b:a, P=s.__powers[INTL_POW[o]]; if(P) P.r=v; return v; }
 s.intl.r[intlPK(a,b)]=v; return v;
}
function intlAddRel(a,b,d){ return intlSetRel(a,b,intlRel(a,b)+d); }
function intlTen(a,b){ var v=s.intl.t[intlPK(a,b)]; return v===undefined?0:v; }
function intlSetTen(a,b,v){ s.intl.t[intlPK(a,b)]=intlCl(v,0,100); }
function intlAddTen(a,b,d){ intlSetTen(a,b,intlTen(a,b)+d); }
function intlPower(k,y){
 if(k==='cn'){ var N=s.natl||{}; return Math.max(5,Math.min(95,((+N.军事||40)*0.35+(+N.经济||40)*0.25+(+N.工业||15)*0.2+(+N.稳定||50)*0.2)*0.8)); }
 var n=s.intl.n[k]; if(!n) return 0;
 return Math.max(1,Math.min(100,intlCurve(INTL_REF[k],y)+n.mil*0.4+n.eco*0.4+(n.stab-60)*0.15));
}
function intlTreaties(a,b,kind){ return (s.intl.tr||[]).filter(function(t){ return (!kind||t.k===kind)&&(!a||t.a===a||t.b===a)&&(!b||t.a===b||t.b===b); }); }
function intlNews(t,kind,a,b,hist,me){
 var I=s.intl; I.news.unshift({o:s.cal.ord,t:t,k:kind,a:a||'',b:b||'',h:hist?1:0,me:me||''});
 if(I.news.length>40) I.news.length=40;
}
function intlInit(fresh){
 if(!s||!s.cal) return;
 initPowers();
 var today=s.cal.ord, y=calFromOrd(today).y;
 var I={v:1,rs:(Math.floor(Math.random()*4294967296)>>>0)|0,last:intlMonthKey(calFromOrd(today)),hd:{},n:{},r:{},t:{},tr:[],news:[],ld:{},acc:0,dec:0,hn:0,mig:fresh?0:1};
 s.intl=I;
 INTL_KEYS.forEach(function(k){
  var pv={}; ['agg','trade','prag','act'].forEach(function(f){ pv[f]=Math.round((intlRand()-0.5)*24); });
  I.n[k]={pv:pv,mil:Math.round((intlRand()-0.5)*8),eco:Math.round((intlRand()-0.5)*8),stab:Math.round(55+intlRand()*15),acts:0};
 });
 for(var i=0;i<INTL_ALL.length;i++) for(var j=i+1;j<INTL_ALL.length;j++){
  var a=INTL_ALL[i], b=INTL_ALL[j], c=intlClimate(a,b,y);
  if((a==='cn'||b==='cn')&&!fresh){ /* 旧档：保留玩家已经打出的对华关系 */ }
  else intlSetRel(a,b,c+(intlRand()-0.5)*12);
  intlSetTen(a,b,Math.max(0,(55-intlRel(a,b))*1.1));
 }
 /* 开局之前已经发生的史实：静默落地（不写纪事），只设锁与标记 */
 INTL_HIST.forEach(function(h){ if(h.fo<=today){ I.hd[h.id]=1; if(h.uo&&h.uo<=today) I.hd[h.id+'_e']=1; } });
 intlApplyLocks(today);
 I.hn=intlNextHistOrd();
 return I;
}
function intlEnsure(){
 if(!s||!s.cal) return null;
 if(!s.intl||typeof s.intl!=='object'||!s.intl.n||!s.intl.r) intlInit(false);
 var I=s.intl;
 if(!Array.isArray(I.tr)) I.tr=[]; if(!Array.isArray(I.news)) I.news=[]; if(!I.hd) I.hd={}; if(!I.t) I.t={}; if(!I.ld) I.ld={};
 INTL_KEYS.forEach(function(k){ if(!I.n[k]) I.n[k]={pv:{agg:0,trade:0,prag:0,act:0},mil:0,eco:0,stab:60,acts:0}; });
 if(typeof I.last!=='number'||!isFinite(I.last)) I.last=intlMonthKey(calFromOrd(s.cal.ord));
 if(typeof I.rs!=='number') I.rs=12345;
 return I;
}
/* 锁：把史实时期的关系压进合理区间 */
function intlApplyLocks(ord){
 for(var i=0;i<INTL_ALL.length;i++) for(var j=i+1;j<INTL_ALL.length;j++){
  var a=INTL_ALL[i], b=INTL_ALL[j], L=intlLock(a,b,ord); if(!L) continue;
  var r=intlRel(a,b), t=intlTen(a,b);
  if(L.k==='war'){ if(r>10) intlSetRel(a,b,10); if(t<85) intlSetTen(a,b,85); }
  else if(L.k==='clash'){ if(r>15) intlSetRel(a,b,15); if(t<80) intlSetTen(a,b,80); }
  else if(L.k==='hostile'){ if(r>30) intlSetRel(a,b,30); if(t<50) intlSetTen(a,b,50); }
  else if(L.k==='ally'){ if(r<72) intlSetRel(a,b,72); if(t>20) intlSetTen(a,b,20); }
  else if(L.k==='entente'){ if(r<60) intlSetRel(a,b,60); if(t>35) intlSetTen(a,b,35); }
  else if(L.k==='nap'){ if(r<35) intlSetRel(a,b,35); }
 }
}
function intlNextHistOrd(){
 var best=Infinity, I=s.intl;
 INTL_HIST.forEach(function(h){
  if(!I.hd[h.id]&&h.fo<best) best=h.fo;
  if(h.uo&&h.k!=='event'&&!I.hd[h.id+'_e']&&h.uo<best) best=h.uo;
 });
 return best===Infinity?CAL_END_ORD+1:best;
}
function intlPairsText(h){
 var seen={}, names=[];
 h.ab.forEach(function(p){ p.forEach(function(k){ if(!seen[k]){ seen[k]=1; names.push(k); } }); });
 return names;
}
/* 每日：只比较一个数（下一个史实日期），不到就什么也不做 */
function intlDay(now){
 if(!s||!s.intl) return;
 var I=s.intl, today=s.cal.ord;
 if(today<I.hn) return;
 INTL_HIST.forEach(function(h){
  var on=!h.prc||intlPRC();
  if(!I.hd[h.id]&&h.fo<=today){
   I.hd[h.id]=1;
   if(!on) return;
   h.ab.forEach(function(p){ if(h.d) intlAddRel(p[0],p[1],h.d); if(h.tn) intlAddTen(p[0],p[1],h.tn); });
   if(h.st!==undefined){ var k0=h.ab[0][0]; if(s.intl.n[k0]) s.intl.n[k0].stab=h.st; }
   intlNews(h.t,h.k,h.ab[0][0],h.ab[0][1],1,'');
  }
  if(h.uo&&h.k!=='event'&&!I.hd[h.id+'_e']&&h.uo<=today){
   I.hd[h.id+'_e']=1;
   if(!on) return;
   if(h.k==='war'||h.k==='clash'||h.k==='hostile') h.ab.forEach(function(p){ intlSetTen(p[0],p[1],Math.min(intlTen(p[0],p[1]),55)); intlSetRel(p[0],p[1],Math.max(intlRel(p[0],p[1]),18)); });
   if(h.te) intlNews(h.te,h.k+'-end',h.ab[0][0],h.ab[0][1],1,'');
  }
 });
 intlApplyLocks(today);
 I.hn=intlNextHistOrd();
}

/* ---------- 每月：国家 AI ---------- */
function intlCentral(){
 if(!s) return false;
 var y=s.year, f=s.faction, o=s.cal.ord;
 var cf=y<1912?'qing':(y<1928?'beiyang':(o<INTL_PRC_ORD?'kmt':(intlPRC()?'cpc':'kmt')));
 return f===cf;
}
function intlNatl(d){
 if(!s.natl) return '';
 var out=[];
 Object.keys(d).forEach(function(k){ if(!d[k]) return; s.natl[k]=clamp((+s.natl[k]||0)+d[k]); out.push((NAT_KEYS.filter(function(x){return x[0]===k;})[0]||[k,k])[1]+' '+(d[k]>0?'+':'')+d[k]); });
 return out.join('，');
}
/* 涉华动向对玩家的后果：国势一律变化；再按身份给出具体后果 */
function intlChina(kind,k,natl){
 var line=intlNatl(natl||{}), me='', role=LIVE_LINE[s.role];
 if(s.isLeader&&intlCentral()) me='你执掌中枢，须亲自应对';
 else if(role==='biz'&&(kind==='trade'||kind==='sanction'||kind==='loan')) me=kind==='sanction'?'洋货断档，铺面生意受挫':(kind==='trade'?'口岸生意见旺，铺面进项随之起落':'借款入库，市面银根稍松');
 else if((role==='mil')&&(kind==='border'||kind==='pressure')){ me='边情吃紧，营中加紧戒备'; if(s.unit&&isMil()) s.unit.mor=clamp((+s.unit.mor||50)+2); }
 else if(role==='civ'&&(s.rank||0)>=3&&(kind==='pressure'||kind==='loan')) me='交涉与摊派的公事落到你手上';
 return (line?('国势：'+line):'')+(me?((line?'；':'')+me):'');
}
var INTL_ACT_NAME={improve:'修好',trade:'通商',ally:'结盟',nap:'互不侵犯',pressure:'施压',sanction:'制裁',armup:'扩军',reform:'改革',loan:'借款',mediate:'调停',border:'边境对峙'};
function intlCandidates(k,ord,y){
 var I=s.intl, n=I.n[k], P=intlPers(k,y), pw=intlPower(k,y), goal=intlGoal(k,y), out=[], foreign=intlForeign(k,ord);
 var R=function(){ return intlRand(); };
 /* 内政 */
 var threat=0, rival=null;
 INTL_ALL.forEach(function(x){ if(x===k) return; var tv=intlTen(k,x)*0.6+Math.max(0,intlPower(x,y)-pw)*0.4; if(tv>threat){ threat=tv; rival=x; } });
 out.push({a:'armup',u:6+threat*0.45+(P.agg-50)*0.35-Math.max(0,40-(50+n.eco))*0.5-(n.mil>10?n.mil:0)+R()*8,x:rival});
 out.push({a:'reform',u:6+(55-n.stab)*0.7+Math.max(0,-n.eco)*0.6+(P.prag-50)*0.15+R()*8});
 if(!foreign) return out;
 INTL_ALL.forEach(function(x){
  if(x===k) return;
  if(x!=='cn'&&!intlActive(x,ord)) return;
  var r=intlRel(k,x), t=intlTen(k,x), L=intlLock(k,x,ord), Lk=L?L.k:'', clim=intlClimate(k,x,y), xp=intlPower(x,y);
  var hostileL=Lk==='war'||Lk==='clash'||Lk==='hostile';
  /* 共同的对手 */
  var ce=0; INTL_ALL.forEach(function(z){ if(z===k||z===x) return; var h=Math.min(100-intlRel(k,z),100-intlRel(x,z)); if(h>ce) ce=h; });
  var targ=goal[4]===x&&(goal[3]==='expand'||goal[3]==='revanche'||goal[3]==='ideology');
  if(!hostileL&&r<80&&r<clim+18) out.push({a:'improve',x:x,u:4+(r<clim?6:0)+Math.max(0,ce-55)*0.35+(P.trade-50)*0.12+(P.prag-50)*0.1-(targ?15:0)+R()*10});
  if(!hostileL&&r>=60&&!intlTreaties(k,x,'trade').length&&!intlTreaties(k,x,'sanction').length) out.push({a:'trade',x:x,u:12+(P.trade-50)*0.4+(r-60)*0.35+R()*10});
  var bloc=y<1945;   /* 1945 年后的阵营（北约、美日、中苏）由史实决定，AI 不另结同盟 */
  if(x!=='cn'&&!L&&r>=75&&ce>=65&&clim>=55&&bloc&&y>=INTL_ALLY_FROM[k]&&y>=INTL_ALLY_FROM[x]&&!intlTreaties(k,x,'ally').length&&intlTreaties(k,null,'ally').length<2) out.push({a:'ally',x:x,u:22+(ce-65)*0.8+R()*10});
  if(x!=='cn'&&!L&&r>=38&&r<75&&t>=40&&!intlTreaties(k,x,'nap').length&&!intlTreaties(k,x,'ally').length){
   var front=0; INTL_ALL.forEach(function(z){ if(z!==k&&z!==x) front=Math.max(front,intlTen(k,z)); });
   if(front>=55) out.push({a:'nap',x:x,u:12+(front-55)*0.5+(P.prag-50)*0.2+R()*8});
  }
  if(Lk!=='war'&&Lk!=='ally'&&(targ||r<35)&&pw>xp+8&&!(x==='cn'&&k==='de'&&y>=1919)) out.push({a:'pressure',x:x,u:4+(P.agg-50)*0.55+(40-r)*0.45+(pw-xp)*0.25+(targ?10:0)+(x==='cn'&&y>=1945?-12:0)+R()*8});
  if(Lk!=='ally'&&r<30&&pw>=xp*0.8&&!intlTreaties(k,x,'sanction').length&&y>=1870&&!(x==='cn'&&y<1945)) out.push({a:'sanction',x:x,u:6+(30-r)*0.7+(P.agg-50)*0.2+(P.trade-50)*0.1+R()*8});
  var need=x==='cn'?Math.max(0,45-((s.natl&&+s.natl.财政)||40)):Math.max(0,-(I.n[x]?I.n[x].eco:0));
  var prcLoan=!(x==='cn'&&ord>=INTL_PRC_ORD&&intlPRC()&&!(Lk==='ally'));
  if(!hostileL&&prcLoan&&r>=50&&n.eco>=-2&&need>3&&!intlTreaties(k,x,'loan').length) out.push({a:'loan',x:x,u:8+need*0.7+(P.trade-50)*0.25+R()*8});
  if(Lk!=='ally'&&Lk!=='entente'&&t>=68&&P.agg>=50&&intlFront(k,x,y)&&Lk!=='war') out.push({a:'border',x:x,u:4+(t-68)*0.7+(P.agg-50)*0.45+R()*8});
 });
 /* 调停：与两方都不错，而两方剑拔弩张 */
 for(var i=0;i<INTL_ALL.length;i++) for(var j=i+1;j<INTL_ALL.length;j++){
  var b=INTL_ALL[i], c=INTL_ALL[j]; if(b===k||c===k) continue;
  var tt=intlTen(b,c), Lb=intlLock(b,c,ord);
  if(tt>=65&&intlRel(k,b)>=55&&intlRel(k,c)>=55&&!(Lb&&(Lb.k==='war'||Lb.k==='clash'))) out.push({a:'mediate',x:b,y:c,u:6+(tt-65)*0.7+(P.prag-50)*0.3+R()*8});
 }
 return out.filter(function(c){ return intlCdOk(k,c.a,c.x,ord); });
}
function intlDo(k,c,ord,y){
 var I=s.intl, n=I.n[k], A=intlName(k,ord), x=c.x, X=x?intlName(x,ord):'', news='', me='', cnGov=intlCnName(ord);
 if(!I.cd) I.cd={}; I.cd[k+c.a+(x||'')]=ord;
 function pk(a){ return a[Math.floor(intlRand()*a.length)]; }
 switch(c.a){
  case 'armup': n.mil=intlCl(n.mil+4,-20,25); n.eco=intlCl(n.eco-1.5,-25,25);
   if(x) intlAddTen(k,x,4);
   var parl=intlRegime(k,y)[1]==='lib'||(k==='jp'&&y>=1890)||(k==='de'&&y>=1871&&y<1933);
   news=A+pk(parl?['议会通过扩军预算','增建舰队','扩编陆军']:['增建舰队','扩编陆军','添购新式枪炮'])+(x?'，矛头所向是'+X:'')+'。'; break;
  case 'reform':
   if(intlRand()<0.62+(intlPers(k,y).prag-50)/250){ n.stab=intlCl(n.stab+6,0,100); n.eco=intlCl(n.eco+2.5,-25,25); news=A+'推行'+(['财政','行政','军制','税制'][Math.floor(intlRand()*4)])+'改革，国内渐稳。'; }
   else { n.stab=intlCl(n.stab-3,0,100); news=A+'改革受阻，内阁更迭。'; }
   break;
  case 'improve': intlAddRel(k,x,4+intlRand()*3); intlAddTen(k,x,-4);
   news=x==='cn'?pk(y<1943?[A+'公使与'+cnGov+'往来频繁，对华关系转暖。',A+'减让部分在华商约条款，对华关系转暖。',A+'派特使访华，与'+cnGov+'商谈悬案。']:[A+'派特使访华，与'+cnGov+'商谈悬案。',A+'与'+cnGov+'扩大文化与贸易往来。']):pk([A+'遣使赴'+X+'，两国关系转暖。',A+'与'+X+'了结一桩边界、侨民或债务悬案，关系转暖。',A+'派高级使团访问'+X+'。']);
   if(x==='cn') me=intlChina('improve',k,{});
   break;
  case 'trade': I.tr.push({id:'t'+ord+k+x,k:'trade',a:k,b:x,f:ord,u:ord+3650}); intlAddRel(k,x,4); n.eco=intlCl(n.eco+1.5,-25,25);
   if(I.n[x]) I.n[x].eco=intlCl(I.n[x].eco+1.5,-25,25);
   news=x==='cn'?(A+'与'+cnGov+'议定新的通商章程，为期十年。'):(A+'与'+X+'签订通商协定，为期十年。');
   if(x==='cn') me=intlChina('trade',k,{经济:1});
   break;
  case 'ally': I.tr.push({id:'a'+ord+k+x,k:'ally',a:k,b:x,f:ord,u:0}); intlAddRel(k,x,5);
   var z=null, zh=0; INTL_ALL.forEach(function(q){ if(q===k||q===x) return; var h=Math.min(100-intlRel(k,q),100-intlRel(x,q)); if(h>zh){ zh=h; z=q; } });
   if(z){ intlAddTen(k,z,6); intlAddTen(x,z,6); }
   news=A+'与'+X+'缔结同盟'+(z?'，矛头指向'+intlName(z,ord):'')+'。'; break;
  case 'nap': I.tr.push({id:'n'+ord+k+x,k:'nap',a:k,b:x,f:ord,u:ord+3650}); intlAddTen(k,x,-15); intlAddRel(k,x,4);
   news=A+'与'+X+'签订互不侵犯协定，为期十年。'; break;
  case 'pressure': intlAddRel(k,x,-5); intlAddTen(k,x,8);
   if(x==='cn'){
    if(y<1945){ news=A+'公使照会'+cnGov+'，要求扩大在华'+pk(({br:['商务','内河航行','西藏'],fr:['路矿','传教','滇越铁路'],ru:['中东铁路','外蒙古','路矿'],de:['路矿','商务'],jp:['路矿','驻兵','内河航行','商务'],us:['商务','传教']})[k])+'权益。'; me=intlChina('pressure',k,{国际:-1}); intlDemand(k); }
    else { news=A+'就'+(({ru:'边界问题',us:intlPRC()?'台湾问题':'驻军与援助条件',jp:'战后赔偿与侨务',br:'香港与侨务',fr:'印度支那问题',de:'贸易问题'})[k])+'向'+cnGov+'提出强硬交涉。'; me=intlChina('pressure',k,{国际:-1}); }
   } else news=A+'向'+X+'提出强硬照会，两国关系紧张。';
   break;
  case 'sanction': I.tr.push({id:'s'+ord+k+x,k:'sanction',a:k,b:x,f:ord,u:ord+730+Math.floor(intlRand()*730)}); intlAddRel(k,x,-6); intlAddTen(k,x,6);
   if(I.n[x]) I.n[x].eco=intlCl(I.n[x].eco-4,-25,25); n.eco=intlCl(n.eco-1,-25,25);
   news=A+'对'+X+'实行贸易禁运。'; if(x==='cn') me=intlChina('sanction',k,{经济:-2,财政:-1}); break;
  case 'loan': I.tr.push({id:'l'+ord+k+x,k:'loan',a:k,b:x,f:ord,u:ord+1825}); intlAddRel(k,x,4);
   if(x==='cn'){ if(y<1928){ news=A+'银行团向'+cnGov+'提供借款，以关税、盐税作抵。'; me=intlChina('loan',k,{财政:2,国际:-1}); } else { news=A+'向'+cnGov+'提供'+(y<1945?'借款与信用贷款':'长期贷款')+'。'; me=intlChina('loan',k,{财政:2}); } }
   else { if(I.n[x]) I.n[x].eco=intlCl(I.n[x].eco+3,-25,25); news=A+'向'+X+'提供贷款。'; }
   break;
  case 'mediate': intlAddTen(c.x,c.y,-12); intlAddRel(k,c.x,2); intlAddRel(k,c.y,2);
   news=A+'出面调停'+intlName(c.x,ord)+'与'+intlName(c.y,ord)+'的争端，局势稍缓。';
   if(c.x==='cn'||c.y==='cn') me=intlChina('mediate',k,{国际:1});
   break;
  case 'border': intlAddTen(k,x,6); intlAddRel(k,x,-3);
   news=A+'在'+intlFront(k,x,y)+'增兵，与'+X+'对峙。'; if(x==='cn') me=intlChina('border',k,{秩序:-1}); break;
 }
 n.acts=(n.acts||0)+1; I.dec=(I.dec||0)+1;
 if(news){
  intlNews(news,c.a,k,x||'',0,me);
  if(x==='cn'||c.y==='cn') try{ log('【外事】'+news+(me?'（'+me+'）':'')); }catch(e){}
  else if(c.a==='ally') try{ log('【列国】'+news); }catch(e){}
 }
}
/* 执掌中枢时，列强照会要你亲自决断（进入弹窗队列，不覆盖其它弹窗） */
function intlDemand(k){
 if(!s||!s.isLeader||!intlCentral()) return;
 var I=s.intl, last=I.ld[k]||-99999, any=I.ld._any||-99999;
 if(s.cal.ord-last<365||s.cal.ord-any<180) return;   /* 同一国一年至多一次，各国合计半年至多一次 */
 I.ld[k]=s.cal.ord; I.ld._any=s.cal.ord;
 dlgOpen('intl',k);
}
function intlDemandDlg(k){
 if(!s||!s.intl||INTL_KEYS.indexOf(k)<0) return false;
 var A=intlName(k), ord=s.cal.ord;
 $('dlgTag').textContent='外事 · '+calFmtOrd(ord);
 $('dlgTitle').textContent=A+'的照会';
 $('dlgDesc').textContent=A+'公使递来照会，要求扩大在华权益，并暗示若不答应将“自行设法”。眼下与'+A+'的关系 '+Math.round(intlRel(k,'cn'))+'，紧张度 '+Math.round(intlTen(k,'cn'))+'。';
 var body=$('dlgBody'); body.innerHTML='';
 var opts=[
  {t:'据理交涉，寸步不让',d:'民心可用，但对方会更强硬。',run:function(){ intlAddRel(k,'cn',-6); intlAddTen(k,'cn',10); return intlNatl({民心:2,国际:-1})+'；与'+A+'关系 -6'; }},
  {t:'有限让步，换取缓和',d:'让出一些利权，换几年太平。',run:function(){ intlAddRel(k,'cn',6); intlAddTen(k,'cn',-10); return intlNatl({国际:-2,财政:-1,民心:-2})+'；与'+A+'关系 +6'; }},
  {t:'拖延不复',d:'先放一放，看对方下一步。',run:function(){ if(intlRand()<0.4){ intlAddRel(k,'cn',-3); intlAddTen(k,'cn',6); return A+'认为受了怠慢，与'+A+'关系 -3'; } return '对方没有再催'; }}
 ];
 opts.forEach(function(o){
  var b=document.createElement('button'); b.className='choice';
  b.innerHTML='<b>'+o.t+'</b><div class="sub">'+o.d+'</div>';
  b.onclick=function(){ var r=o.run(); intlNews('你对'+A+'照会的答复：'+o.t+'。','reply',k,'cn',0,r); try{ log('【外事】答复'+A+'照会：'+o.t+'。'+r+'。'); }catch(e){} $('mask').classList.add('hidden'); try{ persist(); render(); }catch(e){} };
  body.appendChild(b);
 });
 $('mask').classList.remove('hidden');
 return true;
}
/* 月度维护：关系向时代基调回归、紧张度回落、条约到期、锁 */
function intlMaintain(ord,y){
 var I=s.intl;
 INTL_KEYS.forEach(function(k){
  var n=I.n[k];
  n.mil=intlCl(n.mil*0.97,-25,25); n.eco=intlCl(n.eco*0.97+(n.stab-50)*0.01,-25,25);
  n.stab=intlCl(n.stab+(62-n.stab)*0.03+(intlRand()-0.5)*1.2,0,100);
  if(n.stab<25&&intlActive(k,ord)&&intlRand()<0.15) intlNews(intlName(k,ord)+'国内罢工与骚乱频发，政局不稳。','unrest',k,'',0,'');
 });
 for(var i=0;i<INTL_ALL.length;i++) for(var j=i+1;j<INTL_ALL.length;j++){
  var a=INTL_ALL[i], b=INTL_ALL[j], r=intlRel(a,b), c=intlClimate(a,b,y);
  intlTreaties(a,b).forEach(function(t){ if(t.k==='ally') c+=10; else if(t.k==='trade'||t.k==='nap') c+=5; else if(t.k==='sanction') c-=8; });
  var nr=r+(c-r)*0.04+(intlRand()-0.5)*1.2, c0=intlClimate(a,b,y);
  if(!intlLock(a,b,ord)) nr=Math.max(c0-30,Math.min(c0+30,nr));   /* 没有史实锁时，AI 只能在时代基调 ±30 之内演化 */
  intlSetRel(a,b,nr);
  var tgt=Math.max(0,(55-intlRel(a,b))*1.2);
  var t=intlTen(a,b); intlSetTen(a,b,t+(tgt-t)*0.06);
 }
 /* 条约到期 / 破裂 */
 I.tr=I.tr.filter(function(t){
  var r=intlRel(t.a,t.b), A=intlName(t.a,ord), B=intlName(t.b,ord), dead=false, why='';
  if(t.u&&ord>=t.u&&t.k==='trade'&&r>=60){ t.u=ord+3650; return true; }   /* 关系仍好：通商协定自动续约 */
  if(t.u&&ord>=t.u){ dead=true; why=t.k==='sanction'?A+'解除对'+B+'的禁运。':(t.k==='loan'?A+'对'+B+'的借款到期结清。':A+'与'+B+'的'+(t.k==='trade'?'通商协定':'互不侵犯协定')+'期满。'); }
  else if(t.k==='ally'&&(r<55||intlClimate(t.a,t.b,y)<45)){ dead=true; why=A+'与'+B+'的同盟名存实亡。'; }
  else if(t.k==='trade'&&r<38){ dead=true; why=A+'与'+B+'交恶，通商协定中止。'; }
  else if(t.k==='nap'&&r<25){ dead=true; why=A+'与'+B+'的互不侵犯协定破裂。'; }
  else if(t.k==='sanction'&&r>50){ dead=true; why=A+'与'+B+'关系缓和，禁运解除。'; }
  else { var L=intlLock(t.a,t.b,ord); if(L&&(L.k==='war'||L.k==='clash')&&t.k!=='sanction'){ dead=true; why=A+'与'+B+'兵戎相见，原有条约作废。'; } }
  if(dead){ intlNews(why,t.k+'-end',t.a,t.b,0,''); if(t.a==='cn'||t.b==='cn') try{ log('【外事】'+why); }catch(e){} }
  return !dead;
 });
 intlApplyLocks(ord);
 /* 列强对华关系的平均水平，慢慢影响国际地位（累积到整数才落账） */
 var sum=0; INTL_KEYS.forEach(function(k){ sum+=intlRel(k,'cn'); });
 I.acc=(+I.acc||0)+Math.max(-0.3,Math.min(0.3,(sum/INTL_KEYS.length-48)/100));
 if(Math.abs(I.acc)>=1&&s.natl){ var d=I.acc>0?1:-1; s.natl.国际=clamp((+s.natl.国际||0)+d); I.acc-=d; }
 /* 军政页“列强”的实力与 AI 的国力一致 */
 initPowers(); INTL_KEYS.forEach(function(k){ var P=s.__powers[INTL_POW[k]]; if(P) P.p=Math.round(intlPower(k,y)); });
}
function intlRunMonth(mk){
 var I=s.intl, ord=s.cal.ord, y=calFromOrd(ord).y;
 I.last=mk;                                   /* 先落标记：即使下面出错也不会重算本月 */
 intlMaintain(ord,y);
 INTL_KEYS.forEach(function(k){
  if(!intlActive(k,ord)&&!(k==='jp'||k==='de')) return;
  var P=intlPers(k,y), act=0.14+P.act/260;
  if(!intlActive(k,ord)) act=0.08;
  if(intlRand()>act) return;
  var cs=intlCandidates(k,ord,y).filter(function(c){ return c.u>14; });
  if(!intlActive(k,ord)) cs=cs.filter(function(c){ return c.a==='reform'; });
  if(!cs.length) return;
  cs.sort(function(a,b){ return b.u-a.u; });
  cs=cs.slice(0,3);
  var tot=0; cs.forEach(function(c){ tot+=c.u*c.u; });
  var r=intlRand()*tot, pick=cs[0];
  for(var i=0;i<cs.length;i++){ r-=cs[i].u*cs[i].u; if(r<=0){ pick=cs[i]; break; } }
  intlDo(k,pick,ord,y);
 });
 if(window.__intlHook) try{ window.__intlHook(mk); }catch(e){}
}
function intlMonth(now){
 if(!s||!s.cal||s.dead) return;
 var I=intlEnsure(); if(!I) return;
 var key=intlMonthKey(now||calFromOrd(s.cal.ord));
 if(key<=I.last) return;                       /* 本月已决策：重复调用直接忽略 */
 var t0=intlNowMs();
 var from=Math.max(I.last+1,key-36);           /* 正常只差一个月；万一漏了（不应发生）最多补三年 */
 for(var mk=from;mk<=key;mk++) intlRunMonth(mk);
 var dt=intlNowMs()-t0; INTL_PERF.n++; INTL_PERF.total+=dt; if(dt>INTL_PERF.max) INTL_PERF.max=dt;
}
/* 玩家宣战/和谈等改了对华关系后，锁立即生效 */
function intlWarRisk(){
 if(!s||!s.intl) return [];
 var out=[], ord=s.cal.ord;
 for(var i=0;i<INTL_ALL.length;i++) for(var j=i+1;j<INTL_ALL.length;j++){
  var a=INTL_ALL[i], b=INTL_ALL[j], t=intlTen(a,b), L=intlLock(a,b,ord);
  if(t>=75&&!(L&&(L.k==='war'||L.k==='clash'))) out.push({a:a,b:b,tension:t,rel:intlRel(a,b)});
 }
 return out.sort(function(x,y){ return y.tension-x.tension; });
}
/* 商人：列国通商与禁运影响铺面进项 */
function intlTradeFactor(x){
 if(!x||!x.intl||!x.cal) return 0;
 var f=0, ord=x.cal.ord;
 (x.intl.tr||[]).forEach(function(t){ if(t.a==='cn'||t.b==='cn'){ if(t.k==='trade') f+=0.06; if(t.k==='sanction') f-=0.12; } });
 var sum=0; INTL_KEYS.forEach(function(k){ sum+=intlRel(k,'cn'); }); f+=(sum/INTL_KEYS.length-50)/250;
 INTL_KEYS.forEach(function(k){ var L=intlLock(k,'cn',ord); if(L&&L.k==='war') f-=0.08; });
 return Math.max(-0.35,Math.min(0.3,Math.round(f*100)/100));
}

/* ---------- 时局栏：列国局势 ---------- */
function intlStance(r){ return r>=72?'亲密':r>=58?'友好':r>=42?'平常':r>=28?'冷淡':'敌对'; }
function intlEsc(t){ return String(t==null?'':t).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
function intlLead(ord){
 var wars=[], seen={};
 INTL_HIST.forEach(function(h){ if(h.k==='war'&&intlHistOn(h,ord)){ var t=h.t.split(/[：，。]/)[0]; if(!seen[t]){ seen[t]=1; wars.push(t); } } });
 if(wars.length) return wars.slice(0,2).join('；')+'，仍在进行。';
 var top=null;
 for(var i=0;i<INTL_ALL.length;i++) for(var j=i+1;j<INTL_ALL.length;j++){ var a=INTL_ALL[i], b=INTL_ALL[j], t=intlTen(a,b); if(!top||t>top.t) top={a:a,b:b,t:t}; }
 if(top&&top.t>=55) return intlName(top.a,ord)+'与'+intlName(top.b,ord)+'关系紧张。';
 return '列国之间大体相安。';
}
function intlCardHTML(){
 var I=s.intl, ord=s.cal.ord, o=calFromOrd(ord), y=o.y;
 var h='<p class="intl-lead"><span class="intl-date">'+o.y+'年'+o.m+'月</span>'+intlEsc(intlLead(ord))+'</p>';
 h+='<div class="intl-head small muted"><span>国家 · 政体</span><span>国力</span><span>对华</span></div><div class="intl-rows">';
 INTL_KEYS.forEach(function(k){
  var pw=Math.round(intlPower(k,y)), r=Math.round(intlRel(k,'cn')), L=intlLock(k,'cn',ord), g=intlGoal(k,y), act=intlActive(k,ord);
  h+='<div class="intl-row'+(act?'':' off')+'"><div class="intl-n"><b>'+intlName(k,ord)+'</b><span>'+intlRegime(k,y)[0]+' · '+g[2]+'</span></div>'+
   '<div class="intl-p"><span class="bar"><i style="width:'+pw+'%"></i></span><em>'+pw+'</em></div>'+
   '<div class="intl-r'+(r<28||L&&(L.k==='war'||L.k==='clash')?' neg':(r>=58?' pos':''))+'">'+(L&&L.k!=='nap'?INTL_LOCK_TXT[L.k]:intlStance(r))+' <em>'+r+'</em></div></div>';
 });
 h+='</div>';
 /* 同盟与条约：史实在前，AI 在后 */
 var tl=[], seen={};
 INTL_HIST.forEach(function(H){
  if(!intlHistOn(H,ord)||H.k==='hostile') return;
  H.ab.forEach(function(p){ var key=intlPK(p[0],p[1])+H.k; if(seen[key]) return; seen[key]=1; tl.push({t:intlName(p[0],ord)+' — '+intlName(p[1],ord),k:INTL_LOCK_TXT[H.k],f:H.f[0],h:1,neg:H.k==='war'||H.k==='clash'}); });
 });
 (I.tr||[]).forEach(function(t){ if(t.k==='loan') return; tl.push({t:intlName(t.a,ord)+' — '+intlName(t.b,ord),k:({trade:'通商',ally:'同盟',nap:'互不侵犯',sanction:'禁运'})[t.k]||t.k,f:calFromOrd(t.f).y,h:0,neg:t.k==='sanction'}); });
 if(tl.length){
  h+='<div class="intl-sec"><b>同盟与条约</b><ul class="intl-list">'+tl.slice(0,8).map(function(x){ return '<li><span>'+x.t+'</span><span class="'+(x.neg?'neg':'')+'">'+x.k+'</span><span class="small muted">'+x.f+'年起'+(x.h?' · 史实':'')+'</span></li>'; }).join('')+'</ul>'+(tl.length>8?'<p class="small muted">另有 '+(tl.length-8)+' 项。</p>':'')+'</div>';
 }
 /* 紧张局势：给 V4.20 的接口在这里可见 */
 var ts=[];
 for(var i=0;i<INTL_ALL.length;i++) for(var j=i+1;j<INTL_ALL.length;j++){ var a=INTL_ALL[i], b=INTL_ALL[j], L2=intlLock(a,b,ord); if(L2&&(L2.k==='war'||L2.k==='clash')) continue; ts.push({a:a,b:b,t:intlTen(a,b)}); }
 ts.sort(function(p,q){ return q.t-p.t; }); ts=ts.filter(function(x){ return x.t>=30; }).slice(0,3);
 if(ts.length){
  h+='<div class="intl-sec"><b>紧张局势</b>'+ts.map(function(x){ var v=Math.round(x.t); return '<div class="intl-ten"><span>'+intlName(x.a,ord)+' — '+intlName(x.b,ord)+'</span><span class="bar"><i class="'+(v>=75?'hot':(v>=55?'warm':''))+'" style="width:'+v+'%"></i></span><em>'+v+'</em></div>'; }).join('')+'</div>';
 }
 var news=(I.news||[]).slice(0,6);
 h+='<div class="intl-sec"><b>近来动向</b>'+(news.length?'<ul class="intl-news">'+news.map(function(nw){ var d=calFromOrd(nw.o); return '<li><span class="intl-nd">'+(d.y!==y?d.y+'年':'')+d.m+'月'+d.d+'日</span><span>'+intlEsc(nw.t)+(nw.h?'<i class="intl-tag">史实</i>':'')+(nw.me?'<span class="intl-me">'+intlEsc(nw.me)+'</span>':'')+'</span></li>'; }).join('')+'</ul>':'<p class="small muted">尚无新的动向。</p>')+'</div>';
 h+='<p class="small muted intl-foot">各国每月初评估一次局势，按国力、利益、性格与彼此关系作决策；史实大事按日期发生。数值为游戏估算。</p>';
 return h;
}
var INTL_SIG='';
function intlRender(){
 if(!s||!s.intl) return;
 var card=document.getElementById('cardIntl');
 if(!card){
  var main=document.querySelector('#game .main > div'); if(!main) return;
  card=document.createElement('div'); card.className='card'; card.id='cardIntl';
  card.innerHTML='<h2>列国局势</h2><div id="intlBox"></div>';
  var after=document.getElementById('cardDynamicWorld');
  if(after&&after.parentNode===main) main.insertBefore(card,after.nextSibling); else main.appendChild(card);
 }
 var sig=s.cal.ord+'|'+s.intl.last+'|'+s.intl.news.length+'|'+(s.intl.news[0]?s.intl.news[0].o+s.intl.news[0].t:'')+'|'+INTL_KEYS.map(function(k){ return Math.round(intlRel(k,'cn')); }).join(',');
 if(sig===INTL_SIG&&document.getElementById('intlBox')&&document.getElementById('intlBox').innerHTML) return;
 INTL_SIG=sig;
 var box=document.getElementById('intlBox'); if(box) box.innerHTML=intlCardHTML();
}
TAB_TITLE['列国局势']='pol';

/* ---------- 弹窗排队：一次只显示一个，关掉一个再弹下一个 ----------
   年终结算（定国策、天下大势等）与列强照会不再直接写弹窗，而是登记到 s.cal.dlgQ（随存档保存），
   由 calFlush 依次弹出：年度报告 → 队列 → 到期的历史事件。 */
var DLGQ_OPEN={
 policy:function(){ if(!s||!s.isLeader||s.dead) return false; openPolicy(); return true; },
 verdict:function(){ return verdictDlg(); },
 intl:function(k){ return intlDemandDlg(k); }
};
function dlgQueue(){ if(!s||!s.cal) return []; if(!Array.isArray(s.cal.dlgQ)) s.cal.dlgQ=[]; return s.cal.dlgQ; }
function dlgShown(){ var m=document.getElementById('mask'); return !!(m&&m.classList&&!m.classList.contains('hidden')); }
function dlgRun(e){
 var f=DLGQ_OPEN[e.kind]; if(!f) return false;
 try{ return f(e.arg)!==false&&dlgShown(); }catch(err){ if(window.console) console.error(err); return false; }
}
function dlgOpen(kind,arg){
 if(!s) return false;
 var q=dlgQueue(), key=kind+':'+(arg==null?'':arg);
 for(var i=0;i<q.length;i++){ if(q[i].key===key) return false; }   /* 同一个弹窗不排两次 */
 var e={kind:kind,arg:arg==null?null:arg,key:key};
 if(!CLOCK.settling&&!calBlocked()&&!s.cal.pendingReport&&!q.length&&!(SP&&SP.cur)) return dlgRun(e);
 q.push(e); return true;
}
function dlgNext(){
 var q=dlgQueue();
 while(q.length){ var e=q.shift(); if(dlgRun(e)) return true; }
 return false;
}
var _calFlushV419=calFlush;
calFlush=function(){
 if(!s) return;
 if(s.cal.pendingReport){ calShowReport(); return; }
 if(!calBlocked()&&dlgQueue().length&&!s.dead){ if(dlgNext()) return; }
 return _calFlushV419.apply(this,arguments);
};
window.__CAL.flush=calFlush;

/* ---------- 挂到统一的日推进流程 ---------- */
var _calMonthTickV419=calMonthTick;
calMonthTick=function(now){
 try{ intlMonth(now); }catch(e){ if(window.console) console.error(e); }   /* 先决策再走月度生计与自动存档，存档里就有本月的决策 */
 return _calMonthTickV419.apply(this,arguments);
};
var _calDayTickV419=calDayTick;
calDayTick=function(now){
 try{ if(s&&s.cal) intlEnsure(); if(s&&s.intl&&s.cal.ord>=s.intl.hn) intlDay(now); }catch(e){ if(window.console) console.error(e); }
 return _calDayTickV419.apply(this,arguments);
};
var _econItemsV419=econItems;
econItems=function(x){
 var it=_econItemsV419.apply(this,arguments);
 try{
  if(x&&x.intl&&LIVE_LINE[x.role]==='biz'&&!x.isLeader&&!x.isThrone){
   var f=intlTradeFactor(x), base=PAY_TAB.biz[Math.max(0,Math.min(7,x.rank||0))]||0, v=_r2(base*f);
   if(Math.abs(v)>=0.01) it.pay.push([f>0?'外贸行情（列国通商）':'外贸行情（禁运、交恶）',v]);
  }
 }catch(e){}
 return it;
};
window.__econItems=econItems;
/* 1958：大跃进（5 月 5 日）与人民公社化（8 月 29 日）是两件事，按日期各触发一次；
   非“中共胜利”路线下，1958 年这两件事不会发生（没有对应的替代事件）。 */
var V419_PRC_ONLY=['greatleap58','leap58'];
function v419Skip(fn){
 var tmp=[];
 if(s&&s.evDone&&!intlPRC()) V419_PRC_ONLY.forEach(function(id){ if(!s.evDone[id]){ s.evDone[id]=true; tmp.push(id); } });
 try{ return fn(); }finally{ tmp.forEach(function(id){ delete s.evDone[id]; }); }
}
var _maybeEventV419=maybeEvent;
maybeEvent=function(){ var self=this, a=arguments; return v419Skip(function(){ return _maybeEventV419.apply(self,a); }); };
var _waitNextV419=waitNextEventOrd;
waitNextEventOrd=function(){ var self=this, a=arguments; return v419Skip(function(){ return _waitNextV419.apply(self,a); }); };
window.__CAL.nextEventOrd=waitNextEventOrd;

var _initV419=init;
init=function(){
 var r=_initV419.apply(this,arguments);
 if(s){ s.intl=null; if(s.cal) s.cal.dlgQ=[]; intlInit(true); INTL_SIG=''; try{ intlRender(); }catch(e){} }
 return r;
};
var _applySaveV419=applySave;
applySave=function(d){
 var r=_applySaveV419.apply(this,arguments);
 if(s){
  var had=!!(s.intl&&s.intl.n);
  if(!had) intlInit(false);       /* V4.18.6 及更早的存档：没有 AI 状态，按存档日期初始化 */
  intlEnsure(); dlgQueue();
  INTL_SIG='';
  try{ if(window.__RENDER) window.__RENDER(); }catch(e){}
 }
 return r;
};
var _packV419=packSave;
packSave=function(){ var o=_packV419.apply(null,arguments); o.v='4.19'; return o; };
var _renderV419=render;
render=function(){
 _renderV419.apply(null,arguments);
 if(!s) return;
 try{ intlEnsure(); intlRender(); }catch(e){ if(window.console) console.error(e); }
};
window.__INTL={
 state:function(){ return s&&s.intl; }, rel:intlRel, tension:intlTen, lock:function(a,b){ return intlLock(a,b); }, power:function(k){ return intlPower(k,s.year); },
 name:intlName, keys:INTL_KEYS, all:INTL_ALL, hist:INTL_HIST, warRisk:intlWarRisk, perf:INTL_PERF, month:intlMonth, init:intlInit,
 tradeFactor:intlTradeFactor, render:intlRender, html:function(){ return intlCardHTML(); }, climate:intlClimate
};
window.__DLGQ={queue:dlgQueue,open:dlgOpen,next:dlgNext};

window.__V4185NET=1;
})(); /* 主作用域结束 */
