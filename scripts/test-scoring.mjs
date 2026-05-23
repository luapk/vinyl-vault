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

// The auto-select & fallback thresholds from scan.js
const AUTO_SELECT_SOLE = -1;  // if soleScore < this AND vision has info -> visionFallback
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
