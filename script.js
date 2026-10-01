(()=>{
const $=id=>document.getElementById(id);
const fmt=(n,d=2)=>n.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});
const money=n=>'$'+fmt(n);
const sm=n=>(n<0?'-':'+')+'$'+fmt(Math.abs(n));
const pct=n=>(n>=0?'+':'')+fmt(n)+'%';
const cls=n=>n>=0?'up':'dn';
const gauss=()=>{let u=0;while(!u)u=Math.random();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*Math.random());};

/* ---------- market simulation ----------
   One random walk per symbol drives seven candle series (1m ... 1M) at once, so every
   timeframe shows the same live price. Time is simulated, in minutes, and can be sped up. */
const TF=[{k:'1m',L:1},{k:'5m',L:5},{k:'10m',L:10},{k:'1h',L:60},{k:'1d',L:1440},{k:'1w',L:10080},{k:'1M',L:43200}];
const LEN=Object.fromEntries(TF.map(f=>[f.k,f.L]));
const crypto=['BTC','ETH'];
const S=[['SPY',560],['NDQ',20100],['AAPL',230],['NVDA',125],['TSLA',250],['MSFT',430],['AMZN',185],['BTC',64000],['ETH',3100]].map(([s,p])=>({s,p,o:p,v:crypto.includes(s)?.0012:.0006,tf:{}}));
const by=s=>S.find(x=>x.s===s);
let simT=Math.floor(Date.now()/60000);   /* simulated clock, minutes */
let tick=0,cur='SPY',side='long',tfk='5m',speed=30;

/* history is generated backwards from the current price so every series ends exactly on it */
function hist(x,L){
  const n=L>=43200?120:L>=10080?260:400,idx=Math.floor(simT/L),sd=x.v*Math.pow(L,.42),a=[];let c=x.p;
  for(let i=0;i<n;i++){
    const o=c/Math.max(.6,Math.min(1.6,1+sd*gauss()));
    a.unshift({t:(idx-i)*L,o,c,h:Math.max(o,c)*(1+Math.abs(gauss())*sd*.45),l:Math.min(o,c)*(1-Math.abs(gauss())*sd*.45)});
    c=o;
  }
  return a;
}
S.forEach(x=>{x.p*=1+gauss()*.01;TF.forEach(f=>{x.tf[f.k]=hist(x,f.L);});const d=x.tf['1d'];x.o=d[d.length-1].o;});

/* view: n candles visible, off candles scrolled back from the latest (negative leaves blank space on the right) */
const view={n:80,off:0};

function micro(m){
  simT+=m;
  S.forEach(x=>{
    x.p*=Math.max(.9,1+x.v*Math.sqrt(m)*gauss());
    TF.forEach(f=>{
      const a=x.tf[f.k];let c=a[a.length-1];
      if(Math.floor(simT/f.L)*f.L>c.t){
        c={t:Math.floor(simT/f.L)*f.L,o:c.c,c:x.p,h:Math.max(c.c,x.p),l:Math.min(c.c,x.p)};a.push(c);if(a.length>700)a.shift();
        if(x.s===cur&&f.k===tfk&&view.off>0)view.off++;   /* keep the scrolled-back window still */
      }
      c.c=x.p;c.h=Math.max(c.h,x.p);c.l=Math.min(c.l,x.p);
    });
  });
}
function advance(){tick++;const dt=speed*.9/60,k=Math.max(1,Math.ceil(dt/.1));for(let i=0;i<k;i++)micro(dt/k);}

/* ---------- account (persisted per viewer) ----------
   pos[symbol] = {q, a, sl?, tp?, t?}   q is signed: above 0 is long, below 0 is short */
const START=100000;
let acct={cash:START,pos:{},log:[]};
try{const r=localStorage.getItem('tideline-acct');if(r)acct=JSON.parse(r);}catch(e){}
/* the simulated history regenerates on reload, so a saved entry time no longer points at a real candle */
Object.values(acct.pos).forEach(p=>{delete p.t;delete p.id;});
const save=()=>{try{localStorage.setItem('tideline-acct',JSON.stringify(acct));}catch(e){}};
const equity=()=>acct.cash+Object.entries(acct.pos).reduce((a,[s,p])=>a+p.q*by(s).p,0);
const gross=()=>Object.entries(acct.pos).reduce((a,[s,p])=>a+Math.abs(p.q)*by(s).p,0);

/* execution marks are stored by simulated time, so they appear on every timeframe */
let marks=[];
function mark(s,kind,q,px,dir){marks.push({s,t:simT,kind,q,px,dir});if(marks.length>200)marks.shift();}

/* kind: long | short (open or add) · close | sl | tp (exit the whole position). dq is the signed change in quantity */
function fill(kind,s,dq,px){
  const p=acct.pos[s]||{q:0,a:0},q0=p.q,exit=!(kind==='long'||kind==='short'),dir=q0>0?'long':'short';
  let pl=0;
  if(exit)pl=(px-p.a)*q0;
  else{p.a=(p.a*Math.abs(q0)+px*Math.abs(dq))/(Math.abs(q0)+Math.abs(dq));if(q0===0)p.t=simT;}
  acct.cash-=dq*px;p.q=q0+dq;
  if(p.q===0)delete acct.pos[s];else acct.pos[s]=p;
  const q=Math.abs(dq);
  const label={long:'Opened long',short:'Opened short',close:'Closed '+dir,sl:'Stop loss hit, closed '+dir,tp:'Take profit hit, closed '+dir}[kind];
  acct.log.unshift(label+' '+q+' '+s+' @ '+money(px)+(exit?' ('+sm(pl)+')':''));acct.log=acct.log.slice(0,30);
  mark(s,kind,q,px,dir);
  return pl;
}

let tt;
function toast(t,k){const e=$('toast');e.textContent=t;e.className='toast show '+(k||'');clearTimeout(tt);tt=setTimeout(()=>e.classList.remove('show'),4500);}

const num=id=>{const v=$(id).value.trim();return v===''?null:+v;};
/* long: stop below, target above. short: stop above, target below. */
function readLevels(px,sd){
  const sl=num('tSL'),tp=num('tTP'),L=sd==='long';
  if((sl!==null&&!(sl>0))||(tp!==null&&!(tp>0)))return{err:'Stop loss and take profit must be positive prices.'};
  if(sl!==null&&(L?sl>=px:sl<=px))return{err:'For a '+sd+', stop loss must be '+(L?'below':'above')+' the market price ('+money(px)+').'};
  if(tp!==null&&(L?tp<=px:tp>=px))return{err:'For a '+sd+', take profit must be '+(L?'above':'below')+' the market price ('+money(px)+').'};
  return{sl,tp};
}

function openPos(){
  const s=$('tSym').value,q=Math.floor(+$('tQty').value),px=by(s).p,m=$('msg'),p=acct.pos[s],dir=side==='long'?1:-1;
  if(!(q>0)){m.textContent='Enter a whole quantity above zero.';return;}
  if(p&&Math.sign(p.q)!==dir){m.textContent='You hold a '+(p.q>0?'long':'short')+' in '+s+'. Close it first, then open a '+side+'.';return;}
  const lv=readLevels(px,side);if(lv.err){m.textContent=lv.err;return;}
  const room=equity()-gross();
  if(q*px>room){m.textContent='Not enough buying power. You can open '+Math.max(0,Math.floor(room/px))+' '+s+' at this price.';return;}
  fill(side,s,dir*q,px);
  const np=acct.pos[s];if(lv.sl!==null)np.sl=lv.sl;if(lv.tp!==null)np.tp=lv.tp;
  m.textContent=(side==='long'?'Long':'Short')+' order filled.'+(lv.sl!==null||lv.tp!==null?' Levels are live.':'');
  save();render();
}
function setLevels(){
  const s=$('tSym').value,p=acct.pos[s],m=$('msg');
  if(!p){m.textContent='You have no open '+s+' position. Open one first, or set levels with the order.';return;}
  const sd=p.q>0?'long':'short',lv=readLevels(by(s).p,sd);if(lv.err){m.textContent=lv.err;return;}
  if(lv.sl===null)delete p.sl;else p.sl=lv.sl;
  if(lv.tp===null)delete p.tp;else p.tp=lv.tp;
  acct.log.unshift('Levels on '+s+': SL '+(p.sl?money(p.sl):'none')+', TP '+(p.tp?money(p.tp):'none'));acct.log=acct.log.slice(0,30);
  m.textContent='Levels updated. An empty field removes that level.';save();render();
}
function closePos(s){
  const p=acct.pos[s];if(!p)return;
  const q=Math.abs(p.q),d=p.q>0?'long':'short',pl=fill('close',s,-p.q,by(s).p);
  $('msg').textContent='Closed '+d+' '+q+' '+s+' ('+sm(pl)+').';save();render();
}
/* runs on every price tick: exits the whole position when a level is crossed */
function checkLevels(){
  let hit=false;
  Object.entries(acct.pos).forEach(([s,p])=>{
    const px=by(s).p,L=p.q>0;let k=null;
    if(p.sl&&(L?px<=p.sl:px>=p.sl))k='sl';else if(p.tp&&(L?px>=p.tp:px<=p.tp))k='tp';
    if(!k)return;
    const q=Math.abs(p.q),d=L?'long':'short',pl=fill(k,s,-p.q,px);hit=true;
    toast((k==='sl'?'Stop loss hit: ':'Take profit hit: ')+'closed '+d+' '+q+' '+s+' @ '+money(px)+' ('+sm(pl)+')',k);
    $('msg').textContent=(k==='sl'?'Stop loss':'Take profit')+' closed your '+s+' '+d+'.';
  });
  if(hit)save();
}

function setSide(sd){
  side=sd;
  $('sLong').setAttribute('aria-pressed',sd==='long');$('sShort').setAttribute('aria-pressed',sd==='short');
  $('bGo').textContent=sd==='long'?'Open long':'Open short';$('bGo').className='go '+sd;
}
$('sLong').onclick=()=>{if(side!=='long'){$('tSL').value=$('tTP').value='';setSide('long');render();}};
$('sShort').onclick=()=>{if(side!=='short'){$('tSL').value=$('tTP').value='';setSide('short');render();}};
$('bGo').onclick=openPos;$('bSet').onclick=setLevels;$('bClose').onclick=()=>{const s=$('tSym').value;if(acct.pos[s])closePos(s);else $('msg').textContent='You have no open '+s+' position.';};
$('rst').onclick=()=>{acct={cash:START,pos:{},log:[]};marks=[];$('tSL').value=$('tTP').value='';$('msg').textContent='Account reset to $100,000.';save();render();};

/* ---------- UI build ---------- */
S.forEach(x=>{$('tabs').insertAdjacentHTML('beforeend',`<button class="tab" data-s="${x.s}" aria-pressed="${x.s===cur}">${x.s}</button>`);
  $('tSym').insertAdjacentHTML('beforeend',`<option>${x.s}</option>`);});
TF.forEach(f=>$('tfs').insertAdjacentHTML('beforeend',`<button type="button" class="tfb" data-k="${f.k}" aria-pressed="${f.k===tfk}">${f.k}</button>`));
function pick(s){
  if(s!==cur){$('tSL').value=$('tTP').value='';}
  cur=s;$('tSym').value=s;
  const p=acct.pos[s];if(p)setSide(p.q>0?'long':'short');
  document.querySelectorAll('.tab').forEach(b=>b.setAttribute('aria-pressed',b.dataset.s===s));render();
}
$('tabs').onclick=e=>{const b=e.target.closest('.tab');if(b)pick(b.dataset.s);};
$('tSym').onchange=e=>pick(e.target.value);
$('watch').onpointerdown=e=>{const r=e.target.closest('tr');if(r)pick(r.dataset.s);};
/* positions: tap a row to load its levels, tap × to close it (pointerdown because rows redraw every tick) */
$('pos').onpointerdown=e=>{
  const x=e.target.closest('[data-x]');
  if(x){closePos(x.dataset.x);return;}
  const r=e.target.closest('tr[data-s]');
  if(r){const s=r.dataset.s,p=acct.pos[s];pick(s);$('tSL').value=p&&p.sl?p.sl:'';$('tTP').value=p&&p.tp?p.tp:'';render();}
};
$('chips').onclick=e=>{const b=e.target.closest('button');if(!b)return;
  if('clear' in b.dataset){$('tSL').value=$('tTP').value='';}
  else{const px=by($('tSym').value).p,d=side==='long'?1:-1,s=b.dataset.sl/100,t=b.dataset.tp/100;
    $('tSL').value=(px*(1-d*s)).toFixed(2);$('tTP').value=(px*(1+d*t)).toFixed(2);}
  render();};
['tSL','tTP','tQty'].forEach(id=>$(id).addEventListener('input',()=>render()));

function riskReward(){
  const px=by($('tSym').value).p,q=Math.floor(+$('tQty').value)||0,sl=num('tSL'),tp=num('tTP'),d=side==='long'?1:-1,t=[];
  const risk=sl!==null&&(px-sl)*d>0?(px-sl)*d*q:null,rew=tp!==null&&(tp-px)*d>0?(tp-px)*d*q:null;
  if(risk!==null)t.push('Risk <b class="dn">'+money(risk)+'</b>');
  if(rew!==null)t.push('Reward <b class="up">'+money(rew)+'</b>');
  if(risk&&rew)t.push('Ratio <b>1:'+fmt(rew/risk,1)+'</b>');
  $('rr').innerHTML=t.length?t.join(' · '):(side==='long'?'Long: stop loss below the price, take profit above. Presets are stop % / target %.':'Short: stop loss above the price, take profit below. Presets are stop % / target %.');
}

/* ---------- chart: view controls ---------- */
const cv=$('chart'),cx=cv.getContext('2d');
const PAD=66,TOP=26,BOT=26;
const plotW=()=>cv.clientWidth-PAD;
const series=()=>by(cur).tf[tfk];
let raf=0,hov=null;
const redraw=()=>{if(!raf)raf=requestAnimationFrame(()=>{raf=0;draw();});};
function clampView(){
  const len=series().length;
  view.n=Math.max(10,Math.min(len,view.n));
  view.off=Math.max(-Math.floor(view.n*.4),Math.min(len-view.n,view.off));
}
/* zoom by factor f (below 1 zooms in), keeping the candle under pixel x where it is */
function zoomAt(f,x){
  const len=series().length,pw=plotW(),n0=view.n,end0=len-1-view.off,idxAt=end0-n0+1+x/(pw/n0);
  view.n=Math.max(10,Math.min(len,n0*f));
  const end1=idxAt-x/(pw/view.n)+view.n-1;
  view.off=len-1-end1;clampView();
}
function resetView(){view.n=Math.min(80,series().length);view.off=0;}
$('tfs').onclick=e=>{const b=e.target.closest('.tfb');if(!b)return;tfk=b.dataset.k;
  document.querySelectorAll('.tfb').forEach(x=>x.setAttribute('aria-pressed',x===b));resetView();render();};
$('zIn').onclick=()=>{zoomAt(.8,plotW()/2);redraw();};
$('zOut').onclick=()=>{zoomAt(1.25,plotW()/2);redraw();};
$('zFit').onclick=()=>{resetView();redraw();};
$('speed').onchange=e=>{speed=+e.target.value;};

/* chart size: Wide spans the full row, Taller / Shorter and the bottom grip set the height */
$('bWide').onclick=e=>{const on=$('deskCols').classList.toggle('wide');e.currentTarget.setAttribute('aria-pressed',on);requestAnimationFrame(draw);};
const setH=v=>{cv.style.height=Math.max(240,Math.min(1000,v))+'px';draw();};
$('hUp').onclick=()=>setH(cv.clientHeight+90);
$('hDn').onclick=()=>setH(cv.clientHeight-90);
let gd=null;
$('grip').onpointerdown=e=>{e.currentTarget.setPointerCapture(e.pointerId);gd={y:e.clientY,h:cv.clientHeight};};
$('grip').onpointermove=e=>{if(gd)setH(gd.h+e.clientY-gd.y);};
$('grip').onpointerup=$('grip').onpointercancel=()=>{gd=null;};
$('grip').onkeydown=e=>{if(e.key==='ArrowUp'){setH(cv.clientHeight-40);e.preventDefault();}if(e.key==='ArrowDown'){setH(cv.clientHeight+40);e.preventDefault();}};

/* wheel zooms, sideways wheel pans, drag pans, two fingers pinch, double-click resets */
cv.addEventListener('wheel',e=>{
  e.preventDefault();
  if(Math.abs(e.deltaX)>Math.abs(e.deltaY)){view.off-=e.deltaX/(plotW()/view.n);clampView();}
  else zoomAt(e.deltaY<0?.87:1/.87,e.offsetX);
  redraw();
},{passive:false});
const ptrs=new Map();let drag=null,pdist=0;
const pd=()=>{const [a,b]=[...ptrs.values()];return Math.hypot(a.x-b.x,a.y-b.y)||1;};
cv.addEventListener('pointerdown',e=>{
  cv.setPointerCapture(e.pointerId);ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY});
  if(ptrs.size===1)drag={x:e.offsetX,off:view.off};else if(ptrs.size===2){drag=null;pdist=pd();}
});
cv.addEventListener('pointermove',e=>{
  if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.offsetX,y:e.offsetY});
  if(ptrs.size===2){const d=pd(),[a,b]=[...ptrs.values()];zoomAt(pdist/d,(a.x+b.x)/2);pdist=d;hov=null;}
  else if(drag){view.off=drag.off+(e.offsetX-drag.x)/(plotW()/view.n);clampView();}
  if(e.pointerType==='mouse')hov={x:e.offsetX,y:e.offsetY};
  redraw();
});
const endPtr=e=>{
  ptrs.delete(e.pointerId);
  if(ptrs.size===1){const [p]=[...ptrs.values()];drag={x:p.x,off:view.off};}else drag=null;
};
cv.addEventListener('pointerup',endPtr);cv.addEventListener('pointercancel',endPtr);
cv.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'){hov=null;redraw();}});
cv.addEventListener('dblclick',()=>{resetView();redraw();});
cv.addEventListener('keydown',e=>{
  const k=e.key;let used=true;
  if(k==='+'||k==='=')zoomAt(.8,plotW()/2);
  else if(k==='-'||k==='_')zoomAt(1.25,plotW()/2);
  else if(k==='ArrowLeft'){view.off+=view.n*.1;clampView();}
  else if(k==='ArrowRight'){view.off-=view.n*.1;clampView();}
  else if(k==='Home'||k==='End')resetView();
  else used=false;
  if(used){e.preventDefault();redraw();}
});

/* ---------- chart: drawing ---------- */
const MON=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const p2=n=>String(n).padStart(2,'0');
function lab(t,L){const d=new Date(t*60000);
  if(L<1440)return d.getUTCHours()===0&&d.getUTCMinutes()===0?MON[d.getUTCMonth()]+' '+d.getUTCDate():p2(d.getUTCHours())+':'+p2(d.getUTCMinutes());
  if(L<43200)return MON[d.getUTCMonth()]+' '+d.getUTCDate();
  return MON[d.getUTCMonth()]+" '"+p2(d.getUTCFullYear()%100);}
function full(t,L){const d=new Date(t*60000),s=MON[d.getUTCMonth()]+' '+d.getUTCDate()+', '+d.getUTCFullYear();return L<1440?s+' '+p2(d.getUTCHours())+':'+p2(d.getUTCMinutes()):s;}
function css(v){return getComputedStyle(document.documentElement).getPropertyValue(v).trim();}

function draw(){
  const d=devicePixelRatio||1,w=cv.clientWidth,h=cv.clientHeight;
  if(cv.width!==Math.round(w*d)||cv.height!==Math.round(h*d)){cv.width=Math.round(w*d);cv.height=Math.round(h*d);}
  cx.setTransform(d,0,0,d,0,0);cx.clearRect(0,0,w,h);
  const up=css('--up'),dn=css('--down'),mu=css('--mute'),ac=css('--accent'),a2=css('--accent2'),ink=css('--ink'),on=css('--on'),ln=css('--line');
  const F='"Space Grotesk",system-ui,sans-serif',fx=v=>fmt(v,v>1000?0:2);
  const X=by(cur),a=X.tf[tfk],len=a.length,L=LEN[tfk],px=X.p,pw=w-PAD;
  clampView();
  const n=view.n,endIdx=len-1-view.off,start=endIdx-n+1,cw=pw/n,xOf=i=>(i-start+.5)*cw;
  const iS=Math.max(0,Math.floor(start)),iE=Math.min(len-1,Math.ceil(endIdx));
  let hi=-Infinity,lo=Infinity;
  for(let i=iS;i<=iE;i++){if(a[i].h>hi)hi=a[i].h;if(a[i].l<lo)lo=a[i].l;}

  /* position overlay: the open position, or a ghost preview built from the ticket fields */
  const P=acct.pos[cur],qty=Math.floor(+$('tQty').value)||0;let ov=null;
  if(P)ov={a:P.a,q:P.q,sl:P.sl||null,tp:P.tp||null,ghost:false};
  else{const sl=num('tSL'),tp=num('tTP');if((sl>0||tp>0)&&qty>0)ov={a:px,q:(side==='long'?1:-1)*qty,sl:sl>0?sl:null,tp:tp>0?tp:null,ghost:true};}
  /* widen the scale to fit nearby levels; far-away ones are pinned to the edge */
  if(ov){const span=hi-lo||1;[ov.a,ov.sl,ov.tp].forEach(v=>{if(v==null)return;if(v>hi&&v-hi<=span*1.5)hi=v;if(v<lo&&lo-v<=span*1.5)lo=v;});}
  const r=(hi-lo)||1;hi+=r*.06;lo-=r*.06;
  const Y=v=>h-BOT-(v-lo)/(hi-lo)*(h-BOT-TOP),cl=v=>Math.max(4,Math.min(h-BOT+6,Y(v)));
  const chip=(t,x,y,col)=>{cx.font='600 11px '+F;cx.textAlign='left';const tw=cx.measureText(t).width;x=Math.max(4,Math.min(x,pw-tw-8));cx.fillStyle='rgba(5,3,9,.8)';cx.fillRect(x-4,y-11,tw+8,16);cx.fillStyle=col;cx.fillText(t,x,y+1);};
  const tag=(v,col,y)=>{cx.fillStyle=col;cx.fillRect(pw,y-9,PAD,18);cx.fillStyle=on;cx.font='11px '+F;cx.textAlign='left';cx.fillText(fx(v),pw+5,y+4);};

  /* grid and time axis */
  cx.textAlign='left';cx.font='11px '+F;cx.fillStyle=mu;cx.strokeStyle=ln;cx.lineWidth=1;
  for(let i=0;i<=4;i++){const v=lo+(hi-lo)*i/4,y=Y(v);cx.beginPath();cx.moveTo(0,y);cx.lineTo(pw,y);cx.stroke();cx.fillText(fx(v),pw+6,y+4);}
  const step=Math.max(1,Math.ceil(84/cw));cx.textAlign='center';
  for(let i=iS;i<=iE;i++){if(Math.round(a[i].t/L)%step!==0)continue;const x=xOf(i);if(x<24||x>pw-24)continue;
    cx.globalAlpha=.5;cx.beginPath();cx.moveTo(x,TOP);cx.lineTo(x,h-BOT);cx.stroke();cx.globalAlpha=1;cx.fillStyle=mu;cx.fillText(lab(a[i].t,L),x,h-9);}
  cx.textAlign='left';

  /* zones go behind the candles */
  let x0=0,ya=0;
  if(ov){
    if(ov.ghost)x0=pw*.62;
    else{const i=P.t!=null?Math.floor((P.t-a[0].t)/L):-1;x0=i>=0&&i<=endIdx?Math.max(0,xOf(i)):0;}
    ya=cl(ov.a);
    const zone=(v,col)=>{const yv=cl(v);cx.globalAlpha=ov.ghost?.1:.14;cx.fillStyle=col;cx.fillRect(x0,Math.min(ya,yv),pw-x0,Math.abs(yv-ya));cx.globalAlpha=1;};
    if(ov.sl)zone(ov.sl,dn);if(ov.tp)zone(ov.tp,up);
  }

  /* candles */
  const glow=n<=140;
  for(let i=iS;i<=iE;i++){const k=a[i],x=xOf(i),col=k.c>=k.o?up:dn;cx.strokeStyle=cx.fillStyle=col;cx.lineWidth=1;
    if(glow){cx.shadowColor=col;cx.shadowBlur=5;}
    cx.beginPath();cx.moveTo(x,Y(k.h));cx.lineTo(x,Y(k.l));cx.stroke();
    const t=Y(Math.max(k.o,k.c)),b=Y(Math.min(k.o,k.c));cx.fillRect(x-cw*.32,t,Math.max(1,cw*.64),Math.max(1,b-t));}
  cx.shadowBlur=0;
  /* 10-candle average */
  cx.strokeStyle=ac;cx.lineWidth=1.6;cx.shadowColor=ac;cx.shadowBlur=glow?8:0;cx.beginPath();
  for(let i=iS;i<=iE;i++){let s=0,m=0;for(let j=Math.max(0,i-9);j<=i;j++){s+=a[j].c;m++;}const x=xOf(i),y=Y(s/m);i===iS?cx.moveTo(x,y):cx.lineTo(x,y);}
  cx.stroke();cx.shadowBlur=0;

  /* position lines and labels on top of the candles */
  if(ov){
    const long=ov.q>0,aq=Math.abs(ov.q),dash=ov.ghost?[3,4]:[7,4];
    const level=(v,col,name)=>{const yv=cl(v);
      cx.setLineDash(dash);cx.strokeStyle=col;cx.lineWidth=1.2;cx.globalAlpha=ov.ghost?.75:1;cx.beginPath();cx.moveTo(x0,yv);cx.lineTo(pw,yv);cx.stroke();cx.setLineDash([]);cx.globalAlpha=1;
      const gain=(v-ov.a)*ov.q,gp=gain/(ov.a*aq)*100;
      chip(name+' '+fx(v)+'   '+sm(gain)+' ('+pct(gp)+')',x0+8,yv<ya?yv+14:yv-6,col);
      tag(v,col,yv);};
    if(ov.sl)level(ov.sl,dn,'Stop loss');if(ov.tp)level(ov.tp,up,'Take profit');
    cx.strokeStyle=ink;cx.lineWidth=1.3;cx.globalAlpha=ov.ghost?.6:.9;cx.setLineDash(ov.ghost?[3,4]:[]);cx.beginPath();cx.moveTo(x0,ya);cx.lineTo(pw,ya);cx.stroke();cx.setLineDash([]);cx.globalAlpha=1;
    const rr=ov.sl&&ov.tp?Math.abs(ov.tp-ov.a)/Math.abs(ov.a-ov.sl):null;
    chip((ov.ghost?'Preview ':'')+(long?'Long ':'Short ')+aq+' @ '+fx(ov.a)+(ov.ghost?'':'   '+sm((px-ov.a)*ov.q))+(rr?'   R:R 1:'+fmt(rr,1):''),x0+8,ya-6,ink);
    tag(ov.a,ink,ya);
  }

  /* execution marks: triangle for entries, diamond for exits, dot on the exact fill price */
  marks.forEach(m=>{
    if(m.s!==cur)return;const i=Math.floor((m.t-a[0].t)/L);if(i<iS||i>iE)return;
    const k=a[i],x=xOf(i),entry=m.kind==='long'||m.kind==='short';if(x<0||x>pw)return;
    const col=({long:up,short:dn,sl:dn,tp:up,close:a2})[m.kind];
    const below=entry?m.kind==='long':m.dir==='short';
    const ay=Math.max(12,Math.min(h-BOT-6,below?Y(k.l)+14:Y(k.h)-14));
    cx.fillStyle=col;cx.shadowColor=col;cx.shadowBlur=10;cx.beginPath();
    if(entry){if(m.kind==='long'){cx.moveTo(x,ay-6);cx.lineTo(x-6,ay+5);cx.lineTo(x+6,ay+5);}else{cx.moveTo(x,ay+6);cx.lineTo(x-6,ay-5);cx.lineTo(x+6,ay-5);}}
    else{cx.moveTo(x,ay-6);cx.lineTo(x+6,ay);cx.lineTo(x,ay+6);cx.lineTo(x-6,ay);}
    cx.closePath();cx.fill();cx.shadowBlur=0;
    cx.beginPath();cx.arc(x,Y(m.px),3,0,7);cx.fillStyle=ink;cx.fill();cx.strokeStyle=col;cx.lineWidth=1.5;cx.stroke();
    cx.font='600 10px '+F;cx.textAlign='center';cx.fillStyle=col;
    const t=({long:'Long',short:'Short',close:'Exit',sl:'SL',tp:'TP'})[m.kind]+' '+m.q;
    cx.fillText(t,Math.max(26,Math.min(pw-26,x)),Math.max(12,Math.min(h-BOT-2,below?ay+19:ay-10)));
    cx.textAlign='left';
  });

  /* last price tag */
  const y=Y(px);if(y>TOP-4&&y<h-BOT+4){cx.setLineDash([4,4]);cx.strokeStyle=ac;cx.lineWidth=1;cx.beginPath();cx.moveTo(0,y);cx.lineTo(pw,y);cx.stroke();cx.setLineDash([]);
    cx.fillStyle=ac;cx.fillRect(pw,y-9,PAD,18);cx.fillStyle=on;cx.font='600 11px '+F;cx.textAlign='left';cx.fillText(fx(px),pw+5,y+4);}

  /* crosshair */
  let hk=null;
  if(hov&&hov.x>=0&&hov.x<pw){
    const i=Math.max(0,Math.min(len-1,Math.round(start+hov.x/cw-.5)));hk=a[i];const x=xOf(i);
    cx.setLineDash([3,4]);cx.strokeStyle=a2;cx.lineWidth=1;cx.globalAlpha=.55;
    cx.beginPath();cx.moveTo(x,TOP);cx.lineTo(x,h-BOT);cx.stroke();
    if(hov.y>TOP&&hov.y<h-BOT){cx.beginPath();cx.moveTo(0,hov.y);cx.lineTo(pw,hov.y);cx.stroke();}
    cx.setLineDash([]);cx.globalAlpha=1;
    if(hov.y>TOP&&hov.y<h-BOT){const v=lo+(h-BOT-hov.y)/(h-BOT-TOP)*(hi-lo);cx.fillStyle=a2;cx.fillRect(pw,hov.y-9,PAD,18);cx.fillStyle=on;cx.font='11px '+F;cx.fillText(fx(v),pw+5,hov.y+4);}
    const tl=full(hk.t,L);cx.font='11px '+F;const tw=cx.measureText(tl).width;
    const tx=Math.max(2,Math.min(pw-tw-10,x-tw/2-4));cx.fillStyle=a2;cx.fillRect(tx,h-BOT+2,tw+8,17);cx.fillStyle=on;cx.fillText(tl,tx+4,h-BOT+14);
  }
  /* header: OHLC of the hovered candle, or the latest one */
  const k=hk||a[len-1],short=w<470;
  cx.textAlign='left';cx.font='600 12px '+F;cx.fillStyle=ink;const t1=cur+' · '+tfk+'   ';cx.fillText(t1,8,16);let xx=8+cx.measureText(t1).width;
  cx.font='12px '+F;cx.fillStyle=mu;const t2=short?'C '+fx(k.c)+'  ':'O '+fx(k.o)+'  H '+fx(k.h)+'  L '+fx(k.l)+'  C '+fx(k.c)+'  ';cx.fillText(t2,xx,16);xx+=cx.measureText(t2).width;
  cx.fillStyle=k.c>=k.o?up:dn;cx.fillText(pct((k.c/k.o-1)*100),xx,16);
}

/* ---------- render ---------- */
function render(){
  const eq=equity(),pnl=eq-START;
  $('eq').innerHTML=money(eq).replace(/\.(\d+)$/,'<small>.$1</small>');
  $('dayPnl').innerHTML=`<span class="${cls(pnl)}">${sm(pnl)} (${pct(pnl/START*100)})</span>`;
  $('cash').textContent=money(acct.cash);$('npos').textContent=Object.keys(acct.pos).length;
  const mv=[...S].sort((a,b)=>Math.abs(b.p/b.o-1)-Math.abs(a.p/a.o-1))[0];
  $('best').innerHTML=`${mv.s} <span class="${cls(mv.p-mv.o)}">${pct((mv.p/mv.o-1)*100)}</span>`;
  const chg=x=>(x.p/x.o-1)*100;
  $('tape').innerHTML=(t=>t+t)(S.map(x=>`<span>${x.s} <b>${fmt(x.p)}</b> <span class="${cls(chg(x))}">${pct(chg(x))}</span></span>`).join(''));
  $('watch').innerHTML=S.map(x=>`<tr data-s="${x.s}" class="${x.s===cur?'sel':''}"><td>${x.s}</td><td>${fmt(x.p)}</td><td class="${cls(chg(x))}">${pct(chg(x))}</td></tr>`).join('');
  $('tPx').textContent=money(by($('tSym').value).p);
  riskReward();
  const ps=Object.entries(acct.pos);
  $('pos').innerHTML=ps.length?ps.map(([s,p])=>{const u=(by(s).p-p.a)*p.q,L=p.q>0;
    const lv=(p.sl||p.tp)?`<div class="lv"><span class="dn">SL ${p.sl?fmt(p.sl):'none'}</span><span class="up">TP ${p.tp?fmt(p.tp):'none'}</span></div>`:'';
    return `<tr data-s="${s}"><td>${s}<span class="tag ${L?'up':'dn'}">${L?'Long':'Short'}</span>${lv}</td><td>${Math.abs(p.q)}</td><td class="${cls(u)}">${sm(u)}</td><td><button class="x" data-x="${s}" aria-label="Close ${s} position">×</button></td></tr>`;}).join(''):'<tr><td colspan="4" style="color:var(--mute)">No positions yet. Go long or short to open one.</td></tr>';
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

setSide('long');
resetView();
render();
setInterval(()=>{advance();checkLevels();render();},900);
})();
