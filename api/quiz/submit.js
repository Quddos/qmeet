// Student submits answers. Grading happens on the server so the answer key never reaches the browser.
import { db } from '../../lib/db.js';
import { handle, HttpError } from '../../lib/http.js';
import { cleanName, cleanReg, getQuiz, getResponse, quizDeadline } from '../../lib/util.js';

const GRACE_MS = 30000; // allows for network delay on auto-submit at the deadline

export default handle(['POST'], async (req, res) => {
  const b = req.body || {};
  const quiz = await getQuiz(String(b.id || ''));
  const reg = cleanReg(b.regNumber);
  const name = cleanName(b.name);

  const response = await getResponse(quiz.id, reg);
  if (!response) throw new HttpError(400, 'Start the quiz before submitting');
  if (response.submitted_at) throw new HttpError(409, 'You have already submitted this quiz');
  if (quiz.status !== 'open') throw new HttpError(409, 'This quiz is closed');
  if (Date.now() > quizDeadline(response, quiz) + GRACE_MS) {
    throw new HttpError(409, 'Time is up. Your answers could not be accepted.');
  }

  const questions = quiz.questions;
  const given = Array.isArray(b.answers) ? b.answers : [];
  let score = 0;
  const answers = questions.map((q, i) => {
    const a = Number(given[i]);
    const valid = Number.isInteger(a) && a >= 0 && a < q.options.length ? a : -1;
    if (valid === q.answer) score++;
    return valid;
  });

  await db('PATCH', 'quiz_responses', {
    query: `?id=eq.${response.id}`,
    body: {
      name: name || response.name,
      answers,
      score,
      total: questions.length,
      submitted_at: new Date().toISOString(),
    },
  });

  res.status(200).json({
    score,
    total: questions.length,
    showScore: quiz.show_score,
    correctAnswers: quiz.show_score ? questions.map((q) => q.answer) : undefined,
  });
});
