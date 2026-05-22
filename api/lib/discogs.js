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

export async function searchDiscogs({ catalogNumber, artist, title }) {
  const headers = authHeaders();

  let url;
  if (catalogNumber) {
    url = `${BASE}/database/search?catno=${encodeURIComponent(catalogNumber)}&type=release&per_page=5`;
  } else {
    const params = new URLSearchParams({ type: 'release', per_page: '5' });
    if (artist) params.set('artist', artist);
    if (title) params.set('release_title', title);
    url = `${BASE}/database/search?${params}`;
  }

  const res = await fetchWithRetry(url, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Discogs search ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  let results = data.results || [];

  // Cat# search returned nothing: fall back to artist+title
  if (catalogNumber && results.length === 0 && (artist || title)) {
    return searchDiscogs({ artist, title });
  }

  return results.slice(0, 5).map(r => {
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

  const primaryImage =
    r.images?.find(img => img.type === 'primary')?.uri ||
    r.images?.[0]?.uri ||
    null;

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
    tracklist,
    coverUrl: primaryImage,
  };
}
