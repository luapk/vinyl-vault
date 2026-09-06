import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import {
  UserCircle, EnvelopeSimple, ArrowLeft, Crown, ArrowClockwise, Stack,
  CurrencyGbp, Sparkle, SlidersHorizontal, Lock, Globe, CalendarBlank, Warning,
} from '@phosphor-icons/react';
import { FEATURE_TIER, FEATURE_META, TIER_RANK } from '../lib/pricing.js';

// The admin panel: who is here, what they paid, when they renew, and what the
// models are costing to serve them.
//
// Three screens rather than one long scroll, because they answer different
// questions and are read at different times. Money is the one that gets
// checked; People is the one that gets acted on; Features is the one that
// changes what the product is.
//
// Everything on Money comes from public.payments and public.ai_usage, both
// append-only ledgers written by /api/*. Neither can be read from the browser
// (RLS on, no policy), so the numbers arrive through admin_metrics(), a definer
// function that checks is_admin() before answering. Until
// supabase/admin-analytics.sql has been run there is nothing to read, and the
// screen says exactly that instead of drawing a zero that looks like a fact.

const ACID   = 'rgba(201,255,0,0.9)';
const VIOLET = 'rgba(172,144,226,0.95)';

const TIER_COLORS = {
  digger:   'rgba(255,255,255,0.35)',
  selector: ACID,
  resident: VIOLET,
};

const CARD = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' };
const INPUT = { background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' };

// ---- formatting -------------------------------------------------------------
// Money is held in minor units and integers all the way through. It is
// converted once, here, for display.
const money = (pence, currency = 'gbp') => {
  const n = (Number(pence) || 0) / 100;
  try {
    return n.toLocaleString('en-GB', { style: 'currency', currency: (currency || 'gbp').toUpperCase(), maximumFractionDigits: n >= 100 ? 0 : 2 });
  } catch {
    return `£${n.toFixed(2)}`;
  }
};

const usd = (v) => {
  const n = Number(v) || 0;
  if (n === 0) return '$0.00';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const shortDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' }) : null);

const daysUntil = (d) => (d ? Math.round((new Date(d) - Date.now()) / 86400000) : null);

// ---- small pieces -----------------------------------------------------------

function Metric({ label, value, sub, accent = 'rgba(255,255,255,0.92)', wide = false }) {
  return (
    <div className={`rounded-2xl px-4 py-3.5 ${wide ? 'col-span-2' : ''}`} style={CARD}>
      <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1.5">{label}</p>
      <p className="text-2xl font-bold leading-none" style={{ color: accent, fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      {sub && <p className="text-[11px] text-white/35 mt-1.5 leading-snug">{sub}</p>}
    </div>
  );
}

function Empty({ children }) {
  return (
    <p className="text-[11px] text-white/30 leading-relaxed px-1 py-3">{children}</p>
  );
}

// A share bar, direct-labelled. One accent against one neutral: at this size a
// third grey stops being separable, which is the same rule the Trace cost
// breakdown follows.
function ShareRow({ label, value, share, color }) {
  return (
    <div className="mb-2.5 last:mb-0">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <span className="text-[12px] text-white/70 truncate">{label}</span>
        <span className="text-[12px] font-mono flex-shrink-0" style={{ color, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, Math.min(100, share * 100))}%`, background: color }} />
      </div>
    </div>
  );
}

// Thirty days of model spend. A shape, not a chart: it exists to show whether
// the line is flat or climbing, and the figures above it carry the values.
function DailySpend({ daily }) {
  const days = Array.isArray(daily) ? daily : [];
  if (!days.length) return null;
  const peak = Math.max(...days.map(d => Number(d.costUsd) || 0), 0.000001);
  return (
    <div className="mt-4">
      <div className="flex items-end gap-[3px] h-14">
        {days.map((d, i) => (
          <div key={i} className="flex-1 rounded-t"
            title={`${d.day}: ${usd(d.costUsd)}`}
            style={{
              height: `${Math.max(3, ((Number(d.costUsd) || 0) / peak) * 100)}%`,
              background: ACID, opacity: 0.55,
            }} />
        ))}
      </div>
      <div className="flex justify-between mt-1.5">
        <span className="text-[10px] text-white/25">{shortDate(days[0]?.day)}</span>
        <span className="text-[10px] text-white/25">peak {usd(peak)}</span>
      </div>
    </div>
  );
}

// ---- the panel --------------------------------------------------------------

export default function AdminPanel({ onBack, onFeatureTiersChanged }) {
  const [tab, setTab]           = useState('money');
  const [users, setUsers]       = useState([]);
  const [metrics, setMetrics]   = useState(null);
  const [overrides, setOverrides] = useState({});
  const [migrationMissing, setMigrationMissing] = useState(false);
  const [loading, setLoading]   = useState(true);
  const [message, setMessage]   = useState(null);
  const [savingId, setSavingId] = useState(null);
  const [savingFeature, setSavingFeature] = useState(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);

  const [restoreUserId, setRestoreUserId] = useState('');
  const [restoreText, setRestoreText] = useState('');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResults, setRestoreResults] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Through definer functions, not the tables: email is revoked from the
      // authenticated role (supabase/profile-privacy.sql) and an admin is just
      // another authenticated user, while the two ledgers carry no read policy
      // at all. Each function checks is_admin() before it answers.
      const [rpc, metricsRpc, features] = await Promise.all([
        supabase.rpc('admin_list_users'),
        supabase.rpc('admin_metrics'),
        supabase.from('feature_tiers').select('feature, tier, updated_at'),
      ]);

      let profiles = Array.isArray(rpc.data) ? rpc.data : null;
      if (!profiles) {
        // The table read stays as the fallback for a database where the
        // privacy migration has not been run. The client deploys from main the
        // moment it is pushed and the SQL is run by hand, so a screen must not
        // break in the window between the two.
        const direct = await supabase
          .from('profiles')
          .select('id, email, role, created_at, display_name, username, is_public, subscription_tier, subscription_status')
          .order('created_at', { ascending: true });
        if (direct.error) throw rpc.error || direct.error;
        profiles = direct.data || [];
      }

      // record_count comes back from the extended function. Without it, count
      // the rows the old way rather than showing every collection as empty.
      if (profiles.length && profiles[0].record_count === undefined) {
        const { data: counts } = await supabase.from('records').select('user_id');
        const countMap = {};
        (counts || []).forEach(r => { countMap[r.user_id] = (countMap[r.user_id] || 0) + 1; });
        profiles = profiles.map(p => ({ ...p, record_count: countMap[p.id] || 0 }));
      }

      setUsers(profiles);
      setMetrics(metricsRpc.data || null);
      setMigrationMissing(!metricsRpc.data);
      const map = {};
      for (const row of features.data || []) map[row.feature] = row.tier;
      setOverrides(map);
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function sendInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      setMessage({ type: 'success', text: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail('');
      load();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setInviting(false);
    }
  }

  // Admins can update any profile row (profiles_admin_update RLS policy).
  // Setting a tier also clears the scan block: status -> active and the
  // current-period scan count -> 0, so the change takes effect immediately.
  async function changeTier(userId, newTier, label) {
    setSavingId(userId);
    setMessage(null);
    const prev = users;
    setUsers(us => us.map(u => u.id === userId ? { ...u, subscription_tier: newTier, subscription_status: 'active' } : u));
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ subscription_tier: newTier, subscription_status: 'active', scans_this_period: 0 })
        .eq('id', userId);
      if (error) throw error;
      setMessage({ type: 'success', text: `${label} set to ${newTier[0].toUpperCase() + newTier.slice(1)}` });
    } catch (err) {
      setUsers(prev);
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSavingId(null);
    }
  }

  // Moving a gate. 'free' means no gate at all, which is the one value the code
  // map cannot express; clearing the row puts the shipped default back.
  async function setFeatureTier(feature, tier) {
    setSavingFeature(feature);
    setMessage(null);
    const prev = overrides;
    setOverrides(o => {
      const next = { ...o };
      if (tier === null) delete next[feature]; else next[feature] = tier;
      return next;
    });
    try {
      const { error } = tier === null
        ? await supabase.from('feature_tiers').delete().eq('feature', feature)
        : await supabase.rpc('admin_set_feature_tier', { p_feature: feature, p_tier: tier });
      if (error) throw error;
      setMessage({
        type: 'success',
        text: tier === null
          ? `${FEATURE_META[feature]?.label || feature} back to the shipped default`
          : `${FEATURE_META[feature]?.label || feature} now needs ${tier === 'free' ? 'no subscription' : tier}`,
      });
      // The gates in the running app read the same map, so tell it to reload
      // rather than waiting for a refresh to pick the change up.
      onFeatureTiersChanged?.();
    } catch (err) {
      setOverrides(prev);
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSavingFeature(null);
    }
  }

  // Bulk restore: each line is "Artist - Title". The server resolves every line
  // against Discogs (vinyl only) and inserts the matches into the chosen user's
  // collection. dryRun previews the matches without writing.
  async function runRestore(dryRun) {
    const lines = restoreText.split('\n').map(l => l.trim()).filter(Boolean);
    if (!restoreUserId || lines.length === 0) return;
    setRestoreBusy(true);
    setRestoreResults(null);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch('/api/admin-add-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ userId: restoreUserId, lines, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `API ${res.status}`);
      setRestoreResults(data);
      if (!dryRun) {
        setMessage({ type: 'success', text: `Added ${data.added} record${data.added === 1 ? '' : 's'}` });
        load();
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setRestoreBusy(false);
    }
  }

  const rev = metrics?.revenue || {};
  const ai  = metrics?.ai || {};
  const pop = metrics?.users || {};
  const currency = rev.currency || 'gbp';
  const paying = (pop.selector || 0) + (pop.resident || 0);

  const TABS = [
    { id: 'money',    label: 'Money',    icon: CurrencyGbp },
    { id: 'people',   label: 'People',   icon: UserCircle },
    { id: 'features', label: 'Features', icon: SlidersHorizontal },
  ];

  return (
    <div className="min-h-screen px-4 py-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={onBack}
          className="p-2 rounded-xl text-white/50 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Crown size={20} className="text-amber-400" weight="duotone" />
            Admin
          </h1>
          <p className="text-xs text-white/40 truncate">
            {pop.total ? `${pop.total} accounts · ${paying} paid · ${(pop.records || 0).toLocaleString()} records` : 'Manage users, money and gates'}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="p-2 rounded-xl transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: loading ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)' }}
          title="Refresh">
          <ArrowClockwise size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1.5 mb-5">
        {TABS.map(t => {
          const on = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-[12px] font-semibold transition-all"
              style={{
                background: on ? 'rgba(201,255,0,0.14)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${on ? 'rgba(201,255,0,0.35)' : 'rgba(255,255,255,0.08)'}`,
                color: on ? ACID : 'rgba(255,255,255,0.45)',
              }}>
              <t.icon size={14} weight={on ? 'fill' : 'regular'} />
              {t.label}
            </button>
          );
        })}
      </div>

      {message && (
        <p className="text-xs mb-4 px-3 py-2 rounded-lg"
          style={{
            background: message.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: message.type === 'success' ? '#86efac' : '#fca5a5',
            border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
          }}>
          {message.text}
        </p>
      )}

      {migrationMissing && !loading && (
        <div className="rounded-2xl p-4 mb-5 flex gap-3"
          style={{ background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)' }}>
          <Warning size={16} className="text-amber-400 flex-shrink-0 mt-0.5" weight="duotone" />
          <p className="text-[11px] text-amber-200/80 leading-relaxed">
            The money and spend ledgers are not on this database yet. Run
            <span className="font-mono text-amber-200"> supabase/admin-analytics.sql </span>
            in the Supabase SQL editor. Until then this screen shows accounts and tiers only, and
            nothing is being recorded.
          </p>
        </div>
      )}

      {/* ─── MONEY ─────────────────────────────────────────────────────────── */}
      {tab === 'money' && (
        <>
          <div className="grid grid-cols-2 gap-2.5 mb-5">
            <Metric label="Taken, all time" value={money(rev.totalPence, currency)} accent={ACID}
              sub={rev.payments ? `${rev.payments} payment${rev.payments === 1 ? '' : 's'} from ${rev.payers} ${rev.payers === 1 ? 'person' : 'people'}` : 'No payments recorded'} />
            <Metric label="Last 30 days" value={money(rev.pence30d, currency)}
              sub={`${money(rev.pence365d, currency)} in the last year`} />
            <Metric label="Committed / year" value={money(rev.committedYearPence, currency)} accent={VIOLET}
              sub="What live subscriptions are set to bill over twelve months. Not money taken." />
            <Metric label="Paid accounts" value={paying}
              sub={`${pop.selector || 0} Selector · ${pop.resident || 0} Resident${pop.lapsed ? ` · ${pop.lapsed} lapsed` : ''}`} />
          </div>

          {!rev.totalPence && !loading && (
            <div className="rounded-2xl p-5 mb-5" style={CARD}>
              <h2 className="text-sm font-semibold text-white/70 mb-2 flex items-center gap-2">
                <Lock size={15} className="text-white/40" /> Nothing has been charged yet
              </h2>
              <p className="text-[11px] text-white/40 leading-relaxed">
                The ledger fills from Stripe&rsquo;s <span className="font-mono text-white/60">invoice.payment_succeeded</span> and
                one-time checkout events, so it stays empty until live products, prices and the webhook are
                configured in Stripe. The plumbing is in place: the first real payment appears here without any
                further work.
              </p>
            </div>
          )}

          {/* Renewals */}
          <div className="rounded-2xl p-5 mb-5" style={CARD}>
            <h2 className="text-sm font-semibold text-white/70 mb-3 flex items-center gap-2">
              <CalendarBlank size={16} className="text-cyan-400" />
              Renewals, next 60 days
            </h2>
            {(metrics?.renewals || []).length === 0 ? (
              <Empty>No renewal dates on file. They arrive with the first subscription webhook.</Empty>
            ) : (
              <ul className="space-y-2">
                {metrics.renewals.map(r => {
                  const days = daysUntil(r.due);
                  return (
                    <li key={r.id} className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[13px] text-white/85 truncate">{r.name}</p>
                        <p className="text-[11px] text-white/35">
                          {shortDate(r.due)} · {days <= 0 ? 'due now' : `in ${days} day${days === 1 ? '' : 's'}`}
                          {r.cancelling ? ' · cancelling' : ''}
                        </p>
                      </div>
                      <span className="text-[12px] font-mono flex-shrink-0"
                        style={{ color: r.cancelling ? 'rgba(255,255,255,0.3)' : TIER_COLORS[r.tier] || 'rgba(255,255,255,0.6)' }}>
                        {r.amountPence != null ? money(r.amountPence, currency) : '--'}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* AI spend */}
          <div className="rounded-2xl p-5 mb-5" style={CARD}>
            <h2 className="text-sm font-semibold text-white/70 mb-1 flex items-center gap-2">
              <Sparkle size={16} weight="duotone" style={{ color: ACID }} />
              Model spend
            </h2>
            <p className="text-[11px] text-white/35 mb-4 leading-relaxed">
              Every Claude call is booked with the token counts the API reported, priced at the published rate
              and stored. This is what was actually spent, not an estimate from record counts.
              {ai.since ? ` Recording since ${shortDate(ai.since)}.` : ''}
            </p>

            {!ai.calls ? (
              <Empty>
                Nothing recorded yet. Scans, smart crates, recommendations and the BPM arbiter all book their
                usage from the next deploy onwards; anything spent before that is only in the Anthropic console.
              </Empty>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2.5 mb-4">
                  <Metric label="All time" value={usd(ai.costUsdTotal)} accent={ACID} />
                  <Metric label="30 days"  value={usd(ai.costUsd30d)} />
                  <Metric label="7 days"   value={usd(ai.costUsd7d)} />
                </div>

                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-2">By endpoint</p>
                {(ai.byEndpoint || []).map(e => (
                  <ShareRow key={e.endpoint} label={`${e.endpoint} · ${e.calls} call${e.calls === 1 ? '' : 's'}`}
                    value={usd(e.costUsd)} color={ACID}
                    share={(Number(e.costUsd) || 0) / (Number(ai.costUsdTotal) || 1)} />
                ))}

                <p className="text-[10px] uppercase tracking-wider text-white/30 mt-4 mb-2">By model</p>
                {(ai.byModel || []).map(m => (
                  <ShareRow key={m.model}
                    label={`${m.model} · ${(Number(m.inputTokens) || 0).toLocaleString()} in / ${(Number(m.outputTokens) || 0).toLocaleString()} out`}
                    value={usd(m.costUsd)} color="rgba(255,255,255,0.55)"
                    share={(Number(m.costUsd) || 0) / (Number(ai.costUsdTotal) || 1)} />
                ))}

                <DailySpend daily={ai.daily} />

                <p className="text-[11px] text-white/30 mt-4 leading-relaxed">
                  {ai.calls.toLocaleString()} calls recorded. Spend is in US dollars, which is what Anthropic
                  bills in; revenue above is in {currency.toUpperCase()}.
                </p>
              </>
            )}
          </div>
        </>
      )}

      {/* ─── PEOPLE ────────────────────────────────────────────────────────── */}
      {tab === 'people' && (
        <>
          <div className="rounded-2xl p-5 mb-5" style={CARD}>
            <h2 className="text-sm font-semibold text-white/70 mb-4 flex items-center gap-2">
              <EnvelopeSimple size={16} className="text-violet-400" />
              Invite by email
            </h2>
            <form onSubmit={sendInvite} className="flex gap-2">
              <input
                type="email"
                value={inviteEmail}
                onChange={e => setInviteEmail(e.target.value)}
                placeholder="user@example.com"
                required
                className="flex-1 px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none"
                style={INPUT}
              />
              <button type="submit" disabled={inviting}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
                style={{ background: inviting ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.6)', border: '1px solid rgba(139,92,246,0.4)' }}>
                {inviting ? '...' : 'Send'}
              </button>
            </form>
          </div>

          <div className="rounded-2xl overflow-hidden mb-5" style={CARD}>
            <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
              <h2 className="text-sm font-semibold text-white/70 flex items-center gap-2">
                <UserCircle size={16} className="text-cyan-400" />
                Users ({users.length})
              </h2>
            </div>

            {loading ? (
              <div className="py-12 text-center text-white/30 text-sm">Loading...</div>
            ) : users.length === 0 ? (
              <div className="py-12 text-center text-white/30 text-sm">No users yet</div>
            ) : (
              <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
                {users.map(u => {
                  const renews = u.current_period_end;
                  const days = daysUntil(renews);
                  return (
                    <li key={u.id} className="flex items-start gap-3 px-4 sm:px-5 py-3.5 flex-wrap">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
                        style={{ background: u.role === 'admin' ? 'rgba(251,191,36,0.15)' : 'rgba(139,92,246,0.15)' }}>
                        {u.role === 'admin'
                          ? <Crown size={14} className="text-amber-400" weight="duotone" />
                          : <UserCircle size={14} className="text-violet-400" weight="duotone" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white truncate">{u.display_name || u.email}</p>
                          {u.username && (
                            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: u.is_public ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)', color: u.is_public ? '#86efac' : 'rgba(255,255,255,0.3)', border: `1px solid ${u.is_public ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}` }}>
                              @{u.username}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-white/40 truncate">{u.email}</p>
                        <p className="text-[11px] text-white/30">
                          joined {shortDate(u.created_at)} · {u.record_count ?? 0} record{(u.record_count ?? 0) !== 1 ? 's' : ''}
                          {u.subscription_status && u.subscription_status !== 'active' ? ` · ${u.subscription_status}` : ''}
                        </p>
                        {/* The money line only appears when there is money to
                            report. A row of dashes on every free account is
                            noise dressed up as data. */}
                        {(u.total_paid_pence > 0 || renews || u.ai_cost_usd > 0) && (
                          <p className="text-[11px] mt-0.5" style={{ color: 'rgba(255,255,255,0.45)', fontVariantNumeric: 'tabular-nums' }}>
                            {u.total_paid_pence > 0 && (
                              <span style={{ color: ACID }}>
                                {money(u.total_paid_pence, u.subscription_currency || currency)} paid
                                {u.payment_count > 1 ? ` (${u.payment_count})` : ''}
                              </span>
                            )}
                            {u.total_paid_pence > 0 && renews ? ' · ' : ''}
                            {renews && (
                              <span>
                                renews {shortDate(renews)}{days != null && days >= 0 ? ` (${days}d)` : ''}
                                {u.cancel_at_period_end ? ', cancelling' : ''}
                              </span>
                            )}
                            {(u.total_paid_pence > 0 || renews) && u.ai_cost_usd > 0 ? ' · ' : ''}
                            {u.ai_cost_usd > 0 && <span className="text-white/35">{usd(u.ai_cost_usd)} of model spend</span>}
                          </p>
                        )}
                      </div>
                      <div className="w-full sm:w-auto pl-11 sm:pl-0">
                        <select
                          value={u.subscription_tier || 'digger'}
                          onChange={e => changeTier(u.id, e.target.value, u.display_name || u.email)}
                          disabled={savingId === u.id}
                          title="Access tier"
                          className="text-xs rounded-lg pl-2.5 pr-6 py-1.5 outline-none cursor-pointer transition-opacity"
                          style={{
                            background: 'rgba(255,255,255,0.06)',
                            border: `1px solid ${TIER_COLORS[u.subscription_tier] || TIER_COLORS.digger}`,
                            color: TIER_COLORS[u.subscription_tier] || 'rgba(255,255,255,0.75)',
                            opacity: savingId === u.id ? 0.4 : 1,
                            appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                            backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'10\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23888\' stroke-width=\'3\'><path d=\'M6 9l6 6 6-6\'/></svg>")',
                            backgroundRepeat: 'no-repeat',
                            backgroundPosition: 'right 7px center',
                          }}>
                          <option value="digger"   style={{ color: '#000' }}>Digger (free)</option>
                          <option value="selector" style={{ color: '#000' }}>Selector</option>
                          <option value="resident" style={{ color: '#000' }}>Resident</option>
                        </select>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Bulk restore records to a user */}
          <div className="rounded-2xl p-5" style={CARD}>
            <h2 className="text-sm font-semibold text-white/70 mb-1 flex items-center gap-2">
              <Stack size={16} className="text-emerald-400" />
              Restore records to a collection
            </h2>
            <p className="text-[11px] text-white/35 mb-4 leading-relaxed">
              One record per line as <span className="text-white/55 font-mono">Artist - Title</span>. Each line is matched
              on Discogs (vinyl only, best cover match) and added to the chosen collection. Preview first, then add.
              Records already present are skipped.
            </p>

            <select
              value={restoreUserId}
              onChange={e => { setRestoreUserId(e.target.value); setRestoreResults(null); }}
              className="w-full mb-2 px-3 py-2.5 rounded-xl text-sm outline-none"
              style={{ ...INPUT, color: restoreUserId ? '#fff' : 'rgba(255,255,255,0.35)' }}>
              <option value="" style={{ color: '#000' }}>Choose a collection...</option>
              {users.map(u => (
                <option key={u.id} value={u.id} style={{ color: '#000' }}>
                  {(u.display_name || u.email)} - {u.record_count ?? 0} record{(u.record_count ?? 0) === 1 ? '' : 's'}
                </option>
              ))}
            </select>

            <textarea
              value={restoreText}
              onChange={e => setRestoreText(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={'Pavement - Slanted and Enchanted\nThe Killers - Hot Fuss\nBjörk - Debut'}
              className="w-full px-3 py-2.5 rounded-xl text-[13px] font-mono text-white placeholder-white/20 outline-none resize-y"
              style={INPUT}
            />

            <div className="flex items-center gap-2 mt-3">
              <button onClick={() => runRestore(true)} disabled={restoreBusy || !restoreUserId || !restoreText.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all disabled:opacity-40"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.8)' }}>
                {restoreBusy ? 'Working...' : 'Preview matches'}
              </button>
              <button onClick={() => runRestore(false)} disabled={restoreBusy || !restoreUserId || !restoreText.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all disabled:opacity-40"
                style={{ background: 'rgba(34,197,94,0.55)', border: '1px solid rgba(34,197,94,0.5)' }}>
                Add to collection
              </button>
              <span className="text-[11px] text-white/30 ml-auto">
                {restoreText.split('\n').filter(l => l.trim()).length} line(s)
              </span>
            </div>

            {restoreResults && (
              <ul className="mt-4 space-y-1 max-h-72 overflow-y-auto">
                {restoreResults.results.map((r, i) => {
                  const ok = r.status === 'added' || r.status === 'matched';
                  const skip = r.status === 'already_present';
                  return (
                    <li key={i} className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg"
                      style={{ background: 'rgba(255,255,255,0.03)' }}>
                      {r.coverUrl
                        ? <img src={r.coverUrl} alt="" className="w-8 h-8 rounded object-cover flex-shrink-0" />
                        : <div className="w-8 h-8 rounded flex-shrink-0" style={{ background: 'rgba(255,255,255,0.06)' }} />}
                      <div className="min-w-0 flex-1">
                        <div className="text-[12px] text-white/85 truncate">
                          {ok || skip ? `${r.artist} - ${r.title}` : r.line}
                        </div>
                        <div className="text-[10px] text-white/35 truncate">
                          {ok || skip
                            ? [r.year, r.label, r.tracks ? `${r.tracks} tracks` : null].filter(Boolean).join(' · ') || r.line
                            : r.error || 'no vinyl match found'}
                        </div>
                      </div>
                      <span className="text-[10px] font-mono flex-shrink-0 px-1.5 py-0.5 rounded"
                        style={{
                          color: ok ? '#86efac' : skip ? 'rgba(255,255,255,0.4)' : '#fca5a5',
                          background: ok ? 'rgba(34,197,94,0.12)' : skip ? 'rgba(255,255,255,0.06)' : 'rgba(239,68,68,0.12)',
                        }}>
                        {r.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}

      {/* ─── FEATURES ──────────────────────────────────────────────────────── */}
      {tab === 'features' && (
        <FeatureMatrix
          overrides={overrides}
          savingFeature={savingFeature}
          onSet={setFeatureTier}
        />
      )}
    </div>
  );
}

// ---- feature matrix ---------------------------------------------------------
//
// One row per gate, and the gate is the thing being edited, not a copy of it:
// both the client gates and the server gates read this table, so a feature
// moved here is moved everywhere within a minute (the server caches for that
// long). What it does NOT change is the pricing page's marketing copy, which is
// written prose, and the panel says so rather than letting somebody discover it.

const TIER_CHOICES = [
  { value: 'free',     label: 'Everyone',  color: 'rgba(255,255,255,0.5)' },
  { value: 'selector', label: 'Selector',  color: ACID },
  { value: 'resident', label: 'Resident',  color: VIOLET },
];

function FeatureMatrix({ overrides, savingFeature, onSet }) {
  const features = Array.from(new Set([...Object.keys(FEATURE_TIER), ...Object.keys(overrides)]));

  return (
    <div className="rounded-2xl p-5" style={CARD}>
      <h2 className="text-sm font-semibold text-white/70 mb-1 flex items-center gap-2">
        <SlidersHorizontal size={16} style={{ color: ACID }} />
        What each tier buys
      </h2>
      <p className="text-[11px] text-white/35 mb-5 leading-relaxed">
        These switches are the gates themselves. The app and the API both read them, so a change takes effect
        for everyone within a minute, with no deploy. Digger is the free tier, so
        <span className="text-white/55"> Everyone </span> means no gate at all.
        The wording on the pricing page is written copy and does not follow: change one and check the other.
      </p>

      <div className="space-y-4">
        {features.map(f => {
          const meta = FEATURE_META[f] || { label: f, enforced: 'client', where: 'unknown', note: '' };
          const shipped = FEATURE_TIER[f] || null;
          const current = overrides[f] || shipped || 'free';
          const overridden = !!overrides[f] && overrides[f] !== shipped;
          const busy = savingFeature === f;
          const weakened = TIER_RANK[current] != null && TIER_RANK[shipped] != null
            && TIER_RANK[current] < TIER_RANK[shipped];

          return (
            <div key={f} className="rounded-xl p-3.5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="min-w-0">
                  <p className="text-[13px] text-white/90 font-semibold">{meta.label}</p>
                  <p className="text-[11px] text-white/35 leading-snug mt-0.5">{meta.note}</p>
                </div>
                <span className="text-[9px] uppercase tracking-wider px-1.5 py-1 rounded flex items-center gap-1 flex-shrink-0"
                  style={{
                    background: meta.enforced === 'server' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.05)',
                    color: meta.enforced === 'server' ? '#86efac' : 'rgba(255,255,255,0.35)',
                  }}
                  title={meta.enforced === 'server'
                    ? `Enforced on the server (${meta.where}). Spends money or third-party quota.`
                    : `Enforced in the client only (${meta.where}). A view over data the user already owns.`}>
                  {meta.enforced === 'server' ? <Lock size={9} weight="fill" /> : <Globe size={9} />}
                  {meta.enforced}
                </span>
              </div>

              <div className="flex gap-1.5">
                {TIER_CHOICES.map(c => {
                  const on = current === c.value;
                  return (
                    <button key={c.value} disabled={busy}
                      onClick={() => onSet(f, c.value === shipped ? null : c.value)}
                      className="flex-1 py-1.5 rounded-lg text-[11px] font-semibold transition-all disabled:opacity-40"
                      style={{
                        background: on ? 'rgba(255,255,255,0.08)' : 'transparent',
                        border: `1px solid ${on ? c.color : 'rgba(255,255,255,0.08)'}`,
                        color: on ? c.color : 'rgba(255,255,255,0.35)',
                      }}>
                      {c.label}
                    </button>
                  );
                })}
              </div>

              <p className="text-[10px] text-white/25 mt-2">
                Shipped default: {shipped ? shipped[0].toUpperCase() + shipped.slice(1) : 'everyone'}
                {overridden && (
                  <>
                    {' · '}
                    <button onClick={() => onSet(f, null)} disabled={busy}
                      className="underline underline-offset-2 hover:text-white/60 transition-colors">
                      reset
                    </button>
                  </>
                )}
              </p>

              {weakened && (
                <p className="text-[10px] mt-1.5 leading-snug" style={{ color: '#fcd34d' }}>
                  Opened below the shipped tier. Anyone who paid for this expecting it to be theirs still has it,
                  but it is no longer a reason to subscribe.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
