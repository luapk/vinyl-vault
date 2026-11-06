import { requireAuth } from './lib/auth.js';
import { requireTier } from './lib/tier.js';

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

function stripArtistSuffix(name) {
  return name.replace(/\s*\(\d+\)\s*$/, '').trim();
}

function mapRelease(item) {
  const info = item.basic_information || {};

  const artist = (info.artists || [])
    .map(a => stripArtistSuffix(a.name || ''))
    .join(', ');

  const labelObj = (info.labels || [])[0] || {};
  const label = labelObj.name || null;
  const rawCatno = labelObj.catno || null;
  const catalogNumber = rawCatno && rawCatno.toLowerCase() !== 'none' ? rawCatno : null;

  const format = (info.formats || []).map(f => f.name).filter(Boolean).join(', ') || null;

  const genres = [
    ...(info.genres || []),
    ...(info.styles || []),
  ];

  const coverUrl = info.cover_image || info.thumb || null;

  return {
    discogsId: String(info.id),
    artist,
    title: info.title || '',
    label,
    catalogNumber,
    year: info.year || null,
    format,
    genres,
    tags: [...genres],
    coverUrl,
    tracklist: [],
    identified: true,
    confidence: 'high',
    source: 'discogs_import',
    notes: '',
    mediaCondition: '',
    sleeveCondition: '',
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Pulling somebody's collection is a paged walk of the Discogs API: a 900
  // record collection is nine requests against the 60-a-minute budget that
  // everyone's live scanning shares. That is third-party quota, so the gate
  // belongs here and not on the button -- this endpoint shipped with no auth
  // at all, which made the username in the query string the only thing
  // standing between an anonymous caller and the whole rate limit.
  const user = await requireAuth(req, res);
  if (!user) return;
  if (!(await requireTier('bulkImport', user.id, res))) return;

  if (!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Discogs not configured' });
  }

  const { username, page = '1' } = req.query || {};
  if (!username) return res.status(400).json({ error: 'username is required' });

  const pageNum = parseInt(page, 10) || 1;
  const url = `${BASE}/users/${encodeURIComponent(username)}/collection/folders/0/releases?page=${pageNum}&per_page=100&sort=added&sort_order=desc`;

  try {
    const fetchRes = await fetch(url, { headers: authHeaders() });

    if (fetchRes.status === 404) {
      return res.status(404).json({ error: 'Discogs user not found' });
    }
    if (fetchRes.status === 403) {
      return res.status(403).json({ error: 'This collection is private. Go to Discogs > Settings > Privacy and set your collection to Public.' });
    }
    if (!fetchRes.ok) {
      return res.status(fetchRes.status).json({ error: `Discogs error ${fetchRes.status}` });
    }

    const data = await fetchRes.json();
    const pagination = data.pagination || {};
    const releases = (data.releases || []).map(mapRelease);

    return res.status(200).json({
      records: releases,
      page: pagination.page || pageNum,
      pages: pagination.pages || 1,
      total: pagination.items || releases.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
