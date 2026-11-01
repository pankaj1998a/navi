#!/usr/bin/env python3
"""Turn generated images into game art: cut sprites off a flat background, split sheets, size backdrops, check a game
folder's images. Python 3 standard library (reads PNG and baseline JPEG, uses Pillow when installed; writes PNG).

usage:
  python3 -I sprites.py cut <image.png> <out.png | out dir> [--height PX] [--parts N | --grid CxR] [--frames N]
                        [--names a,b,c] [--key auto|#RRGGBB] [--tol 70]
      Removes the flat background (the colour around the edges, e.g. magenta #FF00FF or green #00FF00; an image that is
      already transparent keeps its alpha), softens and un-tints the edge pixels, and trims to the subject.
      --parts N   the image holds N separate subjects (items, poses): each becomes its own PNG
      --grid CxR  the subjects sit in a C-by-R grid: one PNG per cell, row by row
      --frames N  N animation poses in one row: every pose is scaled by the same factor and placed bottom-centred in
                  one cell size; writes one strip PNG (N cells side by side) and prints cell_w, cell_h
      --height PX scale so the subject (for --frames, the tallest pose) is PX tall
      --names     file names for the parts (else out-1.png, out-2.png, ...)
  python3 -I sprites.py fit <image.png> <out.png> --size WxH
      Opaque backdrop: crops the centre to the W:H shape (nothing is stretched) and scales it to W x H.
  python3 -I sprites.py sheet <out.png> <image> [<image> ...] [--height PX | --native]
      Contact sheet on grey: every image at one height (default 220 px), or at its own size with --native (to compare
      sizes). Open it to check that the art matches in style, outline and palette and has no coloured fringe.
  python3 -I sprites.py info <image.png> [...]
      Size, alpha, transparent share and corner colours.
  python3 -I sprites.py check <game folder> [--no-art-tool]
      The folder must hold generated art (--no-art-tool: the image tool was missing or failed twice) and every image the
      game's code names must exist inside it; lists each image, its size and whether it is transparent, and the images no
      code names. Prints PASS or FAIL.
Every command prints one JSON line per file it writes, then the skill's next missing step (brief, art, each Round's
critique file) and "hand-off: yes" only when none is missing.
"""
import argparse, io, json, math, os, re, struct, sys, zlib
from array import array
from collections import deque

SIG = b"\x89PNG\r\n\x1a\n"
JPEG_SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}
ZZ = [0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14,
      21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60,
      61, 54, 47, 55, 62, 63]
CT = [[(math.sqrt(0.5) if u == 0 else 1.0) * math.cos((2 * x + 1) * u * math.pi / 16) / 2 for u in range(8)]
      for x in range(8)]
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp", ".gif")
CODE_EXT = (".html", ".htm", ".js", ".mjs", ".css", ".json", ".ts")


# ---------- PNG ----------

def read_png(path):
    """(w, h, RGBA bytearray) from a PNG or JPEG (the image tool saves JPEG); WebP and GIF need Pillow."""
    data = open(path, "rb").read()
    if data[:8] != SIG:
        got = pil_rgba(data) if data[:3] != b"\xff\xd8\xff" else (pil_rgba(data) or jpeg_rgba(data))
        if not got:
            raise SystemExit(f"{path}: cannot read this image (PNG and baseline JPEG are supported)")
        return got
    pos, idat, plte, trns = 8, [], None, None
    while pos + 8 <= len(data):
        n, = struct.unpack(">I", data[pos:pos + 4]); t = data[pos + 4:pos + 8]; c = data[pos + 8:pos + 8 + n]; pos += 12 + n
        if t == b"IHDR":
            w, h, bd, ct, _, _, il = struct.unpack(">IIBBBBB", c)
        elif t == b"PLTE":
            plte = c
        elif t == b"tRNS":
            trns = c
        elif t == b"IDAT":
            idat.append(c)
        elif t == b"IEND":
            break
    if il:
        raise SystemExit(f"{path}: interlaced PNG is not supported")
    ch = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[ct]
    if bd not in (8, 16) or (ct == 3 and bd != 8):
        raise SystemExit(f"{path}: {bd}-bit PNG is not supported")
    raw = zlib.decompress(b"".join(idat))
    bpp = ch * bd // 8; stride = w * bpp
    out = bytearray(h * stride); prev = bytearray(stride); i = 0
    for y in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i + stride]); i += stride
        if f == 1:
            for x in range(bpp, stride):
                line[x] = (line[x] + line[x - bpp]) & 255
        elif f == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride):
                line[x] = (line[x] + ((line[x - bpp] if x >= bpp else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x - bpp] if x >= bpp else 0; b = prev[x]; c = prev[x - bpp] if x >= bpp else 0
                p = a + b - c; pa = abs(p - a); pb = abs(p - b); pc = abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[y * stride:(y + 1) * stride] = line; prev = line
    if bd == 16:
        out = out[0::2]
    n = w * h; px = bytearray(n * 4)
    if ct == 6:
        px[:] = out
    elif ct == 2:
        px[0::4] = out[0::3]; px[1::4] = out[1::3]; px[2::4] = out[2::3]; px[3::4] = b"\xff" * n
        if trns and bd == 8 and len(trns) >= 6:
            key = (trns[1], trns[3], trns[5])
            for k in range(n):
                if (px[4 * k], px[4 * k + 1], px[4 * k + 2]) == key:
                    px[4 * k + 3] = 0
    elif ct == 0:
        px[0::4] = out; px[1::4] = out; px[2::4] = out; px[3::4] = b"\xff" * n
    elif ct == 4:
        px[0::4] = out[0::2]; px[1::4] = out[0::2]; px[2::4] = out[0::2]; px[3::4] = out[1::2]
    else:
        pal = [tuple(plte[3 * j:3 * j + 3]) + ((trns[j] if trns and j < len(trns) else 255),) for j in range(len(plte) // 3)]
        for k, v in enumerate(out):
            px[4 * k:4 * k + 4] = bytes(pal[v])
    return w, h, px


def write_png(path, w, h, px, alpha=True):
    ch = 4 if alpha else 3; stride = w * ch; rows = bytearray()
    for y in range(h):
        row = px[y * w * 4:(y + 1) * w * 4]
        if not alpha:
            del row[3::4]
        sub = bytearray(row)
        for x in range(stride - 1, ch - 1, -1):
            sub[x] = (row[x] - row[x - ch]) & 255
        rows.append(1); rows += sub
    def chunk(t, c):
        return struct.pack(">I", len(c)) + t + c + struct.pack(">I", zlib.crc32(t + c) & 0xffffffff)
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "wb") as f:
        f.write(SIG + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6 if alpha else 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


# ---------- JPEG (baseline, standard library) ----------

class Bits:
    """Big-endian bit reader over one unstuffed JPEG entropy segment (reads zeros past its end)."""
    __slots__ = ("d", "p", "acc", "n")

    def __init__(self, d):
        self.d, self.p, self.acc, self.n = d, 0, 0, 0

    def fill(self):
        d, p, acc, n = self.d, self.p, self.acc & ((1 << self.n) - 1), self.n
        while n < 16:
            acc = (acc << 8) | (d[p] if p < len(d) else 0)
            p, n = p + 1, n + 8
        self.p, self.acc, self.n = p, acc, n

    def huff(self, lut):
        if self.n < 16:
            self.fill()
        v = lut[(self.acc >> (self.n - 16)) & 0xFFFF]
        self.n -= v >> 8
        return v & 255

    def value(self, k):
        """The next k bits as a signed JPEG magnitude (EXTEND)."""
        if not k:
            return 0
        if self.n < k:
            self.fill()
        self.n -= k
        v = (self.acc >> self.n) & ((1 << k) - 1)
        return v if v >> (k - 1) else v - (1 << k) + 1


def idct_into(c, flat, plane, pw, x0, y0):
    """Inverse DCT of one dequantized 8x8 block (natural order) into plane at (x0, y0)."""
    if flat:
        row = bytes([max(0, min(255, int(c[0] / 8 + 128.5)))]) * 8
        for y in range(8):
            o = (y0 + y) * pw + x0
            plane[o:o + 8] = row
        return
    live = []
    for v in range(8):
        nz = [(u, a) for u, a in enumerate(c[v * 8:v * 8 + 8]) if a]
        if nz:
            live.append((v, [sum(CT[x][u] * a for u, a in nz) for x in range(8)]))
    for y in range(8):
        cy, o = CT[y], (y0 + y) * pw + x0
        plane[o:o + 8] = bytes(max(0, min(255, int(sum(cy[v] * t[x] for v, t in live) + 128.5))) for x in range(8))


def jpeg_rgba(data):
    """(w, h, RGBA bytearray) from a baseline 8-bit JPEG (1 or 3 components), or None for other JPEG kinds."""
    qt, ht, comps, dri, pos, scan = {}, {}, [], 0, 2, None
    while pos + 4 <= len(data) and scan is None:
        if data[pos] != 0xFF:
            return None
        m = data[pos + 1]
        if m == 0xFF or m in (0xD8, 0x01) or 0xD0 <= m <= 0xD7:
            pos += 1 if m == 0xFF else 2
            continue
        n = struct.unpack(">H", data[pos + 2:pos + 4])[0]
        seg, pos = data[pos + 4:pos + 2 + n], pos + 2 + n
        if m == 0xDB:
            i = 0
            while i < len(seg):
                wide, t = seg[i] >> 4, seg[i] & 15
                vals = struct.unpack(">64H", seg[i + 1:i + 129]) if wide else seg[i + 1:i + 65]
                i += 129 if wide else 65
                q = [0] * 64
                for k in range(64):
                    q[ZZ[k]] = vals[k]
                qt[t] = q
        elif m == 0xC4:
            i = 0
            while i < len(seg):
                key, counts, i = (seg[i] >> 4, seg[i] & 15), seg[i + 1:i + 17], i + 17
                lut, code = [0] * 65536, 0
                for length in range(1, 17):
                    span = 1 << (16 - length)
                    for _ in range(counts[length - 1]):
                        lut[code * span:(code + 1) * span] = [(length << 8) | seg[i]] * span
                        code, i = code + 1, i + 1
                    code <<= 1
                ht[key] = lut
        elif m in (0xC0, 0xC1):
            if seg[0] != 8:
                return None
            h, w = struct.unpack(">HH", seg[1:5])
            comps = [(seg[6 + 3 * k], seg[7 + 3 * k] >> 4, seg[7 + 3 * k] & 15, seg[8 + 3 * k]) for k in range(seg[5])]
        elif m in JPEG_SOF:
            return None  # progressive, lossless or arithmetic coding
        elif m == 0xDD:
            dri = struct.unpack(">H", seg[:2])[0]
        elif m == 0xDA:
            scan = {seg[1 + 2 * k]: (seg[2 + 2 * k] >> 4, seg[2 + 2 * k] & 15) for k in range(seg[0])}
    if not scan or len(comps) not in (1, 3) or set(scan) != {c[0] for c in comps}:
        return None
    end = re.search(rb"\xff(?![\x00\xd0-\xd7])", data[pos:])
    body = data[pos:pos + end.start()] if end else data[pos:]
    segs = [s.replace(b"\xff\x00", b"\xff") for s in re.split(rb"\xff[\xd0-\xd7]", body)]
    hmax, vmax = max(c[1] for c in comps), max(c[2] for c in comps)
    mx, my = -(-w // (8 * hmax)), -(-h // (8 * vmax))
    planes = [(bytearray(mx * hs * 8 * my * vs * 8), mx * hs * 8) for _, hs, vs, _ in comps]
    tabs = [(ht.get((0, scan[cid][0])), ht.get((1, scan[cid][1])), qt.get(tq)) for cid, _, _, tq in comps]
    if any(None in t for t in tabs):
        return None
    total, per, mcu = mx * my, dri or mx * my, 0
    for s in segs:
        bits, preds = Bits(s), [0] * len(comps)
        for _ in range(per):
            if mcu >= total:
                break
            bx, by = mcu % mx, mcu // mx
            for ci, (_, hs, vs, _) in enumerate(comps):
                dc, ac, q = tabs[ci]
                plane, pw = planes[ci]
                for v in range(vs):
                    for u in range(hs):
                        preds[ci] += bits.value(bits.huff(dc))
                        c, flat, k = [0] * 64, True, 1
                        c[0] = preds[ci] * q[0]
                        while k < 64:
                            rs = bits.huff(ac)
                            r, z = rs >> 4, rs & 15
                            if not z:
                                if r != 15:
                                    break
                                k += 16
                                continue
                            k += r
                            if k > 63:
                                break
                            nat = ZZ[k]
                            c[nat], flat, k = bits.value(z) * q[nat], False, k + 1
                        idct_into(c, flat, plane, pw, (bx * hs + u) * 8, (by * vs + v) * 8)
            mcu += 1
    chans = []
    for (plane, pw), (_, hs, vs, _) in zip(planes, comps):
        xs = None if hs == hmax else [x * hs // hmax for x in range(w)]
        rows = []
        for y in range(h):
            row = plane[(y * vs // vmax) * pw:(y * vs // vmax) * pw + pw]
            rows.append(row[:w] if xs is None else bytes(row[x] for x in xs))
        chans.append(b"".join(rows))
    n = w * h
    out = bytearray(n * 4)
    out[3::4] = b"\xff" * n
    if len(chans) == 1:
        out[0::4] = out[1::4] = out[2::4] = chans[0]
        return w, h, out
    clip = bytes(max(0, min(255, v)) for v in range(-400, 656))
    cr_r = [round(1.402 * (i - 128)) + 400 for i in range(256)]
    cb_b = [round(1.772 * (i - 128)) + 400 for i in range(256)]
    cb_g = [-0.344136 * (i - 128) + 400.5 for i in range(256)]
    cr_g = [-0.714136 * (i - 128) for i in range(256)]
    yy, cb, cr = chans
    out[0::4] = bytes(clip[a + cr_r[r]] for a, r in zip(yy, cr))
    out[1::4] = bytes(clip[a + int(cb_g[b] + cr_g[r])] for a, b, r in zip(yy, cb, cr))
    out[2::4] = bytes(clip[a + cb_b[b]] for a, b in zip(yy, cb))
    return w, h, out

def pil_rgba(data):
    """Last resort for WebP, GIF or progressive JPEG: Pillow, if it is installed (also in the user site under -I)."""
    try:
        from PIL import Image
    except ImportError:
        import site
        sys.path.append(site.getusersitepackages())
        try:
            from PIL import Image
        except ImportError:
            return None
    try:
        im = Image.open(io.BytesIO(data)).convert("RGBA")
    except Exception:
        return None
    return im.width, im.height, bytearray(im.tobytes())


# ---------- pixels ----------

def crop(w, h, px, x0, y0, x1, y1):
    out = bytearray()
    for y in range(y0, y1):
        out += px[(y * w + x0) * 4:(y * w + x1) * 4]
    return x1 - x0, y1 - y0, out


def resize(w, h, px, dw, dh):
    """Area-average resample with premultiplied alpha (no dark fringes)."""
    if (dw, dh) == (w, h):
        return bytearray(px)
    def weights(sn, dn):
        s = sn / dn; out = []
        for d in range(dn):
            a = d * s; b = a + s; ws = []
            for i in range(int(a), min(sn, int(math.ceil(b - 1e-9)))):
                wt = min(b, i + 1) - max(a, i)
                if wt > 1e-9:
                    ws.append((i, wt))
            tot = sum(x for _, x in ws) or 1.0
            out.append([(i, x / tot) for i, x in ws])
        return out
    src = array("f", [0.0]) * (w * h * 4)
    for k in range(w * h):
        a = px[4 * k + 3] / 255.0
        src[4 * k] = px[4 * k] * a; src[4 * k + 1] = px[4 * k + 1] * a; src[4 * k + 2] = px[4 * k + 2] * a; src[4 * k + 3] = a
    WX = weights(w, dw); tmp = array("f", [0.0]) * (dw * h * 4)
    for y in range(h):
        b0 = y * w * 4; o0 = y * dw * 4
        for dx, ws in enumerate(WX):
            r = g = b = a = 0.0
            for i, t in ws:
                k = b0 + 4 * i; r += src[k] * t; g += src[k + 1] * t; b += src[k + 2] * t; a += src[k + 3] * t
            o = o0 + 4 * dx; tmp[o] = r; tmp[o + 1] = g; tmp[o + 2] = b; tmp[o + 3] = a
    WY = weights(h, dh); out = bytearray(dw * dh * 4); row = dw * 4
    for dy, ws in enumerate(WY):
        o0 = dy * row
        for x in range(dw):
            r = g = b = a = 0.0
            for i, t in ws:
                k = i * row + 4 * x; r += tmp[k] * t; g += tmp[k + 1] * t; b += tmp[k + 2] * t; a += tmp[k + 3] * t
            o = o0 + 4 * x
            if a > 1e-6:
                out[o] = min(255, int(r / a + .5)); out[o + 1] = min(255, int(g / a + .5)); out[o + 2] = min(255, int(b / a + .5))
            out[o + 3] = min(255, int(a * 255 + .5))
    return out


def parse_hex(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def border_indices(w, h):
    return [x for x in range(w)] + [(h - 1) * w + x for x in range(w)] + [y * w for y in range(1, h - 1)] + [y * w + w - 1 for y in range(1, h - 1)]


def key_out(w, h, px, key="auto", tol=70):
    """Make the flat background transparent. Returns (px, info)."""
    n = w * h; edge = border_indices(w, h)
    if sum(1 for i in edge if px[4 * i + 3] < 16) >= len(edge) // 2:
        return px, {"background": "already transparent"}
    if key == "auto":
        bins = {}
        for i in edge:
            q = (px[4 * i] >> 3, px[4 * i + 1] >> 3, px[4 * i + 2] >> 3); bins.setdefault(q, []).append(i)
        top = max(bins.values(), key=len)
        K = tuple(sum(px[4 * i + c] for i in top) // len(top) for c in range(3))
        share = len(top) / len(edge)
    else:
        K = parse_hex(key); share = None
    kr, kg, kb = K
    def dist(i):
        return max(abs(px[4 * i] - kr), abs(px[4 * i + 1] - kg), abs(px[4 * i + 2] - kb))
    bg = bytearray(n); q = deque()
    for i in edge:
        if not bg[i] and dist(i) < tol:
            bg[i] = 1; q.append(i)
    while q:
        i = q.popleft(); x = i % w
        for j in ((i - w) if i >= w else -1, (i + w) if i + w < n else -1, (i - 1) if x else -1, (i + 1) if x < w - 1 else -1):
            if j >= 0 and not bg[j] and dist(j) < tol:
                bg[j] = 1; q.append(j)
    inner = tol * 0.5  # near-exact key colour enclosed by the subject (gaps between arms, under a handle)
    for i in range(n):
        if not bg[i] and dist(i) < inner:
            bg[i] = 1
    out = bytearray(px)
    for i in range(n):
        if bg[i]:
            out[4 * i + 3] = 0
    # soft, un-tinted edges: pixels within 2 px of the background get alpha from their distance to the key colour
    ring = bytearray(n)
    for _ in range(2):
        add = []
        for i in range(n):
            if bg[i] or ring[i]:
                continue
            x = i % w
            for j in ((i - w) if i >= w else -1, (i + w) if i + w < n else -1, (i - 1) if x else -1, (i + 1) if x < w - 1 else -1):
                if j >= 0 and (bg[j] or ring[j] == 1):
                    add.append(i); break
        for i in add:
            ring[i] = 1 if _ == 0 else 2
    lo, hi = tol * 0.5, tol * 1.6; tinted = 0; nring = 0
    for i in range(n):
        if not ring[i]:
            continue
        nring += 1; d = dist(i)
        a = 1.0 if d >= hi else max(0.0, (d - lo) / (hi - lo))
        if a <= 0.02:
            out[4 * i + 3] = 0; continue
        for c in range(3):
            v = (px[4 * i + c] - (1 - a) * K[c]) / a
            out[4 * i + c] = 0 if v < 0 else 255 if v > 255 else int(v + .5)
        out[4 * i + 3] = int(a * px[4 * i + 3] + .5)
        if d < hi:
            tinted += 1
    clear = sum(1 for i in range(n) if out[4 * i + 3] == 0)
    info = {"background": "#%02x%02x%02x" % K, "border_share": round(share, 2) if share is not None else None,
            "transparent_share": round(clear / n, 3), "edge_px_softened": tinted}
    if share is not None and share < 0.6:
        info["warning"] = "the edges are not one flat colour: ask for 'a plain flat solid magenta (#FF00FF) background' and cut again"
    return out, info


def components(w, h, px):
    """8-connected opaque regions: list of [area, x0, y0, x1, y1] (x1/y1 exclusive), and the label array."""
    n = w * h; lab = array("i", [0]) * n; comps = []
    for s in range(n):
        if lab[s] or px[4 * s + 3] < 24:
            continue
        cid = len(comps) + 1; lab[s] = cid; q = deque([s]); area = 0; x0 = y0 = 1 << 30; x1 = y1 = -1
        while q:
            i = q.popleft(); area += 1; x, y = i % w, i // w
            x0 = min(x0, x); x1 = max(x1, x); y0 = min(y0, y); y1 = max(y1, y)
            for dy in (-1, 0, 1):
                yy = y + dy
                if yy < 0 or yy >= h:
                    continue
                for dx in (-1, 0, 1):
                    xx = x + dx
                    if 0 <= xx < w:
                        j = yy * w + xx
                        if not lab[j] and px[4 * j + 3] >= 24:
                            lab[j] = cid; q.append(j)
        comps.append([area, x0, y0, x1 + 1, y1 + 1])
    return comps, lab


def gap(a, b):
    dx = max(0, max(a[1], b[1]) - min(a[3], b[3])); dy = max(0, max(a[2], b[2]) - min(a[4], b[4]))
    return max(dx, dy)


def group_parts(w, h, px, want=None):
    comps, lab = components(w, h, px)
    if not comps:
        raise SystemExit("nothing left after removing the background: check the image (info) or pass --key/--tol")
    big = max(c[0] for c in comps)
    keep = [k for k, c in enumerate(comps) if c[0] >= max(12, big * 0.002)]
    groups = [[k] for k in keep]; box = [list(comps[k]) for k in keep]
    near = max(4, int(min(w, h) * 0.015))
    def merge(a, b):
        groups[a] += groups[b]; ba, bb = box[a], box[b]
        box[a] = [ba[0] + bb[0], min(ba[1], bb[1]), min(ba[2], bb[2]), max(ba[3], bb[3]), max(ba[4], bb[4])]
        del groups[b]; del box[b]
    changed = True
    while changed:  # join pieces that nearly touch (a detached hand, a sword) into one subject
        changed = False; a = 0
        while a < len(box):
            b = a + 1
            while b < len(box):
                if gap(box[a], box[b]) <= near:
                    merge(a, b); changed = True
                else:
                    b += 1
            a += 1
    while want and len(box) > want:
        s = min(range(len(box)), key=lambda k: box[k][0])
        t = min((k for k in range(len(box)) if k != s), key=lambda k: gap(box[s], box[k]))
        merge(t, s)
    hs = sorted(b[4] - b[2] for b in box); mh = hs[len(hs) // 2]
    order = sorted(range(len(box)), key=lambda k: (box[k][2] + box[k][4]) / 2)
    rows, cur, top = [], [], None
    for k in order:
        cy = (box[k][2] + box[k][4]) / 2
        if cur and cy - top > 0.5 * mh:
            rows.append(cur); cur = []
        if not cur:
            top = cy
        cur.append(k)
    rows.append(cur)
    order = [k for r in rows for k in sorted(r, key=lambda k: box[k][1])]
    parts = []
    for k in order:
        ids = {g + 1 for g in groups[k]}; _, x0, y0, x1, y1 = box[k]
        sub = bytearray()
        for y in range(y0, y1):
            for x in range(x0, x1):
                i = y * w + x
                sub += px[4 * i:4 * i + 4] if lab[i] in ids else b"\0\0\0\0"
        parts.append((x1 - x0, y1 - y0, sub))
    return parts


def trim(w, h, px, pad=1):
    ys = [y for y in range(h) if any(px[(y * w + x) * 4 + 3] for x in range(w))]
    if not ys:
        return w, h, px
    xs = [x for x in range(w) if any(px[(y * w + x) * 4 + 3] for y in range(ys[0], ys[-1] + 1))]
    x0, x1 = max(0, xs[0] - pad), min(w, xs[-1] + 1 + pad); y0, y1 = max(0, ys[0] - pad), min(h, ys[-1] + 1 + pad)
    return crop(w, h, px, x0, y0, x1, y1)


def place(cw, ch, w, h, px):
    """Bottom-centred in a cw x ch transparent cell."""
    out = bytearray(cw * ch * 4); ox = (cw - w) // 2; oy = ch - h
    for y in range(h):
        out[((oy + y) * cw + ox) * 4:((oy + y) * cw + ox + w) * 4] = px[y * w * 4:(y + 1) * w * 4]
    return out


def emit(**kw):
    print(json.dumps(kw))


def process_next(art_ok=True, art_msg=None, game=None):
    """The skill's next missing step, from files on disk: the brief, spec.md, the assets, then each Round's critique file."""
    b = "/tmp/game/brief.md"
    if not os.path.isfile(b) or os.path.getsize(b) < 1500:
        return ("next: save the whole brief word for word to /tmp/game/brief.md now (Brief item); every critic reads it", False)
    if game and not os.path.isfile(os.path.join(game, "assets", "manifest.json")):
        return (f"next: the art director's manifest ({os.path.join(game, 'assets', 'manifest.json')}) is not there yet: if you have "
                "not spawned the art director, spawn it now (message in SKILL.md); otherwise go on with the spec and the build, "
                "then subagent_wait for it", False)
    sp = "/tmp/game/spec.md"
    if not os.path.isfile(sp) or os.path.getsize(sp) < 1500:
        return ("next: write /tmp/game/spec.md (requirements trace, balance targets, feedback plan)", False)
    if not art_ok:
        return (art_msg or "next: wire the assets listed in assets/manifest.json into the game (Art)", False)
    for n in (1, 2, 3):
        c = f"/tmp/game/critique-{n}/critique.md"
        if not os.path.isfile(c) or os.path.getsize(c) < 800:
            return (f"next (after the build): Round {n}: copy the game to /tmp/game/snap-{n} and spawn the critic (critic.md) with "
                    f"CRITIQUE={c}; Round {n} is not done until that file exists and you fixed its majors", False)
    return ("next: polish sweep, then the final play of the exact delivered files", True)


def print_next(art_ok=True, art_msg=None, game=None):
    nxt, ok = process_next(art_ok, art_msg, game)
    print(nxt)
    print("hand-off: " + ("yes" if ok else "no (" + nxt.split(": ", 1)[1].split(";")[0] + ")"))


# ---------- commands ----------

def cmd_cut(a):
    w, h, px = read_png(a.image)
    px, info = key_out(w, h, px, a.key, a.tol)
    if a.grid:
        c, r = (int(v) for v in a.grid.lower().split("x"))
        parts = []
        for j in range(r):
            for i in range(c):
                parts.append(trim(*crop(w, h, px, i * w // c, j * h // r, (i + 1) * w // c, (j + 1) * h // r)))
    elif a.parts or a.frames:
        parts = group_parts(w, h, px, a.parts or a.frames)
    else:
        parts = [trim(w, h, px)]
    want = a.parts or a.frames or (len(parts) if a.grid else 1)
    if len(parts) != want:
        info["warning"] = (f"found {len(parts)} subjects, wanted {want}: regenerate with wider gaps between them on the flat "
                           "background, or use --grid CxR")
    names = a.names.split(",") if a.names else None
    if a.frames:
        tall = max(p[1] for p in parts); s = (a.height / tall) if a.height else 1.0
        sized = [(max(1, round(p[0] * s)), max(1, round(p[1] * s))) for p in parts]
        cells = [resize(p[0], p[1], p[2], dw, dh) for p, (dw, dh) in zip(parts, sized)]
        cw = max(d[0] for d in sized) + 2; chh = max(d[1] for d in sized) + 1
        strip_w = cw * len(cells); strip = bytearray(strip_w * chh * 4)
        for k, (cell, (dw, dh)) in enumerate(zip(cells, sized)):
            placed = place(cw, chh, dw, dh, cell)
            for y in range(chh):
                strip[(y * strip_w + k * cw) * 4:(y * strip_w + (k + 1) * cw) * 4] = placed[y * cw * 4:(y + 1) * cw * 4]
        out = a.out if a.out.lower().endswith(".png") else os.path.join(a.out, "frames.png")
        write_png(out, strip_w, chh, strip)
        emit(file=out, frames=len(cells), cell_w=cw, cell_h=chh, sheet_w=strip_w, sheet_h=chh, **info)
        return 0
    multi = len(parts) > 1 or a.grid or a.parts
    for k, (pw, ph, pp) in enumerate(parts):
        if a.height:
            dw, dh = max(1, round(pw * a.height / ph)), a.height
            pp = resize(pw, ph, pp, dw, dh); pw, ph = dw, dh
        if not multi:
            out = a.out if a.out.lower().endswith(".png") else os.path.join(a.out, os.path.basename(a.image))
        elif a.out.lower().endswith(".png"):
            out = a.out[:-4] + "-" + (names[k] if names and k < len(names) else str(k + 1)) + ".png"
        else:
            out = os.path.join(a.out, (names[k] if names and k < len(names) else f"part-{k + 1}") + ".png")
        write_png(out, pw, ph, pp)
        emit(file=out, w=pw, h=ph, **info)
    return 0


def cmd_fit(a):
    w, h, px = read_png(a.image); dw, dh = (int(v) for v in a.size.lower().split("x"))
    if w / h > dw / dh:
        cw = round(h * dw / dh); x0 = (w - cw) // 2; w2, h2, px = crop(w, h, px, x0, 0, x0 + cw, h)
    else:
        chh = round(w * dh / dw); y0 = (h - chh) // 2; w2, h2, px = crop(w, h, px, 0, y0, w, y0 + chh)
    out = resize(w2, h2, px, dw, dh)
    for k in range(3, len(out), 4):
        out[k] = 255
    write_png(a.out, dw, dh, out, alpha=False)
    emit(file=a.out, w=dw, h=dh, cropped_from=f"{w}x{h}")
    return 0


def cmd_sheet(a):
    imgs = []
    for p in a.images:
        w, h, px = read_png(p)
        if not a.native:
            dw = max(1, round(w * a.height / h)); px = resize(w, h, px, dw, a.height); w, h = dw, a.height
        imgs.append((p, w, h, px))
    gapx, maxw = 16, 1800; rows, cur, cw = [], [], gapx
    for im in imgs:
        if cur and cw + im[1] + gapx > maxw:
            rows.append(cur); cur, cw = [], gapx
        cur.append(im); cw += im[1] + gapx
    rows.append(cur)
    W = max(gapx + sum(i[1] + gapx for i in r) for r in rows); H = gapx + sum(max(i[2] for i in r) + gapx for r in rows)
    out = bytearray(b"\x80\x80\x80\xff" * (W * H)); y = gapx
    for r in rows:
        x = gapx; rh = max(i[2] for i in r)
        for p, w, h, px in r:
            oy = y + rh - h
            for yy in range(h):
                for xx in range(w):
                    s = (yy * w + xx) * 4; al = px[s + 3]
                    if al:
                        d = ((oy + yy) * W + x + xx) * 4
                        for c in range(3):
                            out[d + c] = (px[s + c] * al + out[d + c] * (255 - al)) // 255
            x += w + gapx
        y += rh + gapx
    write_png(a.out, W, H, out, alpha=False)
    emit(file=a.out, w=W, h=H, order=[os.path.basename(i[0]) for i in imgs])
    return 0


def info_of(p):
    w, h, px = read_png(p); n = w * h
    clear = sum(1 for k in range(3, len(px), 4) if px[k] < 16)
    corners = ["#%02x%02x%02x/%d" % tuple(px[4 * i:4 * i + 4]) for i in (0, w - 1, (h - 1) * w, n - 1)]
    return {"file": p, "w": w, "h": h, "bytes": os.path.getsize(p), "transparent_share": round(clear / n, 3), "corners": corners}


def cmd_info(a):
    for p in a.images:
        emit(**info_of(p))
    return 0


def cmd_check(a):
    root = os.path.abspath(a.game); imgs, code = [], []
    for d, dirs, files in os.walk(root):
        dirs[:] = [x for x in dirs if x not in ("node_modules", ".git")]
        for f in files:
            p = os.path.join(d, f); e = os.path.splitext(f)[1].lower()
            (imgs if e in IMG_EXT else code if e in CODE_EXT else []).append(p)
    pat = re.compile(r"""["'`(]([^"'`()\s]+\.(?:png|jpe?g|webp|gif))(?:\?[^"'`)]*)?["'`)]""", re.I)
    used, bad = set(), []
    for c in code:
        for m in pat.finditer(open(c, errors="replace").read()):
            ref = m.group(1)
            if "${" in ref or "+" in ref:
                continue
            if ref.startswith(("http://", "https://", "data:")):
                bad.append(f"{os.path.relpath(c, root)} loads {ref} from outside the folder"); continue
            cands = [os.path.normpath(os.path.join(os.path.dirname(c), ref)), os.path.normpath(os.path.join(root, ref.lstrip("/")))]
            hit = next((x for x in cands if os.path.isfile(x)), None)
            if hit and hit.startswith(root + os.sep):
                used.add(hit)
            else:
                bad.append(f"{os.path.relpath(c, root)} names {ref}, which is not a file inside the game folder")
    total = 0
    for p in sorted(imgs):
        total += os.path.getsize(p); rec = {"image": os.path.relpath(p, root), "bytes": os.path.getsize(p), "named_in_code": p in used}
        if p.lower().endswith(".png"):
            try:
                i = info_of(p); rec.update(w=i["w"], h=i["h"], transparent_share=i["transparent_share"])
            except SystemExit as e:
                rec["error"] = str(e)
        emit(**rec)
    unnamed = [os.path.relpath(p, root) for p in imgs if p not in used]
    if imgs and not used and not a.no_art_tool:
        bad.append("the game's code names none of the images in the game folder: wire the assets from assets/manifest.json in")
    if not imgs and not a.no_art_tool:
        bad.append("no image file in the game folder yet: the art director saves the assets under assets/ (SKILL.md, Art); "
                   "only if the image tool is missing or failed twice, rerun with --no-art-tool")
    for b in bad:
        print("FAIL:", b)
    print(("FAIL" if bad else "PASS") + f": art check: {len(imgs)} image(s) in the game folder ({total // 1024} KB), "
          f"{len(used)} named in code" + (f"; not named anywhere (dynamic names are fine, else delete): {', '.join(unnamed)}" if unnamed else ""))
    print_next(art_ok=not bad, art_msg=None if not imgs else "next: fix the FAIL lines above (every image the code names must be a file in the game folder)", game=root)
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("cut"); c.add_argument("image"); c.add_argument("out"); c.add_argument("--height", type=int)
    c.add_argument("--parts", type=int); c.add_argument("--grid"); c.add_argument("--frames", type=int); c.add_argument("--names")
    c.add_argument("--key", default="auto"); c.add_argument("--tol", type=int, default=70)
    f = sub.add_parser("fit"); f.add_argument("image"); f.add_argument("out"); f.add_argument("--size", required=True)
    s = sub.add_parser("sheet"); s.add_argument("out"); s.add_argument("images", nargs="+"); s.add_argument("--height", type=int, default=220)
    s.add_argument("--native", action="store_true")
    i = sub.add_parser("info"); i.add_argument("images", nargs="+")
    k = sub.add_parser("check"); k.add_argument("game"); k.add_argument("--no-art-tool", action="store_true")
    a = ap.parse_args()
    rc = {"cut": cmd_cut, "fit": cmd_fit, "sheet": cmd_sheet, "info": cmd_info, "check": cmd_check}[a.cmd](a)
    return rc


if __name__ == "__main__":
    sys.exit(main())
