const $ = (id) => document.getElementById(id);

function setStatus(text, kind) {
  $('status').textContent = text;
  $('status').className = kind || '';
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    $('pageTitle').textContent = tab.title || '현재 화면';
    $('pageUrl').textContent = tab.url || '';
  }
  const { focusAfter } = await chrome.storage.local.get({ focusAfter: false });
  $('focusAfter').checked = focusAfter;
}

$('focusAfter').addEventListener('change', (e) => {
  chrome.storage.local.set({ focusAfter: e.target.checked });
});

$('captureBtn').addEventListener('click', async () => {
  const btn = $('captureBtn');
  btn.disabled = true;
  setStatus('캡처해서 보내는 중…');
  const res = await chrome.runtime.sendMessage({ type: 'capture', focus: $('focusAfter').checked });
  btn.disabled = false;
  if (res && res.ok) {
    setStatus(`휴리스틱 평가에 추가했습니다 (${res.count}장)`, 'ok');
  } else {
    setStatus((res && res.error) || '보내지 못했습니다. 다시 시도해 주세요.', 'err');
  }
});

$('openBtn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'open-toolkit' });
  window.close();
});

init();
