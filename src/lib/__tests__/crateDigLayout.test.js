import { describe, it, expect } from 'vitest';
import { cardPose, digSort, digLetter, dividers, tabOffset, flickTarget, detent, introCamera, CAM_REST, CAM_START, FLICK_MAX, LIFT, AHEAD } from '../crateDigLayout.js';

const S = 300;

describe('cardPose', () => {
  it('shows the current record flat to the camera, lifted out of the crate', () => {
    const p = cardPose(0, S);
    expect(p.rx).toBe(0);
    expect(p.z).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-LIFT * S);
    expect(p.opacity).toBe(1);
    expect(p.shade).toBe(0);
  });

  it('puts every record behind further back, higher, darker and lower in the stack', () => {
    let prev = cardPose(0, S);
    for (let d = 1; d < AHEAD - 1; d++) {
      const p = cardPose(d, S);
      expect(p.z).toBeLessThan(prev.z);
      expect(p.shade).toBeGreaterThanOrEqual(prev.shade);
      expect(p.zIndex).toBeLessThan(prev.zIndex);
      prev = p;
    }
  });

  it('tips a flicked record toward the viewer, in front of everything, and lets it go', () => {
    const half = cardPose(-0.5, S), gone = cardPose(-2, S);
    expect(half.rx).toBeLessThan(0);
    expect(half.zIndex).toBeGreaterThan(cardPose(0, S).zIndex);
    expect(gone.opacity).toBe(0);
  });

  it('moves continuously through the current record, so a scrub never jumps', () => {
    for (const k of ['y', 'z', 'rx']) {
      expect(Math.abs(cardPose(0.001, S)[k] - cardPose(-0.001, S)[k])).toBeLessThan(1);
    }
  });

  it('fades the last record behind rather than popping it in', () => {
    expect(cardPose(AHEAD, S).opacity).toBe(0);
    expect(cardPose(AHEAD - 0.5, S).opacity).toBeCloseTo(0.5);
  });
});

describe('dividers', () => {
  const recs = [
    { artist: 'The Beatles', title: 'Help' }, { artist: 'Aphex Twin', title: 'SAW' },
    { artist: '808 State', title: 'Ninety' }, { artist: 'Burial', title: 'Untrue' },
    { artist: 'Air', title: 'Moon Safari' },
  ];

  it('files "The" under the next word, and numbers first', () => {
    expect(digLetter('The Beatles')).toBe('B');
    expect(digSort(recs).map(r => r.artist)).toEqual(['808 State', 'Air', 'Aphex Twin', 'The Beatles', 'Burial']);
  });

  it('marks where each letter starts, once per letter', () => {
    expect(dividers(digSort(recs))).toEqual([
      { letter: '#', index: 0 }, { letter: 'A', index: 1 }, { letter: 'B', index: 3 },
    ]);
  });

  it('staggers tabs across the sleeve from A to Z', () => {
    expect(tabOffset('A')).toBe(0);
    expect(tabOffset('Z')).toBe(1);
    expect(tabOffset('M')).toBeGreaterThan(tabOffset('C'));
  });
});

describe('flickTarget', () => {
  it('rests on a whole record, coasts with velocity, and stays in range', () => {
    expect(flickTarget(3.4, 0, 10)).toBe(3);
    expect(flickTarget(3, 0.02, 10)).toBeGreaterThan(4);
    expect(flickTarget(1, -1, 10)).toBe(0);
    expect(flickTarget(8, 1, 10)).toBe(9);
  });

  it('treats a gentle release as no flick at all: it lands on the nearest record', () => {
    expect(flickTarget(3.3, 0.002, 100)).toBe(3);
    expect(flickTarget(3.6, -0.002, 100)).toBe(4);
  });

  it('never carries a flick more than FLICK_MAX records', () => {
    expect(flickTarget(10, 5, 100)).toBe(10 + FLICK_MAX);
    expect(flickTarget(50, -5, 100)).toBe(50 - FLICK_MAX);
  });
});

describe('detent', () => {
  it('maps whole and half records to themselves, so a drag never drifts', () => {
    for (const r of [0, 0.5, 1, 1.5, 7, -2]) expect(detent(r)).toBeCloseTo(r);
  });

  it('is slow at each record and fast between them: the record sticks', () => {
    const slope = (r) => (detent(r + 1e-4) - detent(r - 1e-4)) / 2e-4;
    expect(slope(3)).toBeLessThan(0.5);
    expect(slope(3.5)).toBeGreaterThan(1.5);
  });

  it('only ever moves forward as the finger does', () => {
    for (let r = -1; r < 3; r += 0.01) expect(detent(r + 0.01)).toBeGreaterThan(detent(r));
  });
});

describe('introCamera', () => {
  it('starts wide and swung round, and ends exactly on the resting camera', () => {
    const a = introCamera(0), z = introCamera(1);
    expect(a.ry).toBe(CAM_START.ry);
    expect(a.scale).toBe(CAM_START.scale);
    expect(a.pull).toBe(0);
    for (const k of ['ry', 'rx', 'scale', 'tx', 'ty']) expect(z[k]).toBeCloseTo(CAM_REST[k]);
    expect(z.pull).toBe(1);
  });

  it('orbits before it zooms, and pulls the record out last', () => {
    const mid = introCamera(0.4);
    const orbitDone = (mid.ry - CAM_START.ry) / (CAM_REST.ry - CAM_START.ry);
    const zoomDone = (mid.scale - CAM_START.scale) / (CAM_REST.scale - CAM_START.scale);
    expect(orbitDone).toBeGreaterThan(zoomDone);
    expect(introCamera(0.6).pull).toBe(0);
  });
});

import { isoPose, ISO_SLIDE, ISO_AHEAD, ISO_GAP, ISO_STEP_ASIDE, tiltOffset, TILT_RANGE } from '../crateDigLayout.js';

describe('tiltOffset', () => {
  it('is level where the phone was held, side on tilting left and face-on tilting right', () => {
    expect(tiltOffset(0)).toBe(0);
    expect(tiltOffset(-15)).toBeLessThan(0);     // ry more negative: more side on
    expect(tiltOffset(15)).toBeGreaterThan(0);   // toward face-on
    expect(tiltOffset(15)).toBeCloseTo(-tiltOffset(-15));
  });

  it('never turns the camera past TILT_RANGE, however far the phone goes', () => {
    expect(Math.abs(tiltOffset(90))).toBeLessThanOrEqual(TILT_RANGE);
    expect(Math.abs(tiltOffset(20))).toBeGreaterThan(TILT_RANGE * 0.7);
    expect(tiltOffset(NaN)).toBe(0);
  });
});

describe('isoPose (carousel C)', () => {
  it('slides the record in view out of the row, PARALLEL to the rest, at the apex', () => {
    const p = isoPose(0, S);
    expect(p.x).toBeCloseTo(ISO_SLIDE * S);
    expect(p.ry).toBeCloseTo(0);
    expect(p.y).toBeLessThan(0);
    expect(p.shade).toBe(0);
    expect(p.opacity).toBe(1);
  });

  it('bends the row into an arc that falls away from the apex both ways', () => {
    for (const d of [1, 2, 5]) {
      const ahead = isoPose(d, S), behind = isoPose(-d, S);
      expect(ahead.x).toBeLessThan(0);
      expect(behind.x).toBeLessThanOrEqual(ahead.x + 1e-6);  // the arc, plus the step aside in front
      expect(ahead.ry).toBeCloseTo(-behind.ry);
      expect(ahead.shade).toBeGreaterThan(0);
    }
    expect(Math.abs(isoPose(5, S).ry)).toBeGreaterThan(Math.abs(isoPose(1, S).ry));
    // and stays subtle: the far end of the window is bent, not folded back
    expect(Math.abs(isoPose(ISO_AHEAD, S).ry)).toBeLessThan(35);
  });

  it('moves the records in front of it aside, the other way, so they do not cover it', () => {
    const front = isoPose(-1, S), pulled = isoPose(0, S);
    expect(front.x).toBeLessThan(-ISO_STEP_ASIDE * S * 0.5);
    // a full sleeve width apart: the face in prime position is clear of the one in front
    expect(pulled.x - front.x).toBeGreaterThan(S * 0.95);
    // records behind it do not move aside: the pulled record already covers them
    expect(isoPose(1, S).x).toBeGreaterThan(-0.01 * S);
  });

  it('keeps depth order along the whole row', () => {
    const zs = [-2, -1, 0, 1, 2, 5, 9].map(d => isoPose(d, S).z);
    for (let k = 1; k < zs.length; k++) expect(zs[k]).toBeLessThan(zs[k - 1]);
  });

  it('never lets a neighbour cut through the record in view', () => {
    // The pulled record is parallel at the apex. A neighbour turned by ry and
    // centred at depth z reaches half a sleeve across, so its nearest edge is
    // at |z| - S/2 * sin|ry| from the pulled record's plane. That must stay
    // clear for every step of a scrub past it.
    for (let d = -2; d <= 2; d += 0.05) {
      const here = isoPose(d, S);
      for (const k of [-1, 1]) {
        const n = isoPose(d + k, S);
        const reach = (S / 2) * Math.abs(Math.sin(((n.ry - here.ry) * Math.PI) / 180));
        expect(Math.abs(n.z - here.z) - reach).toBeGreaterThan(0);
      }
    }
  });

  it('opens a gap around it that closes again further along the row', () => {
    expect(isoPose(-1, S).z - isoPose(1, S).z).toBeGreaterThan(2 * ISO_GAP * S * 0.99);
    const far = isoPose(4, S).z - isoPose(5, S).z;
    expect(far).toBeLessThan(ISO_GAP * S * 1.01);
    expect(far).toBeGreaterThan(ISO_GAP * S * 0.9);
  });

  it('moves continuously through the pulled record, so a scrub never jumps', () => {
    for (const k of ['x', 'y', 'z', 'ry']) {
      expect(Math.abs(isoPose(0.002, S)[k] - isoPose(-0.002, S)[k])).toBeLessThan(1);
    }
  });

  it('fades the ends of the row in rather than popping them', () => {
    expect(isoPose(ISO_AHEAD, S).opacity).toBe(0);
    expect(isoPose(-3, S).opacity).toBe(0);
  });
});
