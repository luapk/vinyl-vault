import { useState } from 'react';
import { VinylRecord } from '@phosphor-icons/react';

export default function AuthScreen({ onSignIn, onSignUp, loading: authLoading }) {
  const [mode, setMode]         = useState('signin');
  const [username, setUsername] = useState('');
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [error, setError]       = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        await onSignIn(username, password);
      } else {
        if (!email || !password) throw new Error('Email and password are required');
        await onSignUp(email, password);
        setError('Check your email to confirm your account, then sign in.');
        setMode('signin');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const isLoading = busy || authLoading;

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(139,92,246,0.15) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(6,182,212,0.1) 0%, transparent 60%), #0a0a0f' }}>

      <div className="w-full max-w-sm">
        {/* Logo / brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(6,182,212,0.2))', border: '1px solid rgba(255,255,255,0.1)' }}>
            <VinylRecord size={32} weight="duotone" className="text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Vinyl Vault</h1>
          <p className="text-sm text-white/40 mt-1">Your record collection, anywhere</p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-6"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)' }}>

          {/* Tab switcher */}
          <div className="flex rounded-xl p-1 mb-6"
            style={{ background: 'rgba(0,0,0,0.3)' }}>
            {['signin','signup'].map(m => (
              <button key={m}
                onClick={() => { setMode(m); setError(''); }}
                className="flex-1 py-2 text-sm font-medium rounded-lg transition-all"
                style={{
                  background: mode === m ? 'rgba(139,92,246,0.3)' : 'transparent',
                  color: mode === m ? '#fff' : 'rgba(255,255,255,0.4)',
                  border: mode === m ? '1px solid rgba(139,92,246,0.4)' : '1px solid transparent',
                }}>
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signin' ? (
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Username or email</label>
                <input
                  type="text"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  placeholder="admin or you@example.com"
                  required
                  autoComplete="username"
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,0.5)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>
            ) : (
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                  autoComplete="email"
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,0.5)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>
            )}

            <div>
              <label className="text-xs text-white/50 mb-1.5 block">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>

            {error && (
              <p className="text-xs rounded-lg px-3 py-2"
                style={{ background: error.startsWith('Check') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)', color: error.startsWith('Check') ? '#86efac' : '#fca5a5', border: `1px solid ${error.startsWith('Check') ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}` }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all mt-2"
              style={{ background: isLoading ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, rgba(139,92,246,0.8), rgba(6,182,212,0.6))', border: '1px solid rgba(139,92,246,0.4)' }}>
              {isLoading ? 'Please wait...' : mode === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-white/20 mt-6">
          Vinyl Vault uses Supabase for secure authentication.
        </p>
      </div>
    </div>
  );
}
