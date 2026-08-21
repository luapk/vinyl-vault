import { describe, it, expect, vi, afterEach } from 'vitest';
import handler from '../audio-proxy.js';

// Minimal stand-in for the Vercel res object: records what the handler did.
function mockRes() {
  const res = {
    statusCode: null, body: null, headers: {}, ended: false,
    status(code) { res.statusCode = code; return res; },
    json(payload) { res.body = payload; res.ended = true; return res; },
    setHeader(k, v) { res.headers[k.toLowerCase()] = v; },
    end() { res.ended = true; return res; },
    on() {}, once() {}, emit() {}, write() { return true; },
  };
  return res;
}

const call = (url, method = 'GET') => {
  const res = mockRes();
  return handler({ method, query: url === undefined ? {} : { url } }, res).then(() => res);
};

afterEach(() => { vi.unstubAllGlobals(); });

const upstream = (status, { body = null } = {}) =>
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    body,
    headers: { get: () => null },
  })));

describe('audio-proxy request guards', () => {
  it('rejects a missing url', async () => {
    expect((await call(undefined)).statusCode).toBe(400);
  });

  it('rejects anything outside the allowed preview CDNs', async () => {
    // The allowlist is an SSRF guard, so this must stay closed.
    for (const bad of [
      'https://evil.example.com/x.mp3',
      'http://p.scdn.co/mp3-preview/x',            // plain http
      'https://dzcdn.net.evil.com/x.mp3',          // suffix lookalike
      'https://p.scdn.co.evil.com/x.mp3',
      'not a url',
    ]) {
      const res = await call(bad);
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it('allows the real preview hosts', async () => {
    upstream(404); // reached the fetch, so the allowlist let it through
    for (const good of [
      'https://p.scdn.co/mp3-preview/abc',
      'https://audio-ssl.itunes.apple.com/x.m4a',
      'https://cdns-preview-3.dzcdn.net/stream/abc.mp3',
    ]) {
      const res = await call(good);
      expect(res.statusCode, good).not.toBe(400);
    }
  });
});

describe('audio-proxy upstream status mapping', () => {
  const URL_OK = 'https://p.scdn.co/mp3-preview/abc';

  it('reports an expired or withdrawn preview as 404, not 502', async () => {
    // This is what fired the alert: a dead preview link is a missing
    // resource, and calling it a gateway failure made it a platform error.
    for (const code of [403, 404, 410]) {
      upstream(code);
      const res = await call(URL_OK);
      expect(res.statusCode, `upstream ${code}`).toBe(404);
    }
  });

  it('still reports a genuinely broken upstream as 502', async () => {
    for (const code of [500, 502, 503]) {
      upstream(code);
      const res = await call(URL_OK);
      expect(res.statusCode, `upstream ${code}`).toBe(502);
    }
  });

  it('does not try to pipe a 200 with no body', async () => {
    upstream(200, { body: null });
    const res = await call(URL_OK);
    expect(res.statusCode).toBe(404);
  });

  it('reports a hung CDN as 504 rather than an unexplained 500', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const e = new Error('The operation was aborted due to timeout');
      e.name = 'TimeoutError';
      throw e;
    }));
    const res = await call(URL_OK);
    expect(res.statusCode).toBe(504);
  });

  it('rejects non-GET', async () => {
    expect((await call('https://p.scdn.co/x', 'POST')).statusCode).toBe(405);
  });
});
