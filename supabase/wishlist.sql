-- Wishlist and Trace
-- =============================================================================
-- Run this on an existing database alongside schema.sql. Until it is run the
-- Wishlist tab renders from its local cache only and nothing syncs, which is
-- the same posture the file-import queue takes: a missing migration must
-- degrade the feature, never break the screen.

-- -----------------------------------------------------------------------------
-- wishlist_items
-- -----------------------------------------------------------------------------
-- A record the user wants but does not own. release_id is the Discogs release,
-- which is the identity everything else keys off.
--
-- raw_query is kept permanently, even after the item resolves. It is the record
-- of what the user was actually holding or hearing when they typed, which is
-- the only honest input for improving resolution later. An item can also sit
-- unresolved for ever (a scrawl on a white label that matches nothing yet), so
-- release_id is nullable on purpose.
create table if not exists public.wishlist_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  release_id   bigint,
  raw_query    text,
  artist       text,
  title        text,
  label        text,
  cat_no       text,
  year         int,
  country      text,
  format       text,
  cover_url    text,
  note         text,
  -- grail | want | gig | acquired. Free text rather than an enum so a new
  -- category is a client release, not a migration.
  category     text not null default 'want',
  position     int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists wishlist_items_user_idx    on public.wishlist_items (user_id, category);
create index if not exists wishlist_items_release_idx on public.wishlist_items (release_id);

alter table public.wishlist_items enable row level security;

drop policy if exists "wishlist_select" on public.wishlist_items;
create policy "wishlist_select" on public.wishlist_items
  for select using (auth.uid() = user_id);

drop policy if exists "wishlist_insert" on public.wishlist_items;
create policy "wishlist_insert" on public.wishlist_items
  for insert with check (auth.uid() = user_id);

drop policy if exists "wishlist_update" on public.wishlist_items;
create policy "wishlist_update" on public.wishlist_items
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "wishlist_delete" on public.wishlist_items;
create policy "wishlist_delete" on public.wishlist_items
  for delete using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- trace_results
-- -----------------------------------------------------------------------------
-- The stored outcome of one hunt, so returning to the tab shows the answer
-- rather than re-running it. One row per wishlist item: a re-trace overwrites,
-- because nobody wants a scrolling history of yesterday's prices under every
-- card. `checked_at` is what the card prints, and it is the whole reason the
-- number is trustworthy.
create table if not exists public.trace_results (
  item_id      uuid primary key references public.wishlist_items(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  release_id   bigint,
  payload      jsonb not null,
  checked_at   timestamptz not null default now()
);

create index if not exists trace_results_user_idx on public.trace_results (user_id);

alter table public.trace_results enable row level security;

drop policy if exists "trace_select" on public.trace_results;
create policy "trace_select" on public.trace_results
  for select using (auth.uid() = user_id);

-- Writes come from /api/trace with the service role, which bypasses RLS. The
-- client only ever reads its own rows and deletes them, so no insert or update
-- policy is granted: a client that could write here could fabricate a price.
drop policy if exists "trace_delete" on public.trace_results;
create policy "trace_delete" on public.trace_results
  for delete using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- Keep updated_at honest
-- -----------------------------------------------------------------------------
create or replace function public.touch_wishlist_item()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wishlist_items_touch on public.wishlist_items;
create trigger wishlist_items_touch
  before update on public.wishlist_items
  for each row execute function public.touch_wishlist_item();
