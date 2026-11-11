# v0.10.0 决策记录

> 日期：2026-11-11　基线：`v0.9.0`（模板引擎合并完成）
> 触发：用户提出 5 项改进（菜单结构、模板命名、模板库扩容与背景、纹理失效 bug、手机 9:16 布局）

## 0. 这次发布做了什么

| # | 用户诉求 | 落地 |
|---|---|---|
| 1 | 「美化输出」升一级、改「排版」、放「设置」左侧；「语言」降二级；手机加按钮 | 一级菜单 `layout`（`Ctrl+Shift+P`），`file-beautify` 删除，`settings-language` 二级；手机底栏 6 → 7 |
| 2 | 「存为我的模板」可自定义名称；橱窗示例图能看出配色 | `askText()` 命名弹窗（默认 `原名·改`、重名加序号）；`swatchOf()` 改三色小样 |
| 3 | 加复杂模板（苹果备忘录 / Instagram / 线圈 / 波普）；强装饰能力；可自定义背景图 + 默认选项 | 模板 12 → 20；新增 `bg`（6 底纹 + 上传图 + 浓度）与 `binding`（4 档）；参数 17 → 19 |
| 4 | 「纹理与装饰」设了没效果 | `texLine()` 改按纸色判断；同时修掉验收脚本的假通过 |
| 5 | 手机选 9:16 时设置项被挤出屏幕 | 窄屏预览区 `34vh` 定高，设置区 `overflow-y: auto`；390×844 探针回归 |

## 1. 为什么「删掉」旧入口，而不是两个都留

用户问的是「升级成一级菜单」，字面意思可以读成「再加一个一级入口」。但同一份状态挂两个入口，
必然出现一处改了另一处没刷新的问题——`buildMenus()` 每次重建菜单时会读 `beautify.open()` 的当前
模板与尺寸，两个入口意味着两套「当前值」快照时机。0.9.0 的 `file-beautify` 里带勾选态，
留两处就是两处勾选态。

结论：**删掉 `file-beautify`**，一级「排版」是唯一入口。代价是极少数按菜单 id 写脚本的人要改一行，
在 notes 的兼容性一节写清了。

## 2. 关键取舍

### 2.1 菜单根数保持 9：用「排版」换「语言」

一级菜单从 9 个变 10 个会挤压窄窗口（900px 以下菜单栏开始折行），而语言是低频操作。
所以是**替换**：语言降为 `设置 → 语言`，排版顶到它原来的位置（设置在 `layout` 右侧）。
验收断言从「9 个根含 language」改成「9 个根含 layout」，`i18n-check.mjs` 的 `MENU_IDS` 与
`mobile-check.mjs` 的 `MENU_IDS` 同步改，前者还补了「展开二级菜单再读」的逻辑
（否则降级后的语言项根本读不到）。

### 2.2 手机底栏 7 个按钮，不折成「更多」

390px 宽下 7 个按钮每个 53×48，仍满足 ≥44 的点击区下限，实测不换行。没有选择「把导出和排版
收进更多菜单」——排版是这次的主功能，藏进二级违背需求本意。

顺带补了一条断言 `dockHasLayoutAction`，防止后续有人把按钮删了却没人发现。

### 2.3 背景底纹用 CSS 渐变，不落图片

六个底纹（牛皮纸 / 横线 / 方格 / 点子 / 水彩 / 网线）都是 `repeating-linear-gradient` /
`radial-gradient` 组合：

- **不落文件** → 包体积零增长，也不用管 20 套模板的图片资源命名；
- **缩放不糊** → 卡片按 2× 出图时纹理跟着矢量放大；
- **导出天然内联** → 卡片光栅化走 `<svg><foreignObject>`，CSS 渐变一定能画出来，
  而外部图片会多一条 taint 失败路径。

代价是「真·材质感」不如位图，所以保留自定义上传作为补口。

`BG_PREVIEW` 与 `compile.ts` 的 `buildBgVars()` **共用同一份 CSS 常量**：面板缩略图与出图必须
是同一份代码，否则改一处、另一处漂移，用户会看到「选的样子和出图不一样」。

### 2.4 自定义背景图只收 `data:image/*;base64,`

两条理由，都不是洁癖：

1. `url(...)` 是 CSS 注入的经典入口，而模板字符串会被拼进 `<style>`；
2. 卡片走 `foreignObject` 光栅化，外部图片（含 `blob:`）会 taint canvas，
   `toDataURL` 直接抛 SecurityError —— 0.8.2 已经踩过一次。

上限 3.2 MB，上传前用 `createImageBitmap` + canvas 重编码成 webp（长边 1600px），
手机原图落进模板通常 200 KB 上下。

### 2.5 装订用 CSS 画，不加图层依赖

线圈是 `radial-gradient` 造圆孔 + `repeat-y` 纵向重复；票夹与订书钉是带透明边的圆角框。
没有引入 SVG 资源，也没有给 `DECOR_CSS` 加新文件——装订位只是一个新的 `data-bind` 属性。

### 2.6 `schema` 升 3 但不做版本分支

新增四个 `decor` 字段（`bg` / `bgImage` / `bgOpacity` / `binding`）。两条路：
按 `schema` 分版本走不同归一化，或统一「缺字段回落默认」。

选后者：`normalizeTemplate()` 本来就对每个字段做 clamp + 白名单，缺字段自然拿到默认值。
好处是导入不校验「schema 必须等于 3」，0.9.0 的 `.lyt.json` 与 localStorage 直接可用；
坏处是没法表达「这个字段在旧版里不存在所以不要覆盖」——本项目没有这种语义需求。

### 2.7 参数表加 2 项，背景底纹不占参数行

`decor.bgOpacity`（滑块）与 `decor.binding`（胶囊组）走 `PARAM_SPECS`，面板自动生成。
但 `decor.bg` 的 6 个底纹**不走参数表**，改成面板里的缩略图按钮：

- 参数表生成的 `select` 只能给出文字选项，选底纹必须看得见；
- 缩略图要复用的是 `BG_PREVIEW` 那套 CSS，不是参数表能表达的。

`PARAM_SPECS` 里因此有了 `paths: []` 这种「只有标题、控件自己画」的分组（`card.groupBg`）。

### 2.8 命名弹窗复用 `.modal-mask`，把 z-index 提到 460

没有新写一套浮层，直接复用了既有的模态样式，新增 `ui/ask.ts` 只负责「输入框 + 确定/取消 +
捕获阶段拦 Esc/Enter」（不拦的话按键会漏到编辑器里打字）。

代价是撞上了层叠问题：`.ce-mask` 是 420、`.modal-mask` 原来 300，弹窗被面板盖住——看得见、
点不到。提到 460 并在 CSS 注释里写明「必须高于 .ce-mask」，避免下次为了别的弹层压回去。

### 2.9 版本号 0.9.0 → 0.10.0、`versionCode` 13 → 14、PWA 缓存 `lypora-v3` → `lypora-v4`

按「改结构就升 minor」的判断（菜单根与底栏都是外壳契约）。PWA 缓存名必须跟着换，
否则装过 0.9.0 的浏览器会继续用旧前端产物。

## 3. 过程中发现并修掉的问题

| 问题 | 根因 | 修法 |
|---|---|---|
| 纹理与装饰整组无效果（用户报） | `texLine()` 拿 **ink** 亮度取线色，浅纸深墨 → 白线画白纸 | 先 `gradientSolid(paper)`，再按纸色亮度取线色 |
| 纹理用例假通过 | 基线截于改字号之前，字号变化本身就改了像素 | 同字号 A-B-A：`none → grid → none`，要求回到基线 |
| 命名弹窗点不到 | `.modal-mask`(300) < `.ce-mask`(420) | `.modal-mask` → 460 + 注释说明 |
| 9:16 窄屏设置区被挤出 | 预览区按宽度撑高，没有确定高度 | 窄屏预览 `flex: 0 0 auto; height: 34vh`，设置区 `min-height: 0; overflow-y: auto` |
| 第六个底纹「宣纸」点了没反应 | `BG_PRESETS` 写的是 `wire`，CSS（`BG_PREVIEW`）与词表（`tpl.bg.*`）里叫 `paper`，三处对不上 | 枚举改为 `paper`；验收遍历所有 `.ce-bg[data-bg]`，逐个要求与空背景有可见差异 |
| 牛皮纸看起来还是白纸 | 只有 alpha 0.055 的斜纹，没有底色 | 最底层加半透明牛皮色（0.58–0.62），白纸透出浅牛皮、手账模板透出深牛皮 |
| 点阵量不出差异 | 比对把预览缩到 120×120，16px 网格上 1.1px 的点被平均成 0 | 比对提到 240×240；点阵提到 1.35px / alpha .17 |
| `i18n-check` 偶发红/奇慢 | 收尾 `rmSync` 删临时目录，撞上宿主安全删除钩子（fail-closed，卡到 spawnSync ETIMEDOUT） | 改为不删（编译产物固定 7 个文件名，覆盖写即可），目录进 `.gitignore` |
| 上一条的 34vh 其实没生效 | 媒体查询里的 `.ce-wide .ce-preview{height:34vh}` 被文件末尾同特异性的 `{flex:0 0 38%}` 顶掉，实测 239px | 把 38% 那条收进 `@media (min-width:761px)`；复测 390×844 得 287px（=34vh） |
| 纹理 8 个按钮在 390px 溢出 | `.ce-param` 没有 `flex-wrap` | 加 `flex-wrap: wrap` + `.ce-seg { flex: 1 1 auto; min-width: 0 }` |
| `mobile-check` 报 `dockHas6Actions` / `sheetHasAllMenus` / `desktopMenubar` 失败 | 脚本硬编码「6 按钮 / 8 分区 / 菜单含 language」 | 改为 7 按钮 / 9 分区 / 含 layout 与 settings，并加 `dockHasLayoutAction` |
| `docs/04` 插入脚本报 `anchor not found` | 该文档全篇 CRLF（1257 处），脚本用 `\n` 拼锚点 | 读入折成 LF 匹配、写回用 `newline='\r\n'` |
| Android 打包 `Unable to start the daemon process` | Gradle 8.11 `FileLockCommunicator` 往 `::1` 绑 UDP 失败；真异常 `BindException` 藏在 60 行栈底 | `build-android.mjs` 注入 `JAVA_TOOL_OPTIONS=-Djava.net.preferIPv4Stack=true` |

## 4. 验证（同一台机器，2026-11-11）

```
tsc --noEmit       0
beautify-check     pass / errors []   20 模板出图、纹理 A-B-A、背景与装订、自定义命名、schema 3
mobile-check       pass / errors []   5 视口、7 按钮、9 分区 84 行、无溢出
i18n-check         pass / errors []   287 键 × 7 语言、运行时切换
verify             pass / errors []   编辑器主链路、移动端工具栏 12 按钮
export-check       pass / errors []   MD / HTML / PDF 无回归
--selftest         ok                 0.10.0、9 菜单根、consoleErrors []
pack-win           Lypora-0.10.0-win-x64.zip  111.8 MiB / 147 文件
build-android      Lypora-0.10.0-android.apk   13.6 MiB / versionCode 14 / app.lypora.editor
```

## 5. 遗留

- 背景图不跨模板复用（换模板要重传），后续做「我的背景」列表。
- 分页仍不均衡（大代码块独占一页）。
- 桌面「另存为」与 Android 真机导出需人工确认一次。
- 真机窄屏（软键盘 / 地址栏收缩）只有模拟证据。
- mac / Linux 产物本版仍只有结构与容器证据的边界没变（写了就要说清，见 docs/06）。
