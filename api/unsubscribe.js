import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// One-click unsubscribe for campaign email.
//
// The link in each email carries the recipient address plus an HMAC of it, so
// nobody can unsubscribe someone else by editing the URL, and no database
// lookup is needed to validate the link. Marking the opt-out sets
// profiles.marketing_opt_out, which the send script filters on.
//
// GET  renders a confirmation page (a human clicked the footer link).
// POST returns 200 with no body (RFC 8058 one-click, used by Gmail and
//      Apple Mail when they show their own Unsubscribe button).
//
// Env: UNSUBSCRIBE_SECRET, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_URL

const ACID = '#cafe04';
const INK = '#08080c';

export function signEmail(email, secret) {
  return crypto.createHmac('sha256', secret)
    .update(String(email).trim().toLowerCase())
    .digest('base64url')
    .slice(0, 32);
}

function page(title, body) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title></head>
<body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:${ACID};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${INK};padding:24px;">
<div style="max-width:420px;text-align:center;">
<div style="font-family:Georgia,'Times New Roman',serif;font-size:34px;line-height:38px;margin-bottom:10px;">${title}</div>
<p style="font-size:16px;line-height:25px;margin:0 0 22px 0;">${body}</p>
<a href="https://vinyl-vault-teal.vercel.app/" style="display:inline-block;padding:14px 28px;border-radius:100px;background:${INK};color:${ACID};text-decoration:none;font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">Back to Vinyl Vault</a>
</div></body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = process.env.UNSUBSCRIBE_SECRET;
  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !supabaseUrl || !serviceKey) {
    return res.status(503).json({ error: 'Unsubscribe not configured on server' });
  }

  // Query params work for both verbs: Gmail POSTs to the same URL.
  const url = new URL(req.url, `https://${req.headers.host}`);
  const email = (url.searchParams.get('e') || '').trim().toLowerCase();
  const token = url.searchParams.get('t') || '';

  const expected = signEmail(email, secret);
  const ok = email && token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected));

  if (!ok) {
    if (req.method === 'POST') return res.status(400).json({ error: 'Invalid link' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(400).send(page('That link is not valid', 'Copy the whole link from the email, or reply to it and we will take you off the list by hand.'));
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { error } = await admin
    .from('profiles')
    .update({ marketing_opt_out: true })
    .eq('email', email);

  if (error) {
    console.error('[unsubscribe]', error.message);
    if (req.method === 'POST') return res.status(500).json({ error: 'Could not unsubscribe' });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(page('Something went wrong', 'We could not update your preferences. Reply to the email and we will do it by hand.'));
  }

  // One-click clients expect a bare 200 and show their own confirmation.
  if (req.method === 'POST') return res.status(200).end();

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(page(
    'Done, you are off the list',
    `We will not send <strong>${email}</strong> any more campaign email. Account email, like password resets, still works as normal.`
  ));
}
