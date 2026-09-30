"""Body-core width per row = the contiguous dark run containing the centre column."""
import sys
sys.path.insert(0, r"D:\ROTK\three.js\img2threejs-work\analysis")
from measure import read_png, to_rgb

path, cx = sys.argv[1], int(sys.argv[2])
w, h, ch, plte, buf = read_png(path)
rgb, w, h = to_rgb(w, h, ch, plte, buf)


def dark(x, y):
    j = (y * w + x) * 3
    return (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 < 150


def run_at(y):
    if not dark(cx, y):
        for d in range(1, 60):
            if dark(cx - d, y): return run_from(cx - d, y)
            if dark(cx + d, y): return run_from(cx + d, y)
        return None
    return run_from(cx, y)


def run_from(x, y):
    a = x
    while a > 0 and dark(a - 1, y):
        a -= 1
    b = x
    while b < w - 1 and dark(b + 1, y):
        b += 1
    return a, b


print("   y   core_x0 core_x1 width  centre")
for y in range(120, 1030, 20):
    r = run_at(y)
    if r:
        print("  %4d   %5d  %5d  %5d  %5d" % (y, r[0], r[1], r[1] - r[0], (r[0] + r[1]) // 2))
    else:
        print("  %4d      --" % y)
