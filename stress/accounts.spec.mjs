// Account isolation on a shared device.
//
// Reported: a friend hit refresh and someone else's records appeared. The
// local cache is what renders first (before the cloud load lands), so if it is
// not scoped to the signed-in user, the previous account's collection is shown
// to whoever signs in next. Worse, the merge deliberately never drops local
// records, so those can be adopted into the new user's account for real.
//
// The tests put a second account on a device that already holds the first
// account's cache, which is the condition however it arose (a demo, a shared
// browser, an account set up on someone else's phone).
import { test, expect } from '@playwright/test';
import { resetMock, control, mockState, signIn, stubApi, DATA_COVER } from './helpers.mjs';

const PAUL = { email: 'paul@test.local', password: 'test-password-123' };
const JON = { email: 'jon@test.local', password: 'test-password-123' };

// Drop the auth session but keep everything else, exactly as signing out does.
async function clearSessionOnly(page) {
  await page.evaluate(() => {
    Object.keys(localStorage)
      .filter(k => /^sb-.+-auth-token/.test(k))
      .forEach(k => localStorage.removeItem(k));
  });
}

test.beforeEach(async () => { await resetMock(); });

test('one account never sees, or inherits, another account records on the same device', async ({ page, context }) => {
  await stubApi(context);
  await control('/__test/seed-records', {
    email: PAUL.email,
    records: [
      { id: 'p1', artist: 'Pauls Artist One', title: 'Private A', coverUrl: DATA_COVER, savedAt: 2 },
      { id: 'p2', artist: 'Pauls Artist Two', title: 'Private B', coverUrl: DATA_COVER, savedAt: 1 },
    ],
  });

  // Paul signs in here first: his collection lands in this browser's storage.
  await signIn(page, PAUL);
  await page.getByRole('button', { name: /collection/i }).first().click();
  await expect(page.locator('img[alt="Private A"]').first()).toBeVisible({ timeout: 15_000 });

  // He signs out; Jon signs in on the same browser.
  await clearSessionOnly(page);
  await signIn(page, JON);
  await page.getByRole('button', { name: /collection/i }).first().click();
  await page.waitForTimeout(4000);

  expect(await page.getByText('Pauls Artist One').count(),
    "another user's records must never render").toBe(0);

  const leakedRows = (await mockState()).records.filter(r => String(r.data?.artist || '').startsWith('Pauls') && r.user_id !== undefined);
  const adopted = leakedRows.filter(r => r.data.id === 'p1' || r.data.id === 'p2');
  // Paul's two original rows may still exist under Paul. What must not happen
  // is a COPY of them appearing, which is what adoption into Jon looks like.
  expect(adopted.length, "another user's records must not be copied into this account").toBe(2);
});

test('a user keeps their own local records across a sign-out and back in', async ({ page, context }) => {
  await stubApi(context);
  await control('/__test/seed-records', {
    email: JON.email,
    records: [{ id: 'j1', artist: 'Jons Own Artist', title: 'Jons Record', coverUrl: DATA_COVER, savedAt: 1 }],
  });

  await signIn(page, JON);
  await page.getByRole('button', { name: /collection/i }).first().click();
  await expect(page.locator('img[alt="Jons Record"]').first()).toBeVisible({ timeout: 15_000 });

  await clearSessionOnly(page);
  await signIn(page, JON);
  await page.getByRole('button', { name: /collection/i }).first().click();
  await expect(page.locator('img[alt="Jons Record"]').first()).toBeVisible({ timeout: 15_000 });
});
