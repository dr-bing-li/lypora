#!/usr/bin/env python3
"""
把一个 Electron linux-x64 分发包摊成 deb / rpm / AppImage 共用的 FHS 暂存树。

用法：
  # 1) 生成暂存树（顺带写出 deb 的 DEBIAN/）
  python tools/linux-stage.py --zip electron-v33.4.11-linux-x64.zip --stage build/stage --deb

  # 2) 由暂存树生成 AppDir（appimagetool 的输入）
  python tools/linux-stage.py --stage build/stage --appdir build/AppDir

之后在 Linux 上：
  dpkg-deb --build --root-owner-group build/stage release/lypora_<ver>_amd64.deb
  rpmbuild -bb --define "_version <ver>" --define "_stage_root $PWD/build/stage" \
           --define "_topdir $PWD/build/rpm" packaging/lypora.spec
  ARCH=x86_64 appimagetool --appimage-extract-and-run build/AppDir release/….AppImage

为什么树在这里生成、包在那头打：
  dpkg-deb 与 rpmbuild 都是 ELF 程序，Windows 上跑不了（本机无 WSL、无 Docker）。
  但"哪些文件、什么权限、放哪个路径"是纯数据，Windows 上也能算出来并检查；
  真正的归档封包交给 CI 的 Linux 跑。这样两边算的是同一棵树，不会各写一套。
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _linuxpkg import (  # noqa: E402
    APP_PREFIX,
    deb_control,
    make_appdir,
    stage_tree,
    write_debian_dir,
)
from _packlib import ROOT, fail, log, read_version  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", help="electron-v<ver>-linux-x64.zip")
    ap.add_argument("--stage", default=os.path.join(ROOT, "build", "stage"))
    ap.add_argument("--deb", action="store_true", help="同时写出 DEBIAN/（control、md5sums、维护者脚本）")
    ap.add_argument("--appdir", help="由暂存树生成 AppDir，如 build/AppDir")
    args = ap.parse_args()

    version = read_version()
    log(f"版本 {version}")

    if args.zip:
        stage_tree(args.zip, args.stage, version)
    elif not os.path.isdir(args.stage):
        fail("既没给 --zip，也没有现成的 --stage 目录")

    if args.deb:
        write_debian_dir(args.stage, version)

    if args.appdir:
        make_appdir(args.stage, args.appdir, version)

    # 打一份清单，方便肉眼核对与后续 diff
    root = os.path.join(args.stage, *APP_PREFIX.split("/"))
    if os.path.isdir(root):
        n = sum(len(f) for _b, _d, f in os.walk(root))
        log(f"{APP_PREFIX}/ 下 {n} 个文件")
    for rel in ("usr/bin/lypora", "usr/share/applications/lypora.desktop",
                "usr/share/metainfo/app.lypora.editor.metainfo.xml",
                "usr/share/licenses/lypora/LICENSE", "usr/share/doc/lypora/copyright"):
        p = os.path.join(args.stage, *rel.split("/"))
        log(f"  {'✓' if os.path.exists(p) else '✗'} /{rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
