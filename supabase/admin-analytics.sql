-- Admin analytics: what a feature costs, who paid, and what the models spend.
--
-- Run this in the Supabase SQL editor. It is additive apart from one DROP,
-- which is called out below and is a function signature, never data.
--
-- Four things live here:
--   1. feature_tiers   -- the tier a feature needs, editable without a deploy
--   2. billing columns -- when a subscription started, renews and for how much
--   3. payments        -- an append-only ledger of money actually taken
--   4. ai_usage        -- an append-only ledger of model tokens actually spent
--
-- Both ledgers are written only by /api/* with the service role and read only
-- through the admin definer functions at the bottom. They carry no RLS policy
-- at all, which is the strongest form of "nobody in the browser reads this":
-- with RLS enabled and no policy, every anon and authenticated select returns
-- nothing regardless of what PostgREST is asked for.

-- ─── 1. Feature tiers ─────────────────────────────────────────────────────────
--
-- The shipped map is FEATURE_TIER in src/lib/pricing.js and it stays the
-- default. A row here overrides one feature, and both the client gates and the
-- server gates read it. Layered rather than replacing on purpose: an empty or
-- unreachable table leaves the product exactly as shipped, instead of opening
-- every paid feature to everybody the first time this table is unreachable.

CREATE TABLE IF NOT EXISTS public.feature_tiers (
  feature     text PRIMARY KEY,
  tier        text NOT NULL CHECK (tier IN ('free', 'digger', 'selector', 'resident')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid
);

ALTER TABLE public.feature_tiers ENABLE ROW LEVEL SECURITY;

-- Readable by anyone signed in: the client gate needs it on every boot, and a
-- gate's threshold is not a secret (the pricing page prints all three tiers).
-- Writable only by an admin.
DROP POLICY IF EXISTS "feature_tiers_select" ON public.feature_tiers;
CREATE POLICY "feature_tiers_select" ON public.feature_tiers FOR SELECT USING (true);

DROP POLICY IF EXISTS "feature_tiers_admin_write" ON public.feature_tiers;
CREATE POLICY "feature_tiers_admin_write" ON public.feature_tiers
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT ON public.feature_tiers TO anon, authenticated;

-- ─── 2. Billing detail on the profile ─────────────────────────────────────────
--
-- Stripe already knows all of this; the point of copying it here is that the
-- admin panel can answer "when does this person renew, and for how much"
-- without a Stripe round trip per row. /api/stripe-webhook writes it.
--
-- These columns are deliberately NOT granted to anon or authenticated. The
-- table-wide SELECT was revoked in supabase/profile-privacy.sql and the safe
-- columns granted back by name, so anything added here is private until
-- somebody lists it. Nothing in the browser needs them: the admin panel reads
-- them through admin_list_users() below.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_started_at   timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end        timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscription_amount_pence int,
  ADD COLUMN IF NOT EXISTS subscription_currency     text,
  ADD COLUMN IF NOT EXISTS subscription_interval     text;

-- ─── 3. Payments ledger ───────────────────────────────────────────────────────
--
-- One row per payment Stripe reports as taken. The id is Stripe's own (invoice
-- or checkout session), so a webhook redelivery updates the row it already
-- wrote rather than double-counting the money. Amounts are in minor units,
-- integer, because a float total of somebody's money is a bug waiting to be
-- rounded.

CREATE TABLE IF NOT EXISTS public.payments (
  id                  text PRIMARY KEY,
  user_id             uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  stripe_customer_id  text,
  amount_pence        int  NOT NULL,
  currency            text NOT NULL DEFAULT 'gbp',
  status              text NOT NULL DEFAULT 'paid',
  kind                text NOT NULL DEFAULT 'subscription',
  tier                text,
  description         text,
  paid_at             timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_user_idx    ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS payments_paid_at_idx ON public.payments (paid_at DESC);

ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payments FROM anon, authenticated;

-- ─── 4. AI usage ledger ───────────────────────────────────────────────────────
--
-- One row per model call, with the token counts the API itself reported and
-- the cost worked out from them at the rate in api/lib/aiUsage.js. Storing the
-- cost as well as the tokens is on purpose: rates change, and what a call cost
-- on the day is not recoverable from a later rate card.
--
-- user_id is nullable and not a foreign key: a deleted account must not take
-- the record of what it spent with it, or the spend total silently drops.

CREATE TABLE IF NOT EXISTS public.ai_usage (
  id                 bigserial PRIMARY KEY,
  user_id            uuid,
  endpoint           text NOT NULL,
  model              text NOT NULL,
  input_tokens       int NOT NULL DEFAULT 0,
  output_tokens      int NOT NULL DEFAULT 0,
  cache_read_tokens  int NOT NULL DEFAULT 0,
  cache_write_tokens int NOT NULL DEFAULT 0,
  cost_usd           numeric(12,6) NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_usage_created_idx  ON public.ai_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS ai_usage_user_idx     ON public.ai_usage (user_id);
CREATE INDEX IF NOT EXISTS ai_usage_endpoint_idx ON public.ai_usage (endpoint);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_usage FROM anon, authenticated;

-- ─── 5. admin_list_users(), extended ──────────────────────────────────────────
--
-- THE ONE DESTRUCTIVE-LOOKING STATEMENT IN THIS FILE. A function's return type
-- cannot be widened with CREATE OR REPLACE, so the old signature is dropped and
-- recreated. It drops a function definition, never a row: no user, profile,
-- record or payment is touched by it, and the panel picks the new one up on its
-- next load.
--
-- Record counts now come from here rather than from the client selecting every
-- row of public.records to count them, which was a whole-table read on every
-- admin panel open.

DROP FUNCTION IF EXISTS public.admin_list_users();

CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id                        uuid,
  email                     text,
  role                      text,
  created_at                timestamptz,
  display_name              text,
  username                  text,
  is_public                 boolean,
  subscription_tier         text,
  subscription_status       text,
  subscription_started_at   timestamptz,
  current_period_end        timestamptz,
  cancel_at_period_end      boolean,
  subscription_amount_pence int,
  subscription_currency     text,
  subscription_interval     text,
  stripe_customer_id        text,
  record_count              bigint,
  total_paid_pence          bigint,
  payment_count             bigint,
  last_payment_at           timestamptz,
  ai_cost_usd               numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_list_users: not authorised' USING errcode = '42501';
  END IF;
  RETURN QUERY
    SELECT p.id, p.email, p.role, p.created_at, p.display_name, p.username,
           p.is_public, p.subscription_tier, p.subscription_status,
           p.subscription_started_at, p.current_period_end, p.cancel_at_period_end,
           p.subscription_amount_pence, p.subscription_currency, p.subscription_interval,
           p.stripe_customer_id,
           COALESCE(r.n, 0)                       AS record_count,
           COALESCE(pay.total, 0)                 AS total_paid_pence,
           COALESCE(pay.n, 0)                     AS payment_count,
           pay.last_at                            AS last_payment_at,
           COALESCE(ai.cost, 0)::numeric          AS ai_cost_usd
      FROM public.profiles p
      LEFT JOIN (
        SELECT user_id, count(*) AS n FROM public.records GROUP BY user_id
      ) r ON r.user_id = p.id
      LEFT JOIN (
        SELECT user_id,
               sum(amount_pence) AS total,
               count(*)          AS n,
               max(paid_at)      AS last_at
          FROM public.payments WHERE status = 'paid' GROUP BY user_id
      ) pay ON pay.user_id = p.id
      LEFT JOIN (
        SELECT user_id, sum(cost_usd) AS cost FROM public.ai_usage GROUP BY user_id
      ) ai ON ai.user_id = p.id
     ORDER BY p.created_at;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_list_users() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_list_users() TO authenticated;

-- ─── 6. admin_metrics() ───────────────────────────────────────────────────────
--
-- One round trip for the money and spend summary. Everything is computed here
-- rather than in the browser so the panel never has to hold a copy of the
-- ledgers to add them up.

CREATE OR REPLACE FUNCTION public.admin_metrics()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v jsonb;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_metrics: not authorised' USING errcode = '42501';
  END IF;

  SELECT jsonb_build_object(
    'generatedAt', now(),

    'users', jsonb_build_object(
      'total',    (SELECT count(*) FROM public.profiles),
      'digger',   (SELECT count(*) FROM public.profiles WHERE coalesce(subscription_tier,'digger') = 'digger'),
      'selector', (SELECT count(*) FROM public.profiles WHERE subscription_tier = 'selector'),
      'resident', (SELECT count(*) FROM public.profiles WHERE subscription_tier = 'resident'),
      'lapsed',   (SELECT count(*) FROM public.profiles
                    WHERE subscription_tier IN ('selector','resident')
                      AND subscription_status NOT IN ('active','trialing','past_due')),
      'new30d',   (SELECT count(*) FROM public.profiles WHERE created_at > now() - interval '30 days'),
      'records',  (SELECT count(*) FROM public.records)
    ),

    'revenue', jsonb_build_object(
      'totalPence',  (SELECT COALESCE(sum(amount_pence), 0) FROM public.payments WHERE status = 'paid'),
      'pence30d',    (SELECT COALESCE(sum(amount_pence), 0) FROM public.payments
                       WHERE status = 'paid' AND paid_at > now() - interval '30 days'),
      'pence365d',   (SELECT COALESCE(sum(amount_pence), 0) FROM public.payments
                       WHERE status = 'paid' AND paid_at > now() - interval '365 days'),
      'payments',    (SELECT count(*) FROM public.payments WHERE status = 'paid'),
      'payers',      (SELECT count(DISTINCT user_id) FROM public.payments WHERE status = 'paid'),
      -- What the live subscriptions are committed to bill over a year. Not the
      -- same number as money taken, and labelled as such on the panel.
      'committedYearPence', (SELECT COALESCE(sum(
          CASE WHEN subscription_interval = 'month' THEN subscription_amount_pence * 12
               ELSE subscription_amount_pence END), 0)
        FROM public.profiles
        WHERE subscription_status IN ('active','trialing')
          AND subscription_amount_pence IS NOT NULL
          AND NOT cancel_at_period_end),
      'currency', (SELECT COALESCE(max(currency), 'gbp') FROM public.payments WHERE status = 'paid')
    ),

    'renewals', (
      SELECT COALESCE(jsonb_agg(x ORDER BY x->>'due'), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
                 'id', id, 'name', COALESCE(display_name, email), 'tier', subscription_tier,
                 'due', current_period_end, 'amountPence', subscription_amount_pence,
                 'cancelling', cancel_at_period_end) AS x
          FROM public.profiles
         WHERE current_period_end IS NOT NULL
           AND current_period_end BETWEEN now() AND now() + interval '60 days'
      ) s
    ),

    'ai', jsonb_build_object(
      'costUsdTotal', (SELECT COALESCE(sum(cost_usd), 0) FROM public.ai_usage),
      'costUsd30d',   (SELECT COALESCE(sum(cost_usd), 0) FROM public.ai_usage
                        WHERE created_at > now() - interval '30 days'),
      'costUsd7d',    (SELECT COALESCE(sum(cost_usd), 0) FROM public.ai_usage
                        WHERE created_at > now() - interval '7 days'),
      'calls',        (SELECT count(*) FROM public.ai_usage),
      'since',        (SELECT min(created_at) FROM public.ai_usage),
      'byEndpoint', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'endpoint', endpoint, 'calls', n, 'costUsd', cost) ORDER BY cost DESC), '[]'::jsonb)
          FROM (SELECT endpoint, count(*) AS n, sum(cost_usd) AS cost
                  FROM public.ai_usage GROUP BY endpoint) e
      ),
      'byModel', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                 'model', model, 'calls', n, 'costUsd', cost,
                 'inputTokens', tin, 'outputTokens', tout) ORDER BY cost DESC), '[]'::jsonb)
          FROM (SELECT model, count(*) AS n, sum(cost_usd) AS cost,
                       sum(input_tokens) AS tin, sum(output_tokens) AS tout
                  FROM public.ai_usage GROUP BY model) m
      ),
      'daily', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object('day', d, 'costUsd', cost) ORDER BY d), '[]'::jsonb)
          FROM (SELECT date_trunc('day', created_at)::date AS d, sum(cost_usd) AS cost
                  FROM public.ai_usage
                 WHERE created_at > now() - interval '30 days'
                 GROUP BY 1) day
      )
    )
  ) INTO v;

  RETURN v;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_metrics() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_metrics() TO authenticated;

-- ─── 7. admin_set_feature_tier() ──────────────────────────────────────────────
--
-- The RLS policy above already restricts writes to admins. This exists so the
-- panel makes one call that both validates the value and stamps who changed it,
-- and so a future non-admin route cannot reach the table by another name.

CREATE OR REPLACE FUNCTION public.admin_set_feature_tier(p_feature text, p_tier text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'admin_set_feature_tier: not authorised' USING errcode = '42501';
  END IF;
  IF p_tier NOT IN ('free','digger','selector','resident') THEN
    RAISE EXCEPTION 'admin_set_feature_tier: unknown tier %', p_tier USING errcode = '22023';
  END IF;
  INSERT INTO public.feature_tiers (feature, tier, updated_at, updated_by)
  VALUES (p_feature, p_tier, now(), auth.uid())
  ON CONFLICT (feature) DO UPDATE
    SET tier = excluded.tier, updated_at = now(), updated_by = excluded.updated_by;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_feature_tier(text, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_tier(text, text) TO authenticated;

-- ─── Verify ───────────────────────────────────────────────────────────────────
--   select public.admin_metrics();                 -- as an admin, not the SQL editor's service role
--   select * from public.admin_list_users();
--   select has_column_privilege('anon','public.profiles','current_period_end','SELECT');  -- false
