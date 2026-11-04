"""Stacked lockups: FOUND over SOUND, built from the same traced outlines
as the horizontal stamp.

Why stacked is worth a look at all: at matched cap height the two words are
2605.5 and 2644.2 units wide, a difference of 2.5%. Five letters each,
differing only in the first. That is a near-perfect rectangle sitting unused
inside a logo currently set as one long line with an aspect ratio of about
4:1, which is the worst possible shape for an app icon, an avatar, a favicon
or a square social crop.

Two constructions, because the 2.5% has to go somewhere:

  CAP-MATCHED keeps both words at the same cap height and centres them, so
  the block is very slightly ragged (1.2% a side). Typographically correct.

  WIDTH-MATCHED scales FOUND up 2.5% so the edges are flush, which makes its
  cap height 2.5% taller. Most stacked lockups do this when the words are
  this close, because a flush edge reads as deliberate where a 2.5% rag reads
  as a mistake. The cap difference at this scale is about 1px in 40.
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
CAP = 100.0

TR1, G1, BASE1, CAP1 = L.load_word(TRACE_FOUND)   # FOUND
TR2, G2, BASE2, CAP2 = L.load_word(TRACE_SOUND)   # SOUND


def word(glyphs, transform, baseline, cap, size):
    """Word with left edge at x=0, baseline at y=0, cap height == size."""
    k = size / cap
    x0 = glyphs[0]['x0']
    inner = ''.join(f'<g transform="{transform}"><path d="{g["d"]}"/></g>' for g in glyphs)
    w = (glyphs[-1]['x1'] - x0) * k
    return (f'<g transform="scale({k:.6f}) translate({-x0:.3f},{-baseline:.3f})">{inner}</g>', w)


def outline_text(text, size, tracking_em):
    f = TTFont(SUB_FONT)
    gs, cmap = f.getGlyphSet(), f.getBestCmap()
    k = size / f['head'].unitsPerEm
    track = tracking_em * size
    parts, x = [], 0.0
    for ch in text:
        gname = cmap.get(ord(ch))
        if gname is None:
            x += size * 0.3
            continue
        pen = SVGPathPen(gs)
        gs[gname].draw(pen)
        d = pen.getCommands()
        if d:
            parts.append(f'<g transform="translate({x:.3f},0) scale({k:.6f},{-k:.6f})"><path d="{d}"/></g>')
        x += gs[gname].width * k + track
    return ''.join(parts), x - track


LEAD = CAP * 0.17          # gap from FOUND's baseline to SOUND's cap
STROKE = CAP * 0.115
SUB_SIZE = CAP * 0.265
SUB_GAP = CAP * 0.44


def block(width_matched):
    """The two-word block: (svg, width, height), top-left at 0,0."""
    if width_matched:
        # Scale FOUND so its width equals SOUND's; its cap grows 2.5%.
        natural1 = (G1[-1]['x1'] - G1[0]['x0']) / CAP1
        natural2 = (G2[-1]['x1'] - G2[0]['x0']) / CAP2
        s1, s2 = CAP * natural2 / natural1, CAP
    else:
        s1 = s2 = CAP
    w1svg, w1 = word(G1, TR1, BASE1, CAP1, s1)
    w2svg, w2 = word(G2, TR2, BASE2, CAP2, s2)
    cap1 = s1
    W = max(w1, w2)
    H = cap1 + LEAD + s2
    parts = [
        f'<g transform="translate({(W - w1) / 2:.3f},{cap1:.3f})">{w1svg}</g>',
        f'<g transform="translate({(W - w2) / 2:.3f},{H:.3f})">{w2svg}</g>',
    ]
    return ''.join(parts), W, H


def svg(viewbox_w, viewbox_h, body):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {viewbox_w:.2f} {viewbox_h:.2f}" '
            f'role="img" aria-label="Found Sound">\n    ' + body + '\n</svg>\n')


def rounded(colour, width_matched=True, with_sub=False, radius=0.26):
    b, W, H = block(width_matched)
    pad_x, pad_y = CAP * 0.62, CAP * 0.52
    box_w, box_h = W + pad_x * 2, H + pad_y * 2
    half = STROKE / 2
    total_w, total_h = box_w + STROKE, box_h + STROKE
    sub = ''
    if with_sub:
        s, sw = outline_text(SUB_TEXT, SUB_SIZE, 0.30)
        total_h += SUB_GAP + SUB_SIZE
        sub = (f'<g fill="{colour}" transform="translate({(total_w - sw) / 2:.3f},'
               f'{box_h + STROKE + SUB_GAP + SUB_SIZE * 0.76:.3f})">{s}</g>')
    body = (f'<rect x="{half:.3f}" y="{half:.3f}" width="{box_w:.3f}" height="{box_h:.3f}" '
            f'rx="{box_h * radius:.3f}" fill="none" stroke="{colour}" stroke-width="{STROKE:.3f}"/>'
            f'<g fill="{colour}" transform="translate({half + pad_x:.3f},{half + pad_y:.3f})">{b}</g>'
            + sub)
    return svg(total_w, total_h, body)


def circle(colour, width_matched=True):
    b, W, H = block(width_matched)
    # Radius that clears the block's corners, plus optical breathing room.
    r = ((W / 2) ** 2 + (H / 2) ** 2) ** 0.5 * 1.26
    half = STROKE / 2
    total = r * 2 + STROKE
    body = (f'<circle cx="{total / 2:.3f}" cy="{total / 2:.3f}" r="{r:.3f}" fill="none" '
            f'stroke="{colour}" stroke-width="{STROKE:.3f}"/>'
            f'<g fill="{colour}" transform="translate({(total - W) / 2:.3f},{(total - H) / 2:.3f})">{b}</g>')
    return svg(total, total, body)


def bare(colour, width_matched=True):
    b, W, H = block(width_matched)
    return svg(W, H, f'<g fill="{colour}">{b}</g>')


if __name__ == '__main__':
    # Production: the three colourways of ST2, the construction the app uses.
    for name, col in [('acid', ACID), ('black', INK), ('white', PAPER)]:
        open(os.path.join(PUBLIC, f'logo-block-{name}.svg'), 'w').write(
            rounded(col, width_matched=True))
        print(f'public/logo-block-{name}.svg')

    # The constructions that were auditioned, written beside this script so
    # the comparison can be rebuilt rather than re-derived.
    if '--variants' in sys.argv:
        for fname, svg_text in [
            ('st1-capmatched.svg',   rounded(ACID, width_matched=False)),
            ('st3-circle.svg',       circle(ACID)),
            ('st4-withsub.svg',      rounded(ACID, width_matched=True, with_sub=True)),
            ('st5-bare.svg',         bare(ACID)),
            ('st6-squircle.svg',     rounded(ACID, width_matched=True, radius=0.46)),
        ]:
            open(os.path.join(HERE, fname), 'w').write(svg_text)
            print('brand/' + fname)

    _, W, H = block(True)
    print(f'block width-matched: {W:.1f} x {H:.1f}  ratio {W / H:.2f}')
    _, W2, H2 = block(False)
    print(f'block cap-matched:   {W2:.1f} x {H2:.1f}  ratio {W2 / H2:.2f}')
