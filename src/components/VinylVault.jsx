import { useState, useEffect } from "react";
import {
  Camera,
  Upload,
  Disc3,
  Sparkles,
  X,
  ArrowUpRight,
  Clock,
} from "lucide-react";

// ----- Helpers -----------------------------------------------------------

// Resize image to keep request size under Vercel's 4.5MB body limit
const resizeImage = (file, maxDim = 1500, quality = 0.85) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
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
      canvas.width = size;
      canvas.height = size;
      ctx.drawImage(img, 0, 0, size, size);
      const data = ctx.getImageData(0, 0, size, size).data;
      let r = 0, g = 0, b = 0, total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const pr = data[i], pg = data[i + 1], pb = data[i + 2];
        const brightness = (pr + pg + pb) / 3;
        if (brightness < 20 || brightness > 240) continue;
        const max = Math.max(pr, pg, pb);
        const min = Math.min(pr, pg, pb);
        const sat = max === 0 ? 0 : (max - min) / max;
        const weight = sat * sat + 0.08;
        r += pr * weight;
        g += pg * weight;
        b += pb * weight;
        total += weight;
      }
      if (total > 0) {
        r = Math.round(r / total);
        g = Math.round(g / total);
        b = Math.round(b / total);
      } else {
        r = 157; g = 141; b = 241;
      }
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
  const sat = letter === "B" ? 70 : 55;
  const light = letter === "B" ? 68 : 62;
  return `hsl(${hue}, ${sat}%, ${light}%)`;
};

// ----- Main Component ----------------------------------------------------

export default function VinylVault() {
  const [phase, setPhase] = useState("idle"); // idle | processing | result | error
  const [status, setStatus] = useState("");
  const [release, setRelease] = useState(null);
  const [imageUrl, setImageUrl] = useState(null);
  const [accent, setAccent] = useState({ r: 157, g: 141, b: 241 });
  const [errorMsg, setErrorMsg] = useState("");

  const processImage = async (file) => {
    setPhase("processing");
    setStatus("Reading sleeve");
    setErrorMsg("");

    try {
      // Client-side resize keeps Vercel request body comfortably under 4.5MB
      const dataUrl = await resizeImage(file);
      setImageUrl(dataUrl);

      const color = await extractDominantColor(dataUrl);
      setAccent(color);

      const base64Data = dataUrl.split(",")[1];

      await new Promise((r) => setTimeout(r, 400));
      setStatus("Identifying release");

      const response = await fetch("/api/identify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: base64Data, mediaType: "image/jpeg" }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API ${response.status}: ${errorBody.slice(0, 200)}`);
      }

      const data = await response.json();
      const textBlock = data.content?.find((b) => b.type === "text");
      if (!textBlock) throw new Error("No text response from model");

      let raw = textBlock.text.trim();
      raw = raw
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      const parsed = JSON.parse(raw);

      setStatus("Loading metadata");
      await new Promise((r) => setTimeout(r, 600));

      setRelease(parsed);
      setPhase("result");
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || "Identification failed");
      setPhase("error");
    }
  };

  const reset = () => {
    setPhase("idle");
    setRelease(null);
    setImageUrl(null);
    setAccent({ r: 157, g: 141, b: 241 });
    setErrorMsg("");
  };

  const accentRGB = `${accent.r}, ${accent.g}, ${accent.b}`;

  return (
    <div
      className="min-h-screen w-full relative overflow-x-hidden"
      style={{ background: "#08080c", color: "#f5f5f7" }}
    >
      {/* Atmospheric background — crisp, restrained */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute transition-all duration-[2000ms]"
          style={{
            inset: 0,
            background: `radial-gradient(ellipse 80% 60% at 80% 0%, rgba(${accentRGB}, 0.10), transparent 60%)`,
          }}
        />
        <div
          className="absolute transition-all duration-[2000ms]"
          style={{
            inset: 0,
            background: `radial-gradient(ellipse 60% 50% at 10% 100%, rgba(${accentRGB}, 0.06), transparent 60%)`,
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-10 px-6 md:px-10 py-6 md:py-8 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center"
            style={{
              background: `radial-gradient(circle at 30% 30%, rgba(${accentRGB},0.4), rgba(${accentRGB},0.05))`,
              border: `1px solid rgba(${accentRGB}, 0.3)`,
            }}
          >
            <Disc3 className="w-4 h-4" style={{ color: `rgb(${accentRGB})` }} />
          </div>
          <div>
            <div className="text-[11px] tracking-[0.28em] uppercase font-medium font-mono">
              Vinyl Vault
            </div>
            <div className="text-[10px] text-white/40 tracking-[0.15em] uppercase mt-0.5">
              Archive · Identify · Mix
            </div>
          </div>
        </div>
        {phase === "result" && (
          <button
            onClick={reset}
            className="text-[11px] tracking-[0.2em] uppercase text-white/50 hover:text-white transition-colors px-3 py-1.5 rounded-full border border-white/10 hover:border-white/30 font-mono"
          >
            Scan another
          </button>
        )}
      </header>

      {/* Main */}
      <main className="relative z-10 px-6 md:px-10 pb-16 max-w-7xl mx-auto">
        {phase === "idle" && <IdleView onUpload={processImage} accentRGB={accentRGB} />}
        {phase === "processing" && (
          <ProcessingView imageUrl={imageUrl} status={status} accentRGB={accentRGB} />
        )}
        {phase === "result" && release && (
          <ResultView release={release} imageUrl={imageUrl} accentRGB={accentRGB} />
        )}
        {phase === "error" && <ErrorView message={errorMsg} onReset={reset} />}
      </main>

      {phase === "idle" && <RoadmapFooter />}
    </div>
  );
}

// ----- Sub-views ---------------------------------------------------------

function IdleView({ onUpload, accentRGB }) {
  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (file) onUpload(file);
  };

  return (
    <div className="pt-8 md:pt-16">
      <div className="max-w-3xl">
        <div className="text-[11px] tracking-[0.3em] uppercase mb-6 text-white/40 font-mono">
          /* New entry */
        </div>
        <h1 className="text-5xl md:text-7xl lg:text-8xl leading-[0.95] mb-6 font-display">
          <span className="italic">Photograph</span> a sleeve.
          <br />
          <span className="text-white/40">We do the rest.</span>
        </h1>
        <p className="text-white/50 text-base md:text-lg max-w-xl leading-relaxed">
          Identification, tracklist, BPM and Camelot key for every record.
          Filed into virtual crates, surfaced when you need them.
        </p>
      </div>

      {/* Scan zone — the whole panel is a tappable file input */}
      <div className="mt-12 md:mt-16">
        <label
          className="relative block rounded-3xl overflow-hidden p-8 md:p-12 cursor-pointer transition-all hover:brightness-110 active:scale-[0.995]"
          style={{
            background:
              "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.015))",
            backdropFilter: "blur(40px) saturate(180%)",
            WebkitBackdropFilter: "blur(40px) saturate(180%)",
            border: `1px solid rgba(${accentRGB},0.18)`,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.06), 0 30px 60px -20px rgba(0,0,0,0.5), 0 0 60px -20px rgba(${accentRGB},0.2)`,
          }}
        >
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6 md:gap-8 relative z-10">
            <div className="flex items-center gap-5">
              <div
                className="w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center relative shrink-0"
                style={{
                  background: `radial-gradient(circle at 35% 35%, rgba(${accentRGB},0.35), transparent 70%)`,
                  border: `1px solid rgba(${accentRGB},0.4)`,
                }}
              >
                <Disc3
                  className="w-7 h-7 md:w-9 md:h-9 animate-spin"
                  style={{ color: `rgb(${accentRGB})`, animationDuration: "8s" }}
                />
              </div>
              <div>
                <div className="text-[10px] tracking-[0.25em] uppercase text-white/40 mb-1.5 font-mono">
                  Source
                </div>
                <div className="text-xl md:text-2xl font-display">
                  <span className="italic">Camera</span> or upload
                </div>
              </div>
            </div>

            <div
              className="inline-flex items-center gap-2.5 px-5 py-3 rounded-full text-sm font-medium self-start md:self-auto"
              style={{
                background: `linear-gradient(135deg, rgba(${accentRGB},0.3), rgba(${accentRGB},0.12))`,
                border: `1px solid rgba(${accentRGB},0.45)`,
                color: "#fff",
                boxShadow: `0 0 24px -8px rgba(${accentRGB},0.5)`,
              }}
            >
              <Camera className="w-4 h-4" />
              <Upload className="w-4 h-4 opacity-60" />
              Tap to scan
            </div>
          </div>

          <input
            type="file"
            accept="image/*"
            onChange={handleFile}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              opacity: 0,
              cursor: "pointer",
            }}
          />
        </label>

        <div className="mt-4 text-[10px] tracking-[0.2em] uppercase text-white/30 text-center font-mono">
          On mobile: tap to choose camera or photo library
        </div>
      </div>
    </div>
  );
}

function ProcessingView({ imageUrl, status, accentRGB }) {
  return (
    <div className="pt-12 flex flex-col items-center">
      <div className="relative max-w-md w-full aspect-square rounded-2xl overflow-hidden">
        {imageUrl && (
          <img src={imageUrl} alt="Scanning" className="w-full h-full object-cover" />
        )}
        <div
          className="absolute left-0 right-0 h-[3px] pointer-events-none"
          style={{
            background: `linear-gradient(90deg, transparent, rgba(${accentRGB},1), transparent)`,
            boxShadow: `0 0 30px rgba(${accentRGB},0.8), 0 0 60px rgba(${accentRGB},0.5)`,
            animation: "scanLine 2s ease-in-out infinite",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-30"
          style={{
            backgroundImage: `
              linear-gradient(rgba(${accentRGB},0.4) 1px, transparent 1px),
              linear-gradient(90deg, rgba(${accentRGB},0.4) 1px, transparent 1px)
            `,
            backgroundSize: "32px 32px",
          }}
        />
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            boxShadow: `inset 0 0 80px rgba(0,0,0,0.6), inset 0 0 0 1px rgba(${accentRGB},0.3)`,
          }}
        />
      </div>

      <div
        className="mt-8 text-[11px] tracking-[0.3em] uppercase flex items-center gap-3 font-mono"
        style={{ color: `rgb(${accentRGB})` }}
      >
        <span
          className="inline-block w-1.5 h-1.5 rounded-full"
          style={{
            background: `rgb(${accentRGB})`,
            animation: "pulse 1.4s ease-in-out infinite",
          }}
        />
        {status}
      </div>
    </div>
  );
}

function ResultView({ release, imageUrl, accentRGB }) {
  return (
    <div
      className="pt-4 md:pt-8 grid gap-6 md:gap-8"
      style={{ animation: "fadeUp 0.8s ease-out" }}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ConfidenceBadge
            confidence={release.confidence}
            identified={release.identified}
            accentRGB={accentRGB}
          />
          {release.notes && (
            <div className="text-[11px] text-white/50 font-mono">{release.notes}</div>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-[auto_1fr] gap-6 md:gap-10">
        <div className="relative">
          <div
            className="relative w-full md:w-[320px] lg:w-[380px] aspect-square rounded-2xl overflow-hidden"
            style={{
              boxShadow: `
                0 30px 80px -20px rgba(${accentRGB},0.5),
                0 0 0 1px rgba(255,255,255,0.06),
                inset 0 1px 0 rgba(255,255,255,0.08)
              `,
            }}
          >
            {imageUrl && (
              <img src={imageUrl} alt={release.title} className="w-full h-full object-cover" />
            )}
            <div
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  "linear-gradient(135deg, rgba(255,255,255,0.08), transparent 40%)",
              }}
            />
          </div>
          <div
            className="absolute -inset-12 -z-10 blur-3xl opacity-50"
            style={{
              background: `radial-gradient(circle, rgba(${accentRGB},0.4), transparent 60%)`,
            }}
          />
        </div>

        <div className="flex flex-col justify-center">
          <div className="text-[11px] tracking-[0.3em] uppercase text-white/40 mb-3 font-mono">
            {release.format && <span>{release.format}</span>}
            {release.format && release.year && <span className="mx-2">·</span>}
            {release.year && <span>{release.year}</span>}
            {(release.year || release.format) && release.country && <span className="mx-2">·</span>}
            {release.country && <span>{release.country}</span>}
          </div>

          <h1 className="text-3xl md:text-5xl lg:text-6xl leading-[1.05] mb-2 font-display">
            <span className="italic">{release.artist}</span>
          </h1>
          <h2 className="text-2xl md:text-3xl lg:text-4xl leading-tight mb-6 text-white/70 font-display">
            {release.title}
          </h2>

          <div className="flex flex-wrap gap-2 mb-6">
            {release.label && <Pill label="Label" value={release.label} />}
            {release.catalogNumber && (
              <Pill label="Cat #" value={release.catalogNumber} mono />
            )}
          </div>

          {release.genres && release.genres.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {release.genres.map((g, i) => (
                <span
                  key={i}
                  className="text-[10px] tracking-[0.15em] uppercase px-2.5 py-1 rounded-full font-mono"
                  style={{
                    background: `rgba(${accentRGB},0.1)`,
                    border: `1px solid rgba(${accentRGB},0.25)`,
                    color: `rgb(${accentRGB})`,
                  }}
                >
                  {g}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <Section
        title="Tracklist"
        subtitle={`${release.tracklist?.length || 0} tracks`}
        accentRGB={accentRGB}
      >
        <div className="space-y-1">
          {release.tracklist?.map((track, i) => (
            <TrackRow key={i} track={track} index={i} accentRGB={accentRGB} />
          ))}
        </div>
      </Section>

      {release.suggestedBoxes && release.suggestedBoxes.length > 0 && (
        <Section
          title="Filing into"
          subtitle="Suggested crates · tap to assign"
          accentRGB={accentRGB}
          icon={
            <Sparkles className="w-3.5 h-3.5" style={{ color: `rgb(${accentRGB})` }} />
          }
        >
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
            {release.suggestedBoxes.map((box, i) => (
              <button
                key={i}
                className="text-left p-4 rounded-xl transition-all group relative overflow-hidden"
                style={{
                  background:
                    "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
                  border: "1px solid rgba(255,255,255,0.08)",
                  backdropFilter: "blur(20px)",
                  WebkitBackdropFilter: "blur(20px)",
                }}
              >
                <div
                  className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background: `linear-gradient(135deg, rgba(${accentRGB},0.12), transparent)`,
                  }}
                />
                <div className="relative flex items-start justify-between gap-2">
                  <div>
                    <div className="text-[10px] tracking-[0.2em] uppercase text-white/40 mb-1.5 font-mono">
                      Crate · 0{i + 1}
                    </div>
                    <div className="text-lg leading-tight font-display">{box}</div>
                  </div>
                  <ArrowUpRight className="w-4 h-4 text-white/30 group-hover:text-white/80 transition-colors" />
                </div>
              </button>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

function TrackRow({ track, index, accentRGB }) {
  const keyColor = camelotColor(track.key);
  return (
    <div
      className="grid grid-cols-[40px_1fr_auto] md:grid-cols-[50px_1fr_auto_auto_auto] items-center gap-3 md:gap-5 px-3 md:px-5 py-3 md:py-3.5 rounded-xl transition-all group hover:bg-white/[0.03]"
      style={{ animation: `fadeUp 0.4s ease-out ${index * 0.05}s both` }}
    >
      <div className="text-[11px] tracking-[0.15em] text-white/50 font-medium font-mono">
        {track.position}
      </div>

      <div className="min-w-0">
        <div className="text-base md:text-[17px] truncate font-display">{track.title}</div>
        <div className="md:hidden text-[10px] tracking-[0.1em] text-white/40 mt-0.5 flex items-center gap-2 font-mono">
          {track.duration && <span>{track.duration}</span>}
          {track.duration && <span>·</span>}
          <span>{track.bpm} BPM</span>
          <span>·</span>
          <span style={{ color: keyColor }}>{track.key}</span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-1.5 text-[12px] text-white/50 tabular-nums font-mono">
        <Clock className="w-3 h-3" />
        {track.duration || "—"}
      </div>

      <div className="hidden md:flex items-center gap-1.5 text-[12px] tabular-nums min-w-[80px] justify-end font-mono">
        <span className="text-white/30 text-[10px]">BPM</span>
        <span className="font-medium">{track.bpm}</span>
      </div>

      <div
        className="flex items-center justify-center w-12 md:w-14 h-7 md:h-8 rounded-full text-[11px] md:text-[12px] font-semibold tabular-nums font-mono"
        style={{
          background: keyColor.replace("hsl", "hsla").replace(")", ", 0.12)"),
          border: `1px solid ${keyColor.replace("hsl", "hsla").replace(")", ", 0.35)")}`,
          color: keyColor,
        }}
      >
        {track.key}
      </div>
    </div>
  );
}

function Section({ title, subtitle, icon, children }) {
  return (
    <section
      className="rounded-3xl p-6 md:p-8"
      style={{
        background:
          "linear-gradient(135deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01))",
        backdropFilter: "blur(40px) saturate(180%)",
        WebkitBackdropFilter: "blur(40px) saturate(180%)",
        border: "1px solid rgba(255,255,255,0.06)",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05), 0 20px 50px -20px rgba(0,0,0,0.4)",
      }}
    >
      <div className="flex items-baseline justify-between mb-5 md:mb-6">
        <div className="flex items-center gap-2">
          {icon}
          <h3 className="text-[11px] tracking-[0.3em] uppercase font-medium font-mono">
            {title}
          </h3>
        </div>
        {subtitle && (
          <div className="text-[10px] tracking-[0.15em] uppercase text-white/40 font-mono">
            {subtitle}
          </div>
        )}
      </div>
      {children}
    </section>
  );
}

function Pill({ label, value, mono }) {
  return (
    <div
      className="inline-flex items-baseline gap-2 px-3 py-1.5 rounded-full"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <span className="text-[9px] tracking-[0.2em] uppercase text-white/40 font-mono">
        {label}
      </span>
      <span className={`text-sm text-white/90 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function ConfidenceBadge({ confidence, identified, accentRGB }) {
  const cfg = identified
    ? {
        label: "Identified",
        dot: `rgb(${accentRGB})`,
        text: `rgb(${accentRGB})`,
        ring: `rgba(${accentRGB},0.3)`,
      }
    : {
        label: "Unverified · best guess",
        dot: "rgb(250,200,100)",
        text: "rgb(250,200,100)",
        ring: "rgba(250,200,100,0.3)",
      };
  return (
    <div
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[10px] tracking-[0.2em] uppercase font-mono"
      style={{
        border: `1px solid ${cfg.ring}`,
        color: cfg.text,
        background: "rgba(255,255,255,0.02)",
      }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.dot }} />
      {cfg.label}
      {identified && confidence && (
        <span className="text-white/40">· {confidence}</span>
      )}
    </div>
  );
}

function ErrorView({ message, onReset }) {
  return (
    <div className="pt-16 flex flex-col items-center text-center max-w-md mx-auto">
      <div
        className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
        style={{
          background: "rgba(255,80,80,0.1)",
          border: "1px solid rgba(255,80,80,0.3)",
        }}
      >
        <X className="w-6 h-6 text-red-300" />
      </div>
      <h2 className="text-3xl mb-2 font-display">
        <span className="italic">Couldn't read</span> that one
      </h2>
      <p className="text-white/50 text-sm mb-6 break-words">{message}</p>
      <button
        onClick={onReset}
        className="px-5 py-2.5 rounded-full text-sm border border-white/20 hover:bg-white/5 transition-all"
      >
        Try again
      </button>
    </div>
  );
}

function RoadmapFooter() {
  const items = [
    {
      label: "Phase 1",
      title: "Scan & Identify",
      desc: "Vision · Discogs · Spotify · You are here",
      active: true,
    },
    {
      label: "Phase 2",
      title: "Collection",
      desc: "2k records · predictive search · condition · notes",
    },
    {
      label: "Phase 3",
      title: "Record Boxes",
      desc: "Virtual crates · drag · multi-box assignment",
    },
    {
      label: "Phase 4",
      title: "DJ Mode",
      desc: "Camelot wheel · BPM filter · set builder",
    },
    {
      label: "Phase 5",
      title: "Archetype Engine",
      desc: "Claude clustering · pinnable lenses",
    },
  ];
  return (
    <footer className="relative z-10 px-6 md:px-10 pb-16 max-w-7xl mx-auto mt-20 md:mt-32">
      <div className="text-[10px] tracking-[0.3em] uppercase text-white/30 mb-6 font-mono">
        /* Roadmap */
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {items.map((item, i) => (
          <div
            key={i}
            className="p-4 rounded-2xl"
            style={{
              background: item.active
                ? "linear-gradient(135deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))"
                : "transparent",
              border: item.active
                ? "1px solid rgba(255,255,255,0.12)"
                : "1px solid rgba(255,255,255,0.04)",
              opacity: item.active ? 1 : 0.55,
            }}
          >
            <div className="text-[9px] tracking-[0.25em] uppercase text-white/40 mb-2 font-mono">
              {item.label}
            </div>
            <div className="text-base md:text-lg leading-tight mb-1 font-display">
              {item.title}
            </div>
            <div className="text-[11px] text-white/40 leading-snug">{item.desc}</div>
          </div>
        ))}
      </div>
    </footer>
  );
}
