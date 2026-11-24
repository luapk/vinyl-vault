-- Genre backfill for records saved by the file import before it kept genres.
--
-- Called only by /api/import-worker with the service role, so both functions
-- are revoked from every client role: a security definer function in public is
-- callable by anyone holding the anon key until it is (see CLAUDE.md).
-- Safe to run more than once.

-- A random batch of records with a Discogs id, no genres, and no previous
-- check. Random rather than oldest-first so a record that keeps failing cannot
-- sit at the head of every batch.
create or replace function public.genre_backfill_batch(p_limit int default 30)
returns table (id uuid, discogs_id text)
language sql volatile security definer set search_path = public as $$
  select r.id, r.data->>'discogsId'
    from public.records r
   where coalesce(r.data->>'discogsId', '') <> ''
     and coalesce(jsonb_array_length(case when jsonb_typeof(r.data->'genres') = 'array' then r.data->'genres' end), 0) = 0
     and not (r.data ? 'genresCheckedAt')
   order by random()
   limit greatest(1, least(p_limit, 100));
$$;

-- Writes genres onto one record, but ONLY while it still has none: anything a
-- scan or the user put there since the batch was drawn wins. Stamps
-- genresCheckedAt (ms, like savedAt) so a release Discogs no longer has is not
-- asked about again. Returns whether a row changed.
create or replace function public.genre_backfill_apply(p_id uuid, p_genres jsonb)
returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  update public.records r
     set data = jsonb_set(r.data, '{genres}', coalesce(p_genres, '[]'::jsonb))
                || jsonb_build_object('genresCheckedAt', (extract(epoch from now()) * 1000)::bigint),
         updated_at = now()
   where r.id = p_id
     and coalesce(jsonb_array_length(case when jsonb_typeof(r.data->'genres') = 'array' then r.data->'genres' end), 0) = 0;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;

revoke execute on function public.genre_backfill_batch(int) from public, anon, authenticated;
revoke execute on function public.genre_backfill_apply(uuid, jsonb) from public, anon, authenticated;
