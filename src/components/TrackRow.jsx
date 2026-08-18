// One row of a tracklist: position, title, per-track artist on compilations,
// duration, BPM, key badge and the preview play button.
//
// Lives in its own module because two very different screens render it: your
// own record detail in VinylVault, and another collector's record in the
// community view. Importing it from VinylVault would have made Community and
// VinylVault import each other.
import { Play, Pause, Clock } from "@phosphor-icons/react";
import { camelotColor } from "../lib/camelot.js";

export default function TrackRow({ track, index, accentRGB, playingPreview, onPlay, bpmLoading, onHotToggle }) {
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
          {/* Compilations only. On a single-artist release every row would
              repeat the name already at the top of the page, so the artist is
              carried on the track solely when it differs from the release. */}
          {track.artist && (
            <div className="text-[14px] md:text-[15px] truncate font-display italic" style={{ color: 'rgba(var(--fg),0.52)' }}>
              {track.artist}
            </div>
          )}
          {/* Mobile: duration + BPM + key inline */}
          {/* Built from the parts that actually exist, then joined. Emitting a
              separator after each field left a dangling "·" on any track
              missing a BPM or key. */}
          <div className="md:hidden text-[13px] text-white/42 mt-0.5 flex items-center gap-1.5 font-mono">
            {(() => {
              const parts = [];
              if (track.duration) parts.push(<span key="d">{track.duration}</span>);
              if (bpmLoading) parts.push(<span key="b" style={{ animation: "pulse 1.2s ease-in-out infinite" }}>··· BPM</span>);
              else if (track.bpm != null) parts.push(<span key="b">{track.bpm} BPM</span>);
              if (track.key) parts.push(<span key="k" style={{ color: keyColor || "rgba(var(--fg),0.38)" }}>{track.key}</span>);
              return parts.flatMap((el, i) => i === 0 ? [el] : [<span key={`s${i}`}>·</span>, el]);
            })()}
          </div>
        </div>
      </div>
      {/* Mobile play button: sits in the "auto" third column */}
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
      {/* Key badge: hidden on mobile (already shown inline above) */}
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
