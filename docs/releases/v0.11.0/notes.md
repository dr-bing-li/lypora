写东西的时候最怕两件事：一个是手滑把没存的内容关掉了，一个是想同时看两个文档却只有一个窗口。

0.11.0 把这两件事一起处理了。**标签栏**落到菜单栏下方，每个标签各自保住撤销历史和滚动位置；
**未保存一律用 `*` 标出来**（标题、标签、文件树、最近文件四处同源），关标签、关窗口都用「保存 / 不保存 /
取消」三键确认——只在该丢内容的时候才问。**多窗口**不是伪装的标签，是真的 `BrowserWindow`，
可以拖到第二块屏幕上各写各的。顺手把两处「太挤」也解了：**排版面板从对话框改成整屏**（菜单栏保留），
手机不再被挤成一条缝；**帮助从两条 toast 变成 8 篇只读文档**，中英双语，`F1` 直接打开。

Two things are frightening when you write: closing a tab by accident and losing what you typed, and wanting
two documents open at once with only one window to put them in.

0.11.0 deals with both. A **tab strip** now sits under the menu bar; every tab keeps its own undo history and
scroll position, and **unsaved work is always marked `*`** (window title, tab, file tree, recent files — one
source). Closing a tab or a window asks **Save / Don't save / Cancel**, and only when something would actually
be lost. **Multiple windows** are real `BrowserWindow`s, not disguised tabs — drop them on a second monitor and
keep writing. Two "too cramped" problems went away as well: the **layout panel is now full-screen** (the menu
bar stays) instead of a modal that squeezed phones into a sliver, and **Help became eight read-only documents**
in Chinese and English, opened with `F1`.

- 全部代码、样式、模板、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.11.0-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `7e5cce678ffa87f0ac4f94ec9ffbacae5aa974c0c2003303e908bebe190ea6e7` |
| `Lypora-0.11.0-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.7 MiB | `911172c0b0a69b5979abe4faf0bfb08bd58037b2cf4b481c77f0f9282a218d00` |
| `Lypora-0.11.0-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 98.5 MiB | `4bf783be981dd8f9a7bce2cc2acd7b06ab2ef86f3c4a463916e7be9dbf5a1ade` |
| `Lypora-0.11.0-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 102.9 MiB | `636aacc9791d94b2d270d2cc4053b8f847f6806218655feeeb95d1f6fc25ba39` |
| `Lypora-0.11.0-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 104.3 MiB | `830d0afd3477ea2794a2aa87750e06c18248d4abd1404fd78e12d23dfec5af44` |
| `Lypora-0.11.0-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装 | 96.8 MiB | `0f7d68f1a6fb3290be5951302ef9e3fc89e7ae406e088e634e81741ae64efccf` |
| `lypora_0.11.0_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | 80.9 MiB | `c2ca8339044e4c0deb352502b72016a0846f6cf350d41d82a00753c693d59884` |
| `lypora-0.11.0-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | 104.9 MiB | `8c338e27c6d076db56c1da51b430d185cbba949d954b0fd89b807f4d2792ebcb` |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单 | 发布时生成 / generated at publish | — |

Windows 与 Android 在本机构建；macOS 两件由 `tools/pack-mac.py` 本地打；Linux 四件由 CI 在打 tag 时构建。
上表的体积与校验值全部取自发布产物本身（不是手抄），逐条可用 `SHA256SUMS.txt` 复核。

The Windows and Android artefacts were built locally; the two macOS builds come from `tools/pack-mac.py`
locally, and the four Linux ones are built by CI on the tag. Every size and hash above is read back from the
published assets — verify with `SHA256SUMS.txt`.

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
| 版本 | `0.11.0`（`0.10.0` → `0.11.0`） |
| 日期 | 2026-11-12 |
| 类型 | 功能（文档模型与外壳结构调整） |
| 平台 | Windows x64 / macOS arm64+x64 / Linux x64（tar.gz / AppImage / deb / rpm）/ Android 10+ / PWA |
| Android | `versionName 0.11.0` / `versionCode 15` / `app.lypora.editor` |
| 协议 | MIT |

### 为什么是 0.11.0 而不是 0.10.1

因为改的是**文档模型**和**外壳契约**，不是某个控件的长相：

- 编辑器从「一份文档一个 state」变成「**一个标签一份 `EditorState`**」，切换走 `view.setState()`。
  这是内核级的改动，撤销历史、选区、滚动位置的生命周期都跟着变了。
- 菜单栏下方多了一条**标签栏**（手机隐藏），设置里多了**显示模式**三态，新增 `Ctrl+W` / `Ctrl+Shift+N`
  两个全局键。外壳几何变了，验收脚本、截图、文档都得跟着动。
- 排版面板从模态换成整屏——它不再是"盖住一切"的浮层，而是"占满编辑区"的一个视图。

这三条里任意一条单独出现都够 minor；一起出现就更不该藏在补丁号里。

## 本版改了什么

### 一、标签页：一个标签一份 `EditorState`

最省事的做法是切标签时把新文档的内容 `dispatch` 进同一个 state。代价是撤销历史被清掉——你在 A 文档按
`Ctrl+Z`，退到的是 B 文档的历史。这在编辑器里属于不可接受的错，所以每个标签存的是**整份 `EditorState`**：

- **撤销历史、光标、折叠、滚动位置各自独立**，切回来还是原样。
- 切标签时恢复 `scrollTop`，并**补发一个空事务**，让装饰层按新文档重算一次
  （否则图片尺寸那类缓存会停在上一个文档的值上）。
- 标签栏在菜单栏下方通栏，超宽时横向滚动；中键点标签直接关；末尾有 `+` 新建。
- **手机上整条标签栏隐藏**：一屏只装得下一个文档，多出的 34px 只会抢正文空间。

### 二、未保存标识与三键确认

- **标识是 `*`**，出现在四处且完全同源：窗口标题（`* 文档名 — Lypora`）、标签、左侧文件树、最近文件。
- **判断以磁盘为准**：`dirty = 当前内容 !== 上次落盘的快照`。所以"改了一个字又删回去"、
  "一路撤销回到保存点"，`*` 会自己消失，不需要任何额外记账。
- **关标签 / 关窗口**都会问，三键：**保存 / 不保存 / 取消**（`Enter` 保存、`Esc` 取消、点遮罩取消）。
  没改过的文档不问，直接关。
- 一次关掉多个脏标签时，确认框会**把名字一次列全**（`有 3 个文档未保存：a.md、b.md、c.md`），
  而不是一个标签弹一次框。
- 原生 `confirm()` 只有两个按钮，表达不了"取消"，所以这是自己画的框。

### 三、多窗口与三态显示模式

「设置 → 显示模式」三档：

| 模式 | 行为 |
|---|---|
| 仅标签页 | 打开文件都进当前窗口的标签栏 |
| 仅多窗口 | 每个文件开一个新窗口，可拖到第二块屏 |
| 两者并存 | 当前窗口用标签，`Ctrl+Shift+N` 另外开窗 |

- 多窗口是真的独立 `BrowserWindow`，不是把标签伪装成窗口；每个窗口有自己的关闭守卫。
- **单实例**保留：从资源管理器再点一个 `.md`，会作为**新窗口**打开，不会挤进已有窗口的标签栏。
- 浏览器标签页和 Android 壳里没有系统窗口可开，所以「仅多窗口」「两者并存」两项在那两个环境下**自动置灰**，
  不会给你一个点了没反应的开关。

### 四、排版面板改成整屏

- 面板从居中对话框改成**铺满整个编辑区**，**菜单栏保留**在顶部当它的标题区。
- 关键不是把 `max-width` 删掉，而是**顶边要动态量**：`--ce-top` 由打开时实测「菜单栏下沿 + 可见标签栏高度」
  得到，再 `inset: var(--ce-top) 0 0 0`。用 `100vh` 会在手机上把地址栏算进去，底部三个导出按钮被推出屏外；
  写死像素又会在窄屏菜单栏折行时错位。
- 窄屏（≤760px）改成一列：预览在上（约 42%），参数区在下且自己滚动。原来参数区被挤成一条缝的问题没了。

### 五、帮助改为只读文档

- 帮助不再是两条 toast，而是**8 篇真正的 Markdown 文档**，用 `F1` 或「帮助」菜单打开：
  **快捷键 / 特色功能 / 主题与兼容性 / 页面显示宽度 / 图片引用 / 排版输出 / 设置项 / 关于 Lypora**。
- **中英双语**，跟着界面语言走；正文用编译期 `?raw` 打进包内，**零网络请求**。
- 打开的是**只读标签页**：不能编辑、不算未保存、不进最近文件、不写 IndexedDB。左侧大纲照常可用，
  所以「快捷键」那一篇可以直接按分区跳。
- 只读文档还额外关掉了「光标所在行显示源码」——否则标题会挂着一个 `#`、表格会露出一排管道符。
- 内容都按**代码里的真实值**核对过：快捷键表逐个对 `shortcut:` 字段，排版一篇对 20 套模板、
  19 项参数、4 种画布、3 种分页、7 种底纹与 4 档装订。

### 六、新快捷键

| 键 | 作用 |
|---|---|
| `Ctrl+W` | 关闭当前标签（脏则三键确认） |
| `Ctrl+Shift+N` | 新窗口（仅桌面版） |
| `F1` | 打开帮助 |

## 兼容性与迁移

- **不需要迁移设置**：新增的只有 `displayMode` 一个键，缺省值是「标签页」；旧版本存的键一个没动。
- **首次启动仍是示例文档**：不想要就关掉标签（未修改不会问）。
- **菜单根仍是 9 个**：文件 / 编辑 / 段落 / 格式 / 显示 / 主题 / 排版 / 设置 / 帮助。变的是「设置」里多了
  显示模式，「帮助」里从 2 项变成 8 项。
- **PWA 缓存名升到 `lypora-v5`**：装过旧版 PWA 的会在下次打开时自动取新产物，不用手动清缓存。
- **只读标签不参与持久化**：帮助文档每次打开都是最新的内置内容，不会把你改过的旧副本翻出来。

## 验证

同一台机器（Windows 11 / Edge / Node 22.22.2），全部脚本重跑：

```
tsc --noEmit       退出码 0
tabs-check         pass = true, errors = []   标签栏 34px@y40 / 四处 `*` / 新标签独立撤销 /
                                              撤销回保存点 `*` 消失 / 取消与不保存两条关闭路径 /
                                              帮助 8 项且 contenteditable=false / 显示模式 3 项 /
                                              排版 mask.top = 菜单栏 40 + 标签栏 34，radius 0px
verify             pass = true, errors = []   编辑器主链路、设置迁移、移动端工具栏（无回归）
beautify-check     pass = true, errors = []   20 套模板出图 / 参数重排 / 模板进出 / 外部请求 0
mobile-check       pass = true, errors = []   5 种视口；底栏 7 个按钮、9 分区 84 行
i18n-check         pass = true, errors = []   308 键 × 7 语言；运行时切语言后 reload 仍是该语言
export-check       pass = true, errors = []   Markdown / HTML / PDF 导出无回归
theme-check        skipped（本机 .tmp-themes 里没有第三方 .css）
                                              适配层本次未改；内置 6 套换肤由 verify 覆盖
closetest          五场景全 PASS              含 dirty-multi：关闭时报出 names: ["功能演示.md","未命名.md"]
--selftest         ok = true                 版本 0.11.0、windows 1→2（真的开了第二个窗口，传入文件到达）、
                                              bridgeApi 含 newWindow、consoleErrors []
```

窄屏专项（390×844）：标签栏隐藏、排版面板顶边 44px（只有菜单栏）、面板 390×800、预览 282px、
参数区 389px 可滚动，底部三按钮全在屏内。

**未覆盖**：macOS / Linux 上的多窗口与 `Ctrl+Shift+N` 只做了代码路径与结构校验，没有在真机上点过
（Windows 打包版是实测的）；Android 上的标签栏隐藏是 Playwright 模拟，没有在 WebView 里逐个核对。

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.11.0_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.11.0-1.x86_64.rpm

# 任意发行版，免安装
chmod +x Lypora-0.11.0-linux-x64.AppImage && ./Lypora-0.11.0-linux-x64.AppImage

# Windows：解压 Lypora-0.11.0-win-x64.zip，双击 Lypora.exe
# Android：传 APK 到手机点开安装（需允许「未知来源」）
```

## 已知限制

- **手机上没有标签栏**：一次一个文档。想同时看两个，得用桌面版的多窗口。
- **帮助文档不能搜索**：8 篇里有大纲，但没有全文检索（`Ctrl+F` 只在文档内查找）。
- **多窗口只在 Windows 上真机验过**；macOS / Linux 沿用同一份主进程代码，但没点过。
- **标签不跨重启恢复**：关掉应用再打开，回到「一个文档」的状态（未保存内容仍然会被拦截，不会静默丢）。
- 0.10.0 的几条限制仍在：Android 真机导出、桌面「另存为」对话框需人工确认一次、背景图不跨模板复用、分页不均衡。

---

# English

## Version information

| Field | Value |
|---|---|
| Version | `0.11.0` (`0.10.0` → `0.11.0`) |
| Date | 2026-11-12 |
| Type | Features (document model and shell structure) |
| Platforms | Windows x64 / macOS arm64+x64 / Linux x64 (tar.gz / AppImage / deb / rpm) / Android 10+ / PWA |
| Android | `versionName 0.11.0` / `versionCode 15` / `app.lypora.editor` |
| Licence | MIT |

### Why 0.11.0 and not 0.10.1

Because what changed is the **document model** and the **shell contract**, not the look of a control: the editor
went from one state per app to **one `EditorState` per tab** (switching is `view.setState()`, so undo history,
selection and scroll position now have a per-tab lifetime); a **tab strip** appeared under the menu bar (hidden on
phones) along with a three-state display mode and two new global shortcuts; and the layout panel stopped being a
modal and became a view that fills the editor area. Any one of those would justify a minor bump on its own.

## What changed

### 1. Tabs: one `EditorState` per tab

The cheap way to switch tabs is to `dispatch()` the new text into the same state — which throws away undo
history, so `Ctrl+Z` in document A replays document B's history. That is not an acceptable bug in an editor, so
each tab keeps its **whole `EditorState`**: undo history, cursor, folds and scroll offset all survive a round
trip. Switching restores `scrollTop` and **dispatches one empty transaction**, so the decoration layer recomputes
against the new document (image-size caches otherwise keep the previous document's values).

The strip runs full width under the menu bar, scrolls horizontally when crowded, closes a tab on middle click and
has a `+` at the end. **On phones the strip is hidden entirely** — one document fits a screen, and the 34px would
only steal from the text.

### 2. Unsaved marks and the three-key prompt

- The mark is `*`, and it comes from **one source in four places**: window title (`* name — Lypora`), tab, file
  tree, recent files.
- **It is derived from disk**, not from an edit flag: `dirty = current text !== last saved snapshot`. Type a
  character and delete it, or undo back to the save point, and the `*` disappears by itself.
- Closing a tab or a window prompts **Save / Don't save / Cancel** (`Enter` saves, `Esc` cancels, clicking the
  backdrop cancels). Documents with no changes close silently.
- Closing several dirty tabs at once lists **all the names in one prompt**, instead of one dialog per tab.
- The native `confirm()` has two buttons and cannot express "cancel", so the dialog is drawn by us.

### 3. Real windows, three display modes

*Settings → Display mode*: **tabs only**, **windows only** (one window per file, droppable on a second monitor),
or **both**. These are genuine `BrowserWindow`s with their own close guards, not tabs pretending to be windows.
Single-instance behaviour is kept: opening a `.md` from the file manager opens a **new window** rather than
crowding into an existing window's tab strip. In a browser tab or the Android shell there are no windows to open,
so the two window modes are **greyed out** instead of being switches that do nothing.

### 4. The layout panel is full-screen

It fills the editor area and keeps the menu bar as its header. The part that actually matters is the top edge:
`--ce-top` is measured at open time (menu bar bottom + visible tab strip height) and applied as
`inset: var(--ce-top) 0 0 0`. `100vh` would include the address bar on a phone and push the three export buttons
off screen; a fixed pixel value would break when the menu bar wraps on a narrow screen. Below 760px the panel
splits into preview on top (~42%) and a scrolling parameter column — the "squeezed into a sliver" problem is gone.

### 5. Help as read-only documents

Eight real Markdown documents opened with `F1` or the Help menu: **shortcuts, features, themes and compatibility,
page width, images, layout export, settings, about**. Bilingual, following the UI language, compiled in with
`?raw` — **zero network requests**. They open as **read-only tabs**: not editable, never counted as unsaved, never
added to recent files, never written to IndexedDB. The outline still works, so the shortcuts page is navigable by
section. The "show source on the current line" behaviour is switched off for these documents — otherwise headings
would wear a `#` and tables would leak pipes. Every number in those pages was checked against the code (shortcut
table against the real `shortcut:` fields; the layout page against 20 templates, 19 parameters, 4 canvas sizes,
3 pagination modes, 7 textures and 4 bindings).

### 6. New shortcuts

`Ctrl+W` closes the current tab (with the three-key prompt if dirty), `Ctrl+Shift+N` opens a new window (desktop
only), `F1` opens Help.

## Compatibility and migration

- **No settings migration**: the only new key is `displayMode`, defaulting to tabs; existing keys are untouched.
- **The sample document is still the first launch**: close the tab if you don't want it (unmodified tabs close
  without asking).
- **Still 9 menu roots**: File / Edit / Paragraph / Format / View / Theme / Layout / Settings / Help. Settings
  gained the display mode, Help went from 2 items to 8.
- **PWA cache renamed to `lypora-v5`**: an installed PWA picks up the new bundle on next launch.
- **Read-only tabs are not persisted**: help always opens the current built-in text, never a stale copy.

## Verification

```
tsc --noEmit       exit 0
tabs-check         pass, errors []   34px strip at y=40 / `*` in all four places / per-tab undo /
                                     `*` clears when undone to the save point / cancel vs discard /
                                     8 help docs with contenteditable=false / 3 display modes /
                                     layout top = menubar 40 + tabbar 34, radius 0
verify             pass, errors []   editor core path, settings migration, mobile toolbar (no regression)
beautify-check     pass, errors []   20 templates render / re-pagination / template I/O / zero external requests
mobile-check       pass, errors []   5 viewports; 7 dock buttons, 9 sections / 84 rows
i18n-check         pass, errors []   308 keys × 7 locales; runtime switch survives reload
export-check       pass, errors []   Markdown / HTML / PDF export unchanged
theme-check        skipped (no third-party .css on this machine)
                                     unchanged this release; the 6 built-ins are covered by verify
closetest          5/5 PASS          incl. dirty-multi: names ["功能演示.md","未命名.md"] in one prompt
--selftest         ok               version 0.11.0, windows 1→2 (a second window really opened and received
                                     the file), bridgeApi has newWindow, consoleErrors []
```

Narrow screen (390×844): the strip is hidden, the layout panel starts at 44px (menu bar only), measures
390×800, preview 282px, parameter column 389px and scrollable, all three footer buttons inside the viewport.

**Not covered**: multi-window and `Ctrl+Shift+N` on macOS / Linux are code-path and structure only — no real
clicks on those platforms (the packaged Windows build is the one that was exercised). The hidden tab strip on
Android is a Playwright simulation, not a check inside the WebView.

## Known limitations

- **No tab strip on phones**: one document at a time; use the desktop build for two windows.
- **Help is not searchable**: it has outlines but no full-text search (`Ctrl+F` is in-document only).
- **Multi-window is only exercised on Windows**; macOS and Linux share the same main process but nothing was
  clicked there.
- **Tabs do not survive a restart**: relaunching gives you one document again (unsaved content is still
  intercepted, never silently dropped).
- The 0.10.0 limitations stand: Android on-device export and the desktop "Save as" dialog need one manual
  confirmation; background images are per-template; pagination is not balanced.

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
