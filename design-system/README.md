Found Sound is a record collector's tool: scan a sleeve, identify the pressing, file it in crates, price what you are hunting. The brand is a dark room with one light on in it. Nearly everything is ink, glass and white type at measured strengths, and a single acid yellow-green marks the thing to do next. The trunk mascot carries the personality so the interface does not have to.

## Content fundamentals

- **Write like a collector talking to a collector.** Plain British English, short sentences, the vocabulary of the shop floor: crate, dig, sleeve, pressing, wax, play out, landed cost. Real copy: "Stack your wax the easy way.", "Start digging", "Every badge in the vault is yours.", "Check the pressing".
- **Sentence case** for headings, titles and buttons ("Scan a record", "Remove duplicates"). Uppercase is reserved for mono labels set in `eyebrow`, `section-label`, `label`, `kicker` and `hint`, which carry their own tracking.
- **Address the user as you**; the product never says I or we in the interface.
- **Say what happened, with the number.** "Filed 42 of 58 records" rather than silence; "discogs busy 12s" rather than "no match". A rate limit is never reported as an answer about a record.
- **Never claim more than the data supports.** Trace copy says Discogs reports where a pressing was made, not where the copy sits. A landed cost is labelled an estimate.
- **No em dashes anywhere**: copy, docs or comments. Use a colon, a full stop or a comma.
- **No emoji as decoration.** The one exception is the 🔥 hot-track toggle in a tracklist, which is a control. Country flags are content (they tell a UK pressing from a German one).
- The tagline is **"Your vinyl, sorted"**. In the product it sits once, in the home screen's eyebrow slot, in `eyebrow` at `text-faint`. Do not put it under the header logo.

## Visual foundations

### Colour

- **Dark is the default theme** (`bg` `#050508`); light is warm paper (`#f8f6f0`), never pure white. Design dark first, then check light.
- **Acid marks the primary action, not every action.** `acid` is the only filled colour on most screens, so spending it on four tiles marks nothing. One acid object per view: the hero AddCard, the primary pill, the walkthrough card, a badge.
- **Acid never sits on the light page as text or as a fill carrying text** (1.1:1). In light mode the primary action becomes `ink` with `paper` text. Use the `primary` and `on-primary` aliases, which make that swap for you.
- **Text on acid is always `ink`** or `on-acid-secondary`. Never white.
- **Hierarchy is opacity of one foreground**, not a ladder of greys: `fg`, `text-strong`, `text-secondary`, `text-muted`, `text-faint`. Small text must not go below `text-secondary` in dark mode. `text-muted` and `text-faint` fail 4.5:1 there and are kept only because the product ships them.
- **The artwork accent.** On record screens the header's active tab and a few accents take their hue from the cover art, clamped by luminance so the active tab is always the strongest of the row (`src/lib/accentContrast.js`). That accent is per record and has no token. Buttons never take it: action buttons are fixed values.
- **Status colours** (`danger`, `success`, `warning`, `live`) always travel with a word or icon. `success` in light mode is 4.0:1 and should be bold or paired.
- **Crate colours** (`crate-*`) belong to the user's crates and the tier stickers. They never appear as UI chrome. Black type on all except `crate-purple`, which needs white.

### Type

- Three families, all from Google Fonts: **Instrument Serif** (`display`) for headings, titles and track names; **Hanken Grotesk** (`sans`) for body and buttons; **JetBrains Mono** (`mono`) for every label, number and piece of metadata. Mono is the commonest face in the app by a wide margin (322 uses).
- The serif is only ever regular weight. Emphasis comes from size and from the second line dropping to `text-muted` ("Stack your wax / the easy way."), never from bold serif. Italic is reserved for `track-artist`.
- Headings use `text-wrap: balance` and `display-hero` sets tight (-0.025em, leading 0.92).
- Uppercase mono labels always carry tracking: 0.35em for the eyebrow, 0.3em for section labels, 0.2em for labels and kickers, 0.12em for hints and metadata.
- Numbers line up: `meta` with `font-variant-numeric: tabular-nums`.
- The Tailwind type scale is rescaled 1.25x (`sm` is 17.5px, `2xl` is 30px). The styles here are the rendered pixel sizes.

### Surfaces, borders and shadow

- **Glass, not cards.** Panels are a translucent gradient of the foreground (`surface-glass` to fg 0.02) over a backdrop blur (`blur-panel`), with `border` and `shadow-glass`. On the light theme the same recipe darkens instead of lightens.
- The home screen's **AddCard** is the richest surface: `surface-card`, `shadow-card` and `radius-card`. Its footer rule is `border-hairline`.
- **Sleeve art** gets `shadow-art` and `radius-md`. Keep the spread small or the shadow squares off under a rounded sleeve.
- Hairlines (`border-hairline`) separate; they do not box. The header is `header-bg` with a hairline under it.

### Shape and spacing

- **Round is the house shape**: `radius-full` pills, play buttons, avatars and status dots outnumber every other radius. Panels step up with their size: `radius-md` for rows and buttons, `radius-lg` for panels and icon tiles, `radius-card` for AddCards, `radius-xl` for the walkthrough card.
- Spacing is Tailwind's 4px scale. `space-2` is the default sibling gap; `space-4` the phone gutter; `space-5` the header gutter, rising to `space-10` at md.
- The home screen's four ways in (Scan, Photos, A file, Search) must all fit above the fold at 360 x 740.

### Motion

- Entrances rise and settle: `fadeUp` (20px, 0.3 to 0.4s ease-out); AddCards use `cubic-bezier(0.22, 1.12, 0.36, 1)` over 0.62s with a 90ms stagger per card; track rows stagger by 40ms.
- Loading is honest theatre: the Trace radar sweep (2.4s) and the scan line show what is being looked at.
- Every animation is dropped under `prefers-reduced-motion`; the element simply appears.

## Iconography

- **Phosphor** (`@phosphor-icons/react`) is the only icon set in use. Lucide is still a dependency in `package.json` but nothing imports it.
- Weights: `bold` for small inline UI icons (the commonest), `fill` for play, pause and badge icons, `regular` inside AddCard tiles, `thin` and `light` for large decorative fallbacks.
- Sizes are small and exact: 11 to 16px inline, 18px in compact tiles, 24px in the hero tile.
- Icons take their colour from the text beside them (`text-secondary` or `on-primary`). In an acid tile the glyph is `ink`; in a ghost tile it is fg at 0.8.

## Logos

Four lockups, all outlines, each in its own colourway files because an `<img>` cannot inherit `currentColor`. See the **Logos** section for the rules and sizes.

- **Block** (FOUND over SOUND in a rounded keyline): the app header, 48px tall.
- **Stamp** (horizontal lozenge with "YOUR VINYL, SORTED" beneath): footer, sign-in, pricing. Only from 48px on a 2x screen or 56px on 1x.
- **Mark** (the stamp without the subline): small and static places such as the legal pages.
- **Script** (new): FOUND SOUND in a looping script with an offset keyline. Display and marketing at large sizes only.

## Mascot

The flight-case trunk is the brand's character: an aluminium record case with a scowling face, rubber-hose arms and legs, white gloves and shoes. It is deadpan, never cheerful. See the **Mascot** section.

## Not synced

- No live components: this system holds tokens and brand only, by choice. The app's UI lives in one file (`src/components/VinylVault.jsx`) with styles inline, so there is no library to bundle.
- No font files: all three faces load from Google Fonts. `brand/fonts/Hanken_Grotesk_700.ttf` is a logo build input and is not shipped.
- Not tokenised: the `vv-glass-tile` and `vv-crate-glass` recipes use `color-mix()` and gradients, and the cover-art accent is computed per record.
- `public/favicon.svg` is still the Vinyl Vault era purple record (`#9d8df1`), which matches nothing else in the brand. It is included under App icons as found.
- The original artwork's acid measures `#b3df04`; the product and every logo file use `#cafe04`. Use `acid`.
- The GLB (`GrumpyTrunk_rigged.glb`, 19 MB) cannot be stored here; its stills are under Mascot.
