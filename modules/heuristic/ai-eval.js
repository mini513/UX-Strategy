// AI 휴리스틱 평가표: 평가 대상 캡처를 Claude로 분석해 화면에 맞는 관찰·질문을 만들고,
// 평가자가 그 분석을 검증하게 한다. 심각도 대신 '분석이 맞는지'를 평가하는 것이 목적이다.
import Anthropic from 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@1.8.0/+esm';

const SETTINGS_KEY = UXStorage._key('heuristic', 'ai-settings');
const RESULT_KEY = UXStorage._key('heuristic', 'ai-sheet');
const DEFAULTS = { baseURL: 'https://llm.kohyoung.com', model: 'claude-opus-5' };
const MAX_IMAGES = 4;

const HEURISTIC_NAMES = [
  'H1 시스템 상태의 가시성', 'H2 시스템과 현실 세계의 일치', 'H3 사용자 제어와 자유', 'H4 일관성과 표준',
  'H5 오류 예방', 'H6 기억보다 인식', 'H7 사용의 유연성과 효율성', 'H8 미적이고 미니멀한 디자인',
  'H9 오류 인식·진단·복구', 'H10 도움말과 문서',
];

const SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'object',
      properties: {
        purpose: { type: 'string', description: '이 화면이 사용자에게 하게 하려는 일' },
        elements: { type: 'string', description: '화면의 주요 구성 요소' },
        users: { type: 'string', description: '이 화면을 주로 쓸 것으로 보이는 사용자' },
      },
      required: ['purpose', 'elements', 'users'],
      additionalProperties: false,
    },
    observations: {
      type: 'array',
      description: '화면에서 관찰한 사용성 문제 또는 잘 된 점',
      items: {
        type: 'object',
        properties: {
          heuristic: { type: 'string', enum: HEURISTIC_NAMES },
          where: { type: 'string', description: '화면 안의 위치' },
          text: { type: 'string', description: '관찰한 내용' },
        },
        required: ['heuristic', 'where', 'text'],
        additionalProperties: false,
      },
    },
    questions: {
      type: 'array',
      description: '평가자가 화면을 보고 판단할 질문',
      items: {
        type: 'object',
        properties: {
          heuristic: { type: 'string', enum: HEURISTIC_NAMES },
          question: { type: 'string' },
          intent: { type: 'string', description: '이 질문으로 확인하려는 것' },
        },
        required: ['heuristic', 'question', 'intent'],
        additionalProperties: false,
      },
    },
    needs_check: {
      type: 'array',
      description: '캡처만으로는 판단할 수 없어 평가자가 확인해야 하는 것',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'observations', 'questions', 'needs_check'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `당신은 SMT(표면실장) 검사 장비 소프트웨어를 잘 아는 UX 전문가입니다.
주어진 화면 캡처를 닐슨의 10가지 휴리스틱 원칙으로 분석하고, 다른 UX 전문가가 이 화면을 평가할 때 쓸 평가표 초안을 만듭니다.

- 캡처에 실제로 보이는 것만 근거로 씁니다. 보이지 않는 동작이나 데이터는 추측하지 말고 needs_check에 넣습니다.
- observations에는 구체적인 위치와 함께 관찰한 사실을 씁니다. 문제만이 아니라 잘 된 점도 포함할 수 있습니다.
- questions는 평가자가 화면을 보고 예/아니요로 판단하고 근거를 댈 수 있는 질문으로 씁니다. 6~10개, 여러 원칙에 고르게 나눕니다.
- 심각도 점수는 매기지 않습니다.
- 현장 용어(Pad, Package, Fiducial, JOB, Squeeze, NG/Pass 등)는 그대로 쓰고, 모든 문장은 한국어 존댓말로 짧게 씁니다.`;

const $ = (id) => document.getElementById(id);
let sheet = null; // { generatedAt, model, target, data, answers }

function loadJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch (e) { return null; }
}
function saveJSON(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    return false;
  }
}

function getSettings() {
  const s = loadJSON(SETTINGS_KEY) || {};
  return {
    baseURL: (s.baseURL || DEFAULTS.baseURL).trim(),
    model: (s.model || DEFAULTS.model).trim(),
    token: s.token || '',
  };
}

function setStatus(text, isError) {
  const el = $('aiStatus');
  el.textContent = text;
  el.classList.toggle('ai-status-err', Boolean(isError));
}

function esc(s) {
  const d = document.createElement('div');
  d.textContent = s == null ? '' : String(s);
  return d.innerHTML;
}

// targetImages는 모두 JPEG data URL로 저장돼 있다 (index.html의 addTargetImageFile 참고)
function toImageBlocks(dataUrls) {
  return dataUrls.slice(0, MAX_IMAGES).map((url) => {
    const [head, data] = url.split(',');
    const mediaType = (head.match(/data:([^;]+)/) || [])[1] || 'image/jpeg';
    return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
  });
}

function buildUserText() {
  const label = $('projectLabel').value.trim();
  const url = $('targetUrl').value.trim();
  const jobs = [...document.querySelectorAll('#uxJobs .chip[aria-pressed="true"]')].map((c) => c.textContent.trim());
  const lines = ['위 화면 캡처로 휴리스틱 평가표 초안을 만들어 주세요.'];
  if (label) lines.push(`화면명: ${label}`);
  if (url) lines.push(`화면 주소: ${url}`);
  if (jobs.length) lines.push(`이 화면을 주로 사용할 것으로 예상되는 직무: ${jobs.join(', ')}`);
  return lines.join('\n');
}

async function generate() {
  const images = typeof window.getTargetImages === 'function' ? window.getTargetImages() : [];
  if (!images.length) {
    setStatus('평가 정보의 "평가 대상 화면 캡처"에 화면을 먼저 넣어 주세요.', true);
    $('targetUploadZone').focus();
    return;
  }
  const settings = getSettings();
  if (!settings.token) {
    setStatus('AI 설정에서 인증 토큰을 먼저 저장해 주세요.', true);
    openSettings(true);
    return;
  }

  const btn = $('aiGenerateBtn');
  btn.disabled = true;
  setStatus(`화면 ${Math.min(images.length, MAX_IMAGES)}장을 분석하는 중입니다. 1분 정도 걸릴 수 있습니다…`);

  try {
    const client = new Anthropic({
      baseURL: settings.baseURL,
      authToken: settings.token,
      apiKey: null,
      dangerouslyAllowBrowser: true,
    });
    const stream = client.messages.stream({
      model: settings.model,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{
        role: 'user',
        content: [...toImageBlocks(images), { type: 'text', text: buildUserText() }],
      }],
    });
    const message = await stream.finalMessage();

    if (message.stop_reason === 'refusal') {
      setStatus('AI가 이 요청을 처리하지 않았습니다. 다른 캡처로 다시 시도해 주세요.', true);
      return;
    }
    if (message.stop_reason === 'max_tokens') {
      setStatus('결과가 너무 길어 중간에 끊겼습니다. 캡처 수를 줄여 다시 시도해 주세요.', true);
      return;
    }
    const textBlock = message.content.find((b) => b.type === 'text');
    const data = JSON.parse(textBlock ? textBlock.text : '');

    sheet = {
      generatedAt: new Date().toISOString(),
      model: message.model || settings.model,
      target: $('projectLabel').value.trim(),
      imageCount: Math.min(images.length, MAX_IMAGES),
      data,
      answers: { observations: {}, questions: {} },
    };
    persist();
    render();
    setStatus(`평가표를 만들었습니다. 관찰 ${data.observations.length}개, 질문 ${data.questions.length}개`);
  } catch (e) {
    setStatus(describeError(e), true);
  } finally {
    btn.disabled = false;
  }
}

function describeError(e) {
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
    return '인증에 실패했습니다. AI 설정의 토큰이 맞는지 확인해 주세요.';
  }
  if (e instanceof Anthropic.RateLimitError) {
    return '사용량 한도에 걸렸습니다. 잠시 뒤 다시 시도해 주세요.';
  }
  if (e instanceof Anthropic.NotFoundError) {
    return 'API 주소나 모델 이름을 찾을 수 없습니다. AI 설정을 확인해 주세요.';
  }
  if (e instanceof Anthropic.BadRequestError) {
    return `요청이 거절됐습니다: ${e.message}`;
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return 'AI 서버에 연결하지 못했습니다. 사내망 연결과 API 주소를 확인해 주세요.';
  }
  if (e instanceof Anthropic.APIError) {
    return `AI 서버 오류(${e.status ?? '알 수 없음'})입니다. 잠시 뒤 다시 시도해 주세요.`;
  }
  if (e instanceof SyntaxError) {
    return 'AI 결과를 읽지 못했습니다. 다시 생성해 주세요.';
  }
  return `평가표를 만들지 못했습니다: ${e.message}`;
}

function answerRadios(name, labels, current) {
  return `<div class="pts" role="radiogroup">${labels.map((t, i) => {
    const v = String(i + 1);
    return `<label class="pt"><input class="vh" type="radio" name="${name}" value="${v}"${current === v ? ' checked' : ''}><span>${t}</span></label>`;
  }).join('')}</div>`;
}

function render() {
  const area = $('aiResult');
  if (!sheet) { area.innerHTML = ''; return; }
  const { data, answers } = sheet;
  const obs = data.observations.map((o, i) => {
    const a = answers.observations[i] || {};
    return `<div class="ai-item">
      <div class="ai-item-head"><span class="ai-tag">${esc(o.heuristic)}</span><span class="ai-where">${esc(o.where)}</span></div>
      <p class="ai-text">${esc(o.text)}</p>
      <div class="ai-answer">
        ${answerRadios(`aiObs-${i}`, ['맞음', '일부 맞음', '틀림'], a.verdict)}
        <input type="text" class="input input-sm" data-kind="observations" data-idx="${i}" value="${esc(a.note || '')}" placeholder="근거나 보충 의견">
      </div>
    </div>`;
  }).join('');
  const qs = data.questions.map((q, i) => {
    const a = answers.questions[i] || {};
    return `<div class="ai-item">
      <div class="ai-item-head"><span class="ai-tag">${esc(q.heuristic)}</span></div>
      <p class="ai-text"><strong>Q${i + 1}.</strong> ${esc(q.question)}</p>
      <p class="ai-why">확인하려는 것: ${esc(q.intent)}</p>
      <div class="ai-answer">
        ${answerRadios(`aiQ-${i}`, ['예', '아니요', '모르겠음'], a.verdict)}
        <input type="text" class="input input-sm" data-kind="questions" data-idx="${i}" value="${esc(a.note || '')}" placeholder="그렇게 판단한 근거">
      </div>
    </div>`;
  }).join('');
  const gaps = data.needs_check.length
    ? `<ul class="ai-gaps">${data.needs_check.map((g) => `<li>${esc(g)}</li>`).join('')}</ul>`
    : '<p class="help" style="margin:0;">없음</p>';

  area.innerHTML = `
    <div class="ai-block">
      <h3 class="ai-block-title">화면 요약</h3>
      <div class="ai-summary">
        <p><b>목적</b>${esc(data.summary.purpose)}</p>
        <p><b>주요 요소</b>${esc(data.summary.elements)}</p>
        <p><b>예상 사용자</b>${esc(data.summary.users)}</p>
      </div>
    </div>
    <div class="ai-block">
      <h3 class="ai-block-title">AI가 관찰한 점 · 맞는지 판단해 주세요</h3>
      ${obs || '<p class="help">관찰한 점이 없습니다.</p>'}
    </div>
    <div class="ai-block">
      <h3 class="ai-block-title">평가 질문</h3>
      ${qs || '<p class="help">질문이 없습니다.</p>'}
    </div>
    <div class="ai-block">
      <h3 class="ai-block-title">AI가 판단하지 못한 것 · 평가자 확인 필요</h3>
      ${gaps}
    </div>
    <div class="ai-foot">
      <span>${esc(sheet.target || '화면명 없음')} · 캡처 ${sheet.imageCount}장 · ${esc(sheet.model)} · ${UXDate.format(sheet.generatedAt)} 생성</span>
      <span class="ai-progress" id="aiProgress"></span>
    </div>`;
  updateProgress();
}

function updateProgress() {
  const el = $('aiProgress');
  if (!el || !sheet) return;
  const answered = (kind) => Object.values(sheet.answers[kind]).filter((a) => a && a.verdict).length;
  el.textContent = `관찰 ${answered('observations')}/${sheet.data.observations.length} · 질문 ${answered('questions')}/${sheet.data.questions.length} 답변`;
}

function persist() {
  if (!saveJSON(RESULT_KEY, sheet)) setStatus('저장 공간이 부족해 평가표를 저장하지 못했습니다.', true);
}

function onAnswer(e) {
  if (!sheet) return;
  const t = e.target;
  let kind; let idx; let field; let value;
  if (t.type === 'radio' && /^ai(Obs|Q)-\d+$/.test(t.name)) {
    kind = t.name.startsWith('aiObs') ? 'observations' : 'questions';
    idx = t.name.split('-')[1];
    field = 'verdict';
    value = t.value;
  } else if (t.dataset && t.dataset.kind) {
    kind = t.dataset.kind;
    idx = t.dataset.idx;
    field = 'note';
    value = t.value;
  } else {
    return;
  }
  sheet.answers[kind][idx] = { ...(sheet.answers[kind][idx] || {}), [field]: value };
  persist();
  updateProgress();
}

function openSettings(open) {
  $('aiSettings').hidden = !open;
  $('aiSettingsToggle').setAttribute('aria-expanded', String(open));
  if (open) {
    const s = getSettings();
    $('aiBaseUrl').value = s.baseURL;
    $('aiModel').value = s.model;
    $('aiToken').value = s.token;
    (s.token ? $('aiModel') : $('aiToken')).focus();
  }
}

function saveSettings() {
  const ok = saveJSON(SETTINGS_KEY, {
    baseURL: $('aiBaseUrl').value.trim() || DEFAULTS.baseURL,
    model: $('aiModel').value.trim() || DEFAULTS.model,
    token: $('aiToken').value.trim(),
  });
  setStatus(ok ? 'AI 설정을 저장했습니다.' : '브라우저 저장 공간에 설정을 저장하지 못했습니다.', !ok);
  if (ok) openSettings(false);
}

function init() {
  $('aiGenerateBtn').addEventListener('click', generate);
  $('aiSettingsToggle').addEventListener('click', () => openSettings($('aiSettings').hidden));
  $('aiSettingsSave').addEventListener('click', saveSettings);
  $('aiResult').addEventListener('change', onAnswer);
  $('aiResult').addEventListener('input', onAnswer);

  sheet = loadJSON(RESULT_KEY);
  render();
  if (sheet) setStatus('이전에 만든 평가표를 이어서 작성 중입니다. 다시 누르면 새로 만듭니다.');

  // '새 평가 시작'을 누르면 AI 평가표도 함께 비운다
  const original = window.confirmNewEvaluation;
  if (typeof original === 'function') {
    window.confirmNewEvaluation = function (...args) {
      const result = original.apply(this, args);
      sheet = null;
      saveJSON(RESULT_KEY, null);
      render();
      setStatus('평가 정보에 화면 캡처를 넣은 뒤 눌러 주세요.');
      return result;
    };
  }
}

init();
