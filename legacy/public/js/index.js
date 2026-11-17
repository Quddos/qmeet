import { $, api, toast, saveHostToken } from './common.js';

const notice = new URLSearchParams(location.search).get('msg');
if (notice) {
  const n = $('#notice');
  n.textContent = notice;
  n.classList.remove('hidden');
}

$('#hostName').value = localStorage.getItem('qmeet:name') || '';

$('#startBtn').addEventListener('click', async (e) => {
  const name = $('#hostName').value.trim();
  if (!name) return toast('Enter your name first');
  localStorage.setItem('qmeet:name', name);
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const m = await api('/api/meetings', {
      method: 'POST',
      body: { title: $('#meetingTitle').value.trim() },
    });
    saveHostToken(m.code, m.hostToken);
    location.href = `/room.html?code=${encodeURIComponent(m.code)}`;
  } catch (err) {
    toast(err.message);
    btn.disabled = false;
  }
});

function goToJoin() {
  const raw = $('#joinCode').value.trim();
  const match = raw.match(/[a-z]{3}-[a-z]{4}-[a-z]{3}/i);
  if (!match) return toast('Enter a valid meeting code, like abc-defg-hij');
  location.href = `/room.html?code=${match[0].toLowerCase()}`;
}
$('#joinBtn').addEventListener('click', goToJoin);
$('#joinCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') goToJoin(); });
