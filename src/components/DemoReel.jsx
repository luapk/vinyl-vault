// The promo reel, full screen. Two uses: a new visitor's first screen (Skip,
// then on to the tiers) and "Watch demo" on About (Close, back to About).
//
// It waits for a tap rather than autoplaying: browsers only autoplay muted,
// and the reel is carried by its voiceover. A video that fails to load must
// never stand between a visitor and the app, so an error ends it like Skip.
import { useEffect, useRef, useState } from 'react';
import { Play, Pause, X, ArrowRight } from '@phosphor-icons/react';
import { APP_NAME } from '../lib/brand.js';

// Bump when public/demo-reel.mp4 changes at the same path, to bust caches.
const REEL_V = '1';
const ACID = '#cafe04';

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
        <button onClick={state === 'ready' ? play : toggle}
          aria-label={state === 'ready' ? 'Play the demo with sound' : 'Resume the demo'}
          className="absolute flex items-center justify-center rounded-full transition-transform hover:scale-105"
          style={{ width: 92, height: 92, background: ACID, color: '#0d0c0a', boxShadow: '0 10px 40px rgba(0,0,0,0.45)' }}>
          <Play size={38} weight="fill" style={{ marginLeft: 5 }} />
        </button>
      )}
      {state === 'ready' && (
        <div className="absolute left-0 right-0 text-center font-mono text-[12px] tracking-[0.18em] uppercase pointer-events-none"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 44px)', color: 'rgba(255,255,255,0.75)', textShadow: '0 1px 8px rgba(0,0,0,0.8)' }}>
          Tap to watch, with sound · 50 sec
        </div>
      )}
      {state === 'playing' && (
        <button onClick={toggle} aria-label="Pause the demo"
          className="absolute left-4 flex items-center justify-center rounded-full"
          style={{ bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)', width: 40, height: 40, background: 'rgba(13,12,10,0.55)', color: '#f7f8f2', border: '1px solid rgba(255,255,255,0.25)' }}>
          <Pause size={16} weight="fill" />
        </button>
      )}

      <button ref={skipRef} onClick={onDone}
        className="absolute right-4 flex items-center gap-1.5 rounded-full font-semibold text-[15px] transition-opacity hover:opacity-90"
        style={{ top: 'calc(env(safe-area-inset-top, 0px) + 16px)', padding: '10px 18px', background: '#f7f8f2', color: '#0d0c0a', boxShadow: '0 4px 20px rgba(0,0,0,0.45)' }}>
        {leaveLabel}
        {mode === 'intro' ? <ArrowRight size={16} weight="bold" /> : <X size={16} weight="bold" />}
      </button>

      <div className="absolute left-0 right-0 bottom-0 h-[3px]" style={{ background: 'rgba(255,255,255,0.12)' }} aria-hidden="true">
        <div className="h-full" style={{ width: `${progress * 100}%`, background: ACID }} />
      </div>
    </div>
  );
}
