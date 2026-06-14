const BASE = 'https://api.deezer.com';

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

function titleSim(a, b) {
  const na = norm(a), nb = norm(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const wa = na.split(' ').filter(w => w.length > 2);
  const wb = nb.split(' ').filter(w => w.length > 2);
  if (!wa.length || !wb.length) return (na.includes(nb) || nb.includes(na)) ? 0.5 : 0;
  const overlap = wa.filter(w => wb.includes(w)).length;
  return overlap / Math.max(wa.length, wb.length);
}

function parseDurationSecs(str) {
  if (!str) return null;
  const parts = str.split(':');
  if (parts.length === 2) return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
  return null;
}

async function searchTrack(artist, title, discogsDuration) {
  const q = artist ? `artist:"${artist}" track:"${title}"` : `"${title}"`;
  const url = `${BASE}/search?q=${encodeURIComponent(q)}&limit=5`;

  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    data = await res.json();
  } catch {
    return null;
  }

  const items = (data?.data || []).filter(it => it.preview && it.preview.length > 0);
  if (!items.length) return null;

  const wantSecs = parseDurationSecs(discogsDuration);
  const normArtist = norm(artist || '');
  const artistWords = normArtist.split(' ').filter(w => w.length > 2);

  const scored = items
    .map(it => {
      const sim = titleSim(title, it.title);
      if (sim < 0.5) return null;

      let s = sim;

      const itArtistWords = norm(it.artist?.name || '').split(' ').filter(w => w.length > 2);
      if (artistWords.length > 0 && itArtistWords.length > 0) {
        if (artistWords.some(w => itArtistWords.includes(w))) s += 0.4;
        else s -= 0.4;
      }

      if (wantSecs && it.duration) {
        const diff = Math.abs(it.duration - wantSecs);
        if (diff > 45) return null;
        else if (diff < 5) s += 0.5;
        else if (diff < 15) s += 0.3;
      }

      return { it, s };
    })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s);

  if (!scored.length) return null;
  const { it } = scored[0];
  return { id: it.id, preview: it.preview, duration: it.duration, artistName: it.artist?.name };
}

export async function enrichWithDeezer(tracks, artist, opts = {}) {
  const { concurrency = 3 } = opts;

  const out = tracks.slice();
  const queue = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t && !(t.previewUrl && t.bpm != null)) queue.push(i);
  }
  if (!queue.length) return out;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const idx = queue[cursor++];
      const t = out[idx];
      try {
        const hit = await searchTrack(artist, t.title, t.duration);
        if (!hit) continue;

        let updated = t;
        if (!t.previewUrl) updated = { ...updated, previewUrl: hit.preview };

        if (t.bpm == null) {
          try {
            const res = await fetch(`${BASE}/track/${hit.id}`, { signal: AbortSignal.timeout(2000) });
            if (res.ok) {
              const data = await res.json();
              const bpm = Math.round(parseInt(data.bpm, 10));
              if (Number.isFinite(bpm) && bpm >= 40 && bpm <= 260) {
                updated = { ...updated, bpm, bpmSource: 'deezer' };
              }
            }
          } catch {
            // skip bpm fetch silently
          }
        }

        if (updated !== t) out[idx] = updated;
      } catch {
        // skip track silently
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
