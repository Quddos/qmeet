// Student starts (or resumes) the quiz. The server records the start time and sets the deadline.
import { db } from '../../lib/db.js';
import { handle, HttpError } from '../../lib/http.js';
import { cleanName, cleanReg, getQuiz, getResponse, quizDeadline } from '../../lib/util.js';

export default handle(['POST'], async (req, res) => {
  const b = req.body || {};
  const quiz = await getQuiz(String(b.id || ''));
  const reg = cleanReg(b.regNumber);
  const name = cleanName(b.name);

  if (quiz.status === 'draft') throw new HttpError(409, 'This quiz has not been opened yet');
  if (quiz.status === 'closed') throw new HttpError(409, 'This quiz is closed');
  if (quiz.closes_at && Date.now() > Date.parse(quiz.closes_at)) throw new HttpError(409, 'This quiz has closed');

  let response = await getResponse(quiz.id, reg);
  if (response?.submitted_at) throw new HttpError(409, 'You have already submitted this quiz');

  if (!response) {
    try {
      const rows = await db('POST', 'quiz_responses', {
        returning: true,
        body: { quiz_id: quiz.id, reg_number: reg, name, started_at: new Date().toISOString() },
      });
      response = rows[0];
    } catch (err) {
      // Two tabs started at the same moment: the other insert won, so reuse it.
      if (err.status !== 409) throw err;
      response = await getResponse(quiz.id, reg);
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    startedAt: response.started_at,
    deadline: new Date(quizDeadline(response, quiz)).toISOString(),
    serverNow: new Date().toISOString(),
    durationMinutes: quiz.duration_minutes,
  });
});
