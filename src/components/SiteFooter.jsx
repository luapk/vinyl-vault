import { APP_NAME } from '../lib/brand.js';

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
// opens them signed out, and when Stripe's reviewer loads them cold. So they
// are real links, while in-app destinations are buttons.
//
// Three things here were wrong the first time and are worth not repeating:
//
//   There is no logo here. There was: the full stamp at 58px, which was the
//   largest object in the footer and the first thing the eye landed on, to
//   say a name the sticky header is already showing at the top of the same
//   screen and the copyright line repeats at the bottom of this one. Three
//   statements of the name on one screen is two too many, and the one that
//   earned its place least was the one taking the most room. The links are
//   what this component is for.
//
//   A <button> centres its text and an <a> does not, so a column mixing the two
//   came out visibly ragged. Every item is forced to the same alignment and
//   the same type rather than trusting the defaults.
//
//   Plans pointed at "/#pricing", which is an anchor to nothing. Pricing is a
//   modal in this app, so it has to be a callback.
export default function SiteFooter({ accentRGB, onOpenAbout, onOpenPlans }) {
  const year = new Date().getFullYear();

  const itemStyle = {
    display: 'block',
    textAlign: 'left',
    width: '100%',
    padding: 0,
    margin: 0,
    border: 'none',
    background: 'none',
    font: 'inherit',
    fontSize: 14,
    lineHeight: 1.5,
    color: 'rgba(var(--fg),0.45)',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'color 0.15s',
  };
  const over = (e, on) => {
    e.currentTarget.style.color = on ? `rgba(${accentRGB},0.95)` : 'rgba(var(--fg),0.45)';
  };

  const Item = ({ href, onClick, children }) => (
    href
      ? <a href={href} style={itemStyle} onMouseEnter={e => over(e, true)} onMouseLeave={e => over(e, false)}>{children}</a>
      : <button type="button" onClick={onClick} style={itemStyle}
          onMouseEnter={e => over(e, true)} onMouseLeave={e => over(e, false)}>{children}</button>
  );

  const Heading = ({ children }) => (
    <div className="text-[11px] tracking-[0.22em] uppercase font-mono mb-3"
      style={{ color: 'rgba(var(--fg),0.25)' }}>{children}</div>
  );

  return (
    <footer
      className="relative z-10 px-5 md:px-10 pt-12 pb-14 max-w-7xl mx-auto mt-20 md:mt-28"
      style={{ borderTop: '1px solid rgba(var(--fg),0.08)' }}>

      <div className="flex flex-col md:flex-row md:items-start gap-12">
        <div className="flex gap-16 sm:gap-24">
          <nav className="flex flex-col gap-2.5 items-start">
            <Heading>Product</Heading>
            <Item onClick={onOpenAbout}>About</Item>
            <Item onClick={onOpenPlans}>Plans</Item>
          </nav>

          <nav className="flex flex-col gap-2.5 items-start">
            <Heading>Legal</Heading>
            <Item href="/terms">Terms</Item>
            <Item href="/privacy">Privacy</Item>
            <Item href="/refunds">Cancellation</Item>
          </nav>
        </div>
      </div>

      <div className="mt-12 pt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
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
