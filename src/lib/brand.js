// The product name, in one place.
//
// It has changed once already (Vinyl Vault to Found Sound) and it was spread
// across thirty files when it did, which is the kind of edit that leaves one
// screen still saying the old name months later. Every user-facing mention now
// reads from here.
//
// Deliberately NOT applied behind the scenes. The localStorage keys
// (`vinylvault_*`), the service worker cache names, the Supabase tables and
// the Vercel project keep their original names: nobody sees them, and renaming
// a storage key orphans the cache on every device that already has one.
export const APP_NAME = 'Found Sound';

// THE LOGO. A keyline lozenge holding the wordmark, with the subline justified
// to the same measure as the lozenge so the two parts read as one block rather
// than a shape with a caption under it.
//
// Every part is outlines, the subline included: it was converted from Hanken
// Grotesk rather than set as live text, so the logo never waits on a webfont
// and cannot reflow if one fails to load.
export const STAMP = {
  acid:  '/logo-stamp-acid.svg',
  white: '/logo-stamp-white.svg',
  black: '/logo-stamp-black.svg',
};

// The same stamp without the subline, for anywhere too small to read it.
//
// "Too small" was guessed at 96px and is actually lower. Rendered and read at
// each device ratio, the stamp's subline is mush at 34, soft at 44, and
// legible from 48 on a 2x or 3x screen; a 1x display needs about 56.
//
// The app header uses these files at 34px with no subline under them at all.
// The tagline sits in the home screen's eyebrow slot instead, which is read
// once on arrival rather than parked over every screen in the app.
export const STAMP_MARK = {
  acid:  '/logo-mark-acid.svg',
  white: '/logo-mark-white.svg',
  black: '/logo-mark-black.svg',
};

// The stacked lockup: FOUND over SOUND inside a rounded keyline.
//
// It exists because the name has a property the horizontal setting throws
// away. FOUND and SOUND are five letters each and differ only in the first,
// so at matched cap height they measure 2605.5 and 2644.2 units, 2.5% apart.
// That stacks into very nearly a rectangle. The horizontal mark is 3.90:1 and
// the full stamp 2.77:1; this is 1.33:1.
//
// The 2.5% is resolved by scaling FOUND up so the two edges are flush, which
// costs about 1px of cap height in 40. A flush edge reads as deliberate where
// a 2.5% rag reads as a mistake, which is the usual call when words are this
// close.
//
// Generated from the same traced outlines as the stamp, so it is the same
// drawing rather than a second interpretation of it. NOTE: the generator
// (stacked.py, on top of letters.py and the w1/w2 traces) is not in this
// repo, exactly like the stamp's own generator. Regenerating or recolouring
// either logo means rebuilding that toolchain first.
export const BLOCK = {
  acid:  '/logo-block-acid.svg',
  white: '/logo-block-white.svg',
  black: '/logo-block-black.svg',
};
