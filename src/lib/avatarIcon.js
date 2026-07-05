// Space / sci-fi icon avatars for members without a profile photo.
// The icon is picked deterministically from the profile id, so a given user
// always shows the same one. Rendered black-on-acid (dark) / white-on-black
// (light) via the .vv-avatar-fallback rules in index.css.
import {
  Alien, Planet, Rocket, RocketLaunch, FlyingSaucer, MoonStars,
  ShootingStar, Meteor, Atom, Star, Sun, Sparkle,
} from '@phosphor-icons/react';

export const SPACE_ICONS = [
  Alien, Planet, Rocket, RocketLaunch, FlyingSaucer, MoonStars,
  ShootingStar, Meteor, Atom, Star, Sun, Sparkle,
];

// Returns a Phosphor icon component for the given profile. Stable per id.
export function spaceIconFor(profile) {
  const key = String(profile?.id || profile?.username || profile?.email || '');
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SPACE_ICONS[h % SPACE_ICONS.length];
}
