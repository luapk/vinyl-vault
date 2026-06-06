import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Upload, VinylRecord, Sparkle, X, ArrowUpRight, Clock,
  Play, Pause, Plus, Check, CaretLeft, CaretRight, MagnifyingGlass,
  DownloadSimple, Printer, GridNine, Stack, PencilSimple, Trash,
  Scan, Info, Crown, SignOut, UserCircle, GearSix, ChartBar, Users,
} from "@phosphor-icons/react";
import { useCollection, exportCSV } from "../hooks/useCollection.js";
import { useAuth } from "../hooks/useAuth.js";
import { useTheme } from "../hooks/useTheme.js";
import AuthScreen from "./AuthScreen.jsx";
import AdminPanel from "./AdminPanel.jsx";
import CommunityView from "./Community.jsx";
import { getNotificationCount, getLastSeenTs, markNotifsSeen } from '../lib/social.js';

// ----- Genre crate list (must match api/lib/vision.js GENRE_CRATES) ---------

const GENRE_CRATES = [
  'Techno', 'Detroit', 'Chicago', 'House', 'Drum & Bass', 'Jungle', 'Garage', 'Grime', 'Dubstep',
  'Breakbeat', 'Electro', 'Chuggers', 'Ambient', 'Downtempo', 'Trip Hop', 'IDM', 'Industrial',
  'EBM', 'Wave', 'Trance', 'Hardcore', 'Rave', 'Disco', 'Italo Disco', 'Cosmic', 'Space Disco',
  'Funk', 'Soul', 'R&B', 'Jazz', 'Hip Hop', 'Reggae', 'Dub', 'Latin', 'Afrobeat', 'Classical', 'Experimental',
];

const CONDITION_GRADES = ['', 'M', 'NM', 'VG+', 'VG', 'G+', 'G', 'F', 'P'];

function conditionColor(grade) {
  if (!grade) return null;
  if (grade === 'M' || grade === 'NM') return '120,210,130';
  if (grade === 'VG+' || grade === 'VG') return '220,170,60';
  return '220,90,90';
}

function normalizeKey(artist, title) {
  return `${artist}${title}`.toLowerCase().replace(/[^a-z0-9]/g, '');
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
        resolve(canvas.toDataURL("image/jpeg", quality));
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

async function detectBPM(previewUrl) {
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

    // OfflineAudioContext with 150 Hz low-pass: isolates kick/bass transients
    const offCtx = new OfflineAudioContext(1, Math.floor(sr * dur), sr);
    const src = offCtx.createBufferSource();
    src.buffer = buffer;
    const filt = offCtx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 150;
    filt.Q.value = 0.7;
    src.connect(filt);
    filt.connect(offCtx.destination);
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

    const mean = smoothed.reduce((a, b) => a + b, 0) / smoothed.length;
    const threshold = mean * 1.4;
    const minGap = 25; // 250 ms at 10 ms/frame = max ~240 BPM

    const peaks = [];
    for (let i = 1; i < smoothed.length - 1; i++) {
      if (
        smoothed[i] > threshold &&
        smoothed[i] >= smoothed[i - 1] &&
        smoothed[i] >= smoothed[i + 1] &&
        (!peaks.length || i - peaks[peaks.length - 1] >= minGap)
      ) peaks.push(i);
    }

    if (peaks.length < 4) { bpmCache.set(previewUrl, null); return null; }

    const intervals = peaks.slice(1).map((p, i) => p - peaks[i]);
    intervals.sort((a, b) => a - b);
    const median = intervals[Math.floor(intervals.length / 2)];
    let bpm = Math.round(60 / (median * 0.01));
    while (bpm < 70) bpm *= 2;
    while (bpm > 175) bpm /= 2;
    bpm = Math.round(bpm);

    bpmCache.set(previewUrl, bpm);
    return bpm;
  } catch (e) {
    console.log('[bpm]', e.message);
    return null;
  }
}

// ----- Main Component --------------------------------------------------------

// ----- Greeting helper -------------------------------------------------------

function getGreeting(name) {
  const hour = new Date().getHours();
  let pool;
  if (hour >= 5 && hour < 12) {
    pool = [
      `Early start, ${name}. Coffee and crates?`,
      `Rise and spin, ${name}.`,
    ];
  } else if (hour >= 12 && hour < 18) {
    pool = [
      `Afternoon, ${name}. Stack's not going to sort itself.`,
      `Back at it, ${name}?`,
      `Good afternoon, ${name}. Ready to dig?`,
    ];
  } else if (hour >= 18 && hour < 22) {
    pool = [
      `Evening, ${name}. Time to spin something.`,
      `Hey ${name}, what's going in tonight?`,
      `Good evening, ${name}. The vault awaits.`,
    ];
  } else {
    pool = [
      `Late night crate-digging, ${name}?`,
      `Still at it, ${name}. Respect.`,
      `Night owl mode, ${name}.`,
      `The best finds happen late, ${name}.`,
    ];
  }
  return pool[Math.floor(Math.random() * pool.length)];
}

export default function VinylVault() {
  const { isDark, toggleTheme } = useTheme();
  const { user, profile, loading: authLoading, isAdmin, signIn, signUp, signOut, signInWithGoogle, signInWithFacebook, isSupabaseEnabled, updateDisplayName, updateProfile, updateAvatar } = useAuth();

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

  const displayName = user?.user_metadata?.display_name || profile?.display_name || user?.email?.split('@')[0] || 'there';
  // Regenerate greeting when the display name changes (e.g. after saving account settings)
  const greetingRef = useRef({ name: null, text: null });
  if (user && greetingRef.current.name !== displayName) {
    greetingRef.current = { name: displayName, text: getGreeting(displayName) };
  }
  const greeting = user ? greetingRef.current.text : null;
  const [showWalkthrough, setShowWalkthrough] = useState(() => !localStorage.getItem('walkthroughSeen'));
  const [showAccount, setShowAccount] = useState(false);
  // Community routing: which public profile is open (null = community home).
  // Mirrored to the URL (?u=username) via History API for shareable links.
  const [profileUsername, setProfileUsername] = useState(null);
  const [notifCount, setNotifCount] = useState(0);

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
  const { collection, syncedIds, addRecord, removeRecord, updateRecord, renameCrate, deleteCrate } = useCollection(userId);

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

  // Gate: show login screen when Supabase is configured but no user is logged in.
  if (isSupabaseEnabled && !authLoading && !user) {
    return <AuthScreen onSignIn={signIn} onSignUp={signUp} loading={authLoading} />;
  }
  if (isSupabaseEnabled && authLoading) {
    if (showWalkthrough) {
      return <WalkthroughOverlay onDismiss={() => { localStorage.setItem('walkthroughSeen', '1'); setShowWalkthrough(false); }} accentRGB="200,200,200" />;
    }
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4" style={{ background: "var(--bg-hex)" }}>
        <img src="/logo.png" alt="Vinyl Vault" style={{ height: 192, mixBlendMode: 'screen', opacity: 0.7, marginBottom: 8 }} />
        <div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: "rgba(var(--fg),0.1)", borderTopColor: "rgba(var(--fg),0.5)" }} />
        <span style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.25)' }}>Connecting...</span>
      </div>
    );
  }

  const processImage = async (file, forBatch = false) => {
    if (!forBatch) {
      setPhase("processing");
      setStatus("Reading sleeve");
      setErrorMsg("");
    }
    try {
      const dataUrl = await resizeImage(file);
      if (!forBatch) {
        setImageUrl(dataUrl);
        const color = await extractDominantColor(dataUrl);
        setAccent(color);
        await new Promise((r) => setTimeout(r, 400));
        setStatus("Searching Discogs");
      }
      const base64Data = dataUrl.split(",")[1];
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Data, mediaType: "image/jpeg" }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API ${response.status}: ${errorBody.slice(0, 200)}`);
      }
      const data = await response.json();
      if (forBatch) return { dataUrl, data };
      if (data.status === "disambiguation") {
        setCandidates(data.candidates);
        setVisionData(data.vision);
        setPhase("disambiguation");
      } else if (data.status === "complete") {
        setRelease(data.release);
        setPendingCrates(data.release.suggestedBoxes || []);
        setPhase("result");
        const coverSrc = data.release.coverUrl || null;
        if (coverSrc) { const c = await extractDominantColor(coverSrc); setAccent(c); }
      } else {
        throw new Error(data.error || "Unexpected response");
      }
    } catch (err) {
      if (forBatch) throw err;
      console.error(err);
      setErrorMsg(err.message || "Identification failed");
      setPhase("error");
    }
  };

  const pickCandidate = async (candidate) => {
    setPhase("processing");
    setStatus("Pulling release data");
    setErrorMsg("");
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discogsId: candidate.id, vision: visionData }),
      });
      if (!response.ok) throw new Error(`API ${response.status}`);
      const data = await response.json();
      if (data.status === "complete") {
        setRelease(data.release);
        setPendingCrates(data.release.suggestedBoxes || []);
        setPhase("result");
        if (data.release.coverUrl) { const c = await extractDominantColor(data.release.coverUrl); setAccent(c); }
      } else {
        throw new Error(data.error || "Unexpected response");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Enrichment failed");
      setPhase("error");
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
    const items = Array.from(files).map((file) => ({
      file, status: "queued", release: null, candidates: null, vision: null, imageUrl: null,
    }));
    syncQueue(items);
    setAppView("batch");
    setBatchProcessing(true);

    // Always read from the ref before writing so concurrent resolveBatchDisambiguation
    // calls on other indices are never overwritten.
    for (let i = 0; i < items.length; i++) {
      const qPre = [...batchQueueRef.current];
      qPre[i] = { ...qPre[i], status: "processing" };
      syncQueue(qPre);

      try {
        const { dataUrl, data } = await processImage(items[i].file, true);
        const q = [...batchQueueRef.current];
        q[i] = { ...q[i], imageUrl: dataUrl };
        if (data.status === "complete") {
          q[i] = { ...q[i], status: "complete", release: data.release };
          const batchRelease = !data.release.coverUrl && dataUrl ? { ...data.release, coverUrl: dataUrl } : data.release;
          syncQueue(q);
          // Crates are user-organisational, not derived from metadata. Genres
          // already flow into the record's tags inside recordFromRelease.
          addRecord(batchRelease, []).catch(console.error);
        } else if (data.status === "disambiguation") {
          q[i] = { ...q[i], status: "disambiguation", candidates: data.candidates, vision: data.vision };
          syncQueue(q);
        } else {
          q[i] = { ...q[i], status: "error" };
          syncQueue(q);
        }
      } catch {
        const q = [...batchQueueRef.current];
        q[i] = { ...q[i], status: "error" };
        syncQueue(q);
      }
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
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discogsId: candidate.id, vision }),
      });
      const data = await response.json();
      // Re-snapshot from ref in case another resolve completed while we awaited
      const latest = [...batchQueueRef.current];
      if (data.status === "complete") {
        latest[itemIdx] = { ...latest[itemIdx], status: "complete", release: data.release };
        const disambigScanUrl = latest[itemIdx].imageUrl;
        const disambigRelease = !data.release.coverUrl && disambigScanUrl ? { ...data.release, coverUrl: disambigScanUrl } : data.release;
        addRecord(disambigRelease, []).catch(console.error);
      } else {
        latest[itemIdx] = { ...latest[itemIdx], status: "error" };
      }
      syncQueue(latest);
    } catch {
      const latest = [...batchQueueRef.current];
      latest[itemIdx] = { ...latest[itemIdx], status: "error" };
      syncQueue(latest);
    }
  };

  const allCrates = [...new Set(collection.flatMap((r) => r.crates || []))].sort();
  const accentRGB = `${accent.r}, ${accent.g}, ${accent.b}`;

  const navItems = [
    { id: "scan", label: "Scan", icon: Scan },
    { id: "collection", label: collection.length ? `Collection (${collection.length})` : "Collection", icon: VinylRecord},
    { id: "stats", label: "Stats", icon: ChartBar },
    ...(isSupabaseEnabled && user ? [{ id: "community", label: "Community", icon: Users, badge: notifCount }] : []),
    { id: "about", label: "About", icon: Info },
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
      <header className="sticky top-0 z-30 px-5 md:px-10 py-3 flex items-center justify-between gap-3" style={{ background: "rgba(var(--bg),0.80)", backdropFilter: "blur(24px) saturate(180%)", WebkitBackdropFilter: "blur(24px) saturate(180%)", borderBottom: "1px solid rgba(var(--fg),0.07)" }}>
        <div className="flex items-center shrink-0">
          <img src="/logo.png" alt="Vinyl Vault" style={{ height: 90, mixBlendMode: "screen", opacity: 0.92 }} />
        </div>

        <nav className="flex items-center gap-1.5 flex-wrap">
          {navItems.map(({ id, label, icon: Icon, badge }) => (
            <button
              key={id}
              onClick={() => {
                if (id === "community") { openCommunityHome(); return; }
                setAppView(id);
                if (id === "scan" && appView !== "scan") reset();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all"
              style={appView === id
                ? { background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.35)`, color: `rgb(${accentRGB})`, boxShadow: `0 0 12px -4px rgba(${accentRGB},0.3)` }
                : { background: "transparent", border: `1px solid rgba(var(--fg),${isDark ? 0.07 : 0.15})`, color: `rgba(var(--fg),${isDark ? 0.4 : 0.6})` }
              }
            >
              <span className="relative inline-flex items-center">
                <Icon size={16} weight={appView === id ? "bold" : "regular"} />
                {badge > 0 && (
                  <span style={{ position: 'absolute', top: -5, right: -5, minWidth: 14, height: 14, borderRadius: 7, background: '#22c55e', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 8, fontWeight: 700, color: '#000', lineHeight: 1, padding: '0 3px' }}>
                    {badge > 9 ? '9+' : badge}
                  </span>
                )}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </nav>

        {/* Account button */}
        {isSupabaseEnabled && user && (
          <button onClick={() => setShowAccount(true)} title="Account settings"
            className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center shrink-0 transition-opacity hover:opacity-70"
            style={{ border: "1px solid rgba(var(--fg),0.18)", background: "rgba(var(--fg),0.06)" }}>
            {profile?.avatar_url
              ? <img src={profile.avatar_url} alt="Profile" className="w-full h-full object-cover" />
              : <span style={{ fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: 'rgba(var(--fg),0.45)', lineHeight: 1 }}>
                  {(user?.user_metadata?.display_name || user?.email || '?')[0].toUpperCase()}
                </span>
            }
          </button>
        )}
      </header>

      {/* Main */}
      <main className="relative px-5 md:px-10 pb-20 max-w-7xl mx-auto">
        {appView === "admin" && (
          <AdminPanel onBack={() => setAppView("collection")} />
        )}
        {appView === "scan" && (
          <>
            {phase === "idle" && <IdleView onUpload={processImage} onBatch={startBatch} accentRGB={accentRGB} greeting={greeting} collection={collection} />}
            {phase === "processing" && <ProcessingView imageUrl={imageUrl} status={status} accentRGB={accentRGB} />}
            {phase === "disambiguation" && (
              <>
                <div className="flex justify-center pt-4 pb-1">
                  <button onClick={reset} className="text-[11px] tracking-[0.15em] uppercase font-mono px-5 py-2 rounded-full transition-all" style={{ border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.40)", background: "rgba(var(--fg),0.03)" }}>
                    New scan
                  </button>
                </div>
                <DisambiguationView candidates={candidates} vision={visionData} imageUrl={imageUrl} accentRGB={accentRGB} onPick={pickCandidate} />
              </>
            )}
            {phase === "result" && release && (
              <ResultView release={release} imageUrl={imageUrl} accentRGB={accentRGB} pendingCrates={pendingCrates} setPendingCrates={setPendingCrates} allCrates={allCrates} onSave={saveRecord} saved={!!savedId} onBpmDetected={updateReleaseBpm} onHotToggle={toggleReleaseHot} onReset={reset} collection={collection} />
            )}
            {phase === "error" && <ErrorView message={errorMsg} onReset={reset} />}
          </>
        )}
        {appView === "collection" && (
          <CollectionView collection={collection} syncedIds={syncedIds} accentRGB={accentRGB} onRemove={removeRecord} onUpdate={updateRecord} onRenameCrate={renameCrate} onDeleteCrate={deleteCrate} onDownloadCSV={() => downloadCSV(collection)} labelSelectMode={labelSelectMode} selectedForLabels={selectedForLabels} showBatchLabelModal={showBatchLabelModal} onToggleLabelSelect={toggleLabelSelect} onEnterLabelMode={enterLabelMode} onExitLabelMode={exitLabelMode} onShowBatchLabelModal={setShowBatchLabelModal} />
        )}
        {appView === "batch" && (
          <BatchView queue={batchQueue} processing={batchProcessing} onResolve={resolveBatchDisambiguation} onBatch={startBatch} accentRGB={accentRGB} />
        )}
        {appView === "stats" && <StatsView collection={collection} accentRGB={accentRGB} />}
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
          />
        )}
        {appView === "about" && <AboutView accentRGB={accentRGB} />}
      </main>

      {showWalkthrough && appView === 'scan' && (
        <WalkthroughOverlay onDismiss={() => {
          localStorage.setItem('walkthroughSeen', '1');
          setShowWalkthrough(false);
        }} accentRGB={accentRGB} />
      )}

      {saveAnim && <SaveConfirmation release={saveAnim.release} accentRGB={accentRGB} />}

      {showAccount && (
        <AccountModal
          user={user}
          profile={profile}
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
          isAdmin={isAdmin}
          onOpenAdmin={() => { setShowAccount(false); setAppView('admin'); }}
        />
      )}
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
          <div style={{ fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.35)', marginBottom: 1.5 }}>Added to collection</div>
          <div style={{ fontSize: 12, color: 'rgba(var(--fg),0.85)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis' }}>{release.artist} — {release.title}</div>
        </div>
        <VinylRecord size={15} weight="fill" style={{ color: `rgba(${accentRGB},0.65)`, flexShrink: 0, marginLeft: 2 }} />
      </div>
    </div>
  );
}

// ----- IdleView --------------------------------------------------------------

function IdleView({ onUpload, onBatch, accentRGB, greeting, collection = [] }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const [showCamera, setShowCamera] = useState(false);
  const [recs, setRecs] = useState([]);
  const [recsSource, setRecsSource] = useState([]);

  useEffect(() => {
    const CACHE_KEY = 'vv_recs_v3';
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

    fetch(`/api/recommendations?${params}`)
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

  return (
    <div className="pt-10 md:pt-20 flex flex-col items-center">
      {/* Heading section - left-aligned */}
      <div className="w-full max-w-2xl mb-14 md:mb-20">
        <div className="text-[10px] tracking-[0.35em] uppercase mb-5 text-white/30 font-mono">New scan</div>
        <h1 className="text-5xl md:text-7xl leading-[0.92] mb-5 font-display tracking-tight text-left" style={{ animation: 'fadeUp 0.4s ease-out' }}>
          {greeting
            ? <>{greeting.split('.')[0]}{/[?!]$/.test(greeting.split('.')[0]) ? '' : '.'}<br /><span className="text-white/35">{greeting.split('.').slice(1).join('.').trim()}</span></>
            : <>Stack your wax<br /><span className="text-white/35">the easy way.</span></>
          }
        </h1>
        <p className="text-white/45 text-base md:text-lg max-w-lg leading-relaxed">
          Photograph a sleeve. Get the pressing confirmed, the tracklist loaded, BPM data attached, and the record filed exactly where you want it.
        </p>
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
          background: `linear-gradient(145deg, rgba(255,255,255,0.48) 0%, rgba(${accentRGB},0.05) 60%, rgba(255,255,255,0.34) 100%)`,
          boxShadow: `inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.03), 0 16px 48px -12px rgba(0,0,0,0.16), 0 4px 12px -4px rgba(0,0,0,0.09), 0 0 0 1px rgba(255,255,255,0.7), 0 0 48px -10px rgba(${accentRGB},0.28)`,
          backdropFilter: 'blur(44px) saturate(240%)', WebkitBackdropFilter: 'blur(44px) saturate(240%)', borderRadius: '20px', padding: '2rem',
        } : { background: 'linear-gradient(145deg, rgba(var(--fg),0.08) 0%, rgba(var(--fg),0.03) 100%)', boxShadow: `inset 0 1px 0 rgba(var(--fg),0.15), inset 0 -1px 0 rgba(0,0,0,0.2), 0 32px 64px -20px rgba(0,0,0,0.7), 0 8px 16px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(var(--fg),0.08), 0 0 60px -20px rgba(${accentRGB},0.25)`, backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '20px', padding: '2rem' }}>
          <div className="flex flex-col items-center gap-5 text-center">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: `linear-gradient(145deg, rgba(${accentRGB},0.3), rgba(${accentRGB},0.08))`, boxShadow: isLight ? `inset 0 1px 0 rgba(255,255,255,0.7), 0 4px 12px rgba(${accentRGB},0.18)` : 'inset 0 1px 0 rgba(var(--fg),0.2), 0 4px 12px rgba(0,0,0,0.3)' }}>
              <Camera size={22} weight="light" style={{ color: `rgb(${accentRGB})` }} />
            </div>
            <div>
              <div className="text-[10px] tracking-[0.25em] uppercase text-white/35 mb-1 font-mono">Single record</div>
              <div className="text-lg font-display">Scan a sleeve</div>
            </div>
          </div>
          {/* Primary: open camera viewfinder */}
          <button onClick={() => setShowCamera(true)} className="absolute inset-0 w-full h-full" style={{ borderRadius: '20px' }} aria-label="Open camera" />
        </div>

        {/* Batch queue card */}
        <label className="relative block cursor-pointer transition-all hover:brightness-110 active:scale-[0.98]" style={isLight ? {
          background: 'linear-gradient(145deg, rgba(255,255,255,0.48) 0%, rgba(200,180,255,0.08) 60%, rgba(255,255,255,0.34) 100%)',
          boxShadow: 'inset 0 1px 0 rgba(255,255,255,1), inset 0 -1px 0 rgba(0,0,0,0.03), 0 16px 48px -12px rgba(0,0,0,0.16), 0 4px 12px -4px rgba(0,0,0,0.09), 0 0 0 1px rgba(255,255,255,0.7)',
          backdropFilter: 'blur(44px) saturate(240%)', WebkitBackdropFilter: 'blur(44px) saturate(240%)', borderRadius: '20px', padding: '2rem',
        } : { background: 'linear-gradient(145deg, rgba(var(--fg),0.08) 0%, rgba(var(--fg),0.03) 100%)', boxShadow: 'inset 0 1px 0 rgba(var(--fg),0.15), inset 0 -1px 0 rgba(0,0,0,0.2), 0 32px 64px -20px rgba(0,0,0,0.7), 0 8px 16px -8px rgba(0,0,0,0.4), 0 0 0 1px rgba(var(--fg),0.08)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderRadius: '20px', padding: '2rem' }}>
          <div className="relative z-10 flex flex-col items-center gap-5 text-center">
            <div className="w-12 h-12 rounded-2xl flex items-center justify-center" style={{ background: isLight ? 'linear-gradient(145deg, rgba(160,130,255,0.18), rgba(160,130,255,0.06))' : 'linear-gradient(145deg, rgba(var(--fg),0.10), rgba(var(--fg),0.03))', boxShadow: isLight ? 'inset 0 1px 0 rgba(255,255,255,0.9), 0 2px 10px rgba(160,130,255,0.22)' : 'inset 0 1px 0 rgba(var(--fg),0.12), 0 4px 12px rgba(0,0,0,0.3)' }}>
              <GridNine size={22} weight="light" style={{ color: isLight ? 'rgba(120,90,220,0.80)' : undefined }} className={isLight ? '' : 'text-white/45'} />
            </div>
            <div>
              <div className="text-[10px] tracking-[0.25em] uppercase text-white/35 mb-1 font-mono">Multiple records</div>
              <div className="text-lg font-display text-white/70">Batch queue</div>
            </div>
          </div>
          <input type="file" accept="image/*" multiple onChange={(e) => { if (e.target.files?.length) onBatch(e.target.files); }} style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} />
        </label>
        </div>{/* end grid */}
      </div>{/* end relative wrapper */}

      {/* "or choose from library" centred below the grid */}
      <div className="mt-4 flex justify-center">
        <label className="inline-flex items-center gap-1.5 text-[11px] font-mono text-white/28 hover:text-white/50 transition-colors cursor-pointer">
          <Upload size={11} />
          or choose a photo from library
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} />
        </label>
      </div>

      {showCamera && <CameraModal onCapture={handleCapture} onClose={() => setShowCamera(false)} />}

      {/* Recommendations */}
      {recs.length > 0 && (
        <div className="mt-8 w-full max-w-2xl mx-auto" style={{ animation: 'fadeUp 0.5s ease-out 0.15s both' }}>
          <div className="mb-4">
            <div className="text-[10px] tracking-[0.35em] uppercase font-mono whitespace-nowrap" style={{ color: `rgba(var(--fg),${isLight ? 0.55 : 0.3})` }}>Picked for you</div>
            {recsSource.length > 0 && (
              <div className="text-[9px] font-mono mt-1 truncate" style={{ color: `rgba(var(--fg),${isLight ? 0.52 : 0.2})`, letterSpacing: '0.10em' }}>
                {recsSource.slice(0, 2).join(' / ')}{recsSource.length > 2 ? ` +${recsSource.length - 2}` : ''}
              </div>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {recs.map(rec => (
              <div key={rec.id} style={{ background: `linear-gradient(145deg, rgba(var(--fg),${isLight ? 0.06 : 0.07}) 0%, rgba(var(--fg),0.02) 100%)`, border: `1px solid rgba(var(--fg),${isLight ? 0.13 : 0.08})`, borderRadius: 14, overflow: 'hidden' }}>
                <div style={{ aspectRatio: '1/1', background: 'rgba(var(--fg),0.05)', overflow: 'hidden' }}>
                  {rec.thumb
                    ? <img src={rec.thumb} alt={rec.title} className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center"><VinylRecord size={24} weight="thin" className="opacity-20" /></div>
                  }
                </div>
                <div style={{ padding: '10px 10px 10px' }}>
                  <div style={{ fontSize: 9, color: `rgba(var(--fg),${isLight ? 0.65 : 0.4})`, fontFamily: 'monospace', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{rec.artist || 'Various'}</div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'rgba(var(--fg),0.85)', lineHeight: 1.3, marginBottom: 3, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{rec.title}</div>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: `rgba(var(--fg),${isLight ? 0.52 : 0.28})`, marginBottom: 5 }}>
                    {[rec.label, rec.year].filter(Boolean).join(' · ')}
                  </div>
                  {rec.reason && (
                    <div style={{ fontSize: 9, fontStyle: 'italic', color: `rgba(${accentRGB},${isLight ? 1 : 0.7})`, lineHeight: 1.4, marginBottom: 6 }}>{rec.reason}</div>
                  )}
                  <div style={{ fontSize: 8, fontFamily: 'monospace', color: `rgba(var(--fg),${isLight ? 0.5 : 0.2})`, marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Discogs Marketplace</div>
                  <a href={rec.buyUrl} target="_blank" rel="noopener noreferrer"
                    style={{ display: 'block', textAlign: 'center', padding: '6px 0', borderRadius: 8, fontSize: 10, fontWeight: 700, fontFamily: 'monospace', background: `rgb(${accentRGB})`, border: 'none', color: '#fff', textDecoration: 'none', letterSpacing: '0.12em', textTransform: 'uppercase', boxShadow: `0 2px 8px rgba(${accentRGB},0.35)` }}
                    onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; }}
                    onMouseLeave={e => { e.currentTarget.style.filter = 'none'; }}>
                    Buy now
                  </a>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ----- ProcessingView --------------------------------------------------------

function ProcessingView({ imageUrl, status, accentRGB }) {
  return (
    <div className="pt-16 flex flex-col items-center">
      <div className="relative w-full max-w-[380px] aspect-square rounded-2xl overflow-hidden" style={{ boxShadow: `0 40px 80px -20px rgba(0,0,0,0.7), 0 0 0 1px rgba(var(--fg),0.07)` }}>
        {imageUrl && <img src={imageUrl} alt="Scanning" className="w-full h-full object-cover" />}
        <div className="absolute left-0 right-0 h-[2px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent, rgba(${accentRGB},1), transparent)`, boxShadow: `0 0 24px rgba(${accentRGB},0.9)`, animation: "scanLine 2s ease-in-out infinite" }} />
        <div className="absolute inset-0 pointer-events-none" style={{ backgroundImage: `linear-gradient(rgba(var(--fg),0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(var(--fg),0.025) 1px, transparent 1px)`, backgroundSize: "28px 28px" }} />
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 60px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(var(--fg),0.06)` }} />
      </div>
      <div className="mt-7 text-[11px] tracking-[0.3em] uppercase flex items-center gap-2.5 font-mono" style={{ color: `rgb(${accentRGB})` }}>
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: `rgb(${accentRGB})`, animation: "pulse 1.4s ease-in-out infinite" }} />
        {status}
      </div>
    </div>
  );
}

// ----- ResultView ------------------------------------------------------------

function ResultView({ release, imageUrl, accentRGB, pendingCrates, setPendingCrates, allCrates, onSave, saved, onBpmDetected, onHotToggle, onReset, collection = [] }) {
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
      detectBPM(track.previewUrl).then(bpm => {
        if (bpm != null) onBpmDetected?.(i, bpm);
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
    audioRef.current = audio;
    audio.play().catch(() => {});
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

  // Custom crates from existing collection (non-genre) minus already-pending
  const existingCustom = allCrates.filter(c => !pendingCrates.includes(c) && !GENRE_CRATES.includes(c));

  const duplicate = release && collection.find(r =>
    (release.id && r.discogsId && String(r.discogsId) === String(release.id)) ||
    normalizeKey(r.artist, r.title) === normalizeKey(release.artist || '', release.title || '')
  );

  return (
    <div className="pt-6 md:pt-10 space-y-6" style={{ animation: "fadeUp 0.6s ease-out" }}>
      {/* Duplicate warning */}
      {duplicate && !saved && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderRadius: 12, background: 'rgba(240,190,60,0.07)', border: '1px solid rgba(240,190,60,0.22)' }}>
          <span style={{ fontSize: 14, color: 'rgba(240,190,60,0.85)' }}>!</span>
          <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(240,190,60,0.85)' }}>
            You already own this -- <span style={{ fontStyle: 'italic' }}>{duplicate.artist}</span> {duplicate.title}
          </div>
        </div>
      )}
      {/* Top bar */}
      <div className="flex items-center">
        <button onClick={onReset} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.13)", color: "rgba(var(--fg),0.55)", background: "rgba(var(--fg),0.04)" }}>
          <CaretLeft size={12} />New scan
        </button>
      </div>
      {/* Meta bar */}
      <div className="flex items-center gap-3 flex-wrap">
        <ConfidenceBadge confidence={release.confidence} identified={release.identified} accentRGB={accentRGB} />
        {release.source && release.source !== "vision" && (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] tracking-[0.2em] uppercase font-mono text-white/35" style={{ border: "1px solid rgba(var(--fg),0.07)" }}>
            {release.source === "discogs+spotify" ? "Discogs + Spotify" : "Discogs"}
          </div>
        )}
        {release.notes && <div className="text-[11px] text-white/40 font-mono">{release.notes}</div>}
      </div>

      {/* Cover + details */}
      <div className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-10">
        {/* Image gallery */}
        <div className="relative">
          <div className="relative w-full md:w-[300px] lg:w-[360px] aspect-square rounded-2xl overflow-hidden" style={{ boxShadow: `0 40px 90px -20px rgba(${accentRGB},0.45), 0 0 0 1px rgba(var(--fg),0.07)` }} onTouchStart={onImgTouchStart} onTouchEnd={onImgTouchEnd}>
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
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/35 mb-3 font-mono">
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
                <button key={name} onClick={() => toggleCrate(name)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all" style={{ background: "rgba(var(--fg),0.09)", border: "1px solid rgba(var(--fg),0.22)", color: "rgba(var(--fg),0.85)" }}>
                  <Check size={11} weight="bold" />{name}<X size={10} className="opacity-50 ml-0.5" />
                </button>
              ))}
            </div>
          )}

          {/* Custom crates from existing collection */}
          {existingCustom.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {existingCustom.map((name) => (
                <button key={name} onClick={() => toggleCrate(name)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono transition-all hover:border-white/20 hover:text-white/55" style={{ background: "transparent", border: "1px solid rgba(var(--fg),0.08)", color: "rgba(var(--fg),0.32)" }}>
                  <Plus size={9} />{name}
                </button>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <input value={crateInput} onChange={(e) => setCrateInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addCustomCrate()} placeholder="Create a custom crate..." className="flex-1 rounded-full px-4 py-2 text-[12px] font-mono text-white/60 placeholder-white/20 outline-none" style={{ background: "rgba(var(--fg),0.04)", border: "1px solid rgba(var(--fg),0.09)" }} />
            <button onClick={addCustomCrate} className="px-4 py-2 rounded-full text-[11px] font-mono transition-all hover:text-white/70" style={{ border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.40)", background: "transparent" }}>Add</button>
          </div>

          {/* Grade before saving */}
          {!saved && (
            <div className="flex items-center gap-4 py-1">
              <span style={{ fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.22em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.25)' }}>Grade</span>
              <ConditionSelect label="Vinyl" value={pendingMedia} onChange={setPendingMedia} />
              <ConditionSelect label="Sleeve" value={pendingSleeve} onChange={setPendingSleeve} />
            </div>
          )}

          <button onClick={() => saved ? onReset() : onSave(images[imgIdx] || imageUrl, { mediaCondition: pendingMedia, sleeveCondition: pendingSleeve })} className="w-full py-3 rounded-xl text-[12px] tracking-[0.2em] uppercase font-mono transition-all"
            style={saved
              ? { background: "rgba(100,210,120,0.18)", border: "1px solid rgba(100,210,120,0.50)", color: "rgb(140,230,160)", boxShadow: "0 0 24px -8px rgba(100,210,120,0.4)" }
              : { background: "rgba(var(--fg),0.10)", border: "1px solid rgba(var(--fg),0.22)", color: "#fff", boxShadow: `0 0 24px -8px rgba(${accentRGB},0.5)` }}>
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

const CRATE_PALETTE = [
  { id: 'cyan',    hex: '#22d3ee' },
  { id: 'amber',   hex: '#f59e0b' },
  { id: 'rose',    hex: '#f43f5e' },
  { id: 'violet',  hex: '#8b5cf6' },
  { id: 'emerald', hex: '#10b981' },
];

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

function CollectionView({ collection, syncedIds, accentRGB, onRemove, onUpdate, onRenameCrate, onDeleteCrate, onDownloadCSV, labelSelectMode, selectedForLabels, showBatchLabelModal, onToggleLabelSelect, onEnterLabelMode, onExitLabelMode, onShowBatchLabelModal }) {
  const [collectionMode, setCollectionMode] = useState("stacks"); // stacks | explore
  const [viewMode, setViewMode] = useState("carousel");
  const [search, setSearch] = useState("");
  const [filterCrate, setFilterCrate] = useState(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [showCrateManager, setShowCrateManager] = useState(false);
  const [detailRecordId, setDetailRecordId] = useState(null);
  const detailRecord = detailRecordId ? collection.find(r => r.id === detailRecordId) || null : null;
  const [crateColors, setCrateColorsState] = useState(loadCrateColors);

  const setCrateColor = (name, hex) => {
    setCrateColorsState(prev => {
      const next = { ...prev };
      if (hex) next[name] = hex; else delete next[name];
      localStorage.setItem('vinylvault_crate_colors', JSON.stringify(next));
      return next;
    });
  };

  // Only user-created crates — tags and genres stay out of this list
  const allCrates = [...new Set(collection.flatMap((r) => r.crates || []))].sort();

  const filtered = collection.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = !q
      || r.artist.toLowerCase().includes(q)
      || r.title.toLowerCase().includes(q)
      || (r.label || "").toLowerCase().includes(q)
      || (r.catalogNumber || "").toLowerCase().includes(q)
      || (r.tags || []).some((t) => t.toLowerCase().includes(q));
    const matchCrate = !filterCrate || (r.crates || []).includes(filterCrate);
    return matchSearch && matchCrate;
  });

  useEffect(() => { setCarouselIdx(0); }, [search, filterCrate]);

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
          {[{ id: "stacks", label: "Collection" }, { id: "explore", label: "Explore by tag" }].map(({ id, label }) => (
            <button key={id} onClick={() => setCollectionMode(id)} className="px-4 py-1.5 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono transition-all"
              style={collectionMode === id
                ? { background: "rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.85)", boxShadow: "0 1px 0 rgba(var(--fg),0.08)" }
                : { background: "transparent", color: "rgba(var(--fg),0.52)" }}>
              {label}
            </button>
          ))}
        </div>

        {collectionMode === "stacks" && (
          <div className="flex items-center gap-2">
            {!labelSelectMode ? (
              <>
                <button onClick={() => setShowCrateManager(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.52)", background: "transparent" }}>
                  <PencilSimple size={12} />Crates
                </button>
                <button onClick={onDownloadCSV} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.52)", background: "transparent" }}>
                  <DownloadSimple size={12} />CSV
                </button>
                <button onClick={onEnterLabelMode} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.52)", background: "transparent" }}>
                  <Printer size={12} />Labels
                </button>
              </>
            ) : (
              <>
                <span className="text-[11px] font-mono text-white/40">{selectedForLabels.size} selected</span>
                <button
                  onClick={() => onShowBatchLabelModal(true)}
                  disabled={selectedForLabels.size === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all"
                  style={{ border: `1px solid rgba(${accentRGB},${selectedForLabels.size > 0 ? '0.4' : '0.12'})`, color: selectedForLabels.size > 0 ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.2)', background: selectedForLabels.size > 0 ? `rgba(${accentRGB},0.12)` : 'transparent', cursor: selectedForLabels.size === 0 ? 'not-allowed' : 'pointer' }}>
                  <Printer size={12} />Preview Labels
                </button>
                <button onClick={onExitLabelMode} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.08)", color: "rgba(var(--fg),0.38)", background: "transparent" }}>
                  Cancel
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* EXPLORE MODE */}
      {collectionMode === "explore" && (
        <ExploreView collection={collection} accentRGB={accentRGB} onSelectRecord={(r) => setDetailRecordId(r.id)} />
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
              {[{ id: "carousel", Icon: Stack }, { id: "grid", Icon: GridNine }].map(({ id, Icon }) => (
                <button key={id} onClick={() => setViewMode(id)} className="px-3 py-2 transition-all" style={{ background: viewMode === id ? "rgba(var(--fg),0.09)" : "transparent", color: viewMode === id ? "rgba(var(--fg),0.85)" : "rgba(var(--fg),0.50)" }}>
                  <Icon size={14} />
                </button>
              ))}
            </div>
          </div>

          {/* Crate filters — user crates only */}
          {allCrates.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              {allCrates.map((c) => {
                const col = crateColors[c] || null;
                const active = filterCrate === c;
                return (
                  <button key={c} onClick={() => setFilterCrate(active ? null : c)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] tracking-[0.12em] uppercase font-mono transition-all"
                    style={{
                      background: active ? (col ? `${col}22` : 'rgba(var(--fg),0.10)') : (col ? `${col}0d` : 'rgba(var(--fg),0.025)'),
                      border: active ? `1px solid ${col || 'rgba(var(--fg),0.28)'}` : `1px solid ${col ? col + '55' : 'rgba(var(--fg),0.12)'}`,
                      color: active ? 'rgba(var(--fg),0.88)' : 'rgba(var(--fg),0.52)',
                      boxShadow: active && col ? `0 0 14px -3px ${col}66` : 'none',
                    }}>
                    <RotatingCube color={col || 'rgba(var(--fg),0.4)'} size={8} />
                    {c}
                  </button>
                );
              })}
            </div>
          )}

          <div className="text-[10px] tracking-[0.2em] uppercase text-white/40 mb-5 font-mono">{filtered.length} record{filtered.length !== 1 ? "s" : ""}</div>

          {filtered.length === 0 && <div className="text-center py-16 text-white/40 text-sm font-mono">No records match.</div>}

          {viewMode === "carousel" && filtered.length > 0 && (
            <VinylCarousel records={filtered} index={carouselIdx} onIndexChange={setCarouselIdx} onPrev={goPrev} onNext={goNext} onSelect={(r) => setDetailRecordId(r.id)} onRemove={onRemove} accentRGB={accentRGB} crateColors={crateColors} selectMode={labelSelectMode} selectedIds={selectedForLabels} onToggleSelect={onToggleLabelSelect} onUpdate={onUpdate} allCrates={allCrates} />
          )}
          {viewMode === "grid" && filtered.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {filtered.map((record) => (
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
          )}
        </>
      )}

      {detailRecord && <RecordDetailModal record={detailRecord} onClose={() => setDetailRecordId(null)} onRemove={() => { onRemove(detailRecord.id); setDetailRecordId(null); }} onUpdate={onUpdate} accentRGB={accentRGB} crateColors={crateColors} allCrates={allCrates} />}
      {showCrateManager && <CrateManagerModal crates={allCrates} onClose={() => setShowCrateManager(false)} onRename={onRenameCrate} onDelete={onDeleteCrate} crateColors={crateColors} onSetColor={setCrateColor} />}
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

// ----- VinylCarousel ---------------------------------------------------------

function VinylCarousel({ records, index, onIndexChange, onPrev, onNext, onSelect, onRemove, accentRGB, crateColors = {}, selectMode = false, selectedIds = new Set(), onToggleSelect, onUpdate, allCrates = [] }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const startXRef = useRef(null);
  const startTimeRef = useRef(null);
  const didDragRef = useRef(false);
  const rafRef = useRef(null);
  const [visualDelta, setVisualDelta] = useState(0);
  const [showCratePicker, setShowCratePicker] = useState(false);
  const [cratePickerInput, setCratePickerInput] = useState('');

  const onTouchStart = (e) => {
    startXRef.current = e.touches[0].clientX;
    startTimeRef.current = performance.now();
    didDragRef.current = false;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setVisualDelta(0);
  };

  const onTouchMove = (e) => {
    if (startXRef.current === null) return;
    const delta = e.touches[0].clientX - startXRef.current;
    if (Math.abs(delta) > 6) didDragRef.current = true;
    if (!didDragRef.current) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => setVisualDelta(delta));
  };

  const onTouchEnd = (e) => {
    if (startXRef.current === null) return;
    const lastX = e.changedTouches[0].clientX;
    const delta = lastX - startXRef.current;
    const velocity = delta / Math.max(performance.now() - startTimeRef.current, 1);
    const wasDrag = didDragRef.current;
    startXRef.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    setVisualDelta(0);
    if (!wasDrag) return;
    // Advance on distance or velocity threshold (velocity in px/ms)
    if (delta < -40 || velocity < -0.22) onNext();
    else if (delta > 40 || velocity > 0.22) onPrev();
  };

  const current = records[index];
  if (!current) return null;
  const isDragging = visualDelta !== 0;

  // Close picker when navigating to a different record
  useEffect(() => { setShowCratePicker(false); }, [index]);

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
                    ? `0 50px 100px -18px rgba(0,0,0,0.95), 0 0 65px -8px rgba(${accentRGB},0.28), 0 2px 0 0px rgba(0,0,0,0.7), 0 4px 0 0px rgba(0,0,0,0.42), 0 7px 0 0px rgba(0,0,0,0.2), 0 0 0 1px rgba(var(--fg),0.17), inset 0 1px 0 rgba(var(--fg),0.32), inset 0 0 40px rgba(${accentRGB},0.04)`
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
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="mt-7 text-center">
        <div key={current.id} style={{ animation: "fadeOnly 0.12s ease-out" }}>
        <div className="text-[10px] tracking-[0.25em] uppercase text-white/30 mb-1.5 font-mono">
          {[current.year, current.format, current.country].filter(Boolean).join(" · ")}
        </div>
        <div className="text-xl md:text-2xl leading-tight font-display"><span className="italic">{current.artist}</span></div>
        <div className="text-base md:text-lg text-white/50 font-display mb-3">{current.title}</div>

        {/* Crate badges + edit toggle */}
        <div className="flex flex-wrap justify-center gap-1.5 mb-2">
          {(current.crates || []).map((c) => {
            const col = crateColors[c] || null;
            return (
              <span key={c} className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono"
                style={{
                  background: col ? `${col}1a` : `rgba(${accentRGB},0.1)`,
                  border: `1px solid ${col ? col + '55' : `rgba(${accentRGB},0.22)`}`,
                  color: 'rgba(var(--fg),0.65)',
                  boxShadow: col ? `0 0 10px -3px ${col}55` : 'none',
                }}>
                <RotatingCube color={col || `rgb(${accentRGB})`} size={7} />
                {c}
              </span>
            );
          })}
          {!selectMode && onUpdate && (
            <button onClick={() => { setShowCratePicker(p => !p); setCratePickerInput(''); }}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono transition-all"
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
                    <button key={c} onClick={() => toggleCrate(c)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono transition-all" style={{ background: 'rgba(var(--fg),0.09)', border: '1px solid rgba(var(--fg),0.22)', color: 'rgba(var(--fg),0.85)' }}>
                      <Check size={9} weight="bold" />{c}<X size={8} className="opacity-50 ml-0.5" />
                    </button>
                  ))}
                </div>
              )}
              {/* Genre list */}
              <div className="flex flex-wrap justify-center gap-1.5">
                {GENRE_CRATES.filter(g => !recordCrates.includes(g)).map(g => (
                  <button key={g} onClick={() => toggleCrate(g)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono transition-all hover:border-white/20 hover:text-white/55" style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.32)' }}>
                    <Plus size={9} />{g}
                  </button>
                ))}
              </div>
              {/* Custom crates */}
              {customOther.length > 0 && (
                <div className="flex flex-wrap justify-center gap-1.5">
                  {customOther.map(c => (
                    <button key={c} onClick={() => toggleCrate(c)} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono transition-all hover:border-white/20 hover:text-white/55" style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.32)' }}>
                      <Plus size={9} />{c}
                    </button>
                  ))}
                </div>
              )}
              {/* Custom input */}
              <div className="flex gap-2">
                <input value={cratePickerInput} onChange={e => setCratePickerInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCustom()} placeholder="Create a custom crate..." className="flex-1 rounded-full px-3 py-1.5 text-[11px] font-mono text-white/60 placeholder-white/20 outline-none" style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.09)' }} />
                <button onClick={addCustom} className="px-3 py-1.5 rounded-full text-[10px] font-mono transition-all hover:text-white/70" style={{ border: '1px solid rgba(var(--fg),0.10)', color: 'rgba(var(--fg),0.40)', background: 'transparent' }}>Add</button>
              </div>
            </div>
          );
        })()}

        <div className="text-[10px] tracking-[0.18em] uppercase text-white/20 font-mono">{index + 1} of {records.length}</div>
        </div>
      </div>

      {selectMode && current && (
        <div className="mt-4 flex justify-center">
          <button
            onClick={() => onToggleSelect(current.id)}
            className="flex items-center gap-2 px-5 py-2 rounded-full text-[11px] font-mono transition-all"
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
        <div className="flex items-center gap-1.5">
          {records.slice(Math.max(0, index - 4), Math.min(records.length, index + 5)).map((_, i) => {
            const absIdx = Math.max(0, index - 4) + i;
            return <button key={absIdx} onClick={() => onIndexChange(absIdx)} className="rounded-full transition-all" style={{ width: absIdx === index ? 18 : 5, height: 5, background: absIdx === index ? `rgb(${accentRGB})` : "rgba(var(--fg),0.18)" }} />;
          })}
        </div>
        <button onClick={onNext} disabled={index === records.length - 1} className="w-9 h-9 rounded-full flex items-center justify-center transition-all disabled:opacity-15" style={{ border: "1px solid rgba(var(--fg),0.10)", background: "rgba(var(--fg),0.03)" }}>
          <CaretRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ----- RecordCard (grid) -----------------------------------------------------

function RecordCard({ record, onSelect, onRemove, accentRGB, selectMode = false, selected = false, onToggleSelect, localOnly = false }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const condColor = conditionColor(record.mediaCondition);
  const condColorDark = record.mediaCondition === 'M' || record.mediaCondition === 'NM' ? '40,140,55'
    : record.mediaCondition === 'VG+' || record.mediaCondition === 'VG' ? '140,100,10'
    : condColor ? '180,45,45' : null;
  const displayCondColor = isLight ? condColorDark : condColor;
  return (
    <div className="relative group cursor-pointer" onClick={selectMode ? onToggleSelect : onSelect}>
      <div className="aspect-square rounded-xl overflow-hidden mb-2" style={{ boxShadow: selected ? `0 0 0 2px rgb(${accentRGB}), 0 8px 32px -8px rgba(0,0,0,0.5)` : "0 8px 32px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(var(--fg),0.05)" }}>
        {record.coverUrl ? (
          <img src={record.coverUrl} alt={record.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-400" />
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
            style={{ background: 'rgba(251,146,60,0.92)', fontSize: 9, fontWeight: 800, color: '#fff', fontFamily: 'monospace', lineHeight: 1 }}>
            !
          </div>
        )}
        {record.mediaCondition && !selectMode && displayCondColor && (
          <div style={{ position: 'absolute', bottom: 6, left: 6, fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.08em', padding: '2px 6px', borderRadius: 10, background: `rgba(${displayCondColor},${isLight ? 0.14 : 0.18})`, border: `1px solid rgba(${displayCondColor},${isLight ? 0.40 : 0.35})`, color: `rgb(${displayCondColor})`, pointerEvents: 'none' }}>
            {record.mediaCondition}
          </div>
        )}
      </div>
      <div className="text-[11px] leading-snug font-display truncate text-white/85">{record.artist}</div>
      <div className="text-[10px] text-white/50 truncate font-mono">{record.title}</div>
    </div>
  );
}

// ----- RecordDetailModal -----------------------------------------------------

function RecordDetailModal({ record, onClose, onRemove, onUpdate, accentRGB, crateColors = {}, allCrates = [] }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const audioRef = useRef(null);
  const [playingPreview, setPlayingPreview] = useState(null);
  const [imgIdx, setImgIdx] = useState(0);
  const [price, setPrice] = useState(null); // null=not loaded, false=no data, object=loaded
  const [priceLoading, setPriceLoading] = useState(false);
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
  const [reidentifyPicking, setReidentifyPicking] = useState(false);
  const [reidentifyError, setReidentifyError] = useState(null);
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
    if (!record?.tracklist?.length) return;
    const pending = {};
    let total = 0;

    record.tracklist.forEach((track, i) => {
      if (!track.previewUrl || track.bpm != null || bpmTriedRef.current.has(track.previewUrl)) return;
      bpmTriedRef.current.add(track.previewUrl);
      total++;
      setBpmDetecting(prev => new Set([...prev, i]));

      detectBPM(track.previewUrl).then(bpm => {
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
    audioRef.current = audio; audio.play().catch(() => {}); setPlayingPreview(url);
    audio.onended = () => { setPlayingPreview(null); audioRef.current = null; };
  };
  useEffect(() => () => audioRef.current?.pause(), []);

  const checkPrice = async () => {
    const discogsId = record.discogsId;
    if (!discogsId) return;
    setPriceLoading(true);
    try {
      const res = await fetch(`/api/price?id=${encodeURIComponent(discogsId)}`);
      const data = await res.json();
      setPrice(data.totalListings === 0 && !data.low ? false : data);
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
      setReidentifyResults(data.matches || []);
    } catch (err) {
      setReidentifyError('Search failed. Check your connection.');
    }
    setReidentifyLoading(false);
  };

  const pickReidentifyCandidate = async (candidate) => {
    setReidentifyPicking(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discogsId: candidate.id }),
      });
      const data = await res.json();
      if (data.release && onUpdate) {
        const r = data.release;
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
      }
      setReidentifying(false);
      setReidentifyResults(null);
    } catch (err) {
      setReidentifyError('Failed to load release details.');
    }
    setReidentifyPicking(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.80)", backdropFilter: "blur(10px)" }} onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl" style={{ background: "rgba(var(--bg),0.99)", border: "1px solid rgba(var(--fg),0.08)", boxShadow: "0 40px 100px -20px rgba(0,0,0,0.95)" }} onClick={(e) => e.stopPropagation()}>

        {/* Close bar: drag handle + label. Full-width tap target, especially useful on mobile. */}
        <button onClick={onClose} className="w-full flex flex-col items-center gap-1.5 pt-3 pb-3 transition-opacity hover:opacity-70 active:opacity-50" aria-label="Close">
          <div className="w-10 h-1 rounded-full" style={{ background: "rgba(var(--fg),0.18)" }} />
          <span className="text-[10px] tracking-[0.22em] uppercase font-mono" style={{ color: "rgba(var(--fg),0.22)" }}>Close</span>
        </button>

        <div className="px-6 md:px-8 pb-8">

        <div className="grid sm:grid-cols-[140px_1fr] gap-5 mb-6">
          <div>
            <div className="aspect-square rounded-xl overflow-hidden mb-2" style={{ boxShadow: `0 20px 50px -15px rgba(${localAccent},0.35)` }}>
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
          <div className="flex flex-col justify-center">
            <div className="text-[10px] tracking-[0.2em] uppercase text-white/45 mb-2 font-mono">{[record.year, record.format, record.country].filter(Boolean).join(" · ")}</div>
            <div className="text-xl leading-tight mb-0.5 font-display"><span className="italic">{record.artist}</span></div>
            <div className="text-base text-white/65 font-display mb-3">{record.title}</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {record.label && <Pill label="Label" value={record.label} />}
              {record.catalogNumber && <Pill label="Cat #" value={record.catalogNumber} mono />}
            </div>
            <div className="flex items-center gap-4 mb-3">
              <ConditionSelect label="Vinyl" value={record.mediaCondition || ''} onChange={v => onUpdate?.(record.id, { mediaCondition: v })} />
              <ConditionSelect label="Sleeve" value={record.sleeveCondition || ''} onChange={v => onUpdate?.(record.id, { sleeveCondition: v })} />
            </div>
            <div>
              <div className="text-[9px] tracking-[0.2em] uppercase text-white/40 font-mono mb-1.5">Crates</div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {recordCrates.map((c) => {
                  const col = crateColors[c] || null;
                  return (
                    <button key={c} onClick={() => toggleRecordCrate(c)}
                      className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono transition-all hover:opacity-80"
                      style={{
                        background: col ? `${col}1a` : `rgba(${localAccent},0.1)`,
                        border: `1px solid ${col ? col + '55' : `rgba(${localAccent},0.22)`}`,
                        color: 'rgba(var(--fg),0.65)',
                        boxShadow: col ? `0 0 10px -3px ${col}55` : 'none',
                      }}>
                      <RotatingCube color={col || `rgb(${localAccent})`} size={7} />
                      {c}
                      <X size={9} className="opacity-50 ml-0.5" />
                    </button>
                  );
                })}
                {recordCrates.length === 0 && !showCrateEditor && (
                  <span className="text-[10px] font-mono text-white/25">Not in any crate yet.</span>
                )}
                <button onClick={() => { setShowCrateEditor(p => !p); setCrateInput(''); }}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-mono transition-all"
                  style={{ border: `1px solid ${showCrateEditor ? 'rgba(var(--fg),0.18)' : 'rgba(var(--fg),0.08)'}`, color: showCrateEditor ? 'rgba(var(--fg),0.55)' : 'rgba(var(--fg),0.28)', background: 'transparent' }}>
                  {showCrateEditor ? <X size={9} /> : <Plus size={9} />}
                  {showCrateEditor ? 'Done' : 'Edit'}
                </button>
              </div>
              {showCrateEditor && (
                <div className="space-y-2 mt-1">
                  <div className="flex flex-wrap gap-1.5">
                    {genreChips.map((g) => (
                      <button key={g} onClick={() => toggleRecordCrate(g)}
                        className="inline-flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono transition-all hover:text-white/55 hover:border-white/20"
                        style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.32)' }}>
                        <Plus size={9} />{g}
                      </button>
                    ))}
                  </div>
                  {otherCrates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {otherCrates.map((c) => (
                        <button key={c} onClick={() => toggleRecordCrate(c)}
                          className="inline-flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase px-2.5 py-1 rounded-full font-mono transition-all hover:text-white/60 hover:border-white/20"
                          style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.35)' }}>
                          <Plus size={10} />{c}
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <input value={crateInput} onChange={(e) => setCrateInput(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && addNewCrate()}
                      placeholder="Create a custom crate..."
                      className="flex-1 rounded-full px-3 py-1.5 text-[11px] font-mono text-white/65 placeholder-white/20 outline-none"
                      style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.09)' }} />
                    <button onClick={addNewCrate}
                      className="px-3 py-1.5 rounded-full text-[10px] font-mono transition-all hover:text-white/70"
                      style={{ border: '1px solid rgba(var(--fg),0.10)', color: 'rgba(var(--fg),0.40)', background: 'transparent' }}>
                      Add
                    </button>
                  </div>
                </div>
              )}
            </div>
            {record.tags && record.tags.length > 0 && (
              <div className="mt-2">
                <div className="text-[9px] tracking-[0.2em] uppercase text-white/40 font-mono mb-1.5">Tags</div>
                <div className="flex flex-wrap gap-1.5">
                  {record.tags.map((t) => (
                    <span key={t} className="inline-flex items-center gap-1 text-[10px] px-2.5 py-1 rounded-full font-mono" style={{ background: `rgba(${localAccent},${isLight ? 0.12 : 0.07})`, border: `1px solid rgba(${localAccent},${isLight ? 0.28 : 0.16})`, color: `rgba(${localAccent},${isLight ? 1 : 0.65})` }}>{t}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {record.tracklist && record.tracklist.length > 0 && (
          <div className="mb-5">
            <div className="text-[10px] tracking-[0.2em] uppercase text-white/40 mb-3 font-mono">Tracklist</div>
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
              <button onClick={checkPrice} disabled={priceLoading} className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-mono transition-all disabled:opacity-50" style={{ border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.45)", background: "rgba(var(--fg),0.025)" }}>
                {priceLoading
                  ? <><div className="w-3 h-3 rounded-full border border-t-transparent animate-spin" style={{ borderColor: "rgba(var(--fg),0.3)", borderTopColor: "transparent" }} />Checking prices...</>
                  : <><MagnifyingGlass size={12} />Check marketplace price</>
                }
              </button>
            )}
            {price === false && (
              <div className="text-[11px] font-mono text-white/25">No listings found on Discogs marketplace.</div>
            )}
            {price && typeof price === "object" && (
              <PriceGraph price={price} accentRGB={localAccent} />
            )}
          </div>
        )}

        {/* Re-identify panel */}
        {reidentifying && (
          <div className="mb-5 p-4 rounded-2xl" style={{ background: 'rgba(var(--fg),0.03)', border: '1px solid rgba(var(--fg),0.08)' }}>
            <div className="text-[9px] tracking-[0.22em] uppercase font-mono text-white/25 mb-3">Find correct release</div>
            <div className="flex flex-col gap-2 mb-3">
              {[
                { label: 'Artist', val: searchArtist, set: setSearchArtist },
                { label: 'Title', val: searchTitle, set: setSearchTitle },
                { label: 'Cat #', val: searchCatno, set: setSearchCatno },
              ].map(({ label, val, set }) => (
                <div key={label} className="flex items-center gap-2">
                  <span style={{ width: 40, fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.28)', flexShrink: 0 }}>{label}</span>
                  <input value={val} onChange={e => set(e.target.value)} onKeyDown={e => e.key === 'Enter' && doReidentifySearch()} className="flex-1 rounded-full px-3 py-1.5 text-[11px] font-mono text-white/70 placeholder-white/20 outline-none" style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)' }} />
                </div>
              ))}
            </div>
            <button onClick={doReidentifySearch} disabled={reidentifyLoading} className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-mono transition-all disabled:opacity-40" style={{ background: `rgba(${localAccent},0.12)`, border: `1px solid rgba(${localAccent},0.25)`, color: `rgb(${localAccent})` }}>
              {reidentifyLoading ? <><div className="w-3 h-3 rounded-full border border-t-transparent animate-spin" style={{ borderColor: `rgba(${localAccent},0.4)`, borderTopColor: 'transparent' }} />Searching...</> : <><MagnifyingGlass size={12} />Search Discogs</>}
            </button>
            {reidentifyError && <div className="mt-2 text-[10px] font-mono text-red-400/70">{reidentifyError}</div>}
            {reidentifyResults !== null && reidentifyResults.length === 0 && !reidentifyLoading && (
              <div className="mt-3 text-[11px] font-mono text-white/30">No results found. Try different search terms.</div>
            )}
            {reidentifyResults && reidentifyResults.length > 0 && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                {reidentifyResults.map(c => (
                  <button key={c.id} onClick={() => pickReidentifyCandidate(c)} disabled={reidentifyPicking} className="text-left p-2.5 rounded-xl text-[10px] transition-all hover:bg-white/5 disabled:opacity-40" style={{ border: '1px solid rgba(var(--fg),0.07)' }}>
                    {c.coverUrl && <img src={c.coverUrl} alt="" className="w-full aspect-square object-cover rounded-lg mb-1.5 opacity-80" />}
                    <div className="font-mono text-white/60 truncate">{c.artist}</div>
                    <div className="text-white/40 truncate">{c.recordTitle}</div>
                    <div className="text-white/25 font-mono text-[9px] mt-0.5">{[c.catalogNumber, c.year].filter(Boolean).join(' · ')}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex items-center gap-3 mb-3 flex-wrap">
          <button onClick={() => { if (window.confirm('Remove this record from your collection?')) onRemove(); }} className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-mono transition-all" style={{ color: "rgba(220,100,100,0.60)", border: "1px solid rgba(220,100,100,0.15)", background: "transparent" }}>
            <Trash size={12} />Remove from collection
          </button>
          <button onClick={() => { setReidentifying(p => !p); setReidentifyResults(null); setReidentifyError(null); }} className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-mono transition-all" style={{ color: reidentifying ? 'rgba(var(--fg),0.55)' : 'rgba(var(--fg),0.30)', border: reidentifying ? '1px solid rgba(var(--fg),0.18)' : '1px solid rgba(var(--fg),0.08)', background: 'transparent' }}>
            <Scan size={12} />Re-identify
          </button>
        </div>
        </div>{/* end px-6 content wrapper */}
      </div>
    </div>
  );
}

// ----- PriceGraph ------------------------------------------------------------

const CONDITION_ORDER = [
  'Mint (M)',
  'Near Mint (NM or M-)',
  'Very Good Plus (VG+)',
  'Very Good (VG)',
  'Good Plus (G+)',
  'Good (G)',
  'Fair (F)',
  'Poor (P)',
];

const CONDITION_SHORT = {
  'Mint (M)': 'M',
  'Near Mint (NM or M-)': 'NM',
  'Very Good Plus (VG+)': 'VG+',
  'Very Good (VG)': 'VG',
  'Good Plus (G+)': 'G+',
  'Good (G)': 'G',
  'Fair (F)': 'F',
  'Poor (P)': 'P',
};

function PriceGraph({ price, accentRGB }) {
  const [ready, setReady] = useState(false);
  useEffect(() => { const id = requestAnimationFrame(() => setReady(true)); return () => cancelAnimationFrame(id); }, []);

  const byCondition = price.byCondition || {};
  const rows = CONDITION_ORDER
    .map(cond => ({ cond, short: CONDITION_SHORT[cond] || cond, ...(byCondition[cond] || { avg: null, count: 0 }) }))
    .filter(r => r.avg != null);

  const maxAvg = rows.length ? Math.max(...rows.map(r => r.avg)) : 1;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'rgba(var(--fg),0.02)', border: '1px solid rgba(var(--fg),0.07)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-4 pb-3" style={{ borderBottom: '1px solid rgba(var(--fg),0.05)' }}>
        <div className="text-[10px] tracking-[0.28em] uppercase font-mono" style={{ color: 'rgba(var(--fg),0.28)' }}>
          Marketplace · by condition
        </div>
        <div className="text-[10px] font-mono" style={{ color: 'rgba(var(--fg),0.20)' }}>
          {price.totalListings} listing{price.totalListings !== 1 ? 's' : ''}
          {price.currency ? ` · ${price.currency}` : ''}
        </div>
      </div>

      {/* Bars */}
      <div className="px-4 py-3 space-y-2">
        {rows.length === 0 ? (
          <div style={{ color: 'rgba(var(--fg),0.22)' }}>
            <div className="text-[11px] font-mono py-2">No condition data available.</div>
            {price._debug && <div className="text-[9px] font-mono pb-2 opacity-60">debug: {JSON.stringify(price._debug)}</div>}
          </div>
        ) : rows.map((row, i) => {
          const pct = row.avg / maxAvg;
          // Brightness fades gently from M down to P
          const intensity = 0.55 + 0.45 * ((rows.length - i) / rows.length);

          return (
            <div key={row.cond} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {/* Condition label */}
              <div style={{
                width: 26, textAlign: 'right', flexShrink: 0,
                fontSize: 9, letterSpacing: '0.08em', fontFamily: 'monospace',
                color: `rgba(${accentRGB},${intensity * 0.7})`,
              }}>
                {row.short}
              </div>

              {/* Bar track */}
              <div style={{ flex: 1, position: 'relative', height: 18, borderRadius: 3 }}>
                {/* Track background */}
                <div style={{
                  position: 'absolute', inset: 0, borderRadius: 3,
                  background: `rgba(${accentRGB},0.04)`,
                  border: `1px solid rgba(${accentRGB},0.08)`,
                }} />
                {/* Filled portion */}
                <div style={{
                  position: 'absolute', top: 0, left: 0, bottom: 0,
                  width: ready ? `${pct * 100}%` : '0%',
                  minWidth: ready && pct > 0 ? 4 : 0,
                  borderRadius: 3,
                  transition: `width 0.55s cubic-bezier(0.4,0,0.2,1) ${i * 0.055}s`,
                  background: `linear-gradient(90deg, rgba(${accentRGB},${intensity * 0.28}), rgba(${accentRGB},${intensity * 0.55}))`,
                  boxShadow: `0 0 14px -3px rgba(${accentRGB},${intensity * 0.5}), inset 0 1px 0 rgba(var(--fg),0.06)`,
                }} />
                {/* Count inside bar (right-aligned) */}
                {row.count > 1 && (
                  <div style={{
                    position: 'absolute', right: 5, top: '50%', transform: 'translateY(-50%)',
                    fontSize: 8, fontFamily: 'monospace',
                    color: `rgba(${accentRGB},${intensity * 0.45})`,
                    pointerEvents: 'none',
                  }}>
                    {row.count}
                  </div>
                )}
              </div>

              {/* Price */}
              <div style={{
                width: 52, textAlign: 'right', flexShrink: 0,
                fontSize: 11, fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums',
                color: `rgba(var(--fg),${intensity * 0.75})`,
              }}>
                {row.avg.toFixed(2)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer summary */}
      {(price.median != null || price.low != null) && (
        <div className="px-4 pb-3 pt-1 flex gap-4 flex-wrap" style={{ borderTop: '1px solid rgba(var(--fg),0.04)' }}>
          {price.median != null && (
            <div>
              <span className="text-[9px] tracking-[0.18em] uppercase font-mono mr-1.5" style={{ color: 'rgba(var(--fg),0.20)' }}>Median</span>
              <span className="text-[12px] font-mono" style={{ color: `rgba(${accentRGB},0.80)` }}>{price.median.toFixed(2)}</span>
            </div>
          )}
          {price.low != null && price.high != null && price.low !== price.high && (
            <div>
              <span className="text-[9px] tracking-[0.18em] uppercase font-mono mr-1.5" style={{ color: 'rgba(var(--fg),0.20)' }}>Range</span>
              <span className="text-[11px] font-mono" style={{ color: 'rgba(var(--fg),0.35)' }}>{price.low.toFixed(2)} — {price.high.toFixed(2)}</span>
            </div>
          )}
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
        <span style={{ fontSize: 12, fontFamily: 'monospace', color: open ? 'rgba(var(--fg),0.75)' : 'rgba(var(--fg),0.4)' }}>{label}</span>
        <CaretRight size={12} style={{ color: 'rgba(var(--fg),0.25)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>
      {open && <div className="pb-4">{children}</div>}
    </div>
  );
}

function AccountModal({ user, profile, isDark, onToggleTheme, onClose, onSignOut, onUpdateDisplayName, onUpdateProfile, onUpdateAvatar, onViewProfile, onPrintLabels, onDownloadCSV, isAdmin, onOpenAdmin }) {
  const currentName = user?.user_metadata?.display_name || profile?.display_name || user?.email?.split('@')[0] || '';
  const [displayName, setDisplayName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [openSection, setOpenSection] = useState(null);

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
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'rgba(var(--fg),0.9)' }}>Account</h2>
          <button onClick={onClose} className="text-white/30 hover:text-white/70 transition-colors"><X size={16} /></button>
        </div>

        {/* Avatar */}
        <div className="flex flex-col items-center mb-5">
          <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFile} />
          <button
            onClick={() => avatarInputRef.current?.click()}
            className="relative w-16 h-16 rounded-full overflow-hidden flex items-center justify-center mb-2.5 transition-opacity hover:opacity-80"
            style={{
              border: avatarSavedOk ? '2px solid rgba(120,220,140,0.8)' : '2px solid rgba(var(--fg),0.15)',
              background: 'rgba(var(--fg),0.06)',
              boxShadow: avatarSavedOk ? '0 0 20px -4px rgba(120,220,140,0.55)' : 'none',
              transition: 'all 0.3s',
            }}>
            {avatarPreview
              ? <img src={avatarPreview} alt="Profile" className="w-full h-full object-cover" />
              : <span style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 700, color: 'rgba(var(--fg),0.35)' }}>{initials}</span>
            }
            {avatarSavedOk && (
              <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                style={{ background: 'rgba(60,190,90,0.98)', border: '2px solid rgba(20,20,28,1)' }}>
                <Check size={11} weight="bold" style={{ color: '#fff' }} />
              </div>
            )}
          </button>
          <div className="flex items-center gap-3">
            <button onClick={() => avatarInputRef.current?.click()}
              style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {avatarPreview ? 'Change photo' : 'Upload photo'}
            </button>
            {avatarPreview && (
              <>
                <span style={{ color: 'rgba(var(--fg),0.15)', fontSize: 11 }}>|</span>
                <button onClick={removeAvatar}
                  style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,100,100,0.55)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  Remove
                </button>
              </>
            )}
          </div>
        </div>

        <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.25)', marginBottom: 16, textAlign: 'center' }}>{user.email}</p>

        {errorMsg && <p style={{ fontSize: 11, color: '#fca5a5', marginBottom: 10, fontFamily: 'monospace' }}>{errorMsg}</p>}

        {/* Accordion sections */}
        <div style={{ borderTop: '1px solid rgba(var(--fg),0.07)' }}>

          <AccountSection label="Profile name" open={openSection === 'name'} onToggle={() => toggleSection('name')}>
            <div className="flex gap-2">
              <input
                type="text"
                value={displayName}
                onChange={e => { setDisplayName(e.target.value); setSavedOk(false); setErrorMsg(''); }}
                onKeyDown={e => e.key === 'Enter' && saveDisplayName()}
                placeholder="Your name"
                style={{ flex: 1, padding: '8px 11px', borderRadius: 9, fontSize: 13, color: 'var(--fg-hex)', background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.1)', outline: 'none' }}
                onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.3)'}
                onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
              />
              <button onClick={saveDisplayName} disabled={saving || savedOk}
                style={{
                  padding: '8px 13px', borderRadius: 9, fontSize: 12, fontWeight: 600,
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

          <AccountSection label="Public profile" open={openSection === 'profile'} onToggle={() => toggleSection('profile')}>
            <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 12 }}>
              Claim a username and make your collection public so others can browse it, follow you, and react.
            </p>

            <label style={{ display: 'block', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.4)', marginBottom: 6 }}>Username</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
              <span style={{ fontSize: 14, color: 'rgba(var(--fg),0.35)', fontFamily: 'monospace' }}>@</span>
              <input
                type="text"
                value={username}
                onChange={e => { setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '')); setProfileSavedOk(false); setProfileErr(''); }}
                placeholder="username"
                maxLength={20}
                style={{ flex: 1, padding: '8px 11px', borderRadius: 9, fontSize: 13, color: 'var(--fg-hex)', background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.1)', outline: 'none', fontFamily: 'monospace' }}
                onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.3)'}
                onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
              />
            </div>

            <label style={{ display: 'block', fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.15em', textTransform: 'uppercase', color: 'rgba(var(--fg),0.4)', marginBottom: 6 }}>Bio</label>
            <textarea
              value={bio}
              onChange={e => { setBio(e.target.value.slice(0, 160)); setProfileSavedOk(false); setProfileErr(''); }}
              placeholder="A line about your taste, your rig, your scene…"
              rows={2}
              style={{ width: '100%', padding: '8px 11px', borderRadius: 9, fontSize: 13, color: 'var(--fg-hex)', background: 'rgba(var(--fg),0.06)', border: '1px solid rgba(var(--fg),0.1)', outline: 'none', resize: 'none', marginBottom: 4 }}
              onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.3)'}
              onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
            />
            <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(var(--fg),0.25)', textAlign: 'right', marginBottom: 12 }}>{bio.length}/160</div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 12, color: isPublic ? 'rgba(120,220,140,0.9)' : 'rgba(var(--fg),0.7)', transition: 'color 0.2s' }}>{isPublic ? 'Public collection' : 'Private collection'}</div>
                <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(var(--fg),0.3)' }}>{isPublic ? 'Anyone can view your records' : 'Only you can see your records'}</div>
              </div>
              <button
                onClick={() => { setIsPublic(v => !v); setProfileSavedOk(false); setProfileErr(''); }}
                aria-label="Toggle public collection"
                style={{ position: 'relative', width: 44, height: 24, borderRadius: 12, background: isPublic ? 'rgba(120,220,140,0.45)' : 'rgba(var(--fg),0.12)', border: '1px solid rgba(var(--fg),0.15)', cursor: 'pointer', padding: 0, flexShrink: 0, transition: 'background 0.2s' }}>
                <span style={{ position: 'absolute', top: 3, left: isPublic ? 21 : 3, width: 16, height: 16, borderRadius: '50%', background: 'rgba(255,255,255,0.9)', transition: 'left 0.2s cubic-bezier(0.34,1.4,0.64,1)' }} />
              </button>
            </div>

            {profileErr && <p style={{ fontSize: 11, color: '#fca5a5', marginBottom: 10, fontFamily: 'monospace' }}>{profileErr}</p>}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button onClick={saveProfile} disabled={profileSaving || profileSavedOk}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '8px 16px', borderRadius: 9, fontSize: 12, fontWeight: 600, color: 'var(--bg-hex)', background: profileSaving ? 'rgba(var(--fg),0.3)' : profileSavedOk ? 'rgba(120,220,140,0.9)' : 'rgba(var(--fg),0.9)', border: 'none', cursor: (profileSaving || profileSavedOk) ? 'default' : 'pointer', transition: 'background 0.2s' }}>
                {profileSaving ? 'Saving...' : profileSavedOk ? (<><Check size={13} weight="bold" />Saved!</>) : 'Save profile'}
              </button>
              {!profileSaving && !profileSavedOk && profile?.username && profile?.is_public && (
                <button onClick={() => onViewProfile?.(profile.username)}
                  style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  View my profile →
                </button>
              )}
            </div>
          </AccountSection>

          <AccountSection label="Password" open={openSection === 'password'} onToggle={() => toggleSection('password')}>
            {resetSent ? (
              <p style={{ fontSize: 12, color: '#86efac', fontFamily: 'monospace' }}>Reset link sent to {user.email}</p>
            ) : (
              <button onClick={sendPasswordReset}
                style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.45)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onMouseEnter={e => e.currentTarget.style.color = 'rgba(var(--fg),0.75)'}
                onMouseLeave={e => e.currentTarget.style.color = 'rgba(var(--fg),0.45)'}>
                Send password reset email
              </button>
            )}
          </AccountSection>

          <AccountSection label="Print labels" open={openSection === 'labels'} onToggle={() => toggleSection('labels')}>
            <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 10 }}>Select records from your collection to print labels for.</p>
            <button onClick={onPrintLabels}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono transition-all"
              style={{ background: 'rgba(var(--fg),0.07)', border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.6)', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.11)'; e.currentTarget.style.color = 'rgba(var(--fg),0.85)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.07)'; e.currentTarget.style.color = 'rgba(var(--fg),0.6)'; }}>
              <Printer size={13} />Go to collection
            </button>
          </AccountSection>

          <AccountSection label="Download CSV" open={openSection === 'csv'} onToggle={() => toggleSection('csv')}>
            <p style={{ fontSize: 11, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', marginBottom: 10 }}>Export your full collection as a spreadsheet.</p>
            <button onClick={onDownloadCSV}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono transition-all"
              style={{ background: 'rgba(var(--fg),0.07)', border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.6)', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.11)'; e.currentTarget.style.color = 'rgba(var(--fg),0.85)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.07)'; e.currentTarget.style.color = 'rgba(var(--fg),0.6)'; }}>
              <DownloadSimple size={13} />Download
            </button>
          </AccountSection>

          {/* Appearance */}
          <div style={{ paddingTop: 14, paddingBottom: 14, borderBottom: '1px solid rgba(var(--fg),0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.4)' }}>Appearance</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(var(--fg),0.30)', letterSpacing: '0.08em' }}>{isDark ? 'Dark' : 'Light'}</span>
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

        {/* Admin panel shortcut */}
        {isAdmin && (
          <button onClick={onOpenAdmin}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all mt-5"
            style={{ background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)', color: 'rgba(251,191,36,0.7)' }}
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.14)'; e.currentTarget.style.color = 'rgba(251,191,36,0.95)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(251,191,36,0.07)'; e.currentTarget.style.color = 'rgba(251,191,36,0.7)'; }}>
            <Crown size={14} />
            Admin panel
          </button>
        )}

        {/* Sign out */}
        <button onClick={onSignOut}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm transition-all mt-2"
          style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.45)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239,68,68,0.1)'; e.currentTarget.style.borderColor = 'rgba(239,68,68,0.3)'; e.currentTarget.style.color = '#fca5a5'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(var(--fg),0.04)'; e.currentTarget.style.borderColor = 'rgba(var(--fg),0.08)'; e.currentTarget.style.color = 'rgba(var(--fg),0.45)'; }}>
          <SignOut size={14} />
          Sign out
        </button>
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
          <h3 className="text-[11px] tracking-[0.3em] uppercase font-mono text-white/60">Crate manager</h3>
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
                    <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingName(null); }} className="flex-1 rounded-lg px-3 py-1 text-sm font-mono outline-none" style={{ background: "rgba(var(--fg),0.07)", border: "1px solid rgba(var(--fg),0.14)" }} />
                  ) : (
                    <span className="flex-1 text-sm font-mono" style={{ color: 'rgba(var(--fg),0.70)' }}>{crate}</span>
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
                  <div className="flex items-center gap-2 px-3 pb-3 pt-0">
                    <span className="text-[9px] tracking-[0.18em] uppercase font-mono text-white/20 mr-1">Colour</span>
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
                        className="text-[9px] font-mono tracking-wide ml-1 transition-all"
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

// ----- BatchView -------------------------------------------------------------

function BatchView({ queue, processing, onResolve, onBatch, accentRGB }) {
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
        <span className="text-[11px] font-mono text-white/35">{done}/{queue.length} saved</span>
        {processing && <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: `rgba(${accentRGB},0.25)`, borderTopColor: `rgb(${accentRGB})` }} />}
      </div>

      {needsReview.length > 0 && (
        <div className="mb-5 p-4 rounded-2xl" style={{ background: "rgba(240,190,80,0.05)", border: "1px solid rgba(240,190,80,0.18)" }}>
          <div className="text-[10px] tracking-[0.2em] uppercase text-yellow-400/60 mb-1 font-mono">{needsReview.length} needing disambiguation</div>
          <p className="text-sm text-white/40">Scroll down to pick the correct pressing for flagged records.</p>
        </div>
      )}

      <div className="space-y-2.5">
        {queue.map((item, idx) => (
          <div key={idx} className="rounded-2xl overflow-hidden" style={glassSubtle()}>
            <div className="flex items-center gap-4 p-4">
              <div className="w-11 h-11 rounded-xl overflow-hidden shrink-0" style={{ border: "1px solid rgba(var(--fg),0.06)" }}>
                {item.imageUrl ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/[0.03]" />}
              </div>
              <div className="flex-1 min-w-0">
                {item.release ? (
                  <>
                    <div className="text-sm font-display truncate text-white/80">{item.release.artist} — {item.release.title}</div>
                    <div className="text-[10px] text-white/35 font-mono">{item.release.catalogNumber || item.release.label || ""}</div>
                  </>
                ) : item.status === "disambiguation" ? (
                  <div className="text-sm text-yellow-400/70 font-mono">Multiple pressings found</div>
                ) : (
                  <div className="text-sm text-white/35 font-mono capitalize">{item.status}</div>
                )}
              </div>
              {statusIcon(item.status)}
            </div>
            {item.status === "disambiguation" && item.candidates && (
              <div className="px-4 pb-4">
                <div className="text-[10px] tracking-[0.2em] uppercase text-white/25 mb-2 font-mono">Pick pressing</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {item.candidates.map((c) => (
                    <button key={c.id} onClick={() => onResolve(idx, c)} className="text-left p-2.5 rounded-xl text-[11px] transition-all hover:bg-white/5" style={{ border: "1px solid rgba(var(--fg),0.07)" }}>
                      <div className="font-mono text-white/65 truncate">{c.artist}</div>
                      <div className="text-white/40 truncate">{c.recordTitle}</div>
                      <div className="text-white/22 font-mono text-[10px]">{c.catalogNumber} {c.year}</div>
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

const STAT_PALETTE = [
  '120, 180, 255',
  '255, 150, 190',
  '185, 155, 255',
  '100, 220, 245',
  '255, 165, 135',
  '130, 235, 200',
  '255, 185, 215',
  '155, 170, 255',
];

function StatCard({ label, target, suffix = '', color, ready }) {
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
    <div style={{ padding: '14px 18px', borderRadius: 16, background: `rgba(${color},0.06)`, border: `1px solid rgba(${color},0.20)`, boxShadow: `0 0 30px -10px rgba(${color},0.25)` }}>
      <div style={{ fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.22em', textTransform: 'uppercase', color: `rgba(${color},0.55)`, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontFamily: 'monospace', color: `rgb(${color})`, lineHeight: 1, textShadow: `0 0 24px rgba(${color},0.5)` }}>{val}{suffix}</div>
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

  const barTrack = { flex: 1, position: 'relative', height: 20, borderRadius: 4 };
  const barFill = (pct, c1, c2, delay = 0) => ({
    position: 'absolute', top: 0, left: 0, bottom: 0, borderRadius: 4,
    width: ready ? `${pct * 100}%` : '0%',
    transition: `width 0.6s cubic-bezier(0.4,0,0.2,1) ${delay}s`,
    background: `linear-gradient(90deg, rgba(${c1},0.65), rgba(${c2},0.90))`,
    boxShadow: `0 0 16px -3px rgba(${c2},0.45)`,
  });

  return (
    <div className="pt-8 md:pt-12 space-y-5 max-w-2xl" style={{ animation: "fadeUp 0.5s ease-out" }}>
      <div className="text-[10px] tracking-[0.35em] uppercase mb-2 text-white/25 font-mono">Collection Stats</div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Records"    target={total}          suffix=""  color={STAT_PALETTE[0]} ready={ready} />
        <StatCard label="Crates"     target={totalCrates}    suffix=""  color={STAT_PALETTE[1]} ready={ready} />
        <StatCard label="Identified" target={pctIdentified}  suffix="%" color={STAT_PALETTE[2]} ready={ready} />
        <StatCard label="Graded"     target={pctGraded}      suffix="%" color={STAT_PALETTE[3]} ready={ready} />
      </div>

      {topGenres.length > 0 && (
        <GlassSection title="Genres" accentRGB={accentRGB}>
          <div className="space-y-2.5">
            {topGenres.map(([genre, count], i) => {
              const c1 = STAT_PALETTE[i % STAT_PALETTE.length];
              const c2 = STAT_PALETTE[(i + 2) % STAT_PALETTE.length];
              return (
                <div key={genre} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 76, fontSize: 10, fontFamily: 'monospace', color: `rgba(${c1},0.85)`, flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{genre}</div>
                  <div style={barTrack}>
                    <div style={{ position: 'absolute', inset: 0, background: `rgba(${c1},0.05)`, border: `1px solid rgba(${c1},0.10)`, borderRadius: 4 }} />
                    <div style={barFill(count / maxGenre, c1, c2, i * 0.04)} />
                  </div>
                  <div style={{ width: 24, fontSize: 10, fontFamily: 'monospace', color: `rgba(${c1},0.60)`, textAlign: 'right', flexShrink: 0 }}>{count}</div>
                </div>
              );
            })}
          </div>
        </GlassSection>
      )}

      {Object.values(decadeCounts).some(v => v > 0) && (
        <GlassSection title="By Decade" accentRGB={accentRGB}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 96 }}>
            {Object.entries(decadeCounts).map(([decade, count], i) => {
              const c1 = STAT_PALETTE[i % STAT_PALETTE.length];
              const c2 = STAT_PALETTE[(i + 1) % STAT_PALETTE.length];
              return (
                <div key={decade} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: `rgba(${c1},0.75)` }}>{count || ''}</div>
                  <div style={{ width: '100%', borderRadius: '4px 4px 0 0', background: `rgba(${c1},0.06)`, border: `1px solid rgba(${c1},0.12)`, borderBottom: 'none', position: 'relative', overflow: 'hidden', height: 64 }}>
                    <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, borderRadius: '3px 3px 0 0', height: ready ? `${(count / maxDecade) * 100}%` : '0%', transition: `height 0.6s cubic-bezier(0.4,0,0.2,1) ${i * 0.06}s`, background: `linear-gradient(to top, rgba(${c1},0.80), rgba(${c2},0.40))`, boxShadow: `0 -6px 16px -4px rgba(${c1},0.5)` }} />
                  </div>
                  <div style={{ fontSize: 9, fontFamily: 'monospace', color: 'rgba(var(--fg),0.28)' }}>{decade}</div>
                </div>
              );
            })}
          </div>
        </GlassSection>
      )}

      {topLabels.length > 0 && (
        <GlassSection title="Top Labels" accentRGB={accentRGB}>
          <div className="space-y-2.5">
            {topLabels.map(([label, count], i) => {
              const c1 = STAT_PALETTE[(i + 4) % STAT_PALETTE.length];
              const c2 = STAT_PALETTE[(i + 6) % STAT_PALETTE.length];
              return (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 76, fontSize: 10, fontFamily: 'monospace', color: `rgba(${c1},0.85)`, flexShrink: 0, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{label}</div>
                  <div style={barTrack}>
                    <div style={{ position: 'absolute', inset: 0, background: `rgba(${c1},0.05)`, border: `1px solid rgba(${c1},0.10)`, borderRadius: 4 }} />
                    <div style={barFill(count / (topLabels[0]?.[1] || 1), c1, c2, i * 0.04)} />
                  </div>
                  <div style={{ width: 24, fontSize: 10, fontFamily: 'monospace', color: `rgba(${c1},0.60)`, textAlign: 'right', flexShrink: 0 }}>{count}</div>
                </div>
              );
            })}
          </div>
        </GlassSection>
      )}

      {crateSizes.length > 0 && (
        <GlassSection title="Crates" accentRGB={accentRGB}>
          <div className="flex flex-wrap gap-2">
            {crateSizes.map(({ name, count }, i) => {
              const col = STAT_PALETTE[i % STAT_PALETTE.length];
              return (
                <div key={name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 20, background: `rgba(${col},0.07)`, border: `1px solid rgba(${col},0.20)` }}>
                  <span style={{ fontSize: 11, fontFamily: 'monospace', color: `rgba(${col},0.80)` }}>{name}</span>
                  <span style={{ fontSize: 10, fontFamily: 'monospace', color: `rgba(${col},0.50)` }}>{count}</span>
                </div>
              );
            })}
          </div>
        </GlassSection>
      )}
    </div>
  );
}

// ----- AboutView -------------------------------------------------------------

function AboutView({ accentRGB }) {
  return (
    <div className="pt-8 md:pt-14 max-w-2xl" style={{ animation: "fadeUp 0.5s ease-out" }}>
      <div className="text-[10px] tracking-[0.35em] uppercase mb-5 text-white/25 font-mono">About</div>
      <h2 className="text-4xl md:text-5xl leading-[0.95] mb-8 font-display tracking-tight">
        Built for the crate,<br />
        <span className="text-white/35 italic">not the cloud.</span>
      </h2>

      <div className="space-y-8">
        <div className="space-y-4 text-white/55 leading-relaxed text-[15px]">
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
          <div className="text-[10px] tracking-[0.3em] uppercase text-white/30 mb-4 font-mono">How it works</div>
          <div className="space-y-3">
            {[
              { Icon: Camera,          title: "Photograph", desc: "Point your camera at the sleeve or label. A single photo is all it takes." },
              { Icon: Scan,            title: "Identify",   desc: "The exact pressing is matched against the global record database: label, catalogue number, year, country." },
              { Icon: Sparkle,         title: "Enrich",     desc: "Tracklist, BPM, and Camelot key notation are pulled automatically where available." },
              { Icon: VinylRecord,     title: "File",       desc: "Assign the record to one or more crates, or save it unassigned and sort later." },
            ].map(({ Icon, title, desc }) => (
              <div key={title} className="flex gap-4 p-4 rounded-2xl" style={glassSubtle()}>
                <div className="shrink-0 mt-0.5">
                  <Icon size={16} style={{ color: `rgba(${accentRGB},0.7)` }} />
                </div>
                <div>
                  <div className="text-sm font-display mb-0.5 text-white/85">{title}</div>
                  <div className="text-[13px] text-white/40 leading-relaxed">{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="pt-2 border-t border-white/[0.06] text-[11px] text-white/20 font-mono leading-relaxed">
          Your collection is stored locally and synced to your account across devices.
        </div>
      </div>
    </div>
  );
}

// ----- DisambiguationView ----------------------------------------------------

function DisambiguationView({ candidates, vision, imageUrl, accentRGB, onPick }) {
  return (
    <div className="pt-8 md:pt-12" style={{ animation: "fadeUp 0.5s ease-out" }}>
      <div className="mb-10">
        <div className="text-[10px] tracking-[0.3em] uppercase text-white/30 mb-4 font-mono">Multiple pressings found</div>
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
          <button key={candidate.id} onClick={() => onPick(candidate)} className="text-left rounded-2xl overflow-hidden transition-all group relative" style={{ ...glassSubtle(), animation: `fadeUp 0.35s ease-out ${i * 0.06}s both` }}>
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.08), transparent)` }} />
            <div className="relative aspect-square overflow-hidden">
              {candidate.coverUrl ? (
                <img src={candidate.coverUrl} alt={candidate.recordTitle || candidate.artist} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: `rgba(${accentRGB},0.05)` }}><VinylRecord size={40} weight="thin" className="opacity-15" /></div>
              )}
              <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)" }} />
            </div>
            <div className="relative p-4">
              <div className="text-[10px] tracking-[0.18em] uppercase text-white/35 mb-1.5 font-mono">{[candidate.year, candidate.country, candidate.format].filter(Boolean).join(" · ")}</div>
              <div className="text-sm leading-snug mb-2 font-display">
                {candidate.artist && <span className="italic text-white/80">{candidate.artist}</span>}
                {candidate.artist && candidate.recordTitle && <span className="text-white/25"> / </span>}
                <span className="text-white/60">{candidate.recordTitle || candidate.artist}</span>
              </div>
              <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                {candidate.label && <span className="text-[10px] text-white/40 font-mono">{candidate.label}</span>}
                {candidate.catalogNumber && <span className="text-[10px] text-white/25 font-mono">{candidate.catalogNumber}</span>}
              </div>
            </div>
          </button>
        ))}
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
        className="w-full rounded-full pl-8 pr-4 py-2 text-[12px] font-mono text-white/65 placeholder-white/30 outline-none transition-all"
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
              <span className="text-[9px] tracking-[0.18em] uppercase font-mono shrink-0" style={{ color: `rgba(${accentRGB},0.55)`, minWidth: 36 }}>{s.label}</span>
              <span className="text-[12px] font-mono text-white/70 truncate">{s.text}</span>
            </button>
          ))}
        </div>
      )}
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
      <div className="text-[10px] tracking-[0.12em] text-white/50 font-mono">{track.position}</div>
      <div className="min-w-0 flex items-start gap-1.5">
        {/* Hot toggle: clickable when onHotToggle provided, display-only when track.hot */}
        {(onHotToggle || track.hot) && (
          <button
            onClick={onHotToggle ? () => onHotToggle(index) : undefined}
            className="shrink-0 leading-none transition-opacity"
            style={{ fontSize: 13, opacity: track.hot ? 1 : 0.22, cursor: onHotToggle ? "pointer" : "default", marginTop: 2 }}
            title={onHotToggle ? (track.hot ? "Unmark as hot" : "Mark as hot") : undefined}
          >
            🔥
          </button>
        )}
        <div className="min-w-0">
          <div className="text-[14px] md:text-[15px] truncate font-display text-white/85">{track.title}</div>
          {/* Mobile: duration + BPM + key inline */}
          <div className="md:hidden text-[10px] text-white/42 mt-0.5 flex items-center gap-1.5 font-mono">
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
      <div className="hidden md:flex items-center gap-1 text-[11px] text-white/50 tabular-nums font-mono"><Clock size={11} />{track.duration || "—"}</div>
      <div className="hidden md:flex items-center gap-1 text-[11px] tabular-nums min-w-[72px] justify-end font-mono">
        <span className="text-white/35 text-[9px]">BPM</span>
        {bpmLoading
          ? <span className="text-white/40" style={{ animation: "pulse 1.2s ease-in-out infinite", letterSpacing: "0.05em" }}>···</span>
          : <span style={{ color: track.bpm != null ? "rgba(var(--fg),0.65)" : "rgba(var(--fg),0.40)" }}>{track.bpm != null ? track.bpm : "—"}</span>
        }
      </div>
      {/* Key badge — hidden on mobile (already shown inline above) */}
      <div className="hidden md:flex items-center justify-center md:w-12 h-7">
        {keyColor ? (
          <div className="w-full h-full rounded-full flex items-center justify-center text-[11px] font-semibold tabular-nums font-mono" style={{ background: keyColor.replace("hsl", "hsla").replace(")", ", 0.10)"), border: `1px solid ${keyColor.replace("hsl", "hsla").replace(")", ", 0.30)")}`, color: keyColor }}>{track.key}</div>
        ) : <span className="text-white/35 text-[10px] font-mono">—</span>}
      </div>
      <div className="hidden md:flex items-center justify-center">
        <PlayBtn size={9} />
      </div>
    </div>
  );
}

function ConditionSelect({ label, value, onChange }) {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const color = conditionColor(value);
  const darkColor = value === 'M' || value === 'NM' ? '40,140,55'
    : value === 'VG+' || value === 'VG' ? '140,100,10'
    : value ? '180,45,45' : null;
  const displayColor = isLight ? darkColor : color;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 9, fontFamily: 'monospace', letterSpacing: '0.18em', textTransform: 'uppercase', color: `rgba(var(--fg),${isLight ? 0.52 : 0.30})` }}>{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)} style={{ background: displayColor ? `rgba(${displayColor},${isLight ? 0.10 : 0.09})` : 'rgba(var(--fg),0.04)', border: `1px solid ${displayColor ? `rgba(${displayColor},${isLight ? 0.35 : 0.28})` : 'rgba(var(--fg),0.10)'}`, color: displayColor ? `rgb(${displayColor})` : `rgba(var(--fg),${isLight ? 0.52 : 0.45})`, borderRadius: 20, padding: '3px 8px', fontSize: 10, fontFamily: 'monospace', cursor: 'pointer', outline: 'none', appearance: 'none', WebkitAppearance: 'none' }}>
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
          <h3 className="text-[10px] tracking-[0.3em] uppercase font-medium font-mono text-white/60">{title}</h3>
        </div>
        {subtitle && <div className="text-[10px] tracking-[0.12em] uppercase text-white/40 font-mono">{subtitle}</div>}
      </div>
      {children}
    </section>
  );
}

function Pill({ label, value, mono }) {
  return (
    <div className="inline-flex items-baseline gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(var(--fg),0.035)", border: "1px solid rgba(var(--fg),0.07)" }}>
      <span className="text-[9px] tracking-[0.2em] uppercase text-white/45 font-mono">{label}</span>
      <span className={`text-[13px] text-white/85 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ConfidenceBadge({ confidence, identified, accentRGB }) {
  const isOk = identified;
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] tracking-[0.2em] uppercase font-mono"
      style={{ border: `1px solid ${isOk ? `rgba(${accentRGB},0.28)` : "rgba(240,190,80,0.28)"}`, color: isOk ? `rgb(${accentRGB})` : "rgb(240,190,80)", background: "rgba(var(--fg),0.015)" }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: isOk ? `rgb(${accentRGB})` : "rgb(240,190,80)" }} />
      {isOk ? "Identified" : "Unverified"}
      {isOk && confidence && <span className="text-white/30">· {confidence}</span>}
    </div>
  );
}

function ErrorView({ message, onReset }) {
  return (
    <div className="pt-20 flex flex-col items-center text-center max-w-sm mx-auto">
      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5" style={{ background: "rgba(220,80,80,0.08)", border: "1px solid rgba(220,80,80,0.22)" }}>
        <X size={22} weight="light" className="text-red-300/70" />
      </div>
      <h2 className="text-2xl mb-2 font-display"><span className="italic">Couldn't read</span> that one</h2>
      <p className="text-white/35 text-sm mb-6 break-words leading-relaxed">{message}</p>
      <button onClick={onReset} className="px-5 py-2.5 rounded-full text-sm font-mono transition-all" style={{ border: "1px solid rgba(var(--fg),0.12)", color: "rgba(var(--fg),0.55)", background: "rgba(var(--fg),0.03)" }}>Try again</button>
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-mono"
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
        <button onClick={() => setSelectedTag(null)} className="inline-flex items-center gap-2 mb-6 text-[11px] font-mono text-white/35 hover:text-white/65 transition-colors">
          <CaretLeft size={12} />All tags
        </button>
        <div className="mb-5">
          <h3 className="text-2xl font-display mb-0.5">{selectedTag}</h3>
          <div className="text-[11px] font-mono text-white/30">{records.length} record{records.length !== 1 ? "s" : ""}</div>
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
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-mono transition-all hover:scale-[1.03] active:scale-[0.97]"
          style={{ background: "rgba(var(--fg),0.04)", border: "1px solid rgba(var(--fg),0.10)", color: "rgba(var(--fg),0.65)" }}
        >
          {tag}
          <span className="text-[10px] font-mono" style={{ color: "rgba(var(--fg),0.28)" }}>{records.length}</span>
        </button>
      ))}
    </div>
  );
}

function CameraModal({ onCapture, onClose }) {
  const videoRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [flash, setFlash] = useState(false);
  const streamRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    }).then(stream => {
      if (!mounted) { stream.getTracks().forEach(t => t.stop()); return; }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => setReady(true);
      }
    }).catch(err => {
      if (mounted) setError(err.name === 'NotAllowedError' ? 'Camera permission denied' : err.message);
    });
    return () => {
      mounted = false;
      streamRef.current?.getTracks().forEach(t => t.stop());
    };
  }, []);

  const capture = () => {
    if (!videoRef.current || !ready) return;
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
    const v = videoRef.current;
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    canvas.toBlob(blob => {
      if (blob) onCapture(new File([blob], 'scan.jpg', { type: 'image/jpeg' }));
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
        <video ref={videoRef} autoPlay playsInline muted
          className="w-full h-full object-cover"
          style={{ display: ready ? 'block' : 'none' }} />

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
            <div className="w-full rounded-xl px-4 py-3 text-left text-[12px] font-mono text-white/35 leading-relaxed"
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

        {/* Framing guide: corner brackets on a centred square */}
        {ready && (
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div className="relative" style={{ width: 'min(80vw, 80vh)', height: 'min(80vw, 80vh)' }}>
              {/* Dimming outside the guide area */}
              <div className="absolute inset-0" style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)' }} />
              {/* Corner brackets */}
              {[['top-0 left-0', 'border-t border-l'],
                ['top-0 right-0', 'border-t border-r'],
                ['bottom-0 left-0', 'border-b border-l'],
                ['bottom-0 right-0', 'border-b border-r']].map(([pos, border]) => (
                <div key={pos} className={`absolute ${pos} w-7 h-7 ${border}`}
                  style={{ borderColor: 'rgba(var(--fg),0.8)', borderWidth: 2 }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Capture button */}
      {ready && (
        <div className="absolute bottom-8 left-0 right-0 flex flex-col items-center gap-3 z-10">
          <p className="text-[10px] tracking-[0.2em] uppercase font-mono text-white/40">
            Align sleeve within the guide
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
            <div className="text-[10px] tracking-[0.3em] uppercase font-mono text-white/35">Batch Labels</div>
            <div className="text-white/60 text-sm font-mono mt-0.5">{records.length} record{records.length !== 1 ? 's' : ''}</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={downloadAll}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-mono transition-all"
              style={{ background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.3)`, color: `rgb(${accentRGB})` }}>
              <DownloadSimple size={13} />Download All
            </button>
            <button onClick={printAll}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-mono transition-all"
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
              <div className="text-[10px] font-mono text-white/30 mb-1.5">{record.artist} - {record.title}</div>
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
          <div className="text-[10px] tracking-[0.3em] uppercase font-mono text-white/35 mb-4">Sleeve Label</div>

          <div className="w-full rounded-xl overflow-hidden mb-3" style={{ border: '1px solid rgba(var(--fg),0.07)', aspectRatio: '1000 / 640' }}>
            <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
          </div>

          <div className="text-[10px] font-mono text-white/22 mb-5">
            1000 x 640 px (approx 85 x 54 mm at 300 dpi) · sleeve label format
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={download}
              className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[12px] font-mono transition-all"
              style={{ background: `rgba(${accentRGB},0.15)`, border: `1px solid rgba(${accentRGB},0.30)`, color: `rgb(${accentRGB})` }}>
              <DownloadSimple size={14} />Download PNG
            </button>

            {gelatoStatus === null && (
              <button onClick={orderGelato}
                className="flex items-center gap-2 px-4 py-2.5 rounded-full text-[12px] font-mono transition-all"
                style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.45)', background: 'transparent' }}>
                <Printer size={14} />Order via Gelato
              </button>
            )}
            {gelatoStatus === 'ordering' && (
              <div className="flex items-center gap-2 text-[11px] font-mono text-white/35">
                <div className="w-3 h-3 rounded-full border animate-spin" style={{ borderColor: 'rgba(var(--fg),0.2)', borderTopColor: 'rgba(var(--fg),0.6)' }} />
                Placing order...
              </div>
            )}
            {gelatoStatus === 'success' && (
              <div className="flex items-center gap-2 text-[11px] font-mono" style={{ color: 'rgb(120,220,140)' }}>
                <Check size={13} weight="bold" />Order placed
              </div>
            )}
            {gelatoStatus === 'unavailable' && (
              <div className="text-[11px] font-mono text-white/28">Gelato ordering coming soon.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- WalkthroughOverlay ----------------------------------------------------

function WalkthroughOverlay({ onDismiss, accentRGB }) {
  const steps = [
    {
      icon: Camera,
      title: 'Scan',
      body: 'Photograph a sleeve or upload from your library. We read the label and find the exact pressing on Discogs.',
    },
    {
      icon: Check,
      title: 'Confirm',
      body: 'Review the match, tweak the details, mark your hot tracks with the fire emoji.',
    },
    {
      icon: Stack,
      title: 'Organise',
      body: 'File records into crates, explore your collection by tag, or dig through the carousel.',
    },
    {
      icon: Printer,
      title: 'Print',
      body: 'Select records and print sleeve labels in one batch. Download or send to print.',
    },
  ];

  const [step, setStep] = useState(0);
  const isLast = step === steps.length - 1;
  const StepIcon = steps[step].icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      style={{ background: 'rgba(0,0,0,0.88)', backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)' }}
    >
      <div
        className="w-full max-w-sm rounded-3xl p-8 flex flex-col items-center text-center"
        style={{
          background: 'rgba(var(--bg),0.97)',
          boxShadow: 'inset 0 1px 0 rgba(var(--fg),0.10), 0 32px 64px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(var(--fg),0.10)',
          backdropFilter: 'blur(24px)',
          WebkitBackdropFilter: 'blur(24px)',
          animation: 'fadeUp 0.3s ease-out',
        }}
        key={step}
      >
        {/* Icon */}
        <div
          className="w-16 h-16 rounded-2xl flex items-center justify-center mb-6"
          style={{
            background: `linear-gradient(145deg, rgba(139,92,246,0.35), rgba(139,92,246,0.08))`,
            boxShadow: 'inset 0 1px 0 rgba(var(--fg),0.2), 0 4px 16px rgba(0,0,0,0.4)',
          }}
        >
          <StepIcon size={28} weight="light" className="text-violet-300" />
        </div>

        {/* Title */}
        <h2 className="text-xl font-display mb-3">{steps[step].title}</h2>

        {/* Body */}
        <p className="text-white/55 text-sm leading-relaxed mb-8">{steps[step].body}</p>

        {/* Progress dots */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((_, i) => (
            <div
              key={i}
              className="rounded-full transition-all"
              style={{
                width: i === step ? 20 : 6,
                height: 6,
                background: i === step ? 'rgba(139,92,246,0.9)' : 'rgba(var(--fg),0.2)',
              }}
            />
          ))}
        </div>

        {/* Actions */}
        <button
          onClick={() => { if (isLast) { onDismiss(); } else { setStep(s => s + 1); } }}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white mb-3 transition-all"
          style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.8), rgba(6,182,212,0.6))', border: '1px solid rgba(139,92,246,0.4)' }}
        >
          {isLast ? "Let's go" : 'Next'}
        </button>
        <button
          onClick={onDismiss}
          className="text-xs font-mono text-white/30 hover:text-white/55 transition-colors"
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
      <div className="text-[10px] tracking-[0.3em] uppercase text-white/20 mb-5 font-mono">Roadmap</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
        {items.map((item, i) => (
          <div key={i} className="p-4 rounded-2xl" style={{ background: item.done ? "rgba(var(--fg),0.035)" : "transparent", border: item.done ? "1px solid rgba(var(--fg),0.09)" : "1px solid rgba(var(--fg),0.04)", opacity: item.done ? 1 : 0.45 }}>
            <div className="text-[9px] tracking-[0.25em] uppercase mb-2 font-mono" style={{ color: item.done ? `rgba(${accentRGB},0.6)` : "rgba(var(--fg),0.25)" }}>{item.label}</div>
            <div className="text-sm md:text-base leading-tight mb-1 font-display text-white/80">{item.title}</div>
            <div className="text-[11px] text-white/30 leading-snug">{item.desc}</div>
          </div>
        ))}
      </div>
    </footer>
  );
}
