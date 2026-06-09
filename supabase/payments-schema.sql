-- Payments / subscription schema
-- Run in Supabase SQL editor on top of the existing schema.

-- ─── Profile additions ────────────────────────────────────────────────────────

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS subscription_tier     text NOT NULL DEFAULT 'digger',
  ADD COLUMN IF NOT EXISTS subscription_status   text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS stripe_customer_id    text,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text,
  ADD COLUMN IF NOT EXISTS scans_this_period     int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scans_period_end      timestamptz NOT NULL DEFAULT (date_trunc('month', now()) + interval '1 month');

-- Unique index for Stripe customer ID lookups from webhook handler
CREATE UNIQUE INDEX IF NOT EXISTS profiles_stripe_customer_id_idx
  ON public.profiles (stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

-- ─── Allowed tier values ──────────────────────────────────────────────────────

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_subscription_tier_check
    CHECK (subscription_tier IN ('digger', 'selector', 'resident'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_subscription_status_check
    CHECK (subscription_status IN ('active', 'past_due', 'cancelled', 'trialing'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ─── RPC: increment scan counter (atomic, resets when period expires) ─────────

CREATE OR REPLACE FUNCTION public.increment_scan_count(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_profile  public.profiles%ROWTYPE;
  v_now      timestamptz := now();
BEGIN
  SELECT * INTO v_profile FROM public.profiles WHERE id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'profile_not_found');
  END IF;

  -- Auto-reset counter when billing period rolls over
  IF v_now >= v_profile.scans_period_end THEN
    UPDATE public.profiles
    SET scans_this_period = 1,
        scans_period_end  = date_trunc('month', v_now) + interval '1 month'
    WHERE id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET scans_this_period = scans_this_period + 1
    WHERE id = p_user_id;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── RPC: update subscription from webhook (called by stripe-webhook handler) ─

CREATE OR REPLACE FUNCTION public.upsert_subscription(
  p_stripe_customer_id     text,
  p_stripe_subscription_id text,
  p_tier                   text,
  p_status                 text
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.profiles
  SET subscription_tier       = p_tier,
      subscription_status     = p_status,
      stripe_subscription_id  = p_stripe_subscription_id
  WHERE stripe_customer_id = p_stripe_customer_id;
END;
$$;
