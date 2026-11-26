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
// The same records seen from above and to one side, standing on edge in one
// long row that bends in a gentle arc, the record in view at its apex. That
// record slides SIDEWAYS part way out of the row and lifts a touch; its
// neighbours part to open a gap for it.
//
// It stays PARALLEL to the rest. It used to turn toward the camera as it came
// out, and a turned sleeve swept its edges through the records beside it. The
// legibility now comes from the whole scene being turned more face-on, not
// from turning the one record, so nothing can intersect: every sleeve is at
// most ISO_ARC off its neighbour's angle, far too little to reach across the
// gap between them (asserted in the tests).

export const ISO_GAP = 0.11;      // spacing between records along the arc
export const ISO_ARC = 0.045;     // radians the row bends per record (about 2.6 degrees)
export const ISO_SLIDE = 0.62;    // how far the record in view slides out of the row
export const ISO_LIFT = 0.05;     // and how far it rises as it does
export const ISO_OPEN = 0.07;     // the gap its neighbours open for it
export const ISO_STEP_ASIDE = 0.5; // how far the records in front of it move aside
export const ISO_AHEAD = 11;      // records rendered behind the one in view
export const ISO_BEHIND = 3;      // records rendered in front of it

const smooth = (t) => t * t * (3 - 2 * t);
const ISO_R = ISO_GAP / ISO_ARC;  // the arc's radius, in sleeves

export function isoPose(d, S) {
  const a = Math.abs(d);
  const pull = a < 1 ? smooth(1 - a) : 0;
  // Neighbours move apart along the row, most at the gap and to nothing two
  // records away; at the record itself this term is zero, so a scrub through
  // it never jumps.
  const near = Math.max(0, 1 - a / 2);
  const part = Math.sign(d) * ISO_OPEN * near * (1 - pull);
  // Position on the arc: the apex (d = 0) is nearest the camera side, and the
  // row bends away from it both ways. Each sleeve faces along the arc.
  // The records IN FRONT of it also step aside, the other way: with the scene
  // turned face-on, the one just in front otherwise covers the left of the
  // cover the carousel is showing. Zero at the record itself, so continuous.
  const aside = d < 0 ? -ISO_STEP_ASIDE * Math.max(0, 1 - a / 4) * (1 - pull) : 0;
  const phi = d * ISO_ARC;
  const ax = -ISO_R * (1 - Math.cos(phi));
  const az = -ISO_R * Math.sin(phi);
  let opacity = 1;
  if (d > ISO_AHEAD - 1) opacity = Math.max(0, ISO_AHEAD - d);
  if (d < -(ISO_BEHIND - 1)) opacity = Math.max(0, ISO_BEHIND + d);
  return {
    x: (ax + aside + pull * ISO_SLIDE) * S,   // the slide is toward the camera side, clear of the records in front
    y: -pull * ISO_LIFT * S,
    z: (az - part) * S,
    ry: phi * 180 / Math.PI,
    rx: 0,
    opacity,
    // Off the apex, both ways, a record dims: the one in prime position is the
    // brightest thing in the row.
    shade: Math.min(0.5, a * 0.07),
  };
}
