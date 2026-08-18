// Mock Supabase server for the stress / fault-injection suite.
//
// Implements just enough of GoTrue (auth) and PostgREST (rest) for the app,
// with the one behaviour that matters most faithfully modelled: refresh token
// ROTATION with REUSE DETECTION. Refreshing an already-rotated token inside
// the grace window returns the same successor session (like Supabase); using
// it after the grace window revokes the whole session family -- the exact
// mechanism behind the real "session expired" incidents.
//
// Control endpoints (test-only, no auth):
//   POST /__test/reset               -- wipe all state
//   POST /__test/config              -- { graceMs?, expiresIn? }
//   POST /__test/revoke              -- { email } revoke every session family
//   POST /__test/seed-records        -- { email, records: [recordJson] }
//   POST /__test/set-profile         -- { email, username?, isPublic? }
//   GET  /__test/state               -- { records, users, revocations }
import http from 'node:http';

const PORT = Number(process.env.MOCK_SUPABASE_PORT || 8787);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}.c2lnbmF0dXJl`;

// ---- state ------------------------------------------------------------------
let state;
function reset() {
  state = {
    graceMs: 10000,
    expiresIn: 3600,
    // Lock verification: refreshes from windows sharing one session must be
    // SERIALISED. refreshDelayMs widens the window so overlap is detectable;
    // maxRefreshOverlap > 1 means two refreshes were in flight at once.
    refreshDelayMs: 0,
    refreshInFlight: 0,
    maxRefreshOverlap: 0,
    users: new Map(),        // email -> { id, email, password, displayName }
    refreshTokens: new Map(),// token -> { familyId, userId, rotatedAt: ms|null, successor: token|null }
    families: new Map(),     // familyId -> { userId, revoked: bool }
    accessTokens: new Map(), // token -> { userId, familyId, exp: sec }
    records: [],             // { id, user_id, data, created_at }
    revocations: 0,
    counter: 0,
  };
  addUser('jon@test.local', 'test-password-123', 'Jon Day');
  addUser('paul@test.local', 'test-password-123', 'Paul');
}
function addUser(email, password, displayName) {
  const id = `00000000-0000-4000-8000-${String(state.users.size + 1).padStart(12, '0')}`;
  state.users.set(email, { id, email, password, displayName, username: null, isPublic: false });
  return state.users.get(email);
}

// The profile row as the app expects to read it.
function profileJson(u) {
  return {
    id: u.id, email: u.email, role: u.email === 'paul@test.local' ? 'admin' : 'user',
    avatar_url: null, display_name: u.displayName, username: u.username, bio: null,
    is_public: !!u.isPublic, preferences: null, subscription_tier: 'free',
    subscription_status: null, scans_this_period: 0, scans_period_end: null,
  };
}
reset();

// ---- auth helpers -----------------------------------------------------------
function userJson(u) {
  return {
    id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email,
    email_confirmed_at: new Date(0).toISOString(),
    user_metadata: { display_name: u.displayName },
    app_metadata: { provider: 'email' },
    created_at: new Date(0).toISOString(), updated_at: new Date(0).toISOString(),
  };
}

function issueSession(u, familyId = null) {
  if (!familyId) {
    familyId = `fam-${++state.counter}`;
    state.families.set(familyId, { userId: u.id, revoked: false });
  }
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + state.expiresIn;
  const accessToken = jwt({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp, iat: nowSec, session_id: familyId });
  const refreshToken = `rt-${++state.counter}`;
  state.accessTokens.set(accessToken, { userId: u.id, familyId, exp });
  state.refreshTokens.set(refreshToken, { familyId, userId: u.id, rotatedAt: null, successor: null });
  return {
    access_token: accessToken, token_type: 'bearer',
    expires_in: state.expiresIn, expires_at: exp,
    refresh_token: refreshToken, user: userJson(u),
  };
}

function refreshWith(token) {
  const rt = state.refreshTokens.get(token);
  if (!rt) return { status: 400, body: { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' } };
  const family = state.families.get(rt.familyId);
  if (!family || family.revoked) return { status: 400, body: { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Session Revoked' } };
  const user = [...state.users.values()].find(u => u.id === rt.userId);
  if (rt.rotatedAt !== null) {
    // Reuse of an already-rotated token.
    if (Date.now() - rt.rotatedAt <= state.graceMs && rt.successorSession) {
      return { status: 200, body: rt.successorSession }; // grace: same successor
    }
    family.revoked = true; // reuse detection trips: revoke the whole family
    state.revocations++;
    return { status: 400, body: { code: 400, error_code: 'refresh_token_already_used', msg: 'Invalid Refresh Token: Already Used' } };
  }
  const session = issueSession(user, rt.familyId);
  rt.rotatedAt = Date.now();
  rt.successor = session.refresh_token;
  rt.successorSession = session;
  return { status: 200, body: session };
}

function bearerUser(req) {
  const auth = req.headers['authorization'] || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const at = state.accessTokens.get(token);
  if (!at) return null;
  const family = state.families.get(at.familyId);
  if (!family || family.revoked) return null;
  if (at.exp * 1000 < Date.now()) return null;
  return [...state.users.values()].find(u => u.id === at.userId) || null;
}

// ---- http plumbing ----------------------------------------------------------
function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS,HEAD');
  res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, range, x-upsert');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Supabase-Api-Version');
}
function send(res, status, body, headers = {}) {
  cors(res);
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
}
const q = (url, name) => url.searchParams.get(name);
const eqValue = (url, col) => {
  const v = q(url, col);
  return v && v.startsWith('eq.') ? v.slice(3) : null;
};

// ---- server -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }

  // ---- control --------------------------------------------------------------
  if (path === '/__test/reset') { reset(); return send(res, 200, { ok: true }); }
  if (path === '/__test/config') {
    const body = await readBody(req);
    if (body.graceMs !== undefined) state.graceMs = body.graceMs;
    if (body.expiresIn !== undefined) state.expiresIn = body.expiresIn;
    if (body.refreshDelayMs !== undefined) state.refreshDelayMs = body.refreshDelayMs;
    return send(res, 200, { graceMs: state.graceMs, expiresIn: state.expiresIn, refreshDelayMs: state.refreshDelayMs });
  }
  if (path === '/__test/revoke') {
    const body = await readBody(req);
    const u = state.users.get(body.email);
    let n = 0;
    for (const fam of state.families.values()) {
      if (!u || fam.userId === u.id) { fam.revoked = true; n++; }
    }
    return send(res, 200, { revoked: n });
  }
  if (path === '/__test/seed-records') {
    const body = await readBody(req);
    const u = state.users.get(body.email);
    if (!u) return send(res, 400, { error: 'unknown user' });
    for (const data of body.records || []) {
      state.records.push({ id: `row-${++state.counter}`, user_id: u.id, data, created_at: new Date(Date.now() - 1000 * state.counter).toISOString() });
    }
    return send(res, 200, { count: state.records.length });
  }
  if (path === '/__test/set-profile') {
    const body = await readBody(req);
    const target = state.users.get(body.email);
    if (!target) return send(res, 404, { error: 'no such user' });
    if (body.username !== undefined) target.username = body.username;
    if (body.isPublic !== undefined) target.isPublic = body.isPublic;
    return send(res, 200, { ok: true });
  }
  if (path === '/__test/state') {
    return send(res, 200, {
      records: state.records,
      revocations: state.revocations,
      maxRefreshOverlap: state.maxRefreshOverlap,
      families: [...state.families.entries()].map(([id, f]) => ({ id, ...f })),
      config: { graceMs: state.graceMs, expiresIn: state.expiresIn, refreshDelayMs: state.refreshDelayMs },
    });
  }

  // ---- auth (GoTrue) --------------------------------------------------------
  if (path === '/auth/v1/token' && req.method === 'POST') {
    const grant = q(url, 'grant_type');
    const body = await readBody(req);
    if (grant === 'password') {
      const u = state.users.get(body.email);
      if (!u || u.password !== body.password) {
        return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
      }
      return send(res, 200, issueSession(u));
    }
    if (grant === 'refresh_token') {
      state.refreshInFlight++;
      state.maxRefreshOverlap = Math.max(state.maxRefreshOverlap, state.refreshInFlight);
      if (state.refreshDelayMs) await new Promise(r => setTimeout(r, state.refreshDelayMs));
      const { status, body: out } = refreshWith(body.refresh_token);
      state.refreshInFlight--;
      return send(res, status, out);
    }
    return send(res, 400, { code: 400, error_code: 'unsupported_grant_type', msg: 'unsupported grant type' });
  }
  if (path === '/auth/v1/signup' && req.method === 'POST') {
    const body = await readBody(req);
    if (state.users.has(body.email)) return send(res, 400, { code: 400, error_code: 'user_already_exists', msg: 'User already registered' });
    const u = addUser(body.email, body.password, body.data?.display_name || '');
    return send(res, 200, issueSession(u));
  }
  if (path === '/auth/v1/user' && req.method === 'GET') {
    const u = bearerUser(req);
    if (!u) return send(res, 401, { code: 401, error_code: 'bad_jwt', msg: 'invalid JWT' });
    return send(res, 200, userJson(u));
  }
  if (path === '/auth/v1/logout' && req.method === 'POST') {
    cors(res); res.writeHead(204); return res.end();
  }

  // ---- rest (PostgREST) -----------------------------------------------------
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length);
    const u = bearerUser(req);
    // The app always queries as an authenticated user; RLS would return
    // nothing (or 401) otherwise. Model that: no valid token -> 401.
    if (!u) return send(res, 401, { message: 'JWT expired', code: 'PGRST301' });
    const wantsSingle = /vnd\.pgrst\.object/.test(req.headers['accept'] || '');

    if (table === 'profiles' && req.method === 'GET') {
      // Lookup by id (own profile) or by username (a public collector).
      const id = eqValue(url, 'id');
      const username = eqValue(url, 'username');
      if (!id && !username) {
        // Discovery lists (latest members, user search). The mock ignores the
        // ilike/order refinements and just returns every public collector,
        // which is enough to put a real profile in front of a real click.
        return send(res, 200, [...state.users.values()].filter(x => x.isPublic && x.username).map(profileJson));
      }
      const target = [...state.users.values()].find(x =>
        (id && x.id === id) || (username && (x.username || '').toLowerCase() === username.toLowerCase()));
      if (!target) return wantsSingle ? send(res, 406, { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' }) : send(res, 200, []);
      return send(res, 200, wantsSingle ? profileJson(target) : [profileJson(target)]);
    }

    if (table === 'records') {
      if (req.method === 'GET') {
        const userId = eqValue(url, 'user_id');
        const rowId = eqValue(url, 'id');
        let rows = state.records.filter(r => (!userId || r.user_id === userId) && (!rowId || r.id === rowId));
        rows = [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at));
        return send(res, 200, rows.map(r => ({ id: r.id, data: r.data, created_at: r.created_at })));
      }
      if (req.method === 'POST') {
        const body = await readBody(req);
        const items = Array.isArray(body) ? body : [body];
        const inserted = items.map(item => {
          const row = { id: `row-${++state.counter}`, user_id: item.user_id || u.id, data: item.data, created_at: new Date().toISOString() };
          state.records.push(row);
          return { id: row.id };
        });
        return send(res, 201, wantsSingle ? inserted[0] : inserted);
      }
      if (req.method === 'PATCH') {
        const rowId = eqValue(url, 'id');
        const body = await readBody(req);
        const row = state.records.find(r => r.id === rowId);
        if (row && body.data) row.data = body.data;
        return send(res, 204);
      }
      if (req.method === 'DELETE') {
        const rowId = eqValue(url, 'id');
        state.records = state.records.filter(r => r.id !== rowId);
        return send(res, 204);
      }
    }

    if (table.startsWith('rpc/')) return send(res, 200, null);
    // Any other table (social, chat, follows...): empty result set.
    if (req.method === 'HEAD') { cors(res); res.writeHead(200, { 'Content-Range': '0-0/0' }); return res.end(); }
    if (wantsSingle) return send(res, 406, { message: 'no rows', code: 'PGRST116' });
    return send(res, 200, [], { 'Content-Range': '*/0' });
  }

  // ---- storage: report failure, the app treats cover caching as optional ----
  if (path.startsWith('/storage/v1/')) {
    return send(res, 400, { error: 'storage disabled in mock' });
  }

  return send(res, 404, { error: `mock: unhandled ${req.method} ${path}` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock-supabase listening on http://127.0.0.1:${PORT}`);
});
