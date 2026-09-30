"""Colour-region locator: skin / white-trim / dark, inside the subject mask."""
import sys
sys.path.insert(0, r"D:\ROTK\three.js\img2threejs-work\analysis")
from measure import read_png, to_rgb

path, x0, x1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
w, h, ch, plte, buf = read_png(path)
rgb, w, h = to_rgb(w, h, ch, plte, buf)

skin, white, dark = [], [], []
for y in range(h):
    for x in range(x0, x1 + 1):
        j = (y * w + x) * 3
        r, g, b = rgb[j], rgb[j + 1], rgb[j + 2]
        if r > 215 and g > 190 and b > 175 and (r - b) > 18 and r >= g >= b:
            skin.append((x, y))
        elif r > 225 and g > 225 and b > 225 and (max(r, g, b) - min(r, g, b)) < 14:
            white.append((x, y))
        elif (r + g + b) / 3 < 90:
            dark.append((x, y))


def bbox(pts, name):
    if not pts:
        print(name, "none"); return
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    print("%-6s n=%-7d x[%4d..%4d] y[%4d..%4d]  w=%4d h=%4d" % (
        name, len(pts), min(xs), max(xs), min(ys), max(ys), max(xs) - min(xs), max(ys) - min(ys)))


bbox(skin, "skin")
bbox(white, "white")
bbox(dark, "dark")

# skin rows profile -> find face vs midriff vs thighs bands
rows = {}
for x, y in skin:
    rows.setdefault(y, []).append(x)
ys = sorted(rows)
bands = []
start = ys[0]; prev = ys[0]
for y in ys[1:]:
    if y - prev > 6:
        bands.append((start, prev)); start = y
    prev = y
bands.append((start, prev))
print("\nskin vertical bands (y0..y1, height, xrange, maxwidth):")
for (a, b) in bands:
    if b - a < 4:
        continue
    sel = [p for p in skin if a <= p[1] <= b]
    xs = [p[0] for p in sel]
    wmax = 0
    for y in range(a, b + 1):
        if y in rows:
            wmax = max(wmax, max(rows[y]) - min(rows[y]))
    print("  y %4d..%4d  h=%3d  x[%4d..%4d]  maxwidth=%4d" % (a, b, b - a, min(xs), max(xs), wmax))
