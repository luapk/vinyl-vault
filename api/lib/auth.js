import { createClient } from '@supabase/supabase-js';

export async function requireAuth(req, res) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  let user, error;
  try {
    // 5s ceiling: a hung Supabase connection must not block the entire scan pipeline.
    const result = await Promise.race([
      supabase.auth.getUser(token),
      new Promise((_, reject) => setTimeout(() => reject(new Error('auth_timeout')), 5000)),
    ]);
    user = result.data?.user;
    error = result.error;
  } catch {
    res.status(503).json({ error: 'Authentication service unavailable' });
    return null;
  }
  if (error || !user) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return user;
}
