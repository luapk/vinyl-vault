// Shared helpers for the stress suite.
import { expect } from '@playwright/test';

export const MOCK = 'http://127.0.0.1:8787';
export const JON = { email: 'jon@test.local', password: 'test-password-123' };

export async function control(path, body) {
  const res = await fetch(`${MOCK}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`control ${path} -> ${res.status}`);
  return res.json();
}

export const resetMock = () => control('/__test/reset', {});
export const mockState = () => control('/__test/state');

// Sign in through the real flow: pricing landing -> login screen -> app shell.
export async function signIn(page, { email, password } = JON) {
  await page.goto('/');
  // Signed-out visitors land on the pricing screen first.
  await page.getByRole('button', { name: 'Sign in' }).first().click();
  await page.getByPlaceholder('you@example.com').fill(email);
  await page.getByPlaceholder('••••••••').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  // Signed-in shell: the account settings button exists only past the auth gate.
  await expect(page.locator('button[title="Account settings"]')).toBeVisible({ timeout: 15_000 });
  // First-run walkthrough overlay would intercept clicks: dismiss if shown.
  const skip = page.getByRole('button', { name: 'Skip' });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

// The signed-out marker: a SIGNED_OUT event lands on the AuthScreen
// ("Welcome back"), while a fresh signed-out visit lands on the pricing
// screen ("Already have an account?"). Either counts as safely signed out.
export const signedOutMarker = (page) => page.getByText(/Welcome back|Already have an account\?/).first();

// Stub the app's serverless /api/* endpoints (they don't exist under vite dev).
// discogsMatches: rows returned to any /api/discogs-search call.
export async function stubApi(context, { discogsMatches = [], scanStatus = 200 } = {}) {
  await context.route('**/api/discogs-search', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ matches: discogsMatches }) }));
  await context.route('**/api/scan', (route) =>
    route.fulfill({ status: scanStatus, contentType: 'application/json', body: JSON.stringify(scanStatus === 200 ? { status: 'complete', release: {} } : { error: 'Unauthorized' }) }));
  await context.route('**/api/spotify-features*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await context.route('**/api/image-proxy*', (route) => route.abort());
}

// A 1x1 white JPEG -- enough for the scan pipeline to read and resize.
export const TINY_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
  'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA' +
  'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==', 'base64');

// A tiny data-URI cover so record cards render without any network fetch.
export const DATA_COVER = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

export function discogsMatch(i) {
  return {
    id: 9000 + i,
    artist: `Stress Artist ${i}`,
    recordTitle: `Stress Album ${i}`,
    label: 'Stress Records', catalogNumber: `STR-${i}`, year: 2020 + i,
    country: 'UK', format: 'LP', coverUrl: DATA_COVER,
  };
}

export function csvFile(rows) {
  const body = 'artist,title\n' + rows.map(r => `${r.artist},${r.title}`).join('\n');
  return { name: 'import.csv', mimeType: 'text/csv', buffer: Buffer.from(body) };
}

// A file in the shape that caused the incident: column one is the release,
// column two is a track, so every release appears once per track.
export function trackListFile(releases) {
  const lines = [];
  for (const [release, tracks] of releases) {
    tracks.forEach((t, i) => lines.push(`"${release}","${'AB'[i % 2]}${i + 1}. ${t}"`));
  }
  return { name: 'tracks.csv', mimeType: 'text/csv', buffer: Buffer.from(lines.join('\n')) };
}

// Open Account modal -> Import from file section.
// The file import is reached straight from the home screen's Import card, so
// there is nothing to open first. The account panel offers the same import
// through the same useFileImport hook, so driving either exercises one code
// path; the home card is the shorter route and needs no modal.
export function fileImportInput(page) {
  return page.locator('input[accept*=".csv"]');
}
