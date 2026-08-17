-- Vinyl Vault schema
-- Run this in the Supabase SQL editor after creating your project.

-- ─── Extensions ───────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─── Profiles ─────────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  role        text not null default 'user' check (role in ('user', 'admin')),
  avatar_url  text,
  -- Campaign email only. Account mail (password resets and the like) ignores
  -- this flag. Set by /api/unsubscribe; the send script filters on it.
  marketing_opt_out boolean not null default false,
  -- Community visibility. social-schema.sql also adds this (idempotently); it
  -- is declared here so the select policy below can reference it on a fresh
  -- install regardless of which file runs first.
  is_public   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Migrations for existing databases:
-- alter table public.profiles add column if not exists avatar_url text;
-- alter table public.profiles add column if not exists marketing_opt_out boolean not null default false;

alter table public.profiles enable row level security;

-- is_admin() must be defined BEFORE policies that reference it. Inline EXISTS
-- queries against public.profiles would otherwise recurse through the SELECT
-- policy. SECURITY DEFINER lets the helper bypass RLS for the admin lookup.
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Users can read their own profile; admins can read all profiles.
-- Public profiles must stay readable: the community browses other collectors by
-- username. Leaving the is_public clause out here means re-running this file
-- silently breaks community profile viewing for every non-admin user, which is
-- how it broke once already. social-schema.sql defines the same policy; keep
-- the two identical so applying either in any order is safe.
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id or public.is_admin() or is_public = true);

-- Users can update their own profile (display name, avatar, etc.).
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- Admins can update any profile (e.g. change roles).
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin());

-- Migration for existing databases (run in Supabase SQL editor). Keep the
-- is_public clause: dropping it locks non-admins out of every other profile.
-- create or replace function public.is_admin() returns boolean language sql security definer stable set search_path = public as $$ select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'); $$;
-- drop policy if exists "profiles_select" on public.profiles;
-- drop policy if exists "profiles_admin_update" on public.profiles;
-- create policy "profiles_select" on public.profiles for select using (auth.uid() = id or public.is_admin() or is_public = true);
-- create policy "profiles_admin_update" on public.profiles for update using (public.is_admin());

-- ─── Auto-create profile on sign-up ───────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ─── Records ──────────────────────────────────────────────────────────────────
create table if not exists public.records (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.records enable row level security;

-- Helper: is the calling user an admin?
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Users can read their own records; admins can read everyone's; anyone can read
-- the records of a profile that has opted into being public. As with
-- profiles_select, omitting the public clause here silently breaks community
-- browsing, so this must stay identical to social-schema.sql.
create policy "records_select" on public.records
  for select using (
    auth.uid() = user_id
    or public.is_admin()
    or exists (
      select 1 from public.profiles
      where id = records.user_id and is_public = true
    )
  );

-- Users can insert their own records.
create policy "records_insert" on public.records
  for insert with check (auth.uid() = user_id);

-- Users can update their own records; admins can update any.
create policy "records_update" on public.records
  for update using (auth.uid() = user_id or public.is_admin());

-- Users can delete their own records; admins can delete any.
create policy "records_delete" on public.records
  for delete using (auth.uid() = user_id or public.is_admin());

-- Auto-update updated_at on any row change.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists records_updated_at on public.records;
create trigger records_updated_at
  before update on public.records
  for each row execute procedure public.set_updated_at();

-- ─── Admin user setup ─────────────────────────────────────────────────────────
-- After creating a user with email admin@vault.local in the Supabase
-- Auth dashboard (or via invite), run this to grant admin role:
--
--   update public.profiles set role = 'admin'
--   where email = 'admin@vault.local';

-- ─── Avatar RPC (bypasses UPDATE RLS entirely) ────────────────────────────────
-- Security definer means this runs as the postgres role, not the caller,
-- so it can update profiles regardless of the UPDATE policy.
-- auth.uid() inside the function still returns the calling user's ID.
create or replace function public.set_own_avatar_url(p_avatar_url text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update profiles set avatar_url = p_avatar_url where id = auth.uid();
end;
$$;

-- Migration for existing databases (run this in Supabase SQL editor):
-- create or replace function public.set_own_avatar_url(p_avatar_url text)
-- returns void language plpgsql security definer set search_path = public as $$
-- begin
--   update profiles set avatar_url = p_avatar_url where id = auth.uid();
-- end;
-- $$;
