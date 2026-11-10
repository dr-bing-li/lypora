输出层现在是产品的一部分了。

以前「写完之后怎么发出去」是半成品：8 套风格写死在 CSS 里，想调字号得改代码，想加一套模板要重抄一遍排版。
0.9.0 把它换成**模板 = 一份 JSON + 一个编译器**：12 套模板、17 项可调参数、模板能导出成 `.lyt.json`
再导入，改参数会真的重新分页。整条链路零网络请求，图片、公式、代码块都不出本机。

The output layer is now part of the product.

Until now "how to publish what you wrote" was half-built: eight styles hard-coded in CSS, so changing the font
size meant editing code and adding a template meant re-copying the whole layout. 0.9.0 replaces that with
**a template = one JSON object + one compiler**: 12 templates, 17 adjustable parameters, templates that export
to `.lyt.json` and import back, and a parameter change that genuinely re-paginates. The whole pipeline makes
zero network requests — images, formulas and code blocks never leave your machine.

这一版的功能来自 `Lypora-NEXT` 分支（两个提交 `ed55355` / `64d16fa`，公共基线 `8583d5a`），
原样合并回本仓库；仓库地址、应用标识、包名、产物名全部保持 `Lypora` / `app.lypora.editor` 不变——
它与原版**不能**并存安装，它就是原版的下一版。

The feature set comes from the `Lypora-NEXT` branch (commits `ed55355` / `64d16fa`, common base `8583d5a`)
and was merged back verbatim. Repository URL, application id, package name and artefact names all stay
`Lypora` / `app.lypora.editor` — it does **not** install side by side with the previous version; it *is*
the next version of it.

- 全部代码、样式、模板、译文自研，MIT 协议；不含任何第三方商业产品的代码或素材。
- 独立实现，与 Typora 及其开发者无关联；本项目只是对它的一次**拙劣模仿**（致敬见文末）。

---

## 下载 / Downloads

| 文件 / File | 平台 / Platform | 格式 / Format | 大小 / Size | SHA256 |
|---|---|---|---|---|
| `Lypora-0.9.0-win-x64.zip` | Windows 10/11 x64 | 便携版 ZIP（解压即用）<br>Portable ZIP — unzip and run | 111.8 MiB | `10c720ff79e5b11795230f8ea9c99a9d289b551ce5836c8ef58cdfb1d873b5c8` |
| `Lypora-0.9.0-android.apk` | Android 10+（API 29+） | APK（debug 签名，直接安装）<br>APK, debug-signed, sideload | 13.6 MiB | `24403ee6f0d1215b2559b22babf2134db05cba4197b09a744c07a430c0ac3c58` |
| `Lypora-0.9.0-macos-arm64.tar.gz` | macOS 11+ / Apple Silicon | `.app` bundle（ad-hoc 签名） | 由 CI 构建，发布时回填<br>built by CI, filled at publish | — |
| `Lypora-0.9.0-macos-x64.tar.gz` | macOS 11+ / Intel | `.app` bundle（ad-hoc 签名） | 同上 / same | — |
| `Lypora-0.9.0-linux-x64.tar.gz` | 任意 x86-64 发行版（glibc ≥ 2.31） | tar.gz + `install.sh`（per-user） | 同上 / same | — |
| `Lypora-0.9.0-linux-x64.AppImage` | 任意 x86-64 发行版 | 单文件，免安装 | 同上 / same | — |
| `lypora_0.9.0_amd64.deb` | Debian 11+ / Ubuntu 20.04+ / 深度 / 麒麟 | 系统包（`apt install`） | 同上 / same | — |
| `lypora-0.9.0-1.x86_64.rpm` | Fedora 32+ / RHEL 9+ / openSUSE | 系统包（`dnf install`） | 同上 / same | — |
| `SHA256SUMS.txt` | 任意 / any | 全部产物的校验清单 | 发布时生成 / generated at publish | — |

Windows 与 Android 两件是本机构建并自检过的；macOS / Linux 四件由 CI 在打 tag 时构建，
体积与校验值在发布时回填（`docs/07` 的流水线没有变）。

The Windows and Android artefacts were built and self-tested locally; the macOS / Linux ones are built by CI
on the tag and get their sizes and hashes filled in at publish time.

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
| 版本号 | `0.9.0` |
| 发布标签 | `v0.9.0` |
| 版本性质 | **功能新增（minor）**：新增「美化输出」板块，无破坏性改动 |
| 相对版本 | `v0.8.2` |
| Android | `versionName 0.9.0` / `versionCode 13`（v0.8.2 是 12，可直接覆盖升级） |
| 依赖 | 与 v0.8.2 **完全一致**，`package.json` 依赖树零变化 |

### 为什么是 0.9.0 而不是 0.8.3

仓库的版本规矩是「改 bug 升补丁位，加功能升次版本位」。这一版不是修修补补：

- 新增一个功能板块（文件菜单多一项「美化输出」），不是现有功能的行为修正；
- 新增 9 个源文件（模板引擎 5 个 + 面板 + 验收脚本），重写 3 个；
- 新增 7 语言各约 80 个词条；
- 旧入口 `导出卡片` 被 `美化输出` 取代（同一位置、同一用途，产物种类只增不减）；
- 用户可见的默认行为变了：打开面板看到的不是 8 个风格按钮，而是 12 套模板画廊 + 参数面板。

按仓库既有节奏（0.7.0 加图片策略、0.8.0 改路径解析都是次版本），功能级新增一律升次版本位，
所以 `0.8.2 → 0.9.0`。打包脚本、CI、产物命名规则全部沿用，不因为版本号跨了 `0.9` 就要改流程。

## 本版改了什么

### 一、模板从「一段 CSS」变成「一份数据」

旧做法：一套风格 = 一段手写 CSS。想改字号要会写 CSS，加一套模板要重抄一遍排版规则，抄漏一处就是两套
行为不一致。新做法：

```
CSS 骨架（一份，写死排版规则，只读 var(--c-*)）
   + 模板编译出的变量块（12 套，每套 37 个字段）
   + 装饰表（8 纹理 / 4 强调位 / 2 折角，靠 data 属性命中）
```

12 模板 × 8 纹理 × 4 强调位 × 2 折角 = 768 种外观，CSS 总量只有一份骨架 + 一份装饰表 + 12 段变量，
编译后约 9 KB。**模板只能改变量，不能改盒模型**——一旦允许模板写 `display` / `width` / `padding`，
分页的测量基准就不可控了。这条约束写在 `compile.ts` 头部，评审按它卡。

### 二、17 项参数 + 4 种字体族，面板自动生成

| 分组 | 参数 |
|---|---|
| 颜色（4） | 纸张、正文、强调色、代码底色 |
| 度量（5） | 正文字号 12–22、行高 1.4–2.2、标题字号 22–52、左右留白、圆角 |
| 版面（2） | 页眉、页码开关 |
| 装饰（6） | 8 种纹理、4 个强调位、折角、封面排布、顶部胶带、印章 |

参数表是数据，面板遍历它生成滑块 / 色盘 / 开关 / 胶囊组；加一套模板不需要写任何 UI。
另有一行独立的字体族选择（无衬线 / 衬线 / 楷体 / 等宽）。

**改参数会重新分页**，不是只换 CSS：字号 15 → 21，每页能装的段落就变了，所以走的是
「离屏重测 → 重新切页 → 重新出图」，代价 100–300ms，用 160ms 防抖合并连续拖动。

### 三、12 套模板

素纸 / 便签 / 杂志 / 暗夜 / 渐变海报 / 打字机 / 方格笔记 / 水墨（这 8 套与 v0.8.2 同名同 id），
新增 暖沙 / 极简黑白 / 钴蓝 / 林间。

### 四、模板可以带走

导出 `.lyt.json`（带 `schema` / `exportedAt` / `app` 元信息），导入时**id 冲突加后缀，绝不覆盖内置**；
可存为「我的模板」（本地上限 40 套），也可一键「恢复默认」。

模板里的字符串最终会拼进 `<style>`，一个 `}` 就能跳出变量块改写整页样式——所以校验按**语法形态**白名单，
不是「能解析就行」：结构性字符直接拒，只放行具名色 / `#hex` / `rgb(a)` / `hsl(a)` / 渐变 / 投影；
数值一律 clamp，枚举一律取白名单，非法字段丢弃并回落默认值（不是整份拒绝）。

### 五、没变的部分

4 种画布尺寸（竖版 3:4 / 方版 1:1 / 长竖 9:16 / A4）、三种分页（自动 / 按 `---` / 不分页）、封面页、
PNG（多页打 ZIP）、PDF（一卡一页）、复制当前页到剪贴板、以及「模板与界面主题互不影响」这条边界。

## 兼容性与迁移（升级前请读这一段）

| 事项 | 结论 |
|---|---|
| **编辑器设置** | `lypora:fontSize` / `lypora:theme` / `lypora:pageWidth` / `lypora:tableCols` 等键**一个没动**，升级后原样生效，不需要迁移 |
| **文档数据** | IndexedDB 文档库与最近文件列表结构未变，升级不丢文档 |
| **美化输出的设置键** | 全新：`lypora:beautify:template` / `:userTemplates` / `:beautify-layout`。v0.8.2 里不存在这些键，因此**没有旧数据要迁**；合并时从 NEXT 原型里的 `lypora:next:*` 改名而来（理由见 `decision-log.md`） |
| **菜单入口** | 「文件 → 导出卡片」改名为「文件 → 美化输出」（菜单 id `file-export-card` → `file-beautify`）。用途与位置不变，快捷键无变化 |
| **PWA / 浏览器版** | `sw.js` 的缓存名从 `lypora-v2` 升到 `lypora-v3`。新 SW 激活时会**自动删除旧缓存**，所以不会出现「升级后还是旧界面」。若浏览器仍显示旧版，硬刷新一次 |
| **Android** | 覆盖安装即可保留数据（`versionCode 12 → 13`，同一 `app.lypora.editor` 签名）。旧版本上不存在的模板设置会走默认值 |
| **桌面版** | 便携版解压覆盖即可；配置在 `%APPDATA%\lypora-desktop`，不随包删除 |
| **macOS / Linux** | 前端产物通用，CI 会用同一份脚本重封；`/opt/lypora` 与 `.desktop` 布局未改，deb / rpm 可直接 `upgrade`。**Intel mac 与 deb/rpm/AppImage 的实际运行仍未在真机验证过**（`docs/04` §6） |
| **依赖树** | 零新增依赖。模板引擎是纯 TypeScript 字符串拼接，PDF / ZIP 写入器自研，不引 jsPDF / html2canvas |
| **模板可移植性** | 模板只存样式参数，不存字体文件。目标机器缺楷体时，水墨模板的标题会回落到衬线——这是「不引 webfont」的必然代价 |
| **导出图与预览** | 预览、PNG、PDF 共用同一份 `stylesheetFor(template)`，像素一致；不同机器上字体栈不同则字形可能不同 |

## 验证

| 项 | 结果 |
|---|---|
| `beautify-check.mjs` | pass：12 套模板全部出图、字号 15→21 使页数 4→5、模板导出再导入成功、**外部网络请求 0** |
| `verify.mjs` | pass：编辑器主链路、设置迁移、移动端工具栏、编辑器主题，errors 为空 |
| `export-check.mjs` | pass：Markdown / HTML / 打印 PDF 三条老路无回归 |
| `i18n-check.mjs` | pass：7 语言键一致 + 浏览器实渲染 + 运行时切换 |
| `tsc --noEmit` | 通过 |
| 打包版 `--selftest` | `ok: true`、版本 `0.9.0`、9 个顶级菜单、`bridgeApi` 含 `saveBinary`、`consoleErrors: []` |
| APK | `app.lypora.editor` / `versionCode 13` / `versionName 0.9.0` / minSdk 29 / 13.6 MiB；包内 `assets/public` 已确认是新代码 |

产物体积：Windows 便携包 111.8 MiB（147 个文件），APK 13.6 MiB。

## 安装方式

```bash
# Debian / Ubuntu / 深度 / 麒麟
sudo apt install ./lypora_0.9.0_amd64.deb

# Fedora / RHEL 9+ / openSUSE
sudo dnf install ./lypora-0.9.0-1.x86_64.rpm

# 任意发行版，免安装
chmod +x Lypora-0.9.0-linux-x64.AppImage && ./Lypora-0.9.0-linux-x64.AppImage
```

```bat
:: Android：覆盖安装即可保留数据
adb install -r Lypora-0.9.0-android.apk
```

## 已知限制

- **分页不均衡**：当前是「装不下就换页」，大代码块会独占一页、留半页空白。改成「先算总高再均分」会拆块。
- **模板缩略图**：画廊用双色斜切块代替真实缩略图。
- **渐变模板改「纸张」会退化成纯色**：`<input type="color">` 表达不了渐变，想恢复走「恢复默认」。
- **桌面「另存为」对话框未人工点击验证**：IPC 与 `saveBinary` 都已暴露（`--selftest` 可见），仍需人点一次。
- **Android 真机导出未验证**：走 Documents + 系统分享面板，需装机实测。
- **Intel mac / deb / rpm / AppImage 的实际运行**仍未在真机验证（结构与容器安装证据见 `docs/04`）。
- **远程图片在离线环境会被摘掉**：Markdown 里的 `https://…` 图拉不到时，卡片少一张图，不报错。

---

# English

## Version information

| Item | Value |
|---|---|
| Version | `0.9.0` |
| Tag | `v0.9.0` |
| Nature | **Feature release (minor)**: adds the "beautify output" section, no breaking changes |
| Previous | `v0.8.2` |
| Android | `versionName 0.9.0` / `versionCode 13` (12 in v0.8.2 — upgrade in place) |
| Dependencies | **Unchanged** from v0.8.2; the dependency tree is identical |

### Why 0.9.0 and not 0.8.3

The repository rule is "bug fix → patch digit, new capability → minor digit". This is not a patch: it adds a
feature section (a new File-menu entry), 9 new source files, rewrites 3, adds ~80 translated strings per
language, replaces the old card-export entry, and changes what the user sees when the panel opens. Following
the existing cadence (0.7.0 and 0.8.0 were both minor releases for feature-level work), this lands on `0.9.0`.
Packaging scripts, CI and artefact naming are unchanged.

## What changed

### 1. A template is data, not CSS

Old: one style = one hand-written CSS block. Changing the font size meant editing code; adding a template
meant re-copying every layout rule. New: a shared CSS skeleton that only reads `var(--c-*)`, plus one
compiled variable block per template (37 fields), plus a decoration sheet selected by data attributes.
12 templates × 8 textures × 4 accent slots × 2 corner styles = 768 looks from one skeleton, one decoration
sheet and 12 variable blocks — roughly 9 KB of compiled CSS.

The hard constraint: **a template may change variables, never the box model.** The moment a template can write
`display` / `width` / `padding`, the measurement baseline for pagination drifts.

### 2. 17 parameters plus a font family selector

Four colours, five metrics (body size, line height, title size, horizontal padding, radius), two layout
toggles (header rule, page numbers), six decoration slots (texture, accent, corner, cover layout, tape,
stamp), plus one font-family row (sans / serif / kai / mono). The panel generates its controls by walking the
parameter table, so adding a template requires no UI code.

**A parameter change re-paginates.** Going from 15 px to 21 px changes how many paragraphs fit on a page, so
the pipeline re-measures off-screen, re-cuts pages and re-renders (100–300 ms, debounced at 160 ms).

### 3. Twelve templates

Plain Paper / Sticky Note / Magazine / Midnight / Gradient Poster / Typewriter / Grid Note / Ink Wash (these
eight keep the v0.8.2 ids and names), plus Warm Sand / Minimal Mono / Cobalt / Forest.

### 4. Templates travel as files

Export `.lyt.json`, import it back; an id collision gets a suffix and never overwrites a built-in. Templates
can be saved as "my templates" (40 max, local only) and reset to default.

Template strings end up inside a `<style>` element, so validation is a **syntax-shape** whitelist rather than
"does it parse": structural characters are rejected outright, only named colours / `#hex` / `rgb(a)` / `hsl(a)`
/ gradients / shadows are allowed, numbers are clamped, enums are whitelisted, and invalid fields fall back to
defaults instead of rejecting the whole template.

### 5. What did not change

Four canvas sizes, three pagination modes (`auto` / by `---` / none), cover page, PNG (ZIP for multiple pages),
PDF (one card per page), copy-current-page to clipboard, and the rule that output style is independent of the
editor theme.

## Compatibility and migration

| Item | Conclusion |
|---|---|
| **Editor settings** | Keys such as `lypora:fontSize` / `lypora:theme` / `lypora:pageWidth` / `lypora:tableCols` are untouched — no migration needed |
| **Documents** | IndexedDB document store and recent-file list unchanged; no data loss on upgrade |
| **Beautify keys** | New: `lypora:beautify:template` / `:userTemplates` / `:beautify-layout`. They did not exist in v0.8.2, so there is nothing to migrate. Renamed from the prototype's `lypora:next:*` during the merge |
| **Menu entry** | "File → Export card" is now "File → Beautify output" (`file-export-card` → `file-beautify`). Same place, same purpose, no shortcut changes |
| **PWA / browser** | Service-worker cache renamed `lypora-v2` → `lypora-v3`; the new SW **deletes old caches** on activate, so you will not be stuck on the old UI. Hard-refresh once if it lingers |
| **Android** | Install over the top, data kept (`versionCode 12 → 13`, same `app.lypora.editor`). Template settings that did not exist before fall back to defaults |
| **Desktop** | Unzip over the portable folder; config lives in `%APPDATA%\lypora-desktop` and is not touched |
| **macOS / Linux** | The frontend is platform-neutral and CI re-packages it with the same scripts; `/opt/lypora` and `.desktop` layout unchanged, so deb / rpm upgrade cleanly. **Intel mac and deb/rpm/AppImage runtime are still unverified on real hardware** (`docs/04` §6) |
| **Dependencies** | Zero new dependencies: the template engine is plain TypeScript, the PDF and ZIP writers are self-written (no jsPDF / html2canvas) |
| **Template portability** | Templates store style parameters, not font files. A machine without KaiTi falls back to a serif for the Ink Wash template — the cost of not shipping webfonts |
| **Preview vs export** | Preview, PNG and PDF share one `stylesheetFor(template)`, so they match pixel for pixel on the same machine; across machines the system font stack may differ |

## Verification

| Check | Result |
|---|---|
| `beautify-check.mjs` | pass: 12 templates rendered, font 15→21 changed page count 4→5, template export/import round-trip, **0 external requests** |
| `verify.mjs` | pass: editor core, settings migration, mobile toolbar, editor themes; no errors |
| `export-check.mjs` | pass: Markdown / HTML / print-PDF paths unregressed |
| `i18n-check.mjs` | pass: 7 locales, key parity, real DOM rendering, runtime switching |
| `tsc --noEmit` | clean |
| Packaged `--selftest` | `ok: true`, version `0.9.0`, 9 top-level menus, `bridgeApi` includes `saveBinary`, `consoleErrors: []` |
| APK | `app.lypora.editor` / `versionCode 13` / `versionName 0.9.0` / minSdk 29 / 13.6 MiB; the bundled `assets/public` is the new build |

Artefact size: Windows portable ZIP 111.8 MiB (147 files), APK 13.6 MiB.

## Known limitations

- **Pagination is greedy**, not balanced: a large code block can take a whole page and leave half of it blank.
- **Template thumbnails are simplified** (two-tone diagonal blocks instead of real renders).
- **Editing the "paper" of a gradient template degrades it to a flat colour** — `<input type="color">` cannot
  express a gradient; use "reset to default" to recover.
- **The desktop "save as" dialog has not been clicked by a human** (the IPC and `saveBinary` are exposed and
  visible to `--selftest`).
- **Android export is unverified on real hardware** (writes to Documents and opens the share sheet).
- **Intel mac / deb / rpm / AppImage runtime remains unverified**; only structural and container-install
  evidence exists (`docs/04`).
- **Remote images are dropped offline**: an `https://…` image that cannot be fetched is removed from the card
  without an error.

---

## 致敬与免责 / Acknowledgement

本项目是对 [Typora](https://typora.io/) 的一次独立、拙劣的模仿，用于学习与自用。与 Typora 及其开发者无任何关联，
未使用其任何代码、样式或素材。若你需要的是一款成熟稳定的 Markdown 编辑器，请购买正版 Typora。

This project is an independent, deliberately crude imitation of [Typora](https://typora.io/), built for
learning and personal use. It is not affiliated with, endorsed by, or connected to Typora or its developers,
and contains none of their code, styles or assets. If you want a mature, stable Markdown editor, buy Typora.
