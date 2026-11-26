// The Lab's crate dig: a 3D carousel whose whole case is load time, so the
// things worth holding are the ones that keep it cheap and usable. However big
// the collection, only a small window of records is in the DOM; the keyboard
// and the letter row move through it; and the record you can read is the one
// a tap opens.
import { test, expect } from '@playwright/test';
import { resetMock, signIn, stubApi, control, DATA_COVER } from './helpers.mjs';

const ADMIN = { email: 'paul@test.local', password: 'test-password-123' };
const ARTISTS = ['Aphex Twin', 'The Beatles', 'Carl Craig', 'Daft Punk', 'Floating Points', 'Kraftwerk', 'Moodymann', 'Orbital'];

async function openDig(page, count) {
  await resetMock();
  await control('/__test/seed-records', { email: ADMIN.email, records: Array.from({ length: count }, (_, i) => ({
    id: `lab${i}`, discogsId: String(7000 + i), savedAt: Date.UTC(2025, 0, 1) + i * 864e5,
    artist: ARTISTS[i % ARTISTS.length], title: `Record ${String(i).padStart(3, '0')}`,
    coverUrl: DATA_COVER, images: [], tracklist: [], crates: [], tags: [], genres: [],
  })) });
  await signIn(page, ADMIN);
  // a big seeded collection earns badge cards on arrival: clear them first
  for (let k = 0; k < 8; k++) {
    const card = page.getByRole('dialog', { name: /^Badge unlocked/ });
    if (await card.isVisible().catch(() => false)) await card.getByRole('button', { name: 'Close' }).click();
    else await page.waitForTimeout(300);
  }
  await page.locator('button[title="Account settings"]').click();
  await page.getByRole('button', { name: 'Admin panel' }).click();
  await page.getByRole('button', { name: 'Lab' }).click();
  const stage = page.getByLabel(/Crate dig: swipe/);
  await expect(stage).toBeVisible({ timeout: 15_000 });
  return stage;
}

test('a large collection mounts only a small window of records', async ({ page, context }) => {
  await stubApi(context);
  const stage = await openDig(page, 400);
  await expect(stage.getByText('1 / 400')).toBeVisible();
  expect(await page.locator('[data-dig-i]').count()).toBeLessThanOrEqual(11);

  await page.getByRole('tab', { name: 'M' }).click();
  await expect(stage.getByText(/^\d+ \/ 400$/)).not.toHaveText('1 / 400', { timeout: 5_000 });
  expect(await page.locator('[data-dig-i]').count()).toBeLessThanOrEqual(11);
});

test('the keyboard digs, the letter row jumps, and a tap opens the record in view', async ({ page, context }) => {
  await stubApi(context);
  const stage = await openDig(page, 40);
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(stage.getByText('3 / 40')).toBeVisible({ timeout: 5_000 });
  await page.keyboard.press('ArrowLeft');
  await expect(stage.getByText('2 / 40')).toBeVisible({ timeout: 5_000 });

  // Daft Punk is the fourth artist in A to Z order; its records start at 16 of 40.
  await page.getByRole('tab', { name: 'D' }).click();
  await expect(stage.getByText('16 / 40')).toBeVisible({ timeout: 5_000 });
  await expect(page.getByRole('tab', { name: 'D' })).toHaveAttribute('aria-selected', 'true');

  // The title under the crate is the record a tap on the front sleeve opens.
  await page.waitForTimeout(600);
  const shown = (await page.getByText(/^Record \d{3}$/).first().textContent()).trim();
  await page.locator('[data-dig-i="15"]').click({ position: { x: 60, y: 80 } });
  await expect(page.getByText(new RegExp(`Daft Punk · ${shown}`))).toBeVisible();
});

// Carousel C is the same component with a different camera, so it has to keep
// the same promises: a bounded window, the keys, and a tap on the record that
// is pulled out of the row opening that record.
test('carousel C keeps the window small, digs with the keys, and opens the pulled record', async ({ page, context }) => {
  await stubApi(context);
  await openDig(page, 400);
  await page.getByRole('button', { name: 'Carousel C' }).click();
  const stage = page.getByLabel(/Angled stack: swipe/);
  await expect(stage).toBeVisible();
  expect(await page.locator('[data-dig-i]').count()).toBeLessThanOrEqual(15);

  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(page.getByText(/^3 \/ 400/)).toBeVisible({ timeout: 5_000 });

  await page.waitForTimeout(600);
  const shown = (await page.getByText(/^Record \d{3}$/).first().textContent()).trim();
  // Tap the middle of the cover as a person would, with the real mouse at its
  // on-screen centre. Playwright's own click aims at the element's box and runs
  // its own hit check, which misjudges a rotated 3D scene; the mouse checks the
  // app's hit-testing instead, which is the thing that once failed here (the
  // scene plane swallowed taps on the middle of the pulled record).
  const box = await page.locator('[data-dig-i="2"] > div:last-child').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText(new RegExp(`· ${shown}`))).toBeVisible();
});

// Stickiness: a wheel or trackpad moves one record per notch, never a
// continuous scroll, and a trackpad's long momentum tail cannot spin the stack.
test('the wheel steps exactly one record per notch, and a trackpad coast stays in hand', async ({ page, context }) => {
  await stubApi(context);
  const stage = await openDig(page, 400);
  await stage.scrollIntoViewIfNeeded();
  const box = await stage.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 100);
  await expect(stage.getByText('2 / 400')).toBeVisible({ timeout: 5_000 });
  await page.waitForTimeout(400);
  await page.mouse.wheel(0, 100);
  await expect(stage.getByText('3 / 400')).toBeVisible({ timeout: 5_000 });

  // 60 small deltas, 720px in all, the shape of a trackpad swipe and its
  // coast: a few records, where a 50px step would have covered fourteen.
  await page.waitForTimeout(400);
  for (let k = 0; k < 60; k++) { await page.mouse.wheel(0, 12); await page.waitForTimeout(8); }
  await page.waitForTimeout(800);
  const at = Number((await stage.getByText(/^\d+ \/ 400$/).textContent()).split(' ')[0]);
  expect(at).toBeGreaterThan(3);
  expect(at).toBeLessThanOrEqual(7);
});

// Carousel C opens on a short camera move, ends on its own at the resting
// camera, and gets out of the way the moment anyone touches anything.
test('carousel C plays its intro once, ends on its own, and a key cuts it short', async ({ page, context }) => {
  await stubApi(context);
  await openDig(page, 40);
  await page.getByRole('button', { name: 'Carousel C' }).click();
  const stage = page.getByLabel(/Angled stack: swipe/);
  await expect(stage).toHaveAttribute('data-intro', 'on');
  await expect(stage).toHaveAttribute('data-intro', 'off', { timeout: 4_000 });

  // Back to B and into C again: a fresh mount plays it again, and a key ends
  // it on the spot and still moves the record.
  await page.getByRole('button', { name: 'Carousel B' }).click();
  await page.getByRole('button', { name: 'Carousel C' }).click();
  await expect(stage).toHaveAttribute('data-intro', 'on');
  await stage.focus();
  await page.keyboard.press('ArrowRight');
  await expect(stage).toHaveAttribute('data-intro', 'off', { timeout: 300 });
  await expect(page.getByText(/^2 \/ 40/)).toBeVisible({ timeout: 5_000 });
});

test('with reduced motion carousel C has no intro at all', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  await stubApi(context);
  await openDig(page, 40);
  await page.getByRole('button', { name: 'Carousel C' }).click();
  await expect(page.getByLabel(/Angled stack: swipe/)).toHaveAttribute('data-intro', 'off');
  await context.close();
});
