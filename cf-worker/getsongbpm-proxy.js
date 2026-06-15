// Cloudflare Worker: proxy for api.getsongbpm.com
// Vercel runs on AWS IPs which are blocked by Cloudflare Bot Management on getsongbpm.com.
// CF edge IPs are not blocked, so this worker forwards requests transparently.
//
// Deploy:
//   1. Go to https://dash.cloudflare.com → Workers & Pages → Create Worker
//   2. Paste this file, click Deploy
//   3. Copy the worker URL (e.g. https://getsongbpm-proxy.yourname.workers.dev)
//   4. Add GETSONGBPM_PROXY_URL=<worker-url> to your Vercel environment variables

export default {
  async fetch(req) {
    const url = new URL(req.url);
    const target = 'https://api.getsongbpm.com' + url.pathname + url.search;
    try {
      const resp = await fetch(target, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
          'Accept': 'application/json',
          'Referer': 'https://getsongbpm.com/',
        },
      });
      const body = await resp.text();
      return new Response(body, {
        status: resp.status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
};
