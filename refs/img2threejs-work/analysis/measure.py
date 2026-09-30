"""Minimal stdlib PNG reader + silhouette profiler for the img2threejs reference."""
import zlib, struct, sys


def read_png(path):
    data = open(path, "rb").read()
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "not a png"
    pos = 8
    idat = b""
    w = h = bitd = ctype = None
    plte = None
    while pos < len(data):
        (ln,) = struct.unpack(">I", data[pos:pos + 4])
        typ = data[pos + 4:pos + 8]
        chunk = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if typ == b"IHDR":
            w, h, bitd, ctype, comp, filt, inter = struct.unpack(">IIBBBBB", chunk)
            assert inter == 0, "interlaced unsupported"
        elif typ == b"IDAT":
            idat += chunk
        elif typ == b"PLTE":
            plte = chunk
        elif typ == b"IEND":
            break
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ctype]
    assert bitd == 8, "only 8-bit"
    stride = w * channels
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if ft == 1:
            for i in range(channels, stride):
                line[i] = (line[i] + line[i - channels]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pa = abs(b - c); pb = abs(a - c); pc = abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, channels, plte, bytes(out)


def to_rgb(w, h, ch, plte, buf):
    px = []
    if ch == 3:
        return buf, w, h
    if ch == 4:
        b = bytearray(w * h * 3)
        for i in range(w * h):
            b[i * 3:i * 3 + 3] = buf[i * 4:i * 4 + 3]
        return bytes(b), w, h
    if ch == 1:
        b = bytearray(w * h * 3)
        for i in range(w * h):
            v = buf[i]
            if plte:
                b[i * 3:i * 3 + 3] = plte[v * 3:v * 3 + 3]
            else:
                b[i * 3] = b[i * 3 + 1] = b[i * 3 + 2] = v
        return bytes(b), w, h
    if ch == 2:
        b = bytearray(w * h * 3)
        for i in range(w * h):
            v = buf[i * 2]
            b[i * 3] = b[i * 3 + 1] = b[i * 3 + 2] = v
        return bytes(b), w, h
    raise SystemExit("unsupported ch %d" % ch)


path = sys.argv[1]
w, h, ch, plte, buf = read_png(path)
rgb, w, h = to_rgb(w, h, ch, plte, buf)
print("size", w, h, "channels", ch)

# foreground = pixel notably darker than the near-white background
TH = 200


def isfg(x, y):
    i = (y * w + x) * 3
    r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
    return (r + g + b) / 3 < TH


rows = []
for y in range(h):
    xs = [x for x in range(w) if isfg(x, y)]
    if xs:
        rows.append((y, min(xs), max(xs)))

top = rows[0][0]
bot = rows[-1][0]
print("subject rows: top=%d bottom=%d height=%d" % (top, bot, bot - top))

# horizontal width profile every 5% of subject height
print("\n  ynorm   y     xmin  xmax  width  center")
for f in [i / 20 for i in range(21)]:
    y = int(top + f * (bot - top))
    y = min(y, h - 1)
    r = next((r for r in rows if r[0] == y), None)
    if r:
        print("  %.2f  %4d   %4d  %4d  %4d   %4d" % (f, r[0], r[1], r[2], r[2] - r[1], (r[1] + r[2]) // 2))
