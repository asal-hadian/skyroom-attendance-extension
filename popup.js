const $ = id => document.getElementById(id);
let allSessions = {};
let activeTab = null;
let selectedSessionId = null;
let onSkyroom = false;
const persianDigits = value => String(value).replace(/\d/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
function fmtTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('fa-IR', {dateStyle:'short', timeStyle:'short'}).format(date);
}
function showNotice(text, error=false) {
  const node=$('notice'); node.textContent=text; node.classList.add('show'); node.classList.toggle('error', error);
  setTimeout(()=>node.classList.remove('show'), 4200);
}
function orderedSessions() { return Object.values(allSessions).sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')); }
function relevantSession() {
  if (onSkyroom && activeTab) {
    const matches=orderedSessions().filter(s=>s.tabId===activeTab.id);
    if (matches.length) return matches[0];
  }
  return allSessions[selectedSessionId] || orderedSessions()[0] || null;
}
function render() {
  const sessions=orderedSessions();
  const sel=$('sessionSelect');
  const old=selectedSessionId;
  sel.innerHTML='';
  if (!sessions.length) { const o=document.createElement('option');o.value='';o.textContent='جلسه‌ای ذخیره نشده';sel.append(o);selectedSessionId=null; }
  else {
    for(const s of sessions){const o=document.createElement('option');o.value=s.sessionId;o.textContent=`${fmtTime(s.startedAt)} — ${Object.keys(s.people||{}).length} نام`;sel.append(o);}
    selectedSessionId=(onSkyroom ? sessions.find(s=>s.tabId===activeTab?.id)?.sessionId : null) || (sessions.some(s=>s.sessionId===old)?old:sessions[0].sessionId);
    sel.value=selectedSessionId;
  }
  const session=relevantSession();
  $('monitorStatus').textContent=onSkyroom ? (session?.isMonitoring?'در حال ثبت':'متوقف') : 'فقط مشاهدهٔ داده‌های ذخیره‌شده';
  const names=session?.latestNames||[];
  $('currentCount').textContent=persianDigits(names.length);
  $('lastScan').textContent=fmtTime(session?.latestScanAt);
  $('scanCount').textContent=persianDigits(session?.scans||0);
  const tbody=$('people');tbody.innerHTML='';
  const people=Object.values(session?.people||{}).sort((a,b)=>a.name.localeCompare(b.name,'fa'));
  $('empty').style.display=people.length?'none':'block';
  for(const p of people){const tr=document.createElement('tr');for(const v of [p.name,fmtTime(p.firstSeen),fmtTime(p.lastSeen),persianDigits(p.count)]){const td=document.createElement('td');td.textContent=v;if(v.includes('/')||v.includes(':'))td.className='time';tr.append(td);}tbody.append(tr);}
  $('export').disabled=!people.length;
  $('clear').disabled=!sessions.length;
  $('toggle').textContent=session?.isMonitoring?'توقف ثبت':'شروع ثبت';
}
async function refresh() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});activeTab=tab||null;
  onSkyroom=!!(tab?.url && new URL(tab.url).origin==='https://vc.sharif.edu');
  $('pageStatus').textContent=onSkyroom?'صفحهٔ vc.sharif.edu':'خارج از vc.sharif.edu';
  $('toggle').disabled=!onSkyroom;$('scan').disabled=!onSkyroom;
  const response=await chrome.runtime.sendMessage({type:'GET_DATA'});
  allSessions=response.sessions||{};
  $('interval').value=String(response.settings?.intervalMinutes||2);
  render();
}
$('sessionSelect').addEventListener('change', e=>{selectedSessionId=e.target.value;render();});
$('interval').addEventListener('change', async e=>{
  const minutes=Number(e.target.value);
  await chrome.runtime.sendMessage({type:'SET_INTERVAL',intervalMinutes:minutes,tabId:activeTab?.id});
  showNotice(`فاصلهٔ اسکن روی ${persianDigits(minutes)} دقیقه تنظیم شد.`);
});
$('toggle').addEventListener('click',async()=>{
  const session=relevantSession();const action=session?.isMonitoring?'STOP':'START';
  const result=await chrome.runtime.sendMessage({type:'CONTROL',action,tabId:activeTab?.id,intervalMinutes:Number($('interval').value)});
  if(!result.ok) showNotice('ارتباط با صفحه برقرار نشد؛ صفحه را تازه‌سازی و دوباره امتحان کنید.',true);
  else {showNotice(action==='START'?'ثبت آغاز شد.':'ثبت متوقف شد.');setTimeout(refresh,250);}
});
$('scan').addEventListener('click',async()=>{
  const result=await chrome.runtime.sendMessage({type:'CONTROL',action:'SCAN',tabId:activeTab?.id,intervalMinutes:Number($('interval').value)});
  if(!result.ok) showNotice('اسکن انجام نشد؛ صفحه را تازه‌سازی و دوباره امتحان کنید.',true);
  else {showNotice('درخواست اسکن ارسال شد.');setTimeout(refresh,350);}
});
$('export').addEventListener('click',()=>{
  const session=relevantSession();if(!session)return;
  const rows=[['نام','اولین مشاهده','آخرین مشاهده','تعداد اسکن دارای نام','کل اسکن‌های جلسه','سهم اسکن‌ها (تقریبی، نه حضور قطعی)']];
  for(const p of Object.values(session.people||{})) rows.push([p.name,p.firstSeen,p.lastSeen,p.count,session.scans,session.scans?`${(100*p.count/session.scans).toFixed(1)}%`:'']);
  const csv='\uFEFF'+rows.map(row=>row.map(value=>'"'+String(value??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=`skyroom-observations-${(session.startedAt||'').slice(0,10)||'session'}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
$('clear').addEventListener('click',async()=>{
  if(!confirm('همهٔ جلسه‌ها و نام‌های ذخیره‌شده از این افزونه پاک شوند؟'))return;
  await chrome.runtime.sendMessage({type:'CLEAR_DATA'});allSessions={};selectedSessionId=null;render();showNotice('همهٔ داده‌های ذخیره‌شده پاک شدند.');
});
refresh().catch(()=>showNotice('خواندن داده‌ها با خطا روبه‌رو شد.',true));
