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
```

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
  spotify-features.js  # Spotify BPM / key lookup
  audio-proxy.js       # preview audio proxy (CORS)
  image-proxy.js       # cover art proxy (CORS) for caching covers into storage
  price.js             # Discogs price history
  gelato-order.js      # print-on-demand order
  invite.js            # invite code validation

supabase/
  schema.sql           # full schema (run on a fresh project)
  storage.sql          # storage buckets: avatars (profile photos), covers (cached cover art)
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

## Data model

### Collection (localStorage + Supabase `records` table)
Each record is a JSON blob stored in the `data` jsonb column:
- `id` -- local UUID
- `artist`, `title`, `label`, `catalogNumber`, `year`, `country`, `format`
- `genres[]`, `tags[]`
- `crates[]` -- user-assigned crate names (strings)
- `tracklist[]` -- `{ position, title, duration, bpm, key, previewUrl, hot }`
- `coverUrl`, `images[]`
- `identified`, `confidence`, `source`, `notes`
- `savedAt` -- timestamp

### Sync behaviour
- Always writes to localStorage on every state change (local-first)
- On login, `dbLoad` pulls Supabase records, migrates any local-only records up, then sets state to the merged result
- `syncedIds` Set tracks which records are confirmed in Supabase; unsynced records show an amber `!` badge

## Known quirks

- **Auth lock**: `supabase.js` overrides the supabase-js cross-tab auth lock with a no-op. The default `navigator.locks` implementation can deadlock when a previous tab hangs during token refresh, freezing all DB queries. The trade-off is a possible duplicate refresh call from two tabs simultaneously (harmless).
- **Large single file**: all UI lives in `VinylVault.jsx`. When editing, use grep/search to navigate -- the file is ~3000 lines.
- **Crate editing**: only available in the record detail panel (click a card in grid view). The carousel view is read-only for crates.
- **Batch scan**: assigns no crates automatically -- crates are user-organisational only.
