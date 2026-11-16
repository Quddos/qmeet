// Public config for the browser: Supabase URL + anon key (safe to expose) and optional TURN servers.
import { handle } from '../lib/http.js';

function iceServers() {
  try {
    const parsed = JSON.parse(process.env.ICE_SERVERS || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default handle(['GET'], async (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    iceServers: iceServers(),
  });
});
