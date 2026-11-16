// Host-only quiz management: list, create, start, close, delete.
import { db } from '../lib/db.js';
import { handle, HttpError } from '../lib/http.js';
import { sendResultsEmail } from '../lib/email.js';
import { getMeeting, getQuiz, normalizeCode, requireHost } from '../lib/util.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function cleanQuestions(list) {
  if (!Array.isArray(list) || list.length < 1 || list.length > 100) {
    throw new HttpError(400, 'Add between 1 and 100 questions');
  }
  return list.map((item, i) => {
    const q = String(item?.q || '').trim().slice(0, 500);
    const options = (Array.isArray(item?.options) ? item.options : [])
      .map((o) => String(o ?? '').trim().slice(0, 200));
    const answer = Number(item?.answer);
    if (!q) throw new HttpError(400, `Question ${i + 1} needs text`);
    if (options.length < 2 || options.length > 6) throw new HttpError(400, `Question ${i + 1} needs 2 to 6 options`);
    if (options.some((o) => !o)) throw new HttpError(400, `Question ${i + 1} has an empty option`);
    if (!Number.isInteger(answer) || answer < 0 || answer >= options.length) {
      throw new HttpError(400, `Question ${i + 1} needs one option marked as correct`);
    }
    return { q, options, answer };
  });
}

export default handle(['GET', 'POST', 'PATCH', 'DELETE'], async (req, res) => {
  // GET /api/quizzes?code=...  -> all quizzes in a meeting (host only)
  if (req.method === 'GET') {
    const meeting = await getMeeting(normalizeCode(req.query.code));
    requireHost(req, meeting);
    const rows = await db('GET', 'quizzes', {
      query: `?meeting_code=eq.${meeting.code}&select=*&order=created_at.asc`,
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(rows);
  }

  // POST /api/quizzes -> create a draft quiz
  if (req.method === 'POST') {
    const b = req.body || {};
    const meeting = await getMeeting(normalizeCode(b.code));
    requireHost(req, meeting);

    const title = String(b.title || '').trim().slice(0, 150);
    if (!title) throw new HttpError(400, 'Give the quiz a title');
    const questions = cleanQuestions(b.questions);
    const duration = Math.min(180, Math.max(1, Math.round(Number(b.durationMinutes) || 10)));
    const hostEmail = String(b.hostEmail || '').trim().slice(0, 200) || null;
    if (hostEmail && !EMAIL_RE.test(hostEmail)) throw new HttpError(400, 'Enter a valid host email');

    const rows = await db('POST', 'quizzes', {
      returning: true,
      body: {
        meeting_code: meeting.code,
        title,
        questions,
        duration_minutes: duration,
        show_score: !!b.showScore,
        host_email: hostEmail,
        auto_email: !!b.autoEmail && !!hostEmail,
      },
    });
    return res.status(201).json(rows[0]);
  }

  // PATCH /api/quizzes?id=...  body: { action: 'start' | 'close' }
  if (req.method === 'PATCH') {
    const quiz = await getQuiz(String(req.query.id || ''));
    const meeting = await getMeeting(quiz.meeting_code);
    requireHost(req, meeting);
    const action = req.body?.action;

    if (action === 'start') {
      if (quiz.status === 'open') return res.status(200).json(quiz);
      if (quiz.status === 'closed') throw new HttpError(409, 'This quiz is already closed');
      const now = new Date();
      // Hard cutoff: the quiz window ends duration + 10 minutes after it opens.
      const closes = new Date(now.getTime() + (quiz.duration_minutes + 10) * 60000);
      const rows = await db('PATCH', 'quizzes', {
        query: `?id=eq.${quiz.id}`,
        returning: true,
        body: { status: 'open', opened_at: now.toISOString(), closes_at: closes.toISOString() },
      });
      return res.status(200).json(rows[0]);
    }

    if (action === 'close') {
      if (quiz.status !== 'open') throw new HttpError(409, 'This quiz is not open');
      const rows = await db('PATCH', 'quizzes', {
        query: `?id=eq.${quiz.id}`,
        returning: true,
        body: { status: 'closed', closes_at: new Date().toISOString() },
      });
      let emailed = false;
      if (quiz.auto_email && quiz.host_email) {
        try {
          await sendResultsEmail({ quiz: rows[0], to: quiz.host_email });
          emailed = true;
        } catch (err) {
          console.error('Auto-email failed:', err.message);
        }
      }
      return res.status(200).json({ ...rows[0], emailed });
    }

    throw new HttpError(400, 'Unknown action');
  }

  // DELETE /api/quizzes?id=...  (drafts only)
  const quiz = await getQuiz(String(req.query.id || ''));
  requireHost(req, await getMeeting(quiz.meeting_code));
  if (quiz.status !== 'draft') throw new HttpError(409, 'Only draft quizzes can be deleted');
  await db('DELETE', 'quizzes', { query: `?id=eq.${quiz.id}` });
  return res.status(200).json({ deleted: true });
});
