// A new visitor's first screen is the promo reel, with a Skip over it, and
// the reel hands over to the pricing tiers. After that, a signed-out visit on
// the same device goes straight to sign-in. Somebody already signed in never
// gets the reel, a reel that fails to load never traps anyone, and About can
// play it again on demand.
import { test, expect } from '@playwright/test';
import { resetMock, signIn, stubApi } from './helpers.mjs';

const reel = (page) => page.getByRole('dialog', { name: /demo/ });
const onPricing = (page) => expect(page.getByRole('button', { name: 'Get started' }).first()).toBeVisible();
const onSignIn = (page) => expect(page.getByPlaceholder('you@example.com')).toBeVisible();

test('first visit: the reel, then the tiers; next visit: straight to sign-in', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await page.goto('/');

  await expect(reel(page)).toBeVisible({ timeout: 15_000 });
  await expect(reel(page).getByRole('button', { name: 'Play the demo with sound' })).toBeVisible();
  // The way out is there before anything plays.
  await reel(page).getByRole('button', { name: 'Skip' }).click();
  await expect(reel(page)).toBeHidden();
  await onPricing(page);

  await page.reload();
  await onSignIn(page);
  await expect(reel(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Get started' })).toHaveCount(0);
});

test('a reel that cannot load hands straight over to the tiers', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await context.route('**/demo-reel.mp4*', (r) => r.fulfill({ status: 404, body: '' }));
  await page.goto('/');
  await onPricing(page);
  await expect(reel(page)).toHaveCount(0);
});

test('a signed-in user is never shown the reel, and About plays it on demand', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await signIn(page);

  // A device that never saw the reel, with a session already on it.
  await page.evaluate(() => localStorage.removeItem('vv_reel_seen'));
  await page.reload();
  await expect(page.locator('button[title="Account settings"]')).toBeVisible({ timeout: 15_000 });
  await expect(reel(page)).toHaveCount(0);

  await page.getByRole('button', { name: 'About' }).first().click();
  await page.getByRole('button', { name: 'Watch demo' }).click();
  await expect(reel(page)).toBeVisible();
  await reel(page).getByRole('button', { name: 'Close' }).click();
  await expect(reel(page)).toBeHidden();
  await expect(page.getByRole('button', { name: 'Watch demo' })).toBeVisible();
});
