// Milestone badges: the full-screen unlock card, and the grid in the account
// panel. Tier data and all the earned/celebrated logic live in lib/badges.js.
import { useEffect, useRef } from 'react';
import {
  Alien, Planet, Rocket, RocketLaunch, FlyingSaucer, MoonStars,
  Meteor, Star, Sun, LockSimple,
} from '@phosphor-icons/react';
import {
  BADGE_TIERS, unlockedCounts, nextTier, progressToward,
} from '../lib/badges.js';

const ICONS = { Alien, Planet, Rocket, RocketLaunch, FlyingSaucer, MoonStars, Meteor, Star, Sun };
const iconFor = (name) => ICONS[name] || Star;

const ACID = '#cafe04';
const INK = '#08080c';

const fmt = (n) => n.toLocaleString('en-GB');

const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ----- fanfare ---------------------------------------------------------------
// A rising major arpeggio over a soft held chord: triumphant, about a second
// and a half, and quiet enough to land on a phone speaker without startling
// anyone. Same Web Audio approach as the save chime, one octave brighter.
function playFanfare() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    ctx.resume?.().catch(() => {});

    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    const voice = (freq, start, dur, peak, type = 'triangle') => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(master);
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    };

    const t = ctx.currentTime + 0.05;
    // C major arpeggio climbing to the octave, the last note held long.
    voice(523.25, t,        0.42, 0.20);
    voice(659.25, t + 0.10, 0.42, 0.20);
    voice(783.99, t + 0.20, 0.48, 0.21);
    voice(1046.50, t + 0.32, 1.30, 0.24);
    // Sine octave above the final note for shine, and a low fifth for weight.
    voice(2093.00, t + 0.34, 0.90, 0.055, 'sine');
    voice(261.63, t + 0.30, 1.30, 0.10, 'sine');
    voice(392.00, t + 0.30, 1.30, 0.07, 'sine');

    setTimeout(() => ctx.close().catch(() => {}), 2600);
  } catch { /* audio unavailable: the card is the reward, the sound is a bonus */ }
}

// ----- full-screen unlock card ----------------------------------------------

export function BadgeCelebration({ badge, count, celebrated = [], onClose, onViewBadges }) {
  const Icon = iconFor(badge.icon);
  const next = nextTier(count, celebrated);
  const unlocked = unlockedCounts(count, celebrated);
  const still = reducedMotion();
  const playedRef = useRef(false);

  useEffect(() => {
    if (playedRef.current) return;
    playedRef.current = true;
    playFanfare();
    if (navigator.vibrate) { try { navigator.vibrate([18, 60, 28]); } catch { /* unsupported */ } }
  }, []);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const rise = (delay) => (still ? {} : { animation: `fadeUp 0.5s cubic-bezier(0.22,1,0.36,1) ${delay}s both` });

  return (
    <div role="dialog" aria-modal="true" aria-label={`Badge unlocked: ${badge.name}`}
      style={{
        position: 'fixed', inset: 0, zIndex: 600,
        background: ACID, color: INK,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '32px 24px', textAlign: 'center', overflow: 'hidden',
        animation: still ? undefined : 'badgeFlash 0.42s ease-out both',
      }}>

      {/* Rings pushing out from behind the seal */}
      {!still && [0, 0.55, 1.1].map((d, i) => (
        <span key={i} aria-hidden="true" style={{
          position: 'absolute', top: '50%', left: '50%', width: 220, height: 220,
          marginTop: -110, marginLeft: -110, borderRadius: '50%',
          border: `1.5px solid ${INK}`, pointerEvents: 'none', opacity: 0,
          animation: `badgeRing 2.4s ease-out ${0.25 + d}s infinite`,
        }} />
      ))}

      <div style={{ position: 'relative', zIndex: 1, maxWidth: 400, width: '100%' }}>

        <div style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.28em', textTransform: 'uppercase', color: 'rgba(8,8,12,0.5)', marginBottom: 22, ...rise(0.05) }}>
          Badge unlocked
        </div>

        {/* The seal */}
        <div style={{
          width: 132, height: 132, borderRadius: '50%', margin: '0 auto 26px',
          background: INK, color: ACID,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 22px 50px -18px rgba(8,8,12,0.6)',
          animation: still ? undefined : 'badgeSeal 0.72s cubic-bezier(0.34,1.5,0.5,1) 0.12s both',
        }}>
          <Icon size={62} weight="fill" />
        </div>

        <h2 style={{ fontSize: 40, lineHeight: 1.04, fontWeight: 700, letterSpacing: '-0.02em', margin: '0 0 10px', ...rise(0.30) }}>
          {badge.name}
        </h2>

        <div style={{ fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.2em', textTransform: 'uppercase', color: 'rgba(8,8,12,0.62)', marginBottom: 16, ...rise(0.36) }}>
          {fmt(badge.count)} records
        </div>

        <p style={{ fontSize: 16, lineHeight: 1.5, color: 'rgba(8,8,12,0.78)', margin: '0 auto 26px', maxWidth: 320, ...rise(0.42) }}>
          {badge.line}
        </p>

        {/* Where this sits on the ladder, so the card ends on a next step */}
        <div style={{ maxWidth: 300, margin: '0 auto 30px', ...rise(0.50) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(8,8,12,0.5)', marginBottom: 8 }}>
            <span>{unlocked.size} of {BADGE_TIERS.length} unlocked</span>
            {next && <span>Next at {fmt(next.count)}</span>}
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'rgba(8,8,12,0.16)', overflow: 'hidden' }}>
            <div style={{
              width: `${Math.round(progressToward(count, next) * 100)}%`, height: '100%',
              background: INK, borderRadius: 3,
              transition: still ? 'none' : 'width 0.8s cubic-bezier(0.22,1,0.36,1)',
            }} />
          </div>
          <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(8,8,12,0.5)', marginTop: 9 }}>
            {next
              ? `${fmt(Math.max(0, next.count - count))} more to ${next.name}`
              : 'Every badge in the vault is yours.'}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap', ...rise(0.58) }}>
          <button onClick={onViewBadges}
            style={{
              padding: '12px 22px', borderRadius: 40, cursor: 'pointer',
              background: INK, color: ACID, border: `1px solid ${INK}`,
              fontSize: 13, fontFamily: 'monospace', fontWeight: 700, letterSpacing: '0.08em',
            }}>
            View badges
          </button>
          <button onClick={onClose}
            style={{
              padding: '12px 22px', borderRadius: 40, cursor: 'pointer',
              background: 'transparent', color: 'rgba(8,8,12,0.75)',
              border: '1px solid rgba(8,8,12,0.28)',
              fontSize: 13, fontFamily: 'monospace', letterSpacing: '0.08em',
            }}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- account panel grid ----------------------------------------------------

export function BadgeGrid({ count = 0, celebrated = [] }) {
  const unlocked = unlockedCounts(count, celebrated);
  const next = nextTier(count, celebrated);
  const pct = Math.round(progressToward(count, next) * 100);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 7 }}>
        <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(var(--fg),0.6)' }}>
          {fmt(count)} {count === 1 ? 'record' : 'records'}
        </span>
        <span style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.1em', color: 'rgba(var(--fg),0.35)' }}>
          {unlocked.size}/{BADGE_TIERS.length} unlocked
        </span>
      </div>

      <div style={{ height: 4, borderRadius: 3, background: 'rgba(var(--fg),0.09)', overflow: 'hidden', marginBottom: 8 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: ACID, borderRadius: 3, transition: 'width 0.6s ease' }} />
      </div>

      <p style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', margin: '0 0 14px' }}>
        {next
          ? `${fmt(Math.max(0, next.count - count))} more to ${next.name}`
          : 'Every badge in the vault is yours.'}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {BADGE_TIERS.map(tier => {
          const Icon = iconFor(tier.icon);
          const got = unlocked.has(tier.count);
          const isNext = next?.count === tier.count;
          return (
            <div key={tier.count}
              title={got ? `${tier.name}: ${tier.line}` : `Locked: ${fmt(tier.count)} records`}
              style={{
                borderRadius: 12, padding: '13px 6px 10px', textAlign: 'center',
                minHeight: 96, display: 'flex', flexDirection: 'column', justifyContent: 'center',
                background: got ? ACID : 'rgba(var(--fg),0.03)',
                border: got
                  ? '1px solid rgba(8,8,12,0.18)'
                  : `1px ${isNext ? 'solid' : 'dashed'} rgba(var(--fg),${isNext ? 0.22 : 0.12})`,
                color: got ? INK : 'rgba(var(--fg),0.42)',
                opacity: got ? 1 : 0.7,
              }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 7, position: 'relative' }}>
                <Icon size={26} weight={got ? 'fill' : 'regular'} />
                {!got && (
                  <LockSimple size={10} weight="fill"
                    style={{ position: 'absolute', right: 'calc(50% - 20px)', bottom: -1, opacity: 0.55 }} />
                )}
              </div>
              {/* The one being worked towards is named, so there is something
                  to aim at. The ones beyond it stay a surprise. */}
              <div style={{ fontSize: 11, fontWeight: got ? 700 : 500, lineHeight: 1.2, marginBottom: 3 }}>
                {got || isNext ? tier.name : '???'}
              </div>
              <div style={{ fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.06em', opacity: got ? 0.6 : 0.85 }}>
                {fmt(tier.count)}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
