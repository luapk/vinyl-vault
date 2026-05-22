import { useState, useEffect, useRef, useCallback } from "react";
import {
  Camera, Upload, Disc3, Sparkles, X, ArrowUpRight, Clock,
  Play, Pause, Plus, Check, ChevronLeft, ChevronRight, Search,
  Download, Printer, List, Grid3X3, Layers, Edit2, Trash2, ScanLine,
} from "lucide-react";
import { useCollection, exportCSV } from "../hooks/useCollection.js";

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
      else { r = 157; g = 141; b = 241; }
      resolve({ r, g, b });
    };
    img.onerror = () => resolve({ r: 157, g: 141, b: 241 });
    img.src = imageSrc;
  });

const camelotColor = (key) => {
  if (!key) return "rgb(140,140,150)";
  const num = parseInt(key, 10);
  const letter = key.slice(-1).toUpperCase();
  if (isNaN(num) || num < 1 || num > 12) return "rgb(140,140,150)";
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

// ----- Main Component --------------------------------------------------------

export default function VinylVault() {
  const [appView, setAppView] = useState("scan"); // scan | collection | batch
  const [phase, setPhase] = useState("idle"); // idle | processing | disambiguation | result | error
  const [status, setStatus] = useState("");
  const [release, setRelease] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [accent, setAccent] = useState({ r: 157, g: 141, b: 241 });
  const [errorMsg, setErrorMsg] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [visionData, setVisionData] = useState(null);
  const [pendingCrates, setPendingCrates] = useState([]);
  const [savedId, setSavedId] = useState(null);

  // Batch state
  const [batchQueue, setBatchQueue] = useState([]); // [{file, status, release, candidates, vision, imageUrl}]
  const [batchIdx, setBatchIdx] = useState(0);
  const [batchProcessing, setBatchProcessing] = useState(false);

  // Camera modal
  const [showCamera, setShowCamera] = useState(false);

  const { collection, addRecord, removeRecord, updateRecord, renameCrate, deleteCrate } = useCollection();

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
      }

      const base64Data = dataUrl.split(",")[1];
      if (!forBatch) { await new Promise((r) => setTimeout(r, 500)); setStatus("Searching Discogs"); }

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
        setPendingCrates([]);
        setPhase("result");
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
    setStatus("Pulling audio features");
    setErrorMsg("");
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discogsId: candidate.id, vision: visionData }),
      });
      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API ${response.status}: ${errorBody.slice(0, 200)}`);
      }
      const data = await response.json();
      if (data.status === "complete") {
        setRelease(data.release);
        setPendingCrates([]);
        setPhase("result");
      } else {
        throw new Error(data.error || "Unexpected response");
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Enrichment failed");
      setPhase("error");
    }
  };

  const saveRecord = () => {
    if (!release) return;
    addRecord(release, pendingCrates);
    setSavedId(`${release.artist}|${release.title}`);
  };

  const reset = () => {
    setPhase("idle");
    setRelease(null);
    setImageUrl(null);
    setAccent({ r: 157, g: 141, b: 241 });
    setErrorMsg("");
    setCandidates([]);
    setVisionData(null);
    setPendingCrates([]);
    setSavedId(null);
  };

  // Batch processing
  const startBatch = async (files) => {
    const items = Array.from(files).map((file) => ({
      file, status: "queued", release: null, candidates: null, vision: null, imageUrl: null,
    }));
    setBatchQueue(items);
    setBatchIdx(0);
    setAppView("batch");
    setBatchProcessing(true);

    const updated = [...items];
    for (let i = 0; i < updated.length; i++) {
      setBatchIdx(i);
      updated[i] = { ...updated[i], status: "processing" };
      setBatchQueue([...updated]);
      try {
        const { dataUrl, data } = await processImage(updated[i].file, true);
        updated[i].imageUrl = dataUrl;
        if (data.status === "complete") {
          updated[i].status = "complete";
          updated[i].release = data.release;
          addRecord(data.release, data.release.suggestedBoxes || []);
        } else if (data.status === "disambiguation") {
          updated[i].status = "disambiguation";
          updated[i].candidates = data.candidates;
          updated[i].vision = data.vision;
        } else {
          updated[i].status = "error";
        }
      } catch {
        updated[i].status = "error";
      }
      setBatchQueue([...updated]);
    }
    setBatchProcessing(false);
  };

  const resolveBatchDisambiguation = async (itemIdx, candidate) => {
    const updated = [...batchQueue];
    updated[itemIdx] = { ...updated[itemIdx], status: "processing" };
    setBatchQueue([...updated]);
    try {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discogsId: candidate.id, vision: updated[itemIdx].vision }),
      });
      const data = await response.json();
      if (data.status === "complete") {
        updated[itemIdx].status = "complete";
        updated[itemIdx].release = data.release;
        addRecord(data.release, data.release.suggestedBoxes || []);
      } else {
        updated[itemIdx].status = "error";
      }
    } catch {
      updated[itemIdx].status = "error";
    }
    setBatchQueue([...updated]);
  };

  const allCrates = [...new Set(collection.flatMap((r) => r.crates))].sort();
  const accentRGB = `${accent.r}, ${accent.g}, ${accent.b}`;

  return (
    <div className="min-h-screen w-full relative overflow-x-hidden" style={{ background: "#08080c", color: "#f5f5f7" }}>
      {/* Atmospheric background */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute transition-all duration-[2000ms]" style={{ inset: 0, background: `radial-gradient(ellipse 80% 60% at 80% 0%, rgba(${accentRGB}, 0.10), transparent 60%)` }} />
        <div className="absolute transition-all duration-[2000ms]" style={{ inset: 0, background: `radial-gradient(ellipse 60% 50% at 10% 100%, rgba(${accentRGB}, 0.06), transparent 60%)` }} />
      </div>

      {/* Header */}
      <header className="relative z-10 px-6 md:px-10 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: `radial-gradient(circle at 30% 30%, rgba(${accentRGB},0.4), rgba(${accentRGB},0.05))`, border: `1px solid rgba(${accentRGB}, 0.3)` }}>
            <Disc3 className="w-4 h-4" style={{ color: `rgb(${accentRGB})` }} />
          </div>
          <div>
            <div className="text-[11px] tracking-[0.28em] uppercase font-medium font-mono">Vinyl Vault</div>
            <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mt-0.5">Archive · Identify · Mix</div>
          </div>
        </div>

        <nav className="flex items-center gap-2">
          {[
            { id: "scan", label: "Scan", icon: ScanLine },
            { id: "collection", label: `Collection${collection.length ? ` (${collection.length})` : ""}`, icon: Layers },
            { id: "batch", label: "Batch", icon: Grid3X3 },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => { setAppView(id); if (id === "scan" && appView !== "scan") reset(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] tracking-[0.15em] uppercase font-mono transition-all"
              style={{
                background: appView === id ? `rgba(${accentRGB},0.18)` : "transparent",
                border: appView === id ? `1px solid rgba(${accentRGB},0.4)` : "1px solid rgba(255,255,255,0.08)",
                color: appView === id ? `rgb(${accentRGB})` : "rgba(255,255,255,0.45)",
              }}
            >
              <Icon className="w-3 h-3" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
          {appView === "scan" && (phase === "result" || phase === "disambiguation") && (
            <button onClick={reset} className="text-[11px] tracking-[0.2em] uppercase text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-full border border-white/10 hover:border-white/30 font-mono ml-1">
              New scan
            </button>
          )}
        </nav>
      </header>

      {/* Main content */}
      <main className="relative z-10 px-6 md:px-10 pb-16 max-w-7xl mx-auto">
        {appView === "scan" && (
          <>
            {phase === "idle" && <IdleView onUpload={processImage} onBatch={startBatch} accentRGB={accentRGB} />}
            {phase === "processing" && <ProcessingView imageUrl={imageUrl} status={status} accentRGB={accentRGB} />}
            {phase === "disambiguation" && (
              <DisambiguationView candidates={candidates} vision={visionData} imageUrl={imageUrl} accentRGB={accentRGB} onPick={pickCandidate} />
            )}
            {phase === "result" && release && (
              <ResultView
                release={release} imageUrl={imageUrl} accentRGB={accentRGB}
                pendingCrates={pendingCrates} setPendingCrates={setPendingCrates}
                allCrates={allCrates} onSave={saveRecord} saved={!!savedId}
              />
            )}
            {phase === "error" && <ErrorView message={errorMsg} onReset={reset} />}
          </>
        )}

        {appView === "collection" && (
          <CollectionView
            collection={collection} accentRGB={accentRGB}
            onRemove={removeRecord} onUpdate={updateRecord}
            onRenameCrate={renameCrate} onDeleteCrate={deleteCrate}
            onDownloadCSV={() => downloadCSV(collection)}
          />
        )}

        {appView === "batch" && (
          <BatchView
            queue={batchQueue} processing={batchProcessing}
            onResolve={resolveBatchDisambiguation}
            onBatch={startBatch} accentRGB={accentRGB}
          />
        )}
      </main>

      {appView === "scan" && phase === "idle" && <RoadmapFooter />}
    </div>
  );
}

// ----- IdleView --------------------------------------------------------------

function IdleView({ onUpload, onBatch, accentRGB }) {
  const handleFile = (e) => { const f = e.target.files?.[0]; if (f) onUpload(f); };
  const handleBatch = (e) => { if (e.target.files?.length) onBatch(e.target.files); };

  return (
    <div className="pt-8 md:pt-16">
      <div className="max-w-3xl">
        <div className="text-[11px] tracking-[0.3em] uppercase mb-6 text-white/40 font-mono">/* New entry */</div>
        <h1 className="text-5xl md:text-7xl lg:text-8xl leading-[0.95] mb-6 font-display">
          <span className="italic">Photograph</span> a sleeve.
          <br />
          <span className="text-white/40">We do the rest.</span>
        </h1>
        <p className="text-white/50 text-base md:text-lg max-w-xl leading-relaxed">
          Identification, tracklist, BPM and Camelot key for every record. Filed into virtual crates, surfaced when you need them.
        </p>
      </div>

      <div className="mt-12 md:mt-16 flex flex-col sm:flex-row gap-4">
        {/* Single scan */}
        <label className="relative flex-1 block rounded-3xl overflow-hidden p-8 md:p-10 cursor-pointer transition-all hover:brightness-110 active:scale-[0.995]"
          style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)", border: `1px solid rgba(${accentRGB},0.18)`, boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 60px -20px rgba(0,0,0,0.5), 0 0 60px -20px rgba(${accentRGB},0.2)` }}>
          <div className="flex flex-col gap-4 relative z-10">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: `radial-gradient(circle at 35% 35%, rgba(${accentRGB},0.35), transparent 70%)`, border: `1px solid rgba(${accentRGB},0.4)` }}>
              <Disc3 className="w-6 h-6 animate-spin" style={{ color: `rgb(${accentRGB})`, animationDuration: "8s" }} />
            </div>
            <div>
              <div className="text-[10px] tracking-[0.25em] uppercase text-white/40 mb-1 font-mono">Single</div>
              <div className="text-xl font-display"><span className="italic">Camera</span> or upload</div>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm self-start" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.3), rgba(${accentRGB},0.12))`, border: `1px solid rgba(${accentRGB},0.45)`, color: "#fff" }}>
              <Camera className="w-4 h-4" /><Upload className="w-4 h-4 opacity-60" />Tap to scan
            </div>
          </div>
          <input type="file" accept="image/*" onChange={handleFile} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
        </label>

        {/* Batch scan */}
        <label className="relative flex-1 block rounded-3xl overflow-hidden p-8 md:p-10 cursor-pointer transition-all hover:brightness-110 active:scale-[0.995]"
          style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.03), rgba(255,255,255,0.008))", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04), 0 30px 60px -20px rgba(0,0,0,0.5)" }}>
          <div className="flex flex-col gap-4 relative z-10">
            <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.15)" }}>
              <Grid3X3 className="w-6 h-6 text-white/50" />
            </div>
            <div>
              <div className="text-[10px] tracking-[0.25em] uppercase text-white/40 mb-1 font-mono">Batch</div>
              <div className="text-xl font-display"><span className="italic">Multiple</span> records</div>
            </div>
            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm self-start border border-white/15 text-white/60">
              <ScanLine className="w-4 h-4" />Queue photos
            </div>
          </div>
          <input type="file" accept="image/*" multiple onChange={handleBatch} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }} />
        </label>
      </div>
    </div>
  );
}

// ----- ProcessingView --------------------------------------------------------

function ProcessingView({ imageUrl, status, accentRGB }) {
  return (
    <div className="pt-12 flex flex-col items-center">
      <div className="relative max-w-md w-full aspect-square rounded-2xl overflow-hidden">
        {imageUrl && <img src={imageUrl} alt="Scanning" className="w-full h-full object-cover" />}
        <div className="absolute left-0 right-0 h-[3px] pointer-events-none" style={{ background: `linear-gradient(90deg, transparent, rgba(${accentRGB},1), transparent)`, boxShadow: `0 0 30px rgba(${accentRGB},0.8), 0 0 60px rgba(${accentRGB},0.5)`, animation: "scanLine 2s ease-in-out infinite" }} />
        <div className="absolute inset-0 pointer-events-none opacity-30" style={{ backgroundImage: `linear-gradient(rgba(${accentRGB},0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(${accentRGB},0.4) 1px, transparent 1px)`, backgroundSize: "32px 32px" }} />
        <div className="absolute inset-0 pointer-events-none" style={{ boxShadow: `inset 0 0 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(${accentRGB},0.3)` }} />
      </div>
      <div className="mt-8 text-[11px] tracking-[0.3em] uppercase flex items-center gap-3 font-mono" style={{ color: `rgb(${accentRGB})` }}>
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: `rgb(${accentRGB})`, animation: "pulse 1.4s ease-in-out infinite" }} />
        {status}
      </div>
    </div>
  );
}

// ----- ResultView ------------------------------------------------------------

function ResultView({ release, imageUrl, accentRGB, pendingCrates, setPendingCrates, allCrates, onSave, saved }) {
  const audioRef = useRef(null);
  const [playingPreview, setPlayingPreview] = useState(null);
  const [crateInput, setCrateInput] = useState("");

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

  const toggleCrate = (name) => {
    setPendingCrates((prev) =>
      prev.includes(name) ? prev.filter((c) => c !== name) : [...prev, name]
    );
  };

  const addCustomCrate = () => {
    const name = crateInput.trim();
    if (!name || pendingCrates.includes(name)) return;
    setPendingCrates((prev) => [...prev, name]);
    setCrateInput("");
  };

  const displayImage = release.coverUrl || imageUrl;
  const suggestedNotSelected = (release.suggestedBoxes || []).filter((b) => !pendingCrates.includes(b));
  const existingNotSelected = allCrates.filter((c) => !pendingCrates.includes(c) && !(release.suggestedBoxes || []).includes(c));

  return (
    <div className="pt-4 md:pt-8 grid gap-6 md:gap-8" style={{ animation: "fadeUp 0.8s ease-out" }}>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <ConfidenceBadge confidence={release.confidence} identified={release.identified} accentRGB={accentRGB} />
          {release.source && release.source !== "vision" && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[10px] tracking-[0.2em] uppercase font-mono text-white/40" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              {release.source === "discogs+spotify" ? "Discogs · Spotify" : "Discogs"}
            </div>
          )}
          {release.notes && <div className="text-[11px] text-white/50 font-mono">{release.notes}</div>}
        </div>
      </div>

      <div className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-10">
        <div className="relative">
          <div className="relative w-full md:w-[320px] lg:w-[380px] aspect-square rounded-2xl overflow-hidden" style={{ boxShadow: `0 30px 80px -20px rgba(${accentRGB},0.5), 0 0 0 1px rgba(255,255,255,0.06), inset 0 1px 0 rgba(255,255,255,0.08)` }}>
            {displayImage && <img src={displayImage} alt={release.title} className="w-full h-full object-cover" onError={(e) => { if (e.target.src !== imageUrl) e.target.src = imageUrl; }} />}
            <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.08), transparent 40%)" }} />
          </div>
          <div className="absolute -inset-12 -z-10 blur-3xl opacity-50" style={{ background: `radial-gradient(circle, rgba(${accentRGB},0.4), transparent 60%)` }} />
        </div>

        <div className="flex flex-col justify-center">
          <div className="text-[11px] tracking-[0.3em] uppercase text-white/40 mb-3 font-mono">
            {[release.format, release.year, release.country].filter(Boolean).join(" · ")}
          </div>
          <h1 className="text-3xl md:text-5xl lg:text-6xl leading-[1.05] mb-2 font-display">
            <span className="italic">{release.artist}</span>
          </h1>
          <h2 className="text-2xl md:text-3xl lg:text-4xl leading-tight mb-6 text-white/70 font-display">
            {release.title}
          </h2>
          <div className="flex flex-wrap gap-2 mb-6">
            {release.label && <Pill label="Label" value={release.label} />}
            {release.catalogNumber && <Pill label="Cat #" value={release.catalogNumber} mono />}
          </div>
          {release.genres && release.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {release.genres.map((g, i) => (
                <span key={i} className="text-[10px] tracking-[0.15em] uppercase px-2.5 py-1 rounded-full font-mono" style={{ background: `rgba(${accentRGB},0.1)`, border: `1px solid rgba(${accentRGB},0.25)`, color: `rgb(${accentRGB})` }}>{g}</span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Crate assignment + save */}
      <Section title="File into crates" subtitle="Select before saving" accentRGB={accentRGB} icon={<Sparkles className="w-3.5 h-3.5" style={{ color: `rgb(${accentRGB})` }} />}>
        <div className="space-y-4">
          {/* Selected crates */}
          {pendingCrates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingCrates.map((name) => (
                <button key={name} onClick={() => toggleCrate(name)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all" style={{ background: `rgba(${accentRGB},0.18)`, border: `1px solid rgba(${accentRGB},0.45)`, color: `rgb(${accentRGB})` }}>
                  <Check className="w-3 h-3" />{name}<X className="w-3 h-3 opacity-60" />
                </button>
              ))}
            </div>
          )}

          {/* Suggested */}
          {suggestedNotSelected.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-white/30 mb-2 font-mono">Suggested</div>
              <div className="flex flex-wrap gap-2">
                {suggestedNotSelected.map((name) => (
                  <button key={name} onClick={() => toggleCrate(name)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all hover:border-white/30 hover:text-white/80" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,255,255,0.55)" }}>
                    <Plus className="w-3 h-3" />{name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Existing crates */}
          {existingNotSelected.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.2em] uppercase text-white/30 mb-2 font-mono">Your crates</div>
              <div className="flex flex-wrap gap-2">
                {existingNotSelected.map((name) => (
                  <button key={name} onClick={() => toggleCrate(name)} className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[11px] font-mono transition-all hover:border-white/30 hover:text-white/70" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.40)" }}>
                    <Plus className="w-3 h-3" />{name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Custom crate input */}
          <div className="flex items-center gap-2">
            <input
              value={crateInput} onChange={(e) => setCrateInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomCrate()}
              placeholder="New crate name..."
              className="flex-1 bg-white/[0.03] border border-white/10 rounded-full px-4 py-2 text-[12px] font-mono text-white/70 placeholder-white/25 outline-none focus:border-white/25"
            />
            <button onClick={addCustomCrate} className="px-4 py-2 rounded-full text-[11px] font-mono border border-white/15 text-white/50 hover:text-white/80 hover:border-white/30 transition-all">
              Add
            </button>
          </div>

          {/* Save button */}
          <button
            onClick={onSave}
            disabled={saved}
            className="w-full py-3 rounded-2xl text-[12px] tracking-[0.2em] uppercase font-mono transition-all"
            style={saved
              ? { background: "rgba(100,220,130,0.12)", border: "1px solid rgba(100,220,130,0.35)", color: "rgb(100,220,130)" }
              : { background: `linear-gradient(135deg, rgba(${accentRGB},0.3), rgba(${accentRGB},0.12))`, border: `1px solid rgba(${accentRGB},0.45)`, color: "#fff", boxShadow: `0 0 24px -8px rgba(${accentRGB},0.5)` }
            }
          >
            {saved ? <span className="flex items-center justify-center gap-2"><Check className="w-4 h-4" />Saved to collection</span> : "Save to collection"}
          </button>
        </div>
      </Section>

      {release.tracklist && release.tracklist.length > 0 && (
        <Section title="Tracklist" subtitle={`${release.tracklist.length} tracks`} accentRGB={accentRGB}>
          <div className="space-y-1">
            {release.tracklist.map((track, i) => (
              <TrackRow key={i} track={track} index={i} accentRGB={accentRGB} playingPreview={playingPreview} onPlay={playPreview} />
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

// ----- CollectionView --------------------------------------------------------

function CollectionView({ collection, accentRGB, onRemove, onUpdate, onRenameCrate, onDeleteCrate, onDownloadCSV }) {
  const [viewMode, setViewMode] = useState("carousel"); // carousel | grid
  const [search, setSearch] = useState("");
  const [filterCrate, setFilterCrate] = useState(null);
  const [filterGenre, setFilterGenre] = useState(null);
  const [carouselIdx, setCarouselIdx] = useState(0);
  const [editingCrate, setEditingCrate] = useState(null); // {name, newName}
  const [showCrateManager, setShowCrateManager] = useState(false);
  const [detailRecord, setDetailRecord] = useState(null);

  const allCrates = [...new Set(collection.flatMap((r) => r.crates))].sort();
  const allGenres = [...new Set(collection.flatMap((r) => r.genres || []))].sort();

  const filtered = collection.filter((r) => {
    const q = search.toLowerCase();
    const matchSearch = !q || r.artist.toLowerCase().includes(q) || r.title.toLowerCase().includes(q) || (r.label || "").toLowerCase().includes(q) || (r.catalogNumber || "").toLowerCase().includes(q);
    const matchCrate = !filterCrate || (r.crates || []).includes(filterCrate);
    const matchGenre = !filterGenre || (r.genres || []).includes(filterGenre);
    return matchSearch && matchCrate && matchGenre;
  });

  // Keep carousel index in bounds when filter changes
  useEffect(() => { setCarouselIdx(0); }, [search, filterCrate, filterGenre]);

  const goNext = useCallback(() => setCarouselIdx((i) => Math.min(i + 1, filtered.length - 1)), [filtered.length]);
  const goPrev = useCallback(() => setCarouselIdx((i) => Math.max(i - 1, 0)), []);

  useEffect(() => {
    const handler = (e) => {
      if (viewMode !== "carousel" || detailRecord) return;
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [viewMode, detailRecord, goNext, goPrev]);

  if (collection.length === 0) {
    return (
      <div className="pt-16 flex flex-col items-center text-center max-w-md mx-auto">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <Disc3 className="w-8 h-8 text-white/20" />
        </div>
        <h2 className="text-3xl mb-3 font-display"><span className="italic">Collection</span> is empty</h2>
        <p className="text-white/40 text-sm leading-relaxed">Scan your first record to start building your archive.</p>
      </div>
    );
  }

  return (
    <div className="pt-4 md:pt-8">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search artist, title, label..." className="w-full bg-white/[0.04] border border-white/10 rounded-full pl-8 pr-4 py-2 text-[12px] font-mono text-white/70 placeholder-white/25 outline-none focus:border-white/25" />
        </div>

        {/* View toggle */}
        <div className="flex items-center rounded-full overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
          {[{ id: "carousel", icon: Layers }, { id: "grid", icon: Grid3X3 }].map(({ id, icon: Icon }) => (
            <button key={id} onClick={() => setViewMode(id)} className="px-3 py-2 transition-all" style={{ background: viewMode === id ? "rgba(255,255,255,0.1)" : "transparent", color: viewMode === id ? "#fff" : "rgba(255,255,255,0.35)" }}>
              <Icon className="w-3.5 h-3.5" />
            </button>
          ))}
        </div>

        <button onClick={() => setShowCrateManager(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-mono border border-white/10 text-white/45 hover:text-white/70 hover:border-white/25 transition-all">
          <Edit2 className="w-3 h-3" />Crates
        </button>

        <button onClick={onDownloadCSV} className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-mono border border-white/10 text-white/45 hover:text-white/70 hover:border-white/25 transition-all">
          <Download className="w-3 h-3" />CSV
        </button>

        <button onClick={() => window.print()} className="flex items-center gap-1.5 px-3 py-2 rounded-full text-[11px] font-mono border border-white/10 text-white/45 hover:text-white/70 hover:border-white/25 transition-all">
          <Printer className="w-3 h-3" />Print
        </button>
      </div>

      {/* Filter pills */}
      {(allCrates.length > 0 || allGenres.length > 0) && (
        <div className="flex flex-wrap gap-2 mb-6">
          {allCrates.map((c) => (
            <button key={c} onClick={() => setFilterCrate(filterCrate === c ? null : c)} className="px-3 py-1 rounded-full text-[10px] tracking-[0.15em] uppercase font-mono transition-all" style={{ background: filterCrate === c ? "rgba(157,141,241,0.18)" : "rgba(255,255,255,0.03)", border: filterCrate === c ? "1px solid rgba(157,141,241,0.4)" : "1px solid rgba(255,255,255,0.08)", color: filterCrate === c ? "rgb(157,141,241)" : "rgba(255,255,255,0.4)" }}>
              {c}
            </button>
          ))}
          {allGenres.map((g) => (
            <button key={g} onClick={() => setFilterGenre(filterGenre === g ? null : g)} className="px-3 py-1 rounded-full text-[10px] tracking-[0.12em] uppercase font-mono transition-all" style={{ background: filterGenre === g ? "rgba(100,200,180,0.12)" : "transparent", border: filterGenre === g ? "1px solid rgba(100,200,180,0.35)" : "1px solid rgba(255,255,255,0.06)", color: filterGenre === g ? "rgb(100,200,180)" : "rgba(255,255,255,0.28)" }}>
              {g}
            </button>
          ))}
        </div>
      )}

      <div className="text-[10px] tracking-[0.2em] uppercase text-white/30 mb-4 font-mono">
        {filtered.length} record{filtered.length !== 1 ? "s" : ""}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-white/30 text-sm font-mono">No records match this filter.</div>
      )}

      {/* Carousel view */}
      {viewMode === "carousel" && filtered.length > 0 && (
        <VinylCarousel
          records={filtered} index={carouselIdx} onIndexChange={setCarouselIdx}
          onPrev={goPrev} onNext={goNext}
          onSelect={(r) => setDetailRecord(r)}
          onRemove={onRemove}
          accentRGB={accentRGB}
        />
      )}

      {/* Grid view */}
      {viewMode === "grid" && filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
          {filtered.map((record) => (
            <RecordCard key={record.id} record={record} onSelect={() => setDetailRecord(record)} onRemove={() => onRemove(record.id)} accentRGB={accentRGB} />
          ))}
        </div>
      )}

      {/* Detail modal */}
      {detailRecord && (
        <RecordDetailModal record={detailRecord} onClose={() => setDetailRecord(null)} onRemove={() => { onRemove(detailRecord.id); setDetailRecord(null); }} accentRGB={accentRGB} />
      )}

      {/* Crate manager modal */}
      {showCrateManager && (
        <CrateManagerModal crates={allCrates} onClose={() => setShowCrateManager(false)} onRename={onRenameCrate} onDelete={onDeleteCrate} />
      )}
    </div>
  );
}

// ----- VinylCarousel ---------------------------------------------------------

function VinylCarousel({ records, index, onIndexChange, onPrev, onNext, onSelect, onRemove, accentRGB }) {
  const touchStartX = useRef(null);
  const containerRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState(0);

  const onTouchStart = (e) => { touchStartX.current = e.touches[0].clientX; setDragging(false); setDragDelta(0); };
  const onTouchMove = (e) => {
    if (touchStartX.current === null) return;
    const delta = e.touches[0].clientX - touchStartX.current;
    setDragging(true);
    setDragDelta(delta);
  };
  const onTouchEnd = () => {
    if (Math.abs(dragDelta) > 60) { dragDelta < 0 ? onNext() : onPrev(); }
    touchStartX.current = null;
    setDragging(false);
    setDragDelta(0);
  };

  const current = records[index];
  if (!current) return null;

  // Compute which records to show in the stack (prev, current, next, +1)
  const stack = [-2, -1, 0, 1, 2].map((offset) => ({
    offset,
    record: records[index + offset] || null,
  }));

  return (
    <div className="relative select-none">
      {/* Stack container */}
      <div
        ref={containerRef}
        className="relative mx-auto"
        style={{ height: "min(70vw, 520px)", maxWidth: "min(70vw, 520px)" }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {stack.map(({ offset, record }) => {
          if (!record) return null;
          const isActive = offset === 0;
          const absOffset = Math.abs(offset);

          // Stacking physics
          const translateX = (offset + (dragging ? dragDelta / 320 : 0)) * 52;
          const translateY = absOffset * 8;
          const rotate = offset * 3 + (dragging && isActive ? dragDelta * 0.03 : 0);
          const scale = 1 - absOffset * 0.07;
          const zIndex = 10 - absOffset;
          const opacity = offset < -2 || offset > 2 ? 0 : 1 - absOffset * 0.15;

          return (
            <div
              key={record.id}
              onClick={() => { if (isActive && !dragging) onSelect(record); else if (!dragging) onIndexChange(index + offset); }}
              style={{
                position: "absolute",
                inset: 0,
                transform: `translateX(${translateX}px) translateY(${translateY}px) rotate(${rotate}deg) scale(${scale})`,
                zIndex,
                opacity,
                transition: dragging ? "none" : "transform 0.22s cubic-bezier(0.25, 1.1, 0.5, 1), opacity 0.15s ease",
                cursor: isActive ? "pointer" : "pointer",
                transformOrigin: "center bottom",
              }}
            >
              <div
                className="w-full h-full rounded-2xl overflow-hidden"
                style={{
                  boxShadow: isActive
                    ? `0 40px 100px -20px rgba(0,0,0,0.8), 0 0 0 1px rgba(255,255,255,0.08), 0 0 60px -20px rgba(${accentRGB},0.4)`
                    : "0 20px 60px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04)",
                }}
              >
                {record.coverUrl ? (
                  <img src={record.coverUrl} alt={record.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.12), rgba(${accentRGB},0.03))` }}>
                    <Disc3 className="w-16 h-16 opacity-20" />
                  </div>
                )}
                {isActive && (
                  <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.1) 50%, transparent 100%)" }} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Active record info */}
      <div className="mt-8 text-center" style={{ animation: "fadeUp 0.18s ease-out" }} key={current.id}>
        <div className="text-[10px] tracking-[0.25em] uppercase text-white/35 mb-2 font-mono">
          {[current.year, current.format, current.country].filter(Boolean).join(" · ")}
        </div>
        <div className="text-2xl md:text-3xl leading-tight mb-1 font-display">
          <span className="italic">{current.artist}</span>
        </div>
        <div className="text-lg md:text-xl text-white/60 font-display mb-3">{current.title}</div>
        {current.crates && current.crates.length > 0 && (
          <div className="flex flex-wrap justify-center gap-1.5 mb-4">
            {current.crates.map((c) => (
              <span key={c} className="text-[10px] tracking-[0.15em] uppercase px-2.5 py-1 rounded-full font-mono" style={{ background: `rgba(${accentRGB},0.1)`, border: `1px solid rgba(${accentRGB},0.25)`, color: `rgb(${accentRGB})` }}>{c}</span>
            ))}
          </div>
        )}
        <div className="text-[10px] tracking-[0.2em] uppercase text-white/25 font-mono mb-6">
          {index + 1} of {records.length} — tap to view
        </div>
      </div>

      {/* Nav arrows */}
      <div className="flex items-center justify-center gap-4">
        <button onClick={onPrev} disabled={index === 0} className="w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-20" style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
          <ChevronLeft className="w-4 h-4" />
        </button>

        {/* Dot strip */}
        <div className="flex items-center gap-1.5">
          {records.slice(Math.max(0, index - 4), Math.min(records.length, index + 5)).map((_, i) => {
            const absIdx = Math.max(0, index - 4) + i;
            return (
              <button key={absIdx} onClick={() => onIndexChange(absIdx)} className="rounded-full transition-all" style={{ width: absIdx === index ? 20 : 6, height: 6, background: absIdx === index ? `rgb(${accentRGB})` : "rgba(255,255,255,0.2)" }} />
            );
          })}
        </div>

        <button onClick={onNext} disabled={index === records.length - 1} className="w-10 h-10 rounded-full flex items-center justify-center transition-all disabled:opacity-20" style={{ border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.04)" }}>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ----- RecordCard (grid) -----------------------------------------------------

function RecordCard({ record, onSelect, onRemove, accentRGB }) {
  return (
    <div className="relative group cursor-pointer" onClick={onSelect}>
      <div className="aspect-square rounded-xl overflow-hidden mb-2" style={{ boxShadow: "0 10px 40px -10px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.05)" }}>
        {record.coverUrl ? (
          <img src={record.coverUrl} alt={record.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
        ) : (
          <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.1), rgba(${accentRGB},0.02))` }}>
            <Disc3 className="w-8 h-8 opacity-20" />
          </div>
        )}
        <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(0,0,0,0.3)" }}>
          <button onClick={(e) => { e.stopPropagation(); onRemove(); }} className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-500/80 flex items-center justify-center">
            <X className="w-3 h-3 text-white" />
          </button>
        </div>
      </div>
      <div className="text-[11px] leading-snug font-display truncate">{record.artist}</div>
      <div className="text-[10px] text-white/50 truncate font-mono">{record.title}</div>
    </div>
  );
}

// ----- RecordDetailModal -----------------------------------------------------

function RecordDetailModal({ record, onClose, onRemove, accentRGB }) {
  const audioRef = useRef(null);
  const [playingPreview, setPlayingPreview] = useState(null);

  const playPreview = (url) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (playingPreview === url) { setPlayingPreview(null); return; }
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play().catch(() => {});
    setPlayingPreview(url);
    audio.onended = () => { setPlayingPreview(null); audioRef.current = null; };
  };
  useEffect(() => () => audioRef.current?.pause(), []);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} onClick={onClose}>
      <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-3xl p-6 md:p-8" style={{ background: "linear-gradient(135deg, rgba(20,20,28,0.98), rgba(12,12,18,0.98))", border: "1px solid rgba(255,255,255,0.08)", boxShadow: "0 40px 100px -20px rgba(0,0,0,0.9)" }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center border border-white/10 text-white/50 hover:text-white transition-colors">
          <X className="w-4 h-4" />
        </button>

        <div className="grid sm:grid-cols-[160px_1fr] gap-6 mb-6">
          <div className="aspect-square rounded-xl overflow-hidden" style={{ boxShadow: `0 20px 60px -15px rgba(${accentRGB},0.4)` }}>
            {record.coverUrl ? (
              <img src={record.coverUrl} alt={record.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center" style={{ background: `rgba(${accentRGB},0.08)` }}>
                <Disc3 className="w-8 h-8 opacity-20" />
              </div>
            )}
          </div>
          <div className="flex flex-col justify-center">
            <div className="text-[10px] tracking-[0.2em] uppercase text-white/35 mb-2 font-mono">
              {[record.year, record.format, record.country].filter(Boolean).join(" · ")}
            </div>
            <div className="text-2xl leading-tight mb-1 font-display"><span className="italic">{record.artist}</span></div>
            <div className="text-lg text-white/60 font-display mb-3">{record.title}</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {record.label && <Pill label="Label" value={record.label} />}
              {record.catalogNumber && <Pill label="Cat #" value={record.catalogNumber} mono />}
            </div>
            {record.crates && record.crates.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {record.crates.map((c) => (
                  <span key={c} className="text-[10px] tracking-[0.15em] uppercase px-2.5 py-1 rounded-full font-mono" style={{ background: `rgba(${accentRGB},0.1)`, border: `1px solid rgba(${accentRGB},0.25)`, color: `rgb(${accentRGB})` }}>{c}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        {record.tracklist && record.tracklist.length > 0 && (
          <div className="space-y-1 mb-6">
            <div className="text-[10px] tracking-[0.2em] uppercase text-white/30 mb-3 font-mono">Tracklist</div>
            {record.tracklist.map((track, i) => (
              <TrackRow key={i} track={track} index={i} accentRGB={accentRGB} playingPreview={playingPreview} onPlay={playPreview} />
            ))}
          </div>
        )}

        <button onClick={onRemove} className="flex items-center gap-2 px-4 py-2 rounded-full text-[11px] font-mono text-red-400/70 border border-red-400/20 hover:border-red-400/50 hover:text-red-400 transition-all">
          <Trash2 className="w-3 h-3" />Remove from collection
        </button>
      </div>
    </div>
  );
}

// ----- CrateManagerModal -----------------------------------------------------

function CrateManagerModal({ crates, onClose, onRename, onDelete }) {
  const [editingName, setEditingName] = useState(null);
  const [newName, setNewName] = useState("");

  const startEdit = (crate) => { setEditingName(crate); setNewName(crate); };
  const commitRename = () => {
    if (newName.trim() && newName.trim() !== editingName) onRename(editingName, newName.trim());
    setEditingName(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.75)", backdropFilter: "blur(8px)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl p-6" style={{ background: "linear-gradient(135deg, rgba(20,20,28,0.98), rgba(12,12,18,0.98))", border: "1px solid rgba(255,255,255,0.08)" }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-[11px] tracking-[0.3em] uppercase font-mono">Crate manager</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full flex items-center justify-center border border-white/10 text-white/50 hover:text-white transition-colors"><X className="w-4 h-4" /></button>
        </div>
        {crates.length === 0 && <p className="text-white/40 text-sm font-mono text-center py-4">No crates yet.</p>}
        <div className="space-y-2">
          {crates.map((crate) => (
            <div key={crate} className="flex items-center gap-3 p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
              {editingName === crate ? (
                <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingName(null); }} onBlur={commitRename} className="flex-1 bg-white/[0.06] border border-white/15 rounded-lg px-3 py-1 text-sm font-mono outline-none" />
              ) : (
                <span className="flex-1 text-sm font-mono text-white/80">{crate}</span>
              )}
              <button onClick={() => startEdit(crate)} className="w-7 h-7 rounded-full flex items-center justify-center text-white/30 hover:text-white/70 transition-colors"><Edit2 className="w-3 h-3" /></button>
              <button onClick={() => onDelete(crate)} className="w-7 h-7 rounded-full flex items-center justify-center text-red-400/40 hover:text-red-400/80 transition-colors"><Trash2 className="w-3 h-3" /></button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ----- BatchView -------------------------------------------------------------

function BatchView({ queue, processing, onResolve, onBatch, accentRGB }) {
  const statusIcon = (s) => {
    if (s === "complete") return <Check className="w-4 h-4 text-green-400" />;
    if (s === "error") return <X className="w-4 h-4 text-red-400" />;
    if (s === "processing") return <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: `rgba(${accentRGB},0.6)`, borderTopColor: "transparent" }} />;
    if (s === "disambiguation") return <Sparkles className="w-4 h-4 text-yellow-400" />;
    return <div className="w-4 h-4 rounded-full border border-white/20" />;
  };

  if (queue.length === 0) {
    return (
      <div className="pt-16 flex flex-col items-center text-center max-w-md mx-auto">
        <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)" }}>
          <Grid3X3 className="w-8 h-8 text-white/20" />
        </div>
        <h2 className="text-3xl mb-3 font-display"><span className="italic">Batch</span> scan</h2>
        <p className="text-white/40 text-sm mb-6 leading-relaxed">Upload multiple sleeve photos to scan them all at once. Auto-saved to your collection, pauses on disambiguation.</p>
        <label className="cursor-pointer px-5 py-2.5 rounded-full border border-white/20 hover:bg-white/5 transition-all text-sm font-mono text-white/70">
          Choose photos
          <input type="file" accept="image/*" multiple onChange={(e) => e.target.files?.length && onBatch(e.target.files)} className="hidden" />
        </label>
      </div>
    );
  }

  const done = queue.filter((i) => i.status === "complete").length;
  const needsReview = queue.filter((i) => i.status === "disambiguation");

  return (
    <div className="pt-4 md:pt-8">
      <div className="flex items-center gap-3 mb-6">
        <h2 className="text-2xl font-display"><span className="italic">Batch</span> progress</h2>
        <span className="text-[11px] font-mono text-white/40">{done}/{queue.length} saved</span>
        {processing && <div className="w-4 h-4 rounded-full border-2 animate-spin" style={{ borderColor: `rgba(${accentRGB},0.4)`, borderTopColor: `rgb(${accentRGB})` }} />}
      </div>

      {needsReview.length > 0 && (
        <div className="mb-6 p-4 rounded-2xl" style={{ background: "rgba(250,200,100,0.06)", border: "1px solid rgba(250,200,100,0.2)" }}>
          <div className="text-[10px] tracking-[0.2em] uppercase text-yellow-400/70 mb-1 font-mono">{needsReview.length} needs disambiguation</div>
          <p className="text-sm text-white/50">Scroll down to pick the correct pressing for flagged records.</p>
        </div>
      )}

      <div className="space-y-3">
        {queue.map((item, idx) => (
          <div key={idx} className="rounded-2xl overflow-hidden" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <div className="flex items-center gap-4 p-4">
              <div className="w-12 h-12 rounded-xl overflow-hidden shrink-0">
                {item.imageUrl ? <img src={item.imageUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-white/5" />}
              </div>
              <div className="flex-1 min-w-0">
                {item.release ? (
                  <>
                    <div className="text-sm font-display truncate">{item.release.artist} — {item.release.title}</div>
                    <div className="text-[10px] text-white/40 font-mono">{item.release.catalogNumber || item.release.label || ""}</div>
                  </>
                ) : item.status === "disambiguation" ? (
                  <div className="text-sm text-yellow-400/80 font-mono">Multiple pressings found</div>
                ) : (
                  <div className="text-sm text-white/40 font-mono capitalize">{item.status}</div>
                )}
              </div>
              {statusIcon(item.status)}
            </div>

            {item.status === "disambiguation" && item.candidates && (
              <div className="px-4 pb-4">
                <div className="text-[10px] tracking-[0.2em] uppercase text-white/30 mb-2 font-mono">Pick pressing</div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {item.candidates.map((c) => (
                    <button key={c.id} onClick={() => onResolve(idx, c)} className="text-left p-2 rounded-xl text-[11px] transition-all hover:bg-white/5" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
                      <div className="font-mono text-white/70 truncate">{c.artist}</div>
                      <div className="text-white/40 truncate">{c.recordTitle}</div>
                      <div className="text-white/25 font-mono">{c.catalogNumber} {c.year}</div>
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

// ----- Shared components -----------------------------------------------------

function TrackRow({ track, index, accentRGB, playingPreview, onPlay }) {
  const keyColor = track.key ? camelotColor(track.key) : null;
  const isPlaying = track.previewUrl && playingPreview === track.previewUrl;
  return (
    <div className="grid grid-cols-[40px_1fr_auto] md:grid-cols-[50px_1fr_auto_auto_auto_32px] items-center gap-3 md:gap-5 px-3 md:px-5 py-3 rounded-xl transition-all group hover:bg-white/[0.03]" style={{ animation: `fadeUp 0.4s ease-out ${index * 0.05}s both` }}>
      <div className="text-[11px] tracking-[0.15em] text-white/50 font-medium font-mono">{track.position}</div>
      <div className="min-w-0">
        <div className="text-base md:text-[17px] truncate font-display">{track.title}</div>
        <div className="md:hidden text-[10px] tracking-[0.1em] text-white/40 mt-0.5 flex items-center gap-2 font-mono">
          {track.duration && <span>{track.duration}</span>}
          {track.duration && <span>·</span>}
          <span>{track.bpm != null ? `${track.bpm} BPM` : "— BPM"}</span>
          <span>·</span>
          <span style={{ color: keyColor || "rgba(255,255,255,0.25)" }}>{track.key || "—"}</span>
        </div>
      </div>
      <div className="hidden md:flex items-center gap-1.5 text-[12px] text-white/50 tabular-nums font-mono"><Clock className="w-3 h-3" />{track.duration || "—"}</div>
      <div className="hidden md:flex items-center gap-1.5 text-[12px] tabular-nums min-w-[80px] justify-end font-mono">
        <span className="text-white/30 text-[10px]">BPM</span>
        <span className="font-medium">{track.bpm != null ? track.bpm : "—"}</span>
      </div>
      <div className="flex items-center justify-center w-12 md:w-14 h-7 md:h-8">
        {keyColor ? (
          <div className="w-full h-full rounded-full flex items-center justify-center text-[11px] md:text-[12px] font-semibold tabular-nums font-mono" style={{ background: keyColor.replace("hsl", "hsla").replace(")", ", 0.12)"), border: `1px solid ${keyColor.replace("hsl", "hsla").replace(")", ", 0.35)")}`, color: keyColor }}>{track.key}</div>
        ) : (
          <span className="text-white/25 text-[11px] font-mono">—</span>
        )}
      </div>
      <div className="hidden md:flex items-center justify-center">
        {track.previewUrl ? (
          <button onClick={() => onPlay(track.previewUrl)} className="w-7 h-7 rounded-full flex items-center justify-center transition-all" style={{ background: isPlaying ? `rgba(${accentRGB},0.2)` : "transparent", border: isPlaying ? `1px solid rgba(${accentRGB},0.4)` : "1px solid rgba(255,255,255,0.1)", color: isPlaying ? `rgb(${accentRGB})` : "rgba(255,255,255,0.3)" }}>
            {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
          </button>
        ) : <div className="w-7 h-7" />}
      </div>
    </div>
  );
}

function Section({ title, subtitle, icon, accentRGB, children }) {
  return (
    <section className="rounded-3xl p-6 md:p-8" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)", border: "1px solid rgba(255,255,255,0.06)", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 50px -20px rgba(0,0,0,0.4)" }}>
      <div className="flex items-baseline justify-between mb-5 md:mb-6">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-[11px] tracking-[0.3em] uppercase font-medium font-mono">{title}</h3>
        </div>
        {subtitle && <div className="text-[10px] tracking-[0.15em] uppercase text-white/40 font-mono">{subtitle}</div>}
      </div>
      {children}
    </section>
  );
}

function Pill({ label, value, mono }) {
  return (
    <div className="inline-flex items-baseline gap-2 px-3 py-1.5 rounded-full" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
      <span className="text-[9px] tracking-[0.2em] uppercase text-white/40 font-mono">{label}</span>
      <span className={`text-sm text-white/90 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ConfidenceBadge({ confidence, identified, accentRGB }) {
  const cfg = identified
    ? { label: "Identified", dot: `rgb(${accentRGB})`, text: `rgb(${accentRGB})`, ring: `rgba(${accentRGB},0.3)` }
    : { label: "Unverified · best guess", dot: "rgb(250,200,100)", text: "rgb(250,200,100)", ring: "rgba(250,200,100,0.3)" };
  return (
    <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] tracking-[0.2em] uppercase font-mono" style={{ border: `1px solid ${cfg.ring}`, color: cfg.text, background: "rgba(255,255,255,0.02)" }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {cfg.label}
      {identified && confidence && <span className="text-white/40">· {confidence}</span>}
    </div>
  );
}

function ErrorView({ message, onReset }) {
  return (
    <div className="pt-16 flex flex-col items-center text-center max-w-md mx-auto">
      <div className="w-14 h-14 rounded-full flex items-center justify-center mb-5" style={{ background: "rgba(255,80,80,0.1)", border: "1px solid rgba(255,80,80,0.3)" }}>
        <X className="w-6 h-6 text-red-300" />
      </div>
      <h2 className="text-3xl mb-2 font-display"><span className="italic">Couldn't read</span> that one</h2>
      <p className="text-white/50 text-sm mb-6 break-words">{message}</p>
      <button onClick={onReset} className="px-5 py-2.5 rounded-full text-sm border border-white/20 hover:bg-white/5 transition-all">Try again</button>
    </div>
  );
}

function DisambiguationView({ candidates, vision, imageUrl, accentRGB, onPick }) {
  return (
    <div className="pt-8 md:pt-12" style={{ animation: "fadeUp 0.6s ease-out" }}>
      <div className="mb-10">
        <div className="text-[11px] tracking-[0.3em] uppercase text-white/40 mb-4 font-mono">/* Multiple pressings found */</div>
        <h2 className="text-4xl md:text-5xl leading-[1.05] mb-3 font-display"><span className="italic">Pick a pressing</span></h2>
        {vision && (
          <p className="text-white/40 text-sm font-mono">
            Read as: <span className="text-white/70">{vision.artist}{vision.title ? ` — ${vision.title}` : ""}</span>
            {vision.catalogNumber && <span className="text-white/40"> · {vision.catalogNumber}</span>}
          </p>
        )}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {candidates.map((candidate, i) => (
          <button key={candidate.id} onClick={() => onPick(candidate)} className="text-left rounded-2xl overflow-hidden transition-all group relative" style={{ background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))", backdropFilter: "blur(40px) saturate(180%)", WebkitBackdropFilter: "blur(40px) saturate(180%)", border: `1px solid rgba(${accentRGB},0.15)`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 50px -20px rgba(0,0,0,0.4)", animation: `fadeUp 0.4s ease-out ${i * 0.07}s both` }}>
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.1), transparent)` }} />
            <div className="relative aspect-square overflow-hidden">
              {candidate.coverUrl ? (
                <img src={candidate.coverUrl} alt={candidate.recordTitle || candidate.artist} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
              ) : (
                <div className="w-full h-full flex items-center justify-center" style={{ background: `rgba(${accentRGB},0.07)` }}><Disc3 className="w-12 h-12 opacity-15" /></div>
              )}
              <div className="absolute inset-0 pointer-events-none" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.5) 0%, transparent 50%)" }} />
            </div>
            <div className="relative p-4">
              <div className="text-[10px] tracking-[0.2em] uppercase text-white/40 mb-1.5 font-mono">{[candidate.year, candidate.country, candidate.format].filter(Boolean).join(" · ")}</div>
              <div className="text-base leading-snug mb-2 font-display">
                {candidate.artist && <span className="italic">{candidate.artist}</span>}
                {candidate.artist && candidate.recordTitle && <span className="text-white/35"> — </span>}
                <span className="text-white/80">{candidate.recordTitle || candidate.artist}</span>
              </div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {candidate.label && <span className="text-[10px] text-white/50 font-mono">{candidate.label}</span>}
                {candidate.catalogNumber && <span className="text-[10px] text-white/35 font-mono">{candidate.catalogNumber}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function RoadmapFooter() {
  const items = [
    { label: "Phase 1", title: "Scan & Identify", desc: "Vision · Discogs · Spotify · Done", active: true },
    { label: "Phase 2", title: "Collection", desc: "Save · crates · carousel · export · You are here", active: true },
    { label: "Phase 3", title: "Record Boxes", desc: "Virtual crates · drag · multi-box assignment" },
    { label: "Phase 4", title: "DJ Mode", desc: "Camelot wheel · BPM filter · set builder" },
    { label: "Phase 5", title: "Archetype Engine", desc: "Claude clustering · pinnable lenses" },
  ];
  return (
    <footer className="relative z-10 px-6 md:px-10 pb-16 max-w-7xl mx-auto mt-20 md:mt-32">
      <div className="text-[10px] tracking-[0.3em] uppercase text-white/30 mb-6 font-mono">/* Roadmap */</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {items.map((item, i) => (
          <div key={i} className="p-4 rounded-2xl" style={{ background: item.active ? "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))" : "transparent", border: item.active ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(255,255,255,0.04)", opacity: item.active ? 1 : 0.55 }}>
            <div className="text-[9px] tracking-[0.25em] uppercase text-white/40 mb-2 font-mono">{item.label}</div>
            <div className="text-base md:text-lg leading-tight mb-1 font-display">{item.title}</div>
            <div className="text-[11px] text-white/40 leading-snug">{item.desc}</div>
          </div>
        ))}
      </div>
    </footer>
  );
}
