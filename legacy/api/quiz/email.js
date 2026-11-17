// Host-only: email the results sheet to the host's address for this quiz.
import { handle, HttpError } from '../../lib/http.js';
import { sendResultsEmail } from '../../lib/email.js';
import { requireQuizHost } from '../../lib/util.js';

export default handle(['POST'], async (req, res) => {
  const { quiz } = await requireQuizHost(req, String(req.body?.id || ''));
  if (!quiz.host_email) throw new HttpError(400, 'Set the host email when you create the quiz');
  // Results only ever go to the address saved on the quiz, never to a typed-in address.
  const result = await sendResultsEmail({ quiz, to: quiz.host_email });
  res.status(200).json({ sent: true, ...result });
});
