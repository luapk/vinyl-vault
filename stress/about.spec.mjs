// The About page, and the walkthrough carousel at the top of it.
//
// This file exists because AboutView sat in the codebase fully written and
// unrendered for a long time: the one page explaining the product could not be
// opened by anybody. Nothing caught that, because nothing asserted the route.
// The first test here is that guard, and it is the important one.
import { test, expect } from '@playwright/test';
import { resetMock, signIn, stubApi } from './helpers.mjs';

test.beforeEach(async () => { await resetMock(); });

async function openAbout(page) {
  await page.locator('footer').scrollIntoViewIfNeeded();
  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByText(/Built for the crate/)).toBeVisible({ timeout: 10_000 });
}

const cardState = (page) => page.evaluate(() => {
  const img = document.querySelector('img[src*="/walkthrough/"]');
  // React serialises the background to rgb(), so walk up to the acid ancestor
  // rather than matching the hex in the style attribute.
  let card = img;
  while (card && getComputedStyle(card).backgroundColor !== 'rgb(202, 254, 4)') card = card.parentElement;
  const rail = [...document.querySelectorAll('button[aria-label^="Step "]')];
  return {
    clip: img?.getAttribute('src') || null,
    counter: card?.querySelector('.font-mono')?.textContent?.trim(),
    title: card?.querySelector('h2')?.textContent?.trim(),
    railButtons: rail.length,
    current: rail.findIndex((b) => b.getAttribute('aria-current') === 'true'),
    hasSkip: /(^|\s)Skip(\s|$)/.test(card?.innerText || ''),
  };
});

test('About is reachable from the footer, and opens on the walkthrough', async ({ page, context }) => {
  await stubApi(context);
  await signIn(page);
  await openAbout(page);

  const s = await cardState(page);
  expect(s.clip).toContain('/walkthrough/');   // the real mascot clip, not a placeholder icon
  expect(s.counter).toBe('01 / 04');
  expect(s.title).toBe('Scan the record');
  // No Skip: nothing is being skipped on a page somebody chose to open.
  expect(s.hasSkip).toBe(false);
  // The placeholder "How it works" grid explained the same four steps without
  // any artwork. One explanation of one product.
  await expect(page.getByText(/how it works/i)).toHaveCount(0);
});

test('the carousel wraps at both ends and every step is reachable from the rail', async ({ page, context }) => {
  await stubApi(context);
  await signIn(page);
  await openAbout(page);

  await page.getByRole('button', { name: 'Next step' }).click();
  await expect.poll(async () => (await cardState(page)).counter).toBe('02 / 04');

  // Back past the first step wraps to the last, which is what makes it a
  // carousel rather than the linear sequence the first-run overlay is.
  await page.getByRole('button', { name: 'Previous step' }).click();
  await page.getByRole('button', { name: 'Previous step' }).click();
  await expect.poll(async () => (await cardState(page)).counter).toBe('04 / 04');

  await page.getByRole('button', { name: 'Next step' }).click();
  await expect.poll(async () => (await cardState(page)).counter).toBe('01 / 04');

  await page.getByRole('button', { name: /^Step 3:/ }).click();
  const s = await cardState(page);
  expect(s.counter).toBe('03 / 04');
  expect(s.railButtons).toBe(4);
  expect(s.current).toBe(2);
});
