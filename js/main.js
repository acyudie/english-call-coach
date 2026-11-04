// Screens: home, call, feedback, history, settings.
import { DAYS, FREE_SCENARIOS, getScenario } from './curriculum.js?v=202611042320';
import { buildSystemPrompt, buildCustomScenario, weakPointsFrom } from './prompt.js?v=202611042320';
import { nextDay, isDayDone, streakDays, localYmd, MIN_DONE_SEC } from './progress.js?v=202611042320';
import { loadState, saveState, encodeSetup, decodeSetup } from './store.js?v=202611042320';
import { AudioEngine } from './audio.js?v=202611042320';
import { LiveSession, LIVE_MODELS, explainLiveError } from './live.js?v=202611042320';
import { TranscriptBuilder } from './transcript.js?v=202611042320';
import { makeFeedback, checkKey } from './feedback.js?v=202611042320';
import { int16ToBase64 } from './pcm.js?v=202611042320';

const app = document.getElementById('app');
const QS = new URLSearchParams(location.search);
const TEST = QS.has('test');
const FAKE_MIC = TEST && QS.has('nomic');
const MUTE = TEST && QS.has('mute');
let state = loadState();
let selectedDay = null;
let call = null;

const ICON = {
  hint: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.4 1 1.1 1 1.9V16h5v-.2c0-.8.4-1.5 1-1.9A6 6 0 0 0 12 3z"/></svg>',
  slow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 13V9M10 2h4"/></svg>',
  cc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10.5 10.2a2 2 0 1 0 0 3.6M17 10.2a2 2 0 1 0 0 3.6"/></svg>',
  mic: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v4"/></svg>',
  end: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 9c-2.6 0-5.1.5-7.4 1.4-.7.3-1.1 1-1.1 1.7v2.4c0 .8.7 1.4 1.5 1.3l2.9-.4c.7-.1 1.2-.7 1.2-1.4v-1.6c1.9-.5 3.9-.5 5.8 0V14c0 .7.5 1.3 1.2 1.4l2.9.4c.8.1 1.5-.5 1.5-1.3v-2.4c0-.7-.4-1.4-1.1-1.7C17.1 9.5 14.6 9 12 9z"/></svg>',
};

/* ---------- helpers ---------- */
const $ = sel => app.querySelector(sel);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const persist = () => saveState(state);
const firstName = n => String(n || '').split(' ')[0];
const modeLabel = m => (m === 'phone' ? '전화' : '화상 미팅');
const fmtTime = sec => `${String(Math.floor((sec || 0) / 60)).padStart(2, '0')}:${String((sec || 0) % 60).padStart(2, '0')}`;
const scenarioOf = s => s.custom || getScenario(s.scenarioId);

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function speak(text) {
  if (!('speechSynthesis' in window)) return toast('이 브라우저는 발음 듣기를 지원하지 않아요.');
  const u = new SpeechSynthesisUtterance(text.replace(/_+/g, 'blank'));
  u.lang = 'en-US';
  u.rate = 0.92;
  const v = speechSynthesis.getVoices().find(x => /en-US/i.test(x.lang) && /(Samantha|Ava|Allison|Google US|Aria|Jenny)/i.test(x.name));
  if (v) u.voice = v;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

function ledSign(text, routeLabel) {
  return `<div class="sign" role="img" aria-label="${h(text)}">${routeLabel ? `<span class="sign-route">${h(routeLabel)}</span>` : ''}<span class="led">${h(text)}</span></div>`;
}

function fitLed() {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  app.querySelectorAll('.sign').forEach(sign => {
    const led = sign.querySelector('.led');
    led.classList.remove('scroll');
    if (!reduce && led.scrollWidth > sign.clientWidth - 28) led.classList.add('scroll');
  });
}

function bindCommon() {
  app.querySelectorAll('[data-go]').forEach(b => {
    b.onclick = () => ({ home: renderHome, history: renderHistory, settings: renderSettings })[b.dataset.go]();
  });
  app.querySelectorAll('[data-say]').forEach(b => {
    b.onclick = () => speak(b.dataset.say);
  });
  window.scrollTo(0, 0);
}

/* ---------- home ---------- */
function missionCard(sc) {
  const p = sc.persona;
  return `<article class="mission" aria-labelledby="mt">
    <div class="mission-head">
      <span class="tag ${sc.mode === 'phone' ? 'phone' : ''}">${modeLabel(sc.mode)}</span>
      <span class="tag plain">${sc.day ? `${sc.day}일 차` : '자유 연습'}</span>
      <span class="tag plain">약 ${sc.minutes}분</span>
      ${sc.day && isDayDone(state.sessions, sc.day) ? '<span class="tag plain">완료함</span>' : ''}
    </div>
    <h2 id="mt">${h(sc.titleKo)}</h2>
    <p>${h(sc.situationKo)}</p>
    <dl class="facts">
      <div class="fact"><dt>상대</dt><dd>${h(p.name)} (${h(p.role)}, ${h(p.company)})</dd></div>
      <div class="fact"><dt>오늘 목표</dt><dd>${h(sc.goalKo)}</dd></div>
      <div class="fact"><dt>꼭 써 볼 표현, 누르면 발음을 들려줘요</dt><dd><div class="phrases">${sc.keyPhrases
        .map(k => `<button type="button" class="phrase" data-say="${h(k)}"><span>${h(k)}</span><span class="play">듣기</span></button>`)
        .join('')}</div></dd></div>
    </dl>
    <button type="button" class="btn go" data-start="${h(sc.id)}">${sc.mode === 'phone' ? '전화 걸기' : '화상 미팅 시작'}</button>
  </article>`;
}

function renderHome() {
  document.body.classList.remove('in-call');
  const ss = state.sessions;
  const nd = nextDay(ss);
  const dayNo = selectedDay || nd || 14;
  const sc = DAYS[dayNo - 1];
  const doneCount = DAYS.filter(d => isDayDone(ss, d.day)).length;
  const streak = streakDays(ss, localYmd());
  const allDone = nd === 0 && !selectedDay;
  app.innerHTML = `
    ${ledSign(allDone ? 'COURSE COMPLETE' : sc.signEn, '영어 통화 연습 14일 코스')}
    <section class="route" aria-label="14일 코스 진행 상황">
      <ol class="stops">${DAYS.map(d => {
        const done = isDayDone(ss, d.day);
        const cls = ['stop', done ? 'done' : '', d.day === nd ? 'current' : '', d.day === dayNo && selectedDay ? 'selected' : ''].join(' ').trim();
        return `<li class="${cls}"><button type="button" data-day="${d.day}" aria-label="${d.day}일 차 ${h(d.titleKo)}${done ? ', 완료' : ''}${d.day === nd ? ', 오늘 할 차례' : ''}">${done ? '✓' : d.day}</button></li>`;
      }).join('')}</ol>
      <p class="route-meta"><span>${streak ? `연속 ${streak}일째 연습 중` : '오늘 첫 통화를 걸어 보세요'}</span><span>완료 ${doneCount}/14</span></p>
    </section>
    ${!state.settings.apiKey ? `<div class="notice"><b>시작하려면 연결 키가 필요해요.</b><p class="small" style="margin-top:4px">설정에서 Gemini API 키를 넣거나, 맥 화면에 띄운 QR을 휴대폰 카메라로 찍어 연결하세요.</p><div class="btn-row"><button type="button" class="btn line" data-go="settings">설정 열기</button></div></div>` : ''}
    ${missionCard(sc)}
    <section class="section">
      <h2>자유 연습</h2>
      <div class="rows">${FREE_SCENARIOS.map(f => `<button type="button" class="row" data-start="${f.id}"><span class="row-main"><span class="row-title">${h(f.titleKo)}</span><span class="row-sub">${h(f.goalKo)}</span></span><span class="row-side">${modeLabel(f.mode)}</span></button>`).join('')}</div>
      <details class="custom">
        <summary>실제 상황 직접 만들기</summary>
        <p class="small muted" style="margin-top:8px">곧 있을 미팅이나 통화를 한국어로 적어 주세요. AI가 그 상대 역할을 맡아요.</p>
        <label class="field"><span>상황</span><textarea id="customDesc" placeholder="예: 금요일 저녁 Upwork 고객과 30분 화상 미팅. 일의 범위와 단가를 물어볼 것 같음."></textarea></label>
        <div class="choice" role="radiogroup" aria-label="연습 방식">
          <label><input type="radio" name="cmode" value="video" checked><span>화상 미팅</span></label>
          <label><input type="radio" name="cmode" value="phone"><span>전화</span></label>
        </div>
        <button type="button" class="btn go" id="customStart">이 상황으로 연습하기</button>
      </details>
    </section>
    <nav class="bottom-nav"><button type="button" class="btn line" data-go="history">연습 기록</button><button type="button" class="btn line" data-go="settings">설정</button></nav>`;
  bindCommon();
  app.querySelectorAll('[data-day]').forEach(b => {
    b.onclick = () => {
      selectedDay = +b.dataset.day === nd ? null : +b.dataset.day;
      renderHome();
    };
  });
  app.querySelectorAll('[data-start]').forEach(b => {
    b.onclick = () => startCall(getScenario(b.dataset.start));
  });
  $('#customStart').onclick = () => {
    const desc = $('#customDesc').value.trim();
    if (desc.length < 5) return toast('상황을 한 줄 이상 적어 주세요.');
    const mode = app.querySelector('input[name=cmode]:checked').value;
    startCall(buildCustomScenario(desc, mode));
  };
  fitLed();
}

/* ---------- call ---------- */
function micErrorText(e) {
  const n = e && e.name;
  if (n === 'NotAllowedError' || n === 'SecurityError') return '마이크 권한이 꺼져 있어요. 주소창 옆 메뉴(아이폰은 주소창의 aA 버튼)에서 마이크를 허용한 뒤 다시 걸어 주세요.';
  if (n === 'NotFoundError') return '마이크를 찾지 못했어요. 이어폰 마이크나 기기 마이크를 확인해 주세요.';
  return `마이크를 켜지 못했어요 (${(e && e.message) || n || '원인 미상'}).`;
}

async function startCall(sc) {
  if (!sc || call) return;
  if (!state.settings.apiKey) {
    toast('먼저 설정에서 연결 키를 넣어 주세요.');
    return renderSettings();
  }
  const audio = new AudioEngine();
  audio.silent = MUTE;
  call = { sc, audio, live: null, tb: new TranscriptBuilder(), startedAt: 0, hints: 0, captions: sc.captionsDefault !== false, ended: false, toldTime: false, camStream: null, wakeLock: null, timer: 0, raf: 0, status: 'connecting', shownStatus: '', model: '' };
  renderCall();
  try {
    await audio.init(); // created inside the tap so iPhone allows sound
    await audio.startMic(FAKE_MIC);
  } catch (e) {
    return failCall(micErrorText(e));
  }
  if (sc.mode === 'video' && state.settings.camera && !FAKE_MIC) startCamera();
  try {
    call.wakeLock = (await navigator.wakeLock?.request?.('screen')) || null;
  } catch {
    call.wakeLock = null;
  }
  const prompt = buildSystemPrompt(sc, state.settings.profile, { slow: state.settings.slow, weakPoints: weakPointsFrom(state.sessions) });
  const silenceMs = state.settings.patience === 'long' ? 1600 : 1000;
  let lastErr = null;
  for (const model of LIVE_MODELS) {
    if (!call || call.ended) return;
    const live = new LiveSession({ apiKey: state.settings.apiKey, model, systemPrompt: prompt, voice: sc.persona.voice, silenceMs });
    wireLive(live);
    try {
      await live.connect();
      call.live = live;
      call.model = model;
      break;
    } catch (e) {
      lastErr = e;
      if (/key|PERMISSION|quota|RESOURCE/i.test(e.message)) break;
    }
  }
  if (!call || call.ended) return;
  if (!call.live) return failCall(explainLiveError(lastErr));
  call.startedAt = Date.now();
  audio.onChunk = (b64, injected) => {
    if (!call || !call.live || call.feeding) return;
    if (!injected && !state.settings.earphones && audio.isPlaying()) return; // speaker mode: no echo into the mic
    call.live.sendAudio(b64);
  };
  call.live.sendNote('[The call has connected. Start the role-play now with your opening line.]', true);
  call.timer = setInterval(tick, 1000);
  loop();
}

function wireLive(live) {
  const mine = () => call && (!call.live || call.live === live);
  live.addEventListener('audio', e => { if (mine()) call.audio.play(e.detail); });
  live.addEventListener('outputText', e => { if (mine()) { call.tb.addAi(e.detail); drawCaptions(); } });
  live.addEventListener('inputText', e => { if (mine()) { call.tb.addMe(e.detail); drawCaptions(); } });
  live.addEventListener('turnComplete', () => { if (mine()) call.tb.closeAi(); });
  live.addEventListener('interrupted', () => { if (mine()) { call.audio.stopPlayback(); call.tb.closeAi(); } });
  live.addEventListener('status', e => { if (mine()) call.status = e.detail; });
  live.addEventListener('error', e => {
    if (call && call.live === live && !call.ended) endCall({ error: explainLiveError(e.detail) });
  });
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
    if (!call || call.ended) return stream.getTracks().forEach(t => t.stop());
    call.camStream = stream;
    const v = document.getElementById('selfvid');
    const box = document.getElementById('selfview');
    if (v && box) {
      v.srcObject = stream;
      box.hidden = false;
    }
  } catch {
    /* camera is optional */
  }
}

function renderCall() {
  document.body.classList.add('in-call');
  const { sc } = call;
  const p = sc.persona;
  const stage = sc.mode === 'video'
    ? `<div class="video-tile" style="background:${h(p.tint)}"><div class="avatar" id="avatar">${h(p.initials)}</div><span class="nameplate">${h(p.name)}</span><div class="selfview" id="selfview" hidden><video id="selfvid" playsinline muted autoplay></video><div class="mic-meter" id="micmeter"></div></div></div>`
    : `<div class="avatar" id="avatar" style="background:${h(p.tint)}">${h(p.initials)}</div>`;
  app.innerHTML = `<section class="call" aria-label="통화 화면">
    <div class="call-top"><span>${sc.mode === 'phone' ? '음성 통화' : '화상 미팅'}${sc.day ? `, ${sc.day}일 차` : ''}</span><span class="call-timer" id="timer">00:00</span></div>
    <div class="call-who"><h1>${h(p.name)}</h1><p>${h(p.role)}, ${h(p.company)}</p><span class="status" id="status">연결하는 중</span></div>
    <div class="stage">${stage}</div>
    <div class="captions" id="captions" aria-live="polite"><p class="cap"><b>안내</b>연결되면 상대가 먼저 말을 걸어요.${state.settings.earphones ? '' : ' 상대가 말하는 동안에는 기다렸다가 말해 주세요.'}</p></div>
    <details class="goal-strip"><summary>오늘 목표와 표현 보기</summary><p style="margin-top:6px">${h(sc.goalKo)}</p><ul>${sc.keyPhrases.map(k => `<li>${h(k)}</li>`).join('')}</ul></details>
    <div class="controls">
      <button type="button" class="ctl" id="cHint"><span class="dot">${ICON.hint}</span>힌트</button>
      <button type="button" class="ctl" id="cSlow"><span class="dot">${ICON.slow}</span>천천히</button>
      <button type="button" class="ctl" id="cCap" aria-pressed="${call.captions}"><span class="dot">${ICON.cc}</span>상대 자막</button>
      <button type="button" class="ctl" id="cMute" aria-pressed="false"><span class="dot">${ICON.mic}</span>음소거</button>
    </div>
    <div class="end-wrap"><button type="button" class="end" id="cEnd" aria-label="통화 끝내기">${ICON.end}</button></div>
    <p class="end-label">끝내면 바로 피드백을 만들어요</p>
    ${TEST ? '<div class="testbar"><button type="button" data-fix="1">시험 음성 1</button><button type="button" data-fix="2">시험 음성 2</button><button type="button" data-fix="3">시험 음성 3</button></div>' : ''}
  </section>`;
  $('#cHint').onclick = () => {
    if (!call?.live) return;
    call.live.sendNote('[Coach note: He seems stuck. Step out of the role for one sentence and give a hint that starts with "You could say:" followed by one short natural sentence he can use right now. Then wait for him.]', true);
    call.hints++;
    toast('힌트를 달라고 했어요');
  };
  $('#cSlow').onclick = () => {
    if (!call?.live) return;
    call.live.sendNote('[Coach note: From now on, speak more slowly and use simpler words.]', false);
    toast('천천히 말해 달라고 했어요');
  };
  $('#cCap').onclick = e => {
    call.captions = !call.captions;
    e.currentTarget.setAttribute('aria-pressed', String(call.captions));
    drawCaptions();
  };
  $('#cMute').onclick = e => {
    call.audio.muted = !call.audio.muted;
    e.currentTarget.setAttribute('aria-pressed', String(call.audio.muted));
    toast(call.audio.muted ? '내 마이크를 껐어요' : '내 마이크를 켰어요');
  };
  $('#cEnd').onclick = () => endCall({});
  app.querySelectorAll('[data-fix]').forEach(b => {
    b.onclick = () => sendFixture(+b.dataset.fix);
  });
}

async function sendFixture(n) {
  if (!call?.live) return toast('연결된 뒤에 눌러 주세요');
  const buf = await (await fetch(`tests/fixtures/line${n}.pcm`)).arrayBuffer();
  const i16 = new Int16Array(buf);
  const chunks = [];
  for (let i = 0; i < i16.length; i += 1600) chunks.push(i16.slice(i, i + 1600));
  for (let k = 0; k < 15; k++) chunks.push(new Int16Array(1600));
  call.feeding = true;
  let idx = 0;
  const iv = setInterval(() => {
    if (!call?.live || idx >= chunks.length) {
      clearInterval(iv);
      if (call) call.feeding = false;
      return;
    }
    call.live.sendAudio(int16ToBase64(chunks[idx++]));
  }, 100);
}

function drawCaptions() {
  const box = document.getElementById('captions');
  if (!box || !call) return;
  const who = firstName(call.sc.persona.name);
  const lines = call.tb.toArray().slice(-6);
  box.innerHTML = lines
    .map(l => {
      if (l.who === 'me') return `<p class="cap me"><b>나</b>${h(l.text)}</p>`;
      return call.captions ? `<p class="cap"><b>${h(who)}</b>${h(l.text)}</p>` : `<p class="cap hidden-ai"><b>${h(who)}</b>자막을 껐어요. 귀로 들어 보세요.</p>`;
    })
    .join('');
  box.scrollTop = box.scrollHeight;
}

function setStatus(key) {
  if (!call || call.shownStatus === key) return;
  call.shownStatus = key;
  const el = document.getElementById('status');
  if (!el) return;
  const map = {
    connecting: ['연결하는 중', ''],
    reconnecting: ['연결을 이어 가는 중', 'warn'],
    speaking: [`${firstName(call.sc.persona.name)}이(가) 말하는 중`, 'speaking'],
    mine: ['내 차례예요. 말해 보세요', 'mine'],
    muted: ['마이크 꺼짐', 'warn'],
  };
  const [text, cls] = map[key] || map.connecting;
  el.textContent = text;
  el.className = `status ${cls}`;
}

function loop() {
  if (!call || call.ended) return;
  const a = call.audio;
  const lvl = Math.min(1, a.outputLevel() * 5);
  const av = document.getElementById('avatar');
  if (av) av.style.setProperty('--lvl', lvl.toFixed(3));
  const meter = document.getElementById('micmeter');
  if (meter) meter.style.transform = `scaleX(${Math.min(1, a.micLevel * 10).toFixed(3)})`;
  if (call.status === 'reconnecting' || call.status === 'connecting') setStatus(call.status);
  else if (a.isPlaying() || call.tb.aiOpen) setStatus('speaking');
  else if (a.muted) setStatus('muted');
  else setStatus('mine');
  call.raf = requestAnimationFrame(loop);
}

function tick() {
  if (!call || !call.startedAt) return;
  const sec = Math.round((Date.now() - call.startedAt) / 1000);
  const t = document.getElementById('timer');
  if (t) t.textContent = fmtTime(sec);
  if (!call.toldTime && sec >= call.sc.minutes * 60) {
    call.toldTime = true;
    toast('목표 시간을 채웠어요. 원하면 인사하고 마무리하세요.', 4000);
  }
}

async function cleanupCall(c) {
  clearInterval(c.timer);
  cancelAnimationFrame(c.raf);
  try { c.live?.close(); } catch { /* ignore */ }
  try { await c.audio.close(); } catch { /* ignore */ }
  c.camStream?.getTracks().forEach(t => t.stop());
  try { await c.wakeLock?.release?.(); } catch { /* ignore */ }
}

async function failCall(msg) {
  const c = call;
  if (!c) return;
  c.ended = true;
  call = null;
  await cleanupCall(c);
  renderHome();
  app.insertAdjacentHTML('afterbegin', `<div class="notice error" role="alert">${h(msg)}</div>`);
}

async function endCall({ error } = {}) {
  const c = call;
  if (!c || c.ended) return;
  c.ended = true;
  call = null;
  await cleanupCall(c);
  if (!c.startedAt) return failCall(error || '연결되기 전에 끝났어요.');
  const sc = c.sc;
  const session = {
    id: `s${Date.now()}`,
    scenarioId: sc.id,
    day: sc.day || 0,
    titleKo: sc.titleKo,
    mode: sc.mode,
    date: localYmd(),
    startedAt: new Date(c.startedAt).toISOString(),
    durationSec: Math.round((Date.now() - c.startedAt) / 1000),
    hints: c.hints,
    myWords: c.tb.wordCount('me'),
    model: c.model,
    transcript: c.tb.toArray(),
    feedback: null,
  };
  if (sc.id.startsWith('custom-')) session.custom = sc;
  state.sessions.push(session);
  persist();
  renderFeedback(session, { generate: true, error });
}

/* ---------- feedback ---------- */
const SCORE_LABELS = [['fluency', '유창성'], ['clarity', '전달력'], ['listening', '알아듣기'], ['task', '목표 달성']];

function feedbackHtml(fb) {
  return `<div class="scores">${SCORE_LABELS.map(([k, label]) => `<div class="score"><b>${fb.scores[k]}</b><span>${label}</span></div>`).join('')}</div>
    <p class="small muted" style="margin-top:6px">10점 만점, 평균 ${fb.average}점</p>
    ${fb.summary_ko ? `<p style="margin-top:12px">${h(fb.summary_ko)}</p>` : ''}
    ${fb.corrections.length ? `<section class="section"><h2>이렇게 바꿔 말해 보세요</h2>${fb.corrections.map(c => `<div class="fix">${c.you_said ? `<p class="said">${h(c.you_said)}</p>` : ''}<p class="better">${h(c.better)} <button type="button" class="btn ghost" data-say="${h(c.better)}">듣기</button></p>${c.why_ko ? `<p class="why">${h(c.why_ko)}</p>` : ''}</div>`).join('')}</section>` : ''}
    ${fb.phrases.length ? `<section class="section"><h2>외워 둘 표현</h2><div class="phrases">${fb.phrases.map(p => `<button type="button" class="phrase" data-say="${h(p.en)}"><span>${h(p.en)}${p.ko ? `<br><span class="small muted">${h(p.ko)}</span>` : ''}</span><span class="play">듣기</span></button>`).join('')}</div></section>` : ''}
    ${fb.next_focus_ko ? `<section class="section"><h2>다음에 집중할 것</h2><p>${h(fb.next_focus_ko)}</p></section>` : ''}`;
}

function renderFeedback(s, opts = {}) {
  document.body.classList.remove('in-call');
  const sc = scenarioOf(s);
  const name = sc ? firstName(sc.persona.name) : 'AI';
  const enough = s.transcript.filter(l => l.who === 'me').length >= 2 && (s.myWords || 0) >= 8;
  const short = s.day && s.durationSec < MIN_DONE_SEC;
  app.innerHTML = `
    <div class="topbar"><button type="button" class="btn ghost" data-go="home">홈으로</button><span class="small muted">${h(s.date)}</span></div>
    ${ledSign(s.day ? `DAY ${String(s.day).padStart(2, '0')} ${short ? 'TRY AGAIN' : 'DONE'}` : 'CALL ENDED', s.titleKo)}
    ${opts.error ? `<div class="notice error" role="alert">${h(opts.error)}</div>` : ''}
    <p class="muted" style="margin-top:12px">통화 ${fmtTime(s.durationSec)}, 내가 말한 단어 ${s.myWords || 0}개, 힌트 ${s.hints || 0}번${short ? `. ${Math.round(MIN_DONE_SEC / 60)}분 넘게 해야 ${s.day}일 차를 완료로 쳐요.` : ''}</p>
    <div id="fb">${s.feedback ? feedbackHtml(s.feedback) : enough ? '<p style="margin-top:16px"><span class="spinner" aria-hidden="true"></span>피드백을 만드는 중이에요. 보통 10초, 붐비면 30초쯤 걸려요.</p>' : '<div class="notice">대화가 짧아서 피드백을 만들지 않았어요. 다음에는 2분 넘게 이야기해 보세요.</div>'}</div>
    <details class="section"><summary><b>대화 전체 보기</b></summary><div class="transcript">${s.transcript.map(l => `<p class="${l.who}"><b>${l.who === 'me' ? '나' : h(name)}</b> ${h(l.text)}</p>`).join('') || '<p class="muted">기록된 대화가 없어요.</p>'}</div></details>
    <div class="btn-row"><button type="button" class="btn go" id="again">같은 상황 다시 하기</button></div>
    <div class="btn-row"><button type="button" class="btn line" data-go="home">홈으로</button><button type="button" class="btn line" id="copyOne">이 기록 복사</button></div>`;
  bindCommon();
  $('#again').onclick = () => startCall(s.custom ? { ...s.custom, id: `custom-${Date.now()}` } : getScenario(s.scenarioId));
  $('#copyOne').onclick = () => copyText(summaryText([s]));
  fitLed();
  if (!s.feedback && enough && opts.generate !== false && sc) generateFeedback(s, sc);
}

async function generateFeedback(s, sc) {
  try {
    const fb = await makeFeedback(state.settings.apiKey, sc, s.transcript);
    s.feedback = fb;
    persist();
    const box = document.getElementById('fb');
    if (box) {
      box.innerHTML = feedbackHtml(fb);
      bindCommon();
    }
  } catch (e) {
    const box = document.getElementById('fb');
    if (!box) return;
    box.innerHTML = `<div class="notice error">피드백을 만들지 못했어요 (${h(e.message)}).<div class="btn-row"><button type="button" class="btn line" id="retryFb">다시 만들기</button></div></div>`;
    document.getElementById('retryFb').onclick = () => {
      box.innerHTML = '<p style="margin-top:16px"><span class="spinner" aria-hidden="true"></span>다시 만드는 중이에요.</p>';
      generateFeedback(s, sc);
    };
  }
}

/* ---------- history ---------- */
function summaryText(list) {
  const lines = ['[영어 통화 연습 기록]'];
  for (const s of list) {
    const fb = s.feedback;
    lines.push(`${s.date} ${s.day ? `${s.day}일 차 ` : ''}${s.titleKo} | ${fmtTime(s.durationSec)} | 단어 ${s.myWords || 0}개 | 힌트 ${s.hints || 0}번${fb ? ` | 평균 ${fb.average} (유창 ${fb.scores.fluency}, 전달 ${fb.scores.clarity}, 듣기 ${fb.scores.listening}, 목표 ${fb.scores.task})` : ''}`);
    if (fb) {
      for (const c of fb.corrections) lines.push(`  고칠 말: "${c.you_said}" -> "${c.better}"`);
      if (fb.next_focus_ko) lines.push(`  다음 집중: ${fb.next_focus_ko}`);
    }
  }
  return lines.join('\n');
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('복사했어요. Aside에게 붙여 넣으면 다음 연습을 맞춰 줘요.');
  } catch {
    toast('복사하지 못했어요. 다시 눌러 주세요.');
  }
}

function renderHistory() {
  document.body.classList.remove('in-call');
  const list = [...state.sessions].reverse();
  app.innerHTML = `
    <div class="topbar"><h1>연습 기록</h1><button type="button" class="btn ghost" data-go="home">홈으로</button></div>
    ${list.length ? `<div class="rows">${list.map(s => `<button type="button" class="row" data-sid="${h(s.id)}"><span class="row-main"><span class="row-title">${s.day ? `${s.day}일 차 ` : ''}${h(s.titleKo)}</span><span class="row-sub">${h(s.date)}, ${fmtTime(s.durationSec)}</span></span><span class="row-side">${s.feedback ? `평균 <span class="score-pill">${s.feedback.average}</span>` : '피드백 없음'}</span></button>`).join('')}</div>
      <div class="btn-row"><button type="button" class="btn line" id="copyAll">최근 10개 기록 복사</button></div>` : '<div class="notice">아직 기록이 없어요. 홈에서 오늘의 통화를 걸어 보세요.</div>'}`;
  bindCommon();
  app.querySelectorAll('[data-sid]').forEach(b => {
    b.onclick = () => {
      const s = state.sessions.find(x => x.id === b.dataset.sid);
      if (s) renderFeedback(s, { generate: true });
    };
  });
  const ca = document.getElementById('copyAll');
  if (ca) ca.onclick = () => copyText(summaryText(state.sessions.slice(-10)));
}

/* ---------- settings ---------- */
function setupUrl() {
  return `${location.origin}${location.pathname}#setup=${encodeSetup(state.settings)}`;
}

function renderSettings() {
  document.body.classList.remove('in-call');
  const st = state.settings;
  const https = location.protocol === 'https:';
  app.innerHTML = `
    <div class="topbar"><h1>설정</h1><button type="button" class="btn ghost" data-go="home">홈으로</button></div>
    <section class="stack">
      <h2>연결 키</h2>
      <p class="small muted">구글 AI 스튜디오에서 만든 Gemini API 키예요. 이 기기에만 저장돼요.</p>
      <label class="field"><span>Gemini API 키</span><input type="password" id="apiKey" autocomplete="off" spellcheck="false" placeholder="AQ. 또는 AIza로 시작" value="${h(st.apiKey)}"></label>
      <div class="btn-row"><button type="button" class="btn line" id="saveKey">저장</button><button type="button" class="btn line" id="testKey">연결 확인</button></div>
      <p class="small" id="keyResult" role="status"></p>
    </section>
    <section class="section stack">
      <h2>내 소개</h2>
      <p class="small muted">AI가 차장님을 이 정보로 알고 대화해요. 한국어로 써도 돼요.</p>
      <label class="field"><span>영어 이름</span><input type="text" id="pName" value="${h(st.profile.name)}" placeholder="예: Junghee You"></label>
      <label class="field"><span>경력과 하는 일</span><textarea id="pBio" placeholder="예: 서울의 운송 회사에서 재무와 운영 일을 오래 했고, 프리랜서로 한국어 번역 검수도 함">${h(st.profile.bio)}</textarea></label>
      <div class="btn-row"><button type="button" class="btn line" id="saveProfile">내 소개 저장</button></div>
    </section>
    <section class="section">
      <h2>통화 방식</h2>
      <label class="switch"><span><b>이어폰을 끼고 연습해요</b><br><span class="small muted">켜면 상대가 말할 때 끼어들 수 있어요. 스피커로 할 때는 꺼 두세요. 내 목소리와 상대 목소리가 섞이지 않아요.</span></span><input type="checkbox" id="sEar" ${st.earphones ? 'checked' : ''}></label>
      <label class="switch"><span><b>생각할 시간을 더 주기</b><br><span class="small muted">말을 멈추고 1.6초를 기다린 뒤에 상대가 대답해요. 끄면 1초예요.</span></span><input type="checkbox" id="sPat" ${st.patience === 'long' ? 'checked' : ''}></label>
      <label class="switch"><span><b>처음부터 천천히 말하기</b><br><span class="small muted">상대가 쉬운 단어로 천천히 말해요.</span></span><input type="checkbox" id="sSlow" ${st.slow ? 'checked' : ''}></label>
      <label class="switch"><span><b>화상 미팅 때 내 얼굴 보기</b><br><span class="small muted">카메라 화면은 이 기기에서만 보여요. AI에게 보내지 않아요.</span></span><input type="checkbox" id="sCam" ${st.camera ? 'checked' : ''}></label>
    </section>
    <section class="section stack">
      <h2>휴대폰 연결</h2>
      ${st.apiKey ? (https
        ? `<p class="small muted">아이폰 기본 카메라로 아래 QR을 찍고 뜨는 주소를 열면, 키와 내 소개가 휴대폰에 저장돼요. 이 QR에는 키가 들어 있으니 다른 사람에게 보여 주지 마세요.</p><button type="button" class="btn line" id="showQr">QR 보기</button><div id="qr"></div>`
        : '<p class="small muted">인터넷 주소(https)로 연 화면에서만 QR을 만들 수 있어요.</p>')
        : '<p class="small muted">키를 먼저 저장하면 휴대폰 연결 QR을 만들 수 있어요.</p>'}
    </section>
    <section class="section stack">
      <h2>기록과 개인정보</h2>
      <p class="small muted">연습 기록은 이 기기의 브라우저에만 저장돼요. 무료 키로 연습하면 대화 내용이 구글 서비스 개선에 쓰일 수 있어요. 회사 기밀이나 고객 정보는 말하지 마세요.</p>
      <div class="btn-row"><button type="button" class="btn line" id="copyAll2">기록 복사</button><button type="button" class="btn danger" id="wipe">기록 모두 지우기</button></div>
    </section>`;
  bindCommon();
  $('#saveKey').onclick = () => {
    st.apiKey = $('#apiKey').value.trim();
    persist();
    toast(st.apiKey ? '키를 저장했어요' : '키를 지웠어요');
    renderSettings();
  };
  $('#testKey').onclick = async () => {
    const out = $('#keyResult');
    const key = $('#apiKey').value.trim();
    if (!key) return (out.textContent = '키를 먼저 넣어 주세요.');
    out.textContent = '확인하는 중...';
    try {
      const r = await checkKey(key);
      out.textContent = r.ok ? `연결돼요. 쓸 수 있는 음성 모델 ${r.live.length}개를 찾았어요.` : `키가 맞지 않아요 (오류 ${r.status}).`;
    } catch (e) {
      out.textContent = `확인하지 못했어요 (${e.message}).`;
    }
  };
  $('#saveProfile').onclick = () => {
    st.profile = { name: $('#pName').value.trim(), bio: $('#pBio').value.trim() };
    persist();
    toast('내 소개를 저장했어요');
  };
  $('#sEar').onchange = e => { st.earphones = e.target.checked; persist(); };
  $('#sPat').onchange = e => { st.patience = e.target.checked ? 'long' : 'normal'; persist(); };
  $('#sSlow').onchange = e => { st.slow = e.target.checked; persist(); };
  $('#sCam').onchange = e => { st.camera = e.target.checked; persist(); };
  const qrBtn = document.getElementById('showQr');
  if (qrBtn) {
    qrBtn.onclick = () => {
      const box = document.getElementById('qr');
      const qr = window.qrcode(0, 'L');
      qr.addData(setupUrl());
      qr.make();
      box.innerHTML = `<div class="qr-box"><img alt="휴대폰 연결용 QR 코드" src="${qr.createDataURL(5, 2)}"><p class="small muted" style="margin-top:8px">다 찍었으면 이 화면을 닫아 주세요.</p></div>`;
    };
  }
  $('#copyAll2').onclick = () => copyText(summaryText(state.sessions.slice(-10)));
  $('#wipe').onclick = () => {
    if (!confirm('연습 기록을 모두 지울까요? 되돌릴 수 없어요.')) return;
    state.sessions = [];
    persist();
    toast('기록을 지웠어요');
    renderSettings();
  };
}

/* ---------- boot ---------- */
if (location.hash.startsWith('#setup=')) {
  const s = decodeSetup(location.hash.slice(7));
  history.replaceState(null, '', location.pathname + location.search);
  if (s) {
    state.settings.apiKey = s.apiKey;
    state.settings.profile = s.profile;
    persist();
    setTimeout(() => toast('휴대폰 연결 완료. 키와 내 소개를 저장했어요.', 3500), 300);
  } else {
    setTimeout(() => toast('연결 링크가 올바르지 않아요. 맥에서 QR을 다시 띄워 주세요.', 3500), 300);
  }
}
window.addEventListener('pagehide', () => {
  if (call) cleanupCall(call);
});
window.addEventListener('resize', () => fitLed());
if (TEST) window.__ecc = { get call() { return call; }, get state() { return state; }, reload() { state = loadState(); } };
renderHome();
