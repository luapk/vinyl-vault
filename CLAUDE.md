# Found Sound (repo: vinyl-vault)

**The product is called Found Sound.** It was renamed from Vinyl Vault, and the
rename is deliberately skin-deep: every user-facing mention reads `APP_NAME`
from `src/lib/brand.js`, while everything behind the scenes keeps its original
name on purpose.

Still called vinyl-vault, and staying that way: the repo, the Vercel project,
the `vinyl-vault-teal.vercel.app` domain, the Supabase tables, the service
worker cache names, and the `vinylvault_*` localStorage keys. Renaming a
storage key orphans the cache on every device that already holds one, and
nobody sees any of these. Do not "finish the rename" by touching them.

The logo comes in two lockups. The HORIZONTAL one is a keyline lozenge
holding the wordmark, with the subline ("YOUR VINYL, SORTED") set beneath it.
The STACKED one (`public/logo-block-*.svg`, `BLOCK` in `src/lib/brand.js`) is
FOUND over SOUND inside a rounded keyline, and it is what the app header uses.

Stacking works because of a property of the name: FOUND and SOUND are five
letters each differing only in the first, so at matched cap height they are
2605.5 and 2644.2 units wide, 2.5% apart. The horizontal mark is 3.90:1 and
the full stamp 2.77:1; the block is 1.33:1. In the header that turns 132.5px
of a 360px top bar into 64px, which is what stopped the nav row scrolling
sideways. The 2.5% is resolved by scaling FOUND up so the edges sit flush,
costing about 1px of cap height in 40: a flush edge reads as deliberate where
a 2.5% rag reads as a mistake. Header height is 48px, chosen on cap height
rather than box height, which puts the words at 14.3px against the horizontal
mark's 15.8px at 34px: smaller per line, but two lines carry the name.

**Every logo file in `public/` is generated**, by `brand/stamp.py` and
`brand/stacked.py` from the potrace traces in `brand/traces/`. Do not
hand-edit one: the next run overwrites it. Both scripts are deterministic and
reproduce all nine files byte for byte, which is the check to run after
touching anything in `brand/`. The original artwork the traces came from is
NOT in the repo, so those two trace files are the source of truth for the
letterforms. See `brand/README.md`. The subline justifies to the lozenge's own
measure where the string is long enough to do that at a readable setting, and
is centred at a capped 0.42em tracking where it is not. Uppercase stops reading
as a phrase past roughly that, and a short subline justified to this measure
needs over 1em to reach the edges. `public/logo-stamp-{acid,white,black}.svg` is the
full lockup; `public/logo-mark-*.svg` is the same stamp without the subline,
for anywhere too small to read it. The app header is exactly that case: the
stamp's subline is mush at 34px and only sharpens from 48 on a 2x screen or
56 on a 1x one, so the header carries the MARK and no subline at all.

**The tagline lives in the home screen's eyebrow slot instead**, where
"New scan" used to be. That slot was labelling a screen you had already
navigated to, and the word NEW SCAN still does real work on the two buttons
that carry it (disambiguation and result). The home screen is the one
everybody lands on, so the line is read once on arrival at a size that can
hold it, rather than sitting over every screen in the app forever. It keeps
the eyebrow's own mono voice rather than the logo's Hanken setting: it is in
the app's eyebrow position, not under the lozenge, and borrowing the
lockup's typography outside the lockup is how a wordmark stops being one.

A live-text subline under the mark was built and measured before this, and
it worked (8px at 0.34em tracking, which is what puts it flush with the
lozenge's 132.5px measure; the artwork's 0.42em is a cap, not a target, and
overshoots by 10px at that size). It is in the git history if it is ever
wanted back. Note the trap if so: letter-spacing leaves a trailing space
after the last letter, so an equal `text-indent` is needed to re-centre the
glyphs.

`STAMP` and `STAMP_MARK` in `src/lib/brand.js` hold the paths, and an `<img>`
cannot inherit `currentColor`, so the call site picks a colour rather than
theming it.

Every part is outlines, the subline included: it was converted from Hanken
Grotesk rather than set as live text, so the logo never waits on a webfont and
carries no font licence into a trademark filing.

The Vinyl Vault era `logo*.png` files and the interim `wordmark-*` files have
been deleted. One known cost: confirmation emails already delivered pointed at
`logo.png` (and later `wordmark-white.png`), so the image in that old mail is
now broken. Restoring either file from git history would fix it.

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
somebody's home page, the About route and its walkthrough carousel, the wishlist and Trace rules (a pinned record
survives a reload with no wishlist tables on the database, a rate limit is
never shown as no match, and Trace spends no Discogs quota for a user who
cannot use it), and the home screen's four ways in (all above the fold at
360x740, and the scan card's state rule absent on an empty collection).
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

### Tiers, and where they are enforced
`FEATURE_TIER` in `src/lib/pricing.js` is the single map of what each tier buys,
read by the client gates, the server gates and the pricing screen alike. A
feature absent from the map is free to everyone, on purpose: a gate should have
to be written down.

| Feature | Tier | Enforced |
| --- | --- | --- |
| Unlimited scans | Selector | `api/scan.js`, server |
| Wishlist tab | Selector | client only |
| Smart crates | Selector | `api/smart-crates.js`, server |
| BPM sorter (Tracks) | Resident | client only |
| Trace | Resident | `api/trace.js`, server |

- **Anything that spends money or third-party quota is gated on the server**,
  via `requireTier` (`api/lib/tier.js`). Hiding a button is not a gate: smart
  crates sends up to 2MB to Claude and asks for 8192 tokens back, and Trace
  spends three or four Discogs requests a hunt. The two client-only gates guard
  views over data the user already owns, so there is nothing to abuse.
- **`requireTier` fails CLOSED.** A profile it cannot read answers 503, not
  access. Failing open would make an unreachable database the cheapest way to
  use a paid feature.
- **A lapsed subscriber is a free user, not an exempt one.** `tierAllows` takes
  `isActive` for that reason. The scan limit was once skipped unless the
  subscription was active, so cancelling granted unlimited scans: the one status
  that should have restricted a person was the one that let them through.
- **Do not put a claim on the pricing card that nothing checks.** Label
  printing, CSV export and multi-device sync were all sold on Selector and none
  was ever enforced, which made two thirds of that tier things the free tier
  already had. `FREE_LABELS` is still exported and still unenforced; it is
  annotated as such and no copy claims it.
- Camelot key notation was removed from the product entirely. Track `key` may
  still arrive in scan data, but nothing displays it.

### The admin panel, and where its numbers come from
`src/components/AdminPanel.jsx` is three screens: Money, People, Features.

- **The feature matrix edits the gate, not a copy of it.** `public.feature_tiers`
  holds one row per overridden feature and both the client gates
  (`useFeatureTiers` -> `setFeatureTierOverrides`) and the server gates
  (`requireTier` -> `refreshFeatureOverrides`, cached 60s) read it. It **layers
  over** `FEATURE_TIER` rather than replacing it, which is the direction that
  fails safe: a table that is empty, missing or unreachable leaves the product
  exactly as shipped, where replace-on-load would turn every paid feature free
  the first time the query fell over. `scanUnlimited` moves the scan cap in
  `api/scan.js` too, because the limit is derived from the same gate rather than
  a second table beside it. What it does NOT move is the pricing page's written
  copy, and the panel says so on screen.
- **Money is a ledger, not a projection.** `public.payments` takes one row per
  payment Stripe reports as collected, keyed on Stripe's own invoice or session
  id so a webhook redelivery updates the row instead of counting the money
  twice. "Committed / year" is a separate figure from "Taken", and is labelled
  as such: one is what live subscriptions are set to bill, the other is money
  that actually arrived. Both are integers in minor units all the way to the
  formatter.
- **AI spend is measured, not estimated.** `api/lib/aiUsage.js` books every
  Anthropic response with the token counts the API itself reported, prices it at
  the published rate and stores the cost as well as the tokens (rates change,
  and what a call cost on the day is not recoverable from a later rate card).
  The request context rides on an `AsyncLocalStorage` so `vision.js` does not
  need to know who is scanning, and rows are flushed once, awaited, at the end
  of the handler: an unawaited insert on a serverless function is a row that
  arrives only if the instance outlives the response. An **unknown model prices
  at the dearest rate in the table**, never zero, for the same reason an unknown
  origin gets the expensive shipping corridor.
- **Both ledgers are unreadable from the browser**: RLS on, no policy at all, so
  every anon and authenticated select returns nothing whatever PostgREST is
  asked for. The panel reads them through `admin_metrics()` and the extended
  `admin_list_users()`, definer functions that check `is_admin()` first. The
  record count comes from there too now, instead of the client selecting every
  row of `records` to count them.
- **The panel must not break on a database where the migration has not been
  run**, the same rule `admin_list_users` already followed: `admin_metrics()`
  answering nothing shows a banner naming the file to run, and the users list
  falls back to the old shape.

### Wishlist and Trace
The Wishlist tab (`src/components/Wishlist.jsx`, `src/hooks/useWishlist.js`) is
one screen doing two jobs: what you are hunting, and what each one costs. Search
resolves through the same `/api/discogs-search` the scan screen uses, picking a
result pins it, and the crosshair beside a pinned row fires `/api/trace`. The
result renders under that row and is stored, so coming back shows the answer
rather than paying for it again.

- **Trace runs only on endpoints the app is permitted to use.** The release
  document, the versions list off its master, marketplace stats and price
  suggestions. It does not scrape marketplaces, hold a copy of the Discogs
  database, or make model calls -- every figure is a fetch or arithmetic, which
  is what lets the card name a source for each one. Bolting a scraper onto this
  changes the legal position of the whole product, not just the feature.
- **The landed cost is the point, and it is an estimate.** `src/lib/landedCost.js`
  (unit-tested) turns an asking price plus an origin into a total: FX, corridor
  shipping by weight band, UK import VAT, duty, courier handling, card spread.
  It exists because sorting by asking price is wrong whenever the objects being
  compared sit in different countries. Two rules it must keep: an unknown
  currency returns null rather than pricing yen as pounds, and an unknown origin
  gets the EXPENSIVE corridor, because an under-estimate is the failure that
  costs the user money. The 135 GBP threshold moves WHERE VAT is paid, not
  whether -- treating cheap imports as VAT-free would understate every one.
- **Discogs reports where a pressing was MADE, not where the copy sits.** The
  card says so in as many words. Anything that prints a landed total has to keep
  that sentence, or the number becomes a claim about somebody's money that the
  data does not support.
- **The verdict is deterministic, not generated.** Thresholds live in
  `api/lib/trace.js` so they can be argued with, they cost nothing per hunt, and
  they cannot invent a sentence nobody can check. It never asserts authenticity
  and never tells the user to buy.
- **The card says each thing once.** It first shipped printing the landed total
  twice, the cheapest copy twice, the transit window twice and the origin twice,
  which made the panel about twice as long as the information in it. A verdict
  note now earns its place only by saying something no figure on the card says,
  so `buildVerdict` emits supply judgement and the pressing warning and nothing
  that is already a number on screen. `stress/wishlist.spec.mjs` asserts the
  total appears exactly once.
- **The cost breakdown is a two-tone bar, not a table.** The split that matters
  is the record against the freight, not a league table of fees, and one accent
  plus one neutral is what the dataviz palette checks actually clear at that
  size: three or more greys fall under the normal-vision separation floor. Both
  segments are direct-labelled with name and value, which is what makes the
  two-tone encoding legal and keeps identity off colour alone. Named fees sit in
  one mono line beneath, so nothing is hidden.
- **Load merges, it does not replace.** Both items and stored results keep
  anything local the cloud does not have. An empty cloud result would otherwise
  wipe a card added while the insert was failing -- offline, or before
  `supabase/wishlist.sql` has been run -- which is the same no-data-loss rule the
  collection merge follows. Both bugs were real and are guarded by
  `stress/wishlist.spec.mjs`.
- **Trace is gated server-side.** `api/trace.js` checks the tier before spending
  any Discogs quota; hiding the button would leave the endpoint open to anyone
  holding a token. **The tab is gated too**, on Selector, client-side (see the
  tier table above). This paragraph used to claim the opposite, which left the
  wishlist specs running as a free account that could not open the tab they
  were testing: three of them failed for months against code that was doing
  what the tier table said. The two gates stack on purpose, and the seam
  between them is the interesting case: a SELECTOR account reaches the
  wishlist and pins a record, and is still refused Trace by the server. That
  is what `stress/wishlist.spec.mjs` exercises.
- **A rate limit is not an answer about a record**, the same rule the file import
  follows: a 429 from the search must never render as "no match", or the user
  pins a cold case that would have resolved a minute later.
- FX uses a table in `landedCost.js` with its date shown on the card;
  `api/lib/trace.js` tries a live ECB rate first and falls back silently. A rate
  that fails must never leave the card with no number.

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
    Wishlist.jsx       # the Wishlist tab: pin a record, trace it, keep the answer
  hooks/
    useAuth.js         # Supabase auth state + sign in/out/oauth
    useCollection.js   # collection state, localStorage + Supabase sync
    useWishlist.js     # wishlist items + stored trace results
    useFeatureTiers.js # tier overrides from the database, layered over the shipped map
  lib/
    supabase.js        # Supabase client (handles both legacy JWT and publishable keys)
    badges.js          # milestone ladder + earned/celebrated logic (unit-tested)
    collectionFocus.js # decade buckets + the genre/decade slice filter (unit-tested)
    homeStats.js       # the count + last-added line on the home scan card (unit-tested)
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
  trace.js             # one hunt: pressings, live listings, landed cost, verdict
  lib/aiUsage.js       # books every Claude call to the ai_usage ledger
  gelato-order.js      # print-on-demand order
  invite.js            # invite code validation

brand/                 # the logo toolchain: public/logo-*.svg is GENERATED
  stamp.py             # the horizontal lozenge -> logo-stamp-*, logo-mark-*
  stacked.py           # FOUND over SOUND -> logo-block-*  (--variants for the rest)
  letters.py           # pulls individual letters out of a potrace trace
  traces/              # potrace output; the source of truth for the letterforms
  fonts/               # Hanken Grotesk, a build input for the subline outlines
  README.md            # how to regenerate, and the one known colour inconsistency

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
  wishlist.sql         # wishlist_items + trace_results (Wishlist tab)
  admin-analytics.sql  # feature_tiers overrides, billing columns, payments + ai_usage ledgers
```

### Legal pages and the footer
`public/legal/{terms,privacy,refunds}.html` are **plain static HTML, not app
views**, served at `/terms`, `/privacy` and `/refunds` by rewrites that sit
BEFORE the SPA catch-all in `vercel.json` (after it, they would never match).
They are deliberately outside React: they have to render when the bundle fails,
when the reader is signed out, and when Stripe's reviewer loads them cold. They
load no webfont, which also keeps the privacy page from making a third-party
request while explaining third-party requests.

Highlighted placeholders are live on those pages and MUST all be filled before
taking payment: `[LEGAL NAME]`, `[PLACE OF REGISTRATION]`, `[COMPANY NUMBER]`,
`[TRADING ADDRESS]`, `[SUPPORT EMAIL]` and `[PRIVACY CONTACT EMAIL]`. They are
styled to be impossible to miss rather than hidden in a comment. The registered
number and place of registration are not optional politeness: a UK company must
publish both on its website (Companies Act 2006 s.82, and reg 25 of the Names and
Trading Disclosures Regulations 2015), and the entity named here has to be the one
that holds the Stripe account, or the mismatch is a review flag.

`SiteFooter` renders under `<main>` on every signed-in screen and is the only
route to `AboutView`, which existed in the file unrendered for a long time, so
the one page explaining the product could not be opened by anyone. That route
is now asserted by `stress/about.spec.mjs` rather than trusted.

**About opens on the first-run walkthrough, as a carousel.** `WalkthroughCard`
is shared by `WalkthroughOverlay` and `AboutWalkthrough`, and everything above
the footer is identical in both on purpose: the point of putting it on About
is that it is the thing the user already saw. Only the controls differ. On the
overlay it is a sequence, so the rail fills up to the current step and there
is a Skip. On About nothing is in sequence, so it wraps at both ends, the rail
becomes real buttons that mark only the current step, and there is no Skip,
because nothing is being skipped. A filled-to-here rail would imply a progress
the reader is not making.

This replaced a second "How it works" grid on About that explained the same
four steps with `video: null` placeholder icons, because no clip was ever
wired into it. Two explanations of one product, one of them without the
artwork. Do not reintroduce it: the walkthrough steps are the single copy.

**The walkthrough clips are transparent, and must stay that way.** They are
animated WebP with an alpha channel and no background; the acid comes from
`WalkthroughCard`, which is `#cafe04`. Each clip originally baked in its own
background, and all four greens were different and none was `#CAFE04`
(`#C3F400`, `#C1EF00`, `#C3EE00`, `#C0EE00`), so every clip sat on the card
as a visible rectangle of slightly wrong green. Keying them out costs 1.7MB
across the set and is worth it: it fixes the seam, and it means the brand
colour lives in exactly one place instead of being baked into four binaries
that nobody would think to re-export. `public/walkthrough/BRIEFS.md` has the
two-step key and the trap in it.

## Security rules

- **All API keys (Anthropic, Discogs, Spotify) live in Vercel environment variables and are accessed only from `/api/*.js` handlers. Never expose them to the client.**
- **A `SECURITY DEFINER` function is public unless you revoke it.** Postgres grants EXECUTE to everyone by default, and Supabase exposes every function in `public` at `/rest/v1/rpc/<name>`, so a definer function is reachable with the anon key that ships in the browser bundle. `upsert_subscription` was live like that: read your own `stripe_customer_id` (checkout writes it to your profile), POST it back with `p_tier: 'resident'`, and you hold the top tier for nothing. Every definer function called only by `/api/*` (which uses the service role, and so bypasses grants) must end with a `REVOKE EXECUTE ... FROM public, anon, authenticated` -- see the end of `payments-schema.sql`. `get_advisors` (Supabase MCP, type `security`) lists any that are still open.
- **RLS is row-level, not column-level.** `profiles_select` lets anyone read a profile whose `is_public` is true, and that means the whole row. The app's own queries ask for a safe handful of columns; nothing stops a client with the anon key asking PostgREST for the rest, and four public profiles were handing out their email address that way. Fixed in `supabase/profile-privacy.sql` with column privileges, which apply per role rather than per row. **A column-level `revoke` cannot subtract from a table-wide `grant`**: `anon` and `authenticated` held plain SELECT on the whole table, so `revoke select (email, ...)` reported success and changed nothing, and `has_column_privilege` still said true. The working form revokes SELECT on the table and grants back the safe columns by name, which also means a column added later is private until somebody lists it. Check it with `has_column_privilege`, never with a successful-looking revoke. **The policy itself must keep `is_public = true`**: the community screens read profiles through PostgREST embeds (comment authors, reactors, follower lists) that resolve against this table under this policy, so removing it blanks every name in the community view. Nothing in the browser needs those three columns -- the signed-in user's address is on the auth session as `user.email`, and the Stripe ids are read only by `/api/*` with the service role. The admin panel is the exception and goes through `admin_list_users()`, a definer function that checks `is_admin()` before answering -- **falling back to the table read when that function is not there**, because the client deploys from `main` the moment it is pushed while the SQL is run by hand, and a screen must not break in the window between the two. It did once: the panel reported a missing function on a database that was answering perfectly well. Anything else added to `profiles` that a stranger should not see needs the same revoke.
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
- `supabase/wishlist.sql` (the Wishlist tab; until it is run the tab works but saves to this device only)
- `supabase/admin-analytics.sql` (the advanced admin panel: editable feature gates, billing detail on the profile, and the payments + AI spend ledgers. Until it is run the panel shows accounts and tiers only and says so, and nothing is recorded)

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
- **Four ways to add records**: the home screen has Scan as a hero `AddCard`
  and then Photos, A file and Search as a row of three beneath it. Searching
  by name is one of the four, not a footnote under them: for anybody who knows
  what they own it is the fastest route in, and it used to be the faintest
  thing on the screen. All four sit above the fold on a 360x740 screen, which
  `stress/home.spec.mjs` now asserts rather than asking a human to remember
  when the heading block changes. The import itself is `useFileImport`
  (`src/components/FileImport.jsx`), shared with the account panel so both
  routes match and de-duplicate by identical rules.
- **The hero card earns its size, it does not just have it.** It is the
  biggest object on the home screen and for a long time it held an icon and
  six words, spending about 180px of a 740px phone to say "Scan a record". A
  rule along its bottom now carries what only this collection can say: how big
  it is and when it last grew (`src/lib/homeStats.js`, unit-tested). Two rules
  there. An empty collection shows **no rule at all** rather than "0 in the
  crate, last added never". And the labels are calendar days, not elapsed
  hours, so a record saved four minutes before midnight reads as "Yesterday"
  the moment the date turns, instead of rounding to "Today". The rule is also
  sized for the longest it can ever be, not for the test data: at 10px it
  truncated the count on a five-figure collection, which the spec now checks.
- **Acid marks the primary action, not every action.** `tone` on `AddCard` is
  what carries the ranking in colour. All four tiles used to be the brand acid,
  which is the only filled colour on the screen, so it distinguished nothing:
  the code argued the four were not equals while the paint said they were. Only
  the hero is acid now. The ghost tile the other three use is **not** the old
  glass tile that was removed for being "a grey square on a grey card": that
  failed because the icon was as dim as the tile, where this is a faint ring
  with the glyph at 0.8 of the foreground, so what you read is the icon.
- **A list can be pasted, not just uploaded**: the account panel's import
  section takes a pasted list in the same formats as a file, because on a phone
  saving a file and then finding it in the picker is most of the work. Both
  routes funnel through one `importText` in `useFileImport`, so the row cap,
  the tracklist-shape check and the run itself cannot drift between them.
  Guarded by `stress/import.spec.mjs`, including that a pasted tracklist is
  questioned exactly like an uploaded one.
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
- **The active nav tab must not be the faintest one**: the header's active tab
  is drawn from the artwork accent, and `reset()` parks that accent at a pale
  grey until a cover is read, so on any scan screen before a record loads the
  tab you were on was lighter than the three you were not -- it read as
  disabled. `legibleAccentRGB` (`src/lib/accentContrast.js`, unit-tested)
  clamps the accent's luminance for the current theme before the header uses
  it. The thresholds are set against the INACTIVE tabs, not against the page:
  readable is not enough, the active tab has to be the strongest of the row.
  Clamping rather than replacing keeps the hue, so a record with a strong
  cover still tints its own chrome.
- **Back to results**: picking the wrong pressing is easy, and the list Discogs
  returned has already been fetched, so going back to it costs no network and
  no rate-limit quota. `priorSearch` (`VinylVault.jsx`) holds the last list the
  user chose from and which screen showed it, so the button returns to the scan
  disambiguation grid or to the manual search with its results and its query
  still filled in. `reset()` clears it: the pressings offered for the last
  record are not offers about the next one. Shown only when there was a real
  choice (more than one result). Guarded by `stress/import.spec.mjs`, which
  asserts the return costs zero extra Discogs requests.
- **Country carries a flag, and can be searched on**: `countryLabel`
  (`src/lib/countryFlag.js`, unit-tested) prefixes the flag emoji on every
  candidate card, in the disambiguation grid and the manual search alike,
  because country is what tells a UK pressing from a German one. The manual
  search has a country field whose suggestions (`DISCOGS_COUNTRIES`) are
  Discogs' own strings, ordered by how often each actually occurs in a real
  collection -- read from the database, not assumed, because "United Kingdom"
  instead of "UK" narrows the search to nothing. It is still free text, so a
  country not on the list is searchable. The value reaches the **targeted**
  Discogs query only, never the fuzzy fallback, which exists for when the
  targeted search was too narrow.
  Discogs also combines territories ("UK, Europe & US"), which renders as one
  flag each. Two rules there: the whole string is matched before splitting,
  or "Trinidad & Tobago" becomes two countries; and a combination is
  all-or-nothing, so "France & Benelux" keeps its plain name rather than
  showing a lone French flag and reading as a French pressing. Yugoslavia, the
  USSR and the GDR deliberately get no flag rather than a successor's.
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
