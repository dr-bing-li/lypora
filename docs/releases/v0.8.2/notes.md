标志换了。Windows 的 `.exe`、macOS 的 `.icns`、Linux 的八档 hicolor、Android 的 mipmap 与启动图、浏览器的
favicon 与 PWA 图标——全部换成同一张画：一个穿着宇航服的兵马俑。

以前每端各存一套图，改一次 logo 要手工同步五个地方，必然漏一个。现在只认 `docs/images/logo-source.jpg`，
跑一次 `tools/gen-icons.py`，40 多个文件全部重算。再换 logo 是一条命令，不是一次考古。

The mark changed. The Windows `.exe`, the macOS `.icns`, the eight Linux hicolor sizes, the Android mipmaps and
splash screens, the browser favicon and the PWA icons — all now come from one drawing: a terracotta warrior in a
space suit.

Previously each platform kept its own copy of the artwork, so changing the logo meant editing five places by hand
and inevitably missing one. Now there is exactly one source, `docs/images/logo-source.jpg`, and one command,
`tools/gen-icons.py`, which re-derives 40-odd files. The next change is a command, not an excavation.

标志的来历与历史意涵写在 README 的「关于这个标志 / The mark」一节：秦并六国后的书同文、车同轨、统一度量衡，
以及《礼记》里那句「天下大同」——同一个脸孔、不同的环境。

- 全部代码、样式、图标、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.8.2-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.7 MiB | `0cfdbc0392f0fb1a5e976b8a0297d7d704ceb75d01b8818fccf72fffd4ddb7aa` |
| `lypora_0.8.2_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`）<br>System package | 80.7 MiB | `d326c4bbca4d20d032d9b023a360f9832edc8796e36424aa6a9beb370e977d7a` |
| `lypora-0.8.2-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`）<br>System package | 80.8 MiB | `917b626d6b60c47a19d647b0171fee2c3da4040e854279a4d0046a2b3d22a9d0` |
| `Lypora-0.8.2-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | 96.7 MiB | `01dc128ca223f2ffffa1f67f5a5466fe61c0095c95b7af42b587321d805ce7fa` |
| `Lypora-0.8.2-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 104.3 MiB | `4f55fdca56a858eb084d8fa3cd104d8529dbd0288769b63857ae987bb31e83a4` |
| `Lypora-0.8.2-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.7 MiB | `428f112ffce986cb6b3ef07b1c85fe7f44d4da9639880ea5dfd461f9396db41b` |
| `Lypora-0.8.2-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | 98.5 MiB | `6a2d0e6877e35e8af8fa1ce242618d1f3b2a08e1920f0be7aa54f211378e8d7d` |
| `Lypora-0.8.2-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | 102.9 MiB | `3ce0be48755af2512f06c7cba247e84a1bbae3bd373fc0a6af437d1ba629aca3` |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单<br>Checksums for every artefact | 8 条 / 8 entries | — |

**校验方法 / How to verify**

```bash
sha256sum -c SHA256SUMS.txt          # Linux
shasum -a 256 -c SHA256SUMS.txt      # macOS
```
```bat
certutil -hashfile Lypora-0.8.2-android.apk SHA256
certutil -hashfile Lypora-0.8.2-win-x64.zip SHA256
```

清单只校验**同时存在**的文件（`sha256sum -c` 缺文件会报 FAILED），所以可以先只下自己需要的那一个，
再手工比对那一行。

---

# 中文说明

## 版本信息

| 项 | 值 |
|---|---|
| 版本号 | `0.8.2` |
| 发布标签 | `v0.8.2` |
| 版本性质 | 品牌资源换代（全套图标重生成），无功能改动、无新依赖 |
| 相对版本 | `v0.8.1` |
| Android | `versionName 0.8.2` / `versionCode 12`（v0.8.1 是 11，可直接覆盖升级） |

## 本版改了什么

### 为什么换

旧标志是蓝色渐变圆角方块加三条白横杠——能看，但跟这个项目没关系。新标志是兵马俑宇航员：同一张脸，晚了
2200 年，甲胄成了压力服，俑坑成了近地轨道。继承过去，面向未来，两边都不丢。

完整的来历（书同文、车同轨、统一度量衡、天下大同）见 README 的「关于这个标志」一节，这里只记工程上的事。

### 一件重要的事：源图只有一张

`docs/images/logo-source.jpg` → `tools/gen-icons.py` → 40 多个文件。这是本版真正的改动。旧流程是每端各存
一套，改一次漏一次；新流程是单源派生，漏不了。

产物清单：

| 平台 | 产物 | 处理 |
|---|---|---|
| Web / PWA | `favicon-32` / `apple-touch-icon`（180） / `icon-192` / `icon-512` | 直接缩放；32px 额外锐化（`UnsharpMask` percent 90） |
| Windows | `desktop/icon.ico` | **手写 ICO 容器**，16/24/32/48/64/128/256 七档各自缩放、≤64px 单独锐化。Pillow 自带的 ICO 保存只有一档原图，缩放质量不可控 |
| macOS | `desktop/icon-mac.png` → `Lypora.icns` | 1024 画布，画面占 80.5%、圆角 22.45%（Big Sur 网格），11 档帧 |
| Linux | `usr/share/icons/hicolor/{16…512}/apps/lypora.png` | 打包时由 `make_pngs()` 从 `icon-512.png` 现算，不另外入库 |
| Android | `mipmap-*/ic_launcher{,_round,_foreground}.png` + `drawable*/splash.png` | 见下 |

### 裁切：为什么是头肩特写

源图 806×806。整幅缩到 32px 只剩一团色块，护目镜和胡须全糊；裁到 `(55,5)-(755,705)` 的 700 方框再放大到
1024，24px 下仍能认出脸和头盔，同时保留右上角星野——「在太空里」这个语境不能丢。

候选方案（整幅 / 640 方框 / 700 方框）都出过 32px 对比图，最后选 700：640 太紧，头顶盔沿被切；整幅太松，
脸只剩画面的五分之一。

### 各端的取舍

**Windows。** rcedit 只吃 ICO，而 ICO 里塞 PNG 是 Vista 之后才允许的——够用。七档全部逐帧缩放 + 逐帧锐化，
打完包再把七个 PNG 帧的中间 48 字节拿到 `Lypora.exe` 里比对，七帧全中，才算图标真写进去了。

**macOS。** 直接把满幅方图塞进 icns，Finder 里会显得比邻居大一圈。按苹果的 Big Sur 网格留 9.75% 边距、
圆角取画面边长的 22.45%，11 档帧（`icp4`…`ic14`）一张不少。

**Android。** 三套图标三种处理：

- 传统方形：满幅 + 圆角 21.5%（≤96px 再锐化一次）。
- 圆形：圆形裁切。
- 自适应前景（108dp 网格）：**满铺，不留边**。照片型图标留边会在圆形遮罩下露出一圈底色，很难看。
  背景因此从原来的线性渐变 `#2F6FEB → #1748A8` 改成纯色 `#293542`——取源图外圈像素按亮度排序的 20% 分位色，
  正好落在太空的深蓝黑上，和前景衔接无痕。（用中位色会得到 `#743C29`，一片铁锈色，因为外圈一半是锈红铠甲。）

启动图同理：深蓝底 + 居中圆角图标，图标边长取屏幕短边的 32%（第一版 26%，在真机比例下显得空）。

### 没做量化

图标是照片，`icon-512.png` 481 KB，整套 640 KB，APK 从 10.6 涨到 13.7 MiB。试过 PNG 量化压缩：96 色能把体积
砍到 125 KB，但眼睛那两团橙色发光被压成了砖红；256 色（169 KB）仍然掉饱和。**眼睛是这个标志的重点**，
所以放弃量化，保全部色彩。

### 附带修掉的一处文档 bug

README 英文段的快速开始少了开头围栏——`### Deployment` 连同下面几行一直被当成代码块渲染。顺手补回
`# 1. build the core` 与围栏。

## 验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `i18n-check.mjs` | pass（7 语言 × 9 菜单） |
| `verify.mjs` 15 步 UI 断言 | 全过 |
| `image-check.mjs` | 38/38（回归确认，与图标无关） |
| `check-package.py` | 全部通过（mac 两包 + linux 包，含权限位、符号链接、plist、前端完整性） |
| Windows `--selftest` | `ok: true`，版本 `0.8.2`，菜单 9 项，桥接 API 12 项，`consoleErrors: []` |
| exe 内图标 | ICO 七档帧逐帧在 `Lypora.exe` 中命中（16/24/32/48/64/128/256） |
| mac icns | 11 档帧齐全，`ic10` 解出 1024×1024，画面留边与圆角正确 |
| Linux 图标 | 从 `Lypora-0.8.2-linux-x64.tar.gz` 里解出 `hicolor/512x512/apps/lypora.png` 核对为新标志；暂存树 16–512 八档齐全 |
| APK | 从 APK 里解出 `mipmap-xxxhdpi-v4/ic_launcher{,_round}.png` 与 `drawable-port-xhdpi-v4/splash.png` 目视核对；`aapt2 dump badging` 确认 `versionName 0.8.2` / `versionCode 12` |
| Android 真机 | **装到 Android 14–15 手机上实测**：桌面图标、圆形图标（启动器圆形遮罩）、冷启动图均显示正常，无黑边、无拉伸、无旧蓝条残留 |

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.8.2_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.8.2-1.x86_64.rpm

# 任意发行版，免安装
chmod +x Lypora-0.8.2-linux-x64.AppImage && ./Lypora-0.8.2-linux-x64.AppImage
tar xzf Lypora-0.8.2-linux-x64.tar.gz && cd Lypora && ./install.sh
```

```bat
:: Windows：解压后保持 Lypora\ 目录完整，运行 Lypora\Lypora.exe
```

```bash
# Android：覆盖安装即可保留数据
adb install -r Lypora-0.8.2-android.apk
```

## 已知限制

- **升级后系统可能还显示旧图标**：Windows 任务栏图标缓存、Linux 桌面图标缓存、macOS Dock 都不会立刻刷新。
  注销一次、或删 `%LOCALAPPDATA%\IconCache.db` 后重启资源管理器即可。
- **32px favicon 是照片**：浏览器标签栏里能认出是人像，认不出胡须。要更小尺寸更强辨识只能另画一版简化图形，
  这一版没做。
- **自适应图标满铺**：三星 One UI 这类给图标加 25% 内边距的启动器会把脸挤小；这是满铺策略的代价，
  换成留边又会在圆形遮罩下露底，两害取轻。
- **Android 只验了一种遮罩形状**：Android 14–15 手机上桌面图标、圆形图标与冷启动图都正常；泪滴、方形等
  其它自适应遮罩形状没逐一看过。
- **Linux / macOS 仍未真机启动**：包结构与图标是静态证据；macOS 的 icns 在 Finder 里长什么样，没看过。

---

# English

## Version information

| Item | Value |
|---|---|
| Version | `0.8.2` |
| Tag | `v0.8.2` |
| Kind | Branding refresh (all icons regenerated) — no behaviour change, no new dependencies |
| Previous | `v0.8.1` |
| Android | `versionName 0.8.2` / `versionCode 12` (v0.8.1 was 11, installs as an upgrade) |

## What changed

### Why the mark changed

The old mark was a blue gradient rounded square with three white bars. Legible, but unrelated to this project.
The new one is a terracotta warrior in a space suit: the same face, 2,200 years later, armour become a pressure
suit, the burial pit become low orbit. Inherit the past, aim at the future, cancel neither.

The full story — one script, one gauge, one system of weights and measures, and the old line from the *Book of
Rites* about a world held in common — is in the README under "The mark". This file records the engineering.

### The actual change: one source image

`docs/images/logo-source.jpg` → `tools/gen-icons.py` → 40-odd files. That is the substance of this release. The old
process kept a copy per platform and missed one every time; the new one derives everything from a single file.

| Platform | Artefacts | Treatment |
|---|---|---|
| Web / PWA | `favicon-32`, `apple-touch-icon` (180), `icon-192`, `icon-512` | Straight resample; the 32px one gets an extra `UnsharpMask` (percent 90) |
| Windows | `desktop/icon.ico` | **ICO container written by hand**: seven sizes, each resampled and (≤64px) sharpened separately. Pillow's built-in ICO writer only accepts one source image, so small sizes come out mushy |
| macOS | `desktop/icon-mac.png` → `Lypora.icns` | 1024 canvas, artwork at 80.5%, corner radius 22.45% (Big Sur grid), 11 frames |
| Linux | `usr/share/icons/hicolor/{16…512}/apps/lypora.png` | Computed at packaging time by `make_pngs()` from `icon-512.png`; nothing extra stored |
| Android | `mipmap-*/ic_launcher{,_round,_foreground}.png` + `drawable*/splash.png` | See below |

### Cropping: why a head-and-shoulders crop

The source is 806×806. Scaled whole to 32px it is a smudge — no visor, no moustache. Cropping to `(55,5)-(755,705)`
and upsampling to 1024 keeps the face readable at 24px while preserving the starfield in the upper right: the "in
space" context has to survive.

Three candidates (whole image, 640 box, 700 box) were rendered at 32px and compared. 700 won: 640 clips the top of
the helmet, the whole image leaves the face occupying a fifth of the frame.

### Per-platform trade-offs

**Windows.** rcedit only accepts ICO, and PNG-in-ICO has been legal since Vista — good enough. All seven frames are
resampled and sharpened individually; after packaging, 48 bytes from the middle of each frame are searched for
inside `Lypora.exe`. Seven hits out of seven is the evidence that the icon really landed.

**macOS.** Dumping a full-bleed square into an icns makes the app look oversized next to its neighbours in Finder.
The Big Sur grid is applied instead: 9.75% margin, corner radius 22.45% of the artwork edge, all eleven frames
(`icp4`…`ic14`) present.

**Android.** Three icon sets, three treatments:

- Legacy square: full-bleed with a 21.5% corner radius (plus sharpening at ≤96px).
- Round: circular crop.
- Adaptive foreground (108dp grid): **full-bleed, no margin**. A photo icon with margins shows a ring of background
  under circular masks. The background therefore changed from the old linear gradient `#2F6FEB → #1748A8` to a flat
  `#293542` — the 20th percentile, by luminance, of the source image's border pixels. That lands on the deep blue of
  space and blends seamlessly. (The median would have produced `#743C29`, rust brown, because half the border is
  rust-coloured armour.)

The splash screen follows the same logic: deep blue background, centred rounded icon at 32% of the short edge
(the first pass used 26%, which looked empty at real phone proportions).

### No palette reduction

The icon is a photograph-like illustration: `icon-512.png` is 481 KB, the set 640 KB, and the APK grew from 10.6 to
13.7 MiB. Quantisation was tried — 96 colours gets 512px down to 125 KB, but flattens the orange glow of the eyes to
brick red; 256 colours (169 KB) still loses saturation. **The eyes are the point of this mark**, so full colour stays.

### One documentation bug fixed in passing

The English quick-start lost its opening fence, so `### Deployment` and the following lines had been rendering as a
code block. Restored `# 1. build the core` and the fence.

## Verification

| Item | Result |
|---|---|
| `tsc --noEmit` | clean |
| `i18n-check.mjs` | pass (7 locales × 9 menus) |
| `verify.mjs` (15 UI assertions) | all pass |
| `image-check.mjs` | 38/38 (regression check, unrelated to icons) |
| `check-package.py` | all pass (both macOS bundles + Linux tarball: permissions, symlinks, plist, front-end integrity) |
| Windows `--selftest` | `ok: true`, version `0.8.2`, 9 menu roots, 12 bridge APIs, `consoleErrors: []` |
| Icons inside the exe | all seven ICO frames found in `Lypora.exe` (16/24/32/48/64/128/256) |
| macOS icns | 11 frames present; `ic10` decodes to 1024×1024 with correct margin and radius |
| Linux icons | `hicolor/512x512/apps/lypora.png` extracted from `Lypora-0.8.2-linux-x64.tar.gz` and checked; eight sizes present in the staged tree |
| APK | `mipmap-xxxhdpi-v4/ic_launcher{,_round}.png` and `drawable-port-xhdpi-v4/splash.png` extracted and inspected; `aapt2 dump badging` confirms `versionName 0.8.2` / `versionCode 12` |
| Android device | **Installed on a phone running Android 14–15**: launcher icon, round icon (circular launcher mask) and splash screen all render correctly — no dark border, no stretching, no leftover blue bars |

## Installation

```bash
# Debian / Ubuntu / Deepin / Kylin
sudo apt install ./lypora_0.8.2_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.8.2-1.x86_64.rpm

# Any distribution, no install
chmod +x Lypora-0.8.2-linux-x64.AppImage && ./Lypora-0.8.2-linux-x64.AppImage
tar xzf Lypora-0.8.2-linux-x64.tar.gz && cd Lypora && ./install.sh
```

```bat
:: Windows: unzip, keep the Lypora\ folder intact, run Lypora\Lypora.exe
```

```bash
# Android: installing over the previous version keeps your data
adb install -r Lypora-0.8.2-android.apk
```

## Known limitations

- **The old icon may linger after upgrading**: Windows taskbar caches, Linux desktop caches and the macOS Dock do not
  refresh immediately. Sign out once, or delete `%LOCALAPPDATA%\IconCache.db` and restart Explorer.
- **The 32px favicon is a photo**: in a browser tab it reads as a face, not as a moustache. Better recognition at that
  size would need a separate simplified mark; this release does not have one.
- **Full-bleed adaptive icons**: launchers that add a 25% inset (Samsung's One UI, for instance) will shrink the face.
  That is the price of full-bleed; adding a margin reintroduces the background ring under circular masks.
- **Only one adaptive mask shape was checked**: on a phone running Android 14–15 the launcher icon, the round icon
  and the splash screen all render correctly. Teardrop and squircle masks were not inspected individually.
- **Linux and macOS still have not been launched on real hardware**: structure and icons are static evidence. Nobody
  has looked at that icns in Finder.

---

## 致敬与免责 / Acknowledgement

Lypora 是一个独立的 Markdown 编辑器实现，用 TypeScript + CodeMirror 6 + Electron 从零写成。
界面语言与交互习惯上明确参照了 **Typora**（一款优秀的商业 Markdown 编辑器），谨表敬意。

本项目与 Typora 及其开发者**没有任何关联**，未获得其授权或背书，也不包含其任何代码或素材。
如果你需要成熟稳定的产品，请购买正版 Typora。

Lypora is an independent Markdown editor built from scratch with TypeScript, CodeMirror 6 and Electron.
Its UI language and interaction habits deliberately reference **Typora** (an excellent commercial editor),
with respect.

This project is **not affiliated with** Typora or its developers, is not endorsed by them, and contains none of
their code or assets. If you want a mature, well-supported product, please buy Typora.
