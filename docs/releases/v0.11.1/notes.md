一个软件的界面，坏掉的地方往往不是"不能用"，而是"用着别扭"：字小了一号、按钮点不中、对比度差一点点、
手机上底栏吃掉四分之一屏。这些单看都不算 bug，凑在一起就是"这软件不太行"。

0.11.1 是一次**纯界面整改**，不动功能。做法是先把评审意见变成 **66 条可自动执行的断言**（`core/ui-check.mjs`），
再一条条改到全绿：对比度全部达到 WCAG AA（正文 7:1、次级文字 4.5:1），chrome 字号收成 11 / 12.5 / 14 / 16
四档，热区该到 24px 的到 24px、该到 44px 的到 44px，手机底栏从 153px 压到 103px、格式条 12 个按钮收成
**6 个高频 + 「更多」**且任何机型都不横向溢出，菜单面板加了 9 个分区跳转，排版面板的手机预览可以收起
（参数区占比 49% → 80%）。顺手补上了键盘焦点环、确认对话框的 `role="dialog"` / 焦点陷阱 / 焦点归还，
以及搜索面板的中文化——它原先一直显示英文，因为 CM6 的面板文案走 `EditorState.phrases` 而不是 `t()`。

A UI audit usually finds nothing broken — just a hundred things slightly wrong: a font one step too small, a
button too small to hit, contrast a hair under the line, a phone bottom bar eating a quarter of the screen.
None of them is a bug; together they read as "this thing is not quite finished".

0.11.1 is a **pure interface overhaul** with no new features. The audit was turned into **66 executable
assertions** (`core/ui-check.mjs`) first, then everything was fixed until they all pass: contrast now meets
WCAG AA everywhere (7:1 for body text, 4.5:1 for secondary), the chrome type scale is down to four steps
(11 / 12.5 / 14 / 16), hit targets are 24px where they should be and 44px where they should be, the phone
bottom chrome drops from 153px to 103px, the format bar collapses 12 buttons into **6 frequent ones + "More"**
and never overflows on any device, the menu sheet gained nine section jumps, and the mobile layout preview can
be collapsed (parameters go from 49% to 80% of the panel). It also adds a keyboard focus ring, real
`role="dialog"` semantics with a focus trap and focus restore, and a localised search panel — that one had been
showing English all along because CodeMirror's panel text comes from `EditorState.phrases`, not from `t()`.

- 全部代码、样式、模板、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.11.1-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | — | — |
| `Lypora-0.11.1-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | — | — |
| `Lypora-0.11.1-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | — | — |
| `Lypora-0.11.1-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | — | — |
| `Lypora-0.11.1-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | — | — |
| `Lypora-0.11.1-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装 | — | — |
| `lypora_0.11.1_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | — | — |
| `lypora-0.11.1-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | — | — |
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
| 版本 | **0.11.1**（补丁位，无新增功能） |
| 上一版 | 0.11.0 |
| 许可 | MIT |
| 依赖 | 无新增 |
| 配置 / 文档格式 | 未变，`localStorage` 与工作区数据向后兼容 |
| 最低系统 | Windows 10 / macOS 11 / glibc 2.31 / Android 10（API 29） |

### 为什么是 0.11.1 而不是 0.12.0

没有新功能、没有新 API、没有数据格式变化，只有"把已有的东西对齐"。这类版本对用户是"界面变好看了"，
对回归测试是"每次改动后必须仍然全绿"——按语义化版本属于补丁位。

唯一的例外是**搜索面板的文案**：它第一次真正跟随界面语言。这不是功能增加，是原先的实现漏了一条路
（见下文第三节）。

## 本版改了什么

### 一、先把"审美"变成断言：`core/ui-check.mjs`

评审意见写在文档里，改完靠肉眼确认——下一轮改动又会悄悄退回去。所以本版先做了一个常驻脚本，
**7 组 66 条断言**，`node core/ui-check.mjs` 一条命令跑完，退出码 0 / 1：

| 组 | 条数 | 验什么 |
|---|---|---|
| `contrast` | 17 | WCAG 相对亮度比，背景色向上回溯到第一个不透明祖先（不是假设背景是白的） |
| `type` | 3 | chrome 字号只允许 11 / 12.5 / 14 / 16 四档 |
| `geometry` | 19 | 留白下限、热区尺寸、箭头与文字对齐、数值列共线、页签指示条 |
| `interactive` | 10 | `Ctrl+N` 真的新建、焦点陷阱、对话框语义、搜索面板语言、无 console error |
| `layout` | 2 | 数值参数可直接键入、10 个数值右边缘跨度 ≤2px |
| `mobile` | 10 | 390×844 真机尺寸下的顶栏、底栏高度、格式条溢出、分区跳转、排版面板占比 |
| `regression` | 5 | 已经做得对的地方，改的时候别碰坏 |

跑法：`node ui-check.mjs [--only <组>] [--quiet] [--url http://…]`。探测不到 4173 会自动起
`vite preview`，跑完再关掉。产物落在 `artifacts/ui-check/<时间戳>/`：`report.json` + 每组截图。

**这一版的基线是 64 条断言、40 条失败；收官 66 条、0 条失败。**

### 二、对比度：全部达 AA，正文守住 7:1

问题不在正文（14.65:1，一直够），在"次要文字"：空状态提示、菜单快捷键、子菜单箭头、状态栏分隔符、
面板分组标题、色值输入框。它们的颜色是从父级继承来的，继承链上某一层退成了 `--fg-*` 里最弱的那个。

改法是**按语境分派**，不是一律换 `--fg-muted`：

- 侧栏内用 `--fg-side-dim`、chrome 用 `--fg-chrome-dim`、面板内用 `--fg-muted`——因为导入的第三方
  主题会分别定义这三组，一律换 `--fg-muted` 会让第三方主题的自适应失效
- `--fg-muted` 本身的两套取值也调深了：github 主题 `#6e7781 → #57606a`（6.4:1）、
  night 主题 `#868e96 → #9aa4b0`（5.5:1）

确认对话框的说明文字从 11.5px 灰字改成 12.5px 正文色（14.65:1），遮罩透明度 `.28 → .45`，
底色和面板的边界终于看得清。

### 三、字号阶梯与热区

`button` 不继承父级字号，不写 `font-size` 就吃浏览器默认的 **13.3333px**——高分屏上必然发虚。本版把
chrome 里所有漏写的补上，并把阶梯收成四档：**11 / 12.5 / 14 / 16**。小于 11px 的信息（模板卡片副标题、
分组标题）统一提到 11px，多字形按钮（`•`、`☑`、`❝`）加 `inline-flex` 居中，否则按基线对齐会偏一格。

热区按用途分：桌面菜单项 30px 高、菜单栏根按钮 28px、标签关闭按钮 24×24、状态栏开关 27~28px；
触屏格式条按钮 ≥44×40。原来 18px 的关闭按钮点在手机上基本是赌博。

### 四、手机外壳：底栏 153 → 103px

- 格式条 **12 个按钮收成 6 个高频 + 「更多」**。带 `data-overflow` 的 6 个按钮由 `buildDock` **整体搬家**
  （不是复制）进 `.tb-more` 弹出层，点任一条命令即自动收起；按钮用 `flex: 1 1 0; min-width: 0` 均分，
  实测 7 格各 52px，390px 到 767px 任何宽度都不溢出
- 顶栏左内边距 16px，右侧显示实时字数（与桌面状态栏同源，同一个 `updateCounts`）
- 正文左右留白 13 → 16px
- 菜单面板（原来是一条 5000px 的长列表）顶部加 **9 个分区 chip**：点一下平滑滚到该段并高亮，
  手动滑动时 chip 也跟着走

### 五、排版面板：手机预览可收起

手机上排版面板被切成"预览 42% / 参数 58%"，而预览里那张 A4 缩略图在 390px 宽的屏幕上看不出任何细节。
加了「收起预览 / 展开预览」：收起后参数区占比 **49% → 80%**，预览只留页码行。

### 六、键盘与语义

- 全局 `:focus-visible` 焦点环（2px accent + 2px offset），编辑器自己除外——CM6 有自己的光标绘制
- 确认对话框补 `role="dialog"` / `aria-modal="true"` / `aria-labelledby`，焦点进入时落在「保存」上，
  `Tab` / `Shift+Tab` 在三个按钮间循环，关闭后**焦点回到打开前的元素**
- `Ctrl+N` 修正为真的新建文档（原先走 `loadDocument()`，会命中"复用干净标签"的分支，连按两次还是同一个标签）
- 搜索面板 17 条文案接入 `EditorState.phrases`，跟随界面语言

### 七、其他

- 菜单里的分组标题（设置 → 界面 / 图像）改成不可点的 `.mi-group`，替代原来的两条分隔线
- 侧栏页签的选中态补 2px 指示条，不再只靠背景色区分
- 大纲缩进按层级 8px 递进（原来 12px，6 级标题会被推到屏幕外）
- 空状态加动作按钮（"打开文件夹…"、"打开文件…"），不必先去菜单里找
- 数值参数（字号、页边距、行距…）从只读的 `<span>` 改成可键入的 `<input type="number">`，
  原来只能拖滑块到 ±1 都难

## 兼容性与迁移

- 无需任何操作。设置项、主题、工作区数据、最近文件全部向后兼容
- 若你导入过第三方 Typora 主题：本版调整了 `--fg-muted` 的默认取值，主题里显式定义过的不会被覆盖
- 帮助文档的"关于"页版本号已同步到 0.11.1

## 验证

本版验收分两层：**新写的 66 条 UI 断言** + **既有的七套功能验收**，全部要求零失败。

```bash
cd core
node ui-check.mjs            # 66 条：对比度 / 字号 / 几何 / 交互 / 排版 / 手机 / 回归
node verify.mjs              # 15 步功能验收
node tabs-check.mjs          # 标签页：切标签不丢撤销栈与滚动位置
node export-check.mjs        # 导出公式
node mobile-check.mjs        # 触屏外壳
node beautify-check.mjs      # 12 套模板与参数重排
node i18n-check.mjs          # 7 种语言 × 331 键
```

`tools/closetest.mjs --exe` 跑桌面版的关闭守卫（五场景，含多标签脏文档）。

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.11.1_amd64.deb
# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.11.1-1.x86_64.rpm
# 任意发行版，免安装
chmod +x Lypora-0.11.1-linux-x64.AppImage && ./Lypora-0.11.1-linux-x64.AppImage
# Windows：解压 Lypora-0.11.1-win-x64.zip，双击 Lypora.exe
# Android：传 APK 到手机点开安装（需允许「未知来源」）
```

## 已知限制

- APK 仍是 debug 签名，可侧载、不能上架 Google Play
- 格式条上的是「6 + 更多」，不是自定义：想常驻别的按钮得改代码，暂时没有 UI 配置入口
- `ui-check` 依赖 Edge/Chromium 与 `vite preview`，纯 CI 环境需要预装浏览器
- 手机端字数只显示总字数，不显示"字词 / 字符 / 行"三分解（那三个数在桌面状态栏悬停可看）

---

# English

## Version information

| Item | Value |
|---|---|
| Version | **0.11.1** (patch; no new features) |
| Previous | 0.11.0 |
| Licence | MIT |
| Dependencies | No additions |
| Config / data format | Unchanged; `localStorage` and workspace data stay compatible |
| Minimum OS | Windows 10 / macOS 11 / glibc 2.31 / Android 10 (API 29) |

### Why 0.11.1 and not 0.12.0

No new features, no new APIs, no data-format change — only aligning what was already there. For users it is
"the interface looks better"; for regression testing it is "it must still be all green after every edit".
That is a patch by semver.

The one exception is **search panel wording**: it now actually follows the interface language. That is not a
feature — it is a path the original implementation never wired up (see section 3).

## What changed

### 1. Turning taste into assertions: `core/ui-check.mjs`

Review notes live in a document, and "looks fine now" is verified by eye — which means the next round of edits
quietly undoes it. So this release starts with a permanent script: **7 groups, 66 assertions**, one command,
exit code 0 / 1.

| Group | # | What it checks |
|---|---|---|
| `contrast` | 17 | WCAG relative luminance, walking up to the first opaque ancestor for the background |
| `type` | 3 | Chrome type scale allows only 11 / 12.5 / 14 / 16 |
| `geometry` | 19 | Gutter minimums, hit-target sizes, arrow/text alignment, numeric column alignment, tab indicator |
| `interactive` | 10 | `Ctrl+N` really creates, focus trap, dialog semantics, search-panel language, no console errors |
| `layout` | 2 | Numeric parameters accept typing; 10 values line up within 2px |
| `mobile` | 10 | Top bar, bottom-chrome height, toolbar overflow, section jumps, layout-panel split at 390×844 |
| `regression` | 5 | Things already right — don't break them |

Usage: `node ui-check.mjs [--only <group>] [--quiet] [--url http://…]`. If nothing is listening on 4173 it
starts `vite preview` itself and shuts it down afterwards. Artefacts land in `artifacts/ui-check/<timestamp>/`
(`report.json` plus per-group screenshots).

**Baseline for this release: 64 assertions, 40 failing. Final: 66 assertions, 0 failing.**

### 2. Contrast: all AA, body text held at 7:1

Body text was never the problem (14.65:1). The problem was everything *secondary*: empty-state hints, menu
shortcuts, submenu arrows, status-bar separators, panel group headings, colour-value fields. They inherited
from whichever ancestor happened to be weakest.

The fix dispatches **per context**, not "swap everything for `--fg-muted`":

- sidebar uses `--fg-side-dim`, chrome uses `--fg-chrome-dim`, panels use `--fg-muted` — imported third-party
  themes define those three separately, so collapsing them into one breaks theme adaptation
- `--fg-muted` itself moved darker in both palettes: github `#6e7781 → #57606a` (6.4:1),
  night `#868e96 → #9aa4b0` (5.5:1)

The confirm dialog's body went from 11.5px grey to 12.5px body colour (14.65:1), and its scrim from `.28`
to `.45` opacity so the panel edge is visible.

### 3. Type scale and hit targets

`button` does not inherit font size — without an explicit `font-size` it takes the UA default **13.3333px**,
which renders blurry on HiDPI. Every omission in chrome is now fixed and the scale is down to four steps:
**11 / 12.5 / 14 / 16**. Anything under 11px (template card subtitles, group headings) moved up to 11px, and
multi-glyph buttons (`•`, `☑`, `❝`) got `inline-flex` centring — baseline alignment leaves them a notch low.

Hit targets by purpose: desktop menu items 30px tall, menu-bar roots 28px, tab close 24×24, status toggles
27–28px; touch format buttons ≥44×40. The old 18px close button was a gamble to tap.

### 4. Phone chrome: 153 → 103px

- The format bar collapses **12 buttons into 6 frequent ones + "More"**. The six marked `data-overflow` are
  **moved** (not copied) into the `.tb-more` popover by `buildDock`, which closes on any command; buttons use
  `flex: 1 1 0; min-width: 0`, measured at 52px each, so nothing overflows from 390px to 767px
- Top bar gets 16px left padding and a live word count on the right (same `updateCounts` as the desktop
  status bar)
- Body gutter 13 → 16px
- The menu sheet (previously one 5000px list) gained **9 section chips**: tap to smooth-scroll and highlight,
  and the chips follow manual scrolling

### 5. Layout panel: collapsible preview on phones

On a phone the layout panel split "preview 42% / parameters 58%", and the A4 thumbnail showed nothing legible
at 390px wide. Added *Hide preview / Show preview*: parameters go from **49% to 80%** of the panel, leaving
only the pager row visible.

### 6. Keyboard and semantics

- Global `:focus-visible` ring (2px accent, 2px offset) — except the editor itself, which draws its own caret
- Confirm dialog gets `role="dialog"` / `aria-modal="true"` / `aria-labelledby`, initial focus on **Save**,
  `Tab` / `Shift+Tab` cycling inside the dialog, and **focus restored to the opener** on close
- `Ctrl+N` now really creates a document (it used to call `loadDocument()`, which hit the "reuse a clean tab"
  branch — pressing it twice left you on the same tab)
- The 17 search-panel strings go through `EditorState.phrases` and follow the interface language

### 7. Everything else

- Group headings in menus (Settings → Interface / Image) are proper non-clickable `.mi-group` rows instead of
  two separators
- Sidebar tab selection gets a 2px indicator, not just a background tint
- Outline indentation steps 8px per level (was 12px, which pushed level-6 headings off screen)
- Empty states gained action buttons ("Open folder…", "Open file…") so you don't have to hunt the menu
- Numeric parameters (font size, margin, line height…) became real `<input type="number">` fields; dragging a
  slider to an exact value used to be near-impossible

## Compatibility and migration

- Nothing to do. Settings, themes, workspace data and recent files stay compatible
- If you imported third-party Typora themes: the default `--fg-muted` moved, but values your theme defines
  explicitly are untouched
- The Help › About page now reports 0.11.1

## Verification

Two layers, both required to be green: **66 new UI assertions** plus **the seven existing functional suites**.

```bash
cd core
node ui-check.mjs            # 66: contrast / type / geometry / interaction / layout / mobile / regression
node verify.mjs              # 15 functional steps
node tabs-check.mjs          # tabs keep undo history and scroll position
node export-check.mjs        # export formulas
node mobile-check.mjs        # touch shell
node beautify-check.mjs      # 12 templates and parameter reflow
node i18n-check.mjs          # 7 locales × 331 keys
```

`tools/closetest.mjs --exe` exercises the desktop close guard (five scenarios, including multi-tab dirty docs).

## Install

```bash
# Debian / Ubuntu
sudo apt install ./lypora_0.11.1_amd64.deb
# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.11.1-1.x86_64.rpm
# Any distribution, no install
chmod +x Lypora-0.11.1-linux-x64.AppImage && ./Lypora-0.11.1-linux-x64.AppImage
# Windows: unzip Lypora-0.11.1-win-x64.zip and run Lypora.exe
# Android: copy the APK over and open it (allow unknown sources)
```

## Known limitations

- The APK is still debug-signed: sideload only, not publishable to Google Play
- The format bar is "6 + More" by design, not configurable — changing which commands stay pinned requires code
- `ui-check` needs Edge/Chromium and `vite preview`; bare CI images need a browser installed
- The phone top bar shows total characters only, not the words / characters / lines breakdown (those are in
  the desktop status-bar tooltip)

---

## 致敬 / A tribute

与 0.11.0 相同：Lypora 是对 Typora 的一次独立、笨拙但认真的模仿。它不包含 Typora 的任何代码或资源，
也不与其开发者存在任何关联。如果你喜欢 Typora，请购买它。
