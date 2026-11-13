0.14.0 把 md2card 剩下的四套免费样式**全部搬进内置模板库**：黑金菱纹（Art Deco）、橙光胶囊（Amber
Capsule）、青蓝流线（Cyan Flow）、米纸铅字（Cream Typewriter）。模板 **29 → 33 套**。
一句话概括这一版的价值：**上一版证明了"卡片可以叠成两层"，这一版证明了"标题可以不是字，而是一块图形"。**

**为什么这件事值得单独发一版。** 上一版（0.13.0）的 h2 已经是色块了，但只有波普一种长法：满行宽、
反向倾斜 2°。这四套的 h2 是四种完全不同的形态 —— 收窄居中的药丸、四角不对称的渐变条、只描金不铺底的
大写字、居中斜体的小字。它们逼出了六个此前没有的字段：**对角圆角**（第 1、3 角与第 2、4 角分开设）、
**块投影**（无 / 轻 / 光晕三档）、**字重**、**字距**、**前置标记**（竖条 / 菱形）与**标记色**，外加
一条**顶部通栏色条**。这七个维度进的是 schema，不是四段 CSS —— 也就是说，你随便挑一套现有模板，
都能在面板里把它们打开，不需要等作者再设计一套。

**四条样式，四种写法。** 橙光胶囊把"药丸"拆成四件事：渐变底 + 圆角 30 + 软投影 + **行内收窄**
（色块只有文字那么宽）；圆角 30 在 60px 高的块上正好等于半高，这是"真胶囊"与"圆角矩形"的分界。
青蓝流线只需要一个数就露出辨识度：`8px 24px 8px 24px` —— 一对角 8、对面 24，编译成 `a b a b`。
黑金菱纹靠满幅菱形网 + 3px 金渐变顶条，标题全大写加 3px 字距，h2 前面一枚 9px 的金色菱形（旋转 45°
的正方形）。米纸铅字最克制：纸与内卡是**两种**米色（`#f5efe0` 与 `#f8f3e3`），分隔线是点线，标题
居中、字重 400 —— 年代感全在"轻"上。

**"默认不画"这条纪律这次守得更严。** 六个新字段的默认值都是"什么都不生成"：`radiusAlt: 0` 时输出
单值圆角（不是 `a 0 a 0`）、`elev: 'none'` 时不写 `box-shadow`、`weight: 0` 时不写 `font-weight`、
`track: 0` 时不写 `letter-spacing`、`mark: 'none'` 时不加 `::before`。`isPlainHead()` 把这六项一并
纳入"全默认"判定，所以 29 套老模板的 `.ly-head` 规则条数一条没变，出图逐像素一致。

**两个反直觉的实现选择，都是为了"能断言"。**

1. **菱形网用两组 45°/−45° 的重复渐变，不用内联 SVG 贴图。** 导出时整份 CSS 会被内联进 SVG 的
   `<style>`，data URI 多一层编码就多一个"转义写错、整张卡变空白"的失效点；而且 45° 重复渐变的周期
   是沿法线量的，20px 菱形边长正好是 14px 周期，一条注释就能说清。
2. **顶部色条用独立元素 `.ly-topbar` + `[data-topbar]` 属性选择器，不用 `:has()`。** `:has` 是 2023 年
   才齐的特性，Android WebView 与旧 Edge 上会静默失效 —— 而这条色带是四套模板的共同标识，不能靠运气。

**验收这次抓到一个"险过"的假通过。** 橙光胶囊的"是否收窄"原本用逐行最长色段来量：一条 1px 的浅橙
分隔线也有 680px 宽，于是量出来的腰宽是卡宽的 84.9%（阈值 85%），险过 —— 而胶囊实际只占 **32%**。
改成"先把连续 ≥12 行的色带拼成块，再在块内取最宽行"之后，数字立刻回到 0.321；高度另用竖带法量
（色块里压着白字，逐行连续色段会被字切碎，69px 高的胶囊会被量成 18 行）。这类"量的是一个真实存在
但不相干的东西"的断言，比断言缺失更危险。

0.14.0 brings the remaining four free md2card styles into the built-in template library: *Art Deco*,
*Amber Capsule*, *Cyan Flow* and *Cream Typewriter*. Templates go **29 → 33**. The value in one line:
**the previous release proved a card can be two layers deep; this one proves a heading can stop being text
and become a shape.**

**Why this deserves its own release.** In 0.13.0 an h2 could already be a colour block, but only one way:
full width, rotated -2°. These four styles want four different shapes — a narrow centred capsule,
a gradient bar with two corners at 8px and two at 24px, gold-spaced capitals on no fill at all, and small
centred italics. They forced six fields that did not exist before: **alternate radius** (corners 1 & 3 vs
2 & 4), **block shadow** (none / soft / glow), **weight**, **tracking**, **leading mark** (bar or diamond)
with its own colour, plus a full-width **top bar**. Those seven dimensions went into the schema rather than
into four CSS blobs — which means you can switch any of them on for any existing template from the panel,
without waiting for someone to design another one.

**Four styles, four mechanisms.** Amber Capsule decomposes "capsule" into four things: gradient fill,
radius 30, soft shadow, and **inline shrink** (the block is only as wide as its text). Radius 30 on a 60px
block equals half its height — that is the line between a capsule and a rounded rectangle. Cyan Flow needs a
single number to show its identity: `8px 24px 8px 24px`, compiled from `radius` plus `radiusAlt`. Art Deco
lives on a full-page diamond lattice, a 3px gold gradient top bar, upper-case letter-spaced headings, and a
9px gold diamond (a square rotated 45°) in front of h2. Cream Typewriter is the most restrained: two
different creams (`#f5efe0` paper, `#f8f3e3` inner card), dotted rules, centred weight-400 headings — all of
its period feel comes from being *light*.

**The "default draws nothing" rule got stricter.** Every new field defaults to producing no CSS at all:
`radiusAlt: 0` emits a single-value radius (not `a 0 a 0`), `elev: 'none'` emits no `box-shadow`,
`weight: 0` emits no `font-weight`, `track: 0` emits no `letter-spacing`, `mark: 'none'` adds no `::before`.
`isPlainHead()` now includes all six in its "fully default" test, so the 29 older templates emit exactly the
same number of `.ly-head` rules and render pixel-identically.

**Two counter-intuitive implementation choices, both for the sake of assertion.**

1. **The lattice is two 45°/−45° repeating gradients, not an inline SVG tile.** The whole stylesheet is
   inlined into the SVG `<style>` on export, so every data URI is one more place where a bad escape turns the
   entire card blank; and a 45° repeating gradient measures its period along the normal, so a 20px diamond
   edge is exactly a 14px period — one comment explains it.
2. **The top bar is a real element (`.ly-topbar`) plus a `[data-topbar]` attribute selector, not `:has()`.**
   `:has` only landed everywhere in 2023; it fails silently on Android WebView and old Edge — and this bar is
   the shared identity of all four templates, not something to leave to luck.

**Verification caught one assertion that passed by luck.** Amber Capsule's "is it actually narrow" check used
the longest coloured run per row: a 1px pale-orange rule is 680px wide, so the measured waist came out at
84.9% of the card width against an 85% threshold — a pass, while the capsule really occupies **32%**. Grouping
contiguous rows into blocks (≥12 rows) and taking the widest row inside one band put the number back at 0.321;
height is measured separately by scanning a vertical strip, because white glyphs cut the run into pieces and a
69px capsule reads as 18 rows. An assertion that measures something real but irrelevant is more dangerous than
a missing assertion.

---

## 变更明细 / What changed

### 1. schema 6「样式层」：6 个标题字段 + 顶部色条 / Schema 6, the style layer

| 字段 / Field | 取值 / Values | 默认 / Default |
|---|---|---|
| `headings.*.radiusAlt` | 0–24 px（第 2、4 角） | `0`（= 四角同值） |
| `headings.*.elev` | `none` / `soft` / `glow` | `none` |
| `headings.*.weight` | 0（继承）/ 100–900 | `0` |
| `headings.*.track` | −2 – 8 px | `0` |
| `headings.*.mark` | `none` / `bar` / `diamond` | `none` |
| `headings.*.markColor` | 任意色，可空 | 空（用强调色） |
| `decor.topBar` | `{ height: 0–24, from, to }` | 全 0 / 空（不画） |

同时扩了四个枚举：纹理加 `lattice`（菱形网）、引用框加 `quotemark`（大引号）、分隔线加 `fade`（两端
透明）与 `dot`（点线）、标题下划线加 `fade` 与 `bar`（46×4px 短条，不占行高）。

Four enums were extended as well: texture gained `lattice`, quote styles gained `quotemark` (a big quotation
mark), rules gained `fade` and `dot`, and heading underlines gained `fade` and `bar`.

### 2. 四套新模板 / Four new templates

| id | 名称 | 一眼能认出的地方 |
|---|---|---|
| `deco` | 黑金菱纹 | 近黑纸 + 满幅菱形网 + 3px 金渐变顶条 + 大写字距 + 菱形标记 |
| `pillorange` | 橙光胶囊 | 12px 橙渐变顶条 + 收窄居中的橙色药丸标题 + h3 橙竖条 |
| `cyanflow` | 青蓝流线 | 蓝→红顶条 + 蓝青渐变块（四角 8/24 不对称）+ 淡蓝 h3 卡片 |
| `typograph` | 米纸铅字 | 米纸 + 亮一档的内卡 + 1px 描边 + 点线分隔 + 居中轻标题 |

### 3. 面板：12 组 / 118 个控件

`headSpecs()` 每级 12 → 18 项，新增「顶部色条」一组（高度、起色、止色）。顺带修掉一个会毁掉标题的
真 bug：下拉的 `value` 永远是字符串，而 `'0'` 是 truthy —— 选「字重：继承」原本会真的写进
`font-weight: 0`，标题直接隐形。现在 `ParamSpec.numeric` 让写回时走 `Number()`。

`headSpecs()` grows from 12 to 18 items per level, and a "Top bar" group (height, start, end) is new. A real
bug fixed along the way: an `<option value>` is always a string and `'0'` is truthy, so "weight: inherit"
used to write `font-weight: 0` and make the heading vanish. `ParamSpec.numeric` now converts on write-back.

### 4. 验收：九组 → 十组 / Verification: 9 groups → 10

新增 C5「样式层」：四套各一条像素断言 + 一条老模板回归。全部量预览图的像素，不量 CSS 中间量。

A new C5 *style layer* group: one pixel assertion per template plus a regression on the oldest one.

```
黑金菱纹   底色 10,10,10；金像素 1456；8 段竖带里 6 段有金；顶条是渐变（相对判据，不比对单一色值）
橙光胶囊   药丸 257×60px = 卡宽 32.1%（判据 15%–75%），左右离边 271/272px
青蓝流线   块内首行左右内缩 9 / 28px，差 19；顶条左蓝右红
米纸铅字   外圈 239,233,218 / 内卡 248,243,227（差 15 且非纯白）；点线交替 115 次、覆盖 47%
回归       素笺清墨：data-topbar=none、h1/h2 background-image=none、letter-spacing=normal
```

---

## 升级须知 / Upgrade notes

模板 `schema` 5 → 6。所有新字段默认"不画"，且 `headCss()` 对全默认的级别**不生成规则**，所以
schema 5 的模板、旧 `.zip` 样式包、localStorage 里的「我的模板」打开后与 0.13.0 逐像素一致。
id 全部沿用（新模板用新 id，不与任何老 id 冲突），没有迁移动作。词条 454 → 480，七语言同步。

Template `schema` goes 5 → 6. Every new field defaults to "draw nothing" and `headCss()` emits no rule for a
fully default level, so schema-5 templates, old `.zip` packages and saved user templates open
pixel-identical to 0.13.0. No id changed and nothing needs migrating. Locale keys go 454 → 480 across all
seven languages.

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.14.0-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.7 MiB | `e1fe52c141915f25f679f1fc0cac5a7583a3aee12e86ea128291b7e54ed7d5b8` |
| `Lypora-0.14.0-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | 96.8 MiB | `6153776d6fbc145cbd2a7b22c7d11dc83daef1b3542e1ea7b4bd62094096fe3c` |
| `Lypora-0.14.0-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 104.4 MiB | `527db3949eb8dc9bfeb113dfc219b2973ba47fc3e29abda7dd90392eb23992f1` |
| `Lypora-0.14.0-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 98.6 MiB | `f14c8048b27eae731a55133ec1d702f5c61e0a772005d872e693e921de82c995` |
| `Lypora-0.14.0-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 103.0 MiB | `5a17c13921423c420cbed6f1490556a7a316ca0ca802e86077ba3a630b927a9b` |
| `Lypora-0.14.0-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `db9d556a9b8eacfebee5316f7117e9ca323995bb27f1c49a6382fc8696224529` |
| `lypora-0.14.0-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | 105.0 MiB | `587856d8c43b6487bcb57121d04073e7e81b8a50e975295480dd0e7524804a94` |
| `lypora_0.14.0_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | 81.0 MiB | `ab30771a0a866da4f1fb8f131e364cd015e0d8b0902cb73b67b2b8c78da9ea39` |

