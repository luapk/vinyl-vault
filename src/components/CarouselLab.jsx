import { useState, useRef, useEffect, useCallback } from 'react';

// ─────────────────────────────────────────────────────────────────────────────
// Carousel Lab -- a self-contained audition page for two new carousel concepts.
// Reached via ?lab=carousel on any deployment. No auth, no app state: it reads
// the real collection from localStorage if present, otherwise uses mock records
// so the link is shareable and works for anyone.
// ─────────────────────────────────────────────────────────────────────────────

const ACCENT = '201,255,0'; // lime, matches app accent

// Deterministic gradient cover for mock/coverless records.
const GRADS = [
  ['#ff6b6b', '#4a1942'], ['#1a936f', '#114b5f'], ['#f4a261', '#6d2e46'],
  ['#5e548e', '#231942'], ['#06d6a0', '#073b4c'], ['#ef476f', '#3d1e2f'],
  ['#118ab2', '#073b4c'], ['#ffd166', '#7a4419'], ['#8338ec', '#240046'],
  ['#3a86ff', '#0a1128'], ['#fb5607', '#3d0e00'], ['#2ec4b6', '#011627'],
];

const MOCK = [
  { artist: 'Minilogue', title: 'Animals', year: '2008', format: 'Vinyl', country: 'Germany' },
  { artist: 'Floating Points', title: 'Elaenia', year: '2015', format: 'LP', country: 'UK' },
  { artist: 'Burial', title: 'Untrue', year: '2007', format: '2x12"', country: 'UK' },
  { artist: 'Four Tet', title: 'Rounds', year: '2003', format: 'LP', country: 'UK' },
  { artist: 'Aphex Twin', title: 'Selected Ambient Works', year: '1992', format: 'Vinyl', country: 'UK' },
  { artist: 'Bicep', title: 'Isles', year: '2021', format: 'LP', country: 'UK' },
  { artist: 'Caribou', title: 'Our Love', year: '2014', format: 'LP', country: 'Canada' },
  { artist: 'Jamie xx', title: 'In Colour', year: '2015', format: 'LP', country: 'UK' },
  { artist: 'Bonobo', title: 'Migration', year: '2017', format: '2xLP', country: 'UK' },
  { artist: 'Moderat', title: 'II', year: '2013', format: 'LP', country: 'Germany' },
  { artist: 'Nicolas Jaar', title: 'Space Is Only Noise', year: '2011', format: 'LP', country: 'USA' },
  { artist: 'Daft Punk', title: 'Discovery', year: '2001', format: '2xLP', country: 'France' },
].map((r, i) => ({ ...r, id: `mock-${i}`, _grad: GRADS[i % GRADS.length] }));

function loadRecords() {
  try {
    const raw = JSON.parse(localStorage.getItem('vinylvault_collection') || '[]');
    if (Array.isArray(raw) && raw.length >= 3) {
      return raw.map((r, i) => ({ ...r, _grad: GRADS[i % GRADS.length] }));
    }
  } catch { /* ignore */ }
  return MOCK;
}

// Cover face: real image if present, else a deterministic gradient with the title.
function Cover({ record, radius = 12 }) {
  if (record.coverUrl) {
    return <img src={record.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: radius, display: 'block' }} draggable={false} />;
  }
  const [a, b] = record._grad || GRADS[0];
  return (
    <div style={{ width: '100%', height: '100%', borderRadius: radius, background: `linear-gradient(145deg, ${a}, ${b})`, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', padding: '12%' }}>
      <div style={{ position: 'absolute', top: '8%', right: '8%', width: '26%', aspectRatio: '1', borderRadius: '50%', background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.15)' }} />
      <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 4 }}>{record.year || ''}</div>
      <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 19, lineHeight: 1.05, color: 'rgba(255,255,255,0.95)', textShadow: '0 2px 12px rgba(0,0,0,0.4)' }}>{record.artist}</div>
      <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>{record.title}</div>
    </div>
  );
}

// Unified pointer-drag hook. Reports a live delta while dragging and fires
// onCommit(direction) when the drag passes a distance/velocity threshold.
function useDrag({ axis = 'x', onPrev, onNext, threshold = 48 }) {
  const start = useRef(null);
  const startT = useRef(0);
  const moved = useRef(false);
  const [delta, setDelta] = useState(0);

  const onPointerDown = useCallback((e) => {
    start.current = axis === 'x' ? e.clientX : e.clientY;
    startT.current = performance.now();
    moved.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }, [axis]);

  const onPointerMove = useCallback((e) => {
    if (start.current === null) return;
    const cur = axis === 'x' ? e.clientX : e.clientY;
    const d = cur - start.current;
    if (Math.abs(d) > 4) moved.current = true;
    setDelta(d);
  }, [axis]);

  const onPointerUp = useCallback((e) => {
    if (start.current === null) return;
    const cur = axis === 'x' ? e.clientX : e.clientY;
    const d = cur - start.current;
    const v = d / Math.max(performance.now() - startT.current, 1);
    start.current = null;
    setDelta(0);
    if (d < -threshold || v < -0.35) onNext?.();
    else if (d > threshold || v > 0.35) onPrev?.();
  }, [axis, threshold, onNext, onPrev]);

  return { delta, dragging: start.current !== null, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } };
}

// ─── Concept A: Flip Bin ──────────────────────────────────────────────────────
// Records stand in a front-facing bin, receding up and back with 3D depth.
// Flip vertically (drag / wheel / up-down arrows) to thumb through them, like
// pushing each sleeve forward to see the one behind it.
function FlipBin({ records, index, setIndex }) {
  const onPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), [setIndex]);
  const onNext = useCallback(() => setIndex(i => Math.min(records.length - 1, i + 1)), [setIndex, records.length]);
  const { delta, dragging, handlers } = useDrag({ axis: 'y', onPrev, onNext });

  const wheelLock = useRef(0);
  const onWheel = (e) => {
    const now = performance.now();
    if (now - wheelLock.current < 220) return;
    if (Math.abs(e.deltaY) < 8) return;
    wheelLock.current = now;
    if (e.deltaY > 0) onNext(); else onPrev();
  };

  return (
    <div
      onWheel={onWheel}
      {...handlers}
      style={{ height: 'min(74vw, 520px)', position: 'relative', perspective: 1400, perspectiveOrigin: '50% 38%', touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none' }}>
      {records.map((r, i) => {
        const offset = i - index;
        const abs = Math.abs(offset);
        if (offset < -1 || abs > 5) return null; // 1 in front falling away, 5 receding back

        const dragShift = dragging ? delta / 320 : 0;
        const o = offset - dragShift; // smooth interpolation while dragging

        // Front card (o<=0): tipped toward viewer and sliding down/out.
        // Back cards (o>0): leaning back, stacked upward and receding in Z.
        let rotX, ty, tz, scale, brightness, blur, z;
        if (o <= 0) {
          rotX = 18 * -o;                 // tips forward/away as it leaves
          ty = 60 * -o;                   // slides down and out of the bin
          tz = 120 + 80 * -o;             // pulls toward viewer
          scale = 1 + 0.02 * -o;
          brightness = 1;
          blur = 0;
          z = 100;
        } else {
          rotX = -32 - o * 1.5;           // leaning back into the bin
          ty = -o * 26;                   // stacked upward (receding up)
          tz = -o * 130;                  // receding into depth
          scale = 1 - o * 0.045;
          brightness = Math.max(0.32, 1 - o * 0.16);
          blur = o > 3 ? (o - 3) * 1.4 : 0;
          z = 100 - Math.round(o * 10);
        }
        const opacity = abs > 4.5 ? Math.max(0, 1 - (abs - 4.5) * 2) : 1;

        return (
          <div key={r.id} onClick={() => offset !== 0 && !dragging && setIndex(i)}
            style={{
              position: 'absolute', left: '50%', top: '52%', width: 'min(64vw, 440px)', aspectRatio: '1',
              transform: `translate(-50%,-50%) translateY(${ty}px) translateZ(${tz}px) rotateX(${rotX}deg) scale(${scale})`,
              transformStyle: 'preserve-3d', transformOrigin: '50% 100%',
              transition: dragging ? 'none' : 'transform 0.42s cubic-bezier(0.22,0.9,0.3,1), filter 0.42s ease, opacity 0.3s ease',
              filter: `brightness(${brightness}) blur(${blur}px)`, opacity, zIndex: z,
              cursor: offset === 0 ? 'grab' : 'pointer',
            }}>
            <div style={{ width: '100%', height: '100%', borderRadius: 16, padding: 8, background: 'linear-gradient(150deg, rgba(40,40,46,0.95), rgba(14,14,18,0.95))', boxShadow: offset === 0 ? `0 40px 80px -24px rgba(0,0,0,0.9), 0 0 50px -12px rgba(${ACCENT},0.18), inset 0 1px 0 rgba(255,255,255,0.12)` : '0 30px 60px -28px rgba(0,0,0,0.85), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
              <Cover record={r} radius={10} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Concept B: The Dig ───────────────────────────────────────────────────────
// Records packed tight in a crate, viewed at an angle so you see their edges.
// The current record tips forward and lifts out of the row to show its face --
// the authentic "pull one halfway out to look at it" crate-digging gesture.
function TheDig({ records, index, setIndex }) {
  const onPrev = useCallback(() => setIndex(i => Math.max(0, i - 1)), [setIndex]);
  const onNext = useCallback(() => setIndex(i => Math.min(records.length - 1, i + 1)), [setIndex, records.length]);
  const { delta, dragging, handlers } = useDrag({ axis: 'x', onPrev, onNext });

  const SPREAD = 62; // px between packed records

  return (
    <div
      {...handlers}
      style={{ height: 'min(74vw, 520px)', position: 'relative', perspective: 1700, perspectiveOrigin: '50% 45%', touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab', userSelect: 'none', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, transformStyle: 'preserve-3d' }}>
        {records.map((r, i) => {
          const offset = i - index;
          const abs = Math.abs(offset);
          if (abs > 7) return null;

          const dragShift = dragging ? delta / SPREAD : 0;
          const o = offset - dragShift;
          const isActive = Math.round(o) === 0;

          // Active record swings to face you and lifts up out of the crate.
          // Others stay raked back like packed sleeves you flick past.
          const activeness = Math.max(0, 1 - Math.abs(o)); // 1 at center -> 0
          const rotY = o < 0 ? 64 : -64 + activeness * 64 + (o < 0 ? 0 : 0);
          const faceRot = -58 * (1 - activeness) * Math.sign(o || 1); // faces viewer at center
          const tx = o * SPREAD;
          const ty = -activeness * 46;                 // lifts up when active
          const tz = activeness * 200 - abs * 8;       // pulls forward when active
          const scale = 0.92 + activeness * 0.12;
          const brightness = 0.5 + activeness * 0.5;
          const z = 200 - Math.round(abs * 10);

          return (
            <div key={r.id} onClick={() => !isActive && !dragging && setIndex(i)}
              style={{
                position: 'absolute', left: '50%', top: '50%', width: 'min(60vw, 410px)', aspectRatio: '1',
                transform: `translate(-50%,-50%) translateX(${tx}px) translateY(${ty}px) translateZ(${tz}px) rotateY(${faceRot}deg) scale(${scale})`,
                transformOrigin: '50% 50%', transformStyle: 'preserve-3d',
                transition: dragging ? 'none' : 'transform 0.4s cubic-bezier(0.25,0.9,0.3,1), filter 0.4s ease',
                filter: `brightness(${brightness})`, zIndex: z,
                cursor: isActive ? 'grab' : 'pointer',
              }}>
              <div style={{ width: '100%', height: '100%', borderRadius: 14, padding: 7, background: 'linear-gradient(150deg, rgba(38,38,44,0.96), rgba(12,12,16,0.96))', boxShadow: isActive ? `0 44px 90px -22px rgba(0,0,0,0.92), 0 0 56px -12px rgba(${ACCENT},0.22), inset 0 1px 0 rgba(255,255,255,0.12)` : '0 18px 40px -22px rgba(0,0,0,0.8), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
                <Cover record={r} radius={9} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Lab shell ────────────────────────────────────────────────────────────────
const CONCEPTS = [
  { id: 'flip', label: 'Flip Bin', hint: 'Thumb vertically through a front-facing bin. Drag up/down, scroll, or use arrow keys.' },
  { id: 'dig', label: 'The Dig', hint: 'Pull the current sleeve out of a packed crate. Drag left/right or use arrow keys.' },
];

export default function CarouselLab() {
  const [records] = useState(loadRecords);
  const [concept, setConcept] = useState('flip');
  const [index, setIndex] = useState(0);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    const onKey = (e) => {
      if (concept === 'flip') {
        if (e.key === 'ArrowUp') setIndex(i => Math.max(0, i - 1));
        if (e.key === 'ArrowDown') setIndex(i => Math.min(records.length - 1, i + 1));
      } else {
        if (e.key === 'ArrowLeft') setIndex(i => Math.max(0, i - 1));
        if (e.key === 'ArrowRight') setIndex(i => Math.min(records.length - 1, i + 1));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [concept, records.length]);

  const current = records[index];
  const active = CONCEPTS.find(c => c.id === concept);

  return (
    <div style={{ minHeight: '100vh', background: 'radial-gradient(120% 80% at 50% 0%, #0d0d14 0%, #050508 60%)', color: '#f0f0f2', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px 40px' }}>
      <div style={{ width: '100%', maxWidth: 560 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 6 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 11, letterSpacing: '0.35em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.3)' }}>Carousel Lab</div>
          <div style={{ fontFamily: 'monospace', fontSize: 10, color: `rgba(${ACCENT},0.7)`, marginTop: 4 }}>{records[0]?.id?.startsWith('mock') ? 'demo records' : 'your collection'}</div>
        </div>

        {/* Concept toggle */}
        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', margin: '18px 0 8px' }}>
          {CONCEPTS.map(c => (
            <button key={c.id} onClick={() => { setConcept(c.id); }}
              style={{ padding: '9px 18px', borderRadius: 999, fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.12em', textTransform: 'uppercase', cursor: 'pointer', transition: 'all 0.18s',
                border: concept === c.id ? `1px solid rgba(${ACCENT},0.5)` : '1px solid rgba(255,255,255,0.1)',
                background: concept === c.id ? `rgba(${ACCENT},0.14)` : 'rgba(255,255,255,0.03)',
                color: concept === c.id ? `rgb(${ACCENT})` : 'rgba(255,255,255,0.5)' }}>
              {c.label}
            </button>
          ))}
        </div>
        <p style={{ textAlign: 'center', fontFamily: 'monospace', fontSize: 11.5, lineHeight: 1.5, color: 'rgba(255,255,255,0.38)', maxWidth: 360, margin: '0 auto 10px', minHeight: 34 }}>{active.hint}</p>

        {/* Stage */}
        <div style={{ margin: '8px 0' }}>
          {concept === 'flip'
            ? <FlipBin records={records} index={index} setIndex={setIndex} />
            : <TheDig records={records} index={index} setIndex={setIndex} />}
        </div>

        {/* Info */}
        <div style={{ textAlign: 'center', marginTop: 18 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.32)', marginBottom: 6 }}>
            {[current?.year, current?.format, current?.country].filter(Boolean).join(' · ')}
          </div>
          <div style={{ fontFamily: 'Georgia, serif', fontStyle: 'italic', fontSize: 24, lineHeight: 1.1 }}>{current?.artist}</div>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: 17, color: 'rgba(255,255,255,0.5)' }}>{current?.title}</div>
        </div>

        {/* Nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 22 }}>
          <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0}
            style={navBtn(index === 0)}>{concept === 'flip' ? '↑' : '←'}</button>
          <div style={{ fontFamily: 'monospace', fontSize: 12, letterSpacing: '0.15em', color: 'rgba(255,255,255,0.3)', minWidth: 70, textAlign: 'center' }}>{index + 1} / {records.length}</div>
          <button onClick={() => setIndex(i => Math.min(records.length - 1, i + 1))} disabled={index === records.length - 1}
            style={navBtn(index === records.length - 1)}>{concept === 'flip' ? '↓' : '→'}</button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 30 }}>
          <a href="?" style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.28)', textDecoration: 'none', borderBottom: '1px solid rgba(255,255,255,0.12)', paddingBottom: 2 }}>← back to app</a>
        </div>
      </div>
    </div>
  );
}

function navBtn(disabled) {
  return {
    width: 44, height: 44, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.12)',
    background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.7)', fontSize: 18,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.2 : 1, transition: 'all 0.15s',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  };
}
