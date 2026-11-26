// The crate dig: a Lab experiment in a more 3D carousel.
//
// Records stand upright in a crate, seen from slightly above. Swiping (either
// way, or pulling down) tips the front record toward you on its bottom edge,
// the way you flick through a crate in a shop, and the next one rises out of
// the crate flat to the camera so it is the one thing fully legible. Letter
// dividers stick up out of the stack where each letter starts, and resting on
// a record slides its disc out of the sleeve, spinning, in its own vinyl
// colour with the cover as the label.
//
// Built for load time first. There is no 3D library: it is CSS transforms on a
// window of about ten records, so a 2,000-record collection costs what a
// 20-record one does. The motion loop writes transforms straight to those
// elements rather than re-rendering React every frame, and only the record in
// view asks for its cover at high priority; the next few are preloaded while
// you look at it. All the geometry is in src/lib/crateDigLayout.js.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cardPose, digSort, dividers, tabOffset, flickTarget, AHEAD, BEHIND } from '../lib/crateDigLayout.js';
import { VINYL_COLORS } from '../lib/vinylColors.js';

const ACID = '#cafe04';
const INK = '#0d0c0a';
const PRELOAD = 6;            // covers fetched ahead of the visible window
const SETTLE_MS = 450;        // rest this long on a record and its disc slides out

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function discBackground(colorId) {
  const def = VINYL_COLORS.find(v => v.id === colorId) || VINYL_COLORS[0];
  // Grooves over the vinyl colour: a fine repeating ring, then a soft sheen.
  return [
    'repeating-radial-gradient(circle at 50% 50%, rgba(255,255,255,0.07) 0 0.6px, transparent 0.6px 2.4px)',
    'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, transparent 38%, transparent 62%, rgba(255,255,255,0.10) 100%)',
    def.bg,
  ].join(', ');
}

function Disc({ record, size, out }) {
  const still = reducedMotion();
  return (
    <div aria-hidden="true" style={{
      position: 'absolute', zIndex: 0, width: size * 0.94, height: size * 0.94,
      left: size * 0.03, top: size * 0.03, borderRadius: '50%',
      transform: `translateY(${out ? -size * 0.36 : 0}px)`,
      transition: still ? 'none' : 'transform 0.55s cubic-bezier(0.2, 0.9, 0.25, 1)',
      boxShadow: '0 6px 18px rgba(0,0,0,0.45)',
    }}>
      <div style={{
        width: '100%', height: '100%', borderRadius: '50%',
        background: discBackground(record.vinylColor),
        animation: out && !still ? 'crateDigSpin 1.8s linear infinite' : 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {/* the label: the cover, a third of the disc, with the spindle hole */}
        <div style={{
          width: '34%', height: '34%', borderRadius: '50%', overflow: 'hidden', position: 'relative',
          background: record.coverUrl ? `center / cover no-repeat url("${record.coverUrl}")` : ACID,
        }}>
          <div style={{ position: 'absolute', left: '50%', top: '50%', width: 6, height: 6, marginLeft: -3, marginTop: -3, borderRadius: '50%', background: INK }} />
        </div>
      </div>
    </div>
  );
}

export default function CrateDig({ records, onSelect }) {
  const sorted = useMemo(() => digSort(records), [records]);
  const tabs = useMemo(() => dividers(sorted), [sorted]);
  const tabAt = useMemo(() => new Map(tabs.map(t => [t.index, t.letter])), [tabs]);
  const n = sorted.length;

  const stageRef = useRef(null);
  const [S, setS] = useState(250);
  const sRef = useRef(250);
  const posRef = useRef(0);
  const targetRef = useRef(0);
  const dragRef = useRef(null);
  const rafRef = useRef(0);
  const cards = useRef(new Map());          // index -> { el, shade }
  const [base, setBase] = useState(0);      // the record in view, which also picks the mounted window
  const baseRef = useRef(0);
  const [settled, setSettled] = useState(true);
  const [discOut, setDiscOut] = useState(false);

  // Size the sleeve to the stage, capped so the stack and the disc have room.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const s = Math.round(Math.min(e.contentRect.width * 0.76, 320));
      sRef.current = s; setS(s);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const apply = useCallback(() => {
    const pos = posRef.current, s = sRef.current;
    for (const [i, c] of cards.current) {
      const p = cardPose(i - pos, s);
      c.el.style.transform = `translate3d(0, ${p.y.toFixed(1)}px, ${p.z.toFixed(1)}px) rotateX(${p.rx.toFixed(2)}deg)`;
      c.el.style.opacity = p.opacity;
      c.el.style.zIndex = p.zIndex;
      c.el.style.visibility = p.opacity <= 0.01 ? 'hidden' : 'visible';
      if (c.shade) c.shade.style.opacity = p.shade;
    }
  }, []);

  const tick = useCallback(() => {
    const still = reducedMotion();
    if (!dragRef.current) {
      const diff = targetRef.current - posRef.current;
      if (Math.abs(diff) < 0.002 || still) posRef.current = targetRef.current;
      else posRef.current += diff * 0.17;
    }
    const nearest = Math.max(0, Math.min(n - 1, Math.round(posRef.current)));
    if (nearest !== baseRef.current) {
      baseRef.current = nearest;
      setBase(nearest);
      // one tiny tick per record passed, where the phone supports it
      try { navigator.vibrate?.(3); } catch { /* not supported */ }
    }
    apply();
    if (dragRef.current || posRef.current !== targetRef.current) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      rafRef.current = 0;
      setSettled(true);
    }
  }, [apply, n]);

  const kick = useCallback(() => {
    setSettled(false);
    setDiscOut(false);
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
  }, [tick]);

  const goTo = useCallback((i) => {
    targetRef.current = Math.max(0, Math.min(n - 1, i));
    kick();
  }, [kick, n]);

  // Re-apply after the window remounts or the sleeve resizes.
  useEffect(() => { apply(); }, [apply, base, S]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Rest on a record and the disc comes out of the sleeve.
  useEffect(() => {
    if (!settled) return;
    const t = setTimeout(() => setDiscOut(true), SETTLE_MS);
    return () => clearTimeout(t);
  }, [settled, base]);

  // Preload the covers just past the window, so a flick never lands on a blank.
  useEffect(() => {
    for (let i = base + AHEAD + 1; i <= base + AHEAD + PRELOAD && i < n; i++) {
      const url = sorted[i]?.coverUrl;
      if (url && !url.startsWith('data:')) { const im = new Image(); im.decoding = 'async'; im.src = url; }
    }
  }, [base, sorted, n]);

  // ---- input ---------------------------------------------------------------
  const onPointerDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    // Which record is under the finger has to be read NOW: once the stage
    // captures the pointer, the lift-off is reported against the stage, not
    // the sleeve, and a tap could not tell which record it landed on.
    const hit = e.target.closest?.('[data-dig-i]');
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      x: e.clientX, y: e.clientY, pos: posRef.current, moved: false,
      hit: hit ? Number(hit.getAttribute('data-dig-i')) : null,
      samples: [{ t: performance.now(), p: posRef.current }],
    };
    kick();
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 6) return;
    d.moved = true;
    // Swipe left, or pull down toward you, to dig forward.
    const p = d.pos + (dy - dx) / (sRef.current * 0.55);
    posRef.current = Math.max(-0.35, Math.min(n - 0.65, p));
    targetRef.current = posRef.current;
    d.samples.push({ t: performance.now(), p: posRef.current });
    if (d.samples.length > 6) d.samples.shift();
  };
  const onPointerUp = () => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    if (!d.moved) {
      const i = d.hit;
      if (i !== null && i === baseRef.current) onSelect?.(sorted[i]);
      else if (i !== null) goTo(i);
      else goTo(baseRef.current);
      return;
    }
    const a = d.samples[0], b = d.samples[d.samples.length - 1];
    const v = (b.p - a.p) / Math.max(1, b.t - a.t);
    targetRef.current = flickTarget(posRef.current, v, n);
    kick();
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let idle = 0;
    const onWheel = (e) => {
      e.preventDefault();
      posRef.current = Math.max(0, Math.min(n - 1, posRef.current + (e.deltaY + e.deltaX) / (sRef.current * 1.4)));
      targetRef.current = posRef.current;
      kick();
      clearTimeout(idle);
      idle = setTimeout(() => goTo(Math.round(posRef.current)), 140);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); clearTimeout(idle); };
  }, [goTo, kick, n]);

  const onKeyDown = (e) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); goTo(Math.round(targetRef.current) + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); goTo(Math.round(targetRef.current) - 1); }
    else if (e.key === 'Enter' && sorted[baseRef.current]) onSelect?.(sorted[baseRef.current]);
  };

  if (!n) return null;
  const current = sorted[base];
  const lipH = S * 0.2;
  const stageH = Math.round(S * 1.9);
  const first = Math.max(0, base - BEHIND - 1), last = Math.min(n - 1, base + AHEAD);
  const slots = [];
  for (let i = first; i <= last; i++) slots.push(i);
  const currentLetter = [...tabs].reverse().find(t => t.index <= base)?.letter;

  return (
    <div className="select-none">
      <style>{'@keyframes crateDigSpin { to { transform: rotate(360deg); } }'}</style>

      {/* A to Z: every letter present, the one you are in lit */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-1" style={{ scrollbarWidth: 'none' }} role="tablist" aria-label="Jump to letter">
        {tabs.map(t => {
          const on = t.letter === currentLetter;
          return (
            <button key={t.letter} role="tab" aria-selected={on} onClick={() => goTo(t.index)}
              className="font-mono text-[11px] font-bold flex-shrink-0 rounded-md"
              style={{ width: 24, height: 24, background: on ? ACID : 'rgba(255,255,255,0.06)', color: on ? INK : 'rgba(255,255,255,0.55)' }}>
              {t.letter}
            </button>
          );
        })}
      </div>

      <div ref={stageRef} tabIndex={0} onKeyDown={onKeyDown}
        aria-label="Crate dig: swipe or use the arrow keys to flick through, Enter to open"
        onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
        className="relative outline-none rounded-2xl overflow-hidden"
        style={{
          height: stageH, touchAction: 'none', cursor: 'grab',
          perspective: 680, perspectiveOrigin: '50% -70%',
          background: 'radial-gradient(120% 80% at 50% 100%, rgba(202,254,4,0.06), transparent 60%)',
        }}>
        {slots.map(i => {
          const r = sorted[i];
          const letter = tabAt.get(i);
          const near = Math.abs(i - base) <= 2;
          return (
            <div key={r.id || i} data-dig-i={i}
              ref={el => { if (el) cards.current.set(i, { el, shade: el.querySelector('[data-shade]') }); else cards.current.delete(i); }}
              style={{
                position: 'absolute', left: '50%', bottom: S * 0.06, width: S, height: S, marginLeft: -S / 2,
                transformOrigin: '50% 100%', willChange: 'transform, opacity', backfaceVisibility: 'hidden',
                transform: 'translate3d(0,0,0)',
              }}>
              {i === base && <Disc record={r} size={S} out={discOut} />}
              {letter && (
                <div aria-hidden="true" style={{
                  position: 'absolute', zIndex: 0, top: -S * 0.085, height: S * 0.12, width: S * 0.16,
                  left: `calc(${(tabOffset(letter) * 84).toFixed(1)}% )`,
                  background: ACID, color: INK, borderRadius: '6px 6px 0 0',
                  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                  fontFamily: 'ui-monospace, monospace', fontWeight: 800, fontSize: Math.max(10, S * 0.055), paddingTop: 2,
                }}>{letter}</div>
              )}
              <div style={{
                position: 'absolute', inset: 0, zIndex: 1, borderRadius: 5, overflow: 'hidden', background: '#16161a',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.22), 0 10px 30px -12px rgba(0,0,0,0.8)',
              }}>
                {r.coverUrl
                  ? <img src={r.coverUrl} alt="" draggable={false} decoding="async"
                      loading={near ? 'eager' : 'lazy'} fetchpriority={i === base ? 'high' : 'low'}
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                  : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 14, textAlign: 'center', color: 'rgba(255,255,255,0.55)', fontFamily: 'ui-monospace, monospace', fontSize: 12 }}>
                      {r.artist} · {r.title}
                    </div>}
                <div data-shade style={{ position: 'absolute', inset: 0, background: '#000', opacity: 0, pointerEvents: 'none' }} />
              </div>
            </div>
          );
        })}

        {/* The back of the crate recedes into the page rather than being cut
            off by the stage edge mid-cover. */}
        <div aria-hidden="true" style={{
          position: 'absolute', zIndex: 650, left: 0, right: 0, top: 0, height: S * 0.42, pointerEvents: 'none',
          background: 'linear-gradient(to bottom, rgb(var(--bg)) 0%, rgba(var(--bg), 0.85) 30%, rgba(var(--bg), 0) 100%)',
        }} />

        {/* The crate's front panel. Records behind sit inside it; the one you
            are looking at rises clear of it; flicked ones fall forward over it. */}
        <div aria-hidden="true" style={{
          position: 'absolute', zIndex: 600, bottom: 0, left: '50%', width: S * 1.18, marginLeft: -S * 0.59, height: lipH,
          background: 'linear-gradient(180deg, #1c1c18, #0b0b09)', borderTop: `2px solid ${ACID}`,
          borderRadius: '8px 8px 0 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 12px', fontFamily: 'ui-monospace, monospace', fontSize: 11, letterSpacing: '0.14em',
          color: 'rgba(255,255,255,0.55)', pointerEvents: 'none',
        }}>
          <span>{currentLetter || ''}</span>
          <span>{base + 1} / {n}</span>
        </div>
      </div>

      {/* What you are looking at, large: the legibility the 3D must not cost */}
      {current && (
        <div className="text-center mt-4" aria-live="polite">
          <div className="text-[11px] tracking-[0.22em] uppercase text-white/40 font-mono mb-1">
            {[current.year, current.format, current.country].filter(Boolean).join(' · ')}
          </div>
          <div className="text-xl leading-tight text-white"><span className="italic">{current.artist}</span></div>
          <div className="text-base text-white/55 leading-snug">{current.title}</div>
        </div>
      )}
    </div>
  );
}
