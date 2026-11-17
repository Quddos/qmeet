// Student quiz page. Works standalone (new tab) or inside the meeting's side panel (?embed=1).
import { $, api, realtime, param, toast, escapeHtml } from './common.js';

const id = param('id') || '';
if (param('embed') === '1') document.body.classList.add('embed');
$('#openTab').href = `/q/${encodeURIComponent(id)}`;

const SECTIONS = ['stWait', 'stIdentify', 'stQuiz', 'stDone', 'stClosed'];
const showOnly = (sectionId) => SECTIONS.forEach((s) => $('#' + s).classList.toggle('hidden', s !== sectionId));

const S = {
  quiz: null,
  reg: '',
  name: '',
  started: false,
  submitted: false,
  submitting: false,
  deadline: 0,
  offset: 0,
  timer: null,
  channel: null,
};

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const draftKey = () => `qmeet:ans:${id}:${S.reg}`;
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(draftKey()) || '[]'); } catch { return []; }
}

function fatal(message) {
  $('#qTitle').textContent = 'Quiz unavailable';
  $('#qError').textContent = message;
  $('#qError').classList.remove('hidden');
  SECTIONS.forEach((s) => $('#' + s).classList.add('hidden'));
}

async function load() {
  if (!id) return fatal('This quiz link is missing its quiz id.');
  try {
    S.quiz = await api(`/api/quiz?id=${encodeURIComponent(id)}`);
  } catch (err) {
    return fatal(err.message);
  }
  const q = S.quiz;
  $('#qTitle').textContent = q.title;
  $('#qSub').textContent = `${q.durationMinutes} minutes · ${q.questions.length} questions`;
  $('#qStatus').textContent = q.status === 'open' ? 'Open' : q.status === 'closed' ? 'Closed' : 'Not open';
  $('#qStatus').className = `pill ${q.status}`;

  if (S.submitted) return;
  if (S.started) {
    if (q.status !== 'open') {
      clearInterval(S.timer);
      $('#closedMsg').textContent = 'The quiz was closed before you submitted. Please tell your host.';
      showOnly('stClosed');
    }
    return;
  }
  if (q.status === 'open') {
    const saved = localStorage.getItem(`qmeet:reg:${id}`);
    if (saved && !$('#regInput').value) $('#regInput').value = saved;
    showOnly('stIdentify');
  } else if (q.status === 'closed') {
    showOnly('stClosed');
  } else {
    showOnly('stWait');
  }
}

// Presence (live counts for the host) + broadcast (instant "status changed" updates).
async function connect() {
  try {
    const rt = await realtime();
    const ch = rt.channel(`quiz-${id}`, {
      config: { broadcast: { self: false }, presence: { key: crypto.randomUUID() } },
    });
    ch.on('broadcast', { event: 'status' }, () => load())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          S.channel = ch;
          track('viewing');
        }
      });
  } catch (err) {
    console.warn('Live updates unavailable, falling back to polling', err);
  }
}

function track(state) {
  S.channel?.track({ state }).catch(() => {});
}

function buildQuestions() {
  const box = $('#qList');
  box.innerHTML = '';
  const saved = loadDraft();
  S.quiz.questions.forEach((q, i) => {
    const fs = document.createElement('fieldset');
    fs.className = 'card qitem';
    fs.innerHTML = `<legend><span class="qnum">${i + 1}</span>${escapeHtml(q.q)}</legend>` +
      q.options.map((o, j) => `
        <label class="opt">
          <input type="radio" name="q${i}" value="${j}" ${saved[i] === j ? 'checked' : ''}>
          <span>${escapeHtml(o)}</span>
        </label>`).join('');
    box.append(fs);
  });
  box.onchange = () => {
    localStorage.setItem(draftKey(), JSON.stringify(answersFromDom()));
    updateProgress();
  };
  updateProgress();
}

function answersFromDom() {
  return S.quiz.questions.map((_, i) => {
    const c = document.querySelector(`input[name="q${i}"]:checked`);
    return c ? Number(c.value) : -1;
  });
}

function updateProgress() {
  const answered = answersFromDom().filter((a) => a >= 0).length;
  $('#progress').textContent = `${answered} of ${S.quiz.questions.length} answered`;
}

function startTimer() {
  clearInterval(S.timer);
  const tick = () => {
    const left = S.deadline - (Date.now() + S.offset);
    const t = $('#qTimer');
    t.classList.remove('hidden');
    t.textContent = fmt(left);
    t.classList.toggle('warn', left < 60000);
    if (left <= 0) {
      clearInterval(S.timer);
      submit(true);
    }
  };
  tick();
  S.timer = setInterval(tick, 1000);
}

$('#idForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  S.reg = $('#regInput').value.trim();
  S.name = $('#nameInput').value.trim();
  const btn = $('#startBtn');
  btn.disabled = true;
  $('#idError').classList.add('hidden');
  try {
    const r = await api('/api/quiz/start', { method: 'POST', body: { id, regNumber: S.reg, name: S.name } });
    S.started = true;
    S.offset = Date.parse(r.serverNow) - Date.now();   // align the timer with the server clock
    S.deadline = Date.parse(r.deadline);
    localStorage.setItem(`qmeet:reg:${id}`, S.reg);
    buildQuestions();
    startTimer();
    track('taking');
    showOnly('stQuiz');
  } catch (err) {
    $('#idError').textContent = err.message;
    $('#idError').classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
});

function finish(message) {
  S.submitted = true;
  clearInterval(S.timer);
  $('#qTimer').classList.add('hidden');
  localStorage.removeItem(draftKey());
  track('submitted');
  S.channel?.send({ type: 'broadcast', event: 'submitted', payload: {} });
  $('#doneMsg').textContent = message;
  showOnly('stDone');
}

async function submit(auto = false) {
  if (S.submitting || S.submitted) return;
  const answers = answersFromDom();
  const missing = answers.filter((a) => a < 0).length;
  if (!auto && missing && !confirm(`${missing} question(s) are unanswered. Submit anyway?`)) return;

  S.submitting = true;
  $('#submitBtn').disabled = true;
  try {
    const r = await api('/api/quiz/submit', { method: 'POST', body: { id, regNumber: S.reg, name: S.name, answers } });
    finish(r.showScore ? `Your score: ${r.score} out of ${r.total}.` : 'Your answers have been recorded.');
  } catch (err) {
    if (/already submitted/i.test(err.message)) {
      finish('You have already submitted this quiz.');
    } else if (/closed|time is up/i.test(err.message)) {
      clearInterval(S.timer);
      $('#closedMsg').textContent = err.message;
      showOnly('stClosed');
    } else {
      toast(err.message, 5000);
    }
  } finally {
    S.submitting = false;
    $('#submitBtn').disabled = false;
  }
}

$('#submitBtn').addEventListener('click', () => submit(false));

// Warn before leaving mid-quiz (only in the standalone tab; the embedded frame is kept by the meeting).
window.addEventListener('beforeunload', (e) => {
  if (S.started && !S.submitted && !document.body.classList.contains('embed')) {
    e.preventDefault();
    e.returnValue = '';
  }
});

load();
connect();
// Fallback polling in case a realtime message is missed.
setInterval(() => { if (!S.started && !S.submitted) load(); }, 12000);
