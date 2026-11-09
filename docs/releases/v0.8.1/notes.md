截图截了一半，Ctrl+V，什么也没发生。从文件管理器复制一张图粘贴进来，同样没反应。

不是快捷键坏了：`粘贴` 这条路径只读过文本剪贴板，图片从头到尾没人处理。而 v0.8.0 刚建好的那套
「复制到附件目录 / 保留相对路径 / 保留绝对路径」对粘贴完全无效——因为图片根本没进那条管线。

这一版把粘贴接进去，三种路径模式对截图和复制的图片同样生效。

Screenshot a region, hit Ctrl+V — nothing happens. Copy an image in the file manager and paste: still nothing.

The shortcut is fine: the paste path only ever read the text clipboard, and images were never handled at all.
So the whole "copy into the asset folder / keep relative / keep absolute" machinery added in v0.8.0 had no effect
on pasting, simply because pasted images never reached it.

This release wires pasting into that same pipeline, so all three path modes now apply to screenshots and
copied images too.

- 全部代码、样式、图标、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.8.1-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 10.6 MiB | `1ba559fe9a4239fce7d929504dc18282fbb7f5e96c6040f01670b1b17727029c` |
| `lypora_0.8.1_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`）<br>System package | 79.4 MiB | `5673fd86afddca7a3392fd541551ebdb09e1ed1c8a821a0ea719c46e7824e3b7` |
| `lypora-0.8.1-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`）<br>System package | 79.5 MiB | `d4e5cff9a56e1fd6daa3172713fc79b55d2226a81a904d4a53b601db7662e6a2` |
| `Lypora-0.8.1-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | 95.6 MiB | `5631b92f2a0b6a6e13beb26965283d5353036cb9a0e5fcc578cf24d192cabf09` |
| `Lypora-0.8.1-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 102.5 MiB | `71bc2aef4ea991ba75ab2450e97af86dfa64119ef9d18d7c7c27dcdaff6073f8` |
| `Lypora-0.8.1-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.1 MiB | `d7ea36ff2a88e953c9a28380f931a391f340f7288ca47a2b7a5cf2b2626e5197` |
| `Lypora-0.8.1-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | 95.9 MiB | `f387406c6064a202ea8944034fd8b62e323656b2fc734176b62f34141d3212bb` |
| `Lypora-0.8.1-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | 100.3 MiB | `b54c4c327f558ec2361fb07a65065f44aea0b7a2a70a5e38c052797d7207ac15` |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单<br>Checksums for every artefact | 8 条 / 8 entries | — |

**校验方法 / How to verify**

```bash
sha256sum -c SHA256SUMS.txt          # Linux
shasum -a 256 -c SHA256SUMS.txt      # macOS
```
```bat
certutil -hashfile Lypora-0.8.1-android.apk SHA256
certutil -hashfile Lypora-0.8.1-win-x64.zip SHA256
```

清单只校验**同时存在**的文件（`sha256sum -c` 缺文件会报 FAILED），所以可以先只下自己需要的那一个，
再手工比对那一行。

---

# 中文说明

## 版本信息

| 项 | 值 |
|---|---|
| 版本号 | `0.8.1` |
| 发布标签 | `v0.8.1` |
| 版本性质 | 补丁版（粘贴图片接入管线），无新依赖 |
| 相对版本 | `v0.8.0` |
| Android | `versionName 0.8.1` / `versionCode 11`（v0.8.0 是 10，可直接覆盖升级） |

## 本版改了什么

### 现象

三种粘贴方式，改之前全都不对：

| 操作 | 改之前 |
|---|---|
| 截图后 Ctrl+V | 什么都不发生（图片被当文本丢掉） |
| 文件管理器复制图片后 Ctrl+V | 同上 |
| 「编辑 → 粘贴」 | 只读文本剪贴板，图片一样落空 |

即使侥幸插进去了，也是一段 `data:` URI——把 `.md` 撑到几 MB，跟你在设置里选的「复制到附件目录」完全相反。

### 根因

两条都是"没接上"，不是"写错了"：

1. `pasteClipboard()` 只调 `navigator.clipboard.readText()`。
2. 键盘粘贴走 Chromium 原生行为，`clipboardData.items` 里的图片项没有人读。

更麻烦的是**位图没有磁盘路径**：截图的 `File` 不对应任何文件，`webUtils.getPathForFile()` 返回空串。
按 v0.8.0 的降级规则，这种情况一律内嵌 base64——而用户明明设的是「复制到附件目录」，这就是静默违背设置。

### 改动

**一、拦截时机：必须在 capture 阶段，且同步**

`window.addEventListener('paste', onPasteCapture, true)`。两个细节都是踩出来的：

- **必须挂 capture**：CM6 在 contenteditable 上的粘贴处理晚于捕获阶段，挂冒泡就来不及了。
- **必须同步 `preventDefault()`**：等异步逻辑（读剪贴板、复制文件）跑完再拦，CM6 早把内容插进去了。
  所以判断只做同步部分——看 `clipboardData.items` 里有没有 `kind === 'file'` 且 `type` 以 `image/` 开头的项；
  没有就原样放行，**文本粘贴不受任何影响**。

**二、位图先落盘，再进管线**

新增 IPC `clipboard:read-image`：主进程 `clipboard.readImage()` → 写进
`<temp>/lypora-clipboard/clipboard-<stamp>-<pid>.png` → 把真实路径返回给渲染层，再由 `ImageInput.srcPath`
带进管线。于是「复制到附件目录」对截图也成立。

- 临时文件**刻意不删**：`relative` / `absolute` 模式下正文引用的就是它，删了图就断。
- 像素内容默认不传（base64 是 4/3 倍体积），只有设置选了「内嵌 base64」时才带 `withData`。

**三、落盘文件名**

`image:place` 原来无脑取 `basename(srcPath)`，剪贴板落盘会得到
`clipboard-20261109-153000-1234.png` 这种运维味的名字。新增 `preferredName`：只取 `path.basename`
并过滤控制字符与 `<>:"|?*`，顺带挡掉路径穿越。现在落盘的是 `image.png`，重名才加时间戳前缀。

**四、插入位置补空行**

原来直接插在光标处，光标落在行中/行尾时图片会和既有文字粘成同一段（渲染后两张图并排、或图文挤在一起）。
现在两侧按需补 `\n\n`，图片始终自成段落。

### 验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `i18n-check.mjs` | pass（7 语言 × 9 菜单，无漏键） |
| `verify.mjs` 15 步 UI 断言 | 全过（5 条 404 是 `assets/demo.png` 的既有噪声） |
| `image-check.mjs` | **38/38** 纯函数用例（不受本版影响，回归确认） |
| `tools/imgtest.mjs` | **33/33**，连跑两遍稳定。新增 9 条粘贴断言：capture 阶段被拦截、正文写出附件目录相对路径、文件真的落盘、不退化成 base64、自成段落、纯文本 paste 仍照常插入、「编辑 → 粘贴」菜单同样走管线、**真实按键 Ctrl+V** 也被接管 |
| 打包后自检 `--selftest` | `ok: true`，版本 `0.8.1`，菜单 9 项含「设置」，桥接 API 12 项（多了 `readClipboardImage`），`consoleErrors: []` |

取证链与踩坑记录见 `docs/04-验证方案.md` 的 V53 与 H29。

### 谁应该升级

- **经常截图往文档里贴的人**：这是本版的目的。
- **希望 `.md` 不要因为插图变成几 MB 的人**：粘贴的图现在会落到附件目录，正文只留一行相对路径。
- 只粘贴文本的人：行为完全不变，可以不动。

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.8.1_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.8.1-1.x86_64.rpm

# 任意发行版，免安装
chmod +x Lypora-0.8.1-linux-x64.AppImage && ./Lypora-0.8.1-linux-x64.AppImage
tar xzf Lypora-0.8.1-linux-x64.tar.gz && cd Lypora && ./install.sh
```

```bat
:: Windows：解压后保持 Lypora\ 目录完整，运行 Lypora\Lypora.exe
```

```bash
# Android：覆盖安装即可保留数据
adb install -r Lypora-0.8.1-android.apk
```

## 已知限制

- **Android 粘贴未真机验证**：WebView 的 paste 事件给的是 `File`，没有磁盘路径，走的是
  `Filesystem` 直接写 `Documents/Lypora/<附件目录>/` 那条分支。代码层与浏览器侧用例通过，
  但没有在设备上跑过一遍"截图 → 粘贴 → 落盘 → 渲染"。
- 粘贴一张图会让渲染层多一次 IPC（主进程落到临时目录）。大图（>10 MB）会有可感知的延迟。
- **`relative` / `absolute` 模式下**，粘贴的图引用的是临时目录里的 PNG。这是模式的必然结果
  （剪贴板位图没有"原始位置"），想要稳定引用请用默认的「复制到附件目录」。
- 浏览器 / PWA 无法解析文档相对路径（没有文档目录），维持原行为。
- 旧文档不做迁移：正文里的路径原样保留，只是现在能被正确解析。
- Linux 包在容器里装过、跑过，但**没有在真实桌面会话里启动过**；macOS 包只有静态结构证据，
  **从未在真机上启动过**。
- deb / rpm 未签名，也没有软件仓库（不支持 `apt install lypora`）。

---

# English

## Version information

| Item | Value |
|---|---|
| Version | `0.8.1` |
| Tag | `v0.8.1` |
| Kind | Patch release (wire pasting into the image pipeline) — no new dependencies |
| Previous | `v0.8.0` |
| Android | `versionName 0.8.1` / `versionCode 11` (v0.8.0 was 10, installs as an upgrade) |

## What changed

### Symptom

Three ways to paste, all broken before this release:

| Action | Before |
|---|---|
| Screenshot, then Ctrl+V | Nothing at all — the image was dropped as text |
| Copy an image in a file manager, then Ctrl+V | Same |
| Edit → Paste | Read the text clipboard only; images still went nowhere |

Even when something did land, it was a `data:` URI — inflating the `.md` to several megabytes and directly
contradicting the "copy into the asset folder" setting.

### Root cause

Both paths were unwired rather than wrong:

1. `pasteClipboard()` only called `navigator.clipboard.readText()`.
2. Keyboard paste goes through Chromium's native handling, and nobody read the image entries in
   `clipboardData.items`.

The harder part is that **bitmaps have no path on disk**: a screenshot's `File` corresponds to no file, so
`webUtils.getPathForFile()` returns an empty string. Under the v0.8.0 degradation rule that meant "embed as
base64" — silently ignoring the user's chosen "copy into the asset folder".

### Changes

**1. Interception point: capture phase, and synchronous**

`window.addEventListener('paste', onPasteCapture, true)`. Both details were learned the hard way:

- **Capture is mandatory**: CM6 handles paste on its contenteditable later than the capture phase; a bubble-phase
  listener is too late.
- **`preventDefault()` must be synchronous**: waiting for the async work (read clipboard, copy file) lets CM6
  insert the content first. So the decision uses only what is available synchronously — whether
  `clipboardData.items` contains an entry with `kind === 'file'` and a `type` starting with `image/`. No image,
  no interception: **plain-text paste is untouched**.

**2. Persist the bitmap first, then reuse the pipeline**

New IPC `clipboard:read-image`: the main process calls `clipboard.readImage()`, writes
`<temp>/lypora-clipboard/clipboard-<stamp>-<pid>.png`, and returns the real path, which the renderer feeds back
through `ImageInput.srcPath`. Now "copy into the asset folder" holds for screenshots too.

- The temp file is **deliberately kept**: under `relative` / `absolute` modes the document references it, and
  deleting it would break the image.
- Pixel data is not shipped by default (base64 is 4/3 the size); `withData` is requested only when the
  "embed base64" setting is active.

**3. File name on disk**

`image:place` used to take `basename(srcPath)` blindly, which produced names like
`clipboard-20261109-153000-1234.png`. A new `preferredName` takes only `path.basename`, strips control characters
and `<>:"|?*`, and blocks path traversal as a side effect. It now writes `image.png`, with a timestamp prefix only
on collision.

**4. Blank lines around the insertion**

Inserting at the caret used to glue the image onto whatever text preceded it (two images side by side after
rendering). It now pads with `\n\n` as needed so an image always owns its own paragraph.

### Verification

| Item | Result |
|---|---|
| `tsc --noEmit` | clean |
| `i18n-check.mjs` | pass (7 locales × 9 menus, no missing keys) |
| `verify.mjs` (15 UI assertions) | all pass (the 5 404s are pre-existing `assets/demo.png` noise) |
| `image-check.mjs` | **38/38** pure-function cases (unaffected by this release; confirmed no regression) |
| `tools/imgtest.mjs` | **33/33**, stable across two consecutive runs. Nine new paste assertions: intercepted at capture phase, asset-relative path written, file really on disk, not degraded to base64, forms its own paragraph, plain-text paste still works, "Edit → Paste" menu follows the same path, and a **real Ctrl+V keypress** is intercepted too |
| Packaged `--selftest` | `ok: true`, version `0.8.1`, 9 menu roots (Settings included), 12 bridge APIs (`readClipboardImage` added), `consoleErrors: []` |

Evidence and pitfalls: `docs/04-验证方案.md`, V53 and H29.

### Who should upgrade

- **Anyone who screenshots and pastes into documents** — that is what this release is for.
- **Anyone whose `.md` files ballooned from embedded images**: pasted images now land in the asset folder and the
  document keeps a single relative path.
- Text-only users: no behaviour change; safe to skip.

## Installation

```bash
# Debian / Ubuntu / Deepin / Kylin
sudo apt install ./lypora_0.8.1_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.8.1-1.x86_64.rpm

# Any distribution, no install
chmod +x Lypora-0.8.1-linux-x64.AppImage && ./Lypora-0.8.1-linux-x64.AppImage
tar xzf Lypora-0.8.1-linux-x64.tar.gz && cd Lypora && ./install.sh
```

```bat
:: Windows: unzip, keep the Lypora\ folder intact, run Lypora\Lypora.exe
```

```bash
# Android: installing over the previous version keeps your data
adb install -r Lypora-0.8.1-android.apk
```

## Known limitations

- **Pasting on Android is not verified on a device**: the WebView's paste event yields a `File` with no path, so
  it takes the branch that writes straight into `Documents/Lypora/<asset dir>/` via `Filesystem`. Code-level and
  browser-side cases pass, but "screenshot → paste → write → render" has not been run on hardware.
- Pasting costs one extra IPC round trip (main process writes to the temp dir). Large images (>10 MB) will show a
  noticeable delay.
- Under **`relative` / `absolute` modes** a pasted image references the PNG in the temp directory — an inevitable
  consequence of the mode (a clipboard bitmap has no "original location"). Use the default "copy into the asset
  folder" if you want a stable reference.
- Browser / PWA builds cannot resolve document-relative paths (no document directory); behaviour is unchanged.
- Existing documents are not migrated: paths stay as written, they are just resolved correctly now.
- The Linux packages were installed and launched inside containers but **never in a real desktop session**;
  the macOS packages have static structural evidence only and **have never been launched on real hardware**.
- deb / rpm are unsigned and there is no package repository (`apt install lypora` is not supported).

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
