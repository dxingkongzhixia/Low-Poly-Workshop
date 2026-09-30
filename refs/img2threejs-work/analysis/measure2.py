"""Silhouette profiler driven by the dark (black-garment/hair) mask."""
import sys
sys.path.insert(0, r"D:\ROTK\three.js\img2threejs-work\analysis")
from measure import read_png, to_rgb  # reuse the decoder

path = sys.argv[1]
TH = int(sys.argv[2]) if len(sys.argv) > 2 else 150
w, h, ch, plte, buf = read_png(path)
rgb, w, h = to_rgb(w, h, ch, plte, buf)
print("size", w, h, "channels", ch, "threshold", TH)

cols = [0] * w
for y in range(h):
    base = y * w * 3
    for x in range(w):
        i = base + x * 3
        if (rgb[i] + rgb[i + 1] + rgb[i + 2]) / 3 < TH:
            cols[x] += 1

# find contiguous runs of occupied columns (gap >= 12 px separates views)
runs = []
start = None
gap = 0
for x in range(w):
    if cols[x] > 3:
        if start is None:
            start = x
        gap = 0
    else:
        if start is not None:
            gap += 1
            if gap >= 12:
                runs.append((start, x - gap))
                start = None
if start is not None:
    runs.append((start, w - 1))
runs = [r for r in runs if r[1] - r[0] > 40]
print("column runs (views):", runs)

for (x0, x1) in runs:
    ys = [y for y in range(h) if any((rgb[(y * w + x) * 3] + rgb[(y * w + x) * 3 + 1] + rgb[(y * w + x) * 3 + 2]) / 3 < TH for x in range(x0, x1 + 1, 3))]
    if not ys:
        continue
    top, bot = ys[0], ys[-1]
    print("\nview x[%d..%d] top=%d bottom=%d height=%d" % (x0, x1, top, bot, bot - top))
    print("  ynorm   y     xmin  xmax  width  center")
    for i in range(21):
        f = i / 20
        y = min(int(top + f * (bot - top)), h - 1)
        xs = [x for x in range(x0, x1 + 1) if (rgb[(y * w + x) * 3] + rgb[(y * w + x) * 3 + 1] + rgb[(y * w + x) * 3 + 2]) / 3 < TH]
        if xs:
            print("  %.2f  %4d   %4d  %4d  %4d   %4d" % (f, y, min(xs), max(xs), max(xs) - min(xs), (min(xs) + max(xs)) // 2))
