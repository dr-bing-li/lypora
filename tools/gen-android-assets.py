#!/usr/bin/env python3
"""从 core/public/icons/icon-512.png 生成 Android 启动图标与启动图。

为什么需要这个脚本：`npx cap add android` 生成的是 Capacitor 自带的默认图标
（青色板手/闪电那套），和 Lypora 的品牌形象无关，也不适合开源分发。图标本身是
"垂直线性渐变圆角方块 + 三条白色圆角横条"，几何很规则，所以这里从源图解析出
白条位置后重新排布，而不是手写死数字——源图换了也不会生成错位的资源。

产出（全部写入 core/android/app/src/main/res/）：
  mipmap-*/ic_launcher.png            传统方形图标（保留源图的圆角squircle）
  mipmap-*/ic_launcher_round.png      圆形图标（渐变满铺 + 圆形裁切）
  mipmap-*/ic_launcher_foreground.png 自适应图标前景（108dp 网格，白条居中）
  drawable*/splash.png                启动图（白底 + 居中图标）

自适应图标的背景不生成 PNG，而是一段 XML 渐变（drawable/ic_launcher_background.xml），
因为渐变是纯线性的，矢量绘制在任何密度下都精确。

用法：
  python tools/gen-android-assets.py
依赖：Pillow
"""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "core" / "public" / "icons" / "icon-512.png"
RES = ROOT / "core" / "android" / "app" / "src" / "main" / "res"

SS = 4  # 超采样倍率，缩回目标尺寸后得到抗锯齿边缘

# 传统图标边长（dp）：mdpi/hdpi/xhdpi/xxhdpi/xxxhdpi
LEGACY = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
# 自适应图标前景画布边长（108dp 网格）
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
# 启动图原始尺寸，沿用 Capacitor 生成的那一套，不改变屏占比假设
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

BARS_TARGET_DP = 40.0  # 自适应图标里白条块的宽度（72dp 安全区内，圆形遮罩下不溢出）
SPLASH_ICON_RATIO = 0.26  # 启动图标边长 / 屏幕短边
SPLASH_BG = (255, 255, 255)


def die(msg: str) -> None:
    print(f"[assets] 错误：{msg}", file=sys.stderr)
    raise SystemExit(1)


def load_source() -> tuple[Image.Image, list[tuple[int, int, int, int]], tuple[int, int, int], tuple[int, int, int]]:
    if not SRC.exists():
        die(f"找不到源图标 {SRC}")
    im = Image.open(SRC).convert("RGBA")
    px = im.load()
    w, h = im.size

    # 白条 = 近白且不透明。按行做游程，聚成连续的行带，就是每一根条。
    rows: list[int] = []
    for y in range(h):
        if any(px[x, y][3] > 200 and min(px[x, y][:3]) > 235 for x in range(0, w, 2)):
            rows.append(y)

    bands: list[tuple[int, int]] = []
    for y in rows:
        if bands and y - bands[-1][1] <= 1:
            bands[-1] = (bands[-1][0], y)
        else:
            bands.append((y, y))
    if not bands:
        die("源图里没找到白色横条")

    bars: list[tuple[int, int, int, int]] = []
    for y0, y1 in bands:
        ym = (y0 + y1) // 2
        xs = [x for x in range(w) if px[x, ym][3] > 200 and min(px[x, ym][:3]) > 235]
        bars.append((min(xs), y0, max(xs) + 1, y1 + 1))

    # 背景是纯垂直线性渐变：取一条不含白条的竖列，读首尾两端的颜色。
    col = 8
    top = px[col, 0][:3]
    bottom = px[col, h - 1][:3]
    return im, bars, top, bottom


def render_rounded_plate(size: int, top: tuple[int, int, int], bottom: tuple[int, int, int], radius_ratio: float, bars, canvas_w: int) -> Image.Image:
    """渐变圆角方块 + 白条。圆形图标把 radius_ratio 设成 0.5 就得到圆形。

    这里按"源图整幅画布"缩放（k = s / canvas_w），白条保持它在 512 画布里的相对位置和粗细。
    """

    s = size * SS
    plate = Image.new("RGBA", (s, s), (0, 0, 0, 0))

    grad = Image.new("RGB", (1, s))
    gp = grad.load()
    for y in range(s):
        t = y / max(s - 1, 1)
        gp[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    grad = grad.resize((s, s), Image.NEAREST)

    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * radius_ratio), fill=255)
    plate.paste(grad, (0, 0), mask)

    draw = ImageDraw.Draw(plate)
    k = s / canvas_w
    for bx0, by0, bx1, by1 in bars:
        x0 = bx0 * k
        y0 = by0 * k
        x1 = bx1 * k
        y1 = by1 * k
        draw.rounded_rectangle([x0, y0, x1 - 1, y1 - 1], radius=(y1 - y0) / 2, fill=(255, 255, 255, 255))

    return plate.resize((size, size), Image.LANCZOS)


def render_foreground(size: int, bars, src_box, bars_width: float) -> Image.Image:
    """自适应图标前景：透明画布，白条块按目标宽度居中。"""
    s = size * SS
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    sx0, sy0, sx1, sy1 = src_box
    bw, bh = sx1 - sx0, sy1 - sy0
    target_w = bars_width / 108.0 * s
    k = target_w / bw
    off_x = (s - target_w) / 2
    off_y = (s - bh * k) / 2

    for bx0, by0, bx1, by1 in bars:
        x0 = off_x + (bx0 - sx0) * k
        y0 = off_y + (by0 - sy0) * k
        x1 = off_x + (bx1 - sx0) * k
        y1 = off_y + (by1 - sy0) * k
        draw.rounded_rectangle([x0, y0, x1 - 1, y1 - 1], radius=(y1 - y0) / 2, fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)


def render_splash(w: int, h: int, icon: Image.Image) -> Image.Image:
    canvas = Image.new("RGB", (w * SS, h * SS), SPLASH_BG)
    target = int(min(w, h) * SPLASH_ICON_RATIO) * SS
    scaled = icon.resize((target, target), Image.LANCZOS)
    canvas.paste(scaled, ((canvas.width - target) // 2, (canvas.height - target) // 2), scaled)
    return canvas.resize((w, h), Image.LANCZOS)


def write_gradient_xml(top, bottom) -> None:
    xml = (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<!-- 自适应图标背景：与 icon-512.png 同一套垂直线性渐变，矢量绘制，任意密度都精确 -->\n"
        '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">\n'
        f'    <gradient\n'
        f'        android:type="linear"\n'
        f'        android:angle="270"\n'
        f'        android:startColor="#{top[0]:02X}{top[1]:02X}{top[2]:02X}"\n'
        f'        android:endColor="#{bottom[0]:02X}{bottom[1]:02X}{bottom[2]:02X}" />\n'
        "</shape>\n"
    )
    out = RES / "drawable" / "ic_launcher_background.xml"
    out.write_text(xml, encoding="utf-8")
    print(f"  {out.relative_to(ROOT)}  #{top[0]:02X}{top[1]:02X}{top[2]:02X} → #{bottom[0]:02X}{bottom[1]:02X}{bottom[2]:02X}")


def main() -> None:
    im, bars, top, bottom = load_source()
    src_box = (min(b[0] for b in bars), min(b[1] for b in bars),
               max(b[2] for b in bars), max(b[3] for b in bars))
    print(f"[assets] 源图 {im.size[0]}x{im.size[1]}，白条 {len(bars)} 根，块 {src_box[2]-src_box[0]}x{src_box[3]-src_box[1]}")
    for b in bars:
        print(f"         bar x{b[0]}..{b[2]} y{b[1]}..{b[3]}")

    # 圆角半径：从源图左上角实测，y=0 时的平直段从 r 开始
    px = im.load()
    first = next(x for x in range(im.width) if px[x, 0][3] > 128)
    radius_ratio = first / im.width
    print(f"[assets] 外框圆角半径 ≈ {radius_ratio:.3f} × 边长")

    squircle = render_rounded_plate(512, top, bottom, radius_ratio, bars, im.width)
    circle = render_rounded_plate(512, top, bottom, 0.5, bars, im.width)

    for d, size in LEGACY.items():
        outdir = RES / f"mipmap-{d}"
        outdir.mkdir(parents=True, exist_ok=True)
        squircle.resize((size, size), Image.LANCZOS).save(outdir / "ic_launcher.png", optimize=True)
        circle.resize((size, size), Image.LANCZOS).save(outdir / "ic_launcher_round.png", optimize=True)
        render_foreground(ADAPTIVE[d], bars, src_box, BARS_TARGET_DP).save(
            outdir / "ic_launcher_foreground.png", optimize=True)
        print(f"  mipmap-{d}: ic_launcher {size}px / round {size}px / foreground {ADAPTIVE[d]}px")

    for d, (w, h) in SPLASH.items():
        outdir = RES / d
        outdir.mkdir(parents=True, exist_ok=True)
        render_splash(w, h, squircle).save(outdir / "splash.png", optimize=True)
        print(f"  {d}/splash.png {w}x{h}")

    write_gradient_xml(top, bottom)
    print("[assets] 完成")


if __name__ == "__main__":
    main()
