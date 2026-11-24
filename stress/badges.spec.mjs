// The decades, range and passport badges: one card per suite, queued rather
// than stacked, each in its own colour, and all four ladders on the panel.
import { test, expect } from '@playwright/test';
import { resetMock, signIn, stubApi, control, JON, DATA_COVER } from './helpers.mjs';

const SHOTS = process.env.BADGE_SHOTS || null;

// 30 records: three decades of ten (Rewind), ten styles beyond the top-level
// genres (Crossfade), five countries with a region and a duplicate mixed in
// (Carry-On). Under 50, so the records ladder stays quiet.
function collection() {
  const styles = ['Acid House', 'Deep House', 'Techno', 'Dub', 'Disco', 'Electro', 'Ambient', 'Breakbeat', 'Downtempo', 'Jungle'];
  const countries = ['UK', 'US', 'Germany', 'Japan', 'Italy', 'Europe', 'England'];
  return Array.from({ length: 30 }, (_, i) => ({
    id: `badge-${i}`, discogsId: String(70000 + i), savedAt: Date.UTC(2024, 0, 1 + i),
    artist: `Artist ${i}`, title: `Title ${i}`,
    year: [1978, 1988, 1998][Math.floor(i / 10)],
    genres: ['Electronic', styles[i % styles.length]],
    country: countries[i % countries.length],
    coverUrl: DATA_COVER, images: [], tracklist: [], crates: [], tags: [],
  }));
}

test('a collection that earns one tier in each new suite gets three cards, in turn', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await control('/__test/seed-records', { email: JON.email, records: collection() });
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);

  const card = page.getByRole('dialog', { name: /^Badge unlocked/ });
  const expected = [
    ['Rewind', '3 decades', 'rgb(255, 94, 196)'],
    ['Crossfade', '10 styles', 'rgb(92, 225, 255)'],
    ['Carry-On', '5 countries', 'rgb(189, 123, 255)'],
  ];
  for (const [i, [name, unit, colour]] of expected.entries()) {
    await expect(card).toHaveAttribute('aria-label', `Badge unlocked: ${name}`, { timeout: 15_000 });
    await expect(card.getByText(unit, { exact: true })).toBeVisible();
    expect(await card.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(colour);
    // one card at a time, never stacked
    await expect(card).toHaveCount(1);
    if (SHOTS) { await page.waitForTimeout(1600); await page.screenshot({ path: `${SHOTS}/card-${i}.png` }); }
    await card.getByRole('button', { name: 'Close' }).click();
  }
  await expect(card).toHaveCount(0);

  // Nothing replays on reload: every card was banked.
  await page.reload();
  await expect(page.locator('button[title="Account settings"]')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  await expect(card).toHaveCount(0);

  await page.locator('button[title="Account settings"]').click();
  await page.getByRole('button', { name: 'Badges' }).first().click();
  const panel = page.getByRole('dialog', { name: 'Badges' });
  for (const suite of ['Records', 'Decades', 'Range', 'Passport']) {
    await expect(panel.getByRole('region', { name: `${suite} badges` })).toBeVisible();
  }
  await expect(panel.getByText('2 more decades to Time Slip')).toBeVisible();
  await expect(panel.getByText('15 more styles to Wide Ears')).toBeVisible();
  await expect(panel.getByText('5 more countries to Customs Cleared')).toBeVisible();
  if (SHOTS) {
    await panel.locator('> div').evaluate(el => { el.style.maxHeight = 'none'; });
    await page.setViewportSize({ width: 390, height: 1900 });
    await page.screenshot({ path: `${SHOTS}/panel.png` });
  }
});

test('View badges on the first card skips the rest of the queue to the panel', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await control('/__test/seed-records', { email: JON.email, records: collection() });
  await signIn(page);
  const card = page.getByRole('dialog', { name: /^Badge unlocked/ });
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole('button', { name: 'View badges' }).click();
  await expect(page.getByRole('dialog', { name: 'Badges' })).toBeVisible();
  await page.getByRole('button', { name: 'Close badges' }).click();
  await page.waitForTimeout(800);
  await expect(card).toHaveCount(0);
});
