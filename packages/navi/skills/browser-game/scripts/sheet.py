#!/usr/bin/env python3
"""Put images side by side (or in a grid) in one labelled PNG, so one image read compares them.

usage: python3 -I sheet.py OUT.png IMG [IMG ...] [--cols N] [--height 400]
  Reference vs build:  sheet.py /tmp/g/vs.png <reference image> shots/play.png
  Contact sheet:       sheet.py /tmp/g/all.png shots/*.png --cols 4 --height 260
  Palette of the reference (hex + share):  sheet.py --palette <reference image> [--k 10]
"""
import sys, os, argparse
from PIL import Image, ImageDraw

def palette(path, k):
    im = Image.open(path).convert("RGB"); im.thumbnail((256, 256))
    q = im.quantize(colors=k, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: 3 * k]; counts = sorted(q.getcolors(), reverse=True); total = sum(c for c, _ in counts)
    for c, i in counts:
        r, g, b = pal[3 * i: 3 * i + 3]; print(f"#{r:02x}{g:02x}{b:02x}  {100 * c / total:4.1f}%")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("out"); ap.add_argument("imgs", nargs="*"); ap.add_argument("--cols", type=int, default=0)
    ap.add_argument("--height", type=int, default=400); ap.add_argument("--palette", action="store_true"); ap.add_argument("--k", type=int, default=10)
    a = ap.parse_args()
    if a.palette: return palette(a.out, a.k)
    ims = [Image.open(p).convert("RGB") for p in a.imgs]
    ims = [im.resize((max(1, im.width * a.height // im.height), a.height)) for im in ims]
    cols = a.cols or len(ims); rows = (len(ims) + cols - 1) // cols
    cw = max(im.width for im in ims); lab = 18
    sheet = Image.new("RGB", (cols * (cw + 8), rows * (a.height + lab + 8)), (24, 24, 24)); d = ImageDraw.Draw(sheet)
    for i, (im, p) in enumerate(zip(ims, a.imgs)):
        x, y = (i % cols) * (cw + 8), (i // cols) * (a.height + lab + 8)
        d.text((x + 4, y + 2), os.path.join(os.path.basename(os.path.dirname(p)), os.path.basename(p))[-60:], fill=(230, 230, 230)); sheet.paste(im, (x, y + lab))
    sheet.save(a.out); print(a.out, sheet.size)

if __name__ == "__main__":
    main()
