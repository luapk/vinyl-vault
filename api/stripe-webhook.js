// Vercel: disable body parsing so Stripe can verify the raw signature
export const config = { api: { bodyParser: false } };

import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import { tierForPrice } from './lib/pricing.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

function tierForLineItems(lineItems) {
  for (const item of lineItems?.data || []) {
    const tier = tierForPrice(item.price?.id);
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

// ─── Billing detail ──────────────────────────────────────────────────────────
//
// Stripe is the source of truth for money; these writes are a local copy so the
// admin panel can answer "when does this renew, and for how much" without a
// Stripe call per row. Everything here is best effort: a failed copy costs the
// dashboard a field, and must never cost the customer their access, so the
// tier and status write stays the one that has to succeed.

// Stripe moved the period fields from the subscription onto its items. Read
// both, newest shape first, or a renewal date silently stops updating the day
// the account's API version rolls forward.
function periodEnd(sub) {
  const secs = sub?.items?.data?.[0]?.current_period_end || sub?.current_period_end;
  return secs ? new Date(secs * 1000).toISOString() : null;
}

function priceOf(sub) {
  const price = sub?.items?.data?.[0]?.price;
  return {
    amount:   typeof price?.unit_amount === 'number' ? price.unit_amount : null,
    currency: price?.currency || null,
    interval: price?.recurring?.interval || null,
  };
}

async function writeBillingDetail(supabase, sub) {
  const { amount, currency, interval } = priceOf(sub);
  const patch = {
    current_period_end:        periodEnd(sub),
    cancel_at_period_end:      !!sub.cancel_at_period_end,
    subscription_amount_pence: amount,
    subscription_currency:     currency,
    subscription_interval:     interval,
  };
  const { error } = await supabase
    .from('profiles').update(patch).eq('stripe_customer_id', sub.customer);
  // 42703 is an undefined column: supabase/admin-analytics.sql has not been run
  // on this database yet. That is a normal state, not an incident.
  if (error && error.code !== '42703') {
    console.error('[stripe-webhook] billing detail:', error.message);
  }

  // First payment sets the start date, and only the first: a renewal must not
  // move it, or every subscriber looks like they signed up this month.
  if (sub.start_date) {
    await supabase
      .from('profiles')
      .update({ subscription_started_at: new Date(sub.start_date * 1000).toISOString() })
      .eq('stripe_customer_id', sub.customer)
      .is('subscription_started_at', null);
  }
}

// One row per payment, keyed on Stripe's own id so a webhook redelivery
// updates the row it already wrote instead of counting the money twice.
async function recordPayment(supabase, row) {
  if (!row.id || typeof row.amount_pence !== 'number') return;
  let userId = row.user_id || null;
  if (!userId && row.stripe_customer_id) {
    const { data } = await supabase
      .from('profiles').select('id').eq('stripe_customer_id', row.stripe_customer_id).maybeSingle();
    userId = data?.id || null;
  }
  const { error } = await supabase
    .from('payments')
    .upsert({ ...row, user_id: userId }, { onConflict: 'id' });
  if (error && error.code !== '42P01') {
    console.error('[stripe-webhook] payment ledger:', error.message);
  }
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
          await recordPayment(supabase, {
            id: session.id,
            user_id: userId,
            stripe_customer_id: session.customer || null,
            amount_pence: session.amount_total ?? 0,
            currency: session.currency || 'gbp',
            status: 'paid',
            kind: 'one_time',
            tier,
            description: 'Founding lifetime',
            paid_at: new Date((session.created || Date.now() / 1000) * 1000).toISOString(),
          });
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
        await writeBillingDetail(supabase, sub);
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
        // A cancelled subscription has no next renewal. Leaving the old date in
        // place would have the panel counting down to a charge nobody is making.
        await supabase.from('profiles').update({
          current_period_end: null, cancel_at_period_end: false,
          subscription_amount_pence: null, subscription_interval: null,
        }).eq('stripe_customer_id', sub.customer);
        break;
      }

      // ── Payment taken (first bill and every renewal) ──────────────────────
      //
      // This is the only event that reports money actually collected, so it is
      // the one the revenue total is built from. The subscription events above
      // report intent and access; an invoice reports a charge that cleared.
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        const subId = invoice.subscription || invoice.parent?.subscription_details?.subscription || null;
        await recordPayment(supabase, {
          id: invoice.id,
          stripe_customer_id: invoice.customer || null,
          amount_pence: invoice.amount_paid ?? 0,
          currency: invoice.currency || 'gbp',
          status: 'paid',
          kind: 'subscription',
          tier: invoice.lines?.data?.[0]?.price?.id ? tierForPrice(invoice.lines.data[0].price.id) : null,
          description: invoice.lines?.data?.[0]?.description || 'Subscription',
          paid_at: new Date((invoice.status_transitions?.paid_at || invoice.created || Date.now() / 1000) * 1000).toISOString(),
        });
        // The renewal date moves on every successful bill, and the invoice does
        // not carry it, so it is read back off the subscription.
        if (subId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            await writeBillingDetail(supabase, sub);
          } catch (err) {
            console.error('[stripe-webhook] period refresh:', err.message);
          }
        }
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
