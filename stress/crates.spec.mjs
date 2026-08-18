// Smart crates: the incremental "sort unfiled" run.
//
// The invariant under test is the same one the whole app promises: applying a
// smart crate run only ever ADDS crate names. No record leaves the collection,
// no crate the user assigned by hand is touched, and a record already filed is
// never sent to the AI in the first place.
import { test, expect } from '@playwright/test';
import { control, resetMock, mockState, signIn, stubApi, JON, DATA_COVER } from './helpers.mjs';

const rec = (i, crates) => ({
  id: `crate-rec-${i}`,
  artist: `Artist ${i}`, title: `Release ${i}`,
  label: 'Test Records', catalogNumber: `TR-00${i}`, year: 2000 + i,
  country: 'UK', format: '12"', coverUrl: DATA_COVER,
  identified: true, savedAt: 1700000000000 + i,
  ...(crates ? { crates } : {}),
});

// Answer whatever the app asks for, and record what it asked. Keyed on the
// request's mode, not on call order: React StrictMode double-invokes the
// modal's effect under vite dev, so each open fires the request twice.
async function stubSmartCrates(context, calls, reply) {
  await context.route('**/api/smart-crates', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(reply(body)),
    });
  });
}

const firstCall = (calls, mode) => calls.find(c => c.mode === mode);

async function openCratesTab(page) {
  await page.getByRole('button', { name: /Collection/ }).first().click();
  // The carousel's own crate-picker toggle is also called "Crates"; the mode
  // tab is the first one.
  await page.getByRole('button', { name: 'Crates', exact: true }).first().click();
  await expect(page.getByText('Smart Crates', { exact: true })).toBeVisible();
}

test('sort unfiled sends only uncrated records, and keeps existing crates', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  const calls = [];
  await stubSmartCrates(context, calls, (body) => body.mode === 'full'
    // Full sort: covers two of the four records.
    ? { crates: [{ name: 'Detroit Lineage', description: 'Motor city.', ids: ['crate-rec-1', 'crate-rec-2'] }] }
    // Unfiled run: files the one remaining uncrated record into that same crate.
    : { crates: [{ name: 'Detroit Lineage', description: 'Motor city.', ids: ['crate-rec-4'] }] });

  await control('/__test/seed-records', {
    email: JON.email,
    // rec 3 is filed by hand and must never be sent or altered.
    records: [rec(1), rec(2), rec(3, ['Sunday Morning']), rec(4)],
  });

  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page);
  await openCratesTab(page);

  // ---- First run: full sort -------------------------------------------------
  await page.getByRole('button', { name: 'Sort my collection' }).click();
  await expect(page.getByText(/Filed 2 of 4 records/)).toBeVisible();
  await expect(page.getByText(/2 left unfiled/)).toBeVisible();
  await page.getByRole('button', { name: /^Apply 1 crate/ }).click();

  const full = firstCall(calls, 'full');
  expect(full.records).toHaveLength(4);
  expect(full.existingCrates).toEqual([]);

  // ---- Second run: unfiled only --------------------------------------------
  // rec 3 is hand-filed and rec 1/2 were just filed, so only rec 4 is left.
  const unfiledBtn = page.getByRole('button', { name: /^Sort unfiled records/ });
  await expect(unfiledBtn).toHaveText(/\(1\)/);
  await unfiledBtn.click();
  await expect(page.getByText(/Filed 1 of 1 record/)).toBeVisible();
  await page.getByRole('button', { name: /^Apply 1 crate/ }).click();

  const unfiled = firstCall(calls, 'unfiled');
  expect(unfiled.records.map(r => r.id)).toEqual(['crate-rec-4']);
  // The description travels with the name, so the model can file accurately
  // into a crate it did not create in this run.
  expect(unfiled.existingCrates).toContainEqual(
    expect.objectContaining({ name: 'Detroit Lineage', description: 'Motor city.' }),
  );

  // ---- Nothing was lost or overwritten -------------------------------------
  await expect(page.getByRole('button', { name: 'Everything is filed' })).toBeVisible();

  await expect.poll(async () => {
    const rows = (await mockState()).records;
    const byId = Object.fromEntries(rows.map(r => [r.data.id, r.data]));
    return {
      count: rows.length,
      handFiled: byId['crate-rec-3']?.crates,
      filed: byId['crate-rec-4']?.crates,
    };
  }, { timeout: 20_000 }).toEqual({
    count: 4,                                  // no record added or dropped
    handFiled: ['Sunday Morning'],             // the user's own filing, untouched
    filed: ['Detroit Lineage'],
  });
});

test('a run that files nothing leaves every record exactly as it was', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  const calls = [];
  await stubSmartCrates(context, calls, () => ({ crates: [] }));

  await control('/__test/seed-records', { email: JON.email, records: [rec(1), rec(2, ['Dubs'])] });
  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page);
  await openCratesTab(page);

  await page.getByRole('button', { name: 'Sort my collection' }).click();
  await expect(page.getByText(/Nothing to file this time/)).toBeVisible();
  // No Apply button to press: there is nothing to apply.
  await expect(page.getByRole('button', { name: /^Apply/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  const rows = (await mockState()).records;
  expect(rows).toHaveLength(2);
  expect(rows.find(r => r.data.id === 'crate-rec-2').data.crates).toEqual(['Dubs']);
});
