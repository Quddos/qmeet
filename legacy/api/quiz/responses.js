// Host-only: live list of responses for one quiz (used for the live table and Excel/CSV download).
import { db } from '../../lib/db.js';
import { handle } from '../../lib/http.js';
import { requireQuizHost } from '../../lib/util.js';

export default handle(['GET'], async (req, res) => {
  const { quiz } = await requireQuizHost(req, String(req.query.id || ''));
  const rows = await db('GET', 'quiz_responses', {
    query: `?quiz_id=eq.${quiz.id}&select=reg_number,name,answers,score,total,started_at,submitted_at&order=started_at.asc`,
  });
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    quiz: {
      id: quiz.id,
      title: quiz.title,
      status: quiz.status,
      durationMinutes: quiz.duration_minutes,
      showScore: quiz.show_score,
      questions: quiz.questions,
    },
    responses: rows,
  });
});
