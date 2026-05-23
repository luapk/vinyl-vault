import { useState } from 'react';
import { VinylRecord } from '@phosphor-icons/react';

export default function AuthScreen({ onSignIn, onSignUp, loading: authLoading }) {
  const [mode, setMode]               = useState('signup');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        await onSignIn(email, password);
      } else {
        if (!email || !password) throw new Error('Email and password are required');
        await onSignUp(email, password, displayName);
        setSuccess('Check your email to confirm your account, then sign in.');
        setMode('signin');
        setEmail('');
        setPassword('');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const isLoading = busy || authLoading;

  const inputStyle = {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.1)',
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4"
      style={{ background: 'radial-gradient(ellipse at 30% 20%, rgba(139,92,246,0.15) 0%, transparent 60%), radial-gradient(ellipse at 70% 80%, rgba(6,182,212,0.1) 0%, transparent 60%), #0a0a0f' }}>

      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
            style={{ background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(6,182,212,0.2))', border: '1px solid rgba(255,255,255,0.1)' }}>
            <VinylRecord size={32} weight="duotone" className="text-violet-400" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Vinyl Vault</h1>
          <p className="text-sm text-white/40 mt-1">Your record collection, anywhere</p>
        </div>

        <div className="rounded-2xl p-6"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(24px)' }}>

          <h2 className="text-base font-semibold text-white mb-5">
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="text-xs text-white/50 mb-1.5 block">Your name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="What should we call you?"
                  autoComplete="name"
                  className="w-full px-3 py-2.5 rounded-xl text-sm text-white placeholder-white/20 outline-none transition-all"
                  style={inputStyle}
                  onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,0.5)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>
            )}

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
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>

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
                style={inputStyle}
                onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,0.5)'}
                onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
              />
            </div>

            {error && (
              <p className="text-xs rounded-lg px-3 py-2"
                style={{ background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)' }}>
                {error}
              </p>
            )}
            {success && (
              <p className="text-xs rounded-lg px-3 py-2"
                style={{ background: 'rgba(34,197,94,0.1)', color: '#86efac', border: '1px solid rgba(34,197,94,0.2)' }}>
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-all mt-2"
              style={{ background: isLoading ? 'rgba(139,92,246,0.3)' : 'linear-gradient(135deg, rgba(139,92,246,0.8), rgba(6,182,212,0.6))', border: '1px solid rgba(139,92,246,0.4)' }}>
              {isLoading ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p className="text-center text-xs text-white/30 mt-5">
            {mode === 'signup' ? (
              <>Already have an account?{' '}
                <button onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
                  className="text-white/50 underline underline-offset-2 hover:text-white/70 transition-colors">
                  Sign in
                </button>
              </>
            ) : (
              <>New here?{' '}
                <button onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
                  className="text-white/50 underline underline-offset-2 hover:text-white/70 transition-colors">
                  Create an account
                </button>
              </>
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
