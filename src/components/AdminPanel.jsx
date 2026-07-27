import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserCircle, EnvelopeSimple, ArrowLeft, Crown, ArrowClockwise } from '@phosphor-icons/react';

export default function AdminPanel({ onBack }) {
  const [users, setUsers]       = useState([]);
  const [loading, setLoading]   = useState(true);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [message, setMessage]   = useState(null);
  const [savingId, setSavingId] = useState(null);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    try {
      // Admins can see all profiles via the RLS policy.
      const { data: profiles, error } = await supabase
        .from('profiles')
        .select('id, email, role, created_at, display_name, username, is_public, subscription_tier, subscription_status')
        .order('created_at', { ascending: true });
      if (error) throw error;

      // Count records per user.
      const { data: counts } = await supabase
        .from('records')
        .select('user_id');

      const countMap = {};
      (counts || []).forEach(r => {
        countMap[r.user_id] = (countMap[r.user_id] || 0) + 1;
      });

      setUsers((profiles || []).map(p => ({ ...p, recordCount: countMap[p.id] || 0 })));
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setLoading(false);
    }
  }

  async function sendInvite(e) {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setMessage(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      const res = await fetch('/api/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      setMessage({ type: 'success', text: `Invite sent to ${inviteEmail.trim()}` });
      setInviteEmail('');
      loadUsers();
    } catch (err) {
      setMessage({ type: 'error', text: err.message });
    } finally {
      setInviting(false);
    }
  }

  // Admins can update any profile row (profiles_admin_update RLS policy).
  // Setting a tier also clears the scan block: status -> active and the
  // current-period scan count -> 0, so the change takes effect immediately
  // (the user picks it up on their next refresh).
  async function changeTier(userId, newTier, label) {
    setSavingId(userId);
    setMessage(null);
    const prev = users;
    setUsers(us => us.map(u => u.id === userId ? { ...u, subscription_tier: newTier, subscription_status: 'active' } : u));
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ subscription_tier: newTier, subscription_status: 'active', scans_this_period: 0 })
        .eq('id', userId);
      if (error) throw error;
      setMessage({ type: 'success', text: `${label} set to ${newTier[0].toUpperCase() + newTier.slice(1)}` });
    } catch (err) {
      setUsers(prev);
      setMessage({ type: 'error', text: err.message });
    } finally {
      setSavingId(null);
    }
  }

  const inputStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
  };

  const TIER_COLORS = {
    digger:   'rgba(255,255,255,0.35)',
    selector: 'rgba(201,255,0,0.9)',
    resident: 'rgba(172,144,226,0.95)',
  };

  return (
    <div className="min-h-screen px-4 py-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <button onClick={onBack}
          className="p-2 rounded-xl text-white/50 hover:text-white transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Crown size={20} className="text-amber-400" weight="duotone" />
            Admin Panel
          </h1>
          <p className="text-xs text-white/40">Manage users and invites</p>
        </div>
        <button onClick={loadUsers} disabled={loading}
          className="p-2 rounded-xl transition-colors"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.08)', color: loading ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.5)' }}
          title="Refresh">
          <ArrowClockwise size={16} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
        </button>
      </div>

      {/* Invite form */}
      <div className="rounded-2xl p-5 mb-6"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <h2 className="text-sm font-semibold text-white/70 mb-4 flex items-center gap-2">
          <EnvelopeSimple size={16} className="text-violet-400" />
          Invite by email
        </h2>
        <form onSubmit={sendInvite} className="flex gap-2">
          <input
            type="email"
            value={inviteEmail}
            onChange={e => setInviteEmail(e.target.value)}
            placeholder="user@example.com"
            required
            className="flex-1 px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none"
            style={inputStyle}
          />
          <button type="submit" disabled={inviting}
            className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white transition-all"
            style={{ background: inviting ? 'rgba(139,92,246,0.3)' : 'rgba(139,92,246,0.6)', border: '1px solid rgba(139,92,246,0.4)' }}>
            {inviting ? '...' : 'Send'}
          </button>
        </form>
        {message && (
          <p className="text-xs mt-3 px-3 py-2 rounded-lg"
            style={{
              background: message.type === 'success' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: message.type === 'success' ? '#86efac' : '#fca5a5',
              border: `1px solid ${message.type === 'success' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
            }}>
            {message.text}
          </p>
        )}
      </div>

      {/* Users list */}
      <div className="rounded-2xl overflow-hidden"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
        <div className="px-5 py-4 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
          <h2 className="text-sm font-semibold text-white/70 flex items-center gap-2">
            <UserCircle size={16} className="text-cyan-400" />
            Users ({users.length})
          </h2>
        </div>

        {loading ? (
          <div className="py-12 text-center text-white/30 text-sm">Loading...</div>
        ) : users.length === 0 ? (
          <div className="py-12 text-center text-white/30 text-sm">No users yet</div>
        ) : (
          <ul className="divide-y" style={{ borderColor: 'rgba(255,255,255,0.04)' }}>
            {users.map(u => (
              <li key={u.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                  style={{ background: u.role === 'admin' ? 'rgba(251,191,36,0.15)' : 'rgba(139,92,246,0.15)' }}>
                  {u.role === 'admin'
                    ? <Crown size={14} className="text-amber-400" weight="duotone" />
                    : <UserCircle size={14} className="text-violet-400" weight="duotone" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-white truncate">
                      {u.display_name || u.email}
                    </p>
                    {u.username && (
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                        style={{ background: u.is_public ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.06)', color: u.is_public ? '#86efac' : 'rgba(255,255,255,0.3)', border: `1px solid ${u.is_public ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.08)'}` }}>
                        @{u.username}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-white/30 truncate">
                    {u.email} &middot; {u.role === 'admin' ? 'Admin' : 'User'} &middot; {u.recordCount} record{u.recordCount !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <select
                    value={u.subscription_tier || 'digger'}
                    onChange={e => changeTier(u.id, e.target.value, u.display_name || u.email)}
                    disabled={savingId === u.id}
                    title="Access tier"
                    className="text-xs rounded-lg pl-2.5 pr-6 py-1.5 outline-none cursor-pointer transition-opacity"
                    style={{
                      background: 'rgba(255,255,255,0.06)',
                      border: `1px solid ${TIER_COLORS[u.subscription_tier] || TIER_COLORS.digger}`,
                      color: TIER_COLORS[u.subscription_tier] || 'rgba(255,255,255,0.75)',
                      opacity: savingId === u.id ? 0.4 : 1,
                      appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
                      backgroundImage: 'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'10\' height=\'10\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23888\' stroke-width=\'3\'><path d=\'M6 9l6 6 6-6\'/></svg>")',
                      backgroundRepeat: 'no-repeat',
                      backgroundPosition: 'right 7px center',
                    }}>
                    <option value="digger"   style={{ color: '#000' }}>Digger (free)</option>
                    <option value="selector" style={{ color: '#000' }}>Selector</option>
                    <option value="resident" style={{ color: '#000' }}>Resident</option>
                  </select>
                  <span className="text-[10px] text-white/20">
                    {new Date(u.created_at).toLocaleDateString()}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
