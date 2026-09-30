"""Locate the two eye whites inside the face region."""
import sys
sys.path.insert(0, r"D:\ROTK\three.js\img2threejs-work\analysis")
from measure import read_png, to_rgb

path = sys.argv[1]
rx0, ry0, rx1, ry1 = (int(v) for v in sys.argv[2:6])
THR = int(sys.argv[6]) if len(sys.argv) > 6 else 225
w, h, ch, plte, buf = read_png(path)
rgb, w, h = to_rgb(w, h, ch, plte, buf)

pts = []
for y in range(ry0, ry1):
    for x in range(rx0, rx1):
        j = (y * w + x) * 3
        r, g, b = rgb[j], rgb[j + 1], rgb[j + 2]
        if r > THR and g > THR and b > THR:
            pts.append((x, y))
print("eye-white px:", len(pts))
if pts:
    left = [p for p in pts if p[0] < (rx0 + rx1) / 2]
    right = [p for p in pts if p[0] >= (rx0 + rx1) / 2]
    for name, grp in (("left(-x)", left), ("right(+x)", right)):
        if not grp:
            continue
        xs = [p[0] for p in grp]; ys = [p[1] for p in grp]
        print("%-9s n=%-5d x[%d..%d] y[%d..%d] centre=(%.1f,%.1f) approx_r=(%.1f,%.1f)" % (
            name, len(grp), min(xs), max(xs), min(ys), max(ys),
            sum(xs) / len(xs), sum(ys) / len(ys),
            (max(xs) - min(xs)) / 2, (max(ys) - min(ys)) / 2))
