0.11.2 只改一件事：桌面端开多标签时，**菜单栏和标签条从上下两行并成一行**。顶栏高度 74px → 40px，
正文区上沿从 y=74 提到 y=40——每扇窗口多出 **34px** 的写作高度，在任何宽度下都是。手机端刻意不动：
那里标签条本来就隐藏，顶栏 44px。

修的时候踩到的坑比改的地方值钱：默认的 `flex: 0 1 auto` + `min-width: 0` 会让菜单盒缩到内容宽度以下，
而里面 `white-space: nowrap` 的菜单文字不跟着缩，于是直接画到后面的标签上（900px 实测）。所以新规矩是
**可滚动的标签条 `flex: 1 1 0`，说话的那一条恒 `flex: 0 0 auto`**。验收脚本因此加了第 67 条断言，
量的是菜单的 `scrollWidth - width`——只看顶栏高度是看不出这个故障的。

0.11.2 changes one thing: on desktop with more than one tab open, **the menu bar and the tab strip merge
into a single row**. Chrome height goes 74px → 40px, so the document starts at y=40 instead of y=74 — that is
**34px of writing area back** on every window, at every width. Phones are deliberately untouched: the strip is
hidden there and the top bar stays 44px.

The bug found while building it is worth more than the change: the default `flex: 0 1 auto` with `min-width: 0`
let the menu box shrink below its content, while the `white-space: nowrap` labels inside kept their full length
and painted straight over the tabs (reproduced at 900px). The rule is now **the scrolling strip gets
`flex: 1 1 0`; the side that must stay readable gets `flex: 0 0 auto`**. That is why `ui-check` grew to
**67 assertions** — the new one measures `scrollWidth - width` on the menus, which is the only thing that
catches it; the bar's height alone looked perfect.

- 全部代码、样式、模板、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.11.2-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `797fa7813a6ee1c6d2e9effefaa99bedf7b71bf32184cb8bbca413107bb547de` |
| `Lypora-0.11.2-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.7 MiB | `4d7cdef073c924d05bce819d1df6664cde1d4f89e41a3dca5090b058ffa30a66` |
| `Lypora-0.11.2-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 98.5 MiB | `9893bc8705aa921cb4c2318e87163ac9716aa936be935fecba2f78ea88b84e48` |
| `Lypora-0.11.2-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 102.9 MiB | `35f9e225d134343d770c40545f2d90eb8eba63552c6a531dd36199b7fd3fa938` |
| `Lypora-0.11.2-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 104.3 MiB | `339557645f66d4d51d03b2fd87b9a9150a3af85beaccba6f696f77b7f45bc4fd` |
| `Lypora-0.11.2-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装 | 96.8 MiB | `57f0a4ffc1b16b199c97ffa97877a97ffea65a02e394719bc4ec04a895865c9b` |
| `lypora_0.11.2_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | 80.9 MiB | `49de39d24d0f4874d2b45c783cb735b2b6254653f5633f9090a0679a2098bee9` |
| `lypora-0.11.2-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | 105.0 MiB | `7c5c088d18a8c5ee7d64c6ac8970a91533c590cdfeb9303b2b8afc1b522a2c49` |
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
| 版本 | **0.11.2**（补丁位，无新增功能） |
| 上一版 | 0.11.1 |
| 许可 | MIT |
| 依赖 | 无新增 |
| 配置 / 文档格式 | 未变，`localStorage` 与工作区数据向后兼容 |
| 最低系统 | Windows 10 / macOS 11 / glibc 2.31 / Android 10（API 29） |

### 为什么是 0.11.2 而不是 0.12.0

不新增功能、不新增 API、不改数据格式，只是把已有的两块 chrome 合并成一块。用户视角是"上面空了一点"，
回归视角是"67 条断言仍须全绿"。按语义化版本这是补丁位。

## 本版改了什么

### 一、菜单栏与标签条并排

原先的纵向结构是两层：

```
┌──────────────────────────────── 40px ─ 菜单栏（文件 编辑 视图 … 右侧文件名）
├──────────────────────────────── 34px ─ 标签条（文档A ×  文档B ×  +）
└──────────────────────────────────────── 正文
```

改成一层：

```
┌───────────────────────────── 40px ─────────────┐
│ 文件 编辑 视图 …   [文档A ×][文档B ×][+]  文件名  │
└────────────────────────────────────────────────┘
└──────────────────────────────────────────────── 正文（上沿 +34px）
```

`#tabbar` 从 `.app` 的直接子节点移进 `<header class="menubar">`，位置在 `.menubar-items` 与
`.menubar-right` 之间——也就是说，标签占据的是"菜单项之后、右侧信息之前"的那段剩余宽度，天然随窗口伸缩。
标签条底色改成透明、左侧加 1px 分隔线，成为顶栏的一部分而不是一块贴上去的补丁。

触发条件不变：`tabsEnabled() && tabs.length > 0 && innerWidth > 860`。单文档、关掉标签、窄窗口，三种情况
都没有标签条，顶栏仍是原来那条 40px 的菜单栏。

### 二、谁吸收挤压：`flex: 0 0 auto` 与 `flex: 1 1 0`

这是本版唯一的技术要点，也是最容易做错的一处。

第一版写完在 1440px 下看是对的。到 900px 就出事了：菜单和标签**叠在一起**，文字互相压。

原因是两层默认值叠在一起：

- `.menubar-items` 用的 `flex: 0 1 auto` + `min-width: 0`——意味着**允许收缩**，且可以缩到内容宽度以下；
- 它内部的菜单按钮是 `white-space: nowrap`——**文字不跟着缩**；
- `.tabbar` 写的是 `flex: 1 1 auto`，基准取内容宽度（约 635px），不是 0。

结果：菜单盒被压到 300 多 px，里面的文字还是按真实长度绘制，溢出自己的盒子、按绘制顺序盖在后面的
标签条上；同时标签条按 635px 的基准撑开，两者一起把顶栏顶成 963px，横向溢出整个容器。

修法是给两条边定死角色：

```css
.menubar-items { flex: 0 0 auto; }   /* 说话的那一条：永不收缩 */
.menubar-right { flex: 0 0 auto; }
.tabbar        { flex: 1 1 0; }      /* 可滚动的那一条：基准 0，宽度 = 剩下的全部 */
```

`flex: 1 1 0` 与 `flex: 1 1 auto` 的区别就在 basis：前者"剩下多少我占多少"，后者"我先按内容宽占住，
再多退少补"。标签条要的显然是前者。

窗口窄到标签放不下时，标签条在自己的盒子里横向滚动（`overflow-x: auto`，滚动条隐藏），菜单一个像素都
不让。900px 实测标签条可用宽 408px，三个标签照常切换。

### 三、顺手修掉的布局 bug

排版面板（整屏美化视图）的顶边靠一个运行时量的 `--ce-top` 定位。它原先算的是
「菜单栏 bottom + 标签条 height」——两层叠着的时候这是对的（40 + 39 = 79px）。两者并排之后这个式子
仍然照算，于是面板被往下推了 39px，上方露出正文的一条。

改成直接量 `.workspace` 的上沿：

```ts
function topOffset(): number {
  const ws = document.querySelector<HTMLElement>('.workspace')
  return Math.round(ws?.getBoundingClientRect().top ?? 0)
}
```

**"两段高度相加"这种写法，一旦两段并排就会变成多算一层。** 量的应该是结果的位置，不是过程的组成。

### 四、验收脚本 66 → 67

新增 `geometry/menu-tabs-one-row`，一条断言里量四件事：

| 量什么 | 阈值 | 防的是 |
|---|---|---|
| 标签条是否内嵌于 `.menubar` | `tabbar.parentElement = menubar` | 改回去了但没人发现 |
| 顶栏是否单行 | 高度 ≤ 48px | 悄悄换行成两行 |
| 菜单右沿到标签左沿的间距 | ≥ 4px | 重叠 |
| 菜单盒 `scrollWidth - width` | ≤ 0 | **菜单被压到内容宽以下、文字溢出** |

第四条是关键。前三条在第一版"叠字"故障里**全部通过**——因为两个盒子确实并排、高度确实只有 40px、
`getBoundingClientRect()` 算出来的间隙也是正的。真正坏掉的是"盒子里装的字比盒子宽"，
只有 `scrollWidth` 看得见。

同时把 `regression/tabbar-height`（30–38px 的整条标签条高度）改成 `regression/tab-item-height`
（单个标签 39px）——标签条并排后高度由顶栏决定，再量整条就没有意义了。

## 兼容性与迁移

- 无需任何操作。设置、主题、工作区数据、最近文件、标签会话全部向后兼容
- 第三方 Typora 主题：本版只动了 `.tabbar` 自身的底色，`--c-*` 变量一个没改，主题表现与 0.11.1 一致
- 帮助文档的"关于"页版本号已同步到 0.11.2

## 验证

```bash
cd core
node ui-check.mjs            # 67 条：对比度 / 字号 / 几何 / 交互 / 排版 / 手机 / 回归
node verify.mjs              # 15 步功能验收
node tabs-check.mjs          # 标签页：切标签不丢撤销栈与滚动位置
node export-check.mjs        # 导出公式
node mobile-check.mjs        # 触屏外壳
node beautify-check.mjs      # 12 套模板与参数重排
node i18n-check.mjs          # 7 种语言 × 331 键
```

`tools/closetest.mjs --exe` 跑桌面版的关闭守卫（五场景，含多标签脏文档）。

本轮实测的三个宽度：

| 宽度 | 顶栏高 | 标签条可用宽 | 菜单盒子溢出 | 结论 |
|---|---|---|---|---|
| 1440px | 40px | 634px | 0 | 通过 |
| 1100px | 40px | 294px | 0 | 通过 |
| 900px | 40px | 408px | 0 | 通过（标签条内部横滑） |
| 390px（手机） | 44px | 标签条 `hidden` | 0 | 与 0.11.1 逐项相同 |

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.11.2_amd64.deb
# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.11.2-1.x86_64.rpm
# 任意发行版，免安装
chmod +x Lypora-0.11.2-linux-x64.AppImage && ./Lypora-0.11.2-linux-x64.AppImage
# Windows：解压 Lypora-0.11.2-win-x64.zip，双击 Lypora.exe
# Android：传 APK 到手机点开安装（需允许「未知来源」）
```

## 已知限制

- 标签很多时（十几个）标签条会横向滚动，滚动条按设计隐藏——靠截断的文字和末尾的 `+` 判断还有没有更多
- 窄窗口下菜单项优先，标签让位：860–1000px 之间可见的标签数量会明显变少，这是有意的取舍
- 手机端仍然没有标签页，一个文档一个会话
- APK 仍是 debug 签名，可侧载、不能上架 Google Play

---

# English

## Version information

| Item | Value |
|---|---|
| Version | **0.11.2** (patch; no new features) |
| Previous | 0.11.1 |
| Licence | MIT |
| Dependencies | No additions |
| Config / data format | Unchanged; `localStorage` and workspace data stay compatible |
| Minimum OS | Windows 10 / macOS 11 / glibc 2.31 / Android 10 (API 29) |

### Why 0.11.2 and not 0.12.0

No new features, no new APIs, no data-format change — two blocks of chrome merged into one. For users it is
"there is a bit more room up top"; for regression testing it is "67 assertions must still be green".
That is a patch by semver.

## What changed

### 1. Menu bar and tab strip share a row

Before, two stacked layers:

```
┌──────────────────────────────── 40px ─ menu bar (File Edit View … filename on the right)
├──────────────────────────────── 34px ─ tab strip (Doc A ×  Doc B ×  +)
└──────────────────────────────────────── document
```

Now one layer, and the document starts 34px higher:

```
┌───────────────────────────── 40px ─────────────┐
│ File Edit View …   [Doc A ×][Doc B ×][+]  file  │
└────────────────────────────────────────────────┘
└──────────────────────────────────────────────── document
```

`#tabbar` moved out of `.app` and into `<header class="menubar">`, between `.menubar-items` and
`.menubar-right` — the strip occupies whatever width the menus leave, so it follows the window for free.
The strip's background became transparent and it got a 1px left divider, so it reads as part of the bar
rather than a patch stuck onto it.

The trigger is unchanged: `tabsEnabled() && tabs.length > 0 && innerWidth > 860`. Single document, tabs
switched off, or a narrow window — no strip at all, and the bar stays the plain 40px menu bar.

### 2. Who absorbs the squeeze: `flex: 0 0 auto` versus `flex: 1 1 0`

This is the only technical subtlety in the release, and the easiest thing to get wrong.

The first attempt looked right at 1440px. At 900px the menus and the tabs **overlapped** — text on text.

Two defaults compounded:

- `.menubar-items` was `flex: 0 1 auto` with `min-width: 0` — free to shrink, and free to shrink below its
  content width;
- its menu buttons are `white-space: nowrap` — **the text does not shrink with the box**;
- `.tabbar` was `flex: 1 1 auto`, so its basis was its content width (about 635px), not zero.

Net effect: the menu box was squeezed to ~300px while the labels still painted at full length, overflowing
their own box and drawing over the strip behind them; meanwhile the strip held a 635px basis, and together
they pushed the bar to 963px, overflowing the container.

The fix pins a role on each side:

```css
.menubar-items { flex: 0 0 auto; }   /* the side that must stay readable: never shrinks */
.menubar-right { flex: 0 0 auto; }
.tabbar        { flex: 1 1 0; }      /* the side that can scroll: basis 0, takes all the remainder */
```

The difference between `flex: 1 1 0` and `flex: 1 1 auto` is the basis: the former means "give me whatever is
left", the latter "I reserve my content width, then negotiate". A scrollable strip wants the former.

When the window gets too narrow the strip scrolls horizontally inside its own box (scrollbar hidden) and the
menus give up nothing. Measured at 900px: 408px available for the strip, three tabs still switchable.

### 3. A layout bug fixed along the way

The full-screen layout panel positions itself from a measured `--ce-top`. That value used to be
"menu bar bottom + strip height", which was correct while the two were stacked (40 + 39 = 79px). Once they
share a row the formula still ran, pushing the panel 39px too far down and leaving a strip of the document
showing above it.

It now measures the workspace's own top edge:

```ts
function topOffset(): number {
  const ws = document.querySelector<HTMLElement>('.workspace')
  return Math.round(ws?.getBoundingClientRect().top ?? 0)
}
```

**"Add the heights of the two pieces" breaks the moment the two pieces sit side by side.** Measure where the
result is, not how it is composed.

### 4. Acceptance script: 66 → 67

New `geometry/menu-tabs-one-row`, one assertion measuring four things:

| Measured | Threshold | Guards against |
|---|---|---|
| Strip nested inside `.menubar` | `tabbar.parentElement = menubar` | silently moved back |
| Bar is a single row | height ≤ 48px | quietly wrapping to two lines |
| Gap from last menu to first tab | ≥ 4px | overlap |
| Menus' `scrollWidth - width` | ≤ 0 | **menus squeezed below content width, text spilling out** |

The fourth is the point. The first three **all passed** during the actual "text on text" failure — the boxes
were genuinely side by side, the bar genuinely was 40px tall, and `getBoundingClientRect()` genuinely reported
a positive gap. What was broken was "the box holds more text than it is wide", and only `scrollWidth` sees it.

`regression/tabbar-height` (the whole strip being 30–38px tall) became `regression/tab-item-height`
(a single tab at 39px) — once the strip shares the bar's height, measuring the strip tells you nothing.

## Compatibility and migration

- Nothing to do. Settings, themes, workspace data, recent files and tab sessions stay compatible
- Third-party Typora themes: this release only touched `.tabbar`'s own background; no `--c-*` variable changed,
  so themes behave exactly as in 0.11.1
- The Help › About page now reports 0.11.2

## Verification

```bash
cd core
node ui-check.mjs            # 67: contrast / type / geometry / interaction / layout / mobile / regression
node verify.mjs              # 15 functional steps
node tabs-check.mjs          # tabs keep undo history and scroll position
node export-check.mjs        # export formulas
node mobile-check.mjs        # touch shell
node beautify-check.mjs      # 12 templates and parameter reflow
node i18n-check.mjs          # 7 locales × 331 keys
```

`tools/closetest.mjs --exe` exercises the desktop close guard (five scenarios, including multi-tab dirty docs).

Measured at three widths:

| Width | Bar height | Strip width available | Menu overflow | Result |
|---|---|---|---|---|
| 1440px | 40px | 634px | 0 | pass |
| 1100px | 40px | 294px | 0 | pass |
| 900px | 40px | 408px | 0 | pass (strip scrolls inside) |
| 390px (phone) | 44px | strip `hidden` | 0 | identical to 0.11.1, item by item |

## Install

```bash
# Debian / Ubuntu
sudo apt install ./lypora_0.11.2_amd64.deb
# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.11.2-1.x86_64.rpm
# Any distribution, no install
chmod +x Lypora-0.11.2-linux-x64.AppImage && ./Lypora-0.11.2-linux-x64.AppImage
# Windows: unzip Lypora-0.11.2-win-x64.zip and run Lypora.exe
# Android: copy the APK over and open it (allow unknown sources)
```

## Known limitations

- With many tabs (a dozen or so) the strip scrolls horizontally and the scrollbar is hidden by design — rely
  on truncated labels and the trailing `+` to tell whether there is more
- Narrow windows favour the menus: between 860 and 1000px noticeably fewer tabs are visible. That is the
  intended trade
- Phones still have no tabs — one document per session
- The APK is still debug-signed: sideload only, not publishable to Google Play

---

## 致敬 / A tribute

Lypora 是对 Typora 的一次独立、笨拙但认真的模仿。它不包含 Typora 的任何代码或资源，也不与其开发者
存在任何关联。如果你喜欢 Typora，请购买它。
