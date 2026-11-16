import { db } from '../lib/db.js';
import { handle, HttpError } from '../lib/http.js';
import { CODE_RE, getMeeting, newCode, newToken, normalizeCode } from '../lib/util.js';

export default handle(['GET', 'POST'], async (req, res) => {
  // GET /api/meetings?code=abc-defg-hij  -> does this meeting exist?
  if (req.method === 'GET') {
    const code = normalizeCode(req.query.code);
    if (!CODE_RE.test(code)) return res.status(200).json({ exists: false });
    const meeting = await getMeeting(code);
    return res.status(200).json({ exists: !!meeting, code, title: meeting?.title || null });
  }

  // POST /api/meetings -> create a meeting. The host token is returned once and kept in the host's browser.
  const title = String(req.body?.title || '').trim().slice(0, 100) || null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode();
    const hostToken = newToken();
    try {
      await db('POST', 'meetings', { body: { code, host_token: hostToken, title } });
      return res.status(201).json({ code, hostToken, title });
    } catch (err) {
      if (err.status !== 409) throw err; // 409 = code collision, try again
    }
  }
  throw new HttpError(500, 'Could not create a meeting, please try again');
});
