const TOOLKIT_URL = 'https://mini513.github.io/UX-Strategy/modules/heuristic/index.html';
const TOOLKIT_MATCH = 'https://mini513.github.io/UX-Strategy/modules/heuristic/*';
const TOOLKIT_PREFIX = 'https://mini513.github.io/UX-Strategy/';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForComplete(tabId, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      reject(new Error('툴킷 페이지가 열리지 않았습니다. 인터넷 연결을 확인해 주세요.'));
    }, timeoutMs);
    function onUpdated(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(onUpdated);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

// 이미 열려 있는 평가 탭이 있으면 거기에 이어서 넣고, 없을 때만 새로 연다
async function getToolkitTab(windowId) {
  const tabs = await chrome.tabs.query({ url: TOOLKIT_MATCH });
  const sameWindow = tabs.find((t) => t.windowId === windowId);
  if (sameWindow || tabs[0]) return sameWindow || tabs[0];
  const created = await chrome.tabs.create({ url: TOOLKIT_URL, windowId, active: false });
  await waitForComplete(created.id);
  return created;
}

// 새로 연 탭은 수신 스크립트가 준비되기 전에 메시지가 도착할 수 있어 몇 번 다시 보낸다
async function sendWithRetry(tabId, message) {
  let lastError;
  for (let i = 0; i < 10; i++) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, message);
      if (res && res.ok) return res;
      lastError = new Error((res && res.error) || '툴킷이 캡처를 받지 못했습니다.');
    } catch (e) {
      lastError = e;
    }
    await sleep(300);
  }
  throw lastError;
}

async function flashBadge(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2000);
}

async function captureAndSend({ focus }) {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab) throw new Error('캡처할 화면을 찾지 못했습니다.');
  if (tab.url && tab.url.startsWith(TOOLKIT_PREFIX)) {
    throw new Error('툴킷 화면은 캡처하지 않습니다. 평가할 화면에서 눌러 주세요.');
  }

  let dataUrl;
  try {
    dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  } catch (e) {
    throw new Error('이 화면은 캡처할 수 없습니다. 브라우저 설정 화면이나 새 탭에서는 동작하지 않아요.');
  }

  const target = await getToolkitTab(tab.windowId);
  const res = await sendWithRetry(target.id, {
    type: 'ux-capture',
    dataUrl,
    url: tab.url || '',
    title: tab.title || ''
  });

  if (focus) {
    await chrome.tabs.update(target.id, { active: true });
    await chrome.windows.update(target.windowId, { focused: true });
  }
  return res;
}

async function run(focus) {
  try {
    const res = await captureAndSend({ focus });
    await flashBadge(String(res.count || '✓'), '#4F46E5');
    return { ok: true, count: res.count };
  } catch (e) {
    await flashBadge('!', '#DC2626');
    return { ok: false, error: e.message };
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'capture') {
    run(Boolean(msg.focus)).then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'open-toolkit') {
    chrome.tabs.query({ url: TOOLKIT_MATCH }).then(async (tabs) => {
      if (tabs[0]) {
        await chrome.tabs.update(tabs[0].id, { active: true });
        await chrome.windows.update(tabs[0].windowId, { focused: true });
      } else {
        await chrome.tabs.create({ url: TOOLKIT_URL });
      }
      sendResponse({ ok: true });
    });
    return true;
  }
  return false;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'capture-and-send') return;
  const { focusAfter } = await chrome.storage.local.get({ focusAfter: false });
  await run(focusAfter);
});
