// Sends quiz results to the host through Resend (https://resend.com, free tier).
import { db } from './db.js';
import { HttpError } from './http.js';
import { buildCsv } from './report.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

export async function sendResultsEmail({ quiz, to }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new HttpError(503, 'Email is not set up yet (the site owner must add RESEND_API_KEY)');
  if (!to) throw new HttpError(400, 'Set the host email for this quiz first');

  const responses = await db('GET', 'quiz_responses', {
    query: `?quiz_id=eq.${quiz.id}&select=reg_number,name,score,total,started_at,submitted_at,answers&order=started_at.asc`,
  });
  const submitted = responses.filter((r) => r.submitted_at).length;
  const rows = responses.map((r) => `
    <tr>
      <td>${esc(r.reg_number)}</td>
      <td>${esc(r.name)}</td>
      <td>${r.submitted_at ? `${r.score} / ${r.total}` : 'Not submitted'}</td>
    </tr>`).join('');

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#202124">
      <h2 style="margin-bottom:4px">${esc(quiz.title)}</h2>
      <p>${submitted} submitted out of ${responses.length} started. The full sheet is attached as CSV (opens in Excel).</p>
      <table cellpadding="6" cellspacing="0" style="border-collapse:collapse" border="1">
        <tr><th>Registration No</th><th>Name</th><th>Score</th></tr>
        ${rows}
      </table>
    </div>`;

  const safeTitle = quiz.title.replace(/[^\w-]+/g, '_').slice(0, 60) || 'results';
  const csv = buildCsv(quiz, responses);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'QMeet <onboarding@resend.dev>',
      to: [to],
      subject: `Quiz results: ${quiz.title}`,
      html,
      attachments: [{ filename: `${safeTitle}.csv`, content: Buffer.from(csv, 'utf8').toString('base64') }],
    }),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new HttpError(400, `The email could not be sent: ${detail}`);
  }
  return { to, count: responses.length };
}
