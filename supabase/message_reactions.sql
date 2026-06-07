-- Run this in the Supabase SQL editor to enable message reactions.

create table if not exists public.message_reactions (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid not null references public.messages(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  emoji       text not null,
  created_at  timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

alter table public.message_reactions enable row level security;

-- Users can view reactions on any message they are part of
create policy "view_message_reactions" on public.message_reactions
  for select using (
    exists (
      select 1 from public.messages m
      where m.id = message_id
        and (m.from_user_id = auth.uid() or m.to_user_id = auth.uid())
    )
  );

create policy "add_message_reactions" on public.message_reactions
  for insert with check (auth.uid() = user_id);

create policy "remove_message_reactions" on public.message_reactions
  for delete using (auth.uid() = user_id);
