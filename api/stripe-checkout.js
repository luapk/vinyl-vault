import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from './lib/auth.js';
import { tierForPrice, pricingConfigured } from './lib/pricing.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const { priceId, userEmail } = req.body || {};
  if (!priceId) return res.status(400).json({ error: 'priceId required' });
  const userId = authUser.id;

  // No prices configured at all is a deployment fault, not the caller's.
  if (!pricingConfigured()) {
    console.error('[stripe-checkout] no STRIPE_PRICE_* or VITE_STRIPE_PRICE_* set');
    return res.status(500).json({ error: 'Pricing is not configured. Please try again shortly.' });
  }
  const tier = tierForPrice(priceId);
  if (!tier) return res.status(400).json({ error: 'Unknown price' });

  const appUrl = process.env.VITE_APP_URL || 'https://vinyl-vault-teal.vercel.app';

  const supabase = createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // Reuse existing Stripe customer if we already have one for this user
    const { data: profile } = await supabase
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', userId)
      .single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: { supabase_user_id: userId },
      });
      customerId = customer.id;
      await supabase.from('profiles').update({ stripe_customer_id: customerId }).eq('id', userId);
    }

    // Determine mode: one-time for founding/lifetime, subscription otherwise
    const price = await stripe.prices.retrieve(priceId);
    const mode = price.type === 'one_time' ? 'payment' : 'subscription';

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/?checkout=success&tier=${tier}`,
      cancel_url:  `${appUrl}/?checkout=cancelled`,
      ...(mode === 'subscription' && {
        subscription_data: { metadata: { supabase_user_id: userId, tier } },
      }),
      ...(mode === 'payment' && {
        payment_intent_data: { metadata: { supabase_user_id: userId, tier } },
      }),
      metadata: { supabase_user_id: userId, tier },
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('[stripe-checkout]', err.message);
    return res.status(500).json({ error: err.message });
  }
}
