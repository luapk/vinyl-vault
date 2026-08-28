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
  const { cost, market, pressings, verdict, recourse, sources, checkedAt, releaseId } = payload;
  const forSale = market.totalListings > 0;
  const accent = isLight ? ACID_ON_PAPER : ACID;
  const line = 'rgba(var(--fg),0.10)';

  return (
    <div className="mt-3 rounded-2xl overflow-hidden" style={{ border: `1px solid ${line}`, background: 'rgba(var(--fg),0.03)' }}>
      {/* Verdict */}
      <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${line}` }}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] tracking-[0.22em] uppercase font-mono mb-1" style={{ color: accent }}>
              {verdict.stance}
            </div>
            <div className="text-[19px] leading-snug font-display">{verdict.headline}</div>
          </div>
          {cost && (
            <div className="text-right shrink-0">
              <div className="text-[24px] leading-none font-display">{money(cost.total)}</div>
              <div className="text-[11px] font-mono mt-1 text-white/40">landed</div>
            </div>
          )}
        </div>

        {/* Straight to the copies of THIS pressing, not to the master, which
            is where a Discogs search would otherwise dump you. The label tells
            the truth about what is on the other side: with nothing listed
            there is nothing to buy, and calling it "Buy now" would be a lie
            the next tap exposes. */}
        {releaseId && (
          <a
            href={`https://www.discogs.com/sell/release/${releaseId}`}
            target="_blank" rel="noopener noreferrer"
            className="mt-3.5 w-full flex items-center justify-center gap-2 rounded-full transition-all hover:brightness-110"
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
        {verdict.notes.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1.5">
            {verdict.notes.map((n, i) => (
              <li key={i} className="text-[13px] leading-relaxed text-white/50 flex gap-2">
                <span style={{ color: accent }}>·</span>{n}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* The arithmetic, in full. A total nobody can check is a claim. */}
      {cost && (
        <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${line}` }}>
          <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/30 mb-2.5">What it costs to your door</div>
          <div className="flex flex-col gap-1.5">
            {cost.lines.map(l => (
              <div key={l.label} className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="text-white/55 shrink-0">{l.label}</span>
                {l.note && <span className="text-[11px] font-mono text-white/25 truncate flex-1 text-right">{l.note}</span>}
                <span className="font-mono tabular-nums shrink-0" style={{ minWidth: 62, textAlign: 'right', color: l.value ? 'rgba(var(--fg),0.8)' : 'rgba(var(--fg),0.3)' }}>
                  {money(l.value)}
                </span>
              </div>
            ))}
            <div className="flex items-baseline justify-between gap-3 mt-1.5 pt-2.5" style={{ borderTop: `1px solid ${line}` }}>
              <span className="text-[13px]">Total</span>
              <span className="font-mono tabular-nums text-[15px]" style={{ color: accent }}>{money(cost.total)}</span>
            </div>
          </div>
          <p className="text-[11px] leading-relaxed text-white/30 mt-3">
            An estimate. Discogs reports where a pressing was made, not where this copy sits, so
            shipping is priced from a {cost.corridor} origin. {cost.daysMin} to {cost.daysMax} days
            typical. Recourse: {recourse.note}.
          </p>
        </div>
      )}

      {/* Market and pressings */}
      <div className="px-4 py-3.5 grid grid-cols-2 gap-4" style={{ borderBottom: `1px solid ${line}` }}>
        <div>
          <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/30 mb-2">For sale</div>
          <div className="text-[19px] font-display leading-none">{market.totalListings}</div>
          <div className="text-[12px] text-white/40 mt-1">
            {market.floor ? `from ${market.floor.value} ${market.floor.currency}` : 'no live listings'}
          </div>
        </div>
        <div>
          <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/30 mb-2">Pressings</div>
          <div className="text-[19px] font-display leading-none">{pressings.total}</div>
          <div className="text-[12px] text-white/40 mt-1 truncate">
            {pressings.byCountry.slice(0, 3).map(c => `${c.country} ${c.n}`).join(', ') || 'one known'}
          </div>
        </div>
      </div>

      {/* What it sells for by condition. Discogs' own sales history, which is
          the only benchmark available without scraping anybody. */}
      {market.conditions.length > 0 && (
        <div className="px-4 py-3.5" style={{ borderBottom: `1px solid ${line}` }}>
          <div className="text-[11px] tracking-[0.22em] uppercase font-mono text-white/30 mb-2.5">Sells for, by condition</div>
          <div className="flex flex-wrap gap-1.5">
            {market.conditions.map(c => (
              <span key={c.grade} className="px-2.5 py-1 rounded-full text-[12px] font-mono"
                style={{ background: 'rgba(var(--fg),0.06)', border: `1px solid ${line}` }}>
                {c.grade} <span className="text-white/45">{c.value}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Provenance */}
      <div className="px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
        <div className="text-[11px] font-mono text-white/25 min-w-0">
          Checked {timeAgo(checkedAt)} · {sources.join(' · ')}
        </div>
        <button onClick={onClear}
          className="text-[11px] font-mono text-white/30 hover:text-white/60 transition-colors shrink-0">
          Clear result
        </button>
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
          Records you are after.<br /><span className="text-white/35">And what they really cost.</span>
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
