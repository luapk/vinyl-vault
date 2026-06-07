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
    image:    '/tier-digger.png',
    name:     'Digger',
    price:    'Free',
    billing:  null,
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
    image:    '/tier-selector.png',
    name:     'Selector',
    price:    `£${PRICE_SELECTOR_YEAR}`,
    billing:  '/ year',
    accentRGB: '201,255,0',
    comingSoon: true,
    founding: `or £${PRICE_FOUNDING} lifetime -- first ${FOUNDING_SEATS}`,
    features: [
      'Unlimited AI scans',
      'BPM label printing',
      'CSV export',
      'Multi-device sync',
      'All Digger features',
    ],
  },
  {
    image:    '/tier-resident.png',
    name:     'Resident',
    price:    `£${PRICE_RESIDENT_YEAR}`,
    billing:  '/ year',
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

// ---- Glass panel style matching VinylCarousel active card -------------------

function glassCard(accentRGB, comingSoon) {
  return {
    borderRadius: 24,
    padding: '28px 28px 24px',
    background: comingSoon
      ? 'linear-gradient(145deg, rgba(var(--fg),0.04) 0%, rgba(var(--fg),0.01) 100%)'
      : `linear-gradient(145deg, rgba(${accentRGB},0.13) 0%, rgba(${accentRGB},0.05) 55%, rgba(var(--fg),0.02) 100%)`,
    backdropFilter: 'blur(28px) saturate(180%)',
    WebkitBackdropFilter: 'blur(28px) saturate(180%)',
    border: `1px solid rgba(var(--fg),${comingSoon ? '0.07' : '0.13'})`,
    boxShadow: comingSoon
      ? '0 8px 32px -8px rgba(0,0,0,0.5), inset 0 1px 0 rgba(var(--fg),0.08)'
      : `0 32px 72px -12px rgba(0,0,0,0.85), inset 0 1px 0 rgba(var(--fg),0.18), inset 0 -1px 0 rgba(0,0,0,0.15), 0 0 0 1px rgba(var(--fg),0.07)`,
    opacity: comingSoon ? 0.6 : 1,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    boxSizing: 'border-box',
  };
}

// ---- Sub-components ----------------------------------------------------------

function FeatureRow({ text }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
      <Check size={13} weight="bold" style={{ color: 'rgba(var(--fg),0.4)', marginTop: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'rgba(var(--fg),0.6)', lineHeight: 1.45 }}>{text}</span>
    </div>
  );
}

function TierCard({ tier, onGetStarted }) {
  const { image, name, price, billing, accentRGB, comingSoon, founding, features } = tier;
  const accentHex = accentRGB === '91,33,212' ? '#5B21D4'
    : accentRGB === '201,255,0' ? '#C9FF00'
    : '#AC90E2';
  const ctaOnDark = accentHex === '#C9FF00' || accentHex === '#60EDD6';

  return (
    <div style={glassCard(accentRGB, comingSoon)}>
      {/* Roundel image -- 30% bigger than original 110px = 143px */}
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
        <img src={image} alt={name}
          style={{ width: 143, height: 143, objectFit: 'contain', filter: comingSoon ? 'grayscale(0.35) brightness(0.8)' : 'none' }} />
      </div>

      {/* Tier name */}
      <div style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.35)', marginBottom: 6 }}>
        {name}
      </div>

      {/* Price */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: founding ? 4 : 16 }}>
        <span style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.03em', color: comingSoon ? 'rgba(var(--fg),0.35)' : 'rgba(var(--fg),0.92)', lineHeight: 1 }}>
          {price}
        </span>
        {billing && (
          <span style={{ fontSize: 12, color: 'rgba(var(--fg),0.3)', fontFamily: 'monospace' }}>
            {billing}
          </span>
        )}
      </div>

      {/* Founding offer note */}
      {founding && (
        <div style={{ fontSize: 11, marginBottom: 16, color: `rgb(${accentRGB})`, fontFamily: 'monospace', fontWeight: 600, opacity: 0.7 }}>
          {founding}
        </div>
      )}

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(var(--fg),0.07)', marginBottom: 18 }} />

      {/* Features */}
      <div style={{ flex: 1 }}>
        {features.map(f => <FeatureRow key={f} text={f} />)}
      </div>

      {/* CTA */}
      <button
        onClick={comingSoon ? undefined : onGetStarted}
        disabled={comingSoon}
        style={{
          width: '100%',
          marginTop: 20,
          padding: '12px 0',
          borderRadius: 14,
          fontSize: 13,
          fontWeight: 600,
          letterSpacing: '0.01em',
          cursor: comingSoon ? 'default' : 'pointer',
          border: comingSoon
            ? '1px solid rgba(var(--fg),0.08)'
            : `1px solid rgba(${accentRGB},0.5)`,
          background: comingSoon
            ? 'rgba(var(--fg),0.04)'
            : `linear-gradient(160deg, rgba(${accentRGB},0.9) 0%, rgba(${accentRGB},0.65) 100%)`,
          color: comingSoon
            ? 'rgba(var(--fg),0.18)'
            : ctaOnDark ? '#000' : '#fff',
          boxShadow: comingSoon
            ? 'none'
            : `0 4px 20px rgba(${accentRGB},0.3), inset 0 1px 0 rgba(255,255,255,0.2)`,
          transition: 'all 0.15s',
        }}>
        {comingSoon ? 'Coming soon' : 'Get started'}
      </button>
    </div>
  );
}

// ---- Swipe carousel ----------------------------------------------------------

function TierCarousel({ onGetStarted }) {
  const [idx, setIdx] = useState(0);
  const startXRef = useRef(null);
  const startTimeRef = useRef(null);
  const didDragRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState(0);

  const goTo = (i) => setIdx(Math.max(0, Math.min(TIERS.length - 1, i)));

  const onTouchStart = (e) => {
    startXRef.current = e.touches[0].clientX;
    startTimeRef.current = performance.now();
    didDragRef.current = false;
    setDragging(true);
    setDragDelta(0);
  };
  const onTouchMove = (e) => {
    if (startXRef.current === null) return;
    const d = e.touches[0].clientX - startXRef.current;
    if (Math.abs(d) > 6) didDragRef.current = true;
    if (didDragRef.current) setDragDelta(d);
  };
  const onTouchEnd = (e) => {
    if (startXRef.current === null) return;
    const d = e.changedTouches[0].clientX - startXRef.current;
    const vel = d / Math.max(performance.now() - startTimeRef.current, 1);
    startXRef.current = null;
    setDragging(false);
    setDragDelta(0);
    if (!didDragRef.current) return;
    if (d < -40 || vel < -0.22) goTo(idx + 1);
    else if (d > 40 || vel > 0.22) goTo(idx - 1);
  };

  // Mouse drag for desktop
  const mouseDownX = useRef(null);
  const onMouseDown = (e) => { mouseDownX.current = e.clientX; didDragRef.current = false; setDragging(true); };
  const onMouseMove = (e) => {
    if (mouseDownX.current === null) return;
    const d = e.clientX - mouseDownX.current;
    if (Math.abs(d) > 6) didDragRef.current = true;
    if (didDragRef.current) setDragDelta(d);
  };
  const onMouseUp = (e) => {
    if (mouseDownX.current === null) return;
    const d = e.clientX - mouseDownX.current;
    mouseDownX.current = null;
    setDragging(false);
    setDragDelta(0);
    if (!didDragRef.current) return;
    if (d < -40) goTo(idx + 1);
    else if (d > 40) goTo(idx - 1);
  };

  const clampedDelta = Math.sign(dragDelta) * Math.min(Math.abs(dragDelta), 60);

  return (
    <div style={{ width: '100%', userSelect: 'none' }}>
      {/* Track */}
      <div
        style={{ overflow: 'hidden', cursor: dragging ? 'grabbing' : 'grab' }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}
        onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}
      >
        <div style={{
          display: 'flex',
          transform: `translateX(calc(${-idx * 100}% + ${clampedDelta}px))`,
          transition: dragging ? 'none' : 'transform 0.35s cubic-bezier(0.25,1.1,0.5,1)',
          willChange: 'transform',
        }}>
          {TIERS.map((tier, i) => (
            <div key={tier.name} style={{ minWidth: '100%', padding: '0 4px', boxSizing: 'border-box' }}>
              <TierCard tier={tier} onGetStarted={onGetStarted} />
            </div>
          ))}
        </div>
      </div>

      {/* Dot indicators + arrows */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 24 }}>
        <button onClick={() => goTo(idx - 1)} disabled={idx === 0}
          style={{ background: 'none', border: 'none', cursor: idx === 0 ? 'default' : 'pointer', color: `rgba(var(--fg),${idx === 0 ? '0.15' : '0.45'})`, padding: 4, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}>
          <CaretLeft size={16} weight="bold" />
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          {TIERS.map((_, i) => (
            <button key={i} onClick={() => goTo(i)}
              style={{
                width: i === idx ? 20 : 6, height: 6,
                borderRadius: 3, border: 'none', cursor: 'pointer', padding: 0,
                background: i === idx ? `rgba(var(--fg),0.6)` : 'rgba(var(--fg),0.15)',
                transition: 'all 0.25s cubic-bezier(0.25,1.1,0.5,1)',
              }} />
          ))}
        </div>

        <button onClick={() => goTo(idx + 1)} disabled={idx === TIERS.length - 1}
          style={{ background: 'none', border: 'none', cursor: idx === TIERS.length - 1 ? 'default' : 'pointer', color: `rgba(var(--fg),${idx === TIERS.length - 1 ? '0.15' : '0.45'})`, padding: 4, display: 'flex', alignItems: 'center', transition: 'color 0.15s' }}>
          <CaretRight size={16} weight="bold" />
        </button>
      </div>
    </div>
  );
}

// ---- Main component ----------------------------------------------------------

export default function PricingScreen({ onGetStarted, onSignIn }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-start px-5 py-10 overflow-y-auto"
      style={{ background: 'var(--bg-hex)' }}>

      {/* Subtle top vignette */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(var(--fg),0.04) 0%, transparent 50%)',
      }} />

      <div className="w-full relative" style={{ maxWidth: 440 }}>

        {/* Logo -- 25% bigger than original 72px = 90px, screen blend for transparent bg */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 32 }}>
          <img src="/logo.png" alt="Vinyl Vault"
            style={{ height: 90, mixBlendMode: 'screen', opacity: 0.92, filter: 'drop-shadow(0 0 20px rgba(var(--fg),0.1))' }} />
        </div>

        {/* Headline */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <h1 style={{ fontSize: 'clamp(26px, 6vw, 38px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: 'rgba(var(--fg),0.92)', margin: '0 0 10px' }}>
            For collectors<br />who play out.
          </h1>
          <p style={{ fontSize: 14, color: 'rgba(var(--fg),0.38)', margin: 0, lineHeight: 1.55 }}>
            Free for the community. Funded by paying members.
          </p>
        </div>

        {/* Swipeable tier carousel */}
        <TierCarousel onGetStarted={onGetStarted} />

        {/* Footer links */}
        <div style={{ textAlign: 'center', marginTop: 28, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 13, color: 'rgba(var(--fg),0.25)', margin: 0 }}>
            Already have an account?{' '}
            <button onClick={onSignIn}
              style={{ color: 'rgba(var(--fg),0.5)', textDecoration: 'underline', textUnderlineOffset: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
              Sign in
            </button>
          </p>
          <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.18)', margin: 0, letterSpacing: '0.04em' }}>
            Selector and Resident launching soon. Fair use applies to AI scans.
          </p>
        </div>
      </div>
    </div>
  );
}
