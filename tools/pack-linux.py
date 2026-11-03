#!/usr/bin/env python3
"""
打包 Linux 桌面版（tar.gz）。

用法：
  python tools/pack-linux.py --zip .tmp-elec/electron-v33.4.11-linux-x64.zip

产出：
  release/Lypora-<ver>-linux-x64.tar.gz
    Lypora/                    自包含目录：解压即用，不写系统目录
      lypora                   主程序（ELF）
      resources/app/…          主进程 + 前端
      chrome-sandbox           需要 setuid root（见下）
      …
    Lypora/lypora.desktop      桌面入口（安装脚本会把它放进 ~/.local/share/applications）
    Lypora/icons/hicolor/…     16…512 的 PNG 图标
    Lypora/install.sh          装到「应用菜单」里（~/.local，不需要 root）
    Lypora/uninstall.sh
    Lypora/README-Linux.txt

为什么是 tar.gz 而不是 AppImage / deb：
  appimagetool 与 dpkg-deb 都是 ELF 程序，Windows 上跑不了（本机无 WSL、无 Docker）。
  tar.gz + install.sh 是能在任何 Linux 上落地的等价物，代价是没有单文件自解压。

chrome-sandbox 的坑（几乎所有 Electron 应用都踩）：
  该文件必须是 root:root 且权限 4755，否则 Electron 会报
  "The SUID sandbox helper binary was found, but is not configured correctly"。
  tar 能记录 setuid 位，但解压时是否生效取决于解压器与是否 root——所以 install.sh
  会显式 chown/chmod（需要 sudo）；不想 sudo 的用户可以用 --no-sandbox（已提供开关）。
"""

from __future__ import annotations

import argparse
import os
import stat
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _packlib import (  # noqa: E402
    ROOT,
    TarBuilder,
    app_payload,
    fail,
    human,
    log,
    make_pngs,
    read_version,
    zip_modes,
)

SRC_ICON = os.path.join(ROOT, "core", "public", "icons", "icon-512.png")
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

DESKTOP = """[Desktop Entry]
Type=Application
Name=Lypora
GenericName=Markdown Editor
Comment=Markdown editor with live preview / 即时渲染的 Markdown 编辑器
Exec=lypora.sh %F
Icon=lypora
Terminal=false
Categories=Office;TextEditor;Utility;
MimeType=text/markdown;text/x-markdown;text/plain;
Keywords=markdown;editor;md;txt;
StartupNotify=true
StartupWMClass=lypora
"""

INSTALL = r"""#!/bin/sh
# 把 Lypora 装进当前用户的应用菜单（不需要 root）。
# 用法：  ./install.sh          安装/更新
#         ./install.sh --uninstall
set -e

here=$(cd "$(dirname "$0")" && pwd)
prefix="${XDG_DATA_HOME:-$HOME/.local/share}"
appdir="$prefix/lypora"
bindir="$HOME/.local/bin"
icondir="$prefix/icons/hicolor"
appsdir="$prefix/applications"

if [ "$1" = "--uninstall" ]; then
  rm -rf "$appdir"
  rm -f  "$appsdir/lypora.desktop"
  rm -f  "$bindir/lypora"
  for s in 16 24 32 48 64 128 256 512; do rm -f "$icondir/${s}x${s}/apps/lypora.png"; done
  command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$appsdir" || true
  command -v gtk-update-icon-cache   >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$icondir" || true
  echo "已卸载 Lypora。"
  exit 0
fi

echo "==> 复制程序到 $appdir"
if [ "$here" = "$appdir" ]; then
  echo "    已经在安装目录里运行，跳过复制"
else
rm -rf "$appdir"
mkdir -p "$appdir"
cp -a "$here/." "$appdir/"
fi
# 安装脚本本身也带过去，之后可以直接用副本卸载

echo "==> 修正 chrome-sandbox 权限（Electron 沙箱要求 setuid root）"
if [ "$(id -u)" = "0" ]; then
  chown root:root "$appdir/chrome-sandbox" 2>/dev/null || true
  chmod 4755 "$appdir/chrome-sandbox" 2>/dev/null || true
else
  if command -v sudo >/dev/null 2>&1; then
    sudo chown root:root "$appdir/chrome-sandbox" 2>/dev/null && \
    sudo chmod 4755 "$appdir/chrome-sandbox" 2>/dev/null && echo "    已设置 setuid" || \
    echo "    ⚠ 未能设置 setuid：启动时会自动退回 --no-sandbox（功能可用，隔离性略降）"
  else
    echo "    ⚠ 没有 sudo：启动时会自动退回 --no-sandbox"
  fi
fi

echo "==> 图标"
for s in 16 24 32 48 64 128 256 512; do
  mkdir -p "$icondir/${s}x${s}/apps"
  cp -f "$here/icons/hicolor/${s}x${s}/apps/lypora.png" "$icondir/${s}x${s}/apps/lypora.png"
done

echo "==> 桌面入口"
mkdir -p "$appsdir" "$bindir"
sed "s|^Exec=[^ ]*|Exec=$appdir/lypora.sh|" "$here/lypora.desktop" > "$appsdir/lypora.desktop"
chmod 644 "$appsdir/lypora.desktop"

echo "==> 命令行入口 $bindir/lypora"
cat > "$bindir/lypora" <<EOF
#!/bin/sh
exec "$appdir/lypora.sh" "\$@"
EOF
chmod 755 "$bindir/lypora"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$appsdir" || true
command -v gtk-update-icon-cache   >/dev/null 2>&1 && gtk-update-icon-cache -f -t "$icondir" || true

echo ""
echo "完成。"
echo "  应用菜单里搜 Lypora 即可；命令行直接敲 lypora（若 $bindir 不在 PATH 里，请自行加入）。"
echo "  卸载：$appdir/install.sh --uninstall"
"""

LAUNCHER = """#!/bin/sh
# Lypora 启动包装：只在 chrome-sandbox 不可用时补 --no-sandbox。
#
# 为什么需要这个包装：
#   tar.gz 解压出来的 chrome-sandbox 通常丢掉 setuid 位（root:root + 4755 才合格）。
#   此时 Electron 会直接报 "The SUID sandbox helper binary was found, but is not
#   configured correctly" 然后拒绝启动——用户看到的是"点了没反应"。
#   这里先检测，合格就正常启动（保留沙箱），不合格才降级。
here=$(cd "$(dirname "$0")" && pwd)
bin="$here/lypora"
sb="$here/chrome-sandbox"

sandbox_ok=0
if [ -u "$sb" ] && [ "$(stat -c '%u' "$sb" 2>/dev/null)" = "0" ]; then
  sandbox_ok=1
fi
if [ "$sandbox_ok" = "1" ]; then
  exec "$bin" "$@"
else
  echo "提示：未检测到合格的 chrome-sandbox（需 root:root + 4755），本次以 --no-sandbox 启动。" >&2
  echo "      想恢复沙箱：sudo chown root:root \\"$sb\\" && sudo chmod 4755 \\"$sb\\"" >&2
  exec "$bin" --no-sandbox "$@"
fi
"""

README = """Lypora —— Linux 桌面版
========================

一、最快用法（不安装）
----------------------
    tar xzf Lypora-<ver>-linux-x64.tar.gz
    cd Lypora
    ./lypora.sh

二、装进应用菜单（推荐，不需要 root）
------------------------------------
    cd Lypora
    ./install.sh          # 复制到 ~/.local/share/lypora，图标、桌面项、命令行入口一并装好
    ./install.sh --uninstall

装完后：应用菜单里搜 "Lypora"；命令行敲 `lypora`（需 ~/.local/bin 在 PATH 中）。

三、系统要求
------------
- x86_64（amd64）
- glibc ≥ 2.31（Ubuntu 20.04 / Debian 11 / Fedora 32 / RHEL 9 及更新的发行版）
- 需要图形会话（X11 或 Wayland；Wayland 下走 XWayland 兼容层）
- GTK3、libnss3、libasound2、libgbm1 等常规桌面库。Debian/Ubuntu 上若报缺库：
    sudo apt install libgtk-3-0 libnss3 libasound2 libgbm1 libxss1

四、chrome-sandbox 与 --no-sandbox
----------------------------------
Electron 的 SUID 沙箱要求 `chrome-sandbox` 属于 root:root 且权限 4755。
tar.gz 解压后这个位通常不生效，直接运行会报：
  "The SUID sandbox helper binary was found, but is not configured correctly"

两条路：
  1. 修好它（推荐，保留沙箱）：
       sudo chown root:root chrome-sandbox
       sudo chmod 4755 chrome-sandbox
  2. 用包装脚本自动降级：
       ./lypora.sh          # 检测不到合格 sandbox 时自动加 --no-sandbox
   注意 --no-sandbox 会关闭渲染进程的 OS 级隔离，仅建议在自用机器上用。

五、没有 AppImage / deb 的原因
------------------------------
appimagetool 与 dpkg-deb 都是 Linux 二进制，而本包的构建机是 Windows
（无 WSL、无 Docker），无法执行它们。tar.gz + install.sh 是能落地的等价物。
想自己做 AppImage 很简单，在 Linux 上：
    tar xzf Lypora-<ver>-linux-x64.tar.gz
    wget -O appimagetool https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage
    chmod +x appimagetool
    # 需要 AppDir 结构（Lypora/ 改名 AppDir，AppRun 指向 lypora.sh，根放 lypora.desktop 与 lypora.png）
    ARCH=x86_64 ./appimagetool --appimage-extract-and-run AppDir

六、已知边界
------------
- 未在真实 Linux 发行版上启动过（构建机是 Windows）。包结构、ELF 架构、权限位、
  打包完整性都做了静态校验，详见 docs/06-跨平台构建与平台规范.md。
- 没有自动更新、没有系统托盘、没有全局菜单（Unity 全局菜单那种）。
- 文件关联：`install.sh` 已把 MimeType 写进 .desktop，桌面环境会问你「用什么打开 .md」。

七、许可
--------
MIT。第三方组件（Electron / Chromium / CodeMirror 6 / Lezer / KaTeX）许可见
同目录 LICENSE 与 LICENSES.chromium.html，完整清单见仓库 THIRD-PARTY-NOTICES.md。
本项目为独立实现，与任何第三方商业产品无关联。
  https://github.com/dr-bing-li/lypora
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True)
    ap.add_argument("--out", default=os.path.join(ROOT, "release"))
    args = ap.parse_args()

    version = read_version()
    if not os.path.exists(args.zip):
        fail(f"找不到 {args.zip}")
    os.makedirs(args.out, exist_ok=True)

    tar_path = os.path.join(args.out, f"Lypora-{version}-linux-x64.tar.gz")
    if os.path.exists(tar_path):
        os.remove(tar_path)

    log(f"版本 {version}")
    pngs = make_pngs(SRC_ICON, SIZES)
    payload = app_payload(version)
    log(f"前端与主进程文件 {len(payload)} 个，图标 {len(pngs)} 档")

    zf = zipfile.ZipFile(args.zip)
    modes = zip_modes(zf)
    top = "Lypora"

    tb = TarBuilder(tar_path, comment=f"Lypora {version} linux-x64")
    stats = {"file": 0, "dir": 0, "link": 0}

    with zf:
        for info in zf.infolist():
            arc = info.filename.rstrip("/")
            if not arc:
                continue
            mode, kind = modes.get(arc, (0o644, "file"))
            name = arc.split("/")[-1]

            if kind == "dir":
                tb.dir(f"{top}/{arc}", 0o755)
                stats["dir"] += 1
                continue
            if kind == "link":
                tb.symlink(f"{top}/{arc}", zf.read(info).decode("utf-8"))
                stats["link"] += 1
                continue

            # Electron 自带的默认应用摘掉，否则与 resources/app 抢入口
            if arc.endswith("resources/default_app.asar"):
                log("跳过 resources/default_app.asar")
                continue

            dst_name = arc
            if arc == "electron":
                # 主程序改名，但保留可执行位
                dst_name = "lypora"
                mode = 0o755
            elif name == "chrome-sandbox":
                # 目标权限写在 tar 头里；实际生效与否取决于解压器，install.sh 会再修正
                mode = 0o4755
            elif arc.endswith(".so") or ".so." in name:
                mode = 0o644
            elif name in ("chrome_crashpad_handler",):
                mode = 0o755

            with zf.open(info) as src:
                tb.file_stream(f"{top}/{dst_name}", src, info.file_size, mode)
            stats["file"] += 1

    # 前端 + 主进程
    for rel, data in payload.items():
        tb.file_bytes(f"{top}/resources/app/{rel}", data, 0o644)

    # 启动包装 / 桌面入口 / 图标 / 安装脚本 / 说明
    tb.file_bytes(f"{top}/lypora.sh", LAUNCHER.encode("utf-8"), 0o755)
    tb.file_bytes(f"{top}/lypora.desktop", DESKTOP.encode("utf-8"), 0o644)
    tb.file_bytes(f"{top}/install.sh", INSTALL.encode("utf-8"), 0o755)
    tb.file_bytes(f"{top}/uninstall.sh", b'#!/bin/sh\nexec "$(dirname "$0")/install.sh" --uninstall\n', 0o755)
    tb.file_bytes(f"{top}/README-Linux.txt", README.encode("utf-8"), 0o644)
    tb.file_bytes(
        f"{top}/build-info.txt",
        (
            f"Lypora {version}\n"
            f"platform: linux-x64\n"
            f"electron: 33.4.11\n"
            f"built-from: {os.path.basename(args.zip)}\n"
            f"built-on: {__import__('platform').platform()}\n"
        ).encode("utf-8"),
        0o644,
    )
    for s, data in pngs.items():
        tb.file_bytes(f"{top}/icons/hicolor/{s}x{s}/apps/lypora.png", data, 0o644)
    tb.file_bytes(f"{top}/lypora.png", pngs[512], 0o644)

    size = tb.close()
    log(f"完成：{tar_path}  {human(size)}")
    log(f"条目 文件 {stats['file']} (+ 附加 {len(payload)} + 图标 {len(pngs) + 1}) / 目录 {stats['dir']} / 链接 {stats['link']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
