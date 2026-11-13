0.12.0 是排版引擎的一次**扩维**，不是打补丁：模板从 20 套到 28 套，参数从 19 项到 29 项，
模板的进出格式从单文件 `.lyt.json` 换成 `.zip` 样式包（旧格式继续能读）。同时把 0.11.2 报的两个
"调了没反应"修掉——它们的真因都不在参数上，而在渲染层。

**「圆角」看着无效，有两层原因。** 第一层：面板预览用的 `.ce-img` 写死了白底，圆角画在白底上等于没画。
第二层：导出前的 `captureCard` 为了 PDF 排版干净，把 `border-radius` 一律拉成 0，预览也走了这条路。
现在预览走透明底 + 保留圆角，只有出 PDF 时才拉平；顺带把预览出图从 320px 提到 800px——2 倍屏上
320px 的图会被拉糊，"半径 24px"在糊图里只剩 14 个像素，用户当然觉得没变。

**回形针和订书钉是形状错了，不是位置错了。** 0.11 及以前它们是用三个 CSS 边框拼出来的：`border` 加一条
透明的 `border-bottom-color`，拼出的是一个缺底的口袋。现在回形针是一条线走完的 SVG 路径——左外线下、
底部大 U、右外线上、顶部小 U、内线收在中段（初版让它画过底部 U，多出一根尾巴，看图才发现）；订书钉
是填充路径画的扁金属带，冠腿比 1:2，接近真实 24/6 钉的比例，腿根压了两个暗点表示扎进纸里。

**28 套模板的缩略图是真排版。** 原来画廊是 4 列小方块 + 三色斜切色块，28 套摆一起几乎一样。现在 3 列
横向大卡，缩略图就是这套模板真的排一张卡：`CARD_BASE_CSS` 加每套 `compileTemplate()` 的结果一次性塞进
一张 `<style>`，字号压到 `2.55cqw` 跟着卡片宽度走（手机上 2 列 176px、桌面 3 列 296px 都放得下）。
懒挂载用 `IntersectionObserver`，进视口才 `innerHTML`。

其余：顶级菜单从 9 项收到 7 项（主题并入「显示」、设置并入「文件」）；页眉页脚可自定义，支持
`{doc} {sec} {date} {page} {total}` 占位符；印章从"一个开关"扩成 4 枚预设 + 上传透明 PNG + 四角位置 + 大小；
新增引用框 5 式、项目符号 6 式、标题装饰 5 式、外边框 5 式。

0.12.0 widens the layout engine rather than patching it: templates go from 20 to 28, parameters from 19 to 29,
and the template exchange format moves from a single `.lyt.json` to a `.zip` style package (the old format still
imports). It also fixes the two "I changed it and nothing moved" reports from 0.11.2 — neither root cause was in
the parameters, both were in the render layer.

**"Corner radius does nothing" had two causes.** First, the panel preview's `.ce-img` had a hardcoded white
background, so a radius drawn on white is invisible. Second, `captureCard` zeroed `border-radius` before export to
keep PDF layout clean — and the preview went through the same call. The preview now renders transparent with real
corners and only flattens for PDF; the preview bitmap also went from 320px to 800px, because a 320px image on a
2× display is upscaled to mush, where a 24px radius survives as 14 pixels — of course nobody sees it move.

**The paperclip and staple had the wrong shape, not the wrong position.** Through 0.11 they were assembled from
three CSS borders with a transparent `border-bottom-color`, which draws an open pocket, not a clip. The paperclip
is now one continuous SVG wire path — down the left, big U at the bottom, up the right, small U at the top, inner
wire stopping mid-way (the first attempt ran it past the bottom U and left a stray tail; only the screenshot
showed it). The staple is a filled ribbon path with a 1:2 crown-to-leg ratio, close to a real 24/6 staple, with two
dark dots at the leg roots so it reads as driven into the paper.

**The 28 gallery thumbnails are real layouts.** The gallery used to be four columns of colour swatches — 28 of them
looked nearly identical. It is now three columns of landscape cards whose thumbnail is that template actually
laying out a card: `CARD_BASE_CSS` plus each `compileTemplate()` result injected into one `<style>`, type scaled to
`2.55cqw` so it fits both a 176px phone column and a 296px desktop column. Mounting is lazy via
`IntersectionObserver`.

The rest: top-level menus trimmed from 9 to 7 (theme folded into View, settings into File); header and footer text
are now editable with `{doc} {sec} {date} {page} {total}` placeholders; the stamp grew from a toggle to 4 presets +
transparent-PNG upload + corner position + size; and 5 quote styles, 6 bullet styles, 5 title marks and 5 outer
frames were added.

- 全部代码、样式、模板、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 变更明细 / What changed

### 1. 模板引擎：8 套新模板 + 5 组新装饰 / Engine: 8 new templates, 5 new decoration axes

模板的 40 来个字段里新增了 8 个 `decor.*` 与 3 个 `metrics.*` 文本字段，全部走同一张参数表，
面板自动长出控件。新模板补的是**体裁**而不是配色：作业本（朱线蓝格）、旧报纸（旧报泛黄）、
胶片（胶片定格）、黑板（黑板粉痕）、水彩（水彩晕染）、和纸（樱色和纸）、瑞士栅格（瑞士秩序）、
金属渐变（冷银鎏金）。

Twenty-odd new fields, all declared in the same parameter table, so the panel grows controls by itself.
The new templates add *genres*, not palettes: school exercise book, yellowed newspaper, film still,
chalkboard, watercolour, washi, Swiss grid, silver gradient.

### 2. 模板名统一成四字词，7 语言同调 / Four-character names across 7 languages

`素笺清墨 / 鹅黄小笺 / 铅字排印 / 夜阑星垂 …`。名字不再塞进 i18n 词表（那会造出 28×7 个用户永不修改的键），
而是放进模板自己的 `names` 字段，取值走 `templateName()`。**id 一个没动**，所以升级不丢设置。

Names live in each template's `names` field rather than the i18n dictionary (which would have added 28×7 keys
nobody ever edits), resolved through `templateName()`. **No id changed**, so upgrades keep your settings.

### 3. 样式包 `.zip` / Style packages

```
template.json   模板本体
bg.png          背景图（用到才有）
stamp.png       印章图（上传过才有）
README.txt      说明
```

图以 `@bg.png` 形式相对引用，整个包可以拷给别人。读写自己实现（`zip-read.ts`：EOCD + 中央目录 +
`DecompressionStream('deflate-raw')`），没引 jszip —— 为几十 KB 的东西加 90 KB 依赖不划算。
面板里有「下载范例包」，照着改最快。旧 `.lyt.json` 继续导入。

Images are referenced relatively (`@bg.png`) so the whole package is portable. Zip read/write is in-house
(EOCD + central directory + `DecompressionStream`) instead of pulling jszip for a 90KB dependency on a 30KB file.
There is a "download sample package" button in the panel. Legacy `.lyt.json` still imports.

### 4. 面板：3 列横向大卡 + 真排版缩略图 / Gallery: 3-column cards with real thumbnails

顺带把分组标题从 11px 提到 13px（原来的大小写大写 + 11px 太像一条分隔线）。

Group headers went from 11px uppercase to 13px — the old style read as a divider, not a heading.

### 5. 菜单瘦身：9 → 7 / Menu: 9 → 7 roots

`文件 / 编辑 / 段落 / 格式 / 显示 / 排版 / 帮助`。主题进「显示」，设置进「文件」。
`i18n-check` 与 `mobile-check` 的菜单根项断言同步改成 7 项，`ui-check` 新增 `menu-root-count`。

Themes moved under View, settings under File. The menu-root assertions in `i18n-check` and `mobile-check` were
retargeted to 7, and `ui-check` gained `menu-root-count`.

### 6. 验收 / Verification

| 脚本 | 0.11.2 | 0.12.0 |
| --- | --- | --- |
| `beautify-check` | 12 套模板 / 七组 | **28 套模板 / 八组**（新增圆角、角处理、装订、印章、缩略图、样式包往返、旧格式导入） |
| `ui-check` | 67 条 | **72 条**（新增菜单根项数 7、橱窗 3 列、分组标题 13px） |
| `verify` | 15 步 | 15 步（主题改走「显示 → 主题」二级菜单） |

`beautify-check` 的新断言量的是现象而不是中间量：圆角量的是预览图左上角第 0 行第一颗不透明像素的 x
（半径 0 → 0，半径 24 → 27）；装订量的是"画了没有"（回形针 diff 0.0045 / 订书钉 0.0013）而不是"有没有这个节点"。

The new assertions measure symptoms rather than intermediate values: the radius check scans the first opaque
pixel on row 0 of the preview (radius 0 → x=0, radius 24 → x=27), and the binding check measures pixels drawn
(clip diff 0.0045, staple 0.0013) rather than DOM nodes present.

---

## 升级须知 / Upgrade notes

模板 `schema` 3 → 4。老的 `lypora:beautify:*` 键照常读入，缺字段回落默认值，所以 schema 3 存的模板
打开后只是"新装饰都是默认值"。id 全部沿用，不受影响。

Template `schema` goes 3 → 4. Old `lypora:beautify:*` keys are read as before and missing fields fall back to
defaults, so a schema-3 template simply opens with the new decorations at their defaults. Every id is unchanged.

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.12.0-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 14.4 MiB | `1d64a7fb007da8eccfce4c48cac0852f7c65af5e24451eb0d2acf84cfe650cfe` |
| `Lypora-0.12.0-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | 96.8 MiB | `7b522f3b07cf17e96c99519d05063616e6ec50b7b1fcedbc2eb9fedd6958d99e` |
| `Lypora-0.12.0-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 104.3 MiB | `05800162542f8622cb3adab7b484140c0f9c29347bc5834bff881855fc711bde` |
| `Lypora-0.12.0-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 98.6 MiB | `db46b197ef2e19b2a60721d13de2d9094c82ab6a00c24aaa68c2d160865d6809` |
| `Lypora-0.12.0-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 103.0 MiB | `34f8135e7ce677d29c9c0d29fcdb8bda8965c8e9079f5a0d40694777b11602d9` |
| `Lypora-0.12.0-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `5cbf93555620c0a57965231665e8431bd705fb6637152236a23b04c396b60268` |
| `lypora-0.12.0-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | 105.0 MiB | `2461fbd8af9ba786dc02de285aec2e3cffb1fdbffb12840e867621f6a2c8e08c` |
| `lypora_0.12.0_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | 80.9 MiB | `1a86d09b60a1923d03f3664579a6da4e14c1d9ac19e8a1124e39dccb6c742e58` |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单（8 条）/ checksums for all 8 assets | 759 B | — |
