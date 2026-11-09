`![](./images/../img/a.png)` 这种写法，在别的编辑器里好好的，拿到这里就是一张空白框。

不是语法问题，也不是权限问题：我们从来没解析过 markdown 里的图片路径，直接把字符串塞给了 `<img>`。
浏览器按**页面地址**解析相对路径——而生产环境的页面地址是 `file:///…/dist/index.html`（安装版还在
`app.asar` 里），所以 `./img/a.png` 永远指向 dist 目录，永远 404。绝对路径"能用"只是因为它不需要基准。

这一版把基准改成**文档所在目录**，并顺带给了三种插入策略。

A relative image path that renders fine in every other editor came out as an empty box here.

The syntax was not the problem, and neither were permissions: we never resolved image paths at all — the raw
string went straight into `<img>`. Browsers resolve relative URLs against the **page** URL, and in production
that is `file:///…/dist/index.html` (inside `app.asar` for installed builds), so `./img/a.png` always pointed at
the dist directory and always 404'd. Absolute paths "worked" only because they need no base.

This release rebases relative paths on the **document's own directory**, and adds three policies for inserting
images in the first place.

- 全部代码、样式、图标、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.8.0-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 10.6 MiB | `fa69f1a401f39b374dd5f8ab5848e3fb2b1eceef44b59287cb13d182f7a1b506` |
| `lypora_0.8.0_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`）<br>System package | {{DEB_SIZE}} | `{{DEB_SHA}}` |
| `lypora-0.8.0-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`）<br>System package | {{RPM_SIZE}} | `{{RPM_SHA}}` |
| `Lypora-0.8.0-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | {{APPIMAGE_SIZE}} | `{{APPIMAGE_SHA}}` |
| `Lypora-0.8.0-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | {{TARGZ_SIZE}} | `{{TARGZ_SHA}}` |
| `Lypora-0.8.0-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.0 MiB | `c07549c630b56030dc526e29a5f88601f865006e5a856840b256415e90dd858a` |
| `Lypora-0.8.0-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | 95.9 MiB | `8c8f96627749acb3b05a0925dbb3617f813357117377b3942e85a33c45f35e4d` |
| `Lypora-0.8.0-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名）<br>`.app` bundle, ad-hoc signed | 100.3 MiB | `b89f6c851376ee07cead2f84200c8da927436123749d2dfd34ee6e27f17bff9a` |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单<br>Checksums for every artefact | 8 条 / 8 entries | — |

**校验方法 / How to verify**

```bash
sha256sum -c SHA256SUMS.txt          # Linux
shasum -a 256 -c SHA256SUMS.txt      # macOS
```
```bat
certutil -hashfile Lypora-0.8.0-android.apk SHA256
certutil -hashfile Lypora-0.8.0-win-x64.zip SHA256
```

清单只校验**同时存在**的文件（`sha256sum -c` 缺文件会报 FAILED），所以可以先只下自己需要的那一个，
再手工比对那一行。

---

# 中文说明

## 版本信息

| 项 | 值 |
|---|---|
| 版本号 | `0.8.0` |
| 发布标签 | `v0.8.0` |
| 版本性质 | 功能版（图片路径解析 + 两层设置），无新依赖 |
| 相对版本 | `v0.7.1` |
| Android | `versionName 0.8.0` / `versionCode 10`（v0.7.1 是 9，可直接覆盖升级） |

## 本版改了什么

### 现象

在 `.md` 同级目录下放一个 `img/`、`images/`、`assets/`，正文里写 `![](./img/a.png)`，实时预览里是空白
（只有 alt 文本或一个空框）。把同一张图写成 `C:/x/a.png` 就正常显示。粘贴、拖入图片则一直是好的——因为
那条路走的是 base64。

### 根因

渲染侧根本没有路径解析这一层：

```
live-preview.ts: const src = doc.sliceString(url.from, url.to)
                → new ImageWidget(src, alt, pos)
widgets.ts:     this.dom.src = this.src        // 原样赋给 <img>
```

于是相对路径由浏览器按页面 URL 解析。Electron 里页面是 `file:///…/resources/app/web/index.html`（安装版
在 `app.asar` 内，`file://` 连 asar 里的路径都能读），基准永远是**前端产物目录**，不可能是用户文档目录。
绝对路径之所以"能用"，只是因为它不需要基准。

### 改动

**一、渲染侧：基准改成文档目录**

新增 `core/src/io/image-path-core.ts`（零依赖纯函数，可单测），核心是 `resolveIn(src, docPath, env)`：

- 相对路径 → 与文档所在目录拼接、折叠 `./` 与 `../`，Electron 下转成 `file:///` 并对每段做百分号编码
  （中文、空格、`#`、`?`、`%` 都覆盖）
- `C:\x\a.png` 与 `C:/x/a.png` 都识别为绝对路径（Windows 手写反斜杠也能用）
- `data:` / `http(s):` / 协议相对 URL / 页内锚点原样放行
- Android：以应用 `Documents/Lypora` 为根，经 `Capacitor.convertFileSrc()` 转成 WebView 可读的 URL
- 浏览器 / PWA：没有文档目录这个概念，维持原行为（相对页面解析），不假装支持

渲染侧只改一行：`new ImageWidget(resolveImageSrc(src), …)`。另存为之后基准目录会变，所以保存成功后会
主动 dispatch 一个空事务，让装饰层按新目录重算。

**二、插入侧：一个开关，两种引用方式**

新增顶级菜单 **设置**（菜单栏从 8 项变 9 项），里面两项：

| 设置 | 取值 | 默认 |
|---|---|---|
| 图片引用方式（优先级最高） | 引用文件 / 内嵌 base64 | 引用文件 |
| 图片路径处理 | 拷贝到附件目录 / 保留相对路径 / 保留绝对路径 | 拷贝到附件目录 |

- **选「内嵌 base64」后，路径策略整段不生效**：不探测目录、不复制文件、不拼路径，直接把图片读成
  `data:` URI 写进正文。状态栏的三态开关仍留在原位但置灰不可点，hover 说明"当前由设置中的图片引用方式
  决定"；设置里的三个路径子项禁用，但仍可展开看到当前值。
- 状态栏右下角新增三态循环开关（`拷贝 → 相对 → 绝对 → 拷贝`），与设置菜单是同一个真源，切完弹 toast。

**三、插入管线收口**

「格式 → 图片」、`Ctrl+Shift+I`、从文件管理器拖图进窗口、移动端工具栏的插图按钮，全部走同一条管线：

- **拷贝模式**：先看正文已有的图片引用，哪个目录出现次数最多就用哪个；没有线索就找已存在的
  `assets/` → `images/` → `img/`；都没有才新建 `assets/`。
- **重名**只有真正撞上才处理，加 `YYYYMMDD-HHmmss-` 前缀，原名保留（`pic.png` → `20261109-152030-pic.png`）。
- 源图本来就在文档目录内（或子目录内）时不复制，直接写相对路径——避免"自己复制自己"。
- 文档未保存 / 只读 / 拿不到源路径（浏览器拖放、Android `content://`）时**不猜**：中止并 toast 提示，
  或降级内嵌，绝不写一个注定 404 的路径。
- Electron 取真实路径必须用 `webUtils.getPathForFile()`。Electron 32 起 `File.path` 已被移除，这是很多
  老代码静默失效的地方；主进程 `image:place` 负责目录探测、重名与 `copyFile`。

### 验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 通过 |
| `i18n-check.mjs` | pass（7 语言 × 9 菜单 × 190 键，无漏键） |
| `verify.mjs` 15 步 UI 断言 | 全过（5 条 404 是 `assets/demo.png` 的既有噪声） |
| `image-check.mjs` | **38/38** 纯函数用例（`../`、盘符反斜杠、中文/空格/井号编码、跨盘、Android、浏览器） |
| `tools/imgtest.mjs` | **24/24**，连跑两遍稳定：真启动 Electron，造文档 + 真 PNG，断言 `naturalWidth > 0`，再走完 拷贝 / 重名 / 目录内不复制 / 相对 / 绝对 / 内嵌 六条插入路径 |
| 打包后自检 `--selftest` | `ok: true`，版本 `0.8.0`，菜单 9 项含「设置」，`consoleErrors: []` |

取证链与踩坑记录见 `docs/04-验证方案.md` 的 V51 / V52 与 H27 / H28。

### 谁应该升级

- **所有在文档里用相对路径插图的人**：这是本版的目的，之前那种文档现在是空白框，升完直接正常。
- **经常从别的目录拖图进来的人**：设成「拷贝到附件目录」后，图片会自己落到文档旁边，不再是 base64
  把 `.md` 撑到几 MB。
- Android 用户：同样的渲染修复生效，但**插入图片这一段在 Android 上没有真机验证**（见下）。

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.8.0_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.8.0-1.x86_64.rpm

# 任意发行版，免安装
chmod +x Lypora-0.8.0-linux-x64.AppImage && ./Lypora-0.8.0-linux-x64.AppImage
tar xzf Lypora-0.8.0-linux-x64.tar.gz && cd Lypora && ./install.sh
```

```bat
:: Windows：解压后保持 Lypora\ 目录完整，运行 Lypora\Lypora.exe
```

```bash
# Android：覆盖安装即可保留数据
adb install -r Lypora-0.8.0-android.apk
```

## 已知限制

- **Android 插入图片未真机验证**：文件落盘走的是 Capacitor `Filesystem` + `convertFileSrc`，代码层与
  浏览器侧用例通过，但没有在设备上跑过一遍"拖图 → 落盘 → 渲染"。
- 剪贴板里直接粘贴图片仍走原来的 base64 行为，本版没有把它接进新管线。
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
| Version | `0.8.0` |
| Tag | `v0.8.0` |
| Kind | Feature release (image path resolution + two-layer settings) — no new dependencies |
| Previous | `v0.7.1` |
| Android | `versionName 0.8.0` / `versionCode 10` (v0.7.1 was 9, so it installs as an upgrade) |

## What changed

### Symptom

Put a `img/`, `images/` or `assets/` folder next to your `.md`, write `![](./img/a.png)`, and the live preview
shows an empty box. Write the same image as `C:/x/a.png` and it appears. Pasting and dragging images always
worked — those paths go through base64.

### Root cause

There was no path resolution layer at all:

```
live-preview.ts: const src = doc.sliceString(url.from, url.to)
                → new ImageWidget(src, alt, pos)
widgets.ts:     this.dom.src = this.src        // straight into <img>
```

So the browser resolved relative URLs against the page URL. In Electron the page is
`file:///…/resources/app/web/index.html` (inside `app.asar` for installed builds), so the base is always the
front-end bundle directory — never the user's document directory. Absolute paths only "worked" because they
need no base.

### Changes

**1. Rendering: rebase on the document directory**

New `core/src/io/image-path-core.ts` — zero-dependency pure functions, unit-testable — built around
`resolveIn(src, docPath, env)`:

- Relative paths are joined with the document's directory, `./` and `../` collapsed, then turned into `file:///`
  URIs with per-segment percent-encoding (CJK, spaces, `#`, `?`, `%` all covered) on Electron
- `C:\x\a.png` and `C:/x/a.png` are both recognised as absolute (hand-written backslashes included)
- `data:`, `http(s):`, protocol-relative URLs and in-page anchors pass through untouched
- Android: root is the app's `Documents/Lypora`, converted with `Capacitor.convertFileSrc()` so the WebView can
  read it
- Browser / PWA: there is no document directory, so the old behaviour is kept rather than faked

The renderer changes by one line: `new ImageWidget(resolveImageSrc(src), …)`. Because "Save As" changes the base
directory, a successful save dispatches an empty transaction so the decoration layer recomputes.

**2. Insertion: one switch, two reference modes**

A new top-level **Settings** menu (menu bar goes from 8 to 9 items) holds two entries:

| Setting | Values | Default |
|---|---|---|
| Image reference (highest priority) | Reference file / Embed base64 | Reference file |
| Image path handling | Copy into asset folder / Keep relative / Keep absolute | Copy into asset folder |

- **With "Embed base64" selected, the path policy is entirely out of the picture**: no folder probing, no file
  copying, no path building — the image is read into a `data:` URI and written into the document. The status-bar
  tri-state toggle stays where it is but is greyed out and unclickable, with a hover hint saying the reference
  mode decides; the three path items are disabled but still expandable so you can see the stored value.
- A tri-state cycle toggle sits at the right of the status bar (`copy → relative → absolute → copy`), backed by
  the same single source of truth as the menu, with a toast on each switch.

**3. One insertion pipeline**

Format → Image, `Ctrl+Shift+I`, dragging an image into the window, and the mobile toolbar button all go through
the same pipeline:

- **Copy mode** picks the folder by looking at existing image references in the document first (majority wins),
  then an existing `assets/` → `images/` → `img/`, and only then creates `assets/`.
- **Name collisions** are handled only when they actually happen: a `YYYYMMDD-HHmmss-` prefix is added and the
  original name kept (`pic.png` → `20261109-152030-pic.png`).
- If the source image already lives inside the document directory (or a subdirectory), nothing is copied — a
  relative path is written instead, so a file never duplicates itself.
- When the document is unsaved or read-only, or the real source path is unavailable (browser drag-and-drop,
  Android `content://`), it **does not guess**: it aborts with a toast, or falls back to an embedded image. It
  never writes a path that is guaranteed to 404.
- On Electron the real path must come from `webUtils.getPathForFile()` — `File.path` was removed in Electron 32,
  which is where a lot of older code silently stops working. The main process `image:place` handler owns folder
  probing, collision naming and `copyFile`.

### Verification

| Item | Result |
|---|---|
| `tsc --noEmit` | pass |
| `i18n-check.mjs` | pass (7 languages × 9 menus × 190 keys, nothing missing) |
| `verify.mjs` (15 UI assertions) | all pass (the 5 404s are the pre-existing `assets/demo.png` noise) |
| `image-check.mjs` | **38/38** pure-function cases (`../`, drive-letter backslashes, CJK/space/hash encoding, cross-drive, Android, browser) |
| `tools/imgtest.mjs` | **24/24**, stable across two consecutive runs: launches Electron for real, builds a document with a real PNG, asserts `naturalWidth > 0`, then walks all six insertion paths (copy / collision / already-inside / relative / absolute / embed) |
| Packaged `--selftest` | `ok: true`, version `0.8.0`, 9 menu roots including Settings, `consoleErrors: []` |

Evidence chain and pitfalls: `docs/04-验证方案.md`, entries V51 / V52 and H27 / H28.

### Who should upgrade

- **Anyone whose documents use relative image paths** — that is what this release is for. Those empty boxes now
  render.
- **Anyone who drags images in from other folders** — with "copy into asset folder" the image lands next to the
  document instead of inflating the `.md` with base64.
- Android users: the rendering fix applies, but **the insertion half has not been verified on a device** (below).

## Installation

The commands are unchanged from v0.7.1; see that release's notes for the long-form instructions.

## Known limitations

- **Android image insertion is not device-verified.** Writing files uses Capacitor `Filesystem` +
  `convertFileSrc`; the code path and browser-side cases pass, but "drag → write → render" was never run on
  hardware.
- Pasting an image from the clipboard still produces base64; it is not wired into the new pipeline yet.
- Browser / PWA builds cannot resolve document-relative paths (no document directory) and keep the old behaviour.
- Existing documents are not migrated: paths in the body are left exactly as written, they are simply resolved
  correctly now.
- Linux packages were installed and run inside containers but **never in a real desktop session**; macOS bundles
  have static structural evidence only and **have never been launched on a Mac**.
- deb / rpm are unsigned and there is no repository (`apt install lypora` is not a thing).
