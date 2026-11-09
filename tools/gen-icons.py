#!/usr/bin/env python3
"""从唯一源图重生成全部平台图标（Web / Windows / macOS / Linux / Android）。

为什么是"唯一源图"：以前每端各存一套图，改一次 logo 要手工同步 5 个地方，必然漏。
现在只认 `docs/images/logo-source.jpg`，其余文件全是生成物，重跑本脚本即可。

源图是手绘插画（兵马俑宇航员），不是矢量几何图形，所以不能像旧的
gen-android-assets.py 那样解析白条位置重新排布——直接按裁切框缩放，小尺寸补锐化。
裁切框取头部特写：整幅缩小后 32px 下只剩一团色块，脸和头盔都糊掉；头部特写
在 24px 下仍能看出护目镜和胡须，同时保留右上角星野，太空的语境不丢。

产出：
  core/public/icons/{icon-192,icon-512,favicon-32,apple-touch-icon}.png   Web / PWA
  desktop/icon.ico                                                       Windows（7 档，PNG 压缩）
  desktop/icon-mac.png                                                   macOS（1024，留 9.7% 边距 + 圆角）
  core/android/app/src/main/res/mipmap-*/ic_launcher{,_round,_foreground}.png
  core/android/app/src/main/res/drawable*/splash.png
  core/android/app/src/main/res/drawable/ic_launcher_background.xml      （纯色，取源图边缘色）

Linux 的 8 档 hicolor 图标由 pack-linux.py / _linuxpkg.py 用 make_pngs() 从
icon-512.png 现算，这里不重复生成。

用法：
  python tools/gen-icons.py            # 全部
  python tools/gen-icons.py --preview  # 只出一张对比图，不落盘图标
依赖：Pillow
"""

from __future__ import annotations

import io
import struct
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "images" / "logo-source.jpg"
PUB = ROOT / "core" / "public" / "icons"
ANDROID_RES = ROOT / "core" / "android" / "app" / "src" / "main" / "res"

# 源图 806x806，按这个方形区域裁到头部特写（实测最佳辨识度）
CROP = (55, 5, 755, 705)
MASTER = 1024

# 边缘留白 / 圆角比例
R_SQUARE = 0.215      # 传统图标圆角（与 Android squircle 观感一致）
MAC_ART = 0.805       # macOS Big Sur 网格：画面占 1024 的 80.5%
MAC_RADIUS = 0.2245   # 相对画面边长

LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SPLASH = {
    "drawable": (480, 320),
    "drawable-port-mdpi": (320, 480),
    "drawable-port-hdpi": (480, 800),
    "drawable-port-xhdpi": (720, 1280),
    "drawable-port-xxhdpi": (960, 1600),
    "drawable-port-xxxhdpi": (1280, 1920),
    "drawable-land-mdpi": (480, 320),
    "drawable-land-hdpi": (800, 480),
    "drawable-land-xhdpi": (1280, 720),
    "drawable-land-xxhdpi": (1600, 960),
    "drawable-land-xxxhdpi": (1920, 1280),
}
SPLASH_ICON_RATIO = 0.32


def die(msg: str) -> None:
    print(f"[icons] 错误：{msg}", file=sys.stderr)
    raise SystemExit(1)


def load_master() -> Image.Image:
    if not SRC.exists():
        die(f"找不到源图 {SRC}")
    im = Image.open(SRC).convert("RGB")
    im = im.crop(CROP).resize((MASTER, MASTER), Image.LANCZOS)
    # 放大后略微软化，补一点锐度（照片型图标必须，矢量图不需要）
    return im.filter(ImageFilter.UnsharpMask(radius=1.6, percent=85, threshold=2))


def edge_color(im: Image.Image) -> tuple[int, int, int]:
    """取外圈像素按亮度排序后的 20% 分位色，作为启动图/自适应背景。

    为什么不用中位色：这张画外圈一半是锈红色铠甲，中位色会取到 #743C29，
    拿去做启动图背景像块铁锈。20% 分位落在太空的深蓝黑上，和"太空"语境一致。
    """
    small = im.resize((64, 64), Image.LANCZOS)
    px = small.load()
    ring = [px[x, y] for x in range(64) for y in range(64)
            if x < 3 or y < 3 or x >= 61 or y >= 61]
    ring.sort(key=lambda c: 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2])
    return ring[int(len(ring) * 0.2)]


def sharpen(im: Image.Image, percent: int = 60) -> Image.Image:
    return im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=percent, threshold=2))


def rounded(im: Image.Image, size: int, radius_ratio: float, zoom: float = 1.0) -> Image.Image:
    """圆角方块。zoom<1 表示画面收缩、四周留透明（macOS 用）。"""
    ss = 4
    s = size * ss
    art = int(s * zoom)
    off = (s - art) // 2
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    art_im = im.resize((art, art), Image.LANCZOS)
    mask = Image.new("L", (art, art), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        [0, 0, art - 1, art - 1], radius=int(art * radius_ratio), fill=255)
    canvas.paste(art_im, (off, off), mask)
    return canvas.resize((size, size), Image.LANCZOS)


def circle(im: Image.Image, size: int) -> Image.Image:
    ss = 4
    s = size * ss
    canvas = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    art = im.resize((s, s), Image.LANCZOS)
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, s - 1, s - 1], fill=255)
    canvas.paste(art, (0, 0), mask)
    return canvas.resize((size, size), Image.LANCZOS)


def png_bytes(im: Image.Image) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def write_ico(path: Path, master: Image.Image, sizes: list[int]) -> int:
    """手写 ICO：Pillow 自带的 ICO 保存只有一档原图，缩放质量不可控，小尺寸会糊。

    Vista 之后 ICO 允许直接塞 PNG 数据，所以每档单独缩放 + 单独锐化。
    """
    entries: list[tuple[int, bytes]] = []
    for s in sizes:
        im = master.resize((s, s), Image.LANCZOS)
        if s <= 64:
            im = sharpen(im, 70)
        entries.append((s, png_bytes(im)))

    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    dirs = b""
    data = b""
    for s, blob in entries:
        dim = 0 if s >= 256 else s
        dirs += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(blob), offset)
        offset += len(blob)
        data += blob
    path.write_bytes(header + dirs + data)
    return len(header + dirs + data)


def render_splash(w: int, h: int, icon: Image.Image, bg: tuple[int, int, int]) -> Image.Image:
    ss = 2
    canvas = Image.new("RGB", (w * ss, h * ss), bg)
    target = int(min(w, h) * SPLASH_ICON_RATIO) * ss
    scaled = icon.resize((target, target), Image.LANCZOS)
    canvas.paste(scaled, ((canvas.width - target) // 2, (canvas.height - target) // 2), scaled)
    return canvas.resize((w, h), Image.LANCZOS)


def preview(master: Image.Image, bg: tuple[int, int, int]) -> Path:
    out = ROOT / "build" / "logo-preview" / "final.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    tiles = []
    for s in (512, 256, 128, 64, 48, 32, 24, 16):
        tiles.append((s, master.resize((s, s), Image.LANCZOS)))
    pad = 20
    sheet = Image.new("RGB", (sum(t[0] for t in tiles) + pad * (len(tiles) + 1), 532), (255, 255, 255))
    x = pad
    for s, im in tiles:
        sheet.paste(im, (x, pad))
        sheet.paste(rounded(master, s, R_SQUARE), (x, pad + 512 + 20 - s))
        x += s + pad
    sheet.save(out)
    return out


def main() -> None:
    master = load_master()
    bg = edge_color(master)
    hexbg = "#{:02X}{:02X}{:02X}".format(*bg)
    print(f"[icons] 源图 {SRC.name} {Image.open(SRC).size} → 裁切 {CROP} → 主图 {MASTER}x{MASTER}")
    print(f"[icons] 边缘色 {hexbg}")

    if "--preview" in sys.argv:
        print(f"[icons] 预览：{preview(master, bg).relative_to(ROOT)}")
        return

    # ---- Web / PWA ----
    PUB.mkdir(parents=True, exist_ok=True)
    fav = sharpen(master.resize((32, 32), Image.LANCZOS), 90)
    for name, im in (
        ("icon-512.png", master.resize((512, 512), Image.LANCZOS)),
        ("icon-192.png", master.resize((192, 192), Image.LANCZOS)),
        ("apple-touch-icon.png", master.resize((180, 180), Image.LANCZOS)),
        ("favicon-32.png", fav),
    ):
        (PUB / name).write_bytes(png_bytes(im))
        print(f"  {PUB.name}/{name}  {im.size[0]}px")

    # ---- Windows ----
    ico = ROOT / "desktop" / "icon.ico"
    n = write_ico(ico, master, [16, 24, 32, 48, 64, 128, 256])
    print(f"  desktop/icon.ico  7 档，{n} 字节")

    # ---- macOS（Big Sur 网格：画面 80.5%，圆角 22.45%）----
    mac = rounded(master, 1024, MAC_RADIUS, zoom=MAC_ART)
    (ROOT / "desktop" / "icon-mac.png").write_bytes(png_bytes(mac))
    print("  desktop/icon-mac.png  1024px（留边 + 圆角）")

    # ---- Android ----
    for d, size in LEGACY.items():
        outdir = ANDROID_RES / f"mipmap-{d}"
        outdir.mkdir(parents=True, exist_ok=True)
        sq = rounded(master, size, R_SQUARE)
        if size <= 96:
            sq = sharpen(sq, 55)
        (outdir / "ic_launcher.png").write_bytes(png_bytes(sq))
        (outdir / "ic_launcher_round.png").write_bytes(png_bytes(circle(master, size)))
        fg = master.resize((ADAPTIVE[d], ADAPTIVE[d]), Image.LANCZOS)
        (outdir / "ic_launcher_foreground.png").write_bytes(png_bytes(fg))
        print(f"  mipmap-{d}: launcher {size}px / round {size}px / foreground {ADAPTIVE[d]}px")

    splash_icon = rounded(master, 512, R_SQUARE)
    for d, (w, h) in SPLASH.items():
        outdir = ANDROID_RES / d
        outdir.mkdir(parents=True, exist_ok=True)
        render_splash(w, h, splash_icon, bg).save(outdir / "splash.png", optimize=True)
        print(f"  {d}/splash.png {w}x{h}")

    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!-- 自适应图标背景：取 logo 边缘色，和前景照片无缝衔接（由 tools/gen-icons.py 生成） -->\n"
        '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n'
        f'    <solid android:color="{hexbg}" />\n'
        "</shape>\n"
    )
    (ANDROID_RES / "drawable" / "ic_launcher_background.xml").write_text(xml, encoding="utf-8")
    print(f"  drawable/ic_launcher_background.xml  {hexbg}")
    print("[icons] 完成")


if __name__ == "__main__":
    main()
