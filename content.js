(() => {
  if (window.__skyroomAttendanceInstalled) return;
  window.__skyroomAttendanceInstalled = true;
  const EXCLUDED = new Set([
    'public chat', 'shared notes', 'مکالمه عمومی', 'گفتگوی عمومی', 'گفتگوی همگانی',
    'یادداشت مشترک', 'یادداشت‌های مشترک', 'shared note'
  ]);
  let sessionId = null;
  let timerId = null;
  let intervalMinutes = 2;
  let monitoring = false;

  function cleanName(value) {
    return String(value || '').replace(/[\u200B-\u200F\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  }
  function getNames() {
    const found = new Map();
    document.querySelectorAll('.user-nickname').forEach(el => {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || !el.getClientRects().length) return;
      const name = cleanName(el.getAttribute('title') || el.textContent);
      if (!name || name.length > 120 || EXCLUDED.has(name.toLocaleLowerCase())) return;
      const key = name.toLocaleLowerCase();
      if (!found.has(key)) found.set(key, name);
    });
    return [...found.values()].sort((a,b) => a.localeCompare(b, 'fa'));
  }
  function ensureSession() {
    if (!sessionId) sessionId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  }
  function scan() {
    ensureSession();
    const scannedAt = new Date().toISOString();
    chrome.runtime.sendMessage({type: 'CONTENT_SCAN', sessionId, names: getNames(), scannedAt, intervalMinutes}).catch(() => {});
  }
  function begin() {
    ensureSession();
    monitoring = true;
    clearInterval(timerId);
    chrome.runtime.sendMessage({type: 'CONTENT_SESSION_START', sessionId, intervalMinutes}).catch(() => {});
    scan();
    timerId = setInterval(scan, intervalMinutes * 60 * 1000);
  }
  function stop() {
    monitoring = false;
    clearInterval(timerId);
    timerId = null;
    if (sessionId) chrome.runtime.sendMessage({type: 'CONTENT_STATUS', sessionId, isMonitoring: false, intervalMinutes}).catch(() => {});
  }
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'START') {
      intervalMinutes = [1,2,3,5].includes(Number(msg.intervalMinutes)) ? Number(msg.intervalMinutes) : 2;
      begin(); sendResponse({ok: true, isMonitoring: true});
    } else if (msg?.type === 'STOP') {
      stop(); sendResponse({ok: true, isMonitoring: false});
    } else if (msg?.type === 'SCAN') {
      scan(); sendResponse({ok: true, names: getNames().length});
    } else if (msg?.type === 'SET_INTERVAL') {
      intervalMinutes = [1,2,3,5].includes(Number(msg.intervalMinutes)) ? Number(msg.intervalMinutes) : 2;
      if (monitoring) { clearInterval(timerId); timerId = setInterval(scan, intervalMinutes * 60 * 1000); }
      if (sessionId) chrome.runtime.sendMessage({type: 'CONTENT_STATUS', sessionId, isMonitoring: monitoring, intervalMinutes}).catch(() => {});
      sendResponse({ok: true, intervalMinutes});
    }
    return true;
  });
})();
