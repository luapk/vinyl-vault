// The home screen's four ways in, and the state rule on the scan card.
//
// CLAUDE.md used to ask a human to check the fold by hand after touching the
// heading block. That is the kind of rule nobody remembers on the one commit
// where it matters, and the failure is quiet: a fourth entry point slides
// under the fold on a small phone and simply stops being found.
import { test, expect } from '@playwright/test';
import { resetMock, signIn, stubApi, csvFile, discogsMatch, fileImportInput, allowImport } from './helpers.mjs';

test.beforeEach(async () => { await resetMock(); });

const PHONE = { width: 360, height: 740 };

test('all four ways in sit above the fold on a small phone', async ({ page, context }) => {
  await stubApi(context);
  await signIn(page);
  await page.setViewportSize(PHONE);
  await page.waitForTimeout(800);

  // "Search" is too common a word to match on the visible title: the
  // collection's own search field would match it too. That card is found by
  // its accessible name, the other three by the words on them.
  const cards = [
    page.locator('button,label').filter({ hasText: /Scan a record/ }).first(),
    page.locator('button,label').filter({ hasText: /Photos/ }).first(),
    page.locator('button,label').filter({ hasText: /A file/ }).first(),
    page.getByRole('button', { name: 'Search for a record by artist and title' }),
  ];
  for (const card of cards) {
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box).not.toBeNull();
    // Above the fold, and a real tap target.
    expect(box.y + box.height).toBeLessThanOrEqual(PHONE.height);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
});

test('the scan card says nothing about a collection of none', async ({ page, context }) => {
  await stubApi(context);
  await signIn(page);
  // Not "0 in the crate, last added never": an empty collection has no state
  // worth a line, and the first-run paragraph above already explains the app.
  await expect(page.getByText(/in the crate/i)).toHaveCount(0);
});

test('the state rule fills in once there are records, and never truncates', async ({ page, context }) => {
  await allowImport();   // importing a list is a Selector feature
  await stubApi(context);
  let n = 0;
  await context.route('**/api/discogs-search', (route) => {
    n += 1;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ matches: [discogsMatch(n)] }) });
  });
  await signIn(page);
  await fileImportInput(page).setInputFiles(csvFile(
    Array.from({ length: 3 }, (_, i) => ({ artist: `Artist ${i + 1}`, title: `Album ${i + 1}` }))));
  await page.getByText(/Added \d+ records/).waitFor({ timeout: 40_000 });
  const done = page.getByRole('button', { name: /^(Done|Close)$/ }).first();
  if (await done.count()) await done.click();

  await page.setViewportSize(PHONE);
  await expect(page.getByText(/3 in the crate/i)).toBeVisible();
  await expect(page.getByText(/Last added Today/i)).toBeVisible();

  // A three-record collection makes a short line and would hide an overflow
  // that a real collection hits. Measure the longest the rule can ever be.
  const fit = await page.evaluate(() => {
    const span = [...document.querySelectorAll('span')].find((e) => /in the crate/i.test(e.textContent));
    const row = span.parentElement;
    const other = [...row.querySelectorAll('span')].find((e) => e !== span);
    span.textContent = '12,345 in the crate';
    other.textContent = 'Last added Yesterday';
    return { rowOverflows: row.scrollWidth > row.clientWidth,
             countTruncated: span.scrollWidth > span.clientWidth };
  });
  expect(fit.rowOverflows).toBe(false);
  expect(fit.countTruncated).toBe(false);
});

// The header has to hold the logo AND every tab without the nav row
// scrolling sideways. Nothing asserted this with a FULL tab row, and it was
// quietly broken: Tracks only appears once the collection has records, so
// every check that ran against an empty account saw three tabs and passed
// while a real user with four was scrolling the row.
//
// 320 and 640 still overflow and are not claimed here. 640 is where the tab
// labels appear, which costs about 90px on its own; that predates the script
// lockup and is its own problem.
test('the header fits logo and every tab without the nav scrolling', async ({ page, context }) => {
  await allowImport();   // importing a list is a Selector feature
  await stubApi(context);
  let n = 0;
  await context.route('**/api/discogs-search', (route) => {
    n += 1;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ matches: [discogsMatch(n)] }) });
  });
  await page.setViewportSize(PHONE);
  await signIn(page);
  await fileImportInput(page).setInputFiles(csvFile(
    Array.from({ length: 3 }, (_, i) => ({ artist: `Artist ${i + 1}`, title: `Album ${i + 1}` }))));
  await page.getByText(/Added \d+ records/).waitFor({ timeout: 40_000 });
  const done = page.getByRole('button', { name: /^(Done|Close)$/ }).first();
  if (await done.count()) await done.click();
  await page.waitForTimeout(800);

  for (const width of [360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(350);
    const fit = await page.evaluate(() => {
      const h = document.querySelector('header');
      const cs = getComputedStyle(h);
      const kids = [...h.children];
      const content = kids.reduce((a, k) => a + k.scrollWidth, 0)
        + parseFloat(cs.columnGap || 0) * (kids.length - 1);
      const nav = h.querySelector('nav');
      return {
        tabs: nav.children.length,
        navScrolls: nav.scrollWidth > nav.clientWidth + 1,
        spare: Math.round(h.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - content),
        logoW: Math.round(h.querySelector('img').getBoundingClientRect().width),
      };
    });
    expect(fit.tabs, `four tabs at ${width}px`).toBe(4);
    expect(fit.navScrolls, `nav scrolls sideways at ${width}px`).toBe(false);
    expect(fit.spare, `header has no room left at ${width}px`).toBeGreaterThanOrEqual(0);
    // The script lockup has a legibility floor of roughly 110px at 1x; the
    // header runs it under that and leans on device pixel ratio, so it must
    // not be shrunk any further to buy space.
    expect(fit.logoW, `logo shrunk below its floor at ${width}px`).toBeGreaterThanOrEqual(84);
  }
});
