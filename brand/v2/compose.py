"""Compose the script lockup from its three traced layers."""
import re, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SS = 4            # the layers were traced at 4x
PAD = 10.0        # native px of breathing room

ACID, CREAM, INK, PAPER = '#CAFE04', '#F2F6D8', '#0D0C0A', '#F7F8F2'


def layer(name):
    s = open(os.path.join(HERE, 'traces', f'{name}.svg')).read()
    vb = re.search(r'viewBox="([\d.\s]+)"', s).group(1).split()
    w, h = float(vb[2]) / SS, float(vb[3]) / SS
    tr = re.search(r'<g transform="([^"]+)"', s).group(1)
    ds = [' '.join(d.split()) for d in re.findall(r'<path d="(.*?)"', s, re.S)]
    g = f'<g transform="scale({1/SS}) {tr}">' + ''.join(f'<path d="{d}"/>' for d in ds) + '</g>'
    return w, h, g


W, H, G_BODY = layer('body')
_, _, G_INK = layer('ink')
_, _, G_CREAM = layer('cream')
VW, VH = W + PAD * 2, H + PAD * 2


def svg(body=None, ink=None, cream=None, bg=None, ring_only=False):
    out = []
    if bg:
        out.append(f'<rect x="0" y="0" width="{VW:.0f}" height="{VH:.0f}" fill="{bg}"/>')
    out.append(f'<g transform="translate({PAD},{PAD})">')
    for fill, g in ((body, G_BODY), (ink, G_INK), (cream, G_CREAM)):
        if fill:
            out.append(f'<g fill="{fill}">{g}</g>')
    out.append('</g>')
    return ('<svg xmlns="http://www.w3.org/2000/svg" '
            f'viewBox="0 0 {VW:.0f} {VH:.0f}" role="img" aria-label="Found Sound">\n  '
            + '\n  '.join(out) + '\n</svg>\n')


OUT = {
    # Full three-tone, as drawn: black ground, acid letters, cream bevel.
    'script-full':       svg(body=INK,   ink=ACID,  cream=CREAM),
    # Inverted ground, for printing on light stock.
    'script-paper':      svg(body=PAPER, ink=ACID,  cream=INK),
    # Two-tone, no bevel.
    'script-acid-ink':   svg(body=INK,   ink=ACID),
    'script-ink-acid':   svg(body=ACID,  ink=INK),
    # One colour: ink only, nothing behind it.
    'script-black':      svg(ink=INK),
    'script-white':      svg(ink=PAPER),
    'script-acid':       svg(ink=ACID),
    # One colour with the bevel knocked out of it, for larger sizes.
    'script-black-bevel': svg(ink=INK,   cream=PAPER),
    'script-white-bevel': svg(ink=PAPER, cream=INK),
}

OUT_DIR = os.path.join(HERE, 'out')
if __name__ == '__main__':
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, s in OUT.items():
        open(os.path.join(OUT_DIR, f'{name}.svg'), 'w').write(s)
        print(f'{name:<20s} {len(s):>7d} bytes')
    print(f'\nviewBox {VW:.0f} x {VH:.0f}   ratio {VW/VH:.2f}')
