// Geometry for the crate dig, the Lab's 3D carousel: records standing upright
// in a crate, seen from slightly above, flicked forward one at a time.
//
// Everything is a function of d, a record's distance from the scrub position
// (0 is the record being looked at, positive is further back in the crate,
// negative has already been flicked forward). Pure, so it is unit-tested and
// so the render loop can call it sixty times a second without allocating
// anything it does not hand straight to a style.

// One sleeve is S pixels square. These are fractions of S.
export const BACK_GAP = 0.17;    // depth between records further back
export const BACK_RISE = 0.055;  // extra lift per record back, so their tops read as a stack
export const LIFT = 0.15;        // how far the current record rises out of the crate
export const TIP = 84;           // degrees a flicked record falls toward the viewer
export const AHEAD = 7;          // records rendered behind the current one
export const BEHIND = 2;         // flicked records still in view

export function cardPose(d, S) {
  const lift = Math.max(0, 1 - Math.abs(d)) * LIFT * S;
  if (d >= 0) {
    return {
      y: -lift - d * BACK_RISE * S,
      z: -d * BACK_GAP * S,
      rx: Math.min(d, 1) * 9,              // records behind lean back a touch
      opacity: d > AHEAD - 1 ? Math.max(0, AHEAD - d) : 1,
      shade: Math.min(0.6, d * 0.11),      // further back is darker, cheaper than a filter
      zIndex: 500 - Math.round(d * 10),
    };
  }
  const t = -d;                            // 0..BEHIND: how far through the flick
  return {
    y: -lift,
    z: t * 0.06 * S,
    rx: -Math.min(t, 1) * TIP,             // hinged at the base, the top falls toward you
    opacity: Math.max(0, 1 - Math.max(0, t - 0.85) * 1.15),
    shade: Math.min(0.5, t * 0.35),
    zIndex: 700 + Math.round(t * 10),
  };
}

// Sort key for the dividers: "The Beatles" files under B, as in a shop.
export function digKey(artist) {
  return String(artist || '').trim().replace(/^the\s+/i, '').toUpperCase();
}

export function digLetter(artist) {
  const c = digKey(artist).charAt(0);
  return /[A-Z]/.test(c) ? c : '#';
}

// Artist order, A to Z, numbers and symbols first under '#'.
export function digSort(records) {
  return [...records].sort((a, b) => {
    const la = digLetter(a.artist), lb = digLetter(b.artist);
    if (la !== lb) return la === '#' ? -1 : lb === '#' ? 1 : la.localeCompare(lb);
    return digKey(a.artist).localeCompare(digKey(b.artist)) || String(a.title || '').localeCompare(String(b.title || ''));
  });
}

// Where each letter starts: { letter, index } in order, one per letter present.
export function dividers(sorted) {
  const out = [];
  let last = null;
  sorted.forEach((r, i) => {
    const l = digLetter(r.artist);
    if (l !== last) { out.push({ letter: l, index: i }); last = l; }
  });
  return out;
}

// A divider tab's horizontal position across the sleeve, A at the left edge,
// Z at the right, the way shop dividers are staggered so every one shows.
export function tabOffset(letter) {
  if (letter === '#') return 0;
  return (letter.charCodeAt(0) - 65) / 25;
}

// Where a flick comes to rest: the current position carried on by its
// velocity (records per ms), rounded to a whole record and kept in range.
export function flickTarget(pos, velocity, count, coast = 260) {
  const target = Math.round(pos + velocity * coast);
  return Math.max(0, Math.min(count - 1, target));
}

// ----- Carousel C: the angled stack -----------------------------------------
// The same records seen from above and to one side, near isometric, standing
// on edge in one long row like a shop shelf. The record in view slides
// SIDEWAYS, part way out of the row toward its open side, lifts a touch and
// turns toward the camera; its neighbours part to open a gap for it. Sliding
// out, rather than up, is what keeps it legible: once it is clear of the row,
// nothing in front of it covers its face.

export const ISO_GAP = 0.11;      // depth between records in the row
export const ISO_SLIDE = 0.62;    // how far the record in view slides out of the row
export const ISO_LIFT = 0.05;     // and how far it rises as it does
export const ISO_TURN = 32;       // degrees it turns toward the camera once out
export const ISO_OPEN = 0.07;     // the gap its neighbours open for it
export const ISO_AHEAD = 11;      // records rendered behind the one in view
export const ISO_BEHIND = 3;      // records rendered in front of it

const smooth = (t) => t * t * (3 - 2 * t);

export function isoPose(d, S) {
  const a = Math.abs(d);
  const pull = a < 1 ? smooth(1 - a) : 0;
  // Neighbours move apart along the row, most at the gap and to nothing two
  // records away; at the record itself this term is zero, so a scrub through
  // it never jumps.
  const near = Math.max(0, 1 - a / 2);
  const part = Math.sign(d) * ISO_OPEN * near * (1 - pull);
  let opacity = 1;
  if (d > ISO_AHEAD - 1) opacity = Math.max(0, ISO_AHEAD - d);
  if (d < -(ISO_BEHIND - 1)) opacity = Math.max(0, ISO_BEHIND + d);
  return {
    x: pull * ISO_SLIDE * S,      // toward the camera side: away from the records in front of it
    y: -pull * ISO_LIFT * S,
    z: (-d * ISO_GAP - part) * S,
    ry: pull * ISO_TURN,
    rx: 0,
    opacity,
    shade: Math.min(0.55, Math.max(0, d) * 0.06),
  };
}
