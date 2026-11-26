// 툴킷 휴리스틱 평가 페이지에서 실행된다.
// 툴킷 코드를 고치지 않도록, 사람이 파일을 고른 것과 같은 방식(파일 입력 change 이벤트)으로 캡처를 넣는다.

function dataUrlToFile(dataUrl, name) {
  const [head, body] = dataUrl.split(',');
  const mime = (head.match(/data:([^;]+)/) || [])[1] || 'image/png';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

function fileName(title) {
  const safe = (title || 'capture').replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 60) || 'capture';
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
  return `${safe}_${stamp}.png`;
}

// 평가자가 이미 적어 둔 값은 덮어쓰지 않는다
function fillIfEmpty(id, value) {
  const el = document.getElementById(id);
  if (!el || el.value.trim() || !value) return;
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function showToast(text) {
  let toast = document.getElementById('ux-capture-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'ux-capture-toast';
    toast.setAttribute('role', 'status');
    toast.style.cssText = [
      'position:fixed', 'right:20px', 'bottom:20px', 'z-index:2147483647',
      'padding:10px 16px', 'border-radius:8px', 'background:#1E1B4B', 'color:#fff',
      'font:500 14px/1.4 system-ui,sans-serif', 'box-shadow:0 4px 12px rgba(0,0,0,.2)'
    ].join(';');
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.hidden = true; }, 2500);
}

let received = 0;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ux-capture') return false;
  try {
    const input = document.getElementById('targetFileInput');
    if (!input) {
      sendResponse({ ok: false, error: '휴리스틱 평가 화면에서 캡처 칸을 찾지 못했습니다. 툴킷을 새로고침해 주세요.' });
      return false;
    }
    const dt = new DataTransfer();
    dt.items.add(dataUrlToFile(msg.dataUrl, fileName(msg.title)));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    if (/^https?:\/\//i.test(msg.url)) fillIfEmpty('targetUrl', msg.url);
    fillIfEmpty('projectLabel', msg.title);

    received += 1;
    showToast(`캡처를 추가했습니다 (${received}장)`);
    sendResponse({ ok: true, count: received });
  } catch (e) {
    sendResponse({ ok: false, error: e.message });
  }
  return false;
});
