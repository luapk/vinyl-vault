import { useState, useEffect, useRef, useCallback } from "react";
import {
  X, CaretLeft, MagnifyingGlass, Users, ShareNetwork, PaperPlaneRight,
  Trash, VinylRecord, ChatCircle, Check, Clock, Bell, PaperPlaneTilt,
} from "@phosphor-icons/react";
import {
  getProfileByUsername, getPublicCollection, getCollectionCount,
  getFollowState, followUser, unfollowUser, getFollowing, getFeed, searchUsers,
  REACTION_EMOJI, getReactionsForRecords, getReactions, toggleReaction,
  getComments, addComment, deleteComment,
  getNotifications, getLastSeenTs,
} from "../lib/social.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function initials(profile) {
  const s = profile?.display_name || profile?.username || profile?.email || '?';
  return s[0].toUpperCase();
}

function nameFor(profile) {
  return profile?.display_name || (profile?.username ? `@${profile.username}` : 'Collector');
}

function relativeTime(ts) {
  if (!ts) return '';
  const d = new Date(ts).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function Avatar({ profile, size = 40 }) {
  return (
    <div className="rounded-full overflow-hidden flex items-center justify-center shrink-0"
      style={{ width: size, height: size, border: '1px solid rgba(var(--fg),0.15)', background: 'rgba(var(--fg),0.06)' }}>
      {profile?.avatar_url
        ? <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
        : <span style={{ fontSize: size * 0.4, fontFamily: 'monospace', fontWeight: 600, color: 'rgba(var(--fg),0.45)' }}>{initials(profile)}</span>}
    </div>
  );
}

// ─── Public record card (self-contained, no VinylVault dependency) ────────────

function PublicRecordCard({ record, accentRGB, reactionCount, onSelect }) {
  return (
    <div className="relative group cursor-pointer" onClick={onSelect}>
      <div className="aspect-square rounded-xl overflow-hidden mb-2 relative" style={{ boxShadow: "0 8px 32px -8px rgba(0,0,0,0.5), 0 0 0 1px rgba(var(--fg),0.05)" }}>
        {record.coverUrl
          ? <img src={record.coverUrl} alt={record.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-400" />
          : <div className="w-full h-full flex items-center justify-center" style={{ background: `linear-gradient(135deg, rgba(${accentRGB},0.1), rgba(${accentRGB},0.02))` }}>
              <VinylRecord size={28} weight="thin" className="opacity-20" />
            </div>}
        {reactionCount > 0 && (
          <div style={{ position: 'absolute', bottom: 6, right: 6, fontSize: 9, fontFamily: 'monospace', padding: '2px 7px', borderRadius: 10, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(8px)', color: '#fff', display: 'flex', alignItems: 'center', gap: 3 }}>
            <span style={{ fontSize: 10 }}>♥</span>{reactionCount}
          </div>
        )}
      </div>
      <div className="text-[11px] leading-snug font-display truncate text-white/85">{record.artist}</div>
      <div className="text-[10px] text-white/40 truncate font-mono">{record.title}</div>
    </div>
  );
}

// ─── Reaction bar ─────────────────────────────────────────────────────────────

function ReactionBar({ ownerUserId, recordLocalId, currentUserId, accentRGB }) {
  const [reactions, setReactions] = useState([]);
  const [busy, setBusy] = useState(null);

  useEffect(() => {
    let alive = true;
    getReactions(ownerUserId, recordLocalId).then(r => { if (alive) setReactions(r); }).catch(() => {});
    return () => { alive = false; };
  }, [ownerUserId, recordLocalId]);

  const counts = {};
  const mine = new Set();
  for (const r of reactions) {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
    if (r.reactor_user_id === currentUserId) mine.add(r.emoji);
  }

  const onToggle = async (emoji) => {
    if (!currentUserId || busy) return;
    setBusy(emoji);
    // optimistic
    const had = mine.has(emoji);
    setReactions(prev => had
      ? prev.filter(r => !(r.emoji === emoji && r.reactor_user_id === currentUserId))
      : [...prev, { emoji, reactor_user_id: currentUserId }]);
    try {
      await toggleReaction(ownerUserId, recordLocalId, emoji, currentUserId);
    } catch {
      // revert on failure
      const fresh = await getReactions(ownerUserId, recordLocalId).catch(() => null);
      if (fresh) setReactions(fresh);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {REACTION_EMOJI.map(emoji => {
        const count = counts[emoji] || 0;
        const active = mine.has(emoji);
        return (
          <button key={emoji} onClick={() => onToggle(emoji)} disabled={!currentUserId}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-full transition-all"
            style={{
              border: active ? `1px solid rgba(${accentRGB},0.5)` : '1px solid rgba(var(--fg),0.10)',
              background: active ? `rgba(${accentRGB},0.15)` : 'rgba(var(--fg),0.04)',
              cursor: currentUserId ? 'pointer' : 'default',
              opacity: currentUserId ? 1 : 0.5,
            }}>
            <span style={{ fontSize: 14, lineHeight: 1 }}>{emoji}</span>
            {count > 0 && <span style={{ fontSize: 11, fontFamily: 'monospace', color: active ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.55)' }}>{count}</span>}
          </button>
        );
      })}
    </div>
  );
}

// ─── Comments ─────────────────────────────────────────────────────────────────

function CommentSection({ ownerUserId, recordLocalId, currentUserId, accentRGB, onOpenProfile }) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);

  const reload = useCallback(() => {
    getComments(ownerUserId, recordLocalId)
      .then(setComments).catch(() => {}).finally(() => setLoading(false));
  }, [ownerUserId, recordLocalId]);

  useEffect(() => { reload(); }, [reload]);

  const submit = async () => {
    const body = draft.trim();
    if (!body || posting || !currentUserId) return;
    setPosting(true);
    try {
      await addComment(ownerUserId, recordLocalId, body, currentUserId);
      setDraft('');
      reload();
    } catch (e) {
      // keep draft so user can retry
      console.error(e);
    } finally {
      setPosting(false);
    }
  };

  const remove = async (id) => {
    setComments(prev => prev.filter(c => c.id !== id));
    try { await deleteComment(id); } catch { reload(); }
  };

  return (
    <div>
      <div className="text-[10px] tracking-[0.25em] uppercase font-mono text-white/35 mb-3 flex items-center gap-1.5">
        <ChatCircle size={12} /> Comments {comments.length > 0 && `(${comments.length})`}
      </div>

      {loading ? (
        <div className="text-white/25 text-xs font-mono py-2">Loading…</div>
      ) : comments.length === 0 ? (
        <div className="text-white/25 text-xs font-mono py-2">No comments yet. Start the conversation.</div>
      ) : (
        <div className="space-y-3 mb-4">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2.5">
              <button onClick={() => c.author?.username && onOpenProfile?.(c.author.username)}>
                <Avatar profile={c.author} size={28} />
              </button>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <button onClick={() => c.author?.username && onOpenProfile?.(c.author.username)}
                    className="text-[12px] font-medium truncate" style={{ color: 'rgba(var(--fg),0.8)' }}>
                    {nameFor(c.author)}
                  </button>
                  <span className="text-[10px] font-mono text-white/25">{relativeTime(c.createdAt)}</span>
                  {c.userId === currentUserId && (
                    <button onClick={() => remove(c.id)} className="ml-auto text-white/20 hover:text-red-400 transition-colors">
                      <Trash size={11} />
                    </button>
                  )}
                </div>
                <div className="text-[13px] leading-snug" style={{ color: 'rgba(var(--fg),0.65)' }}>{c.body}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {currentUserId ? (
        <div className="flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 300))}
            onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="Add a comment…"
            rows={1}
            className="flex-1 resize-none rounded-xl px-3 py-2 text-[13px] outline-none"
            style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.1)', color: 'var(--fg-hex)' }}
            onFocus={e => e.target.style.borderColor = `rgba(${accentRGB},0.4)`}
            onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
          />
          <button onClick={submit} disabled={!draft.trim() || posting}
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all"
            style={{ background: draft.trim() ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.08)', color: draft.trim() ? '#000' : 'rgba(var(--fg),0.3)', cursor: draft.trim() ? 'pointer' : 'default' }}>
            <PaperPlaneRight size={15} weight="fill" />
          </button>
        </div>
      ) : (
        <div className="text-white/25 text-xs font-mono">Sign in to comment.</div>
      )}
    </div>
  );
}

// ─── Record social modal (read-only detail + reactions + comments) ────────────

function RecordSocialModal({ record, ownerUserId, currentUserId, accentRGB, onClose, onOpenProfile }) {
  const recordLocalId = record.id;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.78)', backdropFilter: 'blur(10px)' }} onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl"
        style={{ background: 'rgba(var(--bg),0.99)', border: '1px solid rgba(var(--fg),0.08)', boxShadow: '0 40px 100px -20px rgba(0,0,0,0.95)' }}
        onClick={e => e.stopPropagation()}>

        <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-3"
          style={{ background: 'rgba(var(--bg),0.85)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(var(--fg),0.06)' }}>
          <span className="text-[10px] tracking-[0.25em] uppercase font-mono text-white/35">Record</span>
          <button onClick={onClose} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ border: '1px solid rgba(var(--fg),0.1)', color: 'rgba(var(--fg),0.45)' }}><X size={13} /></button>
        </div>

        <div className="p-5">
          <div className="flex gap-4 mb-5">
            <div className="w-28 h-28 rounded-xl overflow-hidden shrink-0" style={{ boxShadow: '0 8px 24px -8px rgba(0,0,0,0.6)' }}>
              {record.coverUrl
                ? <img src={record.coverUrl} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center" style={{ background: `rgba(${accentRGB},0.08)` }}><VinylRecord size={28} weight="thin" className="opacity-20" /></div>}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-lg font-display leading-tight" style={{ color: 'rgba(var(--fg),0.9)' }}>{record.artist}</div>
              <div className="text-sm font-mono text-white/50 mb-2">{record.title}</div>
              <div className="text-[11px] font-mono text-white/35 space-y-0.5">
                {record.label && <div>{record.label}{record.catalogNumber ? ` · ${record.catalogNumber}` : ''}</div>}
                {(record.year || record.country) && <div>{[record.year, record.country].filter(Boolean).join(' · ')}</div>}
              </div>
            </div>
          </div>

          {(record.tags?.length > 0 || record.genres?.length > 0) && (
            <div className="flex flex-wrap gap-1.5 mb-5">
              {[...new Set([...(record.genres || []), ...(record.tags || [])])].slice(0, 8).map(t => (
                <span key={t} className="px-2.5 py-1 rounded-full text-[10px] font-mono" style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.08)', color: 'rgba(var(--fg),0.5)' }}>{t}</span>
              ))}
            </div>
          )}

          <div className="mb-5">
            <ReactionBar ownerUserId={ownerUserId} recordLocalId={recordLocalId} currentUserId={currentUserId} accentRGB={accentRGB} />
          </div>

          <div className="pt-4" style={{ borderTop: '1px solid rgba(var(--fg),0.07)' }}>
            <CommentSection ownerUserId={ownerUserId} recordLocalId={recordLocalId} currentUserId={currentUserId} accentRGB={accentRGB} onOpenProfile={onOpenProfile} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Public profile view ──────────────────────────────────────────────────────

const PAGE = 60;

function PublicProfileView({ username, currentUserId, accentRGB, onBack, onOpenProfile, onShare, onOpenChat }) {
  const [profile, setProfile] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | notfound | private
  const [records, setRecords] = useState([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [follow, setFollow] = useState({ isFollowing: false, followers: 0, following: 0 });
  const [followBusy, setFollowBusy] = useState(false);
  const [reactionCounts, setReactionCounts] = useState({});
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    let alive = true;
    setState('loading'); setRecords([]); setProfile(null);
    (async () => {
      try {
        const p = await getProfileByUsername(username);
        if (!alive) return;
        if (!p) { setState('notfound'); return; }
        setProfile(p);
        if (!p.is_public && p.id !== currentUserId) { setState('private'); return; }
        const [recs, count, fs] = await Promise.all([
          getPublicCollection(p.id, { limit: PAGE, offset: 0 }),
          getCollectionCount(p.id),
          getFollowState(p.id, currentUserId),
        ]);
        if (!alive) return;
        setRecords(recs);
        setTotal(count);
        setFollow(fs);
        setState('ready');
        const ids = recs.map(r => r.id).filter(Boolean);
        getReactionsForRecords(p.id, ids).then(map => {
          if (!alive) return;
          const counts = {};
          for (const [rid, list] of Object.entries(map)) counts[rid] = list.length;
          setReactionCounts(counts);
        }).catch(() => {});
      } catch {
        if (alive) setState('notfound');
      }
    })();
    return () => { alive = false; };
  }, [username, currentUserId]);

  const loadMore = async () => {
    if (loadingMore || !profile) return;
    setLoadingMore(true);
    try {
      const more = await getPublicCollection(profile.id, { limit: PAGE, offset: records.length });
      setRecords(prev => [...prev, ...more]);
      const ids = more.map(r => r.id).filter(Boolean);
      const map = await getReactionsForRecords(profile.id, ids).catch(() => ({}));
      setReactionCounts(prev => {
        const next = { ...prev };
        for (const [rid, list] of Object.entries(map)) next[rid] = list.length;
        return next;
      });
    } finally {
      setLoadingMore(false);
    }
  };

  const onFollowToggle = async () => {
    if (!currentUserId || followBusy || !profile) return;
    setFollowBusy(true);
    const wasFollowing = follow.isFollowing;
    setFollow(f => ({ ...f, isFollowing: !wasFollowing, followers: f.followers + (wasFollowing ? -1 : 1) }));
    try {
      if (wasFollowing) await unfollowUser(profile.id, currentUserId);
      else await followUser(profile.id, currentUserId);
    } catch {
      setFollow(f => ({ ...f, isFollowing: wasFollowing, followers: f.followers + (wasFollowing ? 1 : -1) }));
    } finally {
      setFollowBusy(false);
    }
  };

  if (state === 'loading') {
    return <div className="pt-20 flex flex-col items-center"><div className="w-6 h-6 rounded-full border-2 animate-spin" style={{ borderColor: 'rgba(var(--fg),0.1)', borderTopColor: `rgb(${accentRGB})` }} /></div>;
  }
  if (state === 'notfound') {
    return <ProfileMessage onBack={onBack} title="Profile not found" body={`No collector goes by @${username}.`} />;
  }
  if (state === 'private') {
    return <ProfileMessage onBack={onBack} title={`${nameFor(profile)}'s vault is private`} body="This collector hasn't made their collection public." profile={profile} />;
  }

  const isMe = profile.id === currentUserId;

  return (
    <div className="pt-6 md:pt-10" style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <button onClick={onBack} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] tracking-[0.12em] uppercase font-mono mb-6 transition-all" style={{ border: '1px solid rgba(var(--fg),0.10)', color: 'rgba(var(--fg),0.5)', background: 'rgba(var(--fg),0.03)' }}>
        <CaretLeft size={12} /> Community
      </button>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-5 mb-8">
        <Avatar profile={profile} size={88} />
        <div className="flex-1 min-w-0">
          <h1 className="text-3xl md:text-4xl font-display leading-tight" style={{ color: 'rgba(var(--fg),0.92)' }}>{nameFor(profile)}</h1>
          {profile.username && <div className="text-sm font-mono text-white/40">@{profile.username}</div>}
          {profile.bio && <p className="text-[14px] mt-2 max-w-md leading-relaxed" style={{ color: 'rgba(var(--fg),0.6)' }}>{profile.bio}</p>}
          <div className="flex items-center gap-4 mt-3 text-[12px] font-mono text-white/45">
            <span><span style={{ color: 'rgba(var(--fg),0.8)' }}>{total}</span> records</span>
            <span><span style={{ color: 'rgba(var(--fg),0.8)' }}>{follow.followers}</span> followers</span>
            <span><span style={{ color: 'rgba(var(--fg),0.8)' }}>{follow.following}</span> following</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => onShare(profile.username)} title="Copy profile link"
            className="w-10 h-10 rounded-full flex items-center justify-center transition-all" style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.55)', background: 'rgba(var(--fg),0.04)' }}>
            <ShareNetwork size={16} />
          </button>
          {!isMe && currentUserId && onOpenChat && (
            <button onClick={() => onOpenChat(profile)} title="Send message"
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all" style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.55)', background: 'rgba(var(--fg),0.04)' }}>
              <PaperPlaneTilt size={16} />
            </button>
          )}
          {!isMe && currentUserId && (
            <button onClick={onFollowToggle} disabled={followBusy}
              className="px-5 py-2.5 rounded-full text-[12px] tracking-[0.1em] uppercase font-mono transition-all"
              style={follow.isFollowing
                ? { border: '1px solid rgba(var(--fg),0.15)', color: 'rgba(var(--fg),0.6)', background: 'rgba(var(--fg),0.05)' }
                : { border: `1px solid rgba(${accentRGB},0.5)`, color: '#000', background: `rgb(${accentRGB})` }}>
              {follow.isFollowing ? 'Following' : 'Follow'}
            </button>
          )}
        </div>
      </div>

      {/* Collection grid */}
      {records.length === 0 ? (
        <div className="py-16 text-center text-white/30 text-sm font-mono">Nothing in this crate yet.</div>
      ) : (
        <>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3 md:gap-4">
            {records.map(r => (
              <PublicRecordCard key={r._dbId || r.id} record={r} accentRGB={accentRGB} reactionCount={reactionCounts[r.id] || 0} onSelect={() => setSelected(r)} />
            ))}
          </div>
          {records.length < total && (
            <div className="flex justify-center mt-8">
              <button onClick={loadMore} disabled={loadingMore} className="px-6 py-2.5 rounded-full text-[12px] font-mono transition-all" style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.6)', background: 'rgba(var(--fg),0.04)' }}>
                {loadingMore ? 'Loading…' : `Load more (${total - records.length})`}
              </button>
            </div>
          )}
        </>
      )}

      {selected && (
        <RecordSocialModal record={selected} ownerUserId={profile.id} currentUserId={currentUserId} accentRGB={accentRGB} onClose={() => setSelected(null)} onOpenProfile={onOpenProfile} />
      )}
    </div>
  );
}

function ProfileMessage({ title, body, onBack, profile }) {
  return (
    <div className="pt-16 flex flex-col items-center text-center max-w-sm mx-auto">
      {profile && <div className="mb-4"><Avatar profile={profile} size={72} /></div>}
      <h2 className="text-2xl font-display mb-2" style={{ color: 'rgba(var(--fg),0.85)' }}>{title}</h2>
      <p className="text-white/40 text-sm mb-6">{body}</p>
      <button onClick={onBack} className="px-5 py-2.5 rounded-full text-sm font-mono" style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.6)', background: 'rgba(var(--fg),0.04)' }}>Back to community</button>
    </div>
  );
}

// ─── Community home (feed + search + your profile) ────────────────────────────

function CommunityHome({ currentUser, currentProfile, accentRGB, onOpenProfile, onShare, onOpenAccount, collection, onOpenChat }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [feed, setFeed] = useState([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [following, setFollowing] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [selectedNotifRecord, setSelectedNotifRecord] = useState(null);
  // Capture the "last seen" timestamp at render time, before VinylVault resets it.
  const notifSinceRef = useRef(getLastSeenTs());
  const searchTimer = useRef(null);

  useEffect(() => {
    getFeed(40).then(setFeed).catch(() => {}).finally(() => setFeedLoading(false));
  }, []);

  useEffect(() => {
    if (!currentUser?.id) return;
    getFollowing(currentUser.id).then(setFollowing).catch(() => {});
    getNotifications(currentUser.id, notifSinceRef.current).then(setNotifications).catch(() => {});
  }, [currentUser?.id]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(() => {
      searchUsers(query, currentUser?.id).then(setResults).catch(() => setResults([])).finally(() => setSearching(false));
    }, 300);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [query, currentUser?.id]);

  const hasUsername = !!currentProfile?.username;
  const isPublic = !!currentProfile?.is_public;

  return (
    <div className="pt-6 md:pt-10 max-w-2xl mx-auto" style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <div className="text-[10px] tracking-[0.35em] uppercase mb-5 text-white/30 font-mono">Community</div>
      <h1 className="text-4xl md:text-5xl leading-[0.95] mb-8 font-display tracking-tight">
        Find your people,<br /><span className="text-white/35 italic">browse tracks.</span>
      </h1>

      {/* Your profile card */}
      <div className="rounded-2xl p-4 mb-4 flex items-center gap-3" style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.08)' }}>
        <Avatar profile={currentProfile} size={44} />
        <div className="flex-1 min-w-0">
          <div className="text-[14px] font-medium truncate" style={{ color: 'rgba(var(--fg),0.85)' }}>{nameFor(currentProfile)}</div>
          {hasUsername
            ? <div className="text-[11px] font-mono text-white/40">@{currentProfile.username} · {isPublic ? 'Public' : 'Private'}</div>
            : <div className="text-[11px] font-mono text-white/40">Set a username to share your vault</div>}
        </div>
        {hasUsername && isPublic ? (
          <div className="flex items-center gap-2">
            <button onClick={() => onShare(currentProfile.username)} title="Copy profile link" className="w-9 h-9 rounded-full flex items-center justify-center" style={{ border: '1px solid rgba(var(--fg),0.12)', color: 'rgba(var(--fg),0.55)' }}><ShareNetwork size={15} /></button>
            <button onClick={() => onOpenProfile(currentProfile.username)} className="px-4 py-2 rounded-full text-[11px] font-mono uppercase tracking-[0.1em]" style={{ border: `1px solid rgba(${accentRGB},0.4)`, color: `rgb(${accentRGB})`, background: `rgba(${accentRGB},0.1)` }}>View</button>
          </div>
        ) : (
          <button onClick={onOpenAccount} className="px-4 py-2 rounded-full text-[11px] font-mono uppercase tracking-[0.1em]" style={{ border: `1px solid rgba(${accentRGB},0.4)`, color: `rgb(${accentRGB})`, background: `rgba(${accentRGB},0.1)` }}>Set up</button>
        )}
      </div>

      {/* People you follow */}
      {following.length > 0 && (
        <div className="mb-6">
          <div className="text-[10px] tracking-[0.25em] uppercase font-mono text-white/30 mb-2.5 flex items-center gap-1.5">
            <Users size={11} /> Following ({following.length})
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}>
            {following.map(p => (
              <div key={p.id} className="flex flex-col items-center gap-1.5 shrink-0 px-2.5 py-2 rounded-xl"
                style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.07)', minWidth: 60 }}>
                <button onClick={() => p.username && onOpenProfile(p.username)} className="flex flex-col items-center gap-1">
                  <Avatar profile={p} size={32} />
                  <span className="text-[9px] font-mono text-white/50 max-w-[52px] truncate leading-tight">
                    {p.display_name || p.username || 'User'}
                  </span>
                </button>
                {onOpenChat && (
                  <button onClick={() => onOpenChat(p)} title="Message"
                    className="flex items-center justify-center transition-opacity hover:opacity-70"
                    style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid rgba(var(--fg),0.12)', background: 'rgba(var(--fg),0.05)', color: 'rgba(var(--fg),0.45)' }}>
                    <PaperPlaneTilt size={10} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Search */}
      <div className="relative mb-3">
        <MagnifyingGlass size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-white/30" />
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search collectors by name or @username"
          className="w-full pl-11 pr-4 py-3 rounded-xl text-sm outline-none"
          style={{ background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.1)', color: 'var(--fg-hex)' }}
          onFocus={e => e.target.style.borderColor = `rgba(${accentRGB},0.4)`}
          onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'} />
      </div>

      {query.trim().length >= 2 && (
        <div className="mb-8">
          {searching ? (
            <div className="text-white/25 text-xs font-mono py-3 px-1">Searching…</div>
          ) : results.length === 0 ? (
            <div className="text-white/25 text-xs font-mono py-3 px-1">No public collectors match "{query}".</div>
          ) : (
            <div className="space-y-1.5">
              {results.map(p => (
                <button key={p.id} onClick={() => onOpenProfile(p.username)} className="w-full flex items-center gap-3 p-2.5 rounded-xl transition-all text-left" style={{ background: 'rgba(var(--fg),0.03)', border: '1px solid rgba(var(--fg),0.06)' }}>
                  <Avatar profile={p} size={36} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'rgba(var(--fg),0.8)' }}>{nameFor(p)}</div>
                    <div className="text-[11px] font-mono text-white/35 truncate">@{p.username}{p.bio ? ` · ${p.bio}` : ''}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Notifications */}
      {notifications.length > 0 && (
        <div className="mb-6">
          <div className="text-[10px] tracking-[0.25em] uppercase font-mono mb-3 flex items-center gap-1.5" style={{ color: 'rgba(34,197,94,0.7)' }}>
            <Bell size={12} weight="fill" /> New activity on your records
          </div>
          <div className="space-y-1.5">
            {notifications.map(notif => {
              const record = (collection || []).find(r => r.id === notif.recordLocalId);
              return (
                <button key={notif.id} onClick={() => record && setSelectedNotifRecord(record)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all"
                  style={{ background: 'rgba(34,197,94,0.04)', border: '1px solid rgba(34,197,94,0.12)', cursor: record ? 'pointer' : 'default' }}>
                  <Avatar profile={notif.actor} size={30} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] leading-snug" style={{ color: 'rgba(var(--fg),0.8)' }}>
                      <span className="font-medium">{nameFor(notif.actor)}</span>
                      {notif.type === 'reaction'
                        ? <span className="text-white/45"> reacted {notif.emoji} to your record</span>
                        : <span className="text-white/45"> commented on your record</span>}
                      {record && <span className="font-medium" style={{ color: 'rgba(var(--fg),0.65)' }}> {record.artist} {record.title ? `— ${record.title}` : ''}</span>}
                    </div>
                    {notif.type === 'comment' && notif.body && (
                      <div className="text-[11px] font-mono text-white/35 truncate mt-0.5">"{notif.body}"</div>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-white/25 shrink-0">{relativeTime(notif.createdAt)}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Feed */}
      <div className="text-[10px] tracking-[0.25em] uppercase font-mono text-white/35 mb-4 mt-4 flex items-center gap-1.5">
        <Users size={12} /> Recent adds from people you follow
      </div>
      {feedLoading ? (
        <div className="text-white/25 text-xs font-mono py-3">Loading feed…</div>
      ) : feed.length === 0 ? (
        <div className="rounded-2xl p-8 text-center" style={{ background: 'rgba(var(--fg),0.03)', border: '1px solid rgba(var(--fg),0.06)' }}>
          <Users size={28} weight="thin" className="opacity-20 mx-auto mb-3" />
          <p className="text-white/40 text-sm mb-1">Your feed is quiet.</p>
          <p className="text-white/25 text-xs font-mono">Search for collectors above and follow them to see what they add.</p>
        </div>
      ) : (() => {
        // Group all feed items by owner, preserving first-appearance order
        const grouped = [];
        const ownerMap = new Map();
        for (const item of feed) {
          const uid = item.owner?.id;
          if (!uid) continue;
          if (!ownerMap.has(uid)) {
            const group = { owner: item.owner, records: [], latestAt: item.addedAt };
            ownerMap.set(uid, group);
            grouped.push(group);
          }
          const group = ownerMap.get(uid);
          group.records.push(item.record);
          if (item.addedAt > group.latestAt) group.latestAt = item.addedAt;
        }
        grouped.sort((a, b) => new Date(b.latestAt) - new Date(a.latestAt));

        return (
          <div className="space-y-3">
            {grouped.map(group => (
              <div key={group.owner.id} className="rounded-2xl overflow-hidden"
                style={{ background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.07)' }}>

                {/* Owner header */}
                <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                  <button onClick={() => group.owner.username && onOpenProfile(group.owner.username)}
                    className="shrink-0 transition-opacity hover:opacity-80">
                    <Avatar profile={group.owner} size={38} />
                  </button>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: 'rgba(var(--fg),0.88)' }}>
                      {nameFor(group.owner)}
                    </div>
                    <div className="text-[10px] font-mono text-white/30">
                      {group.records.length} record{group.records.length !== 1 ? 's' : ''}&nbsp;·&nbsp;{relativeTime(group.latestAt)}
                    </div>
                  </div>
                  {group.owner.username && (
                    <button onClick={() => onOpenProfile(group.owner.username)}
                      className="shrink-0 flex items-center gap-1 text-[11px] font-mono px-3 py-1.5 rounded-full transition-all"
                      style={{ border: `1px solid rgba(${accentRGB},0.3)`, color: `rgba(${accentRGB},0.85)`, background: `rgba(${accentRGB},0.08)` }}>
                      View
                    </button>
                  )}
                </div>

                {/* Records list */}
                <div className="px-3 pb-3 space-y-1">
                  {group.records.slice(0, 5).map((record, ri) => (
                    <div key={record._dbId || record.id || ri} className="flex items-center gap-3 px-2 py-2 rounded-xl"
                      style={{ background: 'rgba(var(--fg),0.03)' }}>
                      <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0" style={{ boxShadow: '0 3px 8px -3px rgba(0,0,0,0.5)' }}>
                        {record.coverUrl
                          ? <img src={record.coverUrl} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center" style={{ background: `rgba(${accentRGB},0.08)` }}><VinylRecord size={14} weight="thin" className="opacity-20" /></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-[12px] font-display truncate" style={{ color: 'rgba(var(--fg),0.8)' }}>{record.artist}</div>
                        <div className="text-[10px] font-mono text-white/35 truncate">{record.title}{record.year ? ` · ${record.year}` : ''}</div>
                      </div>
                    </div>
                  ))}
                  {group.records.length > 5 && (
                    <button onClick={() => group.owner.username && onOpenProfile(group.owner.username)}
                      className="w-full text-left text-[10px] font-mono text-white/30 hover:text-white/50 transition-colors px-2 py-1.5">
                      +{group.records.length - 5} more in their vault
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Notification record modal */}
      {selectedNotifRecord && (
        <RecordSocialModal
          record={selectedNotifRecord}
          ownerUserId={currentUser?.id}
          currentUserId={currentUser?.id}
          accentRGB={accentRGB}
          onClose={() => setSelectedNotifRecord(null)}
          onOpenProfile={onOpenProfile}
        />
      )}
    </div>
  );
}

// ─── Top-level Community view ─────────────────────────────────────────────────

export default function CommunityView({ currentUser, currentProfile, accentRGB, profileUsername, onOpenProfile, onOpenHome, onOpenAccount, collection, onOpenChat }) {
  const [toast, setToast] = useState('');

  const share = useCallback((username) => {
    if (!username) return;
    const url = `${window.location.origin}/?u=${encodeURIComponent(username)}`;
    navigator.clipboard?.writeText(url).then(() => {
      setToast('Profile link copied');
      setTimeout(() => setToast(''), 2200);
    }).catch(() => {
      setToast(url);
      setTimeout(() => setToast(''), 4000);
    });
  }, []);

  return (
    <>
      {profileUsername ? (
        <PublicProfileView
          username={profileUsername}
          currentUserId={currentUser?.id}
          accentRGB={accentRGB}
          onBack={onOpenHome}
          onOpenProfile={onOpenProfile}
          onShare={share}
          onOpenChat={onOpenChat}
        />
      ) : (
        <CommunityHome
          currentUser={currentUser}
          currentProfile={currentProfile}
          accentRGB={accentRGB}
          onOpenProfile={onOpenProfile}
          onShare={share}
          onOpenAccount={onOpenAccount}
          collection={collection}
          onOpenChat={onOpenChat}
        />
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 300, padding: '10px 18px', borderRadius: 24, background: 'rgba(8,8,14,0.92)', backdropFilter: 'blur(20px)', border: `1px solid rgba(${accentRGB},0.35)`, color: '#fff', fontSize: 12, fontFamily: 'monospace', display: 'flex', alignItems: 'center', gap: 8 }}>
          <Check size={13} weight="bold" style={{ color: `rgb(${accentRGB})` }} /> {toast}
        </div>
      )}
    </>
  );
}
