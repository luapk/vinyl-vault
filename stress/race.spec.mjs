// The flagship regression test: two windows sharing one stored session
// (installed PWA + browser tab) refreshing concurrently must NOT trip
// refresh-token reuse detection. This is the exact mechanism behind every
// real "session expired" incident; the strict bounded auth lock in
// src/lib/supabase.js is what makes it pass.
//
// Two independent assertions make this discriminating:
// 1. maxRefreshOverlap === 1 -- the mock records how many refresh requests
//    were ever in flight at once (with refreshDelayMs widening the window).
//    A broken or removed lock lets both windows refresh simultaneously,
//    which trips this even when the grace window hides the revocation.
// 2. revocations === 0 with graceMs far below Supabase's real ~10s. The
//    grace is not 0 because Chromium propagates localStorage between
//    renderer processes asynchronously: a serialised second refresh can
//    still read a milliseconds-stale token. That is exactly why the real
//    grace window exists; 1s of grace absorbs propagation lag while still
//    failing on any genuinely unserialised (seconds-stale) reuse.
import { test, expect } from '@playwright/test';
import { resetMock, mockState, control, signIn, stubApi, MOCK, JON } from './helpers.mjs';

test.beforeEach(async () => { await resetMock(); });

test('sanity: the mock really does revoke on unserialised token reuse', async () => {
  await control('/__test/config', { graceMs: 0 });
  // Sign in directly against the mock and reuse one refresh token twice.
  const signin = await fetch(`${MOCK}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: JON.email, password: JON.password }),
  }).then(r => r.json());
  const refresh = () => fetch(`${MOCK}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: signin.refresh_token }),
  });
  expect((await refresh()).status).toBe(200); // first use: rotates
  expect((await refresh()).status).toBe(400); // reuse outside grace: revoked
  expect((await mockState()).revocations).toBe(1);
});

async function openSecondWindow(context) {
  const tab = await context.newPage();
  await tab.goto('/');
  await expect(tab.locator('button[title="Account settings"]')).toBeVisible({ timeout: 20_000 });
  return tab;
}

const doRefresh = (p) => p.evaluate(async () => {
  const { data, error } = await window.__supabase.auth.refreshSession();
  return { ok: !!data?.session, error: error?.message || null };
});

test('PWA + tab: concurrent refreshes are serialised by the auth lock, session survives', async ({ page, context }) => {
  await control('/__test/config', { graceMs: 1000, refreshDelayMs: 150 });
  await stubApi(context);
  await signIn(page);
  const tab = await openSecondWindow(context);

  // Fire a token refresh from both windows at the same instant.
  const [r1, r2] = await Promise.all([doRefresh(page), doRefresh(tab)]);
  expect(r1.error, 'window 1 refresh should succeed').toBeNull();
  expect(r2.error, 'window 2 refresh should succeed').toBeNull();
  expect(r1.ok && r2.ok).toBe(true);

  const state = await mockState();
  // The lock's core promise: refreshes were serialised, never simultaneous.
  expect(state.maxRefreshOverlap, 'refreshes must be serialised by the lock').toBe(1);
  // And reuse detection never tripped.
  expect(state.revocations).toBe(0);

  // Both windows are still signed in after a reload (sessions fully valid).
  await page.reload();
  await expect(page.locator('button[title="Account settings"]')).toBeVisible({ timeout: 15_000 });
  await tab.reload();
  await expect(tab.locator('button[title="Account settings"]')).toBeVisible({ timeout: 15_000 });
});

test('soak: 8 rounds of concurrent dual-window refreshes never kill the session', async ({ page, context }) => {
  await control('/__test/config', { graceMs: 1000, refreshDelayMs: 150 });
  await stubApi(context);
  await signIn(page);
  const tab = await openSecondWindow(context);

  for (let round = 1; round <= 8; round++) {
    const [r1, r2] = await Promise.all([doRefresh(page), doRefresh(tab)]);
    expect(r1.error, `round ${round} window 1`).toBeNull();
    expect(r2.error, `round ${round} window 2`).toBeNull();
  }
  const state = await mockState();
  expect(state.maxRefreshOverlap, 'refreshes must be serialised by the lock').toBe(1);
  expect(state.revocations).toBe(0);
});
