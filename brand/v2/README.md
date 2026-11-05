# Logo v2: the script lockup

A traced vector of the ornate script "Found Sound" drawing. **Nothing in the
app uses it.** It is traced, cleaned and colour-wayed here so it can be
adopted later without redoing any of this. The audition findings, including
the one that decides where it can go, are at the bottom.

## The artwork is four layers, and the trace keeps them

The drawing is a sticker, and the depth in it is structural rather than an
effect. From the back forward:

1. a **black ground**, the sticker body
2. an **acid keyline** around that ground
3. the **acid letters**, floating in the ground with black between them
4. a **cream hairline** inset inside the letters: the bevel that makes the
   lettering read as rounded rather than flat

Three bitmaps carry all four, because (2) and (3) are the same colour and so
trace as one path:

| `traces/` | What it is |
| --- | --- |
| `body.svg` | the filled silhouette: ground plus keyline |
| `ink.svg` | the keyline and the letters |
| `cream.svg` | the bevel |

The first version of this trace flattened all of that into one silhouette and
an outline, which threw the depth away: it came back as a flat acid shape with
a pale edge, nothing behind the letters, and no sticker. The layers are the
whole point of the drawing, so they are what gets traced.

## Separation

`build.py` does it. Luminance alone cannot tell the acid fill from the cream
bevel, so the split is by **saturation**: inked pixels cluster at S 0.15-0.40
(cream) and S 0.65-0.98 (acid) with a clear valley between, and the threshold
sits in that valley. Luminance only decides what is inked at all.

The ground cannot be thresholded for directly, because the artwork's
background is dark too. It is derived instead: take the keyline loop and fill
its interior. **The artwork is cropped on the left**, so the loop runs off the
canvas and a flood fill leaks straight out of it; `build.py` walls off that
opening before filling. See the known issue below.

Each layer is then supersampled 4x, opened and closed to drop spurs and
notches, and softened, so the contour lands on a sub-pixel position instead of
following the stair-steps of a 1052px raster. The layers get different
treatment: the bevel is a hairline and is barely opened at all, because the
radius that tidies the letters erases it.

## Cleanups applied on top

- **The flourish above the "o" of Sound is one line.** A detached blob sat
  beside it; it is dropped, so the flourish reads as a single stroke.
- **The specks are gone.** Five grain islands, the largest 32x21px, scattered
  through the F bowl, the S bowl and around the "n" of Found. They are listed
  by component id in `DROP` in `build.py`, so any of them can be put back by
  deleting one number.
- **The crossing above the "u" of Found is smoothed.** Where the F's tail
  crosses the flourish, the source is soft and it traced with a stepped,
  notched foot. That one box gets a heavier closing and blur. It is blended
  through a feathered window rather than applied inside a rectangle: a hard
  box leaves its own outline printed across the mark, because the contour
  lands a fraction of a pixel differently on each side of the boundary. That
  happened, and the seam was visible.

## Colourways

`out/`, all generated:

| File | Ground | Letters | Bevel |
| --- | --- | --- | --- |
| `script-full` | ink | acid | cream |
| `script-paper` | paper | acid | ink |
| `script-acid-ink` | ink | acid | - |
| `script-ink-acid` | acid | ink | - |
| `script-black` / `-white` / `-acid` | - | that colour | - |
| `script-black-bevel` / `-white-bevel` | - | that colour | knocked out |

The one-colour versions carry no ground, so whatever is behind them shows
through between the keyline and the letters. That is what makes `script-black`
work on acid and `script-white` work on ink: the structure survives with one
ink, because the ground is the page.

## Regenerating

```
pip install numpy scipy pillow
./trace.sh
```

Deterministic: a clean run reproduces `traces/*.svg` and `out/*.svg` byte for
byte, which is the check to run after touching anything here.
`source/script-artwork.png` is the artwork the trace comes from and is in the
repo, unlike v1's, so the separation can actually be re-run and argued with.

## Known issue: the artwork is cropped

The left edge of the lockup runs off the left edge of the source file. Two
things are cut: the acid keyline, at two places, and the terminal of the F's
left swirl, across 45px of stroke. The keyline is walled off and filled so the
ground is correct, but the mark still ends in a straight vertical cut on that
side, which reads as a mistake at any size.

This cannot be fixed from this file. Reconstructing a swirl terminal is
drawing, not tracing, and it would be an invention sitting inside a logo.
**An uncropped original closes it**, and nothing else here needs to change.

## The audition

Auditioned in the real app in a real browser, not on a sheet.

- **Splash, 300px, `script-black` on acid: excellent.** The ground drops out
  and the acid page shows through between keyline and letters, so it reads as
  ink on acid, which is exactly the mascot's own vocabulary. The two now look
  like one drawing instead of a logo above an illustration.
- **Auth, `script-white` on ink: excellent**, the same trick the other way up.
- **Header, 48px tall (61x48 as rendered): unreadable.** A green squiggle. The
  counters close, the bevel separating the overlapping strokes disappears, and
  FOUND and SOUND stop being two words.

The size ramp puts the floor around **110px wide**. Below that the bevel is
under a pixel and the thing that makes a script readable is gone. The header
gives it 61.

So this cannot replace the stacked block in the nav, and the block was chosen
for the nav on exactly this kind of measurement (see the top of `CLAUDE.md`).
If the script is adopted it is a **large-format lockup alongside** the block,
not instead of it: splash, auth, About, print, merch, the store listing. Two
marks with a size rule between them, which is an ordinary thing for a brand to
have.

The grain texture inside the strokes is deliberately dropped. It does not
survive a two-colour separation, it would not survive 61px either, and it is
not something a vector mark should carry. If the distressed look is ever
wanted for print it belongs as a texture overlay on top of this clean vector,
which is the same call `../README.md` makes for v1.
