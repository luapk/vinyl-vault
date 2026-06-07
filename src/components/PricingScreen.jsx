import { useState } from 'react';
import { Check } from '@phosphor-icons/react';
import {
  PRICE_SELECTOR_YEAR,
  PRICE_RESIDENT_YEAR,
  PRICE_FOUNDING,
  FOUNDING_SEATS,
  FREE_SCANS,
  FREE_LABELS,
} from '../lib/pricing.js';

// ---- Tier feature lists -------------------------------------------------------

const DIGGER_FEATURES = [
  `${FREE_SCANS} AI photo scans`,
  `${FREE_LABELS} BPM label prints`,
  'Discogs bulk import',
  'Smart sort into crates',
  'Browse and search',
];

const SELECTOR_FEATURES = [
  'Unlimited AI scans',
  'BPM label printing',
  'CSV export',
  'Multi-device sync',
  'All Digger features',
];

const RESIDENT_FEATURES = [
  'Harmonic and key sorting',
  'Saved, reorderable set crates',
  'Offline booth mode',
  'Priority support and early access',
  'All Selector features',
];

// ---- Sub-components ----------------------------------------------------------

function FeatureRow({ text }) {
  return (
    <div className="flex items-start gap-2.5">
      <Check size={13} weight="bold" style={{ color: 'rgba(var(--fg),0.45)', marginTop: 2, flexShrink: 0 }} />
      <span style={{ fontSize: 13, color: 'rgba(var(--fg),0.6)', lineHeight: 1.4 }}>{text}</span>
    </div>
  );
}

function TierCard({ image, name, price, billing, features, cta, ctaAction, comingSoon, accentHex, foundingRibbon, dimmed }) {
  return (
    <div className="relative flex flex-col rounded-3xl overflow-hidden"
      style={{
        background: 'rgba(var(--bg),0.6)',
        border: `1px solid ${comingSoon ? 'rgba(var(--fg),0.07)' : 'rgba(var(--fg),0.13)'}`,
        backdropFilter: 'blur(24px)',
        WebkitBackdropFilter: 'blur(24px)',
        boxShadow: comingSoon
          ? 'none'
          : '0 24px 56px -12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(var(--fg),0.1)',
        opacity: dimmed ? 0.55 : 1,
        flex: 1,
        minWidth: 0,
        transition: 'opacity 0.2s',
      }}>

      {/* Founding offer ribbon */}
      {foundingRibbon && !comingSoon && (
        <div className="absolute top-0 right-0 overflow-hidden" style={{ width: 120, height: 120, pointerEvents: 'none', zIndex: 10 }}>
          <div style={{
            position: 'absolute',
            top: 22,
            right: -30,
            width: 130,
            textAlign: 'center',
            fontSize: 9,
            fontFamily: 'monospace',
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: '#000',
            background: accentHex,
            padding: '4px 0',
            transform: 'rotate(45deg)',
          }}>
            Founding offer
          </div>
        </div>
      )}

      {/* Sticker image */}
      <div className="flex items-center justify-center pt-7 pb-4 px-6">
        <img src={image} alt={name}
          style={{ width: 110, height: 110, objectFit: 'contain', filter: comingSoon ? 'grayscale(0.4)' : 'none' }} />
      </div>

      {/* Price */}
      <div className="px-6 pb-3">
        <div style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.35)', marginBottom: 4 }}>
          {name}
        </div>
        <div className="flex items-baseline gap-1.5">
          <span style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.03em', color: comingSoon ? 'rgba(var(--fg),0.4)' : 'rgba(var(--fg),0.9)' }}>
            {price}
          </span>
          {billing && (
            <span style={{ fontSize: 12, color: 'rgba(var(--fg),0.3)', fontFamily: 'monospace' }}>
              {billing}
            </span>
          )}
        </div>
        {foundingRibbon && (
          <div style={{ fontSize: 11, marginTop: 4, color: accentHex, fontFamily: 'monospace', fontWeight: 600 }}>
            or £{PRICE_FOUNDING} lifetime -- first {FOUNDING_SEATS}
          </div>
        )}
      </div>

      {/* Divider */}
      <div style={{ height: 1, background: 'rgba(var(--fg),0.06)', margin: '0 24px 18px' }} />

      {/* Features */}
      <div className="px-6 flex flex-col gap-2.5 flex-1">
        {features.map(f => <FeatureRow key={f} text={f} />)}
      </div>

      {/* CTA */}
      <div className="p-6 pt-5">
        <button
          onClick={ctaAction}
          disabled={comingSoon}
          style={{
            width: '100%',
            padding: '12px 0',
            borderRadius: 14,
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '0.01em',
            cursor: comingSoon ? 'default' : 'pointer',
            border: comingSoon
              ? '1px solid rgba(var(--fg),0.08)'
              : `1px solid ${accentHex}60`,
            background: comingSoon
              ? 'rgba(var(--fg),0.04)'
              : `linear-gradient(160deg, ${accentHex}dd 0%, ${accentHex}99 100%)`,
            color: comingSoon
              ? 'rgba(var(--fg),0.2)'
              : accentHex === '#C9FF00' || accentHex === '#60EDD6' ? '#000' : '#fff',
            boxShadow: comingSoon
              ? 'none'
              : `0 4px 20px ${accentHex}35, inset 0 1px 0 rgba(255,255,255,0.2)`,
            transition: 'all 0.15s',
          }}>
          {cta}
        </button>
      </div>
    </div>
  );
}

// ---- Main component ----------------------------------------------------------

export default function PricingScreen({ onGetStarted, onSignIn }) {
  const [email, setEmail] = useState('');
  const [notifySubmitted, setNotifySubmitted] = useState(false);

  return (
    <div className="min-h-screen flex flex-col items-center justify-start px-4 py-10 overflow-y-auto"
      style={{
        background: 'radial-gradient(ellipse at 30% 0%, rgba(91,33,212,0.18) 0%, transparent 50%), radial-gradient(ellipse at 80% 80%, rgba(201,255,0,0.06) 0%, transparent 45%), var(--bg-hex)',
      }}>

      {/* Ambient layers */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(var(--fg),0.04) 0%, transparent 40%)',
      }} />

      <div className="w-full max-w-4xl relative">

        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src="/logo.png" alt="Vinyl Vault"
            style={{ height: 72, mixBlendMode: 'screen', opacity: 0.9, filter: 'drop-shadow(0 0 20px rgba(var(--fg),0.12))' }} />
        </div>

        {/* Headline */}
        <div className="text-center mb-10">
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 44px)', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1.05, color: 'rgba(var(--fg),0.92)', marginBottom: 10 }}>
            For collectors who play out.
          </h1>
          <p style={{ fontSize: 15, color: 'rgba(var(--fg),0.4)', maxWidth: 420, margin: '0 auto', lineHeight: 1.55 }}>
            Free for the community. Funded by paying members who keep Vinyl Vault free for everyone else.
          </p>
        </div>

        {/* Tier cards */}
        <div className="flex flex-col sm:flex-row gap-4 mb-8">
          <TierCard
            image="/tier-digger.png"
            name="Digger"
            price="Free"
            billing={null}
            features={DIGGER_FEATURES}
            cta="Get started"
            ctaAction={onGetStarted}
            comingSoon={false}
            accentHex="#5B21D4"
            dimmed={false}
          />
          <TierCard
            image="/tier-selector.png"
            name="Selector"
            price={`£${PRICE_SELECTOR_YEAR}`}
            billing="/ year"
            features={SELECTOR_FEATURES}
            cta="Coming soon"
            ctaAction={null}
            comingSoon={true}
            accentHex="#C9FF00"
            foundingRibbon={true}
            dimmed={true}
          />
          <TierCard
            image="/tier-resident.png"
            name="Resident"
            price={`£${PRICE_RESIDENT_YEAR}`}
            billing="/ year"
            features={RESIDENT_FEATURES}
            cta="Coming soon"
            ctaAction={null}
            comingSoon={true}
            accentHex="#AC90E2"
            dimmed={true}
          />
        </div>

        {/* Sign-in and fine print */}
        <div className="text-center space-y-3">
          <p style={{ fontSize: 13, color: 'rgba(var(--fg),0.25)' }}>
            Already have an account?{' '}
            <button onClick={onSignIn}
              style={{ color: 'rgba(var(--fg),0.5)', textDecoration: 'underline', textUnderlineOffset: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, padding: 0 }}>
              Sign in
            </button>
          </p>
          <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.18)', letterSpacing: '0.04em' }}>
            Selector and Resident launching soon. Fair use applies to AI scans.
          </p>
        </div>
      </div>
    </div>
  );
}
