# v0.11.1 决策记录

> 日期：2026-11-12　基线：`v0.11.0`（标签页 / 多窗口 / 排版整屏 / 帮助只读文档）
> 触发：用户先要求「评估界面美观度与易用性，输出结构化报告」，随后要求
> 「把审计固化为常驻脚本 `ui-check.mjs`，整理成可逐项勾选的清单，逐条改完并每次重跑验证」

## 0. 这次发布做了什么

| # | 用户诉求 | 落地 |
|---|---|---|
| 1 | 把 UI 审计固化成常驻脚本，参照 `tabs-check` 的组织方式，加对比度与几何断言，每轮改动自动执行并给出明确通过/失败 | `core/ui-check.mjs`：7 组 66 条，`artifacts/ui-check/<ts>/report.json`，退出码 0/1，探测不到 4173 自己起 `vite preview` |
| 2 | 审计意见整理成可逐项勾选的执行清单，按优先级排序 | `design-plans/ui-fix-checklist.md`：6 批次 A–F、32 项，每项带「位置 / 基线实测 / 改法 / 对应断言 id」，改完回填实测值 |
| 3 | 逐条改完，每完成一项即重跑验证，直至全部通过 | 基线 **64 条 / 失败 40** → 收官 **66 条 / 失败 0**；另跑七套既有验收查回归 |
| 4 | 关键交互与模拟操作流程流畅、无阻断 | `interactive` 组 10 条：`Ctrl+N` 真新建、焦点陷阱、`role="dialog"`、焦点归还、搜索面板语言、无 console error |

审计原件在 `design-plans/ui-audit-v0.11.0.md`（高 4 / 中 9 / 低 7），执行清单在
`design-plans/ui-fix-checklist.md`（32 项全勾，含实测值）。

## 1. 为什么先写断言再改代码

审计报告是**文字**。文字的问题是：改完靠肉眼确认"看起来好了"，下一轮改动又悄悄退回去，而且没人会发现。
所以本版第一步不是改 CSS，是写脚本——**每一条审计发现都必须落成一条可证伪的断言**。

这一步的收益是具体的，不只体现在"仪式感"上。写断言的过程直接抓出**两个已有的假结论**：

### 1.1 假失败：底栏 153px

`mobile/bottom-chrome-height` 首跑报"格式条 50 + dock 103 = 153，超标"。屏幕上底栏显然只有一百出头。

根因：`buildDock()` 早就把 `#mobile-toolbar` **整体搬进了** `#mobile-dock`（`dock.appendChild(fmt)`），
而断言写成 `toolbar.h + dock.h` —— 同一个 50px 被算了两次。真实占用 103px。

如果这条断言没写、只是"我觉得底栏有点高"，就会去做一件错事：为了压 50px 去改格式条尺寸，
而实际上需要压的是 dock 里那两行的 padding。

### 1.2 假通过：预览"可折叠"

`mobile/layout-params-room` 判的是 `prev.querySelector('button')` 是否存在——而预览里的 `.ce-arrow`
（页码翻页）本来就是 `button`。条件**恒为真**，这条断言等于不存在，面板里参数区只剩 49% 也一直是绿的。

改成只认 `.ce-prev-toggle`，并且**真的点一下再复测**占比（收起后 33 / 638 / 800 = 80%）。

**结论写进了 docs/04 V64：断言要测用户看到的现象，不要测实现里的中间量。**
写新断言时先问一句：它测的是现象，还是我实现里的那个变量？

## 2. 关键取舍

### 2.1 对比度按语境分派，不是一律换 `--fg-muted`

最省事的改法是把所有偏淡的文字统一换成 `--fg-muted`。不行——因为**第三方 Typora 主题**会分别定义
`--fg-side-dim`（侧栏）、`--fg-chrome-dim`（菜单栏 / 状态栏）、`--fg-muted`（面板内）。三合一之后，
导入主题就失去了自适应的依据，表现为"某个区域突然全是同一个灰度"（`theme-adapter.ts` 就是为此存在的）。

所以按语境分派，并单独调深 `--fg-muted` 本身的两套取值：
github `#6e7781 → #57606a`（6.4:1）、night `#868e96 → #9aa4b0`（5.5:1）。

判据也统一了：**背景色向上回溯到第一个 `alpha > 0.5` 的祖先**，而不是假设背景是白的。
否则面板、遮罩、侧栏里的元素算出来的比值全是假的。

### 2.2 格式条是「6 + 更多」，不是"6 个按钮"

手机上格式条有 12 个按钮，385px 宽放不下 → 横向滚动 → 第 12 个被裁，而"横向能滑"这件事没有视觉提示，
用户会认为它就只有那些。两种解法：

- **换行成两行**：底栏高度直接翻倍，而底栏的每一像素都从正文里抢。
- **收进「更多」**：保持一行，把 6 个低频命令（任务列表 / 引用 / 表格 / 公式 / 链接 / 图片）搬进弹出层。

选了后者。实现上有个细节：`buildDock()` 是**搬家**（`appendChild` 移动节点）而不是复制——复制会留下
两套 DOM 和两套事件绑定，`main.ts` 里按 `data-cmd` 绑定的处理函数会执行两次（一次看不见，一次看得见）。

宽度用 `flex: 1 1 0; min-width: 0` 均分，实测 7 格各 52px，390–767px 任何宽度都不溢出。
多字形按钮（`•`/`☑`/`❝`）额外配 `inline-flex` 居中，否则按基线对齐会偏一格。

### 2.3 底栏高度是"总共多少"，不是"每层多高"

`--statusbar-h` 28px、格式条按钮 34px、action 行 48px + safe-area，单独看都合理，加起来 153px
（在 iPhone SE 的 667px 高度上是 23%）。改法不是砍某一个，而是：

- 格式条 50 → 34px 行高（12 个按钮收成 7 格，不再需要 40px 触屏高）
- action 行 48 → 44px + `padding` 收紧
- 合计 103px，在 390×844 上占 12%

同时保住了触屏下限：格式条按钮仍是 44×34，action 按钮 44×44，都 ≥ 苹果 HIG 的 44px 一维要求。

## 3. 三处坐标系 / 特异性事故（都写进了 docs/04）

### 3.1 面板分区跳转：`offsetTop` 相对谁

`.sheet-body` 不是定位元素，它的子元素 `offsetTop` 是相对 `offsetParent`（`.sheet`，`position: fixed`）算的，
**包含头部标题栏与 chip 条的高度**。直接 `scrollTop = sec.offsetTop` 每次多滚 100px 出头。

正确写法：`sec.offsetTop - body.offsetTop - 8`。

连带一个问题：`mobile-check.mjs` 的 `exportJumpsToFileSection` 原本写的是
`Math.abs(scrollTop - (sec.offsetTop - 8)) < 4 || scrollTop === 0` —— 它是按**有偏的旧公式**写的，
于是把 bug 当成了正确行为，修好之后反而报红。改成与公式无关的语义判定：
`gap = sec.offsetTop - body.offsetTop - scrollTop`，要求 `0 ≤ gap ≤ 24`（"这一节被滚到顶部了"）。

**断言依赖实现细节，就会把 bug 固化成规格。**

### 3.2 折叠样式被文件末尾的同权媒体查询顶掉

`.ce-prev-collapsed .ce-preview { height: auto }` 写完，点「收起预览」毫无反应，预览仍是 282px。

`style.css` 末尾还有一条 `@media (max-width:760px)` 的 `.ce-preview, .ce-wide .ce-preview { flex: 0 0 42% }`。
它和 `.ce-wide .ce-preview` **同特异性**，但位置更靠后 → 赢。

改法：把折叠样式提到 `.ce.ce-prev-collapsed .ce-preview`（0,3,0），顺序无关地压住所有 `.ce-wide .ce-preview`。

这是 v0.10.0 那次「`height:34vh` 被 `flex:0 0 38%` 顶掉」的**第二次发作**。所以这条不能靠"写在后面"，
必须靠特异性——**样式表的末尾可能在别人手里。**

### 3.3 `button` 不继承父级字号

chrome 里 13.3333px 的来源就是这个：`button` 用 UA 默认字号，不继承父级。非整值 + 高分屏 = 发虚。
本版把所有漏写的补上，并把阶梯收到 11 / 12.5 / 14 / 16 四档（`type` 组断言：chrome 里不允许出现第五个值）。

## 4. 为什么是 0.11.1

没有新功能、没有新 API、没有数据格式变化，只有"把已有的东西对齐"。对用户是"界面变好看了"，
对回归测试是"以后每次改动都必须仍然全绿"。按语义化版本属于补丁位。

唯一的例外是**搜索面板文案**第一次真正跟随界面语言——这不是新功能，而是原先的实现漏了一条路：
CM6 的搜索面板不走 `t()`，走 `EditorState.phrases` facet（17 个键）。facet 在建 state 时定下，
所以只能在 `createEditorState` 里塞，且切语言后要重建 state 才换文案。作为补丁修正发。

## 5. 验证

- 新增：`node core/ui-check.mjs` → 66 条全过、退出码 0
- 既有七套零回归：`verify`（15 步）/ `tabs-check` / `export-check` / `mobile-check` / `beautify-check` /
  `i18n-check`（7 语言 × **331** 键，0.11.0 是 308，净增 23）/ `tools/closetest.mjs --exe`（五场景）
- `npx tsc --noEmit` 与 `vite build` 通过
- i18n 键数变化来自：`tab.dropHint`(1) + `settings.groupUi` / `settings.groupImage`(2) + `search.*`(17)
  + `format.more`(1) + `card.hidePrev` / `card.showPrev`(2) = 23

## 6. 遗留

- 格式条哪 6 个常驻是**写死**的，没有 UI 配置入口。如果后续有用户反馈"我常用表格"，再考虑做成设置项
- `ui-check` 依赖本机 Edge/Chromium 与 `vite preview`，没进 CI（CI 只在容器里跑 `--selftest` 冒烟）
- `regression` 组 5 条是"防止改坏"的护栏，不是需求；扩充它们比扩充正向断言更划算
