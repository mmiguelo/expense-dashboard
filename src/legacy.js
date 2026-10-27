const DEF={Groceries:'#3fa66b',Utilities:'#e0a526',Insurance:'#8a63d2',Mortgage:'#d1495b',Gym:'#e97a3b',Transportation:'#2aa6b8',Fuel:'#7a8699',Education:'#2f5bea',Leisure:'#d65db1',Health:'#4cc3a0','Phone & Internet':'#5b8def',Shopping:'#b5651d',Other:'#9aa5b5'};
const KW={Groceries:['pingo doce','continente','lidl','aldi','minipreço','intermarché','mercado','supermarket','padaria','talho'],Utilities:['edp','endesa','energy','electric','luz','gas','água','agua','water','epal'],Insurance:['insurance','seguro','fidelidade','ageas'],Mortgage:['mortgage','crédito habitação','loan','prestação'],Gym:['gym','ginásio','holmes','fitness'],Transportation:['bus','autocarro','metro','train','uber','bolt','taxi','passe'],Fuel:['fuel','petrol','diesel','gasolina','gasóleo','galp','repsol','shell'],Education:['school','course','udemy','book','livro','tuition','escola'],Leisure:['restaurant','restaurante','cinema','café','cafe','netflix','spotify','movie','pizza','sushi'],Health:['pharmacy','farmácia','doctor','médico','dentist','dentista','clinic'],'Phone & Internet':['nos ','meo','vodafone','nowo','internet','phone'],Shopping:['amazon','zara','ikea','fnac','worten','roupa']};
const PAL=['#0a8f8f','#c05299','#7d8f1f','#a0522d','#4b6cb7','#cc7722'];
const $=id=>document.getElementById(id),eur=n=>n.toLocaleString('pt-PT',{style:'currency',currency:'EUR'}),iso=d=>d.toLocaleDateString('sv');
const MN=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'],pf=s=>parseFloat(String(s).replace(',','.'));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const dim=(y,m)=>new Date(y,m,0).getDate(),pad=n=>String(n).padStart(2,'0');
let S={ex:[],rec:[],bud:{},cats:{...DEF},learn:{},gen:{}},mode='month',ref=iso(new Date()),touched=false,editId=null,last=null,tt;
try{const a=localStorage.getItem('exp-v2'),o=localStorage.getItem('expenses-v1');
 if(a)S={...S,...JSON.parse(a)};else if(o)S.ex=JSON.parse(o).map(x=>({...x,type:'e'}))}catch(e){}
const save=()=>{try{localStorage.setItem('exp-v2',JSON.stringify(S))}catch(e){}};
const col=c=>c==='Income'?'#3fa66b':S.cats[c]||'#9aa5b5';
S.ex.forEach(x=>{if(x.type==='e'&&!S.cats[x.cat])S.cats[x.cat]=PAL[Object.keys(S.cats).length%6]});
function guess(t){const l=t.toLowerCase().trim();if(S.learn[l])return S.learn[l];const s=' '+l+' ';for(const c in KW)if(KW[c].some(w=>s.includes(w))&&S.cats[c])return c;return null}
function gen(){const t=iso(new Date()),cm=t.slice(0,7);let ch=0;
 S.rec.forEach(r=>{let[y,m]=r.start.split('-').map(Number);for(;;){const k=`${y}-${pad(m)}`;if(k>cm)break;const dt=`${k}-${pad(Math.min(r.day,dim(y,m)))}`;
 if(dt<=t&&!S.gen[r.id+k]){S.gen[r.id+k]=1;S.ex.push({id:Date.now()+Math.random(),date:dt,amount:r.amount,desc:r.desc,cat:r.cat,type:'e',fixed:1,tags:'recurring'});ch=1}m++;if(m>12){m=1;y++}}});if(ch)save()}
const opts=(el,inc,all)=>{el.innerHTML=(all?'<option value="">All categories</option>':'')+Object.keys(S.cats).map(c=>`<option>${esc(c)}</option>`).join('')+(inc?'<option>Income</option>':'')};
function fillSel(){const v=[$('cat').value,$('fc').value,$('rc').value];opts($('cat'));opts($('fc'),1,1);opts($('rc'));[$('cat'),$('fc'),$('rc')].forEach((e,i)=>{if(v[i])e.value=v[i]})}
const inP=(d,r,m=mode)=>m==='day'?d===r:m==='month'?d.slice(0,7)===r.slice(0,7):d.slice(0,4)===r.slice(0,4);
function shift(r,n){const[y,m,d]=r.split('-').map(Number),dt=new Date(y,m-1,d,12);if(mode==='day')dt.setDate(d+n);else if(mode==='month'){dt.setDate(1);dt.setMonth(m-1+n)}else dt.setFullYear(y+n);return iso(dt)}
const sum=a=>a.reduce((s,x)=>s+x.amount,0),E=()=>S.ex.filter(x=>x.type==='e'),I=()=>S.ex.filter(x=>x.type==='i');
const pct=(a,b)=>b?`<span class="${a>b?'up':'dn'}">${a>=b?'+':''}${Math.round((a-b)/b*100)}%</span>`:'<span class="mute">new</span>';

$('desc').oninput=()=>{const g=guess($('desc').value);if(g&&!touched&&$('type').value==='e')$('cat').value=g};
$('cat').onchange=()=>touched=true;
$('type').onchange=()=>{$('cat').disabled=$('type').value==='i'};
function resetForm(){editId=null;touched=false;['amt','desc','tags'].forEach(i=>$(i).value='');$('type').value='e';$('date').value=ref;$('cat').disabled=false;$('sub').textContent='Add';$('cancel').hidden=true;$('fT').textContent='Add a transaction'}
$('cancel').onclick=resetForm;
const addTx=()=>{const amount=pf($('amt').value);if(!(amount>0)||!$('date').value)return;
 const type=$('type').value,desc=$('desc').value.trim(),cat=type==='i'?'Income':$('cat').value;
 if(type==='e'&&desc&&touched)S.learn[desc.toLowerCase()]=cat;
 const o={date:$('date').value,amount,desc:desc||cat,cat,type,tags:$('tags').value.trim()};
 if(editId){const x=S.ex.find(z=>z.id===editId);Object.assign(x,o)}else S.ex.push({id:Date.now()+Math.random(),...o});
 save();ref=o.date;resetForm();render()};
$('sub').onclick=addTx;['date','amt','desc','tags'].forEach(i=>$(i).onkeydown=e=>{if(e.key==='Enter')addTx()});
$('modes').onclick=e=>{const m=e.target.dataset.m;if(!m)return;mode=m;document.querySelectorAll('#modes button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));render()};
$('prev').onclick=()=>{ref=shift(ref,-1);render()};$('next').onclick=()=>{ref=shift(ref,1);render()};$('today').onclick=()=>{ref=iso(new Date());render()};
$('q').oninput=$('fc').onchange=()=>renderList();
function toast(m){$('tm').textContent=m;$('toast').style.display='flex';clearTimeout(tt);tt=setTimeout(()=>$('toast').style.display='none',6000)}
$('undo').onclick=()=>{if(last){S.ex.push(last);last=null;save();render()}$('toast').style.display='none'};
document.addEventListener('click',e=>{const t=e.target,d=t.dataset;
 if(d.del){last=S.ex.find(x=>String(x.id)===d.del);S.ex=S.ex.filter(x=>x!==last);save();render();toast('Transaction deleted')}
 if(d.edit){const x=S.ex.find(z=>String(z.id)===d.edit);editId=x.id;$('type').value=x.type;$('date').value=x.date;$('amt').value=String(x.amount).replace('.',',');$('desc').value=x.desc;$('tags').value=x.tags||'';
  $('cat').disabled=x.type==='i';if(x.type==='e')$('cat').value=x.cat;touched=false;$('sub').textContent='Save changes';$('cancel').hidden=false;$('fT').textContent='Edit transaction';$('f').scrollIntoView({behavior:'smooth'})}
 if(d.rdel){S.rec=S.rec.filter(r=>String(r.id)!==d.rdel);save();renderSet()}
 if(d.chip){const c=JSON.parse(d.chip);$('type').value='e';$('desc').value=c.desc;$('cat').value=c.cat;$('amt').value=String(c.amount).replace('.',',');$('amt').focus();$('amt').select()}});
$('rb').onclick=()=>{const a=pf($('ra').value);if(!(a>0)||!$('rd').value.trim())return;S.rec.push({id:'r'+Date.now(),desc:$('rd').value.trim(),amount:a,cat:$('rc').value,day:+$('rday').value||1,start:iso(new Date()).slice(0,7)});['rd','ra'].forEach(i=>$(i).value='');gen();save();render()};
$('ncb').onclick=()=>{const n=$('nc').value.trim();if(n&&!S.cats[n]){S.cats[n]=PAL[Object.keys(S.cats).length%6];$('nc').value='';save();render()}};
const dl=(n,t,m)=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([t],{type:m}));a.download=n;a.click()};
$('xj').onclick=()=>dl('expenses-backup.json',JSON.stringify(S),'application/json');
$('xc').onclick=()=>dl('expenses.csv','date,type,amount,category,description,tags,fixed\n'+S.ex.map(x=>[x.date,x.type==='i'?'income':'expense',x.amount,x.cat,'"'+String(x.desc).replace(/"/g,'""')+'"','"'+(x.tags||'')+'"',x.fixed?1:0].join(',')).join('\n'),'text/csv');
$('imp').onchange=e=>{const f=e.target.files[0];if(!f)return;f.text().then(t=>{try{const o=JSON.parse(t);if(!Array.isArray(o.ex))throw 0;if(confirm('Replace current data with this backup?')){S={...S,...o};save();render();toast('Backup imported')}}catch(x){alert('This file is not a valid backup.')}})};

function renderSet(){$('bud').innerHTML=Object.keys(S.cats).map(c=>`<span>${esc(c)}</span><input inputmode="decimal" data-b="${esc(c)}" value="${S.bud[c]||''}" placeholder="€ / month">`).join('');
 document.querySelectorAll('[data-b]').forEach(i=>i.onchange=()=>{const v=pf(i.value);if(v>0)S.bud[i.dataset.b]=v;else delete S.bud[i.dataset.b];save();render()});
 $('rlist').innerHTML=S.rec.length?S.rec.map(r=>`<div class="row"><span class="dot" style="background:${col(r.cat)}"></span><div>${esc(r.desc)} <span class="mute">${r.cat}, day ${r.day}</span></div><div><b>${eur(r.amount)}</b> <button class="x" data-rdel="${r.id}" aria-label="Remove">✕</button></div></div>`).join(''):'<div class="mute">No recurring expenses yet. Add your mortgage, insurance or gym once.</div>'}
function renderList(){const q=$('q').value.toLowerCase(),fc=$('fc').value;
 const l=S.ex.filter(x=>inP(x.date,ref)&&(!fc||x.cat===fc)&&(!q||(x.desc+' '+(x.tags||'')+' '+x.amount+' '+x.cat).toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
 $('list').innerHTML=l.length?l.map(x=>`<div class="row"><span class="dot" style="background:${col(x.cat)}"></span><div>${esc(x.desc)}<div class="mute">${x.date.split('-').reverse().join('/')}, ${esc(x.cat)}${x.tags?', '+esc(x.tags):''}</div></div><div><b>${x.type==='i'?'+':''}${eur(x.amount)}</b> <button class="x" data-edit="${x.id}" aria-label="Edit">✎</button><button class="x" data-del="${x.id}" aria-label="Delete">✕</button></div></div>`).join(''):'<div class="mute">Nothing here yet. Add a transaction above.</div>'}
function renderChips(){const f={};E().forEach(x=>{const k=x.desc.toLowerCase();f[k]=f[k]||{n:0,desc:x.desc,cat:x.cat,amount:x.amount};f[k].n++;f[k].amount=x.amount});
 $('chips').innerHTML=Object.values(f).sort((a,b)=>b.n-a.n).slice(0,6).map(c=>`<button type="button" data-chip='${esc(JSON.stringify({desc:c.desc,cat:c.cat,amount:c.amount}))}'>${esc(c.desc)}</button>`).join('')}

function render(){
 gen();fillSel();const[y,m,d]=ref.split('-').map(Number),now=iso(new Date()),[ny,nm,nd]=now.split('-').map(Number);
 $('lbl').textContent=mode==='day'?`${d} ${MN[m-1]} ${y}`:mode==='month'?`${MN[m-1]} ${y}`:y;
 const cur=E().filter(x=>inP(x.date,ref)),tot=sum(cur),inc=sum(I().filter(x=>inP(x.date,ref))),pr=shift(ref,-1),prevE=E().filter(x=>inP(x.date,pr)),ptot=sum(prevE);
 const by={},pby={};cur.forEach(x=>by[x.cat]=(by[x.cat]||0)+x.amount);prevE.forEach(x=>pby[x.cat]=(pby[x.cat]||0)+x.amount);
 const ents=Object.entries(by).sort((a,b)=>b[1]-a[1]),fixed=sum(cur.filter(x=>x.fixed));
 const span=mode==='month'?dim(y,m):mode==='year'?12:1;let proj='';
 if(mode==='month'&&y===ny&&m===nm)proj=eur(tot/nd*span);if(mode==='year'&&y===ny)proj=eur(tot/nm*12);
 $('sum').innerHTML=`<div class="mute">Spent this ${mode}</div><div class="total">${eur(tot)}</div><div class="mute">${ptot?`${pct(tot,ptot)} vs previous ${mode} (${eur(ptot)})`:`No data for previous ${mode}`}</div>
 <div class="stats"><div><b>${cur.length}</b><small>expenses</small></div>${mode!=='day'?`<div><b>${eur(tot/span)}</b><small>average per ${mode==='year'?'month':'day'}</small></div>`:''}
 ${proj?`<div><b>${proj}</b><small>projected ${mode==='year'?'year':'month'} end</small></div>`:''}
 <div><b>${eur(inc)}</b><small>income</small></div><div><b class="${inc-tot<0?'up':''}">${eur(inc-tot)}</b><small>net balance</small></div>${inc?`<div><b>${Math.round((inc-tot)/inc*100)}%</b><small>savings rate</small></div>`:''}
 <div><b>${tot?Math.round(fixed/tot*100):0}%</b><small>fixed (recurring) · ${eur(fixed)}</small></div><div><b>${eur(tot-fixed)}</b><small>variable</small></div></div>`;
 // stacked trend
 let bk=[];if(mode==='day'){$('tT').textContent='Last 7 days';for(let i=6;i>=0;i--){const dt=new Date(y,m-1,d-i,12);bk.push([String(dt.getDate()),x=>x.date===iso(dt)])}}
 else if(mode==='month'){$('tT').textContent='Daily spending by category';for(let i=1;i<=span;i++){const k=`${y}-${pad(m)}-${pad(i)}`;bk.push([i%5===1?String(i):'',x=>x.date===k])}}
 else{$('tT').textContent='Monthly spending by category';for(let i=1;i<=12;i++){const k=`${y}-${pad(i)}`;bk.push([MN[i-1][0],x=>x.date.slice(0,7)===k])}}
 const data=bk.map(([l,f])=>{const s={};E().filter(f).forEach(x=>s[x.cat]=(s[x.cat]||0)+x.amount);return[l,s,Object.values(s).reduce((a,b)=>a+b,0)]}),mx=Math.max(...data.map(z=>z[2]),1);
 $('trend').innerHTML=data.map(([l,s,t])=>`<div title="${eur(t)}"><div class="st" style="height:${t/mx*82}%">${Object.entries(s).map(([c,v])=>`<i style="height:${v/t*100}%;background:${col(c)}"></i>`).join('')}</div><span>${l||'&nbsp;'}</span></div>`).join('');
 // donut
 let off=0;$('donut').innerHTML=ents.length?`<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap"><svg viewBox="0 0 42 42" width="150" height="150" role="img" aria-label="Category share"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--line)" stroke-width="6"/>${ents.map(([c,v])=>{const p=v/tot*100,s=`<circle cx="21" cy="21" r="15.9" fill="none" stroke="${col(c)}" stroke-width="6" stroke-dasharray="${p} ${100-p}" stroke-dashoffset="${25-off}"/>`;off+=p;return s}).join('')}</svg><div>${ents.slice(0,6).map(([c,v])=>`<div><span class="dot" style="display:inline-block;background:${col(c)}"></span> ${esc(c)} <b>${Math.round(v/tot*100)}%</b></div>`).join('')}</div></div>`:'<div class="mute">No expenses in this period.</div>';
 // categories + budgets
 const mult=mode==='year'?12:1,names=[...new Set([...ents.map(e=>e[0]),...(mode==='day'?[]:Object.keys(S.bud))])];
 $('cats').innerHTML=names.length?names.sort((a,b)=>(by[b]||0)-(by[a]||0)).map(c=>{const v=by[c]||0,b=mode==='day'?0:(S.bud[c]||0)*mult,r=b?v/b:v/(ents[0]?ents[0][1]:1),cl=b?(r>1?'var(--bad)':r>.8?'var(--warn)':col(c)):col(c);
 return`<div style="padding:6px 0"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><span>${esc(c)}</span><span><b>${eur(v)}</b>${b?` <small>of ${eur(b)}</small>`:''} <small>${pby[c]!==undefined||v?pct(v,pby[c]||0):''}</small></span></div><div class="bar"><i style="width:${Math.min(r,1)*100}%;background:${cl}"></i></div></div>`}).join(''):'<div class="mute">Add expenses, or set budgets in Settings.</div>';
 // heatmap
 $('heatC').style.display=mode==='day'?'none':'';
 if(mode!=='day'){const ds=[];const n=mode==='month'?span:(y%4?365:366);for(let i=0;i<n;i++){const dt=mode==='month'?new Date(y,m-1,i+1,12):new Date(y,0,i+1,12);ds.push(iso(dt))}
  const dv=ds.map(k=>sum(cur.filter(x=>x.date===k))),hm=Math.max(...dv,1);$('heat').innerHTML=ds.map((k,i)=>`<i title="${k}: ${eur(dv[i])}" style="opacity:${dv[i]?.2+dv[i]/hm*.8:.08}"></i>`).join('')}
 // top merchants
 const mm={};cur.forEach(x=>{const k=x.desc.toLowerCase();mm[k]=mm[k]||{n:x.desc,v:0,c:0};mm[k].v+=x.amount;mm[k].c++});
 $('top').innerHTML=Object.values(mm).sort((a,b)=>b.v-a.v).slice(0,5).map(z=>`<div class="row" style="grid-template-columns:1fr auto"><div>${esc(z.n)} <small>${z.c}×</small></div><b>${eur(z.v)}</b></div>`).join('')||'<div class="mute">No data yet.</div>';
 renderList();renderChips();renderSet();
}
$('date').value=ref;render();
