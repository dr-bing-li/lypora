#!/usr/bin/env python3
"""
打包 macOS 版（.app + tar.gz）。

用法：
  python tools/pack-mac.py --zip .tmp-elec/electron-v33.4.11-darwin-arm64.zip --arch arm64
  python tools/pack-mac.py --zip .tmp-elec/electron-v33.4.11-darwin-x64.zip   --arch x64

产出：
  release/Lypora-<ver>-macos-<arch>.tar.gz
    Lypora.app/…                完整的 .app 包（含 framework 的符号链接）
    mac-finalize.command        在 Mac 上双击一次：去隔离属性 + ad-hoc 重签
    README-macOS.txt            面向用户的说明
    LICENSE / LICENSES.chromium.html

为什么产出 tar.gz 而不是 zip / dmg：
  - zip：.app 内部有 14 个 framework 符号链接（Versions/Current 之类），
    Windows 建不了 symlink，用 zip 中转会把它们变成普通文本文件，包直接废掉；
    tar 原生支持符号链接条目，不需要落地到磁盘。
  - dmg：要 hdiutil，只有 macOS 有。
详见 docs/06-跨平台构建与平台规范.md。

为什么必须删掉 _CodeSignature：
  原包是 Electron 官方签的，我们把 Contents/Resources/app 塞进去、改了 Info.plist，
  原封条必然失效。留着失效的签名，macOS 会报 "damaged"（比"未签名"更难解释），
  所以整体降级为未签名，由 mac-finalize.command 在 Mac 上 ad-hoc 重签。
"""

from __future__ import annotations

import argparse
import os
import plistlib
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _packlib import (  # noqa: E402
    ROOT,
    TarBuilder,
    app_payload,
    fail,
    human,
    icns_bytes,
    log,
    make_pngs,
    read_version,
    zip_modes,
)

BUNDLE_ID = "app.lypora.editor"
APP_NAME = "Lypora"
SRC_ICON = os.path.join(ROOT, "core", "public", "icons", "icon-512.png")


def info_plist(version: str) -> bytes:
    md_exts = ["md", "markdown", "mdown", "mkd"]
    doc_types = [
        {
            "CFBundleTypeExtensions": md_exts,
            "CFBundleTypeName": "Markdown Document",
            "CFBundleTypeRole": "Editor",
            "LSHandlerRank": "Alternate",
            "LSItemContentTypes": ["net.daringfireball.markdown", "public.plain-text"],
        },
        {
            "CFBundleTypeExtensions": ["txt"],
            "CFBundleTypeName": "Plain Text Document",
            "CFBundleTypeRole": "Editor",
            "LSHandlerRank": "Alternate",
            "LSItemContentTypes": ["public.plain-text"],
        },
    ]
    return plistlib.dumps(
        {
            "CFBundleDevelopmentRegion": "en",
            "CFBundleDisplayName": APP_NAME,
            "CFBundleExecutable": APP_NAME,
            "CFBundleIconFile": "Lypora.icns",
            "CFBundleIdentifier": BUNDLE_ID,
            "CFBundleInfoDictionaryVersion": "6.0",
            "CFBundleName": APP_NAME,
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": version,
            "CFBundleVersion": version,
            "CFBundleDocumentTypes": doc_types,
            "LSApplicationCategoryType": "public.app-category.productivity",
            "LSMinimumSystemVersion": "11.0",
            "LSEnvironment": {"MallocNanoZone": "0"},
            "NSHighResolutionCapable": True,
            "NSPrincipalClass": "AtomApplication",
            "NSMainNibFile": "MainMenu",
            "NSRequiresAquaSystemAppearance": False,
            "NSSupportsAutomaticGraphicsSwitching": True,
            "NSHumanReadableCopyright": (
                "MIT. Independent implementation; not affiliated with, or endorsed by, "
                "any third-party product."
            ),
            # 刻意不给 NSAppTransportSecurity：本应用只加载 file://，不需要放行任意 HTTPS。
        },
        fmt=plistlib.FMT_XML,
        sort_keys=True,
    )


def rename(arcname: str) -> str:
    """把 Electron 的内部命名换成 Lypora 的，同时保住 framework 的名字不改。"""
    p = arcname
    if p == "Electron.app" or p.startswith("Electron.app/"):
        p = "Lypora.app" + p[len("Electron.app") :]
    # 主可执行文件：只改 Contents/MacOS/Electron 这一处，别碰 framework
    p = p.replace("/Contents/MacOS/Electron", "/Contents/MacOS/Lypora")
    # 四个 helper 包与它们的可执行文件（Electron Helper / ... (GPU|Renderer|Plugin)）
    p = p.replace("/Electron Helper", "/Lypora Helper")
    return p


def patch_plist(data: bytes) -> bytes:
    if not data.lstrip().startswith(b"<?xml"):
        fail("遇到二进制 plist，无法在 Windows 上安全改写（Electron 33 预期是 XML）")
    return (
        data.replace(b"com.github.Electron", BUNDLE_ID.encode())
        .replace(b"Electron Helper", b"Lypora Helper")
        .replace(b"<string>Electron</string>", b"<string>Lypora</string>")
    )


FINALIZE = """#!/bin/bash
# 在 macOS 上双击运行一次（或终端里 bash mac-finalize.command）。
#
# 做两件事：
#   1. 去掉下载带来的隔离属性 com.apple.quarantine（否则 Gatekeeper 直接拦）；
#   2. 对整个 .app 做 ad-hoc 重新签名（codesign -s -）。
#
# 为什么第 2 步是必要的：
#   - Apple Silicon 内核对没有代码签名的可执行文件直接 SIGKILL（表现为"闪一下就退出"）。
#     Electron 官方包里 arm64 的二进制自带 ad-hoc 签名，x64 的自带包**完全没有签名**，
#     而我们又改过 Info.plist、塞进了 resources/app，所以统一重封一次最稳。
#   - 本包**没有** Apple 公证（公证要 Developer ID 证书 + notarytool，构建机没有）。
#     重签之后仍属"未识别开发者"，首次打开需要右键 → 打开 放行一次。
set -e
cd "$(dirname "$0")"

APP="Lypora.app"

echo "==> 去除隔离属性（com.apple.quarantine）"
xattr -dr com.apple.quarantine "$APP" 2>/dev/null || true

echo "==> ad-hoc 重新签名"
codesign --force --deep --sign - "$APP"

echo "==> 校验签名"
codesign --verify --deep --strict --verbose=2 "$APP"

echo ""
echo "完成。现在可以直接双击 Lypora.app。"
echo "如果系统仍然提示"无法验证开发者"：右键 Lypora.app → 打开 → 在弹窗里点"打开"。"
echo ""
echo "想用 Developer ID 正式签名 + 公证（需要 Apple 开发者账号）："
echo "  codesign --force --deep --options runtime --sign \\"Developer ID Application: <你的名字> (<TEAMID>)\\" Lypora.app"
echo "  ditto -c -k --keepParent Lypora.app Lypora.zip"
echo "  xcrun notarytool submit Lypora.zip --apple-id <你的 Apple ID> --team-id <TEAMID> --password <App 专用密码> --wait"
echo "  xcrun stapler staple Lypora.app"
"""

README = """Lypora —— macOS 版
====================

一、首次运行（必须做，只需一次）
------------------------------
本包**未做代码签名与公证**（签名与公证只能在 macOS 上完成，构建机是 Windows）。
所以 macOS 会拦一次。两步走：

1. 双击 `mac-finalize.command`
   → 自动去除隔离属性，并做 ad-hoc 签名。
   （如果双击没反应，在终端里执行：`bash mac-finalize.command`）
2. 双击 `Lypora.app`

如果第 1 步因为"无法打开，因为来自身份不明的开发者"被拦：
右键 `mac-finalize.command` → 打开 → 在弹窗里点"打开"。

二、为什么不直接双击
--------------------
- Gatekeeper：从互联网下载的包会被打上 com.apple.quarantine，未签名/签名无效则拦截。
- Apple Silicon（M 系列）：内核要求所有可执行文件至少有一个有效签名，
  完全未签名的二进制会被直接杀掉（表现为闪一下就退出）。ad-hoc 签名（`-`）即可满足。

三、系统要求
------------
- macOS 11 Big Sur 或更高（Electron 33 的下限）
- arm64 包：Apple Silicon（M1/M2/M3/M4）
- x64 包：Intel Mac；在 Apple Silicon 上需 Rosetta 2（`softwareupdate --install-rosetta`）

四、卸载
--------
把 Lypora.app 拖进废纸篓。配置与最近文件在：
  ~/Library/Application Support/lypora-desktop/
不需要时一并删除。

五、已知边界
------------
- 没有 .dmg 安装镜像：hdiutil 只有 macOS 有，Windows 构建机做不出来。
- 没有自动更新、没有公证（公证需要 Apple 开发者账号，本机没有）。
- 「用 Lypora 打开 .md」：默认不抢系统关联（LSHandlerRank = Alternate）。
  右键任意 .md → 打开方式 → 其他… → 选 Lypora → 勾选"始终以此方式打开"。
- ad-hoc 签名 ≠ 公证：没有 Apple Developer ID 证书，无法通过 notarytool 公证。
  首次打开请右键 → 打开；之后系统会记住。
- 本包在 macOS 上**未做过真机实测**（构建环境是 Windows，没有 Mac）。
  包结构、Mach-O 架构、符号链接、Info.plist 都做了静态校验，详见 docs/06。

六、许可
--------
MIT。第三方组件（Electron / Chromium / CodeMirror 6 / Lezer / KaTeX）许可见
同目录 LICENSE 与 LICENSES.chromium.html，完整清单见仓库 THIRD-PARTY-NOTICES.md。
本项目为独立实现，与任何第三方商业产品无关联。
  https://github.com/dr-bing-li/lypora
"""


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--zip", required=True, help="electron-v<ver>-darwin-<arch>.zip")
    ap.add_argument("--arch", required=True, choices=["arm64", "x64"])
    ap.add_argument("--out", default=os.path.join(ROOT, "release"))
    args = ap.parse_args()

    version = read_version()
    if not os.path.exists(args.zip):
        fail(f"找不到 {args.zip}")
    os.makedirs(args.out, exist_ok=True)

    tar_path = os.path.join(args.out, f"Lypora-{version}-macos-{args.arch}.tar.gz")
    if os.path.exists(tar_path):
        os.remove(tar_path)

    log(f"版本 {version} / 架构 {args.arch}")
    log("生成图标（icns 需要 16…1024 共 11 档）")
    pngs = make_pngs(SRC_ICON, [16, 32, 64, 128, 256, 512, 1024])
    icns = icns_bytes(pngs)

    payload = app_payload(version)
    log(f"前端与主进程文件 {len(payload)} 个")

    zf = zipfile.ZipFile(args.zip)
    modes = zip_modes(zf)
    names = list(modes.keys())
    bundle_entries = [n for n in names if n.startswith("Electron.app")]
    if not bundle_entries:
        fail("zip 里没有 Electron.app，不是 darwin 分发包？")

    # 顶层包一层版本化目录：解压时不会把 LICENSE / Lypora.app 甩进当前目录
    top = f"Lypora-{version}-macos-{args.arch}"

    def P(rel: str) -> str:
        return f"{top}/{rel}"

    tb = TarBuilder(tar_path, comment=f"Lypora {version} macOS {args.arch}")
    stats = {"file": 0, "link": 0, "dir": 0}
    skipped = {"codesign": 0, "info": 0, "asar": 0, "icon": 0, "dup": 0}
    seen: set[str] = set()

    with zf:
        for info in zf.infolist():
            arc = info.filename
            mode, kind = modes[arc.rstrip("/")]
            dst = rename(arc)

            # 失效的签名封条必须整体删掉（见文件头说明）
            if "_CodeSignature" in dst:
                skipped["codesign"] += 1
                continue
            # Info.plist 由我们重写；helper 的 plist 只做字符串替换
            if dst == "Lypora.app/Contents/Info.plist":
                skipped["info"] += 1
                continue
            # Electron 自带的默认应用要摘掉，否则会和 resources/app 抢入口
            if dst.endswith("Resources/default_app.asar"):
                skipped["asar"] += 1
                continue
            # Electron 的通用图标由 Lypora.icns 取代
            if dst.endswith("Resources/electron.icns"):
                skipped["icon"] += 1
                continue

            if dst in seen:
                skipped["dup"] += 1
                continue
            seen.add(dst)

            if kind == "dir":
                tb.dir(P(dst), 0o755)
                stats["dir"] += 1
            elif kind == "link":
                target = zf.read(info).decode("utf-8")
                tb.symlink(P(dst), target)
                stats["link"] += 1
            else:
                with zf.open(info) as src:
                    if dst.endswith("/Info.plist"):
                        data = patch_plist(src.read())
                        tb.file_bytes(P(dst), data, mode)
                    else:
                        # 大文件（framework / 主程序）流式写入，不进内存
                        tb.file_stream(P(dst), src, info.file_size, mode)
                stats["file"] += 1

    # 我们自己的 Info.plist
    tb.file_bytes(P("Lypora.app/Contents/Info.plist"), info_plist(version), 0o644)
    # 图标 + 前端 + 主进程
    tb.file_bytes(P("Lypora.app/Contents/Resources/Lypora.icns"), icns, 0o644)
    for rel, data in payload.items():
        tb.file_bytes(P(f"Lypora.app/Contents/Resources/app/{rel}"), data, 0o644)
    # 辅助文件
    tb.file_bytes(P("mac-finalize.command"), FINALIZE.encode("utf-8"), 0o755)
    tb.file_bytes(P("README-macOS.txt"), README.encode("utf-8"), 0o644)
    tb.file_bytes(
        P("build-info.txt"),
        (
            f"Lypora {version}\n"
            f"platform: macOS {args.arch}\n"
            f"electron: 33.4.11\n"
            f"built-from: {os.path.basename(args.zip)}\n"
            f"built-on: {__import__('platform').platform()} (cross-build, 未在 macOS 上运行过)\n"
            f"unsigned: true（需先运行 mac-finalize.command 做 ad-hoc 签名）\n"
        ).encode("utf-8"),
        0o644,
    )
    size = tb.close()

    log(f"完成：{tar_path}  {human(size)}")
    log(f"条目 文件 {stats['file']} / 目录 {stats['dir']} / 符号链接 {stats['link']}")
    log(f"重复条目跳过 {skipped['dup']} 项、标准输出已含 LICENSE / version（不再重复追加）")
    log(f"剔除 _CodeSignature {skipped['codesign']} 项、Info.plist {skipped['info']} 项、"
        f"default_app.asar {skipped['asar']} 项、electron.icns {skipped['icon']} 项")
    log(f"内含 resources/app 文件 {len(payload)} 个，icns {len(icns)} 字节")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
