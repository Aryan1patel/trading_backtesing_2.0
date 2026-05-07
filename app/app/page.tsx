import AppLayout from "../components/AppLayout";

export default function Home() {
  return (
    <div className="app-shell">
      {/* ── Navbar ────────────────────────────────────────────────────── */}
      <nav className="navbar" aria-label="Application navigation">
        <div className="navbar-logo">
          <div className="navbar-logo-icon" aria-hidden="true">
            {/* Candlestick icon */}
            <svg viewBox="0 0 15 15" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="2"    y="4"  width="3"   height="7" rx="0.5" fill="#fff"     opacity="0.9" />
              <rect x="3.25" y="2"  width="0.5" height="2"          fill="#fff"     opacity="0.6" />
              <rect x="3.25" y="11" width="0.5" height="2"          fill="#fff"     opacity="0.6" />
              <rect x="7"    y="2"  width="3"   height="9" rx="0.5" fill="#ef5350"  opacity="0.9" />
              <rect x="8.25" y="1"  width="0.5" height="1"          fill="#ef5350"  opacity="0.7" />
              <rect x="8.25" y="11" width="0.5" height="2"          fill="#ef5350"  opacity="0.7" />
              <rect x="11"   y="5"  width="3"   height="6" rx="0.5" fill="#26a69a"  opacity="0.9" />
              <rect x="12.25" y="3" width="0.5" height="2"          fill="#26a69a"  opacity="0.7" />
              <rect x="12.25" y="11" width="0.5" height="2"         fill="#26a69a"  opacity="0.7" />
            </svg>
          </div>
          <span className="navbar-brand">ChartLens</span>
        </div>

        <div className="navbar-divider" aria-hidden="true" />

        <div className="navbar-chip" aria-label="Build phase indicator">
          <span className="navbar-dot" aria-hidden="true" />
          Phase 7 · Paper Trading
        </div>

        <div className="navbar-right" aria-label="Data source info">
          FastAPI backend · localhost:8000
        </div>
      </nav>

      {/* ── App content (chart + watchlist sidebar) ───────────────────── */}
      <AppLayout />
    </div>
  );
}
