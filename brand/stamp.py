"""The lozenge stamp, built to production spec.

Everything is outlines. The subline is converted from Hanken Grotesk, the
app's own sans, so the logo never waits on a webfont and never shifts if the
font fails to load. A logo that depends on a font request is a logo that
renders wrong on a cold cache.
"""
import re, sys
import os
HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.join(os.path.dirname(HERE), 'public')
TRACE_FOUND = os.path.join(HERE, 'traces', 'found.svg')
TRACE_SOUND = os.path.join(HERE, 'traces', 'sound.svg')
SUB_FONT = os.path.join(HERE, 'fonts', 'Hanken_Grotesk_700.ttf')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import letters as L
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen

ACID, INK, PAPER = '#CAFE04', '#0D0C0A', '#F7F8F2'
SUB_TEXT = 'YOUR VINYL, SORTED'

# ---- the wordmark, one line, original spacing preserved --------------------
def word_group(svg_file):
    s = open(svg_file).read()
    vb = [float(x) for x in re.search(r'viewBox="([\d.\s]+)"', s).group(1).split()]
    tr = re.search(r'<g transform="([^"]+)"', s).group(1)
    d  = ' '.join(re.findall(r'<path d="(.*?)"\s*/>', s, re.S)[0].split())
    return vb[2], vb[3], f'<g transform="{tr}"><path d="{d}"/></g>'

W1, H1, G1 = word_group(TRACE_FOUND)      # FOUND
W2, H2, G2 = word_group(TRACE_SOUND)      # SOUND

CAP = 100.0                            # the unit everything else is drawn from
s1 = CAP / H1
s2 = CAP / H2                          # match cap heights, not box heights
GAP = CAP * 0.30
w1, w2 = W1 * s1, W2 * s2
MARK_W = w1 + GAP + w2

def mark(x, y):
    """Wordmark with its left edge at x and its baseline at y."""
    return (f'<g transform="translate({x:.3f},{y - CAP:.3f})">'
            f'<g transform="scale({s1:.6f})">{G1}</g>'
            f'<g transform="translate({w1 + GAP:.3f},0) scale({s2:.6f})">{G2}</g></g>')

# ---- the subline, converted to outlines ------------------------------------
def outline_text(text, size, tracking_em, target_w=None):
    f = TTFont(SUB_FONT)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    upem = f['head'].unitsPerEm
    k = size / upem
    track = tracking_em * size
    if target_w:
        # Justify to the lozenge where the string is long enough to do it at a
        # readable setting, because sharing an edge with the shape above is
        # what makes the two parts one lockup rather than a shape with a
        # caption under it.
        #
        # But tracking has a ceiling. Past roughly 0.42em uppercase stops
        # reading as a phrase and becomes a row of separate letters, and a
        # short subline justified to a wide measure blows straight through it:
        # "YOUR VINYL, SORTED" needs over 1em to reach this lozenge. So the
        # tracking is capped and the line is centred instead. Filling the
        # measure is worth having; it is not worth illegibility.
        adv = sum(gs[cmap[ord(c)]].width * k for c in text if ord(c) in cmap)
        want = (target_w - adv) / (len(text) - 1)
        track = min(want, MAX_TRACK_EM * size)
    parts, x = [], 0.0
    for ch in text:
        gname = cmap.get(ord(ch))
        if gname is None:
            x += size * 0.3; continue
        pen = SVGPathPen(gs)
        gs[gname].draw(pen)
        d = pen.getCommands()
        if d:
            parts.append(f'<g transform="translate({x:.3f},0) scale({k:.6f},{-k:.6f})">'
                         f'<path d="{d}"/></g>')
        x += gs[gname].width * k + track
    return '\n      '.join(parts), x - track

# ---- the stamp -------------------------------------------------------------
# Optical padding: wider at the ends than top and bottom, because the lozenge
# curves away from the letters there and equal padding reads as too tight.
PAD_Y   = CAP * 0.52
PAD_X   = CAP * 0.92
STROKE  = CAP * 0.115
SUB_SIZE = CAP * 0.315
SUB_TRACK = 0.30
MAX_TRACK_EM = 0.42
SUB_GAP = CAP * 0.56

def build(colour, with_sub=True):
    box_h = CAP + PAD_Y * 2
    box_w = MARK_W + PAD_X * 2
    half = STROKE / 2
    sub_svg, sub_w = outline_text(SUB_TEXT, SUB_SIZE, SUB_TRACK, box_w + STROKE) if with_sub else ('', 0)
    total_w = max(box_w + STROKE, sub_w)
    total_h = box_h + STROKE + (SUB_GAP + SUB_SIZE if with_sub else 0)
    bx = (total_w - box_w) / 2 + half
    body = [
        f'<rect x="{bx:.3f}" y="{half:.3f}" width="{box_w:.3f}" height="{box_h:.3f}" '
        f'rx="{box_h/2:.3f}" fill="none" stroke="{colour}" stroke-width="{STROKE:.3f}"/>',
        f'<g fill="{colour}">{mark(bx + PAD_X, half + PAD_Y + CAP)}</g>',
    ]
    if with_sub:
        sx = (total_w - sub_w) / 2
        sy = box_h + STROKE + SUB_GAP + SUB_SIZE * 0.76
        body.append(f'<g fill="{colour}" transform="translate({sx:.3f},{sy:.3f})">\n      {sub_svg}\n    </g>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {total_w:.2f} {total_h:.2f}" '
            f'role="img" aria-label="Found Sound">\n    ' + '\n    '.join(body) + '\n</svg>\n')

for name, col in [('acid', ACID), ('black', INK), ('white', PAPER)]:
    open(os.path.join(PUBLIC, f'logo-stamp-{name}.svg'), 'w').write(build(col, True))
    open(os.path.join(PUBLIC, f'logo-mark-{name}.svg'), 'w').write(build(col, False))
print('wordmark %.1f wide, stamp %.1f x %.1f' % (MARK_W, MARK_W + PAD_X*2 + STROKE, CAP + PAD_Y*2 + STROKE))
