import { describe, it, expect } from 'vitest';
import { costUsd, rateFor, MODEL_RATES } from '../aiUsage.js';

describe('costUsd', () => {
  it('prices a call from the token counts the API reported', () => {
    // Sonnet 4.6: $3 in, $15 out per million.
    expect(costUsd('claude-sonnet-4-6', { input_tokens: 1_000_000, output_tokens: 1_000_000 })).toBe(18);
    expect(costUsd('claude-haiku-4-5-20251001', { input_tokens: 2000, output_tokens: 500 })).toBeCloseTo(0.0045, 6);
  });

  it('prices cache reads and writes at their own rates', () => {
    const r = MODEL_RATES['claude-sonnet-4-6'];
    const out = costUsd('claude-sonnet-4-6', {
      input_tokens: 0, output_tokens: 0,
      cache_creation_input_tokens: 1_000_000,
      cache_read_input_tokens: 1_000_000,
    });
    expect(out).toBeCloseTo(r.cacheWrite + r.cacheRead, 6);
  });

  it('is zero for a call that reported nothing', () => {
    expect(costUsd('claude-sonnet-4-6', {})).toBe(0);
    expect(costUsd('claude-sonnet-4-6', { input_tokens: null, output_tokens: undefined })).toBe(0);
  });

  it('reads a dated model id as its family', () => {
    expect(rateFor('claude-sonnet-4-6-20260101')).toEqual(MODEL_RATES['claude-sonnet-4-6']);
    expect(rateFor('claude-haiku-4-5')).toEqual(MODEL_RATES['claude-haiku-4-5-20251001']);
  });

  it('prices an unknown model at the dearest rate, never at zero', () => {
    // Same rule the landed cost follows for an unknown origin: an
    // under-estimate is the failure that costs money, so a model nobody added
    // to the table shows up expensive rather than free.
    const unknown = rateFor('some-model-nobody-added');
    const dearest = Object.values(MODEL_RATES).reduce((a, b) => (b.output > a.output ? b : a));
    expect(unknown).toEqual(dearest);
    expect(costUsd('some-model-nobody-added', { input_tokens: 1000, output_tokens: 1000 })).toBeGreaterThan(0);
  });
});
