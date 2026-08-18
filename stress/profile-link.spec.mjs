// A community profile must never become somebody's home page.
//
// The app opens on the scan view. The only thing that can override that is a
// profile link, and a link is a one-time instruction: open this profile now.
// It is not a preference, and nothing the browser restores on its own -- a
// reopened tab, a relaunched PWA -- should ever land a user on someone else's
// profile.
//
// This broke twice. First ?u= was written on open and never removed, so the
// param outlived the visit. That was fixed for inbound links and for PWA
// launches, but not for the case that actually bites: tapping a profile inside
// the app and then closing it there. The address bar still said ?u=, so the
// tab the phone restored hours later reopened that profile.
import { test, expect } from '@playwright/test';
import { control, resetMock, signIn, stubApi, DATA_COVER } from './helpers.mjs';

const PAUL_RECORD = { id: 'p1', artist: 'Paul Rec', title: 'X', coverUrl: DATA_COVER, savedAt: 1 };

async function publicPaul() {
  await control('/__test/set-profile', { email: 'paul@test.local', username: 'paul', isPublic: true });
  await control('/__test/seed-records', { email: 'paul@test.local', records: [PAUL_RECORD] });
}

// "New scan" in the DOM, uppercased by CSS.
const onScanHome = (page) => expect(page.getByText('New scan', { exact: true }).first()).toBeVisible();
const onPaulsProfile = (page) => expect(page.getByText('@paul', { exact: true }).first()).toBeVisible();

test('opening a profile in-app does not survive into the next launch', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await publicPaul();

  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page);
  await page.getByRole('button', { name: /Community/ }).first().click();
  await page.getByText('@paul', { exact: true }).click();
  await onPaulsProfile(page);

  // The open profile lives in history state, never in the address bar: the
  // address bar is the one thing a browser restores by itself.
  expect(await page.evaluate(() => location.search)).toBe('');
  expect(await page.evaluate(() => history.state?.u)).toBe('paul');

  // Reopening the app is a reload of whatever URL the tab was left on.
  await page.reload();
  await onScanHome(page);
});

test('an inbound profile link opens once, and leaves nothing behind', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await publicPaul();

  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page);

  // Jon taps a link Paul shared.
  await page.goto('/?u=paul');
  await onPaulsProfile(page);
  // The link is consumed, not kept: bookmarking from here saves the app, not
  // a stranger's profile.
  await expect.poll(() => page.evaluate(() => location.search)).toBe('');

  await page.reload();
  await onScanHome(page);
});

test('back from a profile returns to the community, not out of the app', async ({ page, context }) => {
  await resetMock();
  await stubApi(context);
  await publicPaul();

  await page.setViewportSize({ width: 1100, height: 1000 });
  await signIn(page);
  await page.getByRole('button', { name: /Community/ }).first().click();
  await page.getByText('@paul', { exact: true }).click();
  await onPaulsProfile(page);

  // History state carries the profile, so back/forward still work with a
  // clean address bar.
  await page.goBack();
  await expect(page.getByText('Connect with likeminded collectors.')).toBeVisible();
});
