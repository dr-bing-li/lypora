这一版**只动排版面板**：没有新模板，没有改模板数据格式（仍是 schema 6），已经导出的样式包
（`.zip` / 旧 `.lyt.json`）原样可用。

一句话：**面板上的东西，要看得清、看得懂、摆得开、夹得像。**

**五件事。**

1. **贴纸那组不再露键名。** 面板上原来直接显示 `card.groupOrn`（七个语言包都缺这条），现在是「贴纸」。
   形状 5 → **7**，新增**对话气泡**与**气球**——后两种带文字，切过去自动补一个占位词（「要点」），
   不用先打字才看得见形状；气泡尾巴朝左下，气球有打结与左上高光，字色按填充色亮度自动取深或浅
   （Rec.601 > 0.66 取深色），所以浅色贴纸上不会出现白字压白底。落点 4 → **8**：四角之外，
   上中 / 下中 / 左中 / 右中四个边中点也能摆，都是半出卡片边缘。

2. **字号两档拉开。** 分组标题（尺寸、分页、颜色、版面度量）13 → **14px**；参数名（正文字号、行高、
   左右留白）11.5 → **13px**，同时把颜色从灰改成主文字色；行高 26 → 30px，标签列 82 → **96px**
   ——「左右留白」这种四字标签原来被挤成两行，现在一行放得下。

3. **H1–H4 的底色可以选「通栏」还是「仅文字」。** 原来只有一个叫「收窄」的开关，名字和效果都不直观。
   实测同一枚 h1：通栏 682px（占卡宽 85%），切「仅文字」收窄到 344px，正好包住标题文字。
   字段仍是 schema 6 的 `inline`，所以旧样式包不用改。

4. **装订件重画**（本轮最费劲的一处）。原来的回形针像两个套在一起的椭圆，订书钉像一张小板凳。
   现在按实物走：
   - **回形针**：一根线从外圈走到内圈，内圈收在 2/3 处；同一路径错位叠三层（基准灰 / 右下暗边 /
     左上高光）做出金属圆柱感，两端是圆头而不是断口。
   - **订书钉**：一条扁带，垂直渐变出金属光泽，两端各有一块下折的暗块（钉子进纸的那一段），
     底下一道 1px 接触影。实测宽 60px、中线厚 10px（6.0 : 1），墨面积是带面积的 0.92 倍 ——
     是实心带，不是描边的「⊓」。
   - **长尾夹（新增）**：卷边横条 + 近方形深色夹体（下沿是咬着纸的钳口圆弧）+
     从卷边两侧折下来、垂在钳口下方的 U 形钢丝手柄。

5. **每一项都能问「这是什么」。** 鼠标停在参数行上约 0.4 秒，浮出一句说明，比如
   「正文字号，越大一页装得越少」。约 60 条说明 × 7 种语言（词条 486 → **577**）。
   手机上没有悬停，点左侧项名弹出，再点收起 —— 点击只挂在项名上，不挂整行，
   否则会把滑块的拖动吃掉。

**顺带修掉一个真 bug：选完颜色，反而清不掉。** 颜色那一行不会因为选色而重渲染，于是「∅」按钮
永远停在进来时的 disabled 状态 —— 用户点了没反应，还以为是自己点歪。现在选色的同时就地把
码位与 ∅ 一起更新。

**验收全部量预览 PNG 的像素，不看中间量：**

| 项 | 实测 |
| --- | --- |
| 底色范围 | 通栏 682px（占卡宽 85%）／仅文字 344px |
| 贴纸上/左中落点 | 「左中」左边界 x=0、中心 528（卡高 1067）—— 半出卡片且垂直居中；「下中」离底 9px |
| 气泡与气球 | 104×103 / 97×104 两块都画出来，逐像素差 0.46% |
| 长尾夹 | 深色像素 6806 → 9193（+2387），变化区 60×95px |
| 订书钉 | 宽 60px、中线厚 10px（6.0 : 1）、填充率 0.92、外接框 4.3 : 1 |
| 回形针 | 53×102px，高宽比 1.9 |

`beautify-check` 十一 → **十二组**（新增 C7「面板可读性与新控件」）；`ui-check` **78 条**
（新增 4 条：面板不露裸键、字号刻度、悬停说明确有文案、参数行 ≥40）；`i18n-check` 577 × 7 无缺无多。

**没有改的东西**（免得被误读）：模板数据格式（仍是 schema 6）、`--c-*` 变量名、33 套模板的任何几何。
`isPlainHead()` 的全默认判定照旧，所以老模板导出的像素逐字节不变（C5 回归断言守着）。

**升级注意**：桌面三平台覆盖即可，无配置迁移。安卓 versionCode 21 → 22，直接覆盖安装。

---

This release **touches only the layout panel**: no new templates, no change to the template data format
(still schema 6), and style packages you already exported (`.zip` / legacy `.lyt.json`) import unchanged.

In one line: **everything on the panel should be legible, understandable, placeable and believable.**

**Five changes.**

1. **The sticker group no longer shows a raw key.** The panel used to print `card.groupOrn` (missing from all
   seven locale files); it now reads "Stickers". Shapes 5 → **7**, adding a **speech bubble** and a **balloon** —
   both carry text, and switching to them fills in a placeholder (so you can see the shape before typing).
   The bubble has its tail at the lower left; the balloon has a knot and a highlight. Text colour is picked from
   the fill's perceived brightness (Rec.601 > 0.66 → dark), so a pale sticker never gets white-on-white.
   Anchors 4 → **8**: besides the corners, the midpoints of all four edges, each sitting half outside the card.

2. **Two distinct type sizes.** Group titles (Size, Pagination, Colour, Metrics) 13 → **14px**; parameter names
   (Body size, Line height, Side margins) 11.5 → **13px** and from muted grey to the primary text colour;
   row height 26 → 30px; label column 82 → **96px** — a four-character label used to wrap onto two lines.

3. **H1–H4 fill span: full width or text only.** The old control was a switch called "narrow", whose name and
   effect were both unclear. Measured on the same h1: full width 682px (85% of the card), text only 344px,
   wrapping the heading exactly. The field is still schema 6's `inline`, so existing style packages are unaffected.

4. **Binding hardware redrawn** (the most expensive part of this release). The paperclip looked like two nested
   ellipses and the staple looked like a small bench. Now they follow the real object:
   - **Paperclip** — one continuous wire from the outer loop to the inner loop, the inner one stopping at
     two-thirds; the same path is stroked three times with sub-pixel offsets (base grey / dark lower-right /
     light upper-left) to read as round metal, with rounded ends instead of cut-off tips.
   - **Staple** — a flat ribbon with a vertical metal gradient, a dark block bent down at each end (where the
     legs enter the paper) and a 1px contact shadow. Measured: 60px wide, 10px thick at the centre line
     (6.0 : 1), ink covering 0.92× of the ribbon's area — a solid strip, not an outlined `⊓`.
   - **Binder clip (new)** — a rolled top edge, a near-square dark body whose lower edge is the jaw arc, and a
     U-shaped wire handle folded down from both ends of the roll, hanging below the jaw.

5. **Every control can explain itself.** Hover a parameter row for about 0.4s and a one-line note appears —
   "Body size — the larger it is, the less fits on a page". About 60 notes × 7 languages
   (entries 486 → **577**). There is no hover on touch screens: tap the label to show it, tap again to dismiss.
   The tap handler is bound to the label only, never the whole row, or it would swallow slider drags.

**A real bug fixed along the way: after picking a colour you could not clear it.** The colour row is not
re-rendered when a colour is picked, so the "∅" button stayed `disabled` from the moment the row was built —
tapping it did nothing and looked like a mis-click. The hex readout and ∅ are now updated right there in the
`oninput` handler.

**Acceptance is measured on preview PNG pixels, never on intermediate state:**

| Item | Measured |
| --- | --- |
| Fill span | full width 682px (85% of card) / text only 344px |
| Left-middle sticker | left edge x=0, centre y=528 against a 1067px-tall card — half outside and vertically centred; bottom-centre sits 9px above the bottom edge |
| Bubble vs balloon | both render (104×103 / 97×104) and differ by 0.46% of pixels |
| Binder clip | dark pixels 6806 → 9193 (+2387), changed area 60×95px |
| Staple | 60px wide, 10px centre thickness (6.0 : 1), 0.92 fill ratio, 4.3 : 1 bounding box |
| Paperclip | 53×102px, height/width 1.9 |

`beautify-check` went from eleven to **twelve groups** (new C7, "panel legibility and new controls");
`ui-check` runs **78 assertions** (four new: no raw keys on the panel, type scale, tooltips actually carry text,
at least 40 parameter rows); `i18n-check` reports 577 × 7 with nothing missing or extra.

**What was not touched**, so it is not misread: the template data format (still schema 6), the `--c-*` variable
names, and the geometry of all 33 templates. `isPlainHead()`'s fully-default test is unchanged, so the 29 older
templates still export byte-identical pixels (guarded by the C5 regression assertions).

**Upgrading**: overwrite on all three desktop platforms, no config migration. Android versionCode 21 → 22,
side-load over the old build.

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.14.2-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.7 MiB | `5129318f1a5a59c9bdd9f94e57b9fa7406440708944b94d72da4b3009de5e332` |
| `Lypora-0.14.2-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装<br>Single file, no install | 96.8 MiB | `981acdf846fb8244bf9b56cd2f72aad306ba0ced0636383d6e644330e534b570` |
| `Lypora-0.14.2-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 104.4 MiB | `96b7151eb5b0b5af411c328b4b5f84191ebed414d02d1afd2eb373e7e26fc645` |
| `Lypora-0.14.2-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 98.6 MiB | `4fa0358772262be169ba343802e3a1b43bcac14bf21e854faa16617eee95a210` |
| `Lypora-0.14.2-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 103.0 MiB | `49e900ed1e14f4e5b7d643093dfbb1ff8029768df55cc8b27ef12649b3776ed3` |
| `Lypora-0.14.2-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `ca3d6274e7a35cf844996f497a2137dd7216ff08fae3756fb93a93c82268b33f` |
| `lypora-0.14.2-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | 105.0 MiB | `9678a88cf371784561bb243a7d8e2113cdde5c6339d77ba38adc387fef8e9195` |
| `lypora_0.14.2_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | 81.0 MiB | `f5f2b85b58bcd291b444c29594fa19fdf9b7fa2d3f6f8681b431ca6f00da5829` |

