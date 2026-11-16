// Minimal Supabase (PostgREST) client using fetch. No npm dependencies needed.
import { HttpError } from './http.js';

function config() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(500, 'Server is not configured: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return { url, key };
}

// db('GET', 'meetings', { query: '?code=eq.abc' })
// db('POST', 'quizzes', { body: {...}, returning: true })
export async function db(method, table, { query = '', body, returning = false } = {}) {
  const { url, key } = config();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
  if (returning) headers.Prefer = 'return=representation';

  const res = await fetch(`${url}/rest/v1/${table}${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();

  if (!res.ok) {
    // Postgres 23505 = unique violation (e.g. duplicate registration number).
    if (text.includes('"23505"')) throw new HttpError(409, 'Already exists');
    throw new Error(`Supabase ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}
