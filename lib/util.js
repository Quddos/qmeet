import crypto from 'node:crypto';
import { db } from './db.js';
import { HttpError } from './http.js';

// Meeting codes look like "abc-defg-hij" (letters only, easy to read and share).
export const CODE_RE = /^[a-z]{3}-[a-z]{4}-[a-z]{3}$/;
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LETTERS = 'abcdefghjkmnpqrstuvwxyz';

export function newCode() {
  const pick = (n) => Array.from(crypto.randomBytes(n), (b) => LETTERS[b % LETTERS.length]).join('');
  return `${pick(3)}-${pick(4)}-${pick(3)}`;
}

export const newToken = () => crypto.randomBytes(24).toString('hex');

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function normalizeCode(v) {
  return String(v || '').trim().toLowerCase();
}

export async function getMeeting(code) {
  if (!CODE_RE.test(code || '')) throw new HttpError(400, 'Invalid meeting code');
  const rows = await db('GET', 'meetings', { query: `?code=eq.${encodeURIComponent(code)}&select=*` });
  return rows[0] || null;
}

// Throws unless the request carries the host token for this meeting.
export function requireHost(req, meeting) {
  if (!meeting) throw new HttpError(404, 'Meeting not found');
  if (!safeEqual(req.headers['x-host-token'] || '', meeting.host_token)) {
    throw new HttpError(403, 'Only the host can do this');
  }
  return meeting;
}

export async function getQuiz(id) {
  if (!UUID_RE.test(id || '')) throw new HttpError(400, 'Invalid quiz id');
  const rows = await db('GET', 'quizzes', { query: `?id=eq.${id}&select=*` });
  if (!rows[0]) throw new HttpError(404, 'Quiz not found');
  return rows[0];
}

export async function requireQuizHost(req, id) {
  const quiz = await getQuiz(id);
  const meeting = await getMeeting(quiz.meeting_code);
  requireHost(req, meeting);
  return { quiz, meeting };
}

// Registration numbers are matched case-insensitively, so store them upper-case.
export function cleanReg(v) {
  const r = String(v || '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9/\-_. ]{1,29}$/.test(r)) {
    throw new HttpError(400, 'Enter a valid registration number (2 to 30 letters, digits, / - _ or .)');
  }
  return r;
}

export function cleanName(v) {
  return String(v || '').trim().slice(0, 80) || null;
}

export function quizDeadline(response, quiz) {
  const byDuration = Date.parse(response.started_at) + quiz.duration_minutes * 60000;
  const byClose = quiz.closes_at ? Date.parse(quiz.closes_at) : Infinity;
  return Math.min(byDuration, byClose);
}

export async function getResponse(quizId, reg) {
  const rows = await db('GET', 'quiz_responses', {
    query: `?quiz_id=eq.${quizId}&reg_number=eq.${encodeURIComponent(reg)}&select=*`,
  });
  return rows[0] || null;
}
