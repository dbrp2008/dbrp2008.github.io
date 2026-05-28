const STORAGE_KEY = 'fiapp_income_v1';
const UNDO_KEY    = 'fiapp_income_undo_v1';
const REDO_KEY    = 'fiapp_income_redo_v1';
const PUSH_KEY    = 'fiapp_income_push_v1';
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT= ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const CELL_CURRENCIES  = ['USD','EUR','GBP','AED','HKD','SGD','CAD','AUD','JPY','CNY','INR','CHF','MYR','THB','KRW','BRL','MXN'];


const ratesCache = {};
let ratesReady   = false;
let currentRate  = 1; 
async function fetchAndCacheUSDRates(){
  if(ratesReady) return;
  try{
    const obj=await fiappGetRates('USD');
    const rates=obj.rates;
    if(rates&&typeof rates==='object'&&!Array.isArray(rates)){
      Object.keys(rates).forEach(k=>{
        if(/^[A-Z]{2,5}$/.test(k)&&typeof rates[k]==='number') ratesCache[k]=rates[k];
      });
      ratesReady=true;
    }
  }catch(e){ console.warn('FiApp: rate fetch failed -',e.message); }
}
async function ensureRate(currency){
  if(!currency||currency==='USD'||ratesCache[currency]) return;
  await fetchAndCacheUSDRates();
}
function rowCurrency(monthKey, rowId){ return (state.monthRowCurrencies||{})[monthKey+'|'+rowId]||'USD'; }
function setRowCurrency(monthKey, rowId, cur){
  if(!state.monthRowCurrencies) state.monthRowCurrencies={};
  state.monthRowCurrencies[monthKey+'|'+rowId]=cur; save();
}
function amountToUSD(rawAmt, monthKey, rowId){
  if(!rawAmt) return 0;
  const cur=rowCurrency(monthKey, rowId);
  if(cur==='USD') return rawAmt;
  const rate=ratesCache[cur];
  return rate?rawAmt/rate:rawAmt;
}
function getAllUsedCurrencies(){
  const set=new Set(CELL_CURRENCIES);
  Object.values(state.monthRowCurrencies||{}).forEach(c=>{ if(c) set.add(c); });
  return [...set];
}

function showConvFields(cur,rate){
  currentRate=rate;
  document.getElementById('conv-lbl').textContent='Total ('+cur+')';
  document.getElementById('conv-wrap').style.display='';
  updateSummaryBar();
}
function hideConvFields(){
  currentRate=1;
  document.getElementById('conv-wrap').style.display='none';
  document.getElementById('curr-note').textContent='';
  updateSummaryBar();
}
function onCurrencyChange(){
  const sel=document.getElementById('curr-sel');
  const cur=sel.value;
  const otherInp=document.getElementById('curr-other-inp');
  const otherBtn=document.getElementById('curr-other-btn');
  if(cur==='__other__'){
    otherInp.style.display='inline-block'; otherBtn.style.display='inline-block';
    document.getElementById('curr-note').textContent='Enter a currency code then click OK.';
    return;
  }
  otherInp.style.display='none'; otherBtn.style.display='none';
  state.displayCurrency=cur; save();
  if(cur==='USD'){ hideConvFields(); return; }
  document.getElementById('curr-note').textContent='Fetching…';
  if(ratesCache[cur]){
    document.getElementById('curr-note').textContent='1 USD = '+ratesCache[cur].toFixed(4)+' '+cur;
    showConvFields(cur,ratesCache[cur]); return;
  }
  fiappGetRates('USD').then(obj=>{
      const rates=obj.rates;
      if(rates&&typeof rates==='object'&&!Array.isArray(rates)){
        Object.keys(rates).forEach(k=>{if(/^[A-Z]{2,5}$/.test(k)&&typeof rates[k]==='number') ratesCache[k]=rates[k];});
        ratesReady=true;
      }
      const rate=ratesCache[cur];
      if(!rate){document.getElementById('curr-note').textContent='Unknown currency: '+cur;return;}
      document.getElementById('curr-note').textContent='1 USD = '+rate.toFixed(4)+' '+cur;
      showConvFields(cur,rate);
    }).catch(()=>{document.getElementById('curr-note').textContent='Network error';});
}
function applyOtherCurrency(){
  const raw=(document.getElementById('curr-other-inp').value||'').trim().toUpperCase();
  if(!raw||!/^[A-Z]{2,5}$/.test(raw)){document.getElementById('curr-note').textContent='Invalid code (2–5 letters).';return;}
  if(raw==='USD'){state.displayCurrency='USD';save();hideConvFields();document.getElementById('curr-sel').value='USD';return;}
  document.getElementById('curr-note').textContent='Fetching…';
  fiappGetRates('USD').then(obj=>{
      const rates=obj.rates;
      if(rates&&typeof rates==='object'){
        Object.keys(rates).forEach(k=>{if(/^[A-Z]{2,5}$/.test(k)&&typeof rates[k]==='number') ratesCache[k]=rates[k];});
        ratesReady=true;
      }
      const rate=ratesCache[raw];
      if(!rate){document.getElementById('curr-note').textContent='Unknown currency: '+raw;return;}
      
      const sel=document.getElementById('curr-sel');
      if(![...sel.options].find(o=>o.value===raw)){
        const opt=document.createElement('option'); opt.value=raw; opt.textContent=raw; opt.dataset.custom='1';
        sel.insertBefore(opt, sel.querySelector('option[value="__other__"]'));
      }
      sel.value=raw;
      document.getElementById('curr-other-inp').style.display='none';
      document.getElementById('curr-other-btn').style.display='none';
      state.displayCurrency=raw; save();
      document.getElementById('curr-note').textContent='1 USD = '+rate.toFixed(4)+' '+raw;
      showConvFields(raw,rate);
    }).catch(()=>{document.getElementById('curr-note').textContent='Network error';});
}
function showCellCurrencyOther(wrap, sel, row){
  sel.style.display='none';
  const form=document.createElement('span'); form.className='curr-other-cell';
  const inp=document.createElement('input'); inp.type='text'; inp.maxLength=5; inp.placeholder='VND';
  const ok=document.createElement('button'); ok.textContent='✓'; ok.title='Apply';
  const cancel=document.createElement('button'); cancel.textContent='✕'; cancel.title='Cancel'; cancel.className='x';
  form.appendChild(inp); form.appendChild(ok); form.appendChild(cancel);
  wrap.appendChild(form);
  setTimeout(()=>inp.focus(),20);
  function showErr(msg){ const old=form.querySelector('.curr-other-err'); if(old) old.remove(); const e=document.createElement('span'); e.className='curr-other-err'; e.textContent=msg; form.style.position='relative'; form.appendChild(e); }
  function close(){ form.remove(); sel.style.display=''; sel.value=rowCurrency(currentMK(), row.id); }
  async function apply(){
    const code=inp.value.trim().toUpperCase();
    if(!code){showErr('Enter a code.');return;}
    if(!/^[A-Z]{2,5}$/.test(code)){showErr('2–5 letters only.');return;}
    if(code==='USD'){setRowCurrency(currentMK(), row.id, code);close();render();renderChart();return;}
    ok.disabled=true; ok.textContent='…';
    await ensureRate(code);
    if(!ratesCache[code]){showErr('Unknown: '+code);ok.disabled=false;ok.textContent='✓';return;}
    setRowCurrency(currentMK(), row.id, code); close(); render(); renderChart();
  }
  ok.addEventListener('click',e=>{e.stopPropagation();apply();});
  cancel.addEventListener('click',e=>{e.stopPropagation();close();});
  inp.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();apply();}if(e.key==='Escape'){close();}});
}

const CATEGORIES = {
  'Salary':       ['Base Pay','Overtime','Bonus','Commission','Tips'],
  'Freelance':    ['Client Work','Consulting','Side Projects','Gigs'],
  'Investments':  ['Dividends','Capital Gains','Rental Income','Interest Income'],
  'Other Income': ['Gifts','Tax Refund','Reimbursements','Miscellaneous'],
};
const CAT_KEYS = Object.keys(CATEGORIES);
const CAT_COLORS = {
  'Salary':'#bbf7d0','Freelance':'#bfdbfe','Investments':'#fed7aa','Other Income':'#e9d5ff',
};
function uid(){ return '_'+Math.random().toString(36).slice(2,9); }


function freshState(){
  const now=new Date(),y=now.getFullYear(),m=now.getMonth();
  return {
    rows:[
      {id:uid(),label:'Salary',      color:'#bbf7d0',textColor:'#1f2937',height:36,parentId:null},
      {id:uid(),label:'Freelance',   color:'#bfdbfe',textColor:'#1f2937',height:36,parentId:null},
      {id:uid(),label:'Investments', color:'#fed7aa',textColor:'#1f2937',height:36,parentId:null},
      {id:uid(),label:'Other Income',color:'#e9d5ff',textColor:'#1f2937',height:36,parentId:null},
    ],
    cols:[
      {id:uid(),label:'Amount',width:160},
    ],
    headerColWidth:185, totalColWidth:110,
    cells:{}, collapsed:{}, monthRowCurrencies:{},
    displayCurrency:'USD',
    currentYear:y, currentMonth:m,
    rowsByMonth:{}, colsByMonth:{},
  };
}
function loadState(){
  try{
    const r=localStorage.getItem(STORAGE_KEY);
    if(r){
      const s=JSON.parse(r);
      if(!s.cells)          s.cells={};
      if(!s.collapsed)      s.collapsed={};
      if(!s.monthRowCurrencies)  s.monthRowCurrencies={};
      if(!s.displayCurrency) s.displayCurrency='USD';
      if(!Array.isArray(s.rows)) s.rows=freshState().rows;
      if(!Array.isArray(s.cols)) s.cols=freshState().cols;
      if(!s.rowsByMonth)    s.rowsByMonth={};
      if(!s.colsByMonth)    s.colsByMonth={};
      return s;
    }
  }catch(e){ console.warn('FiApp: loadState failed, using fresh state -',e.message); }
  return freshState();
}
let state=loadState();

const MAX_ROWS=20;
const MAX_COLS=12;
function getRows(mk2){ mk2=mk2||currentMK(); return (state.rowsByMonth&&state.rowsByMonth[mk2])?state.rowsByMonth[mk2]:(state.rows||[]); }
function getCols(mk2){ mk2=mk2||currentMK(); return (state.colsByMonth&&state.colsByMonth[mk2])?state.colsByMonth[mk2]:(state.cols||[]); }
function forkCurrentMonth(){
  const mk2=currentMK();
  if(!state.rowsByMonth) state.rowsByMonth={};
  if(!state.colsByMonth) state.colsByMonth={};
  if(!state.rowsByMonth[mk2]) state.rowsByMonth[mk2]=(state.rows||[]).map(r=>({...r}));
  if(!state.colsByMonth[mk2]) state.colsByMonth[mk2]=(state.cols||[]).map(c=>({...c}));
}
function copyStructureFromPrevMonth(){
  const mk2=currentMK();
  const [y,mo]=mk2.split('-').map(Number);
  const prev=new Date(y,mo-2);
  const prevMk=prev.getFullYear()+'-'+String(prev.getMonth()+1).padStart(2,'0');
  const prevRows=getRows(prevMk), prevCols=getCols(prevMk);
  if(!prevRows.length){showToast('No rows in previous month.');return;}
  const alreadyForked=state.rowsByMonth&&state.rowsByMonth[mk2];
  if(alreadyForked&&!confirm('This month already has its own structure. Overwrite with previous month\'s rows/columns?')) return;
  if(!state.rowsByMonth) state.rowsByMonth={};
  if(!state.colsByMonth) state.colsByMonth={};
  state.rowsByMonth[mk2]=prevRows.map(r=>({...r}));
  state.colsByMonth[mk2]=prevCols.map(c=>({...c}));
  save(); render();
  showToast('Copied structure from previous month');
}
function copyStructureFromMonth(sourceMk){
  const mk2=currentMK();
  if(sourceMk===mk2){showToast('Already on that month.');return;}
  const srcRows=getRows(sourceMk),srcCols=getCols(sourceMk);
  if(!srcRows.length){showToast('No rows in that month.');return;}
  const alreadyForked=state.rowsByMonth&&state.rowsByMonth[mk2];
  if(alreadyForked&&!confirm('This month already has its own structure. Overwrite with '+sourceMk+'\'s rows/columns?')) return;
  if(!state.rowsByMonth) state.rowsByMonth={};
  if(!state.colsByMonth) state.colsByMonth={};
  state.rowsByMonth[mk2]=srcRows.map(r=>({...r}));
  state.colsByMonth[mk2]=srcCols.map(c=>({...c}));
  save(); render();
  showToast('Copied structure from '+sourceMk);
}
function copyMonthToTargets(sourceMk, targetMks, overwrite){
  snapshot();
  const srcRows=getRows(sourceMk);
  const srcCols=getCols(sourceMk);
  targetMks.forEach(tMk=>{
    if(!state.rowsByMonth) state.rowsByMonth={};
    if(!state.colsByMonth) state.colsByMonth={};
    state.rowsByMonth[tMk]=srcRows.map(r=>({...r}));
    state.colsByMonth[tMk]=srcCols.map(c=>({...c}));
    Object.keys(state.cells).forEach(k=>{
      if(!k.startsWith(sourceMk+'|')) return;
      const newKey=tMk+k.slice(sourceMk.length);
      if(overwrite||!state.cells[newKey]) state.cells[newKey]=state.cells[k];
    });
    if(state.monthRowCurrencies){
      Object.keys(state.monthRowCurrencies).forEach(k=>{
        if(!k.startsWith(sourceMk+'|')) return;
        const newKey=tMk+k.slice(sourceMk.length);
        if(overwrite||!state.monthRowCurrencies[newKey])
          state.monthRowCurrencies[newKey]=state.monthRowCurrencies[k];
      });
    }
  });
  save(); render();
  showToast('Copied to '+targetMks.length+' month'+(targetMks.length>1?'s':'')+'.');
}

function openCopyToDropdown(e){
  const sourceMk=currentMK();
  const months=new Set();

  // Valid range: intersection of (source ±12) and (today ±12)
  // i.e. only months that are both near the source AND accessible via normal navigation
  const [_sy,_sm]=sourceMk.split('-');
  const srcDate=new Date(+_sy,+_sm-1,1);
  const today=new Date(); const todayDate=new Date(today.getFullYear(),today.getMonth(),1);
  const startDate=new Date(Math.max(
    new Date(srcDate).setMonth(srcDate.getMonth()-12),
    new Date(todayDate).setMonth(todayDate.getMonth()-12)
  ));
  const endDate=new Date(Math.min(
    new Date(srcDate).setMonth(srcDate.getMonth()+12),
    new Date(todayDate).setMonth(todayDate.getMonth()+12)
  ));
  const sweep=new Date(startDate);
  while(sweep<=endDate){
    const m=sweep.getFullYear()+'-'+String(sweep.getMonth()+1).padStart(2,'0');
    if(m!==sourceMk) months.add(m);
    sweep.setMonth(sweep.getMonth()+1);
  }

  const opts=[...months].sort();
  const menu=document.getElementById('dd-copy-to-menu');
  menu.innerHTML='';
  if(!opts.length){
    const em=document.createElement('div');em.style.cssText='padding:.5rem .75rem;font-size:.83rem;color:var(--muted);white-space:nowrap;';
    em.textContent='No other months available.';menu.appendChild(em);
    toggleDropdown('dd-copy-to',e);return;
  }
  const [sy,sm]=sourceMk.split('-');
  const hd=document.createElement('div');hd.className='copy-to-hd';
  hd.textContent='Copy '+new Date(+sy,+sm-1,1).toLocaleString('default',{month:'long',year:'numeric'})+' to:';
  menu.appendChild(hd);
  const pillsDiv=document.createElement('div');pillsDiv.className='copy-to-pills';
  opts.forEach(m=>{
    const [y,mo]=m.split('-');
    const pill=document.createElement('span');
    pill.className='copy-to-pill';
    pill.dataset.mk=m;
    pill.textContent=new Date(+y,+mo-1,1).toLocaleString('default',{month:'short',year:'numeric'});
    pill.addEventListener('click',ev=>{ev.stopPropagation();pill.classList.toggle('selected');});
    pillsDiv.appendChild(pill);
  });
  menu.appendChild(pillsDiv);
  const hr=document.createElement('hr');hr.className='copy-to-divider';menu.appendChild(hr);
  const copyBtn=document.createElement('button');copyBtn.className='copy-to-copy-btn';copyBtn.textContent='Copy';
  copyBtn.addEventListener('click',ev=>{
    ev.stopPropagation();
    const selected=[...menu.querySelectorAll('.copy-to-pill.selected')].map(p=>p.dataset.mk);
    if(!selected.length){showToast('Select at least one month.');return;}
    menu.classList.remove('open');
    copyMonthToTargets(sourceMk,selected,true);
  });
  menu.appendChild(copyBtn);
  toggleDropdown('dd-copy-to',e);
}

function showMonthCopyPicker(){
  const months=new Set();
  Object.keys(state.rowsByMonth||{}).forEach(m=>months.add(m));
  Object.keys(state.cells||{}).forEach(k=>{const m=k.split('|')[0];if(m&&m.match(/^\d{4}-\d{2}$/))months.add(m);});
  const cur=currentMK();
  const opts=[...months].filter(m=>m!==cur).sort();
  if(!opts.length){showToast('No other months with data found.');return;}
  const overlay=document.createElement('div');overlay.className='share-overlay';
  const modal=document.createElement('div');modal.className='share-modal';modal.style.maxWidth='340px';
  const h=document.createElement('h3');h.textContent='Copy structure from month';
  const sel=document.createElement('select');sel.style.cssText='width:100%;padding:.5rem;border:1px solid var(--input-border);border-radius:6px;background:var(--input-bg);color:var(--fg);font-size:.9rem;margin:.5rem 0;';
  opts.forEach(m=>{const o=document.createElement('option');o.value=m;const [y,mo]=m.split('-');o.textContent=new Date(+y,+mo-1,1).toLocaleString('default',{month:'long',year:'numeric'});sel.appendChild(o);});
  const actions=document.createElement('div');actions.style.cssText='display:flex;gap:.5rem;justify-content:flex-end;margin-top:.5rem;';
  const confirmBtn=document.createElement('button');confirmBtn.className='btn btn-sm';confirmBtn.textContent='Copy';
  confirmBtn.addEventListener('click',()=>{copyStructureFromMonth(sel.value);overlay.remove();});
  const cancelBtn=document.createElement('button');cancelBtn.className='btn btn-sm btn-ghost';cancelBtn.textContent='Cancel';
  cancelBtn.addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  actions.appendChild(cancelBtn);actions.appendChild(confirmBtn);
  modal.appendChild(h);modal.appendChild(sel);modal.appendChild(actions);
  overlay.appendChild(modal);document.body.appendChild(overlay);
}


var _sync=createSyncManager(STORAGE_KEY,'/api/save/income','/api/load/income',{
  getState:function(){return state;},
  onReload:function(){state=loadState();render();},
  showQuotaWarning:showSaveQuotaWarning
});
var syncToServer=_sync.syncToServer;
var loadFromServer=_sync.loadFromServer;
var setSyncStatus=_sync.setSyncStatus;
var saveLocal=_sync.saveLocal;
function save(){
  saveLocal();
  try{ localStorage.setItem(PUSH_KEY, JSON.stringify({mk:currentMK(),total:grandTotal(),ts:Date.now()})); }catch{}
  syncToServer();
}
function showSaveQuotaWarning(){
  if(document.getElementById('quota-warn')) return;
  const el=document.createElement('div'); el.id='quota-warn'; el.className='error';
  el.style.cssText='position:fixed;bottom:calc(1rem + env(safe-area-inset-bottom, 0px));left:50%;transform:translateX(-50%);z-index:99999;max-width:420px;text-align:center;padding:.6rem 1rem;';
  el.textContent='⚠ Storage full - latest changes could not be saved. Export your data and clear some rows.';
  document.body.appendChild(el); setTimeout(()=>el.remove(),8000);
}
function showToast(msg, isError=false, duration=4000, undoCb=null){
  const el=document.createElement('div');
  el.setAttribute('data-wt-toast','1');
  el.className=isError?'error':'success';
  el.style.cssText='position:fixed;bottom:calc(1rem + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:99999;max-width:480px;padding:.6rem 1rem;display:flex;align-items:center;gap:.75rem;white-space:pre-wrap;';
  const txt=document.createElement('span'); txt.textContent=msg; el.appendChild(txt);
  if(undoCb){
    const btn=document.createElement('button');
    btn.textContent='Undo';
    btn.style.cssText='background:none;border:1px solid currentColor;border-radius:4px;padding:.15rem .5rem;cursor:pointer;font-size:.85rem;color:inherit;white-space:nowrap;';
    btn.addEventListener('click',()=>{ undoCb(); el.remove(); });
    el.appendChild(btn);
  }
  document.body.appendChild(el); setTimeout(()=>el.remove(),duration);
}


let undoStack=[], redoStack=[];
function loadHistory(){
  try{
    const u=sessionStorage.getItem(UNDO_KEY); if(u) undoStack=JSON.parse(u)||[];
    const r=sessionStorage.getItem(REDO_KEY); if(r) redoStack=JSON.parse(r)||[];
  }catch{}
}
function saveHistory(){
  try{
    sessionStorage.setItem(UNDO_KEY,JSON.stringify(undoStack.slice(-60)));
    sessionStorage.setItem(REDO_KEY,JSON.stringify(redoStack.slice(-60)));
  }catch{}
}
function snapshot(){ undoStack.push(JSON.stringify(state)); redoStack.length=0; if(undoStack.length>60) undoStack.shift(); saveHistory(); updateHistBtns(); }
function undo(){ if(!undoStack.length) return; redoStack.push(JSON.stringify(state)); state=JSON.parse(undoStack.pop()); save(); saveHistory(); render(); updateHistBtns(); showToast('↩ Undone.', false, 1800); }
function redo(){ if(!redoStack.length) return; undoStack.push(JSON.stringify(state)); state=JSON.parse(redoStack.pop()); save(); saveHistory(); render(); updateHistBtns(); showToast('↪ Redone.', false, 1800); }
function updateHistBtns(){ const u=document.getElementById('undo-btn'),r=document.getElementById('redo-btn'); if(u)u.disabled=!undoStack.length; if(r)r.disabled=!redoStack.length; }
document.addEventListener('keydown',e=>{
  if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z'){e.preventDefault();undo();}
  if((e.ctrlKey||e.metaKey)&&(e.key==='y'||(e.shiftKey&&e.key==='z'))){e.preventDefault();redo();}
});


const today=new Date();
function mk(y,m){ return String(y)+'-'+String(m+1).padStart(2,'0'); }
function currentMK(){ return mk(state.currentYear,state.currentMonth); }
const minY=today.getFullYear()-1, minM=today.getMonth();
const maxY=today.getFullYear()+1, maxM=today.getMonth();
function isAtMin(){ return state.currentYear<minY||(state.currentYear===minY&&state.currentMonth<=minM); }
function isAtMax(){ return state.currentYear>maxY||(state.currentYear===maxY&&state.currentMonth>=maxM); }
function shiftMonth(d){
  let y=state.currentYear, m=state.currentMonth+d;
  if(m<0){y--;m=11;} if(m>11){y++;m=0;}
  state.currentYear=y; state.currentMonth=m;
  saveLocal(); updateMonthNav(); render();
}
function populateMonthJump(){
  const sel=document.getElementById('month-jump'); if(!sel) return;
  const curMk=mk(state.currentYear,state.currentMonth);
  sel.innerHTML='';
  for(let y=minY;y<=maxY;y++){
    for(let m2=0;m2<12;m2++){
      if(y===minY&&m2<minM) continue;
      if(y===maxY&&m2>maxM) continue;
      const opt=document.createElement('option');
      opt.value=mk(y,m2); opt.textContent=MONTHS_FULL[m2]+' '+y;
      if(mk(y,m2)===curMk) opt.selected=true;
      sel.appendChild(opt);
    }
  }
}
function jumpToMonth(mkStr){
  const parts=mkStr.split('-');
  state.currentYear=parseInt(parts[0],10);
  state.currentMonth=parseInt(parts[1],10)-1;
  saveLocal(); updateMonthNav(); render();
}
function updateMonthNav(){
  const label=MONTHS_FULL[state.currentMonth]+' '+state.currentYear;
  const sm=document.getElementById('summary-month');
  if(sm){
    sm.textContent=label;
    sm.querySelectorAll('.forecast-badge').forEach(b=>b.remove());
    if(isForecastMonth()){const b=document.createElement('span');b.className='forecast-badge';b.textContent='📋 Forecast';sm.appendChild(b);}
  }
  document.getElementById('prev-btn').disabled=isAtMin();
  document.getElementById('next-btn').disabled=isAtMax();
  populateMonthJump();
  updateForecastUI();
  updateCloseBar();
}

// ── Monthly Close Flow ────────────────────────────────────────────────────
function _hasDataForMonth(mk2){
  return Object.keys(state.cells||{}).some(k=>k.startsWith(mk2+'|')&&parseFloat(state.cells[k])>0);
}
function _isPastMonth(){
  const now=new Date();
  const nowMk=mk(now.getFullYear(),now.getMonth());
  return currentMK()<nowMk;
}
function _isClosedMonth(mk2){
  return !!(state.closedMonths&&state.closedMonths[mk2]);
}
function updateCloseBar(){
  const bar=document.getElementById('close-bar');
  if(!bar) return;
  const mk2=currentMK();
  if(!_isPastMonth()||!_hasDataForMonth(mk2)||_isClosedMonth(mk2)){
    bar.style.display='none'; return;
  }
  // Compute income total for the display
  let total=0;
  const rows=getRows(mk2);
  rows.filter(r=>!r.parentId).forEach(row=>{
    const kids=rows.filter(c=>c.parentId===row.id);
    if(kids.length){ kids.forEach(child=>{ (state.cols||[]).forEach(col=>{ total+=parseFloat((state.cells||{})[mk2+'|'+child.id+'|'+col.id]||0)||0; }); }); }
    else { (state.cols||[]).forEach(col=>{ total+=parseFloat((state.cells||{})[mk2+'|'+row.id+'|'+col.id]||0)||0; }); }
  });
  const label=MONTHS_FULL[state.currentMonth]+' '+state.currentYear;
  document.getElementById('close-bar-text').textContent='📋 Close '+label+'? — $'+total.toFixed(2)+' income logged';
  bar.style.display='flex';
}
function openCloseModal(){
  const mk2=currentMK();
  let total=0;
  const rows=getRows(mk2);
  rows.filter(r=>!r.parentId).forEach(row=>{
    const kids=rows.filter(c=>c.parentId===row.id);
    if(kids.length){ kids.forEach(child=>{ (state.cols||[]).forEach(col=>{ total+=parseFloat((state.cells||{})[mk2+'|'+child.id+'|'+col.id]||0)||0; }); }); }
    else { (state.cols||[]).forEach(col=>{ total+=parseFloat((state.cells||{})[mk2+'|'+row.id+'|'+col.id]||0)||0; }); }
  });
  const label=MONTHS_FULL[state.currentMonth]+' '+state.currentYear;
  document.getElementById('close-modal-body').innerHTML='<strong>'+label+'</strong><br>Income logged: $'+total.toFixed(2);
  const overlay=document.getElementById('close-modal-overlay');
  if(overlay) overlay.style.display='flex';
}
function confirmClose(){
  const mk2=currentMK();
  if(!state.closedMonths) state.closedMonths={};
  state.closedMonths[mk2]=Date.now();
  saveLocal(); save();
  document.getElementById('close-modal-overlay').style.display='none';
  updateCloseBar();
  populateMonthJump();
}
function cancelClose(){
  const overlay=document.getElementById('close-modal-overlay');
  if(overlay) overlay.style.display='none';
}

function isForecastMonth(){
  const now=new Date();
  return state.currentYear>now.getFullYear()||(state.currentYear===now.getFullYear()&&state.currentMonth>now.getMonth());
}
function updateForecastUI(){
  const fc=isForecastMonth();
  const bar=document.getElementById('forecast-bar');
  if(bar) bar.style.display=fc?'flex':'none';
  const sb=document.getElementById('summary-bar');
  if(sb) sb.classList.toggle('forecast-panel',fc);
}
function copyLastMonth(){
  if(!isForecastMonth()) return;
  snapshot();
  let py=state.currentYear, pm=state.currentMonth-1;
  if(pm<0){py--;pm=11;}
  const prevMk=mk(py,pm), curMk=currentMK();
  let copied=0;
  Object.keys(state.cells).forEach(k=>{
    if(!k.startsWith(prevMk+'|')) return;
    const newKey=curMk+k.slice(prevMk.length);
    if(!state.cells[newKey]){state.cells[newKey]=state.cells[k];copied++;}
  });
  save(); render();
  showForecastToast(copied?`Copied ${copied} values from ${MONTHS_SHORT[pm]} ${py}.`:'All cells already have values - nothing to copy.');
}
function useAverages(){
  if(!isForecastMonth()) return;
  snapshot();
  const curMk=currentMK();
  const srcMonths=[];
  for(let i=1;i<=3;i++){
    let pm=state.currentMonth-i, py=state.currentYear;
    if(pm<0){py--;pm+=12;}
    srcMonths.push(mk(py,pm));
  }
  let filled=0, hasHistory=false;
  getRows().forEach(r=>{
    getCols().forEach(col=>{

      const usdVals=srcMonths.map(m=>{
        const raw=safeNum(state.cells[m+'|'+r.id+'|'+col.id]);
        return raw>0 ? amountToUSD(raw,m,r.id) : 0;
      }).filter(v=>v>0);
      if(!usdVals.length) return;
      hasHistory=true;
      const avg=(usdVals.reduce((a,b)=>a+b,0)/usdVals.length).toFixed(2);
      state.cells[curMk+'|'+r.id+'|'+col.id]=avg;
      filled++;
    });
  });
  save(); render();
  showForecastToast(hasHistory?`Updated ${filled} cells using up to 3-month averages.`:'No historical data found in the 3 months before this forecast period.');
}
function showForecastToast(msg){
  let t=document.getElementById('forecast-toast');
  if(!t){t=document.createElement('div');t.id='forecast-toast';t.className='forecast-toast';document.body.appendChild(t);}
  t.textContent=msg; t.classList.add('show');
  clearTimeout(window._fcToastT);
  window._fcToastT=setTimeout(()=>t.classList.remove('show'),3500);
}


function ck(rId,cId){ return currentMK()+'|'+rId+'|'+cId; }
function getRawCell(rId,cId){ return state.cells[ck(rId,cId)]||''; }
function getCell(rId,cId){ return safeNum(state.cells[ck(rId,cId)]); }
function setCell(rId,cId,v){ state.cells[ck(rId,cId)]=v; save(); }


function children(rId, mk2){ return getRows(mk2).filter(r=>r.parentId===rId); }
function hasChildren(rId, mk2){ return getRows(mk2).some(r=>r.parentId===rId); }
function isCollapsed(rId){ return state.collapsed[rId]===true; }


function rowTotalUSD(rId){

  const kids=children(rId);
  if(kids.length) return kids.reduce((s,c)=>s+rowTotalUSD(c.id),0);
  return getCols().reduce((s,col)=>s+amountToUSD(getCell(rId,col.id), currentMK(), rId),0);
}
function rowTotal(rId){
  
  const usd=rowTotalUSD(rId);
  return usd*currentRate;
}
function grandTotal(){
  const usd=getRows().filter(r=>!r.parentId).reduce((s,r)=>s+rowTotalUSD(r.id),0);
  return usd;
}
function salaryTotal(){

  return getRows()
    .filter(r=>!r.parentId && r.label.trim().toLowerCase()==='salary')
    .reduce((s,r)=>s+rowTotalUSD(r.id),0);
}
function grandTotalDisplay(){
  return grandTotal()*currentRate;
}
function colTotal(cId){
  return getRows().filter(r=>!r.parentId).reduce((s,r)=>{
    if(hasChildren(r.id)) return s+children(r.id).reduce((cs,c)=>cs+amountToUSD(getCell(c.id,cId), currentMK(), c.id),0);
    return s+amountToUSD(getCell(r.id,cId), currentMK(), r.id);
  },0);
}
function fmt(n){ return '$'+Math.max(0,n).toFixed(2); }

function updateRowTotal(rId){
  const el=document.getElementById('rt-'+rId); if(el) el.textContent=fmt(rowTotal(rId));
  const row=getRows().find(r=>r.id===rId);
  if(row&&row.parentId){ updateRowTotal(row.parentId); updateParentSumCells(row.parentId); }
}
function updateParentSumCells(pId){
  getCols().forEach(col=>{
    const el=document.getElementById('ps-'+pId+'-'+col.id);
    if(el){
      const s=children(pId).reduce((t,c)=>t+getCell(c.id,col.id),0);
      el.textContent=s>0?fmt(s):'';
    }
  });
}
function updateColFooter(cId){
  const el=document.getElementById('ct-'+cId); if(el) el.textContent=fmt(colTotal(cId));
}
function updateGrandTotal(){
  const el=document.getElementById('gt'); if(el) el.textContent=fmt(grandTotal());
  getCols().forEach(col=>updateColFooter(col.id));
  updateSummaryBar();
}
function updateAll(rId){ updateRowTotal(rId); updateGrandTotal(); if(chartVisible) renderChart(); }


function updateSummaryBar(){
  const totalUSD=grandTotal(); 
  const el=document.getElementById('disp-total');
  const annualEl=document.getElementById('disp-annual');
  const convEl=document.getElementById('disp-conv');
  if(el) el.textContent=totalUSD>0?'$'+totalUSD.toFixed(2):'$0.00';
  if(annualEl) annualEl.textContent=totalUSD>0?'$'+(totalUSD*12).toFixed(2):'-';
  if(convEl&&currentRate!==1){
    const cur=state.displayCurrency||'USD';
    convEl.textContent=totalUSD>0?cur+' '+(totalUSD*currentRate).toFixed(2):'-';
    const annualConvEl=document.getElementById('conv-annual');
    if(annualConvEl) annualConvEl.textContent=totalUSD>0?cur+' '+(totalUSD*12*currentRate).toFixed(2):'-';
  }
  
  const salaryUSD=salaryTotal();
  const taxLink=document.getElementById('tax-calc-link');
  if(taxLink&&salaryUSD>0){
    taxLink.href='/tax?annual='+Math.round(salaryUSD*12);
    taxLink.style.display='';
  } else if(taxLink){
    taxLink.style.display='none';
  }
}


function toggleCollapse(rowId){ snapshot(); state.collapsed[rowId]=!isCollapsed(rowId); save(); render(); }
function expandAll(){ snapshot(); getRows().filter(r=>!r.parentId&&hasChildren(r.id)).forEach(r=>state.collapsed[r.id]=false); save(); render(); }
function collapseAll(){ snapshot(); getRows().filter(r=>!r.parentId&&hasChildren(r.id)).forEach(r=>state.collapsed[r.id]=true); save(); render(); }


let openMenu=null;
function closeMenu(){ if(openMenu){openMenu.remove();openMenu=null;} }
document.addEventListener('click',e=>{ if(!e.target.closest('.sub-dropdown')&&!e.target.closest('.sub-menu')) closeMenu(); });

let _gearMenuEl=null;
function _closeGearMenu(){ if(_gearMenuEl){_gearMenuEl.remove();_gearMenuEl=null;} }
document.addEventListener('pointerdown',e=>{ if(!e.target.closest('.row-gear-menu')&&!e.target.closest('.row-gear-btn')) _closeGearMenu(); });

function _openGearMenu(btn, row, rhTd, swatch, textSwatch, isChild){
  _closeGearMenu();
  document.querySelectorAll('input[data-gear-clr]').forEach(el=>el.remove());

  const menu=document.createElement('div'); menu.className='row-gear-menu';

  function mBtn(label,fn){
    const b=document.createElement('button');b.textContent=label;
    b.addEventListener('click',e=>{e.stopPropagation();_closeGearMenu();fn();});
    menu.appendChild(b);
  }

  function mColorItem(labelText, initVal, onInput){
    const id='_gc_'+Math.random().toString(36).slice(2,8);
    const inp=document.createElement('input');
    inp.type='color';inp.id=id;inp.value=initVal;
    inp.setAttribute('data-gear-clr','1');
    inp.style.cssText='position:fixed;opacity:0;top:50%;left:50%;pointer-events:none;';
    inp.addEventListener('input',()=>onInput(inp.value));
    inp.addEventListener('change',()=>{ _closeGearMenu();save();inp.remove(); });
    document.body.appendChild(inp);
    const lbl=document.createElement('label');lbl.htmlFor=id;lbl.textContent=labelText;
    lbl.addEventListener('click',e=>e.stopPropagation());
    menu.appendChild(lbl);
  }

  mColorItem('🎨 Background colour', row.color||'#ffffff',
    v=>{ row.color=v;rhTd.style.backgroundColor=v;if(swatch)swatch.style.backgroundColor=v;if(textSwatch)textSwatch.style.backgroundColor=v; }
  );
  mColorItem('🔤 Text colour', row.textColor||'#1f2937',
    v=>{ row.textColor=v;const lbl=rhTd.querySelector('.row-label');if(lbl)lbl.style.color=v;if(textSwatch)textSwatch.style.color=v; }
  );

  if(!isChild){
    mBtn('＋ Add sub-source',()=>{ showSubMenu(btn,row); });
  }

  const r=btn.getBoundingClientRect();
  const left=Math.max(4,Math.min(r.left,window.innerWidth-180));
  menu.style.cssText=`position:fixed;top:${r.bottom+4}px;left:${left}px;z-index:9999;`;
  document.body.appendChild(menu);
  _gearMenuEl=menu;
}

function renderOtherForm(menu, row){
  menu.innerHTML='';
  const f=document.createElement('div'); f.className='sub-other-form';
  const inp=document.createElement('input'); inp.type='text'; inp.placeholder='Custom sub-source'; inp.maxLength=40;
  const err=document.createElement('span'); err.className='sub-other-err';
  const btnRow=document.createElement('div'); btnRow.className='row';
  const ok=document.createElement('button'); ok.className='ok'; ok.textContent='Add';
  const cancel=document.createElement('button'); cancel.className='cancel'; cancel.textContent='Cancel';
  btnRow.appendChild(ok); btnRow.appendChild(cancel);
  f.appendChild(inp); f.appendChild(err); f.appendChild(btnRow);
  menu.appendChild(f);
  setTimeout(()=>inp.focus(),20);

  function tryAdd(){
    const name=inp.value.trim(); err.textContent='';
    if(!name){ err.textContent='Enter a name.'; return; }
    const lower=name.toLowerCase();
    const existing=children(row.id).map(c=>c.label.toLowerCase());
    const mainCat=CAT_KEYS.find(k=>k===row.label)||CAT_KEYS.find(k=>CATEGORIES[k].includes(row.label));
    const builtins = mainCat ? CATEGORIES[mainCat].map(s=>s.toLowerCase()) : [];
    if(existing.includes(lower)||builtins.includes(lower)){
      err.textContent='"'+name+'" already exists in this category.'; return;
    }
    addSubRow(row,name); closeMenu();
  }
  ok.addEventListener('click',e=>{e.stopPropagation();tryAdd();});
  cancel.addEventListener('click',e=>{e.stopPropagation();closeMenu();});
  inp.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();tryAdd();} if(e.key==='Escape'){closeMenu();} });
}

function showSubMenu(btn, row){
  closeMenu();
  let subs=[];
  const mainCat=CAT_KEYS.find(k=>k===row.label)||CAT_KEYS.find(k=>CATEGORIES[k].includes(row.label));
  if(mainCat) subs=CATEGORIES[mainCat].filter(s=>!children(row.id).some(c=>c.label===s));

  const menu=document.createElement('div'); menu.className='sub-menu';

  if(mainCat&&subs.length){
    subs.forEach(s=>{
      const item=document.createElement('button'); item.className='sub-menu-item'; item.textContent=s;
      item.addEventListener('click',e=>{e.stopPropagation();addSubRow(row,s);closeMenu();});
      menu.appendChild(item);
    });
  } else if(!mainCat) {
    CAT_KEYS.forEach(cat=>{
      const g=document.createElement('div'); g.className='sub-menu-group'; g.textContent=cat; menu.appendChild(g);
      CATEGORIES[cat].forEach(s=>{
        const item=document.createElement('button'); item.className='sub-menu-item'; item.textContent=s;
        item.addEventListener('click',e=>{e.stopPropagation();addSubRow(row,s);closeMenu();});
        menu.appendChild(item);
      });
    });
  }

  const other=document.createElement('button'); other.className='sub-menu-item sub-other'; other.textContent='+ Other (custom)…';
  other.addEventListener('click',e=>{e.stopPropagation();renderOtherForm(menu,row);});
  menu.appendChild(other);

  const rect=btn.getBoundingClientRect();
  menu.style.top=(rect.bottom+4)+'px';
  menu.style.left=rect.left+'px';
  document.body.appendChild(menu);
  openMenu=menu;
  if(menu.getBoundingClientRect().bottom > window.innerHeight - 8){
    menu.style.top=(rect.top - menu.offsetHeight - 4)+'px';
  }
}


function addRow(){
  try{var _wt=JSON.parse(localStorage.getItem('fiapp_walkthrough_v1')||'null');if(_wt&&_wt.active)return;}catch{}
  forkCurrentMonth();
  const mk2=currentMK();
  if(getRows(mk2).filter(r=>!r.parentId).length>=MAX_ROWS){showToast('Maximum '+MAX_ROWS+' rows per month.');return;}
  snapshot();
  const usedLabels=getRows(mk2).filter(r=>!r.parentId).map(r=>r.label);
  const nextCat=CAT_KEYS.find(k=>!usedLabels.includes(k))||'Salary';
  state.rowsByMonth[mk2].push({id:uid(),label:nextCat,color:CAT_COLORS[nextCat]||'#e5e7eb',textColor:'#1f2937',height:36,parentId:null});
  save(); render();
}
function addSubRow(parentRow, subLabel){
  forkCurrentMonth();
  const mk2=currentMK();
  if(getRows(mk2).length>=MAX_ROWS){showToast('Maximum '+MAX_ROWS+' rows per month.');return;}
  snapshot();
  const rows=state.rowsByMonth[mk2];
  const parentIdx=rows.findIndex(r=>r.id===parentRow.id);
  const kids=rows.reduce((acc,r,i)=>r.parentId===parentRow.id?[...acc,i]:acc,[]);
  const insertIdx=kids.length?Math.max(...kids)+1:parentIdx+1;
  rows.splice(insertIdx,0,{id:uid(),label:subLabel,color:parentRow.color,textColor:parentRow.textColor||'#1f2937',height:32,parentId:parentRow.id});
  state.collapsed[parentRow.id]=false;
  save(); render();
}
function addCol(){
  try{var _wt=JSON.parse(localStorage.getItem('fiapp_walkthrough_v1')||'null');if(_wt&&_wt.active)return;}catch{}
  forkCurrentMonth();
  const mk2=currentMK();
  if(getCols(mk2).length>=MAX_COLS){showToast('Maximum '+MAX_COLS+' columns per month.');return;}
  snapshot();
  state.colsByMonth[mk2].push({id:uid(),label:'New Column',width:120});
  save(); render();
}
function deleteRow(id){
  try{var _wt=JSON.parse(localStorage.getItem('fiapp_walkthrough_v1')||'null');if(_wt&&_wt.active)return;}catch{}
  forkCurrentMonth();
  snapshot();
  const mk2=currentMK();
  const kids=getRows(mk2).filter(r=>r.parentId===id).map(r=>r.id);
  const toDelete=[id,...kids];
  state.rowsByMonth[mk2]=getRows(mk2).filter(r=>!toDelete.includes(r.id));
  Object.keys(state.cells).forEach(k=>{ if(toDelete.some(d=>k.includes('|'+d+'|'))) delete state.cells[k]; });
  save();
  (function(){var tbody=document.querySelector('#sheet tbody');if(!tbody){render();return;}toDelete.forEach(function(rId){var tr=tbody.querySelector('[data-tr-row-id="'+rId+'"]');if(tr)tr.remove();});updateGrandTotal();})();
  showToast('Row deleted.', false, 5000, undo);
}
function deleteCol(id){
  try{var _wt=JSON.parse(localStorage.getItem('fiapp_walkthrough_v1')||'null');if(_wt&&_wt.active)return;}catch{}
  forkCurrentMonth();
  snapshot();
  const mk2=currentMK();
  state.colsByMonth[mk2]=getCols(mk2).filter(c=>c.id!==id);
  Object.keys(state.cells).filter(k=>k.endsWith('|'+id)).forEach(k=>delete state.cells[k]);
  save(); render();
  showToast('Column deleted.', false, 5000, undo);
}

function moveParentRow(fromId, toId, before){
  if(fromId===toId) return;
  forkCurrentMonth();
  snapshot();
  const mk2=currentMK();
  const rows=state.rowsByMonth[mk2];
  const fromGroup=[fromId,...rows.filter(r=>r.parentId===fromId).map(r=>r.id)];
  const fromRows=fromGroup.map(id=>rows.find(r=>r.id===id)).filter(Boolean);
  state.rowsByMonth[mk2]=rows.filter(r=>!fromGroup.includes(r.id));
  const arr=state.rowsByMonth[mk2];
  const toParentIdx=arr.findIndex(r=>r.id===toId);
  if(toParentIdx===-1){arr.push(...fromRows);save();render();return;}
  if(before){
    arr.splice(toParentIdx,0,...fromRows);
  } else {
    const toKids=arr.reduce((acc,r,i)=>r.parentId===toId?[...acc,i]:acc,[]);
    const insertAfter=toKids.length?Math.max(...toKids):toParentIdx;
    arr.splice(insertAfter+1,0,...fromRows);
  }
  save(); render();
}
let _dragRowId=null;
let _activeDropEl=null;
let _dragColId=null;


function escapeHtml(s){
  return String(s==null?'':s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function safeNum(v,max=1e12){
  const n=parseFloat(v);
  return (isFinite(n)&&n>=-max&&n<=max)?n:0;
}


let chartInstance=null, chartVisible=false, chartMode='monthly', chartType='bar';
function toggleChart(){
  chartVisible=!chartVisible;
  document.getElementById('chart-section').style.display=chartVisible?'block':'none';
  document.getElementById('chart-btn').textContent=chartVisible?'📊 Hide Chart':'📊 Chart';
  if(chartVisible) renderChart();
}
function setChartMode(mode){
  chartMode=mode;
  document.getElementById('chart-mode-m').classList.toggle('active',mode==='monthly');
  document.getElementById('chart-mode-y').classList.toggle('active',mode==='yearly');
  renderChart();
}
function setChartType(type){
  chartType=type;
  document.getElementById('chart-type-bar').classList.toggle('active',type==='bar');
  document.getElementById('chart-type-doughnut').classList.toggle('active',type==='doughnut');
  renderChart();
}
function rowTotalForMonthKey(rId, monthKey){
  const kids=getRows(monthKey).filter(r=>r.parentId===rId);
  if(kids.length) return kids.reduce((s,c)=>s+rowTotalForMonthKey(c.id,monthKey),0);
  return getCols(monthKey).reduce((s,col)=>{
    const k=monthKey+'|'+rId+'|'+col.id;
    return s+amountToUSD(parseFloat(state.cells[k])||0, monthKey, rId);
  },0);
}
function rowTotalForYear(rId,year){
  let t=0; for(let m=0;m<12;m++) t+=rowTotalForMonthKey(rId,mk(year,m)); return t;
}
function renderChart(){
  if(!chartVisible) return;
  const topRows=getRows().filter(r=>!r.parentId);
  let data, topLabel;
  if(chartMode==='yearly'){
    data=topRows.map(r=>({label:r.label,value:rowTotalForYear(r.id,state.currentYear),color:r.color})).filter(d=>d.value>0).sort((a,b)=>b.value-a.value);
    topLabel='Top Income - '+state.currentYear;
  } else {
    data=topRows.map(r=>({label:r.label,value:rowTotal(r.id),color:r.color})).filter(d=>d.value>0).sort((a,b)=>b.value-a.value);
    topLabel='Top Income - '+MONTHS_SHORT[state.currentMonth]+' '+state.currentYear;
  }
  if(chartInstance){chartInstance.destroy();chartInstance=null;}
  if(!data.length){renderTop3([],topLabel);return;}
  const colors=data.map(d=>d.color||'#bbf7d0');
  const vals=data.map(d=>parseFloat(d.value.toFixed(2)));
  const labels=data.map(d=>d.label);
  const isDark=document.documentElement.classList.contains('dark');
  const fgColor=isDark?'#e2e8f0':'#1f2937';
  const gridColor=isDark?'rgba(255,255,255,.1)':'rgba(0,0,0,.08)';
  if(chartType==='doughnut'){
    chartInstance=new Chart(document.getElementById('inc-chart'),{
      type:'doughnut',
      data:{labels,datasets:[{data:vals,backgroundColor:colors,borderWidth:2,borderColor:isDark?'#1e293b':'#fff',hoverOffset:8}]},
      options:{
        responsive:true,maintainAspectRatio:true,
        plugins:{
          legend:{display:true,position:'right',labels:{color:fgColor,boxWidth:14,padding:10,font:{size:12}}},
          tooltip:{callbacks:{label:ctx=>' '+ctx.label+': $'+ctx.parsed.toFixed(2)+' ('+(ctx.parsed/vals.reduce((a,b)=>a+b,0)*100).toFixed(1)+'%)'}}
        }
      }
    });
  } else {
    chartInstance=new Chart(document.getElementById('inc-chart'),{
      type:'bar',
      data:{labels,datasets:[{label:'$ Amount',data:vals,backgroundColor:colors,borderRadius:4}]},
      options:{
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>' $'+ctx.parsed.y.toFixed(2)}}},
        scales:{
          x:{ticks:{color:fgColor},grid:{color:gridColor},border:{color:gridColor}},
          y:{beginAtZero:true,ticks:{color:fgColor,callback:v=>'$'+v},grid:{color:gridColor},border:{color:gridColor}}
        },
        responsive:true,maintainAspectRatio:true
      }
    });
  }
  renderTop3(data,topLabel);
}
function renderTop3(data,label){
  const top=(data||[]).slice(0,3);
  const el=document.getElementById('top3');
  if(!top.length){el.innerHTML='';return;}
  el.innerHTML='<h4>'+escapeHtml(label||'Top 3')+'</h4><ol>'+top.map(t=>`<li><strong>${escapeHtml(t.label)}</strong> - $${parseFloat(t.value.toFixed(2))}</li>`).join('')+'</ol>';
}


let resetTimer=null;
function resetAll(){
  const btn=document.getElementById('reset-btn');
  if(btn.dataset.arm){
    clearTimeout(resetTimer); delete btn.dataset.arm; btn.textContent='⚠ Reset'; btn.classList.remove('armed');
    snapshot();
    const mk=currentMK();
    Object.keys(state.cells).forEach(k=>{ if(k.startsWith(mk+'|')) delete state.cells[k]; });
    if(state.rowsByMonth) delete state.rowsByMonth[mk];
    if(state.colsByMonth) delete state.colsByMonth[mk];
    if(state.monthRowCurrencies) Object.keys(state.monthRowCurrencies).forEach(k=>{ if(k.startsWith(mk+'|')) delete state.monthRowCurrencies[k]; });
    save(); render();
  } else {
    btn.dataset.arm='1'; btn.textContent='⚠ Sure?'; btn.classList.add('armed');
    resetTimer=setTimeout(()=>{delete btn.dataset.arm;btn.textContent='⚠ Reset';btn.classList.remove('armed');},2500);
  }
}


function attachColResize(handle,col){
  handle.addEventListener('mousedown',e=>{
    e.preventDefault();handle.classList.add('dragging');
    const sx=e.clientX,sw=col.width,cEl=document.getElementById('cg-'+col.id);
    const mv=e=>{col.width=Math.max(55,sw+e.clientX-sx);if(cEl)cEl.style.width=col.width+'px';};
    const up=()=>{handle.classList.remove('dragging');save();document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
}
function attachHdrResize(handle){
  handle.addEventListener('mousedown',e=>{
    e.preventDefault();handle.classList.add('dragging');
    const sx=e.clientX,sw=state.headerColWidth,cEl=document.getElementById('cg-hdr');
    const mv=e=>{state.headerColWidth=Math.max(100,sw+e.clientX-sx);if(cEl)cEl.style.width=state.headerColWidth+'px';};
    const up=()=>{handle.classList.remove('dragging');save();document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
}
function attachRowResize(handle,row,tr){
  handle.addEventListener('mousedown',e=>{
    e.preventDefault();handle.classList.add('dragging');
    const sy=e.clientY,sh=row.height||36;
    const mv=e=>{row.height=Math.max(26,sh+e.clientY-sy);tr.style.height=row.height+'px';};
    const up=()=>{handle.classList.remove('dragging');save();document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up);
  });
}


function renderTableHeader(table){
  const cg=document.createElement('colgroup');
  const _mob=window.innerWidth<640;
  const _vw=window.innerWidth;
  // Mobile: label ~43% vw, data cols 115px. Table scrolls ~30px to show Total — better than cramping.
  const _hdrW=_mob?Math.max(150,Math.round(_vw*0.43)):state.headerColWidth||185;
  const _dataW=_mob?115:null;
  const hc=document.createElement('col');hc.id='cg-hdr';hc.style.width=_hdrW+'px';cg.appendChild(hc);
  getCols().forEach(col=>{const c=document.createElement('col');c.id='cg-'+col.id;c.style.width=(_mob?_dataW:col.width||120)+'px';cg.appendChild(c);});
  const tc=document.createElement('col');tc.style.width=(state.totalColWidth||110)+'px';cg.appendChild(tc);
  const dc=document.createElement('col');dc.style.width='32px';cg.appendChild(dc);
  table.appendChild(cg);
  const thead=document.createElement('thead'),htr=document.createElement('tr');
  const corner=document.createElement('th');
  const ci=document.createElement('div');ci.className='th-inner';
  const cl=document.createElement('span');cl.style.cssText='font-weight:600;color:#6b7280;font-size:.83rem;';cl.textContent='Source';ci.appendChild(cl);
  corner.appendChild(ci);
  const chr=document.createElement('div');chr.className='col-resize';attachHdrResize(chr);corner.appendChild(chr);
  htr.appendChild(corner);
  getCols().forEach(col=>{
    const th=document.createElement('th');
    th.dataset.colId=col.id;
    const inner=document.createElement('div');inner.className='th-inner';
    const cdh=document.createElement('span');cdh.className='col-drag-handle';cdh.textContent='⠿';cdh.title='Drag to reorder column';cdh.setAttribute('aria-label','Drag to reorder column');cdh.setAttribute('role','img');
    cdh.addEventListener('pointerdown',e=>{
      e.preventDefault();cdh.setPointerCapture(e.pointerId);_dragColId=col.id;
      const onMove=e=>{
        document.querySelectorAll('.th-drop-before,.th-drop-after').forEach(el=>el.classList.remove('th-drop-before','th-drop-after'));
        const over=document.elementFromPoint(e.clientX,e.clientY);
        const tTh=over&&over.closest('th[data-col-id]');
        if(tTh&&tTh.dataset.colId!==_dragColId){const r=tTh.getBoundingClientRect();tTh.classList.add(e.clientX<r.left+r.width/2?'th-drop-before':'th-drop-after');}
      };
      const onUp=e=>{
        cdh.removeEventListener('pointermove',onMove);cdh.removeEventListener('pointerup',onUp);
        document.querySelectorAll('.th-drop-before,.th-drop-after').forEach(el=>el.classList.remove('th-drop-before','th-drop-after'));
        const over=document.elementFromPoint(e.clientX,e.clientY);
        const tTh=over&&over.closest('th[data-col-id]');
        if(tTh&&tTh.dataset.colId!==_dragColId){
          forkCurrentMonth();const mk2=currentMK();const cols=state.colsByMonth[mk2];
          const fromIdx=cols.findIndex(c=>c.id===_dragColId);
          if(fromIdx!==-1){const r=tTh.getBoundingClientRect();const before=e.clientX<r.left+r.width/2;snapshot();
            const [moved]=cols.splice(fromIdx,1);const insertAt=cols.findIndex(c=>c.id===tTh.dataset.colId);
            cols.splice(insertAt!==-1?(before?insertAt:insertAt+1):cols.length,0,moved);save();render();}
        }
        _dragColId=null;
      };
      cdh.addEventListener('pointermove',onMove);cdh.addEventListener('pointerup',onUp);
    });
    inner.appendChild(cdh);
    const lbl=document.createElement('input');lbl.type='text';lbl.className='th-label';lbl.size=1;lbl.value=col.label;
    lbl.addEventListener('blur',()=>{col.label=lbl.value.trim()||col.label;save();});
    lbl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();lbl.blur();}});
    inner.appendChild(lbl);
    const del=document.createElement('button');del.className='col-del';del.title='Delete column';del.textContent='×';del.setAttribute('aria-label','Delete column');del.addEventListener('click',()=>deleteCol(col.id));inner.appendChild(del);
    th.appendChild(inner);
    const cr=document.createElement('div');cr.className='col-resize';attachColResize(cr,col);th.appendChild(cr);
    htr.appendChild(th);
  });
  const tth=document.createElement('th');tth.className='th-total';
  const thi=document.createElement('div');thi.className='th-inner';
  const thl=document.createElement('span');thl.style.cssText='font-weight:700;color:#166534;font-size:.85rem;';
  thl.textContent='Total';thi.appendChild(thl);tth.appendChild(thi);htr.appendChild(tth);
  const act=document.createElement('th');act.style.cssText='background:#f9fafb;border:1px dashed #d1d5db;';
  const acb=document.createElement('button');acb.className='btn-add-col';acb.textContent='+';acb.title='Add column';acb.addEventListener('click',addCol);act.appendChild(acb);htr.appendChild(act);
  thead.appendChild(htr);table.appendChild(thead);
}

function renderTableBody(table){
  const tbody=document.createElement('tbody');
  function renderRow(row){
    const isChild=!!row.parentId, hasKids=hasChildren(row.id), collapsed=isCollapsed(row.id);
    const tr=document.createElement('tr');tr.style.height=(row.height||36)+'px';tr.dataset.trRowId=row.id;
    if(isChild) tr.classList.add('child-row');
    const rhTd=document.createElement('td');rhTd.className='rh-cell';rhTd.style.backgroundColor=row.color;
    const rhIn=document.createElement('div');rhIn.className='rh-inner';
    if(!isChild){
      const dh=document.createElement('span');dh.className='drag-handle';dh.textContent='⠿';dh.title='Drag to reorder';dh.setAttribute('aria-label','Drag to reorder');dh.setAttribute('role','img');
      dh.addEventListener('pointerdown',e=>{
        e.preventDefault();dh.setPointerCapture(e.pointerId);
        _dragRowId=row.id;tr.classList.add('tr-dragging');
        const onMove=e=>{
          if(_activeDropEl){_activeDropEl.classList.remove('tr-drop-before','tr-drop-after');_activeDropEl=null;}
          const el=document.elementFromPoint(e.clientX,e.clientY);
          const tTr=el&&el.closest('tr[data-row-id]');
          if(tTr&&tTr.dataset.rowId!==_dragRowId){
            const r=tTr.getBoundingClientRect();
            tTr.classList.add(e.clientY<r.top+r.height/2?'tr-drop-before':'tr-drop-after');
            _activeDropEl=tTr;
          }
        };
        const onUp=()=>{
          dh.removeEventListener('pointermove',onMove);dh.removeEventListener('pointerup',onUp);
          tr.classList.remove('tr-dragging');
          const targetEl=_activeDropEl;
          const isBefore=targetEl&&targetEl.classList.contains('tr-drop-before');
          if(_activeDropEl){_activeDropEl.classList.remove('tr-drop-before','tr-drop-after');_activeDropEl=null;}
          if(targetEl){const targetId=targetEl.dataset.rowId;if(targetId&&targetId!==_dragRowId)moveParentRow(_dragRowId,targetId,isBefore);}
          _dragRowId=null;
        };
        dh.addEventListener('pointermove',onMove);dh.addEventListener('pointerup',onUp);
      });
      rhIn.appendChild(dh);
      tr.dataset.rowId=row.id;
    }
    if(hasKids){
      const cb=document.createElement('button');cb.className='collapse-btn';cb.title=collapsed?'Expand':'Collapse';cb.textContent=collapsed?'▸':'▾';
      cb.addEventListener('click',()=>toggleCollapse(row.id));rhIn.appendChild(cb);
    }
    const colorWrap=document.createElement('div');colorWrap.className='color-swatch-wrap tip-host';colorWrap.dataset.tip='Row background colour';
    const swatch=document.createElement('div');swatch.className='color-swatch';swatch.style.backgroundColor=row.color;
    const cInp=document.createElement('input');cInp.type='color';cInp.className='color-inp-overlay';cInp.value=row.color;
    cInp.addEventListener('input',()=>{row.color=cInp.value;rhTd.style.backgroundColor=cInp.value;swatch.style.backgroundColor=cInp.value;textSwatch.style.backgroundColor=cInp.value;});
    cInp.addEventListener('change',save);
    colorWrap.appendChild(swatch);colorWrap.appendChild(cInp);
    const tcWrap=document.createElement('div');tcWrap.className='color-swatch-wrap tip-host';tcWrap.dataset.tip='Row text colour';
    const textSwatch=document.createElement('div');textSwatch.className='text-color-swatch';textSwatch.textContent='A';textSwatch.style.color=row.textColor||'#1f2937';textSwatch.style.backgroundColor=row.color||'#ffffff';
    const tcInp=document.createElement('input');tcInp.type='color';tcInp.className='color-inp-overlay';tcInp.value=row.textColor||'#1f2937';
    tcInp.addEventListener('input',()=>{row.textColor=tcInp.value;rowLabel.style.color=tcInp.value;textSwatch.style.color=tcInp.value;});
    tcInp.addEventListener('change',save);
    tcWrap.appendChild(textSwatch);tcWrap.appendChild(tcInp);
    const rowLabel=document.createElement('input');rowLabel.type='text';rowLabel.className='row-label';rowLabel.size=1;rowLabel.value=row.label;
    rowLabel.style.color=row.textColor||'#1f2937';
    rowLabel.addEventListener('blur',()=>{row.label=rowLabel.value.trim()||row.label;save();});
    rowLabel.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();rowLabel.blur();}});
    rhIn.appendChild(colorWrap);rhIn.appendChild(tcWrap);rhIn.appendChild(rowLabel);
    if(!isChild){
      const dd=document.createElement('div');dd.className='sub-dropdown';
      const addBtn=document.createElement('button');addBtn.className='sub-add-btn';addBtn.textContent='+Sub';addBtn.title='Add sub-source';
      addBtn.addEventListener('click',e=>{e.stopPropagation();showSubMenu(addBtn,row);});
      dd.appendChild(addBtn);rhIn.appendChild(dd);
    }
    if(!isChild){
      const gearBtn=document.createElement('button');
      gearBtn.className='row-gear-btn';gearBtn.textContent='⚙';gearBtn.title='Row options';gearBtn.setAttribute('aria-label','Row options');
      gearBtn.addEventListener('click',e=>{ e.stopPropagation();_openGearMenu(gearBtn,row,rhTd,swatch,textSwatch,isChild); });
      rhIn.appendChild(gearBtn);
    }
    rhTd.appendChild(rhIn);
    const rr=document.createElement('div');rr.className='row-resize';attachRowResize(rr,row,tr);rhTd.appendChild(rr);
    tr.appendChild(rhTd);
    getCols().forEach(col=>{
      const td=document.createElement('td');
      if(hasKids){
        const span=document.createElement('span');span.className='parent-sum';span.id='ps-'+row.id+'-'+col.id;
        const s=children(row.id).reduce((t,c)=>t+getCell(c.id,col.id),0);
        span.title='Sum of sub-sources';
        span.textContent=s>0?fmt(s):'';td.appendChild(span);
      } else {
        const wrap=document.createElement('div'); wrap.className='cost-wrap';
        const inp=document.createElement('input');inp.type='number';inp.min='0';inp.step='0.01';inp.inputMode='decimal';inp.className='num-input c-num';
        const stored=getRawCell(row.id,col.id);inp.value=stored!==''?stored:'';
        inp.addEventListener('input',()=>{ inp.value=inp.value.replace(/[^0-9.]/g,''); });
        inp.addEventListener('focus',()=>snapshot());
        inp.addEventListener('change',()=>{
          if(inp.value===''){
            delete state.cells[ck(row.id,col.id)]; save(); updateAll(row.id); return;
          }
          if(isNaN(parseFloat(inp.value))) return;
          if(parseFloat(inp.value)<0) inp.value='0';
          setCell(row.id,col.id,inp.value);
          ensureRate(rowCurrency(currentMK(), row.id)).then(()=>updateAll(row.id));
        });
        wrap.appendChild(inp);
        const cur=rowCurrency(currentMK(), row.id);
        const sel=document.createElement('select'); sel.className='cell-curr-sel'; sel.title='Currency for this row';
        const codes=getAllUsedCurrencies();
        if(!codes.includes(cur)) codes.push(cur);
        codes.forEach(c=>{ const o=document.createElement('option'); o.value=c; o.textContent=c; if(c===cur) o.selected=true; sel.appendChild(o); });
        const otherOpt=document.createElement('option'); otherOpt.value='__other__'; otherOpt.textContent='Other…'; sel.appendChild(otherOpt);
        sel.addEventListener('change',()=>{
          if(sel.value==='__other__'){ showCellCurrencyOther(wrap,sel,row); return; }
          setRowCurrency(currentMK(), row.id, sel.value);
          ensureRate(sel.value).then(()=>{ updateAll(row.id); renderChart(); });
        });
        wrap.appendChild(sel);
        td.appendChild(wrap);
      }
      tr.appendChild(td);
    });
    const totTd=document.createElement('td');totTd.className='th-total';
    const totSpan=document.createElement('span');totSpan.className='total-val';totSpan.id='rt-'+row.id;
    totSpan.textContent=fmt(rowTotal(row.id));totTd.appendChild(totSpan);tr.appendChild(totTd);
    const delTd=document.createElement('td');delTd.className='del-td';
    const delBtn=document.createElement('button');delBtn.className='row-del';delBtn.title='Delete row';delBtn.setAttribute('aria-label','Delete row');delBtn.textContent='🗑';
    delBtn.addEventListener('click',()=>deleteRow(row.id));delTd.appendChild(delBtn);tr.appendChild(delTd);
    tbody.appendChild(tr);
    if(!isChild&&!collapsed){ children(row.id).forEach(renderRow); }
  }
  getRows().filter(r=>!r.parentId).forEach(renderRow);
  if(getRows().length===0){
    const etr=document.createElement('tr');const etd=document.createElement('td');etd.colSpan=getCols().length+3;
    etd.style.cssText='text-align:center;padding:1.1rem .75rem;color:var(--muted);font-size:.88rem;border:none;';
    etd.textContent='Add your first row to start tracking.';etr.appendChild(etd);tbody.appendChild(etr);
  }
  const atr=document.createElement('tr');const atd=document.createElement('td');atd.colSpan=getCols().length+3;atd.style.cssText='border:none;padding:3px 0;';
  const arb=document.createElement('button');arb.className='btn-add-row';arb.textContent='+ Add Row';arb.addEventListener('click',addRow);
  atd.appendChild(arb);atr.appendChild(atd);tbody.appendChild(atr);
  table.appendChild(tbody);
}

function renderFooter(table){
  const tfoot=document.createElement('tfoot'),ftr=document.createElement('tr');
  const fl=document.createElement('td');fl.style.cssText='font-weight:700;padding:4px 8px;font-size:.85rem;';fl.textContent='TOTAL';ftr.appendChild(fl);
  getCols().forEach(col=>{
    const ftd=document.createElement('td'); ftd.className='week-total-cell';
    const fs=document.createElement('span');fs.className='gtotal-val';fs.id='ct-'+col.id;
    fs.textContent=fmt(colTotal(col.id));
    ftd.appendChild(fs); ftr.appendChild(ftd);
  });
  const gtd=document.createElement('td');gtd.className='gtotal-cell'+(isForecastMonth()?' forecast-total':'');
  const gs=document.createElement('span');gs.className='gtotal-val';gs.id='gt';gs.textContent=fmt(grandTotal());gtd.appendChild(gs);ftr.appendChild(gtd);
  ftr.appendChild(document.createElement('td'));
  tfoot.appendChild(ftr);table.appendChild(tfoot);
}

let _expandedCardId=null;

function render(){
  const _sy=window.scrollY;
  const MOBILE=window.innerWidth<640;
  const sheetWrap=document.getElementById('inc-sheet-wrap');
  const cardsDiv=document.getElementById('inc-mobile-cards');
  const table=document.getElementById('sheet'); table.innerHTML='';
  if(MOBILE){
    if(sheetWrap) sheetWrap.style.display='none';
    if(cardsDiv) cardsDiv.style.display='';
    renderMobileCards();
  } else {
    if(sheetWrap) sheetWrap.style.display='';
    if(cardsDiv) cardsDiv.style.display='none';
    renderTableHeader(table);
    renderTableBody(table);
    renderFooter(table);
  }
  updateSummaryBar();
  if(chartVisible) renderChart();
  adjustBodyWidth();
  updateForecastUI();
  const tbl=document.getElementById('sheet');
  if(tbl) tbl.classList.toggle('forecast',isForecastMonth());
  const hasSubcats=getRows().some(r=>r.parentId);
  const eb=document.getElementById('expand-btn'), cb2=document.getElementById('collapse-btn');
  if(eb) eb.style.display=hasSubcats?'':'none';
  if(cb2) cb2.style.display=hasSubcats?'':'none';
  requestAnimationFrame(function(){window.scrollTo(0,_sy);});
}

function renderMobileCards(){
  const container=document.getElementById('inc-mobile-cards');
  if(!container) return;
  container.innerHTML='';
  const cols=getCols();

  function buildCard(row){
    const isChild=!!row.parentId;
    const hasKids=hasChildren(row.id);
    const canEdit=!hasKids;
    const isExpanded=_expandedCardId===row.id;
    const cur=rowCurrency(currentMK(),row.id);

    const card=document.createElement('div');
    card.className='mc-card'+(isChild?' mc-child':'')+(isExpanded?' mc-active':'');
    card.dataset.rowId=row.id;
    if(row.color) card.style.backgroundColor=row.color;
    if(row.textColor) card.style.setProperty('--row-text',row.textColor);

    const top=document.createElement('div');
    top.className='mc-top'+(isExpanded?'':' mc-top-only');

    const drag=document.createElement('span');drag.className='mc-drag';drag.textContent='⠿';drag.setAttribute('aria-label','Drag to reorder');
    top.appendChild(drag);

    const main=document.createElement('div');main.className='mc-main';
    const hdr=document.createElement('div');hdr.className='mc-hdr';

    const nameEl=document.createElement('span');nameEl.className='mc-name';nameEl.textContent=row.label;
    if(row.textColor) nameEl.style.color=row.textColor;
    hdr.appendChild(nameEl);

    const totalEl=document.createElement('span');totalEl.className='mc-total';totalEl.textContent=fmt(rowTotal(row.id));hdr.appendChild(totalEl);

    const gear=document.createElement('button');gear.className='mc-gear';gear.textContent='⚙';gear.setAttribute('aria-label','Row options');
    gear.addEventListener('click',e=>{e.stopPropagation();_openGearMenu(gear,row,card,null,null,isChild);});
    hdr.appendChild(gear);
    main.appendChild(hdr);

    const weeksEl=document.createElement('div');weeksEl.className='mc-weeks';
    cols.forEach(col=>{
      const wk=document.createElement('div');wk.className='mc-wk';
      const lbl=document.createElement('div');lbl.className='mc-wl';lbl.textContent=col.label;
      const v=getCell(row.id,col.id);
      const val=document.createElement('div');val.className='mc-wv'+(v===0?' mc-wv-empty':'');
      val.textContent=v>0?fmt(v):'—';
      wk.appendChild(lbl);wk.appendChild(val);
      if(v>0){const cc=document.createElement('div');cc.className='mc-wc';cc.textContent=cur;wk.appendChild(cc);}
      weeksEl.appendChild(wk);
    });
    main.appendChild(weeksEl);

    const hint=document.createElement('div');
    if(!canEdit){
      hint.className='mc-hint-subs';hint.textContent='edit via subcategories below';
    } else {
      hint.className='mc-hint-edit';hint.textContent='tap to edit ✏️';
      card.style.cursor='pointer';
      card.addEventListener('click',e=>{
        if(e.target.closest('.mc-gear')) return;
        _expandedCardId=isExpanded?null:row.id;
        renderMobileCards();
      });
    }
    main.appendChild(hint);
    top.appendChild(main);
    card.appendChild(top);

    if(isExpanded){
      const form=document.createElement('div');form.className='mc-form';
      const grid=document.createElement('div');grid.className='mc-form-grid';
      const inputs=[];
      const codes=getAllUsedCurrencies();
      if(!codes.includes(cur)) codes.push(cur);
      cols.forEach(col=>{
        const ef=document.createElement('div');ef.className='mc-ef';
        const lbl=document.createElement('div');lbl.className='mc-el';lbl.textContent=col.label;
        const er=document.createElement('div');er.className='mc-er';
        const inp=document.createElement('input');inp.type='number';inp.inputMode='decimal';inp.className='mc-ei';
        inp.value=getRawCell(row.id,col.id)||'';
        const sel=document.createElement('select');sel.className='mc-ec';
        codes.forEach(c=>{const o=document.createElement('option');o.value=c;o.textContent=c;if(c===cur)o.selected=true;sel.appendChild(o);});
        er.appendChild(inp);er.appendChild(sel);
        inputs.push({inp,sel,col});
        ef.appendChild(lbl);ef.appendChild(er);grid.appendChild(ef);
      });
      form.appendChild(grid);
      const btns=document.createElement('div');btns.className='mc-ebtns';
      const cancelBtn=document.createElement('button');cancelBtn.className='mc-ecancel';cancelBtn.textContent='Cancel';
      cancelBtn.addEventListener('click',e=>{e.stopPropagation();_expandedCardId=null;renderMobileCards();});
      const saveBtn=document.createElement('button');saveBtn.className='mc-esave';saveBtn.textContent='Save';
      saveBtn.addEventListener('click',e=>{
        e.stopPropagation();
        snapshot();
        const newCur=inputs[0].sel.value;
        setRowCurrency(currentMK(),row.id,newCur);
        inputs.forEach(({inp,col})=>{
          const v=inp.value.trim();
          if(v===''||isNaN(parseFloat(v))) delete state.cells[ck(row.id,col.id)];
          else state.cells[ck(row.id,col.id)]=v;
        });
        _expandedCardId=null;
        save();
        ensureRate(newCur).then(()=>render());
      });
      btns.appendChild(cancelBtn);btns.appendChild(saveBtn);form.appendChild(btns);
      card.appendChild(form);
      setTimeout(()=>{ const first=form.querySelector('.mc-ei'); if(first) first.focus(); },50);
    }

    container.appendChild(card);
  }

  getRows().filter(r=>!r.parentId).forEach(row=>{
    buildCard(row);
    if(!isCollapsed(row.id)) children(row.id).forEach(buildCard);
  });

  if(_expandedCardId){
    container.querySelectorAll('.mc-card').forEach(c=>{
      if(c.dataset.rowId!==_expandedCardId) c.classList.add('mc-dim');
    });
  }
}


function adjustBodyWidth(){
  const naturalWidth=(state.headerColWidth||185)
    +getCols().reduce((s,c)=>s+(c.width||120),0)
    +(state.totalColWidth||110)+32;
  const cap=Math.min(window.innerWidth*0.95,1500);
  document.body.style.maxWidth=naturalWidth>900?Math.min(naturalWidth+60,cap)+'px':'';
}
window.addEventListener('resize',adjustBodyWidth);
let _resizeRenderTimer=null;
let _lastRenderW=window.innerWidth;
window.addEventListener('resize',()=>{
  // Only re-render when WIDTH changes (keyboard open/close only changes height — re-rendering
  // on height-only resize destroys the focused input and closes the keyboard immediately).
  const w=window.innerWidth;
  if(w===_lastRenderW) return;
  _lastRenderW=w;
  clearTimeout(_resizeRenderTimer);
  _resizeRenderTimer=setTimeout(()=>render(),300);
});


function expPad(s,n){ s=String(s); return s.length>=n?s:s+' '.repeat(n-s.length); }
function expCsvEsc(v){
  const s=String(v==null?'':v);
  return /[,"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}

function buildRowsArray(){
  const colLabels=getCols().map(c=>c.label);
  const header=['Source','Sub-source',...colLabels,'Total'];
  const out=[header];
  getRows().filter(r=>!r.parentId).forEach(parent=>{
    const kids=children(parent.id);
    if(kids.length){
      const vals=getCols().map(col=>{
        const s=kids.reduce((t,c)=>t+getCell(c.id,col.id),0);
        return s?s.toFixed(2):'';
      });
      out.push([parent.label,'',...vals,rowTotal(parent.id).toFixed(2)]);
      kids.forEach(kid=>{
        const kVals=getCols().map(col=>{ const v=getCell(kid.id,col.id); return v?v.toFixed(2):''; });
        out.push(['',kid.label,...kVals,rowTotal(kid.id).toFixed(2)]);
      });
    } else {
      const vals=getCols().map(col=>{ const v=getCell(parent.id,col.id); return v?v.toFixed(2):''; });
      out.push([parent.label,'',...vals,rowTotal(parent.id).toFixed(2)]);
    }
  });
  const totals=getCols().map(col=>colTotal(col.id).toFixed(2));
  out.push(['TOTAL','',...totals,grandTotal().toFixed(2)]);
  return out;
}

function buildCsv(){
  return buildRowsArray().map(r=>r.map(expCsvEsc).join(',')).join('\r\n');
}
function buildJson(){
  const mk2=currentMK();
  const topRows=getRows().filter(r=>!r.parentId);
  const rowsOut=topRows.map(parent=>{
    const kids=children(parent.id);
    const colVals={};
    getCols().forEach(col=>{ colVals[col.label]=getCell(parent.id,col.id)||undefined; });
    return {
      label:parent.label,color:parent.color,textColor:parent.textColor,
      total:rowTotal(parent.id),amounts:colVals,
      subsources:kids.map(kid=>{
        const kv={};
        getCols().forEach(col=>{ kv[col.label]=getCell(kid.id,col.id)||undefined; });
        return {label:kid.label,total:rowTotal(kid.id),amounts:kv};
      })
    };
  });
  return JSON.stringify({
    month:mk2,
    monthName:MONTHS_FULL[state.currentMonth]+' '+state.currentYear,
    columns:getCols().map(c=>c.label),
    rows:rowsOut,
    totals:{grand:grandTotal(),perColumn:Object.fromEntries(getCols().map(col=>[col.label,colTotal(col.id)]))}
  },null,2);
}
function buildTxt(){
  const rows=buildRowsArray();
  const widths=rows[0].map((_,ci)=>Math.max(...rows.map(r=>String(r[ci]||'').length)));
  const sep=widths.map(w=>'-'.repeat(w+2)).join('+');
  return rows.map((r,ri)=>{
    const line='|'+r.map((v,ci)=>' '+expPad(v,widths[ci])+' ').join('|')+'|';
    return ri===0||ri===rows.length-1?sep+'\n'+line+'\n'+sep:line;
  }).join('\n');
}
function buildTsv(){
  return buildRowsArray()
    .map(r=>r.map(v=>String(v==null?'':v).replace(/[\t\r\n]/g,' ')).join('\t'))
    .join('\r\n');
}

function gmailHref(subject, body){
  return 'https://mail.google.com/mail/?view=cm&fs=1&tf=1'
       + '&su='+encodeURIComponent(subject)
       + '&body='+encodeURIComponent(body);
}

function clipboardWrite(text){
  if(navigator.clipboard){
    return navigator.clipboard.writeText(text).then(()=>true).catch(()=>fallback());
  }
  return Promise.resolve(fallback());
  function fallback(){
    const tmp=document.createElement('textarea');
    tmp.value=text;tmp.style.position='fixed';tmp.style.opacity='0';
    document.body.appendChild(tmp);tmp.select();
    let ok=false;try{ok=document.execCommand('copy');}catch{}
    tmp.remove();return ok;
  }
}

function showExportFlash(msg){
  const f=document.getElementById('export-flash');if(!f) return;
  f.textContent=msg;f.classList.add('show');
  clearTimeout(window._exportFlashT);
  window._exportFlashT=setTimeout(()=>f.classList.remove('show'),2500);
}



function encodeBlob(obj){
  return 'FIAPP-'+obj.kind+'-V1:'+btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
}
function decodeBlob(str){
  const m=String(str).trim().match(/^FIAPP-([A-Z\-]+)-V1:([A-Za-z0-9+/=]+)\s*$/);
  if(!m) throw new Error('Not a FiApp paste-blob.');
  let obj;
  try{ obj=JSON.parse(decodeURIComponent(escape(atob(m[2])))); }
  catch(e){ throw new Error('Blob is corrupted or incomplete - could not decode.'); }
  if(typeof obj!=='object'||obj===null) throw new Error('Invalid blob: unexpected format.');
  if(obj.kind!==m[1]) throw new Error('Blob kind mismatch.');
  if(!Array.isArray(obj.rows)) throw new Error('Invalid blob: missing rows array.');
  if(!Array.isArray(obj.cols)) throw new Error('Invalid blob: missing cols array.');
  if(obj.kind==='INC-MONTH'){
    if(typeof obj.cells!=='object'||Array.isArray(obj.cells)) throw new Error('Invalid blob: bad cells object.');
    if(typeof obj.monthKey!=='string') throw new Error('Invalid blob: missing monthKey.');
  }
  if(obj.kind==='INC-FULL'){
    if(typeof obj.cellsByMonth!=='object'||Array.isArray(obj.cellsByMonth)) throw new Error('Invalid blob: bad cellsByMonth.');
  }
  if(obj.rows.length>500)  throw new Error('Blob rejected: too many rows (max 500).');
  if(obj.cols.length>52)   throw new Error('Blob rejected: too many columns (max 52).');
  if(obj.kind==='INC-FULL'){
    let totalCells=0;
    Object.values(obj.cellsByMonth).forEach(mc=>{ if(mc&&typeof mc==='object') totalCells+=Object.keys(mc).length; });
    if(totalCells>50000) throw new Error('Blob rejected: too many cells (max 50,000).');
    if(Object.keys(obj.cellsByMonth).length>120) throw new Error('Blob rejected: too many months (max 120).');
  } else if(obj.cells){
    if(Object.keys(obj.cells).length>50000) throw new Error('Blob rejected: too many cells (max 50,000).');
  }
  return obj;
}

function buildIncMonthBlob(){
  const mk2=currentMK();
  const cells={};
  Object.keys(state.cells).forEach(k=>{ if(k.startsWith(mk2+'|')) cells[k]=state.cells[k]; });
  const rowCurrencies={};
  Object.keys(state.monthRowCurrencies||{}).forEach(k=>{ if(k.startsWith(mk2+'|')) rowCurrencies[k]=state.monthRowCurrencies[k]; });
  const rowsByMonth={}; if(state.rowsByMonth&&state.rowsByMonth[mk2]) rowsByMonth[mk2]=JSON.parse(JSON.stringify(state.rowsByMonth[mk2]));
  const colsByMonth={}; if(state.colsByMonth&&state.colsByMonth[mk2]) colsByMonth[mk2]=JSON.parse(JSON.stringify(state.colsByMonth[mk2]));
  return {
    kind:'INC-MONTH', v:1, monthKey:mk2,
    rows:JSON.parse(JSON.stringify(getRows())),
    cols:JSON.parse(JSON.stringify(getCols())),
    rowsByMonth, colsByMonth,
    cells,
    rowCurrencies,
    headerColWidth:state.headerColWidth, totalColWidth:state.totalColWidth,
  };
}
function buildIncFullBlob(){
  const cellsByMonth={};
  Object.keys(state.cells).forEach(k=>{
    const mk2=k.split('|')[0];
    (cellsByMonth[mk2]=cellsByMonth[mk2]||{})[k]=state.cells[k];
  });
  return {
    kind:'INC-FULL', v:1,
    rows:JSON.parse(JSON.stringify(state.rows)),
    cols:JSON.parse(JSON.stringify(state.cols)),
    rowsByMonth:JSON.parse(JSON.stringify(state.rowsByMonth||{})),
    colsByMonth:JSON.parse(JSON.stringify(state.colsByMonth||{})),
    cellsByMonth,
    collapsed:JSON.parse(JSON.stringify(state.collapsed||{})),
    rowCurrencies:JSON.parse(JSON.stringify(state.monthRowCurrencies||{})),
    displayCurrency:state.displayCurrency||'USD',
    headerColWidth:state.headerColWidth, totalColWidth:state.totalColWidth,
    currentYear:state.currentYear, currentMonth:state.currentMonth,
  };
}

function _mergeRowsCols(blobRows, blobCols){
  const labelToId={};
  state.rows.forEach(r=>{ if(!r.parentId) labelToId[r.label]=r.id; });
  const childKeyToId={};
  state.rows.forEach(r=>{
    if(r.parentId){
      const parent=state.rows.find(x=>x.id===r.parentId);
      if(parent) childKeyToId[parent.label+'|'+r.label]=r.id;
    }
  });
  const blobRowIdMap={};
  blobRows.filter(r=>!r.parentId).forEach(br=>{
    if(labelToId[br.label]){
      blobRowIdMap[br.id]=labelToId[br.label];
    } else {
      const newId=uid();
      const nr=Object.assign({},br,{id:newId});
      state.rows.push(nr);
      blobRowIdMap[br.id]=newId;
      labelToId[br.label]=newId;
    }
  });
  blobRows.filter(r=>r.parentId).forEach(br=>{
    const blobParent=blobRows.find(p=>p.id===br.parentId);
    const parentLabel=blobParent?blobParent.label:'';
    const localParentId=blobRowIdMap[br.parentId];
    const key=parentLabel+'|'+br.label;
    if(childKeyToId[key]){
      blobRowIdMap[br.id]=childKeyToId[key];
    } else {
      const newId=uid();
      const nr=Object.assign({},br,{id:newId,parentId:localParentId});
      const parentIdx=state.rows.findIndex(r=>r.id===localParentId);
      const lastKidIdx=state.rows.reduce((acc,r,i)=>r.parentId===localParentId?i:acc, parentIdx);
      state.rows.splice(lastKidIdx+1,0,nr);
      blobRowIdMap[br.id]=newId;
      childKeyToId[key]=newId;
    }
  });
  const colLblToId={};
  state.cols.forEach(c=>colLblToId[c.label]=c.id);
  const blobColIdMap={};
  blobCols.forEach(bc=>{
    if(colLblToId[bc.label]) blobColIdMap[bc.id]=colLblToId[bc.label];
    else {
      const newId=uid();
      const nc=Object.assign({},bc,{id:newId});
      state.cols.push(nc);
      blobColIdMap[bc.id]=newId;
      colLblToId[bc.label]=newId;
    }
  });
  return {blobRowIdMap, blobColIdMap};
}

function importIncMonth(blob){
  const mk2=currentMK();
  Object.keys(state.cells).forEach(k=>{ if(k.startsWith(mk2+'|')) delete state.cells[k]; });
  const {blobRowIdMap, blobColIdMap}=_mergeRowsCols(blob.rows||[], blob.cols||[]);
  Object.entries(blob.cells||{}).forEach(([k,v])=>{
    const parts=k.split('|');
    const rId=blobRowIdMap[parts[1]], cId=blobColIdMap[parts[2]];
    if(rId&&cId) state.cells[mk2+'|'+rId+'|'+cId]=v;
  });
  if(blob.rowsByMonth&&blob.rowsByMonth[blob.monthKey]){
    if(!state.rowsByMonth) state.rowsByMonth={};
    state.rowsByMonth[mk2]=JSON.parse(JSON.stringify(blob.rowsByMonth[blob.monthKey]));
  }
  if(blob.colsByMonth&&blob.colsByMonth[blob.monthKey]){
    if(!state.colsByMonth) state.colsByMonth={};
    state.colsByMonth[mk2]=JSON.parse(JSON.stringify(blob.colsByMonth[blob.monthKey]));
  }
}

function importIncFull(blob, selectedMonths){
  const {blobRowIdMap, blobColIdMap}=_mergeRowsCols(blob.rows||[], blob.cols||[]);
  if(blob.rowsByMonth){ if(!state.rowsByMonth) state.rowsByMonth={}; Object.assign(state.rowsByMonth, JSON.parse(JSON.stringify(blob.rowsByMonth))); }
  if(blob.colsByMonth){ if(!state.colsByMonth) state.colsByMonth={}; Object.assign(state.colsByMonth, JSON.parse(JSON.stringify(blob.colsByMonth))); }
  selectedMonths.forEach(mk2=>{
    Object.keys(state.cells).forEach(k=>{ if(k.startsWith(mk2+'|')) delete state.cells[k]; });
    const blobMonthCells=(blob.cellsByMonth||{})[mk2]||{};
    Object.entries(blobMonthCells).forEach(([k,v])=>{
      const parts=k.split('|');
      const rId=blobRowIdMap[parts[1]], cId=blobColIdMap[parts[2]];
      if(rId&&cId) state.cells[mk2+'|'+rId+'|'+cId]=v;
    });
  });
}


function openPasteModal(){
  const overlay=document.createElement('div');overlay.className='share-overlay';
  const modal=document.createElement('div');modal.className='share-modal';
  const h=document.createElement('h3');h.textContent='Paste FiApp income data';
  const desc=document.createElement('span');desc.className='share-hint';desc.textContent='Paste a FIAPP-INC-… block copied from another Income Tracker. Pastes are undoable with Ctrl+Z.';
  const ta=document.createElement('textarea');ta.placeholder='Paste FIAPP-INC-… block here';
  const status=document.createElement('div');status.className='paste-status';status.textContent='Waiting for input…';
  const actions=document.createElement('div');actions.className='share-actions';
  const applyBtn=document.createElement('button');applyBtn.className='btn btn-sm';applyBtn.textContent='Apply';applyBtn.disabled=true;
  const cancelBtn=document.createElement('button');cancelBtn.className='btn btn-sm btn-ghost';cancelBtn.textContent='Cancel';
  let parsed=null;
  function refresh(){
    const v=ta.value.trim();
    if(!v){ status.textContent='Waiting for input…'; status.className='paste-status'; applyBtn.disabled=true; parsed=null; return; }
    try{
      const obj=decodeBlob(v);
      parsed=obj;
      let label='';
      if(obj.kind==='INC-MONTH'){
        const [yy,mm]=obj.monthKey.split('-');
        label='This month - '+MONTHS_FULL[parseInt(mm,10)-1]+' '+yy;
      } else if(obj.kind==='INC-FULL'){
        const months=Object.keys(obj.cellsByMonth||{}).filter(k=>Object.keys(obj.cellsByMonth[k]).length).length;
        if(months===0){
          status.textContent='⚠ This blob has no month data - the income tracker was empty when it was copied.';
          status.className='paste-status bad';
          applyBtn.disabled=true;
          parsed=null;
          return;
        }
        label='Full data - '+months+' month'+(months===1?'':'s');
      } else {
        throw new Error('This blob is from a different tracker ('+obj.kind+'). Open the matching tracker page to paste it.');
      }
      status.textContent='Detected: '+label;status.className='paste-status ok';applyBtn.disabled=false;
    }catch(err){
      status.textContent='⚠ '+err.message+' Make sure you copied the entire FIAPP-… line.';
      status.className='paste-status bad';applyBtn.disabled=true;parsed=null;
    }
  }
  ta.addEventListener('input',refresh);
  ta.addEventListener('paste',()=>setTimeout(refresh,30));
  applyBtn.addEventListener('click',()=>{
    if(!parsed) return;
    if(parsed.kind==='INC-MONTH'){
      snapshot();importIncMonth(parsed);save();render();
      overlay.remove();showExportFlash('✓ Pasted (this month)');
    } else if(parsed.kind==='INC-FULL'){
      overlay.remove();showMonthPicker(parsed);
    }
  });
  cancelBtn.addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  actions.appendChild(applyBtn);actions.appendChild(cancelBtn);
  modal.appendChild(h);modal.appendChild(desc);modal.appendChild(ta);modal.appendChild(status);modal.appendChild(actions);
  overlay.appendChild(modal);document.body.appendChild(overlay);
  setTimeout(()=>ta.focus(),20);
}

function showMonthPicker(blob){
  const overlay=document.createElement('div');overlay.className='share-overlay';
  const modal=document.createElement('div');modal.className='share-modal';
  const h=document.createElement('h3');h.textContent='Choose months to overwrite';
  const desc=document.createElement('span');desc.className='share-hint';desc.textContent='Pick which months from the pasted blob to apply. Months you don\'t pick stay untouched.';
  const months=Object.keys(blob.cellsByMonth||{}).filter(k=>Object.keys(blob.cellsByMonth[k]).length).sort();
  const tools=document.createElement('div');tools.className='picker-tools';
  const allBtn=document.createElement('button');allBtn.textContent='All';
  const noneBtn=document.createElement('button');noneBtn.textContent='None';
  tools.appendChild(allBtn);tools.appendChild(noneBtn);
  const list=document.createElement('div');list.className='month-picker';
  const checks=[];
  months.forEach(mk2=>{
    const lbl=document.createElement('label');
    const cb=document.createElement('input');cb.type='checkbox';cb.checked=true;cb.value=mk2;
    const [yy,mm]=mk2.split('-');
    const cellCount=Object.keys(blob.cellsByMonth[mk2]).length;
    lbl.appendChild(cb);
    lbl.appendChild(document.createTextNode(' '+MONTHS_FULL[parseInt(mm,10)-1]+' '+yy+'   ('+cellCount+' values)'));
    list.appendChild(lbl);checks.push(cb);
  });
  allBtn.addEventListener('click',()=>checks.forEach(c=>c.checked=true));
  noneBtn.addEventListener('click',()=>checks.forEach(c=>c.checked=false));
  const actions=document.createElement('div');actions.className='share-actions';
  const applyBtn=document.createElement('button');applyBtn.className='btn btn-sm';applyBtn.textContent='Apply selected';
  const cancelBtn=document.createElement('button');cancelBtn.className='btn btn-sm btn-ghost';cancelBtn.textContent='Cancel';
  applyBtn.addEventListener('click',()=>{
    const sel=checks.filter(c=>c.checked).map(c=>c.value);
    if(!sel.length){ showToast('Pick at least one month, or click Cancel.'); return; }
    snapshot();importIncFull(blob,sel);save();render();
    overlay.remove();showExportFlash('✓ Pasted '+sel.length+' month'+(sel.length===1?'':'s'));
  });
  cancelBtn.addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});
  actions.appendChild(applyBtn);actions.appendChild(cancelBtn);
  modal.appendChild(h);modal.appendChild(desc);modal.appendChild(tools);modal.appendChild(list);modal.appendChild(actions);
  overlay.appendChild(modal);document.body.appendChild(overlay);
}

function downloadBlob(filename, blob){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=filename;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}
function downloadText(filename, text, mime){
  downloadBlob(filename,new Blob([text],{type:mime||'text/plain;charset=utf-8'}));
}

let _xlsxLoaded=false,_xlsxLoading=null;
function lazyLoadXlsx(){
  if(_xlsxLoaded) return Promise.resolve();
  if(_xlsxLoading) return _xlsxLoading;
  _xlsxLoading=new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload=()=>{_xlsxLoaded=true;res();};
    s.onerror=()=>rej(new Error('Failed to load XLSX library'));
    document.head.appendChild(s);
  });
  return _xlsxLoading;
}
function exportXlsx(filename){
  lazyLoadXlsx().then(()=>{
    const ws=XLSX.utils.aoa_to_sheet(buildRowsArray());
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,ws,'Income');
    XLSX.writeFile(wb,filename);
  }).catch(err=>showToast('Could not load XLSX library: '+err.message));
}

let _openExportMenu=null;
function closeExportMenu(){
  if(_openExportMenu){_openExportMenu.remove();_openExportMenu=null;}
  document.removeEventListener('click',closeExportMenu,true);
}
function showExportMenu(ev){
  ev.stopPropagation();
  if(_openExportMenu){closeExportMenu();return;}
  const ym=String(state.currentYear)+'-'+String(state.currentMonth+1).padStart(2,'0');
  const base='income-'+ym;
  const menu=document.createElement('div');menu.className='export-menu';
  const formats=[
    {label:'📄 CSV',  fn:()=>downloadText(base+'.csv',buildCsv(),'text/csv;charset=utf-8')},
    {label:'{ } JSON',fn:()=>downloadText(base+'.json',buildJson(),'application/json')},
    {label:'📃 TXT',  fn:()=>downloadText(base+'.txt',buildTxt(),'text/plain;charset=utf-8')},
    {label:'📊 XLSX', fn:()=>exportXlsx(base+'.xlsx')},
    {label:'📋 Copy table - This month', fn:()=>clipboardWrite(encodeBlob(buildIncMonthBlob())).then(ok=>showExportFlash(ok?'✓ Copied (this month)':'Copy failed'))},
    {label:'📋 Copy table - Full data',  fn:()=>clipboardWrite(encodeBlob(buildIncFullBlob())).then(ok=>showExportFlash(ok?'✓ Copied (full)':'Copy failed'))},
  ];
  formats.forEach(f=>{
    const btn=document.createElement('button');btn.textContent=f.label;
    btn.addEventListener('click',e=>{e.stopPropagation();closeExportMenu();f.fn();});
    menu.appendChild(btn);
  });
  const rect=ev.currentTarget.getBoundingClientRect();
  menu.style.top=(rect.bottom+4)+'px';
  menu.style.left=rect.left+'px';
  document.body.appendChild(menu);
  _openExportMenu=menu;
  if(menu.getBoundingClientRect().bottom > window.innerHeight - 8){
    menu.style.top=(rect.top - menu.offsetHeight - 4)+'px';
  }
  setTimeout(()=>document.addEventListener('click',closeExportMenu,true),50);
}

async function shareSheet(){
  const text=buildTxt();
  const title='FiApp Income - '+MONTHS_SHORT[state.currentMonth]+' '+state.currentYear;
  const isMobile=/Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  if(isMobile&&navigator.share){
    try{await navigator.share({title,text});return;}catch(e){if(e.name==='AbortError')return;}
  }
  showShareModal(title,text);
}
function showShareModal(title,text){
  const overlay=document.createElement('div');overlay.className='share-overlay';
  const modal=document.createElement('div');modal.className='share-modal';
  const h=document.createElement('h3');h.textContent='Share - '+title;
  const ta=document.createElement('textarea');ta.readOnly=true;ta.value=text;
  const hint=document.createElement('span');hint.className='share-hint';
  hint.textContent='Copy puts a tab-separated version on your clipboard - pastes cleanly into Word, Docs, Excel and Sheets.';

  const tsv=buildTsv();
  const MAX_BODY=1500;
  const bodyText=text.length>MAX_BODY?text.slice(0,MAX_BODY)+'\n…(truncated - use Export for full data)':text;

  const actions=document.createElement('div');actions.className='share-actions';
  const flash=document.createElement('span');flash.className='share-flash';

  const copyBtn=document.createElement('button');copyBtn.className='btn btn-sm';copyBtn.textContent='📋 Copy';
  copyBtn.addEventListener('click',()=>{
    clipboardWrite(tsv).then(ok=>{
      flash.textContent=ok?'Copied (TSV)!':'Copy failed';
      setTimeout(()=>flash.textContent='',1800);
    });
  });

  const emailTextBtn=document.createElement('a');emailTextBtn.className='btn btn-sm';emailTextBtn.textContent='📧 Email as Text';
  emailTextBtn.href=gmailHref(title,bodyText);emailTextBtn.target='_blank';emailTextBtn.rel='noopener noreferrer';

  const ym=String(state.currentYear)+'-'+String(state.currentMonth+1).padStart(2,'0');
  const xlsxBody='I\'m sharing my FiApp income spreadsheet. Open FiApp at https://fiapp.onrender.com/income to view your own data.\n\nAttached XLSX file (saved to your Downloads folder): income-'+ym+'.xlsx';
  const emailXlsxBtn=document.createElement('a');emailXlsxBtn.className='btn btn-sm';emailXlsxBtn.textContent='📧 Email as XLSX';
  emailXlsxBtn.href=gmailHref(title,xlsxBody);emailXlsxBtn.target='_blank';emailXlsxBtn.rel='noopener noreferrer';
  emailXlsxBtn.addEventListener('click',()=>{
    exportXlsx('income-'+ym+'.xlsx');
    flash.textContent='XLSX downloading - drag it into Gmail to attach.';
    setTimeout(()=>flash.textContent='',5000);
  });

  const blobStr=encodeBlob(buildIncMonthBlob());
  const blobBody='Here is my income data for '+MONTHS_SHORT[state.currentMonth]+' '+state.currentYear+'.\n\nPaste this block into the FiApp Income Tracker at https://fiapp.onrender.com/income using the 📋 Paste button to load the data:\n\n'+blobStr;
  const emailBlobBtn=document.createElement('a');emailBlobBtn.className='btn btn-sm';emailBlobBtn.textContent='📧 Email as FiApp Paste-link';
  emailBlobBtn.href=gmailHref(title,blobBody.slice(0,2000));emailBlobBtn.target='_blank';emailBlobBtn.rel='noopener noreferrer';

  const closeBtn=document.createElement('button');closeBtn.className='btn btn-sm btn-ghost';closeBtn.textContent='Close';
  closeBtn.addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});

  actions.appendChild(flash);actions.appendChild(copyBtn);actions.appendChild(emailTextBtn);actions.appendChild(emailXlsxBtn);actions.appendChild(emailBlobBtn);
  actions.appendChild(closeBtn);
  modal.appendChild(h);modal.appendChild(ta);modal.appendChild(hint);modal.appendChild(actions);
  overlay.appendChild(modal);document.body.appendChild(overlay);
}


(()=>{
  const tip=document.createElement('div');tip.id='swatch-tip';document.body.appendChild(tip);
  document.addEventListener('mouseover',e=>{
    const host=e.target.closest('.tip-host[data-tip]');
    if(!host||!host.closest('.rh-inner')){tip.classList.remove('show');return;}
    tip.textContent=host.dataset.tip;
    const r=host.getBoundingClientRect();
    tip.style.left=(r.left+r.width/2)+'px';
    tip.style.top=(r.top-8)+'px';
    tip.style.transform='translate(-50%,-100%)';
    tip.classList.add('show');
  });
  document.addEventListener('mouseout',e=>{
    const host=e.target.closest('.tip-host[data-tip]');
    if(host&&host.closest('.rh-inner')) tip.classList.remove('show');
  });
  document.addEventListener('touchstart',e=>{
    const host=e.target.closest('.tip-host[data-tip]');
    if(!host||!host.closest('.rh-inner')){tip.classList.remove('show');return;}
    tip.textContent=host.dataset.tip;
    const r=host.getBoundingClientRect();
    tip.style.left=(r.left+r.width/2)+'px';
    tip.style.top=(r.top-8)+'px';
    tip.style.transform='translate(-50%,-100%)';
    tip.classList.add('show');
  },{passive:true});
  document.addEventListener('touchend',e=>{
    setTimeout(()=>{ tip.classList.remove('show'); },600);
  },{passive:true});
})();

function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
function _esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML;}

(async()=>{
  try{
    const me=await fetch('/auth/me').then(r=>r.json());
    window.__currentUser=me.username||null;
    const badge=document.getElementById('auth-badge-container');
    if(badge){
      if(me.username){
        badge.innerHTML='<div class="acct-menu-wrap">'
          +'<button class="btn-ghost btn-sm" id="dyn-acct-menu-btn">👤 '+_esc(me.username)+'</button>'
          +'<div class="acct-dropdown">'
          +'<a href="/account" class="acct-item">⚙ Account settings</a>'
          +'<button class="acct-item acct-logout" id="dyn-logout-btn">⬅ Log out</button>'
          +'</div>'
          +'</div>';
        var _dynAcct=document.getElementById('dyn-acct-menu-btn');
        if(_dynAcct) _dynAcct.addEventListener('click',function(e){toggleAcctMenu(e.currentTarget);});
        var _dynLogout=document.getElementById('dyn-logout-btn');
        if(_dynLogout) _dynLogout.addEventListener('click',function(e){logOutStep(e.currentTarget);});
      } else {
        badge.innerHTML='<a class="btn-ghost btn-sm" href="/login">Log in</a>';
      }
    }
  }catch(e){ window.__currentUser=null; }
  if(!window.__currentUser) setSyncStatus('Offline','');
  try{ await loadFromServer(); }catch(e){ console.warn('FiApp: loadFromServer failed',e); }
  try{ state=loadState(); }catch(e){ console.warn('FiApp: loadState failed',e); state=freshState(); }
  try{ loadHistory(); }catch(e){}
  try{ updateHistBtns(); }catch(e){}
  try{ updateMonthNav(); }catch(e){ console.error('FiApp: updateMonthNav failed',e); }

  try{
    const dc=state.displayCurrency||'USD';
    const dcSel=document.getElementById('curr-sel');
    if(dc!=='USD'&&dcSel){
      if(![...dcSel.options].find(o=>o.value===dc)){
        const opt=document.createElement('option'); opt.value=dc; opt.textContent=dc; opt.dataset.custom='1';
        dcSel.insertBefore(opt, dcSel.querySelector('option[value="__other__"]'));
      }
      dcSel.value=dc;
      ensureRate(dc).then(()=>{
        if(ratesCache[dc]){
          const cn=document.getElementById('curr-note'); if(cn) cn.textContent='1 USD = '+ratesCache[dc].toFixed(4)+' '+dc;
          showConvFields(dc,ratesCache[dc]);
        }
      }).catch(()=>{});
    }
  }catch(e){ console.warn('FiApp: currency init failed',e); }

  try{
    const usedCurs=[...new Set(Object.values(state.monthRowCurrencies||{}).filter(c=>c&&c!=='USD'))];
    if(usedCurs.length) await fetchAndCacheUSDRates();
  }catch(e){}
  try{ render(); }catch(e){ console.error('FiApp: render failed',e); }
})();

function openHelp(){ document.getElementById('help-modal').style.display='flex'; }
function closeHelp(){ document.getElementById('help-modal').style.display='none'; }
function toggleDropdown(id, e){
  e && e.stopPropagation();
  const menu = document.getElementById(id+'-menu');
  const isOpen = menu.classList.contains('open');
  document.querySelectorAll('.dropdown-menu.open').forEach(m=>m.classList.remove('open'));
  if(!isOpen) menu.classList.add('open');
}
function closeDropdown(id){ document.getElementById(id+'-menu').classList.remove('open'); }
document.addEventListener('click', ()=>{ document.querySelectorAll('.dropdown-menu.open').forEach(m=>m.classList.remove('open')); });
document.addEventListener('keydown',function(e){ if(e.key==='Escape') document.querySelectorAll('.dropdown-menu.open').forEach(function(m){m.classList.remove('open');}); });

// Static toolbar event wiring (replaces onclick= attributes)
document.getElementById('help-open-btn').addEventListener('click',openHelp);
document.getElementById('guide-btn').addEventListener('click',function(){wtStartEnhanced('income');});
document.getElementById('prev-btn').addEventListener('click',function(){shiftMonth(-1);});
document.getElementById('next-btn').addEventListener('click',function(){shiftMonth(1);});
document.getElementById('copy-prev-btn').addEventListener('click',copyStructureFromPrevMonth);
document.getElementById('copy-month-btn').addEventListener('click',showMonthCopyPicker);
document.getElementById('copy-to-toggle').addEventListener('click',function(e){openCopyToDropdown(e);});
document.getElementById('forecast-copy-last-btn').addEventListener('click',copyLastMonth);
document.getElementById('forecast-avg-btn').addEventListener('click',useAverages);
document.getElementById('curr-other-btn').addEventListener('click',applyOtherCurrency);
document.getElementById('undo-btn').addEventListener('click',undo);
document.getElementById('redo-btn').addEventListener('click',redo);
document.getElementById('dd-table-toggle').addEventListener('click',function(e){toggleDropdown('dd-table',e);});
document.getElementById('add-row-btn').addEventListener('click',function(){addRow();closeDropdown('dd-table');});
document.getElementById('add-col-btn').addEventListener('click',function(){addCol();closeDropdown('dd-table');});
document.getElementById('dd-share-toggle').addEventListener('click',function(e){toggleDropdown('dd-share',e);});
document.getElementById('share-btn').addEventListener('click',function(){shareSheet();closeDropdown('dd-share');});
document.getElementById('export-btn').addEventListener('click',function(e){showExportMenu(e);closeDropdown('dd-share');});
document.getElementById('paste-btn').addEventListener('click',function(){openPasteModal();closeDropdown('dd-share');});
document.getElementById('expand-btn').addEventListener('click',expandAll);
document.getElementById('collapse-btn').addEventListener('click',collapseAll);
document.getElementById('reset-btn').addEventListener('click',resetAll);
document.getElementById('chart-mode-m').addEventListener('click',function(){setChartMode('monthly');});
document.getElementById('chart-mode-y').addEventListener('click',function(){setChartMode('yearly');});
document.getElementById('chart-type-bar').addEventListener('click',function(){setChartType('bar');});
document.getElementById('chart-type-doughnut').addEventListener('click',function(){setChartType('doughnut');});
document.getElementById('help-modal').addEventListener('click',function(e){if(e.target===this)closeHelp();});
document.getElementById('help-close-btn').addEventListener('click',closeHelp);

