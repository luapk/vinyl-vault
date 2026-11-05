// The splash clip order: one deliberate hero on a first open, rotation after.
//
// This is the first thing anybody ever sees of the product, and all of it is
// decided by one localStorage counter at module load. Three things can go
// wrong quietly: the hero stops being first, the rotation stops advancing (so
// a returning user sees one clip forever), or a clip fails to load and the
// first impression is a broken image icon. None of them would throw.
import { test, expect } from '@playwright/test';

const name = (u) => u.split('/').pop().split('?')[0];

test('a first open gets the hero, later opens rotate, and something always renders', async ({ page }) => {
  const requested = [];
  page.on('request', (r) => {
    if (/\/splash[^/]*\.webp/.test(r.url())) requested.push(name(r.url()));
  });

  // The first-run walkthrough overlay renders BEFORE the splash, so without
  // dismissing it the splash is never reached.
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('walkthroughSeen', '1');
    localStorage.removeItem('vv_splash_i');
  });

  const open = async () => {
    const before = requested.length;
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const img = await page.evaluate(() => {
      const el = [...document.querySelectorAll('img')].find((i) => /splash/.test(i.getAttribute('src') || ''));
      return el ? { src: el.getAttribute('src'), w: el.naturalWidth } : null;
    });
    return { asked: requested.slice(before), img };
  };

  // 1. The hero is what a first open reaches for.
  const first = await open();
  expect(first.asked[0]).toBe('splash-flight.webp');
  // Whatever it settles on must be a clip that actually decoded. This is the
  // guard that matters: it holds whether the hero loads or falls back.
  expect(first.img).not.toBeNull();
  expect(first.img.w).toBeGreaterThan(0);

  // 2. Every open after that advances through the rotation, in order, wrapping.
  const order = ['splash.webp', 'splash2.webp', 'splash4.webp', 'splash.webp', 'splash2.webp'];
  for (const expected of order) {
    const next = await open();
    expect(next.asked).toContain(expected);
    expect(next.img.w).toBeGreaterThan(0);
    // The hero is a first-open-only clip and must not re-enter the rotation.
    expect(next.asked).not.toContain('splash-flight.webp');
  }
});
