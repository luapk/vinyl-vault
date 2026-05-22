# Vinyl Vault

An archive and DJ planning tool for vinyl. Photograph a sleeve, get identification + tracklist + BPM + Camelot key. Records file into virtual crates; Claude clusters them by archetype.

## Stack

- Vite + React (SPA)
- Tailwind CSS
- Vercel serverless function (`api/identify.js`) — proxies Claude Vision so the API key stays server-side
- Claude Sonnet 4 (vision + identification)

## Status

Phase 1 — Scan & Identify. Discogs + Spotify integrations and Supabase persistence land in subsequent phases (see roadmap in the app footer).

---

## Quick deploy via Vercel CLI (fastest)

From this folder:

```bash
npm install
npx vercel
```

When prompted:
- Set up and deploy? **Yes**
- Which scope? **(your account)**
- Link to existing project? **No**
- Project name? `vinyl-vault` (or whatever you prefer)
- In which directory is your code located? `./`
- Override settings? **No** (Vercel auto-detects Vite)

After the first deploy, add the env var:

```bash
npx vercel env add ANTHROPIC_API_KEY
```

Paste your key (from console.anthropic.com), select **Production, Preview, Development**.

Then redeploy:

```bash
npx vercel --prod
```

You'll get a `vinyl-vault-{hash}.vercel.app` URL. Add a custom domain via the Vercel dashboard if you want.

---

## Deploy via GitHub (preferred for source control)

1. Init a git repo here and push to GitHub:
   ```bash
   git init
   git add .
   git commit -m "Phase 1: scan & identify"
   git branch -M main
   git remote add origin git@github.com:YOUR-USERNAME/vinyl-vault.git
   git push -u origin main
   ```
2. Go to vercel.com → New Project → Import the repo. Vercel auto-detects Vite.
3. Before deploying, expand **Environment Variables** and add:
   - `ANTHROPIC_API_KEY` = your key from console.anthropic.com
4. Deploy.

Subsequent pushes to `main` auto-deploy.

---

## Run locally

```bash
npm install
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env.local
npx vercel dev
```

Use `vercel dev` rather than `npm run dev` — it runs the serverless function locally. Visit http://localhost:3000.

---

## Project structure

```
vinyl-vault/
├── api/
│   └── identify.js              Serverless function: Claude Vision proxy
├── public/
│   └── favicon.svg
├── src/
│   ├── components/
│   │   └── VinylVault.jsx       Main component (scan flow)
│   ├── App.jsx
│   ├── main.jsx
│   └── index.css                Tailwind + base styles
├── index.html                   Fonts, meta
├── tailwind.config.js
├── postcss.config.js
├── vite.config.js
├── vercel.json                  Function config (30s timeout)
└── package.json
```

## Costs to note

- **Anthropic API**: each scan = one Sonnet 4 vision call. Roughly $0.02–$0.05 per scan depending on image size and response length. 2,000 records ≈ $40–$100 to fully ingest.
- **Vercel**: hobby tier is free for personal use. Serverless function executions are free up to generous limits.

## Roadmap (next phases)

- **Phase 1A** — real Discogs integration (replace Claude-estimated metadata with verified release data), Spotify Audio Features for accurate BPM/key, pressing disambiguation screen.
- **Phase 2** — Supabase persistence, multi-user auth (3 users + social layer), collection browse with predictive search.
- **Phase 3** — Virtual record boxes / crates with drag-to-assign.
- **Phase 4** — DJ Mode: Camelot wheel, BPM filter, set builder with energy curve.
- **Phase 5** — Archetype Engine: Claude-powered semantic clustering of the collection.
