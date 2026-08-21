#!/usr/bin/env python3
"""Cut the two saluting figures out of the generated artwork.

The picture Stav generated is a wide image of two figures standing on a paper
texture. The certificate is a dark olive field, so the paper has to go — and it
has to go without eating the light parts of the figures (skin, the highlights
on the uniform). That rules out "make every light pixel transparent".

What this does instead: flood-fill inward from the four corners with a colour
tolerance, so only background CONNECTED to the border is removed. A light patch
inside a figure is never reached, because the figure's outline stops the fill.

    python3 scripts/art/salute_cutout.py assets/salute-source.png

Writes assets/salute-a.png (right figure, RTL: the first one you read) and
assets/salute-b.png, each trimmed to the figure and 512px tall.
"""
import sys
import pathlib
from PIL import Image, ImageDraw
import numpy as np

SENTINEL = (255, 0, 255)      # a colour the artwork cannot contain
TOLERANCE = 42                # per-channel distance that still counts as paper
TARGET_H = 512


def cut_background(img: Image.Image) -> Image.Image:
    rgb = img.convert('RGB')
    w, h = rgb.size
    # Fill from a ring of points around the border, not just the corners: the
    # paper is textured, and one corner can be a shade the opposite corner is
    # not.
    seeds = []
    for x in range(0, w, max(1, w // 24)):
        seeds += [(x, 0), (x, h - 1)]
    for y in range(0, h, max(1, h // 24)):
        seeds += [(0, y), (w - 1, y)]
    for xy in seeds:
        if rgb.getpixel(xy) == SENTINEL:
            continue
        ImageDraw.floodfill(rgb, xy, SENTINEL, thresh=TOLERANCE)

    arr = np.array(rgb)
    mask = np.all(arr == np.array(SENTINEL), axis=-1)
    out = np.array(img.convert('RGBA'))
    out[mask] = (0, 0, 0, 0)
    return Image.fromarray(out, 'RGBA')


def split_figures(img: Image.Image):
    """Two figures, so: the two widest runs of columns that hold any pixel."""
    alpha = np.array(img)[:, :, 3]
    cols = alpha.max(axis=0) > 8
    runs, start = [], None
    for x, filled in enumerate(cols):
        if filled and start is None:
            start = x
        elif not filled and start is not None:
            runs.append((start, x)); start = None
    if start is not None:
        runs.append((start, len(cols)))
    runs = [r for r in runs if r[1] - r[0] > 20]
    runs.sort(key=lambda r: r[1] - r[0], reverse=True)
    return sorted(runs[:2])


def trim(img: Image.Image) -> Image.Image:
    box = img.getbbox()
    return img.crop(box) if box else img


def main():
    src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'assets/salute-source.png')
    if not src.exists():
        sys.exit(f'not found: {src}\nPut the artwork there (png/jpg) and run again.')
    img = Image.open(src)
    cut = cut_background(img)
    runs = split_figures(cut)
    if len(runs) != 2:
        sys.exit(f'expected two figures, found {len(runs)} — check the source or the tolerance')

    # RTL: the figure on the right is the one the eye meets first, so it is "a".
    order = list(reversed(runs))
    for name, (x0, x1) in zip(('a', 'b'), order):
        fig = trim(cut.crop((x0, 0, x1, cut.height)))
        scale = TARGET_H / fig.height
        fig = fig.resize((max(1, round(fig.width * scale)), TARGET_H), Image.LANCZOS)
        out = pathlib.Path('assets') / f'salute-{name}.png'
        fig.save(out, optimize=True)
        print(f'{out}  {fig.width}x{fig.height}  {out.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
