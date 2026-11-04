"""Pull individual letters out of a potrace trace and set them on arcs.

Two rules that make arced lettering look drawn rather than warped:

  Letters are ROTATED onto the curve, never bent. Bending a whole word skews
  every vertical stem and the weight goes wrong on the outer edge; rotating
  each letter about its own baseline keeps the drawing intact.

  The baseline is the WORD's baseline, not each letter's own box. These glyphs
  were drawn together, so the O and the S already overshoot the line slightly.
  Aligning each letter's own box bottom would flatten that out and the curve
  would read as mechanical.
"""
import re, math

NUM = re.compile(r'[-+]?(?:\d*\.\d+|\d+)')

def _points(d):
    """Absolute points touched by a potrace path (M/L/C plus relative forms)."""
    toks = re.findall(r'[MmLlCcVvHhZz]|[-+]?(?:\d*\.\d+|\d+)', d)
    pts, i, cx, cy, start = [], 0, 0.0, 0.0, (0.0, 0.0)
    cmd = None
    while i < len(toks):
        t = toks[i]
        if re.match(r'[A-Za-z]', t):
            cmd = t; i += 1
            if cmd in 'Zz':
                cx, cy = start
            continue
        n = lambda k: float(toks[i + k])
        if cmd in 'Mm':
            x, y = (n(0), n(1)) if cmd == 'M' else (cx + n(0), cy + n(1))
            cx, cy = x, y; start = (x, y); pts.append((x, y)); i += 2; cmd = 'L' if cmd == 'M' else 'l'
        elif cmd in 'Ll':
            x, y = (n(0), n(1)) if cmd == 'L' else (cx + n(0), cy + n(1))
            cx, cy = x, y; pts.append((x, y)); i += 2
        elif cmd in 'Cc':
            if cmd == 'C':
                p = [(n(0), n(1)), (n(2), n(3)), (n(4), n(5))]
            else:
                p = [(cx + n(0), cy + n(1)), (cx + n(2), cy + n(3)), (cx + n(4), cy + n(5))]
            pts.extend(p); cx, cy = p[-1]; i += 6
        elif cmd in 'Hh':
            x = n(0) if cmd == 'H' else cx + n(0); cx = x; pts.append((x, cy)); i += 1
        elif cmd in 'Vv':
            y = n(0) if cmd == 'V' else cy + n(0); cy = y; pts.append((cx, y)); i += 1
        else:
            i += 1
    return pts

def load_word(svg_file):
    """-> (transform, [ {d, x0, x1, cx} ...], baseline_y), left to right."""
    s = open(svg_file).read()
    H = float(re.search(r'viewBox="[\d.]+ [\d.]+ ([\d.]+) ([\d.]+)"', s).group(2))
    transform = re.search(r'<g transform="([^"]+)"', s).group(1)
    out = []
    for d in re.findall(r'<path d="(.*?)"\s*/>', s, re.S):
        pts = _points(d)
        xs = [0.1 * p[0] for p in pts]
        ys = [H - 0.1 * p[1] for p in pts]
        out.append({'d': ' '.join(d.split()), 'x0': min(xs), 'x1': max(xs),
                    'y0': min(ys), 'y1': max(ys)})
    out.sort(key=lambda g: g['x0'])
    baseline = max(g['y1'] for g in out)          # the word's baseline, shared
    for g in out:
        g['cx'] = (g['x0'] + g['x1']) / 2
        g['w'] = g['x1'] - g['x0']
    capheight = baseline - min(g['y0'] for g in out)
    return transform, out, baseline, capheight

def letter(g, transform, place):
    """One letter, moved from the word onto `place` = (x, y, rotation_deg)."""
    x, y, rot = place
    return (f'<g transform="translate({x:.2f},{y:.2f}) rotate({rot:.3f})">'
            f'<g transform="translate({-g["cx"]:.2f},{-g["baseline"]:.2f})">'
            f'<g transform="{transform}"><path d="{g["d"]}"/></g></g></g>')

def arc(glyphs, transform, cx, cy, R, tracking, up=True, scale=1.0):
    """Set letters on a circle. up=True is a hill (centre below the text),
    up=False a valley (centre above). Returns (svg, half_angle)."""
    widths = [g['w'] * scale for g in glyphs]
    step = [(widths[i] / 2 + tracking + widths[i + 1] / 2) / R for i in range(len(glyphs) - 1)]
    total = sum(step)
    angles, a = [], -total / 2
    for i in range(len(glyphs)):
        angles.append(a)
        if i < len(step): a += step[i]
    parts = []
    for g, ang in zip(glyphs, angles):
        if up:
            px = cx + R * math.sin(ang)
            py = cy + R - R * math.cos(ang)
            rot = math.degrees(ang)
        else:
            px = cx + R * math.sin(ang)
            py = cy - R + R * math.cos(ang)
            rot = -math.degrees(ang)
        inner = (f'<g transform="translate({px:.2f},{py:.2f}) rotate({rot:.3f}) scale({scale})">'
                 f'<g transform="translate({-g["cx"]:.2f},{-g["baseline"]:.2f})">'
                 f'<g transform="{transform}"><path d="{g["d"]}"/></g></g></g>')
        parts.append(inner)
    return '\n    '.join(parts), total / 2

def word(glyphs, transform, x, y, tracking, scale=1.0):
    """Letters on a straight line, left edge at x, baseline at y."""
    parts, cur = [], x
    for g in glyphs:
        w = g['w'] * scale
        parts.append(
            f'<g transform="translate({cur + w/2:.2f},{y:.2f}) scale({scale})">'
            f'<g transform="translate({-g["cx"]:.2f},{-g["baseline"]:.2f})">'
            f'<g transform="{transform}"><path d="{g["d"]}"/></g></g></g>')
        cur += w + tracking
    return '\n    '.join(parts), cur - tracking - x

def justify(glyphs, transform, x, y, target_w, scale):
    """Set a word to an EXACT measure by solving the tracking, never by
    stretching the letters. Scaling a drawn face horizontally thins its
    verticals and thickens nothing else, which is the tell of amateur work;
    letterspacing leaves every stem exactly as drawn."""
    widths = [g['w'] * scale for g in glyphs]
    track = (target_w - sum(widths)) / (len(glyphs) - 1)
    parts, cur = [], x
    for g, w in zip(glyphs, widths):
        parts.append(
            f'<g transform="translate({cur + w/2:.2f},{y:.2f}) scale({scale})">'
            f'<g transform="translate({-g["cx"]:.2f},{-g["baseline"]:.2f})">'
            f'<g transform="{transform}"><path d="{g["d"]}"/></g></g></g>')
        cur += w + track
    return '\n    '.join(parts), track
