// The collection's carousel is the angled stack (CrateDig in live mode). It
// has to keep every promise the old flat carousel made, inside a page that
// still scrolls: the records in the user's own order, the parent's arrows,
// dots and keys driving it, a tap on the record in view opening it, and the
// intro played once a visit rather than on every return to the tab.
import { test, expect } from '@playwright/test';
import { resetMock, signIn, stubApi, control, DATA_COVER } from './helpers.mjs';

const USER = { email: 'paul@test.local', password: 'test-password-123' };

async function openCollection(page, count = 30) {
  await resetMock();
  await control('/__test/seed-records', { email: USER.email, records: Array.from({ length: count }, (_, i) => ({
    id: `cc${i}`, discogsId: String(8000 + i), savedAt: Date.UTC(2025, 0, 1) + i * 864e5,
    artist: `Artist ${String.fromCharCode(90 - (i % 26))}`, title: `Album ${String(i).padStart(2, '0')}`,
    coverUrl: DATA_COVER, images: [], tracklist: [], crates: [], tags: [], genres: [],
  })) });
  await signIn(page, USER);
  for (let k = 0; k < 6; k++) {
    const card = page.getByRole('dialog', { name: /^Badge unlocked/ });
    if (await card.isVisible().catch(() => false)) await card.getByRole('button', { name: 'Close' }).click();
    else await page.waitForTimeout(250);
  }
  await page.getByRole('button', { name: /collection/i }).first().click();
  const stage = page.getByLabel(/Angled stack: swipe/);
  await expect(stage).toBeVisible({ timeout: 15_000 });
  return stage;
}

const counter = (page, n, total) => page.getByText(new RegExp(`^${n} of ${total}$`));

test('the collection carousel is the angled stack, driven by its arrows and keys, and opens the record in view', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await stubApi(context);
  const stage = await openCollection(page);
  await expect(counter(page, 1, 30)).toBeVisible();
  // no letter row or divider tabs: the order is the user's, not A to Z
  await expect(page.getByRole('tablist', { name: 'Jump to letter' })).toHaveCount(0);

  // The window's own arrow keys move it, once each (the stage does not add a second step).
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(counter(page, 2, 30)).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('ArrowRight');
  await expect(counter(page, 3, 30)).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('ArrowLeft');
  await expect(counter(page, 2, 30)).toBeVisible({ timeout: 5_000 });

  // A horizontal trackpad swipe steps a record; the vertical wheel scrolls the page.
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(120, 0);
  await expect(counter(page, 3, 30)).toBeVisible({ timeout: 5_000 });
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(y0);
  await expect(counter(page, 3, 30)).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));

  // The caption under the stack names the record a tap on it opens.
  await page.waitForTimeout(700);
  const title = 'Album 02';
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  const cover = await page.locator('[data-dig-i="2"] > div:last-child').boundingBox();
  await page.mouse.click(cover.x + cover.width / 2, cover.y + cover.height / 2);
  await expect(page.getByRole('button', { name: /Remove from collection/ })).toBeVisible({ timeout: 5_000 });

  expect(errors).toEqual([]);
});

test('a sort change starts the list again, and the intro plays once a visit', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await stubApi(context);
  const stage = await openCollection(page);
  await expect(stage).toHaveAttribute('data-intro', 'off', { timeout: 4_000 });

  await stage.focus();
  for (let k = 0; k < 4; k++) await page.keyboard.press('ArrowRight');
  await expect(counter(page, 5, 30)).toBeVisible({ timeout: 5_000 });

  // Sort by artist: Artist A first, back at the start of the list.
  await page.getByRole('button', { name: /^Sort$/ }).click();
  await page.getByRole('button', { name: /^Artist A.Z$/ }).click();
  await expect(counter(page, 1, 30)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('Artist A', { exact: true })).toBeVisible();

  // Away and back: the stack is there at once, no second intro.
  await page.getByRole('button', { name: /^Crates$/ }).first().click();
  await page.getByRole('button', { name: /^Collection$/ }).first().click();
  await expect(page.getByLabel(/Angled stack: swipe/)).toHaveAttribute('data-intro', 'off');

  expect(errors).toEqual([]);
});
