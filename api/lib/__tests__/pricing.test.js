import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { priceToTier, tierForPrice, pricingConfigured } from '../pricing.js';

// The revenue bug this guards: checkout and the webhook each kept their own
// copy of the price map, built from STRIPE_PRICE_* while the pricing screen
// sent IDs from VITE_STRIPE_PRICE_*. Set only the VITE_ names, as the client
// needs, and every real checkout answered "Unknown price".
const KEYS = [
  'STRIPE_PRICE_SELECTOR_YEAR', 'VITE_STRIPE_PRICE_SELECTOR_YEAR',
  'STRIPE_PRICE_SELECTOR_FOUNDING', 'VITE_STRIPE_PRICE_SELECTOR_FOUNDING',
  'STRIPE_PRICE_RESIDENT_YEAR', 'VITE_STRIPE_PRICE_RESIDENT_YEAR',
];

let saved;
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  KEYS.forEach(k => { delete process.env[k]; });
});
afterEach(() => {
  KEYS.forEach(k => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

describe('price to tier', () => {
  it('reads the server name', () => {
    process.env.STRIPE_PRICE_SELECTOR_YEAR = 'price_sel';
    expect(tierForPrice('price_sel')).toBe('selector');
  });

  it('falls back to the VITE_ name the client sends', () => {
    process.env.VITE_STRIPE_PRICE_RESIDENT_YEAR = 'price_res';
    expect(tierForPrice('price_res')).toBe('resident');
  });

  it('prefers the server name when both are set', () => {
    process.env.STRIPE_PRICE_SELECTOR_YEAR = 'price_server';
    process.env.VITE_STRIPE_PRICE_SELECTOR_YEAR = 'price_client';
    expect(tierForPrice('price_server')).toBe('selector');
    expect(tierForPrice('price_client')).toBe(null);
  });

  it('maps the founding one-time price to selector', () => {
    process.env.STRIPE_PRICE_SELECTOR_FOUNDING = 'price_life';
    expect(tierForPrice('price_life')).toBe('selector');
  });

  it('never builds an undefined key from an unset variable', () => {
    expect(priceToTier()).toEqual({});
    expect(tierForPrice(undefined)).toBe(null);
    expect(tierForPrice('undefined')).toBe(null);
  });

  it('reports whether any price is configured at all', () => {
    expect(pricingConfigured()).toBe(false);
    process.env.STRIPE_PRICE_SELECTOR_YEAR = 'price_sel';
    expect(pricingConfigured()).toBe(true);
  });
});
