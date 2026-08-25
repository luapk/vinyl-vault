// File import under Discogs rate limiting.
//
// The incident: a friend imported a 165-record list. The first thirty rows
// matched and everything after them was saved as an unmatched draft. Each
// lookup was spending two Discogs requests against a 60-per-minute limit, and
// once the limiter tripped, a 429 came back as an empty result -- which the
// importer read as "no such record" and filed accordingly. A rate limit must
// never decide what a record is.
import { test, expect } from '@playwright/test';
import { resetMock, mockState, signIn, stubApi, csvFile, trackListFile, discogsMatch, fileImportInput, openPasteImport } from './helpers.mjs';

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

test('a tracklist is questioned before it becomes hundreds of unmatchable rows', async ({ page, context }) => {
  await stubApi(context);
  let n = 0;
  await stubSearch(context, () => ({ matches: [discogsMatch(++n)] }));
  await signIn(page);

  // Four releases, thirteen tracks between them. Imported as it stands that is
  // thirteen records, none of them a release.
  await fileImportInput(page).setInputFiles(trackListFile([
    ['Bicep - Isles LP', ['Sundial', 'Atlas', 'Apricots', 'Cazenove']],
    ['Gunnar Haslam - Seasick Acid', ['Seasick Acid', 'Tidal Lock', 'Undertow']],
    ['Aloka - View Source', ['Blind Spot', 'Refract', 'Third Rail']],
    ['Axel Boman - LUZ', ['Jeremy Irons', 'Ocelot', 'Fantasia']],
  ]));

  // Nothing is imported until the question is answered.
  await expect(page.getByText(/looks like a tracklist/i)).toBeVisible({ timeout: 20_000 });
  expect((await mockState()).records).toHaveLength(0);

  await page.getByRole('button', { name: /Import 4 records/ }).click();

  await expect(page.getByText('Added 4 records')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await mockState()).records.length, { timeout: 20_000 }).toBe(4);
});

test('an ordinary release list is never questioned', async ({ page, context }) => {
  await stubApi(context);
  let n = 0;
  await stubSearch(context, () => ({ matches: [discogsMatch(++n)] }));
  await signIn(page);

  await fileImportInput(page).setInputFiles(csvFile([
    { artist: 'Kraftwerk', title: 'The Mix' },
    { artist: 'Daniel Avery', title: 'Drone Logic' },
    { artist: 'Maurizio', title: 'M6' },
  ]));

  await expect(page.getByText('Added 3 records')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/looks like a tracklist/i)).toHaveCount(0);
});

test('a list can be pasted instead of uploaded', async ({ page, context }) => {
  await stubApi(context);
  let n = 0;
  await stubSearch(context, () => ({ matches: [discogsMatch(++n)] }));
  await signIn(page);

  const box = await openPasteImport(page);
  await box.fill('The Adverts - The Peel Sessions\nAerosmith - Live Bootleg\nAll About Eve - Scarlet and Other Stories');
  await page.getByRole('button', { name: /Import pasted list/ }).click();

  await expect(page.getByText('Added 3 records')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => (await mockState()).records.length, { timeout: 20_000 }).toBe(3);
});

test('a pasted tracklist is questioned, exactly like an uploaded one', async ({ page, context }) => {
  await stubApi(context);
  let n = 0;
  await stubSearch(context, () => ({ matches: [discogsMatch(++n)] }));
  await signIn(page);

  const box = await openPasteImport(page);
  await box.fill([
    'Bicep - Isles LP,A1. Sundial',
    'Bicep - Isles LP,A2. Atlas',
    'Bicep - Isles LP,B1. Apricots',
    'Bicep - Isles LP,B2. Cazenove',
    'Aloka - View Source,A1. Blind Spot',
    'Aloka - View Source,A2. Refract',
    'Aloka - View Source,B1. Third Rail',
    'Axel Boman - LUZ,A1. Jeremy Irons',
    'Axel Boman - LUZ,B2. Ocelot',
  ].join('\n'));
  await page.getByRole('button', { name: /Import pasted list/ }).click();

  await expect(page.getByText(/looks like a tracklist/i)).toBeVisible({ timeout: 20_000 });
  expect((await mockState()).records).toHaveLength(0);

  await page.getByRole('button', { name: /Import 3 records/ }).click();
  await expect(page.getByText('Added 3 records')).toBeVisible({ timeout: 30_000 });
});

// Picking the wrong pressing used to mean searching Discogs again from
// scratch to get back a list that had already been fetched.
test('back to results returns to the pressings already fetched, for free', async ({ page, context }) => {
  await stubApi(context);
  let searches = 0;
  await context.route('**/api/discogs-search', (route) => {
    searches += 1;
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ matches: [discogsMatch(1), discogsMatch(2), discogsMatch(3)], remaining: 55, requests: 1 }),
    });
  });
  await signIn(page);

  await page.getByRole('button', { name: /type artist & title to search/i }).click();
  await page.getByPlaceholder('e.g. Nelly Furtado').fill('Kraftwerk');
  await page.getByRole('button', { name: /Search Discogs/i }).click();

  await expect(page.getByText('Stress Album 1').first()).toBeVisible({ timeout: 20_000 });
  expect(searches).toBe(1);
  // Country is what tells one pressing from another, so it carries a flag.
  await expect(page.getByText(/🇬🇧 UK/).first()).toBeVisible();

  // Pick one, land on the result, then think better of it.
  await page.getByText('Stress Album 1').first().click();
  const back = page.getByRole('button', { name: /Back to results/i });
  await expect(back).toBeVisible({ timeout: 20_000 });
  await back.click();

  // The same three pressings, and not a single extra Discogs request.
  await expect(page.getByText('Stress Album 2').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Stress Album 3').first()).toBeVisible();
  expect(searches).toBe(1);
});
