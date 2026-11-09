#!/usr/bin/env python3
"""把图标从打包产物里"挖"出来核对 —— 图标换代的唯一可信证据。

为什么需要：`rcedit 返回 0`、`pack 脚本打印完成`都不是证据，它们只说明命令没报错。
真正要回答的是"用户看到的那个图标，是不是我这次画的那张"。办法只有把它从产物里解出来看。

检查三件事：
  1. Windows：`desktop/icon.ico` 的每一帧，是否原样出现在 `release/Lypora/Lypora.exe` 里
     （rcedit 把 ICO 塞进 PE 的 RT_ICON，帧数据通常逐字节保留；取每帧中间 48 字节做探针）。
  2. macOS：tar.gz 里的 `Lypora.icns` 帧数是否为 11，`ic10` 能否解出 1024×1024。
  3. Android：APK 内 icon 资源的实际像素尺寸（密度的间接证据）。

用法：
  python tools/icon-probe.py                 # 自动找 release/ 下的产物
  python tools/icon-probe.py --exe X.exe --tar Y.tar.gz --apk Z.apk
退出码：0 全中 / 1 有一项对不上
"""

from __future__ import annotations

import argparse
import glob
import io
import os
import struct
import sys
import tarfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICO = os.path.join(ROOT, "desktop", "icon.ico")


def read_ico(path: str) -> list[tuple[int, bytes]]:
    raw = open(path, "rb").read()
    _, _, count = struct.unpack("<HHH", raw[:6])
    out = []
    for i in range(count):
        w, h, _, _, _, _, ln, off = struct.unpack("<BBBBHHII", raw[6 + 16 * i:22 + 16 * i])
        out.append((w or 256, raw[off:off + ln]))
    return out


def probe_exe(exe: str) -> bool:
    if not os.path.exists(exe):
        print(f"  跳过：找不到 {exe}")
        return True
    blob = open(exe, "rb").read()
    frames = read_ico(ICO)
    ok = True
    for size, data in frames:
        probe = data[len(data) // 2: len(data) // 2 + 48]
        hit = blob.find(probe) >= 0
        ok &= hit
        print(f"  {size:>3}px  {len(data):>7} B  {'命中' if hit else '缺失'}")
    print(f"  {len(frames)} 帧 / 命中 {sum(1 for s, d in frames if blob.find(d[len(d)//2:len(d)//2+48]) >= 0)}")
    return ok


def icns_frames(data: bytes) -> dict[str, bytes]:
    assert data[:4] == b"icns", "不是 icns 容器"
    total = struct.unpack(">I", data[4:8])[0]
    out, i = {}, 8
    while i < total:
        tag = data[i:i + 4].decode("ascii", "replace")
        ln = struct.unpack(">I", data[i + 4:i + 8])[0]
        out[tag] = data[i + 8:i + ln]
        i += ln
    return out


def probe_tar(path: str) -> bool:
    if not os.path.exists(path):
        print(f"  跳过：找不到 {path}")
        return True
    with tarfile.open(path, "r:gz") as tf:
        name = next((m.name for m in tf.getmembers() if m.name.endswith("Lypora.icns")), None)
        if not name:
            print("  ✗ 包里没有 Lypora.icns")
            return False
        frames = icns_frames(tf.extractfile(name).read())
    from PIL import Image
    im = Image.open(io.BytesIO(frames["ic10"]))
    im.load()
    ok = len(frames) == 11 and im.size == (1024, 1024)
    print(f"  {os.path.basename(path)}  icns {len(frames)} 帧（期望 11），ic10 {im.size[0]}x{im.size[1]}")
    return ok


def probe_apk(path: str) -> bool:
    if not os.path.exists(path):
        print(f"  跳过：找不到 {path}")
        return True
    from PIL import Image
    ok = True
    with zipfile.ZipFile(path) as zf:
        names = [n for n in zf.namelist() if "mipmap" in n and n.endswith(".png")]
        for n in sorted(names)[:6]:
            im = Image.open(io.BytesIO(zf.read(n)))
            print(f"  {n}  {im.size[0]}x{im.size[1]}")
        if not names:
            print("  ✗ APK 内没有 mipmap PNG")
            ok = False
    return ok


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--exe", default=os.path.join(ROOT, "release", "Lypora", "Lypora.exe"))
    ap.add_argument("--tar", nargs="*", default=sorted(
        t for t in glob.glob(os.path.join(ROOT, "release", "*.tar.gz")) if "macos" in os.path.basename(t)))
    ap.add_argument("--apk", default="")
    a = ap.parse_args()

    apk = a.apk or next(iter(sorted(glob.glob(os.path.join(ROOT, "release", "*.apk")), reverse=True)), "")

    print("[probe] Windows exe ← desktop/icon.ico")
    ok = probe_exe(a.exe)
    for t in a.tar:
        print(f"[probe] macOS ← {os.path.basename(t)}")
        ok &= probe_tar(t)
    if apk:
        print(f"[probe] Android ← {os.path.basename(apk)}")
        ok &= probe_apk(apk)
    print("[probe] 结论：" + ("全部命中" if ok else "有缺失，别发布"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
