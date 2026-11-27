import {auth,signInWithEmailAndPassword,signOut,onAuthStateChanged,connect,doc,getDoc,setDoc,addDoc,collection,query,orderBy,limit,startAfter,getDocs,serverTimestamp,deleteField,deleteDoc} from "./firebase.js";
import {ls} from "./util.js";
import {loadPaddocks,searchPaddocks,getPaddock,fmtLuas} from "./paddock.js";
import {loadOps,searchOps,getOpByCode,getOpByDesc,opsForDept,normDept,DEPTS as OP_DEPTS} from "./operation.js";
import {loadUnits,unitsOf,getUnit} from "./unit.js";

const $=id=>document.getElementById(id);
let db;
const mods={};const mod=n=>mods[n]||(mods[n]=import('./'+n+'.js'));   // timeline / summary / costing / export-excel dimuat saat dipakai
let me=null,cur={id:null,status:'open',mode:'plan'},master=null,ops=null,padFail=false,opsFail=false,luasRO=true,sel=-1;
const MAXR=100;
const isR=(...r)=>r.includes(me.role)||me.role==='admin';
const show=v=>{['list','formv'].forEach(x=>$(x).hidden=x!==v);$('nav').hidden=false;$('ld').hidden=true};
const msg=e=>alert('Gagal: '+(e.code||e.message));

/* ---------- referensi DOM ---------- */
const paper=document.querySelector('#formv .paper');
const opEl=$('op'),opBody=opEl.querySelector('tbody'),ctlRow=opBody.querySelector('.ctl');
const ukBody=document.querySelector('#uk tbody'),mpBody=document.querySelector('#mp tbody');
const startEl=$('fStart'),endEl=$('fEnd');
const S=()=>[...paper.querySelectorAll('[data-s]')];            // input tetap (header, man power, footer)
const opRows=()=>[...opBody.querySelectorAll('tr.r')];          // baris Operation
const ukRows=()=>[...ukBody.children];                          // baris Unit Kerja (selalu sama banyak)
const mpRows=()=>[...mpBody.children];                          // baris Man Power Support (selalu sama banyak)

/* ---------- autocorrect PT & Department: ketikan disesuaikan ke pilihan baku ---------- */
paper.querySelectorAll('[data-fix]').forEach(el=>{
 const opts=[...$(el.dataset.fix).options].map(o=>o.value);
 const key=v=>v.toLowerCase().replace(/[^a-z0-9]/g,'');
 el.addEventListener('change',()=>{
  const k=key(el.value);if(!k)return;
  const hit=opts.find(o=>key(o)===k)||(()=>{const m=opts.filter(o=>key(o).includes(k));return m.length===1?m[0]:null})();
  if(hit)el.value=hit;
 });
});
const iStart=S().indexOf(startEl),iClose=S().indexOf($('dClose'));   // posisi Forecast Start & Tanggal Closing di array s

/* ---------- tanggal & shift ---------- */
const MONTH=['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const MON=['Jan','Feb','Mar','Apr','Mei','Jun','Jul','Agu','Sep','Okt','Nov','Des'];
const dParts=s=>{const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(s||'');return m?{y:+m[1],m:+m[2]-1,d:+m[3]}:null};
const dLong=s=>{const p=dParts(s);return p?p.d+' '+MONTH[p.m]+' '+p.y:''};
const dShort=s=>{const p=dParts(s);return p?p.d+' '+MON[p.m]:''};
const shiftTxt=(sh,s,fn)=>sh?('Shift '+sh+(dParts(s)?' - '+fn(s):'')):'';

/* ---------- baris Operation + Unit Kerja (selalu berpasangan) ---------- */
const OPT='<option value="">None</option><option value="1">Shift 1</option><option value="2">Shift 2</option><option value="3">Shift 3</option>';
const T='<input type="text" ';
const OPROW='<tr class="r"><td class="n"></td>'+
 '<td>'+T+'data-k="code"></td><td>'+T+'data-k="desc"></td>'+
 '<td>'+T+'data-k="paddock" autocomplete="off" spellcheck="false"></td>'+
 '<td>'+T+'data-k="luas" class="luas" readonly></td>'+
 '<td>'+T+'data-k="hk" class="hk"></td><td>'+T+'data-k="uom"></td>'+
 '<td>'+T+'data-k="open" class="open"></td><td>'+T+'data-k="close" class="close"></td>'+
 '<td class="pct"></td>'+
 '<td class="kc"><select class="sh" title="Pilih shift">'+OPT+'</select>'+T+'class="ket" spellcheck="false" title="Bisa diedit. Format: Shift 1 - 17 November 2026"></td></tr>';
const UKROW='<tr><td class="n"></td><td class="uc ucn"></td><td class="uc ucj"></td><td class="uc ucr"></td><td class="uc uce"></td><td class="uc ucv"></td>'+
 '<td class="n"></td><td>'+T+'class="uk2" readonly tabindex="-1"></td><td class="mc md"></td><td class="mc mn"></td><td class="mc mk"></td><td class="mc mr"></td></tr>';

const MPROW='<tr><td class="n"></td><td>'+T+'data-k="mnik"></td><td>'+T+'data-k="mnama"></td><td>'+T+'data-k="mjab"></td><td>'+T+'data-k="mhk"></td>'+
 '<td class="n"></td><td>'+T+'data-k="pnik"></td><td>'+T+'data-k="pnama"></td><td>'+T+'data-k="pjab"></td><td>'+T+'data-k="phk"></td></tr>';

function mkRow(r){
 r=r||{};
 ctlRow.insertAdjacentHTML('beforebegin',OPROW);
 const o=ctlRow.previousElementSibling;
 ukBody.insertAdjacentHTML('beforeend',UKROW);
 const u=ukBody.lastElementChild;
 mpBody.insertAdjacentHTML('beforeend',MPROW);
 const m=mpBody.lastElementChild;
 [o,u,m].forEach(t=>t.querySelectorAll('[data-k]').forEach(e=>{const x=r[e.dataset.k];e.value=x==null?'':x}));
 o.querySelector('.sh').value=r.shift||'';
 const di=o.querySelector('[data-k=desc]');di.title=di.value;
 o.dataset.date=r.date||'';   // tanggal khusus baris (kosong = ikut Forecast Start)
 o.querySelector('.luas').readOnly=luasRO;
 setMats(u,matsFrom(r));
 setUnits(u,unitsFrom(r));
 return o;
}
function markSel(){
 opRows().forEach((tr,i)=>tr.firstElementChild.classList.toggle('sel',i===sel));
 ukRows().forEach((tr,i)=>{tr.children[0].classList.toggle('sel',i===sel);tr.children[6].classList.toggle('sel',i===sel)});
 mpRows().forEach((tr,i)=>{tr.children[0].classList.toggle('sel',i===sel);tr.children[5].classList.toggle('sel',i===sel)});
}
function renum(){
 opRows().forEach((tr,i)=>{tr.firstElementChild.textContent=i+1});
 ukRows().forEach((tr,i)=>{tr.children[0].textContent=i+1;tr.children[6].textContent=i+1});
 mpRows().forEach((tr,i)=>{tr.children[0].textContent=i+1;tr.children[5].textContent=i+1});
 markSel();
}
// keterangan (Operation) dan kode unit (Unit Kerja kanan) mengikuti shift + Forecast Start
function sync(){
 const s=startEl.value,ur=ukRows();
 opRows().forEach((tr,i)=>{
  const sh=tr.querySelector('.sh').value,dt=tr.dataset.date||s;
  tr.querySelector('.ket').value=shiftTxt(sh,dt,dLong);
  if(ur[i])ur[i].querySelector('.uk2').value=shiftTxt(sh,dt,dShort);
 });
}

/* ---------- hitung total ---------- */
const v=e=>parseFloat(String(e.value).replace(',','.'))||0;
const f2=x=>Math.round(x*100)/100;
const fm=x=>x?String(f2(x)).replace('.',','):'';
const sum=c=>{let s=0;opEl.querySelectorAll('tbody .'+c).forEach(e=>{s+=v(e)});return s};
function calc(){
 opRows().forEach(r=>{
  const o=v(r.querySelector('.open')),c=v(r.querySelector('.close'));
  r.querySelector('.pct').textContent=o?String(f2(c/o*100)).replace('.',',')+'%':'';
 });
 const o=sum('open'),c=sum('close');
 $('tLuas').textContent=fm(sum('luas'));$('tHK').textContent=fm(sum('hk'));
 $('tOpen').textContent=fm(o);$('tClose').textContent=fm(c);
 $('tPct').textContent=o?String(f2(c/o*100)).replace('.',',')+'%':'';
 calcUK();
}
// total kolom angka di Unit Kerja
function calcUK(){
 matCalc();
 const t={unik:0,unama:0,uest:0,uhk:0};
 ukRows().forEach(u=>getUnits(u).forEach(e=>{for(const k in UT)t[k]+=nf(e[UT[k]])||0}));
 for(const k in t)$('u_'+k).textContent=fm(t[k]);
}
document.getElementById('uk').addEventListener('input',calcUK);

/* ---------- material: banyak material per baris, diisi lewat pop-up ---------- */
// data per baris: [{mat,sat,dosis,keb,real}] disimpan di rows[i].mats; kolom lama vnik/vnama/vest/vhk tetap diisi (teks bertumpuk) untuk modul lain
const SATS=['','L','ml','Kg','gr','Unit'];
const nf=s=>{const x=parseFloat(String(s==null?'':s).replace(',','.'));return isFinite(x)?x:null};
const nTxt=x=>x==null||x===''?'':String(Math.round(x*1000)/1000).replace('.',',');
function matsFrom(r){
 if(Array.isArray(r.mats))return r.mats.map(m=>Object.assign({mat:'',sat:'',dosis:'',keb:'',real:''},m));
 const any=['vnik','vnama','vest','vhk'].some(k=>String(r[k]||'').trim());
 if(!any)return[];
 const sp=k=>String(r[k]||'').split('\n');const a=sp('vnik'),b=sp('vnama'),c=sp('vest'),d=sp('vhk');
 const n=Math.max(a.length,b.length,c.length,d.length),out=[];
 for(let i=0;i<n;i++)out.push({mat:(b[i]||'').trim(),sat:'',dosis:(a[i]||'').trim(),keb:(c[i]||'').trim(),real:(d[i]||'').trim()});
 return out;
}
const getMats=u=>{try{return JSON.parse((u&&u.dataset.mats)||'[]')}catch(e){return[]}};
const withSat=(x,s)=>x===''||x==null?'':x+(s?' '+s:'');
function matsOut(ms){
 const j=k=>ms.map(m=>m[k]==null?'':String(m[k])).join('\n');
 return{mats:ms,vnik:j('dosis'),vnama:j('mat'),vest:j('keb'),vhk:j('real')};
}
function setMats(u,ms){
 u.dataset.mats=JSON.stringify(ms);
 const c=u.querySelectorAll('td.mc'),L=f=>ms.map(m=>{const x=f(m);return x===''?'\u00a0':x}).join('\n');
 c[0].textContent=ms.length?L(m=>m.dosis):'';
 c[1].textContent=ms.length?L(m=>m.mat):'';
 c[2].textContent=ms.length?L(m=>withSat(m.keb,m.sat)):'';
 c[3].textContent=ms.some(m=>String(m.real).trim())?L(m=>withSat(m.real,m.sat)):'';
 c[3].classList.toggle('can',ms.length>0);
}
const openOf=i=>{const tr=opRows()[i];return tr?nf(tr.querySelector('.open').value):null};
// Total Kebutuhan = Dosis x Target Open (luas) baris itu
function recalcMats(){
 ukRows().forEach((u,i)=>{
  const ms=getMats(u);if(!ms.length)return;const o=openOf(i);let ch=false;
  ms.forEach(m=>{const d=nf(m.dosis),k=d!=null&&o!=null?nTxt(d*o):'';if(k!==m.keb){m.keb=k;ch=true}});
  if(ch)setMats(u,ms);
 });
}
// rekap per material di baris Total
function matCalc(){
 recalcMats();
 const g=new Map();
 ukRows().forEach(u=>getMats(u).forEach(m=>{
  const name=String(m.mat||'').trim();if(!name)return;
  const key=name.toLowerCase()+'|'+m.sat;
  if(!g.has(key))g.set(key,{name:name,sat:m.sat,keb:0,real:0,hasR:false});
  const x=g.get(key);x.keb+=nf(m.keb)||0;const rv=nf(m.real);if(rv!=null){x.real+=rv;x.hasR=true}
 }));
 const a=[...g.values()];
 $('u_vnama').textContent=a.map(x=>x.name).join('\n');
 $('u_vest').textContent=a.map(x=>withSat(nTxt(x.keb)||'0',x.sat)).join('\n');
 $('u_vhk').textContent=a.some(x=>x.hasR)?a.map(x=>x.hasR?withSat(nTxt(x.real),x.sat):'\u00a0').join('\n'):'';
}

let mCur=null;   // {i, kind:'plan'|'real', list:[...]}
const esc=s=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function mOpen(i,kind){
 const u=ukRows()[i],tr=opRows()[i];if(!u||!tr)return;
 const list=getMats(u);
 if(kind==='plan'&&!list.length)list.push({mat:'',sat:'',dosis:'',keb:'',real:''});
 mCur={i:i,kind:kind,list:list};
 const q=s=>tr.querySelector(s).value.trim(),o=openOf(i);
 $('mKind').textContent=kind==='plan'?'Rencana Material':'Realisasi Material';
 $('mTitle').textContent='Baris '+(i+1)+(q('[data-k=desc]')?' \u00b7 '+q('[data-k=desc]'):'');
 $('mSub').textContent=[q('[data-k=code]'),q('[data-k=paddock]')&&'Paddock '+q('[data-k=paddock]'),'Target Open '+(o!=null?nTxt(o):'\u2013'),u.querySelector('.uk2').value].filter(Boolean).join(' \u00b7 ');
 document.querySelector('.mbox').classList.toggle('real',kind==='real');
 // daftar nama material yang sudah dipakai di WO ini (untuk saran ketik)
 const names=new Set();ukRows().forEach(x=>getMats(x).forEach(m=>{if(m.mat)names.add(m.mat)}));
 $('dlMat').innerHTML=[...names].sort().map(n=>'<option value="'+esc(n)+'">').join('');
 fillCopy('m',i,kind,u=>getMats(u).filter(m=>m.mat||m.dosis),'material');
 mDraw();$('mdlg').hidden=false;
 const f=$('mTab').querySelector('input:not([readonly])');if(f)f.focus();
}
function mDraw(){
 const {kind,list}=mCur,o=openOf(mCur.i),th=$('mTab').tHead,tb=$('mTab').tBodies[0];
 const plan=kind==='plan';
 th.innerHTML=plan?'<tr><th>Material</th><th style="width:78px">Satuan</th><th style="width:90px">Dosis / ha</th><th style="width:110px">Total Kebutuhan</th><th style="width:30px"></th></tr>'
  :'<tr><th>Material</th><th style="width:110px">Kebutuhan</th><th style="width:130px">Realisasi</th></tr>';
 tb.innerHTML='';
 list.forEach((m,k)=>{
  const tr=document.createElement('tr');
  if(plan){
   tr.innerHTML='<td><input data-f="mat" list="dlMat" placeholder="Nama material" value="'+esc(m.mat)+'"></td>'+
    '<td><select data-f="sat">'+SATS.map(s=>'<option'+(s===m.sat?' selected':'')+' value="'+s+'">'+(s||'\u2013')+'</option>').join('')+'</select></td>'+
    '<td><input data-f="dosis" class="num" inputmode="decimal" placeholder="0" value="'+esc(m.dosis)+'"></td>'+
    '<td><input class="num keb" readonly tabindex="-1"></td>'+
    '<td><button type="button" class="del" title="Hapus material">&times;</button></td>';
   const upd=()=>{const d=nf(m.dosis);tr.querySelector('.keb').value=d!=null&&o!=null?withSat(nTxt(d*o),m.sat):''};
   tr.querySelectorAll('[data-f]').forEach(e=>e.addEventListener('input',()=>{m[e.dataset.f]=e.value;upd()}));
   tr.querySelector('.del').onclick=()=>{list.splice(k,1);mDraw()};
   upd();
  }else{
   tr.innerHTML='<td class="ro"><b>'+esc(m.mat||'(tanpa nama)')+'</b></td><td class="ro">'+esc(withSat(m.keb,m.sat)||'\u2013')+'</td>'+
    '<td><input data-f="real" class="num" inputmode="decimal" placeholder="'+esc(m.sat||'0')+'" value="'+esc(m.real)+'"></td>';
   tr.querySelector('input').addEventListener('input',e=>{m.real=e.target.value});
  }
  tb.appendChild(tr);
 });
 $('mTab').hidden=!list.length;
 $('mEmpty').hidden=!!list.length;
 $('mEmpty').textContent=plan?'Belum ada material. Klik "+ Tambah Material".':'Belum ada rencana material di baris ini. Isi Rencana terlebih dahulu.';
 const n=$('mNote');n.classList.toggle('warn2',plan&&o==null);
 n.textContent=plan?(o==null?'Target Open baris ini belum diisi, jadi Total Kebutuhan belum bisa dihitung.':'Total Kebutuhan = Dosis/ha \u00d7 Target Open ('+nTxt(o)+').'):'Isi jumlah material yang benar-benar terpakai di lapangan.';
 $('mOk').disabled=!plan&&!list.length;
}
function mClose(){$('mdlg').hidden=true;mCur=null}
$('mAdd').onclick=()=>{mCur.list.push({mat:'',sat:'',dosis:'',keb:'',real:''});mDraw();const ins=$('mTab').querySelectorAll('input[data-f=mat]');if(ins.length)ins[ins.length-1].focus()};
$('mCopyBtn').onclick=()=>{
 if(!mCur||mCur.kind!=='plan')return;
 const u=ukRows()[+$('mCopySel').value];if(!u)return;
 const list=mCur.list;
 for(let k=list.length-1;k>=0;k--)if(!String(list[k].mat||'').trim()&&!String(list[k].dosis||'').trim())list.splice(k,1);
 const key=m=>String(m.mat||'').trim().toLowerCase()+'|'+(m.sat||'');
 const have=new Set(list.map(key));let add=0,skip=0;
 getMats(u).filter(m=>m.mat||m.dosis).forEach(m=>{
  const c={mat:m.mat,sat:m.sat||'',dosis:m.dosis||'',keb:'',real:''};
  if(have.has(key(c))){skip++;return}
  have.add(key(c));list.push(c);add++;
 });
 mDraw();
 $('mCopyMsg').textContent=add+' material disalin'+(skip?', '+skip+' dilewati (sudah ada)':'')+'. Cek Dosis lalu Simpan.';
};
$('mX').onclick=$('mCancel').onclick=mClose;
$('mdlg').addEventListener('mousedown',e=>{if(e.target===$('mdlg'))mClose()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mCur)mClose()});
$('mOk').onclick=()=>{
 const u=ukRows()[mCur.i];if(!u)return mClose();
 const ms=mCur.list.map(m=>({mat:String(m.mat||'').trim(),sat:m.sat||'',dosis:String(m.dosis||'').trim(),keb:m.keb||'',real:String(m.real||'').trim()}))
  .filter(m=>m.mat||m.dosis||m.real);
 setMats(u,ms);mClose();calcUK();
};
// klik kolom material: Dosis/Material/Kebutuhan = Isi Rencana, Total Realisasi = Isi Realisasi (hanya mode Realisasi)
ukBody.addEventListener('click',e=>{
 const td=e.target.closest('td.mc');if(!td||!paper.classList.contains('on'))return;
 const i=ukRows().indexOf(td.parentElement);if(i<0)return;
 if(td.classList.contains('mr')){if(paper.classList.contains('real')&&getMats(ukRows()[i]).length)mOpen(i,'real');}
 else mOpen(i,'plan');
});

/* ---------- salin isi dari baris lain (pop-up Rencana Material & Rencana Unit) ---------- */
function fillCopy(p,i,kind,getter,word){
 const sel=$(p+'CopySel'),src=[];sel.innerHTML='';$(p+'CopyMsg').textContent='';
 ukRows().forEach((u,j)=>{
  if(j===i)return;const n=getter(u).length;if(!n)return;
  const sh=u.querySelector('.uk2').value;
  src.push(new Option('Baris '+(j+1)+(sh?' · '+sh:'')+' · '+n+' '+word,j));
 });
 src.forEach(o=>sel.add(o));
 $(p+'Copy').hidden=kind!=='plan'||!src.length;
}
/* ---------- unit kerja: banyak unit + implement per baris, diisi lewat pop-up ---------- */
// data per baris: [{code,impl,jlh,est, rcode,rimpl,rjlh,rhm, x}] disimpan di rows[i].units
//   code/impl/jlh/est   = RENCANA (unit, implement/gandengan, jumlah unit/opt, estimasi HM/KM/Rit)
//   rcode/rimpl/rjlh/rhm = REALISASI yang menempel pada baris rencana yang sama (boleh unit pengganti)
//   x=true              = unit DI LUAR RENCANA (hanya punya realisasi)
// kolom lama ukode/unik/unama/uest/uhk tetap diisi (ringkasan per baris) supaya Timeline/Summary/Costing/Export tetap jalan
const UE=()=>({code:'',impl:'',jlh:'',est:'',estu:'HM',rcode:'',rimpl:'',rjlh:'',rhm:'',rhmu:'HM',rout:'',ruom:'Ha',x:false});
const UT={unik:'jlh',unama:'rjlh',uest:'est',uhk:'rhm'};
const UTYPE={code:'unit',rcode:'unit',impl:'impl',rimpl:'impl'};
let umaster=null;
function loadUnitMaster(){loadUnits().then(l=>{umaster=l},()=>{umaster=null})}
function unitsFrom(r){
 if(Array.isArray(r.units))return r.units.map(e=>Object.assign(UE(),e));
 const any=['ukode','unik','unama','uest','uhk'].some(k=>String(r[k]||'').trim());
 if(!any)return[];
 const e=Object.assign(UE(),{code:String(r.ukode||'').trim(),jlh:String(r.unik||'').trim(),rjlh:String(r.unama||'').trim(),est:String(r.uest||'').trim(),rhm:String(r.uhk||'').trim()});
 if(e.code&&(e.rjlh||e.rhm))e.rcode=e.code;
 return[e];
}
const getUnits=u=>{try{return JSON.parse((u&&u.dataset.units)||'[]')}catch(e){return[]}};
function unitsOut(us){
 const sm=k=>{let t=0,any=false;us.forEach(e=>{const x=nf(e[k]);if(x!=null){t+=x;any=true}});return any?nTxt(t):''};
 return{units:us,ukode:us.map(e=>e.code||e.rcode).filter(Boolean).join(' + '),unik:sm('jlh'),unama:sm('rjlh'),uest:sm('est'),uhk:sm('rhm')};
}
function setUnits(u,us){
 u.dataset.units=JSON.stringify(us);
 const c=u.querySelectorAll('td.uc'),col=[[],[],[],[],[]];let anyR=false;
 us.forEach(e=>{
  const pl=e.x?['(luar rencana)']:[e.code||(e.impl?'–':'')].concat(e.impl?['↳ '+e.impl]:[]);
  const hasR=!!(e.rcode||e.rimpl||e.rjlh||e.rhm||e.rout);if(hasR)anyR=true;
  const rl=hasR?[(e.rcode||'–')+(e.rjlh!==''?' × '+e.rjlh:'')].concat(e.rimpl?['↳ '+e.rimpl]:[]):[];
  const n=Math.max(pl.length,rl.length,1),pad=a=>{while(a.length<n)a.push('');return a};
  col[0].push(...pad(pl));col[1].push(...pad([e.x?'':e.jlh]));col[2].push(...pad(rl));col[3].push(...pad([e.x||e.est===''?'':e.est+' '+(e.estu||'HM')]));col[4].push(...pad([[e.rhm!==''?e.rhm+' '+(e.rhmu||'HM'):'',e.rout!==''?e.rout+' '+(e.ruom||'Ha'):''].filter(Boolean).join(' \u00b7 ')]));
 });
 const tx=a=>a.map(x=>x===''||x==null?' ':x).join('\n');
 c[0].textContent=us.length?tx(col[0]):'';
 c[1].textContent=us.length?tx(col[1]):'';
 c[2].textContent=anyR?tx(col[2]):'';
 c[3].textContent=us.length?tx(col[3]):'';
 c[4].textContent=anyR?tx(col[4]):'';
}
let uCur=null;   // {i, kind:'plan'|'real', list:[...]}
function uOpen(i,kind){
 const u=ukRows()[i],tr=opRows()[i];if(!u||!tr)return;
 const plan=kind==='plan',list=getUnits(u).map(e=>Object.assign(UE(),e));
 if(plan&&!list.some(e=>!e.x))list.unshift(UE());
 uCur={i:i,kind:kind,list:list};
 const q=s=>tr.querySelector(s).value.trim(),o=openOf(i);
 $('uKind').textContent=plan?'Rencana Unit':'Realisasi Unit';
 $('uTitle').textContent='Baris '+(i+1)+(q('[data-k=desc]')?' · '+q('[data-k=desc]'):'');
 $('uSub').textContent=[q('[data-k=code]'),q('[data-k=paddock]')&&'Paddock '+q('[data-k=paddock]'),'Target Open '+(o!=null?nTxt(o):'–'),u.querySelector('.uk2').value].filter(Boolean).join(' · ');
 document.querySelector('.ubox').classList.toggle('real',!plan);
 const opt=t=>umaster?unitsOf(umaster,t,!plan).map(it=>'<option value="'+esc(it.code)+'"'+(it.active?'':' label="nonaktif"')+'>').join(''):'';
 $('dlUnit').innerHTML=opt('unit');$('dlImpl').innerHTML=opt('impl');
 $('uAdd').textContent=plan?'+ Tambah Unit':'+ Tambah Unit di Luar Rencana';
 $('uNote').textContent=plan
  ?'Jlh Unit/Opt = jumlah unit/operator. Est = perkiraan HM/KM/Rit. Implement boleh dikosongkan. Pilih dari saran agar sesuai Master Unit.'
  :'Kolom "Aktual" yang dikosongkan dianggap sama dengan rencana (cukup isi HM/Rit). Output + UOM (Ha / m / rit): total Output ber-UOM Ha mengisi kolom Close baris ini secara otomatis (Close masih bisa diubah manual). Isi Unit/Implement aktual jika diganti; ketik "-" pada Implement jika tidak memakai implement. Unit yang tidak ada di rencana: klik "+ Tambah Unit di Luar Rencana".';
 fillCopy('u',i,kind,u=>getUnits(u).filter(e=>!e.x&&(e.code||e.impl)),'unit');
 uDraw();$('udlg').hidden=false;
 const f=$('uTab').querySelector('input');if(f)f.focus();
}
function uDraw(){
 const {kind,list}=uCur,plan=kind==='plan',th=$('uTab').tHead,tb=$('uTab').tBodies[0];
 th.innerHTML=plan
  ?'<tr><th>Kode Unit</th><th>Implement / Gandengan</th><th style="width:76px">Jlh Unit/Opt</th><th style="width:84px">Est</th><th style="width:74px">UOM</th><th style="width:30px"></th></tr>'
  :'<tr><th style="width:150px">Rencana</th><th>Unit Aktual</th><th>Implement Aktual</th><th style="width:56px">Jlh</th><th style="width:78px">HM/Rit</th><th style="width:72px">UOM</th><th style="width:84px">Output</th><th style="width:74px">UOM</th><th style="width:30px"></th></tr>';
 tb.innerHTML='';
 let shown=0;
 const sel=(f,val,o,d)=>'<td><select data-f="'+f+'">'+o.map(s=>'<option'+(s===(val||d)?' selected':'')+'>'+s+'</option>').join('')+'</select></td>';
 const fld=(f,val,ph,dl,num)=>'<td><input data-f="'+f+'"'+(dl?' list="'+dl+'" autocomplete="off"':'')+(num?' class="num" inputmode="decimal"':'')+' placeholder="'+esc(ph)+'" value="'+esc(val)+'"></td>';
 list.forEach((m,k)=>{
  if(plan&&m.x)return;
  shown++;
  const tr=document.createElement('tr');
  if(plan){
   tr.innerHTML=fld('code',m.code,'Kode unit','dlUnit')+fld('impl',m.impl,'Implement','dlImpl')+fld('jlh',m.jlh,'1','',1)+fld('est',m.est,'0','',1)+sel('estu',m.estu,['HM','KM','Rit'],'HM')+'<td><button type="button" class="del" title="Hapus unit">&times;</button></td>';
  }else{
   const lab=m.x?'<i>Di luar rencana</i>':'<b>'+esc(m.code||'–')+'</b>'+(m.impl?'<br><span class="msub">↳ '+esc(m.impl)+'</span>':'')+((m.jlh||m.est)?'<br><span class="msub">'+esc([m.jlh&&m.jlh+' unit',m.est&&'Est '+m.est].filter(Boolean).join(' · '))+'</span>':'');
   tr.innerHTML='<td class="ro">'+lab+'</td>'+fld('rcode',m.rcode,m.x?'Kode unit':(m.code||'Kode unit'),'dlUnit')+fld('rimpl',m.rimpl,m.x?'Implement':(m.impl||'Implement'),'dlImpl')+fld('rjlh',m.rjlh,m.x?'1':(m.jlh||'1'),'',1)+fld('rhm',m.rhm,'0','',1)+sel('rhmu',m.rhmu,['HM','KM','Rit'],'HM')+fld('rout',m.rout,'0','',1)+'<td><select data-f="ruom">'+['Ha','m','rit'].map(s=>'<option'+(s===(m.ruom||'Ha')?' selected':'')+'>'+s+'</option>').join('')+'</select></td><td>'+(m.x?'<button type="button" class="del" title="Hapus unit">&times;</button>':'')+'</td>';
  }
  const chk=(e,fix)=>{
   const t=UTYPE[e.dataset.f];if(!t||!umaster)return;
   const v=e.value.trim(),hit=v&&v!=='-'?getUnit(umaster,v,t):null;
   if(hit&&fix&&hit.code!==e.value){e.value=hit.code;m[e.dataset.f]=hit.code}
   const bad=!!v&&v!=='-'&&!hit;e.classList.toggle('bad',bad);e.title=bad?'Tidak ada di Master Unit (tetap bisa disimpan)':'';
  };
  tr.querySelectorAll('input[data-f]').forEach(e=>{
   e.addEventListener('input',()=>{
    m[e.dataset.f]=e.value;
    if(plan&&e.dataset.f==='code'&&e.value.trim()&&!String(m.jlh).trim()){m.jlh='1';tr.querySelector('[data-f=jlh]').value='1'}
    chk(e,false);
   });
   e.addEventListener('change',()=>chk(e,true));
   chk(e,false);
  });
  tr.querySelectorAll('select[data-f]').forEach(s=>s.addEventListener('change',()=>{m[s.dataset.f]=s.value}));
  const del=tr.querySelector('.del');
  if(del)del.onclick=()=>{
   if(plan&&(m.rcode||m.rimpl||m.rjlh||m.rhm||m.rout)&&!confirm('Unit ini sudah punya realisasi. Hapus beserta realisasinya?'))return;
   list.splice(k,1);uDraw();
  };
  tb.appendChild(tr);
 });
 $('uTab').hidden=!shown;$('uEmpty').hidden=!!shown;
 $('uEmpty').textContent=plan?'Belum ada unit. Klik "+ Tambah Unit".':'Belum ada rencana unit di baris ini. Tambahkan unit yang dipakai di lapangan.';
}
function uClose(){$('udlg').hidden=true;uCur=null}
$('uAdd').onclick=()=>{
 const x=uCur.kind==='real';uCur.list.push(Object.assign(UE(),{x:x}));uDraw();
 const rows=$('uTab').tBodies[0].rows,l=rows[rows.length-1];const f=l&&l.querySelector('input');if(f)f.focus();
};
$('uCopyBtn').onclick=()=>{
 if(!uCur||uCur.kind!=='plan')return;
 const u=ukRows()[+$('uCopySel').value];if(!u)return;
 const list=uCur.list;
 for(let k=list.length-1;k>=0;k--){const e=list[k];if(!e.x&&!String(e.code||'').trim()&&!String(e.impl||'').trim()&&!String(e.jlh||'').trim()&&!String(e.est||'').trim())list.splice(k,1)}
 const key=e=>(String(e.code||'').trim()+'|'+String(e.impl||'').trim()).toLowerCase();
 const have=new Set(list.filter(e=>!e.x).map(key));let add=0,skip=0;
 getUnits(u).filter(e=>!e.x&&(e.code||e.impl)).forEach(e=>{
  const c=Object.assign(UE(),{code:e.code,impl:e.impl,jlh:e.jlh,est:e.est,estu:e.estu||'HM'});
  if(have.has(key(c))){skip++;return}
  have.add(key(c));list.splice(list.findIndex(x=>x.x)<0?list.length:list.findIndex(x=>x.x),0,c);add++;
 });
 uDraw();
 $('uCopyMsg').textContent=add+' unit disalin'+(skip?', '+skip+' dilewati (sudah ada)':'')+'. Cek Jlh/Est lalu Simpan.';
};
$('uX').onclick=$('uCancel').onclick=uClose;
$('udlg').addEventListener('mousedown',e=>{if(e.target===$('udlg'))uClose()});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&uCur)uClose()});
$('uOk').onclick=()=>{
 const u=ukRows()[uCur.i];if(!u)return uClose();
 const t=s=>String(s==null?'':s).trim();
 let out=[];
 if(uCur.kind==='plan'){
  const pl=uCur.list.filter(e=>!e.x).map(e=>Object.assign({},e,{code:t(e.code),impl:t(e.impl),jlh:t(e.jlh),est:t(e.est),estu:e.estu||'HM'})).filter(e=>e.code||e.impl||e.jlh||e.est);
  out=pl.concat(uCur.list.filter(e=>e.x));
 }else{
  uCur.list.forEach(e=>{
   const n=Object.assign({},e,{rcode:t(e.rcode),rimpl:t(e.rimpl),rjlh:t(e.rjlh),rhm:t(e.rhm),rout:t(e.rout),ruom:e.ruom||'Ha',rhmu:e.rhmu||'HM'});
   const has=n.rcode||n.rimpl||n.rjlh||n.rhm||n.rout;
   if(e.x){if(has){if(n.rcode&&!n.rjlh)n.rjlh='1';out.push(n)}return}
   if(has){n.rcode=n.rcode||n.code;n.rimpl=n.rimpl==='-'?'':(n.rimpl||n.impl);n.rjlh=n.rjlh||n.jlh||'1'}
   else{n.rcode=n.rimpl=n.rjlh=n.rhm=n.rout=''}
   out.push(n);
  });
 }
 setUnits(u,out);const ri=uCur.i,rk=uCur.kind;uClose();calcUK();
 if(rk==='real')autoClose(ri);
};
// Close (Operation) otomatis = jumlah Output unit ber-UOM Ha pada baris yang sama. Tetap bisa diketik/diubah manual.
function autoClose(i){
 const tr=opRows()[i],u=ukRows()[i];if(!tr||!u)return;
 let s=0,any=false;
 getUnits(u).forEach(e=>{if((e.ruom||'Ha')==='Ha'){const x=nf(e.rout);if(x!=null){s+=x;any=true}}});
 if(!any)return;
 const ci=tr.querySelector('.close');if(!ci||ci.disabled)return;
 const val=nTxt(s);
 if(ci.value!==val){ci.value=val;calc();toast('Close baris '+(i+1)+' terisi otomatis: '+val+' Ha (dari output unit)')}
}
// klik kolom Unit: Kode/Jlh Unit/Est = Isi Rencana; Realisasi Unit/HM = Isi Realisasi (hanya mode Realisasi)
ukBody.addEventListener('click',e=>{
 const td=e.target.closest('td.uc');if(!td||!paper.classList.contains('on'))return;
 const i=ukRows().indexOf(td.parentElement);if(i<0)return;
 if(td.classList.contains('ucr')||td.classList.contains('ucv')){if(paper.classList.contains('real'))uOpen(i,'real')}
 else uOpen(i,'plan');
});
// peringatan (tidak memblokir) jika ada unit / implement yang tidak ada di Master Unit
function unitWarn(){
 if(!umaster)return '';
 const bad=[];
 ukRows().forEach((u,i)=>{if(getUnits(u).some(e=>[[e.code,'unit'],[e.rcode,'unit'],[e.impl,'impl'],[e.rimpl,'impl']].some(p=>p[0]&&!getUnit(umaster,p[0],p[1]))))bad.push(i+1)});
 return bad.length?'Unit / Implement tidak ada di Master Unit pada baris: '+bad.join(', ')+'.':'';
}
function warnAll(){
 const a=[opWarn().replace(/\nTetap simpan\?$/,''),unitWarn()].filter(Boolean);
 return a.length?a.join('\n')+'\nTetap simpan?':'';
}

/* ---------- master paddock: autocomplete + luas otomatis ---------- */
const nk=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
const numStr=n=>n==null?'':String(Math.round(n*10000)/10000).replace('.',',');
function nameMatch(q){const k=nk(q);if(!k)return[];const ex=master.filter(it=>nk(it.paddock)===k);return ex.length?ex:master.filter(it=>nk(it.paddock).includes(k))}
function cand(q){let r=searchPaddocks(master,q);if(!r.length)r=nameMatch(q);return r}
function resolvePad(tr){
 const inp=tr.querySelector('[data-k=paddock]'),lu=tr.querySelector('.luas'),val=inp.value.trim();
 inp.classList.remove('bad');inp.title='';
 if(!master)return;
 if(!val){lu.value='';return}
 let it=getPaddock(master,val);
 if(!it){const m=nameMatch(val);if(m.length===1)it=m[0]}   // koreksi otomatis jika hanya 1 paddock yang cocok
 if(it){inp.value=it.paddock;lu.value=numStr(it.luas)}
 else{inp.classList.add('bad');inp.title='Paddock tidak ditemukan di master';lu.value=''}
}
/* ---------- master Op Code / Desc: saling mengisi ---------- */
function setOp(tr,it){
 const ci=tr.querySelector('[data-k=code]'),di=tr.querySelector('[data-k=desc]');
 ci.value=it.code;di.value=it.desc;di.title=it.desc;
 ci.classList.remove('bad');di.classList.remove('bad');ci.title='';
}
function resolveOp(tr,from){
 const ci=tr.querySelector('[data-k=code]'),di=tr.querySelector('[data-k=desc]');
 ci.classList.remove('bad');di.classList.remove('bad');ci.title='';di.title=di.value;
 if(!ops)return;
 const cv=ci.value.trim(),dv=di.value.trim();
 let it=null;
 if(from==='code'){
  if(!cv)return;
  it=getOpByCode(ops,cv);
  if(!it){const m=opsList().filter(o=>o.code.includes(cv));if(m.length===1)it=m[0]}   // koreksi otomatis jika hanya 1 yang cocok
  if(it){setOp(tr,it);deptCheck(tr);return}
  ci.classList.add('bad');ci.title='Op Code tidak ada di master';
 }else{
  if(!dv)return;
  const L=opsList();
  it=getOpByDesc(L,dv)||getOpByDesc(ops,dv);
  if(!it){const m=searchOps(L,dv);if(m.length===1)it=m[0]}
  if(it){setOp(tr,it);deptCheck(tr);return}
  di.classList.add('bad');di.title='Desc tidak ada di master';
 }
}
/* ---------- Op Code per Department ---------- */
const deptVal=()=>normDept(S()[2].value);
const deptOn=()=>OP_DEPTS.includes(deptVal());
const opsList=()=>ops?opsForDept(ops,deptVal()):[];      // aktif + sesuai Department di header
// tandai Op Code milik department lain / sudah nonaktif (tidak memblokir)
function deptMsg(tr){
 if(!ops)return '';
 const it=getOpByCode(ops,tr.querySelector('[data-k=code]').value.trim());
 if(!it)return '';
 if(deptOn()&&it.dept&&it.dept!==deptVal())return 'Op Code ini milik '+it.dept;
 if(!it.active)return 'Op Code ini sudah nonaktif di master';
 return '';
}
function deptCheck(tr){
 const ci=tr.querySelector('[data-k=code]'),m=deptMsg(tr);
 if(ci.classList.contains('bad')&&!ci.dataset.dw)return;
 ci.classList.toggle('bad',!!m);ci.title=m;if(m)ci.dataset.dw='1';else delete ci.dataset.dw;
}
S()[2].addEventListener('change',()=>opRows().forEach(deptCheck));
// peringatan (tidak memblokir) jika ada Op Code / Desc yang tidak ada di master, mis. WO lama
function opWarn(){
 if(!ops)return '';
 const bad=[],oth=[];
 opRows().forEach((tr,i)=>{
  const c=tr.querySelector('[data-k=code]').value.trim(),d=tr.querySelector('[data-k=desc]').value.trim();
  if((c&&!getOpByCode(ops,c))||(d&&!getOpByDesc(ops,d)))bad.push(i+1);
  else if(c&&deptMsg(tr))oth.push(i+1);
 });
 const m=[];
 if(bad.length)m.push('Op Code / Desc tidak ada di master pada baris: '+bad.join(', ')+'.');
 if(oth.length)m.push('Op Code bukan milik '+(deptOn()?deptVal():'department ini')+' atau sudah nonaktif pada baris: '+oth.join(', ')+'.');
 return m.length?m.join('\n')+'\nTetap simpan?':'';
}

/* ---------- dropdown saran (dipakai Paddock, Op Code, dan Desc) ---------- */
const ac=document.createElement('div');ac.id='ac';ac.hidden=true;document.body.appendChild(ac);
let acIn=null,acKind=null,acItems=[],acIdx=0;
const AC={
 paddock:{ready:()=>!!master,find:cand,onFocus:true,w:260,none:'Tidak ada paddock yang cocok',
  label:it=>[it.paddock,[it.varietas,it.luas!=null?fmtLuas(it.luas)+' Ha':''].filter(Boolean).join(' \u00b7 ')],
  pick:(tr,it)=>{tr.querySelector('[data-k=paddock]').value=it.paddock;resolvePad(tr)}},
 code:{ready:()=>!!ops,find:q=>searchOps(opsList(),q),w:440,none:()=>'Tidak ada Op Code yang cocok'+(deptOn()?' di '+deptVal():''),label:it=>[it.code,deptOn()?it.desc:it.desc+(it.dept?' \u00b7 '+it.dept.replace(/^Agri - /,''):'')],pick:(tr,it)=>{setOp(tr,it);deptCheck(tr)}},
 desc:{ready:()=>!!ops,find:q=>searchOps(opsList(),q),w:440,none:()=>'Tidak ada Desc yang cocok'+(deptOn()?' di '+deptVal():''),label:it=>[it.desc,it.code],pick:(tr,it)=>{setOp(tr,it);deptCheck(tr)}}
};
const acHide=()=>{ac.hidden=true;acIn=null;acKind=null};
const acPaint=()=>[...ac.querySelectorAll('.it')].forEach((el,i)=>el.classList.toggle('on',i===acIdx));
function acShow(inp){
 const kind=inp.dataset.k,cfg=AC[kind],q=inp.value.trim();
 if(!cfg||!cfg.ready()||!q){acHide();return}
 const all=cfg.find(q);acItems=all.slice(0,8);acIdx=0;acIn=inp;acKind=kind;
 ac.textContent='';
 if(!acItems.length){const n=document.createElement('div');n.className='more';n.textContent=typeof cfg.none==='function'?cfg.none():cfg.none;ac.appendChild(n)}
 acItems.forEach((it,i)=>{
  const d=document.createElement('div');d.className='it';d.dataset.i=i;
  const lb=cfg.label(it),b=document.createElement('b');b.textContent=lb[0];
  const sp=document.createElement('span');sp.textContent=lb[1];
  d.append(b,sp);ac.appendChild(d);
 });
 if(all.length>8){const n=document.createElement('div');n.className='more';n.textContent='+'+(all.length-8)+' lainnya, ketik lebih spesifik';ac.appendChild(n)}
 const r=inp.getBoundingClientRect();
 ac.hidden=false;
 ac.style.minWidth=Math.min(Math.max(r.width,cfg.w),innerWidth-8)+'px';
 ac.style.left=Math.max(4,Math.min(r.left,innerWidth-ac.offsetWidth-4))+'px';
 ac.style.top=(r.bottom+2)+'px';
 acPaint();
}
function acPick(it){
 if(!acIn||!it)return;
 const tr=acIn.closest('tr'),cfg=AC[acKind];
 cfg.pick(tr,it);acHide();calc();
}
ac.addEventListener('mousedown',e=>{e.preventDefault();const el=e.target.closest('.it');if(el)acPick(acItems[+el.dataset.i])});
addEventListener('scroll',acHide,true);addEventListener('resize',acHide);

opEl.addEventListener('input',e=>{
 const k=e.target.dataset.k;
 if(AC[k]){
  const tr=e.target.closest('tr');
  // kolom pasangannya dikosongkan; akan terisi lagi otomatis saat pilihan sudah benar
  if(k==='paddock'&&master)tr.querySelector('.luas').value='';
  if(k==='code'&&ops)tr.querySelector('[data-k=desc]').value='';
  if(k==='desc'&&ops){tr.querySelector('[data-k=code]').value='';e.target.title=e.target.value}
  acShow(e.target);
 }
 calc();
});
opEl.addEventListener('focusin',e=>{
 const k=e.target.dataset.k;
 if(!AC[k])return;
 e.target._fv=e.target.value;
 if(AC[k].onFocus)acShow(e.target);
});
opEl.addEventListener('focusout',e=>{
 const k=e.target.dataset.k;
 if(!AC[k])return;
 const tr=e.target.closest('tr');
 acHide();
 if(k==='paddock')resolvePad(tr);
 else if(e.target.value!==e.target._fv)resolveOp(tr,k);   // hanya jika diubah, agar data lama tidak tersentuh
 calc();
});
opEl.addEventListener('keydown',e=>{
 if(!AC[e.target.dataset.k]||ac.hidden)return;
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){
  e.preventDefault();
  if(acItems.length){acIdx=(acIdx+(e.key==='ArrowDown'?1:-1)+acItems.length)%acItems.length;acPaint()}
 }else if(e.key==='Enter'){if(acItems[acIdx]){e.preventDefault();acPick(acItems[acIdx])}}
 else if(e.key==='Escape')acHide();
});
// Keterangan boleh diedit asalkan formatnya: Shift 1/2/3 - tanggal bulan [tahun]
const MKEY={agt:7,ags:7};
MONTH.forEach((m,i)=>{MKEY[m.toLowerCase()]=i});MON.forEach((m,i)=>{MKEY[m.toLowerCase()]=i});
function parseKet(t){
 t=t.trim();
 if(!t)return{shift:'',date:''};
 const m=/^shift\s*([123])\s*-\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?$/i.exec(t);
 if(!m)return null;
 const mo=MKEY[m[3].toLowerCase()];if(mo==null)return null;
 const d=+m[2],y=m[4]?+m[4]:(dParts(startEl.value)||{y:new Date().getFullYear()}).y,dt=new Date(y,mo,d);
 if(dt.getFullYear()!==y||dt.getMonth()!==mo||dt.getDate()!==d)return null;
 const p=n=>String(n).padStart(2,'0');
 return{shift:m[1],date:y+'-'+p(mo+1)+'-'+p(d)};
}
opBody.addEventListener('change',e=>{
 const t=e.target;
 if(t.classList.contains('ket')){
  const tr=t.closest('tr'),r=parseKet(t.value);
  if(!r)alert('Format Keterangan tidak sesuai.\nContoh: Shift 1 - 17 November 2026\n(Shift 1/2/3, tanggal, nama bulan, tahun)');
  else{tr.querySelector('.sh').value=r.shift;tr.dataset.date=r.date&&r.date!==startEl.value?r.date:''}
  sync();
 }else if(t.classList.contains('sh'))sync();
});

function warnUpdate(){
 const m=[];
 if(padFail)m.push('Master paddock tidak bisa dimuat. Luas Area diisi manual dan paddock tidak divalidasi.');
 if(opsFail)m.push('Master Op Code (operation.csv) tidak bisa dimuat. Op Code dan Desc diisi manual.');
 $('mwarn').textContent=m.join(' ');$('mwarn').hidden=!m.length;
}
function loadMaster(){
 loadPaddocks().then(l=>{
  master=l;luasRO=true;padFail=false;
  opEl.querySelectorAll('.luas').forEach(e=>{e.readOnly=true});
  warnUpdate();
  if(me&&cur.mode!=='view')opRows().forEach(tr=>{
   if(tr.querySelector('[data-k=paddock]').value.trim()&&!tr.querySelector('.luas').value)resolvePad(tr);
  });
  calc();
 },()=>{
  master=null;luasRO=false;padFail=true;
  opEl.querySelectorAll('.luas').forEach(e=>{e.readOnly=false});
  warnUpdate();
 });
}
function loadOpsMaster(){
 loadOps().then(l=>{ops=l;opsFail=false;warnUpdate();opRows().forEach(deptCheck)},()=>{ops=null;opsFail=true;warnUpdate()});
}

/* ---------- tambah / hapus baris ---------- */
$('bAdd').onclick=()=>{
 if(opRows().length>=MAXR){alert('Maksimal '+MAXR+' baris.');return}
 const o=mkRow();renum();sync();calc();lock();
 o.scrollIntoView({block:'nearest'});o.querySelector('[data-k=code]').focus();
};
$('bDel').onclick=()=>{
 const n=opRows().length;
 if(n<=1){alert('Minimal 1 baris.');return}
 const i=sel>=0&&sel<n?sel:n-1,tr=opRows()[i],ur=ukRows()[i],mr=mpRows()[i];
 const has=[tr,ur,mr].some(t=>[...t.querySelectorAll('[data-k]')].some(e=>e.value))||tr.querySelector('.sh').value||getUnits(ur).length||getMats(ur).length;
 if(has&&!confirm('Hapus baris '+(i+1)+' beserta isinya (Operation, Unit Kerja, dan Man Power Support)?'))return;
 tr.remove();ur.remove();mr.remove();sel=-1;renum();calc();
};
paper.addEventListener('click',e=>{
 const td=e.target.closest('td.n');
 if(!td||!paper.classList.contains('on'))return;
 const tr=td.parentNode;
 let i=opRows().indexOf(tr);if(i<0)i=ukRows().indexOf(tr);if(i<0)i=mpRows().indexOf(tr);
 if(i<0)return;
 sel=sel===i?-1:i;markSel();
});

/* ---------- simpan / muat data ---------- */
function collect(){
 const ur=ukRows(),mr=mpRows();
 return{
  s:S().map(e=>e.type==='checkbox'?e.checked:e.value),
  rows:opRows().map((tr,i)=>{
   const o={};
   [tr,ur[i],mr[i]].forEach(t=>t.querySelectorAll('[data-k]').forEach(e=>{o[e.dataset.k]=e.value}));
   o.shift=tr.querySelector('.sh').value;
   Object.assign(o,matsOut(getMats(ur[i])));
   Object.assign(o,unitsOut(getUnits(ur[i])));
   o.date=tr.dataset.date||'';
   return o;
  })
 };
}
// WO lama (format array "f") dikonversi agar tetap bisa dibuka
function fromLegacy(f){
 f=f||[];const g=i=>f[i]==null?'':f[i],full=f.length>=290;
 const s=f.slice(0,7);if(full)s.push(...f.slice(202,290));
 const ops=[];
 if(f.length>=52)for(let j=0;j<5;j++){const b=7+j*9;ops.push({code:g(b),desc:g(b+1),paddock:g(b+2),luas:g(b+3),hk:g(b+4),uom:g(b+5),open:g(b+6),close:g(b+7),shift:(/shift\s*([123])/i.exec(String(g(b+8)))||[])[1]||''})}
 const uk=[];
 if(full)for(let i=0;i<15;i++){const b=52+i*10;uk.push({ukode:g(b),unik:g(b+1),unama:g(b+2),uest:g(b+3),uhk:g(b+4),vnik:g(b+6),vnama:g(b+7),vest:g(b+8),vhk:g(b+9)})}
 let n=5;uk.forEach((u,i)=>{if(Object.values(u).some(Boolean))n=Math.max(n,i+1)});
 const rows=[];for(let i=0;i<n;i++)rows.push(Object.assign({},ops[i],uk[i]));
 return{s:s,rows:rows};
}
// Format v2 / lama: Man Power Support ada di array s (indeks 7-86). Format v3: Man Power ikut di setiap baris.
function upgrade(d){
 const s=(d&&d.s)||[],rows=((d&&d.rows)||[]).map(r=>Object.assign({},r));
 if(s.length<95)return{s:s,rows:rows};
 const mp=s.slice(7,87);let n=rows.length;
 for(let i=0;i<10;i++)if(mp.slice(i*8,i*8+8).some(Boolean))n=Math.max(n,i+1);
 while(rows.length<n)rows.push({});
 for(let i=0;i<10&&i<rows.length;i++){const b=i*8;
  Object.assign(rows[i],{mnik:mp[b],mnama:mp[b+1],mjab:mp[b+2],mhk:mp[b+3],pnik:mp[b+4],pnama:mp[b+5],pjab:mp[b+6],phk:mp[b+7]});
 }
 return{s:s.slice(0,7).concat(s.slice(87)),rows:rows};
}
const norm=x=>x.v===3?x:(x.v===2?upgrade(x):(x.f?upgrade(fromLegacy(x.f)):null));
function apply(d){
 const s=d&&d.s;
 S().forEach((e,i)=>{const x=s?s[i]:undefined;if(e.type==='checkbox')e.checked=!!x;else e.value=x==null?(e.defaultValue||''):x});
 $('mandor2').value=(d&&d.mandor2)||'';
 opRows().forEach(tr=>tr.remove());ukBody.innerHTML='';mpBody.innerHTML='';sel=-1;
 const rows=d&&d.rows&&d.rows.length?d.rows:[{},{},{},{},{}];
 rows.forEach(r=>mkRow(r));
 renum();sync();calc();
 if(ops)opRows().forEach(deptCheck);
}

/* ---------- kunci form: Forecast Start wajib diisi pertama ---------- */
// mode: plan = buat/ubah rencana (kolom Close terkunci), real = realisasi (semua bisa diubah, termasuk Close & tambah baris), view = hanya lihat
function lock(){
 const edit=cur.mode!=='view',real=cur.mode==='real',ready=!!startEl.value;
 paper.classList.toggle('ro',!edit);
 paper.classList.toggle('on',edit&&ready);
 paper.classList.toggle('real',real);
 paper.querySelectorAll('input,select').forEach(e=>{
  e.disabled=!edit||(!ready&&e!==startEl)||(!real&&e.classList.contains('close'));
 });
 startEl.classList.toggle('need',edit&&!ready);
 $('hint').hidden=!(edit&&!ready);
 ctlRow.hidden=!(edit&&ready);
 endEl.min=startEl.value||'';
}
['input','change'].forEach(t=>startEl.addEventListener(t,()=>{lock();sync()}));

function validate(){
 if(!startEl.value)return 'Isi Forecast Start terlebih dahulu.';
 if(master){
  const bad=[];
  opRows().forEach((tr,i)=>{const p=tr.querySelector('[data-k=paddock]').value.trim();if(p&&!getPaddock(master,p))bad.push(i+1)});
  if(bad.length)return 'Paddock tidak ada di master pada baris: '+bad.join(', ')+'.\nPilih dari daftar saran atau perbaiki penulisannya.';
 }
 return '';
}

onAuthStateChanged(auth,async u=>{
 if(!u){location.replace('index.html');return}
 try{
  const c=await connect(u.uid);db=c.db;const d=c.snap;
  if(!d.exists()){await signOut(auth);return}
  me={uid:u.uid,...d.data()};
  $('who').textContent=(me.nama||u.email)+' ('+me.role+')';
  $('bNew').hidden=!isR('mandor');
  loadList().finally(()=>{loadMaster();loadOpsMaster();loadUnitMaster()});   // daftar tampil dulu, master CSV menyusul
 }catch(e){$('ld').hidden=false;$('ld').textContent='Gagal terhubung: '+(e.code||e.message)+'. Kembali ke Beranda lalu login ulang.'}
});
$('bHome').onclick=()=>{location.href='index.html'};
$('bOut').onclick=()=>signOut(auth);
$('bList').onclick=()=>loadList();

/* ---------- daftar WO ---------- */
const stOf=x=>x.status==='closed'?'closed':'open';            // status lama (draft/dibuat/dst) dianggap open
const rowsOfDoc=x=>x.v>=2?(x.rows||[]):(x.f?fromLegacy(x.f).rows:[]);
const startOfDoc=x=>x.v>=2?((x.s&&x.s[iStart])||''):((x.f&&x.f[5])||'');
const descsOf=x=>[...new Set(rowsOfDoc(x).map(r=>String(r.desc||'').trim().replace(/\s*-\s*\d{5,}$/,'')).filter(Boolean))];   // buang kode di belakang desc
const shortDesc=ds=>{const f=ds[0].length>30?ds[0].slice(0,30).trimEnd()+'\u2026':ds[0];return ds.length>1?f+' (+'+(ds.length-1)+')':f};
const dFull=s=>{const p=dParts(s);return p?p.d+' '+MON[p.m]+' '+p.y:''};
const todayStr=()=>{const d=new Date(),p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())};
function toast(t){const e=$('toast');e.textContent=t;e.hidden=false;clearTimeout(toast.t);toast.t=setTimeout(()=>{e.hidden=true},2200)}

/* ---------- daftar WO + filter Department & tanggal ---------- */
const DEPTS=['Agri - Land Development','Agri - Upkeep & Manuring','Agri - Planting','Agri - Road & Drainage Maintenance','Agri - Seed Planting'];
const FKEY='woListFilter';
let listDocs=[],flt={dept:'',from:'',to:''};
try{Object.assign(flt,JSON.parse(localStorage.getItem(FKEY)||'{}'))}catch(e){}
const ymd=d=>{const p=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())};
const deptOf=x=>String(x.divisi||'').trim();
function saveFlt(){try{localStorage.setItem(FKEY,JSON.stringify(flt))}catch(e){}}
function passDate(x){const s=startOfDoc(x)||'';if(!flt.from&&!flt.to)return true;if(!s)return false;return(!flt.from||s>=flt.from)&&(!flt.to||s<=flt.to)}
function renderChips(){
 const box=$('fDept');box.innerHTML='';
 const base=listDocs.filter(d=>passDate(d.x));
 const extra=[...new Set(listDocs.map(d=>deptOf(d.x)).filter(v=>v&&!DEPTS.includes(v)))].sort();
 const opts=[['','Semua']].concat(DEPTS.map(v=>[v,v.replace(/^Agri - /,'')]),extra.map(v=>[v,v]));
 if(listDocs.some(d=>!deptOf(d.x)))opts.push(['-','Tanpa department']);
 opts.forEach(([v,lb])=>{
  const n=base.filter(d=>v===''||(v==='-'?!deptOf(d.x):deptOf(d.x)===v)).length;
  const b=document.createElement('button');b.type='button';b.title=v&&v!=='-'?v:'';
  b.className=flt.dept===v?'on':'';b.append(lb);
  const c=document.createElement('span');c.className='ct';c.textContent=n;b.appendChild(c);
  b.onclick=()=>{flt.dept=v;saveFlt();refilter()};box.appendChild(b);
 });
}
function renderList(){
 $('fFrom').value=flt.from;$('fTo').value=flt.to;
 $('fFrom').classList.toggle('has',!!flt.from);$('fTo').classList.toggle('has',!!flt.to);
 $('fTo').min=flt.from||'';$('fFrom').max=flt.to||'';
 renderChips();
 const q=quickNow();$('fQuick').querySelectorAll('button').forEach(b=>b.classList.toggle('on',q===b.dataset.q));
 const tb=document.querySelector('#lt tbody');tb.innerHTML='';
 const rows=listDocs.filter(passF);
 const active=!!(flt.dept||flt.from||flt.to);
 $('fReset').disabled=!active;
 $('fCount').textContent=(active?'Menampilkan '+rows.length+' dari '+listDocs.length:listDocs.length)+(more?'+':'')+' WO';
 $('lMore').hidden=!more;
 if(listDocs.length&&!rows.length){const tr=document.createElement('tr');tr.className='empty';tr.innerHTML='<td colspan="7">Tidak ada WO yang cocok dengan filter.</td>';tb.appendChild(tr)}
 rows.forEach(({id,x})=>{
   const st=stOf(x),tr=document.createElement('tr');
   const cell=t=>{const c=document.createElement('td');if(t!=null)c.textContent=t;tr.appendChild(c);return c};
   const c0=cell(),b=document.createElement('b');b.textContent=x.no||'(tanpa nomor)';c0.appendChild(b);
   const ds=descsOf(x);if(ds.length){c0.append(' - '+shortDesc(ds));c0.title=ds.join('\n')}
   cell(dFull(startOfDoc(x)));cell(x.divisi);cell(x.mandor);
   cell(st==='closed'?'Closed':'Open');
   cell(x.updatedAt?x.updatedAt.toDate().toLocaleString('id-ID'):'');
   const ca=cell();ca.className='act';
   const btn=(label,cls,fn)=>{const e=document.createElement('button');e.type='button';e.className='sm '+cls;e.textContent=label;e.onclick=ev=>{ev.stopPropagation();fn()};ca.appendChild(e)};
   if(st!=='closed'&&isR('mandor')){btn('Input Realisasi','',()=>openWO(id,x,'real'));btn('Close WO','g',()=>closeWO(id,x))}
   if(me.role==='admin')btn('Hapus','dg',()=>delWO(id,x));
   if(st==='closed')tr.style.opacity='.7';
   tr.onclick=()=>openWO(id,x);tb.appendChild(tr);
 });
}
function quickRange(k){
 const d=new Date();
 if(k==='today')return[ymd(d),ymd(d)];
 if(k==='week'){const s=new Date(d);s.setDate(d.getDate()-((d.getDay()+6)%7));const e=new Date(s);e.setDate(s.getDate()+6);return[ymd(s),ymd(e)]}
 const s=new Date(d.getFullYear(),d.getMonth(),1),e=new Date(d.getFullYear(),d.getMonth()+1,0);return[ymd(s),ymd(e)];
}
function quickNow(){return['today','week','month'].find(k=>{const[a,b]=quickRange(k);return flt.from===a&&flt.to===b})||''}
$('fQuick').querySelectorAll('button').forEach(b=>b.onclick=()=>{
 if(quickNow()===b.dataset.q){flt.from='';flt.to=''}else{[flt.from,flt.to]=quickRange(b.dataset.q)}
 saveFlt();refilter();
});
$('fFrom').onchange=e=>{flt.from=e.target.value;if(flt.to&&flt.from>flt.to)flt.to=flt.from;saveFlt();refilter()};
$('fTo').onchange=e=>{flt.to=e.target.value;if(flt.from&&flt.to<flt.from)flt.from=flt.to;saveFlt();refilter()};
$('fReset').onclick=()=>{flt={dept:'',from:'',to:''};saveFlt();refilter()};

/* Daftar dimuat bertahap (PAGE dokumen per kali). Filter jalan di dokumen yang sudah termuat;
 * bila filter aktif dan hasilnya sedikit, halaman berikutnya diambil otomatis (maks. AUTO halaman). */
const PAGE=25,AUTO=8;
let lastSnap=null,more=false,busyL=false;
const passF=d=>passDate(d.x)&&(flt.dept===''||(flt.dept==='-'?!deptOf(d.x):deptOf(d.x)===flt.dept));
const filtActive=()=>!!(flt.dept||flt.from||flt.to);
async function fetchPage(){
 const c=[orderBy('updatedAt','desc')];if(lastSnap)c.push(startAfter(lastSnap));c.push(limit(PAGE));
 const q=await getDocs(query(collection(db,'workOrders'),...c));
 q.forEach(d=>listDocs.push({id:d.id,x:d.data()}));
 if(q.docs.length)lastSnap=q.docs[q.docs.length-1];
 more=q.docs.length===PAGE;
}
async function topUp(){let n=0;while(more&&filtActive()&&listDocs.filter(passF).length<PAGE&&n++<AUTO)await fetchPage()}
async function loadList(){
 show('list');document.querySelector('#lt tbody').innerHTML='';$('lMore').hidden=true;$('lmsg').textContent='Memuat...';
 listDocs=[];lastSnap=null;more=false;
 try{await fetchPage();await topUp();$('lmsg').textContent=listDocs.length?'':'Belum ada Work Order.';renderList()}
 catch(e){$('lmsg').textContent='Gagal memuat: '+(e.code||e.message)}
}
async function loadMore(){
 if(busyL||!more)return;busyL=true;const b=$('lMore');b.disabled=true;b.textContent='Memuat...';
 try{await fetchPage();await topUp();renderList()}catch(e){toast('Gagal memuat: '+(e.code||e.message))}
 finally{busyL=false;b.disabled=false;b.textContent='Muat lagi'}
}
async function refilter(){
 renderList();
 if(filtActive()&&more&&!busyL){busyL=true;try{await topUp()}catch(e){}busyL=false;renderList()}
}
$('lMore').onclick=loadMore;

function openWO(id,x,want){
 const st=stOf(x);
 cur={id:id,status:st,mode:(st==='closed'||!isR('mandor'))?'view':(want||'plan')};
 apply(norm(x));ui();
}
async function closeWO(id,x){
 const has=rowsOfDoc(x).some(r=>String(r.close||'').trim());
 if(!confirm((has?'':'Belum ada realisasi (kolom Close) yang diisi.\n')+'Close WO '+(x.no||'')+'?\nSetelah di-close, WO tidak bisa diubah.'))return;
 const u={status:'closed',closedAt:serverTimestamp(),closedBy:me.nama||me.uid,updatedAt:serverTimestamp(),updatedBy:me.nama||me.uid};
 const d=norm(x);                                   // WO format lama sekaligus dimigrasi ke v3
 if(d){const s=d.s.slice();while(s.length<=iClose)s.push(null);if(!s[iClose])s[iClose]=todayStr();Object.assign(u,{v:3,s:s,rows:d.rows,f:deleteField()})}
 try{await setDoc(doc(db,'workOrders',id),u,{merge:true});toast('WO di-close');loadList()}catch(e){msg(e)}
}
async function delWO(id,x){
 if(!confirm('Hapus WO '+(x.no||'')+'?\nTindakan ini tidak bisa dibatalkan.'))return;
 try{await deleteDoc(doc(db,'workOrders',id));toast('WO dihapus');loadList()}catch(e){msg(e)}
}
$('bNew').onclick=()=>{
 cur={id:null,status:'open',mode:'plan'};apply(null);
 const d=new Date(),p=n=>String(n).padStart(2,'0');
 S()[0].value='WO-'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+'-'+p(d.getHours())+p(d.getMinutes());
 if(!master)loadMaster();
 if(!ops)loadOpsMaster();
 if(!umaster)loadUnitMaster();
 ui();startEl.focus();
};
/* ---------- Timeline & Export Excel ---------- */
const tlModel=async()=>{const{buildTimeline}=await mod('timeline');return buildTimeline({start:startEl.value,end:endEl.value,rows:collect().rows,today:todayStr()})};
const tlTitle=()=>{const no=(S()[0].value||'').trim(),ds=[...new Set(opRows().map(tr=>tr.querySelector('[data-k=desc]').value.trim()).filter(Boolean))];return [no,ds.join(' + ')].filter(Boolean).join(' - ')};
let csSet=null;
async function csDraw(){
 const{renderCosting,buildCosting,mergeCosting}=await mod('costing');
 if(!csSet){try{const d=await getDoc(doc(db,'config','costing'));csSet=mergeCosting(d.exists()?d.data():null)}catch(e){csSet=mergeCosting(null)}}
 renderCosting($('csp'),buildCosting({rows:collect().rows,settings:csSet,today:todayStr(),start:startEl.value}),{title:tlTitle()},{
  settings:csSet,canEdit:!!me&&me.role==='admin',
  onSave:async ns=>{await setDoc(doc(db,'config','costing'),{...ns,updatedAt:Date.now(),updatedBy:(me&&(me.nama||me.uid))||''});csSet=ns;csDraw()}
 });
}
const sumOpt={tol:5,only:false};
async function sumDraw(){
 const{renderSummary,buildSummary}=await mod('summary');
 renderSummary($('smp'),buildSummary({start:startEl.value,rows:collect().rows,today:todayStr(),tol:sumOpt.tol}),{title:tlTitle()},sumOpt,o=>{Object.assign(sumOpt,o);sumDraw()});
}
let curTab='wo';
async function tab(t){
 curTab=t;
 $('tlv').hidden=t!=='tl';$('smv').hidden=t!=='sm';$('csv').hidden=t!=='cs';paper.parentElement.hidden=t!=='wo';
 [['wo','tWo'],['tl','tTl'],['sm','tSm'],['cs','tCs']].forEach(([k,id])=>$(id).classList.toggle('on',k===t));
 try{
  if(t==='tl'){const[{renderTimeline},m]=await Promise.all([mod('timeline'),tlModel()]);if(curTab===t)renderTimeline($('tlp'),m,{title:tlTitle()})}
  if(t==='sm')await sumDraw();
  if(t==='cs')await csDraw();
 }catch(e){toast('Gagal memuat tab: '+(e.message||e))}
}
$('tWo').onclick=()=>tab('wo');$('tTl').onclick=()=>tab('tl');$('tSm').onclick=()=>tab('sm');$('tCs').onclick=()=>tab('cs');
$('bXls').onclick=async()=>{
 try{const[{exportWorkbook},tl]=await Promise.all([mod('export-excel'),tlModel()]);exportWorkbook({root:paper,timeline:tl,tlInfo:{title:tlTitle()},filename:tlTitle()||'Work Order'})}
 catch(e){alert('Gagal export Excel: '+(e.message||e))}
};
function ui(){
 show('formv');
 tab('wo');
 lock();
 const mn={plan:'Perencanaan',real:'Realisasi',view:'Lihat saja'}[cur.mode];
 $('stat').textContent=(cur.id?'Status: '+cur.status.toUpperCase():'WO BARU')+' \u00b7 Mode: '+mn;
 $('bSave').hidden=cur.mode==='view';
 $('bClose').hidden=!(cur.mode!=='view'&&cur.id);
 window.scrollTo(0,0);
}
async function save(status){
 const c=collect(),s=c.s;
 const data={v:3,s:s,rows:c.rows,no:s[0],divisi:s[2],mandor:s[4],mandor2:$('mandor2').value,status:status,updatedAt:serverTimestamp(),updatedBy:me.nama||me.uid};
 if(status==='closed'){data.closedAt=serverTimestamp();data.closedBy=me.nama||me.uid}
 try{
  if(!cur.id){data.createdBy=me.uid;data.createdAt=serverTimestamp();cur.id=(await addDoc(collection(db,'workOrders'),data)).id}
  else{data.f=deleteField();await setDoc(doc(db,'workOrders',cur.id),data,{merge:true})}
  cur.status=status;return true;
 }catch(e){msg(e);return false}
}
$('bSave').onclick=async()=>{
 if(cur.mode!=='view'){const err=validate();if(err){alert(err);return}const w=warnAll();if(w&&!confirm(w))return}
 if(!cur.id&&!$('dOpen').value)$('dOpen').value=todayStr();   // Tanggal Open WO = hari WO pertama disimpan
 if(await save('open')){toast('WO tersimpan');loadList()}
};
$('bClose').onclick=async()=>{
 if(cur.mode!=='view'){const err=validate();if(err){alert(err);return}const w=warnAll();if(w&&!confirm(w))return}
 const has=opRows().some(tr=>v(tr.querySelector('.close')));
 if(!confirm((has?'':'Belum ada realisasi (kolom Close) yang diisi.\n')+'Simpan dan Close WO ini?\nSetelah di-close, WO tidak bisa diubah.'))return;
 if(!$('dClose').value)$('dClose').value=todayStr();
 if(await save('closed')){toast('WO di-close');loadList()}
};
