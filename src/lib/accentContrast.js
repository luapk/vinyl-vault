// Keep an artwork-derived accent readable against the page.
//
// The accent is pulled from the cover art, which is lovely when there is
// cover art and a problem when there is not: reset() parks it at a pale grey
// (200,200,200) until a record is read. The header's active tab is drawn
// entirely in that accent, so on any scan screen before a cover loads, the
// tab you are actually on was the palest of the four in light mode. The
// current view read as the disabled one.
//
// Clamping luminance rather than replacing the colour keeps the hue, so a
// record with a strong cover still tints its own chrome.

// sRGB relative luminance (WCAG). 0 is black, 1 is white.
export function relativeLuminance({ r, g, b }) {
  const channel = (v) => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

// These are set against the INACTIVE tabs, not against the page. An inactive
// tab draws its text at rgba(--fg, 0.6) in light mode and 0.4 in dark, which
// lands near a mid grey either way (luminance about 0.13). "Readable" is not
// enough for the active tab: it has to be the strongest of the row, or the
// view you are on still looks like the one you are not. So the active accent
// must be DARKER than that in light mode and BRIGHTER than it in dark mode.
export const MAX_ON_LIGHT = 0.13;
export const MIN_ON_DARK = 0.30;

// Walk the colour toward black (light mode) or white (dark mode) until it can
// be read. Bounded: 40 steps of 8% covers white to black and back.
export function legibleAccent(rgb, isDark) {
  let { r, g, b } = rgb || {};
  if ([r, g, b].some(v => typeof v !== 'number' || Number.isNaN(v))) {
    return isDark ? { r: 235, g: 235, b: 235 } : { r: 20, g: 20, b: 20 };
  }
  for (let i = 0; i < 40; i++) {
    const lum = relativeLuminance({ r, g, b });
    if (isDark ? lum >= MIN_ON_DARK : lum <= MAX_ON_LIGHT) break;
    if (isDark) {
      r = r + (255 - r) * 0.08; g = g + (255 - g) * 0.08; b = b + (255 - b) * 0.08;
      // A pure black accent never brightens by proportion alone.
      if (r < 8 && g < 8 && b < 8) { r += 8; g += 8; b += 8; }
    } else {
      r *= 0.92; g *= 0.92; b *= 0.92;
    }
  }
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

// Ready for a CSS rgba() triple.
export function legibleAccentRGB(rgb, isDark) {
  const c = legibleAccent(rgb, isDark);
  return `${c.r}, ${c.g}, ${c.b}`;
}
