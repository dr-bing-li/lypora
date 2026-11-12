# 从 GitHub Release 拉取 v0.11.1 全部产物，合并成本地 + CI 的 8 条 SHA256SUMS，
# 回填 notes.md 的下载表与 README 的中文表格
#
# 用法：
#   python tools/backfill-v0111.py            # 拉线上、合并、回填、打印上传命令
#   python tools/backfill-v0111.py --check    # 只核对，不写文件
#
# 与 backfill-v0110 的区别：这版同时回填 README 的表格（v0.11.0 那版 README 是手改的），
# 并且**自己算本地四件的 sha256**（Windows / macOS×2 / APK 是本机构建，线上只在校验用）。
#
# 为什么仍然要走 Release API：体积手抄必错，且 CI 重打一次就变（docs/04 V47）。
import hashlib
import io
import json
import os
import re
import subprocess
import sys

REPO = 'dr-bing-li/lypora'
TAG = 'v0.11.1'
VER = TAG.lstrip('v')
TOK_FILE = os.path.join('build', 'tok.txt')
IP = '140.82.112.6'
NOTES = 'docs/releases/%s/notes.md' % TAG
SUMS_OUT = 'docs/releases/%s/SHA256SUMS.txt' % TAG
README = 'README.md'
RELEASE_DIR = 'release'

# 八件产物：文件名 → 本地产物路径（Linux 四件本地没有，只在线上）
FILES = {
    'Lypora-%s-win-x64.zip' % VER: os.path.join(RELEASE_DIR, 'Lypora-%s-win-x64.zip' % VER),
    'Lypora-%s-android.apk' % VER: os.path.join(RELEASE_DIR, 'Lypora-%s-android.apk' % VER),
    'Lypora-%s-macos-arm64.tar.gz' % VER: os.path.join(RELEASE_DIR, 'Lypora-%s-macos-arm64.tar.gz' % VER),
    'Lypora-%s-macos-x64.tar.gz' % VER: os.path.join(RELEASE_DIR, 'Lypora-%s-macos-x64.tar.gz' % VER),
    'Lypora-%s-linux-x64.tar.gz' % VER: None,
    'Lypora-%s-linux-x64.AppImage' % VER: None,
    'lypora_%s_amd64.deb' % VER: None,
    'lypora-%s-1.x86_64.rpm' % VER: None,
}
CHECK_ONLY = '--check' in sys.argv

if not os.path.exists(TOK_FILE):
    sys.exit('缺 %s（里面放一个有 repo 读权限的 token）' % TOK_FILE)
TOK = io.open(TOK_FILE, encoding='utf-8').read().strip()

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


def sha256_file(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


rel = api('/repos/%s/releases/tags/%s' % (REPO, TAG))
if 'assets' not in rel:
    sys.exit('Release %s 还不存在（先把 --asset 传上去）：%s' % (TAG, str(rel)[:300]))
print('release id = %s | draft %s | prerelease %s' % (rel.get('id'), rel.get('draft'), rel.get('prerelease')))
assets = {a['name']: a for a in rel.get('assets', [])}
for n, a in sorted(assets.items()):
    print('  %-42s %11d B  %s' % (n, a['size'], a['state']))

# 1) 线上 SHA256SUMS（CI 传的 Linux 四条）——可能还没有，缺失就靠本地算补齐
sums = {}
if 'SHA256SUMS.txt' in assets:
    for line in asset_text(assets['SHA256SUMS.txt']).splitlines():
        m = re.match(r'^([0-9a-f]{64})\s+\*?(.+)$', line.strip())
        if m:
            sums[m.group(2).strip()] = m.group(1)
    print('\n线上 SHA256SUMS 条目 = %d' % len(sums))

# 2) 本地四件：自己算，不依赖 CI（本机构建的 Win/mac×2/APK）
missing_local = []
for name, p in FILES.items():
    if not p:
        continue
    if not os.path.exists(p):
        missing_local.append((name, p))
        continue
    sums[name] = sha256_file(p)
    print('  本地 %-38s %s' % (name, sums[name][:16] + '…'))
if missing_local:
    print('\n✗ 本地产物缺：')
    for n, p in missing_local:
        print('  - %s ← %s' % (n, p))
    sys.exit(2)

missing = [n for n in FILES if n not in sums]
if missing:
    print('\n✗ 校验值还不全（CI 未出完？）：')
    for m in missing:
        print('  - %-42s assets:%s' % (m, m in assets))
    sys.exit(2)

# 3) 写一份 8 条的 SHA256SUMS.txt（按文件名排序，与历史版一致）
lines = ['%s  %s' % (sums[n], n) for n in sorted(FILES)]
txt = '\n'.join(lines) + '\n'
if not CHECK_ONLY:
    io.open(SUMS_OUT, 'w', encoding='utf-8', newline='\n').write(txt)
print('\n%s %s（%d 行）' % ('核对' if CHECK_ONLY else 'wrote', SUMS_OUT, len(lines)))

# 4) 体积：线上有就用线上（CI 打的），否则用本地 stat
sizes = {}
for n, p in FILES.items():
    if n in assets:
        sizes[n] = assets[n]['size']
    else:
        sizes[n] = os.path.getsize(p)
        print('  ! %s 尚未上传，体积取本地 stat' % n)

# 5) 回填 notes.md：命中 `| \`name\` |` 的行，重写最后两列
t = io.open(NOTES, encoding='utf-8', newline='').read()
nl = t.split('\n')
hit = 0
for i, line in enumerate(nl):
    if not line.startswith('| `'):
        continue
    parts = line.split('|')
    if len(parts) < 6:
        continue
    name = parts[1].strip().strip('`')
    if name not in FILES:
        continue
    parts[-3] = ' %.1f MiB ' % (sizes[name] / 1048576.0)
    parts[-2] = ' `%s` ' % sums[name]
    nl[i] = '|'.join(parts)
    hit += 1
print('notes 表格命中 %d / %d' % (hit, len(FILES)))
if not CHECK_ONLY:
    io.open(NOTES, 'w', encoding='utf-8', newline='').write('\n'.join(nl))

# 6) 回填 README 中文表格：命中含 `[\\`name\\`](url)` 的行，重写「大小」与「SHA256」两列
r = io.open(README, encoding='utf-8', newline='').read()
rl = r.split('\n')
rhit = 0
for i, line in enumerate(rl):
    if not line.startswith('| [`'):
        continue
    parts = line.split('|')
    if len(parts) < 6:
        continue
    m = re.search(r'`([^`]+)`', parts[1])
    if not m or m.group(1) not in FILES:
        continue
    name = m.group(1)
    h = sums[name]
    parts[-3] = ' %.1f MiB ' % (sizes[name] / 1048576.0)
    parts[-2] = ' %s…%s ' % (h[:8], h[-6:])
    rl[i] = '|'.join(parts)
    rhit += 1
print('README 表格命中 %d / %d' % (rhit, len(FILES)))
if not CHECK_ONLY and rhit:
    io.open(README, 'w', encoding='utf-8', newline='').write('\n'.join(rl))

if not CHECK_ONLY:
    print('\n下一步：')
    print('  GITHUB_TOKEN=$(cat build/tok.txt) GITHUB_API_IP=%s \\' % IP)
    print('    node tools/publish-release.mjs %s --asset %s' % (TAG, SUMS_OUT))
    print('  GITHUB_TOKEN=$(cat build/tok.txt) GITHUB_API_IP=%s \\' % IP)
    print('    node tools/publish-release.mjs %s --notes %s' % (TAG, NOTES))
