// Vercel: disable body parsing so Stripe can verify the raw signature
export const config = { api: { bodyParser: false } };

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Tier granted for a given price ID
const PRICE_TO_TIER = {
  [process.env.STRIPE_PRICE_SELECTOR_YEAR]:     'selector',
  [process.env.STRIPE_PRICE_SELECTOR_FOUNDING]: 'selector',
  [process.env.STRIPE_PRICE_RESIDENT_YEAR]:     'resident',
};

function tierForLineItems(lineItems) {
  for (const item of lineItems?.data || []) {
    const tier = PRICE_TO_TIER[item.price?.id];
    if (tier) return tier;
  }
  return null;
}

function supabaseAdmin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

async function grantTier(supabase, userId, tier) {
  await supabase
    .from('profiles')
    .update({ subscription_tier: tier, subscription_status: 'active' })
    .eq('id', userId);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const rawBody = await new Promise((resolve, reject) => {
      const chunks = [];
      req.on('data', chunk => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', reject);
    });
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[stripe-webhook] signature error:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  const supabase = supabaseAdmin();

  try {
    switch (event.type) {

      // ── Checkout completed (covers both subscription + one-time/founding) ──
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.metadata?.supabase_user_id;
        const tier   = session.metadata?.tier;
        if (!userId || !tier) break;

        // Store customer ID if not already saved
        if (session.customer) {
          await supabase
            .from('profiles')
            .update({ stripe_customer_id: session.customer })
            .eq('id', userId)
            .is('stripe_customer_id', null);
        }

        if (session.mode === 'payment') {
          // One-time founding purchase -- grant permanently, no subscription ID
          await grantTier(supabase, userId, tier);
        }
        // Subscription mode: wait for invoice.payment_succeeded / subscription.updated
        break;
      }

      // ── Subscription activated / renewed / updated ─────────────────────────
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub  = event.data.object;
        const tier = sub.metadata?.tier || tierForLineItems(sub.items);
        if (!tier) break;

        await supabase.rpc('upsert_subscription', {
          p_stripe_customer_id:     sub.customer,
          p_stripe_subscription_id: sub.id,
          p_tier:                   tier,
          p_status:                 sub.status === 'active' || sub.status === 'trialing' ? sub.status : 'past_due',
        });
        break;
      }

      // ── Subscription cancelled / expired ──────────────────────────────────
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabase.rpc('upsert_subscription', {
          p_stripe_customer_id:     sub.customer,
          p_stripe_subscription_id: sub.id,
          p_tier:                   'digger',
          p_status:                 'cancelled',
        });
        break;
      }

      // ── Payment failed -- mark past_due but keep access briefly ───────────
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        if (!invoice.subscription) break;
        const sub = await stripe.subscriptions.retrieve(invoice.subscription);
        await supabase.rpc('upsert_subscription', {
          p_stripe_customer_id:     invoice.customer,
          p_stripe_subscription_id: invoice.subscription,
          p_tier:                   sub.metadata?.tier || 'digger',
          p_status:                 'past_due',
        });
        break;
      }
    }
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err.message);
    // Still return 200 so Stripe doesn't retry indefinitely on logic errors
  }

  return res.status(200).json({ received: true });
}
