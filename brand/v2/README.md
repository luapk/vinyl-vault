# Logo v2: the script lockup

A traced vector of the ornate script "Found Sound" drawing. **Nothing in the
app uses it.** It was traced and auditioned on the real screens, and the
audition is written down below, because the result decides where it can and
cannot go.

Nothing here is wired into `src/` and nothing is copied into `public/`. The
shipped marks are still the ones `../stamp.py` and `../stacked.py` generate.

## What is here

| File | What it is |
| --- | --- |
| `traces/union.svg` | every inked pixel, keyline included |
| `traces/cream.svg` | the pale inner ribbon alone |
| `traces/acid.svg` | the acid fill alone (union minus cream) |
| `compose.py` | the three layers -> the six colourways in `out/` |
| `trace.sh` | the separation recipe, for re-running from a raster |
| `out/script-*.svg` | generated; do not hand-edit |

The original raster is not in the repo, exactly as with `../traces/`: the
three files in `traces/` are the source of truth for these letterforms.
`trace.sh` documents how they were separated so the recipe can be argued with,
but it needs artwork that this repo does not hold.

`compose.py` is deterministic. Running it reproduces all six files in `out/`
byte for byte, which is the check to run after touching anything here.

## The six colourways

`script-full` is the three-tone treatment as drawn. The three single-colour
versions fill the **acid** path rather than the union, which matters more here
than on a normal wordmark: this script overlaps its own strokes constantly,
and the pale ribbon is the only thing separating them. Filling the union
instead merges every overlap and the lettering collapses into a blob. The two
`-keyed` versions are lettering plus keyline with no inner fill distinction.

The keyline is not traced. It sits outside the lettering in the original, so
`compose.py` regenerates it by stroking the union path and painting it behind
everything. That gives a clean, adjustable keyline instead of a traced
approximation of a drop shadow, and it is what lets the whole lockup be
re-weighted or flattened to one colour at all.

## The audition, and what it rules out

Auditioned on the three screens the mark actually appears on, in the real app
in a real browser rather than on a sheet.

- **Splash, 300px: excellent.** It is the best the brand has looked. It shares
  an ink-outline cartoon vocabulary with the crate mascot directly beneath it,
  which the geometric block lockup does not, so the two read as one drawing
  instead of a logo above an illustration.
- **Auth screen: good.** Same reasoning, with room to breathe.
- **Header, 48px tall (61x48 as rendered): unreadable.** It is a green
  squiggle. Not "tight but legible": the counters close, the ribbon separating
  the overlapping strokes disappears, and FOUND and SOUND stop being two
  words.

The size ramp puts the floor at roughly **110px wide**. Below that the inner
ribbon is under a pixel and the thing that makes the script readable is gone.
The header gives it 61px.

So this cannot replace the stacked block in the nav, and the stacked block was
chosen for the nav on exactly this kind of measurement (see the top of
`CLAUDE.md`: 132.5px of a 360px top bar down to 64px, which is what stopped
the nav row scrolling sideways). If the script is ever adopted it is as a
**large-format lockup alongside** the block, not instead of it: splash, auth,
About, print, merch, the app store listing. Two marks with a size rule
between them, which is an ordinary thing for a brand to have.

The texture of the original drawing (the grain inside the strokes) is
deliberately dropped. It does not survive a two-colour separation, it would
not survive being rendered at 61px either, and it is not something a vector
mark should be carrying.
