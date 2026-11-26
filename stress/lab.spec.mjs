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
