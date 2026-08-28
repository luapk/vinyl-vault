import { test, expect } from '@playwright/test';
import { signIn, stubApi, resetMock, control, JON } from './helpers.mjs';

// Wishlist and Trace.
//
// The rules this suite exists to hold:
//   - A pinned record survives a reload, including when the wishlist tables do
//     not exist yet on the database. A migration that has not been run must
//     cost sync, never the thing the user typed.
//   - A rate-limited search never renders as "no match". An unmatched card is a
//     statement about a record; a 429 is a statement about Discogs, and
//     confusing the two is how somebody pins a cold case that would have
//     resolved a minute later.
//   - Trace never spends Discogs quota for a user who cannot use it. The gate
//     is enforced before the request, not by hiding a button.
//   - A stored result is still there when you come back, and clearing it is
//     the user's decision.

// Shaped exactly as searchDiscogs returns a row: `recordTitle` and `coverUrl`,
// not `title` and `thumb`. Reading the wrong two left every result card with a
// blank name and an empty artwork square in production while the tests passed.
const MATCH = {
  id: 249504, masterId: '9911', artist: 'Gat Decor', recordTitle: 'Passion', year: 1992,
  label: 'Effective Records', catalogNumber: '12 EFFS 1', country: 'UK',
  format: 'Vinyl, 12"', coverUrl: null,
};

const TRACE_PAYLOAD = {
  releaseId: '249504',
  release: { artist: 'Gat Decor', title: 'Passion', label: 'Effective Records', catalogNumber: '12 EFFS 1', year: 1992, country: 'Japan', format: 'Vinyl, 12"', coverUrl: null, masterId: '9911' },
  market: { totalListings: 9, floor: { value: 4200, currency: 'JPY' }, conditions: [{ grade: 'M', value: 92.0 }, { grade: 'NM', value: 78.2 }, { grade: 'VG+', value: 55.4 }], suggestionsStatus: 'ok' },
  pressings: { total: 6, byCountry: [{ country: 'UK', n: 4 }, { country: 'Japan', n: 1 }] },
  cost: {
    total: 49.51, currency: 'GBP', askingPrice: 4200, askingCurrency: 'JPY', rate: 0.0051,
    domestic: false, vatAtBorder: false, grams: 420, corridor: 'Japan', corridorCode: 'Japan',
    daysMin: 8, daysMax: 18, fxLive: false, fxDate: '2026-08-01',
    grade: 'M', gradeNote: 'estimated for a Mint copy',
    split: { item: 21.42, friction: 28.09, parts: [{ label: 'Shipping', value: 19 }, { label: 'FX spread', value: 1.01 }, { label: 'Import VAT', value: 8.08 }] },
    lines: [
      { label: 'Item', value: 21.42, note: '4200 JPY' },
      { label: 'Shipping', value: 19, note: 'Japan, 420g' },
      { label: 'FX spread', value: 1.01, note: '2.5% card rate' },
      { label: 'Duty', value: 0, note: 'sound recordings, 0%' },
      { label: 'Import VAT', value: 8.08, note: '20%, charged by the seller' },
      { label: 'Handling fee', value: 0, note: 'none, under the £135 threshold' },
    ],
  },
  floorCost: { total: 27.4, currency: 'GBP', askingPrice: 4200, askingCurrency: 'JPY', corridor: 'Japan', lines: [] },
  recourse: { level: 'weak', note: 'returning it costs more than most records' },
  verdict: { stance: 'steady', headline: '9 listed', notes: ['6 pressings exist. Check the one you are buying is the one you want.'] },
  sources: ['Discogs release', 'Discogs master versions', 'Discogs marketplace stats', 'Built-in FX table'],
  grams: 420, tookMs: 1840, checkedAt: new Date().toISOString(),
};

const openWishlist = (page) => page.getByRole('button', { name: 'Wishlist', exact: true }).first().click();

async function pinPassion(page) {
  await openWishlist(page);
  await page.getByLabel('Artist').fill('Gat Decor');
  await page.getByRole('button', { name: /find it/i }).click();
  await page.getByText('Effective Records').first().click();
  await expect(page.getByText('1 on the hunt')).toBeVisible({ timeout: 10_000 });
}

test('a pinned record survives a reload even with no wishlist tables on the database', async ({ page, context }) => {
  await resetMock();
  await stubApi(context, { discogsMatches: [MATCH] });
  await signIn(page);
  await pinPassion(page);

  // The mock has no wishlist tables, which is exactly the state of a database
  // where supabase/wishlist.sql has not been run yet.
  await page.reload();
  await openWishlist(page);
  await expect(page.getByText('Passion').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('1 on the hunt')).toBeVisible();
});

test('a rate-limited search is never shown as no match', async ({ page, context }) => {
  await resetMock();
  await stubApi(context, { discogsMatches: [] });
  // stubApi answers 200 with an empty match list; override it with the 429 the
  // real endpoint sends when Discogs is limiting.
  await context.route('**/api/discogs-search', route => route.fulfill({
    status: 429, contentType: 'application/json',
    body: JSON.stringify({ error: 'Discogs is rate limiting.', rateLimited: true }),
  }));
  await signIn(page);
  await openWishlist(page);
  await page.getByLabel('Artist').fill('Gat Decor');
  await page.getByRole('button', { name: /find it/i }).click();

  await expect(page.getByText(/rate limiting/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('No match')).toHaveCount(0);
  await expect(page.getByText('Add it anyway')).toHaveCount(0);
});

test('trace never spends Discogs quota for a user who cannot use it', async ({ page, context }) => {
  await resetMock();
  await stubApi(context, { discogsMatches: [MATCH] });
  let traceCalls = 0;
  await context.route('**/api/trace', (route) => {
    traceCalls += 1;
    route.fulfill({ status: 402, contentType: 'application/json', body: JSON.stringify({ error: 'trace_requires_resident' }) });
  });
  await signIn(page);           // mock profile is on the free tier
  await pinPassion(page);

  await page.getByRole('button', { name: /trace this record/i }).click();
  // The pricing sheet, not a hunt. `.vv-pricing-wrap` is the sheet itself, so
  // this asserts the upsell opened rather than that the word "Resident" exists
  // somewhere in the document.
  await expect(page.locator('.vv-pricing-wrap')).toBeVisible({ timeout: 10_000 });
  expect(traceCalls).toBe(0);
});

test('a resident traces a record, sees the sweep, and the result is still there after a reload', async ({ page, context }) => {
  await resetMock();
  await control('/__test/set-tier', { email: JON.email, tier: 'resident' });
  await stubApi(context, { discogsMatches: [MATCH] });
  await context.route('**/api/trace', async (route) => {
    // Long enough that the radar is genuinely on screen to be asserted.
    await new Promise(r => setTimeout(r, 2500));
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_PAYLOAD) });
  });
  await signIn(page);
  await pinPassion(page);

  await page.getByRole('button', { name: /trace this record/i }).click();
  await expect(page.getByText('Sweeping')).toBeVisible({ timeout: 5_000 });

  // The landed total, and the itemisation that makes it checkable.
  await expect(page.getByText('£49.51').first()).toBeVisible({ timeout: 20_000 });
  // The part-to-whole split, which replaced the six-row fee table.
  await expect(page.getByText('The record', { exact: true })).toBeVisible();
  await expect(page.getByText('Getting it here', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /is the record and .* getting it here/ })).toBeVisible();
  // Never asserted as fact: the estimate has to say what it is.
  await expect(page.getByText(/Estimate, not a quote/)).toBeVisible();

  // The landed total is stated ONCE. It used to appear as the headline and
  // again as a Total row under the table, which is half of why the panel was
  // twice as long as the information in it.
  await expect(page.getByText('£49.51')).toHaveCount(1);

  // A price with no condition beside it is how somebody pays clean-copy money
  // for a crackly record, so the grade sits next to the number.
  await expect(page.getByText('M', { exact: true }).first()).toBeVisible();
  await expect(page.getByText(/estimated for a Mint copy/)).toBeVisible();
  // And it must not be passed off as a listing: the cheapest actual copy is
  // named separately, with its condition explicitly unknown.
  await expect(page.getByText(/grade not stated/)).toBeVisible();

  // The name of the record has to survive the round trip from search to card.
  await expect(page.getByText('Passion').first()).toBeVisible();

  // Buy goes to the marketplace page for THIS release, not to the master,
  // which is where a plain Discogs search would drop the user instead.
  const buy = page.getByRole('link', { name: /buy now on discogs/i });
  await expect(buy).toBeVisible();
  await expect(buy).toHaveAttribute('href', 'https://www.discogs.com/sell/release/249504');
  await expect(buy).toHaveAttribute('target', '_blank');
  await expect(buy).toHaveAttribute('rel', /noopener/);

  await page.reload();
  await openWishlist(page);
  await expect(page.getByText('£49.51').first()).toBeVisible({ timeout: 15_000 });
});

test('clearing a stored result is the users decision, and leaves the record pinned', async ({ page, context }) => {
  await resetMock();
  await control('/__test/set-tier', { email: JON.email, tier: 'resident' });
  await stubApi(context, { discogsMatches: [MATCH] });
  await context.route('**/api/trace', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(TRACE_PAYLOAD),
  }));
  await signIn(page);
  await pinPassion(page);

  await page.getByRole('button', { name: /trace this record/i }).click();
  await expect(page.getByText('£49.51').first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: /^clear$/i }).click();
  await expect(page.getByText('£49.51')).toHaveCount(0);
  // The want survives the answer being thrown away.
  await expect(page.getByText('1 on the hunt')).toBeVisible();
});

test('the header tab row never wraps, and messages are reachable inside community', async ({ page, context }) => {
  await resetMock();
  await stubApi(context, { discogsMatches: [MATCH] });
  await page.setViewportSize({ width: 360, height: 740 });
  await signIn(page);

  // Every tab button sits on the same line as the first one. Wrapping folded
  // the icons onto a second row and pushed the whole page down.
  const tabs = page.locator('nav.vv-nav-row button');
  const count = await tabs.count();
  expect(count).toBeGreaterThan(1);
  const firstTop = (await tabs.first().boundingBox()).y;
  for (let i = 1; i < count; i++) {
    const box = await tabs.nth(i).boundingBox();
    expect(Math.abs(box.y - firstTop)).toBeLessThan(4);
  }

  // Chat left the header, so Community has to carry it.
  await page.getByRole('button', { name: /Community/ }).first().click();
  await expect(page.getByRole('button', { name: /Messages/ })).toBeVisible({ timeout: 10_000 });
});
