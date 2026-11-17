这一版修两个「参数在面板上、但画面改不动」的 bug，全在印章那一组。**没有新模板，模板数据格式仍是
schema 6**，新增字段缺省为空串，所以已导出的样式包与老模板的导出像素都不变。

**一、上传的印章图，在左上和右上尺寸不可调。**

上传一张透明 PNG 当印章后，左下、右下拖「印章大小」有效，左上、右上纹丝不动 —— 图按原始像素铺开，
一张 160×100 的图就画成 160×100，大图还会盖住标题。

原因是 CSS 只写了一条半边规则：`[data-pos="bl"] .ly-stamp-img, [data-pos="br"] .ly-stamp-img { max-height: … }`，
而上传分支输出的容器 `<span class="ly-stamp">` **既没有 `data-stamp` 也没有宽高**。于是四个角各走一套逻辑：
左下/右下受约束，左上/右上按原图铺开。

改法：上传分支补 `data-stamp="image"`，规则改成四角通用 `width/height: calc(stampSize × 1.1)`，
图在方框里 `object-fit: contain` 等比缩放 —— 横图竖图都不变形、不溢出，四个角同一套尺寸规则。

**二、手写签名的字写死了「签名」。**

新增 `decor.stampText`（留空 = 用预设字），面板在「印章样式」下面多一行**「印章文字」**，失焦提交。
四个预设都能改：圆印可把「阅」换掉，方印/长条可换「已阅」，手写签名填真名即可 —— 那道横线
自然成了签名下划线。

字号随字数自适应：`k = min(base, room / 字数)`，签「欧阳修文」四个字时自动收小，既不会戳出印章边框，
也不会跑出下划线外面。**只在字数超出预设长度时才写内联字号**，所以默认的「阅 / 已阅 / 签名」逐像素不变。

**验收全部量预览 PNG 的像素：**

| 项 | 实测 |
| --- | --- |
| 四角尺寸一致（size 40） | 红块面积 1344 / 1344 / 1346 / 1345 |
| 四角同步放大（size 120） | 12757 / 12743 / 12727 / 12725（≈9.5 倍，符合面积平方） |
| 签名换字 | 默认「签名」→「张三丰」差 5141px |
| 清空还原 | 清空后与默认图逐像素差 **0** |

`beautify-check` 十二组 → **十三组**（新增 C8「印章与签名」）；`i18n-check` 报 **580 × 7**，无缺无多；
`ui-check` 仍是 **78 条**全过；`tsc` 干净。

**没有改的东西**：模板数据格式（仍是 schema 6）、`--c-*` 变量名、33 套模板的任何几何。
`isPlainHead()` 的全默认判定照旧，29 套老模板的导出像素仍逐字节不变（C5 回归守着）。

**升级**：桌面三平台覆盖安装即可，无配置迁移。安卓 versionCode 22 → 23，直接侧载覆盖。

---

## English

Two bugs, both in the stamp group, both of the shape "the control is on the panel but the picture does not move".
**No new templates, and the template data format is still schema 6** — the new field defaults to an empty string,
so exported style packages and the older templates keep exporting identical pixels.

**1. An uploaded stamp image ignored the size slider in the top-left and top-right corners.**

After uploading a transparent PNG, dragging "stamp size" worked for the bottom corners and did nothing for the top
ones — the image was laid out at its own pixel size (a 160×100 PNG drew as 160×100) and a large one covered the
title. The CSS carried only half the rule (`[data-pos="bl"] … , [data-pos="br"] … { max-height: … }`) while the
upload branch emitted a container with **neither `data-stamp` nor any width/height**. So the four corners ran on two
different code paths: bottom constrained, top unconstrained.

Fix: the upload branch now emits `data-stamp="image"` and the rule is corner-agnostic —
`width/height: calc(stampSize × 1.1)` with `object-fit: contain`. Landscape and portrait images both scale without
distortion or overflow, and all four corners obey the same size rule.

**2. The handwritten signature was hard-coded to the word 签名 ("signature").**

New field `decor.stampText` (empty = use the preset word), exposed as a **"Stamp text"** row right under
"Stamp preset", committed on blur. All four presets accept it: replace 阅 on the round seal, 已阅 on the square seal
or strip, and type your real name for the handwritten signature — the existing underline becomes the signature line.

Font size adapts: `k = min(base, room / characters)`, so a four-character name is scaled down to sit inside both the
seal frame and the underline. The inline font size is written **only** when the text exceeds the preset length, so the
default 阅 / 已阅 / 签名 render pixel-identically.

**Acceptance is measured on preview PNG pixels:**

| Item | Measured |
| --- | --- |
| Four corners agree (size 40) | red-block area 1344 / 1344 / 1346 / 1345 |
| Four corners scale together (size 120) | 12757 / 12743 / 12727 / 12725 (≈9.5×, matching the area-squared law) |
| Changing the signature text | default 签名 → 张三丰 differs by 5141px |
| Clearing the field | pixel difference against the default image: **0** |

`beautify-check` went from twelve to **thirteen groups** (new C8, "stamp and signature"); `i18n-check` reports
**580 × 7** with nothing missing or extra; `ui-check` still **78 assertions**, all green; `tsc` clean.

**What was not touched**: the template data format (still schema 6), the `--c-*` variable names, and the geometry of
all 33 templates. `isPlainHead()`'s fully-default test is unchanged, so the 29 older templates still export
byte-identical pixels.

**Upgrading**: overwrite on all three desktop platforms, no config migration. Android versionCode 22 → 23, side-load
over the old build.

---

## 下载 / Downloads

<!-- DOWNLOADS -->
