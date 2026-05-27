const STORAGE_KEY = 'fiapp_expenses_v4';
const UNDO_KEY    = 'fiapp_expenses_undo_v4';
const REDO_KEY    = 'fiapp_expenses_redo_v4';
const TAX_KEY     = 'fiapp_tax_result';
const PREFILL_KEY = 'fiapp_prefill_income';
const MONTHS_FULL = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const MONTHS_SHORT= ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const SUBS_KEY='fiapp_subs_v4';
const INCOME_KEY='fiapp_income_v1';
const INCOME_PUSH_KEY='fiapp_income_push_v1';
const expRatesCache={};
async function fetchExpRates(){
  if(Object.keys(expRatesCache).length) return;
  try{
    const obj=await fiappGetRates('USD');
    const rates=obj.rates;
    if(rates&&typeof rates==='object'&&!Array.isArray(rates)){
      Object.keys(rates).forEach(k=>{
        if(/^[A-Z]{2,5}$/.test(k)&&typeof rates[k]==='number') expRatesCache[k]=rates[k];
      });
    }
  }catch(e){ console.warn('FiApp: rate fetch failed -',e.message); }
}

const CATEGORIES = {
  'Groceries':    ['Fresh Produce','Dairy & Eggs','Meat & Seafood','Bakery','Frozen Foods','Snacks & Candy','Beverages','Household Supplies','Pet Supplies'],
  'Entertainment':['Streaming Services','Movies & Cinema','Concerts & Events','Sports Events','Video Games','Books & Magazines','Hobbies','Nightlife'],
  'Travel':       ['Flights','Hotels & Lodging','Car Rental','Public Transport','Fuel','Activities & Tours','Travel Insurance'],
  'Savings':      ['Emergency Fund','Retirement','Investments','Short-term Goals','Education Fund','Home Down Payment'],
  'Housing':      ['Rent / Mortgage','Property Tax','Home Insurance','Maintenance','HOA Fees','Furniture & Décor'],
  'Transport':    ['Car Payment','Car Insurance','Fuel','Parking','Public Transit','Ride-share'],
  'Healthcare':   ['Doctor Visits','Dental','Vision','Medication','Gym & Fitness','Mental Health','Health Insurance'],
  'Dining Out':   ['Restaurants','Fast Food','Coffee Shops','Food Delivery'],
  'Utilities':    ['Electricity','Water','Natural Gas','Internet','Phone','Cable TV'],
  'Shopping':     ['Clothing','Electronics','Home & Garden','Personal Care','Gifts'],
  'Education':    ['Tuition','Books & Supplies','Online Courses','Student Loans'],
};
const CAT_KEYS = Object.keys(CATEGORIES);
const CAT_COLORS = {
  'Groceries':'#bbf7d0','Entertainment':'#bfdbfe','Travel':'#fed7aa','Savings':'#e9d5ff',
  'Housing':'#fde68a','Transport':'#fecaca','Healthcare':'#d1fae5','Dining Out':'#fde8c8',
  'Utilities':'#e5e7eb','Shopping':'#fce7f3','Education':'#ede9fe',
};
function uid(){ return '_'+Math.random().toString(36).slice(2,9); }


function freshState(){
  const now=new Date(),y=now.getFullYear(),m=now.getMonth();
  return {
    rows:[],
    cols:[
      {id:uid(),label:'Week 1',width:100},
      {id:uid(),label:'Week 2',width:100},
      {id:uid(),label:'Week 3',width:100},
      {id:uid(),label:'Week 4',width:100},
    ],
    headerColWidth:185, totalColWidth:110,
    cells:{}, income:{}, collapsed:{},
    currentYear:y, currentMonth:m,
    lastTaxTs:0,
    rowsByMonth:{}, colsByMonth:{},
    goals:{},
  };
}
function loadState(){
  try{
    const r=localStorage.getItem(STORAGE_KEY);
    if(r){
      const s=JSON.parse(r);
      if(!s.income)    s.income={};
      if(!s.collapsed) s.collapsed={};
      if(!s.lastTaxTs) s.lastTaxTs=0;
      if(!Array.isArray(s.rows)) s.rows=freshState().rows;
      if(!Array.isArray(s.cols)) s.cols=freshState().cols;
      if(!s.rowsByMonth) s.rowsByMonth={};
      if(!s.colsByMonth) s.colsByMonth={};
      if(!s.goals) s.goals={};
      delete s.cellCurrencies; delete s.displayCurrency;

      if(!s.rows.some(row=>row.linked==='subscriptions')){
        s.rows.push({id:uid(),label:'Subscriptions',color:'#bfdbfe',textColor:'#1f2937',height:36,parentId:null,linked:'subscriptions'});
      }
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

var _sync=createSyncManager(STORAGE_KEY,'/api/save/expenses','/api/load/expenses',{
  getState:function(){return state;},
  onReload:function(){state=loadState();render();syncIncomeInputs();},
  showQuotaWarning:showSaveQuotaWarning
});
var syncToServer=_sync.syncToServer;
var loadFromServer=_sync.loadFromServer;
var setSyncStatus=_sync.setSyncStatus;
var saveLocal=_sync.saveLocal;
async function loadSubsFromServer(){


  if(!window.__currentUser) return;
  try{var _wtr2=JSON.parse(localStorage.getItem('fiapp_walkthrough_v1')||'null');if(_wtr2&&_wtr2.active)return;}catch{}
  try{
    const res=await fetch('/api/load/subs');
    if(!res.ok) return;
    const resp=await res.json();
    const data=resp&&resp.data;
    if(data&&typeof data==='object'&&(Array.isArray(data.rows)||Array.isArray(data.cols)||data.cells)){
      localStorage.setItem(SUBS_KEY,JSON.stringify(data));
    }
  }catch(e){}
}
function save(){
  saveLocal();
  syncToServer();
  checkSpendTrend();
  detectRecurring();
}

// ── Phase 4a: Spend Trend Message ────────────────────────────────────────
function _monthSpendTotal(mk2){
  var sum=0;
  var mCols=(state.colsByMonth&&state.colsByMonth[mk2])||state.cols||[];
  getRows(mk2).forEach(function(row){
    mCols.forEach(function(col){ sum+=parseFloat((state.cells||{})[mk2+'|'+row.id+'|'+col.id]||0)||0; });
  });
  return parseFloat(sum.toFixed(2));
}
function checkSpendTrend(){
  var mk2=currentMK();
  var parts=mk2.split('-'); var py=parseInt(parts[0]), pm=parseInt(parts[1])-1;
  pm--; if(pm<0){py--;pm=11;}
  var prevMk2=mk(py,pm);
  var thisTotal=_monthSpendTotal(mk2);
  var prevTotal=_monthSpendTotal(prevMk2);
  // Hide strip and bail if conditions not met
  if(thisTotal<10||prevTotal<10){
    var old=document.getElementById('voice-strip'); if(old) old.style.display='none'; return;
  }
  var delta=thisTotal-prevTotal;
  var pct=Math.round(Math.abs(delta)/prevTotal*100);
  if(pct<10){
    var old=document.getElementById('voice-strip'); if(old) old.style.display='none'; return;
  }
  var dir=delta>0?'up':'down';
  // Find the category with the largest absolute change vs last month
  var rowTotalsThis={}, rowTotalsPrev={};
  Object.keys(state.cells||{}).forEach(function(k){
    var parts=k.split('|'); if(parts.length!==3) return;
    var n=parseFloat(state.cells[k])||0; if(!n) return;
    if(parts[0]===mk2){ rowTotalsThis[parts[1]]=(rowTotalsThis[parts[1]]||0)+n; }
    if(parts[0]===prevMk2){ rowTotalsPrev[parts[1]]=(rowTotalsPrev[parts[1]]||0)+n; }
  });
  var topCat='', topCatPct=0, topCatDir='up';
  getRows(mk2).forEach(function(row){
    if(row.parentId) return;
    var t=rowTotalsThis[row.id]||0, p=rowTotalsPrev[row.id]||0;
    if(p<1) return;
    var cp=Math.round(Math.abs(t-p)/p*100);
    if(cp>topCatPct){ topCatPct=cp; topCat=row.label; topCatDir=t>p?'up':'down'; }
  });
  var text=topCat && topCatPct>=10
    ? (topCat+' is '+topCatDir+' '+topCatPct+'% vs last month.')
    : ('Spending '+dir+' '+pct+'% vs last month.');
  showVoiceStrip(text);
}
function showVoiceStrip(text){
  var el=document.getElementById('voice-strip');
  var txt=document.getElementById('voice-strip-text');
  if(!el||!txt) return;
  txt.textContent=text;
  el.style.display='flex';
}
// ── Phase 5e: Recurring row detection (CV < 0.15, ≥3 months) ──
function detectRecurring(){
  // Build index: rowId → {label, amounts: [...nonzero monthly totals]}
  const rowAmounts={};
  const allMonths=Object.keys(state.cells||{}).map(k=>k.split('|')[0]).filter((v,i,a)=>v&&a.indexOf(v)===i);
  allMonths.forEach(mk2=>{
    const cols2=(state.colsByMonth&&state.colsByMonth[mk2])||state.cols||[];
    // Merge base rows with month-specific rows so rows added after forking are included
    const monthRows=(state.rowsByMonth&&state.rowsByMonth[mk2])||[];
    const baseRows=state.rows||[];
    const seenIds=new Set(monthRows.map(r=>r.id));
    const rows2=[...monthRows,...baseRows.filter(r=>!seenIds.has(r.id))];
    rows2.filter(r=>!r.parentId&&!r.linked&&!r.recurring).forEach(row=>{
      let total=0;
      cols2.forEach(col=>{ total+=parseFloat((state.cells||{})[mk2+'|'+row.id+'|'+col.id]||0)||0; });
      if(total>0){
        if(!rowAmounts[row.id]) rowAmounts[row.id]={label:row.label,amounts:[]};
        rowAmounts[row.id].amounts.push(total);
      }
    });
  });
  Object.keys(rowAmounts).forEach(rowId=>{
    const entry=rowAmounts[rowId];
    if(entry.amounts.length<3) return;
    if(localStorage.getItem('fiapp_rec_dismissed_'+rowId)) return;
    // Check if already marked recurring
    const row=(state.rows||[]).find(r=>r.id===rowId)||
      Object.values(state.rowsByMonth||{}).reduce((f,arr)=>f||arr.find(r=>r.id===rowId),null);
    if(row&&row.recurring) return;
    // Compute CV
    const n=entry.amounts.length;
    const mean=entry.amounts.reduce((s,v)=>s+v,0)/n;
    if(mean<=0) return;
    const variance=entry.amounts.reduce((s,v)=>s+Math.pow(v-mean,2),0)/n;
    const cv=Math.sqrt(variance)/mean;
    if(cv>=0.15) return;
    _showRecurringToast(rowId,entry.label);
  });
}
function _showRecurringToast(rowId,label){
  if(document.getElementById('rec-toast-'+rowId)) return;
  const el=document.createElement('div');
  el.id='rec-toast-'+rowId;
  el.style.cssText='position:fixed;bottom:calc(4rem + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:99999;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:8px;padding:.65rem 1rem;font-size:.85rem;color:var(--fg);box-shadow:0 4px 16px rgba(0,0,0,.15);display:flex;align-items:center;gap:.6rem;max-width:440px;';
  const txt=document.createElement('span');txt.textContent='💡 '+label+' recurs every month. Mark it?';
  const yes=document.createElement('button');yes.className='btn btn-sm';yes.style.fontSize='.8rem';yes.textContent='Mark recurring';
  yes.onclick=function(){
    [state.rows,...Object.values(state.rowsByMonth||{})].forEach(arr=>{
      const r=(arr||[]).find(r=>r.id===rowId);if(r) r.recurring=true;
    });
    save(); render(); el.remove();
  };
  const no=document.createElement('button');no.className='btn-ghost btn-sm';no.style.fontSize='.8rem';no.textContent='Skip';
  no.onclick=function(){ localStorage.setItem('fiapp_rec_dismissed_'+rowId,'1');el.remove(); };
  el.appendChild(txt);el.appendChild(yes);el.appendChild(no);
  document.body.appendChild(el);
  setTimeout(()=>{ if(document.body.contains(el)) el.remove(); },12000);
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
function undo(){ if(!undoStack.length) return; redoStack.push(JSON.stringify(state)); state=JSON.parse(undoStack.pop()); save(); saveHistory(); render(); syncIncomeInputs(); updateHistBtns(); showToast('↩ Undone.', false, 1800); }
function redo(){ if(!redoStack.length) return; undoStack.push(JSON.stringify(state)); state=JSON.parse(redoStack.pop()); save(); saveHistory(); render(); syncIncomeInputs(); updateHistBtns(); showToast('↪ Redone.', false, 1800); }
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
  saveLocal(); updateMonthNav(); render(); syncIncomeInputs(); checkSpendTrend();
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
      const isClosed=_isClosedMonth(mk(y,m2));
      opt.value=mk(y,m2); opt.textContent=(isClosed?'🔒 ':'')+MONTHS_FULL[m2]+' '+y;
      if(mk(y,m2)===curMk) opt.selected=true;
      sel.appendChild(opt);
    }
  }
}
function jumpToMonth(mkStr){
  const parts=mkStr.split('-');
  state.currentYear=parseInt(parts[0],10);
  state.currentMonth=parseInt(parts[1],10)-1;
  saveLocal(); updateMonthNav(); render(); syncIncomeInputs(); checkSpendTrend();
}
function updateMonthNav(){
  const label=MONTHS_FULL[state.currentMonth]+' '+state.currentYear;
  document.getElementById('budget-month').textContent=label;
  document.getElementById('apply-year-lbl').textContent=state.currentYear;
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
function reopenMonth(){
  const mk2=currentMK();
  if(state.closedMonths) delete state.closedMonths[mk2];
  saveLocal(); save();
  updateCloseBar(); populateMonthJump(); render();
}
function updateCloseBar(){
  const bar=document.getElementById('close-bar');
  if(!bar) return;
  const mk2=currentMK();
  const btn=bar.querySelector('button');
  if(_isClosedMonth(mk2)){
    document.getElementById('close-bar-text').innerHTML='🔒 <strong>Closed</strong> — this month is locked.';
    if(btn){ btn.textContent='Reopen ↩'; btn.onclick=reopenMonth; }
    bar.style.display='flex'; return;
  }
  if(!_isPastMonth()||!_hasDataForMonth(mk2)){
    bar.style.display='none'; return;
  }
  if(btn){ btn.textContent='Review & close ✓'; btn.onclick=openCloseModal; }
  // Compute total for the display
  let spent=0;
  const mCols=(state.colsByMonth&&state.colsByMonth[mk2])||state.cols||[];
  getRows(mk2).forEach(row=>{ mCols.forEach(col=>{ spent+=parseFloat((state.cells||{})[mk2+'|'+row.id+'|'+col.id]||0)||0; }); });
  const label=MONTHS_FULL[state.currentMonth]+' '+state.currentYear;
  document.getElementById('close-bar-text').textContent='📋 Close '+label+'? — $'+spent.toFixed(2)+' tracked';
  bar.style.display='flex';
}
function openCloseModal(){
  const mk2=currentMK();
  let spent=0, prevSpent=0;
  const mCols=(state.colsByMonth&&state.colsByMonth[mk2])||state.cols||[];
  getRows(mk2).forEach(row=>{ mCols.forEach(col=>{ spent+=parseFloat((state.cells||{})[mk2+'|'+row.id+'|'+col.id]||0)||0; }); });
  // prev month
  let py=state.currentYear, pm=state.currentMonth-1;
  if(pm<0){py--;pm=11;}
  const pmk2=mk(py,pm);
  const pmCols=(state.colsByMonth&&state.colsByMonth[pmk2])||state.cols||[];
  getRows(pmk2).forEach(row=>{ pmCols.forEach(col=>{ prevSpent+=parseFloat((state.cells||{})[pmk2+'|'+row.id+'|'+col.id]||0)||0; }); });
  const gross=parseFloat((state.income&&state.income[mk2]&&state.income[mk2].gross)||0)||0;
  const delta=prevSpent>0?spent-prevSpent:null;
  const label=MONTHS_FULL[state.currentMonth]+' '+state.currentYear;
  // Build modal content
  let details='<strong>'+label+'</strong><br>Spent: $'+spent.toFixed(2);
  if(gross>0){ const saved=gross-spent; details+=' &nbsp;·&nbsp; Income: $'+gross.toFixed(2)+(saved>=0?' &nbsp;·&nbsp; Saved: $'+saved.toFixed(2):''); }
  if(delta!==null){ details+='<br><span style="color:var(--muted);font-size:.85rem">'+(delta>=0?'↑ $'+delta.toFixed(2)+' vs prev month':'↓ $'+Math.abs(delta).toFixed(2)+' vs prev month')+'</span>'; }
  // Find top category
  let topCat='', topVal=0;
  const rowIdx={};
  Object.keys(state.cells||{}).forEach(k=>{ const parts=k.split('|'); if(parts.length===3&&parts[0]===mk2){const n=parseFloat(state.cells[k])||0;if(n>0){if(!rowIdx[parts[1]])rowIdx[parts[1]]=0;rowIdx[parts[1]]+=n;}}});
  getRows(mk2).forEach(row=>{ if(!row.parentId&&rowIdx[row.id]>topVal){topVal=rowIdx[row.id];topCat=row.label;}});
  if(topCat) details+='<br><span style="color:var(--muted);font-size:.85rem">Largest: '+escapeHtml(topCat)+' ($'+topVal.toFixed(2)+')</span>';
  // Show modal
  const overlay=document.getElementById('close-modal-overlay');
  if(!overlay) return;
  document.getElementById('close-modal-body').innerHTML=details;
  overlay.style.display='flex';
}
function confirmClose(){
  const mk2=currentMK();
  if(!state.closedMonths) state.closedMonths={};
  state.closedMonths[mk2]=Date.now();
  saveLocal(); save();
  document.getElementById('close-modal-overlay').style.display='none';
  updateCloseBar();
  // Update month nav dropdown to show lock badge
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
  
  const ip=document.querySelector('.income-panel');
  if(ip) ip.classList.toggle('forecast-panel',fc);
  
  const bm=document.getElementById('budget-month');
  if(bm){
    bm.querySelectorAll('.forecast-badge').forEach(b=>b.remove());
    if(fc){ const b=document.createElement('span');b.className='forecast-badge';b.textContent='📋 Forecast';bm.appendChild(b); }
  }
  
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
  if(!state.income[curMk]){
    const pi=state.income[prevMk];
    if(pi) state.income[curMk]={gross:pi.gross||'',tax:pi.tax||''};
  }
  save(); render(); syncIncomeInputs();
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
      const vals=srcMonths.map(m=>safeNum(state.cells[m+'|'+r.id+'|'+col.id])).filter(v=>v>0);
      if(!vals.length) return;
      hasHistory=true;
      const avg=(vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(2);
      state.cells[curMk+'|'+r.id+'|'+col.id]=avg;
      filled++;
    });
  });
  save(); render(); syncIncomeInputs();
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


function rowTotal(rId){
  const row=getRows().find(r=>r.id===rId);
  if(row&&row.linked==='subscriptions') return virtualSubChildren().reduce((s,c)=>s+c.cost,0);
  if(row&&row.snapshotLinkedRow){
    const snap=(row.subsSnapshotByMonth||{})[currentMK()];
    if(snap!==undefined) return snap.reduce((s,c)=>s+c.cost,0);
    return virtualSubChildren().reduce((s,c)=>s+c.cost,0);
  }
  const kids=children(rId);
  if(kids.length) return kids.reduce((s,c)=>s+rowTotal(c.id),0);
  return getCols().reduce((s,col)=>s+getCell(rId,col.id),0);
}
function grandTotal(){ return getRows().filter(r=>!r.parentId).reduce((s,r)=>s+rowTotal(r.id),0); }
function colTotal(cId){
  const colIdx=getCols().findIndex(c=>c.id===cId);
  return getRows().filter(r=>!r.parentId).reduce((s,r)=>{
    if(r.linked==='subscriptions'||r.snapshotLinkedRow){
      const vcs=r.linked==='subscriptions'?virtualSubChildren():((r.subsSnapshotByMonth||{})[currentMK()]||virtualSubChildren());
      return s+vcs.reduce((t,vc)=>t+(vc.weekCosts?vc.weekCosts[colIdx]||0:(colIdx===0?vc.cost:0)),0);
    }
    if(hasChildren(r.id)) return s+children(r.id).reduce((cs,c)=>cs+getCell(c.id,cId),0);
    return s+getCell(r.id,cId);
  },0);
}
function fmt(n){ return '$'+Math.max(0,n).toFixed(2); }

function _goalKey(rId){ return currentMK()+'|'+rId; }
function _renderGoalBar(rId, totTd){
  const valSpan=totTd.querySelector('.total-val');
  const gBtn=totTd.querySelector('.goal-btn');
  let srSpan=totTd.querySelector('.goal-sr');
  const goal=state.goals?.[_goalKey(rId)];
  if(!goal||isNaN(goal)){
    if(valSpan) valSpan.style.color='';
    if(gBtn)    gBtn.style.color='';
    if(srSpan)  srSpan.remove();
    return;
  }
  const spent=rowTotal(rId);
  const pct=Math.min(999,Math.round(spent/goal*100));
  const color=pct>=100?'#ef4444':pct>=75?'#f59e0b':'#22c55e';
  const label=pct>=100?'(over budget)':pct>=75?'(near limit)':'(under budget)';
  if(valSpan) valSpan.style.color=color;
  if(gBtn)    gBtn.style.color=color;
  if(!srSpan){srSpan=document.createElement('span');srSpan.className='sr-only goal-sr';totTd.appendChild(srSpan);}
  srSpan.textContent=label;
}
function _openGoalPopup(rId, gBtn){
  document.querySelectorAll('.goal-popover').forEach(el=>el.remove());
  const totTd=gBtn.closest('td');
  const goal=state.goals?.[_goalKey(rId)];
  const spent=rowTotal(rId);
  const pct=goal?Math.min(999,Math.round(spent/goal*100)):0;
  const color=pct>=100?'#ef4444':pct>=75?'#f59e0b':'#22c55e';

  const pop=document.createElement('div'); pop.className='goal-popover';
  const head=document.createElement('div');
  head.style.cssText='font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:.1rem;';
  head.textContent='Monthly Budget';
  const track=document.createElement('div'); track.className='goal-pop-bar-track';
  const fill=document.createElement('div');  fill.className='goal-pop-bar-fill';
  fill.style.width=(goal?Math.min(100,pct):0)+'%'; fill.style.background=color;
  track.appendChild(fill);
  const stat=document.createElement('div'); stat.className='goal-pop-stat';
  stat.style.color=goal?color:'var(--muted)';
  stat.textContent=goal?'Spent '+fmt(spent)+'  /  Goal '+fmt(goal)+'  ('+pct+'%)':'No goal set';
  const inp=document.createElement('input'); inp.className='goal-pop-inp';
  inp.type='number'; inp.min='0'; inp.step='any'; inp.placeholder='Enter monthly limit…'; inp.value=goal||'';
  const btns=document.createElement('div'); btns.className='goal-pop-btns';
  const saveBtn=document.createElement('button'); saveBtn.className='goal-pop-save'; saveBtn.textContent='Save';
  const clrBtn=document.createElement('button');  clrBtn.className='goal-pop-clear'; clrBtn.textContent='Clear';

  const applyGoal=()=>{
    const v=parseFloat(inp.value);
    if(!state.goals) state.goals={};
    if(!isNaN(v)&&v>0) state.goals[_goalKey(rId)]=v; else delete state.goals[_goalKey(rId)];
    save(); _renderGoalBar(rId,totTd); pop.remove(); removePL();
  };
  saveBtn.addEventListener('click',applyGoal);
  clrBtn.addEventListener('click',()=>{ inp.value=''; applyGoal(); });
  inp.addEventListener('keydown',e=>{
    if(e.key==='Enter'){ e.preventDefault(); applyGoal(); }
    else if(e.key==='Escape'){ pop.remove(); removePL(); }
  });
  btns.appendChild(saveBtn); btns.appendChild(clrBtn);
  pop.appendChild(head); pop.appendChild(track); pop.appendChild(stat);
  pop.appendChild(inp); pop.appendChild(btns);
  document.body.appendChild(pop);

  requestAnimationFrame(()=>{
    const rect=gBtn.getBoundingClientRect(),pw=pop.offsetWidth||220,ph=pop.offsetHeight||180,m=8;
    let top=rect.bottom+6;
    if(top+ph>window.innerHeight-m) top=rect.top-ph-6;
    top=Math.max(m,top);
    let left=rect.right-pw;
    left=Math.max(m,Math.min(left,window.innerWidth-pw-m));
    pop.style.top=top+'px'; pop.style.left=left+'px';
  });
  inp.focus(); inp.select();

  const onOut=e=>{ if(!pop.contains(e.target)&&e.target!==gBtn){ pop.remove(); removePL(); } };
  const onEsc=e=>{ if(e.key==='Escape'){ pop.remove(); removePL(); } };
  function removePL(){ document.removeEventListener('mousedown',onOut); document.removeEventListener('keydown',onEsc); }
  setTimeout(()=>{ document.addEventListener('mousedown',onOut); document.addEventListener('keydown',onEsc); },0);
}
function _rebuildTotTd(rId, totTd){
  totTd.innerHTML='';
  const inner=document.createElement('div'); inner.style.cssText='display:flex;align-items:center;justify-content:flex-end;gap:2px;';
  const span=document.createElement('span'); span.className='total-val'; span.id='rt-'+rId;
  span.textContent=fmt(rowTotal(rId)); inner.appendChild(span);
  const gBtn=document.createElement('button'); gBtn.className='goal-btn'; gBtn.title='Set or view monthly budget goal'; gBtn.setAttribute('aria-label','Set spending goal'); gBtn.textContent='🎯';
  gBtn.addEventListener('click',e=>{ e.stopPropagation(); _openGoalPopup(rId,gBtn); });
  inner.appendChild(gBtn); totTd.appendChild(inner);
  _renderGoalBar(rId,totTd);
}

function updateRowTotal(rId){
  const el=document.getElementById('rt-'+rId); if(el) el.textContent=fmt(rowTotal(rId));
  const totTd=el&&el.closest('td'); if(totTd) _renderGoalBar(rId,totTd);
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
  updateIncomeSummary();
}
function updateAll(rId){ updateRowTotal(rId); updateGrandTotal(); if(chartVisible) renderChart(); }


function monthIncomeObj(){
  const key=currentMK();
  if(!state.income[key]){
    for(let m=0;m<12;m++){
      const k=mk(state.currentYear,m);
      if(k!==key&&state.income[k]&&(state.income[k].gross||state.income[k].tax)){
        return state.income[key]={gross:state.income[k].gross||'',tax:state.income[k].tax||''};
      }
    }
    state.income[key]={gross:'',tax:''};
  }
  return state.income[key];
}
function onGrossInput(){
  
  const obj=monthIncomeObj();
  delete obj.fromIncome;
  const taxEl=document.getElementById('inp-tax');
  taxEl.value='';
  onIncomeInput();
  document.getElementById('income-sync-badge').innerHTML='';
}
function onIncomeInput(){
  const gross=document.getElementById('inp-gross').value;
  const tax  =document.getElementById('inp-tax').value;
  const obj=monthIncomeObj(); obj.gross=gross; obj.tax=tax;
  const gNum=parseFloat(gross)||0;
  if(gNum>0) localStorage.setItem(PREFILL_KEY,(gNum*12).toFixed(0));
  document.getElementById('apply-year-btn').style.display=(gross||tax)?'inline-block':'none';
  save(); updateIncomeSummary();
}
function syncIncomeInputs(){
  const obj=monthIncomeObj();
  document.getElementById('inp-gross').value=obj.gross||'';
  document.getElementById('inp-gross').readOnly=!!obj.fromIncome;
  const _icon=document.getElementById('income-sync-icon');
  if(_icon) _icon.style.display=obj.fromIncome?'':'none';
  document.getElementById('inp-tax').value  =obj.tax  ||'';
  const hasData=!!(obj.gross||obj.tax);
  document.getElementById('apply-year-btn').style.display=hasData?'inline-block':'none';
  document.getElementById('apply-year-lbl').textContent=state.currentYear;
  updateIncomeSummary();
  syncFromIncomeTracker(currentMK());
}
function enterIncomeManually(){
  const obj=monthIncomeObj();
  delete obj.fromIncome;
  saveLocal();
  const inp=document.getElementById('inp-gross');
  inp.readOnly=false;
  inp.focus(); inp.select();
  const icon=document.getElementById('income-sync-icon');
  if(icon) icon.style.display='none';
  document.getElementById('income-sync-badge').innerHTML='<button class="income-sync-update" data-action="accept-income-sync" data-mk="'+currentMK()+'">↺ Re-link to Income Tracker</button>';
}
function applyIncomeToYear(){
  snapshot();
  const obj=monthIncomeObj();
  for(let m=0;m<12;m++){
    const k=mk(state.currentYear,m);
    state.income[k]={gross:obj.gross,tax:obj.tax};
  }
  save();
  const f=document.getElementById('apply-flash');
  if(f){
    f.textContent='✓ Applied to all 12 months in '+state.currentYear+'.';
    f.classList.add('show');
    clearTimeout(window._applyFlashT);
    window._applyFlashT=setTimeout(()=>f.classList.remove('show'),3500);
  }
}
function updateIncomeSummary(){
  const gross=parseFloat(document.getElementById('inp-gross').value)||0;
  const tax  =parseFloat(document.getElementById('inp-tax').value)  ||0;
  const annual=gross*12;
  const afterTax=Math.max(0,gross-tax);
  const exp=grandTotal();
  const rem=afterTax-exp;
  document.getElementById('disp-annual').textContent  =annual>0?'$'+annual.toFixed(2):'-';
  document.getElementById('disp-aftertax').textContent=gross>0?fmt(afterTax):'-';
  document.getElementById('disp-expenses').textContent=fmt(exp);
  const remEl=document.getElementById('disp-remaining');
  remEl.textContent=gross>0?('$'+Math.abs(rem).toFixed(2)+(rem<0?' over budget':'')):'-';
  remEl.className='income-computed '+(rem<0?'neg':'pos');
  // Phase 4c — end-of-month projection
  const projEl=document.getElementById('eom-projection');
  if(projEl){
    const now2=new Date();
    const isCurrent=state.currentYear===now2.getFullYear()&&state.currentMonth===now2.getMonth();
    const daysPassed=now2.getDate();
    if(isCurrent&&daysPassed>=15&&gross>0&&exp>0){
      const daysInMonth=new Date(now2.getFullYear(),now2.getMonth()+1,0).getDate();
      const onPace=(exp/daysPassed)*daysInMonth;
      projEl.textContent='On pace for $'+onPace.toFixed(0)+' this month ('+daysPassed+' days in, $'+gross.toFixed(0)+' earned)';
      projEl.style.display='block';
    }else{
      projEl.style.display='none';
    }
  }
}


function _fmtMkLabel(mk2){
  const [y,m]=mk2.split('-');
  return MONTHS_SHORT[parseInt(m)-1]+' '+y;
}
function loadTaxCarryover(){
  try{
    const t=JSON.parse(localStorage.getItem(TAX_KEY)); if(!t) return;
    const isFresh = t.consumed===false || (t.ts && t.ts>(state.lastTaxTs||0));
    if(!isFresh) return;

    const monthlyTax=(parseFloat(t.tax)/12).toFixed(2);
    const monthlyIncome=(parseFloat(t.income)/12).toFixed(2);

    
    const targetMonths=t.months&&t.months.length ? t.months : [currentMK()];
    targetMonths.forEach(mk2=>{
      if(!state.income[mk2]) state.income[mk2]={};
      state.income[mk2].tax=monthlyTax;
      if(!state.income[mk2].gross) state.income[mk2].gross=monthlyIncome;
    });

    t.consumed=true;
    state.lastTaxTs = t.ts || Date.now();
    localStorage.setItem(TAX_KEY,JSON.stringify(t));
    save();

    const monthLabel=targetMonths.length===1
      ? _fmtMkLabel(targetMonths[0])
      : targetMonths.length+' months ('+targetMonths.map(_fmtMkLabel).join(', ')+')';
    const banner=document.createElement('div'); banner.className='tax-banner';
    banner.innerHTML=`✓ Monthly tax ($${Number(monthlyTax).toLocaleString()}) applied to ${monthLabel}. Annual: $${Number(t.income).toLocaleString()}, tax: $${Number(t.tax).toLocaleString()}. <a href="/tax">Recalculate →</a>`;
    document.getElementById('income-grid').prepend(banner);
    document.getElementById('tax-link').style.display='none';
  }catch(e){ console.warn('FiApp: loadTaxCarryover failed -',e.message); }
}


async function _incomeMonthTotalUSD(incomeState, mk2){
  await fetchExpRates();
  if(!incomeState) return 0;
  const rows=(incomeState.rowsByMonth&&incomeState.rowsByMonth[mk2])||incomeState.rows||[];
  const cols=(incomeState.colsByMonth&&incomeState.colsByMonth[mk2])||incomeState.cols||[];
  if(!rows.length||!cols.length) return 0;
  const mrCur=incomeState.monthRowCurrencies||{};
  let total=0;
  for(const r of rows.filter(r=>!r.parentId)){
    const kids=rows.filter(c=>c.parentId===r.id);
    const leaves=kids.length?kids:[r];
    for(const leaf of leaves){
      const cur=mrCur[mk2+'|'+leaf.id]||'USD';
      for(const col of cols){
        const v=parseFloat(incomeState.cells[mk2+'|'+leaf.id+'|'+col.id])||0;
        if(!v) continue;
        total+= cur==='USD' ? v : (expRatesCache[cur] ? v/expRatesCache[cur] : v);
      }
    }
  }
  return total;
}
async function syncFromIncomeTracker(mk2){
  const badge=document.getElementById('income-sync-badge'); if(!badge) return;
  try{
    const incomeState=JSON.parse(localStorage.getItem(INCOME_KEY));
    if(!incomeState||!incomeState.rows){badge.innerHTML='';return;}
    const total=await _incomeMonthTotalUSD(incomeState,mk2);
    if(total<=0){badge.innerHTML='';return;}
    const obj=monthIncomeObj();
    const currentGross=parseFloat(obj.gross)||0;
    const alreadySynced=obj.fromIncome&&Math.abs(currentGross-total)<0.01;
    if(!obj.gross||obj.fromIncome){
      obj.gross=total.toFixed(2);
      obj.fromIncome=true;
      document.getElementById('inp-gross').value=obj.gross;
      const hasData=!!(obj.gross||obj.tax);
      document.getElementById('apply-year-btn').style.display=hasData?'inline-block':'none';
      saveLocal(); updateIncomeSummary();
    }
    const tFmt='$'+total.toFixed(2);
    const icon=document.getElementById('income-sync-icon');
    if(alreadySynced||obj.fromIncome){
      document.getElementById('inp-gross').readOnly=true;
      if(icon) icon.style.display='';
      badge.innerHTML='<button onclick="enterIncomeManually()" style="background:none;border:none;cursor:pointer;color:var(--muted);font-size:.78rem;padding:0;font-family:inherit;text-decoration:underline;">Enter manually</button>';
    } else {
      document.getElementById('inp-gross').readOnly=false;
      if(icon) icon.style.display='none';
      badge.innerHTML='<button class="income-sync-update" data-action="accept-income-sync" data-mk="'+mk2+'">↺ Re-link to Income Tracker ('+tFmt+')</button>';
    }
  }catch(e){badge.innerHTML='';}
}
async function acceptIncomeSync(mk2){
  try{
    const incomeState=JSON.parse(localStorage.getItem(INCOME_KEY));
    if(!incomeState||!incomeState.rows) return;
    const total=await _incomeMonthTotalUSD(incomeState,mk2);
    if(total<=0) return;
    snapshot();
    const obj=monthIncomeObj();
    obj.gross=total.toFixed(2);
    obj.fromIncome=true;
    document.getElementById('inp-gross').value=obj.gross;
    const hasData=!!(obj.gross||obj.tax);
    document.getElementById('apply-year-btn').style.display=hasData?'inline-block':'none';
    save(); updateIncomeSummary(); syncFromIncomeTracker(mk2);
  }catch(e){}
}


function toggleCollapse(rowId){ snapshot(); state.collapsed[rowId]=!isCollapsed(rowId); save(); render(); }
function expandAll(){ snapshot(); getRows().filter(r=>!r.parentId&&hasChildren(r.id)).forEach(r=>state.collapsed[r.id]=false); save(); render(); }
function collapseAll(){ snapshot(); getRows().filter(r=>!r.parentId&&hasChildren(r.id)).forEach(r=>state.collapsed[r.id]=true); save(); render(); }


let openMenu=null;
function closeMenu(){ if(openMenu){openMenu.remove();openMenu=null;} }
document.addEventListener('click',e=>{ if(!e.target.closest('.sub-dropdown')&&!e.target.closest('.sub-menu')) closeMenu(); });

function renderOtherForm(menu, row){
  menu.innerHTML='';
  const f=document.createElement('div'); f.className='sub-other-form';
  const inp=document.createElement('input'); inp.type='text'; inp.placeholder='Custom subcategory'; inp.maxLength=40;
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


// ── Phase 4h: Row label suggestions ──
function _allHistoricalLabels(){
  const labels=new Set();
  (state.rows||[]).forEach(r=>{if(r.label) labels.add(r.label);});
  Object.values(state.rowsByMonth||{}).forEach(arr=>arr.forEach(r=>{if(r.label) labels.add(r.label);}));
  return [...labels];
}
function _showLabelSuggest(spanEl){
  const partial=(spanEl.textContent||'').trim().toLowerCase();
  const all=_allHistoricalLabels();
  const matches=partial.length<1?[]:all.filter(l=>l.toLowerCase().startsWith(partial)&&l.toLowerCase()!==partial);
  let dd=document.getElementById('_label-suggest-dd');
  if(!matches.length){if(dd) dd.style.display='none'; return;}
  if(!dd){
    dd=document.createElement('div');dd.id='_label-suggest-dd';
    dd.style.cssText='position:fixed;z-index:9999;background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,.15);min-width:160px;max-height:180px;overflow-y:auto;';
    document.body.appendChild(dd);
  }
  dd.innerHTML=matches.slice(0,8).map(l=>'<div data-lbl="'+escapeHtml(l)+'" style="padding:6px 10px;cursor:pointer;font-size:.85rem;color:var(--fg);" onmousedown="event.preventDefault()" onclick="_pickLabel(this,\''+escapeHtml(l)+'\')">'+escapeHtml(l)+'</div>').join('');
  const rect=spanEl.getBoundingClientRect();
  dd.style.left=rect.left+'px';dd.style.top=(rect.bottom+3)+'px';dd.style.display='block';
  dd._targetSpan=spanEl;
}
function _hideLabelSuggest(){
  const dd=document.getElementById('_label-suggest-dd');if(dd) dd.style.display='none';
}
function _pickLabel(itemEl, label){
  const dd=document.getElementById('_label-suggest-dd');
  const span=dd&&dd._targetSpan;
  if(span){span.textContent=label;span.dispatchEvent(new Event('blur'));}
  _hideLabelSuggest();
}

// ── Phase 4g: First-use row templates ──
var _TEMPLATES={
  Student:    ['Rent','Food','Transport','Books & Supplies','Entertainment','Subscriptions','Misc'],
  Freelancer: ['Rent / Mortgage','Equipment','Software','Marketing','Food','Transport','Subscriptions','Tax Set-Aside'],
  Family:     ['Rent / Mortgage','Groceries','Childcare','Transport','Utilities','Insurance','Subscriptions','Entertainment'],
};
function renderTemplatePrompt(){
  const el=document.getElementById('template-prompt'); if(!el) return;
  if(window._wtActive){el.innerHTML='';return;}
  if(localStorage.getItem('fiapp_template_dismissed')==='1'){el.innerHTML='';return;}
  const hasAnyData=Object.keys(state.cells||{}).length>0;
  const hasRows=getRows().length>0;
  if(hasAnyData||hasRows){el.innerHTML='';return;}

  el.innerHTML='';
  const names=Object.keys(_TEMPLATES);
  let selectedName=names[0];

  const wrap=document.createElement('div');
  wrap.style.cssText='background:var(--panel-bg);border:1px solid var(--panel-border);border-radius:8px;padding:.75rem 1rem;margin-bottom:.75rem;font-size:.85rem;color:var(--fg);';

  const title=document.createElement('strong');
  title.style.cssText='display:block;margin-bottom:.5rem;';
  title.textContent='Start with a template';
  wrap.appendChild(title);

  const btnRow=document.createElement('div');
  btnRow.style.cssText='display:flex;gap:.5rem;flex-wrap:wrap;align-items:center;';

  const previewArea=document.createElement('div');
  previewArea.style.cssText='margin-top:.6rem;';

  function _setSelected(name){
    selectedName=name;
    btnRow.querySelectorAll('._tpl-btn').forEach(b=>{
      b.style.outline=b.dataset.tpl===name?'2px solid var(--accent)':'';
    });
  }
  function _renderPreview(name){
    const labels=_TEMPLATES[name]||[];
    const cols=['Week 1','Week 2','Week 3','Week 4'];
    const colHeaders=cols.map(c=>'<th style="padding:.25rem .5rem;font-weight:600;font-size:.78rem;color:var(--muted);border-bottom:1px solid var(--panel-border);white-space:nowrap;">'+c+'</th>').join('');
    const rows=labels.map(l=>{
      const bg=CAT_COLORS[l]||'#e5e7eb';
      const cells=cols.map(()=>'<td style="padding:.25rem .5rem;border-bottom:1px solid var(--panel-border);font-size:.78rem;color:var(--muted);text-align:right;">—</td>').join('');
      return '<tr><td style="padding:.25rem .6rem;border-bottom:1px solid var(--panel-border);font-size:.82rem;font-weight:500;background:'+bg+';color:#1f2937;border-radius:3px 0 0 3px;white-space:nowrap;">'+escapeHtml(l)+'</td>'+cells+'</tr>';
    }).join('');
    previewArea.innerHTML='<div style="overflow-x:auto;margin-top:.65rem;border:1px solid var(--panel-border);border-radius:6px;">'
      +'<table style="border-collapse:collapse;width:100%;min-width:340px;">'
      +'<thead><tr><th style="padding:.25rem .6rem;font-weight:600;font-size:.78rem;color:var(--muted);border-bottom:1px solid var(--panel-border);text-align:left;">Category</th>'+colHeaders+'</tr></thead>'
      +'<tbody>'+rows+'</tbody>'
      +'</table></div>'
      +'<div style="margin-top:.6rem;">'
      +'<button class="btn btn-sm" style="font-size:.82rem" onclick="applyTemplate(\''+name+'\')">Apply '+escapeHtml(name)+' →</button>'
      +'</div>';
  }

  names.forEach(name=>{
    const btn=document.createElement('button');
    btn.className='btn btn-sm _tpl-btn';
    btn.dataset.tpl=name;
    btn.style.cssText='font-size:.82rem;';
    btn.textContent=name;
    btn.addEventListener('mouseenter',()=>_renderPreview(name));
    btn.addEventListener('mouseleave',()=>_renderPreview(selectedName));
    btn.addEventListener('click',()=>{ _setSelected(name); _renderPreview(name); });
    btnRow.appendChild(btn);
  });

  const blankBtn=document.createElement('button');
  blankBtn.className='btn-ghost btn-sm';
  blankBtn.style.cssText='font-size:.82rem;margin-left:.25rem;';
  blankBtn.textContent='Start blank';
  blankBtn.addEventListener('click',dismissTemplatePrompt);
  btnRow.appendChild(blankBtn);

  wrap.appendChild(btnRow);
  wrap.appendChild(previewArea);
  el.appendChild(wrap);

  _setSelected(selectedName);
  _renderPreview(selectedName);
}
function applyTemplate(name){
  const labels=_TEMPLATES[name]; if(!labels) return;
  forkCurrentMonth();
  const mk2=currentMK();
  snapshot();
  labels.forEach(label=>{
    if(getRows(mk2).filter(r=>!r.parentId).length>=MAX_ROWS) return;
    const color=CAT_COLORS[label]||'#e5e7eb';
    const rowObj={id:uid(),label,color,textColor:'#1f2937',height:36,parentId:null};
    if(label==='Subscriptions') rowObj.linked='subscriptions';
    state.rowsByMonth[mk2].push(rowObj);
  });
  localStorage.setItem('fiapp_template_dismissed','1');
  save(); render();
}
function dismissTemplatePrompt(){
  localStorage.setItem('fiapp_template_dismissed','1');
  const el=document.getElementById('template-prompt'); if(el) el.innerHTML='';
}

function addRow(){
  try{var _wt=JSON.parse(localStorage.getItem('fiapp_walkthrough_v1')||'null');if(_wt&&_wt.active)return;}catch{}
  forkCurrentMonth();
  const mk2=currentMK();
  if(getRows(mk2).filter(r=>!r.parentId).length>=MAX_ROWS){showToast('Maximum '+MAX_ROWS+' rows per month.');return;}
  snapshot();
  const usedLabels=getRows(mk2).filter(r=>!r.parentId).map(r=>r.label);
  const nextCat=CAT_KEYS.find(k=>!usedLabels.includes(k))||'Groceries';
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
  state.colsByMonth[mk2].push({id:uid(),label:'New Column',width:100});
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
  const row=getRows(monthKey).find(r=>r.id===rId);

  if(row&&(row.linked==='subscriptions'||row.snapshotLinkedRow)){
    const [ys,ms]=monthKey.split('-').map(Number);
    const mo=ms-1;
    if(row.snapshotLinkedRow){
      const snap=(row.subsSnapshotByMonth||{})[monthKey];
      if(snap!==undefined) return snap.reduce((s,c)=>s+c.cost,0);
    }
    const subs=loadSubsState(); if(!subs) return 0;
    return (subs.rows||[]).reduce((s,r)=>s+calcSubMonthCostInExp(r,subs,ys,mo),0);
  }
  const kids=getRows(monthKey).filter(r=>r.parentId===rId);
  if(kids.length) return kids.reduce((s,c)=>s+rowTotalForMonthKey(c.id,monthKey),0);
  return getCols(monthKey).reduce((s,col)=>{
    const k=monthKey+'|'+rId+'|'+col.id;
    return s+(parseFloat(state.cells[k])||0);
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
    topLabel='Top Expenses - '+state.currentYear;
  } else {
    data=topRows.map(r=>({label:r.label,value:rowTotal(r.id),color:r.color})).filter(d=>d.value>0).sort((a,b)=>b.value-a.value);
    topLabel='Top Expenses - '+MONTHS_SHORT[state.currentMonth]+' '+state.currentYear;
  }
  if(chartInstance){chartInstance.destroy();chartInstance=null;}
  if(!data.length){renderTop3([],topLabel);return;}
  const colors=data.map(d=>d.color||'#93c5fd');
  const vals=data.map(d=>parseFloat(d.value.toFixed(2)));
  const labels=data.map(d=>d.label);
  const isDark=document.documentElement.classList.contains('dark');
  const fgColor=isDark?'#e2e8f0':'#1f2937';
  const gridColor=isDark?'rgba(255,255,255,.1)':'rgba(0,0,0,.08)';
  if(chartType==='doughnut'){
    chartInstance=new Chart(document.getElementById('exp-chart'),{
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
    chartInstance=new Chart(document.getElementById('exp-chart'),{
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
    if(state.goals) Object.keys(state.goals).forEach(k=>{ if(k.startsWith(mk+'|')) delete state.goals[k]; });
    save(); render(); syncIncomeInputs();
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


function loadSubsState(){ try{ return JSON.parse(localStorage.getItem(SUBS_KEY))||null; }catch{ return null; } }

function calcSubMonthCostInExp(r, subs, yr, mo){
  const costCol=subs.cols.find(c=>c.ctype==='number');
  const billCol=subs.cols.find(c=>c.ctype==='billing');
  const startCol=subs.cols.find(c=>c.ctype==='date');
  const cancelCol=subs.cols.find(c=>c.ctype==='canceldate');
  const trialCol=subs.cols.find(c=>c.ctype==='trial');
  const statusCol=subs.cols.find(c=>c.ctype==='status');
  if(!costCol||!startCol) return 0;
  function gsc(rId,cId){ return subs.cells[rId+'|'+cId]||''; }
  const rawCost=Math.max(0,parseFloat(gsc(r.id,costCol.id))||0);
  const billing=billCol?(gsc(r.id,billCol.id)||'Monthly'):'Monthly';
  const startStr=gsc(r.id,startCol.id);
  if(!startStr) return 0;
  const start=new Date(startStr+'T00:00:00');
  const cancelStr=cancelCol?gsc(r.id,cancelCol.id):'';
  const cancel=cancelStr?new Date(cancelStr+'T00:00:00'):null;
  const trialV=trialCol?(gsc(r.id,trialCol.id)||'none'):'none';
  const status=statusCol?(gsc(r.id,statusCol.id)||'Active'):'Active';
  if(status==='Paused') return 0;
  const mStart=new Date(yr,mo,1), mEnd=new Date(yr,mo+1,0,23,59,59);
  if(start>mEnd) return 0;
  if(cancel&&cancel<mStart) return 0;
  
  let trialEnd=null;
  if(trialV!=='none'){
    const td2=new Date(start);
    if(trialV==='week')     {td2.setDate(td2.getDate()+6);trialEnd=td2;}
    else if(trialV==='2weeks'){td2.setDate(td2.getDate()+13);trialEnd=td2;}
    else if(trialV==='month'){td2.setMonth(td2.getMonth()+1);td2.setDate(td2.getDate()-1);trialEnd=td2;}
    else if(trialV==='2months'){td2.setMonth(td2.getMonth()+2);td2.setDate(td2.getDate()-1);trialEnd=td2;}
    else if(trialV==='3months'){td2.setMonth(td2.getMonth()+3);td2.setDate(td2.getDate()-1);trialEnd=td2;}
  }
  
  let events=0;
  if(billing==='Monthly'){
    const chargeDay=start.getDate();
    const dIM=new Date(yr,mo+1,0).getDate();
    const actualDay=Math.min(chargeDay,dIM);
    const chargeDate=new Date(yr,mo,actualDay);
    if(chargeDate>=mStart&&chargeDate<=mEnd&&chargeDate>=start){
      if(!cancel||chargeDate<=cancel){
        if(!(trialEnd&&chargeDate<=trialEnd)) events=1;
      }
    }
  } else if(billing==='Weekly'||billing==='Bi-Weekly'){
    const interval=(billing==='Weekly'?7:14)*864e5;
    let d=new Date(start);
    while(d<=mEnd){
      if(d>=mStart&&(!cancel||d<=cancel)&&!(trialEnd&&d<=trialEnd)) events++;
      d=new Date(d.getTime()+interval);
    }
  } else {
    const months=billing==='Quarterly'?3:billing==='Semi-Annual'?6:12;
    let d=new Date(start);
    while(d<=mEnd){
      if(d>=mStart&&(!cancel||d<=cancel)&&!(trialEnd&&d<=trialEnd)) events++;
      const nm=d.getMonth()+months;
      d=new Date(d.getFullYear()+Math.floor(nm/12),nm%12,d.getDate());
    }
  }
  
  const cur=(subs.rowCurrencies||{})[r.id]||'USD';
  const usdCost=cur==='USD'?rawCost:(expRatesCache[cur]?rawCost/expRatesCache[cur]:rawCost);
  return events*usdCost;
}



function getSubWeekCosts(r, subs, yr, mo){
  const cost=calcSubMonthCostInExp(r,subs,yr,mo);
  if(!cost) return [0,0,0,0];
  const billCol=subs.cols.find(c=>c.ctype==='billing');
  const startCol=subs.cols.find(c=>c.ctype==='date');
  const billing=billCol?(subs.cells[r.id+'|'+billCol.id]||'Monthly'):'Monthly';
  const startStr=startCol?(subs.cells[r.id+'|'+startCol.id]||''):'';
  function dayToW(d){ return d<=7?0:d<=14?1:d<=21?2:3; }
  const weeks=[0,0,0,0];
  if(billing==='Weekly'||billing==='Bi-Weekly'){
    const interval=(billing==='Weekly'?7:14)*864e5;
    const start=new Date(startStr+'T12:00:00');
    let d=new Date(start);
    while(d.getFullYear()<yr||(d.getFullYear()===yr&&d.getMonth()<mo)) d=new Date(d.getTime()+interval);
    const days=[];
    while(d.getFullYear()===yr&&d.getMonth()===mo){ days.push(d.getDate()); d=new Date(d.getTime()+interval); }
    if(!days.length){ weeks[0]=cost; return weeks; }
    const perEvent=cost/days.length;
    days.forEach(day=>{ weeks[dayToW(day)]+=perEvent; });
  } else {
    
    const day=startStr?new Date(startStr+'T12:00:00').getDate():1;
    weeks[dayToW(day)]=cost;
  }
  return weeks;
}

function virtualSubChildren(){
  const subs=loadSubsState(); if(!subs||!subs.rows||!subs.cols) return [];
  const svcCol=subs.cols.find(c=>c.ctype==='text');
  return subs.rows.map(r=>{
    const label=svcCol?subs.cells[r.id+'|'+svcCol.id]||'-':'-';
    const cost=calcSubMonthCostInExp(r,subs,state.currentYear,state.currentMonth);
    const weekCosts=getSubWeekCosts(r,subs,state.currentYear,state.currentMonth);
    return {id:r.id,label,cost,weekCosts};
  }).filter(c=>c.cost>0);
}


function renderTableHeader(table){
  const cg=document.createElement('colgroup');
  const hc=document.createElement('col');hc.id='cg-hdr';hc.style.width=(state.headerColWidth||185)+'px';cg.appendChild(hc);
  getCols().forEach(col=>{const c=document.createElement('col');c.id='cg-'+col.id;c.style.width=(col.width||100)+'px';cg.appendChild(c);});
  const tc=document.createElement('col');tc.style.width=(state.totalColWidth||110)+'px';cg.appendChild(tc);
  const dc=document.createElement('col');dc.style.width='32px';cg.appendChild(dc);
  table.appendChild(cg);

  const thead=document.createElement('thead'),htr=document.createElement('tr');
  const corner=document.createElement('th');
  const ci=document.createElement('div');ci.className='th-inner';
  const cl=document.createElement('span');cl.style.cssText='font-weight:600;color:#6b7280;font-size:.83rem;';cl.textContent='Category';ci.appendChild(cl);
  corner.appendChild(ci);
  const chr=document.createElement('div');chr.className='col-resize';attachHdrResize(chr);corner.appendChild(chr);
  htr.appendChild(corner);
  getCols().forEach((col,colIdx)=>{
    const th=document.createElement('th');
    if(colIdx===0) th.setAttribute('data-wt','expense-month-col');
    th.dataset.colId=col.id;
    const inner=document.createElement('div');inner.className='th-inner';
    const cdh=document.createElement('span');cdh.className='col-drag-handle';cdh.textContent='⠿';cdh.title='Drag to reorder column';cdh.setAttribute('aria-label','Drag to reorder column');cdh.setAttribute('role','img');
    cdh.addEventListener('mousedown',()=>{ th.draggable=true; });
    cdh.addEventListener('mouseup',()=>{ th.draggable=false; });
    inner.appendChild(cdh);
    const lbl=document.createElement('span');lbl.className='th-label';lbl.contentEditable='true';lbl.textContent=col.label;
    lbl.addEventListener('blur',()=>{col.label=lbl.textContent.trim()||col.label;save();});
    lbl.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();lbl.blur();}});
    inner.appendChild(lbl);
    const del=document.createElement('button');del.className='col-del';del.title='Delete column';del.textContent='×';del.setAttribute('aria-label','Delete column');del.addEventListener('click',()=>deleteCol(col.id));inner.appendChild(del);
    th.appendChild(inner);
    const cr=document.createElement('div');cr.className='col-resize';attachColResize(cr,col);th.appendChild(cr);
    th.addEventListener('dragstart',e=>{ _dragColId=col.id; e.dataTransfer.effectAllowed='move'; });
    th.addEventListener('dragend',()=>{
      _dragColId=null; th.draggable=false;
      document.querySelectorAll('.th-drop-before,.th-drop-after').forEach(el=>el.classList.remove('th-drop-before','th-drop-after'));
    });
    th.addEventListener('dragover',e=>{
      if(!_dragColId||_dragColId===col.id) return;
      e.preventDefault();
      document.querySelectorAll('.th-drop-before,.th-drop-after').forEach(el=>el.classList.remove('th-drop-before','th-drop-after'));
      const rect=th.getBoundingClientRect();
      th.classList.add(e.clientX<rect.left+rect.width/2?'th-drop-before':'th-drop-after');
    });
    th.addEventListener('drop',e=>{
      if(!_dragColId||_dragColId===col.id) return;
      e.preventDefault();
      document.querySelectorAll('.th-drop-before,.th-drop-after').forEach(el=>el.classList.remove('th-drop-before','th-drop-after'));
      forkCurrentMonth();
      const mk2=currentMK();
      const cols=state.colsByMonth[mk2];
      const fromIdx=cols.findIndex(c=>c.id===_dragColId);
      const toIdx=cols.findIndex(c=>c.id===col.id);
      if(fromIdx===-1||toIdx===-1) return;
      const rect=th.getBoundingClientRect();
      const before=e.clientX<rect.left+rect.width/2;
      snapshot();
      const [moved]=cols.splice(fromIdx,1);
      const insertAt=cols.findIndex(c=>c.id===col.id);
      cols.splice(before?insertAt:insertAt+1,0,moved);
      save(); render();
    });
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
  tbody.addEventListener('dragover',e=>{
    if(!_dragRowId){return;}
    e.preventDefault();
    const trs=[...tbody.querySelectorAll('tr[data-row-id]')];
    if(!trs.length) return;
    if(_activeDropEl){_activeDropEl.classList.remove('tr-drop-before','tr-drop-after');_activeDropEl=null;}
    let target=null,before=true;
    for(let i=0;i<trs.length;i++){
      const rect=trs[i].getBoundingClientRect();
      if(e.clientY<rect.top+rect.height/2){target=trs[i];before=true;break;}
      if(i===trs.length-1){target=trs[i];before=false;}
    }
    if(target&&target.dataset.rowId!==_dragRowId){target.classList.add(before?'tr-drop-before':'tr-drop-after');_activeDropEl=target;}
  });
  tbody.addEventListener('drop',e=>{
    if(!_dragRowId) return;
    e.preventDefault();
    const targetEl=_activeDropEl;
    const isBefore=targetEl&&targetEl.classList.contains('tr-drop-before');
    if(_activeDropEl){_activeDropEl.classList.remove('tr-drop-before','tr-drop-after');_activeDropEl=null;}
    if(!targetEl) return;
    const targetId=targetEl.dataset.rowId;
    if(targetId&&targetId!==_dragRowId) moveParentRow(_dragRowId,targetId,isBefore);
  });
  function renderRow(row){
    const isChild=!!row.parentId, hasKids=hasChildren(row.id), collapsed=isCollapsed(row.id);
    const tr=document.createElement('tr');tr.style.height=(row.height||36)+'px';tr.dataset.trRowId=row.id;
    if(isChild) tr.classList.add('child-row');
    const rhTd=document.createElement('td');rhTd.className='rh-cell';rhTd.style.backgroundColor=row.color;
    const rhIn=document.createElement('div');rhIn.className='rh-inner';
    if(!isChild){
      const dh=document.createElement('span');dh.className='drag-handle';dh.textContent='⠿';dh.title='Drag to reorder';dh.setAttribute('aria-label','Drag to reorder');dh.setAttribute('role','img');
      dh.addEventListener('mousedown',()=>{ tr.draggable=true; });
      dh.addEventListener('mouseup',()=>{ tr.draggable=false; });
      rhIn.appendChild(dh);
      tr.dataset.rowId=row.id;
      tr.addEventListener('dragstart',e=>{
        _dragRowId=row.id;
        tr.classList.add('tr-dragging');
        e.dataTransfer.effectAllowed='move';
      });
      tr.addEventListener('dragend',()=>{
        _dragRowId=null;
        tr.classList.remove('tr-dragging');
        if(_activeDropEl){_activeDropEl.classList.remove('tr-drop-before','tr-drop-after');_activeDropEl=null;}
      });
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
    const rowLabel=document.createElement('span');rowLabel.className='row-label';rowLabel.contentEditable='true';rowLabel.textContent=row.label;
    rowLabel.style.color=row.textColor||'#1f2937';
    rowLabel.addEventListener('blur',()=>{row.label=rowLabel.textContent.trim()||row.label;save();_hideLabelSuggest();});
    rowLabel.addEventListener('input',()=>_showLabelSuggest(rowLabel));
    rowLabel.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();rowLabel.blur();}if(e.key==='Escape')_hideLabelSuggest();});
    rowLabel.addEventListener('paste',function(e){e.preventDefault();const text=(e.clipboardData||window.clipboardData).getData('text/plain');document.execCommand('insertText',false,text);});
    if(row.snapshotLinkedRow){
      rowLabel.contentEditable='false';
      rowLabel.style.textDecorationLine='underline';
      rowLabel.style.textDecorationStyle='dashed';
      rowLabel.style.cursor='pointer';
      rowLabel.classList.add('tip-host');
      rowLabel.dataset.tip='Pasted snapshot - click to restore live link to your Subscription Tracker';
      rowLabel.addEventListener('click',e=>{e.stopPropagation();restoreSubsLink(row.id);});
    }
    rhIn.appendChild(colorWrap);rhIn.appendChild(tcWrap);rhIn.appendChild(rowLabel);
    if(row.recurring){const rb=document.createElement('span');rb.textContent='🔁';rb.title='Recurring';rb.style.cssText='font-size:.75em;opacity:.6;margin-left:.25rem;pointer-events:none;flex-shrink:0;';rhIn.appendChild(rb);}
    if(!isChild && !row.linked && !row.snapshotLinkedRow){
      const dd=document.createElement('div');dd.className='sub-dropdown';
      const addBtn=document.createElement('button');addBtn.className='sub-add-btn';addBtn.textContent='+Sub';addBtn.title='Add subcategory';
      addBtn.addEventListener('click',e=>{e.stopPropagation();showSubMenu(addBtn,row);});
      dd.appendChild(addBtn);rhIn.appendChild(dd);
    }
    if(row.linked==='subscriptions'){
      const linkBtn=document.createElement('a');
      linkBtn.href='/subscriptions';
      linkBtn.className='subs-link-btn tip-host';
      linkBtn.dataset.tip='This category is linked to your Subscription Tracker - click to open it';
      linkBtn.title='This category is linked to your Subscription Tracker - click to open it';
      linkBtn.textContent='→ Subscriptions';
      linkBtn.setAttribute('data-wt','subs-link');
      rhIn.appendChild(linkBtn);
    }
    rhTd.appendChild(rhIn);
    const rr=document.createElement('div');rr.className='row-resize';attachRowResize(rr,row,tr);rhTd.appendChild(rr);
    tr.appendChild(rhTd);
    const isLinkedRow=row.linked==='subscriptions'||row.snapshotLinkedRow;
    const linkedVC=isLinkedRow?(row.linked==='subscriptions'?virtualSubChildren():((row.subsSnapshotByMonth||{})[currentMK()]||virtualSubChildren())):null;
    getCols().forEach((col,colIdx)=>{
      const td=document.createElement('td');
      if(hasKids||isLinkedRow){
        const span=document.createElement('span');span.className='parent-sum';span.id='ps-'+row.id+'-'+col.id;
        let s=0;
        if(isLinkedRow&&linkedVC){
          s=linkedVC.reduce((t,vc)=>t+(vc.weekCosts?vc.weekCosts[colIdx]||0:(colIdx===0?vc.cost:0)),0);
        } else {
          s=children(row.id).reduce((t,c)=>t+getCell(c.id,col.id),0);
          span.title='Sum of subcategories';
        }
        span.textContent=s>0?fmt(s):'';td.appendChild(span);
      } else {
        const inp=document.createElement('input');inp.type='number';inp.min='0';inp.step='0.01';inp.inputMode='decimal';inp.className='num-input';
        if(_isClosedMonth(currentMK())) inp.disabled=true;
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
          updateAll(row.id);
        });
        td.appendChild(inp);
      }
      tr.appendChild(td);
    });
    const totTd=document.createElement('td');totTd.className='th-total';
    const totInner=document.createElement('div');totInner.style.cssText='display:flex;align-items:center;justify-content:flex-end;gap:2px;';
    const totSpan=document.createElement('span');totSpan.className='total-val';totSpan.id='rt-'+row.id;
    totSpan.textContent=fmt(rowTotal(row.id));totInner.appendChild(totSpan);
    if(!isChild){
      const gBtn=document.createElement('button');gBtn.className='goal-btn';gBtn.title='Set or view monthly budget goal';gBtn.setAttribute('aria-label','Set spending goal');gBtn.textContent='🎯';
      gBtn.addEventListener('click',e=>{e.stopPropagation();_openGoalPopup(row.id,gBtn);});
      totInner.appendChild(gBtn);
    }
    totTd.appendChild(totInner);
    if(!isChild) _renderGoalBar(row.id,totTd);
    tr.appendChild(totTd);
    const delTd=document.createElement('td');delTd.className='del-td';
    const delBtn=document.createElement('button');delBtn.className='row-del';delBtn.title='Delete row';delBtn.setAttribute('aria-label','Delete row');delBtn.textContent='🗑';
    delBtn.addEventListener('click',()=>deleteRow(row.id));delTd.appendChild(delBtn);tr.appendChild(delTd);
    tbody.appendChild(tr);
    if(!isChild&&!collapsed){
      children(row.id).forEach(renderRow);
      const _vchildren = row.linked==='subscriptions' ? virtualSubChildren()
        : row.snapshotLinkedRow ? ((row.subsSnapshotByMonth||{})[currentMK()]||virtualSubChildren())
        : [];
      if(_vchildren.length){
        _vchildren.forEach(vc=>{
          const vtr=document.createElement('tr'); vtr.style.height='30px'; vtr.classList.add('child-row'); vtr.style.opacity='.88';
          const vrhTd=document.createElement('td'); vrhTd.className='rh-cell'; vrhTd.style.backgroundColor=row.color;
          const vrhIn=document.createElement('div'); vrhIn.className='rh-inner'; vrhIn.style.paddingLeft='22px';
          const vbadge=document.createElement('span'); vbadge.style.cssText='font-size:.7rem;margin-right:3px;'; vbadge.textContent='🔗'; vbadge.title='From Subscription Tracker';
          const vlbl=document.createElement('span'); vlbl.className='row-label'; vlbl.style.cssText='font-weight:500;font-size:.83rem;color:'+(row.textColor||'#1f2937')+';cursor:default;pointer-events:none;'; vlbl.textContent=vc.label;
          vrhIn.appendChild(vbadge); vrhIn.appendChild(vlbl); vrhTd.appendChild(vrhIn); vtr.appendChild(vrhTd);
          getCols().forEach((col,idx)=>{
            const vtd=document.createElement('td');
            const wc=vc.weekCosts?vc.weekCosts[idx]||0:(idx===0?vc.cost:0);
            if(wc>0){
              const vs=document.createElement('span'); vs.className='parent-sum'; vs.style.cssText='display:block;padding:4px 7px;text-align:right;font-size:.83rem;min-height:30px;line-height:22px;';
              vs.textContent=fmt(wc); vtd.appendChild(vs);
            }
            vtr.appendChild(vtd);
          });
          const vtotTd=document.createElement('td'); vtotTd.className='th-total';
          const vtotSpan=document.createElement('span'); vtotSpan.className='total-val'; vtotSpan.textContent=fmt(vc.cost); vtotTd.appendChild(vtotSpan); vtr.appendChild(vtotTd);
          vtr.appendChild(document.createElement('td'));
          tbody.appendChild(vtr);
        });
      }
    }
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

function render(){
  const _sy=window.scrollY;
  const table=document.getElementById('sheet'); table.innerHTML='';
  renderTableHeader(table);
  renderTableBody(table);
  renderFooter(table);
  updateIncomeSummary();
  renderTemplatePrompt();
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


function adjustBodyWidth(){
  const naturalWidth=(state.headerColWidth||185)
    +getCols().reduce((s,c)=>s+(c.width||100),0)
    +(state.totalColWidth||110)+32;
  const cap=Math.min(window.innerWidth*0.95,1500);
  document.body.style.maxWidth=naturalWidth>900?Math.min(naturalWidth+60,cap)+'px':'';
}
window.addEventListener('resize',adjustBodyWidth);




function expPad(s,n){ s=String(s); return s.length>=n?s:s+' '.repeat(n-s.length); }
function expCsvEsc(v){
  const s=String(v==null?'':v);
  return /[,"\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;
}


function buildRowsArray(){
  const colLabels=getCols().map(c=>c.label);
  const header=['Category','Subcategory',...colLabels,'Total'];
  const out=[header];
  getRows().filter(r=>!r.parentId).forEach(parent=>{
    const kids=children(parent.id);
    const isLinked=parent.linked==='subscriptions'||parent.snapshotLinkedRow;
    if(isLinked){
      const vcs=parent.linked==='subscriptions'?virtualSubChildren():((parent.subsSnapshotByMonth||{})[currentMK()]||virtualSubChildren());
      const vals=getCols().map((col,ci)=>{
        const s=vcs.reduce((t,vc)=>t+(vc.weekCosts?vc.weekCosts[ci]||0:(ci===0?vc.cost:0)),0);
        return s?s.toFixed(2):'';
      });
      out.push([parent.label,'',...vals,rowTotal(parent.id).toFixed(2)]);
      vcs.forEach(vc=>{
        const kVals=getCols().map((col,ci)=>{
          const wc=vc.weekCosts?vc.weekCosts[ci]||0:(ci===0?vc.cost:0);
          return wc?wc.toFixed(2):'';
        });
        out.push(['',vc.label,...kVals,vc.cost.toFixed(2)]);
      });
    } else if(kids.length){
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
      label:parent.label,
      color:parent.color,
      textColor:parent.textColor,
      total:rowTotal(parent.id),
      weeks:colVals,
      subcategories:kids.map(kid=>{
        const kv={};
        getCols().forEach(col=>{ kv[col.label]=getCell(kid.id,col.id)||undefined; });
        return {label:kid.label,total:rowTotal(kid.id),weeks:kv};
      })
    };
  });
  const obj={
    month:mk2,
    monthName:MONTHS_FULL[state.currentMonth]+' '+state.currentYear,
    columns:getCols().map(c=>c.label),
    rows:rowsOut,
    totals:{
      grand:grandTotal(),
      perColumn:Object.fromEntries(getCols().map(col=>[col.label,colTotal(col.id)]))
    }
  };
  const obj2=state.income[mk2];
  if(obj2) obj.income={gross:obj2.gross,tax:obj2.tax};
  return JSON.stringify(obj,null,2);
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
  if(obj.kind==='EXP-MONTH'){
    if(typeof obj.cells!=='object'||Array.isArray(obj.cells)) throw new Error('Invalid blob: bad cells object.');
    if(typeof obj.monthKey!=='string') throw new Error('Invalid blob: missing monthKey.');
  }
  if(obj.kind==='EXP-FULL'){
    if(typeof obj.cellsByMonth!=='object'||Array.isArray(obj.cellsByMonth)) throw new Error('Invalid blob: bad cellsByMonth.');
  }
  if(obj.kind==='SUBS'){
    if(typeof obj.cells!=='object'||Array.isArray(obj.cells)) throw new Error('Invalid blob: bad cells object.');
  }
  
  if(obj.rows.length>500)  throw new Error('Blob rejected: too many rows (max 500).');
  if(obj.cols.length>52)   throw new Error('Blob rejected: too many columns (max 52).');
  if(obj.kind==='EXP-FULL'){
    let totalCells=0;
    Object.values(obj.cellsByMonth).forEach(mc=>{ if(mc&&typeof mc==='object') totalCells+=Object.keys(mc).length; });
    if(totalCells>50000) throw new Error('Blob rejected: too many cells (max 50,000).');
    if(Object.keys(obj.cellsByMonth).length>120) throw new Error('Blob rejected: too many months (max 120).');
  } else if(obj.cells){
    if(Object.keys(obj.cells).length>50000) throw new Error('Blob rejected: too many cells (max 50,000).');
  }
  return migrateBlob(obj);
}
function migrateBlob(obj){
  
  
  return obj;
}


function buildExpMonthBlob(){
  const mk2=currentMK();
  const cells={};
  Object.keys(state.cells).forEach(k=>{ if(k.startsWith(mk2+'|')) cells[k]=state.cells[k]; });
  const inc=state.income[mk2]||{gross:'',tax:''};
  const rowsByMonth={}; if(state.rowsByMonth&&state.rowsByMonth[mk2]) rowsByMonth[mk2]=JSON.parse(JSON.stringify(state.rowsByMonth[mk2]));
  const colsByMonth={}; if(state.colsByMonth&&state.colsByMonth[mk2]) colsByMonth[mk2]=JSON.parse(JSON.stringify(state.colsByMonth[mk2]));
  return {
    kind:'EXP-MONTH', v:1, monthKey:mk2,
    rows:JSON.parse(JSON.stringify(getRows())),
    cols:JSON.parse(JSON.stringify(getCols())),
    rowsByMonth, colsByMonth,
    cells, income:{gross:inc.gross||'',tax:inc.tax||''},
    headerColWidth:state.headerColWidth, totalColWidth:state.totalColWidth,
    subsSnapshot:virtualSubChildren().map(c=>({label:c.label,cost:c.cost,weekCosts:c.weekCosts})),
  };
}

function buildExpFullBlob(){
  
  const cellsByMonth={};
  Object.keys(state.cells).forEach(k=>{
    const mk2=k.split('|')[0];
    (cellsByMonth[mk2]=cellsByMonth[mk2]||{})[k]=state.cells[k];
  });
  const subsSnapshotByMonth={};
  const subsData=loadSubsState();
  if(subsData&&subsData.rows&&subsData.cols){
    const svcCol=subsData.cols.find(c=>c.ctype==='text');
    for(let y=minY;y<=maxY;y++){
      for(let m2=0;m2<12;m2++){
        if(y===minY&&m2<minM) continue;
        if(y===maxY&&m2>maxM) continue;
        const mk2=mk(y,m2);
        const snap=subsData.rows.map(r=>({
          label:svcCol?subsData.cells[r.id+'|'+svcCol.id]||'-':'-',
          cost:calcSubMonthCostInExp(r,subsData,y,m2),
          weekCosts:getSubWeekCosts(r,subsData,y,m2),
        })).filter(c=>c.cost>0);
        if(snap.length) subsSnapshotByMonth[mk2]=snap;
      }
    }
  }
  return {
    kind:'EXP-FULL', v:1,
    rows:JSON.parse(JSON.stringify(state.rows)),
    cols:JSON.parse(JSON.stringify(state.cols)),
    rowsByMonth:JSON.parse(JSON.stringify(state.rowsByMonth||{})),
    colsByMonth:JSON.parse(JSON.stringify(state.colsByMonth||{})),
    cellsByMonth,
    income:JSON.parse(JSON.stringify(state.income||{})),
    collapsed:JSON.parse(JSON.stringify(state.collapsed||{})),
    headerColWidth:state.headerColWidth, totalColWidth:state.totalColWidth,
    currentYear:state.currentYear, currentMonth:state.currentMonth,
    subsSnapshotByMonth,
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

function restoreSubsLink(rowId){
  if(!confirm('Restore live link to your Subscription Tracker?\nThe pasted snapshot will be replaced with your current subscriptions.')) return;
  snapshot();
  const row=state.rows.find(r=>r.id===rowId); if(!row) return;
  delete row.snapshotLinkedRow;
  delete row.subsSnapshotByMonth;
  row.linked='subscriptions';
  save(); render();
}
function applySubsSnapshot(linkedRow, snapshotByMonth){
  if(!linkedRow||!snapshotByMonth) return;
  if(!linkedRow.subsSnapshotByMonth) linkedRow.subsSnapshotByMonth={};
  Object.assign(linkedRow.subsSnapshotByMonth, snapshotByMonth);
  linkedRow.snapshotLinkedRow=true;
  delete linkedRow.linked;
}

function importExpMonth(blob){
  const mk2=currentMK();
  
  Object.keys(state.cells).forEach(k=>{ if(k.startsWith(mk2+'|')) delete state.cells[k]; });
  const {blobRowIdMap, blobColIdMap}=_mergeRowsCols(blob.rows||[], blob.cols||[]);
  Object.entries(blob.cells||{}).forEach(([k,v])=>{
    const parts=k.split('|'); 
    const rId=blobRowIdMap[parts[1]], cId=blobColIdMap[parts[2]];
    if(rId&&cId) state.cells[mk2+'|'+rId+'|'+cId]=v;
  });
  if(blob.income) state.income[mk2]={gross:blob.income.gross||'',tax:blob.income.tax||''};
  
  if(blob.rowsByMonth&&blob.rowsByMonth[blob.monthKey]){
    if(!state.rowsByMonth) state.rowsByMonth={};
    state.rowsByMonth[mk2]=JSON.parse(JSON.stringify(blob.rowsByMonth[blob.monthKey]));
  }
  if(blob.colsByMonth&&blob.colsByMonth[blob.monthKey]){
    if(!state.colsByMonth) state.colsByMonth={};
    state.colsByMonth[mk2]=JSON.parse(JSON.stringify(blob.colsByMonth[blob.monthKey]));
  }
  if(blob.subsSnapshot){
    const lr=state.rows.find(r=>r.linked==='subscriptions'||r.snapshotLinkedRow);
    applySubsSnapshot(lr,{[mk2]:blob.subsSnapshot});
  }
}

function importExpFull(blob, selectedMonths){
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
    
    if(blob.income && blob.income[mk2]) state.income[mk2]={gross:blob.income[mk2].gross||'',tax:blob.income[mk2].tax||''};
  });
  
  if(blob.subsSnapshotByMonth){
    const lr=state.rows.find(r=>r.linked==='subscriptions'||r.snapshotLinkedRow);
    const rel={};
    selectedMonths.forEach(mk2=>{if(blob.subsSnapshotByMonth[mk2]) rel[mk2]=blob.subsSnapshotByMonth[mk2];});
    if(Object.keys(rel).length) applySubsSnapshot(lr,rel);
  }
}


function openPasteModal(){
  const overlay=document.createElement('div');overlay.className='share-overlay';
  const modal=document.createElement('div');modal.className='share-modal';
  const h=document.createElement('h3');h.textContent='Paste FiApp data';
  const desc=document.createElement('span');desc.className='share-hint';desc.textContent='Paste a FIAPP-… block copied from another FiApp tracker. Pastes are undoable with Ctrl+Z.';
  const ta=document.createElement('textarea');ta.placeholder='Paste FIAPP-EXP-… or FIAPP-SUBS-… block here';
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
      if(obj.kind==='EXP-MONTH'){
        const [yy,mm]=obj.monthKey.split('-');
        label='This month - '+MONTHS_FULL[parseInt(mm,10)-1]+' '+yy;
      } else if(obj.kind==='EXP-FULL'){
        const months=Object.keys(obj.cellsByMonth||{}).filter(k=>Object.keys(obj.cellsByMonth[k]).length).length;
        if(months===0){
          status.textContent='⚠ This blob has no month data - the spreadsheet was empty when it was copied.';
          status.className='paste-status bad';
          applyBtn.disabled=true;
          parsed=null;
          return;
        }
        label='Full data - '+months+' month'+(months===1?'':'s');
      } else if(obj.kind==='SUBS'){
        label='Subscription tracker (open the Subscription Tracker page to paste)'; applyBtn.disabled=true; status.textContent='⚠ '+label; status.className='paste-status bad'; return;
      } else { throw new Error('Unsupported kind: '+obj.kind); }
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
    if(parsed.kind==='EXP-MONTH'){
      snapshot();importExpMonth(parsed);save();render();syncIncomeInputs();
      overlay.remove();showExportFlash('✓ Pasted (this month)');
    } else if(parsed.kind==='EXP-FULL'){
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
    snapshot();importExpFull(blob,sel);save();render();syncIncomeInputs();
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
    XLSX.utils.book_append_sheet(wb,ws,'Expenses');
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
  const base='expenses-'+ym;
  const menu=document.createElement('div');menu.className='export-menu';
  const formats=[
    {label:'📄 CSV',  fn:()=>downloadText(base+'.csv',buildCsv(),'text/csv;charset=utf-8')},
    {label:'{ } JSON',fn:()=>downloadText(base+'.json',buildJson(),'application/json')},
    {label:'📃 TXT',  fn:()=>downloadText(base+'.txt',buildTxt(),'text/plain;charset=utf-8')},
    {label:'📊 XLSX', fn:()=>exportXlsx(base+'.xlsx')},
    {label:'📋 Copy table - This month', fn:()=>clipboardWrite(encodeBlob(buildExpMonthBlob())).then(ok=>showExportFlash(ok?'✓ Copied (this month)':'Copy failed'))},
    {label:'📋 Copy table - Full data',  fn:()=>clipboardWrite(encodeBlob(buildExpFullBlob())).then(ok=>showExportFlash(ok?'✓ Copied (full)':'Copy failed'))},
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
  const title='FiApp Expenses - '+MONTHS_SHORT[state.currentMonth]+' '+state.currentYear;
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

  
  const emailXlsxBtn=document.createElement('a');emailXlsxBtn.className='btn btn-sm';emailXlsxBtn.textContent='📧 Email as XLSX';
  const ym=String(state.currentYear)+'-'+String(state.currentMonth+1).padStart(2,'0');
  const xlsxBody='I\'m sharing my FiApp expenses spreadsheet. Open FiApp at https://fiapp.onrender.com/expenses to view your own data.\n\nAttached XLSX file (saved to your Downloads folder): expenses-'+ym+'.xlsx';
  emailXlsxBtn.href=gmailHref(title,xlsxBody);emailXlsxBtn.target='_blank';emailXlsxBtn.rel='noopener noreferrer';
  emailXlsxBtn.addEventListener('click',()=>{
    
    exportXlsx('expenses-'+ym+'.xlsx');
    flash.textContent='XLSX downloading - drag it into Gmail to attach.';
    setTimeout(()=>flash.textContent='',5000);
  });

  
  const emailPasteBtn=document.createElement('a');emailPasteBtn.className='btn btn-sm';emailPasteBtn.textContent='📧 Email as Paste-link';
  const blob=encodeBlob(buildExpMonthBlob());
  const pasteBody=('I\'m sharing my FiApp expense data for '+MONTHS_SHORT[state.currentMonth]+' '+state.currentYear+'.\n\nPaste this block into the FiApp Expense Tracker at https://fiapp.onrender.com/expenses using the 📋 Paste button to load the data:\n\n'+blob).slice(0,2000);
  emailPasteBtn.href=gmailHref(title,pasteBody);emailPasteBtn.target='_blank';emailPasteBtn.rel='noopener noreferrer';

  const closeBtn=document.createElement('button');closeBtn.className='btn btn-sm btn-ghost';closeBtn.textContent='Close';
  closeBtn.addEventListener('click',()=>overlay.remove());
  overlay.addEventListener('click',e=>{if(e.target===overlay)overlay.remove();});

  actions.appendChild(flash);
  actions.appendChild(copyBtn);
  actions.appendChild(emailTextBtn);
  actions.appendChild(emailXlsxBtn);
  actions.appendChild(emailPasteBtn);
  actions.appendChild(closeBtn);

  modal.appendChild(h);modal.appendChild(ta);modal.appendChild(hint);modal.appendChild(actions);
  overlay.appendChild(modal);document.body.appendChild(overlay);
}


(function(){
  const tip=document.createElement('div');tip.id='swatch-tip';document.body.appendChild(tip);
  let hideT;
  function show(el){
    clearTimeout(hideT);
    const label=el.dataset.tip; if(!label) return;
    tip.textContent=label;
    tip.classList.add('show');
    
    const r=el.getBoundingClientRect();
    tip.style.left=(r.left+r.width/2-tip.offsetWidth/2)+'px';
    tip.style.top=(r.top-tip.offsetHeight-6)+'px';
    
    requestAnimationFrame(()=>{
      const r2=el.getBoundingClientRect();
      tip.style.left=Math.max(4,r2.left+r2.width/2-tip.offsetWidth/2)+'px';
      tip.style.top=(r2.top-tip.offsetHeight-6)+'px';
    });
  }
  function hide(){ hideT=setTimeout(()=>tip.classList.remove('show'),80); }
  
  document.addEventListener('mouseover',e=>{
    const h=e.target.closest('.tip-host[data-tip]');
    if(h) show(h); else hide();
  });
  document.addEventListener('mouseout',e=>{
    if(!e.target.closest('.tip-host[data-tip]')) hide();
  });
  
  document.addEventListener('touchstart',e=>{
    const h=e.target.closest('.tip-host[data-tip]');
    
    document.querySelectorAll('.tip-host.tip-visible').forEach(el=>{ if(el!==h) el.classList.remove('tip-visible'); });
    if(h){
      h.classList.add('tip-visible');
      show(h);
    } else {
      hide();
    }
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
  try{ await loadSubsFromServer(); }catch(e){ console.warn('FiApp: loadSubsFromServer failed',e); }
  try{ state=loadState(); }catch(e){ console.warn('FiApp: loadState failed',e); state=freshState(); }
  try{ loadHistory(); }catch(e){}
  try{ loadTaxCarryover(); }catch(e){}
  try{ updateHistBtns(); }catch(e){}
  try{ updateMonthNav(); }catch(e){ console.error('FiApp: updateMonthNav failed',e); }
  try{ syncIncomeInputs(); }catch(e){}
  try{ render(); }catch(e){ console.error('FiApp: render failed',e); }

  fetchExpRates().then(()=>{ if(getRows().some(r=>r.linked==='subscriptions')) render(); }).catch(()=>{});

  syncFromIncomeTracker(currentMK()).catch(()=>{});

  window.addEventListener('storage',e=>{
    if(e.key===SUBS_KEY) render();
    if(e.key===INCOME_KEY||e.key===INCOME_PUSH_KEY) syncFromIncomeTracker(currentMK()).catch(()=>{});
  });
})();

// Static toolbar event wiring (replaces onclick= attributes)
document.getElementById('help-open-btn').addEventListener('click',openHelp);
document.getElementById('guide-btn').addEventListener('click',function(){wtStartEnhanced('expenses');});
document.getElementById('prev-btn').addEventListener('click',function(){shiftMonth(-1);});
document.getElementById('next-btn').addEventListener('click',function(){shiftMonth(1);});
document.getElementById('copy-prev-btn').addEventListener('click',copyStructureFromPrevMonth);
document.getElementById('copy-month-btn').addEventListener('click',showMonthCopyPicker);
document.getElementById('forecast-copy-last-btn').addEventListener('click',copyLastMonth);
document.getElementById('forecast-avg-btn').addEventListener('click',useAverages);
document.getElementById('apply-year-btn').addEventListener('click',applyIncomeToYear);
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
// Help modal: close on overlay click or close button
document.getElementById('help-modal').addEventListener('click',function(e){if(e.target===this)closeHelp();});
document.getElementById('help-close-btn').addEventListener('click',closeHelp);
// Event delegation for dynamically-injected income-sync update button
document.getElementById('income-sync-badge').addEventListener('click',function(e){
  var btn=e.target.closest('[data-action="accept-income-sync"]');
  if(btn) acceptIncomeSync(btn.dataset.mk);
});

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
