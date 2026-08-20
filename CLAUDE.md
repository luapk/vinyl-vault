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
npm run bench:barcode # 100-barcode on-device decode benchmark
npm run test:all # both
```

### Stress suite
`stress/` contains the fault-injection E2E tests: the real app in a real
browser against a mock Supabase (`stress/mock-supabase.mjs`) that faithfully
models refresh-token rotation + reuse revocation. It covers the session
lifecycle (revoked sessions, unreachable auth server, sign-out always works),
the no-data-loss sync invariant under database faults, and the PWA + tab
concurrent-refresh race that guards the auth lock, account isolation on a
shared device, the smart-crate runs (which may only ever ADD crate names), and
the rule that a community profile can never become somebody's home page.
CI runs it on every push
(`.github/workflows/test.yml`). When touching auth, sync, or session code,
run `npm run stress` before shipping.

### Barcode scanning
The camera's Barcode mode decodes on-device from the live preview (no shutter,
no upload): `src/lib/barcodeScanner.js` uses the native `BarcodeDetector` where
it exists and otherwise a lazily-loaded ZXing WASM build, served from our own
origin (`public/zxing_reader.wasm`, not the library's default CDN). Reads are
checksum-validated (`src/lib/ean13.js`) before being sent, so a partial read is
dropped rather than looked up. The decoded number goes to `/api/scan` as
`{ barcode }`, which skips Claude entirely and does a single Discogs barcode
search. `npm run bench:barcode` renders 100 barcodes under camera-like
degradation and reports read rate and decode time.

### Error tracking (Sentry)
`src/lib/sentry.js` -- inert unless the Vercel env var `VITE_SENTRY_DSN` is
set (create a free React project at sentry.io and paste its DSN). No PII is
sent; users are tagged by Supabase user id only.

## Project structure

```
src/
  components/
    VinylVault.jsx     # entire app UI (single large component file)
    TrackRow.jsx       # one tracklist row; shared by record detail and community
    AuthScreen.jsx     # login / sign-up screen
    AdminPanel.jsx     # admin user management
    Badges.jsx         # milestone unlock card + the grid in the account panel
  hooks/
    useAuth.js         # Supabase auth state + sign in/out/oauth
    useCollection.js   # collection state, localStorage + Supabase sync
  lib/
    supabase.js        # Supabase client (handles both legacy JWT and publishable keys)
    badges.js          # milestone ladder + earned/celebrated logic (unit-tested)
    collectionFocus.js # decade buckets + the genre/decade slice filter (unit-tested)
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

email/                 # founder campaign email
  founder-resident.html  # the build (also .txt for the plain-text part)
  README.md              # send runbook: domain auth, env vars, dry run, send

scripts/
  send-campaign.mjs    # CSV -> Resend batch send, signed unsubscribe per recipient

supabase/
  schema.sql           # full schema (run on a fresh project)
  storage.sql          # storage buckets: avatars (profile photos), covers (cached cover art)
  bpm-cache.sql        # track_bpm shared BPM cache (service-role only)
```

## Security rules

- **All API keys (Anthropic, Discogs, Spotify) live in Vercel environment variables and are accessed only from `/api/*.js` handlers. Never expose them to the client.**
- **Any endpoint that spends money or third-party quota must call `requireAuth`** (see `api/lib/auth.js`), and the client must send `Authorization: Bearer <token>` using `freshAccessToken()`. Endpoints that legitimately cannot: `stripe-webhook` (verified by Stripe signature), `unsubscribe` (clicked from email, HMAC-signed), and `image-proxy` / `audio-proxy` (loaded by `<img>` / `<audio>`, which cannot send headers). Still unprotected and worth closing: `discogs-search`, `discogs-release`, `discogs-import`, `spotify-features` -- these burn the shared Discogs/Spotify rate limit rather than money, so abuse degrades scanning for everyone.
- No em dashes anywhere -- in code comments, docs, copy, or UI strings.

## Environment variables

### Vercel (server-side, used in `/api/*`)
- `ANTHROPIC_API_KEY` -- Claude vision for record identification
- `DISCOGS_TOKEN` -- Discogs API
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` -- Spotify BPM/key lookup
- `GETSONGBPM_API_KEY` -- GetSongBPM (first-pass BPM by artist + title). Free key from getsongbpm.com/api. Requires a visible dofollow backlink to getsongbpm.com (rendered in the Tracks view) or the account is suspended.
- `UNSUBSCRIBE_SECRET` -- HMAC secret for campaign unsubscribe links (`/api/unsubscribe`). Must match the value used by `scripts/send-campaign.mjs` at send time.

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

-- Fix profiles RLS infinite recursion (policies must use is_admin() helper).
-- NOTE the `is_public` clause: without it, non-admin users cannot read anyone
-- else's profile and every community profile reports "Profile not found".
-- An earlier version of this block omitted it and broke exactly that.
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
drop policy if exists "profiles_select" on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_select" on public.profiles
  for select using (auth.uid() = id or public.is_admin() or is_public = true);
create policy "profiles_admin_update" on public.profiles
  for update using (public.is_admin());

-- Campaign email opt-out (set by /api/unsubscribe)
alter table public.profiles
  add column if not exists marketing_opt_out boolean not null default false;

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
- `tracklist[]` -- `{ position, title, artist, duration, bpm, bpmSource, bpmConfidence, key, previewUrl, hot }`
  - `artist`: set only on compilations, where each track has its own artist and
    the release artist is just "Various". Null on single-artist releases, where
    repeating the name on every row would be noise.
  - `bpmSource`: `deezer` | `getsongbpm` | `cache:*` | `waveform` | `waveform+arbiter`
  - `bpmConfidence`: `high` (two independent sources agree) | `low` (sources disagree; dimmed in Tracks view) | null (single source)
- `coverUrl`, `images[]`
- `identified`, `confidence`, `source`, `notes`
- `priceData`, `priceCheckedAt` -- persisted result of the last marketplace price check (`/api/price`): `{ currency, conditions: [{grade, value}], suggestionsStatus, floor, totalListings, checkedAt }`
- `savedAt` -- timestamp

### Local cache is per user
Every localStorage key is scoped to the signed-in user id
(`vinylvault_collection:<uid>` and friends). The cache renders before the cloud
load lands, so a global key meant that on a shared browser the previous
account's records were shown to whoever signed in next -- and because the merge
never drops local records, they were then written into the new user's account.
Nothing is read or written while signed out. Pre-scoping blobs are moved to
`vinylvault_orphaned_*` rather than adopted (they cannot be attributed to an
owner) so nothing is destroyed. Guarded by `stress/accounts.spec.mjs`.

### Local storage budget
Scanned records carry their photo as a base64 data URL (a 1500px JPEG), so a
few dozen records exceed the ~5MB localStorage quota. `src/lib/localCache.js`
writes the collection slimmed: photos are kept only for records with no
confirmed DB row (where this device holds the only copy) and dropped for the
rest, and if it still does not fit the cache degrades in stages (drop remaining
photos, then the oldest records) rather than failing. Every other localStorage
write goes through `safeSetItem`: a full quota once threw inside a React state
updater and took the whole app down with the crash screen.

### Sync behaviour
- Always writes to localStorage on every state change (local-first); new records and edits are additionally persisted immediately (not just via the 800ms debounce)
- On login, `dbLoad` merges cloud + local via `planLoadMerge` (`src/lib/collectionMerge.js`, unit-tested). Invariants: a record on this device only leaves the collection via an explicit user delete (tombstoned in `vinylvault_deleted_ids`); a record with an unconfirmed local **edit** (flagged in `vinylvault_dirty_ids`) beats the cloud copy and is re-pushed. Otherwise the cloud copy wins for records it has.
- A 25s background retry re-attempts failed inserts (unsynced records) and failed updates (dirty records) until confirmed -- an expired session or offline period costs latency, never data
- `syncedIds` Set tracks which records are confirmed in Supabase; unsynced records show an amber `!` badge

### Milestone badges
Nine space-themed tiers (50, 100, 200, 350, 500, 1000, 2000, 3500, 5000) in
`src/lib/badges.js`, rendered by `src/components/Badges.jsx`: a full-screen
acid unlock card with a Web Audio fanfare, a `BadgeChip` rank beside the
record count on a community profile, and `BadgesPanel`, its own sheet
(reached from the Badges row under Profile in the account panel, or from the
unlock card) where everything ahead of the user is greyed out up to 5,000.

- The trigger is `collection.length`, watched in one effect rather than hooked
  into each save, so every route in counts the same: single scan, batch,
  Discogs import, file import. The evaluation is delayed 1.5s so the cloud
  load has landed; without it a returning user got a card for 50 and then
  another for 500 a second later.
- **Only ever one card.** `planCelebration` returns the highest tier earned
  but not yet celebrated and banks the rest silently, so a 600-record import
  (or an existing collector meeting the system for the first time) gets one
  moment, not six.
- The card waits for a clear screen: never over a running batch, never on top
  of the account panel it links to.
- **Unlock dates are derived, not stored.** A collection reached its 50th
  record on the day its 50th record was saved, so `unlockDates` reads the Nth
  oldest `savedAt` (`src/lib/badges.js`). That dates the badges a long-standing
  collector earned years ago truthfully, instead of stamping them all with the
  day the feature shipped, and it needs no migration. The ledger's `unlockedAt`
  is only a fallback for a tier the collection can no longer account for
  (records deleted since).
- **Somebody else's rank is derived, not fetched.** `highestEarned(count)` is a
  pure function of the collection size, so the chip on a public profile needs
  nothing from that person's device: their ledger is local to them, but their
  record count is already public. Below 50 records it renders nothing rather
  than a "no badge yet" marker.
- The ledger (`vinylvault_badges:<uid>`) is local and user-scoped like every
  other local key. It is unioned with what the count has earned, so deleting
  records never takes a badge away. Being local, a first sign-in on a new
  device replays the single highest card once; that is a welcome, and it costs
  no schema change.

- **Auth lock**: `supabase.js` uses a **strictly serialising, bounded-wait** `navigator.locks` auth lock. Cross-context serialisation prevents refresh-token reuse revocation (the "session expired" sign-outs when a PWA window + tab share storage); a 5s cap means a hung holder degrades one call instead of freezing the app. supabase-js never re-enters an injected lock (its `_acquireLock` queues nested acquires internally), so no re-entrancy short-circuit is needed -- and an earlier same-tab short-circuit let refreshes bypass serialisation and replay stale tokens (caught by `stress/race.spec.mjs`; do not reintroduce it).
- **onAuthStateChange deadlock guard**: never `await` a supabase call inside the `onAuthStateChange` callback (`useAuth.js`). supabase-js awaits these callbacks while holding its auth lock; a query there calls `getSession()`, which waits on `initialize()`, which waits on the callback -- a circular wait that wedges the whole client on with-session boots (the historic "profile/admin/community missing until refresh" hydration bug). Dispatch follow-up work with `setTimeout(..., 0)`. Regression-tested by `stress/session.spec.mjs`.
- **Compilation track artists**: Discogs sends a per-track `artists` array on
  compilations; `trackArtist` (`api/lib/discogs.js`, unit-tested) keeps it. It
  is not only for display -- every preview and BPM lookup prefers it over the
  release artist, because searching "Various - Song Title" matches nothing, and
  writing a whole compilation into the shared `track_bpm` cache under "various"
  would pollute it for everyone. Note that `recordFromRelease`
  (`useCollection.js`) whitelists track fields: a field missing from that map
  survives the scan screen and then disappears on save.
- **User cover photos**: any image strip ends with an add-your-own tile
  (`AddCoverTile`). The upload goes to the same `covers` bucket as cached
  Discogs art, whose per-user RLS policies already exist in
  `supabase/storage.sql`, so there is no migration. A failed upload falls back
  to a local data URL: the photo is never lost, it just does not sync.
- **Stats bars open the collection**: tapping a genre row, decade bar, label
  row or crate chip on the Stats tab focuses the collection on that slice,
  browsed in whichever view mode the user last used, exactly like a crate. A
  crate chip drives the crate filter that already exists rather than a second
  mechanism that looks the same. Because the stats are computed over the whole
  collection, opening one clears the search box and the other filter, or a bar
  reading 42 would land on fewer than 42 with nothing to explain the gap. The decade buckets live in
  `src/lib/collectionFocus.js` and are shared by the chart and the filter: two
  copies would drift, and the failure is quiet (a bar reading 42 that opens
  onto 39). The focus is owned by `CollectionView`, which unmounts on
  navigation, so the collection is always whole when you come back to it.
- **Large single file**: all UI lives in `VinylVault.jsx`. When editing, use grep/search to navigate -- the file is ~3000 lines.
- **Crate editing**: only available in the record detail panel (click a card in grid view). The carousel view is read-only for crates.
- **Community profile routing**: which profile is open lives in
  `history.state.u`, **never in the address bar**. `?u=` is accepted only as an
  inbound shared link, consumed once, and stripped on the first render. Putting
  it in the URL made the browser's own restore behaviour a bug: tap a profile,
  switch away, and the tab the phone restores hours later reopens a stranger's
  profile. Guarded by `stress/profile-link.spec.mjs`. Sharing is unaffected --
  the share button builds its link from `window.location.origin`.
- **Batch scan**: assigns no crates automatically -- crates are user-organisational only.
- **Smart crates**: two runs. `mode: 'full'` sorts the whole collection from
  scratch and replaces the suggestion list. `mode: 'unfiled'` (the default action
  once a collection has been sorted once) sends only records in **no crate at
  all**, passes the existing crates with their descriptions, and asks Claude to
  file into those first. A record the user filed by hand is never sent and never
  touched. Applying a run only ever ADDS crate names, so a bad run costs a
  tidy-up, never a record (`stress/crates.spec.mjs`). Descriptions are persisted
  in `vv_smart_crate_meta` because the next unfiled run needs them to file
  accurately; `vv_smart_crate_names` is still written for backwards
  compatibility. Claude is told to leave a record unfiled rather than force a
  weak grouping, so partial coverage is normal -- the results modal says so
  explicitly ("Filed 42 of 58 records") because silence read as a bug.
