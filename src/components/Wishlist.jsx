import { useState, useMemo } from 'react';
import {
  MagnifyingGlass, Crosshair, Trash, CaretDown, CaretRight, Plus, LockSimple, X, ArrowUpRight,
} from '@phosphor-icons/react';
import { useWishlist } from '../hooks/useWishlist.js';
import { countryLabel, DISCOGS_COUNTRIES } from '../lib/countryFlag.js';

// The Wishlist tab: records you want, and what each one actually costs.
//
// One tab rather than two. A wishlist without live state is a graveyard, and a
// hunting tool with nowhere to keep its answers makes you re-run it. Pinning
// the record and hunting it are the same object at two moments, so they are the
// same screen: search, pin, trace, and the answer stays under the card.
//
// Look and feel is the app's own, not a separate visual world. Same glass
// cards, same mono kickers, same serif titles as the scan and collection
// screens, because a tab that looks like a different application reads as one.

const ACID = '#CAFE04';
const ACID_ON_PAPER = '#6E8A00';

// ----- Radar ----------------------------------------------------------------
// Shown while a hunt runs. Sized by the caller so the same component works as a
// 20px button glyph and as a 56px panel centrepiece.
function Radar({ size = 56, colour }) {
  return (
    <div className="vv-radar" style={{ width: size, height: size, '--vv-radar-colour': colour }} aria-hidden="true">
      <span className="vv-radar-ring" />
      <span className="vv-radar-ping" />
      <span className="vv-radar-ping" />
      <span className="vv-radar-ping" />
      <span className="vv-radar-sweep" />
      <span className="vv-radar-dot" />
    </div>
  );
}

const money = (n) => `£${Number(n).toFixed(2)}`;

function timeAgo(iso) {
  if (!iso) return '';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
  const days = Math.round(hrs / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

// ----- The stored answer ----------------------------------------------------
// Every figure on this panel names where it came from. That is the house rule,
// and it is also the only thing that makes a number about somebody's money
// worth showing: the user can check it rather than trust it.
function TracePanel({ payload, isLight, onClear }) {
  const { cost, floorCost, market, pressings, verdict, recourse, sources, checkedAt, releaseId } = payload;
  const forSale = market.totalListings > 0;
  const accent = isLight ? ACID_ON_PAPER : ACID;
  // The bar is two-tone, not a five-hue breakdown. Validated against the
  // dataviz palette checks: one accent plus one neutral clears the CVD and
  // normal-vision separation floors with room, where three or more greys at
  // this size do not. It also tells the truer story, which is the ratio between
  // the record and the freight rather than a league table of fees.
  const neutral = isLight ? 'rgba(10,10,13,0.45)' : 'rgba(255,255,255,0.45)';
  const line = 'rgba(var(--fg),0.10)';
  const pct = cost?.split ? Math.max(4, Math.min(96, (cost.split.item / cost.total) * 100)) : 0;

  return (
    <div className="mt-3 rounded-2xl overflow-hidden" style={{ border: `1px solid ${line}`, background: 'rgba(var(--fg),0.03)' }}>
      <div className="px-4 pt-3.5 pb-4">
        {/* One meta row carries supply and stance. It used to be a headline, a
            separate two-column stat block, and a bullet, all saying the same
            two numbers. */}
        <div className="flex items-center gap-2 flex-wrap text-[10px] tracking-[0.2em] uppercase font-mono mb-3">
          <span style={{ color: accent }}>{verdict.stance}</span>
          <span className="text-white/20">/</span>
          <span className="text-white/40">{market.totalListings} listed</span>
          <span className="text-white/20">/</span>
          <span className="text-white/40">{pressings.total} pressing{pressings.total === 1 ? '' : 's'}</span>
        </div>

        {/* The hero number. It appears exactly once now: the old panel printed
            it in the header and again as a Total under the table. */}
        {cost ? (
          <>
            <div className="flex items-baseline gap-2.5">
              {cost.grade && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono shrink-0 self-center"
                  style={{ background: `${accent}22`, border: `1px solid ${accent}66`, color: accent }}>
                  {cost.grade}
                </span>
              )}
              <span className="text-[34px] leading-none font-display tabular-nums">{money(cost.total)}</span>
              <span className="text-[11px] font-mono text-white/35">landed</span>
            </div>
            <div className="text-[11.5px] text-white/35 mt-1.5">
              {cost.gradeNote}{cost.domestic ? '' : ` · ${cost.corridor} origin`}
            </div>

            {/* Part to whole: what is the record, and what is getting it here.
                2px surface gap between the segments rather than a stroke. */}
            <div className="mt-4" role="img"
              aria-label={`Of ${money(cost.total)} landed, ${money(cost.split.item)} is the record and ${money(cost.split.friction)} is getting it here`}>
              <div className="flex h-2.5 w-full rounded-full overflow-hidden" style={{ gap: 2 }}>
                <div style={{ width: `${pct}%`, background: accent, borderRadius: '999px 0 0 999px' }} />
                <div style={{ flex: 1, background: neutral, borderRadius: '0 999px 999px 0' }} />
              </div>
              {/* Legend, direct-labelled. Identity is never colour alone, which
                  is also what makes the two-tone bar legal at this size. */}
              <div className="mt-2.5 flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: accent }} />
                  <span className="text-white/55">The record</span>
                  <span className="flex-1 border-b border-dashed self-end mb-1" style={{ borderColor: 'rgba(var(--fg),0.10)' }} />
                  <span className="font-mono tabular-nums text-white/80">{money(cost.split.item)}</span>
                </div>
                <div className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="w-2 h-2 rounded-full shrink-0 self-center" style={{ background: neutral }} />
                  <span className="text-white/55">Getting it here</span>
                  <span className="flex-1 border-b border-dashed self-end mb-1" style={{ borderColor: 'rgba(var(--fg),0.10)' }} />
                  <span className="font-mono tabular-nums text-white/80">{money(cost.split.friction)}</span>
                </div>
                {cost.split.parts.length > 0 && (
                  <div className="text-[10.5px] font-mono text-white/28 pl-4 leading-relaxed">
                    {cost.split.parts.map(x => `${x.label} ${money(x.value)}`).join('  ·  ')}
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="text-[19px] font-display">{verdict.headline}</div>
        )}
      </div>

      {/* Three things an asking price hides, each said once. */}
      <div className="grid grid-cols-3" style={{ borderTop: `1px solid ${line}` }}>
        {[
          floorCost
            ? { k: 'Cheapest', v: money(floorCost.total), sub: 'grade not stated' }
            : { k: 'Cheapest', v: '--', sub: 'none listed' },
          cost
            ? { k: 'To hand', v: `${cost.daysMin}-${cost.daysMax}`, sub: 'days' }
            : { k: 'To hand', v: '--', sub: '' },
          {
            k: 'Returns',
            v: { strong: 'Easy', fair: 'Fair', weak: 'Hard' }[recourse.level],
            sub: { strong: 'UK rights', fair: 'postage on you', weak: 'costly to send back' }[recourse.level],
          },
        ].map((t, i) => (
          <div key={t.k} className="px-3 py-3" style={i < 2 ? { borderRight: `1px solid ${line}` } : undefined}>
            <div className="text-[9.5px] tracking-[0.18em] uppercase font-mono text-white/28 mb-1.5">{t.k}</div>
            <div className="text-[16px] font-display leading-none tabular-nums">{t.v}</div>
            <div className="text-[10px] font-mono text-white/28 mt-1 leading-tight">{t.sub}</div>
          </div>
        ))}
      </div>

      {/* The ladder Discogs has actually sold copies at. Ordered best first, so
          it doubles as the scale the headline grade sits on. */}
      {market.conditions.length > 0 && (
        <div className="px-4 py-3" style={{ borderTop: `1px solid ${line}` }}>
          <div className="text-[9.5px] tracking-[0.18em] uppercase font-mono text-white/28 mb-2">
            Sells for, in {market.currency || 'USD'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {market.conditions.map(c => (
              <span key={c.grade} className="px-2 py-0.5 rounded-full text-[11.5px] font-mono"
                style={c.grade === cost?.grade
                  ? { background: `${accent}1f`, border: `1px solid ${accent}55`, color: accent }
                  : { background: 'rgba(var(--fg),0.05)', border: `1px solid ${line}`, color: 'rgba(var(--fg),0.5)' }}>
                {c.grade} {c.value}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Judgement only. Anything the figures above already state has been cut. */}
      {verdict.notes.length > 0 && (
        <div className="px-4 py-3 flex flex-col gap-1.5" style={{ borderTop: `1px solid ${line}` }}>
          {verdict.notes.map((n, i) => (
            <div key={i} className="text-[12.5px] leading-relaxed text-white/45">{n}</div>
          ))}
        </div>
      )}

      <div className="px-4 pt-3 pb-4" style={{ borderTop: `1px solid ${line}` }}>
        {releaseId && (
          <a
            href={`https://www.discogs.com/sell/release/${releaseId}`}
            target="_blank" rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 rounded-full transition-all hover:brightness-110"
            style={{
              padding: '11px 0', fontSize: 13, fontWeight: 600, letterSpacing: '0.1em',
              textTransform: 'uppercase', fontFamily: 'monospace', textDecoration: 'none',
              background: forSale ? (isLight ? '#08080c' : accent) : 'transparent',
              color: forSale ? (isLight ? '#ffffff' : '#08080c') : 'rgba(var(--fg),0.55)',
              border: forSale ? 'none' : '1px solid rgba(var(--fg),0.16)',
            }}>
            {forSale ? 'Buy now on Discogs' : 'See it on Discogs'}
            <ArrowUpRight size={14} weight="bold" />
          </a>
        )}
        {/* Provenance, one line. The long disclaimer paragraph said the origin,
            the transit window and the recourse a second time; all three are
            figures on the card now, so only the caveat itself is left. */}
        <div className="mt-3 flex items-baseline justify-between gap-3 flex-wrap">
          <div className="text-[10px] font-mono text-white/25 min-w-0 leading-relaxed">
            Estimate, not a quote. Discogs reports where a pressing was made, not where this copy is.
            <br />{sources.join(' · ')} · {timeAgo(checkedAt)}
          </div>
          <button onClick={onClear}
            className="text-[10px] font-mono text-white/25 hover:text-white/60 transition-colors shrink-0"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

// ----- One wanted record ----------------------------------------------------
function WishlistRow({ item, trace, tracing, isLight, canTrace, onTrace, onRemove, onClear }) {
  const [open, setOpen] = useState(true);
  const accent = isLight ? ACID_ON_PAPER : ACID;
  const meta = [item.year, item.catNo, item.format].filter(Boolean).join(' · ');

  return (
    <div className="rounded-2xl p-3.5 sm:p-4" style={{
      background: 'rgba(var(--fg),0.045)',
      border: '1px solid rgba(var(--fg),0.09)',
    }}>
      <div className="flex items-start gap-3.5">
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-xl overflow-hidden shrink-0"
          style={{ background: 'rgba(var(--fg),0.07)' }}>
          {item.coverUrl
            ? <img src={item.coverUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
            : <div className="w-full h-full flex items-center justify-center text-white/20"><MagnifyingGlass size={18} /></div>}
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-[15px] sm:text-[17px] leading-snug font-display truncate">{item.title || item.rawQuery || 'Unmatched'}</div>
          <div className="text-[13px] text-white/45 truncate">{item.artist}</div>
          <div className="text-[11px] font-mono text-white/28 mt-1 truncate">
            {item.label ? `${item.label} · ` : ''}{meta}
            {item.country ? ` · ${countryLabel(item.country)}` : ''}
          </div>
          {!item.releaseId && (
            <div className="text-[11px] font-mono mt-1.5" style={{ color: accent }}>
              Cold case. Nothing matched this yet, so there is nothing to trace.
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {item.releaseId && (
            <button
              onClick={() => (canTrace ? onTrace(item) : onTrace(item, true))}
              disabled={tracing}
              aria-label={trace ? 'Trace again' : 'Trace this record'}
              title={canTrace ? (trace ? 'Trace again' : 'Trace this record') : 'Trace is a Resident feature'}
              className="w-10 h-10 rounded-full flex items-center justify-center transition-all hover:brightness-110"
              style={{
                background: tracing ? 'transparent' : (isLight ? '#08080c' : ACID),
                border: tracing ? '1px solid rgba(var(--fg),0.12)' : 'none',
                cursor: tracing ? 'default' : 'pointer',
              }}>
              {tracing
                ? <Radar size={22} colour={accent} />
                : <span className="relative">
                    <Crosshair size={19} weight="bold" style={{ color: isLight ? '#ffffff' : '#08080c' }} />
                    {!canTrace && (
                      <span style={{ position: 'absolute', top: -5, right: -7, width: 13, height: 13, borderRadius: 7, background: 'rgba(var(--bg),0.95)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgba(var(--fg),0.6)' }}>
                        <LockSimple size={9} weight="fill" />
                      </span>
                    )}
                  </span>}
            </button>
          )}
          <button onClick={() => onRemove(item.id)} aria-label="Remove from wishlist"
            className="w-9 h-9 rounded-full flex items-center justify-center text-white/25 hover:text-white/60 transition-colors"
            style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <Trash size={16} />
          </button>
        </div>
      </div>

      {tracing && (
        <div className="mt-3.5 rounded-2xl px-4 py-6 flex flex-col items-center gap-3"
          style={{ border: '1px solid rgba(var(--fg),0.09)', background: 'rgba(var(--fg),0.02)' }}>
          <Radar size={56} colour={accent} />
          <div className="text-[12px] font-mono tracking-[0.16em] uppercase text-white/35">Sweeping</div>
          <div className="text-[12px] text-white/30">Pressings, live listings and what it lands at</div>
        </div>
      )}

      {!tracing && trace && (
        <>
          <button onClick={() => setOpen(o => !o)}
            className="mt-3 flex items-center gap-1.5 text-[11px] font-mono tracking-[0.14em] uppercase text-white/30 hover:text-white/55 transition-colors"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            {open ? <CaretDown size={11} /> : <CaretRight size={11} />}
            {open ? 'Hide result' : `Result · ${trace.cost ? money(trace.cost.total) : 'no listings'}`}
          </button>
          {open && <TracePanel payload={trace} isLight={isLight} onClear={() => onClear(item.id)} />}
        </>
      )}
    </div>
  );
}

// ----- The tab --------------------------------------------------------------
export default function WishlistView({ userId, accessToken, isLight, canTrace, onUpsell }) {
  const { items, traces, tracing, loading, syncOff, addItem, removeItem, runTrace, clearTrace } = useWishlist(userId);

  const [artist, setArtist] = useState('');
  const [title, setTitle] = useState('');
  const [catno, setCatno] = useState('');
  const [country, setCountry] = useState('');
  const [results, setResults] = useState(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(null);

  const accent = isLight ? ACID_ON_PAPER : ACID;
  const canSearch = !!(artist.trim() || title.trim() || catno.trim());
  const fieldStyle = { background: 'rgba(var(--fg),0.04)', border: '1px solid rgba(var(--fg),0.10)' };

  const rawQuery = useMemo(
    () => [artist.trim(), title.trim(), catno.trim()].filter(Boolean).join(' · '),
    [artist, title, catno],
  );

  const search = async (e) => {
    e?.preventDefault();
    if (!canSearch || searching) return;
    setSearching(true); setError(null); setResults(null);
    try {
      const res = await fetch('/api/discogs-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artist: artist.trim(), title: title.trim(), catalogNumber: catno.trim(), country: country.trim() }),
      });
      const data = await res.json();
      // A rate limit is not an answer about a record. Never let a 429 render as
      // "no matches", which is what would make somebody pin a cold case that
      // Discogs could have resolved a minute later.
      if (!res.ok) throw new Error(data.error || `Search failed (${res.status})`);
      setResults(data.matches || []);
    } catch (err) {
      setError(`${err.message} Try again in a moment.`);
    }
    setSearching(false);
  };

  const pin = async (candidate) => {
    await addItem(candidate, rawQuery);
    setResults(null);
    setArtist(''); setTitle(''); setCatno(''); setCountry('');
  };

  // Pin what the user typed even though nothing matched. Being told the tool
  // does not recognise your record and then being given nowhere to put it is
  // worse than the tool simply not knowing.
  const pinUnmatched = async () => {
    await addItem({ artist: artist.trim(), title: title.trim(), catalogNumber: catno.trim(), country: country.trim() }, rawQuery);
    setResults(null);
    setArtist(''); setTitle(''); setCatno(''); setCountry('');
  };

  const [traceError, setTraceError] = useState(null);
  const handleTrace = async (item, locked = false) => {
    if (locked || !canTrace) { onUpsell?.(); return; }
    setTraceError(null);
    const out = await runTrace(item, accessToken);
    if (out?.locked) { onUpsell?.(); return; }
    if (out?.error) setTraceError(out.error);
  };

  return (
    <div className="pt-8 md:pt-12 max-w-3xl mx-auto w-full" style={{ animation: 'fadeUp 0.4s ease-out' }}>
      <div className="mb-7 md:mb-9">
        <div className="text-[13px] tracking-[0.35em] uppercase mb-4 text-white/30 font-mono">Wishlist</div>
        <h1 className="text-[34px] md:text-[46px] leading-[0.98] mb-3 font-display tracking-tight">
          Track down<br /><span className="text-white/35">the records you need.</span>
        </h1>
        <p className="text-white/45 text-sm max-w-lg leading-relaxed">
          Add what you are hunting, then trace it. You get the pressings that exist, what is for sale,
          and the price with shipping, VAT and fees already in it.
        </p>
      </div>

      {/* Type what you can read. The same fields as the manual scan search,
          because a catalogue number scrawled on a white label is the commonest
          thing a collector actually has to go on. */}
      <form onSubmit={search} className="flex flex-col gap-3 mb-7">
        <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/30">Type what you can read</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Artist"
            aria-label="Artist"
            className="w-full rounded-full px-4 py-2.5 text-[15px] font-mono text-white/75 placeholder-white/25 outline-none transition-all" style={fieldStyle} />
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Release or track title"
            aria-label="Release or track title"
            className="w-full rounded-full px-4 py-2.5 text-[15px] font-mono text-white/75 placeholder-white/25 outline-none transition-all" style={fieldStyle} />
          <input value={catno} onChange={e => setCatno(e.target.value)} placeholder="Catalogue number"
            aria-label="Catalogue number"
            className="w-full rounded-full px-4 py-2.5 text-[15px] font-mono text-white/75 placeholder-white/25 outline-none transition-all" style={fieldStyle} />
          <input value={country} onChange={e => setCountry(e.target.value)} placeholder="Country"
            aria-label="Country" list="vv-wishlist-countries" autoComplete="off"
            className="w-full rounded-full px-4 py-2.5 text-[15px] font-mono text-white/75 placeholder-white/25 outline-none transition-all" style={fieldStyle} />
          <datalist id="vv-wishlist-countries">
            {DISCOGS_COUNTRIES.map(c => <option key={c} value={c} />)}
          </datalist>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!canSearch || searching}
            className="vv-search-btn inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-[14px] tracking-[0.1em] uppercase font-mono transition-all disabled:opacity-40">
            <MagnifyingGlass size={14} weight="bold" />{searching ? 'Searching...' : 'Find it'}
          </button>
          {results && (
            <button type="button" onClick={() => { setResults(null); setError(null); }}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full text-[13px] tracking-[0.1em] uppercase font-mono transition-colors"
              style={{ background: 'transparent', border: '1px solid rgba(var(--fg),0.14)', color: 'rgba(var(--fg),0.55)', cursor: 'pointer' }}>
              <X size={12} /> Clear
            </button>
          )}
        </div>
      </form>

      {error && <p className="text-[14px] font-mono text-red-300/80 mb-6">{error}</p>}

      {results && (
        <div className="mb-8">
          <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/30 mb-3">
            {results.length ? `${results.length} match${results.length === 1 ? '' : 'es'}. Pick the pressing you want` : 'No match'}
          </div>
          {results.length > 0 ? (
            <div className="grid sm:grid-cols-2 gap-2.5">
              {results.map(c => (
                <button key={c.id} onClick={() => pin(c)}
                  className="flex items-center gap-3 p-3 rounded-2xl text-left transition-all hover:brightness-110"
                  style={{ background: 'rgba(var(--fg),0.045)', border: '1px solid rgba(var(--fg),0.09)', cursor: 'pointer' }}>
                  <div className="w-12 h-12 rounded-lg overflow-hidden shrink-0" style={{ background: 'rgba(var(--fg),0.07)' }}>
                    {(c.coverUrl || c.thumb) && <img src={c.coverUrl || c.thumb} alt="" className="w-full h-full object-cover" loading="lazy" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    {/* searchDiscogs splits "Artist - Title" into `artist` and
                        `recordTitle`. Reading `title` here left the name of the
                        record blank on every card. */}
                    <div className="text-[14px] font-display truncate">{c.recordTitle || c.title}</div>
                    <div className="text-[12px] text-white/45 truncate">{c.artist}</div>
                    <div className="text-[11px] font-mono text-white/28 truncate">
                      {[c.year, c.label, c.catalogNumber].filter(Boolean).join(' · ')}
                      {c.country ? ` · ${countryLabel(c.country)}` : ''}
                    </div>
                  </div>
                  <Plus size={16} className="text-white/30 shrink-0" />
                </button>
              ))}
            </div>
          ) : (
            <button onClick={pinUnmatched}
              className="w-full p-4 rounded-2xl text-left transition-all hover:brightness-110"
              style={{ background: 'rgba(var(--fg),0.045)', border: '1px solid rgba(var(--fg),0.09)', cursor: 'pointer' }}>
              <div className="text-[15px] font-display">Add it anyway</div>
              <div className="text-[12px] text-white/40 mt-0.5">
                Keeps what you typed as a cold case. Trace needs a matched release, so this one waits until it resolves.
              </div>
            </button>
          )}
        </div>
      )}

      {traceError && <p className="text-[14px] font-mono text-red-300/80 mb-5">{traceError}</p>}

      {syncOff && (
        <p className="text-[12px] font-mono text-white/30 mb-5">
          Saving on this device only. The wishlist tables have not been created on the database yet.
        </p>
      )}

      {/* The list */}
      {loading && items.length === 0 ? (
        <p className="text-[13px] font-mono text-white/25">Loading...</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl p-6 text-center" style={{ background: 'rgba(var(--fg),0.03)', border: '1px dashed rgba(var(--fg),0.12)' }}>
          <div className="flex justify-center mb-3"><Radar size={40} colour={accent} /></div>
          <div className="text-[17px] font-display mb-1">Nothing on the hunt yet</div>
          <p className="text-[13px] text-white/40 max-w-sm mx-auto leading-relaxed">
            Add a record above. Once it is on the list, the crosshair traces it: every pressing,
            every copy for sale, and the real price to your door.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/30">
            {items.length} on the hunt
          </div>
          {items.map(item => (
            <WishlistRow
              key={item.id}
              item={item}
              trace={traces[item.id]}
              tracing={!!tracing[item.id]}
              isLight={isLight}
              canTrace={canTrace}
              onTrace={handleTrace}
              onRemove={removeItem}
              onClear={clearTrace}
            />
          ))}
        </div>
      )}
    </div>
  );
}
