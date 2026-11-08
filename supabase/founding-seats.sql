-- Founding seats: counting the £59 lifetime offer so the pricing card's
-- "first 500" is a number something checks.
--
-- The card has always said "or £59 lifetime -- first 500" and nothing counted
-- them, which is the same fault the tier copy has hit before: label printing,
-- CSV export and multi-device sync were all sold and never enforced. A seat
-- cap is worse than those, because it is a promise of scarcity to someone
-- handing over money for a product you then owe them forever.
--
-- The count comes from `payments` rather than a counter of its own. That table
-- is the ledger of money Stripe reported as collected, keyed on Stripe's own
-- session id, so a webhook redelivery updates a row instead of counting the
-- sale twice. A separate counter would be a second source of truth that drifts
-- from the money the first time a webhook is replayed or a payment refunded.
--
-- Run this in the Supabase SQL editor. It needs supabase/admin-analytics.sql
-- (which creates `payments`) to have been run first.

CREATE OR REPLACE FUNCTION public.founding_seats_taken()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT count(*)::int
    FROM public.payments
   WHERE kind = 'one_time'
     AND status = 'paid';
$$;

-- `payments` has RLS on and no policy, and is revoked from anon and
-- authenticated, so nothing in the browser can read it -- which is why this
-- function exists. It is SECURITY DEFINER and therefore public unless revoked,
-- so it is granted deliberately rather than by default.
--
-- Exposing it is safe in a way the table is not: it returns a single integer
-- that the pricing card advertises to everyone anyway, and nothing about who
-- bought, what they paid, or when. Contrast upsert_subscription, which was
-- reachable with the anon key and granted the top tier for nothing.
REVOKE ALL ON FUNCTION public.founding_seats_taken() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.founding_seats_taken() TO anon, authenticated;
