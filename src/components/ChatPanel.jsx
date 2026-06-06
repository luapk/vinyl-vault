import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ArrowLeft, PaperPlaneTilt, ChatCircleDots } from '@phosphor-icons/react';
import { supabase } from '../lib/supabase';
import { getConversations, getMessages, sendMessage, markMessagesRead } from '../lib/social';

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
  const endRef = useRef(null);
  const inputRef = useRef(null);
  const recipientRef = useRef(recipient);
  useEffect(() => { recipientRef.current = recipient; }, [recipient]);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await getConversations(currentUser.id);
      setConversations(convs);
      const total = convs.reduce((s, c) => s + c.unread, 0);
      onUnreadChange?.(total);
    } catch { /* silent */ }
  }, [currentUser.id, onUnreadChange]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  const openThread = useCallback(async (profile) => {
    setRecipient(profile);
    setView('thread');
    setMessages([]);
    try {
      const msgs = await getMessages(currentUser.id, profile.id);
      setMessages(msgs);
      await markMessagesRead(currentUser.id, profile.id);
      setConversations(prev => prev.map(c => c.userId === profile.id ? { ...c, unread: 0 } : c));
      onUnreadChange?.(0);
    } catch { /* silent */ }
    setTimeout(() => inputRef.current?.focus(), 150);
  }, [currentUser.id, onUnreadChange]);

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

  const handleSend = async () => {
    if (!input.trim() || !recipient || sending) return;
    const body = input.trim();
    setInput('');
    setSending(true);
    // Reset textarea height
    if (inputRef.current) { inputRef.current.style.height = 'auto'; }
    try {
      const msg = await sendMessage(currentUser.id, recipient.id, body);
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
      {view === 'list' ? (
        <>
          {/* List header */}
          <div style={{ padding: '16px 20px 14px', borderBottom: '1px solid rgba(var(--fg),0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
            <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: '0.2em', textTransform: 'uppercase', fontFamily: 'monospace', color: 'rgba(var(--fg),0.65)' }}>Messages</span>
            <button onClick={onClose} style={btnStyle}><X size={13} weight="bold" /></button>
          </div>

          {/* Conversation list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {conversations.length === 0 ? (
              <div style={{ padding: '52px 24px', textAlign: 'center', color: 'rgba(var(--fg),0.35)', fontSize: 12, fontFamily: 'monospace' }}>
                <ChatCircleDots size={34} style={{ margin: '0 auto 12px', display: 'block', opacity: 0.28 }} />
                <div style={{ marginBottom: 4 }}>No conversations yet</div>
                <div style={{ fontSize: 11, color: 'rgba(var(--fg),0.25)' }}>Open a profile and tap Message to start.</div>
              </div>
            ) : conversations.map(conv => (
              <button key={conv.userId} onClick={() => openThread(conv.profile)}
                style={{ width: '100%', padding: '12px 18px', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid rgba(var(--fg),0.05)', background: 'transparent', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ position: 'relative', flexShrink: 0 }}>
                  <ChatAvatar profile={conv.profile} size={40} />
                  {conv.unread > 0 && (
                    <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 16, height: 16, borderRadius: 8, background: `rgb(${accentRGB})`, fontSize: 9, fontWeight: 800, color: '#fff', fontFamily: 'monospace', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>{conv.unread > 9 ? '9+' : conv.unread}</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: conv.unread > 0 ? 700 : 500, color: 'rgba(var(--fg),0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                      {conv.profile?.display_name || conv.profile?.username || 'User'}
                    </span>
                    <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(var(--fg),0.35)', flexShrink: 0, marginLeft: 8 }}>{msgTime(conv.lastMessage?.created_at)}</span>
                  </div>
                  <div style={{ fontSize: 12, color: conv.unread > 0 ? 'rgba(var(--fg),0.62)' : 'rgba(var(--fg),0.38)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontFamily: 'monospace' }}>
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
              <div style={{ fontSize: 13, fontWeight: 600, color: 'rgba(var(--fg),0.88)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {recipient?.display_name || recipient?.username || 'User'}
              </div>
              {recipient?.username && <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'rgba(var(--fg),0.40)' }}>@{recipient.username}</div>}
            </div>
            <button onClick={onClose} style={btnStyle}><X size={13} weight="bold" /></button>
          </div>

          {/* Message thread */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px 6px' }}>
            {messages.length === 0 && (
              <div style={{ textAlign: 'center', padding: '36px 0', color: 'rgba(var(--fg),0.28)', fontSize: 12, fontFamily: 'monospace' }}>
                Start the conversation
              </div>
            )}
            {messages.map((msg, i) => {
              const isMe = msg.from_user_id === currentUser.id;
              const prevMsg = messages[i - 1];
              const showTime = !prevMsg || (new Date(msg.created_at) - new Date(prevMsg.created_at)) > 300000;
              return (
                <div key={msg.id}>
                  {showTime && (
                    <div style={{ textAlign: 'center', fontSize: 10, fontFamily: 'monospace', color: 'rgba(var(--fg),0.28)', margin: '6px 0 10px' }}>{msgTime(msg.created_at)}</div>
                  )}
                  <div style={{ display: 'flex', justifyContent: isMe ? 'flex-end' : 'flex-start', marginBottom: 4 }}>
                    <div style={{
                      maxWidth: '78%', padding: '8px 12px',
                      borderRadius: isMe ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                      background: isMe ? `rgba(${accentRGB},0.16)` : 'rgba(var(--fg),0.07)',
                      border: `1px solid ${isMe ? `rgba(${accentRGB},0.24)` : 'rgba(var(--fg),0.10)'}`,
                      fontSize: 13, lineHeight: 1.45,
                      color: isMe ? `rgb(${accentRGB})` : 'rgba(var(--fg),0.82)',
                      wordBreak: 'break-word',
                    }}>
                      {msg.body}
                    </div>
                  </div>
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
              style={{ flex: 1, background: 'rgba(var(--fg),0.05)', border: '1px solid rgba(var(--fg),0.10)', borderRadius: 16, padding: '9px 14px', fontSize: 13, fontFamily: 'inherit', color: 'rgba(var(--fg),0.85)', resize: 'none', outline: 'none', lineHeight: 1.4, maxHeight: 90, overflowY: 'auto' }}
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
