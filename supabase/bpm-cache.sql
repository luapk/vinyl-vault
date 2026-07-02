-- Shared BPM cache: community-wide artist+title -> bpm lookups.
-- Once any user's scan or device resolves a track's BPM, every later scan of
-- the same track gets it for free. Written only by serverless functions using
-- the service role key; RLS is enabled with no policies so anon/authenticated
-- clients cannot read or write it directly.

create table if not exists public.track_bpm (
  id bigint generated always as identity primary key,
  artist_norm text not null,
  title_norm text not null,
  -- round(duration_secs / 30); -1 = duration unknown. Separates genuinely
  -- different versions (7" edit vs 12" mix) without splitting on trivial
  -- run-time differences between pressings.
  duration_bucket int not null default -1,
  bpm int not null check (bpm between 40 and 260),
  -- deezer | getsongbpm | waveform | waveform+arbiter
  source text not null,
  confidence text not null default 'medium' check (confidence in ('high', 'medium', 'low')),
  hits int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (artist_norm, title_norm, duration_bucket)
);

create index if not exists track_bpm_lookup_idx
  on public.track_bpm (artist_norm, title_norm);

alter table public.track_bpm enable row level security;
