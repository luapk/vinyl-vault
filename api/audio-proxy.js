export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url required' });

  // Only proxy known audio preview CDNs. Deezer preview hosts are numbered
  // (cdns-preview-3.dzcdn.net, cdnt-preview.dzcdn.net, ...) so they are
  // matched by hostname suffix rather than URL prefix.
  const allowedPrefixes = [
    'https://audio-ssl.itunes.apple.com/',
    'https://a1.mzstatic.com/',
    'https://p.scdn.co/',
  ];
  const isAllowed = (u) => {
    if (allowedPrefixes.some(prefix => u.startsWith(prefix))) return true;
    try {
      const parsed = new URL(u);
      return parsed.protocol === 'https:' &&
        (parsed.hostname === 'dzcdn.net' || parsed.hostname.endsWith('.dzcdn.net'));
    } catch {
      return false;
    }
  };
  if (!isAllowed(url)) {
    return res.status(400).json({ error: 'URL not allowed' });
  }

  try {
    // Bounded: a CDN that never answers would otherwise hold the function
    // open for its whole duration and fail as a platform 502.
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'VinylVault/1.0' },
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      // A preview that has expired or been withdrawn answers 403/404. That is
      // a missing resource, not a gateway fault, and calling it 502 turned an
      // ordinary dead link into a platform error alert. 5xx upstream stays
      // 502, which is what that status is actually for.
      const status = upstream.status >= 400 && upstream.status < 500 ? 404 : 502;
      return res.status(status).json({ error: 'Preview unavailable', upstream: upstream.status });
    }

    // A 200 with no body cannot be piped; Readable.fromWeb(null) would throw
    // after the headers had already gone out.
    if (!upstream.body) return res.status(404).json({ error: 'Preview unavailable' });

    const ct = upstream.headers.get('content-type') || 'audio/mpeg';

    res.setHeader('Content-Type', ct);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    const cc = upstream.headers.get('cache-control');
    if (cc) res.setHeader('Cache-Control', cc);
    const { Readable } = await import('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    // The timeout above lands here as TimeoutError/AbortError.
    const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
    res.status(timedOut ? 504 : 500).json({ error: timedOut ? 'Upstream timed out' : err.message });
    return;
  }
}
