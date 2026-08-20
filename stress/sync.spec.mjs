// Sync resilience: the no-data-loss invariant under database faults, and
// cross-device convergence.
import { test, expect } from '@playwright/test';
import { resetMock, mockState, signIn, stubApi, csvFile, discogsMatch, fileImportInput } from './helpers.mjs';

test.beforeEach(async () => { await resetMock(); });

// Per-request Discogs stub: each searched row gets its own distinct release
// so nothing is deduplicated as a "same release" duplicate.
async function stubDiscogsPerRow(context) {
  let n = 0;
  await context.route('**/api/discogs-search', (route) => {
    n += 1;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ matches: [discogsMatch(n)] }) });
  });
}

test('records added while the database is down survive a reload and sync on recovery', async ({ page, context }) => {
  await stubApi(context);
  await stubDiscogsPerRow(context);
  await signIn(page);

  // Fault: every write to the records table dies (reads still work).
  await context.route('**/rest/v1/records**', (route) => {
    if (route.request().method() === 'POST') return route.abort();
    return route.fallback();
  });

  await fileImportInput(page).setInputFiles(csvFile([
    { artist: 'Import Artist A', title: 'Album A' },
    { artist: 'Import Artist B', title: 'Album B' },
  ]));
  // The import completes locally (ticks land) even though every insert failed.
  await expect(page.getByText('Added 2 records')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Import Artist A - Album A')).toBeVisible();

  // Nothing reached the cloud.
  expect((await mockState()).records).toHaveLength(0);

  // THE invariant: a reload with an empty cloud must not lose local records.
  // Assert on the cover images -- the carousel captions only the focused card.
  await page.reload();
  await page.getByRole('button', { name: /collection/i }).first().click();
  await expect(page.locator('img[alt="Stress Album 1"]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('img[alt="Stress Album 2"]').first()).toBeVisible();

  // Recovery: lift the fault; the 25s background retry must push both records
  // to the cloud without any user action.
  await context.unroute('**/rest/v1/records**');
  await expect.poll(async () => (await mockState()).records.length, {
    timeout: 60_000, message: 'background retry should sync the 2 unsynced records',
  }).toBe(2);
});

test('two devices on one account converge', async ({ browser, context, page }) => {
  await stubApi(context);
  await stubDiscogsPerRow(context);

  // Device A: sign in and import a record (database healthy).
  await signIn(page);
  await fileImportInput(page).setInputFiles(csvFile([
    { artist: 'Shared Artist', title: 'Shared Album' },
  ]));
  await expect(page.getByText('Added 1 record', { exact: false })).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await mockState()).records.length, { timeout: 30_000 }).toBe(1);

  // Device B: a completely separate browser profile, same account.
  const deviceB = await browser.newContext();
  const pageB = await deviceB.newPage();
  await stubApi(deviceB);
  await signIn(pageB);
  await pageB.getByRole('button', { name: /collection/i }).first().click();
  await expect(pageB.locator('img[alt="Stress Album 1"]').first()).toBeVisible({ timeout: 15_000 });
  await deviceB.close();
});
