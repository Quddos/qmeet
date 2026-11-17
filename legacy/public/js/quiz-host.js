// Host side of quizzes, inside the meeting's Quiz tab:
// build a quiz, start/close it, see live counts, download Excel/CSV, email results.
import { $, api, toast, escapeHtml, downloadBlob } from './common.js';

const LABEL = { draft: 'Draft', open: 'Live', closed: 'Closed' };
const MAX_OPTIONS = 6;

export function initQuizHost({ code, hostToken, rt, announce }) {
  const list = $('#quizList');
  const form = $('#quizForm');
  const qWrap = $('#qWrap');
  const emailInput = $('#quizHostEmail');
  emailInput.value = localStorage.getItem('qmeet:hostEmail') || '';

  let quizzes = [];
  const subs = new Map();      // quiz id -> realtime channel (open quizzes only)
  const live = new Map();      // quiz id -> { viewing, taking }
  const results = new Map();   // quiz id -> { quiz, responses }
  let groupCounter = 0;

  // ----- Question builder -----
  function addOption(card, text = '', checked = false) {
    const row = document.createElement('div');
    row.className = 'opt-row';
    row.innerHTML = `
      <input type="radio" name="${card.dataset.group}" title="Mark as the correct answer" ${checked ? 'checked' : ''}>
      <input class="opttext" maxlength="200" placeholder="Option text" value="${escapeHtml(text)}">
      <button type="button" class="btn small ghost" data-del-opt aria-label="Remove option">✕</button>`;
    card.querySelector('.opts').append(row);
  }

  function addQuestion(data = { q: '', options: ['', '', '', ''], answer: 0 }) {
    const card = document.createElement('div');
    card.className = 'qcard2';
    card.dataset.group = `qg${++groupCounter}`;
    card.innerHTML = `
      <div class="qhead">
        <input class="qtext" maxlength="500" placeholder="Question" value="${escapeHtml(data.q)}">
        <button type="button" class="btn small ghost" data-del-q>Remove</button>
      </div>
      <div class="opts"></div>
      <div><button type="button" class="btn small ghost" data-add-opt>+ Add option</button>
      <span class="muted small">Tick the circle for the correct answer.</span></div>`;
    qWrap.append(card);
    data.options.forEach((o, i) => addOption(card, o, i === data.answer));
  }

  qWrap.addEventListener('click', (e) => {
    const card = e.target.closest('.qcard2');
    if (!card) return;
    if (e.target.matches('[data-del-q]')) card.remove();
    else if (e.target.matches('[data-add-opt]')) {
      if (card.querySelectorAll('.opt-row').length >= MAX_OPTIONS) return toast(`A question can have at most ${MAX_OPTIONS} options`);
      addOption(card);
    } else if (e.target.matches('[data-del-opt]')) {
      const row = e.target.closest('.opt-row');
      const wasChecked = row.querySelector('input[type="radio"]').checked;
      row.remove();
      if (wasChecked) {
        const first = card.querySelector('.opt-row input[type="radio"]');
        if (first) first.checked = true;
      }
    }
  });

  function readQuestions() {
    return Array.from(qWrap.querySelectorAll('.qcard2')).map((card) => {
      const options = [];
      let answer = -1;
      card.querySelectorAll('.opt-row').forEach((row) => {
        const text = row.querySelector('.opttext').value.trim();
        if (!text) return;
        if (row.querySelector('input[type="radio"]').checked) answer = options.length;
        options.push(text);
      });
      return { q: card.querySelector('.qtext').value.trim(), options, answer };
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    try {
      const hostEmail = emailInput.value.trim();
      if (hostEmail) localStorage.setItem('qmeet:hostEmail', hostEmail);
      await api('/api/quizzes', {
        method: 'POST',
        hostToken,
        body: {
          code,
          title: $('#quizTitle').value.trim(),
          durationMinutes: Number($('#quizDuration').value) || 10,
          showScore: $('#quizShowScore').checked,
          autoEmail: $('#quizAutoEmail').checked,
          hostEmail,
          questions: readQuestions(),
        },
      });
      toast('Quiz saved. Press "Start now" when you are ready.');
      form.reset();
      emailInput.value = hostEmail;
      qWrap.innerHTML = '';
      addQuestion();
      await load();
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      submit.disabled = false;
    }
  });

  $('#addQBtn').addEventListener('click', () => addQuestion());

  // ----- Quiz list -----
  async function load() {
    quizzes = await api(`/api/quizzes?code=${encodeURIComponent(code)}`, { hostToken });
    for (const q of quizzes) {
      if (q.status === 'open') subscribe(q.id);
      if (q.status !== 'draft') refreshResults(q.id, false);
    }
    render();
  }

  function btn(act, label, cls) {
    return `<button class="btn small ${cls}" data-act="${act}" type="button">${label}</button>`;
  }

  function cardHtml(q) {
    const stat = live.get(q.id) || { viewing: 0, taking: 0 };
    const res = results.get(q.id);
    const started = res ? res.responses.length : 0;
    const submitted = res ? res.responses.filter((r) => r.submitted_at).length : 0;
    const actions = [];
    if (q.status === 'draft') actions.push(btn('start', 'Start now', 'primary'), btn('delete', 'Delete', 'ghost'));
    if (q.status === 'open') actions.push(btn('close', 'Close quiz', 'danger'), btn('view', 'Preview as student', 'ghost'));
    if (q.status !== 'draft') {
      actions.push(btn('xlsx', 'Excel', 'ghost'), btn('csv', 'CSV', 'ghost'), btn('email', 'Email results', 'ghost'));
    }
    const liveLine = q.status === 'open'
      ? `Live: <b>${stat.taking}</b> taking · <b>${stat.viewing}</b> on the page · <b>${submitted}</b> submitted`
      : q.status === 'closed'
        ? `<b>${submitted}</b> submitted of ${started} who started`
        : '';
    return `
      <div class="qlist-card" data-id="${q.id}">
        <div class="row"><strong>${escapeHtml(q.title)}</strong><span class="pill ${q.status}">${LABEL[q.status]}</span></div>
        <div class="muted small">${q.duration_minutes} min per student · ${q.questions.length} questions${q.show_score ? ' · score shown' : ''}${q.host_email ? ` · ${escapeHtml(q.host_email)}` : ''}</div>
        ${liveLine ? `<div class="live">${liveLine}</div>` : ''}
        <div class="row wrap">${actions.join('')}</div>
      </div>`;
  }

  function render() {
    if (!quizzes.length) {
      list.innerHTML = '<p class="muted small">No quizzes yet. Create one below.</p>';
      return;
    }
    list.innerHTML = quizzes.slice().reverse().map(cardHtml).join('');
  }

  list.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const id = b.closest('[data-id]').dataset.id;
    const quiz = quizzes.find((q) => q.id === id);
    if (!quiz) return;
    b.disabled = true;
    try {
      await runAction(b.dataset.act, quiz);
    } catch (err) {
      toast(err.message, 5000);
    } finally {
      b.disabled = false;
    }
  });

  async function runAction(act, quiz) {
    const summary = (status) => ({
      id: quiz.id, title: quiz.title, durationMinutes: quiz.duration_minutes,
      showScore: quiz.show_score, status,
    });
    switch (act) {
      case 'start': {
        await api(`/api/quizzes?id=${quiz.id}`, { method: 'PATCH', hostToken, body: { action: 'start' } });
        subscribe(quiz.id);
        subs.get(quiz.id)?.send({ type: 'broadcast', event: 'status', payload: { status: 'open' } });
        announce(summary('open'));
        toast('Quiz is live for students');
        break;
      }
      case 'close': {
        if (!confirm('Close this quiz? Students will no longer be able to submit.')) return;
        const res = await api(`/api/quizzes?id=${quiz.id}`, { method: 'PATCH', hostToken, body: { action: 'close' } });
        subs.get(quiz.id)?.send({ type: 'broadcast', event: 'status', payload: { status: 'closed' } });
        announce(summary('closed'));
        unsubscribe(quiz.id);
        toast(res.emailed ? 'Quiz closed. Results were emailed to you.' : 'Quiz closed');
        break;
      }
      case 'delete': {
        if (!confirm('Delete this draft quiz?')) return;
        await api(`/api/quizzes?id=${quiz.id}`, { method: 'DELETE', hostToken });
        break;
      }
      case 'view':
        window.open(`/q/${encodeURIComponent(quiz.id)}`, '_blank', 'noopener');
        return;
      case 'xlsx':
        return exportXlsx(await getResults(quiz.id));
      case 'csv':
        return exportCsv(await getResults(quiz.id));
      case 'email': {
        const r = await api('/api/quiz/email', { method: 'POST', hostToken, body: { id: quiz.id } });
        toast(`Results emailed to ${r.to}`, 5000);
        return;
      }
      default:
        return;
    }
    await load();
  }

  // ----- Results -----
  async function getResults(id) {
    const data = await api(`/api/quiz/responses?id=${id}`, { hostToken });
    results.set(id, data);
    return data;
  }

  async function refreshResults(id, redraw = true) {
    try {
      await getResults(id);
      if (redraw) render();
    } catch { /* ignore transient errors */ }
  }

  const fmt = (v) => (v ? new Date(v).toLocaleString() : '');

  function resultRows(data) {
    const qs = data.quiz.questions;
    const header = [
      'Registration No', 'Name', 'Status', 'Score', 'Total', 'Percent', 'Started', 'Submitted',
      ...qs.map((q, i) => `Q${i + 1}: ${q.q}`),
    ];
    const body = data.responses.map((r) => {
      const done = !!r.submitted_at;
      return [
        r.reg_number,
        r.name || '',
        done ? 'Submitted' : 'In progress',
        done ? r.score : '',
        done ? r.total : '',
        done && r.total ? `${Math.round((r.score / r.total) * 100)}%` : '',
        fmt(r.started_at),
        done ? fmt(r.submitted_at) : '',
        ...qs.map((q, i) => {
          const a = r.answers?.[i];
          return a == null || a < 0 ? '' : q.options[a];
        }),
      ];
    });
    return [header, ...body];
  }

  function answerKeyRows(data) {
    return [
      ['Question #', 'Question', 'Option', 'Correct answer'],
      ...data.quiz.questions.flatMap((q, i) =>
        q.options.map((o, j) => [i + 1, q.q, o, j === q.answer ? 'Yes' : ''])),
    ];
  }

  function safeName(title) {
    return (title || 'quiz').replace(/[^\w-]+/g, '_').slice(0, 60) || 'quiz';
  }

  function exportXlsx(data) {
    if (!window.XLSX) return toast('Excel library is still loading. Try again in a moment.');
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(resultRows(data)), 'Results');
    window.XLSX.utils.book_append_sheet(wb, window.XLSX.utils.aoa_to_sheet(answerKeyRows(data)), 'Answer key');
    window.XLSX.writeFile(wb, `${safeName(data.quiz.title)}-results.xlsx`);
  }

  function exportCsv(data) {
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const text = '﻿' + resultRows(data).map((row) => row.map(esc).join(',')).join('\r\n');
    downloadBlob(`${safeName(data.quiz.title)}-results.csv`, new Blob([text], { type: 'text/csv;charset=utf-8' }));
  }

  // ----- Real-time: live counts from students on the quiz page -----
  function subscribe(id) {
    if (subs.has(id) || !rt) return;
    const ch = rt.channel(`quiz-${id}`, {
      config: { broadcast: { self: false }, presence: { key: `host-${crypto.randomUUID()}` } },
    });
    ch.on('presence', { event: 'sync' }, () => {
      let viewing = 0;
      let taking = 0;
      Object.values(ch.presenceState()).forEach((metas) => metas.forEach((m) => {
        viewing++;
        if (m.state === 'taking') taking++;
      }));
      live.set(id, { viewing, taking });
      render();
    })
      .on('broadcast', { event: 'submitted' }, () => refreshResults(id))
      .subscribe();
    subs.set(id, ch);
  }

  function unsubscribe(id) {
    const ch = subs.get(id);
    if (ch && rt) rt.removeChannel(ch);
    subs.delete(id);
    live.delete(id);
  }

  setInterval(() => {
    quizzes.filter((q) => q.status === 'open').forEach((q) => refreshResults(q.id));
  }, 10000);

  addQuestion();
  load().catch((err) => {
    list.innerHTML = `<p class="notice error">${escapeHtml(err.message)}</p>`;
  });
}
