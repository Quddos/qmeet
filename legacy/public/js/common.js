// Helpers shared by every page.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export const param = (name) => new URLSearchParams(location.search).get(name);

export const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

// Calls our own /api routes. Pass hostToken for host-only routes.
export async function api(path, { method = 'GET', body, hostToken } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (hostToken) headers['x-host-token'] = hostToken;
  const res = await fetch(path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

let configPromise;
export function config() {
  configPromise ||= api('/api/config');
  return configPromise;
}

// Supabase realtime client (broadcast + presence). Uses only the public anon key.
export async function realtime() {
  const c = await config();
  if (!c.supabaseUrl || !c.supabaseAnonKey) throw new Error('Realtime is not configured yet');
  return window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
    auth: { persistSession: false },
    realtime: { params: { eventsPerSecond: 30 } },
  });
}

export function toast(msg, ms = 3200) {
  let box = document.getElementById('toasts');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toasts';
    box.className = 'toasts';
    document.body.append(box);
  }
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

// The host token lives only in this browser. It proves the host owns the meeting.
const HOST_KEY = 'qmeet:host:';
export function getHostToken(code) {
  try { return localStorage.getItem(HOST_KEY + code); } catch { return null; }
}
export function saveHostToken(code, token) {
  try { localStorage.setItem(HOST_KEY + code, token); } catch { /* private mode */ }
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
