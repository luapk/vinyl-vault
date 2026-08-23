// File import under Discogs rate limiting.
//
// The incident: a friend imported a 165-record list. The first thirty rows
// matched and everything after them was saved as an unmatched draft. Each
// lookup was spending two Discogs requests against a 60-per-minute limit, and
// once the limiter tripped, a 429 came back as an empty result -- which the
// importer read as "no such record" and filed accordingly. A rate limit must
// never decide what a record is.
import { test, expect } from '@playwright/test';
import { resetMock, mockState, signIn, stubApi, csvFile, discogsMatch, fileImportInput } from './helpers.mjs';

test.beforeEach(async () => { await resetMock(); });

// Route registration order matters: the last matching route wins, so this has
// to be registered after stubApi's generic handler.
async function stubSearch(context, handler) {
  await context.route('**/api/discogs-search', (route) => {
    const reply = handler();
    if (reply.status === 429) {
      return route.fulfill({
        status: 429, contentType: 'application/json',
        body: JSON.stringify({ error: 'rate limit', rateLimited: true, remaining: 0, matches: [] }),
      });
    }
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ matches: reply.matches || [], remaining: 55, requests: reply.matches?.length ? 1 : 2 }),
    });
  });
}

test('a rate-limited lookup waits, and never files the record as unmatched', async ({ page, context }) => {
  await stubApi(context);
  await stubSearch(context, () => ({ status: 429 }));
  await signIn(page);

  await fileImportInput(page).setInputFiles(csvFile([
    { artist: 'Kelly Lee Owens', title: 'Inner Song' },
    { artist: 'Konduku', title: 'Parlama' },
  ]));

  // The row parks itself rather than resolving to a draft, and says why.
  await expect(page.getByText(/discogs busy/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('draft', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Stop here' }).click();
  await expect(page.getByText(/Stopped --/)).toBeVisible({ timeout: 15_000 });

  // Nothing was written for either row: a rate limit produces no record at
  // all, so re-running the same file later picks up cleanly.
  await expect(page.getByText('draft', { exact: true })).toHaveCount(0);
  expect((await mockState()).records).toHaveLength(0);
});

test('a lookup that recovers from a rate limit is matched, not drafted', async ({ page, context }) => {
  await stubApi(context);
  let calls = 0;
  await stubSearch(context, () => (++calls === 1 ? { status: 429 } : { matches: [discogsMatch(1)] }));
  await signIn(page);

  await fileImportInput(page).setInputFiles(csvFile([{ artist: 'Kraftwerk', title: 'The Mix' }]));

  // First backoff is 20s, so this is deliberately patient.
  await expect(page.getByText('Added 1 record')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('draft', { exact: true })).toHaveCount(0);
  expect(calls).toBeGreaterThan(1);
});

test('Match unmatched repairs rows an earlier import could not match', async ({ page, context }) => {
  await stubApi(context);
  let matching = false;
  await stubSearch(context, () => (matching ? { matches: [discogsMatch(1)] } : { matches: [] }));
  await signIn(page);

  await fileImportInput(page).setInputFiles(csvFile([
    { artist: 'Laid Back', title: 'Sire' },
    { artist: 'Lars Bartkuhn', title: 'Transcend' },
  ]));
  await expect(page.getByText('Added 2 records')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('draft', { exact: true })).toHaveCount(2);

  // Discogs starts answering again. Importing the same file a second time
  // would add a second copy of each draft (de-duplication keys on the Discogs
  // id, which a draft has not got), so the repair is its own pass.
  matching = true;
  await page.getByRole('button', { name: /Match unmatched \(2\)/ }).click();

  await expect(page.getByText('Matched 2 of 2')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('draft', { exact: true })).toHaveCount(0);
});

test('duplicate drafts can be cleared out in one go', async ({ page, context }) => {
  await stubApi(context);
  await stubSearch(context, () => ({ matches: [] }));
  await signIn(page);

  const file = () => csvFile([
    { artist: 'Herbert', title: 'Part 4' },
    { artist: 'Klockworks', title: '04' },
  ]);

  await fileImportInput(page).setInputFiles(file());
  await expect(page.getByText('Added 2 records')).toBeVisible({ timeout: 30_000 });

  // The same file again. An unmatched row has no Discogs id, so nothing
  // recognises it as already present and both rows land a second time.
  await page.getByRole('button', { name: 'Done' }).click();
  await fileImportInput(page).setInputFiles(file());
  await expect(page.getByText('Added 2 records')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('draft', { exact: true })).toHaveCount(2);

  // Two of the four are now redundant. Deleting is not undoable, so it asks.
  await page.getByRole('button', { name: /Remove duplicates \(2\)/ }).click();
  await page.getByRole('button', { name: /Delete 2\? Tap again/ }).click();

  await expect(page.getByRole('button', { name: /Remove duplicates/ })).toHaveCount(0);
  await expect.poll(async () => (await mockState()).records.length, {
    timeout: 20_000, message: 'the two duplicate drafts should be deleted',
  }).toBe(2);
});
