// GetSongBPM lookup -- fills track BPM from artist + title metadata.
// This is a metadata lookup (no audio required), so it covers tracks that have
// no preview URL, which is where the client-side waveform analyser cannot help.
// Free API; an attribution backlink to getsongbpm.com is mandatory (see UI).
const BASE = 'https://api.getsongbpm.com';

const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

// Loose title similarity: 1 = exact, down to 0 = unrelated. Mirrors the scoring
// used for Spotify/iTunes matching so we do not attach a wrong song's tempo.
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

function parseTempo(v) {
  const n = Math.round(parseFloat(v));
  return Number.isFinite(n) && n >= 40 && n <= 260 ? n : null;
}

async function fetchSongTempo(apiKey, songId) {
  try {
    const res = await fetch(`${BASE}/song/?api_key=${apiKey}&id=${encodeURIComponent(songId)}`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return parseTempo(data?.song?.tempo);
  } catch {
    return null;
  }
}

// Look up the BPM for one track. Returns an integer BPM or null.
export async function lookupBpm(apiKey, artist, title) {
  if (!title) return null;
  const lookup = artist ? `song:${title} artist:${artist}` : `song:${title}`;
  const url = `${BASE}/search/?api_key=${apiKey}&type=both&lookup=${encodeURIComponent(lookup)}`;

  let data;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    console.log(`[getsongbpm] search status=${res.status} title="${title}" artist="${artist}"`);
    if (!res.ok) {
      const text = await res.text();
      console.log(`[getsongbpm] error body:`, text.slice(0, 200));
      return null;
    }
    data = await res.json();
    console.log(`[getsongbpm] response:`, JSON.stringify(data).slice(0, 300));
  } catch (err) {
    console.log(`[getsongbpm] fetch error:`, err.message);
    return null;
  }

  // The API returns { search: [...] } on a hit, or { search: { error: ... } }
  // when nothing matches. Guard for both shapes.
  const items = Array.isArray(data?.search) ? data.search : [];
  console.log(`[getsongbpm] items:`, items.length, items[0] ? JSON.stringify(items[0]).slice(0, 150) : 'none');
  if (!items.length) return null;

  const artistWords = norm(artist || '').split(' ').filter(w => w.length > 2);

  const scored = items
    .map(it => {
      const sim = titleSim(title, it.song_title || it.title || '');
      if (sim < 0.5) return null;
      let s = sim;
      // Reward artist overlap so the right recording wins among same-named songs.
      if (artistWords.length) {
        const cand = norm(it.artist?.name || '').split(' ').filter(w => w.length > 2);
        if (cand.length && artistWords.some(w => cand.includes(w))) s += 0.4;
      }
      return { it, s };
    })
    .filter(Boolean)
    .sort((a, b) => b.s - a.s);

  if (!scored.length) return null;
  const best = scored[0].it;

  const inline = parseTempo(best.tempo);
  if (inline != null) return inline;

  // Some search payloads omit tempo; fetch the song detail for the best match.
  if (best.song_id) return fetchSongTempo(apiKey, best.song_id);
  return null;
}

// Fill bpm for any track still missing one, using a small concurrency pool to
// stay gentle on the free-tier rate limit. Tracks that already have a bpm, or
// were already tried (bpmGsbTried), are left untouched. Marks every attempted
// track so callers can persist a durable "do not retry" flag.
export async function enrichBpm(tracks, artist, { concurrency = 2 } = {}) {
  const apiKey = process.env.GETSONGBPM_API_KEY;
  if (!apiKey) return tracks;

  const out = tracks.slice();
  const queue = [];
  for (let i = 0; i < out.length; i++) {
    const t = out[i];
    if (t && t.bpm == null && !t.bpmGsbTried) queue.push(i);
  }
  if (!queue.length) return out;

  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length) {
      const idx = queue[cursor++];
      const t = out[idx];
      const bpm = await lookupBpm(apiKey, artist, t.title).catch(() => null);
      out[idx] = bpm != null
        ? { ...t, bpm, bpmSource: 'getsongbpm', bpmGsbTried: true }
        : { ...t, bpmGsbTried: true };
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return out;
}
