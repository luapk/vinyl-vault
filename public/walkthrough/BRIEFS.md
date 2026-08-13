# Walkthrough animation briefs

Four short loops of the Vinyl Vault mascot, one per onboarding step. Drop the
finished files in this folder with these exact names and they appear
automatically; until then each step falls back to a line icon.

| File | Step |
| --- | --- |
| `step-scan.webp` | 01 Scan the record |
| `step-confirm.webp` | 02 Check the pressing |
| `step-file.webp` | 03 File it in crates |
| `step-play.webp` | 04 Play out |

## Specification for all four

- **Character**: the Vinyl Vault mascot, an aluminium record flight case with a
  cartoon face on its front panel, white-gloved hands, white shoes, thin black
  rubber-hose arms and legs. Thick black outlines, flat black-and-white artwork
  with halftone shading on the case body. 1930s rubber-hose cartoon styling,
  the same character as the existing splash clips.
- **Background**: solid `#cafe04` acid green, edge to edge, no gradient, no
  shadow on the background itself (the character keeps its own ground shadow).
- **Format**: animated WebP, transparent not required, roughly 780 x 440,
  2 to 3 seconds, seamless loop, 24 fps.
- **Framing**: character centred, full body in frame, generous acid space
  around it. No text anywhere in the animation.
- **Motion**: one clear action per clip, looping cleanly. Keep it simple and
  readable at 168px tall on a phone.

## The four prompts

**01 Scan the record.** The flight case mascot stands facing us holding a small
cartoon camera up in both gloved hands. It raises the camera, a soft flash pops
from the lens, and it lowers the camera again with a satisfied nod. A vinyl
record leans against its side throughout. Loop: raise, flash, lower, repeat.

**02 Check the pressing.** The mascot holds a vinyl record up in one hand and
inspects it closely, turning it slowly to read the label, head tilting. It then
gives a single confident nod and a thumbs up with its free hand. Loop: inspect,
tilt, nod, thumbs up, reset.

**03 File it in crates.** The mascot's lid flips open and it flicks briskly
through the records inside with one gloved hand, the way you dig through a
crate in a shop, sleeves tipping back and forth. It pulls one record halfway
out, pauses on it, then pushes it back and keeps flicking. Loop the flick.

**04 Play out.** The mascot walks with purpose to the right, lid closed, arms
swinging in a big confident stride, with a pair of headphones slung around the
top of the case. Small motion lines behind it to sell the speed. Loop the walk
cycle on the spot.

## Notes for whoever generates these

Keep all four in the same weight of line and the same size on screen, so the
character does not appear to change scale as the user taps through. If the
generator drifts off-model, feed it a still from an existing splash clip as a
character reference.
