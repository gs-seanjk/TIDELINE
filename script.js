(()=>{
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=n=>'$'+fmt(n);
const pct=n=>(n>=0?'+':'')+fmt(n)+'%';
const cls=n=>n>=0?'up':'dn';

/* ---------- market simulation ---------- */
const crypto=['BTC','ETH'];
const S=[['SPY',560],['NDQ',20100],['AAPL',230],['NVDA',125],['TSLA',250],['MSFT',430],['AMZN',185],['BTC',64000],['ETH',3100]].map(([s,p])=>({s,p,o:p,v:crypto.includes(s)?.0014:.0006,c:[],n:0}));
const by=s=>S.find(x=>x.s===s);
const rnd=()=>(Math.random()+Math.random()+Math.random()-1.5)*.9;
/* every candle carries an id so execution marks stay pinned to it as the chart scrolls */
S.forEach(x=>{let p=x.p*(1+rnd()*.03);for(let i=0;i<80;i++){const o=p;for(let k=0;k<6;k++)p*=1+rnd()*x.v*1.6;x.c.push({id:x.n++,o,c:p,h:Math.max(o,p)*(1+Math.random()*x.v*.6),l:Math.min(o,p)*(1-Math.random()*x.v*.6)});}
  x.o=x.c[0].o;x.p=p;});
let tick=0,cur='SPY';
function step(){tick++;S.forEach(x=>{x.p*=1+rnd()*x.v*1.6;let c=x.c[x.c.length-1];
  if(tick%6===0){c={id:x.n++,o:x.p,c:x.p,h:x.p,l:x.p};x.c.push(c);if(x.c.length>90)x.c.shift();}
  c.c=x.p;c.h=Math.max(c.h,x.p);c.l=Math.min(c.l,x.p);});}

/* ---------- account (persisted per viewer) ---------- */
const START=100000;
let acct={cash:START,pos:{},log:[]};
try{const r=localStorage.getItem('tideline-acct');if(r)acct=JSON.parse(r);}catch(e){}
const save=()=>{try{localStorage.setItem('tideline-acct',JSON.stringify(acct));}catch(e){}};
const equity=()=>acct.cash+Object.entries(acct.pos).reduce((a,[s,p])=>a+p.q*by(s).p,0);

/* execution marks live for this session only: the simulated candles regenerate on reload */
let marks=[];
function mark(s,side,q,px){const c=by(s).c;marks.push({s,id:c[c.length-1].id,side,q,px});if(marks.length>200)marks.shift();}

/* kind: buy | sell | sl | tp */
function fill(kind,s,q,px){
  const p=acct.pos[s]||{q:0,a:0};
  if(kind==='buy'){p.a=(p.a*p.q+px*q)/(p.q+q);p.q+=q;acct.cash-=q*px;}
  else{p.q-=q;acct.cash+=q*px;}
  if(p.q===0)delete acct.pos[s];else acct.pos[s]=p;
  const label={buy:'Bought',sell:'Sold',sl:'Stop loss hit, sold',tp:'Take profit hit, sold'}[kind];
  acct.log.unshift(label+' '+q+' '+s+' @ '+money(px));acct.log=acct.log.slice(0,30);
  mark(s,kind,q,px);
}

let tt;
function toast(t,k){const e=$('toast');e.textContent=t;e.className='toast show '+(k||'');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('show'),4500);}

const num=id=>{const v=$(id).value.trim();return v===''?null:+v;};
function readLevels(px){
  const sl=num('tSL'),tp=num('tTP');
  if((sl!==null&&!(sl>0))||(tp!==null&&!(tp>0)))return{err:'Stop loss and take profit must be positive prices.'};
  if(sl!==null&&sl>=px)return{err:'Stop loss must be below the market price ('+money(px)+').'};
  if(tp!==null&&tp<=px)return{err:'Take profit must be above the market price ('+money(px)+').'};
  return{sl,tp};
}

function trade(side){
  const s=$('tSym').value,q=Math.floor(+$('tQty').value),px=by(s).p,m=$('msg');
  if(!(q>0)){m.textContent='Enter a whole quantity above zero.';return;}
  const p=acct.pos[s]||{q:0,a:0};
  let lv=null;
  if(side==='buy'){
    lv=readLevels(px);if(lv.err){m.textContent=lv.err;return;}
    if(q*px>acct.cash){m.textContent='Not enough cash. You can afford '+Math.floor(acct.cash/px)+' at this price.';return;}
  }else if(q>p.q){m.textContent='You hold '+p.q+' '+s+'. Lower the quantity to sell.';return;}
  fill(side,s,q,px);
  if(lv){const np=acct.pos[s];if(lv.sl!==null)np.sl=lv.sl;if(lv.tp!==null)np.tp=lv.tp;}
  m.textContent='Order filled.'+(lv&&(lv.sl!==null||lv.tp!==null)?' Levels are live.':'');
  save();render();
}
function setLevels(){
  const s=$('tSym').value,p=acct.pos[s],m=$('msg');
  if(!p){m.textContent='You have no open '+s+' position. Buy first, or set levels with the buy order.';return;}
  const lv=readLevels(by(s).p);if(lv.err){m.textContent=lv.err;return;}
  if(lv.sl===null)delete p.sl;else p.sl=lv.sl;
  if(lv.tp===null)delete p.tp;else p.tp=lv.tp;
  acct.log.unshift('Levels on '+s+': SL '+(p.sl?money(p.sl):'none')+', TP '+(p.tp?money(p.tp):'none'));acct.log=acct.log.slice(0,30);
  m.textContent='Levels updated. An empty field removes that level.';save();render();
}
/* runs on every price tick: closes the whole position when a level is crossed */
function checkLevels(){
  let hit=false;
  Object.entries(acct.pos).forEach(([s,p])=>{
    const px=by(s).p,q=p.q;let k=null;
    if(p.sl&&px<=p.sl)k='sl';else if(p.tp&&px>=p.tp)k='tp';
    if(!k)return;
    fill(k,s,q,px);hit=true;
    const pl=(px-p.a)*q;
    toast((k==='sl'?'Stop loss hit: ':'Take profit hit: ')+'sold '+q+' '+s+' @ '+money(px)+' ('+(pl>=0?'+':'')+money(pl)+')',k);
    $('msg').textContent=(k==='sl'?'Stop loss':'Take profit')+' closed your '+s+' position.';
  });
  if(hit)save();
}
$('bBuy').onclick=()=>trade('buy');$('bSell').onclick=()=>trade('sell');$('bSet').onclick=setLevels;
$('rst').onclick=()=>{acct={cash:START,pos:{},log:[]};marks=[];$('tSL').value=$('tTP').value='';$('msg').textContent='Account reset to $100,000.';save();render();};

/* ---------- UI build ---------- */
S.forEach(x=>{$('tabs').insertAdjacentHTML('beforeend',`<button class="tab" data-s="${x.s}" aria-pressed="${x.s===cur}">${x.s}</button>`);
  $('tSym').insertAdjacentHTML('beforeend',`<option>${x.s}</option>`);});
function pick(s){if(s!==cur){$('tSL').value=$('tTP').value='';}cur=s;$('tSym').value=s;document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-pressed',b.dataset.s===s));render();}
$('tabs').onclick=e=>{const b=e.target.closest('.tab');if(b)pick(b.dataset.s);};
$('tSym').onchange=e=>pick(e.target.value);
$('watch').onpointerdown=e=>{const r=e.target.closest('tr');if(r)pick(r.dataset.s);};
/* positions: tap a row to load its levels, tap × to close it (pointerdown because rows redraw every tick) */
$('pos').onpointerdown=e=>{
  const x=e.target.closest('[data-x]');
  if(x){const s=x.dataset.x,p=acct.pos[s];if(p){const q=p.q;fill('sell',s,q,by(s).p);$('msg').textContent='Closed '+q+' '+s+'.';save();render();}return;}
  const r=e.target.closest('tr[data-s]');
  if(r){const s=r.dataset.s,p=acct.pos[s];pick(s);$('tSL').value=p&&p.sl?p.sl:'';$('tTP').value=p&&p.tp?p.tp:'';render();}
};
$('chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  if('clear' in b.dataset){$('tSL').value=$('tTP').value='';}
  else{const px=by($('tSym').value).p;$('tSL').value=(px*(1-b.dataset.sl/100)).toFixed(2);$('tTP').value=(px*(1+b.dataset.tp/100)).toFixed(2);}
  render();};
['tSL','tTP','tQty'].forEach(id=>$(id).addEventListener('input',()=>render()));

function riskReward(){
  const px=by($('tSym').value).p,q=Math.floor(+$('tQty').value)||0,sl=num('tSL'),tp=num('tTP');
  const risk=sl>0&&sl<px?(px-sl)*q:null,rew=tp>px?(tp-px)*q:null,t=[];
  if(risk!==null)t.push('Risk <b class="dn">'+money(risk)+'</b>');
  if(rew!==null)t.push('Reward <b class="up">'+money(rew)+'</b>');
  if(risk&&rew)t.push('Ratio <b>1:'+fmt(rew/risk,1)+'</b>');
  $('rr').innerHTML=t.join(' · ');
}

/* ---------- chart ---------- */
const cv=$('chart'),cx=cv.getContext('2d');
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}
function draw(){
  const d=devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;
  if(cv.width!==w*d||cv.height!==h*d){cv.width=w*d;cv.height=h*d;}
  cx.setTransform(d,0,0,d,0,0);cx.clearRect(0,0,w,h);
  const up=css('--up'),dn=css('--down'),mu=css('--mute'),ac=css('--accent'),ink=css('--ink'),on=css('--on'),ln=css('--line');
  const F='"Space Grotesk",system-ui,sans-serif',fx=v=>fmt(v,v>1000?0:2);
  const c=by(cur).c,n=c.length,pad=64,pw=w-pad;
  let hi=Math.max(...c.map(k=>k.h)),lo=Math.min(...c.map(k=>k.l));const r=(hi-lo)||1;hi+=r*.05;lo-=r*.05;
  const Y=v=>h-16-(v-lo)/(hi-lo)*(h-32),cw=pw/n;
  cx.textAlign='left';cx.font='11px '+F;cx.fillStyle=mu;cx.strokeStyle=ln;cx.lineWidth=1;
  for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,y=Y(v);cx.beginPath();cx.moveTo(0,y);cx.lineTo(pw,y);cx.stroke();cx.fillText(fx(v),pw+6,y+4);}
  /* candles */
  c.forEach((k,i)=>{const x=i*cw+cw/2,col=k.c>=k.o?up:dn;cx.strokeStyle=cx.fillStyle=col;cx.shadowColor=col;cx.shadowBlur=5;
    cx.beginPath();cx.moveTo(x,Y(k.h));cx.lineTo(x,Y(k.l));cx.stroke();
    const t=Y(Math.max(k.o,k.c)),b=Y(Math.min(k.o,k.c));cx.fillRect(x-cw*.32,t,cw*.64,Math.max(1,b-t));});
  cx.shadowBlur=0;
  /* 10-period average */
  cx.strokeStyle=ac;cx.lineWidth=1.6;cx.shadowColor=ac;cx.shadowBlur=8;cx.beginPath();
  c.forEach((k,i)=>{let a=0,m=0;for(let j=Math.max(0,i-9);j<=i;j++){a+=c[j].c;m++;}const x=i*cw+cw/2,y=Y(a/m);i?cx.lineTo(x,y):cx.moveTo(x,y);});cx.stroke();cx.shadowBlur=0;
  /* entry, stop loss and take profit lines for an open position */
  const P=acct.pos[cur];
  const lvl=(v,name,col,dash,alpha)=>{const y=Math.max(9,Math.min(h-9,Y(v)));
    cx.globalAlpha=alpha;cx.setLineDash(dash);cx.strokeStyle=col;cx.lineWidth=1;cx.beginPath();cx.moveTo(0,y);cx.lineTo(pw,y);cx.stroke();cx.setLineDash([]);cx.globalAlpha=1;
    cx.fillStyle=col;cx.font='600 11px '+F;cx.fillText(name,8,y-5);
    cx.fillRect(pw,y-9,pad,18);cx.fillStyle=on;cx.font='11px '+F;cx.fillText(fx(v),pw+5,y+4);};
  if(P){lvl(P.a,'Entry',ink,[2,4],.55);if(P.sl)lvl(P.sl,'Stop loss',dn,[7,4],.95);if(P.tp)lvl(P.tp,'Take profit',up,[7,4],.95);}
  /* execution marks: arrow beside the candle, dot on the exact fill price */
  marks.forEach(m=>{
    if(m.s!==cur)return;const i=m.id-c[0].id;if(i<0||i>=n)return;
    const k=c[i],x=i*cw+cw/2,buy=m.side==='buy',col=(m.side==='buy'||m.side==='tp')?up:dn;
    const ay=Math.max(10,Math.min(h-10,buy?Y(k.l)+14:Y(k.h)-14));
    cx.fillStyle=col;cx.shadowColor=col;cx.shadowBlur=10;cx.beginPath();
    if(buy){cx.moveTo(x,ay-6);cx.lineTo(x-6,ay+5);cx.lineTo(x+6,ay+5);}
    else{cx.moveTo(x,ay+6);cx.lineTo(x-6,ay-5);cx.lineTo(x+6,ay-5);}
    cx.closePath();cx.fill();cx.shadowBlur=0;
    cx.beginPath();cx.arc(x,Y(m.px),3,0,7);cx.fillStyle=ink;cx.fill();cx.strokeStyle=col;cx.lineWidth=1.5;cx.stroke();
    cx.font='600 10px '+F;cx.textAlign='center';cx.fillStyle=col;
    const t=({buy:'Buy',sell:'Sell',sl:'SL',tp:'TP'})[m.side]+' '+m.q;
    cx.fillText(t,Math.max(24,Math.min(pw-24,x)),Math.max(10,Math.min(h-3,buy?ay+19:ay-10)));
    cx.textAlign='left';
  });
  /* last price tag */
  const lp=by(cur).p,y=Y(lp);cx.setLineDash([4,4]);cx.strokeStyle=ac;cx.lineWidth=1;cx.beginPath();cx.moveTo(0,y);cx.lineTo(pw,y);cx.stroke();cx.setLineDash([]);
  cx.fillStyle=ac;cx.fillRect(pw,y-9,pad,18);cx.fillStyle=on;cx.font='600 11px '+F;cx.fillText(fx(lp),pw+5,y+4);
}

/* ---------- render ---------- */
function render(){
  const eq=equity();
  const pnl=eq-START;
  $('eq').innerHTML=money(eq).replace(/\.(\d+)$/,'<small>.$1</small>');
  $('dayPnl').innerHTML=`<span class="${cls(pnl)}">${(pnl>=0?'+':'')+money(pnl)} (${pct(pnl/START*100)})</span>`;
  $('cash').textContent=money(acct.cash);$('npos').textContent=Object.keys(acct.pos).length;
  const mv=[...S].sort((a,b)=>Math.abs(b.p/b.o-1)-Math.abs(a.p/a.o-1))[0];
  $('best').innerHTML=`${mv.s} <span class="${cls(mv.p-mv.o)}">${pct((mv.p/mv.o-1)*100)}</span>`;
  const chg=x=>(x.p/x.o-1)*100;
  $('tape').innerHTML=(t=>t+t)(S.map(x=>`<span>${x.s} <b>${fmt(x.p)}</b> <span class="${cls(chg(x))}">${pct(chg(x))}</span></span>`).join(''));
  $('watch').innerHTML=S.map(x=>`<tr data-s="${x.s}" class="${x.s===cur?'sel':''}"><td>${x.s}</td><td>${fmt(x.p)}</td><td class="${cls(chg(x))}">${pct(chg(x))}</td></tr>`).join('');
  $('tPx').textContent=money(by($('tSym').value).p);
  riskReward();
  const ps=Object.entries(acct.pos);
  $('pos').innerHTML=ps.length?ps.map(([s,p])=>{const u=(by(s).p-p.a)*p.q;
    const lv=(p.sl||p.tp)?`<div class="lv"><span class="dn">SL ${p.sl?fmt(p.sl):'none'}</span><span class="up">TP ${p.tp?fmt(p.tp):'none'}</span></div>`:'';
    return `<tr data-s="${s}"><td>${s}${lv}</td><td>${p.q}</td><td class="${cls(u)}">${(u>=0?'+':'')+money(u)}</td><td><button class="x" data-x="${s}" aria-label="Close ${s} position">×</button></td></tr>`;}).join(''):'<tr><td colspan="4" style="color:var(--mute)">No positions yet. Place an order to open one.</td></tr>';
  $('log').innerHTML=acct.log.map(l=>`<li>${l}</li>`).join('');
  const x=by(cur),sp=x.p*.0004;let a='',b='';$('bookSym').textContent=cur;
  if(!window.__lv||tick%3===0){window.__lv=[...Array(7)].map(()=>Math.round(40+Math.random()*260));window.__lq=[...Array(7)].map(()=>Math.round(40+Math.random()*260));}
  const lv=window.__lv,mx=300;
  for(let i=6;i>=0;i--)a+=`<div><span class="dn">${fmt(x.p+sp*(i+1))}</span><span>${lv[i]}</span><i style="width:${lv[i]/mx*100}%;background:var(--down)"></i></div>`;
  for(let i=0;i<7;i++){const q=window.__lq[i];b+=`<div><span class="up">${fmt(x.p-sp*(i+1))}</span><span>${q}</span><i style="width:${q/mx*100}%;background:var(--up)"></i></div>`;}
  $('depth').innerHTML=a+`<div style="border-block:1px solid var(--line);margin:4px 0"><span><b>${fmt(x.p)}</b></span><span>spread ${fmt(sp*2)}</span></div>`+b;
  $('heatGrid').innerHTML=S.map(x=>{const c=chg(x),k=Math.min(1,Math.abs(c)/1.5),col=c>=0?'var(--up)':'var(--down)';
    return `<div class="tile" style="background:color-mix(in srgb,${col} ${10+k*34}%,var(--bg2));border-color:color-mix(in srgb,${col} ${35+k*65}%,transparent)"><b>${x.s}</b><span>${fmt(x.p)}<br>${pct(c)}</span></div>`;}).join('');
  draw();
}

/* ---------- parallax ---------- */
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
let mx=0,my=0,tx=0,ty=0,sy=0;
addEventListener('mousemove',e=>{tx=e.clientX/innerWidth-.5;ty=e.clientY/innerHeight-.5;});
addEventListener('deviceorientation',e=>{if(e.gamma!=null){tx=Math.max(-.5,Math.min(.5,e.gamma/60));ty=Math.max(-.5,Math.min(.5,(e.beta-45)/90));}});
addEventListener('scroll',()=>sy=scrollY,{passive:true});
const layers=[...document.querySelectorAll('.layer')],movers=[...document.querySelectorAll('[data-speed]')],tilts=[...document.querySelectorAll('[data-tilt]')];
tilts.forEach(t=>{
  t.addEventListener('pointermove',e=>{if(reduce)return;const r=t.getBoundingClientRect(),x=(e.clientX-r.left)/r.width-.5,y=(e.clientY-r.top)/r.height-.5;
    t.style.transform=`perspective(900px) rotateY(${x*5}deg) rotateX(${-y*5}deg)`;});
  t.addEventListener('pointerleave',()=>{t.style.transform='';});
});
function frame(){
  mx+=(tx-mx)*.06;my+=(ty-my)*.06;
  if(!reduce){
    layers.forEach(l=>{const d=+l.dataset.d;l.style.transform=`translate3d(${-mx*d*2}px,${-my*d*2-sy*d/60}px,0)`;});
    $('heroIn').style.opacity=Math.max(0,1-sy/650);
    movers.forEach(m=>{const s=+m.dataset.speed,hero=m.id==='heroIn';
      m.style.transform=hero?`translate3d(${mx*-24}px,${sy*.3+my*-14}px,0) rotateY(${mx*7}deg) rotateX(${-my*5}deg)`:`translate3d(0,${(sy-m.parentElement.offsetTop)*-s*.6}px,0)`;});
  }
  requestAnimationFrame(frame);
}
frame();
addEventListener('resize',draw);

render();
setInterval(()=>{step();checkLevels();render();},900);
})();
