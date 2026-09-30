"""True silhouette via background flood-fill from the image border (keeps interior white trim)."""
import sys
sys.path.insert(0, r"D:\ROTK\three.js\img2threejs-work\analysis")
from measure import read_png, to_rgb

path, x0, x1 = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
w, h, ch, plte, buf = read_png(path)
rgb, w, h = to_rgb(w, h, ch, plte, buf)
L = int(sys.argv[4]) if len(sys.argv) > 4 else 205

bg = bytearray(w * h)
stack = []
for x in range(w):
    for y in (0, h - 1):
        i = y * w + x
        j = i * 3
        if not bg[i] and (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 > L:
            bg[i] = 1; stack.append(i)
for y in range(h):
    for x in (0, w - 1):
        i = y * w + x
        j = i * 3
        if not bg[i] and (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 > L:
            bg[i] = 1; stack.append(i)
while stack:
    p = stack.pop()
    x, y = p % w, p // w
    for q in (p - 1, p + 1, p - w, p + w):
        if q < 0 or q >= w * h or bg[q]:
            continue
        qx, qy = q % w, q // w
        if abs(qx - x) + abs(qy - y) != 1:
            continue
        j = q * 3
        if (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 > L:
            bg[q] = 1; stack.append(q)

subject = [p for p in range(w * h) if not bg[p] and x0 <= p % w <= x1]
if not subject:
    print("empty"); sys.exit()
ys = [p // w for p in subject]
top, bot = min(ys), max(ys)
print("view x[%d..%d] subject px=%d  top=%d bottom=%d height=%d" % (x0, x1, len(subject), top, bot, bot - top))
print("   y   xmin xmax width centre")
for y in range(top, bot + 1, 15):
    rowx = [p % w for p in subject if p // w == y]
    if rowx:
        print("  %4d  %4d %4d %5d %5d" % (y, min(rowx), max(rowx), max(rowx) - min(rowx), (min(rowx) + max(rowx)) // 2))
