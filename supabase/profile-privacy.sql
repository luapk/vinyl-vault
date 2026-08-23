-- Keep email and the Stripe ids off the wire.
--
-- RLS is row-level, not column-level. `profiles_select` lets anyone read a
-- profile whose is_public is true, and that means the WHOLE row: the app's own
-- queries ask for a safe handful of columns, but nothing stops a client
-- holding the anon key (which ships in the browser bundle) from asking
-- PostgREST for the rest. Four public profiles were handing out their email
-- address, and one its stripe_customer_id, to anybody who asked.
--
-- The policy itself has to stay as it is: the community screens read profiles
-- through PostgREST embeds (comment authors, reactors, follower lists), and
-- those resolve against this table under this policy. Take is_public out and
-- every name in the community view goes blank.
--
-- So the fix is column privileges, which apply to the role rather than the
-- row. Nothing in the browser needs any of these three: the signed-in user's
-- address is already on the auth session as user.email, and the Stripe ids are
-- only ever read by /api/* handlers using the service role, which is not
-- subject to grants.
--
-- Run this in the Supabase SQL editor.

revoke select (email, stripe_customer_id, stripe_subscription_id)
  on public.profiles from anon, authenticated;

-- The admin panel is the one screen that legitimately shows other people's
-- email addresses. It cannot go through the grant above (an admin is just
-- another `authenticated` role), so it asks a definer function that checks the
-- caller is an admin before answering.
create or replace function public.admin_list_users()
returns table (
  id                  uuid,
  email               text,
  role                text,
  created_at          timestamptz,
  display_name        text,
  username            text,
  is_public           boolean,
  subscription_tier   text,
  subscription_status text
)
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'admin_list_users: not authorised' using errcode = '42501';
  end if;
  return query
    select p.id, p.email, p.role, p.created_at, p.display_name, p.username,
           p.is_public, p.subscription_tier, p.subscription_status
      from public.profiles p
     order by p.created_at;
end;
$$;

-- Signed-in users may call it; the function decides whether to answer. Signed
-- out, there is nothing to be an admin of.
revoke all on function public.admin_list_users() from public, anon;
grant execute on function public.admin_list_users() to authenticated;
