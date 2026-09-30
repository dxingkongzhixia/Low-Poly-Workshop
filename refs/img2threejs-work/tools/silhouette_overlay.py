"""Bounding-box-normalised silhouette overlay between the reference view and a render.

Writes review/silhouette-overlay-<tag>.png where
  black = in both,  red = reference only,  blue = render only
and prints the IoU, so the failure is located rather than just reported.
"""
import sys
import zlib
import struct
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "analysis"))
from measure import read_png, to_rgb  # noqa: E402

GRID_W, GRID_H = 300, 460


def load_mask(path, bg_threshold=205):
    w, h, ch, plte, buf = read_png(path)
    rgb, w, h = to_rgb(w, h, ch, plte, buf)
    bg = bytearray(w * h)
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            i = y * w + x
            j = i * 3
            if not bg[i] and (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 > bg_threshold:
                bg[i] = 1
                stack.append(i)
    for y in range(h):
        for x in (0, w - 1):
            i = y * w + x
            j = i * 3
            if not bg[i] and (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 > bg_threshold:
                bg[i] = 1
                stack.append(i)
    while stack:
        p = stack.pop()
        x, y = p % w, p // w
        for q in (p - 1, p + 1, p - w, p + w):
            if q < 0 or q >= w * h or bg[q]:
                continue
            if abs(q % w - x) + abs(q // w - y) != 1:
                continue
            j = q * 3
            if (rgb[j] + rgb[j + 1] + rgb[j + 2]) / 3 > bg_threshold:
                bg[q] = 1
                stack.append(q)
    return w, h, bytearray(0 if bg[i] else 1 for i in range(w * h))


def bbox_of(mask, w, h):
    xs, ys = [], []
    for i, v in enumerate(mask):
        if v:
            xs.append(i % w)
            ys.append(i // w)
    if not xs:
        return None
    return min(xs), min(ys), max(xs), max(ys)


def resample(mask, w, h, box, gw, gh):
    x0, y0, x1, y1 = box
    bw = max(1, x1 - x0)
    bh = max(1, y1 - y0)
    out = bytearray(gw * gh)
    for gy in range(gh):
        sy = y0 + int((gy + 0.5) * bh / gh)
        for gx in range(gw):
            sx = x0 + int((gx + 0.5) * bw / gw)
            if 0 <= sx < w and 0 <= sy < h and mask[sy * w + sx]:
                out[gy * gw + gx] = 1
    return out


def write_png(path, gw, gh, rgb):
    raw = bytearray()
    for y in range(gh):
        raw.append(0)
        raw += rgb[y * gw * 3:(y + 1) * gw * 3]

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", gw, gh, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 6))
    png += chunk(b"IEND", b"")
    Path(path).write_bytes(png)


ref_path, render_path, tag = sys.argv[1], sys.argv[2], sys.argv[3]

rw, rh, rmask = load_mask(ref_path)
tw, th, tmask = load_mask(render_path)
rbox = bbox_of(rmask, rw, rh)
tbox = bbox_of(tmask, tw, th)
print("reference bbox", rbox, "render bbox", tbox)

R = resample(rmask, rw, rh, rbox, GRID_W, GRID_H)
T = resample(tmask, tw, th, tbox, GRID_W, GRID_H)

inter = sum(1 for i in range(GRID_W * GRID_H) if R[i] and T[i])
union = sum(1 for i in range(GRID_W * GRID_H) if R[i] or T[i])
print("bbox-normalised silhouette IoU = %.4f" % (inter / union if union else 0.0))

pixels = bytearray(GRID_W * GRID_H * 3)
for i in range(GRID_W * GRID_H):
    if R[i] and T[i]:
        c = (30, 30, 30)
    elif R[i]:
        c = (214, 48, 49)
    elif T[i]:
        c = (9, 132, 227)
    else:
        c = (245, 245, 245)
    pixels[i * 3:i * 3 + 3] = bytes(c)

out = Path("review") / f"silhouette-overlay-{tag}.png"
write_png(out, GRID_W, GRID_H, pixels)
print("wrote", out)
