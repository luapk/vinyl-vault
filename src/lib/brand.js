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

// The same mark set on ONE line, for places too short to take two: the header
// pill, where a square two-line block sat badly beside a row of round buttons.
// Traced from the same artwork, the two words split at the gap between them
// and set on a shared baseline, so it is the identical lettering rather than a
// second drawing that could drift.
export const WORDMARK_LINE = {
  acid:  '/wordmark-line-acid.svg',
  white: '/wordmark-line-white.svg',
  black: '/wordmark-line-black.svg',
};
