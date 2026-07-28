import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

// Wipe the service worker + all caches, then hard-reload. This is the escape
// hatch when a bad or stale cached bundle would otherwise trap the user on a
// broken build: one tap fetches the newest deploy fresh.
async function clearCachesAndReload() {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
  } catch { /* best effort */ }
  window.location.reload();
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100vh', background: '#06060a', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{ maxWidth: 420, width: '100%', textAlign: 'center' }}>
            <div style={{ fontFamily: 'Instrument Serif, Georgia, serif', fontSize: 30, color: 'rgba(255,255,255,0.92)', marginBottom: 10 }}>Something went wrong</div>
            <p style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6, color: 'rgba(255,255,255,0.45)', marginBottom: 22 }}>
              A hiccup loading the app. Reloading fetches the latest version and usually fixes it.
            </p>
            <button
              onClick={clearCachesAndReload}
              style={{ display: 'inline-block', padding: '12px 28px', borderRadius: 999, background: '#cafe04', color: '#08080c', fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', border: 'none', cursor: 'pointer' }}>
              Reload app
            </button>
            <details style={{ marginTop: 26, textAlign: 'left' }}>
              <summary style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.25)', cursor: 'pointer' }}>Technical details</summary>
              <pre style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,255,255,0.4)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(255,255,255,0.04)', padding: 14, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)', marginTop: 10 }}>
                {this.state.error?.message}{'\n'}{this.state.error?.stack}
              </pre>
            </details>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);

// PWA: registered in production only so the service worker never interferes
// with the Vite dev server.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
