"""Largest-connected-component silhouette profiler (drops guide marks & background)."""
import sys
sys.path.insert(0, r"D:\ROTK\three.js\img2threejs-work\analysis")
from measure import read_png, to_rgb

path = sys.argv[1]
TH = int(sys.argv[2]) if len(sys.argv) > 2 else 150
w, h, ch, plte, buf = read_png(path)
rgb, w, h = to_rgb(w, h, ch, plte, buf)
print("size", w, h, "threshold", TH)

mask = bytearray(w * h)
for i in range(w * h):
    j = i * 3
    if (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 < TH:
        mask[i] = 1

label = [-1] * (w * h)
comps = []
for s in range(w * h):
    if mask[s] and label[s] < 0:
        cid = len(comps)
        stack = [s]
        label[s] = cid
        px = []
        while stack:
            p = stack.pop()
            px.append(p)
            x, y = p % w, p // w
            if x > 0 and mask[p - 1] and label[p - 1] < 0:
                label[p - 1] = cid; stack.append(p - 1)
            if x < w - 1 and mask[p + 1] and label[p + 1] < 0:
                label[p + 1] = cid; stack.append(p + 1)
            if y > 0 and mask[p - w] and label[p - w] < 0:
                label[p - w] = cid; stack.append(p - w)
            if y < h - 1 and mask[p + w] and label[p + w] < 0:
                label[p + w] = cid; stack.append(p + w)
        comps.append(px)

comps.sort(key=len, reverse=True)
print("components:", [len(c) for c in comps[:8]])
keep = set()
for c in comps[:6]:
    if len(c) > 3000:
        keep.update(c)

xs = [p % w for p in keep]
ys = [p // w for p in keep]
print("subject bbox x[%d..%d] y[%d..%d]" % (min(xs), max(xs), min(ys), max(ys)))

colcount = {}
for p in keep:
    colcount[p % w] = colcount.get(p % w, 0) + 1
occ = sorted(colcount)
runs = []
start = occ[0]; prev = occ[0]
for x in occ[1:]:
    if x - prev > 12:
        runs.append((start, prev)); start = x
    prev = x
runs.append((start, prev))
runs = [r for r in runs if r[1] - r[0] > 40]
print("view column runs:", runs)

sel = set(int(v) for v in sys.argv[3].split(",")) if len(sys.argv) > 3 else set(range(len(runs)))
for vi in sel:
    x0, x1 = runs[vi]
    pts = [p for p in keep if x0 <= p % w <= x1]
    vy = [p // w for p in pts]
    top, bot = min(vy), max(vy)
    print("\n== view %d  x[%d..%d]  top=%d bottom=%d height=%d" % (vi, x0, x1, top, bot, bot - top))
    print("  ynorm   y    xmin xmax width center")
    for i in range(21):
        y = int(top + (i / 20) * (bot - top))
        rowx = [p % w for p in pts if p // w == y]
        if rowx:
            print("  %.2f  %4d  %4d %4d %5d %5d" % (i / 20, y, min(rowx), max(rowx), max(rowx) - min(rowx), (min(rowx) + max(rowx)) // 2))
