# 从 GitHub Release 拉取本版全部产物的体积与校验值，回填 notes.md / README.md 的占位符
# 用法：python tools/backfill-v071.py
#
# 为什么需要它：体积和 64 位十六进制手抄必错，而且 CI 每次重打都会变（docs/04 V47）。
# 这里把"值从哪来"钉死在一个地方——Release API 的 size 字段 + SHA256SUMS.txt 正文。
import io
import json
import os
import re
import subprocess
import sys

REPO = 'dr-bing-li/lypora'
TAG = 'v0.7.1'
TOK_FILE = os.path.join('build', 'tok.txt')
IP = '140.82.112.6'

if not os.path.exists(TOK_FILE):
    sys.exit('缺 %s（里面放一个有 repo 读权限的 token）' % TOK_FILE)
TOK = open(TOK_FILE).read().strip()

ENV = dict(os.environ)
ENV.update({'NO_PROXY': '*', 'no_proxy': '*', 'HTTPS_PROXY': '', 'HTTP_PROXY': '', 'ALL_PROXY': ''})
# 刻意不设 GITHUB_UPLOAD_IP：uploads.github.com 与 api.github.com 是两套服务，
# 共用 IP 会让附件上传 404（2026-11-02 踩过）。
ENV.pop('GITHUB_UPLOAD_IP', None)


def curl(url, api=True):
    cmd = ['curl', '-sL', '--noproxy', '*']
    if api:
        cmd += ['--resolve', 'api.github.com:443:%s' % IP, '-H', 'Authorization: Bearer %s' % TOK]
    cmd.append(url)
    r = subprocess.run(cmd, capture_output=True, text=True, env=ENV)
    if r.returncode != 0:
        sys.exit('curl failed %s %s' % (r.returncode, url))
    return r.stdout


def api(path):
    raw = curl('https://api.github.com' + path)
    try:
        return json.loads(raw)
    except Exception:
        sys.exit('API 返回不是 JSON（路径 %s）：\n%s' % (path, raw[:400]))


def asset_text(a):
    """经 API 拉附件正文（Accept: octet-stream），绕开 github.com 网页不可达。"""
    url = 'https://api.github.com/repos/%s/releases/assets/%d' % (REPO, a['id'])
    r = subprocess.run(['curl', '-sL', '--noproxy', '*', '--resolve', 'api.github.com:443:%s' % IP,
                        '-H', 'Authorization: Bearer %s' % TOK,
                        '-H', 'Accept: application/octet-stream', url],
                       capture_output=True, env=ENV)
    if r.returncode != 0:
        sys.exit('asset fetch failed %s' % r.returncode)
    return r.stdout.decode('utf-8', 'replace')


rel = api('/repos/%s/releases/tags/%s' % (REPO, TAG))
print('release id =', rel.get('id'), '| draft', rel.get('draft'), '| prerelease', rel.get('prerelease'))
assets = {a['name']: a for a in rel.get('assets', [])}
for n, a in sorted(assets.items()):
    print('  %-40s %10d B  %s' % (n, a['size'], a['state']))

sums = {}
if 'SHA256SUMS.txt' in assets:
    txt = asset_text(assets['SHA256SUMS.txt'])
    for line in txt.splitlines():
        m = re.match(r'^([0-9a-f]{64})\s+\*?(.+)$', line.strip())
        if m:
            sums[m.group(2).strip()] = m.group(1)
    print('SHA256SUMS entries =', len(sums))

# 键名 = 占位符前缀：{{KEY_SIZE}} / {{KEY_SHORT}} / {{KEY_SHA}}
WANT = {
    'apk': 'Lypora-%s-android.apk' % TAG.lstrip('v'),
    'deb': 'lypora_%s_amd64.deb' % TAG.lstrip('v'),
    'rpm': 'lypora-%s-1.x86_64.rpm' % TAG.lstrip('v'),
    'appimage': 'Lypora-%s-linux-x64.AppImage' % TAG.lstrip('v'),
    'targz': 'Lypora-%s-linux-x64.tar.gz' % TAG.lstrip('v'),
    'win': 'Lypora-%s-win-x64.zip' % TAG.lstrip('v'),
    'arm': 'Lypora-%s-macos-arm64.tar.gz' % TAG.lstrip('v'),
    'x64': 'Lypora-%s-macos-x64.tar.gz' % TAG.lstrip('v'),
}

vals = {}
missing = []
for k, name in WANT.items():
    if name not in assets or name not in sums:
        missing.append(name)
        continue
    K = k.upper()
    vals[K + '_SIZE'] = '%.1f MiB' % (assets[name]['size'] / 1048576.0)
    vals[K + '_SHORT'] = sums[name][:8] + '\u2026' + sums[name][-5:]
    vals[K + '_SHA'] = sums[name]

# README 双语表用短别名（AI = AppImage，TG = tar.gz），补一份同值键
vals['AI_SIZE'] = vals.get('APPIMAGE_SIZE', '')
vals['AI_SHORT'] = vals.get('APPIMAGE_SHORT', '')
vals['AI_SHA'] = vals.get('APPIMAGE_SHA', '')
vals['TG_SIZE'] = vals.get('TARGZ_SIZE', '')
vals['TG_SHORT'] = vals.get('TARGZ_SHORT', '')
vals['TG_SHA'] = vals.get('TARGZ_SHA', '')

if missing:
    print('\nMISSING（先确认 CI 是否已把包传完）:')
    for m in missing:
        print('  -', m, '| in assets:', m in assets, '| in sums:', m in sums)
    sys.exit(2)

print(json.dumps(vals, ensure_ascii=False, indent=2))

PH = re.compile(r'\{\{[A-Z0-9_]+\}\}')
for path in ('docs/releases/v0.7.1/notes.md', 'README.md'):
    if not os.path.exists(path):
        print('skip (not found):', path)
        continue
    t = io.open(path, encoding='utf-8', newline='').read()
    n_before = len(PH.findall(t))
    for k, v in vals.items():
        t = t.replace('{{%s}}' % k, v)
    io.open(path, 'w', encoding='utf-8', newline='').write(t)
    left = PH.findall(t)
    print('%-38s %d placeholders -> %d left' % (path, n_before, len(left)))
    if left:
        print('   LEFT:', sorted(set(left)))
        sys.exit(3)

# 顺手把 SHA256SUMS.txt 落到发布目录（作为该版本的归档副本）
if 'SHA256SUMS.txt' in assets:
    txt = asset_text(assets['SHA256SUMS.txt'])
    io.open('docs/releases/v0.7.1/SHA256SUMS.txt', 'w', encoding='utf-8', newline='\n').write(txt)
    print('wrote docs/releases/v0.7.1/SHA256SUMS.txt (%d lines)' % len(txt.strip().splitlines()))
