// Builds the CSV used for email attachments. The browser builds its own Excel/CSV files.

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function buildCsv(quiz, responses) {
  const qs = quiz.questions;
  const header = [
    'Registration No', 'Name', 'Status', 'Score', 'Total', 'Percent', 'Started', 'Submitted',
    ...qs.map((_, i) => `Q${i + 1} answer`),
  ];
  const lines = [header.map(cell).join(',')];

  for (const r of responses) {
    const done = !!r.submitted_at;
    const pct = done && r.total ? `${Math.round((r.score / r.total) * 100)}%` : '';
    const answers = qs.map((q, i) => {
      const a = r.answers?.[i];
      return a == null || a < 0 ? '' : q.options[a];
    });
    lines.push([
      r.reg_number,
      r.name || '',
      done ? 'Submitted' : 'In progress',
      done ? r.score : '',
      done ? r.total : '',
      pct,
      r.started_at,
      r.submitted_at || '',
      ...answers,
    ].map(cell).join(','));
  }
  // BOM so Excel opens non-English characters correctly.
  return '﻿' + lines.join('\r\n');
}
