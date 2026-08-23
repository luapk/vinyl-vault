/**
 * Scoring + ranking unit tests for the scan pipeline.
 *
 * Tests the scoreCandidate / rankCandidates logic (copied verbatim from
 * api/scan.js) against 50 realistic synthetic scenarios, grouped by failure
 * category.  No API keys required — pure local logic.
 *
 * Run: node scripts/test-scoring.mjs
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
    'techno', 'house', 'ambient', 'dnb', 'jungle', 'garage', 'trance',
    'hardcore', 'rave', 'dub', 'electronic', 'electro', 'dance', 'music',
    'funk', 'soul', 'jazz', 'rap', 'disco', 'breakbeat', 'breaks',
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

function rankCandidates(candidates, vision) {
  if (!vision || candidates.length <= 1) return candidates;
  const scored = candidates.map(c => ({ c, s: scoreCandidate(c, vision) }));
  scored.sort((a, b) => b.s - a.s);
  const good = scored.filter(x => x.s >= 0);
  const result = good.length > 0 ? good : scored;
  return result.map(x => x.c);
}

// The fallback threshold from scan.js
const ALL_BAD_THRESHOLD = -1; // if every candidate scores < this -> visionFallback

// ─── Test runner ─────────────────────────────────────────────────────────────

let passed = 0, failed = 0;
const failures = [];
const CATEGORIES = {};

function test(category, description, { vision, candidates, correctId, expectFallback = false }) {
  if (!CATEGORIES[category]) CATEGORIES[category] = { pass: 0, fail: 0 };

  const ranked = rankCandidates(candidates, vision);
  const scores = candidates.map(c => ({ id: c.id, score: scoreCandidate(c, vision) }));

  const allBad = scores.every(s => s.score < ALL_BAD_THRESHOLD);
  const isFallback = allBad && (vision.artist || vision.title);

  let ok;
  if (expectFallback) {
    ok = isFallback;
  } else {
    ok = !isFallback && ranked[0]?.id === correctId;
  }

  if (ok) {
    passed++;
    CATEGORIES[category].pass++;
  } else {
    failed++;
    CATEGORIES[category].fail++;
    const topId = ranked[0]?.id ?? 'FALLBACK';
    const topScore = ranked[0] ? scoreCandidate(ranked[0], vision) : 'n/a';
    const correctScore = scores.find(s => s.id === correctId)?.score ?? 'not in pool';
    failures.push({
      category, description,
      expected: expectFallback ? 'visionFallback' : correctId,
      got: isFallback ? 'visionFallback' : topId,
      correctScore,
      topScore,
      vision: { artist: vision.artist, title: vision.title, label: vision.label },
    });
  }
}

// ─── Scenario helpers ─────────────────────────────────────────────────────────

const c = (id, artist, title, label) => ({ id, artist, recordTitle: title, label });

// ─── Category A: Perfect / near-perfect matches ───────────────────────────────

test('A: clean match', 'Exact artist + title match', {
  vision: { artist: 'Aphex Twin', title: 'Selected Ambient Works Volume II', label: 'Warp' },
  candidates: [
    c('1', 'Aphex Twin', 'Selected Ambient Works Volume II', 'Warp Records'),
    c('2', 'Aphex Twin', 'Selected Ambient Works 85-92', 'Warp Records'),
    c('3', 'Various Artists', 'Ambient Works', 'Warp Records'),
  ],
  correctId: '1',
});

test('A: clean match', 'Artist + title partial word overlap', {
  vision: { artist: 'Juan Atkins', title: 'Skyway', label: 'Metroplex' },
  candidates: [
    c('1', 'Juan Atkins', 'Skyway', 'Metroplex'),
    c('2', 'Model 500', 'Skyway', 'Metroplex'),
    c('3', 'Juan Atkins', 'Off To Battle', 'Metroplex'),
  ],
  correctId: '1',
});

test('A: clean match', 'Case + punctuation normalisation', {
  vision: { artist: "larry heard", title: "can you feel it", label: null },
  candidates: [
    c('1', "Larry Heard", "Can You Feel It", "Trax Records"),
    c('2', "Larry Heard", "Washing Machine", "Trax Records"),
    c('3', "Mr. Fingers", "Can You Feel It", "Trax Records"),
  ],
  correctId: '1',
});

test('A: clean match', 'Discogs disambiguation suffix stripped', {
  vision: { artist: 'Model 500', title: 'No UFO\'s', label: 'Metroplex' },
  candidates: [
    c('1', 'Model 500 (2)', 'No UFO\'s', 'Metroplex'),
    c('2', 'Model 500', 'Nitro', 'Metroplex'),
  ],
  correctId: '1',
});

test('A: clean match', 'Label matches when artist/title both strong', {
  vision: { artist: 'Underground Resistance', title: 'Galaxy 2 Galaxy', label: 'Underground Resistance' },
  candidates: [
    c('1', 'Underground Resistance', 'Galaxy 2 Galaxy', 'Underground Resistance'),
    c('2', 'Underground Resistance', 'Final Frontier', 'Underground Resistance'),
  ],
  correctId: '1',
});

// ─── Category B: Catalog-number collision (different artist, same catno) ──────

test('B: catno collision', 'Wrong artist same catno should rank below correct', {
  vision: { artist: 'Plastikman', title: 'Consumed', label: 'Novamute' },
  candidates: [
    c('1', 'Plastikman', 'Consumed', 'Novamute'),
    c('2', 'Some Other Band', 'Consumed', 'Some Label'),  // catno collision
    c('3', 'Artist X', 'Another Album', 'Label Y'),
  ],
  correctId: '1',
});

test('B: catno collision', 'Correct should beat total mismatch artist', {
  vision: { artist: 'Basic Channel', title: 'BCD', label: 'Basic Channel' },
  candidates: [
    c('1', 'Basic Channel', 'BCD', 'Basic Channel'),
    c('2', 'Random Artist', 'Something Else', 'Other Label'),
  ],
  correctId: '1',
});

test('B: catno collision', 'Artist mismatch without title match triggers fallback', {
  vision: { artist: 'Carl Craig', title: 'Landcruising', label: 'Planet E' },
  candidates: [
    c('1', 'Totally Wrong Artist', 'Different Album', 'Some Label'),
    c('2', 'Also Wrong', 'Different Title', 'Planet E'),
  ],
  correctId: null,
  expectFallback: true,
});

test('B: catno collision', 'Strong artist + weak title beats weak artist + strong title', {
  vision: { artist: 'Drexciya', title: 'Bubble Metropolis', label: 'Submerge' },
  candidates: [
    c('1', 'Drexciya', 'Bubble Metropolis', 'Submerge'),
    c('2', 'Unknown Artist', 'Bubble Metropolis', 'Submerge'),
  ],
  correctId: '1',
});

// ─── Category C: Empty / missing artist (minimal techno label) ────────────────

test('C: empty artist', 'Title match is enough when artist is empty', {
  vision: { artist: '', title: 'Domina', label: null },
  candidates: [
    c('1', 'Domina', 'Domina', 'Z Records'),
    c('2', 'Carl Craig', 'Domina (C. Craig Mix)', 'Planet E'),
    c('3', 'Random Act', 'Something Else', 'Z Records'),
  ],
  correctId: '1',
});

test('C: empty artist', 'No artist, label strong signal', {
  vision: { artist: '', title: 'Strings of Life', label: 'Transmat' },
  candidates: [
    c('1', 'Rhythim Is Rhythim', 'Strings of Life', 'Transmat'),
    c('2', 'Derrick May', 'Icon', 'Transmat'),
    c('3', 'Various Artists', 'Strings of Life Remixes', 'Hospital Records'),
  ],
  correctId: '1',
});

test('C: empty artist', 'No artist, no label — title is only signal', {
  vision: { artist: '', title: 'Nude Photo', label: null },
  candidates: [
    c('1', 'Rhythim Is Rhythim', 'Nude Photo', 'Transmat'),
    c('2', 'Random Artist', 'Nude Photo Remix', 'Other Label'),
  ],
  correctId: '1',
});

test('C: empty artist', 'Empty vision fields — no candidates filtered', {
  vision: { artist: '', title: '', label: null },
  candidates: [
    c('1', 'Anything', 'Goes', 'Label'),
  ],
  correctId: '1',
});

// ─── Category D: Mix credit mistaken for artist (the DOMINA case) ─────────────

test('D: mix credit as artist', 'Mix credit read as artist — correct should still rank 1', {
  vision: { artist: 'C. Craig', title: 'Domina', label: null },
  candidates: [
    c('1', 'Domina', 'Domina', 'Z Records'),          // correct: artist is "Domina"
    c('2', 'Carl Craig', 'Mind', 'Planet E'),          // wrong: matches artist "C. Craig" loosely
  ],
  correctId: '1',  // fails under current scoring — artist "Domina" vs vision "C. Craig" = -3
});

test('D: mix credit as artist', 'Remixer name as artist — title match saves it', {
  vision: { artist: 'DJ Stingray', title: 'Trident Bass', label: null },
  candidates: [
    c('1', 'Underground Resistance', 'Trident Bass (DJ Stingray Remix)', 'UR'),
    c('2', 'DJ Stingray', 'Trident Bass', 'Submerge'),
  ],
  correctId: '1',
});

test('D: mix credit as artist', 'Remix suffix in candidate title reduces titleSim', {
  vision: { artist: '', title: 'Domina', label: null },
  candidates: [
    c('1', 'Artist A', 'Domina', 'Label X'),            // exact title match
    c('2', 'Artist B', 'Domina (C. Craig Mind Mix)', 'Label Y'), // partial title match
  ],
  correctId: '1',
});

test('D: mix credit as artist', 'No artist, title+label together find correct', {
  vision: { artist: '', title: 'Domina', label: 'Z Records' },
  candidates: [
    c('1', 'Domina', 'Domina', 'Z Records'),
    c('2', 'Carl Craig', 'Domina', 'Planet E'),
    c('3', 'Various Artists', 'Domina EP', 'Z Records'),
  ],
  correctId: '1',
});

// ─── Category E: Label name confused with artist ──────────────────────────────

test('E: label as artist', 'Purpose Maker label name on label, no separate artist', {
  vision: { artist: 'Purpose Maker', title: 'Throw', label: 'Purpose Maker' },
  candidates: [
    c('1', 'Carl Craig', 'Throw', 'Purpose Maker'),
    c('2', 'Purpose Maker', 'Throw', 'Purpose Maker'),  // wrong: label credited as artist
  ],
  correctId: '1',  // expectation: Carl Craig should win on title match
});

test('E: label as artist', 'Warp Records not the artist', {
  vision: { artist: 'Warp Records', title: 'Artificial Intelligence', label: 'Warp' },
  candidates: [
    c('1', 'Various Artists', 'Artificial Intelligence', 'Warp Records'),
    c('2', 'Warp Records', 'Artificial Intelligence', 'Warp Records'),
  ],
  correctId: '1',
});

test('E: label as artist', 'R&S label name vs actual artist', {
  vision: { artist: 'R&S', title: 'Stella', label: 'R&S Records' },
  candidates: [
    c('1', 'Quadrophonia', 'Stella', 'R&S Records'),
    c('2', 'R&S', 'Stella', 'R&S Records'),
  ],
  correctId: '1',
});

// ─── Category F: Multiple pressings same release ──────────────────────────────

test('F: pressings', 'US vs UK pressing — both valid, correct should rank >= 1', {
  vision: { artist: 'Massive Attack', title: 'Blue Lines', label: 'Wild Bunch' },
  candidates: [
    c('1', 'Massive Attack', 'Blue Lines', 'Wild Bunch Records'),   // UK
    c('2', 'Massive Attack', 'Blue Lines', 'Virgin'),                // US
  ],
  correctId: '1',  // UK pressing with label match
});

test('F: pressings', 'Reissue vs original, same artist title', {
  vision: { artist: 'Daft Punk', title: 'Homework', label: 'Virgin' },
  candidates: [
    c('1', 'Daft Punk', 'Homework', 'Virgin'),
    c('2', 'Daft Punk', 'Homework', 'Parlophone'),  // reissue
  ],
  correctId: '1',
});

test('F: pressings', 'Promo vs commercial, identical metadata', {
  vision: { artist: 'Floorplan', title: 'Never Grow Old', label: 'Motor City Drum Ensemble' },
  candidates: [
    c('1', 'Floorplan', 'Never Grow Old', 'Motor City Drum Ensemble'),
    c('2', 'Floorplan', 'Never Grow Old EP', 'Motor City Drum Ensemble'),
  ],
  correctId: '1',
});

// ─── Category G: VA releases ──────────────────────────────────────────────────

test('G: various artists', 'VA comp with known track in title', {
  vision: { artist: 'Various', title: 'Tresor II', label: 'Tresor' },
  candidates: [
    c('1', 'Various', 'Tresor II', 'Tresor'),
    c('2', 'Various Artists', 'Tresor I', 'Tresor'),
    c('3', 'Various', 'Berlin', 'Tresor'),
  ],
  correctId: '1',
});

test('G: various artists', 'VA read as specific artist', {
  vision: { artist: '', title: 'Wax Trax! Records The First 13 Years', label: 'Wax Trax' },
  candidates: [
    c('1', 'Various Artists', 'Wax Trax! Records The First 13 Years', 'Wax Trax!'),
    c('2', 'Ministry', 'Wax Trax! Sampler', 'Wax Trax!'),
  ],
  correctId: '1',
});

// ─── Category H: Short or single-word titles ──────────────────────────────────

test('H: short titles', 'Single word title — artist must disambiguate', {
  vision: { artist: 'Burial', title: 'Untrue', label: 'Hyperdub' },
  candidates: [
    c('1', 'Burial', 'Untrue', 'Hyperdub'),
    c('2', 'Various', 'Untrue', 'Some Label'),
    c('3', 'Burial', 'Kindred', 'Hyperdub'),
  ],
  correctId: '1',
});

test('H: short titles', 'Two-letter catno-style title', {
  vision: { artist: 'Basic Channel', title: 'BCD', label: 'Basic Channel' },
  candidates: [
    c('1', 'Basic Channel', 'BCD', 'Basic Channel'),
    c('2', 'Basic Channel', 'BVD', 'Basic Channel'),
  ],
  correctId: '1',
});

test('H: short titles', 'Numeric only release title', {
  vision: { artist: 'Surgeon', title: '700', label: 'Downwards' },
  candidates: [
    c('1', 'Surgeon', '700', 'Downwards'),
    c('2', 'Regis', '700', 'Downwards'),
  ],
  correctId: '1',
});

// ─── Category I: Artist disambiguation suffix collisions ──────────────────────

test('I: disambiguation', 'Artist (2) vs Artist — correct should win', {
  vision: { artist: 'Model 500', title: 'No UFO\'s', label: 'Metroplex' },
  candidates: [
    c('1', 'Model 500', 'No UFO\'s', 'Metroplex'),
    c('2', 'Model 500 (2)', 'No UFO\'s', 'Planet E'),   // different wrong label
  ],
  correctId: '1',
});

test('I: disambiguation', 'Carl Craig vs C. Craig — norm should treat same', {
  vision: { artist: 'Carl Craig', title: 'More Songs About Food and Revolutionary Art', label: 'Planet E' },
  candidates: [
    c('1', 'Carl Craig', 'More Songs About Food and Revolutionary Art', 'Planet E'),
    c('2', 'C. Craig', 'Other Album', 'Some Label'),
  ],
  correctId: '1',
});

// ─── Category J: Genre tag / crate label confusion ────────────────────────────

test('J: genre confusion', 'TECHNO on label read as artist name', {
  vision: { artist: 'Techno', title: 'Detroit Techno Allstars', label: null },
  candidates: [
    c('1', 'Various Artists', 'Detroit Techno Allstars', 'Metroplex'),
    c('2', 'Techno', 'Detroit Techno Allstars', 'Metroplex'),
  ],
  correctId: '1',  // VA should beat "Techno" as artist
});

test('J: genre confusion', 'HOUSE printed large on label, read as artist', {
  vision: { artist: 'House', title: 'The Sensation', label: 'Trax Records' },
  candidates: [
    c('1', 'Various Artists', 'The Sensation', 'Trax Records'),
    c('2', 'House', 'The Sensation', 'Trax Records'),
  ],
  correctId: '1',
});

// ─── Category K: Non-English / transliterated artists ─────────────────────────

test('K: non-english', 'Japanese artist name with latin chars', {
  vision: { artist: 'Haruomi Hosono', title: 'Watering a Flower', label: null },
  candidates: [
    c('1', 'Haruomi Hosono', 'Watering a Flower', 'King Records'),
    c('2', 'Yellow Magic Orchestra', 'Watering a Flower', 'Alfa'),
  ],
  correctId: '1',
});

test('K: non-english', 'Accents stripped in norm', {
  vision: { artist: 'Erik Satie', title: 'Gymnopédies', label: null },
  candidates: [
    c('1', 'Erik Satie', 'Gymnopédies', 'Deutsche Grammophon'),
    c('2', 'Erik Satie', 'Gnossiennes', 'Deutsche Grammophon'),
  ],
  correctId: '1',
});

// ─── Category L: Long artist or title names ───────────────────────────────────

test('L: long names', 'Long title partial word overlap', {
  vision: { artist: 'Aphex Twin', title: 'Come to Daddy', label: 'Warp' },
  candidates: [
    c('1', 'Aphex Twin', 'Come to Daddy', 'Warp Records'),
    c('2', 'Aphex Twin', 'Come to Daddy (Mummy Mix)', 'Warp Records'),
  ],
  correctId: '1',
});

test('L: long names', 'Full album vs EP same title', {
  vision: { artist: 'Autechre', title: 'Amber', label: 'Warp' },
  candidates: [
    c('1', 'Autechre', 'Amber', 'Warp Records'),
    c('2', 'Autechre', 'Amber EP', 'Warp Records'),
  ],
  correctId: '1',
});

// ─── Category M: Instrumental / untitled tracks ───────────────────────────────

test('M: untitled', 'Untitled release with artist', {
  vision: { artist: 'Actress', title: 'Untitled', label: 'Werkdiscs' },
  candidates: [
    c('1', 'Actress', 'Untitled', 'Werkdiscs'),
    c('2', 'Various Artists', 'Untitled', 'Werkdiscs'),
    c('3', 'Actress', 'R.I.P.', 'Werkdiscs'),
  ],
  correctId: '1',
});

// ─── Category N: Side marker confusion ───────────────────────────────────────

test('N: side markers', 'Side A / B label on side A — reading track list as title', {
  vision: { artist: 'Jeff Mills', title: 'The Bells', label: 'Axis' },
  candidates: [
    c('1', 'Jeff Mills', 'The Bells', 'Axis'),
    c('2', 'Jeff Mills', 'Side B', 'Axis'),
  ],
  correctId: '1',
});

// ─── Category O: Wrong fallback (should NOT fallback when correct exists) ──────

test('O: no false fallback', 'Should not fallback when correct candidate scores >= 0', {
  vision: { artist: 'Burial', title: 'Rival Dealer', label: 'Hyperdub' },
  candidates: [
    c('1', 'Burial', 'Rival Dealer', 'Hyperdub'),
  ],
  correctId: '1',
  expectFallback: false,
});

test('O: no false fallback', 'Weak score but should not fallback if title matches', {
  vision: { artist: 'Unknown', title: 'Mayday', label: null },
  candidates: [
    c('1', 'Reese & Santonio', 'Mayday', 'KMS'),
  ],
  correctId: '1',
  expectFallback: false,
});

test('O: no false fallback', 'Empty artist should not cause fallback when title strong', {
  vision: { artist: '', title: 'Spastik', label: null },
  candidates: [
    c('1', 'Plastikman', 'Spastik', 'Novamute'),
  ],
  correctId: '1',
  expectFallback: false,
});

// ─── Category P: Fallback SHOULD trigger (all candidates clearly wrong) ───────

test('P: correct fallback', 'All candidates wrong artist + wrong title = fallback', {
  vision: { artist: 'Aphex Twin', title: 'Drukqs', label: 'Warp' },
  candidates: [
    c('1', 'Some Random', 'Completely Different', 'Other Label'),
    c('2', 'Another Artist', 'Also Wrong', 'More Labels'),
  ],
  correctId: null,
  expectFallback: true,
});

test('P: correct fallback', 'No candidates at all edge case handled', {
  vision: { artist: 'The Orb', title: 'Adventures Beyond the Ultraworld', label: 'Big Life' },
  candidates: [],
  correctId: null,
  expectFallback: true,  // empty pool with vision info: allBad vacuously true, should fallback
});

// ─── Category Q: Substring / contains cases ───────────────────────────────────

test('Q: substring', 'Title is substring of candidate title', {
  vision: { artist: 'Plastikman', title: 'Spastik', label: null },
  candidates: [
    c('1', 'Plastikman', 'Spastik', 'Novamute'),
    c('2', 'Plastikman', 'Spastikman Remixes', 'Novamute'),
  ],
  correctId: '1',
});

test('Q: substring', 'Artist substring of longer candidate name', {
  vision: { artist: 'Sven Vath', title: 'Harlequin', label: 'Cocoon' },
  candidates: [
    c('1', 'Sven Vath', 'Harlequin', 'Cocoon Recordings'),
    c('2', 'Sven Vath In The Mood', 'Harlequin', 'Cocoon Recordings'),
  ],
  correctId: '1',
});

// ─── Category R: Score edge cases ─────────────────────────────────────────────

test('R: score edges', 'Label bonus breaks exact title tie', {
  vision: { artist: 'Ricardo Villalobos', title: 'Fizheuer Zieheuer', label: 'Perlon' },
  candidates: [
    c('1', 'Ricardo Villalobos', 'Fizheuer Zieheuer', 'Perlon'),
    c('2', 'Ricardo Villalobos', 'Fizheuer Zieheuer', 'Other Imprint'),
  ],
  correctId: '1',
});

test('R: score edges', 'Two-word overlap sim > one-word overlap', {
  vision: { artist: 'Theo Parrish', title: 'Falling Up', label: 'Sound Signature' },
  candidates: [
    c('1', 'Theo Parrish', 'Falling Up', 'Sound Signature'),
    c('2', 'Theo Parrish', 'Falling Down', 'Sound Signature'),
  ],
  correctId: '1',
});

test('R: score edges', 'null sim (empty fields) does not penalise', {
  vision: { artist: '', title: '', label: 'Tresor' },
  candidates: [
    c('1', 'Surgeon', 'Force + Form', 'Tresor'),
    c('2', 'Various', 'Compilation', 'Not Tresor'),
  ],
  correctId: '1',
});

// ─── Category S: Truncated / partial artist name ──────────────────────────────

test('S: truncated artist', 'First word of two-word artist only', {
  vision: { artist: 'Aphex', title: 'Come to Daddy', label: 'Warp' },
  candidates: [
    c('1', 'Aphex Twin', 'Come to Daddy', 'Warp Records'),
    c('2', 'Various Artists', 'Come to Daddy Compilation', 'Warp Records'),
  ],
  correctId: '1',
});

test('S: truncated artist', 'Artist truncated mid-word — substring includes saves it', {
  vision: { artist: 'Aphex T', title: 'Drukqs', label: 'Warp' },
  candidates: [
    c('1', 'Aphex Twin', 'Drukqs', 'Warp Records'),
    c('2', 'Aphex', 'Drukqs', 'Not Warp'),
  ],
  correctId: '1',
});

test('S: truncated artist', 'Only surname readable', {
  vision: { artist: 'Craig', title: 'Landcruising', label: 'Planet E' },
  candidates: [
    c('1', 'Carl Craig', 'Landcruising', 'Planet E'),
    c('2', 'Various', 'Landcruising Remixes', 'Planet E'),
  ],
  correctId: '1',
});

test('S: truncated artist', 'Known short-form alias on label', {
  vision: { artist: 'UR', title: 'Electronic Warfare', label: null },
  candidates: [
    c('1', 'UR', 'Electronic Warfare', 'Underground Resistance'),
    c('2', 'Underground Resistance', 'Electronic Warfare', 'Underground Resistance'),
  ],
  correctId: '1',
});

test('S: truncated artist', 'Single initial — too short to penalise, title decides', {
  vision: { artist: 'J', title: 'The Bells', label: 'Axis' },
  candidates: [
    c('1', 'Jeff Mills', 'The Bells', 'Axis'),
    c('2', 'Joey Beltram', 'Energy Flash', 'R&S Records'),
  ],
  correctId: '1',
});

test('S: truncated artist', 'Partial label word bleeds into artist — triggers unreliable', {
  vision: { artist: 'Warp Re', title: 'Surfing on Sine Waves', label: 'Warp' },
  candidates: [
    c('1', 'Polygon Window', 'Surfing on Sine Waves', 'Warp Records'),
    c('2', 'Warp Records', 'Surfing on Sine Waves', 'Warp Records'),
  ],
  correctId: '1',
});

// ─── Category T: Truncated / clipped title ────────────────────────────────────

test('T: truncated title', 'Title ends at word boundary, shorter than real title', {
  vision: { artist: 'Burial', title: 'Rival Deal', label: 'Hyperdub' },
  candidates: [
    c('1', 'Burial', 'Rival Dealer', 'Hyperdub'),
    c('2', 'Various', 'Rival Deal', 'Other Label'),
  ],
  correctId: '1',
});

test('T: truncated title', 'Last word missing from four-word title', {
  vision: { artist: 'Massive Attack', title: 'Unfinished Sympathy', label: 'Wild Bunch' },
  candidates: [
    c('1', 'Massive Attack', 'Unfinished Sympathy', 'Wild Bunch Records'),
    c('2', 'Massive Attack', 'Unfinished', 'Wild Bunch Records'),
  ],
  correctId: '1',
});

test('T: truncated title', 'Title truncated mid-word — prefix still matches via includes', {
  vision: { artist: 'Autechre', title: 'Amber', label: 'Warp' },
  candidates: [
    c('1', 'Autechre', 'Amber', 'Warp Records'),
    c('2', 'Autechre', 'Ambergris', 'Warp Records'),
  ],
  correctId: '1',
});

test('T: truncated title', 'Only first keyword of long title', {
  vision: { artist: 'Carl Craig', title: 'More Songs', label: 'Planet E' },
  candidates: [
    c('1', 'Carl Craig', 'More Songs About Food and Revolutionary Art', 'Planet E'),
    c('2', 'Carl Craig', 'More Hits', 'Planet E'),
  ],
  correctId: '1',
});

test('T: truncated title', 'EP suffix stripped by OCR', {
  vision: { artist: 'Floorplan', title: 'Never Grow Old', label: null },
  candidates: [
    c('1', 'Floorplan', 'Never Grow Old EP', 'Motor City Drum Ensemble'),
    c('2', 'Floorplan', 'Paradise', 'Motor City Drum Ensemble'),
  ],
  correctId: '1',
});

test('T: truncated title', 'Long title clipped to ~half — word overlap carries it', {
  vision: { artist: 'The Orb', title: 'Adventures Beyond', label: null },
  candidates: [
    c('1', 'The Orb', 'Adventures Beyond the Ultraworld', 'Big Life'),
    c('2', 'The Orb', 'Adventures in Clubland', 'Big Life'),
  ],
  correctId: '1',
});

// ─── Category U: OCR character substitutions ──────────────────────────────────

test('U: ocr substitution', '1 substituted for i — word still mostly matches', {
  vision: { artist: 'Aphex Tw1n', title: 'Windowlicker', label: 'Warp' },
  candidates: [
    c('1', 'Aphex Twin', 'Windowlicker', 'Warp Records'),
    c('2', 'AFX', 'Windowlicker', 'Warp Records'),
  ],
  correctId: '1',
});

test('U: ocr substitution', '0 substituted for O in artist', {
  vision: { artist: 'M0del 500', title: "No UFO's", label: 'Metroplex' },
  candidates: [
    c('1', 'Model 500', "No UFO's", 'Metroplex'),
    c('2', 'Model 500', 'Nitro', 'Metroplex'),
  ],
  correctId: '1',
});

test('U: ocr substitution', 'Extra space inserted mid-word in artist', {
  vision: { artist: 'Plasti kman', title: 'Spastik', label: null },
  candidates: [
    c('1', 'Plastikman', 'Spastik', 'Novamute'),
    c('2', 'Plaster', 'Spastik', 'Other Label'),
  ],
  correctId: '1',
});

test('U: ocr substitution', 'Repeated letter in artist name', {
  vision: { artist: 'Burrial', title: 'Archangel', label: 'Hyperdub' },
  candidates: [
    c('1', 'Burial', 'Archangel', 'Hyperdub'),
    c('2', 'Various', 'Archangel', 'Hyperdub'),
  ],
  correctId: '1',
});

test('U: ocr substitution', 'S substituted for 5 in catalog-style artist name', {
  vision: { artist: 'Model S00', title: 'Starlight', label: 'Metroplex' },
  candidates: [
    c('1', 'Model 500', 'Starlight', 'Metroplex'),
    c('2', 'Model 500', 'Nitro', 'Metroplex'),
  ],
  correctId: '1',
});

test('U: ocr substitution', 'Both artist and title have single char errors — title saves it', {
  vision: { artist: 'Pla5tikman', title: 'Consumed', label: null },
  candidates: [
    c('1', 'Plastikman', 'Consumed', 'Novamute'),
    c('2', 'Random Act', 'Consumed', 'Other Label'),
  ],
  correctId: '1',
});

// ─── Category V: Track title read as release title ────────────────────────────

test('V: track as release title', 'Track name matches EP title — no conflict', {
  vision: { artist: 'Rhythim Is Rhythim', title: 'Strings of Life', label: 'Transmat' },
  candidates: [
    c('1', 'Rhythim Is Rhythim', 'Strings of Life', 'Transmat'),
    c('2', 'Derrick May', 'Beyond the Dance', 'Transmat'),
  ],
  correctId: '1',
});

test('V: track as release title', 'B-side track name read as title, artist strong enough', {
  vision: { artist: 'Jeff Mills', title: 'Gamma Player', label: 'Axis' },
  candidates: [
    c('1', 'Jeff Mills', 'Gamma Player', 'Axis'),
    c('2', 'Jeff Mills', 'The Bells', 'Axis'),
  ],
  correctId: '1',
});

test('V: track as release title', 'Track with remix suffix in title field — ties go to first candidate', {
  vision: { artist: 'Drexciya', title: 'Aquabahn (Techno Mix)', label: 'Submerge' },
  candidates: [
    c('1', 'Drexciya', 'Aquabahn', 'Submerge'),
    c('2', 'Drexciya', 'Aquabahn (Techno Mix)', 'Submerge'),
  ],
  correctId: '1',  // both score 9 (includes = 0.8 and exact = 1.0 both hit +4 threshold); stable sort preserves order
});

test('V: track as release title', 'Exact title match beats partial match when label differs', {
  vision: { artist: 'Basic Channel', title: 'Phylyps Trak', label: 'Basic Channel' },
  candidates: [
    c('1', 'Basic Channel', 'Phylyps Trak II', 'Rhythm & Sound'),  // wrong label
    c('2', 'Basic Channel', 'Phylyps Trak', 'Basic Channel'),       // exact title + matching label
  ],
  correctId: '2',  // label overlap is unreliable (artist=label), but title exact match wins
});

test('V: track as release title', 'Side label track listing first line taken as title', {
  vision: { artist: 'Underground Resistance', title: 'Frictional Nevada', label: 'UR' },
  candidates: [
    c('1', 'Underground Resistance', 'Frictional Nevada', 'Underground Resistance'),
    c('2', 'Underground Resistance', 'Galaxy 2 Galaxy', 'Underground Resistance'),
  ],
  correctId: '1',
});

test('V: track as release title', 'Untitled track read, matches untitled release', {
  vision: { artist: 'Actress', title: 'Untitled', label: 'Werkdiscs' },
  candidates: [
    c('1', 'Actress', 'Untitled', 'Werkdiscs'),
    c('2', 'Actress', 'Untitled 2', 'Werkdiscs'),
  ],
  correctId: '1',
});

// ─── Category W: Noise / junk text in fields ──────────────────────────────────

test('W: junk in fields', 'SIDE A read as title — artist carries the match', {
  vision: { artist: 'Juan Atkins', title: 'SIDE A', label: 'Metroplex' },
  candidates: [
    c('1', 'Juan Atkins', 'Skyway', 'Metroplex'),
    c('2', 'Model 500', 'No UFOs', 'Metroplex'),
  ],
  correctId: '1',
});

test('W: junk in fields', '33 1/3 RPM speed marking read as title', {
  vision: { artist: 'Derrick May', title: '33 1/3', label: 'Transmat' },
  candidates: [
    c('1', 'Derrick May', 'Nude Photo', 'Transmat'),
    c('2', 'Derrick May', 'Strings of Life', 'Transmat'),
  ],
  correctId: '1',
});

test('W: junk in fields', 'STEREO printed large, read as artist', {
  vision: { artist: 'STEREO', title: 'Mentasm', label: 'R&S Records' },
  candidates: [
    c('1', 'Second Phase', 'Mentasm', 'R&S Records'),
    c('2', 'Joey Beltram', 'Mentasm', 'R&S Records'),
  ],
  correctId: '1',
});

test('W: junk in fields', 'Matrix runout text in title — no title signal, artist+label decide', {
  vision: { artist: 'Plastikman', title: 'NVMLT-001 A1 PORKY', label: 'Novamute' },
  candidates: [
    c('1', 'Plastikman', 'Spastik', 'Novamute'),
    c('2', 'Plastikman', 'Consumed', 'Novamute'),
  ],
  correctId: '1',
});

test('W: junk in fields', 'PROMOTIONAL COPY NOT FOR SALE bleeds into artist', {
  vision: { artist: 'PROMOTIONAL COPY', title: 'Strings of Life', label: 'Transmat' },
  candidates: [
    c('1', 'Rhythim Is Rhythim', 'Strings of Life', 'Transmat'),
    c('2', 'Various', 'Strings of Life Remixes', 'Transmat'),
  ],
  correctId: '1',
});

test('W: junk in fields', 'MADE IN UK read as label — no label signal but artist+title strong', {
  vision: { artist: 'Aphex Twin', title: 'Windowlicker', label: 'MADE IN UK' },
  candidates: [
    c('1', 'Aphex Twin', 'Windowlicker', 'Warp Records'),
    c('2', 'Aphex Twin', 'Come to Daddy', 'Warp Records'),
  ],
  correctId: '1',
});

// ─── Category X: Single word from a multi-word name ──────────────────────────

test('X: single keyword', 'Last name only — first name dropped', {
  vision: { artist: 'Mills', title: 'The Bells', label: 'Axis' },
  candidates: [
    c('1', 'Jeff Mills', 'The Bells', 'Axis'),
    c('2', 'Robert Mills', 'The Bells', 'Other Label'),
  ],
  correctId: '1',
});

test('X: single keyword', 'First word of title only — artist disambiguates', {
  vision: { artist: 'Burial', title: 'Rival', label: null },
  candidates: [
    c('1', 'Burial', 'Rival Dealer', 'Hyperdub'),
    c('2', 'Various', 'Rival', 'Some Label'),
  ],
  correctId: '1',
});

test('X: single keyword', '"Attack" as full artist name', {
  vision: { artist: 'Attack', title: 'Teardrop', label: null },
  candidates: [
    c('1', 'Massive Attack', 'Teardrop', 'Virgin'),
    c('2', 'Heart Attack', 'Teardrop', 'Other Label'),
  ],
  correctId: '1',
});

test('X: single keyword', '"Resistance" as full artist name', {
  vision: { artist: 'Resistance', title: 'Electronic Warfare', label: null },
  candidates: [
    c('1', 'Underground Resistance', 'Electronic Warfare', 'Underground Resistance'),
    c('2', 'Resistance D', 'Electronic Warfare', 'Some Label'),
  ],
  correctId: '1',
});

test('X: single keyword', 'Generic single word title needs artist + label', {
  vision: { artist: 'Surgeon', title: 'Magneze', label: 'Downwards' },
  candidates: [
    c('1', 'Surgeon', 'Magneze', 'Downwards'),
    c('2', 'Surgeon', 'Badger Bite', 'Downwards'),
    c('3', 'Various', 'Magneze', 'Other'),
  ],
  correctId: '1',
});

test('X: single keyword', 'Title word is common — artist is the only reliable signal', {
  vision: { artist: 'Drexciya', title: 'Journey', label: null },
  candidates: [
    c('1', 'Drexciya', 'Journey of the Deep Sea Dweller', 'Clone'),
    c('2', 'Various', 'Journey', 'Some Compilations'),
    c('3', 'Drexciya', 'Neptune\'s Lair', 'Tresor'),
  ],
  correctId: '1',
});

// ─── Category Y: Format / pressing info in fields ─────────────────────────────

test('Y: format as title', '"12 Inch" printed on label read as title', {
  vision: { artist: 'Juan Atkins', title: '12 Inch', label: 'Metroplex' },
  candidates: [
    c('1', 'Juan Atkins', 'Skyway', 'Metroplex'),
    c('2', 'Model 500', 'Off To Battle', 'Metroplex'),
  ],
  correctId: '1',
});

test('Y: format as title', '"EP" only as title — too short, artist + label decide', {
  vision: { artist: 'Bicep', title: 'EP', label: 'Feel My Bicep' },
  candidates: [
    c('1', 'Bicep', 'Feel My Bicep EP', 'Feel My Bicep'),
    c('2', 'Bicep', 'Glue', 'Feel My Bicep'),
  ],
  correctId: '1',
});

test('Y: format as title', '"Original Mix" as title — subtitle leaked into title field', {
  vision: { artist: 'Floorplan', title: 'Original Mix', label: null },
  candidates: [
    c('1', 'Floorplan', 'Never Grow Old', 'Motor City Drum Ensemble'),
    c('2', 'Floorplan', 'Paradise', 'Motor City Drum Ensemble'),
  ],
  correctId: '1',
});

test('Y: format as title', '"White Label" printed as title', {
  vision: { artist: 'Surgeon', title: 'White Label', label: 'Downwards' },
  candidates: [
    c('1', 'Surgeon', 'Force + Form', 'Downwards'),
    c('2', 'Regis', 'Gymnastics', 'Downwards'),
  ],
  correctId: '1',
});

test('Y: format as title', '"Maxi Single" as title with correct artist', {
  vision: { artist: 'Daft Punk', title: 'Maxi Single', label: 'Virgin' },
  candidates: [
    c('1', 'Daft Punk', 'Da Funk', 'Virgin'),
    c('2', 'Daft Punk', 'Around the World', 'Virgin'),
  ],
  correctId: '1',
});

test('Y: format as title', 'RPM marking "45 RPM" as title, label strong', {
  vision: { artist: '', title: '45 RPM', label: 'Trax Records' },
  candidates: [
    c('1', 'Larry Heard', 'Can You Feel It', 'Trax Records'),
    c('2', 'Various', 'Trax Sampler', 'Not Trax'),
  ],
  correctId: '1',
});

// ─── Category Z: Multi-field degradation ──────────────────────────────────────

test('Z: multi-field degraded', 'Truncated artist + truncated title — substring includes still wins', {
  vision: { artist: 'Aphex', title: 'Selected Ambient', label: 'Warp' },
  candidates: [
    c('1', 'Aphex Twin', 'Selected Ambient Works Volume II', 'Warp Records'),
    c('2', 'Aphex Twin', 'Selected Ambient Works 85-92', 'Warp Records'),
    c('3', 'Various', 'Selected Ambient', 'Warp Records'),
  ],
  correctId: '1',  // "Aphex Twin" includes "Aphex" (0.8 -> +4) beats "Various" (0 -> -3); tied with '2', stable sort picks first
});

test('Z: multi-field degraded', 'OCR error in artist + partial title — title sim barely passes', {
  vision: { artist: 'Bur1al', title: 'Archangel', label: 'Hyperdub' },
  candidates: [
    c('1', 'Burial', 'Archangel', 'Hyperdub'),
    c('2', 'Various', 'Archangel', 'Hyperdub'),
  ],
  correctId: '1',
});

test('Z: multi-field degraded', 'Track title + empty artist + correct label', {
  vision: { artist: '', title: 'Gamma Player', label: 'Axis' },
  candidates: [
    c('1', 'Jeff Mills', 'Gamma Player', 'Axis'),
    c('2', 'Jeff Mills', 'The Bells', 'Axis'),
  ],
  correctId: '1',
});

test('Z: multi-field degraded', 'Only label readable — no artist no title', {
  vision: { artist: '', title: '', label: 'Tresor' },
  candidates: [
    c('1', 'Surgeon', 'Force + Form', 'Tresor'),
    c('2', 'Various', 'Tresor Compilation', 'Not Tresor'),
  ],
  correctId: '1',
});

test('Z: multi-field degraded', 'Artist and title completely swapped — known limitation, triggers fallback', {
  vision: { artist: 'Strings of Life', title: 'Rhythim Is Rhythim', label: 'Transmat' },
  candidates: [
    c('1', 'Rhythim Is Rhythim', 'Strings of Life', 'Transmat'),
    c('2', 'Derrick May', 'Strings of Life', 'Transmat'),
  ],
  correctId: null,
  expectFallback: true,  // swapped fields: every candidate scores -3 (artist cross-match); allBad triggers fallback
});

test('Z: multi-field degraded', 'Year text mixed into title field', {
  vision: { artist: 'Plastikman', title: 'Spastik 1993', label: null },
  candidates: [
    c('1', 'Plastikman', 'Spastik', 'Novamute'),
    c('2', 'Plastikman', 'Spastik 1993 Edition', 'Novamute'),
  ],
  correctId: '1',
});

test('Z: multi-field degraded', 'Everything slightly off but correct candidate still best', {
  vision: { artist: 'Basik Channel', title: 'Phylyps Track', label: 'Basik' },
  candidates: [
    c('1', 'Basic Channel', 'Phylyps Trak', 'Basic Channel'),
    c('2', 'Basic Channel', 'Enforcement', 'Basic Channel'),
    c('3', 'Various', 'Phylyps Trak Remixes', 'Basic Channel'),
  ],
  correctId: '1',
});

test('Z: multi-field degraded', 'All fields empty — no signal, no fallback triggered', {
  vision: { artist: '', title: '', label: null },
  candidates: [
    c('1', 'Aphex Twin', 'Drukqs', 'Warp Records'),
  ],
  correctId: '1',
  expectFallback: false,
});

// ─── Results ──────────────────────────────────────────────────────────────────

const total = passed + failed;
console.log('\n='.repeat(70));
console.log(`SCAN SCORING TEST  —  ${total} scenarios`);
console.log('='.repeat(70));
console.log(`  PASS ${passed}/${total}   FAIL ${failed}/${total}\n`);

console.log('Category breakdown:');
for (const [cat, { pass, fail }] of Object.entries(CATEGORIES)) {
  const pct = Math.round(100 * pass / (pass + fail));
  const bar = '█'.repeat(Math.round(pct / 5)) + '░'.repeat(20 - Math.round(pct / 5));
  console.log(`  ${bar} ${pct.toString().padStart(3)}%  ${cat}  (${pass}/${pass + fail})`);
}

if (failures.length > 0) {
  console.log('\n' + '-'.repeat(70));
  console.log('FAILURES:\n');
  for (const f of failures) {
    console.log(`[${f.category}] ${f.description}`);
    console.log(`  Vision:   artist="${f.vision.artist}"  title="${f.vision.title}"  label="${f.vision.label}"`);
    console.log(`  Expected: ${f.expected}`);
    console.log(`  Got:      ${f.got}`);
    console.log(`  Score of expected candidate: ${f.correctScore}`);
    console.log(`  Score of top result:         ${f.topScore}`);
    console.log();
  }
}
console.log('='.repeat(70) + '\n');
