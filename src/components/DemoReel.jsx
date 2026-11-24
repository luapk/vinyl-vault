// The promo reel, full screen. Two uses: a new visitor's first screen (Skip,
// then on to the tiers) and "Watch demo" on About (Close, back to About).
//
// It waits for a tap rather than autoplaying: browsers only autoplay muted,
// and the reel is carried by its voiceover. A video that fails to load must
// never stand between a visitor and the app, so an error ends it like Skip.
import { forwardRef, useEffect, useRef, useState } from 'react';
import { Play, Pause, X, ArrowRight } from '@phosphor-icons/react';
import { APP_NAME } from '../lib/brand.js';

// Bump when public/demo-reel.mp4 changes at the same path, to bust caches.
const REEL_V = '1';
const ACID = '#cafe04';
const INK = '#0d0c0a';

// The reel's buttons, and About's "Watch demo", are one object in two sizes:
// an acid lozenge, ink caps, and the icon in an ink disc. They were two styles
// (an acid disc for play, a paper pill for Skip), which read as two designers.
// Exported so the About page cannot drift from the screen it opens.
export const ReelPill = forwardRef(function ReelPill({ label, icon: Icon, iconSide = 'left', size = 'lg', ...rest }, ref) {
  const lg = size === 'lg';
  const disc = lg ? 38 : 28;
  const pad = lg ? 6 : 5;
  const iconEl = (
    <span aria-hidden="true" className="flex items-center justify-center rounded-full flex-shrink-0"
      style={{ width: disc, height: disc, background: INK, color: ACID }}>
      <Icon size={lg ? 16 : 13} weight={Icon === Play ? 'fill' : 'bold'} style={Icon === Play ? { marginLeft: 2 } : undefined} />
    </span>
  );
  return (
    <button ref={ref} {...rest}
      className={`inline-flex items-center rounded-full font-mono font-bold uppercase transition-transform hover:scale-[1.03] active:scale-[0.98] ${rest.className || ''}`}
      style={{
        // The ink keyline is what keeps an acid pill readable on the acid
        // poster; on black it simply disappears.
        background: ACID, color: INK, border: `2px solid ${INK}`,
        outlineColor: ACID, outlineOffset: 3,
        gap: lg ? 12 : 9,
        padding: iconSide === 'left' ? `${pad}px ${lg ? 24 : 16}px ${pad}px ${pad}px` : `${pad}px ${pad}px ${pad}px ${lg ? 24 : 16}px`,
        fontSize: lg ? 15 : 12, letterSpacing: '0.16em',
        boxShadow: '0 10px 32px rgba(0,0,0,0.45)',
        ...rest.style,
      }}>
      {iconSide === 'left' && iconEl}
      <span style={{ marginRight: '-0.16em' }}>{label}</span>
      {iconSide === 'right' && iconEl}
    </button>
  );
});

export default function DemoReel({ onDone, mode = 'intro' }) {
  const videoRef = useRef(null);
  const skipRef = useRef(null);
  const [state, setState] = useState('ready');   // ready | playing | paused
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    skipRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onDone(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDone]);

  const play = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = false;
    v.play().then(() => setState('playing')).catch(() => {
      // a browser that still refuses sound gets the picture, with the native controls to unmute
      v.muted = true; v.controls = true;
      v.play().then(() => setState('playing')).catch(() => setState('paused'));
    });
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play().then(() => setState('playing')).catch(() => {}); }
    else { v.pause(); setState('paused'); }
  };

  const leaveLabel = mode === 'intro' ? 'Skip' : 'Close';

  return (
    <div role="dialog" aria-modal="true" aria-label={`${APP_NAME} demo`}
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: '#050508' }}>
      <video
        ref={videoRef}
        src={`/demo-reel.mp4?v=${REEL_V}`}
        poster={`/demo-reel.jpg?v=${REEL_V}`}
        playsInline
        preload="metadata"
        onClick={state === 'ready' ? play : toggle}
        onEnded={onDone}
        onError={onDone}
        onTimeUpdate={(e) => { const v = e.currentTarget; if (v.duration) setProgress(v.currentTime / v.duration); }}
        className="h-full w-full"
        style={{ objectFit: 'contain', cursor: 'pointer' }}
      />

      {state !== 'playing' && (
        // Low on the frame, not dead centre: the centre of the poster is the
        // character, and a button over his face reads as an accident.
        <div className="absolute left-0 right-0 flex justify-center pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 84px)' }}>
          <ReelPill onClick={state === 'ready' ? play : toggle}
            label={state === 'ready' ? 'Watch demo' : 'Resume'}
            icon={Play} className="pointer-events-auto" />
        </div>
      )}
      {state === 'ready' && (
        // On its own ink chip: where the poster fills a short screen this line
        // lands on acid, and white on acid is unreadable.
        <div className="absolute left-0 right-0 flex justify-center pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 32px)' }}>
          <span className="font-mono text-[11px] tracking-[0.18em] uppercase rounded-full"
            style={{ padding: '5px 12px', background: INK, color: 'rgba(247,248,242,0.8)' }}>
            With sound · 50 sec
          </span>
        </div>
      )}
      {state === 'playing' && (
        <button onClick={toggle} aria-label="Pause the demo"
          className="absolute left-4 flex items-center justify-center rounded-full"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', width: 40, height: 40, background: 'rgba(13,12,10,0.55)', color: '#f7f8f2', border: '1px solid rgba(255,255,255,0.25)' }}>
          <Pause size={16} weight="fill" />
        </button>
      )}

      <ReelPill ref={skipRef} onClick={onDone} label={leaveLabel} size="sm" iconSide="right"
        icon={mode === 'intro' ? ArrowRight : X} className="absolute right-4"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)' }} />

      <div className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: 'rgba(255,255,255,0.12)' }} aria-hidden="true">
        <div className="h-full" style={{ width: `${progress * 100}%`, background: ACID }} />
      </div>
    </div>
  );
}
