import { useState } from 'react';
import { VinylRecord } from '@phosphor-icons/react';

export default function AuthScreen({ onSignIn, onSignUp, onSignInWithGoogle, onSignInWithFacebook, loading: authLoading }) {
  const [mode, setMode]               = useState('signin');
  const [username, setUsername]       = useState('');
  const [email, setEmail]             = useState('');
  const [password, setPassword]       = useState('');
  const [displayName, setDisplayName] = useState('');
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'signin') {
        await onSignIn(username, password);
      } else {
        if (!email || !password) throw new Error('Email and password are required');
        await onSignUp(email, password, displayName);
        setError('Check your email to confirm your account, then sign in.');
        setMode('signin');
      }
    } catch (err) {
      setError(err.message || 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function handleSocialSignIn(provider) {
    setError('');
    setBusy(true);
    try {
      if (provider === 'google') await onSignInWithGoogle();
      if (provider === 'facebook') await onSignInWithFacebook();
    } catch (err) {
      setError(err.message || 'Something went wrong');
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
                  style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
                  onFocus={e => e.target.style.borderColor = 'rgba(139,92,246,0.5)'}
                  onBlur={e => e.target.style.borderColor = 'rgba(255,255,255,0.1)'}
                />
              </div>
            )}

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

            {/* Social sign-in divider */}
            {(onSignInWithGoogle || onSignInWithFacebook) && (
              <>
                <div className="relative my-4">
                  <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center' }}>
                    <div style={{ width: '100%', borderTop: '1px solid rgba(255,255,255,0.08)' }} />
                  </div>
                  <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
                    <span style={{ background: 'rgba(12,12,20,0.95)', padding: '0 12px', fontSize: 11, fontFamily: 'monospace', color: 'rgba(255,255,255,0.25)' }}>or continue with</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {onSignInWithGoogle && (
                    <button type="button" onClick={() => handleSocialSignIn('google')} disabled={isLoading}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
                      style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(255,255,255,0.7)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                      </svg>
                      Google
                    </button>
                  )}
                  {onSignInWithFacebook && (
                    <button type="button" onClick={() => handleSocialSignIn('facebook')} disabled={isLoading}
                      className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-all"
                      style={{ background: 'rgba(24,119,242,0.15)', border: '1px solid rgba(24,119,242,0.3)', color: 'rgba(255,255,255,0.7)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="#1877F2">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                      </svg>
                      Facebook
                    </button>
                  )}
                </div>
              </>
            )}
          </form>
        </div>

        <p className="text-center text-xs text-white/20 mt-6">
          Vinyl Vault uses Supabase for secure authentication.
        </p>
      </div>
    </div>
  );
}
