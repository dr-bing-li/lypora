这一版只动**第三方主题的显示效果**，不改编辑器内核、不改模板数据格式（仍是 schema 6），
所以正文排版、导出、卡片样式连一个像素都没动。

**起因**：拿 12 套真实在用的第三方主题（组合主题包）逐套和原作者提供的 `preview.html` 并排看，
差距不是"少几个颜色"，而是"整篇版式没接上"——段落卡片、标题编号、代码块配色、表格斑马纹、
整页纸张纹理大面积缺失。查到六类原因，逐个修掉。

**一、`>` 和 `+` 在扁平行模型上一个都落不了地。**

Typora 的 `#write` 是真正的内容根，`#write > p` 是父子关系；我们的正文是 `.cm-editor > .cm-content`
下面平铺的一行一行，中间隔了两层，`>` 的左邻是页面容器 → 永不命中（green-swiss 的段落卡片整片消失）。
现在页面容器后面的 `>` 一律降级为后代；`p + p` 这种"段落间距"在扁平行模型里没有对应物，
整条丢弃并**计入统计**，而不是静默失效。

**二、同一个选择器里的容器前缀被换了两遍，表格样式全灭。**

`#write table tr th` 里两处 `#write` 都替换成 `.cm-table-widget`，得到
`​.cm-table-widget table .cm-table-widget tr th`——要求"widget 里还有 widget"，命中率 0。
12 套主题的表格全退化成浏览器默认细线框，原因都是这一条。现在同一作用域前缀在一个选择器里只留一次；
顺带把选择器拆分改成括号/引号感知，`tr:nth-child(2n + 1)` 里的空格和 `+` 不再被当组合符切碎。

**三、主题自带的基准字号被行内变量顶掉。**

我们的字号是行内 `--content-font-size`，主题写 `#write{font-size:15px}` 只改了自己，
正文行继承的仍是行内变量；更隐蔽的是 `html{font-size:11pt}`——主题整篇用 `rem`，
`html` 还是 16px，所有尺寸放大约 1.09 倍。现在这类规则会换算成倍率 `--doc-font-scale`，
字号滑块仍是在主题基准上缩放。实测三档基准：forest-latex 27.9px、green-swiss 42.75px、vercel-ceylon 37.4px。

**四、代码块是"一组行"，不是一个盒子。**

主题写 `pre.md-fences{border:1px solid}`，原样转译就变成**每一行**一圈边框（songti 每行一条横线）、
每行四个圆角、上下内边距翻倍。现在块级盒模型拆三份：左右给每一行、上边只给首行、下边只给末行，
圆角首行给上两角、末行给下两角。另外 `.CodeMirror{background:transparent!important}` 这种
"给外层去底"的规则改为只保文字层，不再把代码块自己的底色一起去掉（vercel 白底浅字）。

**五、伪元素是装饰载体，不能顺手扔。**

标题自动编号（`counter` + `::before`）、引用色条、列表圆点、H2 折角三角全靠伪元素。
现在带 `::before/::after` 的规则整条放行，并给行补定位基准（装饰不会飘到窗口左上角）；
代码块上的伪元素（三颗红绿灯圆点）重定向到首行，只画一套而不是每行一套。

**六、`inherit` 在合并行里的语义是反的。**

`blockquote p{color:inherit}` 单独看是"继承引用块颜色"，合并到扁平行后 `.md-quote-line` 本身就是那个 `<p>`，
`inherit` 会去继承正文色 → orange-drake 的引用文字和竖条一起变黑。textOnly 模式下这三个关键字必须丢。

**验收：`theme-check` 从 8 项断言扩到 13 项，12 套主题全过。**

期望值全部从主题 CSS 文本**独立推算**（`#write > p` 存在 → 期望段落有非透明底色；
`html{font-size:11pt}` → 期望 14.67px），再量实算值，容差 0.6px——不读适配层自述。

| 主题 | 底色 | 正文色 | H1 | 行宽 | 正文对比度 | 骨架对比度 |
| --- | --- | --- | --- | --- | --- | --- |
| chernobyl-blackout | 21,23,26 | 232,232,232 | 40px | 978 | 14.7 | 6.6 |
| drake-notion | 255,255,255 | 55,53,47 | 35.2px | 1190 | 12.3 | 4.4 |
| forest-latex | 255,255,255 | 54,60,66 | 27.87px | 858 | 11.2 | 4.3 |
| green-swiss | 252,249,244 | 17,17,17 | 42.75px | 964 | 12.0 | 5.6 |
| misty-konayuki | 255,253,248 | 44,62,80 | 36px | 840 | 10.8 | 3.9 |
| orange-drake | 255,255,255 | 51,51,51 | 32px | 1190 | 12.6 | 4.7 |
| rainbow-konayuki | 26,27,38 | 229,233,240 | 33.6px | 840 | 14.0 | 5.6 |
| scholar-notion | 255,255,255 | 55,53,47 | 35.2px | 858 | 12.3 | 4.4 |
| songti-academic | 250,249,245 | 43,38,33 | 29.44px | 858 | 14.2 | 3.8 |
| themeable-heart | 255,255,255 | 64,64,64 | 45.23px | 768 | 10.4 | 4.2 |
| vercel-ceylon | 255,255,255 | 23,23,23 | 37.4px | 924 | 17.9 | 5.8 |
| warm-snow | 42,39,37 | 240,235,224 | 33.6px | 840 | 12.5 | 4.3 |

切换链路同时验：导入后 `styleLen=11209`、切回内置 Night 归 0、再切回内置 Github 与基线逐像素一致
（`matchesBaseline=true`），`console errors: none`。

**明确做不到的（是模型差异，不是没修）**：`p + p` 这类块间距；跨行居中的装饰；
`display:table` 之类把正文重排的布局；远程字体与远程背景图（离线优先 + 外部输入不发请求）。
这四条也写进了帮助页「主题与兼容性」，并给了自查方法：拿主题包的 `preview.html` 与本项目并排看。

**升级**：桌面三平台覆盖安装即可；已导入的主题会用新的转译层重新生成，不需要重新导入。
安卓 versionCode 23 → 24，直接侧载覆盖。

---

## English

This release only touches **how third-party themes render**. The editor core and the template data format
(still schema 6) are unchanged, so body typography, export and card templates are pixel-identical.

**Why**: twelve real-world third-party themes (a combined theme pack) were compared side by side against
each author's own `preview.html`. The gap was not "a few missing colours" but "the whole layout never
connects" — paragraph cards, automatic heading numbering, code-block colours, table striping and paper
textures were largely missing. Six root causes, all fixed.

**1. `>` and `+` cannot land on a flat-line model.** In Typora `#write` is the real content root, so
`#write > p` is a parent/child relation. Here the body is a flat sequence of lines two levels below
`.cm-editor > .cm-content`, so the `>` never matches (green-swiss lost every paragraph card).
A `>` after the page container is now treated as a descendant; `p + p` (spacing *between* paragraphs)
has no counterpart in this model, so the rule is dropped **and counted** rather than silently vanishing.

**2. The same container prefix was substituted twice, killing every table.** `#write table tr th` turned
into `​.cm-table-widget table .cm-table-widget tr th` — "a widget inside a widget", zero matches. All twelve
themes had tables rendered as browser defaults for exactly this reason. A scope prefix now appears once per
selector, and selector splitting is bracket/quote aware so `tr:nth-child(2n + 1)` is no longer shredded.

**3. The theme's own base font size was overridden by an inline variable.** Our font size is the inline
`--content-font-size`, so `#write{font-size:15px}` only changed itself; worse, `html{font-size:11pt}` left
`html` at 16px and inflated every `rem` by ~1.09×. These now fold into a `--doc-font-scale` multiplier, and
the font-size slider scales on top of the theme baseline. Measured baselines: forest-latex 27.9px,
green-swiss 42.75px, vercel-ceylon 37.4px.

**4. A code block is a group of lines, not one box.** `pre.md-fences{border:1px solid}` translated to one
border **per line** (songti drew a rule under every line), four radii per line, doubled vertical padding.
Block box properties are now split three ways: left/right on every line, top only on the first, bottom only
on the last, with the radii split accordingly. `.CodeMirror{background:transparent!important}`-style
"clear the outer shell" rules are reduced to the text layer so they no longer wipe the block's own fill
(vercel had white text on white).

**5. Pseudo-elements carry the decoration and must not be discarded.** Automatic numbering (`counter` +
`::before`), quote bars, list bullets and the folded-corner H2 all rely on them. Rules with `::before/::after`
now pass through untouched, lines get a positioning context (decoration no longer escapes to the window
corner), and pseudo-elements on code blocks (traffic-light dots) are redirected to the first line — one set
per block instead of one per line.

**6. `inherit` means the opposite once rules are merged onto a line.** `blockquote p{color:inherit}` reads as
"inherit the quote colour", but `.md-quote-line` *is* that `<p>`, so `inherit` reaches for the body colour —
orange-drake's quote text and bar both turned black. In textOnly mode these three keywords must be dropped.

**Acceptance: `theme-check` grew from 8 assertions to 13, all twelve themes green.** Every expectation is
derived independently from the theme CSS text (`#write > p` present → paragraph must have a non-transparent
fill; `html{font-size:11pt}` → 14.67px expected), then compared against computed values with a 0.6px
tolerance — the adapter's own claims are never trusted.

| Theme | Background | Body | H1 | Width | Body contrast | Chrome contrast |
| --- | --- | --- | --- | --- | --- | --- |
| chernobyl-blackout | 21,23,26 | 232,232,232 | 40px | 978 | 14.7 | 6.6 |
| drake-notion | 255,255,255 | 55,53,47 | 35.2px | 1190 | 12.3 | 4.4 |
| forest-latex | 255,255,255 | 54,60,66 | 27.87px | 858 | 11.2 | 4.3 |
| green-swiss | 252,249,244 | 17,17,17 | 42.75px | 964 | 12.0 | 5.6 |
| misty-konayuki | 255,253,248 | 44,62,80 | 36px | 840 | 10.8 | 3.9 |
| orange-drake | 255,255,255 | 51,51,51 | 32px | 1190 | 12.6 | 4.7 |
| rainbow-konayuki | 26,27,38 | 229,233,240 | 33.6px | 840 | 14.0 | 5.6 |
| scholar-notion | 255,255,255 | 55,53,47 | 35.2px | 858 | 12.3 | 4.4 |
| songti-academic | 250,249,245 | 43,38,33 | 29.44px | 858 | 14.2 | 3.8 |
| themeable-heart | 255,255,255 | 64,64,64 | 45.23px | 768 | 10.4 | 4.2 |
| vercel-ceylon | 255,255,255 | 23,23,23 | 37.4px | 924 | 17.9 | 5.8 |
| warm-snow | 42,39,37 | 240,235,224 | 33.6px | 840 | 12.5 | 4.3 |

The switching path is verified too: after import `styleLen=11209`, switching to the built-in Night back to 0,
switching back to the built-in Github pixel-identical to the baseline (`matchesBaseline=true`), and
`console errors: none`.

**Genuinely out of reach** (a model difference, not an unfixed bug): block spacing expressed as `p + p`;
decoration spanning several lines; `display:table`-style re-layout of body text; remote fonts and remote
background images (offline-first, and untrusted input makes no requests). All four are documented in the
in-app help page *Themes and compatibility*, along with a self-check recipe: open the theme pack's own
`preview.html` next to this app and compare side by side.

**Upgrading**: overwrite on all three desktop platforms. Previously imported themes are re-translated
automatically, no re-import needed. Android versionCode 23 → 24, side-load over the old build.

<!-- DOWNLOADS -->
