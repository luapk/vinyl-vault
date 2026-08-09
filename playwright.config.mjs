import { defineConfig, chromium } from '@playwright/test';
import fs from 'node:fs';

// Stress / fault-injection suite. Runs the real app (vite dev) against the
// mock Supabase server (stress/mock-supabase.mjs), which faithfully models
// refresh-token rotation and reuse revocation. See stress/README.md.
//
// CHROMIUM_PATH: set to a chromium binary to skip Playwright's own download
// (pre-provisioned environments); leave unset where `npx playwright install
// chromium` has run (CI, local dev machines).

const MOCK_PORT = 8787;
const APP_PORT = 5199;

// Legacy-JWT-shaped anon key (must start with "eyJ" for src/lib/supabase.js
// to take the standard client path). Payload is irrelevant to the mock.
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const ANON_KEY = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ role: 'anon', iss: 'mock' })}.c2lnbmF0dXJl`;

function resolveChromium() {
  if (process.env.CHROMIUM_PATH) return { executablePath: process.env.CHROMIUM_PATH };
  try {
    if (fs.existsSync(chromium.executablePath())) return {};
  } catch { /* no default browser installed */ }
  // Fall back to a system-provisioned chromium (remote sandboxes).
  if (fs.existsSync('/opt/pw-browsers/chromium')) return { executablePath: '/opt/pw-browsers/chromium' };
  return {};
}

export default defineConfig({
  testDir: './stress',
  testMatch: '**/*.spec.mjs',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1, // tests share the mock server's state; run serially
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    launchOptions: resolveChromium(),
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node stress/mock-supabase.mjs',
      url: `http://127.0.0.1:${MOCK_PORT}/__test/state`,
      reuseExistingServer: !process.env.CI,
      timeout: 15_000,
    },
    {
      command: `npx vite --port ${APP_PORT} --strictPort`,
      url: `http://127.0.0.1:${APP_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        VITE_SUPABASE_ANON_KEY: ANON_KEY,
      },
    },
  ],
});
