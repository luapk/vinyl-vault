// Candidate-scoring and ranking logic, extracted for testability.
// Used by api/scan.js to rank Discogs search results against vision metadata.

export const GENRE_WORDS = new Set([
  'techno', 'house', 'ambient', 'dnb', 'jungle', 'garage', 'trance',
  'hardcore', 'rave', 'dub', 'electronic', 'electro', 'dance', 'music',
  'funk', 'soul', 'jazz', 'rap', 'disco', 'breakbeat', 'breaks',
]);

export function norm(s) {
  return (s || '').toLowerCase()
    .replace(/\s*\(\d+\)$/, '')   // strip Discogs "(2)" disambiguation suffixes
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function sim(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return null; // missing field: no signal, no penalty
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  const wa = a.split(' ').filter(w => w.length > 2);
  const wb = b.split(' ').filter(w => w.length > 2);
  if (!wa.length || !wb.length) return null;
  const hits = wa.filter(w => wb.includes(w)).length;
  return hits / Math.max(wa.length, wb.length);
}

// Catalogue-number similarity, case- and separator-insensitive.
// 1   = same code ("PM 012" / "pm-012" / "PM012")
// 0.8 = one contains the other and the shorter side is specific enough
//       (covers "AM12 93" printed vs "R&S AM12 93" catalogued)
// 0   = both present but different
// null = either side missing (no signal, no penalty)
export function catnoSim(a, b) {
  if (!a || !b) return null;
  const na = String(a).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const nb = String(b).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!na || !nb) return null;
  if (na === nb) return 1;
  if ((na.includes(nb) || nb.includes(na)) && Math.min(na.length, nb.length) >= 4) return 0.8;
  return 0;
}

// Score how well a Discogs candidate matches Vision-identified metadata.
// Negative scores mean the candidate is likely a false catno collision.
export function scoreCandidate(candidate, vision) {
  if (!vision) return 0;

  const normVA = norm(vision.artist || '');
  const normVL = norm(vision.label || '');

  // Artist is unreliable when it's the same word(s) as the label (vision confused
  // the imprint name as an artist) or when it's a generic genre word.
  const labelArtistOverlap = normVL && (normVA === normVL || normVA.includes(normVL) || normVL.includes(normVA));
  const artistReliable = normVA && !labelArtistOverlap && !GENRE_WORDS.has(normVA);

  let score = 0;
  const artistSim = artistReliable ? sim(candidate.artist, vision.artist) : null;
  const titleSim  = sim(candidate.recordTitle ?? candidate.title, vision.title);
  const labelSim  = sim(candidate.label, vision.label);

  // Artist is the dominant signal: a clear mismatch when we have artist info
  // strongly indicates a false catno hit from a different label/series.
  if (artistSim !== null) score += artistSim >= 0.5 ? 4 : artistSim >= 0.2 ? 1 : -3;
  if (titleSim  !== null) score += titleSim  >= 0.5 ? 4 : titleSim  >= 0.2 ? 1 : -1;
  if (labelSim  !== null && labelSim >= 0.5) score += 1;

  // Catalogue number is the strongest identity signal a label carries: an
  // exact (or contained) match outweighs any other single field, which is
  // what lets a catno-only white-label read beat fuzzy artist/title
  // collisions. A mismatch is only a mild penalty -- other pressings of the
  // right release legitimately carry different catnos.
  const catSim = catnoSim(candidate.catalogNumber, vision.catalogNumber);
  if (catSim !== null) score += catSim >= 0.8 ? 6 : -1;

  // A barcode search is an exact lookup: a misread digit returns nothing rather
  // than the wrong record, so anything that comes back from one is almost
  // certainly the pressing in the user's hands. Outranks catalogue number,
  // which repressings and territories legitimately share.
  if (candidate.viaBarcode) score += 8;

  return score;
}

// Re-rank candidates by vision match score and drop clearly wrong ones
// when better alternatives exist.
export function rankCandidates(candidates, vision) {
  if (!vision || candidates.length <= 1) return candidates;

  const scored = candidates.map(c => ({ c, s: scoreCandidate(c, vision) }));
  scored.sort((a, b) => b.s - a.s);

  const good = scored.filter(x => x.s >= 0);
  const result = good.length > 0 ? good : scored; // never return empty
  return result.map(x => x.c);
}

// Extract catno-like patterns from raw OCR text for fallback Discogs searches.
export function extractRawCatnos(rawText, knownCatno) {
  if (!rawText) return [];
  const catnoPattern = /\b([A-Z]{1,6}[\s\-]?\d{2,5}[A-Z]?)\b/g;
  const found = [...rawText.matchAll(catnoPattern)].map(m => m[1]);
  return found.filter(c => c !== knownCatno);
}

// Normalise a catalogue number: strip separators for variant-search
export function normalizeCatno(catno) {
  if (!catno) return [];
  const stripped = catno.replace(/[\s\-\.]/g, '');
  const dashed   = catno.replace(/[\s\.]/g, '-');
  const variants = new Set([catno, stripped, dashed]);
  return [...variants];
}
