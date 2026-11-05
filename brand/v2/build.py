"""Separate the script artwork into its three layers and write clean bitmaps.

The artwork is a four-part sticker, from the back forward:

  1. a black ground (the sticker body)
  2. an acid keyline around that ground
  3. the acid letters, floating in the ground
  4. a cream hairline inset inside the letters, the bevel that makes the
     lettering read as rounded rather than flat

Only three bitmaps are needed, because (2) and (3) are the same colour and so
trace as one path: BODY (the filled silhouette), INK (keyline + letters), and
CREAM (the bevel).
"""
import os, sys, numpy as np
from PIL import Image
from scipy import ndimage as nd

HERE = os.path.dirname(os.path.abspath(__file__))

SRC = os.path.join(HERE, 'source', 'script-artwork.png')
SS = 4                      # supersample factor for the traced bitmaps
S_SPLIT = 0.52              # saturation that separates acid from cream
V_INK = 150                 # value above which a pixel is inked at all

# Components to drop: the five grain specks and the blob above the "o" of
# Sound, which leaves the flourish there reading as one line.
DROP = [5, 6, 7, 8, 11, 12]

# Where the F's tail crosses the flourish above the "u" of Found. The source
# is soft right there and the crossing traces with a stepped, notched foot,
# so that one box gets a heavier smoothing than the rest of the mark.
JOIN = (540, 140, 665, 235)          # x0, y0, x1, y1 in native px
JOIN_CLOSE = 2.4                     # fills the notches biting into the foot
JOIN_BLUR = 1.6                      # then rounds what is left of the steps

PARAMS = {            # per layer: (opening radius, blur, local repair), in native px
    'body':  (0.0,  0.9, False),
    'ink':   (1.1,  0.9, True),
    'cream': (0.45, 0.7, False),     # the bevel is a hairline: barely open it
}

a = np.asarray(Image.open(SRC).convert('RGB')).astype(float)
H, W, _ = a.shape
mx, mn = a.max(2), a.min(2)
S = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1), 0)

ink = mx > V_INK
lab, n = nd.label(ink, structure=np.ones((3, 3)))
ink &= np.isin(lab, [i for i in range(1, n + 1) if i not in DROP])

ring = (lab == 1)

# ---------------------------------------------------------------------------
# UNCROPPING THE LEFT EDGE
#
# The artwork runs off the left of its own canvas, so the mark ends in a flat
# vertical cut: the F's left swirl loses a slice, and the acid keyline that
# bulges around it is missing entirely for 129 rows.
#
# This is reconstructed rather than redrawn, because the geometry there is
# measurable and says what the missing part has to be. The swirl's left
# boundary fits a circle to 0.33px mean residual (0.88 worst) over the rows
# either side of the cut, and the keyline runs CONCENTRIC with it: against the
# swirl's own centre its outer edge holds radius 126.0 and its inner edge
# 114.7, steady to a fifth of a pixel through the rows approaching each cut.
# So the missing piece is two arcs on one centre, not a guess about what the
# artist drew. The swirl turns out to be clipped by only 2px; the keyline by
# 26.
#
# None of this is a substitute for the uncropped original, and if that ever
# turns up, delete this block and re-run.
PADL = 44                       # padding to draw the restored arcs into
SWIRL = (99.7, 368.4, 101.8)    # the swirl's left boundary: cx, cy, r
KEY_R = (114.7, 126.0)          # the keyline's inner and outer radius, same centre
KEY_ROWS = (252, 486)           # rows over which it holds that circle


def pad(m):
    return np.pad(m, ((0, 0), (PADL, 0)))


ink, ring, lab = pad(ink), pad(ring), pad(lab)
S = np.pad(S, ((0, 0), (PADL, 0)))
W += PADL

cx, cy, r = SWIRL[0] + PADL, SWIRL[1], SWIRL[2]
yy, xx = np.ogrid[:H, :W]
d = np.hypot(xx - cx, yy - cy)

# The swirl: only the crescent beyond where the canvas cut it, never the disc,
# or the spiral's own counter fills in.
ink |= (d <= r) & (xx <= PADL)

# The keyline: the band between the two radii, on the left of the centre.
# It is NOT clipped to the padding. Cutting it off at the canvas edge leaves a
# vertical step where the restored arc butts against the surviving keyline,
# and a step in a keyline reads as a kink. Letting the band run on INTO what
# already exists makes the join a union of two copies of the same arc, so
# there is no seam to see. KEY_ROWS bounds it to the stretch where the
# keyline really is concentric with the swirl; past that it drifts off this
# circle and would start drawing where it does not belong.
restored_key = ((d >= KEY_R[0]) & (d <= KEY_R[1]) & (xx < cx)
                & (yy >= KEY_ROWS[0]) & (yy <= KEY_ROWS[1]))
ink |= restored_key
ring |= restored_key

body = nd.binary_fill_holes(ring)
cream = ink & (S < S_SPLIT)
assert body.sum() > ring.sum() * 2, 'the keyline is still not a closed loop'
print(f'uncrop: +{int(restored_key.sum())}px of keyline, '
      f'+{int(((d <= r) & (xx <= PADL)).sum())}px of swirl')


def disk(r):
    r = int(round(r)); y, x = np.ogrid[-r:r+1, -r:r+1]
    return x*x + y*y <= r*r


def join_window():
    """A feathered weight over the crossing, 1 inside and 0 well outside.

    The local repair has to fade in, not switch on at a rectangle: a hard box
    leaves its own outline printed across the mark, because the contour lands
    a fraction of a pixel differently on each side of the boundary.
    """
    w = np.zeros((H*SS, W*SS), np.float32)
    x0, y0, x1, y1 = [v * SS for v in JOIN]
    w[y0:y1, x0:x1] = 1.0
    return nd.gaussian_filter(w, 6 * SS)


WIN = None


def refine(m, open_r, blur, repair=False):
    """Supersample, de-spur, de-notch, soften: a smooth sub-pixel contour."""
    global WIN
    big = np.asarray(Image.fromarray((m * 255).astype(np.uint8))
                     .resize((W*SS, H*SS), Image.BILINEAR)).astype(float) / 255.0 > 0.5
    if open_r > 0:
        d = disk(open_r * SS)
        big = nd.binary_opening(big, d)
        big = nd.binary_closing(big, d)
    soft = nd.gaussian_filter(big.astype(float), blur * SS)
    if repair:
        if WIN is None:
            WIN = join_window()
        heavy = nd.gaussian_filter(
            nd.binary_closing(big, disk(JOIN_CLOSE * SS)).astype(float), JOIN_BLUR * SS)
        soft = soft * (1 - WIN) + heavy * WIN
    return soft > 0.5


if __name__ == '__main__':
    for name, m in (('body', body), ('ink', ink), ('cream', cream)):
        r = refine(m, *PARAMS[name])
        Image.fromarray(np.where(r, 0, 255).astype(np.uint8)).save(
            os.path.join(HERE, 'traces', f'{name}.pbm'))
        print(f'{name:6s} {int(m.sum()):>8d} px -> {r.sum()//(SS*SS):>8d} px')
    print(f'grid {W*SS}x{H*SS}  (native {W}x{H})')
