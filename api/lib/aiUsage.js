// What the models actually cost, recorded per call.
//
// The admin panel's spend figure has to be an accounting of calls that
// happened, not a guess from record counts: a scan that fell back to text
// identification costs a different amount from one that did not, and a smart
// crate run over 600 records costs more than the next fifty scans put together.
// So every response the Anthropic API returns is booked here with the token
// counts it reported, and the cost is worked out and stored alongside them.
//
// Two deliberate choices:
//
//   The cost is stored, not derived at read time. Rates change, and what a
//   call cost on the day is not recoverable from a later rate card.
//
//   An unknown model is priced at the most expensive rate we know rather than
//   zero. The same rule the landed cost follows: an under-estimate is the
//   failure that costs somebody money, and a spend dashboard that quietly
//   ignores a model nobody added to the table is worse than one that flags it.

import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@supabase/supabase-js';

// USD per million tokens. Source: Anthropic's published pricing.
export const MODEL_RATES = {
  'claude-sonnet-4-6':          { input: 3.00,  output: 15.00, cacheWrite: 3.75,  cacheRead: 0.30 },
  'claude-haiku-4-5-20251001':  { input: 1.00,  output: 5.00,  cacheWrite: 1.25,  cacheRead: 0.10 },
  'claude-opus-4-6':            { input: 15.00, output: 75.00, cacheWrite: 18.75, cacheRead: 1.50 },
};

// The dearest rate in the table, used for anything not in it.
const FALLBACK_RATE = Object.values(MODEL_RATES)
  .reduce((a, b) => (b.output > a.output ? b : a));

export function rateFor(model) {
  // Dated model ids ("claude-sonnet-4-6-20260101") price as their family.
  if (MODEL_RATES[model]) return MODEL_RATES[model];
  const family = Object.keys(MODEL_RATES).find(k => model && model.startsWith(k.replace(/-\d{8}$/, '')));
  return (family && MODEL_RATES[family]) || FALLBACK_RATE;
}

/**
 * USD cost of one call, from the usage block the API returned.
 * Rounded to six decimals, which is the precision the ledger column holds.
 */
export function costUsd(model, usage = {}) {
  const r = rateFor(model);
  const per = (tokens, rate) => ((Number(tokens) || 0) / 1_000_000) * rate;
  const total =
    per(usage.input_tokens, r.input) +
    per(usage.output_tokens, r.output) +
    per(usage.cache_creation_input_tokens, r.cacheWrite) +
    per(usage.cache_read_input_tokens, r.cacheRead);
  return Math.round(total * 1e6) / 1e6;
}

// ---------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------
// The call sites are several layers below the handler (scan.js reaches Claude
// through vision.js, which does not know who is scanning), so the request
// context is carried in an AsyncLocalStorage rather than threaded through six
// signatures. Rows collect on the context and are written once, awaited, when
// the handler's work finishes: an unawaited insert on a serverless function is
// a row that arrives only if the instance happens to outlive the response.

const store = new AsyncLocalStorage();

let cachedAdmin = null;
function admin() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  if (!cachedAdmin) {
    cachedAdmin = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return cachedAdmin;
}

/**
 * Book one Anthropic response. Safe to call anywhere: outside a context it is
 * a no-op, because a call nobody can attribute is not worth a write.
 */
export function recordAiUsage(model, usage) {
  const ctx = store.getStore();
  if (!ctx || !usage) return;
  ctx.rows.push({
    user_id: ctx.userId || null,
    endpoint: ctx.endpoint,
    model: model || 'unknown',
    input_tokens: Number(usage.input_tokens) || 0,
    output_tokens: Number(usage.output_tokens) || 0,
    cache_read_tokens: Number(usage.cache_read_input_tokens) || 0,
    cache_write_tokens: Number(usage.cache_creation_input_tokens) || 0,
    cost_usd: costUsd(model, usage),
  });
}

/**
 * Run a handler with a usage context, then flush whatever it booked.
 *
 * The flush never throws and never blocks the response for long: the ledger is
 * for a dashboard, and losing a row from it must never cost a user their scan.
 */
export async function withAiUsage(meta, fn) {
  const ctx = { userId: meta?.userId || null, endpoint: meta?.endpoint || 'unknown', rows: [] };
  try {
    return await store.run(ctx, fn);
  } finally {
    if (ctx.rows.length) await flush(ctx.rows);
  }
}

/**
 * Wrap a Vercel handler so every model call inside it is booked against one
 * endpoint. The user is not known until requireAuth has run, so it is attached
 * later with setAiUser rather than being a parameter here.
 */
export function aiUsageHandler(endpoint, handler) {
  return (req, res) => withAiUsage({ endpoint }, () => handler(req, res));
}

/** Attribute everything booked on this request to a user. */
export function setAiUser(userId) {
  const ctx = store.getStore();
  if (ctx) ctx.userId = userId || null;
}

async function flush(rows) {
  const db = admin();
  if (!db) return;
  try {
    const write = db.from('ai_usage').insert(rows);
    const timeout = new Promise(resolve => setTimeout(() => resolve({ timedOut: true }), 2500));
    const out = await Promise.race([write, timeout]);
    // A missing table is the migration not being run, which is a normal state
    // for a fresh database and not worth a line in the logs on every scan.
    if (out?.error && out.error.code !== '42P01') {
      console.log(`[ai-usage] write failed: ${out.error.message}`);
    }
  } catch (err) {
    console.log(`[ai-usage] write threw: ${err?.message || err}`);
  }
}
