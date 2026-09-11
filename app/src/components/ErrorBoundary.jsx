import { Component } from 'react';

/** Koi bhi screen crash ho jaye to poora blank ho jata tha — ab ye ek "reload karo" card dikhata hai.
 *  Reload par sab cache clear + fresh load (naya deploy ho to wahi aa jayega). */
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }

  static getDerivedStateFromError(err) { return { err }; }

  componentDidCatch(err, info) {
    // eslint-disable-next-line no-console
    console.error('App crash:', err, info?.componentStack);
  }

  async reload() {
    try {
      if (window.caches) { const ks = await caches.keys(); await Promise.all(ks.map((k) => caches.delete(k))); }
    } catch { /* ignore */ }
    const u = new URL(window.location.href);
    u.searchParams.delete('_v'); u.searchParams.delete('_');
    window.location.replace(u.pathname + (u.search || '') + u.hash);
  }

  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div style={{
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24, background: '#f2f5f9', fontFamily: '-apple-system,Segoe UI,Roboto,sans-serif',
      }}>
        <div style={{
          maxWidth: 380, width: '100%', background: '#fff', borderRadius: 16, padding: '28px 22px',
          textAlign: 'center', boxShadow: '0 12px 40px rgba(0,0,0,.12)', color: '#1a2b45',
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>⚠️</div>
          <h2 style={{ fontSize: 17, margin: '0 0 6px', color: '#001f3f' }}>Kuch gadbad ho gayi</h2>
          <p style={{ fontSize: 13, color: '#5a6b82', margin: '0 0 18px', lineHeight: 1.5 }}>
            App theek se load nahi hui. Neeche button dabao — ye saaf karke dobara khol dega.
          </p>
          <button
            type="button"
            onClick={() => this.reload()}
            style={{
              width: '100%', background: '#001f3f', color: '#fff', border: 'none', borderRadius: 12,
              padding: 14, fontWeight: 700, fontSize: 15, cursor: 'pointer',
            }}
          >
            🔄 Reload karo
          </button>
        </div>
      </div>
    );
  }
}
