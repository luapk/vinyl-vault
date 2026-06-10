import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const userId = authUser.id;

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', userId)
    .single();

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No Stripe customer found for this user' });
  }

  const appUrl = process.env.VITE_APP_URL || 'https://vinyl-vault-teal.vercel.app';

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: profile.stripe_customer_id,
      return_url: appUrl,
    });
    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[stripe-portal]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
