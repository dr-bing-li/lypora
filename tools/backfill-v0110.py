# 从 GitHub Release 拉取 v0.11.0 全部产物的体积与校验值，回填 notes.md 的下载表
# 用法：python tools/backfill-v0100.py
#
# 与 backfill-v070…v082 的区别：那几版 notes.md 里写的是 {{KEY_SIZE}} 占位符，
# 这版直接写的是人类可读的表；而且 macOS 两件从「由 CI 构建」改成本机构建，
# 所以这里按"表格行 × 文件名列"重写最后两列，而不是做占位符替换。
# 为什么仍然要走 Release API：体积手抄必错，且 CI 重打一次就变（docs/04 V47）。
import io
import json
import os
import re
import subprocess
import sys

REPO = 'dr-bing-li/lypora'
TAG = 'v0.11.0'
VER = TAG.lstrip('v')
TOK_FILE = os.path.join('build', 'tok.txt')
IP = '140.82.112.6'
NOTES = 'docs/releases/%s/notes.md' % TAG

if not os.path.exists(TOK_FILE):
    sys.exit('缺 %s（里面放一个有 repo 读权限的 token）' % TOK_FILE)
TOK = open(TOK_FILE).read().strip()

ENV = dict(os.environ)
ENV.update({'NO_PROXY': '*', 'no_proxy': '*', 'HTTPS_PROXY': '', 'HTTP_PROXY': '', 'ALL_PROXY': ''})
# 刻意不设 GITHUB_UPLOAD_IP：uploads.github.com 与 api.github.com 是两套服务，
# 共用 IP 会让附件上传 404（2026-11-02 踩过）。
ENV.pop('GITHUB_UPLOAD_IP', None)


def curl(args, api=True):
    cmd = ['curl', '-sL', '--noproxy', '*']
    if api:
        cmd += ['--resolve', 'api.github.com:443:%s' % IP, '-H', 'Authorization: Bearer %s' % TOK]
    cmd += args
    r = subprocess.run(cmd, capture_output=True, env=ENV)
    if r.returncode != 0:
        sys.exit('curl failed %s: %s' % (r.returncode, args[-1]))
    return r.stdout


def api(path):
    raw = curl(['--max-time', '40', 'https://api.github.com' + path]).decode('utf-8', 'replace')
    try:
        return json.loads(raw)
    except Exception:
        sys.exit('API 返回不是 JSON（路径 %s）：\n%s' % (path, raw[:400]))


def asset_text(a):
    """经 API 拉附件正文（Accept: octet-stream），绕开 github.com 网页不可达。"""
    url = 'https://api.github.com/repos/%s/releases/assets/%d' % (REPO, a['id'])
    return curl(['--max-time', '60', '-H', 'Accept: application/octet-stream', url]).decode('utf-8', 'replace')


rel = api('/repos/%s/releases/tags/%s' % (REPO, TAG))
print('release id = %s | draft %s | prerelease %s' % (rel.get('id'), rel.get('draft'), rel.get('prerelease')))
assets = {a['name']: a for a in rel.get('assets', [])}
for n, a in sorted(assets.items()):
    print('  %-40s %10d B  %s' % (n, a['size'], a['state']))

sums = {}
if 'SHA256SUMS.txt' in assets:
    for line in asset_text(assets['SHA256SUMS.txt']).splitlines():
        m = re.match(r'^([0-9a-f]{64})\s+\*?(.+)$', line.strip())
        if m:
            sums[m.group(2).strip()] = m.group(1)
    print('SHA256SUMS entries = %d' % len(sums))

# 表格里出现过的 8 个文件（顺序无关，靠文件名命中）
WANT = [
    'Lypora-%s-win-x64.zip' % VER,
    'Lypora-%s-android.apk' % VER,
    'Lypora-%s-macos-arm64.tar.gz' % VER,
    'Lypora-%s-macos-x64.tar.gz' % VER,
    'Lypora-%s-linux-x64.tar.gz' % VER,
    'Lypora-%s-linux-x64.AppImage' % VER,
    'lypora_%s_amd64.deb' % VER,
    'lypora-%s-1.x86_64.rpm' % VER,
]

missing = [n for n in WANT if n not in assets or n not in sums]
if missing:
    print('\nMISSING（先确认 CI 与本地四件都传完了）:')
    for m in missing:
        print('  - %-40s assets:%s sums:%s' % (m, m in assets, m in sums))
    sys.exit(2)

cells = {}
for n in WANT:
    cells[n] = ('%.1f MiB' % (assets[n]['size'] / 1048576.0), '`%s`' % sums[n])

t = io.open(NOTES, encoding='utf-8', newline='').read()
lines = t.split('\n')
hit = []
size_col = {}
for i, line in enumerate(lines):
    if not line.startswith('| `'):
        continue
    parts = line.split('|')
    if len(parts) < 6:
        continue
    name = parts[1].strip().strip('`')
    if name not in cells:
        continue
    size_col[name] = (i, parts)
    hit.append(name)

print('\n命中表格行 %d / %d' % (len(hit), len(WANT)))
for n in WANT:
    if n not in hit:
        print('  ! 表格里没有这一行:', n)

for n in hit:
    i, parts = size_col[n]
    parts[-3] = ' %s ' % cells[n][0]
    parts[-2] = ' %s ' % cells[n][1]
    lines[i] = '|'.join(parts)

t = '\n'.join(lines)

# v0.11.0 的 notes 里来源说明已经是终稿（Windows/Android/macOS 本地、Linux 走 CI），无需再改

io.open(NOTES, 'w', encoding='utf-8', newline='').write(t)
print('\nwrote %s' % NOTES)

# 归档一份线上清单（与线上逐字节一致，便于离线核对）
txt = asset_text(assets['SHA256SUMS.txt'])
io.open('docs/releases/%s/SHA256SUMS.txt' % TAG, 'w', encoding='utf-8', newline='\n').write(txt)
print('wrote docs/releases/%s/SHA256SUMS.txt (%d lines)' % (TAG, len(txt.strip().splitlines())))
