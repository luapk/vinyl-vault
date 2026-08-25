import { searchDiscogs } from './lib/discogs.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.DISCOGS_PERSONAL_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Discogs not configured', matches: [] });
  }

  const { artist, title, catalogNumber, country } = req.body || {};

  // meta carries Discogs's own rate-limit state back out of the search. A
  // caller has to be able to tell "Discogs would not answer" from "no such
  // record": the file import saves an unmatched row as a draft, so a 429
  // reported as an empty result files the record as unidentifiable.
  const meta = { rateLimited: false, remaining: null, requests: 0 };

  try {
    const matches = await searchDiscogs({ artist, title, catalogNumber, country, manual: true, meta });
    if (!matches.length && meta.rateLimited) {
      return res.status(429).json({
        error: 'Discogs rate limit reached', rateLimited: true,
        remaining: meta.remaining ?? 0, requests: meta.requests, matches: [],
      });
    }
    // remaining and requests are what let a long run pace itself off the real
    // budget: a row that matches costs one request, a row that misses costs
    // two, and a caller that assumes one falls behind the limit.
    return res.status(200).json({ matches, remaining: meta.remaining, requests: meta.requests });
  } catch (err) {
    return res.status(500).json({ error: err.message, matches: [] });
  }
}
