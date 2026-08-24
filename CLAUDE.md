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
npm run lint     # eslint: correctness only (no-undef, unused vars, rules of hooks)
npm test         # unit tests (vitest)
npm run stress   # fault-injection E2E suite (Playwright; see stress/README.md)
npm run bench:barcode # 100-barcode on-device decode benchmark
npm run test:all # lint + unit + stress
```

### Stress suite
`stress/` contains the fault-injection E2E tests: the real app in a real
browser against a mock Supabase (`stress/mock-supabase.mjs`) that faithfully
models refresh-token rotation + reuse revocation. It covers the session
lifecycle (revoked sessions, unreachable auth server, sign-out always works),
the no-data-loss sync invariant under database faults, and the PWA + tab
concurrent-refresh race that guards the auth lock, account isolation on a
shared device, the smart-crate runs (which may only ever ADD crate names), the
file import under Discogs rate limiting (a 429 must never be saved as an
unmatched record), and the rule that a community profile can never become
somebody's home page.
CI runs it on every push
(`.github/workflows/test.yml`). When touching auth, sync, or session code,
run `npm run stress` before shipping.

### Lint
`eslint.config.js` is deliberately narrow: it reports code that is **wrong**,
never code that is merely written differently. The rule that earns its keep is
`no-undef`. All the UI lives in one 7000-line file, Vite bundles an unbound
identifier without a murmur, and the unit tests never render most of it, so an
undefined variable used to reach the browser and show the crash screen there:
`userId` was passed to a hook inside a component that had no such variable, and
only the 12-minute stress suite caught it. `react-hooks/rules-of-hooks` is on
for the same reason. `react-hooks/exhaustive-deps` is off on purpose -- several
effects here deliberately omit dependencies (the auth deadlock guard, the badge
celebration delay), each with a comment saying why, and the rule would bury the
ones that matter. CI runs it on every push.

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
    FileImport.jsx     # CSV/text import hook + status list, shared by home and account
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
  import-worker.js     # background file-import worker (cron + on-demand)
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
  import-jobs.sql      # background import queue + claim_import_job
  profile-privacy.sql  # column grants that keep email + Stripe ids off public profiles
  bpm-cache.sql        # track_bpm shared BPM cache (service-role only)
```

## Security rules

- **All API keys (Anthropic, Discogs, Spotify) live in Vercel environment variables and are accessed only from `/api/*.js` handlers. Never expose them to the client.**
- **A `SECURITY DEFINER` function is public unless you revoke it.** Postgres grants EXECUTE to everyone by default, and Supabase exposes every function in `public` at `/rest/v1/rpc/<name>`, so a definer function is reachable with the anon key that ships in the browser bundle. `upsert_subscription` was live like that: read your own `stripe_customer_id` (checkout writes it to your profile), POST it back with `p_tier: 'resident'`, and you hold the top tier for nothing. Every definer function called only by `/api/*` (which uses the service role, and so bypasses grants) must end with a `REVOKE EXECUTE ... FROM public, anon, authenticated` -- see the end of `payments-schema.sql`. `get_advisors` (Supabase MCP, type `security`) lists any that are still open.
- **RLS is row-level, not column-level.** `profiles_select` lets anyone read a profile whose `is_public` is true, and that means the whole row. The app's own queries ask for a safe handful of columns; nothing stops a client with the anon key asking PostgREST for the rest, and four public profiles were handing out their email address that way. Fixed in `supabase/profile-privacy.sql` with column privileges (`revoke select (email, stripe_customer_id, stripe_subscription_id) ... from anon, authenticated`), which apply per role rather than per row. **The policy itself must keep `is_public = true`**: the community screens read profiles through PostgREST embeds (comment authors, reactors, follower lists) that resolve against this table under this policy, so removing it blanks every name in the community view. Nothing in the browser needs those three columns -- the signed-in user's address is on the auth session as `user.email`, and the Stripe ids are read only by `/api/*` with the service role. The admin panel is the exception and goes through `admin_list_users()`, a definer function that checks `is_admin()` before answering -- **falling back to the table read when that function is not there**, because the client deploys from `main` the moment it is pushed while the SQL is run by hand, and a screen must not break in the window between the two. It did once: the panel reported a missing function on a database that was answering perfectly well. Anything else added to `profiles` that a stranger should not see needs the same revoke.
- **Any endpoint that spends money or third-party quota must call `requireAuth`** (see `api/lib/auth.js`), and the client must send `Authorization: Bearer <token>` using `freshAccessToken()`. Endpoints that legitimately cannot: `stripe-webhook` (verified by Stripe signature), `unsubscribe` (clicked from email, HMAC-signed), and `image-proxy` / `audio-proxy` (loaded by `<img>` / `<audio>`, which cannot send headers). `import-worker` accepts the `CRON_SECRET` bearer (or the `x-vercel-cron` stamp) for the scheduled run and `requireAuth` for the on-demand kick, and is never open. Still unprotected and worth closing: `discogs-search`, `discogs-release`, `discogs-import`, `spotify-features` -- these burn the shared Discogs/Spotify rate limit rather than money, so abuse degrades scanning for everyone.
- No em dashes anywhere -- in code comments, docs, copy, or UI strings.

## Environment variables

### Vercel (server-side, used in `/api/*`)
- `ANTHROPIC_API_KEY` -- Claude vision for record identification
- `DISCOGS_TOKEN` -- Discogs API
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` -- Spotify BPM/key lookup
- `GETSONGBPM_API_KEY` -- GetSongBPM (first-pass BPM by artist + title). Free key from getsongbpm.com/api. Requires a visible dofollow backlink to getsongbpm.com (rendered in the Tracks view) or the account is suspended.
- `UNSUBSCRIBE_SECRET` -- HMAC secret for campaign unsubscribe links (`/api/unsubscribe`). Must match the value used by `scripts/send-campaign.mjs` at send time.
- `CRON_SECRET` -- shared secret Vercel sends as the bearer on cron requests to `/api/import-worker`. Optional but recommended: without it the endpoint falls back to trusting the `x-vercel-cron` header (which Vercel strips from external requests) or a signed-in user's token.

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
- `supabase/profile-privacy.sql` (stops a public profile exposing its email and Stripe ids; also adds `admin_list_users`, which the admin panel now calls instead of selecting the table)
- `supabase/import-jobs.sql` (background file imports; until it is run, imports keep running in the browser and stop when the tab does)
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
- **Three ways to add records**: the home screen has Scan, Upload photos and
  Import (CSV / text) as one row of `AddCard`s. They are laid out as rows on
  mobile and a three-column grid from `sm` up, so all three sit above the fold
  on a 360x740 screen without scrolling; check that when changing the heading
  block above them. The import itself is `useFileImport`
  (`src/components/FileImport.jsx`), shared with the account panel so both
  routes match and de-duplicate by identical rules.
- **The import cap must stay visible**: one file adds up to `IMPORT_ROW_CAP`
  (`src/lib/importParse.js`, 1000) records, because the per-row Discogs lookup
  shares a rate limit with everyone else's scanning. The parser applies the cap
  by default; `useFileImport` deliberately parses with `Infinity` and caps
  itself, so it knows how many rows were left behind and says so in the result.
  It used to truncate silently at 500, which made a 900-record file finish
  looking exactly like a 500-record one that had succeeded.
- **A rate limit is never an answer about a record**: an unmatched import row
  is saved as a draft, so anything that reports "no match" decides what a
  record is. `/api/discogs-search` therefore answers **429** (not an empty
  200) when Discogs rate limits it, and reports the remaining budget so a long
  run can pace itself (`src/lib/importBudget.js`, unit-tested). The import
  waits out a 429 and retries the row; after a full 60s window it stops the
  run rather than drafting the rest of the file. Two things caused the
  original incident, and both must hold: a lookup that matches costs **one**
  Discogs request, with the fuzzy `q` query held back as a fallback and fired
  only when the targeted search comes up empty (`searchDiscogs`,
  `manual: true`); and the run is paced **per request, not per row**.
  `/api/discogs-search` reports both `remaining`
  (`X-Discogs-Ratelimit-Remaining`) and `requests` (what the lookup actually
  spent) for that reason: a row that misses costs two requests, so a list of
  obscure records paced per row runs at nearly double the budget and trips the
  limiter anyway. That was the second version of this bug. `IMPORT_RATE_CAP`
  (`src/lib/importBudget.js`) is 45 of the 60 a minute, leaving the rest for
  live scanning, and `createRateWindow` is a sliding-window backstop under the
  even pacing. Guarded by `stress/import.spec.mjs`.
- **A file that looks like a tracklist is questioned, not imported**: the
  parser reads column one as the artist, which is right for every ordinary
  export and exactly wrong for a release/track listing, where column one is the
  release and column two a track. That shape once produced 432 unmatchable
  drafts in a single upload before anyone noticed. `inspectImportShape`
  (`src/lib/importShape.js`, unit-tested) looks for the giveaways -- titles
  opening with a side and position ("B1."), a separator in the first column, an
  entry repeating once per track -- and the import stops to ask. The offer that
  matters is the third one: column one held the release all along, so
  `releasesFromTrackRows` reads the same file as records and the user imports
  those instead. Importing as it stands stays available, because being told
  what your own file is and not being allowed to proceed is worse than the
  mistake. Thresholds are deliberately not near-certain: asking about a good
  file costs one tap. Guarded by `stress/import.spec.mjs`, both ways round.
- **Duplicate drafts, and why they exist**: record identity is the Discogs
  release id, so an unmatched row (which has none) cannot be de-duplicated on
  import: upload the same file twice and every unmatched row lands twice.
  `planDraftDedupe` (`src/lib/draftDuplicates.js`, unit-tested) finds the
  redundant copies, drives "Remove duplicates" beside "Match unmatched", and
  follows two rules that must not be relaxed: an identified record always beats
  a draft (a draft is the copy that loses, never the other way round), and a
  bracketed suffix is part of the title, because with no release id to check
  against, "Acid Cowboy (Multi Culti)" and "Acid Cowboy" may well be different
  pressings and deleting a record cannot be undone.
- **An import outlives the tab that started it**: rows become a row in
  `public.import_jobs` (`supabase/import-jobs.sql`), `/api/import-worker`
  drains them with the service role, and a Vercel cron (`vercel.json`, every
  two minutes) re-claims anything unfinished. The tab that creates a job calls
  the worker once so it starts immediately, then only watches the job row, so
  a locked phone or a closed browser no longer abandons the rest of the list;
  reopening the app rejoins the same run. Double-processing is prevented by
  `claim_import_job` (`for update skip locked` + `locked_until`) -- a double
  claim would add every record twice, and a bulk import cannot be un-done.
  **The in-browser loop is still there and still maintained**: it is the
  fallback whenever the job insert fails (the migration has not been run on
  this database), so the two paths must keep producing the same records.
  `api/lib/importRecord.js` mirrors `recordFromRelease`'s whitelist for exactly
  that reason, checked by `api/lib/__tests__/import-record.test.js`.
- **Unmatched imports can only be repaired in place**: de-duplication keys on
  the Discogs release id (`addRecordsBulk`) and a draft has none, so importing
  the same file again adds a second copy of every unmatched row rather than
  fixing it. `retryUnmatched` (`useFileImport`) looks each draft up again and
  patches the existing record, reached from "Match unmatched" on the import
  result and in the account panel's import section.
- **Failed BPM lookups must be cached**: `detectBPM` (`VinylVault.jsx`) keys
  `bpmCache` by preview URL, and EVERY exit including the fetch failures must
  `bpmCache.set(previewUrl, null)`. Two failure paths once returned without
  caching, so a preview URL that no longer resolves was re-fetched on every
  render; the Tracks view's `triedRef` only guards a single mount, so
  navigating back and forth replayed the whole dead batch and put dozens of
  failing requests through `/api/audio-proxy` in seconds.
- **`audio-proxy` status codes carry meaning**: an upstream 4xx is a preview
  that has expired or been withdrawn, so it answers 404. Only a genuinely
  broken upstream is 502, and a hung one is 504. Returning 502 for a dead link
  turned an ordinary missing resource into a platform error alert.
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
