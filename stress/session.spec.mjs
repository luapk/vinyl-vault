// Session lifecycle: hydration on first load, and the session-expired UX
// when the refresh token family has been revoked server-side (the exact
// state testers hit before the auth-lock fix).
import { test, expect } from '@playwright/test';
import { resetMock, control, signIn, signedOutMarker, stubApi, JON, TINY_JPEG } from './helpers.mjs';

test.beforeEach(async () => { await resetMock(); });

test('sign-in hydrates the profile on first load, no manual refresh needed', async ({ page, context }) => {
  await stubApi(context);
  await signIn(page);
  // Profile-dependent UI must appear WITHOUT a reload (the old hydration bug
  // required a manual refresh before profile/admin/avatar showed up).
  await page.locator('button[title="Account settings"]').click();
  await expect(page.getByText(JON.email).first()).toBeVisible();
});

test('revoked session: the app signs out cleanly, never a zombie state', async ({ page, context }) => {
  await stubApi(context, { scanStatus: 401 }); // /api/scan rejects like production would
  await signIn(page);

  // Server-side revocation (reuse detection tripped elsewhere): from now on
  // every token refresh fails, which is precisely the dead-session state.
  await control('/__test/revoke', { email: JON.email });

  // Batch-scan a sleeve: scan gets 401, the retry refresh fails (revoked),
  // supabase-js purges the dead session and the app must land the user
  // signed out -- able to sign straight back in, not stuck half-alive.
  await page.locator('input[type="file"][multiple]').first()
    .setInputFiles({ name: 'sleeve.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG });
  await expect(signedOutMarker(page)).toBeVisible({ timeout: 30_000 });

  // And signing back in from that state must work first try.
  await signIn(page);
});

test('sign-out still lands at login when the auth server is unreachable', async ({ page, context }) => {
  await stubApi(context, { scanStatus: 401 });
  await signIn(page);
  await control('/__test/revoke', { email: JON.email });

  // Take the whole auth server offline AND revoke: the worst case.
  await context.route('**/auth/v1/**', (route) => route.abort());

  await page.locator('input[type="file"][multiple]').first()
    .setInputFiles({ name: 'sleeve.jpg', mimeType: 'image/jpeg', buffer: TINY_JPEG });
  await expect(page.getByText('Session expired', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Sign out now' }).click();
  // The hardened signOut clears storage manually (capped at 3.5s) and
  // reloads. The offline boot then rides useAuth's 20s getSession timeout
  // before rendering the signed-out screen, hence the wide window here --
  // the state itself (storage cleared, no zombie session) is settled within
  // seconds. Known follow-up: make the offline boot fail fast.
  await expect(signedOutMarker(page)).toBeVisible({ timeout: 40_000 });
});
