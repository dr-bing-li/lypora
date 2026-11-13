"""Extract md2card theme definitions (CSS + metadata) from a minified Next.js chunk.

Usage: python extract-theme.py <chunk.js> <outdir>
Writes <outdir>/<id>.css for every theme that carries a css string, plus
<outdir>/index.tsv listing id, zh name, en name, className, css length.
ASCII-only console output so Windows consoles do not mangle it.
"""
import io
import json
import os
import re
import sys


def read_js_str(s, start):
    """Read a JS double-quoted string literal starting at s[start] == '"'."""
    assert s[start] == '"'
    out = []
    k = start + 1
    while k < len(s):
        c = s[k]
        if c == '\\':
            out.append(s[k:k + 2])
            k += 2
            continue
        if c == '"':
            return ''.join(out), k + 1
        out.append(c)
        k += 1
    raise ValueError('unterminated string')


def unescape(raw):
    # JS escapes -> text. Keep it dependency free: handle the ones that appear.
    def repl(m):
        e = m.group(1)
        if e.startswith('u'):
            return chr(int(e[1:], 16))
        if e.startswith('x'):
            return chr(int(e[1:], 16))
        return {'n': '\n', 't': '\t', 'r': '\r', '"': '"', '\\': '\\', "'": "'", '/': '/'}.get(e, e)
    return re.sub(r'\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)', repl, raw)


def main():
    src, outdir = sys.argv[1], sys.argv[2]
    os.makedirs(outdir, exist_ok=True)
    s = io.open(src, encoding='utf-8', errors='ignore').read()

    # Theme records look like: name:"...",enName:"...",id:"...",thumbnail:"...",className:"...",code:"...",css:"..."
    rec = re.compile(
        r'name:"([^"]{1,40})",enName:"([^"]{1,60})",id:"([^"]{1,40})"'
        r'(?:,thumbnail:"([^"]*)")?,className:"([^"]*)"(?:,code:"([^"]*)")?,css:')
    rows = []
    for m in rec.finditer(s):
        zh, en, tid, thumb, cls, code = m.groups()
        pos = m.end()
        if pos >= len(s) or s[pos] != '"':
            continue
        raw, _ = read_js_str(s, pos)
        css = unescape(raw)
        safe = re.sub(r'[^A-Za-z0-9_.-]', '_', tid)
        io.open(os.path.join(outdir, safe + '.css'), 'w', encoding='utf-8', newline='\n').write(css)
        rows.append((tid, zh, en, cls, code or '', len(css), bool(thumb)))

    with io.open(os.path.join(outdir, 'index.tsv'), 'w', encoding='utf-8', newline='\n') as f:
        f.write('id\tname_zh\tname_en\tclassName\tcode\tcss_chars\tthumb\n')
        for r in rows:
            f.write('\t'.join(str(x) for x in r) + '\n')

    print('themes with css:', len(rows))
    total = sum(r[5] for r in rows)
    print('total css bytes:', total, '| median:', sorted(r[5] for r in rows)[len(rows) // 2] if rows else 0)
    for r in sorted(rows, key=lambda x: -x[5])[:8]:
        print('  big', r[0], 'css', r[5], 'code', r[4])


if __name__ == '__main__':
    main()
