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

// The wordmark, as three flat-colour SVGs in public/. An <img> cannot inherit
// currentColor, so the colour is picked per context rather than themed in CSS.
export const WORDMARK = {
  acid:  '/wordmark-acid.svg',
  white: '/wordmark-white.svg',
  black: '/wordmark-black.svg',
};

// The same mark set on ONE line, for places too short to take two.
export const WORDMARK_LINE = {
  acid:  '/wordmark-line-acid.svg',
  white: '/wordmark-line-white.svg',
  black: '/wordmark-line-black.svg',
};

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

// The same stamp without the subline, for anywhere too small to read it. Below
// about 96px the subline turns to mush, so it is dropped rather than shipped
// illegible.
export const STAMP_MARK = {
  acid:  '/logo-mark-acid.svg',
  white: '/logo-mark-white.svg',
  black: '/logo-mark-black.svg',
};
