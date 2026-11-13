0.13.0 给模板引擎加了一层**结构**而不是一堆颜色：外带、内面板、分级标题、分隔线、贴纸、表码图三态，
六组字段全部走模板数据，第 29 套模板「波普撞印」是它们的第一个使用者（带 3 个配色变体）。
一句话概括这一版的价值：**以前模板只能换纸色和引文框，现在能换"这张卡是怎么叠出来的"。**

**为什么值得为"黄边围白卡"专门做一组字段。** 那种视觉不是一条 `border`：它是卡片先铺一层亮黄纸，
再往里缩 30px 放一张白卡，白卡带 2px 墨色描边和**零模糊**的 10px 硬阴影。三件事必须在数据里分开
（带宽度、面板描边、阴影形态），否则用户调「带宽度」时会发现阴影变厚了。同理，阴影只给三个枚举值
（无 / 贴纸硬阴影 / 软阴影）而不是自由 CSS 字符串——**零模糊正是"贴纸感"的定义特征**，写自由字符串
既没法钳制，也没法在验收里断言"它真的没有模糊"。

**标题三级三样，是这套视觉的骨架。** h1 深色字 + 45° 双色斜纹下划线；h2 整行宽的蓝色块、反向倾斜 2°；
h3 是只有文字那么宽的珊瑚色块（`display: table` 收窄）。所以标题参数做成了 **h1–h4 各一套**（12 项），
不是全局一套。默认值全是"不画"，于是 28 套老模板一个像素都不会变——这条有断言守着。

**贴纸用 DOM + 内联 SVG，不用伪元素。** `::before` 被纹理占了、`::after` 被折角占了，只剩两个；
而波普需要"左上五角星 + 右上 POP! 徽标"。贴纸层是独立的 `<i class="ly-orn">`，`z-index: 6`，
四角定位 + 出血量，最多 6 枚，形状五种（五角星 / 四角星 / 爆炸 / 徽标 / 圆斑）。

**顺带修掉三个真 bug**（都不是新功能，是这轮才被逼出来的）：CSS 注释里一个裸的小于号会让整张卡片
渲染失败（`<style>` 现在包 CDATA）；缩略图只压了外带没压内面板内边距，170px 卡里正文溢出 21px；
颜色行的 `∅` 清除键放错边，把整列数值右移了 30px。

0.13.0 adds a layer of *structure* to the template engine rather than a pile of colours: an outer band, an
inner panel, per-level headings, rules, stickers, and three states each for tables/code/images — six field
groups, all pure template data. Template 29, *Pop Print*, is their first user (with three colour variants).
The value in one line: **templates used to change paper colour and quote frames; now they change how the card
is stacked.**

**Why "yellow rim around a white card" deserves its own field group.** That look is not a `border`. The card
lays down bright yellow paper, insets 30px, and puts a white panel there with a 2px ink border and a
**zero-blur** 10px hard shadow. All three must be separate in the data (band width, panel border, shadow kind),
or dragging "band width" appears to thicken the shadow. For the same reason the shadow is a three-value enum
(none / hard sticker / soft) rather than a free CSS string: **zero blur *is* the sticker look** — a free string
can neither be clamped nor asserted against.

**Three heading levels, three looks — that is the skeleton.** h1 is dark text over a 45° two-colour striped
underline; h2 is a full-width blue block rotated -2°; h3 is a coral block only as wide as its text
(`display: table`). So headings became **one set of 12 parameters per level, h1–h4**, not one global set.
Every default draws nothing, so the 28 older templates do not change by a single pixel — and an assertion
guards that.

**Stickers are DOM plus inline SVG, not pseudo-elements.** `::before` is taken by the texture and `::after`
by the folded corner — only two exist, and Pop Print needs a red star top-left plus a `POP!` badge top-right.
The sticker layer is an independent `<i class="ly-orn">` at `z-index: 6`, corner-anchored with a bleed offset,
up to six of them, in five shapes (five-point star, four-point star, burst, badge, blob).

**Three real bugs fixed on the way** (none of them new features — the work pushed them out): a bare `<` inside a
CSS comment broke the entire card render (`<style>` is CDATA now); thumbnails compressed the band but not the
panel padding, overflowing the body by 21px in a 170px card; and the colour row's `∅` clear button sat on the
wrong side, shifting the whole value column by 30px.

- 全部代码、样式、模板、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 变更明细 / What changed

### 1. schema 5「艺术层」：六组字段 / Schema 5, the art layer: six field groups

```ts
decor.panel      { band, border, radius, shadow, pad }          // 外带 + 内面板
decor.headings   { h1..h4: { bg, fg, padX, padY, radius, rotate, shadow,
                             caps, italic, align, inline, rule } }
decor.rule       { style, height, color, color2, angle }        // hr 五式
decor.ornaments  [{ shape, pos, size, rotate, fill, stroke, text, bleed }]
decor.surface    { table, code, image }                          // 三态
decor.listNo     'plain' | 'circle' | 'square'
tokens           + panelBg（面板底色，空串=不铺底） + patternInk（纹理色，空串=按纸色亮度算）
```

模板编译只输出 CSS 变量与固定选择器（`--c-band` / `--c-panel-*` / `--hN-*` / `--c-rule*` / `[data-tbl]` /
`[data-pre]` / `[data-pic]`），**没有一处允许模板写任意 CSS**。样式包因此无法注入样式。

Compilation still emits variables and fixed selectors only — no template can write arbitrary CSS, so a style
package cannot inject styles.

### 2. 第 29 套「波普撞印」+ 3 个配色变体 / Template 29 *Pop Print*, plus three colour variants

亮黄 `#fde041` 点阵纸 + 30px 外带 + 白卡硬阴影；h1 斜纹下划线、h2 蓝块 -2°、h3 珊瑚行内色块；
45° 双色斜纹分隔线；左上红色五角星、右上蓝色 `POP!` 徽标；`★` 项目符号；圆形有序序号。
变体（粉蓝 / 薄荷 / 紫夜）只覆盖 token，**就地改色**——点完等于把这些颜色写进当前模板，
想回去点「恢复默认」。

Bright yellow dotted paper, a 30px band, a white panel with a hard shadow; striped underline on h1, a rotated
blue block on h2, an inline coral block on h3; 45° two-colour rules; a red star top-left and a blue `POP!`
badge top-right; `★` bullets; circular ordered-list badges. The variants (pink-blue / mint / night) override
tokens only and **write into the current template**, so *Reset* is how you get the built-in palette back.

### 3. 面板：三组新控件 + 变体切换 / Panel: three new groups and a variant switch

面板 / 分级标题（四级折叠）/ 分隔线+贴纸 / 配色变体。波普这套在面板上是 **107 个可调控件**
（参数表 44 + 4 级标题 ×12 + 2 枚贴纸 ×8），比 0.12.0 的 25 个翻了四倍多。
四级标题与贴纸默认折叠，否则参数区会被拉成三屏。

Four groups. On *Pop Print* the panel carries **107 controls** (44 table rows + 4 heading levels ×12 +
2 stickers ×8), up from 25 in 0.12.0. Heading levels and stickers are collapsed by default so the parameter
column does not become three screens tall.

### 4. 缩略图：三个压缩系数 / Thumbnails: three compression factors

`--c-band-k`（外带）、`--c-pad-k`（内面板内边距）、`--o-k`（贴纸）只在缩略图里生效，模板侧全是 1。
只压带不压内边距时，170px 的缩略图里正文会溢出 21px——`beautify-check` 的「缩略图不溢出」断言就是
为这类问题准备的。

All three default to 1 on the template side and are only lowered inside thumbnails. Compressing the band but
not the padding overflowed a 170px thumbnail by 21px.

### 5. 验收：八组 → 九组 / Verification: 8 groups → 9

`beautify-check` 新增 C4「艺术层」10 条断言，**全部量预览图像的像素**，不量 CSS 中间量：

| 断言 | 实测 |
| --- | --- |
| 带宽度真的存在 | 左上角 (3,3)-(9,9) 均值 `253,224,65` = `#fde041` |
| band 30→0 面板位移 | 左边界 x `45 → 0`；设回 30 回到 45 |
| 内面板白底 + 描边 | 中心 `255,255,255`；中线描边连续墨色 2px |
| 硬阴影是 0 模糊 | 右侧连续墨色 17px，中段 40% 亮度极差 **0** |
| 三级标题三种形态 | 蓝块游程 668px / 珊瑚块 161×44 / 满行双色交替 16 行 |
| 贴纸 | 左上 140×140 内 `#ff2e63` 1846px；右上 `#51bafa` 5918px |
| 有序序号徽标 | 圆形→无：accent 少 958px、画面差异 0.85% |
| 变体只换色 | 纸色 → `224,247,250`；左边界 45 与描边 2px 都不变 |
| 分页不被破坏 | band 30 / band 0 页数同为 3 |
| 样式包往返 | `schema: 5`，`band=30`、`shadow=sticker`、2 枚贴纸、`listNo=circle` 全保留 |

其他脚本同步：`ui-check` 72 条（新增的控件没有破坏对比度、字号刻度与数值列共线）、`verify` 15 步、
`i18n-check` 7 语言 × 全键、`mobile-check`、`export-check`、`image-check` 38 条——全绿。

The new C4 group measures pixels of the preview image rather than CSS intermediates: band colour at the
top-left, panel left edge shifting 45px when band goes 30 → 0, 2px border, the hard shadow's interior
luminance spread being **0**, a 668px blue run for h2, a 161×44 coral box for h3, 16 fully-striped rows,
1846/5918 sticker pixels in the corners, a 958px accent drop when list badges are turned off, a variant that
changes colour but keeps geometry, identical page counts at band 0 and 30, and a zip round-trip that keeps
`schema: 5`.

---

## 升级须知 / Upgrade notes

模板 `schema` 4 → 5。新字段默认值全部是"不画"（`--c-band: 0`、`--c-panel-bg: transparent`、
`--c-panel-border: 0`、`--c-panel-shadow: none`），`headCss()` 对全默认的级别**直接不生成规则**，
所以 schema 4 的模板、旧的 `.zip` 样式包、localStorage 里的「我的模板」打开后与 0.12.0 逐像素一致。
id 全部沿用，没有迁移动作。

Template `schema` goes 4 → 5. Every new field defaults to "draw nothing", and `headCss()` emits no rule at all
for a level that is fully default, so schema-4 templates, old `.zip` packages and saved user templates open
pixel-identical to 0.12.0. All ids are unchanged and nothing needs migrating.

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.13.0-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.7 MiB | `44531e1bc834709ed2a82e02a6bd12592c38a4a47ae7f54ca10fa266b2b29dec` |
| `Lypora-0.13.0-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | 96.8 MiB | `8cb93105fbb09b2f8fa3554006f5e17057c0ada765de49abf06e899d59a926b1` |
| `Lypora-0.13.0-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 104.3 MiB | `38aa452be451bdd3e3f207d2e1ab42c9fa174eb2098566b9dac8c6d3d4c08cc2` |
| `Lypora-0.13.0-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 98.6 MiB | `f11ccfdd0b93384889efa831862d5897ac2aff96e4071a2e7507053b120ca883` |
| `Lypora-0.13.0-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 103.0 MiB | `7edd2abebba9ff4ac5b2818eed53c6636042e2f280155ef7ef2623ee3d8dc938` |
| `Lypora-0.13.0-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `5cc5638050255782e2cab57dce9aa4aec7a87ebdf342441f27eae8b20d95e3c0` |
| `lypora-0.13.0-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | 105.0 MiB | `1d376e39c8a93b80a786b22c29c75d24c50b497c0b252c03ed749d3e46e65816` |
| `lypora_0.13.0_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | 81.0 MiB | `1faeba550b72b11b0da2b1a2fe88494d98bb240b5024da27d07becac3a074702` |

