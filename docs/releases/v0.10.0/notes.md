排版不再是一个藏在「文件」里的子项。

0.9.0 把输出能力做成了模板引擎，但入口低、模板少、装饰不够用——「纹理与装饰」设了没反应，
手机竖屏选 9:16 会把设置区挤出屏幕。0.10.0 把这几件事一起收了：**「排版」升为一级菜单**，
模板从 12 套扩到 20 套（补了苹果备忘录 / Instagram / 线圈笔记本 / 波普艺术等），
新增**背景**（6 种纸纹 + 本地上传图片 + 浓度）与**装订**（线圈 / 票夹 / 订书钉）两个维度，
「存为我的模板」可以自己起名字，两处显示层 bug 一并修掉。

Layout is no longer a submenu buried under "File".

0.9.0 turned the output layer into a template engine, but the entry point was low, the library was small and
the decoration options were not enough — "texture & decoration" had no visible effect, and picking 9:16 on a
phone pushed the settings panel off screen. 0.10.0 fixes all of that: **Layout is now a top-level menu**, the
library grows from 12 to 20 templates (Apple Notes, Instagram, spiral notebook, pop art and more), and two new
dimensions arrive — **backgrounds** (6 paper textures + local image upload + opacity) and **bindings**
(spiral / clip / staple). "Save as my template" now lets you name it, and two rendering bugs are gone.

- 全部代码、样式、模板、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.10.0-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `7f4d156a3925d666a5ec1db16d71ece60202539188ec747531b8bceca3d53189` |
| `Lypora-0.10.0-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.6 MiB | `a3d326a8a2e0ddbba5f95d91d6ec5ce325db51852f13ba366dfc59805ac58c9a` |
| `Lypora-0.10.0-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 发布时回填 | 发布时回填 |
| `Lypora-0.10.0-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 发布时回填 | 发布时回填 |
| `Lypora-0.10.0-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | CI 构建后回填 | CI 构建后回填 |
| `Lypora-0.10.0-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装 | CI 构建后回填 | CI 构建后回填 |
| `lypora_0.10.0_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | CI 构建后回填 | CI 构建后回填 |
| `lypora-0.10.0-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | CI 构建后回填 | CI 构建后回填 |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单 | 发布时生成 / generated at publish | — |

Windows 与 Android 在本机构建（上表为实测值）；macOS 两件由 `tools/pack-mac.py` 本地打，
Linux 四件由 CI 在打 tag 时构建，它们的体积与校验值在发布流水线里回填。

The Windows and Android artefacts were built locally (values above are measured); the two macOS builds come
from `tools/pack-mac.py` locally, and the four Linux ones are built by CI on the tag. Their sizes and hashes
are filled in by the release pipeline.

**校验方法 / How to verify**

```bash
sha256sum -c SHA256SUMS.txt          # Linux
shasum -a 256 -c SHA256SUMS.txt      # macOS
```

---

# 中文说明

## 版本信息

| 项 | 值 |
|---|---|
| 版本 | `0.10.0`（`0.9.0` → `0.10.0`） |
| 日期 | 2026-11-11 |
| 类型 | 功能 + 缺陷修复（含界面结构调整） |
| 平台 | Windows x64 / macOS arm64+x64 / Linux x64（tar.gz / AppImage / deb / rpm）/ Android 10+ / PWA |
| Android | `versionName 0.10.0` / `versionCode 14` / `app.lypora.editor` |
| 协议 | MIT |

### 为什么是 0.10.0 而不是 0.9.1

改了两处**用户可见的结构**：菜单根从「文件 → 美化输出」变成一级「排版」，语言降为二级；
手机底栏从 6 个按钮变成 7 个。菜单结构和底栏是外壳契约，验收脚本、文档、截图都要跟着动，
所以走次版本号而不是补丁号。模板从 12 到 20、参数从 17 到 19 也够得上 minor。

## 本版改了什么

### 一、菜单结构：排版上一级，语言下一级

- 一级菜单新增 **「排版」**，位置在**「设置」左侧**，快捷键 `Ctrl+Shift+P`。
- `文件 → 美化输出` 已**删除**（只留一个入口，避免两处状态不同步）。
- **「语言」降为 `设置 → 语言`** 二级菜单。菜单根总数仍是 9 个，只是「语言」换成了「排版」。
- **手机底栏加第 7 个按钮「排版」**，一步直达排版面板，不用先进「菜单」面板再翻分区。
- 手机「菜单」面板仍是完整的 9 个分区（含「设置」——否则手机上改不了语言）。

### 二、模板从 12 套到 20 套

新增 8 套，都是按「常见平台的视觉母语」挑的：

| 新增 | 特点 |
|---|---|
| 苹果备忘录 | 纯白 + 横线本底纹，两色分标题层级 |
| Instagram 风格 | 洋红强调 + 水彩底 + 大圆角 |
| 线圈笔记本 | 左侧线圈装订 + 横线纸 |
| 波普艺术 | 高饱和黄 + 网点 + 红角标 |
| 艺术装饰 | 黑金 + 衬线 + 光晕 |
| 杂志跨栏 | 标题 48px、左侧粗黑条 |
| 霓虹 | 深蓝黑 + 洋红 |
| 手账 | 牛皮纸 + 胶带 + 折角 |

画廊里的示例图不再是单色块，换成**三色小样**（纸 / 强调 / 墨斜切），一眼能看出这套配什么色。

### 三、背景与装订（两个新维度）

- **背景底纹 6 种**：牛皮纸 / 横线本 / 方格 / 点阵 / 水彩 / 宣纸。全部用 CSS 渐变生成——
  不落图片文件、缩放不糊、导出时天然内联、包体积零增长。
- **自定义背景图**：可以上传本地图片（压到长边 1600px 的 webp 存进模板），配 0–100% 浓度滑块。
  图片只存在你自己的模板 JSON 里，**不上传、不同步、不出本机**。
- 6 种底纹**逐个都验过「看得出来」**：牛皮纸除了斜纹还有一层牛皮底色（原来只有 alpha 0.055 的纹，
  在白纸上等于没有）；点阵从 1.1px 提到 1.35px 并加深，2× 出图里能看出是一张点阵纸。
- **装订 4 档**：无 / 线圈 / 票夹 / 订书钉。

### 四、「存为我的模板」可以自己命名

点了之后弹命名框，默认名是「原名·改」，重名自动加序号。之前只能自动生成名字，
现在能按自己的分类起名（「公众号头图」「周报模板」……）。

### 五、修掉的两个显示层 bug

1. **「纹理与装饰」整组无效**。根因是纹理线的颜色按**墨色**亮度判断：浅纸配深字是常态，
   于是白线画在白纸上，8 种纹理里 5 种完全看不见。现在按**纸色**亮度取线色。
   同时修了验收脚本里的一个**假通过**——旧用例的基线取自改字号之前，纹理没画出来也照样通过。
2. **手机 / 窄屏选「长竖 9:16」时设置区被挤出屏幕**。预览区改成固定占比（约 34vh），
   设置区始终可滚动，尺寸按钮、滑块、背景色块、底栏都还在视口内。

## 兼容性与迁移

- **升级不需要迁移任何设置**：编辑器设置键一个没动。
- **旧模板照常读**：模板 `schema` 从 2 升到 3（新增背景与装订四个字段），但读取时缺字段
  一律回落默认值，0.9.0 存的「我的模板」和导出的 `.lyt.json` 都能直接打开，只是没有背景设置。
- **`file-beautify` 菜单项已删除**：如果你写了自己的脚本按菜单 id 点击，改成
  `layout → layout-open`。
- **PWA 缓存名升到 `lypora-v4`**：装过旧版 PWA 的会在下次打开时自动更新，不用手动清缓存。

## 验证

同一台机器（Windows 11 / Edge / Node 22.22.2），全部脚本重跑：

```
tsc --noEmit       退出码 0
beautify-check     pass = true, errors = []   20 套模板全部出图 / 参数重排 4→5 页 /
                                               纹理同字号对比与回到基线 / 背景与装订 / 自定义命名 / schema=3
mobile-check       pass = true, errors = []   5 种视口；底栏 7 个按钮、9 分区 84 行，无横向溢出
i18n-check         pass = true, errors = []   287 键 × 7 语言；运行时切到日文后 reload 仍是 ja
verify             pass = true, errors = []   编辑器主链路、设置迁移、移动端工具栏
export-check       pass = true, errors = []   原有 MD / HTML / PDF 链路无回归
--selftest         ok = true                 版本 0.10.0、9 个菜单根（排版在设置左侧）、consoleErrors []
```

窄屏专项（390×844）：从底栏「排版」按钮进入 → 切「长竖 9:16」→ 预览区 287px（=34vh）、
设置区 342px 可滚动（内容 1851px）、底栏 78px 仍在视口内，6 个滑块与背景色块均点击命中，
无横向溢出、无页面报错。**未覆盖**：Android WebView / iOS Safari 上软键盘与
地址栏收缩后的可视高度。

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.10.0_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.10.0-1.x86_64.rpm

# 任意发行版，免安装
chmod +x Lypora-0.10.0-linux-x64.AppImage && ./Lypora-0.10.0-linux-x64.AppImage

# Windows：解压 Lypora-0.10.0-win-x64.zip，双击 Lypora.exe
# Android：传 APK 到手机点开安装（需允许「未知来源」）
```

## 已知限制

- **Android 真机导出**仍未人工验证（`shareBinary` 写 Documents + 拉分享面板）。
- **桌面「另存为」对话框**需人工点一次确认落盘。
- **真机窄屏**的软键盘 / 地址栏收缩未覆盖，只有 Playwright 模拟。
- **背景图不跨模板复用**：上传的图存在当前模板里，换模板要重传（后续做「我的背景」列表）。
- **分页不均衡**：大代码块会独占一页留半页空白。

---

# English

## Version information

| Field | Value |
|---|---|
| Version | `0.10.0` (`0.9.0` → `0.10.0`) |
| Date | 2026-11-11 |
| Type | Features + bug fixes (with UI structure changes) |
| Platforms | Windows x64 / macOS arm64+x64 / Linux x64 (tar.gz / AppImage / deb / rpm) / Android 10+ / PWA |
| Android | `versionName 0.10.0` / `versionCode 14` / `app.lypora.editor` |
| Licence | MIT |

### Why 0.10.0 and not 0.9.1

Two **user-visible structures** changed: the entry moved from "File → Beautify" to a top-level "Layout" menu,
and Language became a submenu of Settings; the mobile dock went from 6 buttons to 7. Menu structure is a shell
contract — acceptance scripts, docs and screenshots all follow it — so this warrants a minor bump rather than a
patch. Going from 12 to 20 templates and 17 to 19 parameters would already justify it.

## What changed

### 1. Menu structure

- New top-level **"Layout"**, placed **left of Settings**, shortcut `Ctrl+Shift+P`.
- `File → Beautify` is **removed** — one entry point only, so the two can never disagree.
- **Language is now `Settings → Language`**. The number of menu roots stays at 9.
- **A 7th dock button "Layout"** on mobile opens the panel in one tap.
- The mobile menu sheet still carries all 9 sections, including Settings — otherwise you cannot change
  language on a phone at all.

### 2. From 12 to 20 templates

Eight new ones, chosen for the visual language of common platforms: Apple Notes, Instagram, Spiral Notebook,
Pop Art, Art Deco, Editorial Spread, Neon, Craft Journal. Gallery swatches are now **three-colour chips**
(paper / accent / ink) instead of a single block.

### 3. Backgrounds and bindings

- **6 built-in paper textures** (kraft / lined / grid / dots / watercolour / wire), generated as CSS gradients:
  no image files, crisp at any scale, inlined into exports, zero bundle growth.
- **Custom background image**: upload a local picture (downscaled to 1600px webp inside the template) with a
  0–100% opacity slider. It lives only in your own template JSON — never uploaded, never synced.
- **4 binding styles**: none / spiral / clip / staple.

### 4. Name your own templates

"Save as my template" now prompts for a name (default `original·edited`, duplicate names get a suffix).

### 5. Two rendering bugs fixed

1. **"Texture & decoration" had no visible effect.** Texture line colour was derived from *ink* luminance, so on
   the usual light paper + dark ink combination it drew white lines on white paper — 5 of 8 textures invisible.
   It now uses the *paper* luminance. The acceptance test that should have caught this was a **false pass**
   (its baseline predated a font-size change), and was rewritten to compare at a fixed font size and to require
   a return to baseline.
2. **9:16 on a narrow screen pushed the settings panel off screen.** The preview now takes a fixed ~34vh and
   the settings column always scrolls; every control and the footer stay reachable.

## Compatibility and migration

- **No settings migration**: editor setting keys are untouched.
- **Old templates keep working**: `schema` goes 2 → 3 (background and binding fields), but missing fields fall
  back to defaults on read, so 0.9.0 templates and `.lyt.json` files open as-is.
- **`file-beautify` is gone**: scripts that clicked it should use `layout → layout-open`.
- **PWA cache renamed to `lypora-v4`**: an installed PWA updates itself on next launch.

## Verification

```
tsc --noEmit       exit 0
beautify-check     pass, errors []   20 templates render / 4→5 pages on font change /
                                     texture A-B-A at fixed font size / backgrounds & binding / naming / schema 3
mobile-check       pass, errors []   5 viewports; 7 dock buttons, 9 sections / 84 rows, no overflow
i18n-check         pass, errors []   287 keys × 7 locales; runtime switch to ja survives reload
verify             pass, errors []   editor core path, settings migration, mobile toolbar
export-check       pass, errors []   Markdown / HTML / PDF export unchanged
--selftest         ok               version 0.10.0, 9 menu roots (Layout left of Settings), consoleErrors []
```

Narrow-screen probe (390×844): entering from the dock button and selecting 9:16, the preview measures
287px (=34vh), the settings column is 342px tall with 1851px of scrollable content, the 78px footer stays
in the viewport, all six sliders and the background chips accept a real click, with no horizontal overflow
and no page errors. **Not covered**: the visual
viewport after the soft keyboard or the address bar collapses on a real Android WebView / iOS Safari.

## Known limitations

Android on-device export and the desktop "Save as" dialog still need one manual confirmation; real-device
narrow screens are simulated only; uploaded background images are per-template (no shared library yet);
pagination is not balanced (a large code block can leave half a page blank).

---

## 致敬与免责 / Acknowledgement

灵感和界面参照来自 [Typora](https://typora.io)。本项目与 Typora 及其开发者无任何关联，
只是对它的一次独立、拙劣的模仿；不含其任何代码或素材，采用 MIT 协议。
模板功能的设计参考了 [md2card](https://md2card.cn/zh/editor) 的「模板即数据」思路，
但其 CSS、配色与版式均为本项目原创，未复制任何代码或素材。

Inspiration and UI reference come from [Typora](https://typora.io). This project is not affiliated with Typora
or its authors; it is an independent, rather clumsy imitation containing none of its code or assets, released
under MIT. The template feature follows the "template as data" idea seen in
[md2card](https://md2card.cn/zh/editor), but all CSS, colours and layouts here are original — no code or assets
were copied.
