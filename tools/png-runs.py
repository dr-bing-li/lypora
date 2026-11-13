"""Print colour runs along a row and a column, to measure band / border widths.

Usage: python runs.py <png> <row-y> <col-x>
"""
import sys

from PIL import Image

im = Image.open(sys.argv[1]).convert('RGB')
w, h = im.size
y = int(sys.argv[2]) if len(sys.argv) > 2 else h // 2
x = int(sys.argv[3]) if len(sys.argv) > 3 else w // 3


def q(p):
    return (p[0] // 12 * 12, p[1] // 12 * 12, p[2] // 12 * 12)


def runs(seq):
    out, cur, n, start = [], None, 0, 0
    for i, p in enumerate(seq):
        k = q(p)
        if k != cur:
            if cur is not None and n >= 2:
                out.append((start, i - 1, n, '#%02x%02x%02x' % cur))
            cur, n, start = k, 1, i
        else:
            n += 1
    if cur is not None:
        out.append((start, len(seq) - 1, n, '#%02x%02x%02x' % cur))
    return out


print('image', w, h)
print('--- row', y)
for a, b, n, c in runs([im.getpixel((i, y)) for i in range(w)]):
    print('%4d..%-4d %3dpx %s' % (a, b, n, c))
print('--- col', x)
for a, b, n, c in runs([im.getpixel((x, j)) for j in range(h)]):
    print('%4d..%-4d %3dpx %s' % (a, b, n, c))
