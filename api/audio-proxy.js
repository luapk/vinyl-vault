export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Only proxy known audio preview CDNs
  const allowed = [
    'https://audio-ssl.itunes.apple.com/',
    'https://a1.mzstatic.com/',
    'https://p.scdn.co/',
  ];
  if (!allowed.some(prefix => url.startsWith(prefix))) {
    return res.status(400).json({ error: 'URL not allowed' });
  }

  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'VinylVault/1.0' },
    });
    if (!upstream.ok) return res.status(502).json({ error: 'Upstream error' });

    const ct = upstream.headers.get('content-type') || 'audio/mpeg';

    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const cc = upstream.headers.get('cache-control');
    if (cc) res.setHeader('Cache-Control', cc);
    const { Readable } = await import('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
    return;
  }
}
