import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Camera, Upload, VinylRecord, Sparkle, X, ArrowUpRight, Clock,
  Play, Pause, Plus, Check, CaretLeft, CaretRight, CaretDown, MagnifyingGlass,
  DownloadSimple, Printer, GridNine, Stack, PencilSimple, Trash,
  Scan, Info, Crown, SignOut, UserCircle, GearSix, ChartBar, Users,
  ChatCircle, ImageSquare, Mountains, CloudArrowDown, Wrench, ArrowsDownUp,
  MusicNotes, Waveform, Export, DeviceMobile, Rows,
} from "@phosphor-icons/react";
import { useCollection, exportCSV } from "../hooks/useCollection.js";
import { useAuth } from "../hooks/useAuth.js";
import { useTheme } from "../hooks/useTheme.js";
import { useSubscription } from "../hooks/useSubscription.js";
import AuthScreen from "./AuthScreen.jsx";
import AdminPanel from "./AdminPanel.jsx";
import CommunityView from "./Community.jsx";
import ChatPanel from "./ChatPanel.jsx";
import PricingScreen, { TierCarousel } from "./PricingScreen.jsx";
import { getNotificationCount, getLastSeenTs, markNotifsSeen, getUnreadMessageCount } from '../lib/social.js';
import { spaceIconFor } from '../lib/avatarIcon.js';
import { parseImportRows } from '../lib/importParse.js';
import { detectBarcode, loadBarcodeDetector } from '../lib/barcodeScanner.js';
import { safeSetItem } from '../lib/localCache.js';
import { supabase } from '../lib/supabase.js';

// A Supabase access token expires ~hourly. The cached token from useAuth stays
// fresh only while background auto-refresh fires; if the app sat idle the
// cached token can be expired, so authed API calls (/api/scan) 401. getSession()
// returns the current token and transparently refreshes an expired one -- we
// race it against a timeout so a stalled refresh can never hang the call, and
// fall back to the cached token if it does.
async function freshAccessToken(fallback) {
  try {
    const { data } = await Promise.race([
      supabase.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('getSession timeout')), 8000)),
    ]);
    return data?.session?.access_token || fallback;
  } catch {
    return fallback;
  }
}

// ----- Genre crate list (must match api/lib/vision.js GENRE_CRATES) ---------

const GENRE_CRATES = [
  'Techno', 'Detroit', 'Chicago', 'House', 'Drum & Bass', 'Jungle', 'Garage', 'Grime', 'Dubstep',
  'Breakbeat', 'Electro', 'Chuggers', 'Ambient', 'Downtempo', 'Trip Hop', 'IDM', 'Industrial',
  'EBM', 'Wave', 'Trance', 'Hardcore', 'Rave', 'Disco', 'Italo Disco', 'Cosmic', 'Space Disco',
  'Funk', 'Soul', 'R&B', 'Jazz', 'Hip Hop', 'Reggae', 'Dub', 'Latin', 'Afrobeat', 'Classical', 'Experimental',
];

const CONDITION_GRADES = ['', 'M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'];

// Vinyl colour / pressing types
const VINYL_COLORS = [
  { id: 'black',    label: 'Black',       bg: '#1a1a1a' },
  { id: 'clear',    label: 'Clear',       bg: 'rgba(190,220,240,0.45)', border: 'rgba(180,210,230,0.6)' },
  { id: 'white',    label: 'White',       bg: '#e2e2e2', border: 'rgba(0,0,0,0.18)' },
  { id: 'red',      label: 'Red',         bg: '#c0392b' },
  { id: 'blue',     label: 'Blue',        bg: '#1a6fa8' },
  { id: 'green',    label: 'Green',       bg: '#1e8449' },
  { id: 'yellow',   label: 'Yellow',      bg: '#d4ac0d', border: 'rgba(0,0,0,0.12)' },
  { id: 'orange',   label: 'Orange',      bg: '#ca6f1e' },
  { id: 'pink',     label: 'Pink',        bg: '#cb4397' },
  { id: 'purple',   label: 'Purple',      bg: '#7d3c98' },
  { id: 'gold',     label: 'Gold',        bg: 'linear-gradient(135deg,#b8952a,#e8cf6a,#b8952a)' },
  { id: 'marbled',  label: 'Marbled',     bg: 'conic-gradient(#c0392b 0deg,#1a6fa8 120deg,#1a1a1a 240deg,#c0392b 360deg)' },
  { id: 'splatter', label: 'Splatter',    bg: 'radial-gradient(circle at 30% 40%,#cb4397 0%,#cb4397 12%,#1a1a1a 12%,#1a1a1a 100%),radial-gradient(circle at 70% 60%,#d4ac0d 0%,#d4ac0d 8%,transparent 8%)' },
  { id: 'picture',  label: 'Picture',     bg: 'linear-gradient(135deg,#8e44ad,#2980b9,#27ae60)' },
];

function VinylColorDot({ colorId, size = 14 }) {
  if (!colorId || colorId === 'black') return null;
  const def = VINYL_COLORS.find(v => v.id === colorId);
  if (!def) return null;
  return (
    <span title={def.label} style={{
      display: 'inline-block', width: size, height: size, borderRadius: '50%',
      background: def.bg,
      border: `1px solid ${def.border || 'rgba(255,255,255,0.18)'}`,
      flexShrink: 0,
    }} />
  );
}

function VinylColorSelect({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const current = VINYL_COLORS.find(v => v.id === (value || 'black')) || VINYL_COLORS[0];

  // Close popover on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ color: `rgba(var(--fg),${isLight ? 0.52 : 0.38})`, display: 'flex' }}>
        <VinylRecord size={16} />
      </span>
      <button onClick={() => setOpen(v => !v)} style={{
        display: 'flex', alignItems: 'center', gap: 5,
        background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.10)',
        borderRadius: 20, padding: '3px 8px', cursor: 'pointer', outline: 'none',
      }}>
        <span style={{
          width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
          background: current.bg,
          boxShadow: `inset 0 0 0 1px ${current.border || 'rgba(255,255,255,0.18)'}`,
        }} />
        <span style={{ fontSize: 16, fontFamily: 'monospace', color: `rgba(var(--fg),0.45)` }}>
          {current.label}
        </span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 200,
          background: 'var(--bg-hex)', border: '1px solid rgba(var(--fg),0.12)',
          borderRadius: 12, padding: 8,
          boxShadow: '0 8px 28px rgba(0,0,0,0.35)',
          display: 'flex', flexWrap: 'wrap', gap: 5, width: 162,
        }}>
          {VINYL_COLORS.map(({ id, label, bg, border }) => (
            <button key={id} title={label} onClick={() => { onChange(id); setOpen(false); }}
              style={{
                width: 22, height: 22, borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0,
                background: bg,
                outline: (value || 'black') === id ? '2px solid rgba(120,220,140,0.85)' : '2px solid transparent',
                outlineOffset: 2,
                boxShadow: `inset 0 0 0 1px ${border || 'rgba(255,255,255,0.18)'}`,
                transition: 'outline 0.1s',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function conditionColor(grade) {
  if (!grade) return null;
  if (grade === 'M' || grade === 'NM') return '120,210,130';
  if (grade === 'VG+' || grade === 'VG') return '220,170,60';
  return '220,90,90';
}

function normalizeKey(artist, title) {
  return `${artist}${title}`.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Rank crate names by how well they fit a release so the scan result suggests
// only the few most relevant crates rather than every crate the user owns.
// Scores by word overlap with the release genres and AI crate-name
// suggestions, with bonuses for exact genre/suggestion and decade matches.
function rankCratesForRelease(crateNames, release, limit = 3) {
  const unique = [...new Set((crateNames || []).filter(Boolean))];
  if (unique.length <= limit) return unique;

  const tokenize = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);

  const weights = new Map();
  const bump = (tokens, w) => tokens.forEach((t) => weights.set(t, (weights.get(t) || 0) + w));
  bump((release.genres || []).flatMap(tokenize), 3);
  bump((release.suggestedBoxes || []).flatMap(tokenize), 2);
  bump(tokenize(release.artist), 1);

  // Decade tokens: 1994 -> "1990s" and "90s"
  const year = parseInt(release.year, 10);
  if (!Number.isNaN(year)) {
    const dec = Math.floor(year / 10) * 10;
    bump([`${dec}s`, `${String(dec).slice(2)}s`], 2);
  }

  const genreSet = new Set((release.genres || []).map((g) => g.toLowerCase().trim()));
  const boxSet = new Set((release.suggestedBoxes || []).map((b) => b.toLowerCase().trim()));

  return unique
    .map((name, i) => {
      const lname = name.toLowerCase().trim();
      let score = tokenize(name).reduce((sum, t) => sum + (weights.get(t) || 0), 0);
      if (boxSet.has(lname)) score += 6;   // AI named this exact crate for this release
      if (genreSet.has(lname)) score += 5;
      return { name, score, i };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.name);
}

// ----- Helpers ---------------------------------------------------------------

const resizeImage = (file, maxDim = 1500, quality = 0.85) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) { height = Math.round((height * maxDim) / width); width = maxDim; }
          else { width = Math.round((width * maxDim) / height); height = maxDim; }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        canvas.getContext("2d").drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        canvas.width = 0; canvas.height = 0;
        resolve(dataUrl);
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const extractDominantColor = (imageSrc) =>
  new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      const size = 60;
      canvas.width = size; canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0, total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2];
        const brightness = (pr + pg + pb) / 3;
        if (brightness < 20 || brightness > 240) continue;
        const max = Math.max(pr, pg, pb), min = Math.min(pr, pg, pb);
        const sat = max === 0 ? 0 : (max - min) / max;
        const weight = sat * sat + 0.08;
        r += pr * weight; g += pg * weight; b += pb * weight; total += weight;
      }
      if (total > 0) { r = Math.round(r / total); g = Math.round(g / total); b = Math.round(b / total); }
      else { r = 200; g = 200; b: 200; }
      resolve({ r, g, b });
    };
    img.onerror = () => resolve({ r: 200, g: 200, b: 200 });
    img.src = imageSrc;
  });

const resizeAvatar = (file, size = 160) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext("2d");
        const { width, height } = img;
        const minDim = Math.min(width, height);
        const sx = (width - minDim) / 2;
        const sy = (height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const camelotColor = (key) => {
  if (!key) return "rgb(120,120,130)";
  const num = parseInt(key, 10);
  const letter = key.slice(-1).toUpperCase();
  if (isNaN(num) || num < 1 || num > 12) return "rgb(120,120,130)";
  const hue = ((num - 1) * 30) % 360;
  return `hsl(${hue}, ${letter === "B" ? 70 : 55}%, ${letter === "B" ? 68 : 62}%)`;
};

const downloadCSV = (collection) => {
  const csv = exportCSV(collection);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `vinyl-vault-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

// Glass style helpers
const glass = (extra = {}) => ({
  background: "linear-gradient(135deg, rgba(var(--fg),0.07) 0%, rgba(var(--fg),0.02) 100%)",
  backdropFilter: "blur(48px) saturate(200%)",
  WebkitBackdropFilter: "blur(48px) saturate(200%)",
  border: "1px solid rgba(var(--fg),0.10)",
  boxShadow: "inset 0 1px 0 rgba(var(--fg),0.08), 0 24px 60px -20px rgba(0,0,0,0.5)",
  ...extra,
});

const glassSubtle = (extra = {}) => ({
  background: "rgba(var(--fg),0.03)",
  backdropFilter: "blur(20px)",
  WebkitBackdropFilter: "blur(20px)",
  border: "1px solid rgba(var(--fg),0.07)",
  ...extra,
});

// Synthesise a soft confirmation chime using Web Audio API.
// Three cycling styles so the user can compare feels on first few saves.
function playSaveChime() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();

    const tone = (freq, start, dur, peak = 0.22) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(peak, start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
      osc.start(start);
      osc.stop(start + dur + 0.05);
    };

    const now = ctx.currentTime;
    tone(880, now, 0.80, 0.16);
    tone(1760, now, 0.40, 0.05);
    setTimeout(() => ctx.close().catch(() => {}), 1400);
  } catch {}
}

// Module-level cache so reopening a record doesn't re-fetch + re-analyse
const bpmCache = new Map();

// ----- Shared camera stream --------------------------------------------------
// One MediaStream reused across camera opens within a session. Calling
// getUserMedia fresh on every open re-triggers the OS permission prompt on iOS
// Safari (the per-tab grant is dropped once tracks are stopped). Keeping a single
// live stream and reusing it means the prompt fires once per session at most.
// The stream is released when leaving the scan flow, on tab-hide, and on unload.
let _sharedCamStream = null;

function streamIsLive(s) {
  return !!s && s.getVideoTracks().some(t => t.readyState === 'live');
}

// Ask for the highest practical sensor resolution. In a portrait viewport the
// preview is object-cover, so only a narrow slice of a landscape frame is ever
// on screen; the pixels behind the guide box are what limit barcode and
// catalogue-number legibility. These are `ideal` constraints, so a device that
// cannot deliver simply returns the closest it has.
async function acquireCameraStream() {
  if (streamIsLive(_sharedCamStream)) return _sharedCamStream;
  _sharedCamStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1440 } },
    audio: false,
  });
  return _sharedCamStream;
}

function releaseCameraStream() {
  _sharedCamStream?.getTracks().forEach(t => t.stop());
  _sharedCamStream = null;
}

// Typical tempo band + perceptual centre per broad genre. `center` drives an
// octave-symmetric tempo prior during lag selection (so a 174 BPM D&B track
// is not read as its half-time 87); [lo,hi] is a final safety clamp.
// Genres are normalised (punctuation -> spaces) first so "Drum & Bass",
// "Drum n Bass", and "D&B" all match -- the old regex missed every one of
// these, which is why D&B kept resolving to half tempo.
function tempoProfile(genres) {
  const g = (genres || []).join(' ').toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const has = (re) => re.test(g);
  if (has(/\bdnb\b|\bd b\b|drum ?n ?bass|drum and bass|jungle|neurofunk|techstep|darkstep|jump up|liquid funk|ragga|halftime/))
    return { lo: 150, hi: 190, center: 174 };
  if (has(/hardcore|gabber|speedcore|breakcore/))
    return { lo: 155, hi: 210, center: 180 };
  if (has(/dubstep|grime|\b2 ?step\b|uk garage|speed garage/))
    return { lo: 128, hi: 150, center: 140 };
  if (has(/hip ?hop|\brap\b|\btrap\b|boom bap|g funk/))
    return { lo: 70, hi: 110, center: 90 };
  if (has(/reggae|\bdub\b|dancehall|\bska\b|dub techno/))
    return { lo: 60, hi: 100, center: 75 };
  if (has(/ambient|drone|downtempo|trip ?hop|\bidm\b/))
    return { lo: 60, hi: 110, center: 85 };
  if (has(/house|techno|electro|disco|garage|breakbeat|\bbreaks\b|nu skool|acid/))
    return { lo: 110, hi: 140, center: 126 };
  return { lo: 70, hi: 180, center: 120 };
}

// Octave-symmetric weight: bpm and its double are equally far from centre in
// log space, so an octave error is penalised hard (~0.004 at 2x), while
// nearby tempi stay near 1. sigma ~ a third of an octave.
function tempoPrior(bpm, center) {
  const x = Math.log2(bpm / center) / 0.30;
  return Math.exp(-0.5 * x * x);
}

async function detectBPM(previewUrl, genres) {
  if (bpmCache.has(previewUrl)) return bpmCache.get(previewUrl);
  try {
    let arrayBuf;
    try {
      const resp = await fetch(previewUrl, { mode: 'cors' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      arrayBuf = await resp.arrayBuffer();
    } catch {
      // CORS or network block: route through server-side proxy
      const proxyResp = await fetch(
        `/api/audio-proxy?url=${encodeURIComponent(previewUrl)}`
      );
      if (!proxyResp.ok) return null;
      arrayBuf = await proxyResp.arrayBuffer();
    }

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;

    // Decode into a buffer, then close the live context immediately
    const tempCtx = new AudioCtx();
    let buffer;
    try { buffer = await tempCtx.decodeAudioData(arrayBuf); }
    finally { await tempCtx.close(); }

    const sr = buffer.sampleRate;
    const dur = buffer.duration;

    // Band-pass 50 Hz - 2 kHz (highpass -> lowpass). The old sub-only 150 Hz
    // low-pass threw away the snare/breakbeat transients that carry the pulse
    // in drum & bass and jungle, leaving a half-time kick pattern that read as
    // 87 instead of 174. This band keeps the kick fundamental AND the snare
    // body while dropping rumble and hiss.
    const offCtx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
    const src = offCtx.createBufferSource();
    src.buffer = buffer;
    const hp = offCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 50;
    hp.Q.value = 0.7;
    const lp = offCtx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2000;
    lp.Q.value = 0.7;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(offCtx.destination);
    src.start(0);
    const filtered = await offCtx.startRendering();
    const raw = filtered.getChannelData(0);

    // RMS energy in 10 ms windows
    const win = Math.floor(sr * 0.01);
    const numFrames = Math.floor(raw.length / win);
    const energy = new Float32Array(numFrames);
    for (let i = 0; i < numFrames; i++) {
      let s = 0;
      const base = i * win;
      for (let j = 0; j < win; j++) s += raw[base + j] ** 2;
      energy[i] = Math.sqrt(s / win);
    }

    // Smooth over 50 ms
    const smW = 5;
    const smoothed = Float32Array.from(energy, (_, i) => {
      const lo = Math.max(0, i - smW), hi = Math.min(numFrames - 1, i + smW);
      let s = 0;
      for (let k = lo; k <= hi; k++) s += energy[k];
      return s / (hi - lo + 1);
    });

    // Onset-strength envelope: a half-wave rectified first difference emphasises
    // beat attacks. Autocorrelating this is far more reliable than counting
    // peaks, which fails on anything but a clean four-on-the-floor kick.
    const fps = 100; // 10 ms frames
    const onset = new Float32Array(numFrames);
    for (let i = 1; i < numFrames; i++) {
      const d = smoothed[i] - smoothed[i - 1];
      onset[i] = d > 0 ? d : 0;
    }
    const oMean = onset.reduce((a, b) => a + b, 0) / (onset.length || 1);
    if (oMean <= 0) { bpmCache.set(previewUrl, null); return null; }
    for (let i = 0; i < onset.length; i++) onset[i] -= oMean; // remove DC bias

    // Autocorrelate across a wide tempo band (60-200 BPM) and take the strongest lag.
    const minLag = Math.floor((60 * fps) / 200); // 30 frames
    const maxLag = Math.ceil((60 * fps) / 60);   // 100 frames
    if (onset.length < maxLag * 2) { bpmCache.set(previewUrl, null); return null; }

    const ac = new Float32Array(maxLag + 1);
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0;
      for (let i = lag; i < onset.length; i++) sum += onset[i] * onset[i - lag];
      ac[lag] = sum / (onset.length - lag);
    }

    // Reward harmonic support: a true beat period also correlates at 2x and 3x
    // its lag, which biases away from picking a random sub-multiple.
    const scoreAt = (lag) => {
      if (lag < minLag || lag > maxLag) return -Infinity;
      let score = ac[lag];
      if (lag * 2 <= maxLag) score += 0.5 * ac[lag * 2];
      if (lag * 3 <= maxLag) score += 0.25 * ac[lag * 3];
      return score;
    };

    // Weight each candidate lag by the genre tempo prior, so the octave that
    // matches the genre's typical tempo wins at selection time rather than
    // being fixed up afterwards. This is what stops a 174 D&B track locking
    // onto its half-time 87.
    const { lo: bpmLo, hi: bpmHi, center } = tempoProfile(genres);
    let bestLag = minLag, bestScore = -Infinity;
    for (let lag = minLag; lag <= maxLag; lag++) {
      const score = scoreAt(lag) * tempoPrior((60 * fps) / lag, center);
      if (score > bestScore) { bestScore = score; bestLag = lag; }
    }

    if (scoreAt(bestLag) <= 0) { bpmCache.set(previewUrl, null); return null; }

    let bpm = (60 * fps) / bestLag;
    while (bpm < bpmLo) bpm *= 2;
    while (bpm > bpmHi) bpm /= 2;

    // Octave ambiguity: when the half/double-tempo lag scores nearly as well
    // as the winner (on raw autocorrelation) AND the competing octave still
    // fits the genre window, send it to the arbiter rather than persist a
    // coin flip. Compared on raw scores so genuine ambiguity still surfaces
    // even after the prior has picked a primary.
    const rawBest = scoreAt(bestLag);
    const competitor = Math.max(scoreAt(bestLag * 2), scoreAt(Math.round(bestLag / 2)));
    let alt = null;
    if (competitor >= 0.7 * rawBest) {
      if (bpm * 2 <= bpmHi) alt = Math.round(bpm * 2);
      else if (bpm / 2 >= bpmLo) alt = Math.round(bpm / 2);
    }
    bpm = Math.round(bpm);
    if (alt === bpm) alt = null;

    const result = { bpm, alt };
    bpmCache.set(previewUrl, result);
    return result;
  } catch (e) {
    console.log('[bpm]', e.message);
    return null;
  }
}

// Resolve octave-ambiguous waveform readings: one batched call, Claude picks
// between the two candidates from artist/genre/era. Returns choices aligned
// with items, or null on failure.
async function arbitrateOctaves(items, token) {
  if (!items.length || !token) return null;
  try {
    const res = await fetch('/api/bpm-arbiter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        tracks: items.map(it => ({
          artist: it.artist, title: it.title, genres: it.genres, year: it.year, options: it.options,
        })),
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data.choices) ? data.choices : null;
  } catch {
    return null;
  }
}

// Fire-and-forget: feed resolved waveform BPMs into the shared community cache
// so other users' scans of the same tracks get them instantly.
function reportBpmsToCache(items, token) {
  if (!items.length || !token) return;
  fetch('/api/bpm-report', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ tracks: items }),
  }).catch(() => {});
}

// ----- Main Component --------------------------------------------------------

// ----- Greeting helper -------------------------------------------------------

function getGreeting(name) {
  // Greetings: six words max, including the name. Dry, laconic, a little
  // sarcastic, ultimately pointing at the dig. The idle view bolds the clause
  // before the first period and dims the rest, so a short two-beat lands well.
  const hour = new Date().getHours();
  let pool;
  if (hour >= 3 && hour < 5) {
    pool = [
      `3am again, ${name}. Respectable.`,
      `Still up, ${name}? Figures.`,
      `The records waited, ${name}.`,
      `Sleep's overrated anyway, ${name}.`,
      `Witching hour, ${name}. Dig.`,
      `${name}, the vault never sleeps.`,
      `One more record, ${name}? Sure.`,
      `Nocturnal as ever, ${name}.`,
    ];
  } else if (hour >= 5 && hour < 8) {
    pool = [
      `Dawn patrol, ${name}. Respect.`,
      `Up early, ${name}. Good.`,
      `Coffee and crates, ${name}?`,
      `Rise and spin, ${name}.`,
      `Early bird digs deep, ${name}.`,
      `Morning, ${name}. Beat the rush.`,
      `First light, first find, ${name}.`,
      `Sunrise sorting, ${name}? Bold.`,
    ];
  } else if (hour >= 8 && hour < 12) {
    pool = [
      `Morning, ${name}. The stack waits.`,
      `Coffee first, ${name}. Then crates.`,
      `Fresh start, ${name}. Dig in.`,
      `Morning, ${name}. Yesterday's haul judges.`,
      `Back at it, ${name}. Good.`,
      `Morning, ${name}. Files won't sort themselves.`,
      `Bright and early, ${name}.`,
      `${name}, the crates missed you.`,
    ];
  } else if (hour >= 12 && hour < 14) {
    pool = [
      `Midday, ${name}. Still digging?`,
      `Lunch can wait, ${name}.`,
      `Back at it, ${name}?`,
      `Half the day, ${name}. Dig on.`,
      `Noon, ${name}. The stack grew.`,
      `Midday dig, ${name}? Respectable.`,
    ];
  } else if (hour >= 14 && hour < 17) {
    pool = [
      `Afternoon, ${name}. File three, buy none.`,
      `Afternoon, ${name}. The shelf's full again.`,
      `Back digging, ${name}. Naturally.`,
      `Afternoon, ${name}. Ready to dig?`,
      `Prime crate hours, ${name}.`,
      `Afternoon, ${name}. No willpower required.`,
      `${name}, that white label awaits.`,
    ];
  } else if (hour >= 17 && hour < 21) {
    pool = [
      `Evening, ${name}. Time to spin.`,
      `Evening, ${name}. Pull a set.`,
      `Golden hour, ${name}. Dig in.`,
      `Evening, ${name}. What's going in?`,
      `The vault awaits, ${name}.`,
      `Prime time, ${name}. Load up.`,
      `Evening, ${name}. Gig bag's hopeful.`,
      `Showtime soon, ${name}. Dig.`,
    ];
  } else {
    pool = [
      `Late, ${name}. The wantlist's open.`,
      `Night, ${name}. Best finds happen now.`,
      `Still at it, ${name}. Respect.`,
      `Night owl, ${name}? Naturally.`,
      `Midnight crates, ${name}. Dangerous.`,
      `Late, ${name}. Order it anyway.`,
      `The needle rests, ${name}. You don't.`,
      `After midnight, ${name}. No regrets.`,
    ];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}


export default function VinylVault() {
  const { isDark, toggleTheme } = useTheme();
  const { user, profile, loading: authLoading, isAdmin, accessToken, signIn, signUp, signOut, signInWithGoogle, signInWithFacebook, isSupabaseEnabled, updateDisplayName, updateProfile, updateAvatar, updatePreferences, refreshProfile } = useAuth();
  const { tier, scansRemaining, isPaid, startCheckout, openPortal } = useSubscription(user, profile);

  // Splash stays up for one full loop of the chosen WebP clip (its duration),
  // and for as long as auth is genuinely still loading. WebP <img> has no
  // "ended" event, so a per-clip timer stands in; +400ms covers decode/start.
  const [splashHold, setSplashHold] = useState(isSupabaseEnabled);
  useEffect(() => {
    const t = setTimeout(() => setSplashHold(false), (splashClip.dur || 6) * 1000 + 400);
    return () => clearTimeout(t);
  }, []);

  const [appView, setAppView] = useState("scan"); // scan | collection | batch | about | admin
  const [phase, setPhase] = useState("idle");
  const [status, setStatus] = useState("");
  const [release, setRelease] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [accent, setAccent] = useState({ r: 200, g: 200, b: 200 });
  const [errorMsg, setErrorMsg] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [visionData, setVisionData] = useState(null);
  const [pendingCrates, setPendingCrates] = useState([]);
  const [savedId, setSavedId] = useState(null);
  const [saveAnim, setSaveAnim] = useState(null);
  const [batchQueue, setBatchQueue] = useState([]);
  const [batchProcessing, setBatchProcessing] = useState(false);
  // Always-fresh ref so async callbacks never read stale queue state
  const batchQueueRef = useRef([]);
  // Aborts the in-flight single scan when the user cancels mid-search
  const scanAbortRef = useRef(null);

  // Release the shared camera stream when the user leaves the scan flow or the
  // page unloads. The stream is kept alive across camera opens within the scan
  // flow (so repeated scans don't re-prompt), so this is where it's stopped.
  // Note: deliberately NOT released on tab-hide -- iOS backgrounds the tab while
  // the permission sheet is up, and killing the stream there would break the grant.
  useEffect(() => {
    if (appView !== 'scan') releaseCameraStream();
  }, [appView]);
  useEffect(() => {
    window.addEventListener('pagehide', releaseCameraStream);
    return () => {
      window.removeEventListener('pagehide', releaseCameraStream);
      releaseCameraStream();
    };
  }, []);

  const displayName = user?.user_metadata?.display_name || profile?.display_name || user?.email?.split('@')[0] || 'there';
  // Regenerate greeting when the display name changes (e.g. after saving account settings)
  const greetingRef = useRef({ name: null, text: null });
  if (user && greetingRef.current.name !== displayName) {
    greetingRef.current = { name: displayName, text: getGreeting(displayName) };
  }
  const greeting = user ? greetingRef.current.text : null;
  const [showWalkthrough, setShowWalkthrough] = useState(() => !localStorage.getItem('walkthroughSeen'));
  // Owned here rather than inside the scan view: tapping NEW SCAN must open
  // the camera whether that view is already mounted or not, and closing the
  // camera should leave the user on the scan screen.
  const [cameraOpen, setCameraOpen] = useState(false);
  // Pricing screen: always shown to unauthenticated visitors before auth.
  // Dismissed in-session only -- no localStorage needed.
  const [pricingSeen, setPricingSeen] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState('signup');
  const [showAccount, setShowAccount] = useState(false);
  const [showPricingModal, setShowPricingModal] = useState(false);
  const [checkoutSuccess, setCheckoutSuccess] = useState(() => new URLSearchParams(window.location.search).get('checkout') === 'success');
  const [smartCrateNames, setSmartCrateNames] = useState(() => {
    try { return JSON.parse(localStorage.getItem('vv_smart_crate_names') || '[]'); } catch { return []; }
  });
  // Community routing: which public profile is open (null = community home).
  // Mirrored to the URL (?u=username) via History API for shareable links.
  const [profileUsername, setProfileUsername] = useState(null);
  const [notifCount, setNotifCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatRecipient, setChatRecipient] = useState(null); // profile object
  const [msgUnread, setMsgUnread] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState(() => new Set());

  // When returning from Stripe Checkout, re-fetch the profile after a short
  // delay so the webhook has time to update Supabase, then clear the URL param.
  useEffect(() => {
    if (!checkoutSuccess || !user?.id) return;
    window.history.replaceState({}, '', window.location.pathname);
    const timer = setTimeout(() => {
      refreshProfile();
      setCheckoutSuccess(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [checkoutSuccess, user?.id, refreshProfile]);

  const openProfile = useCallback((username) => {
    if (!username) return;
    setProfileUsername(username);
    setAppView('community');
    const url = `${window.location.pathname}?u=${encodeURIComponent(username)}`;
    if (`?u=${encodeURIComponent(username)}` !== window.location.search) {
      window.history.pushState({ u: username }, '', url);
    }
  }, []);

  const openCommunityHome = useCallback(() => {
    setProfileUsername(null);
    setAppView('community');
    if (window.location.search) window.history.pushState({}, '', window.location.pathname);
  }, []);

  // On first load, open a shared profile link if present (?u=username).
  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get('u');
    if (u) { setProfileUsername(u); setAppView('community'); }
  }, []);

  // Browser back/forward: re-sync the open profile from the URL.
  useEffect(() => {
    const onPop = () => {
      const u = new URLSearchParams(window.location.search).get('u');
      if (u) { setProfileUsername(u); setAppView('community'); }
      else { setProfileUsername(null); }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Notification badge: fetch count on login, reset when community tab is opened.
  useEffect(() => {
    if (!user?.id || !isSupabaseEnabled) { setNotifCount(0); return; }
    getNotificationCount(user.id, getLastSeenTs()).then(setNotifCount).catch(() => {});
  }, [user?.id, isSupabaseEnabled]);

  // Unread message badge
  useEffect(() => {
    if (!user?.id || !isSupabaseEnabled) { setMsgUnread(0); return; }
    getUnreadMessageCount(user.id).then(setMsgUnread).catch(() => {});
  }, [user?.id, isSupabaseEnabled]);

  // Realtime presence: track who is currently online.
  useEffect(() => {
    if (!user?.id || !isSupabaseEnabled) { setOnlineUsers(new Set()); return; }
    let channel;
    (async () => {
      const { supabase } = await import('../lib/supabase.js');
      channel = supabase.channel('online', { config: { presence: { key: user.id } } });
      channel.on('presence', { event: 'sync' }, () => {
        const ids = new Set(Object.keys(channel.presenceState()));
        setOnlineUsers(ids);
      });
      await channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') await channel.track({ t: Date.now() });
      });
    })();
    return () => { channel?.unsubscribe(); setOnlineUsers(new Set()); };
  }, [user?.id, isSupabaseEnabled]);

  useEffect(() => {
    if (appView === 'community' && user?.id) {
      setNotifCount(0);
      markNotifsSeen();
    }
  }, [appView, user?.id]);

  const [labelSelectMode, setLabelSelectMode] = useState(false);
  const [selectedForLabels, setSelectedForLabels] = useState(new Set());
  const [showBatchLabelModal, setShowBatchLabelModal] = useState(false);
  const enterLabelMode = useCallback(() => { setLabelSelectMode(true); setSelectedForLabels(new Set()); }, []);
  const exitLabelMode = useCallback(() => { setLabelSelectMode(false); setSelectedForLabels(new Set()); }, []);
  const toggleLabelSelect = useCallback((id) => {
    setSelectedForLabels(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const userId = user?.id ?? null;
  const { collection, syncedIds, addRecord, removeRecord, updateRecord, renameCrate, deleteCrate, addRecordsBulk } = useCollection(userId);

  const updateReleaseBpm = useCallback((trackIdx, bpm) => {
    setRelease(prev => {
      if (!prev) return prev;
      const tracklist = prev.tracklist.map((t, i) => i === trackIdx ? { ...t, bpm } : t);
      return { ...prev, tracklist };
    });
  }, []);

  const toggleReleaseHot = useCallback((trackIdx) => {
    setRelease(prev => {
      if (!prev) return prev;
      const tracklist = prev.tracklist.map((t, i) => i === trackIdx ? { ...t, hot: !t.hot } : t);
      return { ...prev, tracklist };
    });
  }, []);

  // Gate: unauthenticated visitors see pricing first, then auth.
  // Splash shows while auth resolves, with a minimum hold so the mascot
  // animation reads even when the session restores instantly.
  if (isSupabaseEnabled && (authLoading || splashHold)) {
    if (showWalkthrough) {
      return <WalkthroughOverlay onDismiss={() => { safeSetItem(localStorage, 'walkthroughSeen', '1'); setShowWalkthrough(false); }} />;
    }
    return <SplashScreen />;
  }
  if (isSupabaseEnabled && !authLoading && !user) {
    if (!pricingSeen) {
      return (
        <PricingScreen
          onGetStarted={() => { setAuthInitialMode('signup'); setPricingSeen(true); }}
          onSignIn={() => { setAuthInitialMode('signin'); setPricingSeen(true); }}
        />
      );
    }
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} loading={authLoading} initialMode={authInitialMode} />;
  }

  // POST to /api/scan with a guaranteed-fresh access token. If the token is
  // rejected (401 -- expired while the app sat idle), force one refresh and
  // retry, so a stale cached token doesn't surface as "Couldn't read that one".
  // Plain function (not useCallback): it lives below the early gate returns, so
  // it must not be a hook.
  const scanFetch = async (body, signal) => {
    const send = (tok) => fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${tok}` },
      body: JSON.stringify(body),
      signal,
    });
    const token = await freshAccessToken(accessToken);
    let response = await send(token);
    if (response.status === 401) {
      try {
        const { data } = await Promise.race([
          supabase.auth.refreshSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('refresh timeout')), 8000)),
        ]);
        const refreshed = data?.session?.access_token;
        if (refreshed && refreshed !== token) response = await send(refreshed);
      } catch { /* fall through with the original 401 */ }
    }
    // 503 means the auth service could not answer, not that the session is
    // dead. Back off briefly and try again rather than troubling the user:
    // scanning a stack of records in quick succession is exactly when this
    // happens, and it clears within a second.
    for (let attempt = 0; attempt < 2 && response.status === 503; attempt++) {
      await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
      response = await send(await freshAccessToken(accessToken));
    }
    return response;
  };

  // Sends a pre-loaded data URL to /api/scan and returns the parsed response.
  // Used by startBatch where files are pre-read upfront. Throws on any error.
  const scanDataUrl = async (dataUrl, signal) => {
    const base64Data = dataUrl.split(",")[1];
    const response = await scanFetch({ image: base64Data, mediaType: "image/jpeg" }, signal);
    if (response.status === 402) throw new Error("scan_limit_reached");
    if (response.status === 401) throw new Error("Your session expired. Sign out and back in, then try again.");
    if (response.status === 503) throw new Error("The server is busy. Your records are safe. Wait a moment and scan again.");
    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`API ${response.status}: ${errorBody.slice(0, 200)}`);
    }
    return response.json();
  };

  // Barcode scans skip the vision model entirely: the number was decoded on the
  // device, so the server only has to look it up. One Discogs call, no upload.
  const processBarcode = async (code) => {
    setPhase("processing");
    setStatus("Looking up barcode");
    setErrorMsg("");
    setImageUrl(null);
    try {
      const response = await scanFetch({ barcode: code }, undefined);
      if (response.status === 402) { setPhase("idle"); setShowPricingModal(true); return; }
      if (response.status === 401) throw new Error("Your session expired. Sign out and back in, then try again.");
      if (response.status === 503) throw new Error("The server is busy. Your records are safe. Wait a moment and scan again.");
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      if (data.status === "complete") {
        setRelease(data.release);
        setPendingCrates([]);
        setPhase("result");
        if (data.release.coverUrl) { const c = await extractDominantColor(data.release.coverUrl); setAccent(c); }
      } else if (data.status === "disambiguation") {
        setCandidates(data.candidates);
        setVisionData(data.vision);
        setPhase("disambiguation");
      } else if (data.status === "not_found") {
        // The barcode read fine, Discogs simply has no pressing carrying it --
        // common for older and underground vinyl. Point at the photo scan.
        setErrorMsg(`No release on Discogs carries barcode ${data.barcode}. Try scanning the label instead.`);
        setPhase("error");
      } else {
        throw new Error(data.error || "Unexpected response");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Barcode lookup failed");
      setPhase("error");
    }
  };

  const processImage = async (file) => {
    const controller = new AbortController();
    scanAbortRef.current = controller;
    setPhase("processing");
    setStatus("Reading sleeve");
    setErrorMsg("");
    try {
      const dataUrl = await resizeImage(file);
      setImageUrl(dataUrl);
      const color = await extractDominantColor(dataUrl);
      setAccent(color);
      await new Promise((r) => setTimeout(r, 400));
      setStatus("Searching Discogs");
      let data;
      try {
        data = await scanDataUrl(dataUrl, controller.signal);
      } catch (fetchErr) {
        if (fetchErr.message === "scan_limit_reached") {
          setPhase("idle");
          setShowPricingModal(true);
          return null;
        }
        throw fetchErr;
      }
      if (controller.signal.aborted) return;
      if (data.status === "disambiguation") {
        setCandidates(data.candidates);
        setVisionData(data.vision);
        setPhase("disambiguation");
      } else if (data.status === "complete") {
        setRelease(data.release);
        setPendingCrates([]);
        setPhase("result");
        const coverSrc = data.release.coverUrl || null;
        if (coverSrc) { const c = await extractDominantColor(coverSrc); setAccent(c); }
      } else {
        throw new Error(data.error || "Unexpected response");
      }
    } catch (err) {
      if (err.name === "AbortError") return null; // user cancelled; cancelScan already reset the UI
      console.error(err);
      setErrorMsg(err.message || "Identification failed");
      setPhase("error");
    } finally {
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
    }
  };

  const cancelScan = () => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    reset();
  };

  const stopBatch = () => {
    scanAbortRef.current?.abort();
    scanAbortRef.current = null;
    // Don't reset() -- stay on batch view so user can see completed items
  };

  const pickCandidate = async (candidate) => {
    const controller = new AbortController();
    scanAbortRef.current = controller;
    // 50s hard ceiling: abort the controller on timeout so the user never waits
    // forever. AbortSignal.any() is too new for all browsers, so use a timer instead.
    const pickTimeoutId = setTimeout(() => controller.abort(), 50000);
    setPhase("processing");
    setStatus("Pulling release data");
    setErrorMsg("");
    try {
      const response = await scanFetch({ discogsId: candidate.id, vision: visionData }, controller.signal);
      if (response.status === 401) throw new Error('Your session expired. Sign out and back in, then try again.');
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      if (controller.signal.aborted) return;
      if (data.status === "complete") {
        setRelease(data.release);
        setPendingCrates([]);
        setPhase("result");
        if (data.release.coverUrl) { const c = await extractDominantColor(data.release.coverUrl); setAccent(c); }
      } else {
        throw new Error(data.error || "Unexpected response");
      }
    } catch (err) {
      if (err.name === "AbortError") return; // user cancelled or 50s timeout fired
      console.error(err);
      setErrorMsg(err.message || "Failed to pull release data");
      setPhase("error");
    } finally {
      clearTimeout(pickTimeoutId);
      if (scanAbortRef.current === controller) scanAbortRef.current = null;
    }
  };

  const saveRecord = (selectedCover, conditions = {}) => {
    if (!release) return;
    const coverUrl = selectedCover || release.coverUrl || imageUrl || null;
    const extraImages = imageUrl ? [...(release.images || []), imageUrl] : (release.images || []);
    const toSave = { ...release, coverUrl, images: extraImages, mediaCondition: conditions.mediaCondition || '', sleeveCondition: conditions.sleeveCondition || '' };
    playSaveChime();
    addRecord(toSave, pendingCrates).catch(err => setErrorMsg(`Saved locally but failed to sync: ${err.message}`));
    setSavedId(`${release.artist}|${release.title}`);
    setSaveAnim({ release: toSave });
    setTimeout(() => setSaveAnim(null), 2200);
  };

  const reset = () => {
    setPhase("idle");
    setRelease(null);
    setImageUrl(null);
    setAccent({ r: 200, g: 200, b: 200 });
    setErrorMsg("");
    setCandidates([]);
    setVisionData(null);
    setPendingCrates([]);
    setSavedId(null);
  };

  // Sync helper: keeps ref and state in lockstep so async callbacks always
  // read the latest queue without stale-closure issues.
  const syncQueue = (next) => {
    batchQueueRef.current = next;
    setBatchQueue(next);
  };

  const startBatch = async (files) => {
    const fileArray = Array.from(files);

    // Pre-read all files to data URLs immediately while file handles are fresh.
    // On Android, handles from a multi-file picker can become invalid if the tab
    // is backgrounded between selection and processing. Google Photos "Smart Storage"
    // also returns handles for cloud-only photos that fail to read later.
    // Batch uses 1200px / 0.8q (vs 1500px / 0.85 for single scan) to reduce
    // canvas memory pressure on mobile.
    const preloaded = await Promise.all(
      fileArray.map(file =>
        resizeImage(file, 1200, 0.8)
          .then(dataUrl => ({ dataUrl, error: null }))
          .catch(() => ({ dataUrl: null, error: "Could not read image file" }))
      )
    );

    const items = preloaded.map(({ dataUrl, error }) => ({
      dataUrl,
      status: error ? "error" : "queued",
      errorMsg: error || null,
      release: null, candidates: null, vision: null,
      imageUrl: dataUrl || null,
    }));
    syncQueue(items);
    setAppView("batch");
    setBatchProcessing(true);

    let batchStopped = false;
    let currentItemController = null;

    // Wire into scanAbortRef so the "Stop" button can abort the in-flight item
    // and halt the queue. Don't call reset() on stop -- stay on the batch view.
    scanAbortRef.current = {
      abort: () => {
        batchStopped = true;
        currentItemController?.abort();
      },
    };

    // Always read from the ref before writing so concurrent resolveBatchDisambiguation
    // calls on other indices are never overwritten.
    for (let i = 0; i < items.length && !batchStopped; i++) {
      // Skip items that failed pre-read (already marked error above)
      if (items[i].status === "error") continue;

      const qPre = [...batchQueueRef.current];
      qPre[i] = { ...qPre[i], status: "processing" };
      syncQueue(qPre);

      currentItemController = new AbortController();
      // 50s per-item hard ceiling -- prevents a single scan from hanging the whole queue
      const timeoutId = setTimeout(() => currentItemController.abort(), 50000);

      try {
        const data = await scanDataUrl(items[i].dataUrl, currentItemController.signal);
        clearTimeout(timeoutId);
        const q = [...batchQueueRef.current];
        if (data.status === "complete") {
          q[i] = { ...q[i], status: "complete", release: data.release };
          const itemDataUrl = items[i].dataUrl;
          const batchRelease = !data.release.coverUrl && itemDataUrl ? { ...data.release, coverUrl: itemDataUrl } : data.release;
          syncQueue(q);
          // Crates are user-organisational, not derived from metadata. Genres
          // already flow into the record's tags inside recordFromRelease.
          addRecord(batchRelease, []).catch(console.error);
        } else if (data.status === "disambiguation") {
          q[i] = { ...q[i], status: "disambiguation", candidates: data.candidates, vision: data.vision };
          syncQueue(q);
        } else {
          q[i] = { ...q[i], status: "error", errorMsg: "Unexpected server response" };
          syncQueue(q);
        }
      } catch (batchErr) {
        clearTimeout(timeoutId);
        const errMsg = batchErr?.name === "AbortError" ? "Timed out" : (batchErr?.message || "Unknown error");
        console.error(`[batch] item ${i} error:`, errMsg);
        const q = [...batchQueueRef.current];
        q[i] = { ...q[i], status: "error", errorMsg: errMsg };
        syncQueue(q);
      }
    }

    if (scanAbortRef.current && typeof scanAbortRef.current.abort === 'function') {
      scanAbortRef.current = null;
    }
    setBatchProcessing(false);
  };

  const resolveBatchDisambiguation = async (itemIdx, candidate) => {
    // Always read from ref so we never work from a stale render closure.
    // Multiple concurrent resolves each see the latest committed queue.
    const snapshot = [...batchQueueRef.current];
    const vision = snapshot[itemIdx]?.vision;

    snapshot[itemIdx] = { ...snapshot[itemIdx], status: "processing" };
    syncQueue(snapshot);

    try {
      const response = await scanFetch({ discogsId: candidate.id, vision }, AbortSignal.timeout(50000));
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      // Re-snapshot from ref in case another resolve completed while we awaited
      const latest = [...batchQueueRef.current];
      if (data.status === "complete") {
        latest[itemIdx] = { ...latest[itemIdx], status: "complete", release: data.release };
        const disambigScanUrl = latest[itemIdx].imageUrl;
        const disambigRelease = !data.release.coverUrl && disambigScanUrl ? { ...data.release, coverUrl: disambigScanUrl } : data.release;
        addRecord(disambigRelease, []).catch(console.error);
      } else {
        latest[itemIdx] = { ...latest[itemIdx], status: "error", errorMsg: data.error || "Unexpected server response" };
      }
      syncQueue(latest);
    } catch (resolveErr) {
      const errMsg = resolveErr?.name === "AbortError" ? "Timed out" : (resolveErr?.message || "Unknown error");
      console.error(`[batch] resolve item ${itemIdx} error:`, errMsg);
      const latest = [...batchQueueRef.current];
      latest[itemIdx] = { ...latest[itemIdx], status: "error", errorMsg: errMsg };
      syncQueue(latest);
    }
  };

  const allCrates = [...new Set(collection.flatMap((r) => r.crates || []))].sort();
  const accentRGB = `${accent.r}, ${accent.g}, ${accent.b}`;

  const navItems = [
    { id: "scan", label: "Scan", icon: Scan },
    { id: "collection", label: collection.length ? `Collection (${collection.length})` : "Collection", icon: VinylRecord},
    ...(collection.length ? [{ id: "tracks", label: "Tracks", icon: MusicNotes }] : []),
    ...(isSupabaseEnabled && user ? [{ id: "community", label: "Community", icon: Users, badge: notifCount }] : []),
  ];

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden" style={{ background: "var(--bg-hex)", color: "var(--fg-hex)" }}>
      {/* Atmospheric accent glows — more prominent in light mode to show through glass */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute transition-all duration-[2500ms]" style={{ inset: 0, background: `radial-gradient(ellipse 70% 50% at 75% -5%, rgba(${accentRGB}, ${isDark ? 0.13 : 0.30}), transparent 55%)` }} />
        <div className="absolute transition-all duration-[2500ms]" style={{ inset: 0, background: `radial-gradient(ellipse 55% 45% at 15% 105%, rgba(${accentRGB}, ${isDark ? 0.08 : 0.22}), transparent 55%)` }} />
        <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse 100% 60% at 50% 0%, rgba(var(--fg),0.015), transparent 50%)" }} />
      </div>

      {/* Header — sticky, frosted glass so content scrolls cleanly underneath */}
      <header className="sticky top-0 z-30 px-5 md:px-10 py-3 flex items-center justify-between gap-3" style={{ background: "rgba(var(--bg),0.80)", backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)", borderBottom: "1px solid rgba(var(--fg),0.07)", paddingTop: "calc(0.75rem + env(safe-area-inset-top))" }}>
        <div className="flex items-center shrink-0">
          <img src="/logo-white.png" alt="Vinyl Vault" style={{ height: 56, opacity: 0.92 }} />
        </div>

        <nav className="flex items-center gap-1.5 flex-wrap">
          {navItems.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => {
                if (id === "community") { openCommunityHome(); return; }
                setAppView(id);
                if (id === "scan") {
                  if (appView !== "scan") reset();
                  // Straight to the viewfinder, where the label / sleeve /
                  // barcode toggle lives. Closing it lands on the scan screen.
                  setCameraOpen(true);
                }
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] tracking-[0.12em] uppercase font-mono transition-all"
              style={appView === id
                ? { background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.35)`, color: `rgb(${accentRGB})`, boxShadow: `0 0 12px -4px rgba(${accentRGB},0.3)` }
                : { background: "transparent", border: `1px solid rgba(var(--fg),${isDark ? 0.07 : 0.15})`, color: `rgba(var(--fg),${isDark ? 0.4 : 0.6})` }
              }
            >
              <span className="relative inline-flex items-center">
                <Icon size={16} weight={appView === id ? "bold" : "regular"} />
                {badge > 0 && (
                  <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 14, height: 14, borderRadius: 7, background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: '#000', lineHeight: 1, padding: '0 3px' }}>
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>

        {/* Chat + Account pair */}
        {isSupabaseEnabled && user && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => { setChatRecipient(null); setChatOpen(p => !p); }} title="Messages"
              className="relative w-8 h-8 rounded-full flex items-center justify-center transition-opacity hover:opacity-70"
              style={{ border: chatOpen ? `1px solid rgba(${accentRGB},0.45)` : '1px solid rgba(var(--fg),0.18)', background: chatOpen ? `rgba(${accentRGB},0.12)` : 'rgba(var(--fg),0.06)', color: chatOpen ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.55)' }}>
              <ChatCircle size={16} weight={chatOpen ? 'fill' : 'regular'} />
              {msgUnread > 0 && (
                <span style={{ position: 'absolute', top: -3, right: -3, minWidth: 14, height: 14, borderRadius: 7, background: `rgb(${accentRGB})`, fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {msgUnread > 9 ? '9+' : msgUnread}
                </span>
              )}
            </button>
            <button onClick={() => setShowAccount(true)} title="Account settings"
              className={`w-8 h-8 rounded-full overflow-hidden flex items-center justify-center transition-opacity hover:opacity-70${profile?.avatar_url ? '' : ' vv-avatar-fallback'}`}
              style={profile?.avatar_url
                ? { border: "1px solid rgba(var(--fg),0.18)", background: "rgba(var(--fg),0.06)" }
                : undefined}>
              {profile?.avatar_url
                ? <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
                : (() => { const SpaceIcon = spaceIconFor(profile || { id: user?.id, email: user?.email }); return <SpaceIcon size={17} weight="regular" />; })()
              }
            </button>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="relative px-5 md:px-10 pb-20 max-w-7xl mx-auto">
        {appView === "admin" && (
          <AdminPanel onBack={() => setAppView("collection")} />
        )}
        {appView === "scan" && (
          <>
            {phase === "idle" && <IdleView showCamera={cameraOpen} setShowCamera={setCameraOpen} onUpload={processImage} onBarcode={processBarcode} onBatch={startBatch} accentRGB={accentRGB} greeting={greeting} collection={collection} onManual={() => setPhase("manual")} />}
            {phase === "processing" && <ProcessingView imageUrl={imageUrl} status={status} accentRGB={accentRGB} onCancel={cancelScan} />}
            {phase === "manual" && (
              <ManualSearchView initial={visionData} accentRGB={accentRGB} onPick={pickCandidate} onCancel={reset} />
            )}
            {phase === "disambiguation" && (
              <>
                <div className="flex justify-center pt-4 pb-1">
                  <button onClick={reset} className="text-[14px] tracking-[0.15em] uppercase font-mono px-5 py-2 rounded-full transition-all" style={{ border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.40)", background: "rgba(var(--fg),0.03)" }}>
                    New scan
                  </button>
                </div>
                <DisambiguationView candidates={candidates} vision={visionData} imageUrl={imageUrl} accentRGB={accentRGB} onPick={pickCandidate} onManual={() => setPhase("manual")} />
              </>
            )}
            {phase === "result" && release && (
              <ResultView release={release} imageUrl={imageUrl} accentRGB={accentRGB} pendingCrates={pendingCrates} setPendingCrates={setPendingCrates} allCrates={allCrates} onSave={saveRecord} saved={!!savedId} onBpmDetected={updateReleaseBpm} onHotToggle={toggleReleaseHot} onReset={reset} onManual={() => setPhase("manual")} collection={collection} smartCrateNames={smartCrateNames} />
            )}
            {phase === "error" && <ErrorView message={errorMsg} onReset={reset} onManual={() => setPhase("manual")} onSignOut={signOut} />}
          </>
        )}
        {appView === "collection" && (
          <CollectionView collection={collection} syncedIds={syncedIds} accentRGB={accentRGB} accessToken={accessToken} onRemove={removeRecord} onUpdate={updateRecord} onRenameCrate={renameCrate} onDeleteCrate={deleteCrate} onDownloadCSV={() => downloadCSV(collection)} labelSelectMode={labelSelectMode} selectedForLabels={selectedForLabels} showBatchLabelModal={showBatchLabelModal} onToggleLabelSelect={toggleLabelSelect} onEnterLabelMode={enterLabelMode} onExitLabelMode={exitLabelMode} onShowBatchLabelModal={setShowBatchLabelModal} smartCrateNames={smartCrateNames} onSmartCratesApplied={(names) => { setSmartCrateNames(names); safeSetItem(localStorage, 'vv_smart_crate_names', JSON.stringify(names)); }} profile={profile} onUpdatePreferences={updatePreferences} />
        )}
        {appView === "tracks" && (
          <TracksView collection={collection} accentRGB={accentRGB} onUpdate={updateRecord} accessToken={accessToken} />
        )}
        {appView === "batch" && (
          <BatchView queue={batchQueue} processing={batchProcessing} onResolve={resolveBatchDisambiguation} onBatch={startBatch} onStop={stopBatch} accentRGB={accentRGB} onSignOut={signOut} />
        )}
        {appView === "community" && (
          <CommunityView
            currentUser={user}
            currentProfile={profile}
            accentRGB={accentRGB}
            profileUsername={profileUsername}
            onOpenProfile={openProfile}
            onOpenHome={openCommunityHome}
            onOpenAccount={() => setShowAccount(true)}
            collection={collection}
            onOpenChat={(recipient) => { setChatRecipient(recipient); setChatOpen(true); }}
            onlineUsers={onlineUsers}
          />
        )}

      </main>

      {/* Chat panel overlay */}
      {chatOpen && user && (
        <ChatPanel
          currentUser={user}
          accentRGB={accentRGB}
          isDark={isDark}
          initialRecipient={chatRecipient}
          onClose={() => { setChatOpen(false); setChatRecipient(null); }}
          onUnreadChange={setMsgUnread}
          onlineUsers={onlineUsers}
        />
      )}

      {showWalkthrough && appView === 'scan' && (
        <WalkthroughOverlay onDismiss={() => {
          safeSetItem(localStorage, 'walkthroughSeen', '1');
          setShowWalkthrough(false);
        }} />
      )}

      {saveAnim && <SaveConfirmation release={saveAnim.release} accentRGB={accentRGB} />}

      {showAccount && (
        <AccountModal
          user={user}
          profile={profile}
          accentRGB={accentRGB}
          isDark={isDark}
          onToggleTheme={toggleTheme}
          onClose={() => setShowAccount(false)}
          onSignOut={() => { setShowAccount(false); signOut(); }}
          onUpdateDisplayName={updateDisplayName}
          onUpdateProfile={updateProfile}
          onUpdateAvatar={updateAvatar}
          onViewProfile={(username) => { setShowAccount(false); openProfile(username); }}
          onPrintLabels={() => { setShowAccount(false); setAppView('collection'); enterLabelMode(); }}
          onDownloadCSV={() => downloadCSV(collection)}
          onAddRecordsBulk={addRecordsBulk}
          isAdmin={isAdmin}
          onOpenAdmin={() => { setShowAccount(false); setAppView('admin'); }}
          onUpgrade={() => { setShowAccount(false); setShowPricingModal(true); }}
          tier={tier}
          isPaid={isPaid}
          onManageSubscription={openPortal}
        />
      )}

      {showPricingModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
          onClick={() => setShowPricingModal(false)}>
          {/* Acid card on the scrim: the tier panels are drawn as ink keylines
              on acid, so they need the acid ground to read at all. */}
          <div className="vv-pricing-wrap" style={{ width: '100%', padding: '20px 16px 18px', margin: '0 16px', borderRadius: 24, background: '#cafe04', maxHeight: '92vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <TierCarousel onGetStarted={() => setShowPricingModal(false)} onCheckout={startCheckout} />
            <button onClick={() => setShowPricingModal(false)}
              style={{ display: 'block', margin: '16px auto 0', fontSize: 13, fontFamily: 'monospace', color: 'rgba(8,8,12,0.55)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              Close
            </button>
          </div>
        </div>
      )}

      <PWAInstallBanner accentRGB={accentRGB} />
    </div>
  );
}

// ----- PWA install -----------------------------------------------------------

// Detects install eligibility across platforms. Android/desktop Chromium fires
// `beforeinstallprompt`, which we capture for a custom button. iOS Safari has no
// such event -- the only path is the Share sheet -> "Add to Home Screen", so we
// surface instructions there instead. Hidden once the app runs standalone.
function usePwaInstall() {
  const isStandalone = () =>
    (typeof window !== 'undefined' &&
      ((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
        window.navigator.standalone === true));

  const [deferred, setDeferred] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    const onBIP = (e) => { e.preventDefault(); setDeferred(e); };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onBIP);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBIP);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  const isIOS = /iphone|ipad|ipod/i.test(ua) && !window.MSStream;

  const promptInstall = async () => {
    if (!deferred) return false;
    deferred.prompt();
    const choice = await deferred.userChoice.catch(() => ({ outcome: 'dismissed' }));
    if (choice.outcome === 'accepted') setInstalled(true);
    setDeferred(null);
    return choice.outcome === 'accepted';
  };

  return { installed, isIOS, canInstall: !!deferred, promptInstall };
}

const PWA_DISMISS_KEY = 'vv_pwa_install_dismissed';

function PWAInstallBanner({ accentRGB }) {
  const { installed, isIOS, canInstall, promptInstall } = usePwaInstall();
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(PWA_DISMISS_KEY) === '1'; } catch { return false; }
  });
  const [showIosSteps, setShowIosSteps] = useState(false);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(PWA_DISMISS_KEY, '1'); } catch { /* private mode */ }
  };

  // Nothing to offer: already installed, dismissed, or a browser with neither
  // the install event (Chromium) nor iOS's Add-to-Home-Screen path.
  if (installed || dismissed) return null;
  if (!canInstall && !isIOS) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(16px,env(safe-area-inset-bottom))] pointer-events-none">
      <div className="mx-auto max-w-md rounded-2xl p-4 pointer-events-auto"
        style={{ background: 'rgba(var(--bg),0.95)', backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)', border: '1px solid rgba(var(--fg),0.12)', boxShadow: '0 24px 60px -12px rgba(0,0,0,0.4)', animation: 'fadeUp 0.4s ease-out both' }}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.3)` }}>
            <DeviceMobile size={20} style={{ color: `rgb(${accentRGB})` }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-display text-white/90 mb-0.5">Install Vinyl Vault</div>
            <div className="text-[12.5px] font-mono leading-relaxed text-white/45">
              Add it to your home screen for full-screen scanning and a camera that only asks permission once.
            </div>

            {!showIosSteps && (
              <div className="flex items-center gap-2 mt-3">
                {canInstall ? (
                  <button onClick={async () => { const ok = await promptInstall(); if (ok) dismiss(); }}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] tracking-[0.12em] uppercase font-mono transition-all"
                    style={{ background: `rgba(${accentRGB},0.18)`, border: `1px solid rgba(${accentRGB},0.4)`, color: `rgb(${accentRGB})` }}>
                    <DownloadSimple size={14} weight="bold" />Install
                  </button>
                ) : (
                  <button onClick={() => setShowIosSteps(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] tracking-[0.12em] uppercase font-mono transition-all"
                    style={{ background: `rgba(${accentRGB},0.18)`, border: `1px solid rgba(${accentRGB},0.4)`, color: `rgb(${accentRGB})` }}>
                    <Export size={14} weight="bold" />How to add
                  </button>
                )}
                <button onClick={dismiss}
                  className="px-3 py-2 rounded-full text-[12px] tracking-[0.12em] uppercase font-mono transition-all"
                  style={{ color: 'rgba(var(--fg),0.45)' }}>
                  Not now
                </button>
              </div>
            )}

            {showIosSteps && (
              <div className="mt-3 text-[12.5px] font-mono text-white/55 space-y-1.5">
                <div className="flex items-center gap-2"><span style={{ color: `rgb(${accentRGB})` }}>1.</span> Tap the Share button <Export size={14} className="inline -mt-0.5" /> in Safari's toolbar</div>
                <div className="flex items-center gap-2"><span style={{ color: `rgb(${accentRGB})` }}>2.</span> Scroll down and tap <span className="text-white/80">Add to Home Screen</span></div>
                <div className="flex items-center gap-2"><span style={{ color: `rgb(${accentRGB})` }}>3.</span> Tap <span className="text-white/80">Add</span> — done</div>
                <button onClick={dismiss} className="mt-1 px-3 py-1.5 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono" style={{ color: 'rgba(var(--fg),0.45)', border: '1px solid rgba(var(--fg),0.12)' }}>Got it</button>
              </div>
            )}
          </div>

          <button onClick={dismiss} className="shrink-0 -mr-1 -mt-1 p-1 transition-opacity hover:opacity-70" aria-label="Dismiss">
            <X size={15} className="text-white/40" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- SaveConfirmation (pill toast, audio does the heavy lifting) -----------

function SaveConfirmation({ release, accentRGB }) {
  const [leaving, setLeaving] = useState(false);
  useEffect(() => { const t = setTimeout(() => setLeaving(true), 1600); return () => clearTimeout(t); }, []);

  return (
    <div style={{
      position: 'fixed', top: 68, left: '50%', zIndex: 300, pointerEvents: 'none',
      animation: leaving
        ? 'bannerOut 0.32s cubic-bezier(0.4,0,1,1) forwards'
        : 'bannerIn 0.36s cubic-bezier(0.34,1.4,0.64,1) forwards',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px 9px 10px',
        borderRadius: 48, whiteSpace: 'nowrap', maxWidth: 'min(88vw, 340px)',
        background: 'rgba(8,8,14,0.90)', backdropFilter: 'blur(32px)',
        WebkitBackdropFilter: 'blur(32px)',
        border: `1px solid rgba(${accentRGB},0.36)`,
        boxShadow: `0 8px 32px -8px rgba(0,0,0,0.75), 0 0 22px -6px rgba(${accentRGB},0.40)`,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: `rgba(${accentRGB},0.16)`, border: `1px solid rgba(${accentRGB},0.38)`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', color: `rgb(${accentRGB})`,
        }}>
          <Check size={14} weight="bold" />
        </div>
        <div style={{ overflow: 'hidden', minWidth: 0 }}>
          <div style={{ fontSize: 11, fontFamily: 'monospace', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.35)', marginBottom: 1.5 }}>Added to collection</div>
          <div style={{ fontSize: 14, color: 'rgba(var(--fg),0.85)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis' }}>{release.artist} — {release.title}</div>
        </div>
        <VinylRecord size={15} weight="fill" style={{ color: `rgba(${accentRGB},0.65)`, flexShrink: 0, marginLeft: 2 }} />
      </div>
    </div>
  );
}

// ----- IdleView --------------------------------------------------------------

function IdleView({ onUpload, onBarcode, onBatch, accentRGB, greeting, collection = [], onManual, showCamera, setShowCamera }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const [recs, setRecs] = useState([]);
  const [recsSource, setRecsSource] = useState([]);

  useEffect(() => {
    const CACHE_KEY = 'vv_recs_v4';
    const CACHE_TTL = 24 * 60 * 60 * 1000;

    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (cached && Date.now() - cached.ts < CACHE_TTL && cached.results?.length) {
        setRecs(cached.results);
        setRecsSource(cached.source || []);
        return;
      }
    } catch {}

    const labelCounts = {}, artistCounts = {}, genreCounts = {};
    for (const record of collection) {
      if (record.label) labelCounts[record.label] = (labelCounts[record.label] || 0) + 1;
      if (record.artist) artistCounts[record.artist] = (artistCounts[record.artist] || 0) + 1;
      for (const g of (record.genres || [])) genreCounts[g] = (genreCounts[g] || 0) + 1;
      for (const t of (record.tags || [])) genreCounts[t] = (genreCounts[t] || 0) + 1;
    }
    const topLabels  = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([l]) => l);
    const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a]) => a);
    const topGenres  = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([g]) => g);

    if (!topLabels.length && !topArtists.length) return;
    const source = topLabels.slice(0, 3);
    setRecsSource(source);

    const params = new URLSearchParams();
    if (topLabels.length)  params.set('labels',  topLabels.join(','));
    if (topArtists.length) params.set('artists', topArtists.join(','));
    if (topGenres.length)  params.set('genres',  topGenres.join(','));

    freshAccessToken(null)
      .then(token => fetch(`/api/recommendations?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      }))
      .then(r => r.ok ? r.json() : { results: [] })
      .then(data => {
        const results = data.results || [];
        setRecs(results);
        try { localStorage.setItem(CACHE_KEY, JSON.stringify({ results, source, ts: Date.now() })); } catch {}
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCapture = (file) => {
    setShowCamera(false);
    onUpload(file);
  };

  const handleBarcode = (code) => {
    setShowCamera(false);
    onBarcode?.(code);
  };

  return (
    <div className="pt-10 md:pt-20 flex flex-col items-center">
      {/* Heading section - left-aligned */}
      <div className="w-full max-w-2xl mb-14 md:mb-20">
        <div className="text-[13px] tracking-[0.35em] uppercase mb-5 text-white/30 font-mono">New scan</div>
        <h1 className="text-[38px] md:text-[58px] leading-[0.92] mb-5 font-display tracking-tight text-left" style={{ animation: 'fadeUp 0.4s ease-out' }}>
          {greeting
            ? <>{greeting.split('.')[0]}{/[?!]$/.test(greeting.split('.')[0]) ? '' : '.'}<br /><span className="text-white/35">{greeting.split('.').slice(1).join('.').trim()}</span></>
            : <>Stack your wax<br /><span className="text-white/35">the easy way.</span></>
          }
        </h1>
        {/* Explains the app to someone who has not used it yet. Once they have
            saved their first record they know what it does, so it retires
            itself rather than taking up the top of the screen forever. */}
        {collection.length === 0 && (
          <p className="text-white/45 text-sm md:text-base max-w-lg leading-relaxed">
            Photograph a sleeve. Get the pressing confirmed, the tracklist loaded, BPM data attached, and the record filed exactly where you want it.
          </p>
        )}
      </div>

      {/* Cards grid - centred */}
      <div className="relative max-w-lg mx-auto w-full" style={{ overflow: 'visible' }}>
        {/* Colour blobs behind the glass panels — only rendered in light mode */}
        {isLight && (
          <div style={{ position: 'absolute', inset: '-35% -20%', pointerEvents: 'none' }}>
            <div style={{ position: 'absolute', top: '5%', left: '8%', width: '55%', height: '60%', background: `radial-gradient(ellipse, rgba(${accentRGB},0.42), transparent 60%)`, filter: 'blur(56px)' }} />
            <div style={{ position: 'absolute', bottom: '5%', right: '6%', width: '48%', height: '52%', background: 'radial-gradient(ellipse, rgba(180,140,255,0.32), transparent 60%)', filter: 'blur(48px)' }} />
            <div style={{ position: 'absolute', top: '42%', left: '38%', width: '36%', height: '38%', background: 'radial-gradient(ellipse, rgba(100,200,255,0.22), transparent 60%)', filter: 'blur(40px)' }} />
          </div>
        )}
        <div className="grid sm:grid-cols-2 gap-4">
        {/* Camera / scan card */}
        <div className="relative transition-all hover:brightness-110 active:scale-[0.98]" style={isLight ? {
          background: 'linear-gradient(145deg, rgba(255,254,250,0.92) 0%, rgba(252,249,240,0.88) 100%)',
          boxShadow: `inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.03), 0 16px 48px -12px rgba(0,0,0,0.16), 0 4px 12px -4px rgba(0,0,0,0.09), 0 0 0 1px rgba(255,255,255,0.7), 0 0 48px -10px rgba(${accentRGB},0.28)`,
          backdropFilter: 'blur(44px) saturate(240%)', WebkitBackdropFilter: 'blur(44px) saturate(240%)', borderRadius: '20px', padding: '2rem',
        } : { background: 'linear-gradient(145deg, rgba(var(--fg),0.08) 0%, rgba(var(--fg),0.03) 100%)', boxShadow: `inset 0 1px 0 rgba(var(--fg),0.15), inset 0 -1px 0 rgba(0,0,0,0.2), 0 32px 64px -20px rgba(0,0,0,0.7), 0 8px 16px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(var(--fg),0.08), 0 0 60px -20px rgba(${accentRGB},0.25)`, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '20px', padding: '2rem' }}>
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="vv-glass-tile w-12 h-12 rounded-2xl flex items-center justify-center">
              <Camera size={22} weight="light" style={{ color: 'rgba(var(--fg),0.72)' }} />
            </div>
            <div>
              <div className="text-[13px] tracking-[0.25em] uppercase text-white/35 mb-1 font-mono">Single record</div>
              <div className="text-lg font-display">Scan label, barcode or sleeve</div>
            </div>
          </div>
          {/* Primary: open camera viewfinder */}
          <button onClick={() => setShowCamera(true)} className="absolute inset-0 w-full h-full" style={{ borderRadius: '20px' }} aria-label="Open camera" />
        </div>

        {/* Batch queue card */}
        <label className="relative block cursor-pointer transition-all hover:brightness-110 active:scale-[0.98]" style={isLight ? {
          background: 'linear-gradient(145deg, rgba(255,254,250,0.92) 0%, rgba(252,249,240,0.88) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.03), 0 16px 48px -12px rgba(0,0,0,0.16), 0 4px 12px -4px rgba(0,0,0,0.09), 0 0 0 1px rgba(255,255,255,0.7)',
          backdropFilter: 'blur(44px) saturate(240%)', WebkitBackdropFilter: 'blur(44px) saturate(240%)', borderRadius: '20px', padding: '2rem',
        } : { background: 'linear-gradient(145deg, rgba(var(--fg),0.08) 0%, rgba(var(--fg),0.03) 100%)', boxShadow: 'inset 0 1px 0 rgba(var(--fg),0.15), inset 0 -1px 0 rgba(0,0,0,0.2), 0 32px 64px -20px rgba(0,0,0,0.7), 0 8px 16px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(var(--fg),0.08)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '20px', padding: '2rem' }}>
          <div className="relative z-10 flex flex-col items-center gap-5 text-center">
            <div className="vv-glass-tile w-12 h-12 rounded-2xl flex items-center justify-center">
              <GridNine size={22} weight="light" style={{ color: 'rgba(var(--fg),0.72)' }} />
            </div>
            <div>
              <div className="text-[13px] tracking-[0.25em] uppercase text-white/35 mb-1 font-mono">Multiple records</div>
              <div className="text-lg font-display text-white/70">Upload photo/s</div>
            </div>
          </div>
          <input type="file" accept="image/*" multiple onChange={(e) => { if (e.target.files?.length) onBatch(e.target.files); }} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
        </div>{/* end grid */}
      </div>{/* end relative wrapper */}

      <div className="mt-4 flex flex-col items-center gap-2">
        {onManual && (
          <button onClick={onManual} className="inline-flex items-center gap-1.5 text-[14px] font-mono text-white/28 hover:text-white/50 transition-colors">
            <MagnifyingGlass size={11} />
            or type artist & title to search
          </button>
        )}
      </div>

      {showCamera && <CameraModal onCapture={handleCapture} onBarcode={handleBarcode} onClose={() => setShowCamera(false)} />}

      {/* Recommendations */}
      {recs.length > 0 && (
        <div className="mt-14 w-full" style={{ animation: 'fadeUp 0.5s ease-out 0.15s both' }}>
          <div className="mb-4">
            <div className="text-[13px] tracking-[0.35em] uppercase font-mono whitespace-nowrap" style={{ color: `rgba(var(--fg),${isLight ? 0.55 : 0.3})` }}>Picked for you</div>
            {recsSource.length > 0 && (
              <div className="text-[11px] font-mono mt-1 truncate" style={{ color: `rgba(var(--fg),${isLight ? 0.52 : 0.2})`, letterSpacing: '0.10em' }}>
                {recsSource.slice(0, 2).join(' / ')}{recsSource.length > 2 ? ` +${recsSource.length - 2}` : ''}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10, overflowX: 'auto', paddingBottom: 8, scrollSnapType: 'x mandatory', WebkitOverflowScrolling: 'touch' }}>
            {recs.slice(0, 6).map(rec => (
              <div key={rec.id} style={{ flex: '0 0 calc(33.33% - 7px)', minWidth: 120, scrollSnapAlign: 'start' }}>
                {/* Square art -- matches RecordCard exactly */}
                <div className="aspect-square rounded-xl overflow-hidden mb-2 vv-art-shadow">
                  {rec.thumb
                    ? <img src={rec.thumb} alt={rec.title} loading="lazy" decoding="async" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.1), rgba(${accentRGB},0.02))` }}>
                        <VinylRecord size={24} weight="thin" className="opacity-20" />
                      </div>
                  }
                </div>
                {/* Text -- matches RecordCard exactly */}
                <div className="text-[14px] leading-snug font-display truncate" style={{ color: 'rgba(var(--fg),0.85)' }}>{rec.artist || 'Various'}</div>
                <div className="text-[13px] truncate font-mono" style={{ color: 'rgba(var(--fg),0.5)' }}>{rec.title}</div>
                {rec.reason && (
                  <div style={{ fontSize: 10, fontStyle: 'italic', color: `rgba(${accentRGB},${isLight ? 0.85 : 0.7})`, lineHeight: 1.4, marginTop: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{rec.reason}</div>
                )}
                {/* Single lime green buy button */}
                {(rec.storeLinks?.[0]?.url || rec.buyUrl) && (
                  <div style={{ marginTop: 7, display: 'flex', justifyContent: 'center' }}>
                    <a href={rec.storeLinks?.[0]?.url || rec.buyUrl} target="_blank" rel="noopener noreferrer"
                      style={{ display: 'inline-block', padding: '5px 14px', borderRadius: 20, fontSize: 10, fontWeight: 700, fontFamily: 'monospace', background: '#C9FF00', color: '#000', textDecoration: 'none', letterSpacing: '0.12em', textTransform: 'uppercase', transition: 'background 0.15s', whiteSpace: 'nowrap' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#d8ff33'}
                      onMouseLeave={e => e.currentTarget.style.background = '#C9FF00'}>
                      Buy now
                    </a>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ----- ProcessingView --------------------------------------------------------

function ProcessingView({ imageUrl, status, accentRGB, onCancel }) {
  return (
    <div className="pt-16 flex flex-col items-center">
      <div className="relative w-full max-w-[380px] aspect-square rounded-2xl overflow-hidden" style={{ boxShadow: `0 40px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(var(--fg),0.07)` }}>
        {imageUrl && <img src={imageUrl} alt="Scanning" className="w-full h-full object-cover" />}
        <div className="absolute left-0 right-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent, rgba(${accentRGB},1), transparent)`, boxShadow: `0 0 24px rgba(${accentRGB},0.9)`, animation: "scanLine 2s ease-in-out infinite" }} />
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(var(--fg),0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--fg),0.025) 1px, transparent 1px)`, backgroundSize: "28px 28px" }} />
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(var(--fg),0.06)` }} />
      </div>
      <div className="mt-7 text-[14px] tracking-[0.3em] uppercase flex items-center gap-2.5 font-mono" style={{ color: `rgb(${accentRGB})` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: `rgb(${accentRGB})`, animation: "pulse 1.4s ease-in-out infinite" }} />
        {status}
      </div>
      {onCancel && (
        <button onClick={onCancel} className="mt-5 inline-flex items-center gap-1.5 px-5 py-2 rounded-full text-[14px] tracking-[0.12em] uppercase font-mono transition-all hover:opacity-80"
          style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.5)", background: "rgba(var(--fg),0.03)" }}>
          <X size={12} />Cancel
        </button>
      )}
    </div>
  );
}

// ----- ResultView ------------------------------------------------------------

function ResultView({ release, imageUrl, accentRGB, pendingCrates, setPendingCrates, allCrates, onSave, saved, onBpmDetected, onHotToggle, onReset, onManual, collection = [], smartCrateNames = [] }) {
  const audioRef = useRef(null);
  const [playingPreview, setPlayingPreview] = useState(null);
  const [crateInput, setCrateInput] = useState("");
  const [imgIdx, setImgIdx] = useState(0);
  const [bpmDetecting, setBpmDetecting] = useState(new Set());
  const bpmTriedRef = useRef(new Set());
  const [pendingMedia, setPendingMedia] = useState('');
  const [pendingSleeve, setPendingSleeve] = useState('');

  const releaseKey = `${release?.discogsId || release?.artist}|${release?.title}`;
  useEffect(() => {
    if (!release?.tracklist?.length) return;
    release.tracklist.forEach((track, i) => {
      if (!track.previewUrl || track.bpm != null || bpmTriedRef.current.has(track.previewUrl)) return;
      bpmTriedRef.current.add(track.previewUrl);
      setBpmDetecting(prev => new Set([...prev, i]));
      detectBPM(track.previewUrl, release.genres).then(res => {
        // Octave-ambiguous readings stay null here; the Tracks view resolves
        // them through the arbiter rather than persisting a coin flip.
        if (res?.bpm != null && res.alt == null) onBpmDetected?.(i, res.bpm);
        setBpmDetecting(prev => { const s = new Set(prev); s.delete(i); return s; });
      });
    });
  }, [releaseKey]);

  const discogsImages = release.images?.length ? release.images : (release.coverUrl ? [release.coverUrl] : []);
  // Always append the user's scanned photo so there is always at least two options
  // when a Discogs cover exists: the official artwork and their own shot.
  const images = (imageUrl && discogsImages.length > 0) ? [...discogsImages, imageUrl] : discogsImages.length > 0 ? discogsImages : imageUrl ? [imageUrl] : [];
  const displayImage = images[imgIdx] || imageUrl;

  // Swipe support for the main image
  const imgSwipeStartX = useRef(null);
  const onImgTouchStart = (e) => { imgSwipeStartX.current = e.touches[0].clientX; };
  const onImgTouchEnd = (e) => {
    if (imgSwipeStartX.current === null || images.length <= 1) return;
    const delta = e.changedTouches[0].clientX - imgSwipeStartX.current;
    imgSwipeStartX.current = null;
    if (delta < -40) setImgIdx(i => Math.min(i + 1, images.length - 1));
    else if (delta > 40) setImgIdx(i => Math.max(i - 1, 0));
  };

  const playPreview = (url) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingPreview === url) { setPlayingPreview(null); return; }
    const audio = new Audio(url);
    audio.preload = 'auto';
    audioRef.current = audio;
    audio.oncanplay = () => { if (audioRef.current === audio) audio.play().catch(() => {}); };
    setPlayingPreview(url);
    audio.onended = () => { setPlayingPreview(null); audioRef.current = null; };
  };
  useEffect(() => () => { audioRef.current?.pause(); }, []);

  const toggleCrate = (name) => setPendingCrates((prev) => prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]);
  const addCustomCrate = () => {
    const name = crateInput.trim();
    if (!name || pendingCrates.includes(name)) return;
    setPendingCrates((prev) => [...prev, name]);
    setCrateInput("");
  };

  // Release tags: AI evocative names + Discogs genres/styles (descriptive metadata)
  const releaseTags = [
    ...(release.suggestedBoxes || []),
    ...(release.genres || []),
  ].filter((t, i, arr) => arr.indexOf(t) === i);

  // Suggest only the three most apt crates for this release, not every crate
  // the user owns. Smart-crate users rank against their fixed taxonomy;
  // everyone else ranks the AI per-release names plus their own custom crates.
  const usingSmartCrates = smartCrateNames.length > 0;
  const cratePool = usingSmartCrates
    ? smartCrateNames
    : [...(release.suggestedBoxes || []), ...allCrates.filter(c => !GENRE_CRATES.includes(c))];
  const suggestedCrates = rankCratesForRelease(
    cratePool.filter(c => !pendingCrates.includes(c)),
    release,
    3,
  );

  const duplicate = release && collection.find(r =>
    (release.id && r.discogsId && String(r.discogsId) === String(release.id)) ||
    normalizeKey(r.artist, r.title) === normalizeKey(release.artist || '', release.title || '')
  );

  return (
    <div className="pt-6 md:pt-10 space-y-6" style={{ animation: "fadeUp 0.6s ease-out" }}>
      {/* Duplicate warning */}
      {duplicate && !saved && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: 'rgba(240,190,60,0.07)', border: '1px solid rgba(240,190,60,0.22)' }}>
          <span style={{ fontSize: 23, color: 'rgba(240,190,60,0.85)' }}>!</span>
          <div style={{ fontSize: 18, fontFamily: 'monospace', color: 'rgba(240,190,60,0.85)' }}>
            You already own this -- <span style={{ fontStyle: 'italic' }}>{duplicate.artist}</span> {duplicate.title}
          </div>
        </div>
      )}
      {/* Top bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={onReset} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] tracking-[0.12em] uppercase font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.13)", color: "rgba(var(--fg),0.55)", background: "rgba(var(--fg),0.04)" }}>
          <CaretLeft size={12} />New scan
        </button>
        {onManual && (
          <button onClick={onManual} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] tracking-[0.12em] uppercase font-mono transition-all"
            style={release.identified
              ? { border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.40)", background: "rgba(var(--fg),0.03)" }
              : { border: `1px solid rgba(${accentRGB},0.35)`, color: `rgb(${accentRGB})`, background: `rgba(${accentRGB},0.12)` }}>
            <MagnifyingGlass size={12} />{release.identified ? "Not right?" : "Search manually"}
          </button>
        )}
      </div>
      {/* Meta bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <ConfidenceBadge confidence={release.confidence} identified={release.identified} accentRGB={accentRGB} />
        {release.source && release.source !== "vision" && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] tracking-[0.2em] uppercase font-mono text-white/35" style={{ border: "1px solid rgba(var(--fg),0.07)" }}>
            {release.source === "discogs+spotify" ? "Discogs + Spotify" : "Discogs"}
          </div>
        )}
        {release.notes && <div className="text-[14px] text-white/40 font-mono">{release.notes}</div>}
      </div>

      {/* Cover + details. grid-cols-1 on mobile is load-bearing: with no
          explicit template the auto track sizes to its items' max-content
          (the image strip contributes its full unscrolled width), overflowing
          the viewport on image-rich scans -- same fix as the detail modal. */}
      <div className="grid grid-cols-1 md:grid-cols-[auto_1fr] gap-6 md:gap-10">
        {/* Image gallery */}
        <div className="relative min-w-0">
          <div className="relative w-full md:w-[300px] lg:w-[360px] aspect-square rounded-2xl overflow-hidden" style={{ boxShadow: `0 3px 8px rgba(0,0,0,0.22), 0 26px 60px -8px rgba(${accentRGB},0.42), 0 0 0 1px rgba(var(--fg),0.07)` }} onTouchStart={onImgTouchStart} onTouchEnd={onImgTouchEnd}>
            {displayImage ? (
              <img src={displayImage} alt={release.title} className="w-full h-full object-cover transition-opacity duration-300" onError={(e) => { if (imageUrl && e.target.src !== imageUrl) e.target.src = imageUrl; }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.1), rgba(${accentRGB},0.02))` }}>
                <VinylRecord size={48} weight="thin" className="opacity-20" />
              </div>
            )}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(var(--fg),0.06), transparent 40%)" }} />
          </div>

          {/* Image strip */}
          {images.length > 0 && (
            <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
              {images.map((src, i) => (
                <button key={i} onClick={() => setImgIdx(i)} className="relative shrink-0 w-12 h-12 rounded-lg overflow-hidden transition-all"
                  style={{ opacity: imgIdx === i ? 1 : 0.45, border: imgIdx === i ? "1px solid rgba(120,220,140,0.70)" : "1px solid rgba(var(--fg),0.08)", boxShadow: imgIdx === i ? "0 0 10px -2px rgba(120,220,140,0.45)" : "none" }}>
                  <img src={src} alt="" className="w-full h-full object-cover" />
                  {imgIdx === i && (
                    <div className="absolute bottom-0.5 right-0.5 w-4 h-4 rounded-full flex items-center justify-center" style={{ background: "rgba(60,190,90,0.95)", border: "1px solid rgba(var(--fg),0.30)" }}>
                      <Check size={9} weight="bold" style={{ color: "#fff" }} />
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}

          <div className="absolute -inset-10 -z-10 blur-3xl opacity-40 pointer-events-none" style={{ background: `radial-gradient(circle, rgba(${accentRGB},0.5), transparent 60%)` }} />
        </div>

        {/* Info */}
        <div className="flex flex-col justify-center">
          <div className="text-[13px] tracking-[0.3em] uppercase text-white/35 mb-3 font-mono">
            {[release.format, release.year, release.country].filter(Boolean).join(" · ")}
          </div>
          <h1 className="text-3xl md:text-5xl leading-[1.02] mb-1.5 font-display tracking-tight">
            <span className="italic">{release.artist}</span>
          </h1>
          <h2 className="text-2xl md:text-3xl leading-tight mb-5 text-white/55 font-display">
            {release.title}
          </h2>
          <div className="flex flex-wrap gap-2 mb-5">
            {release.label && <Pill label="Label" value={release.label} />}
            {release.catalogNumber && <Pill label="Cat #" value={release.catalogNumber} mono />}
          </div>
        </div>
      </div>

      {/* Tags — descriptive metadata, not organisational */}
      {releaseTags.length > 0 && (
        <GlassSection title="Tags" subtitle="Genre and feel — for discovery" accentRGB={accentRGB} icon={<Sparkle size={13} weight="fill" style={{ color: `rgb(${accentRGB})` }} />}>
          <TagCloud tags={releaseTags} genres={release.genres || []} accentRGB={accentRGB} />
        </GlassSection>
      )}

      {/* Crate assignment */}
      <GlassSection title="File into crates" subtitle="Where does this record live?" accentRGB={accentRGB}>
        <div className="space-y-3">
          {/* Selected crates */}
          {pendingCrates.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {pendingCrates.map((name) => (
                <button key={name} onClick={() => toggleCrate(name)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] font-mono transition-all" style={{ background: "rgba(var(--fg),0.09)", border: "1px solid rgba(var(--fg),0.22)", color: "rgba(var(--fg),0.85)" }}>
                  <Check size={11} weight="bold" />{name}<X size={10} className="opacity-50 ml-0.5" />
                </button>
              ))}
            </div>
          )}

          {/* Crate suggestions: only the three most apt for this release */}
          {suggestedCrates.length > 0 && (
            <div>
              <div className="text-[11px] tracking-[0.25em] uppercase font-mono mb-1.5" style={{ color: 'rgba(var(--fg),0.28)' }}>{usingSmartCrates ? 'Your crates' : 'Suggested'}</div>
              <div className="flex flex-wrap gap-1.5">
                {suggestedCrates.map((name) => (
                  <button key={name} onClick={() => toggleCrate(name)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-mono transition-all hover:border-white/20 hover:text-white/55" style={{ background: "transparent", border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.38)" }}>
                    <Plus size={9} />{name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input value={crateInput} onChange={(e) => setCrateInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomCrate()} placeholder="Create a custom crate..." className="flex-1 rounded-full px-4 py-2 text-[15px] font-mono text-white/60 placeholder-white/20 outline-none" style={{ background: "rgba(var(--fg),0.04)", border: "1px solid rgba(var(--fg),0.09)" }} />
            <button onClick={addCustomCrate} className="px-4 py-2 rounded-full text-[14px] font-mono transition-all hover:text-white/70" style={{ border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.40)", background: "transparent" }}>Add</button>
          </div>

          {/* Grade before saving */}
          {!saved && (
            <div className="flex items-center gap-4 py-1">
              <span style={{ fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.25)' }}>Grade</span>
              <ConditionSelect icon={<Mountains size={16} />} value={pendingMedia} onChange={setPendingMedia} />
              <ConditionSelect icon={<ImageSquare size={16} />} value={pendingSleeve} onChange={setPendingSleeve} />
            </div>
          )}

          <button onClick={() => saved ? onReset() : onSave(images[imgIdx] || imageUrl, { mediaCondition: pendingMedia, sleeveCondition: pendingSleeve })}
            className={`w-full py-3 rounded-xl text-[15px] tracking-[0.2em] uppercase font-mono transition-all${saved ? '' : ' vv-save-btn'}`}
            style={saved
              ? { background: "rgba(100,210,120,0.18)", border: "1px solid rgba(100,210,120,0.50)", color: "rgb(140,230,160)", boxShadow: "0 0 24px -8px rgba(100,210,120,0.4)" }
              : undefined}>
            {saved
              ? <span className="flex items-center justify-center gap-2"><Check size={14} weight="bold" />Saved to collection</span>
              : "Save to collection"}
          </button>
        </div>
      </GlassSection>

      {/* Tracklist */}
      {release.tracklist && release.tracklist.length > 0 && (
        <GlassSection title="Tracklist" subtitle={`${release.tracklist.length} tracks`} accentRGB={accentRGB}>
          <div className="space-y-0.5">
            {release.tracklist.map((track, i) => (
              <TrackRow key={i} track={track} index={i} accentRGB={accentRGB} playingPreview={playingPreview} onPlay={playPreview} bpmLoading={bpmDetecting.has(i)} onHotToggle={onHotToggle} />
            ))}
          </div>
        </GlassSection>
      )}
    </div>
  );
}

// ----- CollectionView --------------------------------------------------------

// ----- Crate colour system ---------------------------------------------------

// Ten crate colours. The original five ran cool (violet through blue to
// cyan) plus the brand acid, which left the warm half of the wheel empty and
// made two crates of similar mood hard to tell apart. The second five fill
// that gap at a matching saturation so the set still reads as one family, and
// every one of them takes black type under the contrast test used by the
// filled lozenges, so the whole palette stays legible.
const CRATE_PALETTE = [
  { id: 'purple',  hex: '#5B21D4', rgb: '91,33,212'   },
  { id: 'violet',  hex: '#AC90E2', rgb: '172,144,226' },
  { id: 'cyan',    hex: '#60EDD6', rgb: '96,237,214'  },
  { id: 'blue',    hex: '#3498EF', rgb: '52,152,239'  },
  { id: 'lime',    hex: '#C9FF00', rgb: '201,255,0'   },
  { id: 'emerald', hex: '#17C08A', rgb: '23,192,138'  },
  { id: 'amber',   hex: '#FFB020', rgb: '255,176,32'  },
  { id: 'coral',   hex: '#FF5C4D', rgb: '255,92,77'   },
  { id: 'magenta', hex: '#F0409C', rgb: '240,64,156'  },
  { id: 'slate',   hex: '#7B8FA8', rgb: '123,143,168' },
];

// Palette RGB strings for use in rgba() — matches CRATE_PALETTE order
const PALETTE_RGB = CRATE_PALETTE.map(c => c.rgb);

// ---- Crate colour helpers ---------------------------------------------------
// Used where a crate colour becomes a filled surface rather than an accent, so
// whatever sits on top has to stay legible against it.

function hexToRgb(hex) {
  const h = String(hex || '').replace('#', '');
  const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  const n = parseInt(full, 16);
  return Number.isNaN(n) ? null : { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

// Ink or paper, whichever the eye can actually read on this colour. Most of the
// palette takes black; the deep purple does not, and guessing would leave that
// one crate unreadable.
function contrastInk(hex) {
  const c = hexToRgb(hex);
  if (!c) return '#08080c';
  const lin = (v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
  const L = 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const onBlack = (L + 0.05) / 0.05;
  const onWhite = 1.05 / (L + 0.05);
  return onBlack >= onWhite ? '#08080c' : '#ffffff';
}

// Same hue, a shade deeper, for the far end of the gradient.
function shade(hex, amount = 0.18) {
  const c = hexToRgb(hex);
  if (!c) return hex;
  const f = (v) => Math.max(0, Math.round(v * (1 - amount)));
  return `rgb(${f(c.r)}, ${f(c.g)}, ${f(c.b)})`;
}

function pillGlassStyle(col, extraStyle = {}) {
  return {
    background: `linear-gradient(135deg, ${col}d8 0%, ${col}88 100%)`,
    border: `1px solid ${col}90`,
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
    boxShadow: `inset 0 1.5px 0 rgba(255,255,255,0.38), inset 0 -1px 0 rgba(0,0,0,0.10), 0 4px 16px ${col}45`,
    color: 'rgba(var(--fg),0.95)',
    ...extraStyle,
  };
}

function loadCrateColors() {
  try { return JSON.parse(localStorage.getItem('vinylvault_crate_colors') || '{}'); }
  catch { return {}; }
}

function RotatingCube({ color, size = 9 }) {
  const c = color || 'rgba(var(--fg),0.4)';
  const half = size / 2;
  const face = {
    position: 'absolute', width: size, height: size,
    background: `${c}14`, border: `1px solid ${c}`,
    top: 0, left: 0, boxSizing: 'border-box',
  };
  return (
    <div style={{ width: size, height: size, perspective: size * 5, flexShrink: 0 }}>
      <div className="crate-cube" style={{ width: size, height: size, position: 'relative', transformStyle: 'preserve-3d' }}>
        <div style={{ ...face, transform: `translateZ(${half}px)` }} />
        <div style={{ ...face, transform: `rotateY(180deg) translateZ(${half}px)` }} />
        <div style={{ ...face, transform: `rotateY(90deg) translateZ(${half}px)` }} />
        <div style={{ ...face, transform: `rotateY(-90deg) translateZ(${half}px)` }} />
        <div style={{ ...face, transform: `rotateX(-90deg) translateZ(${half}px)` }} />
        <div style={{ ...face, transform: `rotateX(90deg) translateZ(${half}px)` }} />
      </div>
    </div>
  );
}

// ----- CollectionView --------------------------------------------------------

// Record-shop filing rule: a leading "The " is silent when sorting artist
// names, so The Beatles files under B and The Cure under C.
const artistSortKey = (v) => String(v || '').replace(/^the\s+/i, '');

function CollectionView({ collection, syncedIds, accentRGB, accessToken, onRemove, onUpdate, onRenameCrate, onDeleteCrate, onDownloadCSV, labelSelectMode, selectedForLabels, showBatchLabelModal, onToggleLabelSelect, onEnterLabelMode, onExitLabelMode, onShowBatchLabelModal, smartCrateNames = [], onSmartCratesApplied, profile, onUpdatePreferences }) {
  const [collectionMode, setCollectionMode] = useState("stacks"); // stacks | explore
  // Carousel vs grid is a personal preference: remember the last choice so
  // the collection reopens the way the user left it.
  const [viewMode, setViewMode] = useState(() => {
    try {
      const stored = localStorage.getItem('vv_view_mode');
      return stored === 'grid' || stored === 'list' ? stored : 'carousel';
    } catch { return 'carousel'; }
  });
  useEffect(() => {
    try { localStorage.setItem('vv_view_mode', viewMode); } catch { /* storage unavailable */ }
  }, [viewMode]);
  const [search, setSearch] = useState("");
  const [filterCrate, setFilterCrate] = useState(null);
  const [crateMenuOpen, setCrateMenuOpen] = useState(false);
  // Sort choice is a personal preference like the view mode: remember it so the
  // collection comes back the way the user left it.
  const [sortBy, setSortBy] = useState(() => {
    try {
      const v = localStorage.getItem('vv_sort_by');
      return ['added', 'artist', 'title', 'label'].includes(v) ? v : 'added';
    } catch { return 'added'; }
  });
  useEffect(() => {
    try { localStorage.setItem('vv_sort_by', sortBy); } catch { /* storage unavailable */ }
  }, [sortBy]);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [carouselIdx, setCarouselIdx] = useState(0);
  // Grid renders in pages of GRID_PAGE; an IntersectionObserver sentinel grows
  // the limit as you scroll so large collections don't mount thousands of nodes.
  const [gridLimit, setGridLimit] = useState(GRID_PAGE);
  const gridSentinelRef = useRef(null);
  const [detailRecordId, setDetailRecordId] = useState(null);
  const detailRecord = detailRecordId ? collection.find(r => r.id === detailRecordId) || null : null;
  const [crateColors, setCrateColorsState] = useState(loadCrateColors);
  const cloudSyncedRef = useRef(false);
  const colorSaveTimerRef = useRef(null);

  // One-time sync: when the profile first loads, merge cloud colours in (cloud wins).
  useEffect(() => {
    if (cloudSyncedRef.current) return;
    const cloudColors = profile?.preferences?.crate_colors;
    if (!cloudColors || Object.keys(cloudColors).length === 0) return;
    cloudSyncedRef.current = true;
    setCrateColorsState(prev => {
      const merged = { ...prev, ...cloudColors };
      safeSetItem(localStorage, 'vinylvault_crate_colors', JSON.stringify(merged));
      return merged;
    });
  }, [profile]);

  const setCrateColor = (name, hex) => {
    // The write and the cloud save happen OUTSIDE the state updater. A state
    // updater must be pure: when this ran inside it and localStorage was full,
    // the QuotaExceededError surfaced during the update and took the whole app
    // down with the crash screen instead of just failing to save a colour.
    const next = { ...crateColors };
    if (hex) next[name] = hex; else delete next[name];
    setCrateColorsState(next);
    if (!safeSetItem(localStorage, 'vinylvault_crate_colors', JSON.stringify(next))) {
      console.warn('[crate colours] local storage is full; the colour is saved to your account instead.');
    }
    // Debounce cloud save by 1 s so rapid palette changes don't spam Supabase.
    if (onUpdatePreferences) {
      clearTimeout(colorSaveTimerRef.current);
      colorSaveTimerRef.current = setTimeout(() => {
        onUpdatePreferences({ crate_colors: next });
      }, 1000);
    }
  };

  // Only user-created crates — tags and genres stay out of this list
  const allCrates = [...new Set(collection.flatMap((r) => r.crates || []))].sort();

  const crateCounts = useMemo(() => {
    const counts = {};
    for (const r of collection) {
      for (const c of (r.crates || [])) counts[c] = (counts[c] || 0) + 1;
    }
    return counts;
  }, [collection]);

  const filtered = useMemo(() => collection.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || r.artist.toLowerCase().includes(q)
      || r.title.toLowerCase().includes(q)
      || (r.label || "").toLowerCase().includes(q)
      || (r.catalogNumber || "").toLowerCase().includes(q)
      || (r.tags || []).some((t) => t.toLowerCase().includes(q));
    const matchCrate = !filterCrate || (r.crates || []).includes(filterCrate);
    return matchSearch && matchCrate;
  }), [collection, search, filterCrate]);

  const sortedFiltered = useMemo(() => {
    if (sortBy === 'added') return filtered;
    const col = sortBy === 'artist' ? 'artist' : sortBy === 'title' ? 'title' : 'label';
    const keyOf = (r) => col === 'artist' ? artistSortKey(r[col]) : (r[col] || '');
    return [...filtered].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
  }, [filtered, sortBy]);

  useEffect(() => { setCarouselIdx(0); setGridLimit(GRID_PAGE); }, [search, filterCrate, sortBy]);

  useEffect(() => {
    const el = gridSentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) setGridLimit((l) => l + GRID_PAGE);
    }, { rootMargin: '600px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [viewMode, gridLimit, filtered.length]);

  const goNext = useCallback(() => setCarouselIdx((i) => Math.min(i + 1, filtered.length - 1)), [filtered.length]);
  const goPrev = useCallback(() => setCarouselIdx((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    const handler = (e) => {
      if (collectionMode !== "stacks" || viewMode !== "carousel" || detailRecord) return;
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [collectionMode, viewMode, detailRecord, goNext, goPrev]);

  if (collection.length === 0) {
    return (
      <div className="pt-20 flex flex-col items-center text-center max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={glassSubtle()}>
          <VinylRecord size={28} weight="thin" className="opacity-25" />
        </div>
        <h2 className="text-2xl mb-2 font-display"><span className="italic">Collection</span> is empty</h2>
        <p className="text-white/35 text-sm leading-relaxed">Scan your first record to start building your archive.</p>
      </div>
    );
  }

  return (
    <div className="pt-6 md:pt-10">
      {/* Mode toggle: Stacks vs Explore */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center rounded-full p-0.5" style={{ background: "rgba(var(--fg),0.04)", border: "1px solid rgba(var(--fg),0.08)" }}>
          {[{ id: "stacks", label: "Collection" }, { id: "crates", label: "Crates" }, { id: "stats", label: "Stats" }].map(({ id, label }) => (
            <button key={id} onClick={() => setCollectionMode(id)} className="px-4 py-1.5 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all"
              style={collectionMode === id
                ? { background: "rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.85)", boxShadow: "0 1px 0 rgba(var(--fg),0.08)" }
                : { background: "transparent", color: "rgba(var(--fg),0.50)" }}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="text-[11px] tracking-[0.15em] uppercase font-mono" style={{ color: 'rgba(var(--fg),0.28)' }}>
            {collectionMode === 'stacks' ? filtered.length : collection.length}{(collectionMode === 'stacks' ? filtered.length : collection.length) !== 1 ? ' recs' : ' rec'}
          </span>
          {collectionMode === 'stacks' && labelSelectMode && (
            <>
              <span className="text-[14px] font-mono text-white/40">{selectedForLabels.size} selected</span>
              <button
                onClick={() => onShowBatchLabelModal(true)}
                disabled={selectedForLabels.size === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] font-mono transition-all"
                style={{ border: `1px solid rgba(${accentRGB},${selectedForLabels.size > 0 ? '0.4' : '0.12'})`, color: selectedForLabels.size > 0 ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.2)', background: selectedForLabels.size > 0 ? `rgba(${accentRGB},0.12)` : 'transparent', cursor: selectedForLabels.size === 0 ? 'not-allowed' : 'pointer' }}>
                <Printer size={12} />Preview Labels
              </button>
              <button onClick={onExitLabelMode} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.08)", color: "rgba(var(--fg),0.38)", background: "transparent" }}>
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* CRATES MODE */}
      {collectionMode === "crates" && (
        <CratesTabView collection={collection} allCrates={allCrates} onUpdate={onUpdate} onRename={onRenameCrate} onDelete={onDeleteCrate} crateColors={crateColors} onSetColor={setCrateColor} onSmartCratesApplied={onSmartCratesApplied} smartCrateNames={smartCrateNames} onOpenCrate={(crate) => { setFilterCrate(crate); setCrateMenuOpen(false); setCollectionMode("stacks"); }} />
      )}

      {/* STATS MODE */}
      {collectionMode === "stats" && (
        <StatsView collection={collection} accentRGB={accentRGB} />
      )}

      {/* STACKS MODE */}
      {collectionMode === "stacks" && (
        <>
          {/* Search + layout controls */}
          <div className="flex flex-wrap items-center gap-2.5 mb-4">
            <div className="flex-1 min-w-[180px]">
              <PredictiveSearch value={search} onChange={setSearch} collection={collection} accentRGB={accentRGB} />
            </div>
            <div className="flex items-center rounded-full overflow-hidden" style={{ border: "1px solid rgba(var(--fg),0.08)" }}>
              {[{ id: "carousel", Icon: Stack }, { id: "grid", Icon: GridNine }, { id: "list", Icon: Rows }].map(({ id, Icon }) => (
                <button key={id} onClick={() => setViewMode(id)} className="px-3 py-2 transition-all" style={{ background: viewMode === id ? "rgba(var(--fg),0.09)" : "transparent", color: viewMode === id ? "rgba(var(--fg),0.85)" : "rgba(var(--fg),0.50)" }}>
                  <Icon size={14} />
                </button>
              ))}
            </div>
          </div>

          {/* Sort + crate filter row */}
          <div className="flex items-center gap-3 mb-4 flex-wrap">

            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={() => setSortMenuOpen(o => !o)}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all"
                style={{ background: sortBy !== 'added' ? 'rgba(var(--fg),0.07)' : 'rgba(var(--fg),0.025)', border: '1px solid rgba(var(--fg),0.08)', color: sortBy !== 'added' ? 'rgba(var(--fg),0.75)' : 'rgba(var(--fg),0.50)' }}>
                <ArrowsDownUp size={13} className="opacity-70" />
                <span>{sortBy === 'added' ? 'Sort' : { artist: 'Artist', title: 'Title', label: 'Label' }[sortBy]}</span>
                <CaretDown size={11} className="opacity-50" style={{ transform: sortMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
              </button>
              {sortMenuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setSortMenuOpen(false)} />
                  <div className="absolute left-0 mt-1.5 z-30 rounded-2xl overflow-hidden py-1.5" style={{ minWidth: 190, background: 'rgba(var(--bg),0.97)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(var(--fg),0.12)', boxShadow: '0 24px 60px -12px rgba(0,0,0,0.4)' }}>
                    {[['added', 'Recently added'], ['artist', 'Artist A–Z'], ['title', 'Title A–Z'], ['label', 'Label A–Z']].map(([key, label]) => (
                      <button key={key} onClick={() => { setSortBy(key); setSortMenuOpen(false); }}
                        className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-all"
                        style={{ background: sortBy === key ? 'rgba(var(--fg),0.07)' : 'transparent' }}
                        onMouseEnter={e => { if (sortBy !== key) e.currentTarget.style.background = 'rgba(var(--fg),0.04)'; }}
                        onMouseLeave={e => { if (sortBy !== key) e.currentTarget.style.background = 'transparent'; }}>
                        <span className="flex-1 text-[12px] tracking-[0.1em] uppercase font-mono" style={{ color: sortBy === key ? 'rgba(var(--fg),0.92)' : 'rgba(var(--fg),0.62)' }}>{label}</span>
                        {sortBy === key && <Check size={11} weight="bold" style={{ color: 'rgba(var(--fg),0.7)' }} />}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Crate filter — dropdown picker (scales to any number of crates) */}
            {allCrates.length > 0 && (
            <div className="relative">
              {filterCrate ? (
                /* Active state: glassmorphic pill that re-opens the menu on tap */
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setCrateMenuOpen(o => !o)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] tracking-[0.12em] uppercase font-mono transition-all"
                    style={crateColors[filterCrate]
                      ? pillGlassStyle(crateColors[filterCrate])
                      : { background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.32)`, color: 'rgba(var(--fg),0.90)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: `0 4px 16px rgba(${accentRGB},0.20)` }}>
                    {filterCrate}
                    {(crateCounts[filterCrate] || 0) > 0 && (
                      <span style={{ minWidth: 14, height: 14, borderRadius: '50%', background: 'rgba(0,0,0,0.22)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, lineHeight: 1 }}>{crateCounts[filterCrate]}</span>
                    )}
                  </button>
                  <button onClick={() => { setFilterCrate(null); setCrateMenuOpen(false); }} className="flex items-center justify-center w-6 h-6 rounded-full transition-all" style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)', color: 'rgba(var(--fg),0.40)' }} onMouseEnter={e => e.currentTarget.style.color='rgba(var(--fg),0.80)'} onMouseLeave={e => e.currentTarget.style.color='rgba(var(--fg),0.40)'}><X size={10} /></button>
                </div>
              ) : (
                /* Idle state: compact trigger */
                <button onClick={() => setCrateMenuOpen(o => !o)}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all"
                  style={{ background: 'rgba(var(--fg),0.025)', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.50)' }}>
                  <Stack size={13} className="opacity-60" />
                  <span>Filter by crate</span>
                  <CaretDown size={11} className="opacity-50" style={{ transform: crateMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
                </button>
              )}

              {crateMenuOpen && (
                <>
                  <div className="fixed inset-0 z-20" onClick={() => setCrateMenuOpen(false)} />
                  <div className="absolute left-0 mt-1.5 z-30 rounded-2xl overflow-hidden py-1.5 max-h-[320px] overflow-y-auto" style={{ minWidth: 220, background: 'rgba(var(--bg),0.97)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(var(--fg),0.12)', boxShadow: '0 24px 60px -12px rgba(0,0,0,0.4)' }}>
                    {allCrates.map((c) => {
                      const active = filterCrate === c;
                      return (
                        <button key={c} onClick={() => { setFilterCrate(active ? null : c); setCrateMenuOpen(false); }}
                          className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-all"
                          style={{ background: active ? 'rgba(var(--fg),0.07)' : 'transparent' }}
                          onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(var(--fg),0.04)'; }}
                          onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                          <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: crateColors[c] || 'rgba(var(--fg),0.28)' }} />
                          <span className="flex-1 truncate text-[12px] tracking-[0.1em] uppercase font-mono" style={{ color: active ? 'rgba(var(--fg),0.92)' : 'rgba(var(--fg),0.62)' }}>{c}</span>
                          {active && <Check size={11} weight="bold" style={{ color: 'rgba(var(--fg),0.7)' }} />}
                          <span className="text-[11px] font-mono" style={{ color: 'rgba(var(--fg),0.30)' }}>{crateCounts[c] || 0}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}

          </div>{/* end sort+filter row */}

          {sortedFiltered.length === 0 && <div className="text-center py-16 text-white/40 text-sm font-mono">No records match.</div>}

          {viewMode === "carousel" && sortedFiltered.length > 0 && (
            <VinylCarousel records={sortedFiltered} index={carouselIdx} onIndexChange={setCarouselIdx} onPrev={goPrev} onNext={goNext} onSelect={(r) => setDetailRecordId(r.id)} onRemove={onRemove} accentRGB={accentRGB} crateColors={crateColors} selectMode={labelSelectMode} selectedIds={selectedForLabels} onToggleSelect={onToggleLabelSelect} onUpdate={onUpdate} allCrates={allCrates} smartCrateNames={smartCrateNames} crateCounts={crateCounts} />
          )}
          {viewMode === "list" && sortedFiltered.length > 0 && (
            <RecordListView records={sortedFiltered} onSelect={(r) => setDetailRecordId(r.id)} onDownloadCSV={onDownloadCSV} accentRGB={accentRGB} />
          )}
          {viewMode === "grid" && sortedFiltered.length > 0 && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                {sortedFiltered.slice(0, gridLimit).map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    onSelect={labelSelectMode ? null : () => setDetailRecordId(record.id)}
                    onRemove={labelSelectMode ? null : () => onRemove(record.id)}
                    accentRGB={accentRGB}
                    selectMode={labelSelectMode}
                    selected={selectedForLabels.has(record.id)}
                    onToggleSelect={() => onToggleLabelSelect(record.id)}
                    localOnly={syncedIds !== null && !syncedIds.has(record.id)}
                  />
                ))}
              </div>
              {sortedFiltered.length > gridLimit && <div ref={gridSentinelRef} style={{ height: 1 }} />}
            </>
          )}
        </>
      )}

      {detailRecord && <RecordDetailModal record={detailRecord} onClose={() => setDetailRecordId(null)} onRemove={() => { onRemove(detailRecord.id); setDetailRecordId(null); }} onUpdate={onUpdate} accentRGB={accentRGB} accessToken={accessToken} crateColors={crateColors} allCrates={allCrates} smartCrateNames={smartCrateNames} crateCounts={crateCounts} />}
      {showBatchLabelModal && (
        <BatchLabelModal
          records={filtered.filter(r => selectedForLabels.has(r.id))}
          accentRGB={accentRGB}
          onClose={() => onShowBatchLabelModal(false)}
        />
      )}
    </div>
  );
}

// ----- RecordListView --------------------------------------------------------

// Text table of the collection: sortable by clicking any column header, with
// a CSV export at the top. Search/crate filters from the toolbar above apply
// (records arrive pre-filtered); header sorting overrides the incoming order.
const LIST_COLS = [
  { key: 'artist', label: 'Artist' },
  { key: 'title', label: 'Release' },
  { key: 'catalogNumber', label: 'Cat No.' },
  { key: 'country', label: 'Country' },
  { key: 'year', label: 'Year' },
  { key: 'label', label: 'Label' },
];

function RecordListView({ records, onSelect, onDownloadCSV, accentRGB }) {
  const [sort, setSort] = useState({ key: null, dir: 1 });

  const sorted = useMemo(() => {
    if (!sort.key) return records;
    const { key, dir } = sort;
    return [...records].sort((a, b) => {
      const av = a[key], bv = b[key];
      // Blanks always sink to the bottom regardless of direction.
      if (av == null || av === '') return bv == null || bv === '' ? 0 : 1;
      if (bv == null || bv === '') return -1;
      if (key === 'year') return (Number(av) - Number(bv)) * dir;
      const as = key === 'artist' ? artistSortKey(av) : String(av);
      const bs = key === 'artist' ? artistSortKey(bv) : String(bv);
      return as.localeCompare(bs, undefined, { sensitivity: 'base' }) * dir;
    });
  }, [records, sort]);

  const toggleSort = (key) => {
    setSort(prev => prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 });
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[12px] font-mono" style={{ color: 'rgba(var(--fg),0.35)' }}>
          {sorted.length} record{sorted.length === 1 ? '' : 's'}
        </span>
        <button onClick={onDownloadCSV}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all hover:opacity-80"
          style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.1)', color: 'rgba(var(--fg),0.65)' }}>
          <DownloadSimple size={13} />Export CSV
        </button>
      </div>
      <div className="rounded-2xl" style={{ border: '1px solid rgba(var(--fg),0.08)', overflowX: 'auto' }}>
        <table className="w-full" style={{ minWidth: 640, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(var(--fg),0.1)' }}>
              <th style={{ width: 44 }} />
              {LIST_COLS.map(({ key, label }) => (
                <th key={key} className="text-left px-3 py-2.5">
                  <button onClick={() => toggleSort(key)}
                    className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.16em] uppercase font-mono transition-all hover:opacity-80"
                    style={{ color: sort.key === key ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                    {label}
                    <CaretDown size={10} weight="bold"
                      style={{ opacity: sort.key === key ? 1 : 0.25, transform: sort.key === key && sort.dir === -1 ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.id} onClick={() => onSelect?.(r)}
                className="cursor-pointer transition-colors"
                style={{ borderBottom: '1px solid rgba(var(--fg),0.05)' }}
                onMouseEnter={e => e.currentTarget.style.background = 'rgba(var(--fg),0.04)'}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <td className="pl-3 py-1.5">
                  <div className="w-7 h-7 rounded-md overflow-hidden" style={{ border: '1px solid rgba(var(--fg),0.07)', background: 'rgba(var(--fg),0.04)' }}>
                    {r.coverUrl && <img src={r.coverUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-[13px] font-mono" style={{ color: 'rgba(var(--fg),0.8)', maxWidth: 200 }}>
                  <span className="block truncate">{r.artist || '-'}</span>
                </td>
                <td className="px-3 py-1.5 text-[13px]" style={{ color: 'rgba(var(--fg),0.65)', maxWidth: 240 }}>
                  <span className="block truncate">{r.title || '-'}</span>
                </td>
                <td className="px-3 py-1.5 text-[12px] font-mono whitespace-nowrap" style={{ color: 'rgba(var(--fg),0.5)' }}>{r.catalogNumber || '-'}</td>
                <td className="px-3 py-1.5 text-[12px] font-mono whitespace-nowrap" style={{ color: 'rgba(var(--fg),0.5)' }}>{r.country || '-'}</td>
                <td className="px-3 py-1.5 text-[12px] font-mono whitespace-nowrap" style={{ color: 'rgba(var(--fg),0.5)' }}>{r.year || '-'}</td>
                <td className="px-3 py-1.5 text-[12px] font-mono" style={{ color: 'rgba(var(--fg),0.5)', maxWidth: 180 }}>
                  <span className="block truncate">{r.label || '-'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ----- VinylCarousel ---------------------------------------------------------

// Elastic resistance curve: free movement up to ELASTIC_START, then
// progressively damped so the card feels like it's held by a spring.
const ELASTIC_START   = 55;   // px -- free zone before resistance kicks in
const SNAP_THRESHOLD  = 82;   // px raw drag -- commits the swipe
const VELOCITY_SNAP   = 0.28; // px/ms -- fast flick commits regardless of distance
const SPRING_DECAY    = 0.72; // per-frame multiplier for spring-back animation

function elasticDelta(raw) {
  if (Math.abs(raw) <= ELASTIC_START) return raw;
  const sign = raw < 0 ? -1 : 1;
  const excess = Math.abs(raw) - ELASTIC_START;
  // Diminishing returns: each extra px beyond ELASTIC_START contributes less
  return sign * (ELASTIC_START + excess * 0.28);
}

function VinylCarousel({ records, index, onIndexChange, onPrev, onNext, onSelect, onRemove, accentRGB, crateColors = {}, selectMode = false, selectedIds = new Set(), onToggleSelect, onUpdate, allCrates = [], smartCrateNames = [], crateCounts = {} }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const startXRef    = useRef(null);
  const startTimeRef = useRef(null);
  const rawDeltaRef  = useRef(0);
  const didDragRef   = useRef(false);
  const rafRef       = useRef(null);
  const [visualDelta, setVisualDelta] = useState(0);
  const [showCratePicker, setShowCratePicker] = useState(false);
  const [cratePickerInput, setCratePickerInput] = useState('');

  // Spring-back: animate visualDelta toward 0 with exponential decay
  const springBack = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    let v = visualDelta;
    function step() {
      v *= SPRING_DECAY;
      if (Math.abs(v) < 0.8) { setVisualDelta(0); rafRef.current = null; return; }
      setVisualDelta(v);
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
  }, [visualDelta]);

  const onTouchStart = (e) => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    startXRef.current = e.touches[0].clientX;
    startTimeRef.current = performance.now();
    rawDeltaRef.current = 0;
    didDragRef.current = false;
    setVisualDelta(0);
  };

  const onTouchMove = (e) => {
    if (startXRef.current === null) return;
    const raw = e.touches[0].clientX - startXRef.current;
    if (Math.abs(raw) > 6) didDragRef.current = true;
    if (!didDragRef.current) return;
    rawDeltaRef.current = raw;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setVisualDelta(elasticDelta(raw)));
  };

  const onTouchEnd = (e) => {
    if (startXRef.current === null) return;
    const raw = e.changedTouches[0].clientX - startXRef.current;
    const dt = Math.max(performance.now() - startTimeRef.current, 1);
    const velocity = raw / dt;
    const wasDrag = didDragRef.current;
    startXRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (!wasDrag) { setVisualDelta(0); return; }

    const committed = Math.abs(raw) >= SNAP_THRESHOLD || Math.abs(velocity) >= VELOCITY_SNAP;
    if (committed) {
      setVisualDelta(0);
      if (raw < 0 || velocity < -VELOCITY_SNAP) onNext();
      else onPrev();
    } else {
      // Not far enough -- spring back
      springBack();
    }
  };

  // Close picker when navigating to a different record (must be before early return)
  useEffect(() => { setShowCratePicker(false); }, [index]);

  const current = records[index];
  if (!current) return null;
  const isDragging = visualDelta !== 0;

  return (
    <div className="select-none">
      <div className="relative mx-auto" style={{ height: "min(68vw, 480px)", maxWidth: "min(68vw, 480px)" }}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
        {[-2, -1, 0, 1, 2].map((offset) => {
          const record = records[index + offset];
          if (!record) return null;
          const abs = Math.abs(offset);
          const isActive = offset === 0;
          const tx = (offset + (isDragging ? visualDelta / 280 : 0)) * 48;
          const ty = abs * 11;
          const rot = offset * 2.5 + (isDragging && isActive ? visualDelta * 0.025 : 0);
          const scale = 1 - abs * 0.065;
          const opacity = abs > 2 ? 0 : 1 - abs * 0.15;

          return (
            <div key={record.id} onClick={() => !didDragRef.current && (isActive ? onSelect(record) : onIndexChange(index + offset))}
              style={{ position: "absolute", inset: 0, transform: `translateX(${tx}px) translateY(${ty}px) rotate(${rot}deg) scale(${scale})`, zIndex: 10 - abs, opacity, transition: isDragging ? "none" : "transform 0.22s cubic-bezier(0.25, 1.1, 0.5, 1), opacity 0.15s ease", cursor: "pointer", transformOrigin: "center bottom" }}>
              {/* Glass panel frame */}
              <div style={{
                position: 'relative', width: '100%', height: '100%', borderRadius: 20, padding: 10,
                background: isLight
                  ? (isActive
                    ? `linear-gradient(145deg, rgba(255,255,255,0.96) 0%, rgba(${accentRGB},0.06) 100%)`
                    : `linear-gradient(145deg, rgba(255,255,255,0.88) 0%, rgba(248,246,240,0.82) 100%)`)
                  : (isActive
                    ? `linear-gradient(145deg, rgba(${accentRGB},0.18) 0%, rgba(${accentRGB},0.07) 55%, rgba(var(--fg),0.03) 100%)`
                    : `linear-gradient(145deg, rgba(var(--fg),0.11) 0%, rgba(var(--fg),0.03) 100%)`),
                backdropFilter: `blur(${isActive ? 28 : Math.max(6, 18 - abs * 6)}px)`,
                WebkitBackdropFilter: `blur(${isActive ? 28 : Math.max(6, 18 - abs * 6)}px)`,
                boxShadow: isLight
                  ? (isActive
                    ? `0 20px 60px -12px rgba(0,0,0,0.20), 0 0 30px -5px rgba(${accentRGB},0.15), 0 2px 0 0px rgba(0,0,0,0.10), 0 4px 0 0px rgba(0,0,0,0.06), 0 7px 0 0px rgba(0,0,0,0.03), 0 0 0 1px rgba(0,0,0,0.09), inset 0 1px 0 rgba(255,255,255,1), inset 0 0 30px rgba(${accentRGB},0.03)`
                    : `0 ${10 + abs * 6}px 35px -8px rgba(0,0,0,0.13), 0 2px 0 0px rgba(0,0,0,0.07), 0 4px 0 0px rgba(0,0,0,0.04), 0 0 0 1px rgba(0,0,0,${Math.max(0.05, 0.09 - abs * 0.01)}), inset 0 1px 0 rgba(255,255,255,0.9)`)
                  : (isActive
                    ? `0 36px 64px -22px rgba(0,0,0,0.82), 0 0 60px -10px rgba(${accentRGB},0.24), 0 2px 0 0px rgba(0,0,0,0.7), 0 4px 0 0px rgba(0,0,0,0.42), 0 7px 0 0px rgba(0,0,0,0.2), 0 0 0 1px rgba(var(--fg),0.17), inset 0 1px 0 rgba(var(--fg),0.32), inset 0 0 40px rgba(${accentRGB},0.04)`
                    : `0 ${14 + abs * 9}px 55px -10px rgba(0,0,0,0.82), 0 2px 0 0px rgba(0,0,0,0.58), 0 4px 0 0px rgba(0,0,0,0.32), 0 0 0 1px rgba(var(--fg),${Math.max(0.05, 0.12 - abs * 0.02)}), inset 0 1px 0 rgba(var(--fg),0.16)`),
              }}>
                {/* Album cover inset */}
                <div style={{ width: '100%', height: '100%', borderRadius: 12, overflow: 'hidden', position: 'relative' }}>
                  {record.coverUrl
                    ? <img src={record.coverUrl} alt={record.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.1), rgba(${accentRGB},0.02))` }}>
                        <VinylRecord size={56} weight="thin" className="opacity-20" />
                      </div>
                  }
                  {isActive && <div style={{ position: 'absolute', inset: 0, background: isLight ? "linear-gradient(to top, rgba(0,0,0,0.28) 0%, transparent 45%)" : "linear-gradient(to top, rgba(0,0,0,0.55) 0%, transparent 45%)", pointerEvents: 'none' }} />}
                  {record.vinylColor && record.vinylColor !== 'black' && (
                    <div style={{ position: 'absolute', bottom: 7, right: 7, pointerEvents: 'none' }}>
                      <VinylColorDot colorId={record.vinylColor} size={isActive ? 16 : 11} />
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="mt-11 text-center">
        <div key={current.id} style={{ animation: "fadeOnly 0.12s ease-out" }}>
        <div className="text-[13px] tracking-[0.25em] uppercase text-white/30 mb-1.5 font-mono flex items-center justify-center gap-2">
          <span>{[current.year, current.format, current.country].filter(Boolean).join(" · ")}</span>
          {current.vinylColor && current.vinylColor !== 'black' && <VinylColorDot colorId={current.vinylColor} size={12} />}
        </div>
        <div className="text-xl md:text-2xl leading-tight font-display"><span className="italic">{current.artist}</span></div>
        <div className="text-base md:text-lg text-white/50 font-display mb-3">{current.title}</div>

        {/* Crate badges + edit toggle */}
        <div className="flex flex-wrap justify-center gap-1.5 mb-2">
          {(current.crates || []).map((c) => {
            const col = crateColors[c] || null;
            return (
              <span key={c} className="inline-flex items-center text-[10px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono"
                style={col ? pillGlassStyle(col) : {
                  background: `rgba(${accentRGB},0.10)`,
                  border: `1px solid rgba(${accentRGB},0.22)`,
                  color: 'rgba(var(--fg),0.65)',
                }}>
                {c}
                {(crateCounts[c] || 0) > 0 && (
                  <span style={{ marginLeft: 4, minWidth: 14, height: 14, borderRadius: '50%', background: 'rgba(var(--fg),0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontFamily: 'monospace', lineHeight: 1 }}>
                    {crateCounts[c]}
                  </span>
                )}
              </span>
            );
          })}
          {!selectMode && onUpdate && (
            <button onClick={() => { setShowCratePicker(p => !p); setCratePickerInput(''); }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-mono transition-all"
              style={{ border: `1px solid ${showCratePicker ? 'rgba(var(--fg),0.22)' : 'rgba(var(--fg),0.1)'}`, color: showCratePicker ? 'rgba(var(--fg),0.65)' : 'rgba(var(--fg),0.3)', background: showCratePicker ? 'rgba(var(--fg),0.07)' : 'transparent' }}>
              {showCratePicker ? <X size={9} /> : <Plus size={9} />}
              {showCratePicker ? 'Done' : 'Crates'}
            </button>
          )}
        </div>

        {/* Inline crate picker */}
        {showCratePicker && onUpdate && (() => {
          const recordCrates = current.crates || [];
          const customOther = allCrates.filter(c => !recordCrates.includes(c) && !GENRE_CRATES.includes(c));
          const toggleCrate = (name) => {
            const next = recordCrates.includes(name) ? recordCrates.filter(c => c !== name) : [...recordCrates, name];
            onUpdate(current.id, { crates: next });
          };
          const addCustom = () => {
            const name = cratePickerInput.trim();
            if (!name || recordCrates.includes(name)) { setCratePickerInput(''); return; }
            onUpdate(current.id, { crates: [...recordCrates, name] });
            setCratePickerInput('');
          };
          return (
            <div className="mx-auto max-w-sm mt-1 mb-2 px-4 py-3 rounded-2xl space-y-2.5" style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.08)' }}>
              {/* Selected */}
              {recordCrates.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {recordCrates.map(c => (
                    <button key={c} onClick={() => toggleCrate(c)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-mono transition-all" style={{ background: 'rgba(var(--fg),0.09)', border: '1px solid rgba(var(--fg),0.22)', color: 'rgba(var(--fg),0.85)' }}>
                      <Check size={9} weight="bold" />{c}<X size={8} className="opacity-50 ml-0.5" />
                    </button>
                  ))}
                </div>
              )}
              {/* Crate suggestions */}
              {smartCrateNames.length > 0 ? (
                (() => {
                  const smart = [...smartCrateNames].filter(c => !recordCrates.includes(c)).sort();
                  return smart.length > 0 ? (
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {smart.map(c => (
                        <button key={c} onClick={() => toggleCrate(c)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-mono transition-all hover:border-white/20 hover:text-white/55" style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.32)' }}>
                          <Plus size={9} />{c}
                        </button>
                      ))}
                    </div>
                  ) : null;
                })()
              ) : (
                <>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {GENRE_CRATES.filter(g => !recordCrates.includes(g)).map(g => (
                      <button key={g} onClick={() => toggleCrate(g)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-mono transition-all hover:border-white/20 hover:text-white/55" style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.32)' }}>
                        <Plus size={9} />{g}
                      </button>
                    ))}
                  </div>
                  {customOther.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {customOther.map(c => (
                        <button key={c} onClick={() => toggleCrate(c)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[13px] font-mono transition-all hover:border-white/20 hover:text-white/55" style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.32)' }}>
                          <Plus size={9} />{c}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
              {/* Custom input */}
              <div className="flex gap-2">
                <input value={cratePickerInput} onChange={e => setCratePickerInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()} placeholder="Create a custom crate..." className="flex-1 rounded-full px-3 py-1.5 text-[14px] font-mono text-white/60 placeholder-white/20 outline-none" style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.09)' }} />
                <button onClick={addCustom} className="px-3 py-1.5 rounded-full text-[13px] font-mono transition-all hover:text-white/70" style={{ border: '1px solid rgba(var(--fg),0.10)', color: 'rgba(var(--fg),0.40)', background: 'transparent' }}>Add</button>
              </div>
            </div>
          );
        })()}

        <div className="text-[13px] tracking-[0.18em] uppercase text-white/20 font-mono">{index + 1} of {records.length}</div>
        </div>
      </div>

      {selectMode && current && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => onToggleSelect(current.id)}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-[14px] font-mono transition-all"
            style={{
              background: selectedIds.has(current.id) ? `rgba(${accentRGB},0.18)` : 'rgba(var(--fg),0.05)',
              border: `1px solid ${selectedIds.has(current.id) ? `rgba(${accentRGB},0.45)` : 'rgba(var(--fg),0.12)'}`,
              color: selectedIds.has(current.id) ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.45)',
            }}>
            <Check size={11} weight="bold" />
            {selectedIds.has(current.id) ? 'Selected for batch' : 'Add to batch'}
          </button>
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center justify-center gap-4 mt-5">
        <button onClick={onPrev} disabled={index === 0} className="w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-15" style={{ border: "1px solid rgba(var(--fg),0.10)", background: "rgba(var(--fg),0.03)" }}>
          <CaretLeft size={14} />
        </button>
        {/* Progress dots — click to seek. Capped so the track never overruns the arrows. */}
        {(() => {
          const MAX_DOTS = 30;
          const dotCount = Math.min(records.length, MAX_DOTS);
          // Map the real index onto the (possibly condensed) dot array.
          const activeDot = records.length <= 1 ? 0 : Math.round((index / (records.length - 1)) * (dotCount - 1));
          return (
            <div className="relative flex-1 max-w-[180px] flex items-center justify-between cursor-pointer"
              style={{ height: 16 }}
              onClick={e => {
                const rect = e.currentTarget.getBoundingClientRect();
                const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                onIndexChange(Math.round(ratio * (records.length - 1)));
              }}>
              {Array.from({ length: dotCount }, (_, i) => (
                <div key={i} style={{
                  width: i === activeDot ? 4 : 2,
                  height: i === activeDot ? 4 : 2,
                  borderRadius: '50%',
                  flexShrink: 0,
                  transition: 'all 0.2s',
                  background: i === activeDot
                    ? `rgb(${accentRGB})`
                    : i < activeDot
                      ? 'rgba(var(--fg),0.32)'
                      : 'rgba(var(--fg),0.12)',
                  boxShadow: i === activeDot ? `0 0 0 2px rgba(${accentRGB},0.22)` : 'none',
                }} />
              ))}
            </div>
          );
        })()}
        <button onClick={onNext} disabled={index === records.length - 1} className="w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-15" style={{ border: "1px solid rgba(var(--fg),0.10)", background: "rgba(var(--fg),0.03)" }}>
          <CaretRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ----- RecordCard (grid) -----------------------------------------------------

const GRID_PAGE = 60;

function RecordCard({ record, onSelect, onRemove, accentRGB, selectMode = false, selected = false, onToggleSelect, localOnly = false }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  return (
    <div className="relative group cursor-pointer" onClick={selectMode ? onToggleSelect : onSelect} style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' }}>
      {/* Selection ring is an outline, not another shadow layer: outline follows
          the border radius and leaves .vv-art-shadow to own the drop shadow. */}
      <div className="aspect-square rounded-xl overflow-hidden mb-2 vv-art-shadow"
        style={selected ? { outline: `2px solid rgb(${accentRGB})`, outlineOffset: 0 } : undefined}>
        {record.coverUrl ? (
          <img src={record.coverUrl} alt={record.title} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-400" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.1), rgba(${accentRGB},0.02))` }}>
            <VinylRecord size={28} weight="thin" className="opacity-20" />
          </div>
        )}
        {!selectMode && (
          <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.35)" }}>
            <button onClick={(e) => { e.stopPropagation(); if (window.confirm('Remove this record from your collection?')) onRemove(); }} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500/75 flex items-center justify-center">
              <X size={10} weight="bold" className="text-white" />
            </button>
          </div>
        )}
        {selectMode && (
          <div className="absolute top-2 left-2 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
            style={{ background: selected ? `rgb(${accentRGB})` : 'rgba(0,0,0,0.5)', borderColor: selected ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.4)' }}>
            {selected && <Check size={9} weight="bold" style={{ color: '#000' }} />}
          </div>
        )}
        {localOnly && !selectMode && (
          <div title="Saved locally, not yet synced to database"
            className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center group-hover:opacity-0 transition-opacity"
            style={{ background: 'rgba(251,146,60,0.92)', fontSize: 14, fontWeight: 800, color: '#fff', fontFamily: 'monospace', lineHeight: 1 }}>
            !
          </div>
        )}
      </div>
      <div className="text-[14px] leading-snug font-display truncate text-white/85">{record.artist}</div>
      <div className="text-[13px] text-white/50 truncate font-mono">{record.title}</div>
    </div>
  );
}

// ----- RecordDetailModal -----------------------------------------------------

function RecordDetailModal({ record, onClose, onRemove, onUpdate, accentRGB, accessToken, crateColors = {}, allCrates = [], smartCrateNames = [], crateCounts = {} }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const audioRef = useRef(null);
  const [playingPreview, setPlayingPreview] = useState(null);
  const [imgIdx, setImgIdx] = useState(0);
  // null=not loaded, false=no data, object=loaded. Seeded from the persisted
  // result so a previously checked record shows its graph immediately.
  const [price, setPrice] = useState(record.priceData || null);
  const [priceLoading, setPriceLoading] = useState(false);
  useEffect(() => { setPrice(record.priceData || null); }, [record.id]);
  const [bpmDetecting, setBpmDetecting] = useState(new Set());
  const [localBpms, setLocalBpms] = useState({});
  const [localHots, setLocalHots] = useState(() =>
    Object.fromEntries((record.tracklist || []).map((t, i) => [i, t.hot || false]))
  );
  const [localAccent, setLocalAccent] = useState(accentRGB);
  const [crateInput, setCrateInput] = useState('');
  const [showCrateEditor, setShowCrateEditor] = useState(false);
  const [reidentifying, setReidentifying] = useState(false);
  const [searchArtist, setSearchArtist] = useState(record.artist || '');
  const [searchTitle, setSearchTitle] = useState(record.title || '');
  const [searchCatno, setSearchCatno] = useState(record.catalogNumber || '');
  const [reidentifyLoading, setReidentifyLoading] = useState(false);
  const [reidentifyResults, setReidentifyResults] = useState(null);
  // Holds the id of the candidate being applied (truthy = replacement in
  // flight); drives the per-card "Replacing..." overlay.
  const [reidentifyPicking, setReidentifyPicking] = useState(null);
  // Success feedback for a completed replacement: { prev, name }. `prev` is a
  // full snapshot of the overwritten fields so Undo restores them exactly.
  const [replaced, setReplaced] = useState(null);
  const replacedTimer = useRef(null);
  useEffect(() => { setReplaced(null); clearTimeout(replacedTimer.current); }, [record.id]);
  useEffect(() => () => clearTimeout(replacedTimer.current), []);
  const [reidentifyError, setReidentifyError] = useState(null);
  const [enriching, setEnriching] = useState(false);
  const recordCrates = record.crates || [];
  const genreChips = GENRE_CRATES.filter(g => !recordCrates.includes(g));
  const otherCrates = allCrates.filter(c => !recordCrates.includes(c) && !GENRE_CRATES.includes(c));

  const toggleRecordCrate = (name) => {
    const next = recordCrates.includes(name)
      ? recordCrates.filter(c => c !== name)
      : [...recordCrates, name];
    onUpdate?.(record.id, { crates: next });
  };
  const addNewCrate = () => {
    const name = crateInput.trim();
    if (!name || recordCrates.includes(name)) { setCrateInput(''); return; }
    onUpdate?.(record.id, { crates: [...recordCrates, name] });
    setCrateInput('');
  };

  const bpmTriedRef = useRef(new Set());
  const images = record.images?.length ? record.images : (record.coverUrl ? [record.coverUrl] : []);

  // Start with the saved hero image selected, not always index 0
  useEffect(() => {
    const idx = images.findIndex(s => s === record.coverUrl);
    if (idx > 0) setImgIdx(idx);
  }, [record.id]);

  useEffect(() => {
    const src = images[0] || record.coverUrl;
    if (!src) return;
    extractDominantColor(src).then(({ r, g, b }) => setLocalAccent(`${r},${g},${b}`)).catch(() => {});
  }, [record.coverUrl]);

  useEffect(() => {
    if (record.source !== 'discogs_import' || !record.discogsId || (record.tracklist || []).length > 0) return;
    setEnriching(true);
    fetch(`/api/discogs-release?id=${record.discogsId}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return;
        onUpdate?.(record.id, {
          tracklist: data.tracklist || [],
          country: data.country || record.country || null,
          source: 'discogs',
        });
      })
      .catch(console.error)
      .finally(() => setEnriching(false));
  }, [record.id]);

  useEffect(() => {
    if (!record?.tracklist?.length) return;
    const pending = {};
    let total = 0;

    record.tracklist.forEach((track, i) => {
      if (!track.previewUrl || track.bpm != null || bpmTriedRef.current.has(track.previewUrl)) return;
      bpmTriedRef.current.add(track.previewUrl);
      total++;
      setBpmDetecting(prev => new Set([...prev, i]));

      detectBPM(track.previewUrl, record.genres).then(res => {
        // Only unambiguous readings persist; the Tracks view arbitrates the rest.
        const bpm = (res?.bpm != null && res.alt == null) ? res.bpm : null;
        if (bpm != null) {
          pending[i] = bpm;
          setLocalBpms(prev => ({ ...prev, [i]: bpm }));
        }
        setBpmDetecting(prev => { const s = new Set(prev); s.delete(i); return s; });
        total--;
        if (total === 0 && Object.keys(pending).length > 0 && onUpdate) {
          onUpdate(record.id, {
            tracklist: record.tracklist.map((t, j) => pending[j] != null ? { ...t, bpm: pending[j] } : t),
          });
        }
      });
    });
  }, [record.id]);

  const playPreview = (url) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingPreview === url) { setPlayingPreview(null); return; }
    const audio = new Audio(url);
    audio.preload = 'auto';
    audioRef.current = audio;
    audio.oncanplay = () => { if (audioRef.current === audio) audio.play().catch(() => {}); };
    setPlayingPreview(url);
    audio.onended = () => { setPlayingPreview(null); audioRef.current = null; };
  };
  useEffect(() => () => audioRef.current?.pause(), []);

  const checkPrice = async () => {
    const discogsId = record.discogsId;
    if (!discogsId) return;
    setPriceLoading(true);
    try {
      const res = await fetch(`/api/price?id=${encodeURIComponent(discogsId)}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json();
      const usable = res.ok && (data.conditions?.length || data.floor || data.totalListings) ? data : false;
      setPrice(usable);
      // Persist so the graph shows instantly next time the record is opened.
      if (usable) onUpdate?.(record.id, { priceData: usable, priceCheckedAt: usable.checkedAt || Date.now() });
    } catch {
      setPrice(false);
    }
    setPriceLoading(false);
  };

  const toggleHot = (trackIdx) => {
    const newHot = !localHots[trackIdx];
    setLocalHots(prev => ({ ...prev, [trackIdx]: newHot }));
    if (onUpdate) {
      onUpdate(record.id, {
        tracklist: (record.tracklist || []).map((t, i) => i === trackIdx ? { ...t, hot: newHot } : t),
      });
    }
  };

  const doReidentifySearch = async () => {
    setReidentifyLoading(true);
    setReidentifyResults(null);
    setReidentifyError(null);
    try {
      const res = await fetch('/api/discogs-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: searchArtist, title: searchTitle, catalogNumber: searchCatno }),
      });
      const data = await res.json();
      // Never show a failed search as "no results" (rate limits, hiccups).
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      setReidentifyResults(data.matches || []);
    } catch (err) {
      setReidentifyError(`Search failed: ${err.message || 'connection error'}. Try again in a moment.`);
    }
    setReidentifyLoading(false);
  };

  const pickReidentifyCandidate = async (candidate) => {
    setReidentifyPicking(candidate.id);
    setReidentifyError(null);
    try {
      // freshAccessToken refreshes an expired token (timeout-guarded so it can
      // never hang the picker); a 401 then forces one refresh + retry so an
      // idle-expired token doesn't fail the re-identify.
      const sendReident = (tok) => fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${tok}` },
        body: JSON.stringify({ discogsId: candidate.id }),
        signal: AbortSignal.timeout(50000),
      });
      const reidentToken = await freshAccessToken(accessToken);
      let res = await sendReident(reidentToken);
      if (res.status === 401) {
        const { data } = await Promise.race([
          supabase.auth.refreshSession(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('refresh timeout')), 8000)),
        ]).catch(() => ({ data: null }));
        const refreshed = data?.session?.access_token;
        if (refreshed && refreshed !== reidentToken) res = await sendReident(refreshed);
      }
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      if (!data.release) throw new Error(data.error || 'No release data returned');
      if (onUpdate) {
        const r = data.release;
        // Snapshot every field the replacement overwrites, so the success
        // banner's Undo can restore the previous release exactly (including
        // the old tracklist with its BPM/key data).
        const prev = {
          discogsId: record.discogsId ?? null,
          artist: record.artist, title: record.title,
          label: record.label ?? null, catalogNumber: record.catalogNumber ?? null,
          year: record.year ?? null, country: record.country ?? null,
          format: record.format ?? null,
          genres: record.genres || [], tracklist: record.tracklist || [],
          coverUrl: record.coverUrl || null, images: record.images || [],
          identified: record.identified ?? true,
          confidence: record.confidence || 'high',
          source: record.source || 'discogs',
          notes: record.notes || '',
        };
        onUpdate(record.id, {
          discogsId: r.id || candidate.id,
          artist: r.artist || record.artist,
          title: r.title || record.title,
          label: r.label ?? record.label,
          catalogNumber: r.catalogNumber ?? record.catalogNumber,
          year: r.year ?? record.year,
          country: r.country ?? record.country,
          format: r.format ?? record.format,
          genres: r.genres?.length ? r.genres : record.genres,
          tracklist: r.tracklist?.length ? r.tracklist : record.tracklist,
          coverUrl: r.coverUrl || record.coverUrl,
          images: r.images?.length ? r.images : record.images,
          identified: true,
          confidence: 'high',
          source: r.source || 'discogs',
          notes: r.notes || '',
        });
        if (r.coverUrl) extractDominantColor(r.coverUrl).then(setLocalAccent).catch(() => {});
        setReplaced({
          prev,
          name: [r.artist || record.artist, r.title || record.title].filter(Boolean).join(' — ')
            + (r.year ? ` (${r.year})` : ''),
        });
        clearTimeout(replacedTimer.current);
        replacedTimer.current = setTimeout(() => setReplaced(null), 10000);
      }
      setReidentifying(false);
      setReidentifyResults(null);
    } catch (err) {
      // Keep the panel and results open so the user can retry.
      console.error('[reidentify]', err);
      setReidentifyError(err.name === 'TimeoutError'
        ? 'Timed out pulling release data. Try again.'
        : 'Failed to load release details. Try again.');
    }
    setReidentifyPicking(null);
  };

  // Restore the release exactly as it was before the last re-identify pick.
  const undoReplace = () => {
    if (!replaced) return;
    onUpdate?.(record.id, replaced.prev);
    if (replaced.prev.coverUrl) extractDominantColor(replaced.prev.coverUrl).then(setLocalAccent).catch(() => {});
    clearTimeout(replacedTimer.current);
    setReplaced(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(10px)" }} onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl" style={{ background: "rgba(var(--bg),0.99)", border: "1px solid rgba(var(--fg),0.08)", boxShadow: "0 40px 100px -20px rgba(0,0,0,0.95)" }} onClick={(e) => e.stopPropagation()}>

        {/* Close bar: drag handle + label. Full-width tap target, especially useful on mobile. */}
        <button onClick={onClose} className="w-full flex flex-col items-center gap-1.5 pt-3 pb-3 transition-opacity hover:opacity-70 active:opacity-50" aria-label="Close">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(var(--fg),0.30)" }} />
          <span className="text-[13px] tracking-[0.22em] uppercase font-mono" style={{ color: "rgba(var(--fg),0.45)" }}>Close</span>
        </button>

        <div className="px-6 md:px-8 pb-8">

        {/* grid-cols-1 (minmax(0,1fr)) is load-bearing on mobile: without an
            explicit template the single auto track sizes to its items'
            max-content, and the thumbnail strip contributes its FULL content
            width even though it is overflow-x-auto (8 thumbs = 362px). Fresh
            scans carry big Discogs image galleries, so the track -- and the
            cover above it -- blew out past the viewport; older records with
            fewer images happened to fit. minmax(0,1fr) ignores content size
            entirely; min-w-0 keeps long meta text in check too. */}
        <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-5 mb-6">
          <div className="min-w-0">
            {/* Small spread so the shadow keeps the 12px radius (see .vv-art-shadow). */}
            <div className="aspect-square rounded-xl overflow-hidden mb-2" style={{ boxShadow: `0 2px 5px rgba(0,0,0,0.20), 0 10px 24px -4px rgba(${localAccent},0.35)` }}>
              {images[imgIdx] ? (
                <img src={images[imgIdx]} alt={record.title} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: `rgba(${localAccent},0.07)` }}>
                  <VinylRecord size={28} weight="thin" className="opacity-20" />
                </div>
              )}
            </div>
            {images.length > 0 && (
              <div className="flex gap-1.5 overflow-x-auto">
                {images.map((src, i) => (
                  <button key={i} onClick={() => {
                    setImgIdx(i);
                    if (src !== record.coverUrl && onUpdate) onUpdate(record.id, { coverUrl: src });
                  }} className="relative shrink-0 w-10 h-10 rounded-md overflow-hidden transition-all" style={{ opacity: imgIdx === i ? 1 : 0.45, border: imgIdx === i ? "1px solid rgba(120,220,140,0.70)" : "1px solid rgba(var(--fg),0.08)", boxShadow: imgIdx === i ? "0 0 10px -2px rgba(120,220,140,0.45)" : "none" }}>
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    {imgIdx === i && (
                      <div className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 rounded-full flex items-center justify-center" style={{ background: "rgba(60,190,90,0.95)", border: "1px solid rgba(var(--fg),0.30)" }}>
                        <Check size={7} weight="bold" style={{ color: "#fff" }} />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center min-w-0">
            <div className="text-[13px] tracking-[0.2em] uppercase text-white/45 mb-2 font-mono">{[record.year, record.format, record.country].filter(Boolean).join(" · ")}</div>
            <div className="text-xl leading-tight mb-0.5 font-display"><span className="italic">{record.artist}</span></div>
            <div className="text-base text-white/65 font-display mb-3">{record.title}</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {record.label && <Pill label="Label" value={record.label} />}
              {record.catalogNumber && <Pill label="Cat #" value={record.catalogNumber} mono />}
            </div>
            <div className="flex items-center gap-4 mb-3">
              <ConditionSelect icon={<Mountains size={16} />} value={record.mediaCondition || ''} onChange={v => onUpdate?.(record.id, { mediaCondition: v })} />
              <ConditionSelect icon={<ImageSquare size={16} />} value={record.sleeveCondition || ''} onChange={v => onUpdate?.(record.id, { sleeveCondition: v })} />
              <VinylColorSelect value={record.vinylColor || 'black'} onChange={v => onUpdate?.(record.id, { vinylColor: v })} />
            </div>
            <div>
              <div className="text-[11px] tracking-[0.2em] uppercase text-white/40 font-mono mb-1.5">Crates</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {recordCrates.map((c) => {
                  const col = crateColors[c] || null;
                  return (
                    <button key={c} onClick={() => toggleRecordCrate(c)}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono transition-all hover:opacity-80"
                      style={col ? pillGlassStyle(col) : {
                        background: `rgba(${localAccent},0.10)`,
                        border: `1px solid rgba(${localAccent},0.22)`,
                        color: 'rgba(var(--fg),0.65)',
                      }}>
                      {c}
                      {(crateCounts[c] || 0) > 0 && (
                        <span style={{ minWidth: 14, height: 14, borderRadius: '50%', background: 'rgba(var(--fg),0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontFamily: 'monospace', lineHeight: 1 }}>
                          {crateCounts[c]}
                        </span>
                      )}
                      <X size={9} className="opacity-50 ml-0.5" />
                    </button>
                  );
                })}
                {recordCrates.length === 0 && !showCrateEditor && (
                  <span className="text-[13px] font-mono text-white/25">Not in any crate yet.</span>
                )}
                <button onClick={() => { setShowCrateEditor(p => !p); setCrateInput(''); }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[13px] font-mono transition-all"
                  style={{ border: `1px solid ${showCrateEditor ? 'rgba(var(--fg),0.18)' : 'rgba(var(--fg),0.08)'}`, color: showCrateEditor ? 'rgba(var(--fg),0.55)' : 'rgba(var(--fg),0.28)', background: 'transparent' }}>
                  {showCrateEditor ? <X size={9} /> : <Plus size={9} />}
                  {showCrateEditor ? 'Done' : 'Edit'}
                </button>
              </div>
              {showCrateEditor && (
                <div className="space-y-2 mt-1">
                  {smartCrateNames.length > 0 ? (
                    (() => {
                      const smart = [...smartCrateNames].filter(c => !recordCrates.includes(c)).sort();
                      return smart.length > 0 ? (
                        <div className="flex flex-wrap gap-1.5">
                          {smart.map((c) => (
                            <button key={c} onClick={() => toggleRecordCrate(c)}
                              className="inline-flex items-center gap-1 text-[13px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono transition-all hover:text-white/60 hover:border-white/20"
                              style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.35)' }}>
                              <Plus size={9} />{c}
                            </button>
                          ))}
                        </div>
                      ) : null;
                    })()
                  ) : (
                    <>
                      <div className="flex flex-wrap gap-1.5">
                        {genreChips.map((g) => (
                          <button key={g} onClick={() => toggleRecordCrate(g)}
                            className="inline-flex items-center gap-1 text-[13px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono transition-all hover:text-white/55 hover:border-white/20"
                            style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.32)' }}>
                            <Plus size={9} />{g}
                          </button>
                        ))}
                      </div>
                      {otherCrates.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {otherCrates.map((c) => (
                            <button key={c} onClick={() => toggleRecordCrate(c)}
                              className="inline-flex items-center gap-1 text-[13px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono transition-all hover:text-white/60 hover:border-white/20"
                              style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.35)' }}>
                              <Plus size={10} />{c}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex items-center gap-2">
                    <input value={crateInput} onChange={(e) => setCrateInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addNewCrate()}
                      placeholder="Create a custom crate..."
                      className="flex-1 rounded-full px-3 py-1.5 text-[14px] font-mono text-white/65 placeholder-white/20 outline-none"
                      style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.09)' }} />
                    <button onClick={addNewCrate}
                      className="px-3 py-1.5 rounded-full text-[13px] font-mono transition-all hover:text-white/70"
                      style={{ border: '1px solid rgba(var(--fg),0.10)', color: 'rgba(var(--fg),0.40)', background: 'transparent' }}>
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
            {record.tags && record.tags.length > 0 && (
              <div className="mt-2">
                <div className="text-[11px] tracking-[0.2em] uppercase text-white/40 font-mono mb-1.5">Tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {record.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 text-[13px] px-2.5 py-1 rounded-full font-mono" style={{ background: `rgba(${localAccent},${isLight ? 0.12 : 0.07})`, border: `1px solid rgba(${localAccent},${isLight ? 0.28 : 0.16})`, color: `rgba(${localAccent},${isLight ? 1 : 0.65})` }}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {enriching && (
          <div className="mb-3" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div className="w-3 h-3 rounded-full border border-t-transparent animate-spin" style={{ borderColor: 'rgba(var(--fg),0.3)', borderTopColor: 'transparent' }} />
            <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>Loading tracklist...</span>
          </div>
        )}

        {/* Replacement confirmation: names the new release and offers a full
            Undo (restores the pre-replacement snapshot), which is what makes
            an instant, confirmation-free swap safe. Auto-dismisses. */}
        {replaced && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3 rounded-2xl" style={{ background: '#cafe04', color: '#08080c', animation: 'fadeUp 0.3s ease-out' }}>
            <Check size={16} weight="bold" className="shrink-0" />
            <div className="flex-1 min-w-0 text-[13px] font-mono leading-snug">
              <span style={{ fontWeight: 700 }}>Release replaced.</span> Now filed as {replaced.name}.
            </div>
            <button onClick={undoReplace} className="shrink-0 px-3 py-1.5 rounded-full text-[12px] font-mono font-bold uppercase tracking-[0.08em] transition-all active:scale-95" style={{ background: '#08080c', color: '#cafe04' }}>
              Undo
            </button>
          </div>
        )}

        {/* Re-identify -- promoted: correcting a wrong or draft match is the
            primary fix-up action, so it sits above the fold. Theme-aware via
            .vv-reid-btn (index.css): acid in dark mode, ink/white in light. */}
        <div className="mb-5">
          <button onClick={() => { setReidentifying(p => !p); setReidentifyResults(null); setReidentifyError(null); }}
            data-open={reidentifying ? 'true' : undefined}
            className="vv-reid-btn inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] tracking-[0.12em] uppercase font-mono transition-all active:scale-95">
            <Scan size={11} weight="bold" />
            {reidentifying ? 'Close' : record.identified === false ? 'Identify this record' : 'Re-identify'}
          </button>
          {record.identified === false && !reidentifying && (
            <div className="mt-2 text-[13px] font-mono" style={{ color: 'rgba(var(--fg),0.40)' }}>
              This record is not matched to a release yet -- identify it to pull artwork and tracklist.
            </div>
          )}
        </div>

        {/* Re-identify panel */}
        {reidentifying && (
          <div className="mb-5 p-4 rounded-2xl" style={{ background: 'rgba(var(--fg),0.03)', border: '1px solid rgba(var(--fg),0.08)' }}>
            <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/25 mb-3">Find correct release</div>
            <div className="flex flex-col gap-2 mb-3">
              {[
                { label: 'Artist', val: searchArtist, set: setSearchArtist },
                { label: 'Title', val: searchTitle, set: setSearchTitle },
                { label: 'Cat #', val: searchCatno, set: setSearchCatno },
              ].map(({ label, val, set }) => (
                <div key={label} className="flex items-center gap-2">
                  <span style={{ width: 40, fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.28)', flexShrink: 0 }}>{label}</span>
                  <input value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === 'Enter' && doReidentifySearch()} className="flex-1 rounded-full px-3 py-1.5 text-[14px] font-mono text-white/70 placeholder-white/20 outline-none" style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)' }} />
                </div>
              ))}
            </div>
            <button onClick={doReidentifySearch} disabled={reidentifyLoading} className="vv-search-btn flex items-center gap-2 px-4 py-2 rounded-full text-[14px] font-mono transition-all disabled:opacity-40">
              {reidentifyLoading ? <><div className="w-3 h-3 rounded-full border border-t-transparent animate-spin" style={{ borderColor: `rgba(${localAccent},0.4)`, borderTopColor: 'transparent' }} />Searching...</> : <><MagnifyingGlass size={12} />Search Discogs</>}
            </button>
            {reidentifyError && <div className="mt-2 text-[13px] font-mono text-red-400/70">{reidentifyError}</div>}
            {reidentifyResults !== null && reidentifyResults.length === 0 && !reidentifyLoading && (
              <div className="mt-3 text-[14px] font-mono text-white/30">No results found. Try different search terms.</div>
            )}
            {reidentifyResults && reidentifyResults.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {reidentifyResults.map(c => (
                  <button key={c.id} onClick={() => pickReidentifyCandidate(c)} disabled={!!reidentifyPicking}
                    className="relative text-left p-2.5 rounded-xl text-[13px] transition-all hover:bg-white/5"
                    style={{
                      border: reidentifyPicking === c.id ? '1px solid rgba(202,254,4,0.85)' : '1px solid rgba(var(--fg),0.07)',
                      opacity: reidentifyPicking && reidentifyPicking !== c.id ? 0.35 : 1,
                    }}>
                    {reidentifyPicking === c.id && (
                      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-xl" style={{ background: 'rgba(0,0,0,0.55)' }}>
                        <div className="w-5 h-5 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(202,254,4,0.35)', borderTopColor: '#cafe04' }} />
                        <span className="text-[11px] font-mono uppercase tracking-[0.15em]" style={{ color: '#cafe04' }}>Replacing...</span>
                      </div>
                    )}
                    {c.coverUrl && <img src={c.coverUrl} alt="" loading="lazy" decoding="async" className="w-full aspect-square object-cover rounded-lg mb-1.5 opacity-80" />}
                    <div className="font-mono text-white/60 truncate">{c.artist}</div>
                    <div className="text-white/40 truncate">{c.recordTitle}</div>
                    <div className="text-white/25 font-mono text-[11px] mt-0.5">{[c.catalogNumber, c.year].filter(Boolean).join(' · ')}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {record.tracklist && record.tracklist.length > 0 && (
          <div className="mb-5">
            <div className="text-[13px] tracking-[0.2em] uppercase text-white/40 mb-3 font-mono">Tracklist</div>
            <div className="space-y-0.5">
              {record.tracklist.map((track, i) => (
                <TrackRow key={i} track={{ ...track, bpm: track.bpm ?? localBpms[i] ?? null, hot: localHots[i] ?? track.hot ?? false }} index={i} accentRGB={accentRGB} playingPreview={playingPreview} onPlay={playPreview} bpmLoading={bpmDetecting.has(i)} onHotToggle={toggleHot} />
              ))}
            </div>
          </div>
        )}

        {/* Price check */}
        {record.discogsId && (
          <div className="mb-5">
            {price === null && (
              <button onClick={checkPrice} disabled={priceLoading} className="flex items-center gap-2 px-4 py-2 rounded-full text-[14px] font-mono transition-all disabled:opacity-50" style={{ border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.45)", background: "rgba(var(--fg),0.025)" }}>
                {priceLoading
                  ? <><div className="w-3 h-3 rounded-full border border-t-transparent animate-spin" style={{ borderColor: "rgba(var(--fg),0.3)", borderTopColor: "transparent" }} />Checking prices...</>
                  : <><MagnifyingGlass size={12} />Check marketplace price</>
                }
              </button>
            )}
            {price === false && (
              <div className="text-[14px] font-mono text-white/25">No listings found on Discogs marketplace.</div>
            )}
            {price && typeof price === "object" && (
              <PriceGraph price={price} accentRGB={localAccent} mediaCondition={record.mediaCondition || ''} onRefresh={checkPrice} refreshing={priceLoading} />
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <button onClick={() => { if (window.confirm('Remove this record from your collection?')) onRemove(); }} className="flex items-center gap-2 px-4 py-2 rounded-full text-[14px] font-mono transition-all" style={{ color: "rgba(220,100,100,0.60)", border: "1px solid rgba(220,100,100,0.15)", background: "transparent" }}>
            <Trash size={12} />Remove from collection
          </button>
        </div>
        </div>{/* end px-6 content wrapper */}
      </div>
    </div>
  );
}

// ----- PriceGraph ------------------------------------------------------------

const PRICE_GRAPH_GRADES = ['M', 'NM', 'VG+', 'VG', 'G+', 'G'];
const PRICE_GRADE_NAMES = {
  M: 'Mint', NM: 'Near Mint', 'VG+': 'Very Good Plus',
  VG: 'Very Good', 'G+': 'Good Plus', G: 'Good',
};

// Ordinal colour ramp for the condition bars: the record's accent hue with
// monotone lightness steps (best grade brightest). Both endpoints are anchored
// by construction -- the dark end lifted until it clears 2:1 contrast on the
// surface, the light end pushed toward white until the ramp spans enough
// lightness for visible per-step gaps -- so any album-cover accent yields a
// legible ramp on the dark UI.
function conditionRamp(accentStr, steps = 6) {
  const accent = (accentStr || '150,150,150').split(',').map(n => parseInt(n, 10) || 0);
  const SURFACE = [18, 18, 18];
  const WHITE = [255, 255, 255];
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const relLum = rgb => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const contrast = (a, b) => { const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const okL = rgb => Math.cbrt(relLum(rgb));
  const mix = (a, b, t) => a.map((c, i) => c + (b[i] - c) * t);

  const mx = Math.max(...accent, 1);
  const base = accent.map(c => c * (200 / mx));
  let dark = mix(base, SURFACE, 0.5);
  for (let i = 0; i < 30 && contrast(dark, SURFACE) < 2.15; i++) dark = mix(dark, WHITE, 0.05);
  let light = mix(base, WHITE, 0.5);
  for (let i = 0; i < 30 && okL(light) - okL(dark) < 0.36; i++) light = mix(light, WHITE, 0.08);
  return Array.from({ length: steps }, (_, i) =>
    `rgb(${mix(light, dark, i / (steps - 1)).map(Math.round).join(',')})`);
}

function PriceGraph({ price, accentRGB, mediaCondition, onRefresh, refreshing }) {
  const cur = price.currency || '';
  const fmt = v => `${cur} ${v.toFixed(2)}`.trim();

  const conditions = PRICE_GRAPH_GRADES
    .map(grade => ({ grade, value: (price.conditions || []).find(c => c.grade === grade)?.value }))
    .filter(c => c.value != null);
  const maxValue = conditions.length ? Math.max(...conditions.map(c => c.value)) : 0;
  const ramp = conditionRamp(accentRGB, Math.max(conditions.length, 2));

  // The headline number: the suggestion matching the user's own graded copy,
  // falling back to VG+ (the most common trading grade).
  const ownGrade = conditions.some(c => c.grade === mediaCondition) ? mediaCondition : null;
  const headGrade = ownGrade || (conditions.some(c => c.grade === 'VG+') ? 'VG+' : conditions[0]?.grade);
  const headline = conditions.find(c => c.grade === headGrade);

  const checked = price.checkedAt
    ? new Date(price.checkedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
    : null;
  const sellerHint = /^http_(401|403|404)$/.test(price.suggestionsStatus || '');

  return (
    <div className="rounded-2xl px-4 py-3" style={{ background: 'rgba(var(--fg),0.02)', border: '1px solid rgba(var(--fg),0.07)' }}>
      <div className="flex items-baseline justify-between flex-wrap gap-x-3 gap-y-0.5 mb-3">
        <span className="text-[11px] tracking-[0.25em] uppercase font-mono" style={{ color: 'rgba(var(--fg),0.25)' }}>Marketplace</span>
        <span className="text-[11px] font-mono flex items-baseline gap-2 text-right" style={{ color: 'rgba(var(--fg),0.22)' }}>
          {price.totalListings > 0 && <span>{price.totalListings} for sale{!conditions.length && price.floor ? ` · from ${fmt(price.floor.value)}` : ''}</span>}
          <button onClick={onRefresh} disabled={refreshing} className="underline-offset-2 hover:underline disabled:opacity-40" style={{ color: 'rgba(var(--fg),0.3)' }}>
            {refreshing ? '...' : (checked ? `checked ${checked}` : 'refresh')}
          </button>
        </span>
      </div>

      {conditions.length > 0 ? (
        <>
          {headline && (
            <div className="mb-3">
              <div className="text-[11px] tracking-[0.18em] uppercase font-mono mb-0.5" style={{ color: 'rgba(var(--fg),0.22)' }}>
                {ownGrade ? `Your copy · ${ownGrade}` : `Typical copy · ${headGrade}`}
              </div>
              <div className="text-[20px] font-mono" style={{ color: `rgba(${accentRGB},0.9)` }}>{fmt(headline.value)}</div>
            </div>
          )}
          <div className="flex flex-col gap-[5px]" role="table" aria-label="Suggested price by condition">
            {conditions.map(({ grade, value }, i) => (
              <div key={grade} role="row" className="grid items-center gap-2" style={{ gridTemplateColumns: '36px 1fr 64px' }}
                title={`${PRICE_GRADE_NAMES[grade]} (${grade}) · ${fmt(value)}`}>
                <span role="rowheader" className="text-[11px] font-mono flex items-center gap-1" style={{ color: grade === ownGrade ? 'rgba(var(--fg),0.8)' : 'rgba(var(--fg),0.35)' }}>
                  {grade === ownGrade && <span className="w-[5px] h-[5px] rounded-full shrink-0" style={{ background: `rgb(${accentRGB})` }} />}
                  {grade}
                </span>
                <div className="h-[13px] rounded-r" style={{ background: 'rgba(var(--fg),0.035)' }}>
                  <div className="h-full" style={{
                    width: `${Math.max((value / maxValue) * 100, 3)}%`,
                    background: ramp[i],
                    borderRadius: '1px 4px 4px 1px',
                  }} />
                </div>
                <span role="cell" className="text-[12px] font-mono text-right" style={{ color: grade === ownGrade ? 'rgba(var(--fg),0.8)' : 'rgba(var(--fg),0.45)', fontVariantNumeric: 'tabular-nums' }}>
                  {value.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-2.5 text-[10px] font-mono" style={{ color: 'rgba(var(--fg),0.18)' }}>
            Discogs suggested prices, from this pressing's sales history
          </div>
        </>
      ) : (
        <div className="text-[13px] font-mono leading-relaxed" style={{ color: 'rgba(var(--fg),0.3)' }}>
          {price.totalListings === 0 && (price.floor ? <>Cheapest known listing {fmt(price.floor.value)}. </> : <>No active listings. </>)}
          {sellerHint
            ? 'Per-condition pricing needs seller settings enabled on the Discogs account behind the API token.'
            : 'No per-condition sales history for this pressing yet.'}
        </div>
      )}
    </div>
  );
}

// ----- AccountModal -----------------------------------------------------------

function AccountSection({ label, open, onToggle, children }) {
  return (
    <div style={{ borderBottom: '1px solid rgba(var(--fg),0.07)' }}>
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-3.5 text-left transition-colors"
        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '14px 0' }}>
        <span style={{ fontSize: 13, fontFamily: 'monospace', color: open ? 'rgba(var(--fg),0.75)' : 'rgba(var(--fg),0.4)' }}>{label}</span>
        <CaretRight size={12} style={{ color: 'rgba(var(--fg),0.25)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

// Live per-row status list for the file import: a green tick lands on each
// row as it is saved; drafts and skipped duplicates are labelled inline.
function ImportStatusList({ items, listRef }) {
  const statusIcon = (s) => {
    if (s === 'added') return <Check size={13} weight="bold" style={{ color: 'rgb(74,222,128)' }} />;
    if (s === 'draft') return <Check size={13} weight="bold" style={{ color: 'rgba(240,190,80,0.9)' }} />;
    if (s === 'skipped') return <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)', lineHeight: 1 }}>--</span>;
    if (s === 'searching') return <div className="animate-spin" style={{ width: 11, height: 11, borderRadius: '50%', border: '2px solid rgba(var(--fg),0.12)', borderTopColor: 'rgba(var(--fg),0.5)' }} />;
    return <span style={{ width: 11, height: 11, borderRadius: '50%', border: '1.5px solid rgba(var(--fg),0.12)', display: 'inline-block' }} />;
  };
  return (
    <div ref={listRef} style={{ maxHeight: 210, overflowY: 'auto', borderRadius: 10, border: '1px solid rgba(var(--fg),0.08)', background: 'rgba(var(--fg),0.03)', padding: '7px 12px', marginBottom: 10 }}>
      {items.map((it, i) => (
        <div key={i} data-active={it.status === 'searching' ? '1' : undefined} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '3px 0', minWidth: 0 }}>
          <span style={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{statusIcon(it.status)}</span>
          <span style={{ fontSize: 13, fontFamily: 'monospace', color: it.status === 'skipped' ? 'rgba(var(--fg),0.3)' : 'rgba(var(--fg),0.65)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>
            {it.artist ? `${it.artist} - ${it.title}` : (it.title || '(untitled)')}
          </span>
          {it.status === 'draft' && (
            <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(240,190,80,0.75)', flexShrink: 0 }}>draft</span>
          )}
          {it.status === 'skipped' && (
            <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)', flexShrink: 0 }}>duplicate</span>
          )}
        </div>
      ))}
    </div>
  );
}

function AccountModal({ user, profile, accentRGB, isDark, onToggleTheme, onClose, onSignOut, onUpdateDisplayName, onUpdateProfile, onUpdateAvatar, onViewProfile, onPrintLabels, onDownloadCSV, onAddRecordsBulk, isAdmin, onOpenAdmin, onUpgrade, tier, isPaid, onManageSubscription }) {
  const currentName = user?.user_metadata?.display_name || profile?.display_name || user?.email?.split('@')[0] || '';
  const [displayName, setDisplayName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [openSection, setOpenSection] = useState(null);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingErr, setBillingErr] = useState('');

  async function openBillingPortal() {
    if (billingBusy) return;
    setBillingBusy(true);
    setBillingErr('');
    try {
      await onManageSubscription();
    } catch (e) {
      setBillingErr(e.message || 'Could not open billing. Please try again.');
      setBillingBusy(false);
    }
  }

  const [avatarPreview, setAvatarPreview] = useState(profile?.avatar_url || null);
  const [avatarSavedOk, setAvatarSavedOk] = useState(false);
  const avatarInputRef = useRef(null);

  // Public profile (community) fields
  const [username, setUsername] = useState(
    profile?.username ||
    (profile?.display_name || user?.user_metadata?.display_name || '')
      .toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20)
  );
  const [bio, setBio] = useState(profile?.bio || '');
  const [isPublic, setIsPublic] = useState(!!profile?.is_public);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileSavedOk, setProfileSavedOk] = useState(false);
  const [profileErr, setProfileErr] = useState('');

  const initials = (user?.user_metadata?.display_name || user?.email || '?')[0].toUpperCase();

  // Discogs import state
  const [discogsUser, setDiscogsUser] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importResult, setImportResult] = useState(null);
  const [importError, setImportError] = useState('');
  const cancelImport = useRef(false);

  async function startImport() {
    const uname = discogsUser.trim();
    if (!uname || importing) return;
    cancelImport.current = false;
    setImporting(true);
    setImportError('');
    setImportResult(null);
    setImportProgress({ done: 0, total: 0 });
    let totalAdded = 0, totalSkipped = 0;
    try {
      for (let page = 1; ; page++) {
        if (cancelImport.current) break;
        const res = await fetch(`/api/discogs-import?username=${encodeURIComponent(uname)}&page=${page}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Import failed');
        if (page === 1) setImportProgress({ done: 0, total: data.total });
        const { added, skipped } = await onAddRecordsBulk(data.records);
        totalAdded += added;
        totalSkipped += skipped;
        setImportProgress({ done: Math.min(page * 100, data.total), total: data.total });
        if (page >= data.pages) break;
      }
      if (!cancelImport.current) setImportResult({ added: totalAdded, skipped: totalSkipped });
    } catch (err) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  }

  // File import (CSV / text) state
  const [fileImporting, setFileImporting] = useState(false);
  const [fileProgress, setFileProgress] = useState({ done: 0, total: 0, matched: 0 });
  const [fileResult, setFileResult] = useState(null);
  const [fileError, setFileError] = useState('');
  // Per-row live status: 'pending' | 'searching' | 'added' | 'draft' | 'skipped'
  const [fileItems, setFileItems] = useState([]);
  const cancelFileImport = useRef(false);
  const importFileRef = useRef(null);
  const importListRef = useRef(null);

  // Keep the row currently being processed visible in the scrolling list.
  useEffect(() => {
    const active = importListRef.current?.querySelector('[data-active="1"]');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }, [fileProgress.done]);

  function resetFileImport() {
    setFileResult(null);
    setFileItems([]);
    setFileError('');
  }

  // Resolve each parsed row against Discogs (vinyl-only search) and bulk-add.
  // Maximum-recall policy: a row is NEVER dropped. Best match wins (preferring
  // one with cover art); a row with no match is still added as a draft record
  // (identified: false) carrying the artist/title, which the user fine-tunes
  // via Re-identify in the record detail panel. Matched rows use source
  // 'discogs_import' so the existing lazy enrichment pulls their tracklist on
  // first open.
  async function handleImportFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || fileImporting) return;
    let rows;
    try {
      rows = parseImportRows(await file.text());
    } catch {
      setFileError('Could not read that file.');
      return;
    }
    if (!rows.length) {
      setFileError('No records found. Use CSV columns like artist,title or lines like "Artist - Title".');
      return;
    }
    cancelFileImport.current = false;
    setFileImporting(true);
    setFileError('');
    setFileResult(null);
    setFileItems(rows.map(r => ({ artist: r.artist, title: r.title, status: 'pending' })));
    setFileProgress({ done: 0, total: rows.length, matched: 0 });

    const setItemStatus = (idx, status) => setFileItems(prev => {
      const next = [...prev];
      if (next[idx]) next[idx] = { ...next[idx], status };
      return next;
    });

    let matched = 0, drafts = 0, added = 0, skipped = 0, stopped = false;
    for (let i = 0; i < rows.length; i++) {
      if (cancelFileImport.current) { stopped = true; break; }
      const row = rows[i];
      setItemStatus(i, 'searching');
      let release = null;
      try {
        const res = await fetch('/api/discogs-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ artist: row.artist, title: row.title }),
        });
        const data = await res.json();
        const m = (data.matches || []).find(x => x.coverUrl) || (data.matches || [])[0];
        if (m) {
          matched++;
          release = {
            id: m.id, artist: m.artist || row.artist, title: m.recordTitle || row.title,
            label: m.label, catalogNumber: m.catalogNumber, year: m.year,
            country: m.country, format: m.format, genres: [], tracklist: [],
            coverUrl: m.coverUrl, source: 'discogs_import',
          };
        }
      } catch { /* network hiccup: fall through to draft */ }
      const isDraft = !release;
      if (isDraft) {
        drafts++;
        release = {
          id: null, artist: row.artist, title: row.title || '(untitled)',
          genres: [], tracklist: [], coverUrl: null,
          identified: false, confidence: 'low', source: 'file_import',
        };
      }
      // Add one row at a time so each tick in the list reflects a record that
      // is genuinely saved (and so duplicates are flagged on the right row).
      const res = await onAddRecordsBulk([release]);
      added += res.added;
      skipped += res.skipped;
      setItemStatus(i, res.skipped ? 'skipped' : (isDraft ? 'draft' : 'added'));
      setFileProgress({ done: i + 1, total: rows.length, matched });
      // Pace the Discogs fan-out to stay inside the shared rate limit.
      if (i < rows.length - 1) await new Promise(r => setTimeout(r, 650));
    }
    setFileResult({ added, skipped, matched, drafts, stopped });
    setFileImporting(false);
  }

  function toggleSection(name) {
    setOpenSection(prev => prev === name ? null : name);
  }

  async function handleAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const resized = await resizeAvatar(file);
      setAvatarPreview(resized);
      setAvatarSavedOk(true);
      setTimeout(() => setAvatarSavedOk(false), 3000);
      onUpdateAvatar(resized).catch(err => setErrorMsg(err?.message || 'Photo saved but could not sync.'));
    } catch (err) {
      setErrorMsg(err?.message || 'Could not process photo.');
    }
  }

  function removeAvatar() {
    setAvatarPreview(null);
    onUpdateAvatar(null).catch(err => setErrorMsg(err?.message || 'Could not remove photo.'));
  }

  async function saveDisplayName() {
    const name = displayName.trim();
    if (!name) return;
    setSaving(true);
    setSavedOk(false);
    setErrorMsg('');
    try {
      await onUpdateDisplayName(name);
      setSavedOk(true);
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e) {
      setErrorMsg(e?.message || 'Could not save. Try again.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile() {
    setProfileErr('');
    const uname = username.trim().toLowerCase();
    if (uname && !/^[a-z0-9_]{3,20}$/.test(uname)) {
      setProfileErr('Username: 3-20 chars, lowercase letters, numbers, underscores.');
      return;
    }
    if (isPublic && !uname) {
      setProfileErr('Choose a username before making your collection public.');
      return;
    }
    setProfileSaving(true);
    try {
      await onUpdateProfile({ username: uname || undefined, bio: bio.trim(), isPublic });
      setProfileSavedOk(true);
      setTimeout(() => onClose(), 1600);
    } catch (e) {
      setProfileErr(e?.message || 'Could not save profile.');
    } finally {
      setProfileSaving(false);
    }
  }

  async function sendPasswordReset() {
    try {
      const { supabase } = await import('../lib/supabase.js');
      await supabase.auth.resetPasswordForEmail(user.email, { redirectTo: window.location.origin });
      setResetSent(true);
    } catch (e) {
      setErrorMsg(e?.message || 'Could not send reset email.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
      onClick={onClose}>
      <div className="w-full sm:max-w-sm rounded-t-3xl sm:rounded-3xl p-6"
        style={{ background: 'rgba(var(--bg),0.97)', border: '1px solid rgba(var(--fg),0.10)', backdropFilter: 'blur(32px)', WebkitBackdropFilter: 'blur(32px)', boxShadow: '0 32px 64px rgba(0,0,0,0.5)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between mb-5">
          <h2 style={{ fontSize: 20, fontWeight: 600, color: 'rgba(var(--fg),0.9)' }}>Account</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors"><X size={16} /></button>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center mb-4">
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
          <button
            onClick={() => avatarInputRef.current?.click()}
            className={`relative rounded-full overflow-hidden flex items-center justify-center mb-2 transition-opacity hover:opacity-80${avatarPreview ? '' : ' vv-avatar-fallback'}`}
            style={{
              width: 76, height: 76,
              border: avatarSavedOk ? '2px solid rgba(120,220,140,0.8)' : '2px solid rgba(var(--fg),0.15)',
              ...(avatarPreview ? { background: 'rgba(var(--fg),0.06)' } : {}),
              boxShadow: avatarSavedOk ? '0 0 20px -4px rgba(120,220,140,0.55)' : 'none',
              transition: 'all 0.3s',
            }}>
            {avatarPreview
              ? <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
              : (() => { const SpaceIcon = spaceIconFor(profile || { id: user?.id, email: user?.email }); return <SpaceIcon size={38} weight="regular" />; })()
            }
            {avatarSavedOk && (
              <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(60,190,90,0.98)', border: '2px solid rgba(20,20,28,1)' }}>
                <Check size={9} weight="bold" style={{ color: '#fff' }} />
              </div>
            )}
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => avatarInputRef.current?.click()}
              style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.06em' }}>
              {avatarPreview ? 'Change photo' : 'Upload photo'}
            </button>
            {avatarPreview && (
              <>
                <span style={{ color: 'rgba(var(--fg),0.12)', fontSize: 11 }}>|</span>
                <button onClick={removeAvatar}
                  style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,100,100,0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.06em' }}>
                  Remove
                </button>
              </>
            )}
          </div>
        </div>

        <p style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.22)', marginBottom: 14, textAlign: 'center', letterSpacing: '0.04em' }}>{user.email}</p>

        {errorMsg && <p style={{ fontSize: 13, color: '#fca5a5', marginBottom: 10, fontFamily: 'monospace' }}>{errorMsg}</p>}

        {/* Plan row */}
        <div style={{ borderTop: '1px solid rgba(var(--fg),0.07)', borderBottom: '1px solid rgba(var(--fg),0.07)', paddingTop: 11, paddingBottom: 11, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)' }}>Plan</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)', letterSpacing: '0.06em', textTransform: 'capitalize' }}>{tier || 'Digger'}</span>
            {!isPaid && (
              <button onClick={onUpgrade}
                style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 500, color: 'rgba(var(--fg),0.55)', background: 'transparent', border: '1px solid rgba(var(--fg),0.18)', borderRadius: 20, padding: '3px 10px', cursor: 'pointer', letterSpacing: '0.08em', transition: 'all 0.15s' }}
                onMouseEnter={e => { e.currentTarget.style.color = 'rgba(var(--fg),0.85)'; e.currentTarget.style.borderColor = 'rgba(var(--fg),0.4)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'rgba(var(--fg),0.55)'; e.currentTarget.style.borderColor = 'rgba(var(--fg),0.18)'; }}>
                Upgrade →
              </button>
            )}
          </div>
        </div>

        {/* Accordion sections */}
        <div>

          <AccountSection label="Collector name" open={openSection === 'name'} onToggle={() => toggleSection('name')}>
            <div className="flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setSavedOk(false); setErrorMsg(''); }}
                onKeyDown={e => e.key === 'Enter' && saveDisplayName()}
                placeholder="Your name"
                style={{ flex: 1, padding: '8px 11px', borderRadius: 9, fontSize: 17, color: 'var(--fg-hex)', background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.1)', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.3)'}
                onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
              />
              <button onClick={saveDisplayName} disabled={saving || savedOk}
                style={{
                  padding: '8px 13px', borderRadius: 9, fontSize: 16, fontWeight: 600,
                  color: 'var(--bg-hex)',
                  background: saving ? 'rgba(var(--fg),0.3)' : savedOk ? 'rgba(120,220,140,0.9)' : 'rgba(var(--fg),0.9)',
                  border: 'none',
                  cursor: (saving || savedOk) ? 'default' : 'pointer',
                  minWidth: 48,
                  transition: 'background 0.2s',
                }}>
                {saving ? '...' : savedOk ? <Check size={13} weight="bold" /> : 'Save'}
              </button>
            </div>
          </AccountSection>

          <AccountSection label="Profile" open={openSection === 'profile'} onToggle={() => toggleSection('profile')}>
            <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 12 }}>
              Claim a username and make your collection public so others can browse it, follow you, and react.
            </p>

            <label style={{ display: 'block', fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.4)', marginBottom: 6 }}>Username</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 20, color: 'rgba(var(--fg),0.35)', fontFamily: 'monospace' }}>@</span>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setProfileSavedOk(false); setProfileErr(''); }}
                placeholder="username"
                maxLength={20}
                style={{ flex: 1, padding: '8px 11px', borderRadius: 9, fontSize: 17, color: 'var(--fg-hex)', background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.1)', outline: 'none', fontFamily: 'monospace' }}
                onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.3)'}
                onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
              />
            </div>

            <label style={{ display: 'block', fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.4)', marginBottom: 6 }}>Bio</label>
            <textarea
              value={bio}
              onChange={e => { setBio(e.target.value.slice(0, 160)); setProfileSavedOk(false); setProfileErr(''); }}
              placeholder="A line about your taste, your rig, your scene…"
              rows={2}
              style={{ width: '100%', padding: '8px 11px', borderRadius: 9, fontSize: 17, color: 'var(--fg-hex)', background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.1)', outline: 'none', resize: 'none', marginBottom: 4 }}
              onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.3)'}
              onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
            />
            <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.25)', textAlign: 'right', marginBottom: 12 }}>{bio.length}/160</div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 16, color: isPublic ? 'rgba(120,220,140,0.9)' : 'rgba(var(--fg),0.7)', transition: 'color 0.2s' }}>{isPublic ? 'Public collection' : 'Private collection'}</div>
                <div style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)' }}>{isPublic ? 'Anyone can view your records' : 'Only you can see your records'}</div>
              </div>
              <button
                onClick={() => { setIsPublic(v => !v); setProfileSavedOk(false); setProfileErr(''); }}
                aria-label="Toggle public collection"
                style={{ position: 'relative', width: 44, height: 24, borderRadius: 12, background: isPublic ? 'rgba(120,220,140,0.45)' : 'rgba(var(--fg),0.12)', border: '1px solid rgba(var(--fg),0.15)', cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'background 0.2s' }}>
                <span style={{ position: 'absolute', top: 3, left: isPublic ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', transition: 'left 0.2s cubic-bezier(0.34,1.4,0.64,1)' }} />
              </button>
            </div>

            {profileErr && <p style={{ fontSize: 15, color: '#fca5a5', marginBottom: 10, fontFamily: 'monospace' }}>{profileErr}</p>}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={saveProfile} disabled={profileSaving || profileSavedOk}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 9, fontSize: 16, fontWeight: 600, color: 'var(--bg-hex)', background: profileSaving ? 'rgba(var(--fg),0.3)' : profileSavedOk ? 'rgba(120,220,140,0.9)' : 'rgba(var(--fg),0.9)', border: 'none', cursor: (profileSaving || profileSavedOk) ? 'default' : 'pointer', transition: 'background 0.2s' }}>
                {profileSaving ? 'Saving...' : profileSavedOk ? (<><Check size={13} weight="bold" />Saved!</>) : 'Save profile'}
              </button>
              {!profileSaving && !profileSavedOk && profile?.username && profile?.is_public && (
                <button onClick={() => onViewProfile?.(profile.username)}
                  style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(var(--fg),0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  View my profile →
                </button>
              )}
            </div>
          </AccountSection>

          <AccountSection label="Password" open={openSection === 'password'} onToggle={() => toggleSection('password')}>
            {resetSent ? (
              <p style={{ fontSize: 16, color: '#86efac', fontFamily: 'monospace' }}>Reset link sent to {user.email}</p>
            ) : (
              <button onClick={sendPasswordReset}
                style={{ fontSize: 16, fontFamily: 'monospace', color: 'rgba(var(--fg),0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = 'rgba(var(--fg),0.75)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(var(--fg),0.45)'}>
                Send password reset email
              </button>
            )}
          </AccountSection>

          {isPaid && (
            <AccountSection label="Billing" open={openSection === 'billing'} onToggle={() => toggleSection('billing')}>
              <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 12 }}>
                You're on the <span style={{ color: 'rgba(var(--fg),0.6)', textTransform: 'capitalize' }}>{tier}</span> plan. Manage your subscription on Stripe to change plan, update your payment method, view invoices, or cancel.
              </p>
              {billingErr && <p style={{ fontSize: 15, color: '#fca5a5', marginBottom: 10, fontFamily: 'monospace' }}>{billingErr}</p>}
              <button onClick={openBillingPortal} disabled={billingBusy}
                style={{ fontSize: 16, fontFamily: 'monospace', color: 'rgba(var(--fg),0.45)', background: 'none', border: 'none', cursor: billingBusy ? 'default' : 'pointer', padding: 0 }}
                onMouseEnter={e => { if (!billingBusy) e.currentTarget.style.color = 'rgba(var(--fg),0.75)'; }}
                onMouseLeave={e => { if (!billingBusy) e.currentTarget.style.color = 'rgba(var(--fg),0.45)'; }}>
                {billingBusy ? 'Opening...' : 'Manage billing on Stripe →'}
              </button>
            </AccountSection>
          )}

          <AccountSection label="Export" open={openSection === 'export'} onToggle={() => toggleSection('export')}>
            <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 12 }}>Download your collection as a spreadsheet, or print sleeve labels for selected records.</p>
            <div className="flex flex-wrap gap-2">
              <button onClick={onDownloadCSV}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono transition-all"
                style={{ background: 'rgba(var(--fg),0.07)', border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.6)', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.11)'; e.currentTarget.style.color = 'rgba(var(--fg),0.85)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.07)'; e.currentTarget.style.color = 'rgba(var(--fg),0.6)'; }}>
                <DownloadSimple size={13} />CSV
              </button>
              <button onClick={onPrintLabels}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono transition-all"
                style={{ background: 'rgba(var(--fg),0.07)', border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.6)', cursor: 'pointer' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.11)'; e.currentTarget.style.color = 'rgba(var(--fg),0.85)'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.07)'; e.currentTarget.style.color = 'rgba(var(--fg),0.6)'; }}>
                <Printer size={13} />Labels
              </button>
            </div>
          </AccountSection>

          <AccountSection label="Import from Discogs" open={openSection === 'discogs-import'} onToggle={() => toggleSection('discogs-import')}>
            {!importing && !importResult && (
              <>
                <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 12 }}>
                  Import your Discogs collection directly into Vinyl Vault. Your collection must be set to Public in Discogs Settings.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={discogsUser}
                    onChange={e => { setDiscogsUser(e.target.value); setImportError(''); }}
                    onKeyDown={e => e.key === 'Enter' && startImport()}
                    placeholder="Discogs username"
                    style={{ flex: 1, padding: '8px 11px', borderRadius: 9, fontSize: 17, color: 'var(--fg-hex)', background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.1)', outline: 'none', fontFamily: 'monospace' }}
                    onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.3)'}
                    onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
                  />
                  <button onClick={startImport} disabled={!discogsUser.trim()}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 5,
                      padding: '8px 13px', borderRadius: 9, fontSize: 16, fontWeight: 600,
                      color: 'var(--bg-hex)',
                      background: discogsUser.trim() ? 'rgba(var(--fg),0.9)' : 'rgba(var(--fg),0.3)',
                      border: 'none',
                      cursor: discogsUser.trim() ? 'pointer' : 'default',
                      transition: 'background 0.2s',
                    }}>
                    <CloudArrowDown size={15} />Import
                  </button>
                </div>
                {importError && (
                  <p style={{ fontSize: 14, color: '#fca5a5', fontFamily: 'monospace', marginTop: 10 }}>{importError}</p>
                )}
              </>
            )}
            {importing && (
              <div>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(var(--fg),0.06)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    height: '100%',
                    borderRadius: 3,
                    background: 'rgba(var(--fg),0.35)',
                    width: importProgress.total > 0 ? `${Math.min((importProgress.done / importProgress.total) * 100, 100)}%` : '0%',
                    transition: 'width 0.3s',
                  }} />
                </div>
                <p style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.5)', marginBottom: 10 }}>
                  {importProgress.total > 0 ? `${importProgress.done} / ${importProgress.total} records` : 'Starting...'}
                </p>
                <button
                  onClick={() => { cancelImport.current = true; }}
                  style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Cancel
                </button>
              </div>
            )}
            {!importing && importResult && (
              <div>
                <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(120,220,140,0.9)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Check size={14} weight="bold" />Added {importResult.added} records
                </p>
                {importResult.skipped > 0 && (
                  <p style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 10 }}>
                    {importResult.skipped} duplicates skipped
                  </p>
                )}
                {importError && (
                  <p style={{ fontSize: 14, color: '#fca5a5', fontFamily: 'monospace', marginBottom: 10 }}>{importError}</p>
                )}
                <button
                  onClick={() => { setImportResult(null); setImportError(''); }}
                  style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Import again
                </button>
              </div>
            )}
          </AccountSection>

          <AccountSection label="Import from file" open={openSection === 'file-import'} onToggle={() => toggleSection('file-import')}>
            <input ref={importFileRef} type="file" accept=".csv,.txt,.tsv,text/plain,text/csv,text/tab-separated-values" className="hidden" onChange={handleImportFile} />
            {!fileImporting && !fileResult && (
              <>
                <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', lineHeight: 1.6, marginBottom: 12 }}>
                  Upload a list of records. Each row is matched to the most likely vinyl release; anything unmatched is added as a draft to fine-tune with Re-identify.
                </p>
                <div style={{ borderRadius: 10, background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.08)', padding: '10px 14px', marginBottom: 14 }}>
                  {[['CSV', 'artist,title'], ['Text', 'Artist - Title']].map(([kind, example]) => (
                    <div key={kind} style={{ display: 'flex', alignItems: 'baseline', gap: 12, padding: '3px 0' }}>
                      <span style={{ fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(var(--fg),0.30)', width: 40, flexShrink: 0 }}>{kind}</span>
                      <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(var(--fg),0.65)' }}>{example}</span>
                    </div>
                  ))}
                </div>
                <button onClick={() => importFileRef.current?.click()}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    padding: '8px 13px', borderRadius: 9, fontSize: 16, fontWeight: 600,
                    color: 'var(--bg-hex)', background: 'rgba(var(--fg),0.9)',
                    border: 'none', cursor: 'pointer',
                  }}>
                  <Upload size={15} />Choose file
                </button>
                {fileError && (
                  <p style={{ fontSize: 14, color: '#fca5a5', fontFamily: 'monospace', marginTop: 10 }}>{fileError}</p>
                )}
              </>
            )}
            {fileImporting && (
              <div>
                <div style={{ height: 6, borderRadius: 3, background: 'rgba(var(--fg),0.06)', overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{
                    height: '100%', borderRadius: 3, background: 'rgba(var(--fg),0.35)',
                    width: fileProgress.total > 0 ? `${Math.min((fileProgress.done / fileProgress.total) * 100, 100)}%` : '0%',
                    transition: 'width 0.3s',
                  }} />
                </div>
                <p style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.5)', marginBottom: 8 }}>
                  {fileProgress.done} / {fileProgress.total} · {fileProgress.matched} matched
                </p>
                <ImportStatusList items={fileItems} listRef={importListRef} />
                <button onClick={() => { cancelFileImport.current = true; }}
                  style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Stop here
                </button>
              </div>
            )}
            {!fileImporting && fileResult && (
              <div>
                <p style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(120,220,140,0.9)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Check size={14} weight="bold" />
                  {fileResult.stopped ? `Stopped -- ${fileResult.added} of ${fileProgress.total} added` : `Added ${fileResult.added} record${fileResult.added === 1 ? '' : 's'}`}
                </p>
                {fileResult.drafts > 0 && (
                  <p style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(240,190,80,0.85)', marginBottom: 4 }}>
                    {fileResult.drafts} couldn't be matched -- added as drafts, marked amber below. Open each and use Re-identify to pin the exact release.
                  </p>
                )}
                {fileResult.skipped > 0 && (
                  <p style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 4 }}>
                    {fileResult.skipped} already in your collection -- skipped as duplicates
                  </p>
                )}
                <div style={{ marginTop: 8 }}>
                  <ImportStatusList items={fileItems} listRef={importListRef} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button onClick={() => { resetFileImport(); setOpenSection(null); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 16px', borderRadius: 9, fontSize: 15, fontWeight: 600,
                      color: 'var(--bg-hex)', background: 'rgba(var(--fg),0.9)',
                      border: 'none', cursor: 'pointer',
                    }}>
                    Done
                  </button>
                  <button onClick={() => { resetFileImport(); importFileRef.current?.click(); }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '8px 14px', borderRadius: 9, fontSize: 15,
                      color: 'rgba(var(--fg),0.6)', background: 'rgba(var(--fg),0.05)',
                      border: '1px solid rgba(var(--fg),0.1)', cursor: 'pointer',
                    }}>
                    <Upload size={14} />Import another file
                  </button>
                </div>
              </div>
            )}
          </AccountSection>

          <AccountSection label="About" open={openSection === 'about'} onToggle={() => toggleSection('about')}>
            <div style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(var(--fg),0.45)', lineHeight: 1.6, marginBottom: 14 }}>
              Personal archive for record collectors. Photograph a sleeve, confirm the pressing, file it in crates.
            </div>
            <div style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(var(--fg),0.45)', marginBottom: 10 }}>How it works</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14 }}>
              {[
                { Icon: Camera,      title: 'Photograph', desc: 'Camera or photo library' },
                { Icon: Scan,        title: 'Identify',   desc: 'Matched against Discogs' },
                { Icon: Sparkle,     title: 'Enrich',     desc: 'Tracklist, BPM, Camelot key' },
                { Icon: VinylRecord, title: 'File',       desc: 'Assign to crates, sort later' },
              ].map(({ Icon, title, desc }) => (
                <div key={title} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Icon size={12} style={{ color: `rgba(${accentRGB},0.55)`, flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: 'rgba(var(--fg),0.7)', fontFamily: 'monospace', fontWeight: 600 }}>{title}</span>
                  <span style={{ fontSize: 12, color: 'rgba(var(--fg),0.32)', fontFamily: 'monospace' }}>{desc}</span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', paddingTop: 10, borderTop: '1px solid rgba(var(--fg),0.07)' }}>Stored locally and synced across devices</div>
          </AccountSection>

          {/* Appearance */}
          <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: '1px solid rgba(var(--fg),0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 13, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)' }}>Appearance</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.30)', letterSpacing: '0.08em' }}>{isDark ? 'Dark' : 'Light'}</span>
              <button
                onClick={onToggleTheme}
                aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
                style={{
                  position: 'relative',
                  width: 44,
                  height: 24,
                  borderRadius: 12,
                  background: isDark ? 'rgba(var(--fg),0.10)' : 'rgba(var(--fg),0.20)',
                  border: '1px solid rgba(var(--fg),0.15)',
                  cursor: 'pointer',
                  transition: 'background 0.2s',
                  padding: 0,
                  flexShrink: 0,
                }}>
                <span style={{
                  position: 'absolute',
                  top: 3,
                  left: isDark ? 3 : 21,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  background: 'rgba(var(--fg),0.70)',
                  transition: 'left 0.2s cubic-bezier(0.34,1.4,0.64,1)',
                }} />
              </button>
            </div>
          </div>

        </div>

        <div className="flex items-center justify-center gap-5 mt-5">
          {isAdmin && (
            <button onClick={onOpenAdmin}
              className="inline-flex items-center gap-1.5 transition-all"
              style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(251,191,36,0.55)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.06em' }}
              onMouseEnter={e => { e.currentTarget.style.color = 'rgba(251,191,36,0.9)'; }}
              onMouseLeave={e => { e.currentTarget.style.color = 'rgba(251,191,36,0.55)'; }}>
              <Crown size={11} />Admin panel
            </button>
          )}
          {isAdmin && <span style={{ color: 'rgba(var(--fg),0.12)', fontSize: 12 }}>|</span>}
          <button onClick={onSignOut}
            className="inline-flex items-center gap-1.5 transition-all"
            style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, letterSpacing: '0.06em' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'rgba(239,100,100,0.75)'; }}
            onMouseLeave={e => { e.currentTarget.style.color = 'rgba(var(--fg),0.3)'; }}>
            <SignOut size={11} />Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- CrateManagerModal -----------------------------------------------------

function CrateManagerModal({ crates, onClose, onRename, onDelete, crateColors = {}, onSetColor }) {
  const [editingName, setEditingName] = useState(null);
  const [newName, setNewName] = useState("");

  const commitRename = () => {
    if (newName.trim() && newName.trim() !== editingName) onRename(editingName, newName.trim());
    setEditingName(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-3xl p-6" style={{ background: "rgba(var(--bg),0.99)", border: "1px solid rgba(var(--fg),0.08)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[14px] tracking-[0.3em] uppercase font-mono text-white/60">Crate manager</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center transition-all" style={{ border: "1px solid rgba(var(--fg),0.08)", color: "rgba(var(--fg),0.40)" }}><X size={13} /></button>
        </div>
        {crates.length === 0 && <p className="text-white/30 text-sm font-mono text-center py-4">No crates yet.</p>}
        <div className="space-y-2">
          {crates.map((crate) => {
            const activeColor = crateColors[crate] || null;
            return (
              <div key={crate} className="rounded-xl overflow-hidden" style={{ background: "rgba(var(--fg),0.025)", border: `1px solid ${activeColor ? activeColor + '44' : 'rgba(var(--fg),0.06)'}`, boxShadow: activeColor ? `0 0 16px -6px ${activeColor}55` : 'none' }}>
                <div className="flex items-center gap-2.5 p-3">
                  <RotatingCube color={activeColor || 'rgba(var(--fg),0.35)'} size={10} />
                  {editingName === crate ? (
                    <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingName(null); }} className="flex-1 rounded-lg px-3 py-1 text-[11px] font-mono outline-none" style={{ background: "rgba(var(--fg),0.07)", border: "1px solid rgba(var(--fg),0.14)" }} />
                  ) : (
                    <span className="flex-1 text-[11px] font-mono" style={{ color: 'rgba(var(--fg),0.70)' }}>{crate}</span>
                  )}
                  {editingName === crate ? (
                    <button onClick={commitRename} className="w-7 h-7 rounded-full flex items-center justify-center transition-all text-white/50 hover:text-white/90"><Check size={12} weight="bold" /></button>
                  ) : (
                    <button onClick={() => { setEditingName(crate); setNewName(crate); }} className="w-7 h-7 rounded-full flex items-center justify-center transition-all text-white/25 hover:text-white/60"><PencilSimple size={12} /></button>
                  )}
                  <button onClick={() => { if (window.confirm(`Delete the "${crate}" crate? Records in this crate will not be deleted.`)) onDelete(crate); }} className="w-7 h-7 rounded-full flex items-center justify-center transition-all" style={{ color: "rgba(220,100,100,0.4)" }}><Trash size={12} /></button>
                </div>
                {/* Colour picker — only shown when editing this crate */}
                {editingName === crate && (
                  <div className="flex items-center gap-2 px-3 pb-3 pt-0 flex-wrap">
                    <span className="text-[11px] tracking-[0.18em] uppercase font-mono text-white/20 mr-1">Colour</span>
                    {CRATE_PALETTE.map(({ id, hex }) => {
                      const isActive = activeColor === hex;
                      return (
                        <button key={id} onClick={() => onSetColor(crate, isActive ? null : hex)}
                          title={id}
                          style={{
                            width: 14, height: 14, borderRadius: '50%', flexShrink: 0,
                            background: hex,
                            border: isActive ? '2px solid rgba(var(--fg),0.85)' : '1.5px solid rgba(var(--fg),0.12)',
                            boxShadow: isActive ? `0 0 8px ${hex}` : 'none',
                            transition: 'all 0.15s',
                            transform: isActive ? 'scale(1.2)' : 'scale(1)',
                          }}
                        />
                      );
                    })}
                    {activeColor && (
                      <button onClick={() => onSetColor(crate, null)}
                        className="text-[11px] font-mono tracking-wide ml-1 transition-all"
                        style={{ color: 'rgba(var(--fg),0.22)', borderBottom: '1px solid rgba(var(--fg),0.10)', lineHeight: '1.1' }}>
                        clear
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ----- SmartCratesModal ------------------------------------------------------

function SmartCratesModal({ collection, onUpdate, onClose, crateColors = {}, onSetColor, onApplied }) {
  const [loading, setLoading] = useState(true);
  const [crates, setCrates] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const compact = collection.map(r => ({
      id: r.id,
      artist: r.artist,
      title: r.title,
      year: r.year,
      label: r.label,
      genres: r.genres,
    }));

    // The endpoint requires a signed-in caller, so send a fresh token.
    freshAccessToken(null).then(token => fetch('/api/smart-crates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ records: compact }),
    }))
      .then(async res => {
        // Read as text first: a gateway timeout or an SPA fallback answers with
        // HTML, and calling res.json() on that throws a parse error that reads
        // like a bug rather than "the request did not get through".
        const body = await res.text();
        let data = null;
        try { data = JSON.parse(body); } catch { /* not JSON */ }
        if (!res.ok) {
          if (res.status === 401) throw new Error('Your session expired. Sign out and back in, then try again.');
          if (res.status === 503) throw new Error('The server is busy. Wait a moment and try again.');
          throw new Error(data?.error || (res.status === 504
            ? 'That took too long. Try again, and it will usually work second time.'
            : `Sorting failed (HTTP ${res.status}).`));
        }
        if (!data) throw new Error('The server sent something unreadable. Try again.');
        return data;
      })
      .then(data => {
        // Never trust the shape into render: a non-array here used to take the
        // whole app down with the generic crash screen, because .map is not a
        // function on an object.
        const list = Array.isArray(data.crates) ? data.crates : [];
        setCrates(list.filter(c => c && typeof c.name === 'string').map(c => ({
          name: c.name,
          description: typeof c.description === 'string' ? c.description : '',
          ids: Array.isArray(c.ids) ? c.ids.filter(id => typeof id === 'string') : [],
        })));
        setLoading(false);
      })
      .catch(err => { setError(err.message || 'Sorting failed'); setLoading(false); });
  }, []);

  const apply = () => {
    const updates = {};
    for (const crate of (crates || [])) {
      for (const id of (crate.ids || [])) {
        if (!updates[id]) updates[id] = [];
        updates[id].push(crate.name);
      }
    }
    for (const [id, newCrateNames] of Object.entries(updates)) {
      const record = collection.find(r => r.id === id);
      if (!record) continue;
      const merged = [...new Set([...(record.crates || []), ...newCrateNames])];
      onUpdate(id, { ...record, crates: merged });
    }
    // Distribute palette colors across new crates in order
    if (onSetColor) {
      let colorIdx = 0;
      for (const crate of (crates || [])) {
        if (!crateColors[crate.name]) {
          onSetColor(crate.name, CRATE_PALETTE[colorIdx % CRATE_PALETTE.length].hex);
          colorIdx++;
        }
      }
    }
    onApplied?.((crates || []).map(c => c.name));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(10px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-6 flex flex-col" style={{ background: "rgba(var(--bg),0.99)", border: "1px solid rgba(var(--fg),0.08)", maxHeight: "85vh" }} onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            <Sparkle size={14} style={{ color: "rgba(var(--fg),0.45)" }} />
            <h3 className="text-[14px] tracking-[0.3em] uppercase font-mono" style={{ color: "rgba(var(--fg),0.6)" }}>Smart Crates</h3>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ border: "1px solid rgba(var(--fg),0.08)", color: "rgba(var(--fg),0.40)" }}><X size={13} /></button>
        </div>

        {loading && (
          <div className="flex flex-col items-center justify-center py-14 gap-5">
            <div className="w-10 h-10 rounded-full animate-spin" style={{ border: "2.5px solid rgba(var(--fg),0.07)", borderTopColor: "rgba(var(--fg),0.55)" }} />
            <div className="text-[13px] font-mono tracking-wide" style={{ color: "rgba(var(--fg),0.35)" }}>Sorting your collection...</div>
          </div>
        )}

        {!loading && error && (
          <div className="py-8 text-center">
            <p className="text-sm font-mono" style={{ color: "rgba(220,100,100,0.7)" }}>{error}</p>
          </div>
        )}

        {!loading && crates && (
          <>
            <div className="overflow-y-auto flex-1 space-y-2 pr-0.5" style={{ minHeight: 0 }}>
              {crates.map((crate, i) => (
                <div key={i} className="rounded-xl p-3.5" style={{ background: "rgba(var(--fg),0.03)", border: "1px solid rgba(var(--fg),0.07)" }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[13px] font-mono" style={{ color: "rgba(var(--fg),0.75)" }}>{crate.name}</span>
                    <span className="text-[11px] font-mono px-2 py-0.5 rounded-full" style={{ background: "rgba(var(--fg),0.07)", color: "rgba(var(--fg),0.4)" }}>{(crate.ids || []).length}</span>
                  </div>
                  {crate.description && <p className="text-[12px] leading-snug" style={{ color: "rgba(var(--fg),0.35)" }}>{crate.description}</p>}
                </div>
              ))}
            </div>
            <div className="flex gap-3 mt-5">
              <button onClick={apply} className="flex-1 py-2.5 rounded-2xl text-[13px] font-mono transition-all" style={{ background: "rgba(var(--fg),0.08)", color: "rgba(var(--fg),0.75)", border: "1px solid rgba(var(--fg),0.12)" }}>
                Apply {crates.length} crate{crates.length !== 1 ? "s" : ""}
              </button>
              <button onClick={onClose} className="px-5 py-2.5 rounded-2xl text-[13px] font-mono" style={{ color: "rgba(var(--fg),0.35)", border: "1px solid rgba(var(--fg),0.08)" }}>
                Discard
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ----- CratesTabView ---------------------------------------------------------

function CratesTabView({ collection, allCrates, onUpdate, onRename, onDelete, crateColors, onSetColor, onSmartCratesApplied, smartCrateNames = [], onOpenCrate }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const [showSmartCrates, setShowSmartCrates] = useState(false);
  const [editingName, setEditingName] = useState(null);
  const [newName, setNewName] = useState("");

  const commitRename = () => {
    if (newName.trim() && newName.trim() !== editingName) onRename(editingName, newName.trim());
    setEditingName(null);
  };

  const canScan = collection.length >= 2;

  return (
    <div className="pt-2 max-w-sm">
      {/* Smart Crates */}
      <div className="mb-6 pb-6" style={{ borderBottom: '1px solid rgba(var(--fg),0.07)' }}>
        <div className="flex items-center gap-1.5 mb-2">
          <Sparkle size={12} style={{ color: "rgba(var(--fg),0.45)", flexShrink: 0 }} />
          <span className="text-[11px] tracking-[0.2em] uppercase font-mono" style={{ color: "rgba(var(--fg),0.45)" }}>Smart Crates</span>
        </div>
        <p className="text-[12px] font-mono mb-3" style={{ color: "rgba(var(--fg),0.45)" }}>
          AI sorts your collection into crates by sound, era and scene.
        </p>
        {smartCrateNames.length > 0 && (
          <p className="text-[11px] font-mono mb-3 px-3 py-2 rounded-lg" style={{ color: "rgba(220,160,60,0.85)", background: "rgba(220,160,60,0.08)", border: "1px solid rgba(220,160,60,0.18)" }}>
            You have already scanned your collection. Running again will replace existing smart crates.
          </p>
        )}
        <button
          onClick={() => canScan && setShowSmartCrates(true)}
          disabled={!canScan}
          className="text-[13px] font-mono transition-all px-4 py-2.5 rounded-2xl"
          style={{ border: "none", color: canScan ? "#000" : "rgba(var(--fg),0.25)", background: canScan ? "#C9FF00" : "rgba(var(--fg),0.06)", cursor: canScan ? "pointer" : "not-allowed" }}
          onMouseEnter={e => { if (canScan) e.currentTarget.style.background = '#d8ff33'; }}
          onMouseLeave={e => { if (canScan) e.currentTarget.style.background = canScan ? '#C9FF00' : "rgba(var(--fg),0.06)"; }}
        >
          Scan Collection
        </button>
      </div>

      {/* Crate list */}
      {allCrates.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3">
          <Wrench size={12} style={{ color: "rgba(var(--fg),0.45)", flexShrink: 0 }} />
          <span className="text-[11px] tracking-[0.2em] uppercase font-mono" style={{ color: "rgba(var(--fg),0.45)" }}>Edit Crates</span>
        </div>
      )}
      {allCrates.length === 0 ? (
        <p className="text-[13px] font-mono" style={{ color: "rgba(var(--fg),0.25)" }}>No crates yet. Open a record and assign it to a crate to get started.</p>
      ) : (
        <div className="space-y-2">
          {allCrates.map((crate) => {
            const activeColor = crateColors[crate] || null;
            const crateCount = collection.filter(r => (r.crates || []).includes(crate)).length;
            // In light mode a crate that has been given a colour wears it: the
            // whole lozenge fills with that colour as a gradient. While the row
            // is being edited it drops back to plain, so the colour swatches
            // stay readable against it.
            const filled = isLight && !!activeColor && editingName !== crate;
            const ink = filled ? contrastInk(activeColor) : null;
            const inkFade = (a) => (ink === '#ffffff' ? `rgba(255,255,255,${a})` : `rgba(8,8,12,${a})`);
            return (
              <div key={crate} className={`rounded-xl overflow-hidden${filled ? ' vv-crate-glass' : ''}`}
                style={filled
                  ? { '--crate': activeColor, '--crate-deep': shade(activeColor, 0.26), '--crate-shadow': `${activeColor}88` }
                  : { background: "rgba(var(--fg),0.025)", border: `1px solid ${activeColor ? activeColor + '33' : 'rgba(var(--fg),0.07)'}`, boxShadow: activeColor ? `0 0 20px -6px ${activeColor}66` : 'none' }}>
                <div className="flex items-center gap-3 px-3.5 py-3">
                  {/* Solid colour circle. Redundant once the row itself is the
                      colour, so it steps aside. */}
                  {!filled && (
                    <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: activeColor || 'rgba(var(--fg),0.28)', display: 'inline-block' }} />
                  )}
                  {editingName === crate ? (
                    <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingName(null); }} className="flex-1 rounded-lg px-3 py-1 text-[13px] font-mono outline-none" style={{ background: "rgba(var(--fg),0.07)", border: "1px solid rgba(var(--fg),0.14)" }} />
                  ) : (
                    <div className="flex-1 flex items-baseline gap-2 min-w-0">
                      <span className="text-[13px] font-mono truncate" style={{ color: filled ? ink : 'rgba(var(--fg),0.80)', fontWeight: filled ? 600 : 400 }}>{crate}</span>
                      <span className="text-[11px] font-mono flex-shrink-0" style={{ color: filled ? inkFade(0.6) : 'rgba(var(--fg),0.28)' }}>{crateCount}</span>
                    </div>
                  )}
                  {editingName !== crate && (
                    <button onClick={() => onOpenCrate?.(crate)} title={`Open "${crate}" in Collection`} className="w-8 h-8 rounded-full flex items-center justify-center transition-all" style={{ color: filled ? ink : (activeColor || 'rgba(var(--fg),0.45)') }} onMouseEnter={e => e.currentTarget.style.opacity = '0.7'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}><ArrowUpRight size={14} weight="bold" /></button>
                  )}
                  {editingName === crate ? (
                    <button onClick={commitRename} className="w-8 h-8 rounded-full flex items-center justify-center transition-all" style={{ color: 'rgba(var(--fg),0.55)' }} onMouseEnter={e => e.currentTarget.style.color='rgba(var(--fg),0.9)'} onMouseLeave={e => e.currentTarget.style.color='rgba(var(--fg),0.55)'}><Check size={12} weight="bold" /></button>
                  ) : (
                    <button onClick={() => { setEditingName(crate); setNewName(crate); }} className="w-8 h-8 rounded-full flex items-center justify-center transition-all" style={{ color: filled ? inkFade(0.75) : 'rgba(var(--fg),0.35)' }} onMouseEnter={e => { e.currentTarget.style.color = filled ? ink : 'rgba(var(--fg),0.75)'; }} onMouseLeave={e => { e.currentTarget.style.color = filled ? inkFade(0.75) : 'rgba(var(--fg),0.35)'; }}><PencilSimple size={13} /></button>
                  )}
                  <button onClick={() => { if (window.confirm(`Delete the "${crate}" crate? Records in this crate will not be deleted.`)) onDelete(crate); }} className="w-8 h-8 rounded-full flex items-center justify-center transition-all" style={{ color: filled ? inkFade(0.55) : "rgba(220,100,100,0.35)" }} onMouseEnter={e => { e.currentTarget.style.color = filled ? ink : 'rgba(220,100,100,0.75)'; }} onMouseLeave={e => { e.currentTarget.style.color = filled ? inkFade(0.55) : 'rgba(220,100,100,0.35)'; }}><Trash size={13} /></button>
                </div>
                {editingName === crate && (
                  <div className="flex items-center gap-2 px-3 pb-3 pt-0 flex-wrap">
                    <span className="text-[11px] tracking-[0.18em] uppercase font-mono text-white/20 mr-1">Colour</span>
                    {CRATE_PALETTE.map(({ id, hex }) => {
                      const isActive = activeColor === hex;
                      return (
                        <button key={id} onClick={() => onSetColor(crate, isActive ? null : hex)} title={id}
                          style={{ width: 14, height: 14, borderRadius: '50%', flexShrink: 0, background: hex, border: isActive ? '2px solid rgba(var(--fg),0.85)' : '1.5px solid rgba(var(--fg),0.12)', boxShadow: isActive ? `0 0 8px ${hex}` : 'none', transition: 'all 0.15s', transform: isActive ? 'scale(1.2)' : 'scale(1)' }}
                        />
                      );
                    })}
                    {activeColor && (
                      <button onClick={() => onSetColor(crate, null)} className="text-[11px] font-mono tracking-wide ml-1 transition-all" style={{ color: 'rgba(var(--fg),0.22)', borderBottom: '1px solid rgba(var(--fg),0.10)', lineHeight: '1.1' }}>clear</button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showSmartCrates && <SmartCratesModal collection={collection} onUpdate={onUpdate} onClose={() => setShowSmartCrates(false)} crateColors={crateColors} onSetColor={onSetColor} onApplied={onSmartCratesApplied} />}
    </div>
  );
}

// ----- BatchView -------------------------------------------------------------

function BatchView({ queue, processing, onResolve, onBatch, onStop, accentRGB, onSignOut }) {
  if (queue.length === 0) {
    return (
      <div className="pt-20 flex flex-col items-center text-center max-w-sm mx-auto">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6" style={glassSubtle()}>
          <GridNine size={28} weight="thin" className="opacity-25" />
        </div>
        <h2 className="text-2xl mb-2 font-display"><span className="italic">Batch</span> scan</h2>
        <p className="text-white/35 text-sm mb-6 leading-relaxed">Upload multiple sleeve photos. We scan them in order, auto-save confirmed matches, and pause on disambiguation.</p>
        <label className="cursor-pointer px-5 py-2.5 rounded-full text-sm font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.14)", color: "rgba(var(--fg),0.55)", background: "rgba(var(--fg),0.03)" }}>
          Choose photos
          <input type="file" accept="image/*" multiple onChange={(e) => e.target.files?.length && onBatch(e.target.files)} className="hidden" />
        </label>
      </div>
    );
  }

  const done = queue.filter((i) => i.status === "complete").length;
  const needsReview = queue.filter((i) => i.status === "disambiguation");

  const statusIcon = (s) => {
    if (s === "complete") return <Check size={15} weight="bold" className="text-green-400" />;
    if (s === "error") return <X size={15} weight="bold" className="text-red-400/70" />;
    if (s === "processing") return <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: `rgba(${accentRGB},0.3)`, borderTopColor: `rgb(${accentRGB})` }} />;
    if (s === "disambiguation") return <Sparkle size={15} weight="fill" className="text-yellow-400" />;
    return <div className="w-4 h-4 rounded-full" style={{ border: "1.5px solid rgba(var(--fg),0.15)" }} />;
  };

  return (
    <div className="pt-6 md:pt-10">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-2xl font-display"><span className="italic">Batch</span> progress</h2>
        <span className="text-[14px] font-mono text-white/35">{done}/{queue.length} saved</span>
        {processing && <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: `rgba(${accentRGB},0.25)`, borderTopColor: `rgb(${accentRGB})` }} />}
        {processing && onStop && (
          <button onClick={onStop} className="ml-auto inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full text-[13px] font-mono transition-all hover:opacity-80" style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.5)", background: "rgba(var(--fg),0.03)" }}>
            <X size={11} />Stop
          </button>
        )}
      </div>

      {queue.some((i) => i.status === "error" && /session expired/i.test(i.errorMsg || "")) && (
        <div className="mb-5 p-4 rounded-2xl" style={{ background: "rgba(202,254,4,0.05)", border: "1px solid rgba(202,254,4,0.22)" }}>
          <div className="text-[13px] tracking-[0.2em] uppercase mb-1 font-mono" style={{ color: "rgba(202,254,4,0.7)" }}>Session expired</div>
          <p className="text-sm text-white/40 mb-3">Your login needs a refresh. Sign out, sign straight back in, then rescan the failed items -- everything saved so far is safe.</p>
          <button onClick={onSignOut} className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[13px] font-mono font-semibold transition-all hover:opacity-85" style={{ background: "#cafe04", color: "#08080c", border: "none" }}>
            <SignOut size={12} weight="bold" />Sign out now
          </button>
        </div>
      )}

      {needsReview.length > 0 && (
        <div className="mb-5 p-4 rounded-2xl" style={{ background: "rgba(240,190,80,0.05)", border: "1px solid rgba(240,190,80,0.18)" }}>
          <div className="text-[13px] tracking-[0.2em] uppercase text-yellow-400/60 mb-1 font-mono">{needsReview.length} needing disambiguation</div>
          <p className="text-sm text-white/40">Scroll down to pick the correct pressing for flagged records.</p>
        </div>
      )}

      <div className="space-y-2.5">
        {queue.map((item, idx) => (
          <div key={idx} className="rounded-2xl overflow-hidden" style={glassSubtle()}>
            <div className="flex items-center gap-4 p-4">
              <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0" style={{ border: "1px solid rgba(var(--fg),0.06)" }}>
                {item.imageUrl ? <img src={item.imageUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/[0.03]" />}
              </div>
              <div className="flex-1 min-w-0">
                {item.release ? (
                  <>
                    <div className="text-sm font-display truncate text-white/80">{item.release.artist} — {item.release.title}</div>
                    <div className="text-[13px] text-white/35 font-mono">{item.release.catalogNumber || item.release.label || ""}</div>
                  </>
                ) : item.status === "disambiguation" ? (
                  <div className="text-sm text-yellow-400/70 font-mono">Multiple pressings found</div>
                ) : item.status === "error" ? (
                  <div className="text-sm text-red-400/60 font-mono truncate">{item.errorMsg || "Error"}</div>
                ) : (
                  <div className="text-sm text-white/35 font-mono capitalize">{item.status}</div>
                )}
              </div>
              {statusIcon(item.status)}
            </div>
            {item.status === "disambiguation" && item.candidates && (
              <div className="px-4 pb-4">
                <div className="text-[13px] tracking-[0.2em] uppercase text-white/25 mb-2 font-mono">Pick pressing</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {item.candidates.map((c) => (
                    <button key={c.id} onClick={() => onResolve(idx, c)} className="text-left p-2.5 rounded-xl text-[14px] transition-all hover:bg-white/5" style={{ border: "1px solid rgba(var(--fg),0.07)" }}>
                      <div className="font-mono text-white/65 truncate">{c.artist}</div>
                      <div className="text-white/40 truncate">{c.recordTitle}</div>
                      <div className="text-white/22 font-mono text-[13px]">{c.catalogNumber} {c.year}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ----- StatsView -------------------------------------------------------------

function StatCard({ label, target, suffix = '', ready }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!ready) return;
    let raf;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min((now - start) / 750, 1);
      const eased = 1 - Math.pow(1 - p, 4);
      setVal(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ready]);

  return (
    <div style={{ padding: '14px 18px', borderRadius: 16, background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.09)' }}>
      <div style={{ fontSize: 12, fontFamily: 'monospace', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.35)', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 37, fontFamily: 'monospace', color: 'rgba(var(--fg),0.88)', lineHeight: 1 }}>{val}{suffix}</div>
    </div>
  );
}

function StatsView({ collection, accentRGB }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setReady(true));
    return () => cancelAnimationFrame(id);
  }, []);

  if (collection.length === 0) {
    return (
      <div className="pt-20 flex flex-col items-center text-center max-w-sm mx-auto" style={{ animation: "fadeUp 0.5s ease-out" }}>
        <ChartBar size={36} weight="thin" className="opacity-20 mb-4" />
        <p className="text-white/30 text-sm font-mono">No records yet. Scan something first.</p>
      </div>
    );
  }

  const total = collection.length;
  const allCratesSet = [...new Set(collection.flatMap(r => r.crates || []))];
  const totalCrates = allCratesSet.length;
  const identifiedCount = collection.filter(r => r.identified).length;
  const gradedCount = collection.filter(r => r.mediaCondition || r.sleeveCondition).length;
  const pctIdentified = Math.round(identifiedCount / total * 100);
  const pctGraded = Math.round(gradedCount / total * 100);

  const genreCounts = {};
  collection.forEach(r => (r.genres || []).forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; }));
  const topGenres = Object.entries(genreCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxGenre = topGenres[0]?.[1] || 1;

  const decadeCounts = { '60s': 0, '70s': 0, '80s': 0, '90s': 0, '00s': 0, '10s': 0, '20s': 0 };
  collection.forEach(r => {
    const y = parseInt(r.year);
    if (!y) return;
    if (y < 1970) decadeCounts['60s']++;
    else if (y < 1980) decadeCounts['70s']++;
    else if (y < 1990) decadeCounts['80s']++;
    else if (y < 2000) decadeCounts['90s']++;
    else if (y < 2010) decadeCounts['00s']++;
    else if (y < 2020) decadeCounts['10s']++;
    else decadeCounts['20s']++;
  });
  const maxDecade = Math.max(...Object.values(decadeCounts), 1);

  const labelCounts = {};
  collection.forEach(r => { if (r.label) labelCounts[r.label] = (labelCounts[r.label] || 0) + 1; });
  const topLabels = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const crateSizes = allCratesSet
    .map(c => ({ name: c, count: collection.filter(r => (r.crates || []).includes(c)).length }))
    .sort((a, b) => b.count - a.count);

  const barColors = PALETTE_RGB;

  const barTrack = { flex: 1, position: 'relative', height: 18, borderRadius: 4, background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.08)', overflow: 'hidden' };
  const barFill = (pct, colorIdx = 0, delay = 0) => {
    const c = barColors[colorIdx % barColors.length];
    return {
      position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 4,
      width: ready ? `${pct * 100}%` : '0%',
      transition: `width 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s`,
      background: `linear-gradient(to bottom, rgba(${c},0.85) 0%, rgba(${c},0.55) 55%, rgba(${c},0.45) 100%)`,
      boxShadow: `inset 0 1px 0 rgba(255,255,255,0.28), inset 0 -1px 0 rgba(0,0,0,0.12), 0 1px 4px rgba(${c},0.35)`,
      border: `1px solid rgba(${c},0.30)`,
    };
  };

  return (
    <div className="pt-8 md:pt-12 space-y-5 max-w-2xl" style={{ animation: "fadeUp 0.5s ease-out" }}>
      <div className="text-[13px] tracking-[0.35em] uppercase mb-2 text-white/25 font-mono">Collection Stats</div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Records"    target={total}         suffix=""  ready={ready} />
        <StatCard label="Crates"     target={totalCrates}   suffix=""  ready={ready} />
        <StatCard label="Identified" target={pctIdentified} suffix="%" ready={ready} />
        <StatCard label="Graded"     target={pctGraded}     suffix="%" ready={ready} />
      </div>

      {topGenres.length > 0 && (
        <GlassSection title="Genres" accentRGB={accentRGB}>
          <div className="space-y-2.5">
            {topGenres.map(([genre, count], i) => (
              <div key={genre} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 76, fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.55)', flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{genre}</div>
                <div style={barTrack}>
                  <div style={barFill(count / maxGenre, i, i * 0.04)} />
                </div>
                <div style={{ width: 24, fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', textAlign: 'right', flexShrink: 0 }}>{count}</div>
              </div>
            ))}
          </div>
        </GlassSection>
      )}

      {Object.values(decadeCounts).some(v => v > 0) && (
        <GlassSection title="By Decade" accentRGB={accentRGB}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
            {Object.entries(decadeCounts).map(([decade, count], i) => {
              const c = barColors[i % barColors.length];
              return (
                <div key={decade} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.40)' }}>{count || ''}</div>
                  <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.08)', borderBottom: 'none', position: 'relative', overflow: 'hidden', height: 64 }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '3px 3px 0 0', height: ready ? `${(count / maxDecade) * 100}%` : '0%', transition: `height 0.6s cubic-bezier(0.4,0,0.2,1) ${i * 0.06}s`, background: `linear-gradient(to top, rgba(${c},0.80) 0%, rgba(${c},0.60) 50%, rgba(${c},0.85) 100%)`, boxShadow: `inset 1px 0 0 rgba(255,255,255,0.22), inset -1px 0 0 rgba(0,0,0,0.08), inset 0 2px 0 rgba(255,255,255,0.18), 0 0 8px rgba(${c},0.25)`, border: `1px solid rgba(${c},0.28)`, borderBottom: 'none' }} />
                  </div>
                  <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.28)' }}>{decade}</div>
                </div>
              );
            })}
          </div>
        </GlassSection>
      )}

      {topLabels.length > 0 && (
        <GlassSection title="Top Labels" accentRGB={accentRGB}>
          <div className="space-y-2.5">
            {topLabels.map(([label, count], i) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 76, fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.55)', flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</div>
                <div style={barTrack}>
                  <div style={barFill(count / (topLabels[0]?.[1] || 1), i, i * 0.04)} />
                </div>
                <div style={{ width: 24, fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', textAlign: 'right', flexShrink: 0 }}>{count}</div>
              </div>
            ))}
          </div>
        </GlassSection>
      )}

      {crateSizes.length > 0 && (
        <GlassSection title="Crates" accentRGB={accentRGB}>
          <div className="flex flex-wrap gap-2">
            {crateSizes.map(({ name, count }) => (
              <div key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.10)' }}>
                <span style={{ fontSize: 15, fontFamily: 'monospace', color: 'rgba(var(--fg),0.62)' }}>{name}</span>
                <span style={{ fontSize: 14, fontFamily: 'monospace', color: 'rgba(var(--fg),0.32)' }}>{count}</span>
              </div>
            ))}
          </div>
        </GlassSection>
      )}
    </div>
  );
}

// ----- AboutView -------------------------------------------------------------

// The four onboarding steps. Each is an acid tile with a looping mascot
// animation as the hero (the video's own acid backdrop matches the tile, so
// the frame edge is invisible -- same trick as the splash). Until a clip is
// wired in, the tile shows a big black step icon on acid as a placeholder.
// To add a clip: set `video`/`poster` to the processed asset paths.
const HOW_STEPS = [
  { num: 1, title: 'Photograph', Icon: Camera,      video: null, poster: null, desc: 'Point your camera at the sleeve or label. A single photo is all it takes.' },
  { num: 2, title: 'Identify',   Icon: Scan,        video: null, poster: null, desc: 'The exact pressing is matched against the global record database: label, catalogue number, year, country.' },
  { num: 3, title: 'Enrich',     Icon: Sparkle,     video: null, poster: null, desc: 'Tracklist, BPM, and Camelot key notation are pulled automatically where available.' },
  { num: 4, title: 'File',       Icon: VinylRecord, video: null, poster: null, desc: 'Assign the record to one or more crates, or save it unassigned and sort later.' },
];

function HowStep({ num, title, desc, Icon, video, poster }) {
  // Play the clip only while the tile is on screen (battery/decode friendly).
  const vidRef = useRef(null);
  useEffect(() => {
    const el = vidRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) el.play?.().catch(() => {}); else el.pause?.();
    }, { threshold: 0.3 });
    obs.observe(el);
    return () => obs.disconnect();
  }, [video]);

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: '#cafe04' }}>
      <div className="relative w-full aspect-video">
        {video ? (
          <video ref={vidRef} src={video} poster={poster || undefined} muted loop playsInline preload="none"
            className="w-full h-full object-contain" />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Icon size={58} weight="regular" style={{ color: '#08080c' }} />
          </div>
        )}
        <span className="absolute top-2.5 left-2.5 w-6 h-6 rounded-full flex items-center justify-center font-mono text-[12px] font-bold"
          style={{ background: '#08080c', color: '#cafe04' }}>{num}</span>
      </div>
      <div className="px-4 pt-3 pb-4">
        <div className="text-[15px] font-display mb-1" style={{ color: '#08080c' }}>{title}</div>
        <div className="text-[13.5px] leading-relaxed font-mono" style={{ color: 'rgba(8,8,12,0.72)' }}>{desc}</div>
      </div>
    </div>
  );
}

function AboutView({ accentRGB }) {
  return (
    <div className="pt-8 md:pt-14 max-w-2xl" style={{ animation: "fadeUp 0.5s ease-out" }}>
      <div className="text-[13px] tracking-[0.35em] uppercase mb-5 text-white/25 font-mono">About</div>
      <h2 className="text-4xl md:text-5xl leading-[0.95] mb-8 font-display tracking-tight">
        Built for the crate,<br />
        <span className="text-white/35 italic">not the cloud.</span>
      </h2>

      <div className="space-y-8">
        <div className="space-y-4 text-white/55 leading-relaxed text-[19px]">
          <p>
            Vinyl Vault is a personal archive for record collectors who have more wax than memory. Photograph a sleeve, and within seconds you have the pressing confirmed, the tracklist loaded, BPM and key data attached, and the record filed exactly where you want it.
          </p>
          <p>
            No typing, no cross-referencing, no spreadsheet. When the match is unambiguous, it files automatically. When several pressings exist, you pick the right one. That is the only decision required.
          </p>
          <p>
            The crate system is intentional. Instead of flat tags, Vinyl Vault organises records the way a real DJ would: by feel, era, energy, purpose. Crate names come from the music, not a dropdown. And if the suggestions are not right for how you think, you can name them yourself.
          </p>
        </div>

        <div>
          <div className="text-[13px] tracking-[0.3em] uppercase text-white/30 mb-4 font-mono">How it works</div>
          <div className="grid sm:grid-cols-2 gap-3">
            {HOW_STEPS.map(step => <HowStep key={step.title} {...step} />)}
          </div>
        </div>

        <div className="pt-2 border-t border-white/[0.06] text-[14px] text-white/20 font-mono leading-relaxed">
          Your collection is stored locally and synced to your account across devices.
        </div>
      </div>
    </div>
  );
}

// ----- DisambiguationView ----------------------------------------------------

function DisambiguationView({ candidates, vision, imageUrl, accentRGB, onPick, onManual }) {
  return (
    <div className="pt-8 md:pt-12" style={{ animation: "fadeUp 0.5s ease-out" }}>
      <div className="mb-10">
        <div className="text-[13px] tracking-[0.3em] uppercase text-white/30 mb-4 font-mono">Multiple pressings found</div>
        <h2 className="text-4xl md:text-5xl leading-[1.02] mb-3 font-display tracking-tight"><span className="italic">Pick a pressing</span></h2>
        {vision && (
          <p className="text-white/35 text-sm font-mono">
            Read as: <span className="text-white/60">{vision.artist}{vision.title ? ` — ${vision.title}` : ""}</span>
            {vision.catalogNumber && <span className="text-white/30"> · {vision.catalogNumber}</span>}
          </p>
        )}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {candidates.map((candidate, i) => (
          <CandidateCard key={candidate.id} candidate={candidate} index={i} accentRGB={accentRGB} onPick={onPick} />
        ))}
      </div>
      {onManual && (
        <div className="flex justify-center mt-10">
          <button onClick={onManual} className="inline-flex items-center gap-2 text-[14px] font-mono px-5 py-2.5 rounded-full transition-all hover:opacity-80"
            style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.55)", background: "rgba(var(--fg),0.03)" }}>
            <MagnifyingGlass size={13} />None of these? Search manually
          </button>
        </div>
      )}
    </div>
  );
}

// Single pressing/result card, shared by disambiguation and manual search.
function CandidateCard({ candidate, index = 0, accentRGB, onPick }) {
  return (
    <button onClick={() => onPick(candidate)} className="text-left rounded-2xl overflow-hidden transition-all group relative" style={{ ...glassSubtle(), animation: `fadeUp 0.35s ease-out ${index * 0.06}s both` }}>
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.08), transparent)` }} />
      <div className="relative aspect-square overflow-hidden">
        {candidate.coverUrl ? (
          <img src={candidate.coverUrl} alt={candidate.recordTitle || candidate.artist} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: `rgba(${accentRGB},0.05)` }}><VinylRecord size={40} weight="thin" className="opacity-15" /></div>
        )}
        <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)" }} />
      </div>
      <div className="relative p-4">
        <div className="text-[13px] tracking-[0.18em] uppercase text-white/35 mb-1.5 font-mono">{[candidate.year, candidate.country, candidate.format].filter(Boolean).join(" · ")}</div>
        <div className="text-sm leading-snug mb-2 font-display">
          {candidate.artist && <span className="italic text-white/80">{candidate.artist}</span>}
          {candidate.artist && candidate.recordTitle && <span className="text-white/25"> / </span>}
          <span className="text-white/60">{candidate.recordTitle || candidate.artist}</span>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {candidate.label && <span className="text-[13px] text-white/40 font-mono">{candidate.label}</span>}
          {candidate.catalogNumber && <span className="text-[13px] text-white/25 font-mono">{candidate.catalogNumber}</span>}
        </div>
      </div>
    </button>
  );
}

// Manual fallback when a scan can't be read or none of the pressings match:
// the user types whatever they can read off the label and we search Discogs.
function ManualSearchView({ initial, accentRGB, onPick, onCancel }) {
  const [artist, setArtist] = useState(initial?.artist || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [catno, setCatno] = useState(initial?.catalogNumber || "");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const canSearch = !!(artist.trim() || title.trim() || catno.trim());

  const runSearch = async (e) => {
    e?.preventDefault();
    if (!canSearch || loading) return;
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch('/api/discogs-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: artist.trim(), title: title.trim(), catalogNumber: catno.trim() }),
      });
      const data = await res.json();
      // A failed search must never masquerade as "no matches" -- rate limits
      // and Discogs hiccups were being shown as not-found.
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      setResults(data.matches || []);
    } catch (err) {
      setError(`Search failed: ${err.message}. Try again in a moment.`);
    }
    setLoading(false);
  };

  const fieldStyle = { background: "rgba(var(--fg),0.04)", border: "1px solid rgba(var(--fg),0.10)" };

  return (
    <div className="pt-8 md:pt-12 max-w-2xl mx-auto" style={{ animation: "fadeUp 0.4s ease-out" }}>
      <div className="mb-8">
        <div className="text-[13px] tracking-[0.3em] uppercase text-white/30 mb-4 font-mono">Manual search</div>
        <h2 className="text-4xl md:text-5xl leading-[1.02] mb-3 font-display tracking-tight"><span className="italic">Type what you can read</span></h2>
        <p className="text-white/35 text-sm font-mono">Fill in any field (artist, release title, or catalogue number) and we'll search Discogs.</p>
      </div>

      <form onSubmit={runSearch} className="flex flex-col gap-3 mb-8">
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] tracking-[0.2em] uppercase text-white/35 font-mono">Artist</label>
          <input value={artist} onChange={(e) => setArtist(e.target.value)} placeholder="e.g. Nelly Furtado" autoFocus
            className="w-full rounded-full px-4 py-2.5 text-[15px] font-mono text-white/75 placeholder-white/25 outline-none transition-all" style={fieldStyle} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] tracking-[0.2em] uppercase text-white/35 font-mono">Release / track title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Only Human"
            className="w-full rounded-full px-4 py-2.5 text-[15px] font-mono text-white/75 placeholder-white/25 outline-none transition-all" style={fieldStyle} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[12px] tracking-[0.2em] uppercase text-white/35 font-mono">Catalogue number <span className="text-white/20">(optional)</span></label>
          <input value={catno} onChange={(e) => setCatno(e.target.value)} placeholder="e.g. RACCIDENT 004"
            className="w-full rounded-full px-4 py-2.5 text-[15px] font-mono text-white/75 placeholder-white/25 outline-none transition-all" style={fieldStyle} />
        </div>
        <div className="flex items-center gap-3 mt-2">
          <button type="submit" disabled={!canSearch || loading}
            className="vv-search-btn inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-[14px] tracking-[0.1em] uppercase font-mono transition-all disabled:opacity-40">
            <MagnifyingGlass size={14} weight="bold" />{loading ? "Searching..." : "Search Discogs"}
          </button>
          <button type="button" onClick={onCancel} className="text-[14px] font-mono text-white/35 hover:text-white/60 transition-colors px-3 py-2">
            Cancel
          </button>
        </div>
      </form>

      {error && <p className="text-[14px] font-mono text-red-300/80 mb-6">{error}</p>}

      {results && results.length === 0 && !loading && (
        <p className="text-[14px] font-mono text-white/35">No matches found. Try fewer words, a different spelling, or just the catalogue number.</p>
      )}

      {results && results.length > 0 && (
        <>
          <div className="text-[13px] tracking-[0.2em] uppercase text-white/30 mb-4 font-mono">{results.length} match{results.length !== 1 ? "es" : ""} found. Pick the right one</div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {results.map((candidate, i) => (
              <CandidateCard key={candidate.id} candidate={candidate} index={i} accentRGB={accentRGB} onPick={onPick} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ----- SplashScreen ------------------------------------------------------------
// Acid boot screen: a crate-mascot animation plays and the logo fades up
// while auth and the first data pull happen. The background colour matches
// the videos' own backdrop exactly (rgb 202,253,4) so the frame edge is
// invisible and the animation reads as part of the page.
const SPLASH_ACID = '#cafe04';

// Two mascot animations, alternated on each visit so the boot screen varies.
// The chosen index is advanced in localStorage at module load (once per app
// open), falling back to a fixed clip if storage is unavailable.
// Clips are transparent animated WebP (not video): WebP is sRGB, so there is
// no YUV colour-range shift -- the transparent background lets the page's own
// acid show through, making a colour mismatch impossible. `dur` (seconds) is
// used to hold the splash for one full loop. Bump SPLASH_V when a clip's bytes
// change at the same path, to bust browser/CDN caches.
const SPLASH_V = '4';
const SPLASH_CLIPS = [
  { src: `/splash.webp?v=${SPLASH_V}`, dur: 5 },
  { src: `/splash2.webp?v=${SPLASH_V}`, dur: 5 },
  { src: `/splash4.webp?v=${SPLASH_V}`, dur: 6 },
];

const splashClip = (() => {
  try {
    const next = (parseInt(localStorage.getItem('vv_splash_i') || '0', 10) || 0) % SPLASH_CLIPS.length;
    localStorage.setItem('vv_splash_i', String((next + 1) % SPLASH_CLIPS.length));
    return SPLASH_CLIPS[next];
  } catch {
    return SPLASH_CLIPS[0];
  }
})();

function SplashScreen() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-2 overflow-hidden" style={{ background: SPLASH_ACID }}>
      <img
        src="/logo-black.png"
        alt="Vinyl Vault"
        className="w-[54vw] max-w-[300px]"
        style={{ animation: 'splashFadeUp 1.1s ease-out 0.35s both' }}
      />
      <img
        src={splashClip.src}
        alt=""
        className="w-[98vw] max-w-[620px]"
        style={{ animation: 'splashFadeUp 0.7s ease-out both' }}
      />
      <div
        className="flex items-center gap-2 px-4 py-2 rounded-full mt-4"
        style={{
          background: 'rgba(0,0,0,0.06)',
          border: '1px solid rgba(0,0,0,0.14)',
          backdropFilter: 'blur(14px) saturate(160%)',
          WebkitBackdropFilter: 'blur(14px) saturate(160%)',
          boxShadow: '0 8px 24px -12px rgba(0,0,0,0.25)',
          animation: 'splashFadeUp 0.9s ease-out 0.6s both',
        }}
      >
        <div className="w-3 h-3 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(0,0,0,0.15)', borderTopColor: 'rgba(0,0,0,0.65)' }} />
        <span className="font-mono text-[11px] tracking-[0.22em] uppercase" style={{ color: 'rgba(0,0,0,0.75)' }}>Connecting...</span>
      </div>
    </div>
  );
}

// ----- Shared components -----------------------------------------------------

// ----- PredictiveSearch -----------------------------------------------------

function PredictiveSearch({ value, onChange, collection, accentRGB }) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const q = value.toLowerCase().trim();

  const suggestions = q.length < 1 ? [] : (() => {
    const seen = new Set();
    const results = [];
    const add = (label, text) => {
      const key = `${label}:${text}`;
      if (!seen.has(key) && text.toLowerCase().includes(q)) { seen.add(key); results.push({ label, text }); }
    };
    // Artists and titles first (most likely search targets), then label/catno
    for (const r of collection) {
      add("Artist", r.artist);
      add("Title", r.title);
    }
    for (const r of collection) {
      if (r.label) add("Label", r.label);
      if (r.catalogNumber) add("Cat #", r.catalogNumber);
    }
    // Starts-with matches bubble to top
    results.sort((a, b) => {
      const aStarts = a.text.toLowerCase().startsWith(q) ? 0 : 1;
      const bStarts = b.text.toLowerCase().startsWith(q) ? 0 : 1;
      return aStarts - bStarts;
    });
    return results.slice(0, 8);
  })();

  const pick = (text) => { onChange(text); setOpen(false); inputRef.current?.blur(); };

  const handleKey = (e) => {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setHighlighted((h) => Math.min(h + 1, suggestions.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHighlighted((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(suggestions[highlighted].text); }
    else if (e.key === "Escape") { setOpen(false); }
  };

  useEffect(() => { setHighlighted(0); }, [suggestions.length]);

  return (
    <div className="relative">
      <MagnifyingGlass size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45 pointer-events-none z-10" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={handleKey}
        placeholder="Search artist, title, label, cat #..."
        className="w-full rounded-full pl-8 pr-4 py-2 text-[15px] font-mono text-white/65 placeholder-white/30 outline-none transition-all"
        style={{ background: "rgba(var(--fg),0.04)", border: open && suggestions.length > 0 ? `1px solid rgba(${accentRGB},0.3)` : "1px solid rgba(var(--fg),0.08)" }}
      />
      {value && (
        <button onClick={() => { onChange(""); setOpen(false); inputRef.current?.focus(); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/60 transition-colors">
          <X size={11} />
        </button>
      )}
      {open && suggestions.length > 0 && (
        <div ref={listRef} className="absolute top-full left-0 right-0 mt-1.5 rounded-2xl overflow-hidden z-30" style={{ background: "rgba(var(--bg),0.98)", border: "1px solid rgba(var(--fg),0.09)", boxShadow: "0 20px 50px -10px rgba(0,0,0,0.8)" }}>
          {suggestions.map((s, i) => (
            <button key={i} onMouseDown={() => pick(s.text)} className="w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all"
              style={{ background: i === highlighted ? `rgba(${accentRGB},0.10)` : "transparent" }}
              onMouseEnter={() => setHighlighted(i)}>
              <span className="text-[11px] tracking-[0.18em] uppercase font-mono shrink-0" style={{ color: `rgba(${accentRGB},0.55)`, minWidth: 36 }}>{s.label}</span>
              <span className="text-[15px] font-mono text-white/70 truncate">{s.text}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ----- TracksView (group/filter individual tracks by BPM) --------------------

const BPM_SLIDER_MIN = 60;
const BPM_SLIDER_MAX = 200;
const BPM_BUCKET = 5;

function TracksView({ collection, accentRGB, onUpdate, accessToken }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(null);
  const [search, setSearch] = useState('');
  const [range, setRange] = useState(null); // null = follow data bounds until touched
  const [crateFilter, setCrateFilter] = useState(null);
  const [crateMenuOpen, setCrateMenuOpen] = useState(false);
  const [showUnanalyzed, setShowUnanalyzed] = useState(false);
  const [detecting, setDetecting] = useState(() => new Set()); // previewUrls in flight
  const triedRef = useRef(new Set());
  const mountedRef = useRef(true);

  // Live mirrors so the detection pump and persist read fresh state without
  // becoming effect dependencies (which would restart the pump on every save
  // or token refresh).
  const collectionRef = useRef(collection);
  collectionRef.current = collection;
  const tokenRef = useRef(accessToken);
  tokenRef.current = accessToken;

  useEffect(() => () => { mountedRef.current = false; }, []);

  // Flatten every track, carrying its parent record's cover/artist/title/crates.
  const allTracks = useMemo(() => {
    const out = [];
    for (const rec of collection) {
      (rec.tracklist || []).forEach((t, i) => {
        if (!t || (!t.title && !t.position)) return;
        out.push({
          uid: `${rec.id}:${i}`,
          recordId: rec.id,
          trackIndex: i,
          artist: rec.artist || '',
          recordTitle: rec.title || '',
          coverUrl: rec.coverUrl || null,
          title: t.title || `Track ${i + 1}`,
          position: t.position || '',
          bpm: typeof t.bpm === 'number' ? t.bpm : null,
          bpmConfidence: t.bpmConfidence || null,
          key: t.key || null,
          previewUrl: t.previewUrl || null,
          duration: t.duration || null,
          crates: rec.crates || [],
        });
      });
    }
    return out;
  }, [collection]);

  // Persist a detected BPM back into the record's tracklist (idempotent).
  const persistBpm = useCallback((recordId, trackIndex, bpm, source = 'waveform') => {
    const rec = collectionRef.current.find(r => r.id === recordId);
    if (!rec) return;
    const next = (rec.tracklist || []).map((t, i) => i === trackIndex ? { ...t, bpm, bpmSource: source } : t);
    onUpdate?.(recordId, { tracklist: next });
  }, [onUpdate]);


  // Waveform BPM detection: runs when TracksView mounts, processes every track
  // that has a previewUrl but no BPM yet. Each URL is tried once per session.
  // Unambiguous readings persist immediately; octave-ambiguous ones (87 vs 174)
  // are batched to the arbiter afterwards. Everything resolved is reported to
  // the shared community cache.
  useEffect(() => {
    let active = true;

    const runWaveformPass = async () => {
      const CONCURRENCY = 2;
      const nextJob = () => {
        for (const rec of collectionRef.current) {
          const tl = rec.tracklist || [];
          for (let i = 0; i < tl.length; i++) {
            const t = tl[i];
            if (t?.previewUrl && t.bpm == null && !triedRef.current.has(t.previewUrl)) {
              return {
                recordId: rec.id, trackIndex: i, previewUrl: t.previewUrl,
                genres: rec.genres || [], artist: rec.artist || '',
                title: t.title || '', duration: t.duration || null, year: rec.year || null,
              };
            }
          }
        }
        return null;
      };

      const ambiguous = [];
      const resolved = [];

      const worker = async () => {
        while (active) {
          const job = nextJob();
          if (!job) return;
          triedRef.current.add(job.previewUrl);
          if (mountedRef.current) setDetecting(prev => new Set(prev).add(job.previewUrl));
          let res = null;
          try { res = await detectBPM(job.previewUrl, job.genres); } catch { /* ignore */ }
          if (res?.bpm != null) {
            if (res.alt == null) {
              persistBpm(job.recordId, job.trackIndex, res.bpm);
              resolved.push({ artist: job.artist, title: job.title, duration: job.duration, bpm: res.bpm, source: 'waveform' });
            } else {
              ambiguous.push({ ...job, options: [res.bpm, res.alt] });
            }
          }
          if (mountedRef.current) setDetecting(prev => { const s = new Set(prev); s.delete(job.previewUrl); return s; });
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));

      for (let i = 0; i < ambiguous.length && active; i += 20) {
        const batch = ambiguous.slice(i, i + 20);
        const choices = await arbitrateOctaves(batch, tokenRef.current);
        batch.forEach((job, j) => {
          const bpm = choices?.[j];
          if (bpm != null) {
            persistBpm(job.recordId, job.trackIndex, bpm, 'waveform+arbiter');
            resolved.push({ artist: job.artist, title: job.title, duration: job.duration, bpm, source: 'waveform+arbiter' });
          }
        });
      }

      for (let i = 0; i < resolved.length; i += 40) {
        reportBpmsToCache(resolved.slice(i, i + 40), tokenRef.current);
      }
    };

    runWaveformPass();

    return () => { active = false; };
  }, [persistBpm]);

  useEffect(() => () => audioRef.current?.pause(), []);

  const play = (url) => {
    if (!url) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playing === url) { setPlaying(null); return; }
    const a = new Audio(url);
    a.preload = 'auto';
    audioRef.current = a;
    a.oncanplay = () => { if (audioRef.current === a) a.play().catch(() => {}); };
    setPlaying(url);
    a.onended = () => { setPlaying(null); audioRef.current = null; };
  };

  // Data-driven default slider bounds (snap out to nearest bucket).
  const analyzedBpms = useMemo(() => allTracks.map(t => t.bpm).filter(b => b != null), [allTracks]);
  const dataLo = analyzedBpms.length ? Math.max(BPM_SLIDER_MIN, Math.floor(Math.min(...analyzedBpms) / BPM_BUCKET) * BPM_BUCKET) : 110;
  const dataHi = analyzedBpms.length ? Math.min(BPM_SLIDER_MAX, Math.ceil(Math.max(...analyzedBpms) / BPM_BUCKET) * BPM_BUCKET) : 150;
  const selMin = range ? range[0] : dataLo;
  const selMax = range ? range[1] : dataHi;

  const allCrates = useMemo(() => [...new Set(collection.flatMap(r => r.crates || []))].sort(), [collection]);
  const crateTrackCounts = useMemo(() => {
    const counts = {};
    for (const t of allTracks) for (const c of t.crates) counts[c] = (counts[c] || 0) + 1;
    return counts;
  }, [allTracks]);

  const q = search.trim().toLowerCase();
  const matchesSearch = (t) =>
    !q || t.artist.toLowerCase().includes(q) || t.title.toLowerCase().includes(q) || t.recordTitle.toLowerCase().includes(q);
  const matchesCrate = (t) => !crateFilter || t.crates.includes(crateFilter);

  const analyzed = useMemo(
    () => allTracks.filter(t => t.bpm != null && matchesSearch(t) && matchesCrate(t)).sort((a, b) => a.bpm - b.bpm || a.artist.localeCompare(b.artist)),
    [allTracks, q, crateFilter],
  );
  const visible = analyzed.filter(t => t.bpm >= selMin && t.bpm <= selMax);
  const unanalyzed = useMemo(() => allTracks.filter(t => t.bpm == null && matchesSearch(t) && matchesCrate(t)), [allTracks, q, crateFilter]);

  // Histogram: counts per 5-BPM bucket across the slider range.
  const histogram = useMemo(() => {
    const buckets = {};
    for (const t of analyzed) {
      const b = Math.floor(t.bpm / BPM_BUCKET) * BPM_BUCKET;
      buckets[b] = (buckets[b] || 0) + 1;
    }
    const bars = [];
    for (let b = BPM_SLIDER_MIN; b < BPM_SLIDER_MAX; b += BPM_BUCKET) bars.push({ low: b, count: buckets[b] || 0 });
    const max = bars.reduce((m, x) => Math.max(m, x.count), 0) || 1;
    return { bars, max };
  }, [analyzed]);

  const detectingCount = detecting.size;

  if (allTracks.length === 0) {
    return (
      <div className="px-5 md:px-10 py-20 text-center">
        <MusicNotes size={32} weight="thin" className="mx-auto mb-3 opacity-30" />
        <div className="text-white/40 text-sm font-mono">No tracks yet. Scan some records to build your track pool.</div>
      </div>
    );
  }

  // Render the analyzed list with a small divider whenever the 5-BPM band changes.
  const rows = [];
  let lastBand = null;
  for (const t of visible) {
    const band = Math.floor(t.bpm / BPM_BUCKET) * BPM_BUCKET;
    if (band !== lastBand) {
      lastBand = band;
      const count = visible.filter(x => Math.floor(x.bpm / BPM_BUCKET) * BPM_BUCKET === band).length;
      rows.push(
        <div key={`band-${band}`} className="flex items-baseline gap-2 px-1 pt-5 pb-1.5 sticky top-0 z-10" style={{ background: 'linear-gradient(to bottom, var(--bg-hex) 60%, transparent)' }}>
          <span className="text-[20px] font-display" style={{ color: `rgb(${accentRGB})` }}>{band}–{band + BPM_BUCKET - 1}</span>
          <span className="text-[12px] tracking-[0.18em] uppercase font-mono text-white/35">BPM · {count}</span>
        </div>
      );
    }
    rows.push(<TrackBpmRow key={t.uid} t={t} accentRGB={accentRGB} playing={playing} onPlay={play} detecting={detecting.has(t.previewUrl)} />);
  }

  return (
    <div className="px-4 md:px-10 py-5 max-w-4xl mx-auto">
      {/* Header stats */}
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Waveform size={20} weight="duotone" style={{ color: `rgb(${accentRGB})` }} />
          <h2 className="text-[15px] tracking-[0.18em] uppercase font-mono text-white/70">Tracks by BPM</h2>
        </div>
        <div className="text-[12px] tracking-[0.12em] uppercase font-mono text-white/35">
          {analyzed.length} analyzed · {unanalyzed.length} pending
          {detectingCount > 0 && <span style={{ color: `rgb(${accentRGB})` }}> · detecting {detectingCount}</span>}
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <MagnifyingGlass size={15} className="absolute left-3 top-1/2 -translate-y-1/2 opacity-40" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter by artist, track, or release"
          className="w-full pl-9 pr-3 py-2.5 rounded-xl text-[14px] font-mono outline-none"
          style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.85)' }}
        />
      </div>

      {/* Histogram + dual-thumb BPM range slider */}
      <div className="mb-5 rounded-2xl p-4" style={{ background: 'rgba(var(--fg),0.025)', border: '1px solid rgba(var(--fg),0.07)' }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-mono text-white/60">{selMin}–{selMax} BPM</span>
          {range && (
            <button onClick={() => setRange(null)} className="text-[11px] tracking-[0.14em] uppercase font-mono text-white/40 hover:text-white/70 transition-colors">Reset</button>
          )}
        </div>

        {/* Histogram bars (tap a bar to snap the range to that band) */}
        <div className="flex items-end gap-[2px] h-16 mb-1">
          {histogram.bars.map(({ low, count }) => {
            const inRange = low >= selMin && low < selMax;
            return (
              <button
                key={low}
                onClick={() => setRange([low, Math.min(BPM_SLIDER_MAX, low + BPM_BUCKET)])}
                title={`${low}–${low + BPM_BUCKET - 1} BPM · ${count}`}
                className="flex-1 rounded-t transition-all"
                style={{
                  height: `${Math.max(count ? 8 : 2, (count / histogram.max) * 100)}%`,
                  background: inRange ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.14)',
                  opacity: inRange ? 0.9 : 0.5,
                  minHeight: 2,
                }}
              />
            );
          })}
        </div>

        {/* Dual-thumb range slider overlaid on the bucket axis */}
        <div className="relative h-7">
          <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full" style={{ background: 'rgba(var(--fg),0.12)' }} />
          <div
            className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full"
            style={{
              left: `${((selMin - BPM_SLIDER_MIN) / (BPM_SLIDER_MAX - BPM_SLIDER_MIN)) * 100}%`,
              right: `${(1 - (selMax - BPM_SLIDER_MIN) / (BPM_SLIDER_MAX - BPM_SLIDER_MIN)) * 100}%`,
              background: `rgb(${accentRGB})`,
            }}
          />
          <input
            type="range" className="bpm-range" min={BPM_SLIDER_MIN} max={BPM_SLIDER_MAX} step={1} value={selMin}
            onChange={e => { const v = Math.min(+e.target.value, selMax - 1); setRange([v, selMax]); }}
          />
          <input
            type="range" className="bpm-range" min={BPM_SLIDER_MIN} max={BPM_SLIDER_MAX} step={1} value={selMax}
            onChange={e => { const v = Math.max(+e.target.value, selMin + 1); setRange([selMin, v]); }}
          />
        </div>
        <div className="flex justify-between text-[10px] font-mono text-white/25 mt-1">
          <span>{BPM_SLIDER_MIN}</span><span>{BPM_SLIDER_MAX} BPM</span>
        </div>
      </div>

      {/* Crate filter */}
      {allCrates.length > 0 && (
        <div className="mb-5 relative inline-block">
          {crateFilter ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCrateMenuOpen(o => !o)}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] tracking-[0.12em] uppercase font-mono transition-all"
                style={{ background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.32)`, color: 'rgba(var(--fg),0.90)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)', boxShadow: `0 4px 16px rgba(${accentRGB},0.20)` }}>
                {crateFilter}
                {(crateTrackCounts[crateFilter] || 0) > 0 && (
                  <span style={{ minWidth: 14, height: 14, borderRadius: '50%', background: 'rgba(0,0,0,0.22)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, lineHeight: 1 }}>{crateTrackCounts[crateFilter]}</span>
                )}
              </button>
              <button onClick={() => { setCrateFilter(null); setCrateMenuOpen(false); }} className="flex items-center justify-center w-6 h-6 rounded-full transition-all" style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)', color: 'rgba(var(--fg),0.40)' }} onMouseEnter={e => e.currentTarget.style.color='rgba(var(--fg),0.80)'} onMouseLeave={e => e.currentTarget.style.color='rgba(var(--fg),0.40)'}><X size={10} /></button>
            </div>
          ) : (
            <button onClick={() => setCrateMenuOpen(o => !o)}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all"
              style={{ background: 'rgba(var(--fg),0.025)', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.50)' }}>
              <Stack size={13} className="opacity-60" />
              <span>Filter by crate</span>
              <CaretDown size={11} className="opacity-50" style={{ transform: crateMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
            </button>
          )}
          {crateMenuOpen && (
            <>
              <div className="fixed inset-0 z-20" onClick={() => setCrateMenuOpen(false)} />
              <div className="absolute left-0 mt-1.5 z-30 rounded-2xl overflow-hidden py-1.5 max-h-[320px] overflow-y-auto" style={{ minWidth: 220, background: 'rgba(var(--bg),0.97)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', border: '1px solid rgba(var(--fg),0.12)', boxShadow: '0 24px 60px -12px rgba(0,0,0,0.4)' }}>
                {allCrates.map(c => {
                  const active = crateFilter === c;
                  return (
                    <button key={c} onClick={() => { setCrateFilter(active ? null : c); setCrateMenuOpen(false); }}
                      className="w-full flex items-center gap-2.5 px-3.5 py-2 text-left transition-all"
                      style={{ background: active ? 'rgba(var(--fg),0.07)' : 'transparent' }}
                      onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'rgba(var(--fg),0.04)'; }}
                      onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}>
                      <span style={{ width: 9, height: 9, borderRadius: '50%', flexShrink: 0, background: 'rgba(var(--fg),0.28)' }} />
                      <span className="flex-1 truncate text-[12px] tracking-[0.1em] uppercase font-mono" style={{ color: active ? 'rgba(var(--fg),0.92)' : 'rgba(var(--fg),0.62)' }}>{c}</span>
                      {active && <Check size={11} weight="bold" style={{ color: 'rgba(var(--fg),0.7)' }} />}
                      <span className="text-[11px] font-mono" style={{ color: 'rgba(var(--fg),0.30)' }}>{crateTrackCounts[c] || 0}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

      {/* Analyzed track list, grouped by band */}
      {visible.length === 0 ? (
        <div className="text-center py-10 text-white/35 text-sm font-mono">
          {analyzed.length === 0
            ? (crateFilter ? `No analyzed tracks in crate "${crateFilter}".` : 'No analyzed tracks yet — detection runs automatically for tracks with previews.')
            : 'No tracks in this BPM range.'}
        </div>
      ) : (
        <div className="flex flex-col">{rows}</div>
      )}

      {/* Unanalyzed / pending section */}
      {unanalyzed.length > 0 && (
        <div className="mt-6">
          <button onClick={() => setShowUnanalyzed(s => !s)} className="w-full flex items-center justify-between px-1 py-2 transition-opacity hover:opacity-80">
            <span className="text-[13px] tracking-[0.16em] uppercase font-mono text-white/45">Unanalyzed · {unanalyzed.length}</span>
            <CaretDown size={13} className="opacity-50" style={{ transform: showUnanalyzed ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s' }} />
          </button>
          {showUnanalyzed && (
            <div className="flex flex-col mt-1">
              {unanalyzed.map(t => (
                <TrackBpmRow key={t.uid} t={t} accentRGB={accentRGB} playing={playing} onPlay={play} detecting={detecting.has(t.previewUrl)} />
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

function TrackBpmRow({ t, accentRGB, playing, onPlay, detecting }) {
  const isPlaying = t.previewUrl && playing === t.previewUrl;
  const keyColor = t.key ? camelotColor(t.key) : null;
  return (
    <div className="flex items-center gap-3 px-2 py-2 rounded-xl transition-all hover:bg-white/[0.03]" style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 56px' }}>
      {/* Cover */}
      <div className="w-11 h-11 rounded-md overflow-hidden shrink-0" style={{ background: `rgba(${accentRGB},0.08)` }}>
        {t.coverUrl
          ? <img src={t.coverUrl} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
          : <div className="w-full h-full flex items-center justify-center"><VinylRecord size={16} weight="thin" className="opacity-25" /></div>}
      </div>

      {/* Title + artist */}
      <div className="min-w-0 flex-1">
        <div className="text-[15px] truncate font-display text-white/85">{t.title}</div>
        <div className="text-[12px] truncate font-mono text-white/45">{t.artist}{t.recordTitle ? ` · ${t.recordTitle}` : ''}</div>
      </div>

      {/* Key chip (camelotColor returns hsl/rgb, so colour the text/border, neutral bg) */}
      {t.key && (
        <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-mono shrink-0" style={{ background: 'rgba(var(--fg),0.05)', color: keyColor || 'rgba(var(--fg),0.5)', border: '1px solid rgba(var(--fg),0.10)' }}>
          {t.key}
        </span>
      )}

      {/* BPM */}
      <div className="text-right shrink-0 w-[52px]">
        {t.bpm != null ? (
          <><span className={`text-[19px] font-display tabular-nums${t.bpmConfidence === 'low' ? ' opacity-50' : ''}`} style={{ color: `rgb(${accentRGB})` }} title={t.bpmConfidence === 'low' ? 'Sources disagree on this tempo' : undefined}>{t.bpm}</span><span className="text-[9px] block tracking-[0.14em] uppercase font-mono text-white/30 -mt-0.5">bpm</span></>
        ) : detecting ? (
          <div className="w-3.5 h-3.5 ml-auto rounded-full border border-t-transparent animate-spin" style={{ borderColor: `rgba(${accentRGB},0.4)`, borderTopColor: 'transparent' }} />
        ) : (
          <span className="text-[11px] font-mono text-white/25">{t.previewUrl ? '–' : 'no audio'}</span>
        )}
      </div>

      {/* Play */}
      {t.previewUrl ? (
        <button onClick={() => onPlay(t.previewUrl)} className="rounded-full flex items-center justify-center transition-all shrink-0" style={{ width: 30, height: 30, background: isPlaying ? `rgba(${accentRGB},0.18)` : 'transparent', border: isPlaying ? `1px solid rgba(${accentRGB},0.35)` : '1px solid rgba(var(--fg),0.13)', color: isPlaying ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.5)' }}>
          {isPlaying ? <Pause size={11} weight="fill" /> : <Play size={11} weight="fill" />}
        </button>
      ) : <div className="w-[30px] shrink-0" />}
    </div>
  );
}

function TrackRow({ track, index, accentRGB, playingPreview, onPlay, bpmLoading, onHotToggle }) {
  const keyColor = track.key ? camelotColor(track.key) : null;
  const isPlaying = track.previewUrl && playingPreview === track.previewUrl;

  const PlayBtn = ({ size = 9 }) => track.previewUrl ? (
    <button onClick={() => onPlay(track.previewUrl)}
      className="rounded-full flex items-center justify-center transition-all shrink-0"
      style={{
        width: size === 9 ? 24 : 28, height: size === 9 ? 24 : 28,
        background: isPlaying ? `rgba(${accentRGB},0.18)` : "transparent",
        border: isPlaying ? `1px solid rgba(${accentRGB},0.35)` : "1px solid rgba(var(--fg),0.13)",
        color: isPlaying ? `rgb(${accentRGB})` : "rgba(var(--fg),0.50)",
      }}>
      {isPlaying ? <Pause size={size} weight="fill" /> : <Play size={size} weight="fill" />}
    </button>
  ) : null;

  return (
    <div className="grid grid-cols-[36px_1fr_auto] md:grid-cols-[44px_1fr_auto_auto_auto_28px] items-center gap-2.5 md:gap-4 px-3 md:px-4 py-2.5 rounded-xl transition-all group hover:bg-white/[0.025]" style={{ animation: `fadeUp 0.3s ease-out ${index * 0.04}s both` }}>
      <div className="text-[13px] tracking-[0.12em] text-white/50 font-mono">{track.position}</div>
      <div className="min-w-0 flex items-start gap-1.5">
        {/* Hot toggle: clickable when onHotToggle provided, display-only when track.hot */}
        {(onHotToggle || track.hot) && (
          <button
            onClick={onHotToggle ? () => onHotToggle(index) : undefined}
            className="shrink-0 leading-none transition-opacity"
            style={{ fontSize: 20, opacity: track.hot ? 1 : 0.22, cursor: onHotToggle ? "pointer" : "default", marginTop: 2 }}
            title={onHotToggle ? (track.hot ? "Unmark as hot" : "Mark as hot") : undefined}
          >
            🔥
          </button>
        )}
        <div className="min-w-0">
          <div className="text-[18px] md:text-[19px] truncate font-display text-white/85">{track.title}</div>
          {/* Mobile: duration + BPM + key inline */}
          <div className="md:hidden text-[13px] text-white/42 mt-0.5 flex items-center gap-1.5 font-mono">
            {track.duration && <><span>{track.duration}</span><span>·</span></>}
            {bpmLoading
              ? <span style={{ animation: "pulse 1.2s ease-in-out infinite" }}>··· BPM</span>
              : <span>{track.bpm != null ? `${track.bpm} BPM` : ""}</span>
            }
            {track.bpm != null && <span>·</span>}
            <span style={{ color: keyColor || "rgba(var(--fg),0.38)" }}>{track.key || ""}</span>
          </div>
        </div>
      </div>
      {/* Mobile play button — sits in the "auto" third column */}
      <div className="md:hidden flex items-center justify-center">
        <PlayBtn size={10} />
      </div>
      {/* Desktop columns */}
      <div className="hidden md:flex items-center gap-1 text-[14px] text-white/50 tabular-nums font-mono"><Clock size={11} />{track.duration || "—"}</div>
      <div className="hidden md:flex items-center gap-1 text-[14px] tabular-nums min-w-[72px] justify-end font-mono">
        <span className="text-white/35 text-[11px]">BPM</span>
        {bpmLoading
          ? <span className="text-white/40" style={{ animation: "pulse 1.2s ease-in-out infinite", letterSpacing: "0.05em" }}>···</span>
          : <span style={{ color: track.bpm != null ? "rgba(var(--fg),0.65)" : "rgba(var(--fg),0.40)" }}>{track.bpm != null ? track.bpm : "—"}</span>
        }
      </div>
      {/* Key badge — hidden on mobile (already shown inline above) */}
      <div className="hidden md:flex items-center justify-center md:w-12 h-7">
        {keyColor ? (
          <div className="w-full h-full rounded-full flex items-center justify-center text-[14px] font-semibold tabular-nums font-mono" style={{ background: keyColor.replace("hsl", "hsla").replace(")", ", 0.10)"), border: `1px solid ${keyColor.replace("hsl", "hsla").replace(")", ", 0.30)")}`, color: keyColor }}>{track.key}</div>
        ) : <span className="text-white/35 text-[13px] font-mono">—</span>}
      </div>
      <div className="hidden md:flex items-center justify-center">
        <PlayBtn size={9} />
      </div>
    </div>
  );
}

function ConditionSelect({ label, icon, value, onChange }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const color = conditionColor(value);
  const darkColor = value === 'M' || value === 'NM' ? '40,140,55'
    : value === 'VG+' || value === 'VG' ? '140,100,10'
    : value ? '180,45,45' : null;
  const displayColor = isLight ? darkColor : color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      {icon
        ? <span style={{ color: `rgba(var(--fg),${isLight ? 0.52 : 0.38})`, display: 'flex' }}>{icon}</span>
        : <span style={{ fontSize: 14, fontFamily: 'monospace', letterSpacing: '0.18em', textTransform: 'uppercase', color: `rgba(var(--fg),${isLight ? 0.52 : 0.30})` }}>{label}</span>
      }
      <select value={value} onChange={e => onChange(e.target.value)} style={{ background: displayColor ? `rgba(${displayColor},${isLight ? 0.10 : 0.09})` : 'rgba(var(--fg),0.04)', border: `1px solid ${displayColor ? `rgba(${displayColor},${isLight ? 0.35 : 0.28})` : 'rgba(var(--fg),0.10)'}`, color: displayColor ? `rgb(${displayColor})` : `rgba(var(--fg),${isLight ? 0.52 : 0.45})`, borderRadius: 20, padding: '3px 8px', fontSize: 16, fontFamily: 'monospace', cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none' }}>
        {CONDITION_GRADES.map(g => (
          <option key={g} value={g}>{g || '--'}</option>
        ))}
      </select>
    </div>
  );
}

function GlassSection({ title, subtitle, icon, accentRGB, children }) {
  return (
    <section className="rounded-2xl p-5 md:p-7" style={glass()}>
      <div className="flex items-baseline justify-between mb-5">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-[13px] tracking-[0.3em] uppercase font-medium font-mono text-white/60">{title}</h3>
        </div>
        {subtitle && <div className="text-[13px] tracking-[0.12em] uppercase text-white/40 font-mono">{subtitle}</div>}
      </div>
      {children}
    </section>
  );
}

function Pill({ label, value, mono }) {
  return (
    <div className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(var(--fg),0.035)", border: "1px solid rgba(var(--fg),0.07)" }}>
      <span className="text-[11px] tracking-[0.2em] uppercase text-white/45 font-mono">{label}</span>
      <span className={`text-[16px] text-white/85 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ConfidenceBadge({ confidence, identified, accentRGB }) {
  const isOk = identified;
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[13px] tracking-[0.2em] uppercase font-mono"
      style={{ border: `1px solid ${isOk ? `rgba(${accentRGB},0.28)` : "rgba(240,190,80,0.28)"}`, color: isOk ? `rgb(${accentRGB})` : "rgb(240,190,80)", background: "rgba(var(--fg),0.015)" }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: isOk ? `rgb(${accentRGB})` : "rgb(240,190,80)" }} />
      {isOk ? "Identified" : "Unverified"}
      {isOk && confidence && <span className="text-white/30">· {confidence}</span>}
    </div>
  );
}

function ErrorView({ message, onReset, onManual, onSignOut }) {
  const sessionExpired = /session expired/i.test(message || "");
  if (sessionExpired) {
    return (
      <div className="pt-20 flex flex-col items-center text-center max-w-sm mx-auto">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(202,254,4,0.08)", border: "1px solid rgba(202,254,4,0.25)" }}>
          <SignOut size={22} weight="light" style={{ color: "#cafe04" }} />
        </div>
        <h2 className="text-2xl mb-2 font-display"><span className="italic">Session</span> expired</h2>
        <p className="text-white/35 text-sm mb-6 break-words leading-relaxed">Your login needs a refresh. Sign out below, then sign straight back in.</p>
        <p className="text-white/50 text-sm mb-6 break-words leading-relaxed" style={{ background: 'rgba(202,254,4,0.08)', border: '1px solid rgba(202,254,4,0.25)', borderRadius: 12, padding: '10px 14px' }}>
          Everything you have scanned is already saved on this device. The collection may look empty for a second while you sign back in, then it all comes back.
        </p>
        <div className="flex items-center gap-2.5 flex-wrap justify-center">
          <button onClick={onSignOut} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-mono font-semibold transition-all hover:opacity-85" style={{ background: "#cafe04", color: "#08080c", border: "none" }}>
            <SignOut size={13} weight="bold" />Sign out now
          </button>
          <button onClick={onReset} className="px-5 py-2.5 rounded-full text-sm font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.55)", background: "rgba(var(--fg),0.03)" }}>Not now</button>
        </div>
      </div>
    );
  }
  return (
    <div className="pt-20 flex flex-col items-center text-center max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(220,80,80,0.08)", border: "1px solid rgba(220,80,80,0.22)" }}>
        <X size={22} weight="light" className="text-red-300/70" />
      </div>
      <h2 className="text-2xl mb-2 font-display"><span className="italic">Couldn't read</span> that one</h2>
      <p className="text-white/35 text-sm mb-6 break-words leading-relaxed">{message}</p>
      <div className="flex items-center gap-2.5 flex-wrap justify-center">
        <button onClick={onReset} className="px-5 py-2.5 rounded-full text-sm font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.55)", background: "rgba(var(--fg),0.03)" }}>Try again</button>
        {onManual && (
          <button onClick={onManual} className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-sm font-mono transition-all" style={{ border: `1px solid rgba(var(--fg),0.12)`, color: "rgba(var(--fg),0.7)", background: "rgba(var(--fg),0.06)" }}>
            <MagnifyingGlass size={13} />Enter details manually
          </button>
        )}
      </div>
    </div>
  );
}

// ----- TagCloud --------------------------------------------------------------

function TagCloud({ tags, genres, accentRGB }) {
  const genreSet = new Set(genres);
  return (
    <div className="flex flex-wrap gap-2">
      {tags.map((tag) => {
        const isGenre = genreSet.has(tag);
        return (
          <span
            key={tag}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[14px] font-mono"
            style={isGenre
              ? { background: `rgba(${accentRGB},0.10)`, border: `1px solid rgba(${accentRGB},0.25)`, color: `rgba(${accentRGB},0.85)` }
              : { background: "rgba(var(--fg),0.04)", border: "1px solid rgba(var(--fg),0.09)", color: "rgba(var(--fg),0.52)" }
            }
          >
            {!isGenre && <Sparkle size={9} weight="fill" style={{ opacity: 0.55 }} />}
            {tag}
          </span>
        );
      })}
    </div>
  );
}

// ----- ExploreView -----------------------------------------------------------

function ExploreView({ collection, accentRGB, onSelectRecord }) {
  const [selectedTag, setSelectedTag] = useState(null);

  const tagMap = new Map();
  for (const record of collection) {
    for (const tag of (record.tags || [])) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(record);
    }
  }
  const tagEntries = [...tagMap.entries()].sort((a, b) => b[1].length - a[1].length);

  if (tagEntries.length === 0) {
    return (
      <div className="py-20 text-center text-white/25 text-sm font-mono">
        No tags yet. Scan records to populate the explore view.
      </div>
    );
  }

  if (selectedTag) {
    const records = tagMap.get(selectedTag) || [];
    return (
      <div style={{ animation: "fadeUp 0.22s ease-out" }}>
        <button onClick={() => setSelectedTag(null)} className="inline-flex items-center gap-2 mb-6 text-[14px] font-mono text-white/35 hover:text-white/65 transition-colors">
          <CaretLeft size={12} />All tags
        </button>
        <div className="mb-5">
          <h3 className="text-2xl font-display mb-0.5">{selectedTag}</h3>
          <div className="text-[14px] font-mono text-white/30">{records.length} record{records.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {records.map((record) => (
            <RecordCard key={record.id} record={record} onSelect={() => onSelectRecord(record)} onRemove={() => {}} accentRGB={accentRGB} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2.5" style={{ animation: "fadeUp 0.22s ease-out" }}>
      {tagEntries.map(([tag, records]) => (
        <button
          key={tag}
          onClick={() => setSelectedTag(tag)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[15px] font-mono transition-all hover:scale-[1.03] active:scale-[0.97]"
          style={{ background: "rgba(var(--fg),0.04)", border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.65)" }}
        >
          {tag}
          <span className="text-[13px] font-mono" style={{ color: "rgba(var(--fg),0.28)" }}>{records.length}</span>
        </button>
      ))}
    </div>
  );
}

function CameraModal({ onCapture, onBarcode, onClose }) {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  // Measured at capture time to crop exactly what the guide frames on screen.
  const guideRef = useRef(null);
  const [flash, setFlash] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const startedRef = useRef(false);
  // Viewfinder mode: 'label' (circular guide + centre crop, catno-optimised)
  // or 'sleeve' (square corner-bracket guide + full-frame capture). Persisted
  // so the preference sticks between scans.
  const [scanMode, setScanMode] = useState(() => {
    try {
      const m = localStorage.getItem('vv_scan_mode');
      return m === 'sleeve' || m === 'barcode' ? m : 'label';
    }
    catch { return 'label'; }
  });
  const switchMode = (m) => {
    setScanMode(m);
    try { localStorage.setItem('vv_scan_mode', m); } catch { /* private mode */ }
  };

  useEffect(() => {
    let mounted = true;

    const start = async () => {
      // Guard: only ever request once per mount (defends against any double
      // invocation, which would surface a second permission prompt).
      if (startedRef.current) return;
      startedRef.current = true;

      if (!navigator.mediaDevices?.getUserMedia) {
        if (mounted) setError('Camera not supported on this browser');
        return;
      }
      try {
        // Reuse the shared session stream when it's already live -- this is what
        // keeps the permission prompt to once per session rather than once per scan.
        const stream = await acquireCameraStream();
        if (!mounted) return; // leave the shared stream alive for the next open
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        // iOS Safari needs an explicit play() call -- autoPlay + onloadedmetadata
        // alone frequently yields a permanently black frame. Awaiting play() and
        // then flipping ready avoids depending on a metadata event that may never fire.
        try { await v.play(); } catch { /* play() can reject on iOS; frames still arrive */ }
        if (mounted) setReady(true);
      } catch (err) {
        if (mounted) setError(err.name === 'NotAllowedError' ? 'Camera permission denied' : (err.message || 'Camera unavailable'));
      }
    };

    start();

    // iOS pauses (or black-frames) the stream when the tab is backgrounded -- an
    // app switch or the permission sheet itself does this. Resume on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && videoRef.current?.srcObject) {
        videoRef.current.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      mounted = false;
      document.removeEventListener('visibilitychange', onVisible);
      // Detach the feed but keep the shared stream alive so the next open
      // reuses the existing grant without re-prompting. The stream is released
      // by VinylVault when the scan flow is exited (and on tab-hide / unload).
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, []);

  // Live barcode decoding. While barcode mode is open the guide region is
  // decoded on-device a few times a second; the first checksum-valid read wins
  // and fires immediately, so there is no shutter press and no upload. Every
  // result is validated, so a partial read is dropped and the next frame tried
  // (measured: failures are always no-reads, never wrong values).
  const [barcodeLocked, setBarcodeLocked] = useState(false);
  useEffect(() => {
    if (scanMode !== 'barcode' || !ready || !onBarcode) return;
    let stop = false;
    let busy = false;
    const work = document.createElement('canvas');
    setBarcodeLocked(false);

    const tick = async () => {
      if (stop || busy) return;
      const v = videoRef.current;
      const guide = guideRef.current;
      if (!v?.videoWidth || !guide) return;
      busy = true;
      try {
        // Decode only what the guide frames: smaller image, faster decode, and
        // a barcode elsewhere on the sleeve cannot hijack the scan.
        const box = v.getBoundingClientRect();
        const g = guide.getBoundingClientRect();
        const cover = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
        const originX = box.left + (box.width - v.videoWidth * cover) / 2;
        const originY = box.top + (box.height - v.videoHeight * cover) / 2;
        const sw = Math.min(g.width / cover, v.videoWidth);
        const sh = Math.min(g.height / cover, v.videoHeight);
        const sx = Math.max(0, Math.min((g.left - originX) / cover, v.videoWidth - sw));
        const sy = Math.max(0, Math.min((g.top - originY) / cover, v.videoHeight - sh));
        const scale = Math.min(1, 900 / sw);
        work.width = Math.max(1, Math.round(sw * scale));
        work.height = Math.max(1, Math.round(sh * scale));
        work.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, work.width, work.height);
        const code = await detectBarcode(work);
        if (code && !stop) {
          stop = true;
          setBarcodeLocked(true);
          if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* unsupported */ } }
          onBarcode(code);
        }
      } finally {
        busy = false;
      }
    };

    // Warm the decoder up front so the first frame is not the one that pays
    // for loading the WASM.
    loadBarcodeDetector().catch(() => {});
    const id = setInterval(tick, 140);
    return () => { stop = true; clearInterval(id); work.width = 0; work.height = 0; };
  }, [scanMode, ready, onBarcode]);

  const capture = () => {
    const v = videoRef.current;
    if (!v || !ready || capturing) return;
    // Guard against capturing before any frames have decoded -- iOS can report
    // ready while videoWidth is still 0, which would make a zero-size canvas.
    if (!v.videoWidth || !v.videoHeight) return;
    setCapturing(true);
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    // Cap the capture canvas: full-resolution iPhone sensors (up to ~4032x3024)
    // can spike memory enough to crash the tab. The scan pipeline downsizes again.
    const MAX = 1600;
    const canvas = document.createElement('canvas');
    if (scanMode === 'label') {
      // Centre-square crop matching the circular viewfinder: the guide occupies
      // <=82% of the smaller screen dimension and the video is object-cover, so
      // a 90%-of-min-dimension square safely contains everything inside the
      // circle while shedding background clutter -- the label fills more of the
      // frame, which directly raises OCR accuracy on the catalogue number.
      const side = Math.round(Math.min(v.videoWidth, v.videoHeight) * 0.9);
      const sx = Math.round((v.videoWidth - side) / 2);
      const sy = Math.round((v.videoHeight - side) / 2);
      const scale = Math.min(1, MAX / side);
      canvas.width = canvas.height = Math.round(side * scale);
      canvas.getContext('2d').drawImage(v, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
    } else if (scanMode === 'barcode') {
      // Barcode mode: crop to exactly what the guide box frames on screen.
      //
      // The naive "fraction of the video" crop is wrong on a phone: the preview
      // is object-cover, so with a landscape stream in a portrait viewport most
      // of the frame width is off-screen. Cropping 92% of the video then
      // included a load of sleeve the user never saw, and the barcode ended up
      // a small fraction of the sent image -- the opposite of what this mode is
      // for. Mapping the guide rect through the cover transform means the
      // barcode fills the frame, which is what makes the digits readable.
      const guide = guideRef.current?.getBoundingClientRect();
      const box = v.getBoundingClientRect();
      let sx, sy, sw, sh;
      if (guide && box.width && v.videoWidth) {
        const cover = Math.max(box.width / v.videoWidth, box.height / v.videoHeight);
        // Where the (overflowing) video actually sits, in page coordinates
        const originX = box.left + (box.width - v.videoWidth * cover) / 2;
        const originY = box.top + (box.height - v.videoHeight * cover) / 2;
        // A little margin so a barcode aligned slightly outside the box survives
        const pad = 0.08;
        sw = (guide.width / cover) * (1 + pad * 2);
        sh = (guide.height / cover) * (1 + pad * 2);
        sx = (guide.left - originX) / cover - (guide.width / cover) * pad;
        sy = (guide.top - originY) / cover - (guide.height / cover) * pad;
        // Clamp inside the frame
        sw = Math.min(sw, v.videoWidth); sh = Math.min(sh, v.videoHeight);
        sx = Math.max(0, Math.min(sx, v.videoWidth - sw));
        sy = Math.max(0, Math.min(sy, v.videoHeight - sh));
      } else {
        sw = v.videoWidth; sh = Math.min(v.videoHeight, sw * 0.42);
        sx = 0; sy = (v.videoHeight - sh) / 2;
      }
      // The crop is a thin band, so its pixel area stays small even at a
      // generous width. Keep native resolution where possible: every pixel
      // across the bars is a pixel of barcode legibility.
      const BARCODE_MAX = 2200;
      const scale = Math.min(1, BARCODE_MAX / sw);
      canvas.width = Math.max(1, Math.round(sw * scale));
      canvas.height = Math.max(1, Math.round(sh * scale));
      canvas.getContext('2d').drawImage(v, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    } else {
      // Sleeve mode: full frame, as sleeves are framed loosely and Vision
      // reads layout context from the whole shot.
      const scale = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight));
      canvas.width = Math.round(v.videoWidth * scale);
      canvas.height = Math.round(v.videoHeight * scale);
      canvas.getContext('2d').drawImage(v, 0, 0, canvas.width, canvas.height);
    }
    // Keep the shared stream alive (don't stop tracks) so batch-scanning the next
    // record reopens the camera instantly without another permission prompt.
    if (v) v.srcObject = null;
    canvas.toBlob(blob => {
      canvas.width = 0; canvas.height = 0;
      if (blob) onCapture(new File([blob], 'scan.jpg', { type: 'image/jpeg' }));
      else { setCapturing(false); setError('Capture failed, please try again'); }
    }, 'image/jpeg', 0.92);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center"
      style={{ background: '#000' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>

      {/* Flash overlay */}
      {flash && <div className="absolute inset-0 z-20 pointer-events-none" style={{ background: 'rgba(var(--fg),0.7)', animation: 'none' }} />}

      {/* Close */}
      <button onClick={onClose} className="absolute top-4 right-4 z-30 w-10 h-10 rounded-full flex items-center justify-center text-white"
        style={{ background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(var(--fg),0.15)' }}>
        <X size={18} />
      </button>

      {/* Video feed */}
      <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
        {/* Kept rendered (never display:none) -- iOS will not start a camera feed
            on a hidden video element, which is a common cause of the black screen.
            Fade in once the first frames arrive. */}
        <video ref={videoRef} autoPlay playsInline muted
          className="absolute inset-0 w-full h-full object-cover"
          style={{ opacity: ready ? 1 : 0, transition: 'opacity 0.25s' }} />

        {!ready && !error && (
          <div className="text-white/50 text-sm font-mono flex flex-col items-center gap-3">
            <div className="w-8 h-8 rounded-full border-2 animate-spin"
              style={{ borderColor: 'rgba(var(--fg),0.2)', borderTopColor: 'rgba(var(--fg),0.7)' }} />
            Starting camera...
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center gap-5 px-8 text-center max-w-sm">
            {/* Icon */}
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Camera size={24} className="text-red-400/70" />
            </div>

            <div>
              <p className="text-white/80 text-base font-display mb-1">Camera access blocked</p>
              <p className="text-white/40 text-sm font-mono leading-relaxed">
                {error === 'Camera permission denied'
                  ? 'Your browser blocked camera access. Enable it in site settings, then try again.'
                  : error}
              </p>
            </div>

            {/* How to fix — browser-specific hint */}
            <div className="w-full rounded-xl px-4 py-3 text-left text-[15px] font-mono text-white/35 leading-relaxed"
              style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.08)' }}>
              <p className="text-white/50 mb-1.5">To allow camera access:</p>
              <p>1. Tap the lock / info icon in your browser address bar</p>
              <p>2. Find <span className="text-white/60">Camera</span> and set it to <span className="text-white/60">Allow</span></p>
              <p>3. Reload the page and try again</p>
            </div>

            {/* Fallback: choose from library */}
            <label className="px-5 py-2.5 rounded-full text-sm font-mono text-white/70 cursor-pointer transition-all hover:text-white/90"
              style={{ border: '1px solid rgba(var(--fg),0.2)', background: 'rgba(var(--fg),0.06)' }}>
              Choose photo from library instead
              <input type="file" accept="image/*" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onCapture(f); }} />
            </label>
          </div>
        )}

        {/* Framing guide: circular viewfinder sized to the record label.
            Labels carry the densest identity data (catalogue number above
            all), so the guide steers users to fill the circle with the
            label; the capture centre-crops to match. Acid ring = brand. */}
        {ready && scanMode === 'label' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative rounded-full" style={{ width: 'min(82vw, 68vh)', height: 'min(82vw, 68vh)' }}>
              {/* Dim everything outside the circle */}
              <div className="absolute inset-0 rounded-full" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.55)', border: '2px solid rgba(202,254,4,0.9)' }} />
              {/* Spindle-hole hint: centre the label on the dot */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-3 h-3 rounded-full" style={{ border: '2px solid rgba(202,254,4,0.55)' }} />
            </div>
          </div>
        )}
        {ready && scanMode === 'sleeve' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative" style={{ width: 'min(82vw, 68vh)', height: 'min(82vw, 68vh)' }}>
              <div className="absolute inset-0" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
              {[['top-0 left-0', 'border-t border-l'],
                ['top-0 right-0', 'border-t border-r'],
                ['bottom-0 left-0', 'border-b border-l'],
                ['bottom-0 right-0', 'border-b border-r']].map(([pos, border]) => (
                <div key={pos} className={`absolute ${pos} w-7 h-7 ${border}`}
                  style={{ borderColor: 'rgba(202,254,4,0.9)', borderWidth: 2 }} />
              ))}
            </div>
          </div>
        )}
        {/* Barcode: a wide letterbox shaped like the barcode itself, with
            corner brackets matching sleeve mode, a centre scan line and faint
            stripes so the target reads instantly. guideRef drives the capture
            crop, so what is inside this box is exactly what gets sent. */}
        {ready && scanMode === 'barcode' && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div ref={guideRef} className="relative" style={{ width: 'min(86vw, 78vh)', height: 'min(46vw, 40vh)' }}>
              <div className="absolute inset-0 rounded-lg transition-all" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.6)', border: barcodeLocked ? '2px solid #cafe04' : '1px solid rgba(202,254,4,0.35)', background: barcodeLocked ? 'rgba(202,254,4,0.18)' : 'transparent' }} />
              {/* Stripe hint: the shape a barcode makes */}
              <div className="absolute inset-0 flex items-center justify-center gap-[3px] px-6 overflow-hidden" style={{ opacity: 0.22 }}>
                {[3, 1, 2, 1, 1, 3, 1, 2, 2, 1, 3, 1, 1, 2, 1, 3, 2, 1].map((w, i) => (
                  <div key={i} style={{ width: w, height: '42%', background: '#cafe04', flexShrink: 0 }} />
                ))}
              </div>
              {/* Scan line across the middle */}
              <div className="absolute left-3 right-3 top-1/2 -translate-y-1/2" style={{ height: 2, background: 'rgba(202,254,4,0.85)' }} />
              {/* Corner brackets */}
              {[['top-0 left-0', 'border-t border-l'],
                ['top-0 right-0', 'border-t border-r'],
                ['bottom-0 left-0', 'border-b border-l'],
                ['bottom-0 right-0', 'border-b border-r']].map(([pos, border]) => (
                <div key={pos} className={`absolute ${pos} w-7 h-7 ${border}`}
                  style={{ borderColor: 'rgba(202,254,4,0.95)', borderWidth: 2 }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Capture button */}
      {ready && (
        <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-3 z-10">
          {/* Label / Sleeve / Barcode viewfinder toggle */}
          <div className="flex rounded-full p-1" style={{ background: 'rgba(0,0,0,0.55)', border: '1px solid rgba(255,255,255,0.15)' }}>
            {[['label', 'Label'], ['sleeve', 'Sleeve'], ['barcode', 'Barcode']].map(([m, txt]) => (
              <button key={m} onClick={() => switchMode(m)}
                className="px-3.5 py-1.5 rounded-full text-[12px] font-mono uppercase tracking-[0.1em] transition-all"
                style={scanMode === m
                  ? { background: '#cafe04', color: '#08080c', fontWeight: 700 }
                  : { background: 'transparent', color: 'rgba(255,255,255,0.55)' }}>
                {txt}
              </button>
            ))}
          </div>
          <p className="text-[13px] tracking-[0.2em] uppercase font-mono px-6 text-center" style={{ color: 'rgba(202,254,4,0.85)' }}>
            {scanMode === 'label' ? 'Centre the label in the circle'
              : scanMode === 'barcode' ? (barcodeLocked ? 'Got it, looking it up' : 'Hold the barcode in the box')
              : 'Align sleeve inside corners'}
          </p>
          <p className="text-[11px] font-mono text-white/40 px-6 text-center -mt-1.5">
            {scanMode === 'label'
              ? 'The catalogue number is the key detail'
              : scanMode === 'barcode'
              ? 'Reads by itself, no need to press the button'
              : 'Front or back -- catalogue number and spine text help most'}
          </p>
          <button onClick={capture}
            className="w-16 h-16 rounded-full flex items-center justify-center transition-all active:scale-95"
            style={{ background: 'rgba(var(--fg),0.92)', border: '3px solid rgba(var(--fg),0.5)', boxShadow: '0 0 0 4px rgba(var(--fg),0.15)' }}>
            <Camera size={24} style={{ color: '#111' }} weight="bold" />
          </button>
        </div>
      )}
    </div>
  );
}

// ----- Label printing --------------------------------------------------------

function truncateLabelText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && ctx.measureText(t + '...').width > maxWidth) t = t.slice(0, -1);
  return t + '...';
}

function drawLabel(ctx, record, W, H, accentRGB) {
  const parts = (accentRGB || '200,200,200').split(',').map(Number);
  const [r, g, b] = parts;
  const accent = `rgb(${r},${g},${b})`;

  ctx.fillStyle = '#0a0a10';
  ctx.fillRect(0, 0, W, H);

  // Left accent bar
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 8, H);

  const pad = 48;
  const cx = pad + 8;
  const cw = W - cx - pad;

  // Artist
  ctx.font = 'bold 62px Georgia, serif';
  ctx.fillStyle = 'rgba(var(--fg),0.92)';
  ctx.textAlign = 'left';
  ctx.fillText(truncateLabelText(ctx, record.artist || '', cw), cx, 104);

  // Title
  ctx.font = 'italic 38px Georgia, serif';
  ctx.fillStyle = 'rgba(var(--fg),0.52)';
  ctx.fillText(truncateLabelText(ctx, record.title || '', cw), cx, 156);

  // Meta
  const meta = [record.label, record.year, record.catalogNumber].filter(Boolean).join('  ·  ');
  ctx.font = '13px monospace';
  ctx.fillStyle = 'rgba(var(--fg),0.26)';
  ctx.fillText(meta, cx, 194);

  // Divider
  ctx.strokeStyle = 'rgba(var(--fg),0.07)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, 216);
  ctx.lineTo(W - pad, 216);
  ctx.stroke();

  // Tracklist
  const tracks = record.tracklist || [];
  const trackH = 35;
  const startY = 240;
  const maxTracks = Math.floor((H - startY - 36) / trackH);

  tracks.slice(0, maxTracks).forEach((track, i) => {
    const y = startY + i * trackH + 20;
    const isHot = track.hot;

    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(var(--fg),0.24)';
    ctx.textAlign = 'left';
    ctx.fillText(track.position || String(i + 1), cx, y);

    const fireX = cx + 26;
    if (isHot) {
      ctx.font = '14px serif';
      ctx.fillText('🔥', fireX, y);
    }

    const titleX = cx + 50;
    const bpmW = track.bpm ? 72 : 0;
    const maxTitleW = cw - 50 - bpmW - 8;
    ctx.font = isHot ? `bold 17px -apple-system, sans-serif` : `17px -apple-system, sans-serif`;
    ctx.fillStyle = isHot ? accent : 'rgba(var(--fg),0.78)';
    ctx.fillText(truncateLabelText(ctx, track.title || '', maxTitleW), titleX, y);

    if (track.bpm) {
      ctx.font = 'bold 13px monospace';
      ctx.fillStyle = `rgba(${r},${g},${b},0.55)`;
      ctx.textAlign = 'right';
      ctx.fillText(`${track.bpm} BPM`, W - pad, y);
      ctx.textAlign = 'left';
    }
  });

  // Branding
  ctx.font = '11px monospace';
  ctx.fillStyle = 'rgba(var(--fg),0.10)';
  ctx.textAlign = 'right';
  ctx.fillText('VINYL VAULT', W - pad, H - 18);
  ctx.textAlign = 'left';
}

function BatchLabelModal({ records, accentRGB, onClose }) {
  const canvasRefs = useRef([]);
  const W = 1000, H = 640;

  useEffect(() => {
    records.forEach((record, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      canvas.width = W;
      canvas.height = H;
      drawLabel(canvas.getContext('2d'), record, W, H, accentRGB);
    });
  }, [records.map(r => r.id).join(','), accentRGB]);

  const downloadAll = () => {
    records.forEach((record, i) => {
      const canvas = canvasRefs.current[i];
      if (!canvas) return;
      setTimeout(() => {
        const a = document.createElement('a');
        a.download = `label-${(record.artist + '-' + record.title).replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
      }, i * 200);
    });
  };

  const printAll = () => {
    const win = window.open('', '_blank');
    const imgs = records.map((record, i) => {
      const canvas = canvasRefs.current[i];
      return canvas ? `<div style="page-break-inside:avoid;margin-bottom:16px"><img src="${canvas.toDataURL('image/png')}" style="width:100%;max-width:700px;display:block" /><div style="font-family:monospace;font-size:11px;color:#666;margin-top:4px">${record.artist} - ${record.title}</div></div>` : '';
    }).join('');
    win.document.write(`<html><head><title>Vinyl Vault Labels</title><style>body{margin:24px;background:#fff}@media print{body{margin:0}}</style></head><body>${imgs}<script>window.onload=()=>{window.print();window.close()}<\/script></body></html>`);
    win.document.close();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(16px)' }}
      onClick={onClose}>
      <div className="relative w-full max-w-3xl max-h-[90vh] rounded-3xl overflow-hidden flex flex-col"
        style={{ background: 'rgba(var(--bg),0.99)', border: '1px solid rgba(var(--fg),0.08)', boxShadow: '0 40px 100px -20px rgba(0,0,0,0.95)' }}
        onClick={e => e.stopPropagation()}>

        <div className="flex items-center justify-between px-6 pt-6 pb-4 shrink-0">
          <div>
            <div className="text-[13px] tracking-[0.3em] uppercase font-mono text-white/35">Batch Labels</div>
            <div className="text-white/60 text-sm font-mono mt-0.5">{records.length} record{records.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadAll}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[14px] font-mono transition-all"
              style={{ background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.3)`, color: `rgb(${accentRGB})` }}>
              <DownloadSimple size={13} />Download All
            </button>
            <button onClick={printAll}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[14px] font-mono transition-all"
              style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.5)', background: 'transparent' }}>
              <Printer size={13} />Print
            </button>
            <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center transition-all"
              style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)' }}>
              <X size={14} className="text-white/50" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-6 pb-6 flex flex-col gap-4">
          {records.map((record, i) => (
            <div key={record.id}>
              <div className="text-[13px] font-mono text-white/30 mb-1.5">{record.artist} - {record.title}</div>
              <div className="w-full rounded-xl overflow-hidden" style={{ border: '1px solid rgba(var(--fg),0.07)', aspectRatio: '1000 / 640' }}>
                <canvas ref={el => canvasRefs.current[i] = el} style={{ width: '100%', height: '100%', display: 'block' }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LabelModal({ record, accentRGB, onClose }) {
  const canvasRef = useRef(null);
  const [gelatoStatus, setGelatoStatus] = useState(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const W = 1000, H = 640;
    canvas.width = W;
    canvas.height = H;
    drawLabel(canvas.getContext('2d'), record, W, H, accentRGB);
  }, [record.id, accentRGB]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.download = `label-${(record.artist + '-' + record.title).replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`;
    a.href = canvas.toDataURL('image/png');
    a.click();
  };

  const orderGelato = async () => {
    setGelatoStatus('ordering');
    try {
      const canvas = canvasRef.current;
      const imageData = canvas.toDataURL('image/png').split(',')[1];
      const res = await fetch('/api/gelato-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData, record: { artist: record.artist, title: record.title } }),
      });
      const data = await res.json();
      setGelatoStatus(data.error === 'not_configured' ? 'unavailable' : 'success');
    } catch {
      setGelatoStatus('unavailable');
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(14px)' }}
      onClick={onClose}>
      <div className="relative w-full max-w-2xl rounded-3xl overflow-hidden"
        style={{ background: 'rgba(var(--bg),0.99)', border: '1px solid rgba(var(--fg),0.08)', boxShadow: '0 40px 100px -20px rgba(0,0,0,0.95)' }}
        onClick={e => e.stopPropagation()}>

        <button onClick={onClose} className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full flex items-center justify-center transition-all"
          style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)' }}>
          <X size={14} className="text-white/50" />
        </button>

        <div className="p-6 md:p-8">
          <div className="text-[13px] tracking-[0.3em] uppercase font-mono text-white/35 mb-4">Sleeve Label</div>

          <div className="w-full rounded-xl overflow-hidden mb-3" style={{ border: '1px solid rgba(var(--fg),0.07)', aspectRatio: '1000 / 640' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>

          <div className="text-[13px] font-mono text-white/22 mb-5">
            1000 x 640 px (approx 85 x 54 mm at 300 dpi) · sleeve label format
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={download}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[15px] font-mono transition-all"
              style={{ background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.30)`, color: `rgb(${accentRGB})` }}>
              <DownloadSimple size={14} />Download PNG
            </button>

            {gelatoStatus === null && (
              <button onClick={orderGelato}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[15px] font-mono transition-all"
                style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.45)', background: 'transparent' }}>
                <Printer size={14} />Order via Gelato
              </button>
            )}
            {gelatoStatus === 'ordering' && (
              <div className="flex items-center gap-2 text-[14px] font-mono text-white/35">
                <div className="w-3 h-3 rounded-full border animate-spin" style={{ borderColor: 'rgba(var(--fg),0.2)', borderTopColor: 'rgba(var(--fg),0.6)' }} />
                Placing order...
              </div>
            )}
            {gelatoStatus === 'success' && (
              <div className="flex items-center gap-2 text-[14px] font-mono" style={{ color: 'rgb(120,220,140)' }}>
                <Check size={13} weight="bold" />Order placed
              </div>
            )}
            {gelatoStatus === 'unavailable' && (
              <div className="text-[14px] font-mono text-white/28">Gelato ordering coming soon.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- WalkthroughOverlay ----------------------------------------------------

// Four steps, acid and ink, matching the splash and pricing screens. Each step
// has a mascot clip in /walkthrough (see public/walkthrough/BRIEFS.md for the
// animation briefs); until a clip is dropped in, the step falls back to its
// Phosphor icon, so this ships and looks right either way.
const WALKTHROUGH_STEPS = [
  {
    icon: Camera,
    clip: '/walkthrough/step-scan.webp',
    title: 'Scan the record',
    body: 'Point the camera at the label, the sleeve or the barcode. It reads the catalogue number and finds your exact pressing, not just the album.',
  },
  {
    icon: Check,
    clip: '/walkthrough/step-confirm.webp',
    title: 'Check the pressing',
    body: 'Wrong repress? Hit Re-identify and pick the right one. Tracklist, year and cover art come along with it.',
  },
  {
    icon: Stack,
    clip: '/walkthrough/step-file.webp',
    title: 'File it in crates',
    body: 'Sort by hand or let Smart Crates group the collection for you. Browse as a carousel, a grid, or a sortable list you can export.',
  },
  {
    icon: MusicNotes,
    clip: '/walkthrough/step-play.webp',
    title: 'Play out',
    body: 'Every track gets a BPM for building sets, and you can print sleeve labels for the records you are taking to the booth.',
  },
];

function WalkthroughOverlay({ onDismiss }) {
  const steps = WALKTHROUGH_STEPS;
  const [step, setStep] = useState(0);
  const [clipFailed, setClipFailed] = useState({});
  const isLast = step === steps.length - 1;
  const current = steps[step];
  const StepIcon = current.icon;
  const showClip = !clipFailed[step];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(8,8,12,0.75)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-sm rounded-3xl px-7 pt-7 pb-6 flex flex-col items-center text-center"
        style={{ background: '#cafe04', animation: 'fadeUp 0.3s ease-out' }}
        key={step}
      >
        {/* Mascot clip, or the icon while the clips are still being made */}
        <div className="flex items-center justify-center mb-4" style={{ height: 168, width: '100%' }}>
          {showClip ? (
            <img
              src={current.clip}
              alt=""
              onError={() => setClipFailed(f => ({ ...f, [step]: true }))}
              style={{ maxHeight: 168, maxWidth: '100%', objectFit: 'contain' }}
            />
          ) : (
            <div className="rounded-2xl flex items-center justify-center"
              style={{ width: 84, height: 84, border: '2px solid #08080c' }}>
              <StepIcon size={36} weight="light" style={{ color: '#08080c' }} />
            </div>
          )}
        </div>

        {/* Step counter */}
        <div className="font-mono mb-2" style={{ fontSize: 10, letterSpacing: '0.26em', color: 'rgba(8,8,12,0.5)' }}>
          {String(step + 1).padStart(2, '0')} / {String(steps.length).padStart(2, '0')}
        </div>

        <h2 className="text-2xl font-display mb-2.5" style={{ color: '#08080c' }}>{current.title}</h2>

        <p className="text-sm leading-relaxed mb-6" style={{ color: 'rgba(8,8,12,0.7)' }}>{current.body}</p>

        {/* Progress rail */}
        <div className="flex w-full gap-1.5 mb-6">
          {steps.map((_, i) => (
            <div key={i} className="flex-1 rounded-full transition-all" style={{
              height: 3,
              background: i <= step ? '#08080c' : 'rgba(8,8,12,0.18)',
            }} />
          ))}
        </div>

        <button
          onClick={() => { if (isLast) { onDismiss(); } else { setStep(s => s + 1); } }}
          className="w-full py-3 rounded-xl text-sm mb-2.5 transition-opacity hover:opacity-85"
          style={{ background: '#08080c', color: '#ffffff', fontWeight: 700, letterSpacing: '0.02em', border: 'none' }}
        >
          {isLast ? "Start digging" : 'Next'}
        </button>
        <button
          onClick={onDismiss}
          className="text-xs font-mono transition-opacity hover:opacity-70"
          style={{ color: 'rgba(8,8,12,0.45)' }}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

function RoadmapFooter({ accentRGB }) {
  const items = [
    { label: "Phase 1", title: "Scan and Identify", desc: "Vision · Discogs · Spotify · Done", done: true },
    { label: "Phase 2", title: "Collection", desc: "Save · crates · carousel · export · Done", done: true },
    { label: "Phase 3", title: "Record Boxes", desc: "Virtual crates · drag · multi-box assignment" },
    { label: "Phase 4", title: "DJ Mode", desc: "Camelot wheel · BPM filter · set builder" },
    { label: "Phase 5", title: "Archetype Engine", desc: "Clustering · pinnable lenses" },
  ];
  return (
    <footer className="relative z-10 px-5 md:px-10 pb-16 max-w-7xl mx-auto mt-24 md:mt-36">
      <div className="text-[13px] tracking-[0.3em] uppercase text-white/20 mb-5 font-mono">Roadmap</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {items.map((item, i) => (
          <div key={i} className="p-4 rounded-2xl" style={{ background: item.done ? "rgba(var(--fg),0.035)" : "transparent", border: item.done ? "1px solid rgba(var(--fg),0.09)" : "1px solid rgba(var(--fg),0.04)", opacity: item.done ? 1 : 0.45 }}>
            <div className="text-[11px] tracking-[0.25em] uppercase mb-2 font-mono" style={{ color: item.done ? `rgba(${accentRGB},0.6)` : "rgba(var(--fg),0.25)" }}>{item.label}</div>
            <div className="text-sm md:text-base leading-tight mb-1 font-display text-white/80">{item.title}</div>
            <div className="text-[14px] text-white/30 leading-snug">{item.desc}</div>
          </div>
        ))}
      </div>
    </footer>
  );
}
