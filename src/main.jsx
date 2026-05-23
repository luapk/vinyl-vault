import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./index.css";

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
          <div style={{ maxWidth: 480, width: '100%' }}>
            <p style={{ fontFamily: 'monospace', fontSize: 11, color: 'rgba(255,100,100,0.8)', marginBottom: 12 }}>App error</p>
            <pre style={{ fontFamily: 'monospace', fontSize: 12, color: 'rgba(255,255,255,0.6)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: 'rgba(255,255,255,0.04)', padding: 16, borderRadius: 10, border: '1px solid rgba(255,255,255,0.08)' }}>
              {this.state.error?.message}{'\n'}{this.state.error?.stack}
            </pre>
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
