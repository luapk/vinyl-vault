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

async function fetchWithRetry(url, opts, maxRetries = 3) {
  let delay = 1000;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts);
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

export async function searchDiscogs({ catalogNumber, artist, title, label, rawText }) {
  const headers = authHeaders();

  // Run every plausible strategy in parallel. Vision sometimes misassigns fields
  // (e.g. track title read as label name), so we try multiple interpretations.
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
  if (title) {
    // Title-only: catches cases where artist is empty (mix credit misread as artist)
    // or when artist field is wrong but title is correct.
    urls.add(buildSearchUrl({ release_title: title }));
  }
  if (label && title) {
    urls.add(buildSearchUrl({ label, release_title: title }));
  }
  if (artist && title && artist !== label) {
    // Treat Vision's "artist" as a label — catches label/artist/title confusion
    urls.add(buildSearchUrl({ label: artist, release_title: title }));
  }
  // Extract every catno-like pattern from rawText as independent catno searches.
  // This catches cases where Vision OCR'd the catalogue number wrong in the
  // catalogNumber field but transcribed it correctly (or differently) in rawText.
  if (rawText) {
    const catnoPattern = /\b([A-Z]{1,5}[\s\-]?\d{2,4}[A-Z]?)\b/g;
    const rawCatnos = [...rawText.matchAll(catnoPattern)].map(m => m[1]);
    for (const c of rawCatnos) {
      if (c !== catalogNumber) {
        urls.add(`${BASE}/database/search?catno=${encodeURIComponent(c)}&type=release&per_page=5`);
        const stripped = c.replace(/[\s\-]/g, '');
        if (stripped !== c) {
          urls.add(`${BASE}/database/search?catno=${encodeURIComponent(stripped)}&type=release&per_page=5`);
        }
      }
    }
  }

  // Fuzzy: rawText is the exact transcription of visible text — more reliable than
  // reassembling structured fields that Vision may have misassigned
  const fuzzyQ = rawText || [artist, title, label].filter(Boolean).join(' ');
  if (fuzzyQ) {
    urls.add(buildSearchUrl({ q: fuzzyQ }));
  }

  // Title-keyword fallback: when rawText contains remix suffixes like "c.craig's mind mix",
  // the fuzzy search may bias toward wrong releases. A clean title-only keyword search
  // cuts through that noise.
  if (title && (!artist || artist === label)) {
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

  return merged.slice(0, 5).map(r => {
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
  const res = await fetchWithRetry(`${BASE}/releases/${id}`, { headers });
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

  // Fetch up to 100 active marketplace listings sorted cheapest-first.
  // The IQR method then trims outliers so we get a bell-curve centre.
  const listingsRes = await fetchWithRetry(
    `${BASE}/marketplace/search?release_id=${releaseId}&sort=price&sort_order=asc&per_page=100`,
    { headers }
  );

  if (listingsRes.ok) {
    const data = await listingsRes.json();
    const listings = data.listings || [];

    const prices = listings
      .map(l => l.price?.value)
      .filter(p => typeof p === 'number' && p > 0)
      .sort((a, b) => a - b);

    if (prices.length >= 3) {
      const q1 = prices[Math.floor(prices.length * 0.25)];
      const q3 = prices[Math.floor(prices.length * 0.75)];
      const iqr = q3 - q1;
      const trimmed = prices.filter(p => p >= q1 - 1.5 * iqr && p <= q3 + 1.5 * iqr);
      const median = trimmed[Math.floor(trimmed.length / 2)];
      const mean = Math.round((trimmed.reduce((s, p) => s + p, 0) / trimmed.length) * 100) / 100;
      const currency = listings.find(l => l.price?.currency)?.price?.currency || 'USD';
      return {
        currency,
        median: Math.round(median * 100) / 100,
        mean,
        low: Math.round(trimmed[0] * 100) / 100,
        high: Math.round(trimmed[trimmed.length - 1] * 100) / 100,
        sampleSize: trimmed.length,
        totalListings: listings.length,
      };
    }
  }

  // Fallback: marketplace stats gives at least the floor price
  const statsRes = await fetchWithRetry(`${BASE}/marketplace/stats/${releaseId}`, { headers });
  if (!statsRes.ok) return null;
  const stats = await statsRes.json();
  if (!stats.lowest_price) return null;
  return {
    currency: stats.lowest_price.currency,
    median: null,
    mean: null,
    low: stats.lowest_price.value,
    high: null,
    sampleSize: null,
    totalListings: stats.num_for_sale || 0,
  };
}
