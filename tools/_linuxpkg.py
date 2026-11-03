"""
Linux 安装包（deb / rpm / AppImage）共用的 FHS 暂存树。

为什么不复用 pack-linux.py：
  tar.gz 是"自包含目录 + install.sh"，落点是 ~/.local/share；
  deb / rpm 走的是系统包管理器，落点必须是 FHS：
    /opt/lypora/           主程序目录（附加软件包按 FHS 就该放 /opt/<pkg>）
    /usr/bin/lypora        命令行入口（一个 shell 包装脚本，不建符号链接）
    /usr/share/applications/lypora.desktop
    /usr/share/icons/hicolor/<n>x<n>/apps/lypora.png
    /usr/share/metainfo/app.lypora.editor.metainfo.xml   （AppStream，软件中心要靠它取图标和简介）
    /usr/share/licenses/lypora/{LICENSE,LICENSES.chromium.html}   （rpm 的 %license 要这个路径）
    /usr/share/doc/lypora/{copyright,README.md}                   （Debian 政策要求 copyright）

两者共用的是"Electron 分发包怎么摊开"这段规则（改名、权限位、剔除 default_app.asar），
分别写了两遍是因为 tar 那条链路是 zip→tar 流式直通，这条链路是 zip→磁盘，接口不同。

关于符号链接：
  这里刻意**不建**符号链接（Windows 上建不了，而这段代码要在 Windows 上也能跑通做结构检查）。
  /usr/bin/lypora 用 3 行 shell 包装脚本代替，效果一样。
  唯一的例外是 Electron zip 里自带的链接（当前 linux-x64 包里没有）。
"""

from __future__ import annotations

import hashlib
import os
import stat
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _packlib import (  # noqa: E402
    ROOT,
    app_payload,
    fail,
    human,
    log,
    make_pngs,
    read_version,
    zip_modes,
)

APP_PREFIX = "opt/lypora"
SIZES = [16, 24, 32, 48, 64, 128, 256, 512]
MAIN_EXE = "lypora"
SANDBOX = "chrome-sandbox"
MANAGED_DIRS = ("usr/bin", "usr/share/applications", "usr/share/metainfo",
                "usr/share/licenses/lypora", "usr/share/doc/lypora")

DESKTOP = """[Desktop Entry]
Type=Application
Name=Lypora
GenericName=Markdown Editor
GenericName[zh_CN]=Markdown 编辑器
Comment=Markdown editor with instant preview / 即时渲染的 Markdown 编辑器
Exec=/opt/lypora/lypora.sh %F
Icon=lypora
Terminal=false
Categories=Office;TextEditor;Utility;
MimeType=text/markdown;text/x-markdown;text/plain;
Keywords=markdown;editor;md;txt;
StartupNotify=true
StartupWMClass=lypora
"""

# 与 tar.gz 包里的 lypora.sh 逻辑一致：沙箱合格就正常起，不合格才降级。
# 走包管理器安装时 chrome-sandbox 是 root:root 4755，正常分支；AppImage 里必然是降级分支。
LAUNCHER = """#!/bin/sh
# Lypora 启动包装：只在 chrome-sandbox 不可用时补 --no-sandbox。
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
  echo "      系统包安装不会出现这个提示；若出现，说明文件权限被改过。" >&2
  exec "$bin" --no-sandbox "$@"
fi
"""

USRBIN = """#!/bin/sh
# 命令行入口。真正的参数处理与沙箱降级在 /opt/lypora/lypora.sh。
exec /opt/lypora/lypora.sh "$@"
"""

METAINFO = """<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>app.lypora.editor</id>
  <metadata_license>MIT</metadata_license>
  <project_license>MIT</project_license>
  <name>Lypora</name>
  <summary>Markdown editor with instant preview</summary>
  <summary xml:lang="zh-CN">即时渲染的 Markdown 编辑器</summary>
  <description>
    <p>Lypora is an independent, from-scratch implementation of a live-preview Markdown
       editor: what you type is rendered in place, with the source still editable.</p>
  </description>
  <launchable type="desktop-id">lypora.desktop</launchable>
  <url type="homepage">https://github.com/dr-bing-li/lypora</url>
  <url type="bugtracker">https://github.com/dr-bing-li/lypora/issues</url>
  <provides>
    <binary>lypora</binary>
  </provides>
  <content_rating type="oars-1.1"/>
</component>
"""

INSTALL_README = """Lypora —— Linux 系统包（deb / rpm）
====================================

装完之后：
    lypora              命令行启动（/usr/bin/lypora → /opt/lypora/lypora.sh）
    应用菜单里搜 Lypora

文件都在 /opt/lypora 下，卸载用包管理器：
    sudo apt remove lypora     # Debian / Ubuntu
    sudo dnf remove lypora     # Fedora / RHEL

chrome-sandbox 已由包管理器装成 root:root 4755，不需要 sudo 或 --no-sandbox。
Ubuntu 24.04 起系统限制了非特权 user namespace，这里走的是 SUID 沙箱，不受影响。

系统要求：x86_64、glibc ≥ 2.31、X11 或 Wayland 图形会话。
"""


def _chmod(path: str, mode: int) -> None:
    """Windows 上 chmod 只认只读位，setuid 会静默丢弃——那台机器上跑出来的树只用于结构检查。"""
    try:
        os.chmod(path, mode)
    except OSError:
        pass


def _md5(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _write(path: str, data: bytes, mode: int) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    _chmod(path, mode)


def stage_tree(zip_path: str, dest: str, version: str) -> "dict[str, int]":
    """把 Electron 分发包 + 我们的前端摊成 FHS 目录树，返回统计。"""
    if not os.path.exists(zip_path):
        fail(f"找不到 {zip_path}")
    os.makedirs(dest, exist_ok=True)
    app = os.path.join(dest, *APP_PREFIX.split("/"))
    os.makedirs(app, exist_ok=True)

    zf = zipfile.ZipFile(zip_path)
    modes = zip_modes(zf)
    stats = {"file": 0, "link": 0, "skipped": 0, "bytes": 0}

    with zf:
        for info in zf.infolist():
            arc = info.filename.rstrip("/")
            if not arc:
                continue
            mode, kind = modes.get(arc, (0o644, "file"))
            if kind == "dir":
                continue

            if kind == "link":
                target = zf.read(info).decode("utf-8")
                dst = os.path.join(app, *arc.split("/"))
                os.makedirs(os.path.dirname(dst), exist_ok=True)
                try:
                    os.symlink(target, dst)
                    stats["link"] += 1
                except (OSError, NotImplementedError):
                    # Windows：退化成实体文件，保证树完整（仅供结构检查）
                    real = os.path.normpath(os.path.join(os.path.dirname(dst), target))
                    if os.path.exists(real):
                        with open(real, "rb") as s, open(dst, "wb") as d:
                            d.write(s.read())
                        stats["file"] += 1
                    else:
                        log(f"跳过无法解析的链接 {arc} -> {target}")
                        stats["skipped"] += 1
                continue

            # Electron 自带的默认应用摘掉，否则与 resources/app 抢入口
            if arc.endswith("resources/default_app.asar"):
                stats["skipped"] += 1
                continue

            name = arc.split("/")[-1]
            dst_rel = arc
            if arc == "electron":
                dst_rel = MAIN_EXE
                mode = 0o755
            elif name == SANDBOX:
                mode = 0o4755          # SUID：Electron 的沙箱助手，包管理器会如实装成 root:root 4755
            elif arc.endswith(".so") or ".so." in name:
                mode = 0o644
            elif name == "chrome_crashpad_handler":
                mode = 0o755

            dst = os.path.join(app, *dst_rel.split("/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with zf.open(info) as src, open(dst, "wb") as out:
                for chunk in iter(lambda: src.read(1 << 20), b""):
                    out.write(chunk)
                stats["bytes"] += info.file_size
            _chmod(dst, mode)
            stats["file"] += 1

    # 前端 + 主进程（与 Windows / macOS / tar.gz 同一份）
    payload = app_payload(version)
    for rel, data in payload.items():
        _write(os.path.join(app, "resources", "app", *rel.split("/")), data, 0o644)
        stats["bytes"] += len(data)

    # 启动器 / 桌面项 / 图标 / 元信息 / 许可证
    _write(os.path.join(app, "lypora.sh"), LAUNCHER.encode("utf-8"), 0o755)
    _write(os.path.join(dest, "usr", "bin", MAIN_EXE), USRBIN.encode("utf-8"), 0o755)
    _write(os.path.join(dest, "usr", "share", "applications", "lypora.desktop"),
           DESKTOP.encode("utf-8"), 0o644)
    _write(os.path.join(dest, "usr", "share", "metainfo", "app.lypora.editor.metainfo.xml"),
           METAINFO.encode("utf-8"), 0o644)

    pngs = make_pngs(os.path.join(ROOT, "core", "public", "icons", "icon-512.png"), SIZES)
    for s, data in pngs.items():
        _write(os.path.join(dest, "usr", "share", "icons", "hicolor",
                            f"{s}x{s}", "apps", "lypora.png"), data, 0o644)
        stats["bytes"] += len(data)

    # 许可证：Electron 分发包根目录带 LICENSE / LICENSES.chromium.html，原样带进包
    lic_dir = os.path.join(dest, "usr", "share", "licenses", "lypora")
    with zipfile.ZipFile(zip_path) as z2:
        for extra in ("LICENSE", "LICENSES.chromium.html"):
            if extra in z2.namelist():
                _write(os.path.join(lic_dir, extra), z2.read(extra), 0o644)
    # 仓库自己的 LICENSE（MIT）
    with open(os.path.join(ROOT, "LICENSE"), "rb") as f:
        _write(os.path.join(lic_dir, "LICENSE.lypora"), f.read(), 0o644)

    doc_dir = os.path.join(dest, "usr", "share", "doc", "lypora")
    _write(os.path.join(doc_dir, "README.md"), INSTALL_README.encode("utf-8"), 0o644)
    _write(os.path.join(doc_dir, "copyright"), _copyright_text().encode("utf-8"), 0o644)

    log(f"暂存完成：{dest}")
    log(f"  文件 {stats['file']} / 链接 {stats['link']} / 跳过 {stats['skipped']} / "
        f"主程序体 {human(stats['bytes'])}")
    return stats


def _copyright_text() -> str:
    try:
        with open(os.path.join(ROOT, "LICENSE"), encoding="utf-8") as f:
            mit = f.read()
    except OSError:
        mit = "MIT License\n"
    return (
        "Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/\n"
        "Upstream-Name: Lypora\n"
        "Source: https://github.com/dr-bing-li/lypora\n"
        "\n"
        "Files: *\n"
        "Copyright: 2026 dr-bing-li\n"
        "License: MIT\n"
        "\n"
        "Files: opt/lypora/*\n"
        "Copyright: Electron / Chromium contributors (see LICENSES.chromium.html)\n"
        "License: MIT and BSD-3-Clause and others\n"
        "\n"
        + "".join(" " + line + "\n" for line in mit.splitlines())
    )


PACKAGING = os.path.join(ROOT, "packaging")


def deb_control(version: str, installed_kb: int) -> str:
    """
    control 由 packaging/debian/control.in 渲染。
    依赖里的 `a | b` 是给 Ubuntu 24.04 的 t64 改名留的（libasound2 → libasound2t64 等），
    否则同一个 deb 在 22.04 装得上、24.04 报缺依赖。
    """
    tpl = os.path.join(PACKAGING, "debian", "control.in")
    if not os.path.exists(tpl):
        fail(f"缺少 {tpl}")
    with open(tpl, encoding="utf-8") as f:
        text = f.read()
    return text.replace("@VERSION@", version).replace("@INSTALLED_SIZE@", str(installed_kb))


def write_debian_dir(stage: str, version: str) -> None:
    """在暂存树里写出 DEBIAN/（control + md5sums + 维护者脚本），供 dpkg-deb --build 使用。"""
    debian = os.path.join(stage, "DEBIAN")
    os.makedirs(debian, exist_ok=True)

    total = 0
    sums = []
    for base, _dirs, files in os.walk(stage):
        if os.path.relpath(base, stage).split(os.sep)[0] == "DEBIAN":
            continue
        for fn in files:
            full = os.path.join(base, fn)
            rel = os.path.relpath(full, stage).replace(os.sep, "/")
            if os.path.islink(full):
                continue
            size = os.path.getsize(full)
            total += size
            sums.append((_md5(full), rel))

    _write(os.path.join(debian, "control"), deb_control(version, total // 1024).encode("utf-8"), 0o644)
    _write(os.path.join(debian, "md5sums"),
           "".join(f"{h}  {p}\n" for h, p in sorted(sums, key=lambda x: x[1])).encode("utf-8"), 0o644)
    for name in ("postinst", "prerm", "postrm"):
        src = os.path.join(PACKAGING, "debian", name)
        if not os.path.exists(src):
            fail(f"缺少维护者脚本 {src}")
        with open(src, "rb") as f:
            _write(os.path.join(debian, name), f.read(), 0o755)

    log(f"DEBIAN/ 写好：{len(sums)} 个文件，Installed-Size {total // 1024} KB")


def make_appdir(stage: str, appdir: str, version: str) -> None:
    """
    从暂存树生成 AppDir（appimagetool 的输入）。
    AppImage 里没有 root，chrome-sandbox 的 SUID 不可能生效，所以 AppRun 直接带 --no-sandbox。
    """
    import shutil

    if os.path.exists(appdir):
        shutil.rmtree(appdir)
    src = os.path.join(stage, *APP_PREFIX.split("/"))
    dst = os.path.join(appdir, "usr", "lib", "lypora")
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    shutil.copytree(src, dst, symlinks=True)

    apprun = (
        "#!/bin/sh\n"
        "# AppImage 没有 root，SUID 沙箱必然不可用，直接以 --no-sandbox 启动。\n"
        'HERE="$(dirname "$(readlink -f "$0")")"\n'
        'exec "$HERE/usr/lib/lypora/lypora" --no-sandbox "$@"\n'
    )
    _write(os.path.join(appdir, "AppRun"), apprun.encode("utf-8"), 0o755)
    _write(os.path.join(appdir, "lypora.desktop"),
           DESKTOP.replace("Exec=/opt/lypora/lypora.sh", "Exec=lypora").encode("utf-8"), 0o644)
    icon = os.path.join(stage, "usr", "share", "icons", "hicolor", "512x512", "apps", "lypora.png")
    with open(icon, "rb") as f:
        data = f.read()
    _write(os.path.join(appdir, "lypora.png"), data, 0o644)
    _write(os.path.join(appdir, ".DirIcon"), data, 0o644)
    _write(os.path.join(appdir, "usr", "share", "applications", "lypora.desktop"),
           DESKTOP.replace("Exec=/opt/lypora/lypora.sh", "Exec=lypora").encode("utf-8"), 0o644)
    _write(os.path.join(appdir, "usr", "share", "icons", "hicolor", "512x512", "apps", "lypora.png"),
           data, 0o644)
    log(f"AppDir 生成：{appdir}")
