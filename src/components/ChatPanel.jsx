import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ArrowLeft, PaperPlaneTilt, ChatCircleDots, PencilSimpleLine, Smiley, VinylRecord } from '@phosphor-icons/react';
import { supabase } from '../lib/supabase';
import { getConversations, getMessages, sendMessage, markMessagesRead, getFollowing, getReactionsForMessages, toggleMessageReaction, bustConversationsCache, checkRecordsExist } from '../lib/social';

const REACT_EMOJIS = ['❤️', '😂', '👍'];

function ChatAvatar({ profile, size = 32 }) {
  const letter = (profile?.display_name || profile?.username || '?')[0].toUpperCase();
  if (profile?.avatar_url) {
    return <img src={profile.avatar_url} alt="" style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: 'rgba(var(--fg),0.10)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: Math.floor(size * 0.38), fontWeight: 600, color: 'rgba(var(--fg),0.55)', flexShrink: 0, fontFamily: 'monospace' }}>
      {letter}
    </div>
  );
}

function msgTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export default function ChatPanel({ currentUser, onClose, initialRecipient, accentRGB, onUnreadChange }) {
  const [view, setView] = useState(initialRecipient ? 'thread' : 'list');
  const [conversations, setConversations] = useState([]);
  const [recipient, setRecipient] = useState(initialRecipient || null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [followingList, setFollowingList] = useState([]);
  const [loadingFollowing, setLoadingFollowing] = useState(false);
  const [reactions, setReactions] = useState({});
  const [pickerMsg, setPickerMsg] = useState(null);
  const [deletedRefs, setDeletedRefs] = useState(new Set());
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const recipientRef = useRef(recipient);
  useEffect(() => { recipientRef.current = recipient; }, [recipient]);

  const openCompose = useCallback(async () => {
    setView('compose');
    if (followingList.length > 0) return;
    setLoadingFollowing(true);
    try {
      const list = await getFollowing(currentUser.id);
      setFollowingList(list);
    } catch { /* silent */ }
    setLoadingFollowing(false);
  }, [currentUser.id, followingList.length]);

  const applyConversations = useCallback((convs) => {
    setConversations(convs);
    const total = convs.reduce((s, c) => s + c.unread, 0);
    onUnreadChange?.(total);
  }, [onUnreadChange]);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await getConversations(currentUser.id, applyConversations);
      applyConversations(convs);
    } catch { /* silent */ }
  }, [currentUser.id, applyConversations]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openThread = useCallback(async (profile) => {
    setRecipient(profile);
    setView('thread');
    setMessages([]);
    setReactions({});
    setPickerMsg(null);
    try {
      const msgs = await getMessages(currentUser.id, profile.id);
      setMessages(msgs);
      if (msgs.length > 0) {
        getReactionsForMessages(msgs.map(m => m.id)).then(setReactions).catch(() => {});
      }
      await markMessagesRead(currentUser.id, profile.id);
      setConversations(prev => prev.map(c => c.userId === profile.id ? { ...c, unread: 0 } : c));
      onUnreadChange?.(0);
    } catch { /* silent */ }
    setTimeout(() => inputRef.current?.focus(), 150);
  }, [currentUser.id, onUnreadChange]);

  const handleReact = useCallback(async (msgId, emoji) => {
    setPickerMsg(null);
    const prev = reactions[msgId] || [];
    const hasIt = prev.some(r => r.user_id === currentUser.id && r.emoji === emoji);
    setReactions(r => ({
      ...r,
      [msgId]: hasIt
        ? (r[msgId] || []).filter(x => !(x.user_id === currentUser.id && x.emoji === emoji))
        : [...(r[msgId] || []), { emoji, user_id: currentUser.id }],
    }));
    try {
      await toggleMessageReaction(msgId, emoji, currentUser.id);
    } catch {
      getReactionsForMessages([msgId]).then(fresh => setReactions(r => ({ ...r, ...fresh }))).catch(() => {});
    }
  }, [currentUser.id, reactions]);

  // Open initial recipient once on mount
  useEffect(() => {
    if (initialRecipient) openThread(initialRecipient);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime -- new incoming messages
  useEffect(() => {
    if (!supabase || !currentUser?.id) return;
    const channel = supabase
      .channel(`dm-${currentUser.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `to_user_id=eq.${currentUser.id}` }, async (payload) => {
        const msg = payload.new;
        if (recipientRef.current?.id === msg.from_user_id) {
          setMessages(prev => [...prev, msg]);
          await markMessagesRead(currentUser.id, msg.from_user_id);
        }
        loadConversations();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser.id, loadConversations]);

  // Auto-scroll on new messages
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Check if referenced records still exist in their owner's collection
  useEffect(() => {
    const refs = messages.filter(m => m.record_ref?.owner_user_id && m.record_ref?.record_local_id).map(m => m.record_ref);
    if (!refs.length) return;
    const byOwner = {};
    for (const ref of refs) {
      const s = (byOwner[ref.owner_user_id] = byOwner[ref.owner_user_id] || new Set());
      s.add(ref.record_local_id);
    }
    Promise.all(
      Object.entries(byOwner).map(([ownerId, ids]) =>
        checkRecordsExist(ownerId, [...ids]).then(existing => ({ ownerId, existing }))
      )
    ).then(results => {
      const gone = new Set();
      for (const { ownerId, existing } of results) {
        for (const id of byOwner[ownerId]) {
          if (!existing.has(id)) gone.add(`${ownerId}:${id}`);
        }
      }
      setDeletedRefs(gone);
    }).catch(() => {});
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || !recipient || sending) return;
    const body = input.trim();
    setInput('');
    setSending(true);
    setPickerMsg(null);
    if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    try {
      const msg = await sendMessage(currentUser.id, recipient.id, body);
      bustConversationsCache(currentUser.id);
      setMessages(prev => [...prev, msg]);
      setConversations(prev => {
        const exists = prev.find(c => c.userId === recipient.id);
        if (exists) return prev.map(c => c.userId === recipient.id ? { ...c, lastMessage: msg } : c);
        return [{ userId: recipient.id, profile: recipient, lastMessage: msg, unread: 0 }, ...prev];
      });
    } catch { setInput(body); }
    setSending(false);
    inputRef.current?.focus();
  };

  const panelStyle = {
    position: 'fixed', right: 0, top: 0, bottom: 0,
    width: 'min(360px, 100vw)',
    background: 'rgba(var(--bg),0.97)',
    backdropFilter: 'blur(24px)', WebkitBackdropFilter: 'blur(24px)',
    borderLeft: '1px solid rgba(var(--fg),0.09)',
    boxShadow: '-16px 0 48px rgba(0,0,0,0.22)',
    zIndex: 45, display: 'flex', flexDirection: 'column',
    animation: 'slideInRight 0.22s cubic-bezier(0.25,0.46,0.45,0.94)',
  };

  const btnStyle = { width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(var(--fg),0.07)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(var(--fg),0.55)', flexShrink: 0 };

  return (
    <div style={panelStyle}>
      {view === 'compose' ? (
        <>
          {/* Compose header */}
          <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid rgba(var(--fg),0.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setView('list')} style={btnStyle}><ArrowLeft size={13} weight="bold" /></button>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(var(--fg),0.65)' }}>New Message</span>
            <button onClick={onClose} style={btnStyle}><X size={13} weight="bold" /></button>
          </div>

          {/* Following list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {loadingFollowing ? (
              <div style={{ padding: '48px 0', display: 'flex', justifyContent: 'center' }}>
                <div className="animate-spin" style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid rgba(var(--fg),0.1)`, borderTopColor: `rgb(${accentRGB})` }} />
              </div>
            ) : followingList.length === 0 ? (
              <div style={{ padding: '52px 24px', textAlign: 'center', color: 'rgba(var(--fg),0.35)', fontSize: 14, fontFamily: 'monospace' }}>
                <div style={{ marginBottom: 4 }}>No one to message yet</div>
                <div style={{ fontSize: 12, color: 'rgba(var(--fg),0.25)' }}>Follow someone to start a conversation.</div>
              </div>
            ) : followingList.map(p => (
              <button key={p.id} onClick={() => openThread(p)}
                style={{ width: '100%', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(var(--fg),0.05)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                <ChatAvatar profile={p} size={40} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 500, color: 'rgba(var(--fg),0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.display_name || p.username || 'User'}
                  </div>
                  {p.username && <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)' }}>@{p.username}</div>}
                </div>
              </button>
            ))}
          </div>
        </>
      ) : view === 'list' ? (
        <>
          {/* List header */}
          <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid rgba(var(--fg),0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 14, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(var(--fg),0.65)' }}>Messages</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={openCompose} style={btnStyle} title="New message"><PencilSimpleLine size={13} weight="bold" /></button>
              <button onClick={onClose} style={btnStyle}><X size={13} weight="bold" /></button>
            </div>
          </div>

          {/* Conversation list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {conversations.length === 0 ? (
              <div style={{ padding: '52px 24px', textAlign: 'center', color: 'rgba(var(--fg),0.35)', fontSize: 14, fontFamily: 'monospace' }}>
                <ChatCircleDots size={34} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.28 }} />
                <div style={{ marginBottom: 4 }}>No conversations yet</div>
                <div style={{ fontSize: 14, color: 'rgba(var(--fg),0.25)' }}>Open a profile and tap Message to start.</div>
              </div>
            ) : conversations.map(conv => (
              <button key={conv.userId} onClick={() => openThread(conv.profile)}
                style={{ width: '100%', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(var(--fg),0.05)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <ChatAvatar profile={conv.profile} size={40} />
                  {conv.unread > 0 && (
                    <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, background: `rgb(${accentRGB})`, fontSize: 11, fontWeight: 800, color: '#fff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{conv.unread > 9 ? '9+' : conv.unread}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                    <span style={{ fontSize: 15, fontWeight: conv.unread > 0 ? 700 : 500, color: 'rgba(var(--fg),0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                      {conv.profile?.display_name || conv.profile?.username || 'User'}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', flexShrink: 0, marginLeft: 8 }}>{msgTime(conv.lastMessage?.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 14, color: conv.unread > 0 ? 'rgba(var(--fg),0.62)' : 'rgba(var(--fg),0.38)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
                    {conv.lastMessage?.from_user_id === currentUser.id ? 'You: ' : ''}{conv.lastMessage?.body || ''}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </>
      ) : (
        <>
          {/* Thread header */}
          <div style={{ padding: '12px 14px', borderBottom: '1px solid rgba(var(--fg),0.07)', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
            <button onClick={() => setView('list')} style={btnStyle}><ArrowLeft size={13} weight="bold" /></button>
            {recipient && <ChatAvatar profile={recipient} size={32} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'rgba(var(--fg),0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {recipient?.display_name || recipient?.username || 'User'}
              </div>
              {recipient?.username && <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.40)' }}>@{recipient.username}</div>}
            </div>
            <button onClick={onClose} style={btnStyle}><X size={13} weight="bold" /></button>
          </div>

          {/* Message thread */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '36px 0', color: 'rgba(var(--fg),0.28)', fontSize: 14, fontFamily: 'monospace' }}>
                Start the conversation
              </div>
            )}
            {messages.map((msg, i) => {
              const isMe = msg.from_user_id === currentUser.id;
              const prevMsg = messages[i - 1];
              const showTime = !prevMsg || (new Date(msg.created_at) - new Date(prevMsg.created_at)) > 300000;
              const msgRxs = reactions[msg.id] || [];
              const rxGroups = {};
              for (const r of msgRxs) {
                if (!rxGroups[r.emoji]) rxGroups[r.emoji] = { count: 0, mine: false };
                rxGroups[r.emoji].count++;
                if (r.user_id === currentUser.id) rxGroups[r.emoji].mine = true;
              }
              const hasRx = Object.keys(rxGroups).length > 0;
              const pickerOpen = pickerMsg === msg.id;
              const reactBtn = (
                <button
                  onClick={() => setPickerMsg(p => p === msg.id ? null : msg.id)}
                  className={`transition-opacity ${pickerOpen ? 'opacity-80' : 'opacity-20 hover:opacity-70'}`}
                  style={{ width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'rgba(var(--fg),0.7)' }}>
                  <Smiley size={14} />
                </button>
              );
              return (
                <div key={msg.id}>
                  {showTime && (
                    <div style={{ textAlign: 'center', fontSize: 12, fontFamily: 'monospace', color: 'rgba(var(--fg),0.28)', margin: '6px 0 10px' }}>{msgTime(msg.created_at)}</div>
                  )}
                  {pickerOpen && (
                    <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: 4, marginBottom: 4 }}>
                      {REACT_EMOJIS.map(emoji => (
                        <button key={emoji} onClick={() => handleReact(msg.id, emoji)}
                          style={{ fontSize: 18, padding: '4px 6px', borderRadius: 10, border: '1px solid rgba(var(--fg),0.1)', background: 'rgba(var(--fg),0.05)', cursor: 'pointer', lineHeight: 1, transition: 'transform 0.1s' }}
                          onMouseEnter={e => e.currentTarget.style.transform = 'scale(1.25)'}
                          onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                  <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', alignItems: 'center', gap: 4, marginBottom: hasRx ? 2 : 4 }}>
                    {!isMe && reactBtn}
                    <div style={{
                      maxWidth: '78%',
                      padding: msg.record_ref ? 0 : '8px 12px',
                      borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: isMe ? `rgba(${accentRGB},0.16)` : 'rgba(var(--fg),0.07)',
                      border: `1px solid ${isMe ? `rgba(${accentRGB},0.24)` : 'rgba(var(--fg),0.10)'}`,
                      fontSize: 15, lineHeight: 1.45,
                      color: isMe ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.82)',
                      wordBreak: 'break-word',
                      overflow: 'hidden',
                    }}>
                      {msg.record_ref && (() => {
                        const ref = msg.record_ref;
                        const isGone = deletedRefs.has(`${ref.owner_user_id}:${ref.record_local_id}`);
                        return (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px 8px', borderBottom: `1px solid ${isMe ? `rgba(${accentRGB},0.15)` : 'rgba(var(--fg),0.08)'}` }}>
                            <div style={{ width: 34, height: 34, borderRadius: 6, overflow: 'hidden', flexShrink: 0, background: 'rgba(var(--fg),0.08)' }}>
                              {ref.coverUrl
                                ? <img src={ref.coverUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><VinylRecord size={15} weight="thin" style={{ opacity: 0.3 }} /></div>
                              }
                            </div>
                            <div style={{ minWidth: 0, flex: 1 }}>
                              <div style={{ fontSize: 10, fontFamily: 'monospace', letterSpacing: '0.06em', marginBottom: 1, opacity: 0.45 }}>
                                {isGone ? 'no longer available' : 'in response to'}
                              </div>
                              {(ref.artist || ref.title) && (
                                <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.78 }}>
                                  {ref.artist}{ref.title ? ` / ${ref.title}` : ''}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <div style={{ padding: msg.record_ref ? '7px 12px' : 0 }}>{msg.body}</div>
                    </div>
                    {isMe && reactBtn}
                  </div>
                  {hasRx && (
                    <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', gap: 4, marginBottom: 6 }}>
                      {Object.entries(rxGroups).map(([emoji, { count, mine }]) => (
                        <button key={emoji} onClick={() => handleReact(msg.id, emoji)}
                          style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 10, border: mine ? `1px solid rgba(${accentRGB},0.45)` : '1px solid rgba(var(--fg),0.10)', background: mine ? `rgba(${accentRGB},0.12)` : 'rgba(var(--fg),0.05)', cursor: 'pointer' }}>
                          <span style={{ fontSize: 13 }}>{emoji}</span>
                          <span style={{ fontSize: 11, fontFamily: 'monospace', color: mine ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.50)' }}>{count}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {/* Input row */}
          <div style={{ padding: '10px 12px 14px', borderTop: '1px solid rgba(var(--fg),0.07)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
              placeholder="Message..."
              rows={1}
              style={{ flex: 1, background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)', borderRadius: 16, padding: '9px 14px', fontSize: 15, fontFamily: 'inherit', color: 'rgba(var(--fg),0.85)', resize: 'none', outline: 'none', lineHeight: 1.4, maxHeight: 90, overflowY: 'auto' }}
              onInput={e => { e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 90) + 'px'; }}
            />
            <button onClick={handleSend} disabled={!input.trim() || sending}
              style={{ width: 36, height: 36, borderRadius: '50%', border: 'none', flexShrink: 0, cursor: input.trim() && !sending ? 'pointer' : 'not-allowed', background: input.trim() && !sending ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.15s' }}>
              <PaperPlaneTilt size={15} weight="fill" style={{ color: input.trim() && !sending ? '#fff' : 'rgba(var(--fg),0.30)' }} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
