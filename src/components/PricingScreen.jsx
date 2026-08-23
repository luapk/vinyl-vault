import { useState, useRef } from 'react';
import { Check, CaretRight } from '@phosphor-icons/react';
import {
  PRICE_SELECTOR_YEAR,
  PRICE_RESIDENT_YEAR,
  PRICE_FOUNDING,
  FOUNDING_SEATS,
  FREE_SCANS,
  FREE_LABELS,
} from '../lib/pricing.js';

// Brand acid + ink. This screen is deliberately theme-independent: acid page,
// black chrome, dark cards with white interiors -- matching the splash and app
// icon (black-on-acid). ACID matches the value the mascot clips decode to.
const ACID = '#cafe04';
const INK = '#08080c';

// ---- Tier definitions --------------------------------------------------------

const TIERS = [
  {
    image:     '/tier-digger.png',
    name:      'Digger',
    price:     'Free',
    billing:   null,
    accentRGB: '91,33,212',
    comingSoon: false,
    features: [
      `${FREE_SCANS} AI photo scans`,
      `${FREE_LABELS} BPM label prints`,
      'Discogs bulk import',
      'Smart sort into crates',
      'Browse and search',
    ],
  },
  {
    image:     '/tier-selector.png',
    name:      'Selector',
    price:     `£${PRICE_SELECTOR_YEAR}`,
    billing:   '/ year',
    accentRGB: '201,255,0',
    comingSoon: false,
    priceEnvKey:        'VITE_STRIPE_PRICE_SELECTOR_YEAR',
    foundingPriceEnvKey:'VITE_STRIPE_PRICE_SELECTOR_FOUNDING',
    founding:  `or £${PRICE_FOUNDING} lifetime -- first ${FOUNDING_SEATS}`,
    features: [
      'Unlimited AI scans',
      'Tracks view: BPM and key for every track',
      'BPM label printing',
      'CSV export and multi-device sync',
      'All Digger features',
    ],
  },
  {
    image:     '/tier-resident.png',
    name:      'Resident',
    price:     `£${PRICE_RESIDENT_YEAR}`,
    billing:   '/ year',
    accentRGB: '172,144,226',
    comingSoon: false,
    priceEnvKey: 'VITE_STRIPE_PRICE_RESIDENT_YEAR',
    features: [
      'Saved, reorderable set crates',
      'Offline booth mode',
      'Priority support and early access',
      'All Selector features',
    ],
  },
];

// ---- Animation helper --------------------------------------------------------

function anim(delay = 0) {
  return {
    animation: `fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) both`,
    animationDelay: `${delay}ms`,
  };
}

// ---- Compact tier card -------------------------------------------------------

const ROUNDEL = 150; // px -- visible roundel diameter
const OVERLAP = 62;  // px -- how much roundel hangs above the panel
// How much of the roundel sits inside the panel (= ROUNDEL - OVERLAP)
const ROUNDEL_INSIDE = ROUNDEL - OVERLAP;

// What the next tier up buys you. Named, not vague: the panel edge peeking at
// the right says "there is more", this says what the more actually is.
const UPSELL = {
  Digger:   'Selector adds unlimited scans and Tracks',
  Selector: 'Resident adds set crates and booth mode',
};

function TierCard({ tier, onGetStarted, onCheckout, onUpsell }) {
  const { image, name, price, billing, comingSoon, founding, features, priceEnvKey, foundingPriceEnvKey } = tier;
  const [checkoutLoading, setCheckoutLoading] = useState(false);

  const handleCta = async () => {
    if (comingSoon) return;
    if (!priceEnvKey || !onCheckout) { onGetStarted?.(); return; }
    const priceId = import.meta.env[priceEnvKey];
    if (!priceId) { onGetStarted?.(); return; } // env not configured yet
    setCheckoutLoading(true);
    try { await onCheckout(priceId); } catch { setCheckoutLoading(false); }
  };

  const handleFounding = async () => {
    if (!foundingPriceEnvKey || !onCheckout) return;
    const priceId = import.meta.env[foundingPriceEnvKey];
    if (!priceId) return;
    setCheckoutLoading(true);
    try { await onCheckout(priceId); } catch { setCheckoutLoading(false); }
  };

  const upsell = UPSELL[name];

  return (
    // Outer wrapper provides space for the overhanging roundel
    <div style={{ paddingTop: OVERLAP, width: '100%', height: '100%', boxSizing: 'border-box' }}>
      {/* Panel: acid page showing through, described by an ink keyline. No
          fill, no shadow -- the shape is the drawing. */}
      <div style={{
        position: 'relative',
        height: '100%',
        borderRadius: 20,
        background: 'transparent',
        border: `2px ${comingSoon ? 'dashed' : 'solid'} ${INK}`,
        opacity: comingSoon ? 0.5 : 1,
        // Top padding makes room for the roundel that overlaps from above
        paddingTop: ROUNDEL_INSIDE + 12,
        paddingBottom: 16,
        paddingLeft: 18,
        paddingRight: 18,
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: 'column',
      }}>

        {/* Roundel -- floats over the top keyline like a sticker on a frame */}
        <img src={image} alt={name} style={{
          position: 'absolute',
          top: -OVERLAP,
          left: '50%',
          transform: 'translateX(-50%)',
          width: ROUNDEL,
          height: ROUNDEL,
          objectFit: 'contain',
          filter: comingSoon ? 'grayscale(1) opacity(0.6)' : 'none',
          pointerEvents: 'none',
        }} />

        {/* Tier name */}
        <div style={{ fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(8,8,12,0.5)', marginBottom: 3, textAlign: 'center' }}>
          {name}
        </div>

        {/* Price row */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 5, marginBottom: founding ? 2 : 12 }}>
          <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: INK }}>
            {price}
          </span>
          {billing && (
            <span style={{ fontSize: 11, color: 'rgba(8,8,12,0.5)', fontFamily: 'monospace' }}>{billing}</span>
          )}
        </div>

        {/* Founding note */}
        {founding && (
          <div style={{ fontSize: 10, textAlign: 'center', marginBottom: 10, color: 'rgba(8,8,12,0.7)', fontFamily: 'monospace', fontWeight: 600 }}>
            {foundingPriceEnvKey && import.meta.env[foundingPriceEnvKey]
              ? <button onClick={handleFounding} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', fontFamily: 'inherit', fontSize: 'inherit', fontWeight: 'inherit', padding: 0, textDecoration: 'underline', textUnderlineOffset: 2 }}>{founding}</button>
              : founding}
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(8,8,12,0.18)', marginBottom: 11 }} />

        {/* Features */}
        {features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
            <Check size={11} weight="bold" style={{ color: INK, marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'rgba(8,8,12,0.78)', lineHeight: 1.4 }}>{f}</span>
          </div>
        ))}

        {/* CTA -- ink with white type, the one solid mass on the panel */}
        <button
          onClick={handleCta}
          disabled={comingSoon || checkoutLoading}
          className="vv-tier-cta"
          style={{
            width: '100%',
            marginTop: 'auto',
            padding: '12px 0',
            borderRadius: 12,
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: '0.02em',
            cursor: comingSoon || checkoutLoading ? 'default' : 'pointer',
            border: 'none',
            background: comingSoon ? 'rgba(8,8,12,0.25)' : INK,
            color: '#ffffff',
            transition: 'opacity 0.15s',
            opacity: checkoutLoading ? 0.7 : 1,
          }}>
          {checkoutLoading ? 'Redirecting...' : comingSoon ? 'Coming soon' : 'Get started'}
        </button>

        {/* Where the ladder goes next. Reserves its line on every panel so the
            panels stay the same height whether or not there is a tier above. */}
        <div className="vv-tier-upsell" style={{ minHeight: 16, marginTop: 9, textAlign: 'center' }}>
          {upsell && (
            <button onClick={onUpsell}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'monospace', fontSize: 10, letterSpacing: '0.04em', color: 'rgba(8,8,12,0.55)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {upsell}
              <CaretRight size={9} weight="bold" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- Tier row ----------------------------------------------------------------

// Three named tiers do not need dots. On narrow screens the row is a
// scroll-snap track where the next panel is deliberately left peeking at the
// right edge: the cut-off shape is what says "there is another tier", with no
// animation to wait for and nothing to discover. Wide screens drop the
// scrolling entirely and show all three at once (see .vv-tier-* in index.css).
// Below the row, the tier NAMES act as the control, so you can always read
// what your options are instead of decoding anonymous dots.
export function TierCarousel({ onGetStarted, onCheckout }) {
  const [idx, setIdx] = useState(0);
  const rowRef = useRef(null);
  const cellRefs = useRef([]);

  const goTo = (i) => {
    const clamped = Math.max(0, Math.min(TIERS.length - 1, i));
    setIdx(clamped);
    cellRefs.current[clamped]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  // Keep the name buttons in step with wherever the user has scrolled to.
  const onScroll = () => {
    const row = rowRef.current;
    if (!row) return;
    const centre = row.scrollLeft + row.clientWidth / 2;
    let best = 0, bestDist = Infinity;
    cellRefs.current.forEach((cell, i) => {
      if (!cell) return;
      const cellCentre = cell.offsetLeft + cell.offsetWidth / 2;
      const dist = Math.abs(cellCentre - centre);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    setIdx(best);
  };

  return (
    <div style={{ width: '100%' }}>
      <div ref={rowRef} className="vv-tier-row" onScroll={onScroll}>
        {TIERS.map((tier, i) => (
          <div key={tier.name} className="vv-tier-cell" ref={el => { cellRefs.current[i] = el; }}>
            <TierCard
              tier={tier}
              onGetStarted={onGetStarted}
              onCheckout={onCheckout}
              onUpsell={() => goTo(i + 1)}
            />
          </div>
        ))}
      </div>

      {/* Names, not dots. Hidden on wide screens where all three are visible. */}
      <div className="vv-tier-nav">
        {TIERS.map((tier, i) => (
          <button key={tier.name} onClick={() => goTo(i)}
            style={{
              flex: '0 1 auto',
              padding: '7px 14px',
              borderRadius: 100,
              cursor: 'pointer',
              fontFamily: 'monospace',
              fontSize: 10,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              fontWeight: 700,
              border: `1.5px solid ${INK}`,
              background: i === idx ? INK : 'transparent',
              color: i === idx ? ACID : INK,
              transition: 'background 0.2s, color 0.2s',
            }}>
            {tier.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---- Main component ----------------------------------------------------------

export default function PricingScreen({ onGetStarted, onSignIn }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-8 overflow-y-auto"
      style={{ background: ACID }}>

      <div className="vv-pricing-wrap" style={{ width: '100%', position: 'relative' }}>

        {/* Logo -- black logotype on acid */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18, ...anim(0) }}>
          <img src="/logo-black.png" alt="Vinyl Vault"
            style={{ width: 'min(58vw, 230px)', height: 'auto' }} />
        </div>

        {/* Headline */}
        <div style={{ textAlign: 'center', marginBottom: 24, ...anim(120) }}>
          <h1 style={{ fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, color: INK, margin: '0 0 6px' }}>
            For collectors who play out
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(8,8,12,0.6)', margin: 0, lineHeight: 1.4 }}>
            Smart vinyl sorting tool, from shelf to booth.
          </p>
        </div>

        {/* Carousel */}
        <div style={anim(260)}>
          <TierCarousel onGetStarted={onGetStarted} />
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 6, ...anim(380) }}>
          <p style={{ fontSize: 13, color: 'rgba(8,8,12,0.55)', margin: 0 }}>
            Already have an account?{' '}
            <button onClick={onSignIn}
              style={{ color: INK, fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 3,
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
              Sign in
            </button>
          </p>
          <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(8,8,12,0.4)', margin: 0, letterSpacing: '0.04em' }}>
            Selector and Resident launching soon. Fair use applies.
          </p>
        </div>
      </div>
    </div>
  );
}
