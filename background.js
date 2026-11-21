const SESSIONS_KEY = 'sessions';
const SETTINGS_KEY = 'settings';

async function readSessions() {
  const obj = await chrome.storage.local.get(SESSIONS_KEY);
  return obj[SESSIONS_KEY] || {};
}
async function saveSessions(sessions) {
  await chrome.storage.local.set({[SESSIONS_KEY]: sessions});
}
async function isSkyroomTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    return !!tab.url && new URL(tab.url).origin === 'https://vc.sharif.edu';
  } catch (_) { return false; }
}
async function markTabStopped(tabId) {
  const sessions = await readSessions();
  let changed = false;
  for (const item of Object.values(sessions)) {
    if (item.tabId === tabId && item.isMonitoring) {
      item.isMonitoring = false;
      item.updatedAt = new Date().toISOString();
      changed = true;
    }
  }
  if (changed) await saveSessions(sessions);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg?.type === 'CONTENT_SESSION_START' || msg?.type === 'CONTENT_SCAN' || msg?.type === 'CONTENT_STATUS') {
      const tabId = sender.tab?.id;
      if (tabId == null) return {ok: false};
      const sessions = await readSessions();
      const now = new Date().toISOString();
      let session = sessions[msg.sessionId];
      if (!session) {
        session = sessions[msg.sessionId] = {
          sessionId: msg.sessionId, tabId, startedAt: now, updatedAt: now,
          isMonitoring: false, intervalMinutes: msg.intervalMinutes || 2,
          scans: 0, latestScanAt: null, latestNames: [], people: {}
        };
      }
      session.tabId = tabId;
      session.updatedAt = now;
      if (msg.type === 'CONTENT_SESSION_START') {
        session.isMonitoring = true;
        session.intervalMinutes = msg.intervalMinutes || session.intervalMinutes || 2;
        session.startedAt = session.startedAt || now;
      } else if (msg.type === 'CONTENT_STATUS') {
        session.isMonitoring = !!msg.isMonitoring;
        if (msg.intervalMinutes) session.intervalMinutes = msg.intervalMinutes;
      } else if (msg.type === 'CONTENT_SCAN') {
        const names = [...new Set((Array.isArray(msg.names) ? msg.names : []).filter(n => typeof n === 'string'))];
        session.scans = (session.scans || 0) + 1;
        session.latestScanAt = msg.scannedAt || now;
        session.latestNames = names;
        session.intervalMinutes = msg.intervalMinutes || session.intervalMinutes || 2;
        for (const name of names) {
          const key = name.trim().toLocaleLowerCase();
          if (!key) continue;
          if (!session.people[key]) session.people[key] = {name: name.trim(), firstSeen: session.latestScanAt, lastSeen: session.latestScanAt, count: 0};
          const person = session.people[key];
          person.lastSeen = session.latestScanAt;
          person.count += 1;
        }
      }
      sessions[msg.sessionId] = session;
      await saveSessions(sessions);
      return {ok: true, sessionId: msg.sessionId};
    }
    if (msg?.type === 'GET_DATA') {
      const data = await chrome.storage.local.get([SESSIONS_KEY, SETTINGS_KEY]);
      return {ok: true, sessions: data[SESSIONS_KEY] || {}, settings: data[SETTINGS_KEY] || {intervalMinutes: 2}};
    }
    if (msg?.type === 'SET_INTERVAL') {
      const mins = [1,2,3,5].includes(Number(msg.intervalMinutes)) ? Number(msg.intervalMinutes) : 2;
      await chrome.storage.local.set({[SETTINGS_KEY]: {intervalMinutes: mins}});
      if (Number.isInteger(msg.tabId) && await isSkyroomTab(msg.tabId)) {
        try { await chrome.tabs.sendMessage(msg.tabId, {type: 'SET_INTERVAL', intervalMinutes: mins}); } catch (_) {}
      }
      return {ok: true, intervalMinutes: mins};
    }
    if (msg?.type === 'CONTROL') {
      if (!Number.isInteger(msg.tabId) || !(await isSkyroomTab(msg.tabId))) return {ok: false, error: 'not-skyroom'};
      const action = ['START', 'STOP', 'SCAN'].includes(msg.action) ? msg.action : null;
      if (!action) return {ok: false, error: 'unknown-action'};
      const settingsObj = await chrome.storage.local.get(SETTINGS_KEY);
      const intervalMinutes = [1,2,3,5].includes(Number(msg.intervalMinutes)) ? Number(msg.intervalMinutes) : (settingsObj[SETTINGS_KEY]?.intervalMinutes || 2);
      try {
        const result = await chrome.tabs.sendMessage(msg.tabId, {type: action, intervalMinutes});
        return {ok: true, result};
      } catch (_) { return {ok: false, error: 'content-not-ready'}; }
    }
    if (msg?.type === 'CLEAR_DATA') {
      await chrome.storage.local.remove(SESSIONS_KEY);
      return {ok: true};
    }
    return {ok: false, error: 'unknown-message'};
  })().then(sendResponse).catch(err => sendResponse({ok: false, error: String(err)}));
  return true;
});

chrome.tabs.onRemoved.addListener(tabId => { markTabStopped(tabId).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url && !changeInfo.url.startsWith('https://vc.sharif.edu/')) markTabStopped(tabId).catch(() => {});
});
