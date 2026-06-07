import { useState } from 'react';

export default function AuthScreen({ onSignIn, onSignUp, loading: authLoading, initialMode = 'signup' }) {
  const [mode, setMode]               = useState(initialMode);
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

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{
      background: 'radial-gradient(ellipse at 40% 10%, rgba(var(--fg),0.07) 0%, transparent 55%), radial-gradient(ellipse at 70% 90%, rgba(var(--fg),0.04) 0%, transparent 50%), var(--bg-hex)',
    }}>
      {/* Subtle depth layers */}
      <div style={{
        position: 'fixed', inset: 0, pointerEvents: 'none',
        background: 'radial-gradient(ellipse at 50% 0%, rgba(var(--fg),0.05) 0%, transparent 40%)',
      }} />

      <div className="w-full max-w-sm relative">
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <img
            src="/logo.png"
            alt="Vinyl Vault"
            style={{ height: 180, opacity: 0.92 }}
          />
        </div>

        {/* 3D glass card */}
        <div style={{
          borderRadius: 24,
          padding: '28px 28px 24px',
          background: 'rgba(var(--bg),0.95)',
          border: '1px solid rgba(var(--fg),0.12)',
          backdropFilter: 'blur(32px)',
          WebkitBackdropFilter: 'blur(32px)',
          boxShadow: '0 32px 64px rgba(0,0,0,0.6), inset 0 1px 0 rgba(var(--fg),0.12), inset 0 -1px 0 rgba(0,0,0,0.3)',
        }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'rgba(var(--fg),0.9)', marginBottom: 20, letterSpacing: '-0.01em' }}>
            {mode === 'signup' ? 'Create your account' : 'Welcome back'}
          </h2>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {mode === 'signup' && (
              <div>
                <label style={{ display: 'block', fontSize: 11, color: 'rgba(var(--fg),0.4)', marginBottom: 6, fontFamily: 'monospace' }}>
                  Your name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="What should we call you?"
                  autoComplete="name"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '10px 14px', borderRadius: 12,
                    fontSize: 13, color: '#fff',
                    background: 'rgba(var(--fg),0.05)',
                    border: '1px solid rgba(var(--fg),0.1)',
                    outline: 'none', transition: 'border-color 0.15s',
                  }}
                  className="placeholder-white/20"
                  onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.35)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
                />
              </div>
            )}

            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(var(--fg),0.4)', marginBottom: 6, fontFamily: 'monospace' }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 14px', borderRadius: 12,
                  fontSize: 13, color: '#fff',
                  background: 'rgba(var(--fg),0.05)',
                  border: '1px solid rgba(var(--fg),0.1)',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                className="placeholder-white/20"
                onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.35)'}
                onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, color: 'rgba(var(--fg),0.4)', marginBottom: 6, fontFamily: 'monospace' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '10px 14px', borderRadius: 12,
                  fontSize: 13, color: '#fff',
                  background: 'rgba(var(--fg),0.05)',
                  border: '1px solid rgba(var(--fg),0.1)',
                  outline: 'none', transition: 'border-color 0.15s',
                }}
                className="placeholder-white/20"
                onFocus={e => e.target.style.borderColor = 'rgba(var(--fg),0.35)'}
                onBlur={e => e.target.style.borderColor = 'rgba(var(--fg),0.1)'}
              />
            </div>

            {error && (
              <p style={{ fontSize: 12, borderRadius: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.2)', margin: 0 }}>
                {error}
              </p>
            )}
            {success && (
              <p style={{ fontSize: 12, borderRadius: 10, padding: '8px 12px', background: 'rgba(var(--fg),0.06)', color: 'rgba(var(--fg),0.7)', border: '1px solid rgba(var(--fg),0.12)', margin: 0 }}>
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%', padding: '11px 0', borderRadius: 12,
                fontSize: 13, fontWeight: 600,
                color: isLoading ? 'rgba(0,0,0,0.5)' : '#000',
                background: isLoading
                  ? 'rgba(var(--fg),0.25)'
                  : 'linear-gradient(160deg, rgba(var(--fg),0.95) 0%, rgba(220,220,220,0.9) 100%)',
                border: '1px solid rgba(var(--fg),0.2)',
                boxShadow: isLoading ? 'none' : '0 4px 20px rgba(var(--fg),0.15), inset 0 1px 0 rgba(var(--fg),0.6)',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s',
                marginTop: 4,
              }}>
              {isLoading ? 'Please wait...' : mode === 'signup' ? 'Create account' : 'Sign in'}
            </button>
          </form>

          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg),0.25)', marginTop: 20, marginBottom: 0 }}>
            {mode === 'signup' ? (
              <>Already have an account?{' '}
                <button onClick={() => { setMode('signin'); setError(''); setSuccess(''); }}
                  style={{ color: 'rgba(var(--fg),0.45)', textDecoration: 'underline', textUnderlineOffset: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}>
                  Sign in
                </button>
              </>
            ) : (
              <>New here?{' '}
                <button onClick={() => { setMode('signup'); setError(''); setSuccess(''); }}
                  style={{ color: 'rgba(var(--fg),0.45)', textDecoration: 'underline', textUnderlineOffset: 3, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, padding: 0 }}>
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
