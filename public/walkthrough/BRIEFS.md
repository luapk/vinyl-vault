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
- **Format**: animated WebP, transparent not required, 780 x 440, 5 seconds,
  seamless loop. The shipped set is 16 fps, which is plenty for motion this
  unhurried and keeps the files small enough for a first run on mobile data.
- **Framing**: character centred, full body in frame, generous acid space
  around it. No text anywhere in the animation.
- **Motion**: one clear action per clip, looping cleanly. Keep it simple and
  readable at 168px tall on a phone.
- **Register**: cool and calm, never cheesy. The character's own face is
  faintly scowling and it stays that way: no grinning, no thumbs up, no
  cheering, no bouncing. It may hold a prop (camera, magnifying glass,
  headphones). This is the note that most often gets lost when regenerating,
  and it is the difference between the mascot reading as a collector and
  reading as a mascot.

## The four prompts

**01 Scan the record.** The flight case mascot stands facing us holding a small
boxy cartoon camera in both gloved hands. It raises the camera unhurriedly,
takes one photograph, and lowers it again slowly. A vinyl record leans against
its side throughout. Deadpan throughout. Loop: raise, shoot, lower, repeat.

**02 Check the pressing.** The mascot holds a vinyl record up in one gloved
hand and studies its label through a large round magnifying glass held in the
other. It turns the record slowly and tilts its head once, appraising. A
sceptical connoisseur, not a delighted one: no nod of approval, no thumbs up.

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
character does not appear to change scale as the user taps through.

**Use a still from a splash clip as the character reference, not `intro.mp4`.**
`intro.mp4` is the logo animation: a plain flight case with no face, arms or
legs, over the wordmark on black. Referencing it produces the logo, not the
mascot. `splash.webp` has the character full body on acid; the shipped set was
generated from a frame of it cropped to the acid panel.

The shipped set was made with Higgsfield (`seedance_2_0`, image reference,
5 s, 16:9, silent) and converted with
`ffmpeg -vf "fps=16,scale=780:440" -c:v libwebp_anim -q:v 70 -loop 0`.
