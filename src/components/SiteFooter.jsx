import { APP_NAME, STAMP_MARK } from '../lib/brand.js';

// The footer every signed-in screen ends on.
//
// It exists for two reasons that are not decoration. A trader selling a
// subscription to UK consumers has to make its terms, its cancellation rights
// and its identity findable before and after purchase, and "findable" in
// practice means a link on every page. And the About copy was written, styled
// and then never rendered: AboutView sat in the file unreachable, so the one
// page explaining what the product is for could not be opened by anyone.
//
// The legal pages are plain HTML served straight from /public, not views in
// this app. They have to stay readable when the bundle fails, when somebody
// opens them signed out, and when Stripe's reviewer loads them cold.
export default function SiteFooter({ accentRGB, onOpenAbout, isDark }) {
  const year = new Date().getFullYear();

  const linkStyle = {
    color: 'rgba(var(--fg),0.42)',
    textDecoration: 'none',
    fontSize: 13,
    transition: 'color 0.15s',
  };
  const hover = (e, on) => { e.currentTarget.style.color = on ? `rgba(${accentRGB},0.95)` : 'rgba(var(--fg),0.42)'; };

  const Item = ({ href, onClick, children }) => (
    href
      ? <a href={href} style={linkStyle} onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}>{children}</a>
      : <button type="button" onClick={onClick}
          style={{ ...linkStyle, background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit', fontSize: 13 }}
          onMouseEnter={e => hover(e, true)} onMouseLeave={e => hover(e, false)}>{children}</button>
  );

  return (
    <footer
      className="relative z-10 px-5 md:px-10 pt-10 pb-14 max-w-7xl mx-auto mt-20 md:mt-28"
      style={{ borderTop: '1px solid rgba(var(--fg),0.08)' }}>
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-8">

        <div className="flex flex-col gap-3 shrink-0">
          <img src={isDark ? STAMP_MARK.acid : STAMP_MARK.black} alt={APP_NAME}
            style={{ height: 30, display: 'block' }} />
          <p className="text-[13px] leading-relaxed max-w-[15rem]" style={{ color: 'rgba(var(--fg),0.35)' }}>
            Your vinyl, sorted. Photograph a sleeve and the pressing files itself.
          </p>
        </div>

        <div className="flex gap-12 md:gap-16">
          <nav className="flex flex-col gap-2.5">
            <div className="text-[11px] tracking-[0.22em] uppercase font-mono mb-1"
              style={{ color: 'rgba(var(--fg),0.22)' }}>Product</div>
            <Item onClick={onOpenAbout}>About</Item>
            <Item href="/#pricing">Plans</Item>
          </nav>

          <nav className="flex flex-col gap-2.5">
            <div className="text-[11px] tracking-[0.22em] uppercase font-mono mb-1"
              style={{ color: 'rgba(var(--fg),0.22)' }}>Legal</div>
            <Item href="/terms">Terms</Item>
            <Item href="/privacy">Privacy</Item>
            <Item href="/refunds">Cancellation</Item>
          </nav>
        </div>
      </div>

      <div className="mt-10 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
        style={{ borderTop: '1px solid rgba(var(--fg),0.05)' }}>
        <span className="text-[12px]" style={{ color: 'rgba(var(--fg),0.26)' }}>
          &copy; {year} {APP_NAME}
        </span>
        <span className="text-[12px]" style={{ color: 'rgba(var(--fg),0.26)' }}>
          Release data from Discogs. Prices are estimates, not quotations.
        </span>
      </div>
    </footer>
  );
}
