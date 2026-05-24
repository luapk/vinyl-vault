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
  created_at  timestamptz not null default now()
);

-- Migration for existing databases:
-- alter table public.profiles add column if not exists avatar_url text;

alter table public.profiles enable row level security;

-- Users can read their own profile; admins can read all profiles.
create policy "profiles_select" on public.profiles
  for select using (
    auth.uid() = id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Users can update their own profile (display name, avatar, etc.).
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id);

-- Admins can update any profile (e.g. change roles).
create policy "profiles_admin_update" on public.profiles
  for update using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'admin'
    )
  );

-- Migration for existing databases (replace old profiles_update policy):
-- drop policy if exists "profiles_update" on public.profiles;
-- create policy "profiles_self_update" on public.profiles for update using (auth.uid() = id);
-- create policy "profiles_admin_update" on public.profiles for update using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

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

-- Users can read their own records; admins can read everyone's.
create policy "records_select" on public.records
  for select using (auth.uid() = user_id or public.is_admin());

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
