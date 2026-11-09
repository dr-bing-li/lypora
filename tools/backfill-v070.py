# 从 GitHub Release 拉取 Linux 四件的体积与校验值，回填 notes.md / README.md 的占位符
# 用法：python tools/backfill-v070.py
import io, json, os, re, subprocess, sys

REPO = 'dr-bing-li/lypora'
TAG = 'v0.7.0'
TOK = open(os.path.join('build', 'tok.txt')).read().strip()
IP = '140.82.112.6'

ENV = dict(os.environ)
ENV.update({'NO_PROXY': '*', 'no_proxy': '*', 'HTTPS_PROXY': '', 'HTTP_PROXY': '', 'ALL_PROXY': ''})


def curl(url, out=None, api=True):
    cmd = ['curl', '-s', '--noproxy', '*', '-f' if out else '', '-o', out] if out else ['curl', '-s', '--noproxy', '*']
    cmd = [c for c in cmd if c != '']
    if api:
        cmd += ['--resolve', 'api.github.com:443:%s' % IP, '-H', 'Authorization: Bearer %s' % TOK]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True, env=ENV)
    if r.returncode != 0:
        print('curl failed', r.returncode, url); sys.exit(1)
    return r.stdout


def api(path):
    return json.loads(curl('https://api.github.com' + path))


rel = api('/repos/%s/releases/tags/%s' % (REPO, TAG))
print('release id =', rel['id'], '| draft', rel.get('draft'), '| prerelease', rel.get('prerelease'))
assets = {a['name']: a for a in rel['assets']}
for n, a in sorted(assets.items()):
    print('  %-38s %10d B  %s' % (n, a['size'], a['state']))

def asset_text(a):
    """经 api 拉附件正文（Accept: octet-stream），绕开 github.com 网页不可达"""
    url = 'https://api.github.com/repos/%s/releases/assets/%d' % (REPO, a['id'])
    r = subprocess.run(['curl', '-sL', '--noproxy', '*', '--resolve', 'api.github.com:443:%s' % IP,
                        '-H', 'Authorization: Bearer %s' % TOK,
                        '-H', 'Accept: application/octet-stream', url],
                       capture_output=True, env=ENV)
    if r.returncode != 0:
        print('asset fetch failed', r.returncode); sys.exit(1)
    return r.stdout.decode('utf-8', 'replace')


sums = {}
if 'SHA256SUMS.txt' in assets:
    txt = asset_text(assets['SHA256SUMS.txt'])
    for line in txt.splitlines():
        m = re.match(r'^([0-9a-f]{64})\s+\*?(.+)$', line.strip())
        if m:
            sums[m.group(2).strip()] = m.group(1)
    print('SHA256SUMS entries =', len(sums))

WANT = {
    'deb': 'lypora_0.7.0_amd64.deb',
    'rpm': 'lypora-0.7.0-1.x86_64.rpm',
    'appimage': 'Lypora-0.7.0-linux-x64.AppImage',
    'targz': 'Lypora-0.7.0-linux-x64.tar.gz',
}
vals = {}
missing = []
for k, name in WANT.items():
    if name not in assets or name not in sums:
        missing.append(name); continue
    size_mib = assets[name]['size'] / 1048576.0
    K = k.upper()
    vals[K + '_SIZE'] = '%.1f MiB' % size_mib
    vals[K + '_SHORT'] = sums[name][:8] + '\u2026' + sums[name][-5:]
    vals[K + '_SHA'] = sums[name]

# README 的双语表用短别名（AI = AppImage，TG = tar.gz），补一份同值键
vals['AI_SIZE'] = vals['APPIMAGE_SIZE']; vals['AI_SHORT'] = vals['APPIMAGE_SHORT']
vals['TG_SIZE'] = vals['TARGZ_SIZE'];    vals['TG_SHORT'] = vals['TARGZ_SHORT']

if missing:
    print('MISSING:', missing); sys.exit(2)

print(json.dumps(vals, ensure_ascii=False, indent=2))

for path in ('docs/releases/v0.7.0/notes.md', 'README.md'):
    t = io.open(path, encoding='utf-8', newline='').read()
    n_before = len(re.findall(r'\{\{[A-Z_]+\}\}|__[A-Z_]+__', t))
    for k, v in vals.items():
        # notes.md 用 {{KEY}}，README 用 __KEY__
        t = t.replace('{{%s}}' % k, v).replace('__%s__' % k, v)
    io.open(path, 'w', encoding='utf-8', newline='').write(t)
    left = re.findall(r'\{\{[A-Z_]+\}\}|__[A-Z_]+__', t)
    print('%-38s %d placeholders -> %d left' % (path, n_before, len(left)))
    if left:
        print('   LEFT:', sorted(set(left))); sys.exit(3)

# 顺手把 SHA256SUMS.txt 落到发布目录
if 'SHA256SUMS.txt' in assets:
    txt = asset_text(assets['SHA256SUMS.txt'])
    io.open('docs/releases/v0.7.0/SHA256SUMS.txt', 'w', encoding='utf-8', newline='\n').write(txt)
    print('wrote docs/releases/v0.7.0/SHA256SUMS.txt (%d lines)' % len(txt.strip().splitlines()))
