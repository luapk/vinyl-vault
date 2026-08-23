-- Background file imports.
--
-- An import used to live entirely in the tab that started it: lock the phone,
-- switch app, or close the browser and the rest of the list simply never
-- happened. A job is a row here instead. The tab that creates it kicks off the
-- worker, and a Vercel cron re-claims anything still unfinished, so the import
-- finishes whether or not anyone is watching.
--
-- Run this in the Supabase SQL editor. Until it is run, imports fall back to
-- running in the browser exactly as before.

create table if not exists public.import_jobs (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  -- 'import' resolves parsed file rows into new records.
  -- 'retry' re-looks-up records an earlier import could not match.
  kind         text not null default 'import' check (kind in ('import', 'retry')),
  status       text not null default 'queued'
               check (status in ('queued', 'running', 'done', 'cancelled', 'failed')),
  -- One entry per row: { artist, title, status, recordId? }. The worker writes
  -- each row's status back so the progress list survives a reload.
  rows         jsonb not null default '[]'::jsonb,
  cursor       int  not null default 0,
  total        int  not null default 0,
  matched      int  not null default 0,
  drafts       int  not null default 0,
  added        int  not null default 0,
  skipped      int  not null default 0,
  overflow     int  not null default 0,
  error        text,
  -- Held by whichever worker invocation is processing the job. A job whose
  -- lock has expired is fair game again: that is what makes a killed
  -- invocation recoverable rather than a job stuck at 'running' forever.
  locked_until timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists import_jobs_user_idx    on public.import_jobs (user_id, created_at desc);
create index if not exists import_jobs_pending_idx on public.import_jobs (status, locked_until);

alter table public.import_jobs enable row level security;

-- Owners read their own jobs and create them, and may cancel one by setting
-- status. Everything else (row statuses, counters, the lock) is written by the
-- worker with the service role, which bypasses RLS.
drop policy if exists "import_jobs_select" on public.import_jobs;
create policy "import_jobs_select" on public.import_jobs
  for select using (auth.uid() = user_id);

drop policy if exists "import_jobs_insert" on public.import_jobs;
create policy "import_jobs_insert" on public.import_jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "import_jobs_update" on public.import_jobs;
create policy "import_jobs_update" on public.import_jobs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Claim the oldest unfinished job for one worker invocation.
--
-- `for update skip locked` plus locked_until is what stops the cron tick and
-- the tab that started the job from importing the same rows twice: a double
-- claim would add every record twice, and an import cannot be un-done in bulk.
create or replace function public.claim_import_job(p_lock_seconds int default 360)
returns public.import_jobs
language plpgsql security definer set search_path = public as $$
declare claimed public.import_jobs;
begin
  update public.import_jobs
     set status       = 'running',
         locked_until = now() + make_interval(secs => p_lock_seconds),
         updated_at   = now()
   where id = (
     select id from public.import_jobs
      where status in ('queued', 'running')
        and (locked_until is null or locked_until < now())
      order by created_at
      limit 1
      for update skip locked
   )
   returning * into claimed;
  return claimed;
end;
$$;

revoke all on function public.claim_import_job(int) from public, anon, authenticated;
