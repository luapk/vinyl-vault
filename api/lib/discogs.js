const BASE = 'https://api.discogs.com';
const UA = 'VinylVault/1.0';

function authHeaders() {
  const token = process.env.DISCOGS_PERSONAL_ACCESS_TOKEN;
  if (!token) throw new Error('DISCOGS_PERSONAL_ACCESS_TOKEN not configured');
  return {
    Authorization: `Discogs token=${token}`,
    'User-Agent': UA,
    Accept: 'application/json',
  };
}

// Per-request read timeout. Without this, a Discogs response that is slow but
// never errors (no 429, just hanging) blocks indefinitely -- the main cause of
// the "pulling release data" hang, since fetchWithRetry only retried on 429 and
// had no ceiling on a slow-but-200 response.
async function fetchWithRetry(url, opts, maxRetries = 3, timeoutMs = 6000) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    let res;
    try {
      res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      // Timeout/abort: don't keep waiting -- on the last attempt surface it,
      // otherwise fall through to the backoff and retry.
      if (attempt === maxRetries) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
      continue;
    }
    if (res.status !== 429 || attempt === maxRetries) return res;
    await new Promise(r => setTimeout(r, delay));
    delay *= 2;
  }
}

function parseDiscogsTitle(combined) {
  const idx = combined.indexOf(' - ');
  if (idx === -1) return { artist: '', recordTitle: combined };
  return { artist: combined.slice(0, idx), recordTitle: combined.slice(idx + 3) };
}

function buildSearchUrl(params) {
  return `${BASE}/database/search?${new URLSearchParams({ type: 'release', per_page: '5', ...params })}`;
}

export async function searchDiscogs({ catalogNumber, artist, title, label, rawText, manual = false }) {
  const headers = authHeaders();

  // Run search strategies in parallel. Vision sometimes misassigns fields
  // (e.g. track title read as label name), so image scans try multiple interpretations.
  // Manual searches (user-typed fields) use a smaller targeted set to preserve
  // Discogs rate-limit quota for the subsequent fetchDiscogsRelease detail fetch.
  const urls = new Set();

  if (catalogNumber) {
    // Broad catno-only search (may return false collisions from other labels)
    urls.add(`${BASE}/database/search?catno=${encodeURIComponent(catalogNumber)}&type=release&per_page=5`);
    // Normalised variants: strip/replace separators so "PM012" finds "PM-012"
    const stripped = catalogNumber.replace(/[\s\-\.]/g, '');
    const dashed = catalogNumber.replace(/[\s\.]/g, '-');
    for (const variant of new Set([stripped, dashed])) {
      if (variant !== catalogNumber) {
        urls.add(`${BASE}/database/search?catno=${encodeURIComponent(variant)}&type=release&per_page=5`);
      }
    }
    // Combined catno + artist: much more targeted, avoids cross-label collisions
    if (artist) {
      urls.add(`${BASE}/database/search?catno=${encodeURIComponent(catalogNumber)}&artist=${encodeURIComponent(artist)}&type=release&per_page=5`);
    }
  }
  if (artist && title) {
    urls.add(buildSearchUrl({ artist, release_title: title }));
  }
  // Loose fallbacks: only needed for image scans where Vision may misidentify fields.
  // Skip for manual searches -- the user typed explicit values, so field confusion
  // doesn't apply, and the extra requests needlessly eat rate-limit quota.
  if (!manual) {
    if (title) {
      urls.add(buildSearchUrl({ release_title: title }));
    }
    if (label && title) {
      urls.add(buildSearchUrl({ label, release_title: title }));
    }
    if (artist && title && artist !== label) {
      // Treat Vision's "artist" as a label — catches label/artist/title confusion
      urls.add(buildSearchUrl({ label: artist, release_title: title }));
    }
    // Mine rawText for catno-like patterns as independent catno searches, but only
    // when no structured catalogue number was read -- a confident structured catno
    // (plus its variants above) already covers that case, and dense OCR text can
    // otherwise yield a dozen-plus false catno tokens (publisher codes, years),
    // each firing its own Discogs query and tripping the rate limiter. Cap the
    // remaining candidates so the request fan-out stays small.
    if (rawText && !catalogNumber) {
      const catnoPattern = /\b([A-Z]{1,5}[\s\-]?\d{2,4}[A-Z]?)\b/g;
      const rawCatnos = [...new Set([...rawText.matchAll(catnoPattern)].map(m => m[1]))].slice(0, 3);
      for (const c of rawCatnos) {
        urls.add(`${BASE}/database/search?catno=${encodeURIComponent(c)}&type=release&per_page=5`);
        const stripped = c.replace(/[\s\-]/g, '');
        if (stripped !== c) {
          urls.add(`${BASE}/database/search?catno=${encodeURIComponent(stripped)}&type=release&per_page=5`);
        }
      }
    }
  }

  // Fuzzy: for image scans, rawText is the verbatim OCR -- more reliable than
  // reassembled fields Vision may have misidentified. Trim to 80 chars to keep
  // the query focused. For manual searches, fall back to joined fields only when
  // no catno is present (catno searches already cover the targeted case).
  const fuzzyQ = (rawText ? rawText.slice(0, 80).trim() : '') || [artist, title, label].filter(Boolean).join(' ');
  if (fuzzyQ && (!manual || !catalogNumber)) {
    urls.add(buildSearchUrl({ q: fuzzyQ }));
  }

  // Title-keyword fallback: only for image scans where artist field may be unreliable.
  if (!manual && title && (!artist || artist === label)) {
    urls.add(buildSearchUrl({ q: title }));
  }

  // 5s timeout + 1 retry for search: Discogs responses regularly arrive in the
  // 3-5s range, so 3s was cutting off valid responses. 5s keeps failure fast
  // while catching the long tail. Worst case per URL: 5+1+5 = 11s, but all
  // URLs run in parallel so the batch ceiling stays ~11s.
  const batches = await Promise.all(
    [...urls].map(async url => {
      try {
        const res = await fetchWithRetry(url, { headers }, 1, 5000);
        if (!res.ok) return [];
        const data = await res.json();
        return data.results || [];
      } catch {
        return [];
      }
    })
  );

  // Merge and deduplicate — earlier strategies (catNo first) win on ordering
  const seen = new Set();
  const merged = [];
  for (const batch of batches) {
    for (const r of batch) {
      if (!seen.has(r.id)) {
        seen.add(r.id);
        merged.push(r);
      }
    }
  }

  // Slice to 15: broad catno searches can return up to 5 wrong-label collisions,
  // which would crowd out correct releases from targeted searches if we sliced to 5.
  return merged.slice(0, 15).map(r => {
    const { artist: a, recordTitle } = parseDiscogsTitle(r.title || '');
    return {
      id: String(r.id),
      masterId: r.master_id ? String(r.master_id) : null,
      artist: a,
      recordTitle,
      label: Array.isArray(r.label) ? r.label[0] : (r.label || null),
      catalogNumber: r.catno || null,
      year: r.year ? parseInt(r.year, 10) : null,
      country: r.country || null,
      format: Array.isArray(r.format) ? r.format.join(', ') : (r.format || null),
      coverUrl: r.cover_image || null,
    };
  });
}

export async function fetchDiscogsRelease(id) {
  const headers = authHeaders();
  // 1 retry, 4s timeout: keeps the "pulling data" screen fast even if Discogs
  // is slow. The search fan-out already used most quota, so stay conservative.
  const res = await fetchWithRetry(`${BASE}/releases/${id}`, { headers }, 1, 4000);
  if (!res.ok) throw new Error(`Discogs release fetch ${res.status}`);

  const r = await res.json();

  const artistName = (r.artists || [])
    .map(a => a.name.replace(/\s*\(\d+\)$/, '').trim())
    .join(', ');

  const label = r.labels?.[0]?.name || null;
  const catalogNumber = r.labels?.[0]?.catno || null;

  const tracklist = (r.tracklist || [])
    .filter(t => !t.type_ || t.type_ === 'track')
    .map(t => ({
      position: t.position || '',
      title: t.title || '',
      duration: t.duration || null,
    }));

  const images = (r.images || []).map(img => img.uri).filter(Boolean);
  const primaryImage = r.images?.find(img => img.type === 'primary')?.uri || images[0] || null;

  return {
    id: String(r.id),
    masterId: r.master_id ? String(r.master_id) : null,
    artist: artistName,
    title: r.title || '',
    label,
    catalogNumber,
    year: r.year || null,
    country: r.country || null,
    format: (r.formats || []).map(f => f.name).join(', ') || null,
    genres: [...(r.genres || []), ...(r.styles || [])],
    topGenres: r.genres || [],
    tracklist,
    coverUrl: primaryImage,
    images,
  };
}

// Discogs suggestion keys -> the short grade codes the app stores in
// mediaCondition (CONDITION_GRADES in the UI).
const SUGGESTION_GRADES = [
  ['Mint (M)', 'M'],
  ['Near Mint (NM or M-)', 'NM'],
  ['Very Good Plus (VG+)', 'VG+'],
  ['Very Good (VG)', 'VG'],
  ['Good Plus (G+)', 'G+'],
  ['Good (G)', 'G'],
  ['Fair (F)', 'F'],
  ['Poor (P)', 'P'],
];

export async function fetchDiscogsPrice(releaseId) {
  const headers = authHeaders();

  // Three layers, so something always comes back:
  //   1. price_suggestions/{id} -- Discogs' own per-condition price estimates,
  //      derived from real sales history. Needs the token's account to have
  //      marketplace seller settings enabled, and the release to have sold.
  //   2. marketplace/stats/{id} -- live listing count + lowest active price.
  //   3. releases/{id}          -- lowest_price/num_for_sale fallback when the
  //      stats endpoint itself fails.
  const [suggestRes, statsRes] = await Promise.all([
    fetchWithRetry(`${BASE}/marketplace/price_suggestions/${releaseId}`, { headers }),
    fetchWithRetry(`${BASE}/marketplace/stats/${releaseId}`, { headers }),
  ]);

  // Layer 1: per-condition ladder, ordered best grade first.
  const conditions = [];
  let currency = null;
  let suggestionsStatus = 'error';
  if (suggestRes && suggestRes.ok) {
    const suggestions = await suggestRes.json().catch(() => null);
    for (const [key, grade] of SUGGESTION_GRADES) {
      const val = suggestions?.[key]?.value;
      if (typeof val !== 'number' || val <= 0) continue;
      conditions.push({ grade, value: Math.round(val * 100) / 100 });
      if (!currency && suggestions[key].currency) currency = suggestions[key].currency;
    }
    suggestionsStatus = conditions.length ? 'ok' : 'empty';
  } else if (suggestRes) {
    // 401/403/404: token account lacks seller settings, or no sales history.
    suggestionsStatus = `http_${suggestRes.status}`;
    console.log(`[price] price_suggestions ${suggestRes.status} for release ${releaseId}`);
  }

  // Layer 2: floor price + listing count.
  let totalListings = 0;
  let floor = null;
  let statsOk = false;
  if (statsRes && statsRes.ok) {
    const stats = await statsRes.json().catch(() => null);
    if (stats) {
      statsOk = true;
      totalListings = stats.num_for_sale || 0;
      if (stats.lowest_price?.value != null) {
        floor = {
          value: Math.round(stats.lowest_price.value * 100) / 100,
          currency: stats.lowest_price.currency || currency || 'USD',
        };
      }
    }
  }

  // Layer 3: the release document carries the same floor data; use it only
  // when the stats endpoint failed outright.
  if (!statsOk) {
    try {
      const relRes = await fetchWithRetry(`${BASE}/releases/${releaseId}`, { headers }, 1, 5000);
      if (relRes && relRes.ok) {
        const rel = await relRes.json();
        totalListings = rel.num_for_sale || 0;
        if (rel.lowest_price != null && rel.lowest_price > 0) {
          floor = {
            value: Math.round(rel.lowest_price * 100) / 100,
            currency: currency || 'USD',
          };
        }
      }
    } catch { /* keep whatever we have */ }
  }

  if (!conditions.length && !floor && !totalListings) return null;

  return {
    currency: currency || floor?.currency || 'USD',
    conditions,
    suggestionsStatus,
    floor,
    totalListings,
    checkedAt: Date.now(),
  };
}
