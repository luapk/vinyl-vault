import { describe, it, expect } from 'vitest';
import { inspectImportShape, releasesFromTrackRows } from './importShape.js';

// Rows in the shape that caused the incident: column one is the release,
// column two is a track.
const trackRows = [
  { artist: 'Bicep - Isles LP', title: 'Sundial' },
  { artist: 'Bicep - Isles LP', title: 'Atlas' },
  { artist: 'Bicep - Isles LP', title: 'Apricots' },
  { artist: 'Gunnar Haslam - Seasick Acid', title: 'B1. Seasick Acid' },
  { artist: 'Gunnar Haslam - Seasick Acid', title: 'A1. Tidal Lock' },
  { artist: 'Aloka - View Source (Haws)', title: 'Blind Spot' },
  { artist: 'Aloka - View Source (Haws)', title: 'A2. Refract' },
  { artist: 'Axel Boman - LUZ', title: 'F2. Jeremy Irons' },
  { artist: 'Axel Boman - LUZ', title: 'A1. Ocelot' },
];

// An ordinary collection export.
const releaseRows = [
  { artist: 'Kraftwerk', title: 'The Mix' },
  { artist: 'Daniel Avery', title: 'Drone Logic' },
  { artist: 'Maurizio', title: 'M6' },
  { artist: 'LoSoul', title: 'Placeless EP' },
  { artist: 'Kassian', title: '8th Movement EP' },
  { artist: 'Rhythm & Sound', title: 'The Versions' },
  { artist: 'Konduku', title: 'Parlama' },
  { artist: 'Jeigo', title: 'We Are Not Nothing' },
  { artist: 'Polito', title: 'Ultraparallel' },
];

describe('inspectImportShape', () => {
  it('spots a tracklist', () => {
    const shape = inspectImportShape(trackRows);
    expect(shape.looksLikeTracklist).toBe(true);
    expect(shape.reasons.length).toBeGreaterThan(0);
  });

  it('leaves an ordinary release list alone', () => {
    expect(inspectImportShape(releaseRows).looksLikeTracklist).toBe(false);
  });

  // A collector with several records by one artist must not be nagged.
  it('does not flag a file just because an artist repeats', () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ artist: 'Aphex Twin', title: `Analogue Bubblebath ${i}` }));
    expect(inspectImportShape(rows).looksLikeTracklist).toBe(false);
  });

  // Nor an artist whose name genuinely contains a dash, when nothing else fits.
  it('does not flag a handful of rows', () => {
    expect(inspectImportShape(trackRows.slice(0, 3)).looksLikeTracklist).toBe(false);
    expect(inspectImportShape([]).looksLikeTracklist).toBe(false);
  });

  it('says what it noticed, in numbers', () => {
    const shape = inspectImportShape(trackRows);
    expect(shape.reasons.join(' ')).toMatch(/%/);
  });
});

describe('releasesFromTrackRows', () => {
  it('recovers one record per release, not one per track', () => {
    expect(releasesFromTrackRows(trackRows)).toEqual([
      { artist: 'Bicep', title: 'Isles LP' },
      { artist: 'Gunnar Haslam', title: 'Seasick Acid' },
      { artist: 'Aloka', title: 'View Source (Haws)' },
      { artist: 'Axel Boman', title: 'LUZ' },
    ]);
  });

  it('keeps a release that carries no artist as a title', () => {
    expect(releasesFromTrackRows([
      { artist: 'Bonkers Music VI', title: 'A1. Neskeh' },
      { artist: 'Bonkers Music VI', title: 'B2. Intruso' },
    ])).toEqual([{ artist: '', title: 'Bonkers Music VI' }]);
  });

  it('ignores rows with nothing in the first column', () => {
    expect(releasesFromTrackRows([{ artist: '', title: 'orphan' }])).toEqual([]);
  });
});
