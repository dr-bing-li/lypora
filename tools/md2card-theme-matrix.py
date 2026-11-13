"""Build a feature matrix over md2card theme CSS files.

Usage: python theme-matrix.py <themes-dir>
Prints one row per theme: css size, element coverage, and which visual
techniques it uses. ASCII output only.
"""
import io
import os
import re
import sys

FEATS = {
    'dot-tile': r'url\("data:image/svg\+xml',
    'stripes': r'repeating-linear-gradient',
    'rotate': r'transform:\s*rotate',
    'offset-shadow': r'box-shadow:\s*\d+px\s+\d+px\s+0',
    'text-shadow': r'text-shadow',
    'clip-path': r'clip-path',
    'blend': r'mix-blend-mode',
    'pseudo': r'::(before|after)',
    'spacing-calc': r'calc\(var\(--spacing\)',
    'radius': r'border-radius',
}
ELEMS = ['h1', 'h2', 'h3', 'h4', 'blockquote', 'hr', 'ul', 'ol', 'table', 'pre']


def main():
    d = sys.argv[1]
    files = sorted(f for f in os.listdir(d) if f.endswith('.css'))
    print('file\tbytes\t' + '\t'.join(ELEMS) + '\t' + '\t'.join(FEATS))
    for f in files:
        css = io.open(os.path.join(d, f), encoding='utf-8', errors='ignore').read()
        # strip the variant blocks (*.pink-blue-mode etc) for element counting
        rows = [f, str(len(css))]
        for e in ELEMS:
            n = len(re.findall(r'(^|[\s,>])' + e + r'(?![\w-])', css))
            rows.append(str(n))
        for k, pat in FEATS.items():
            rows.append('Y' if re.search(pat, css) else '-')
        print('\t'.join(rows))

    # what does each theme do with the SAME element? one line per theme
    print()
    for f in files:
        css = io.open(os.path.join(d, f), encoding='utf-8', errors='ignore').read()
        i = css.find(' h1 {')
        if i < 0:
            i = css.find(' h1,')
        print('---', f, 'h1 rule:', re.sub(r'\s+', ' ', css[i:i + 260]) if i >= 0 else 'n/a')


if __name__ == '__main__':
    main()
