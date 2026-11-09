#!/usr/bin/env python3
"""已并入 tools/gen-icons.py —— 这里只做转发，保留旧命令不至于报错。

历史原因：Android 图标当初是唯一一套自绘素材（蓝色渐变 + 三条白条），
所以单独有个脚本解析白条坐标重建各密度。换成插画型 logo 之后，白条那套
几何解析彻底失效，全套图标（Web/Windows/macOS/Linux/Android）改成同一张
源图派生，继续分两个脚本事必会出现"改了 Web 忘了 Android"。

用法（等价于 python tools/gen-icons.py）：
  python tools/gen-android-assets.py
"""

from __future__ import annotations

import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

print("[assets] 已并入 tools/gen-icons.py，本次转发执行全部平台图标生成。", file=sys.stderr)
runpy.run_path(str(HERE / "gen-icons.py"), run_name="__main__")
