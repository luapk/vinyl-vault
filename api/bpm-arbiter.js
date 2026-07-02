import { requireAuth } from './lib/auth.js';
import { callClaude } from './lib/vision.js';

// Octave arbiter: the client waveform analyser sometimes cannot tell a tempo
// from its half/double (87 vs 174 -- the classic autocorrelation ambiguity).
// Claude is never asked to generate a BPM, only to pick between the two
// octave candidates using artist/genre/era knowledge. One batched call per
// request keeps this at fractions of a cent per record.
const MAX_ITEMS = 24;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authUser = await requireAuth(req, res);
  if (!authUser) return;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'Arbiter not configured' });

  const { tracks } = req.body || {};
  if (!Array.isArray(tracks) || !tracks.length) {
    return res.status(400).json({ error: 'tracks array required' });
  }

  const items = tracks.slice(0, MAX_ITEMS).map(t => ({
    artist: String(t?.artist || ''),
    title: String(t?.title || ''),
    genres: Array.isArray(t?.genres) ? t.genres.slice(0, 6).map(String) : [],
    year: Number.isFinite(t?.year) ? t.year : null,
    options: (Array.isArray(t?.options) ? t.options : [])
      .filter(n => Number.isFinite(n) && n >= 40 && n <= 260)
      .slice(0, 2),
  }));

  if (items.some(it => it.options.length !== 2)) {
    return res.status(400).json({ error: 'each track needs exactly 2 candidate BPMs' });
  }

  const lines = items.map((it, i) => {
    const meta = [
      it.artist && `artist: ${it.artist}`,
      it.genres.length && `genres: ${it.genres.join(', ')}`,
      it.year && `year: ${it.year}`,
    ].filter(Boolean).join('; ');
    return `${i + 1}. "${it.title}" (${meta || 'no metadata'}) -- ${it.options[0]} or ${it.options[1]} BPM?`;
  }).join('\n');

  const prompt = `Tempo analysis of these tracks produced two candidate BPMs exactly one octave apart. For each track pick the more plausible tempo given the artist, genre, and era. Typical ranges: hip-hop/downtempo 70-100, house 118-130, techno 125-145, drum & bass/jungle 160-180, dub/reggae 60-90.

${lines}

Return ONLY a JSON array of the chosen numbers, one per track, in order. Example: [174, 128]`;

  try {
    const data = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }],
    }, apiKey);

    const text = data.content?.[0]?.text?.trim() || '[]';
    const raw = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();
    const parsed = JSON.parse(raw);

    // A choice must be one of the offered candidates; anything else falls
    // back to the analyser's primary reading rather than trusting free text.
    const choices = items.map((it, i) => {
      const pick = Array.isArray(parsed) ? Math.round(parsed[i]) : NaN;
      return it.options.includes(pick) ? pick : it.options[0];
    });

    return res.status(200).json({ choices });
  } catch (err) {
    console.log(`[bpm-arbiter] ${err.message}`);
    // Fail open with the primary candidates so the client can still persist.
    return res.status(200).json({ choices: items.map(it => it.options[0]), fallback: true });
  }
}

export const config = {
  api: { bodyParser: { sizeLimit: '256kb' } },
};
