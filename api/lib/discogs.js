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

  const batches = await Promise.all(
    [...urls].map(async url => {
      try {
        const res = await fetchWithRetry(url, { headers });
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
  // 1 retry max: the search fan-out already uses quota, so limit backoff to 1s
  // rather than the default 7s (1+2+4) which is the main cause of "pulling data" hangs.
  const res = await fetchWithRetry(`${BASE}/releases/${id}`, { headers }, 1);
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

export async function fetchDiscogsPrice(releaseId) {
  const headers = authHeaders();

  // Discogs has no public endpoint that lists individual marketplace listings
  // with their conditions, so the old marketplace/search call never returned
  // condition data (it 404s and we fell back to stats, which only has a floor
  // price + listing count). Instead we use two real endpoints:
  //   price_suggestions/{id} -- a suggested price per condition grade
  //   stats/{id}             -- live listing count + lowest active price
  const [suggestRes, statsRes] = await Promise.all([
    fetchWithRetry(`${BASE}/marketplace/price_suggestions/${releaseId}`, { headers }),
    fetchWithRetry(`${BASE}/marketplace/stats/${releaseId}`, { headers }),
  ]);

  // price_suggestions returns { "Near Mint (NM or M-)": { currency, value }, ... }
  // keyed by the same condition names the PriceGraph expects.
  const byCondition = {};
  let currency = null;
  if (suggestRes && suggestRes.ok) {
    const suggestions = await suggestRes.json();
    for (const [cond, info] of Object.entries(suggestions || {})) {
      const val = info && info.value;
      if (typeof val !== 'number' || val <= 0) continue;
      byCondition[cond] = { avg: Math.round(val * 100) / 100, count: 0 };
      if (!currency && info.currency) currency = info.currency;
    }
  } else if (suggestRes) {
    console.log('price_suggestions failed:', suggestRes.status);
  }

  // stats gives the headline listing count and floor price.
  let totalListings = 0;
  let low = null;
  if (statsRes && statsRes.ok) {
    const stats = await statsRes.json();
    totalListings = stats.num_for_sale || 0;
    if (stats.lowest_price) {
      low = stats.lowest_price.value;
      if (!currency) currency = stats.lowest_price.currency;
    }
  }

  const condVals = Object.values(byCondition).map(c => c.avg).sort((a, b) => a - b);

  // Nothing usable from either endpoint.
  if (condVals.length === 0 && totalListings === 0 && low == null) return null;

  const median = condVals.length ? condVals[Math.floor(condVals.length / 2)] : null;
  const mean = condVals.length
    ? Math.round((condVals.reduce((s, p) => s + p, 0) / condVals.length) * 100) / 100
    : null;
  const high = condVals.length ? condVals[condVals.length - 1] : null;
  if (low == null && condVals.length) low = condVals[0];

  return {
    currency: currency || 'USD',
    median,
    mean,
    low: low != null ? Math.round(low * 100) / 100 : null,
    high,
    sampleSize: condVals.length || null,
    totalListings,
    byCondition,
  };
}
