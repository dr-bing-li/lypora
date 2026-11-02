"""
跨平台打包共用件（macOS / Linux）。

为什么在 Windows 上也能做 macOS 包：
  1. Electron 的 darwin/linux 分发包就是官方预编译好的 zip，与宿主平台无关；
  2. 我们的前端产物是纯静态文件，主进程脚本是纯 JS，不需要编译；
  3. 唯一不能照搬的是**符号链接**——Windows 普通账户建不了 symlink，
     所以不能"解压到磁盘再打包"，必须 **zip 条目直通 tar 条目**（本文件的 TarBuilder
     和 pack-mac.py 的流式写法就是这个原因）。

不能做的（见 docs/06）：
  - 代码签名 / 公证：codesign、notarytool 只有 macOS 有，Windows 上无替代；
  - .dmg：hdiutil 同上；
  - AppImage / .deb：appimagetool 与 dpkg 是 ELF 程序，Windows 上跑不了。
"""

from __future__ import annotations

import io
import json
import os
import plistlib
import stat
import sys
import tarfile
import time

# 固定 mtime：同一次输入产出逐字节可复现的 tar.gz（sha256 才有比对价值）
FIXED_MTIME = 1_700_000_000

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def log(msg: str) -> None:
    print(f"[pack] {msg}", flush=True)


def fail(msg: str, code: int = 1):
    print(f"[pack] ✗ {msg}", file=sys.stderr, flush=True)
    raise SystemExit(code)


def read_version() -> str:
    with open(os.path.join(ROOT, "desktop", "package.json"), encoding="utf-8") as f:
        return json.load(f)["version"]


def app_payload(version: str) -> "dict[str, bytes]":
    """
    resources/app 的内容：主进程 + 预加载 + 自检探针 + 前端产物。
    与 tools/pack-win.mjs 生成的 Windows 结构保持一字不差，避免三端行为分叉。
    """
    out: dict[str, bytes] = {}
    for name in ("main.js", "preload.js", "selftest-probe.js"):
        with open(os.path.join(ROOT, "desktop", name), "rb") as f:
            out[name] = f.read()

    pkg = {
        "name": "lypora-desktop",
        "productName": "Lypora",
        "version": version,
        "description": "Lypora —— 独立实现的即时渲染 Markdown 编辑器",
        "main": "main.js",
        "author": "dr-bing-li",
        "license": "MIT",
        "homepage": "https://github.com/dr-bing-li/lypora#readme",
    }
    out["package.json"] = (json.dumps(pkg, indent=2, ensure_ascii=False) + "\n").encode("utf-8")

    web = os.path.join(ROOT, "core", "dist")
    if not os.path.exists(os.path.join(web, "index.html")):
        fail("找不到 core/dist/index.html，请先 cd core && npx vite build")
    for base, _dirs, files in os.walk(web):
        for fn in files:
            full = os.path.join(base, fn)
            rel = os.path.relpath(full, web).replace(os.sep, "/")
            with open(full, "rb") as f:
                out[f"web/{rel}"] = f.read()
    return out


class TarBuilder:
    """按固定 mtime / uid / gid 写 tar，支持真实符号链接条目与 setuid 位。"""

    def __init__(self, path_tar_gz: str, comment: str = ""):
        self.raw = open(path_tar_gz, "wb")
        self.gz = __import__("gzip").GzipFile(
            filename="", mode="wb", fileobj=self.raw, mtime=FIXED_MTIME, compresslevel=9
        )
        self.tar = tarfile.open(fileobj=self.gz, mode="w", format=tarfile.PAX_FORMAT)
        self.comment = comment
        self.dirs: set[str] = set()
        self.count = 0

    def _ti(self, name: str, mode: int) -> tarfile.TarInfo:
        ti = tarfile.TarInfo(name)
        ti.mtime = FIXED_MTIME
        ti.uid = 0
        ti.gid = 0
        ti.uname = "root"
        ti.gname = "wheel"
        ti.mode = mode
        return ti

    def dir(self, name: str, mode: int = 0o755) -> None:
        name = name.rstrip("/")
        if not name or name in self.dirs:
            return
        # 逐级补父目录，解压器对顺序的宽容度不一，显式写更稳
        parts = name.split("/")
        for i in range(1, len(parts) + 1):
            sub = "/".join(parts[:i])
            if sub in self.dirs:
                continue
            ti = self._ti(sub, mode if i == len(parts) else 0o755)
            ti.type = tarfile.DIRTYPE
            ti.size = 0
            self.tar.addfile(ti)
            self.dirs.add(sub)

    def file_bytes(self, name: str, data: bytes, mode: int = 0o644) -> None:
        self.dir(os.path.dirname(name))
        ti = self._ti(name, mode)
        ti.size = len(data)
        self.tar.addfile(ti, io.BytesIO(data))
        self.count += 1

    def file_stream(self, name: str, src, size: int, mode: int = 0o644) -> None:
        """从 zip 的已打开流直接灌进 tar，避免把 200MB 读进内存。"""
        self.dir(os.path.dirname(name))
        ti = self._ti(name, mode)
        ti.size = size
        self.tar.addfile(ti, src)
        self.count += 1

    def symlink(self, name: str, target: str) -> None:
        self.dir(os.path.dirname(name))
        ti = self._ti(name, 0o777)
        ti.type = tarfile.SYMTYPE
        ti.linkname = target
        ti.size = 0
        self.tar.addfile(ti)
        self.count += 1

    def close(self) -> int:
        if self.comment:
            self.tar.pax_headers = {"comment": self.comment}
        self.tar.close()
        self.gz.close()
        size = self.raw.tell()
        self.raw.close()
        return size


def icns_bytes(png_by_size: "dict[int, bytes]") -> bytes:
    """
    手写 .icns。没有 macOS 就用不了 iconutil，但 icns 容器本身很简单：
    'icns' + 总长度 + 若干 (4 字节类型 + 4 字节长度 + PNG 数据)。
    各类型对应的像素尺寸是固定的，写错尺寸 Finder 会拒绝显示。
    """
    types = [
        (b"icp4", 16),
        (b"icp5", 32),
        (b"icp6", 64),
        (b"ic07", 128),
        (b"ic08", 256),
        (b"ic09", 512),
        (b"ic10", 1024),
        (b"ic11", 32),
        (b"ic12", 64),
        (b"ic13", 256),
        (b"ic14", 512),
    ]
    body = b""
    for tag, size in types:
        data = png_by_size.get(size)
        if not data:
            continue
        body += tag + (len(data) + 8).to_bytes(4, "big") + data
    return b"icns" + (len(body) + 8).to_bytes(4, "big") + body


def make_pngs(src_png: str, sizes: "list[int]") -> "dict[int, bytes]":
    try:
        from PIL import Image
    except ImportError:
        fail("需要 Pillow 来生成图标：pip install pillow（或用 managed venv 里的 python 运行本脚本）")
    out: dict[int, bytes] = {}
    im = Image.open(src_png).convert("RGBA")
    for s in sizes:
        buf = io.BytesIO()
        im.resize((s, s), Image.LANCZOS).save(buf, format="PNG", optimize=True)
        out[s] = buf.getvalue()
    return out


def zip_modes(zf) -> "dict[str, tuple[int, str]]":
    """返回 {条目名: (unix mode, 'file'|'dir'|'link')}"""
    out = {}
    for info in zf.infolist():
        mode = (info.external_attr >> 16) & 0xFFFF
        kind = stat.S_IFMT(mode)
        if kind == stat.S_IFLNK:
            out[info.filename] = (0o777, "link")
        elif info.is_dir() or kind == stat.S_IFDIR:
            out[info.filename.rstrip("/")] = (0o755, "dir")
        else:
            out[info.filename] = (mode & 0o777 or 0o644, "file")
    return out


def human(n: int) -> str:
    return f"{n / 1048576:.1f} MiB"


def now_stamp() -> str:
    return time.strftime("%Y-%m-%d")
