# Vinyl Vault

A vinyl record collection manager. Scan a record sleeve photo, identify it via AI + Discogs, and file it into crates. Syncs across devices via Supabase.

## Tech stack

- **Frontend**: React 18 + Vite, Tailwind CSS, Lucide + Phosphor icons
- **Backend**: Vercel serverless functions (`/api/*.js`)
- **Database**: Supabase (Postgres + Auth)
- **Deploy**: Vercel, production from `main` branch

## Development

```bash
npm install
npm run dev      # localhost:5173
npm run build    # production build
npm test         # unit tests (vitest)
npm run stress   # fault-injection E2E suite (Playwright; see stress/README.md)
npm run test:all # both
```

### Stress suite
`stress/` contains the fault-injection E2E tests: the real app in a real
browser against a mock Supabase (`stress/mock-supabase.mjs`) that faithfully
models refresh-token rotation + reuse revocation. It covers the session
lifecycle (revoked sessions, unreachable auth server, sign-out always works),
the no-data-loss sync invariant under database faults, and the PWA + tab
concurrent-refresh race that guards the auth lock. CI runs it on every push
(`.github/workflows/test.yml`). When touching auth, sync, or session code,
run `npm run stress` before shipping.

### Error tracking (Sentry)
`src/lib/sentry.js` -- inert unless the Vercel env var `VITE_SENTRY_DSN` is
set (create a free React project at sentry.io and paste its DSN). No PII is
sent; users are tagged by Supabase user id only.

## Project structure

```
src/
  components/
    VinylVault.jsx     # entire app UI (single large component file)
    AuthScreen.jsx     # login / sign-up screen
    AdminPanel.jsx     # admin user management
  hooks/
    useAuth.js         # Supabase auth state + sign in/out/oauth
    useCollection.js   # collection state, localStorage + Supabase sync
  lib/
    supabase.js        # Supabase client (handles both legacy JWT and publishable keys)
  App.jsx              # root: auth gate -> VinylVault or AuthScreen

api/                   # Vercel serverless functions (all secret keys live here)
  scan.js              # image -> Claude vision -> record identification
  identify.js          # single record identification
  discogs-search.js    # Discogs search proxy
  spotify-features.js  # Spotify preview lookup (audio-features is dead; see lib/spotify.js)
  bpm-report.js        # client waveform BPM results -> shared track_bpm cache
  bpm-arbiter.js       # Claude picks between octave-ambiguous BPM candidates (87 vs 174)
  audio-proxy.js       # preview audio proxy (CORS): Apple, Spotify, Deezer CDNs
  image-proxy.js       # cover art proxy (CORS) for caching covers into storage
  price.js             # Discogs price history
  gelato-order.js      # print-on-demand order
  invite.js            # invite code validation

supabase/
  schema.sql           # full schema (run on a fresh project)
  storage.sql          # storage buckets: avatars (profile photos), covers (cached cover art)
  bpm-cache.sql        # track_bpm shared BPM cache (service-role only)
```

## Security rules

- **All API keys (Anthropic, Discogs, Spotify) live in Vercel environment variables and are accessed only from `/api/*.js` handlers. Never expose them to the client.**
- No em dashes anywhere -- in code comments, docs, copy, or UI strings.

## Environment variables

### Vercel (server-side, used in `/api/*`)
- `ANTHROPIC_API_KEY` -- Claude vision for record identification
- `DISCOGS_TOKEN` -- Discogs API
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` -- Spotify BPM/key lookup
- `GETSONGBPM_API_KEY` -- GetSongBPM (first-pass BPM by artist + title). Free key from getsongbpm.com/api. Requires a visible dofollow backlink to getsongbpm.com (rendered in the Tracks view) or the account is suspended.

### Vercel (client-side, exposed to browser)
- `VITE_SUPABASE_URL` -- Supabase project URL
- `VITE_SUPABASE_ANON_KEY` -- Supabase anon key (legacy JWT `eyJ...` format; see note below)

## Supabase setup

### First-time setup
1. Create a Supabase project
2. Run `supabase/schema.sql` in the SQL editor
3. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel

### Key format note
The app currently uses the **legacy JWT anon key** (`eyJ...`, ~208 chars) from Supabase > Settings > API > "Legacy anon, service_role API keys" tab. The newer `sb_publishable_...` format is supported in `src/lib/supabase.js` but not yet fully verified end-to-end. When Supabase eventually retires legacy keys, swap the Vercel env var to the publishable key -- the client code is already wired for it.

### Migrations (run in Supabase SQL editor)
If applying to an existing database rather than a fresh schema.sql run:

```sql
-- Add avatar_url to profiles
alter table public.profiles add column if not exists avatar_url text;

-- Fix profiles RLS infinite recursion (policies must use is_admin() helper)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id or public.is_admin());
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin());

-- Allow users to update their own profile row
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);
```

Also run when updating an existing database:
- the `records_exist` function from `supabase/social-schema.sql` (accurate chat thumbnail existence check)
- the `covers` bucket section from `supabase/storage.sql` (cover art caching)
- `supabase/bpm-cache.sql` (shared track_bpm cache -- scans and client waveform analysis feed it; later scans of the same tracks read from it)

## Data model

### Collection (localStorage + Supabase `records` table)
Each record is a JSON blob stored in the `data` jsonb column:
- `id` -- local UUID
- `artist`, `title`, `label`, `catalogNumber`, `year`, `country`, `format`
- `genres[]`, `tags[]`
- `crates[]` -- user-assigned crate names (strings)
- `tracklist[]` -- `{ position, title, duration, bpm, bpmSource, bpmConfidence, key, previewUrl, hot }`
  - `bpmSource`: `deezer` | `getsongbpm` | `cache:*` | `waveform` | `waveform+arbiter`
  - `bpmConfidence`: `high` (two independent sources agree) | `low` (sources disagree; dimmed in Tracks view) | null (single source)
- `coverUrl`, `images[]`
- `identified`, `confidence`, `source`, `notes`
- `priceData`, `priceCheckedAt` -- persisted result of the last marketplace price check (`/api/price`): `{ currency, conditions: [{grade, value}], suggestionsStatus, floor, totalListings, checkedAt }`
- `savedAt` -- timestamp

### Sync behaviour
- Always writes to localStorage on every state change (local-first); new records and edits are additionally persisted immediately (not just via the 800ms debounce)
- On login, `dbLoad` merges cloud + local via `planLoadMerge` (`src/lib/collectionMerge.js`, unit-tested). Invariants: a record on this device only leaves the collection via an explicit user delete (tombstoned in `vinylvault_deleted_ids`); a record with an unconfirmed local **edit** (flagged in `vinylvault_dirty_ids`) beats the cloud copy and is re-pushed. Otherwise the cloud copy wins for records it has.
- A 25s background retry re-attempts failed inserts (unsynced records) and failed updates (dirty records) until confirmed -- an expired session or offline period costs latency, never data
- `syncedIds` Set tracks which records are confirmed in Supabase; unsynced records show an amber `!` badge

## Known quirks

- **Auth lock**: `supabase.js` uses a **strictly serialising, bounded-wait** `navigator.locks` auth lock. Cross-context serialisation prevents refresh-token reuse revocation (the "session expired" sign-outs when a PWA window + tab share storage); a 5s cap means a hung holder degrades one call instead of freezing the app. supabase-js never re-enters an injected lock (its `_acquireLock` queues nested acquires internally), so no re-entrancy short-circuit is needed -- and an earlier same-tab short-circuit let refreshes bypass serialisation and replay stale tokens (caught by `stress/race.spec.mjs`; do not reintroduce it).
- **onAuthStateChange deadlock guard**: never `await` a supabase call inside the `onAuthStateChange` callback (`useAuth.js`). supabase-js awaits these callbacks while holding its auth lock; a query there calls `getSession()`, which waits on `initialize()`, which waits on the callback -- a circular wait that wedges the whole client on with-session boots (the historic "profile/admin/community missing until refresh" hydration bug). Dispatch follow-up work with `setTimeout(..., 0)`. Regression-tested by `stress/session.spec.mjs`.
- **Large single file**: all UI lives in `VinylVault.jsx`. When editing, use grep/search to navigate -- the file is ~3000 lines.
- **Crate editing**: only available in the record detail panel (click a card in grid view). The carousel view is read-only for crates.
- **Batch scan**: assigns no crates automatically -- crates are user-organisational only.
