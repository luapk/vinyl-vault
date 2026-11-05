// The splash clip order: the hero leads, then the rotation, hero included.
//
// This is the first thing anybody sees of the product, and all of it is
// decided by two localStorage keys at module load. Things that can go wrong
// quietly: the hero never reaches a device that already has the app, the
// rotation stops advancing (so a returning user sees one clip forever), or a
// clip fails to load and the first impression is a broken image icon. None of
// them would throw.
import { test, expect } from '@playwright/test';

const name = (u) => u.split('/').pop().split('?')[0];
const HERO = 'splash-flight.webp';
const ROTATION = ['splash-flight.webp', 'splash.webp', 'splash2.webp', 'splash4.webp'];

function recorder(page) {
  const seen = [];
  page.on('request', (r) => {
    if (/\/splash[^/]*\.webp/.test(r.url())) seen.push(name(r.url()));
  });
  return seen;
}

async function open(page, seen) {
  const before = seen.length;
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
  const img = await page.evaluate(() => {
    const el = [...document.querySelectorAll('img')].find((i) => /splash/.test(i.getAttribute('src') || ''));
    return el ? { src: el.getAttribute('src'), w: el.naturalWidth } : null;
  });
  return { asked: seen.slice(before), img };
}

// The first-run walkthrough overlay renders BEFORE the splash, so the splash
// is never reached without dismissing it.
async function prime(page, { rotationCounter = null, heroSeen = null } = {}) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(([i, h]) => {
    localStorage.setItem('walkthroughSeen', '1');
    localStorage.removeItem('vv_splash_i');
    localStorage.removeItem('vv_splash_hero');
    if (i !== null) localStorage.setItem('vv_splash_i', i);
    if (h !== null) localStorage.setItem('vv_splash_hero', h);
  }, [rotationCounter, heroSeen]);
}

test('a device that already uses the app still gets the hero', async ({ page }) => {
  const seen = recorder(page);
  // The exact case that was broken: an existing install, mid-rotation, that
  // has never seen this hero. It must still be served it.
  await prime(page, { rotationCounter: '2' });

  const first = await open(page, seen);
  expect(first.asked).toContain(HERO);
  expect(first.img).not.toBeNull();
  expect(first.img.w).toBeGreaterThan(0);

  // And the hero does not repeat on the very next open: it is shown once per
  // hero, then the rotation carries on from where it was.
  const second = await open(page, seen);
  expect(second.asked).toContain('splash2.webp');
});

test('a brand new device gets the hero first', async ({ page }) => {
  const seen = recorder(page);
  await prime(page);
  const first = await open(page, seen);
  expect(first.asked[0]).toBe(HERO);
  expect(first.img.w).toBeGreaterThan(0);
});

test('a device that has seen this hero goes straight into the rotation, hero included', async ({ page }) => {
  const seen = recorder(page);
  await prime(page, { rotationCounter: '0', heroSeen: `/splash-flight.webp?v=4` });

  const got = [];
  for (let i = 0; i < 5; i++) {
    const o = await open(page, seen);
    expect(o.img.w).toBeGreaterThan(0);
    got.push(o.asked.find((a) => ROTATION.includes(a)));
  }
  // Advances in order and wraps.
  expect(got.slice(0, 4)).toEqual(ROTATION);
  expect(got[4]).toBe(ROTATION[0]);
  // The hero keeps its place in the mix rather than being shown once.
  expect(got).toContain(HERO);
});

test('a clip that fails to load never leaves a broken image', async ({ page }) => {
  const seen = recorder(page);
  await page.route('**/splash-flight.webp*', (r) => r.abort());
  await prime(page);
  const first = await open(page, seen);
  expect(first.asked).toContain(HERO);   // it tried
  expect(first.img).not.toBeNull();
  expect(first.img.w).toBeGreaterThan(0); // and something else decoded
  expect(name(first.img.src)).not.toBe(HERO);
});
