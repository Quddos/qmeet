// Public quiz data for students. Answer keys are never sent until the student has submitted.
import { handle } from '../../lib/http.js';
import { getQuiz } from '../../lib/util.js';

export default handle(['GET'], async (req, res) => {
  const quiz = await getQuiz(String(req.query.id || ''));
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    id: quiz.id,
    title: quiz.title,
    status: quiz.status,
    durationMinutes: quiz.duration_minutes,
    showScore: quiz.show_score,
    closesAt: quiz.closes_at,
    questions: quiz.status === 'draft' ? [] : quiz.questions.map(({ q, options }) => ({ q, options })),
  });
});
