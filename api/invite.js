import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Supabase not configured on server' });
  }

  // Verify the caller is authenticated and has admin role.
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const callerToken = authHeader.slice(7);

  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  });

  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' });

  const { data: profile } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'email is required' });

  // Use the service-role client to send the invite.
  const adminClient = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await adminClient.auth.admin.inviteUserByEmail(email);
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({ ok: true, userId: data?.user?.id });
}
