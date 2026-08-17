import { supabase } from './supabase';

// ─── In-memory stale-while-revalidate cache ───────────────────────────────────
// Keyed by string, value is { data, ts }. Returns stale data immediately while
// refreshing in background, so components never wait on re-mount.
const _cache = {};
const TTL = 90_000; // 90 s

function fromCache(key) {
  const e = _cache[key];
  return e ? e.data : null;
}

function toCache(key, data) {
  _cache[key] = { data, ts: Date.now() };
}

function isFresh(key) {
  const e = _cache[key];
  return e && Date.now() - e.ts < TTL;
}

// Calls fn() and caches the result. If cached data exists (even stale), returns
// it immediately and refreshes the cache in the background.
async function cachedFetch(key, fn, onFresh) {
  const stale = fromCache(key);
  if (isFresh(key)) return stale; // still fresh, no need to refetch
  if (stale) {
    // Return stale immediately, refresh silently
    fn().then(data => { toCache(key, data); onFresh?.(data); }).catch(() => {});
    return stale;
  }
  // No cache at all -- fetch and wait
  const data = await fn();
  toCache(key, data);
  return data;
}

// ─── Notification helpers ─────────────────────────────────────────────────────

const NOTIF_LAST_SEEN_KEY = 'vv_notifs_last_seen';

export function getLastSeenTs() {
  return localStorage.getItem(NOTIF_LAST_SEEN_KEY) || new Date(0).toISOString();
}

export function markNotifsSeen() {
  try { localStorage.setItem(NOTIF_LAST_SEEN_KEY, new Date().toISOString()); } catch { /* storage full */ }
}

export async function getNotificationCount(userId, since) {
  if (!supabase || !userId) return 0;
  const [{ count: rc }, { count: cc }] = await Promise.all([
    supabase.from('record_reactions')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .neq('reactor_user_id', userId)
      .gt('created_at', since),
    supabase.from('record_comments')
      .select('id', { count: 'exact', head: true })
      .eq('owner_user_id', userId)
      .neq('user_id', userId)
      .gt('created_at', since),
  ]);
  return (rc || 0) + (cc || 0);
}

export async function getNotifications(userId, since) {
  if (!supabase || !userId) return [];
  const [{ data: reactions }, { data: comments }] = await Promise.all([
    supabase.from('record_reactions')
      .select('id, record_local_id, emoji, created_at, profiles:reactor_user_id(id, username, display_name, avatar_url)')
      .eq('owner_user_id', userId)
      .neq('reactor_user_id', userId)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(30),
    supabase.from('record_comments')
      .select('id, record_local_id, body, created_at, profiles:user_id(id, username, display_name, avatar_url)')
      .eq('owner_user_id', userId)
      .neq('user_id', userId)
      .gt('created_at', since)
      .order('created_at', { ascending: false })
      .limit(30),
  ]);
  const notifs = [
    ...(reactions || []).map(r => ({
      id: `r-${r.id}`,
      type: 'reaction',
      recordLocalId: r.record_local_id,
      emoji: r.emoji,
      createdAt: r.created_at,
      actor: r.profiles || null,
    })),
    ...(comments || []).map(c => ({
      id: `c-${c.id}`,
      type: 'comment',
      recordLocalId: c.record_local_id,
      body: c.body,
      createdAt: c.created_at,
      actor: c.profiles || null,
    })),
  ];
  notifs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  return notifs.slice(0, 40);
}

// ─── Profiles ─────────────────────────────────────────────────────────────────

const PROFILE_FIELDS = 'id, username, display_name, avatar_url, bio, is_public';

export async function getProfileByUsername(username) {
  if (!supabase || !username) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('username', username.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getProfileById(id) {
  if (!supabase || !id) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

// Search public profiles by username or display name.
export async function searchUsers(query, currentUserId, limit = 20) {
  if (!supabase || !query || query.trim().length < 2) return [];
  const q = query.trim();
  const { data, error } = await supabase
    .from('profiles')
    .select(PROFILE_FIELDS)
    .eq('is_public', true)
    .or(`username.ilike.%${q}%,display_name.ilike.%${q}%`)
    .limit(limit);
  if (error) throw error;
  return (data || []).filter(p => p.id !== currentUserId);
}

// The most recently joined public collectors, for discovery in the search
// pane. Excludes the current user and anyone already followed (passed in as
// excludeIds). Over-fetches so the exclusion filter still yields `limit` rows.
export async function getLatestMembers(currentUserId, excludeIds = [], limit = 10) {
  if (!supabase) return [];
  const exclude = new Set([currentUserId, ...excludeIds].filter(Boolean));
  const { data, error } = await supabase
    .from('profiles')
    .select(`${PROFILE_FIELDS}, created_at`)
    .eq('is_public', true)
    .not('username', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit + exclude.size + 5);
  if (error) throw error;
  return (data || []).filter(p => !exclude.has(p.id)).slice(0, limit);
}

// ─── Public collection ────────────────────────────────────────────────────────

// Pulls a page of a public user's records. Returns the inner data jsonb blobs
// (same shape the local collection uses) plus the DB row created_at.
export async function getPublicCollection(userId, { limit = 60, offset = 0 } = {}) {
  if (!supabase || !userId) return [];
  const { data, error } = await supabase
    .from('records')
    .select('id, data, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return (data || []).map(row => ({ ...row.data, _dbId: row.id, _addedAt: row.created_at }));
}

export async function getCollectionCount(userId) {
  if (!supabase || !userId) return 0;
  const { count, error } = await supabase
    .from('records')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) throw error;
  return count || 0;
}

// ─── Follows ──────────────────────────────────────────────────────────────────

export async function getFollowState(targetId, currentUserId) {
  if (!supabase || !targetId) return { isFollowing: false, followers: 0, following: 0 };

  const [{ count: followers }, { count: following }, mine] = await Promise.all([
    supabase.from('follows').select('follower_id', { count: 'exact', head: true }).eq('following_id', targetId),
    supabase.from('follows').select('following_id', { count: 'exact', head: true }).eq('follower_id', targetId),
    currentUserId
      ? supabase.from('follows').select('follower_id').eq('follower_id', currentUserId).eq('following_id', targetId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  return {
    isFollowing: !!mine?.data,
    followers: followers || 0,
    following: following || 0,
  };
}

export async function followUser(targetId, currentUserId) {
  if (!supabase) throw new Error('Not configured');
  const { error } = await supabase.from('follows').insert({ follower_id: currentUserId, following_id: targetId });
  if (error && error.code !== '23505') throw error; // ignore duplicate
  bustFollowCache(currentUserId);
}

export async function unfollowUser(targetId, currentUserId) {
  if (!supabase) throw new Error('Not configured');
  const { error } = await supabase.from('follows').delete().eq('follower_id', currentUserId).eq('following_id', targetId);
  if (error) throw error;
  bustFollowCache(currentUserId);
}

export function getFollowing(userId, limit = 50, onFresh) {
  if (!supabase || !userId) return Promise.resolve([]);
  return cachedFetch(`following:${userId}`, async () => {
    const { data, error } = await supabase
      .from('follows')
      .select(`profiles:following_id(${PROFILE_FIELDS})`)
      .eq('follower_id', userId)
      .limit(limit);
    if (error) throw error;
    return (data || []).map(row => row.profiles).filter(Boolean);
  }, onFresh);
}

export function getFollowers(userId, limit = 50, onFresh) {
  if (!supabase || !userId) return Promise.resolve([]);
  return cachedFetch(`followers:${userId}`, async () => {
    const { data, error } = await supabase
      .from('follows')
      .select(`profiles:follower_id(${PROFILE_FIELDS})`)
      .eq('following_id', userId)
      .limit(limit);
    if (error) throw error;
    return (data || []).map(row => row.profiles).filter(Boolean);
  }, onFresh);
}

// Bust following/followers caches after a follow/unfollow action.
export function bustFollowCache(userId) {
  delete _cache[`following:${userId}`];
  delete _cache[`followers:${userId}`];
}

// ─── Feed ─────────────────────────────────────────────────────────────────────

// Recent records added by people the current user follows.
export async function getFeed(limit = 40) {
  if (!supabase) return [];
  const { data, error } = await supabase.rpc('get_social_feed', { p_limit: limit });
  if (error) throw error;
  return (data || []).map(row => ({
    record: { ...row.record_data, _dbId: row.record_db_id },
    addedAt: row.added_at,
    owner: {
      id: row.owner_id,
      display_name: row.owner_name,
      username: row.owner_username,
      avatar_url: row.owner_avatar,
    },
  }));
}

// ─── Reactions ────────────────────────────────────────────────────────────────

export const REACTION_EMOJI = ['🔥', '❤️', '🚀', '⛳', '💎'];

// Fetch all reactions for a single record (owner + local id).
export async function getReactions(ownerUserId, recordLocalId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('record_reactions')
    .select('emoji, reactor_user_id')
    .eq('owner_user_id', ownerUserId)
    .eq('record_local_id', recordLocalId);
  if (error) throw error;
  return data || [];
}

// Batch: fetch reactions for many records of one owner at once.
// Returns a map: { [recordLocalId]: [{ emoji, reactor_user_id }] }
export async function getReactionsForRecords(ownerUserId, recordLocalIds = []) {
  if (!supabase || recordLocalIds.length === 0) return {};
  const { data, error } = await supabase
    .from('record_reactions')
    .select('record_local_id, emoji, reactor_user_id')
    .eq('owner_user_id', ownerUserId)
    .in('record_local_id', recordLocalIds);
  if (error) throw error;
  const map = {};
  for (const r of data || []) {
    (map[r.record_local_id] ||= []).push({ emoji: r.emoji, reactor_user_id: r.reactor_user_id });
  }
  return map;
}

// Toggle a reaction: if the current user already reacted with this emoji, remove
// it; otherwise add it. Returns 'added' | 'removed'.
export async function toggleReaction(ownerUserId, recordLocalId, emoji, reactorUserId) {
  if (!supabase) throw new Error('Not configured');
  const { data: existing } = await supabase
    .from('record_reactions')
    .select('id')
    .eq('owner_user_id', ownerUserId)
    .eq('record_local_id', recordLocalId)
    .eq('reactor_user_id', reactorUserId)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('record_reactions').delete().eq('id', existing.id);
    if (error) throw error;
    return 'removed';
  }
  const { error } = await supabase.from('record_reactions').insert({
    owner_user_id: ownerUserId,
    record_local_id: recordLocalId,
    reactor_user_id: reactorUserId,
    emoji,
  });
  if (error) throw error;
  return 'added';
}

// ─── Comments ─────────────────────────────────────────────────────────────────

// Comments for a record, with each commenter's profile joined.
export async function getComments(ownerUserId, recordLocalId) {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('record_comments')
    .select('id, body, created_at, user_id, profiles:user_id (username, display_name, avatar_url)')
    .eq('owner_user_id', ownerUserId)
    .eq('record_local_id', recordLocalId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data || []).map(c => ({
    id: c.id,
    body: c.body,
    createdAt: c.created_at,
    userId: c.user_id,
    author: c.profiles || null,
  }));
}

export async function addComment(ownerUserId, recordLocalId, body, userId) {
  if (!supabase) throw new Error('Not configured');
  const trimmed = (body || '').trim();
  if (!trimmed) throw new Error('Comment is empty');
  if (trimmed.length > 300) throw new Error('Comment too long (300 char max)');
  const { data, error } = await supabase
    .from('record_comments')
    .insert({ owner_user_id: ownerUserId, record_local_id: recordLocalId, user_id: userId, body: trimmed })
    .select('id, body, created_at, user_id')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteComment(commentId) {
  if (!supabase) throw new Error('Not configured');
  const { error } = await supabase.from('record_comments').delete().eq('id', commentId);
  if (error) throw error;
}

// ─── Direct messages ──────────────────────────────────────────────────────────

async function _fetchConversations(userId) {
  const { data, error } = await supabase
    .from('messages')
    .select('id, from_user_id, to_user_id, body, created_at, read_at')
    .or(`from_user_id.eq.${userId},to_user_id.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;

  const map = new Map();
  const partnerIds = new Set();
  for (const msg of data || []) {
    const otherId = msg.from_user_id === userId ? msg.to_user_id : msg.from_user_id;
    partnerIds.add(otherId);
    if (!map.has(otherId)) {
      map.set(otherId, { userId: otherId, profile: null, lastMessage: msg, unread: 0 });
    }
    if (msg.to_user_id === userId && !msg.read_at) {
      map.get(otherId).unread++;
    }
  }

  if (partnerIds.size > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username, display_name, avatar_url')
      .in('id', [...partnerIds]);
    for (const p of profiles || []) {
      if (map.has(p.id)) map.get(p.id).profile = p;
    }
  }

  return [...map.values()];
}

export function getConversations(userId, onFresh) {
  if (!supabase || !userId) return Promise.resolve([]);
  return cachedFetch(`convs:${userId}`, () => _fetchConversations(userId), onFresh);
}

export function bustConversationsCache(userId) {
  delete _cache[`convs:${userId}`];
}

export async function getMessages(userId, otherUserId, limit = 80) {
  if (!supabase || !userId || !otherUserId) return [];
  const { data, error } = await supabase
    .from('messages')
    .select('id, from_user_id, to_user_id, body, created_at, read_at, record_ref')
    .or(`and(from_user_id.eq.${userId},to_user_id.eq.${otherUserId}),and(from_user_id.eq.${otherUserId},to_user_id.eq.${userId})`)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

export async function sendMessage(fromUserId, toUserId, body, recordRef = null) {
  if (!supabase) throw new Error('Not configured');
  const trimmed = (body || '').trim();
  if (!trimmed) throw new Error('Message is empty');
  if (trimmed.length > 500) throw new Error('Message too long (500 char max)');
  const row = { from_user_id: fromUserId, to_user_id: toUserId, body: trimmed };
  if (recordRef) row.record_ref = recordRef;
  const { data, error } = await supabase
    .from('messages')
    .insert(row)
    .select('id, from_user_id, to_user_id, body, created_at, read_at, record_ref')
    .single();
  if (error) throw error;
  return data;
}

export async function checkRecordsExist(ownerUserId, recordLocalIds) {
  if (!supabase || !recordLocalIds.length) return new Set(recordLocalIds);
  try {
    // SECURITY DEFINER RPC: a direct SELECT on records is blocked by RLS for
    // non-public profiles, which made deleted and not-visible records
    // indistinguishable. On error (e.g. function not yet migrated) treat all
    // records as existing so nothing is falsely marked unavailable.
    const { data, error } = await supabase.rpc('records_exist', {
      p_owner_user_id: ownerUserId,
      p_local_ids: recordLocalIds,
    });
    if (error) return new Set(recordLocalIds);
    return new Set(data || []);
  } catch {
    return new Set(recordLocalIds);
  }
}

export async function markMessagesRead(toUserId, fromUserId) {
  if (!supabase) return;
  await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('to_user_id', toUserId)
    .eq('from_user_id', fromUserId)
    .is('read_at', null);
}

// ─── Message reactions ────────────────────────────────────────────────────────

export async function getReactionsForMessages(messageIds) {
  if (!supabase || !messageIds.length) return {};
  const { data } = await supabase
    .from('message_reactions')
    .select('message_id, emoji, user_id')
    .in('message_id', messageIds);
  const map = {};
  for (const r of data || []) {
    (map[r.message_id] ||= []).push({ emoji: r.emoji, user_id: r.user_id });
  }
  return map;
}

export async function toggleMessageReaction(messageId, emoji, userId) {
  if (!supabase) throw new Error('Not configured');
  const { data: existing } = await supabase
    .from('message_reactions')
    .select('id')
    .eq('message_id', messageId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle();
  if (existing) {
    const { error } = await supabase.from('message_reactions').delete().eq('id', existing.id);
    if (error) throw error;
    return 'removed';
  }
  const { error } = await supabase.from('message_reactions').insert({ message_id: messageId, user_id: userId, emoji });
  if (error) throw error;
  return 'added';
}

export async function getUnreadMessageCount(userId) {
  if (!supabase || !userId) return 0;
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('to_user_id', userId)
    .is('read_at', null);
  if (error) return 0;
  return count || 0;
}
