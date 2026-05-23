/**
 * Diagnostic: PF013 "Stasis - Circuit Funk" UNVERIFIED failure.
 *
 * Tests 30 OCR/Vision permutations of what Claude might read from the
 * Peacefrog PF013 label. For each permutation we:
 *   1. Show which Discogs search strategies would be generated
 *   2. Score the CORRECT Discogs candidate against the vision read
 *   3. Score a WRONG candidate (false catno collision) against the vision read
 *   4. Diagnose whether the pipeline would succeed or fall to visionFallback
 *
 * No API keys required — pure local logic.
 *
 * Run: node scripts/test-pf013.mjs
 */

// ─── Scoring logic (mirrors api/scan.js) ─────────────────────────────────────

function scoreCandidate(candidate, vision) {
  if (!vision) return 0;
  const norm = s =>
    (s || '').toLowerCase()
      .replace(/\s*\(\d+\)$/, '')
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const sim = (a, b) => {
    a = norm(a); b = norm(b);
    if (!a || !b) return null;
    if (a === b) return 1;
    if (a.includes(b) || b.includes(a)) return 0.8;
    const wa = a.split(' ').filter(w => w.length > 2);
    const wb = b.split(' ').filter(w => w.length > 2);
    if (!wa.length || !wb.length) return null;
    const hits = wa.filter(w => wb.includes(w)).length;
    return hits / Math.max(wa.length, wb.length);
  };
  const GENRE_WORDS = new Set([
    'techno','house','ambient','dnb','jungle','garage','trance',
    'hardcore','rave','dub','electronic','electro','dance','music',
    'funk','soul','jazz','rap','disco','breakbeat','breaks',
  ]);
  const normVA = norm(vision.artist || '');
  const normVL = norm(vision.label || '');
  const labelArtistOverlap = normVL && (normVA === normVL || normVA.includes(normVL) || normVL.includes(normVA));
  const artistReliable = normVA && !labelArtistOverlap && !GENRE_WORDS.has(normVA);

  let score = 0;
  const artistSim = artistReliable ? sim(candidate.artist, vision.artist) : null;
  const titleSim  = sim(candidate.recordTitle ?? candidate.title, vision.title);
  const labelSim  = sim(candidate.label, vision.label);

  if (artistSim !== null) score += artistSim >= 0.5 ? 4 : artistSim >= 0.2 ? 1 : -3;
  if (titleSim  !== null) score += titleSim  >= 0.5 ? 4 : titleSim  >= 0.2 ? 1 : -1;
  if (labelSim  !== null && labelSim >= 0.5) score += 1;
  return score;
}

// ─── URL generation logic (mirrors api/lib/discogs.js) ───────────────────────

function buildSearchUrls({ catalogNumber, artist, title, label, rawText }) {
  const BASE = 'https://api.discogs.com';
  const urls = new Set();

  if (catalogNumber) {
    urls.add(`catno=${catalogNumber}`);
    const stripped = catalogNumber.replace(/[\s\-\.]/g, '');
    const dashed   = catalogNumber.replace(/[\s\.]/g, '-');
    for (const v of new Set([stripped, dashed])) {
      if (v !== catalogNumber) urls.add(`catno=${v}`);
    }
    if (artist) urls.add(`catno=${catalogNumber}&artist=${artist}`);
  }
  if (artist && title) urls.add(`artist=${artist}&release_title=${title}`);
  if (title)           urls.add(`release_title=${title}`);
  if (label && title)  urls.add(`label=${label}&release_title=${title}`);
  if (artist && title && artist !== label) {
    urls.add(`label=${artist}&release_title=${title}`);
  }
  if (rawText) {
    const catnoPattern = /\b([A-Z]{1,5}[\s\-]?\d{2,4}[A-Z]?)\b/g;
    const rawCatnos = [...rawText.matchAll(catnoPattern)].map(m => m[1]);
    for (const c of rawCatnos) {
      if (c !== catalogNumber) {
        urls.add(`catno=${c} [from rawText]`);
        const s = c.replace(/[\s\-]/g, '');
        if (s !== c) urls.add(`catno=${s} [from rawText stripped]`);
      }
    }
  }
  const fuzzyQ = rawText || [artist, title, label].filter(Boolean).join(' ');
  if (fuzzyQ) urls.add(`q="${fuzzyQ.slice(0, 60)}${fuzzyQ.length > 60 ? '...' : ''}"`);
  if (title && (!artist || artist === label)) urls.add(`q=${title} [title-keyword fallback]`);

  return [...urls];
}

// ─── Known Discogs candidates ─────────────────────────────────────────────────

// The correct Stasis "Circuit Funk" release (PF013 on Peacefrog)
const CORRECT = {
  artist: 'Stasis',
  recordTitle: 'Circuit Funk',
  label: 'Peacefrog',         // Discogs often stores as "Peacefrog" not "Peacefrog Records"
  catalogNumber: 'PF013',
};

// A plausible false catno collision: another label that also uses "PF013"
const WRONG_CATNO_COLLISION = {
  artist: 'Unknown Artist',
  recordTitle: 'Some Other Track',
  label: 'Pure Frequency',
  catalogNumber: 'PF013',
};

// A wrong title match (different artist, same title words)
const WRONG_ARTIST_MATCH = {
  artist: 'The Prodigy',
  recordTitle: 'Circuit Funk',
  label: 'XL Recordings',
  catalogNumber: 'XL123',
};

// ─── Would this search strategy find the correct release? ────────────────────

function wouldFindCorrect(urls) {
  // Strategies that would reliably surface PF013 Stasis Circuit Funk
  return urls.some(u =>
    (u.includes('PF013') || u.includes('PF 013') || u.includes('PF-013')) ||
    (u.includes('Stasis') || u.includes('STASIS') || u.includes('stasis')) ||
    (u.includes('Circuit') || u.includes('circuit') || u.includes('CIRCUIT')) ||
    (u.includes('Peacefrog') || u.includes('PEACEFROG') || u.includes('peacefrog'))
  );
}

function findStrategies(urls) {
  const hits = [];
  if (urls.some(u => u.match(/catno=PF.?013/) && u.includes('&artist='))) hits.push('catno+artist');
  if (urls.some(u => u.match(/catno=PF.?013/) && !u.includes('&')))        hits.push('catno-only');
  if (urls.some(u => u.includes('artist=') && u.includes('release_title='))) hits.push('artist+title');
  if (urls.some(u => u.includes('label=') && u.includes('Peacefrog') || u.includes('PEACEFROG'))) hits.push('label+title');
  if (urls.some(u => u.startsWith('q=')))                                   hits.push('fuzzy');
  return hits.join(', ') || 'none';
}

// ─── 30 permutations ─────────────────────────────────────────────────────────

const cases = [
  // --- IDEAL reads ---
  { id: 1,  label: 'Perfect read',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 2,  label: 'Lowercase catno',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'pf013' } },
  { id: 3,  label: 'Spaced catno (PF 013)',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF 013' } },
  { id: 4,  label: 'Dashed catno (PF-013)',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF-013' } },

  // --- Artist misreads ---
  { id: 5,  label: 'Artist empty',
    v: { artist:'', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 6,  label: 'Artist = label (Vision confused them)',
    v: { artist:'PEACEFROG RECORDS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 7,  label: 'Artist has disambiguation suffix "Stasis (2)"',
    v: { artist:'STASIS (2)', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 8,  label: 'Artist read as track title "VIEW FROM THE RILLE"',
    v: { artist:'VIEW FROM THE RILLE', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 9,  label: 'Artist OCR garbled "ST4SIS"',
    v: { artist:'ST4SIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 10, label: 'Artist is genre word "ELECTRONIC"',
    v: { artist:'ELECTRONIC', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },

  // --- Title misreads ---
  { id: 11, label: 'Title empty',
    v: { artist:'STASIS', title:'', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 12, label: 'Title has EP suffix',
    v: { artist:'STASIS', title:'CIRCUIT FUNK EP', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 13, label: 'Title only first word',
    v: { artist:'STASIS', title:'CIRCUIT', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 14, label: 'Title = track name "VIEW FROM THE RILLE" (confused release vs track)',
    v: { artist:'STASIS', title:'VIEW FROM THE RILLE', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 15, label: 'Title typo "CIRCUT FUNK"',
    v: { artist:'STASIS', title:'CIRCUT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 16, label: 'Title includes both tracks "CIRCUIT FUNK / VIEW FROM THE RILLE"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK / VIEW FROM THE RILLE', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },
  { id: 17, label: 'Title and artist swapped',
    v: { artist:'CIRCUIT FUNK', title:'STASIS', label:'PEACEFROG RECORDS', catalogNumber:'PF013' } },

  // --- Label misreads ---
  { id: 18, label: 'Label empty',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'', catalogNumber:'PF013' } },
  { id: 19, label: 'Label short form "PEACEFROG"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG', catalogNumber:'PF013' } },
  { id: 20, label: 'Label OCR garbled "PEACE FROG RECORDS"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACE FROG RECORDS', catalogNumber:'PF013' } },
  { id: 21, label: 'Label = artist (Vision confused them)',
    v: { artist:'PEACEFROG RECORDS', title:'CIRCUIT FUNK', label:'STASIS', catalogNumber:'PF013' } },

  // --- Catno misreads ---
  { id: 22, label: 'Catno empty',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'' } },
  { id: 23, label: 'Catno OCR: O instead of 0 "PFO13"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PFO13' } },
  { id: 24, label: 'Catno OCR: I instead of 1 "PF0I3"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF0I3' } },
  { id: 25, label: 'Catno OCR: l instead of 1 "PF0l3"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF0l3' } },
  { id: 26, label: 'Catno prefix dropped "013"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'013' } },
  { id: 27, label: 'Catno B instead of 3 "PF01B"',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF01B' } },

  // --- Compound failures ---
  { id: 28, label: 'Wrong catno + correct artist+title',
    v: { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PFO13' } },
  { id: 29, label: 'Wrong catno + artist is label + correct title',
    v: { artist:'PEACEFROG RECORDS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PFO13' } },
  { id: 30, label: 'All empty except rawText with correct text',
    v: { artist:'', title:'', label:'', catalogNumber:'',
         rawText:'STASIS CIRCUIT FUNK PEACEFROG RECORDS PF013 VIEW FROM THE RILLE PRESENCE' } },
];

// ─── Run diagnostics ─────────────────────────────────────────────────────────

let okCount = 0, failCount = 0;
const failures = [];

console.log('PF013 Stasis "Circuit Funk" -- 30-permutation diagnostic\n');
console.log(`${'#'.padEnd(3)} ${'Case'.padEnd(52)} ${'Score(C)'.padEnd(9)} ${'Score(W)'.padEnd(9)} ${'Strategies'.padEnd(30)} ${'Verdict'}`);
console.log('─'.repeat(130));

for (const { id, label: caseLabel, v } of cases) {
  const scoreCorrect = scoreCandidate(CORRECT, v);
  const scoreWrong   = scoreCandidate(WRONG_CATNO_COLLISION, v);
  const urls = buildSearchUrls(v);
  const strategies = findStrategies(urls);

  // The pipeline succeeds if:
  // 1. The correct release appears in search results (we can only heuristically
  //    check by seeing if any URL would plausibly surface PF013 on Peacefrog), AND
  // 2. The correct candidate scores >= 0 (not filtered as bad), AND
  // 3. The correct candidate is not cut off by merged.slice(0, 5)

  const correctWouldScore = scoreCorrect >= 0;
  const correctWouldSurface = strategies !== 'none';
  // If there is a catno+artist or artist+title strategy, those are highly targeted
  // and would likely surface the release even if catno-only returns collisions.
  const hasTargetedStrategy = strategies.includes('catno+artist') || strategies.includes('artist+title') || strategies.includes('label+title');

  // The UNVERIFIED failure modes:
  // A) No URLs generated (catno empty, no artist, no title, no label, no rawText)
  // B) Only catno-only which has collisions, and catno hits fill the slice(0,5)
  //    before targeted results can appear
  // C) scoreCorrect < 0 (correct candidate would be ranked out)

  let verdict, ok;
  if (!correctWouldSurface) {
    verdict = 'FAIL: no search strategies'; ok = false;
  } else if (scoreCorrect < -1) {
    verdict = `FAIL: correct scores ${scoreCorrect} (would be filtered)`; ok = false;
  } else if (!hasTargetedStrategy && strategies === 'catno-only') {
    verdict = 'RISK: only catno-only, collision may fill slice'; ok = false;
  } else {
    verdict = `OK (correct scores ${scoreCorrect}, strategies: ${strategies})`; ok = true;
  }

  if (ok) okCount++; else { failCount++; failures.push(id); }

  const sign = ok ? '' : '!';
  console.log(
    `${(sign + id).padEnd(3)} ${caseLabel.padEnd(52)} ${String(scoreCorrect).padEnd(9)} ${String(scoreWrong).padEnd(9)} ${strategies.padEnd(30)} ${verdict}`
  );
}

console.log('\n' + '─'.repeat(130));
console.log(`\nResults: ${okCount}/30 would succeed, ${failCount} would fail (cases: ${failures.join(', ')})\n`);

// ─── Deeper look: slice collision analysis ───────────────────────────────────

console.log('\n== Slice collision analysis ==\n');
console.log('The catno-only search (per_page=5) runs in parallel with targeted searches.');
console.log('merged.slice(0,5) in discogs.js means the first 5 unique results win.');
console.log('If catno=PF013 returns 5 wrong-label releases, targeted hits from');
console.log('catno+artist or artist+title would be cut off at position 6+.\n');

const perfectVision = { artist:'STASIS', title:'CIRCUIT FUNK', label:'PEACEFROG RECORDS', catalogNumber:'PF013' };
const urls = buildSearchUrls(perfectVision);
console.log('URLs generated for perfect vision read:');
urls.forEach((u, i) => console.log(`  ${i+1}. ${u}`));

console.log('\nIf catno=PF013 returns 5 collision candidates ALL scoring < -1:');
console.log('  - allBad check fires -> visionFallback -> UNVERIFIED');
console.log('  - Even though artist+title=STASIS+CIRCUIT FUNK would find the correct release,');
console.log('    its result is at merged position 6+ and never makes it into the candidate pool.\n');

console.log('== Scoring the correct candidate vs vision reads ==\n');
const edgeCases = [
  { label: 'Discogs: "Peacefrog" vs Vision: "PEACEFROG RECORDS"',
    c: { ...CORRECT, label: 'Peacefrog' },
    v: { ...perfectVision } },
  { label: 'Discogs: "Peacefrog" vs Vision: "PEACEFROG"',
    c: { ...CORRECT, label: 'Peacefrog' },
    v: { ...perfectVision, label: 'PEACEFROG' } },
  { label: 'Discogs: "Stasis" vs Vision artist="PEACEFROG RECORDS" (label=artist confusion)',
    c: { ...CORRECT },
    v: { ...perfectVision, artist: 'PEACEFROG RECORDS' } },
  { label: 'Discogs: "Stasis" vs Vision has "funk" as artist (genre word)',
    c: { ...CORRECT },
    v: { ...perfectVision, artist: 'FUNK' } },
];

for (const { label: l, c, v } of edgeCases) {
  console.log(`  ${l}`);
  console.log(`    -> score: ${scoreCandidate(c, v)}\n`);
}
