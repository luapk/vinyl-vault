import { useState, useRef } from 'react';
import { Check, CaretLeft, CaretRight } from '@phosphor-icons/react';
import {
  PRICE_SELECTOR_YEAR,
  PRICE_RESIDENT_YEAR,
  PRICE_FOUNDING,
  FOUNDING_SEATS,
  FREE_SCANS,
  FREE_LABELS,
} from '../lib/pricing.js';

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
    comingSoon: true,
    founding:  `or £${PRICE_FOUNDING} lifetime -- first ${FOUNDING_SEATS}`,
    features: [
      'Unlimited AI scans',
      'BPM label printing',
      'CSV export',
      'Multi-device sync',
      'All Digger features',
    ],
  },
  {
    image:     '/tier-resident.png',
    name:      'Resident',
    price:     `£${PRICE_RESIDENT_YEAR}`,
    billing:   '/ year',
    accentRGB: '172,144,226',
    comingSoon: true,
    features: [
      'Harmonic and key sorting',
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

const ROUNDEL = 168; // px -- visible roundel diameter
const OVERLAP = 68;  // px -- how much roundel hangs above the glass card
// How much of the roundel sits inside the card (= ROUNDEL - OVERLAP)
const ROUNDEL_INSIDE = ROUNDEL - OVERLAP; // 100px

function TierCard({ tier, onGetStarted }) {
  const { image, name, price, billing, accentRGB, comingSoon, founding, features } = tier;
  const ctaOnDark = accentRGB === '201,255,0' || accentRGB === '96,237,214';

  return (
    // Outer wrapper provides space for the overhanging roundel
    <div style={{ paddingTop: OVERLAP, width: '100%', boxSizing: 'border-box' }}>
      {/* Glass card */}
      <div style={{
        position: 'relative',
        borderRadius: 22,
        background: comingSoon
          ? 'linear-gradient(145deg, rgba(var(--fg),0.04) 0%, rgba(var(--fg),0.01) 100%)'
          : `linear-gradient(145deg, rgba(${accentRGB},0.14) 0%, rgba(${accentRGB},0.05) 55%, rgba(var(--fg),0.02) 100%)`,
        backdropFilter: 'blur(28px) saturate(180%)',
        WebkitBackdropFilter: 'blur(28px) saturate(180%)',
        border: `1px solid rgba(var(--fg),${comingSoon ? '0.07' : '0.13'})`,
        boxShadow: comingSoon
          ? '0 8px 32px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(var(--fg),0.07)'
          : `0 28px 64px -12px rgba(0,0,0,0.9), inset 0 1px 0 rgba(var(--fg),0.18), inset 0 -1px 0 rgba(0,0,0,0.15), 0 0 0 1px rgba(var(--fg),0.06)`,
        opacity: comingSoon ? 0.58 : 1,
        // Top padding makes room for the roundel that overlaps from above
        paddingTop: ROUNDEL_INSIDE + 14,
        paddingBottom: 18,
        paddingLeft: 20,
        paddingRight: 20,
        boxSizing: 'border-box',
      }}>

        {/* Roundel -- floats above the card top edge */}
        <img src={image} alt={name} style={{
          position: 'absolute',
          top: -OVERLAP,
          left: '50%',
          transform: 'translateX(-50%)',
          width: ROUNDEL,
          height: ROUNDEL,
          objectFit: 'contain',
          filter: comingSoon ? 'grayscale(0.4) brightness(0.75)' : 'none',
          pointerEvents: 'none',
        }} />

        {/* Tier name */}
        <div style={{ fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.32)', marginBottom: 4, textAlign: 'center' }}>
          {name}
        </div>

        {/* Price row */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 5, marginBottom: founding ? 3 : 12 }}>
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, color: comingSoon ? 'rgba(var(--fg),0.32)' : 'rgba(var(--fg),0.92)' }}>
            {price}
          </span>
          {billing && (
            <span style={{ fontSize: 11, color: 'rgba(var(--fg),0.28)', fontFamily: 'monospace' }}>{billing}</span>
          )}
        </div>

        {/* Founding note */}
        {founding && (
          <div style={{ fontSize: 10, textAlign: 'center', marginBottom: 10, color: `rgb(${accentRGB})`, fontFamily: 'monospace', fontWeight: 600, opacity: 0.65 }}>
            {founding}
          </div>
        )}

        {/* Divider */}
        <div style={{ height: 1, background: 'rgba(var(--fg),0.07)', marginBottom: 11 }} />

        {/* Features */}
        {features.map(f => (
          <div key={f} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 7 }}>
            <Check size={11} weight="bold" style={{ color: 'rgba(var(--fg),0.38)', marginTop: 2, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: 'rgba(var(--fg),0.58)', lineHeight: 1.4 }}>{f}</span>
          </div>
        ))}

        {/* CTA */}
        <button
          onClick={comingSoon ? undefined : onGetStarted}
          disabled={comingSoon}
          style={{
            width: '100%',
            marginTop: 14,
            padding: '11px 0',
            borderRadius: 13,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
            cursor: comingSoon ? 'default' : 'pointer',
            border: comingSoon ? '1px solid rgba(var(--fg),0.08)' : `1px solid rgba(${accentRGB},0.45)`,
            background: comingSoon
              ? 'rgba(var(--fg),0.04)'
              : `linear-gradient(160deg, rgba(${accentRGB},0.92) 0%, rgba(${accentRGB},0.65) 100%)`,
            color: comingSoon ? 'rgba(var(--fg),0.18)' : ctaOnDark ? '#000' : '#fff',
            boxShadow: comingSoon ? 'none' : `0 4px 20px rgba(${accentRGB},0.28), inset 0 1px 0 rgba(255,255,255,0.18)`,
            transition: 'all 0.15s',
          }}>
          {comingSoon ? 'Coming soon' : 'Get started'}
        </button>
      </div>
    </div>
  );
}

// ---- Swipe carousel ----------------------------------------------------------

export function TierCarousel({ onGetStarted }) {
  const [idx, setIdx] = useState(0);
  const startXRef   = useRef(null);
  const startTRef   = useRef(null);
  const didDragRef  = useRef(false);
  const [dragging, setDragging]     = useState(false);
  const [dragDelta, setDragDelta]   = useState(0);
  const mouseDownX = useRef(null);

  const goTo = i => setIdx(Math.max(0, Math.min(TIERS.length - 1, i)));

  const onTouchStart = e => {
    startXRef.current = e.touches[0].clientX;
    startTRef.current = performance.now();
    didDragRef.current = false;
    setDragging(true); setDragDelta(0);
  };
  const onTouchMove = e => {
    if (startXRef.current === null) return;
    const d = e.touches[0].clientX - startXRef.current;
    if (Math.abs(d) > 6) didDragRef.current = true;
    if (didDragRef.current) setDragDelta(d);
  };
  const onTouchEnd = e => {
    if (startXRef.current === null) return;
    const d = e.changedTouches[0].clientX - startXRef.current;
    const v = d / Math.max(performance.now() - startTRef.current, 1);
    startXRef.current = null;
    setDragging(false); setDragDelta(0);
    if (!didDragRef.current) return;
    if (d < -40 || v < -0.22) goTo(idx + 1);
    else if (d > 40 || v > 0.22) goTo(idx - 1);
  };
  const onMouseDown = e => { mouseDownX.current = e.clientX; didDragRef.current = false; setDragging(true); };
  const onMouseMove = e => {
    if (mouseDownX.current === null) return;
    const d = e.clientX - mouseDownX.current;
    if (Math.abs(d) > 6) didDragRef.current = true;
    if (didDragRef.current) setDragDelta(d);
  };
  const onMouseUp = e => {
    if (mouseDownX.current === null) return;
    const d = e.clientX - mouseDownX.current;
    mouseDownX.current = null;
    setDragging(false); setDragDelta(0);
    if (!didDragRef.current) return;
    if (d < -40) goTo(idx + 1); else if (d > 40) goTo(idx - 1);
  };

  const clampedDelta = Math.sign(dragDelta) * Math.min(Math.abs(dragDelta), 60);

  return (
    <div style={{ width: '100%' }}>
      <div style={{ overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
        <div style={{
          display: 'flex',
          transform: `translateX(calc(${-idx * 100}% + ${clampedDelta}px))`,
          transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(0.25,1.1,0.5,1)',
          willChange: 'transform',
        }}>
          {TIERS.map(tier => (
            <div key={tier.name} style={{ minWidth: '100%', paddingLeft: 2, paddingRight: 2, boxSizing: 'border-box' }}>
              <TierCard tier={tier} onGetStarted={onGetStarted} />
            </div>
          ))}
        </div>
      </div>

      {/* Dots + arrows */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 14, marginTop: 16 }}>
        <button onClick={() => goTo(idx - 1)} disabled={idx === 0}
          style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: `rgba(var(--fg),${idx === 0 ? '0.15' : '0.4'})`, padding: 4, display: 'flex', transition: 'color 0.15s' }}>
          <CaretLeft size={14} weight="bold" />
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          {TIERS.map((_, i) => (
            <button key={i} onClick={() => goTo(i)}
              style={{ width: i === idx ? 18 : 5, height: 5, borderRadius: 3, border: 'none', cursor: 'pointer', padding: 0,
                background: i === idx ? 'rgba(var(--fg),0.55)' : 'rgba(var(--fg),0.15)',
                transition: 'all 0.25s cubic-bezier(0.25,1.1,0.5,1)' }} />
          ))}
        </div>
        <button onClick={() => goTo(idx + 1)} disabled={idx === TIERS.length - 1}
          style={{ background: 'none', border: 'none', cursor: idx === TIERS.length - 1 ? 'default' : 'pointer', color: `rgba(var(--fg),${idx === TIERS.length - 1 ? '0.15' : '0.4'})`, padding: 4, display: 'flex', transition: 'color 0.15s' }}>
          <CaretRight size={14} weight="bold" />
        </button>
      </div>
    </div>
  );
}

// ---- Main component ----------------------------------------------------------

export default function PricingScreen({ onGetStarted, onSignIn }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-5 py-8 overflow-y-auto"
      style={{ background: 'var(--bg-hex)' }}>

      <div style={{ position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(var(--fg),0.04) 0%, transparent 50%)' }} />

      <div style={{ width: '100%', maxWidth: 400, position: 'relative' }}>

        {/* Logo -- doubled from 90px to 180px */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20, ...anim(0) }}>
          <img src="/logo.png" alt="Vinyl Vault"
            style={{ height: 180, opacity: 0.92 }} />
        </div>

        {/* Headline */}
        <div style={{ textAlign: 'center', marginBottom: 24, ...anim(120) }}>
          <h1 style={{ fontSize: 'clamp(22px, 5.5vw, 30px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.1, color: 'rgba(var(--fg),0.9)', margin: '0 0 6px' }}>
            For collectors who play out
          </h1>
          <p style={{ fontSize: 13, color: 'rgba(var(--fg),0.35)', margin: 0, lineHeight: 1.4 }}>
            Smart vinyl sorting tool, from shelf to booth.
          </p>
        </div>

        {/* Carousel */}
        <div style={anim(260)}>
          <TierCarousel onGetStarted={onGetStarted} />
        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: 18, display: 'flex', flexDirection: 'column', gap: 6, ...anim(380) }}>
          <p style={{ fontSize: 13, color: 'rgba(var(--fg),0.25)', margin: 0 }}>
            Already have an account?{' '}
            <button onClick={onSignIn}
              style={{ color: 'rgba(var(--fg),0.48)', textDecoration: 'underline', textUnderlineOffset: 3,
                background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
              Sign in
            </button>
          </p>
          <p style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(var(--fg),0.16)', margin: 0, letterSpacing: '0.04em' }}>
            Selector and Resident launching soon. Fair use applies.
          </p>
        </div>
      </div>
    </div>
  );
}
