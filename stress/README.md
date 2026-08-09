# Stress suite (fault injection)

End-to-end tests that drive the real app in a real browser and deliberately
inject the faults behind every incident this project has seen: revoked
sessions, dead databases, unreachable auth servers, and concurrent
refresh-token races from multiple windows.

## Run it

```bash
npm run stress       # just this suite
npm run test:all     # unit tests + stress suite
```

Requirements: `npx playwright install chromium` once per machine (CI does
this itself). In environments with a pre-provisioned browser, set
`CHROMIUM_PATH=/path/to/chromium` or rely on the `/opt/pw-browsers/chromium`
fallback in `playwright.config.mjs`.

## How it works

- `mock-supabase.mjs` is a local stand-in for Supabase with the one behaviour
  that matters modelled faithfully: refresh-token ROTATION with REUSE
  DETECTION and a configurable grace window. Reusing a rotated token outside
  the grace window revokes the whole session family -- the exact mechanism
  behind the real "session expired" incidents. Control endpoints under
  `/__test/*` let tests revoke sessions, seed records, and inspect state.
- `playwright.config.mjs` boots the mock plus the real app (vite dev) with
  env pointing at it. The app's serverless `/api/*` endpoints are stubbed
  per-test via route interception.
- The dev-only `window.__supabase` seam (see `src/lib/supabase.js`) lets
  tests trigger auth operations directly; it is compiled out of production.

## What is covered

| Spec | Guards against |
| --- | --- |
| `session.spec.mjs` | profile hydration on first load; session-expired UX shows a working sign-out, even with the auth server unreachable |
| `sync.spec.mjs` | the no-data-loss invariant: records added while the DB is down survive reloads and auto-sync on recovery; two devices converge |
| `race.spec.mjs` | THE flagship: PWA + tab refreshing concurrently with a zero grace window must not trip reuse revocation. Fails if the re-entrant auth lock in `src/lib/supabase.js` is broken or removed |

`race.spec.mjs` sets `graceMs: 0`, which is stricter than real Supabase
(~10s): only correct cross-context serialisation passes. It also includes a
sanity test proving the mock really does revoke on unserialised reuse, so a
green run is meaningful.

## Writing new fault tests

Reach for the same three levers:

1. `control('/__test/...')` -- server-side state: revoke sessions, seed
   records, tune `graceMs` / `expiresIn`.
2. `context.route(...)` -- network faults: abort writes, 401 an endpoint,
   take a host offline. Prefer surgical faults (one method on one route)
   over blanket offline mode.
3. Multiple pages/contexts -- same context = same device (shared storage,
   the PWA + tab setup); separate contexts = separate devices.

After every fault, assert the same invariant the app promises users: nothing
a user created is ever lost, and the way out of a broken state is always
sign-posted on screen.
