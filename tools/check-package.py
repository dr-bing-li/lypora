#!/usr/bin/env python3
"""
跨平台产物结构校验（macOS / Linux）。

这是"能不能用"的**静态**证据，不是启动证据：
构建机是 Windows，没有 Mac、没有 Linux 发行版、没有 WSL/Docker，
所以能验的只有包内事实（架构、权限、plist、符号链接、前端完整性），
验不到的是"双击能不能起来"。两者在 docs/06 里分开写，别混。

用法：
  python tools/check-package.py                       # 自动找 release/ 下所有 tar.gz
  python tools/check-package.py release/xxx.tar.gz    # 指定文件

退出码：0 全绿 / 1 有断言失败 / 2 文件不存在
"""

from __future__ import annotations

import glob
import json
import os
import plistlib
import stat
import struct
import sys
import tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
from _packlib import read_version  # noqa: E402

MAC_CPU = {0x0100000C: "arm64", 0x01000007: "x64"}
ELF_MACHINE = {0x3E: "x86-64", 0xB7: "aarch64"}


class Index:
    """把 tar 条目读成内存索引，避免反复扫盘"""

    def __init__(self, path: str):
        self.path = path
        self.items: dict[str, tarfile.TarInfo] = {}
        self.links: dict[str, str] = {}
        self.notes: "list[str]" = []
        with tarfile.open(path, "r:gz") as tf:
            for ti in tf:
                name = ti.name.rstrip("/")
                self.items[name] = ti
                if ti.issym():
                    self.links[name] = ti.linkname
        self.tf = None

    def read(self, name: str) -> bytes:
        with tarfile.open(self.path, "r:gz") as tf:
            f = tf.extractfile(name)
            if f is None:
                raise KeyError(name)
            return f.read()

    def has(self, name: str) -> bool:
        return name in self.items

    def mode(self, name: str) -> int:
        return self.items[name].mode

    def files(self) -> "list[str]":
        return [n for n, ti in self.items.items() if ti.isfile()]


def macho_header(data: bytes):
    """返回 (arch, load command 集合)；解析不了返回 (None, set())"""
    if len(data) < 32:
        return None, set()
    magic = struct.unpack("<I", data[:4])[0]
    if magic not in (0xFEEDFACF, 0xFEEDFACE):
        return ("universal" if magic == 0xCAFEBABE else None), set()
    _m, cpu, _sub, _ft, ncmds, _sz, _fl = struct.unpack("<IiIIIII", data[:28])
    cmds = set()
    off = 32
    for _ in range(ncmds):
        if off + 8 > len(data):
            break
        cmd, sz = struct.unpack("<II", data[off : off + 8])
        cmds.add(cmd)
        if sz <= 0:
            break
        off += sz
    return MAC_CPU.get(cpu & 0xFFFFFFFF, f"unknown({cpu:#x})"), cmds


def elf_info(data: bytes):
    if data[:4] != b"\x7fELF":
        return None
    cls, endian = data[4], data[5]
    machine = struct.unpack("<H", data[18:20])[0] if endian == 1 else struct.unpack(">H", data[18:20])[0]
    return {
        "class": 64 if cls == 2 else 32,
        "endian": "LE" if endian == 1 else "BE",
        "machine": ELF_MACHINE.get(machine, f"unknown({machine:#x})"),
        "type": struct.unpack("<H", data[16:18])[0] if endian == 1 else struct.unpack(">H", data[16:18])[0],
    }


def check_mac(idx: Index, want_arch: str, version: str) -> "list[str]":
    e: list[str] = []

    # 包内顶层是 Lypora-<ver>-macos-<arch>/，先从条目里把前缀找出来
    root = ""
    for n in idx.items:
        if n == "Lypora.app" or n.endswith("/Lypora.app"):
            root = n[: -len("Lypora.app")]
            break
    expect_root = f"Lypora-{version}-macos-{want_arch}/"
    if root != expect_root:
        e.append(f"顶层目录 {root!r}，期望 {expect_root!r}")
    A = f"{root}Lypora.app"

    def need(name: str):
        if not idx.has(name):
            e.append(f"缺少 {name}")
            return False
        return True

    # 1) Info.plist
    if need(f"{A}/Contents/Info.plist"):
        pl = plistlib.loads(idx.read(f"{A}/Contents/Info.plist"))
        checks = {
            "CFBundleExecutable": "Lypora",
            "CFBundleIdentifier": "app.lypora.editor",
            "CFBundleName": "Lypora",
            "CFBundleIconFile": "Lypora.icns",
            "CFBundlePackageType": "APPL",
            "CFBundleShortVersionString": version,
            "CFBundleVersion": version,
            "LSMinimumSystemVersion": "11.0",
        }
        for k, v in checks.items():
            if pl.get(k) != v:
                e.append(f"Info.plist {k}={pl.get(k)!r}，期望 {v!r}")
        if not pl.get("CFBundleDocumentTypes"):
            e.append("Info.plist 缺少 CFBundleDocumentTypes（文件关联）")
        else:
            exts = [x for d in pl["CFBundleDocumentTypes"] for x in d.get("CFBundleTypeExtensions", [])]
            if "md" not in exts:
                e.append("CFBundleDocumentTypes 未声明 md")
        if pl.get("NSHighResolutionCapable") is not True:
            e.append("NSHighResolutionCapable 不是 true（Retina 会糊）")
        if "NSAppTransportSecurity" in pl:
            e.append("Info.plist 不该有 NSAppTransportSecurity（本应用只加载 file://）")

    # 2) 主可执行：存在 + 架构对 + 可执行位 + 仍有 Mach-O 签名段
    exe = f"{A}/Contents/MacOS/Lypora"
    if need(exe):
        data = idx.read(exe)
        arch, cmds = macho_header(data)
        if arch != want_arch:
            e.append(f"主可执行架构 {arch}，期望 {want_arch}")
        if not (idx.mode(exe) & stat.S_IXUSR):
            e.append(f"主可执行没有 x 位（mode {oct(idx.mode(exe))}）")
        # 只有 arm64 是硬要求：Apple Silicon 内核对无签名的可执行文件直接 SIGKILL。
        # Electron 官方的 x64 包本身就没签名（实测：cputype 01000007、无 LC_CODE_SIGNATURE），
        # Intel Mac 上未签名只会被 Gatekeeper 提示，不会拒绝运行，所以这里只记录不判失败。
        if 0x1D not in cmds and want_arch == "arm64":
            e.append("arm64 主可执行没有 LC_CODE_SIGNATURE（Apple Silicon 会直接 SIGKILL）")
        elif 0x1D not in cmds:
            idx.notes.append("x64 主可执行未签名（与 Electron 官方包一致），需 mac-finalize 做 ad-hoc 签名")

    # 3) Framework 与 4 个 helper
    fw = f"{A}/Contents/Frameworks/Electron Framework.framework"
    if need(fw):
        if not idx.has(f"{fw}/Versions/A/Electron Framework"):
            e.append("Electron Framework 的 Versions/A 缺失")
    for suffix in ("", " (GPU)", " (Renderer)", " (Plugin)"):
        helper = f"{A}/Contents/Frameworks/Lypora Helper{suffix}.app"
        if not idx.has(f"{helper}/Contents/MacOS/Lypora Helper{suffix}"):
            e.append(f"helper 缺失或未改名：{helper}")

    # 4) 符号链接（framework 内部 14 个，缺一个 dyld 就找不到库）
    if len(idx.links) < 14:
        e.append(f"符号链接只有 {len(idx.links)} 个，期望 ≥14（Windows 打包会丢失）")
    cur = f"{fw}/Versions/Current"
    if idx.links.get(cur) != "A":
        e.append(f"Versions/Current 不是指向 A 的符号链接（实际 {idx.links.get(cur)!r}）")

    # 5) 前端与主进程
    for rel in ("main.js", "preload.js", "package.json", "web/index.html"):
        if not idx.has(f"{A}/Contents/Resources/app/{rel}"):
            e.append(f"resources/app 缺少 {rel}")
    if idx.has(f"{A}/Contents/Resources/app/package.json"):
        pkg = json.loads(idx.read(f"{A}/Contents/Resources/app/package.json"))
        if pkg.get("version") != version:
            e.append(f"app/package.json 版本 {pkg.get('version')}，期望 {version}")
        if pkg.get("main") != "main.js":
            e.append("app/package.json main 不是 main.js")

    # 6) 图标
    if idx.has(f"{A}/Contents/Resources/Lypora.icns"):
        ic = idx.read(f"{A}/Contents/Resources/Lypora.icns")
        if ic[:4] != b"icns":
            e.append("Lypora.icns 魔数不对")
        elif len(ic) < 10_000:
            e.append(f"Lypora.icns 只有 {len(ic)} 字节，可能没塞进各档位 PNG")
    else:
        e.append("缺少 Lypora.icns")

    # 7) 不该有的东西
    for name in idx.items:
        if "_CodeSignature" in name:
            e.append(f"残留失效签名 {name}（会被 macOS 判成 damaged）")
            break
    for name in idx.items:
        if "default_app.asar" in name:
            e.append("残留 default_app.asar（会与 resources/app 抢入口）")
            break
    for name in idx.items:
        if "Electron Helper" in name:
            e.append(f"helper 未改名：{name}")
            break

    # 8) 交付辅助文件（都在顶层目录里，不散落到解压后的当前目录）
    for rel in ("mac-finalize.command", "README-macOS.txt", "build-info.txt",
                "LICENSE", "LICENSES.chromium.html"):
        if not idx.has(f"{root}{rel}"):
            e.append(f"缺少 {root}{rel}")
    fin = f"{root}mac-finalize.command"
    if idx.has(fin) and not (idx.mode(fin) & stat.S_IXUSR):
        e.append("mac-finalize.command 没有 x 位")
    return e


def check_linux(idx: Index, version: str) -> "list[str]":
    e: list[str] = []
    T = "Lypora"

    exe = f"{T}/lypora"
    if not idx.has(exe):
        e.append("缺少主程序 Lypora/lypora")
    else:
        info = elf_info(idx.read(exe)[:64])
        if not info:
            e.append("主程序不是 ELF")
        else:
            if info["class"] != 64:
                e.append(f"主程序是 {info['class']} 位 ELF")
            if info["machine"] != "x86-64":
                e.append(f"主程序架构 {info['machine']}，期望 x86-64")
            if info["type"] != 3:  # ET_DYN（PIE 可执行）
                e.append(f"主程序 ELF type={info['type']}，期望 3(ET_DYN)")
        if not (idx.mode(exe) & stat.S_IXUSR):
            e.append("主程序没有 x 位")

    sb = f"{T}/chrome-sandbox"
    if not idx.has(sb):
        e.append("缺少 chrome-sandbox")
    else:
        m = idx.mode(sb)
        if not (m & stat.S_ISUID):
            e.append(f"chrome-sandbox 缺 setuid 位（mode {oct(m)}，期望 4755）")
        if not elf_info(idx.read(sb)[:64]):
            e.append("chrome-sandbox 不是 ELF")

    # 前端与主进程
    for rel in ("main.js", "preload.js", "package.json", "web/index.html"):
        if not idx.has(f"{T}/resources/app/{rel}"):
            e.append(f"resources/app 缺少 {rel}")
    if idx.has(f"{T}/resources/app/package.json"):
        pkg = json.loads(idx.read(f"{T}/resources/app/package.json"))
        if pkg.get("version") != version:
            e.append(f"app/package.json 版本 {pkg.get('version')}，期望 {version}")

    # locales（Chromium 的语言包，缺了菜单只有英文）
    locales = [n for n in idx.items if n.startswith(f"{T}/locales/") and n.endswith(".pak")]
    if len(locales) < 20:
        e.append(f"locales/*.pak 只有 {len(locales)} 个，可能没打全")

    # .desktop 规范
    if not idx.has(f"{T}/lypora.desktop"):
        e.append("缺少 lypora.desktop")
    else:
        d = idx.read(f"{T}/lypora.desktop").decode("utf-8")
        for key in ("Type=Application", "Name=Lypora", "Exec=", "Icon=lypora", "Categories="):
            if key not in d:
                e.append(f"lypora.desktop 缺 {key}")
        if "MimeType=" not in d or "text/markdown" not in d:
            e.append("lypora.desktop 未声明 text/markdown（文件关联不会生效）")
        if "StartupWMClass=" not in d:
            e.append("lypora.desktop 缺 StartupWMClass（任务栏图标会分身）")

    # 图标各档
    for s in (16, 24, 32, 48, 64, 128, 256, 512):
        n = f"{T}/icons/hicolor/{s}x{s}/apps/lypora.png"
        if not idx.has(n):
            e.append(f"缺少图标 {s}x{s}")
        else:
            data = idx.read(n)
            if data[:8] != b"\x89PNG\r\n\x1a\n":
                e.append(f"{s}x{s} 不是 PNG")
            else:
                w, h = struct.unpack(">II", data[16:24])
                if (w, h) != (s, s):
                    e.append(f"图标尺寸 {w}x{h}，目录却标 {s}x{s}")

    for rel in ("lypora.sh", "install.sh", "uninstall.sh", "README-Linux.txt"):
        if not idx.has(f"{T}/{rel}"):
            e.append(f"缺少 {rel}")
    for rel in ("lypora.sh", "install.sh", "uninstall.sh"):
        if idx.has(f"{T}/{rel}") and not (idx.mode(f"{T}/{rel}") & stat.S_IXUSR):
            e.append(f"{rel} 没有 x 位")

    for name in idx.items:
        if "default_app.asar" in name:
            e.append("残留 default_app.asar")
            break
    for name in idx.items:
        if name.endswith(".exe") or name.endswith(".dll"):
            e.append(f"混进 Windows 文件：{name}")
            break
    return e


def main() -> int:
    version = read_version()
    args = sys.argv[1:]
    if args:
        tars = args
    else:
        tars = sorted(glob.glob(os.path.join(ROOT, "release", f"Lypora-{version}-*.tar.gz")))
    if not tars:
        print(f"[check] 没找到 release/Lypora-{version}-*.tar.gz", file=sys.stderr)
        return 2

    report = {"version": version, "packages": {}, "pass": True}
    for t in tars:
        base = os.path.basename(t)
        idx = Index(t)
        if "macos" in base:
            arch = "arm64" if "arm64" in base else "x64"
            errs = check_mac(idx, arch, version)
            kind = f"macos-{arch}"
        elif "linux" in base:
            errs = check_linux(idx, version)
            kind = "linux-x64"
        else:
            continue
        size = os.path.getsize(t)
        report["packages"][base] = {
            "kind": kind,
            "size": size,
            "entries": len(idx.items),
            "symlinks": len(idx.links),
            "errors": errs,
            "notes": idx.notes,
        }
        if errs:
            report["pass"] = False
        mark = "✓" if not errs else "✗"
        print(f"[check] {mark} {base}  {size / 1048576:.1f} MiB  条目 {len(idx.items)}  链接 {len(idx.links)}")
        for x in idx.notes:
            print(f"         i {x}")
        for x in errs:
            print(f"         - {x}")

    out = os.path.join(ROOT, "artifacts", "cross-platform", "check-report.json")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    print(f"[check] 报告 {out}")
    print(f"[check] 结论：{'全部通过' if report['pass'] else '有失败项'}")
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
