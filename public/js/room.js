// Meeting room: lobby, admit-all waiting room, WebRTC mesh, mute-all, screen share, chat, quizzes.
// Signalling runs over Supabase realtime broadcast on channel "room-<code>".
import { $, $$, api, config, realtime, param, toast, escapeHtml, getHostToken } from './common.js';
import { initQuizHost } from './quiz-host.js';

const code = (param('code') || '').toLowerCase();
const myId = crypto.randomUUID();
const ICE_BASE = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];
let ICE = ICE_BASE;

const S = {
  isHost: false,
  hostToken: null,
  name: localStorage.getItem('qmeet:name') || '',
  admitted: false,
  waiting: false,
  channel: null,
  rt: null,
  mic: false,
  cam: false,
  hand: false,
  tab: 'people',
  activeQuiz: null,
  timers: [],
};

const people = new Map();   // id -> { id, name, isHost, mic, cam, sharing, hand, seen }
const waiting = new Map();  // id -> name (host only)
const peers = new Map();    // id -> { id, pc, stream, audioSender, videoSender, pending, remoteSet }

let micTrack = null;
let camTrack = null;
let screenTrack = null;
const localView = new MediaStream();
const currentVideo = () => screenTrack || camTrack;

// ---------- Media ----------
async function acquire(kind) {
  try {
    const constraints = kind === 'audio'
      ? { audio: { echoCancellation: true, noiseSuppression: true } }
      : { video: { width: { ideal: 1280 }, height: { ideal: 720 } } };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    return stream.getTracks()[0];
  } catch {
    return null;
  }
}

function refreshLocal() {
  localView.getTracks().forEach((t) => localView.removeTrack(t));
  const v = currentVideo();
  if (v) localView.addTrack(v);
  const preview = $('#previewVideo');
  if (preview.srcObject !== localView) preview.srcObject = localView;
  syncMe();
  scheduleRender();
}

function attachTo(peer) {
  peer.audioSender.replaceTrack(micTrack).catch(() => {});
  peer.videoSender.replaceTrack(currentVideo()).catch(() => {});
}
const attachAll = () => peers.forEach(attachTo);
const attachVideo = () => peers.forEach((p) => p.videoSender.replaceTrack(currentVideo()).catch(() => {}));

async function toggleMic() {
  if (!micTrack) {
    micTrack = await acquire('audio');
    if (!micTrack) return toast('No microphone found or permission denied');
    attachAll();
  }
  S.mic = !S.mic;
  micTrack.enabled = S.mic;
  afterMediaChange();
}

async function toggleCam() {
  if (camTrack) {
    camTrack.stop();
    camTrack = null;
    S.cam = false;
  } else {
    camTrack = await acquire('video');
    if (!camTrack) return toast('No camera found or permission denied');
    S.cam = true;
  }
  attachVideo();
  afterMediaChange();
}

async function toggleShare() {
  if (screenTrack) return stopShare();
  try {
    const s = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    screenTrack = s.getVideoTracks()[0];
    screenTrack.onended = stopShare;
  } catch {
    return toast('Screen sharing was cancelled');
  }
  attachVideo();
  afterMediaChange();
}

function stopShare() {
  if (screenTrack) screenTrack.stop();
  screenTrack = null;
  attachVideo();
  afterMediaChange();
}

function afterMediaChange() {
  refreshLocal();
  changed();
}

// ---------- Realtime signalling ----------
function send(payload) {
  if (!S.channel) return;
  S.channel.send({ type: 'broadcast', event: 'msg', payload: { ...payload, from: myId } });
}

async function connect() {
  if (S.channel) return;
  S.rt = S.rt || await realtime();
  const ch = S.rt.channel(`room-${code}`, { config: { broadcast: { self: false } } });
  ch.on('broadcast', { event: 'msg' }, ({ payload }) => {
    try { onMessage(payload); } catch (err) { console.error(err); }
  });
  await new Promise((resolve, reject) => {
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') resolve();
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') reject(new Error('Could not connect to the meeting'));
    });
  });
  S.channel = ch;
}

function selfInfo() {
  return { name: S.name, isHost: S.isHost, mic: S.mic, cam: S.cam, sharing: !!screenTrack, hand: S.hand };
}

function onMessage(p) {
  if (!p || p.from === myId) return;
  // Messages with "to" are only for the people listed. No "to" means everyone.
  if (p.to && p.to !== '*' && !(Array.isArray(p.to) ? p.to.includes(myId) : p.to === myId)) return;

  switch (p.t) {
    case 'knock':
      if (S.isHost && S.admitted) {
        if (!waiting.has(p.from)) toast(`${p.name || 'Someone'} is waiting to join`);
        waiting.set(p.from, p.name || 'Guest');
        scheduleRender();
      }
      break;

    case 'admit':
      if (!S.admitted && S.waiting) {
        S.waiting = false;
        enterMeeting();
      }
      break;

    case 'deny':
      if (!S.admitted) {
        S.waiting = false;
        $('#joinBtn').disabled = false;
        $('#lobbyStatus').textContent = 'The host did not let you in this time.';
      }
      break;

    case 'hello':
      if (!S.admitted) return;
      upsert(p);
      connectTo(p.from);
      if (!p.reply) send({ t: 'hello', reply: true, to: p.from, ...selfInfo(), quiz: S.activeQuiz });
      else if (p.quiz) applyQuiz(p.quiz);
      break;

    case 'state':
      if (!S.admitted) return;
      if (!people.has(p.from)) {
        upsert(p);
        connectTo(p.from);
        send({ t: 'hello', reply: true, to: p.from, ...selfInfo(), quiz: S.activeQuiz });
      } else {
        upsert(p);
      }
      break;

    case 'signal':
      if (S.admitted) onSignal(p.from, p.data);
      break;

    case 'chat':
      addChat(p.name, p.text, false);
      break;

    case 'mute':
      if (S.mic) toggleMic();
      toast(p.to === '*' ? 'The host muted everyone' : 'The host muted you');
      break;

    case 'remove':
      leaveMeeting('The host removed you from the meeting.');
      break;

    case 'end':
      leaveMeeting('The host ended the meeting.');
      break;

    case 'leave':
      removePerson(p.from);
      break;

    case 'quiz':
      applyQuiz(p.quiz);
      break;

    default:
      break;
  }
}

// ---------- WebRTC mesh ----------
// Rule to avoid "both sides send an offer": the peer with the smaller id always makes the offer.
function connectTo(id) {
  if (id === myId || peers.has(id) || !S.admitted) return;
  const peer = createPeer(id);
  if (myId < id) makeOffer(peer);
}

function createPeer(id) {
  const pc = new RTCPeerConnection({ iceServers: ICE });
  // Transceivers are created up front, so camera / screen toggles never need renegotiation.
  const a = pc.addTransceiver('audio', { direction: 'sendrecv' });
  const v = pc.addTransceiver('video', { direction: 'sendrecv' });
  const peer = {
    id, pc, stream: new MediaStream(),
    audioSender: a.sender, videoSender: v.sender,
    pending: [], remoteSet: false,
  };
  peers.set(id, peer);
  pc.onicecandidate = (e) => {
    if (e.candidate) send({ t: 'signal', to: id, data: { candidate: e.candidate.toJSON() } });
  };
  pc.ontrack = (e) => {
    peer.stream.addTrack(e.track);
    scheduleRender();
  };
  attachTo(peer);
  return peer;
}

async function makeOffer(peer) {
  const offer = await peer.pc.createOffer();
  await peer.pc.setLocalDescription(offer);
  send({ t: 'signal', to: peer.id, data: { sdp: peer.pc.localDescription.toJSON() } });
}

async function onSignal(from, data) {
  if (!data) return;
  let peer = peers.get(from);
  try {
    if (data.sdp) {
      if (data.sdp.type === 'offer' && !peer) peer = createPeer(from);
      if (!peer) return;
      if (data.sdp.type === 'answer' && peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription(data.sdp);
      peer.remoteSet = true;
      for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      if (data.sdp.type === 'offer') {
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        send({ t: 'signal', to: from, data: { sdp: peer.pc.localDescription.toJSON() } });
      }
    } else if (data.candidate) {
      if (!peer) return;
      if (peer.remoteSet) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  } catch (err) {
    console.warn('Signalling error', err);
  }
}

function dropPeer(id) {
  const peer = peers.get(id);
  if (!peer) return;
  peer.pc.close();
  peers.delete(id);
}

// ---------- People state ----------
function syncMe() {
  if (!S.admitted && !people.has(myId)) return;
  const me = people.get(myId) || { id: myId };
  Object.assign(me, {
    name: S.name || 'You', isHost: S.isHost, mic: S.mic, cam: S.cam,
    sharing: !!screenTrack, hand: S.hand, seen: Date.now(),
  });
  people.set(myId, me);
}

function sendState() {
  if (!S.admitted) return;
  syncMe();
  send({ t: 'state', ...selfInfo() });
}

function changed() {
  sendState();
  renderAll();
}

function upsert(p) {
  const cur = people.get(p.from) || { id: p.from };
  Object.assign(cur, {
    name: p.name || cur.name || 'Guest',
    isHost: !!p.isHost,
    mic: !!p.mic,
    cam: !!p.cam,
    sharing: !!p.sharing,
    hand: !!p.hand,
    seen: Date.now(),
  });
  people.set(p.from, cur);
  scheduleRender();
}

function removePerson(id) {
  if (id === myId) return;
  people.delete(id);
  dropPeer(id);
  scheduleRender();
}

function prune() {
  for (const p of Array.from(people.values())) {
    if (p.id !== myId && Date.now() - p.seen > 20000) removePerson(p.id);
  }
}

// ---------- Rendering ----------
let renderTimer = null;
function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = null; renderAll(); }, 150);
}

function renderAll() {
  syncMe();
  renderStage();
  renderPeople();
  renderControls();
}

function renderStage() {
  const stage = $('#stage');
  stage.querySelectorAll('.tile').forEach((t) => { if (!people.has(t.dataset.id)) t.remove(); });

  for (const p of people.values()) {
    const isMe = p.id === myId;
    let tile = stage.querySelector(`.tile[data-id="${p.id}"]`);
    if (!tile) {
      tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.id = p.id;
      tile.innerHTML = '<video autoplay playsinline></video><div class="avatar"></div><div class="tag"></div><div class="icons"></div>';
      stage.append(tile);
    }
    const video = tile.querySelector('video');
    if (isMe) {
      video.muted = true;
      if (video.srcObject !== localView) video.srcObject = localView;
    } else {
      const peer = peers.get(p.id);
      if (peer && video.srcObject !== peer.stream) video.srcObject = peer.stream;
    }
    tile.classList.toggle('me', isMe);
    tile.classList.toggle('cam-off', !p.cam && !p.sharing);
    tile.classList.toggle('presenting', !!p.sharing);
    tile.querySelector('.avatar').textContent = (p.name || '?').trim().charAt(0).toUpperCase();
    tile.querySelector('.tag').textContent = `${isMe ? 'You' : escapeHtml(p.name)}${p.isHost ? ' · Host' : ''}`;
    tile.querySelector('.icons').textContent = `${p.mic ? '' : '🔇'}${p.hand ? '✋' : ''}`;
  }
}

function renderPeople() {
  const isHost = S.isHost;
  $('#hostTools').classList.toggle('hidden', !isHost);
  $('#endRow').classList.toggle('hidden', !isHost);

  const arr = Array.from(people.values()).sort((a, b) => (b.isHost - a.isHost) || (a.name || '').localeCompare(b.name || ''));
  $('#peopleCount').textContent = arr.length;
  $('#peopleList').innerHTML = arr.map((p) => {
    const isMe = p.id === myId;
    const tags = `${isMe ? ' <span class="muted">(you)</span>' : ''}${p.isHost ? ' <span class="muted">(host)</span>' : ''}`;
    const hostBtns = isHost && !isMe && !p.isHost
      ? `<button class="btn small ghost" data-mute="${p.id}" type="button">Mute</button>
         <button class="btn small ghost" data-remove="${p.id}" type="button">Remove</button>`
      : '';
    return `<li><span class="pname">${escapeHtml(p.name)}${tags}</span>
      <span>${p.mic ? '' : '🔇'}${p.cam ? '' : '🚫'}${p.hand ? '✋' : ''}${p.sharing ? '🖥️' : ''}</span>${hostBtns}</li>`;
  }).join('');

  const w = Array.from(waiting.entries());
  $('#waitCount').textContent = w.length;
  $('#waitList').innerHTML = w.map(([id, name]) => `
    <li><span class="pname">${escapeHtml(name)}</span>
      <button class="btn small primary" data-admit="${id}" type="button">Admit</button>
      <button class="btn small ghost" data-deny="${id}" type="button">Deny</button></li>`).join('');
  $('#admitAllBtn').classList.toggle('hidden', w.length === 0);
  $('#admitAllBtn').textContent = w.length > 1 ? `Admit all (${w.length})` : 'Admit all';

  const badge = $('#peopleBadge');
  badge.textContent = w.length;
  badge.classList.toggle('hidden', !isHost || w.length === 0);
}

function renderControls() {
  const setBtn = (btn, on, onLabel, offLabel, offClass = true) => {
    btn.querySelector('.lbl').textContent = on ? onLabel : offLabel;
    if (offClass) btn.classList.toggle('off', !on);
  };
  setBtn($('#micBtn'), S.mic, 'Mute', 'Unmute');
  setBtn($('#camBtn'), S.cam, 'Camera', 'Camera off');
  setBtn($('#lobbyMic'), S.mic, 'Mic', 'Mic off');
  setBtn($('#lobbyCam'), S.cam, 'Camera', 'Camera off');
  $('#previewOff').classList.toggle('hidden', S.cam);

  const sharing = !!screenTrack;
  $('#shareBtn').classList.toggle('on', sharing);
  $('#shareBtn').querySelector('.lbl').textContent = sharing ? 'Stop' : 'Present';
  $('#handBtn').classList.toggle('on', S.hand);
  $('#handBtn').querySelector('.lbl').textContent = S.hand ? 'Lower' : 'Raise hand';
  $('#quizBtn').classList.toggle('on', S.tab === 'quiz' && isSideOpen());
}

// ---------- Side panel ----------
const isSideOpen = () => !$('#side').classList.contains('hidden');

function openPanel(tab) {
  S.tab = tab;
  $('#side').classList.remove('hidden');
  $$('.tab[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === tab));
  if (tab === 'chat') $('#chatInput').focus();
  renderControls();
}

function togglePanel(tab) {
  if (isSideOpen() && S.tab === tab) {
    $('#side').classList.add('hidden');
    renderControls();
  } else {
    openPanel(tab);
  }
}

function addChat(name, text, mine) {
  const log = $('#chatLog');
  const d = document.createElement('div');
  d.className = `msg${mine ? ' mine' : ''}`;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  d.innerHTML = `<b>${escapeHtml(name)}</b> <span class="muted small">${time}</span><div>${escapeHtml(text)}</div>`;
  log.append(d);
  log.scrollTop = log.scrollHeight;
}

// ---------- Quizzes (students see the active quiz here) ----------
function applyQuiz(quiz) {
  const prev = S.activeQuiz;
  S.activeQuiz = quiz || null;
  renderQuizCard();
  // Students: a newly opened quiz pops up beside the call automatically.
  if (!S.isHost && quiz && quiz.status === 'open' && (!prev || prev.id !== quiz.id || prev.status !== 'open')) {
    openQuizFrame(quiz);
  }
}

function renderQuizCard() {
  const q = S.activeQuiz;
  const card = $('#quizCard');
  if (!q) {
    card.innerHTML = '<div class="quiz-card"><span class="muted">No quiz is running right now.</span></div>';
    return;
  }
  const open = q.status === 'open';
  card.innerHTML = `
    <div class="quiz-card">
      <div class="row"><strong>${escapeHtml(q.title)}</strong><span class="pill ${escapeHtml(q.status)}">${open ? 'Open' : 'Closed'}</span></div>
      <div class="muted small">${q.durationMinutes} minutes per student${q.showScore ? ' · score shown after submit' : ''}</div>
      <div class="row wrap">
        ${open ? '<button id="openQuizHere" class="btn small primary" type="button">Open beside the call</button>' : ''}
        <a class="btn small ghost" href="/q/${encodeURIComponent(q.id)}" target="_blank" rel="noopener">Open in new tab</a>
      </div>
    </div>`;
  $('#openQuizHere')?.addEventListener('click', () => openQuizFrame(q));
}

function openQuizFrame(q) {
  openPanel('quiz');
  $('#quizFrameTitle').textContent = q.title;
  $('#quizNewTab').href = `/q/${encodeURIComponent(q.id)}`;
  const frame = $('#quizFrame');
  const src = `/quiz.html?id=${encodeURIComponent(q.id)}&embed=1`;
  if (frame.getAttribute('src') !== src) frame.src = src;
  $('#quizFrameWrap').classList.remove('hidden');
}

// ---------- Meeting lifecycle ----------
async function enterMeeting() {
  S.admitted = true;
  $('#lobby').classList.add('hidden');
  $('#meeting').classList.remove('hidden');
  syncMe();
  refreshLocal();

  if (S.isHost) {
    $('#quizStudent').classList.add('hidden');
    $('#quizHost').classList.remove('hidden');
    initQuizHost({
      code,
      hostToken: S.hostToken,
      rt: S.rt,
      announce: (quiz) => {
        applyQuiz(quiz);
        send({ t: 'quiz', quiz });
      },
    });
  } else {
    $('#quizHost').classList.add('hidden');
    $('#quizStudent').classList.remove('hidden');
    $('#quizStudent').style.display = 'flex';
  }

  send({ t: 'hello', ...selfInfo() });
  renderQuizCard();
  renderAll();
  S.timers.push(setInterval(sendState, 5000));
  S.timers.push(setInterval(prune, 5000));
}

function leaveMeeting(message) {
  if (!S.admitted && !S.channel) return location.assign('/');
  try { send({ t: 'leave' }); } catch { /* channel may already be closed */ }
  S.timers.forEach(clearInterval);
  S.timers = [];
  peers.forEach((p) => p.pc.close());
  peers.clear();
  [micTrack, camTrack, screenTrack].forEach((t) => t && t.stop());
  if (S.channel && S.rt) S.rt.removeChannel(S.channel);
  S.channel = null;
  location.assign(`/?msg=${encodeURIComponent(message || 'You left the meeting.')}`);
}

function showError(message) {
  $('#errorText').textContent = message;
  $('#errorPage').classList.remove('hidden');
}

// ---------- Startup ----------
async function init() {
  if (!/^[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(code)) return showError('This meeting link is not valid.');

  let info;
  try {
    info = await api(`/api/meetings?code=${encodeURIComponent(code)}`);
  } catch (err) {
    return showError(err.message);
  }
  if (!info.exists) return showError('This meeting does not exist or has ended.');

  S.hostToken = getHostToken(code);
  S.isHost = !!S.hostToken;

  $('#meetingTitle').textContent = info.title || 'Meeting';
  $('#meetingCode').textContent = code;
  $('#lobbyTitle').textContent = info.title || 'Ready to join?';
  $('#lobbyCode').textContent = `Meeting code: ${code}`;
  $('#nameInput').value = S.name;
  $('#joinBtn').textContent = S.isHost ? 'Start meeting' : 'Ask to join';
  $('#lobby').classList.remove('hidden');

  try {
    const cfg = await config();
    ICE = [...ICE_BASE, ...(cfg.iceServers || [])];
  } catch { /* fall back to public STUN */ }

  micTrack = await acquire('audio');
  camTrack = await acquire('video');
  S.mic = !!micTrack;
  S.cam = !!camTrack;
  refreshLocal();
  renderControls();
}

$('#lobbyMic').addEventListener('click', toggleMic);
$('#lobbyCam').addEventListener('click', toggleCam);

$('#joinBtn').addEventListener('click', async (e) => {
  const name = $('#nameInput').value.trim();
  if (!name) return toast('Enter your name first');
  S.name = name;
  localStorage.setItem('qmeet:name', name);
  const btn = e.currentTarget;
  btn.disabled = true;
  $('#lobbyStatus').textContent = 'Connecting…';
  try {
    await connect();
  } catch (err) {
    btn.disabled = false;
    $('#lobbyStatus').textContent = err.message;
    return;
  }
  if (S.isHost) {
    await enterMeeting();
    return;
  }
  S.waiting = true;
  $('#lobbyStatus').textContent = 'Waiting for the host to admit you…';
  send({ t: 'knock', name });
  // Keep knocking so the host sees you even if they join after you.
  S.timers.push(setInterval(() => { if (S.waiting) send({ t: 'knock', name }); }, 4000));
});

$('#micBtn').addEventListener('click', toggleMic);
$('#camBtn').addEventListener('click', toggleCam);
$('#shareBtn').addEventListener('click', toggleShare);
$('#handBtn').addEventListener('click', () => { S.hand = !S.hand; changed(); });
$('#peopleBtn').addEventListener('click', () => togglePanel('people'));
$('#chatBtn').addEventListener('click', () => togglePanel('chat'));
$('#quizBtn').addEventListener('click', () => togglePanel('quiz'));
$('#closeSide').addEventListener('click', () => { $('#side').classList.add('hidden'); renderControls(); });
$('#leaveBtn').addEventListener('click', () => leaveMeeting('You left the meeting.'));
$('#copyBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/m/${code}`);
    toast('Meeting link copied');
  } catch {
    toast(`Share this link: ${location.origin}/m/${code}`, 6000);
  }
});
$('#quizFrameClose').addEventListener('click', () => {
  $('#quizFrame').removeAttribute('src');
  $('#quizFrameWrap').classList.add('hidden');
});

$$('.tab[data-tab]').forEach((b) => b.addEventListener('click', () => openPanel(b.dataset.tab)));

// Host: mute everyone, admit, deny, mute or remove a single person.
$('#muteAllBtn').addEventListener('click', () => {
  send({ t: 'mute', to: '*' });
  toast('Muted everyone. People can unmute themselves.');
});
$('#admitAllBtn').addEventListener('click', () => {
  const ids = Array.from(waiting.keys());
  if (!ids.length) return;
  send({ t: 'admit', to: ids });
  ids.forEach((id) => waiting.delete(id));
  toast(`Admitted ${ids.length} ${ids.length === 1 ? 'person' : 'people'}`);
  scheduleRender();
});
$('#endBtn').addEventListener('click', () => {
  if (!confirm('End this meeting for everyone?')) return;
  send({ t: 'end', to: '*' });
  leaveMeeting('The meeting was ended.');
});

$('#peopleList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.mute) { send({ t: 'mute', to: [b.dataset.mute] }); toast('Muted'); }
  if (b.dataset.remove) { send({ t: 'remove', to: [b.dataset.remove] }); removePerson(b.dataset.remove); }
});
$('#waitList').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.admit) {
    send({ t: 'admit', to: [b.dataset.admit] });
    waiting.delete(b.dataset.admit);
    scheduleRender();
  }
  if (b.dataset.deny) {
    send({ t: 'deny', to: b.dataset.deny });
    waiting.delete(b.dataset.deny);
    scheduleRender();
  }
});

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('#chatInput');
  const text = input.value.trim();
  if (!text) return;
  send({ t: 'chat', name: S.name, text });
  addChat(S.name, text, true);
  input.value = '';
});

$('#endBtn').parentElement.classList.toggle('hidden', !S.isHost);

setInterval(() => {
  $('#clock').textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}, 1000);

window.addEventListener('beforeunload', () => { try { send({ t: 'leave' }); } catch { /* ignore */ } });

init();
