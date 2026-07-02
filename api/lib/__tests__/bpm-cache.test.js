import { describe, it, expect } from 'vitest';
import { normKey, durationBucket } from '../bpm-cache.js';

describe('normKey', () => {
  it('lowercases, strips punctuation, collapses whitespace', () => {
    expect(normKey('Aphex Twin')).toBe('aphex twin');
    expect(normKey("Windowlicker (Acid Edit)")).toBe('windowlicker acid edit');
    expect(normKey('  LFO --  LFO ')).toBe('lfo lfo');
  });

  it('handles null/empty', () => {
    expect(normKey(null)).toBe('');
    expect(normKey('')).toBe('');
  });
});

describe('durationBucket', () => {
  it('buckets m:ss into 30s slots', () => {
    expect(durationBucket('0:14')).toBe(0);
    expect(durationBucket('3:00')).toBe(6);
    expect(durationBucket('3:14')).toBe(6);
    expect(durationBucket('7:30')).toBe(15);
  });

  it('handles h:mm:ss', () => {
    expect(durationBucket('1:00:00')).toBe(120);
  });

  it('close pressings share a bucket, different versions do not', () => {
    expect(durationBucket('5:58')).toBe(durationBucket('6:05'));
    expect(durationBucket('3:30')).not.toBe(durationBucket('7:00'));
  });

  it('returns -1 for unknown/garbage', () => {
    expect(durationBucket(null)).toBe(-1);
    expect(durationBucket('')).toBe(-1);
    expect(durationBucket('abc')).toBe(-1);
  });
});
