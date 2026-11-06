// The background file-import worker.
//
// An import used to run entirely in the tab that started it, which meant a
// locked phone or a closed browser abandoned the rest of the list. Rows now
// live in public.import_jobs; this endpoint drains them. The tab that creates
// a job calls it once to start immediately, and a Vercel cron re-claims
// anything left unfinished (a killed invocation, a job longer than one
// invocation can hold), so an import finishes with nobody watching.
import { createClient } from '@supabase/supabase-js';
import { searchDiscogs } from './lib/discogs.js';
import { requireAuth } from './lib/auth.js';
import { requireTier, userAllows } from './lib/tier.js';
import { recordFromMatch, draftFromRow, patchFromMatch } from './lib/importRecord.js';
import { rowCanIdentify } from '../src/lib/importParse.js';

// Leave headroom under the function's maxDuration so the last flush and the
// unlock always get to run. An invocation that dies mid-row is recoverable
// (the lock expires) but it costs a whole cron interval.
const INVOCATION_BUDGET_MS = 230_000;
const LOCK_SECONDS = 360;

// Discogs allows 60 authenticated requests a minute. The worker spends at most
// RATE_CAP of them, leaving the rest for live scanning, and paces by REQUEST
// rather than by row: a row that matches costs one request, a row that misses
// costs two (targeted search, then the fuzzy fallback), so a list of obscure
// records paced per row runs at nearly double the budget and trips the limiter
// anyway. That was the second version of this bug.
const RATE_CAP = 45;
const RATE_WINDOW_MS = 60_000;
const MS_PER_REQUEST = Math.ceil(RATE_WINDOW_MS / RATE_CAP);
const LOW_BUDGET_GAP_MS = 2500;
const EXHAUSTED_GAP_MS = 15_000;
// Retries for a row that came back rate limited. Short first: the limiter's
// window rolls continuously, so capacity usually returns in seconds.
const LIMIT_BACKOFF_MS = [5_000, 10_000, 20_000, 30_000];
// Write progress back this often. Every row would be a write per second for
// the length of the import; every fifth keeps the progress list honest without
// hammering the table.
const FLUSH_EVERY = 5;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function gapFor(remaining, requests = 1) {
  const spent = Math.max(1, requests) * MS_PER_REQUEST;
  if (remaining == null) return spent;
  if (remaining <= 5) return EXHAUSTED_GAP_MS;
  if (remaining <= 15) return Math.max(spent, LOW_BUDGET_GAP_MS);
  return spent;
}

function admin() {
  return createClient(
    process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

// Vercel sends cron requests with the CRON_SECRET bearer when that variable is
// set, and stamps x-vercel-cron on them; it strips client-supplied x-vercel-*
// headers at the edge. Anything else must be a signed-in user: this endpoint
// spends Discogs quota, so it is never open.
async function authorize(req, res) {
  const secret = process.env.CRON_SECRET;
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (secret && bearer === secret) return { cron: true, via: 'cron-secret' };
  if (req.headers['x-vercel-cron']) return { cron: true, via: 'cron-header' };
  const user = await requireAuth(req, res);
  if (user) {
    if (!(await requireTier('bulkImport', user.id, res))) return null;
    return { cron: false, via: 'user', user };
  }

  // A cron tick that cannot authenticate is the failure that hides itself: the
  // schedule fires, the function answers 401, nothing is written, and the only
  // visible symptom is an import that stops moving hours later. It has to say
  // so. Which credential was missing is the whole diagnosis, so name it.
  console.error('[import-worker] rejected: ' +
    `cronSecretSet=${!!secret} bearerSent=${!!bearer} ` +
    `vercelCronHeader=${!!req.headers['x-vercel-cron']}`);
  return null;
}

// One Discogs lookup for one row, with the rate limit treated as what it is:
// Discogs asking for a moment, never a verdict on the record. A row that is
// still limited after the last backoff hands the job back to the queue rather
// than being written down as unmatched.
async function resolveRow(row) {
  let requests = 0;
  for (let attempt = 0; ; attempt++) {
    const meta = { rateLimited: false, remaining: null, requests: 0 };
    // Same rule the browser applies, for the same reason: an artist with no
    // title cannot identify a release, so it is drafted rather than guessed.
    // These two paths have to produce the same records.
    if (!rowCanIdentify(row)) return { outcome: 'nomatch', remaining: null, requests };

    let matches = [];
    try {
      matches = await searchDiscogs({ artist: row.artist, title: row.title, manual: true, meta });
    } catch {
      // A lookup that failed is not an answer about the record either. The
      // browser drafts after a couple of retries because somebody is watching
      // and wants the run to finish; the worker has no such pressure, so it
      // hands the job back and tries again on the next tick rather than
      // filing a Discogs outage as a collection of unmatched records.
      requests += meta.requests || 1;
      if (attempt >= 2) return { outcome: 'unavailable', remaining: null, requests };
      await sleep(2000);
      continue;
    }
    requests += meta.requests || 1;
    if (!matches.length && meta.rateLimited) {
      if (attempt >= LIMIT_BACKOFF_MS.length) return { outcome: 'ratelimited', remaining: 0, requests };
      await sleep(LIMIT_BACKOFF_MS[attempt]);
      continue;
    }
    const match = matches.find(m => m.coverUrl) || matches[0];
    return match
      ? { outcome: 'match', match, remaining: meta.remaining, requests }
      : { outcome: 'nomatch', remaining: meta.remaining, requests };
  }
}

async function flush(db, job, patch) {
  await db.from('import_jobs').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', job.id);
}

async function processJob(db, job, deadline) {
  const rows = Array.isArray(job.rows) ? [...job.rows] : [];
  const counts = {
    matched: job.matched || 0, drafts: job.drafts || 0,
    added: job.added || 0, skipped: job.skipped || 0,
  };

  // Existing Discogs ids for this user, read once. Record identity is the
  // release id, so this is the same duplicate rule the browser applies.
  const seen = new Set();
  if (job.kind === 'import') {
    const { data } = await db.from('records').select('data').eq('user_id', job.user_id);
    for (const r of data || []) if (r?.data?.discogsId) seen.add(String(r.data.discogsId));
  }

  let i = job.cursor || 0;
  let sinceFlush = 0;
  let handBack = false;

  for (; i < rows.length; i++) {
    if (Date.now() > deadline) { handBack = true; break; }

    // The user can cancel from the app at any point; check before each row's
    // lookup so a cancelled job stops spending quota promptly.
    if (i % FLUSH_EVERY === 0) {
      const { data: fresh } = await db.from('import_jobs').select('status').eq('id', job.id).single();
      if (fresh?.status === 'cancelled') {
        await flush(db, job, { cursor: i, rows, ...counts, locked_until: null });
        return 'cancelled';
      }
    }

    const row = rows[i];
    const r = await resolveRow(row);

    if (r.outcome === 'ratelimited' || r.outcome === 'unavailable') {
      // Nothing about this row is known yet. Put the job back and let the next
      // tick continue: a rate limit must never be written down as a record.
      handBack = true;
      break;
    }

    if (job.kind === 'retry') {
      if (r.outcome === 'match' && row.recordId) {
        // Addressed by the record's own id inside the jsonb, which is what
        // the client knows a record by; the table's row id never reaches it.
        const { data: existing } = await db.from('records')
          .select('id, data').eq('user_id', job.user_id).eq('data->>id', row.recordId).maybeSingle();
        if (existing?.data) {
          const merged = { ...existing.data, ...patchFromMatch(r.match, existing.data) };
          await db.from('records').update({ data: merged }).eq('id', existing.id);
          counts.matched++;
          rows[i] = { ...row, status: 'added' };
        } else {
          rows[i] = { ...row, status: 'draft' };
        }
      } else {
        rows[i] = { ...row, status: 'draft' };
      }
    } else if (r.outcome === 'match') {
      const id = String(r.match.id);
      if (seen.has(id)) {
        counts.skipped++;
        rows[i] = { ...row, status: 'skipped' };
      } else {
        seen.add(id);
        const record = recordFromMatch(r.match, row);
        const { error } = await db.from('records').insert({ user_id: job.user_id, data: record });
        if (error) { handBack = true; break; }
        counts.matched++;
        counts.added++;
        rows[i] = { ...row, status: 'added' };
      }
    } else {
      const record = draftFromRow(row);
      const { error } = await db.from('records').insert({ user_id: job.user_id, data: record });
      if (error) { handBack = true; break; }
      counts.drafts++;
      counts.added++;
      rows[i] = { ...row, status: 'draft' };
    }

    if (++sinceFlush >= FLUSH_EVERY) {
      sinceFlush = 0;
      await flush(db, job, { cursor: i + 1, rows, ...counts });
    }
    if (i < rows.length - 1) await sleep(gapFor(r.remaining, r.requests));
  }

  if (handBack) {
    // Unlock so the cron picks it straight back up. cursor points at the row
    // that has not been dealt with, so nothing is repeated and nothing is lost.
    await flush(db, job, { cursor: i, rows, ...counts, status: 'queued', locked_until: null });
    return 'paused';
  }
  await flush(db, job, { cursor: rows.length, rows, ...counts, status: 'done', locked_until: null });
  return 'done';
}

export default async function handler(req, res) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const auth = await authorize(req, res);
  if (!auth) return;

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.DISCOGS_PERSONAL_ACCESS_TOKEN) {
    // Without either of these every lookup would fail and every row would be
    // written down as unmatched. Leave the jobs alone instead.
    return res.status(503).json({ error: 'Import worker not configured' });
  }

  const db = admin();
  const deadline = Date.now() + INVOCATION_BUDGET_MS;
  const handled = [];
  // Proof of life for the schedule itself, cheap enough to keep: without it a
  // cron that never fires and a cron that fires over an empty queue look
  // identical from the logs.
  console.log(`[import-worker] tick via=${auth.via}`);

  try {
    while (Date.now() < deadline) {
      const { data: job, error } = await db.rpc('claim_import_job', { p_lock_seconds: LOCK_SECONDS });
      if (error) {
        // No table yet (the migration has not been run): say so plainly rather
        // than failing loudly every cron tick.
        return res.status(503).json({ error: 'Import jobs table not available', detail: error.message });
      }
      // A claim that found nothing comes back as null, or as an all-null row.
      if (!job || !job.id) break;

      // Gating only the kick would leave the queue itself open: a job row is
      // inserted by the client straight into import_jobs under RLS, so anyone
      // who can write their own row could skip the endpoint entirely and let
      // the cron spend the quota for them a couple of minutes later. The
      // owner is judged here, where the spending actually happens.
      const allowed = await userAllows('bulkImport', job.user_id);
      if (allowed === null) {
        // Profile unreadable. Do not fail the job over a database wobble:
        // release it and let the next tick judge it again. Failing CLOSED here
        // means leaving it queued, not destroying somebody's import.
        await db.from('import_jobs').update({ locked_until: null }).eq('id', job.id);
        console.warn(`[import-worker] job=${job.id} owner tier unreadable, released`);
        break;
      }
      if (!allowed) {
        await db.from('import_jobs').update({
          status: 'failed', locked_until: null,
          error: 'bulkImport_requires_upgrade',
        }).eq('id', job.id);
        console.log(`[import-worker] job=${job.id} blocked: owner cannot bulkImport`);
        handled.push({ id: job.id, outcome: 'blocked' });
        continue;
      }

      const before = job.cursor || 0;
      const outcome = await processJob(db, job, deadline);
      handled.push({ id: job.id, outcome });
      // Every claim leaves a trace. A worker that only logs on exceptions is a
      // worker nobody can tell apart from one that is never being called, which
      // is exactly the hole this investigation fell into.
      console.log(`[import-worker] via=${auth.via} job=${job.id} ` +
        `rows=${before}->${job.total ?? '?'} outcome=${outcome}`);
      if (outcome === 'paused') break;
    }
  } catch (err) {
    console.error('[import-worker]', err.message);
    return res.status(500).json({ error: err.message, handled });
  }

  return res.status(200).json({ ok: true, handled });
}
