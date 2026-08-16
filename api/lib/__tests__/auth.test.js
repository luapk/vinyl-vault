import { describe, it, expect } from 'vitest';
import { isTokenRejected } from '../auth.js';

// The incident this guards: a friend scanned a stack of records with the new
// barcode scanner, hit a transient auth failure, and was told his session had
// expired. He signed out, his collection appeared to vanish, and it only came
// back on refresh. Nothing was lost, but only a rejected token should ever
// produce that message.
describe('isTokenRejected -- only a real rejection signs someone out', () => {
  it('treats 401 and 403 as genuine rejections', () => {
    expect(isTokenRejected({ status: 401, message: 'invalid JWT' })).toBe(true);
    expect(isTokenRejected({ status: 403, message: 'forbidden' })).toBe(true);
  });

  it('does NOT treat a rate limit as a rejection', () => {
    expect(isTokenRejected({ status: 429, message: 'Too many requests' })).toBe(false);
  });

  it('does NOT treat auth-service 5xx as a rejection', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isTokenRejected({ status, message: 'upstream' })).toBe(false);
    }
  });

  it('does NOT treat a transport failure with no status as a rejection', () => {
    expect(isTokenRejected({ message: 'fetch failed' })).toBe(false);
    expect(isTokenRejected(new Error('network error'))).toBe(false);
  });

  it('no error at all is not a rejection', () => {
    expect(isTokenRejected(null)).toBe(false);
    expect(isTokenRejected(undefined)).toBe(false);
  });
});
