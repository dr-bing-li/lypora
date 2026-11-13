# UI 审计整改清单（v0.11.0 → v0.11.1）

> 来源：[`ui-audit-v0.11.0.md`](ui-audit-v0.11.0.md) 的 32 项发现（含第 10 节的 DARK-1/2/3）
> 驱动脚本：[`core/ui-check.mjs`](../core/ui-check.mjs) —— **66 条断言**，每次改动后跑一遍
> 原则：**先有断言，再改代码**。每条都能被脚本证伪，不靠"看起来好了"。

## 怎么跑

```bash
cd core
node ui-check.mjs              # 自动探测/启动 preview，输出 PASS/FAIL 与退出码
node ui-check.mjs --only contrast   # 只跑一组：contrast|type|geometry|interactive|layout|mobile|regression
node ui-check.mjs --quiet      # 只打失败项与汇总
```

退出码 0 = 全过，1 = 有失败，可直接串进 CI。产物在 `artifacts/ui-check/<时间戳>/report.json`。

## 进度

| | 断言 | 失败 | 说明 |
|---|---|---|---|
| 基线（2026-11-12 改动前） | 64 | 40 | contrast 7 · type 2 · geometry 9 · interactive 9 · layout 2 · mobile 6 · regression 1 |
| 收官（2026-11-12 改动后） | 66 | **0** | 各组合计 17+3+19+10+2+10+5；净增 2 条是补出来的真断言（`layout-prev-toggle`、`sidebar-tab-indicator`） |

---

## 批次 A · 对比度与弱色令牌（最高性价比，纯样式）

- [x] **A1｜GLB-1（高）弱色令牌被用于承载信息的文字**
  - 位置：`core/src/style.css` 令牌区（`--fg-muted` / `--fg-faint`）
  - 基线：空状态 1.89、菜单快捷键 2.01、子菜单箭头 2.01、状态栏分隔符 2.01、确认框警告 2.01（浅）；空状态 2.55（深）
  - 改法：`--fg-faint` 退回只做分隔线/装饰；承载信息的文字全部改弱色语义令牌
    （侧栏 `--fg-side-dim`、chrome `--fg-chrome-dim`、面板内 `--fg-muted`，不一律换 `--fg-muted`，否则破坏导入主题的自适应）
  - 断言：`contrast/empty-hint/{light,dark}`、`contrast/menu-shortcut/light`、`contrast/submenu-arrow/light`、`contrast/status-sep/light`
  - **实测**：空状态 6.0（浅）/ 6.09（深）；快捷键 6.39；箭头 6.39；分隔符 6.39；`--fg-muted` 提到 github `#57606a`（6.4:1）

- [x] **A2｜DARK-1（中）深色状态栏 4.22:1**
  - 位置：`[data-theme='night'] --fg-muted`
  - 改法：`#868e96` → `#9aa4b0`（随 A1 一起，状态栏、标签标题、开关共用这个令牌）
  - 断言：`contrast/statusbar/dark`、`contrast/status-btn/dark`、`contrast/tab-title/dark`
  - **实测**：状态栏深色 5.54；标签标题 14.65 / 10.0

- [x] **A3｜DARK-2（中）排版面板分组标题与色值 2.32:1**
  - 位置：`.ce-label`、`.ce-hex`、`.ce-status`、`.ce-del`、`.cm-lang-label`、`.ce-style-name`
  - 改法：上述位置全部 `--fg-faint` → `--fg-muted`
  - 断言：`contrast/layout-group-title/dark`、`contrast/layout-hex/dark`
  - **实测**：分组标题 5.54、色值 5.54

- [x] **A4｜DLG-2（中）破坏性提示是全局最淡的一行字**
  - 位置：`ui/confirm.ts` 的 `<p>`、`.modal-mask` 的遮罩
  - 改法：警告句 `--fg` + 字号 11.5 → 12.5px 并允许换行；遮罩 alpha 0.28 → 0.45
  - 断言：`contrast/confirm-warning/light`、`contrast/confirm-mask-alpha`
  - **实测**：警告 14.65、遮罩 0.45

---

## 批次 B · 几何与点击热区

- [x] **B1｜DOC-1（高）861–1160px 正文两侧零留白**
  - 位置：`.editor-host`（`style.css`）
  - 基线：1100 / 1024 / 900 三档左右均 0，正文压着侧栏分割线
  - 改法：`max-width: calc(var(--content-width) + 2*clamp(16px,3vw,32px))` + `padding-inline: clamp(16px,3vw,32px)`
    —— 同时满足"最大宽度仍是 860"和"最小呼吸区 16px"，`--content-width` 仍是唯一真源
  - 断言：`geometry/doc-gutter@{1440,1280,1100,1024,900}`
  - **实测**：五档全部 ≥16px，`no-overflow@` 五档均无横向溢出

- [x] **B2｜MENU-4（低）菜单项 26px / 根按钮 24px**
  - 改法：菜单项 30px（`padding: 7px 8px`）、根按钮 28px（`padding: 6px 9px`）
  - 断言：`geometry/menu-item-height`、`geometry/menu-root-height`
  - **实测**：菜单项 30px、根按钮 28px

- [x] **B3｜MENU-1（中）子菜单指示器只有 4px 宽**
  - 位置：`ui/menubar.ts` 的 `.mi-arrow`
  - 改法：`›` 字符换成 12px chevron SVG（`flex: 0 0 12px` + 内联 `svg{width:12px;height:12px}`），
    hover 时箭头跟随变色；颜色部分在 A1
  - 断言：`geometry/submenu-arrow-size`（≥10×10）
  - **实测**：箭头 12×12

- [x] **B4｜STAT-2（中）状态栏开关只有 19px 高**
  - 改法：`--statusbar-h` 26 → 28px，开关字号 12.5px + `padding: 5px 6px`，热区 28px
  - 断言：`geometry/statusbar-hit`
  - **实测**：热区 26px+（实测值随字号 12.5 与 padding 5 组合落在 28px 栏高内）

- [x] **B5｜TAB-3（低）标签关闭按钮 18×18**
  - 改法：`.tab-item .tb-close` 18 → 24px
  - 断言：`geometry/tab-close-hit`
  - **实测**：24×24

- [x] **B6｜DOC-2（低）帮助文档表格比正文窄**
  - 基线：表格 642 vs 行宽 686
  - 改法：`.cm-table-stage:not(.manual) table { width: 100% }`
  - 断言：`geometry/help-table-width`（差 ≤8px）
  - **实测**：表格 860 = 行宽 860（差 0）

- [x] **B7｜TAB-2（低）单标签时标签栏整条空着**
  - 改法：不收起（收起会破坏 tabs-check 的"标签栏恒可见"契约），
    在空白区放 `.tb-hint`「拖文件到此处打开」（`aria-hidden`，多标签时自动隐藏）
  - 断言：无硬断言，靠 `regression/tab-item-height` 兜住标签几何
  - **实测**：标签栏仍恒在；单标签时提示条可见，加第二个标签即消失
    （v0.11.2 起标签条并进菜单行，该项改量单个标签高 **39px**）

- [x] **B8｜MOB-4（低）手机正文左右只有 13px**
  - 改法：`@media (max-width:480px)` 的 `.editor-host` 横向 padding 13 → 16px
  - 断言：`mobile/body-gutter`
  - **实测**：16 / 16

---

## 批次 C · 交互与无障碍

- [x] **C1｜TAB-1（高）`Ctrl+N` 不新增标签**
  - 位置：`core/src/main.ts` 全局键分支
  - 基线：菜单连点 1→2→3 ✅；`Ctrl+N` 1→1→1 ❌（走的是 `loadDocument()` 的"复用干净标签"分支）
  - 改法：改调 `newDocument()`；复用规则只留给"打开文件"
  - 断言：`interactive/ctrl-n-new-tab`
  - **实测**：1 → 2 → 3

- [x] **C2｜DLG-1（高）确认框没有对话框语义与焦点陷阱**
  - 位置：`ui/confirm.ts`
  - 基线：`role=null`；Tab×5 全部跑出框；关闭后焦点落在菜单栏
  - 改法：`role="dialog" aria-modal="true" aria-labelledby`；Tab/Shift+Tab 在三个按钮内首尾循环；
    Enter 触发当前焦点按钮（默认"保存"）；关闭后焦点还给打开前的元素
  - 断言：`interactive/dialog-role`、`dialog-focus-trap`、`dialog-focus-restore`
  - **实测**：`role=dialog aria-modal=true labelled=true`；初始焦点"保存"；
    Tab 轨迹 取消→不保存→保存→取消→不保存（全在框内）；关闭后焦点回 textbox

- [x] **C3｜GLB-3（中）没有自定义焦点环**
  - 改法：全局 `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`；编辑器容器保留 `outline:none`
  - 断言：`interactive/focus-ring-rule`
  - **实测**：规则存在

- [x] **C4｜MENU-3（低）菜单与整屏面板层级倒挂**
  - 基线：面板打开时菜单仍浮在上面（drop z=200 / mask z=420，依赖 z 值靠运气）
  - 改法：`openLayout()` 里先 `menubar.close()` 再开面板（比调 z 值可靠），三处入口统一走它
  - 断言：`interactive/panel-closes-menu`
  - **实测**：开面板时 `drop z=null`（菜单已关）

- [x] **C5｜DLG-3（中）搜索面板全英文**
  - 改法：`setup.ts` 里 `EditorState.phrases.of({...})`（17 键）进 `createEditorState`，词条进 7 个语言包
  - 注意：facet 建 state 时定死，切语言后 **不重建 state**（会丢撤销栈）→ 搜索面板文案跟随到下次建 state
  - 断言：`interactive/search-i18n`
  - **实测**：面板文案「下一个 上一个 全部 区分大小写 正则 全词 替换 全部替换」

- [x] **C6｜SIDE-1（中）空状态没有可点入口**
  - 改法：`emptyState()` 帮手 + 两行正文色文字 + 主按钮（分别直连 `doOpenWorkspace()` / `doOpen()`）
  - 断言：`interactive/empty-state-action`
  - **实测**：空状态按钮 1 个「打开文件夹…」（100px 宽）

- [x] **C7｜MENU-2（中）设置菜单缺分组**
  - 改法：`MenuEntry.group` + `.mi-group` 样式，加「界面」「图片」两个不可点小标题；
    手机面板同步（`renderEntries` 里 `it.group` 走 `.sheet-sub`，否则会生成无文字空行）
  - 断言：`geometry/settings-groups`
  - **实测**：分组标题 2 个，带子菜单 4 项

---

## 批次 D · 排版面板

- [x] **D1｜LAYOUT-1（中）数值只能拖不能输入**
  - 基线：6 个 `.ce-num`，可输入 0 个
  - 改法：数字改成 `input[type=number]`（回显单位并入 label），拖动与输入共用 `commit()`（clamp 到 min/max），
    Enter=blur 提交，打字过程中仅在范围内跟随
  - 断言：`layout/numeric-editable`
  - **实测**：6 个数值控件全部可输入

- [x] **D2｜LAYOUT-4（低）数值列不共线**
  - 基线：10 个数值，右边缘跨度 682px
  - 改法：`.ce-num-val` 与 `.ce-hex` 统一成右对齐定宽列（58px），`.ce-hex` 加 `margin-left:auto`
  - 断言：`layout/value-column-align`（跨度 ≤2px）
  - **实测**：10 个数值，右边缘 1 种位置，跨度 0px

- [x] **D3｜LAYOUT-3（低）模板卡片名 10.5px**
  - 改法：`.ce-style-name` 10.5 → 11px
  - 断言：`type/template-name`
  - **实测**：11px

---

## 批次 E · 手机外壳

- [x] **E1｜MOB-1（中）底部两层 153px，格式条第 12 个被裁**
  - 基线：格式条 50 + dock 103 = 153；12 个按钮横向溢出
  - 改法：格式条只留 6 个高频 + 「更多」入口，其余 6 个按钮**整体搬家**（不复制）进 `.tb-more` 弹出层，
    点任一条命令即收起；按钮改 `flex: 1 1 0; min-width: 0` 均分屏宽，任何机型都不会横向溢出
  - **顺手修了断言**：`.mobile-toolbar` 早就被 `mobile.ts` 搬进 `#mobile-dock`，
    原断言把工具栏算了两次（103 报成 153）—— 改成"工具栏在 dock 内就只算 dock 高"
  - 断言：`mobile/bottom-chrome-height`、`mobile/toolbar-no-clip`
  - **实测**：底栏 103px（含格式条 50px）；格式条 7 个按钮、横向溢出 false；
    7 格实测等宽 52px；弹出层 61px（6 个命令一行排开，点完自动收起）

- [x] **E2｜MOB-2（中）菜单面板是 5015px 长列表**
  - 基线：9 分区 93 行，可视 599px，无跳转
  - 改法：顶部 `.sheet-chips` 横向分区目录（与分区同源于 `menus`，切语言一起重画），
    点一下平滑滚到该段并高亮；手动滑动时 chip 跟着亮
  - **顺手修了坐标系**：`offsetTop` 相对 `.sheet`（含头部 + chip 条），跳转必须减 `body.offsetTop`，
    否则每次都多滚 100px 出头（`mobile-check` 的旧断言正好把这个偏移当成"正确"）
  - 断言：`mobile/sheet-section-jump`
  - **实测**：chip 9 个；跳到「主题」后 topSec=theme、chipOn=theme；跳到「格式」后 gap=8px（预期呼吸位）

- [x] **E3｜MOB-3（中）+ STAT-3（低）手机顶栏只有一行 13px 灰字**
  - 基线：顶栏高 44 但左内边距 0；无字数显示（状态栏在 ≤860px 整条隐藏）
  - 改法：`≤767px` 顶栏 `padding-left: 16px`（与正文左对齐）；新增 `.mb-words`，由 `updateCounts()` 同源写入，
    仅在手机断点显示（桌面零成本）
  - 断言：`mobile/topbar-padding`、`mobile/topbar-words`
  - **实测**：左内边距 16px；顶栏显示「1,050 字」

- [x] **E4｜LAYOUT-2（中）手机排版面板被预览挤掉一半**
  - 基线：预览 282 / 参数 389（占 49%，内容 1851px 要滚 4.8 屏）
  - 改法：页码行加 `.ce-prev-toggle`「收起预览 / 展开预览」，收起后预览只剩 33px 的页码条
  - **坑**：文件末尾还有一条 `@media(max-width:760px)` 的 `.ce-preview { flex: 0 0 42% }`，
    与 `.ce-wide .ce-preview` 同权且更靠后 → 折叠样式必须写到 `.ce.ce-prev-collapsed` 才压得住
  - **顺手修了断言**：原 `collapsible` 写成 `prev.querySelector('button')`，页码翻页箭头也是 button → 永远真。
    改成只认 `.ce-prev-toggle`，并且**真的点一下再复测**
  - 断言：`mobile/layout-prev-toggle`、`mobile/layout-params-room`（≥55%）
  - **实测**：收起后预览 33 / 参数 638 / 面板 800 = **80%**

---

## 批次 F · 字号刻度与其余低优先

- [x] **F1｜GLB-2（中）字号同时存在 7 档**
  - 基线：11 / 11.5 / 12 / 12.5 / 13 / 13.3333 / 14
  - 改法：收敛成 11（徽标/快捷键）/ 12.5（chrome 正文）/ 14（标题）/ 16（正文）；
    `sidebar-tabs .tab` 与 `.icon-btn` 必须显式写 `font-size`，否则吃 UA 默认 13.3333px
  - 断言：`type/chrome-ladder`
  - **实测**：chrome 字号只剩 11 / 12.5 / 14 / 16 四档

- [x] **F2｜STAT-1（中）只读值与开关同字号同色**
  - 改法：只读值（`#st-words` / `#st-lines`）用 `--fg-chrome-dim`，可点开关用 `--fg-chrome`；
    开关开启态补 `accent-text` 12% 底色 —— 靠"色 + 底"两层区分，不只靠色
  - 断言：`geometry/statusbar-distinct`
  - **实测**：只读值 `rgb(87,96,106)` vs 开关 `rgb(36,41,47)`

- [x] **F3｜SIDE-2（低）三个页签只有图标**
  - 改法：选中态补 2px 实线指示条（`::after`，左右各留 6px，距底 2px，色 `--accent-side`）
  - 断言：`geometry/sidebar-tab-indicator`（**新加**，原来只写"目视"）
  - **实测**：指示条 2px、3 个页签

- [x] **F4｜SIDE-3（低）大纲深层级只靠缩进**
  - 改法：缩进 12px/级 → 8px/级（8/16/24/32/40/48），5–6 级改用 `--fg-muted`，删掉 5–6 级的 12px 字号
  - 断言：无硬断言（目视 + 截图）
  - **实测**：6 级缩进 8→48px 等差，5–6 级文字降为次要色

- [x] **F5｜DARK-3（低）面板分区底色亮度差仅 4%**
  - 改法：`.ce-preview` 再暗一档
  - 断言：`type/layout-layer-dark`（亮度差 ≥8%）
  - **实测**：深色预览/参数区亮度差 14.3%

---

## 批次 G：菜单与标签并排（v0.11.2 追加需求）

- [x] **G1｜桌面顶栏两行改一行**
  - 位置：`index.html` 的 `<header class="menubar">`、`src/style.css` 的 `.tabbar` / `.menubar-items`
  - 基线：菜单栏 40px + 标签栏 34px = 74px，正文区从 y=74 开始
  - 改法：`#tabbar` 移入 `.menubar`（菜单项与右侧信息之间），`flex: 1 1 0` 吃满剩余宽度、
    `align-self: stretch` 撑满行高；菜单与右侧信息 `flex: 0 0 auto` 永不收缩；
    多标签时隐藏顶栏右侧重复的「文件名 + `*`」（`body.tabs-on`）
  - 断言：`geometry/menu-tabs-one-row`（内嵌 + 单行 ≤48px + 间距 ≥4px + 菜单溢出 ≤0）
  - **实测**：顶栏 40px 单行，正文区 y=40（省下 34px）；标签内嵌、中线差 0px、菜单溢出 0px；
    1440 / 1100 / 900 三个宽度均无重叠，900px 时标签条内部横滑（宽 408px）
  - 手机端：`.tabbar` 恒 `hidden`（`innerWidth > 860` 才显示），顶栏仍 44px、
    `doc-title` 与字数照旧 —— 实测零变化

---

## 完成定义

- [x] `node ui-check.mjs` **67 条全过**，退出码 **0**
  （contrast 17 · type 3 · geometry 20 · interactive 10 · layout 2 · mobile 10 · regression 5）
- [x] 七套既有验收无回归：`verify` / `tabs-check` / `export-check` / `mobile-check` / `beautify-check` / `i18n-check` / `closetest`
  - **实测**：七套全部 `pass: true` / 退出码 0；`i18n-check` 键数 **331**（v0.11.0 是 308，净增 23：
    `search.*` 17 + `tab.dropHint` 1 + `settings.groupUi/groupImage` 2 + `format.more` 1 + `card.hidePrev/showPrev` 2）
  - `closetest` 五场景全绿（`dirty-multi` 断言 names 长度 2 → `功能演示.md/未命名.md`）
- [x] `tsc --noEmit` 与 `vite build` 通过
- [x] 关键交互手测/机测：新建（Ctrl+N 真增标签）、切标签、关标签三键框、帮助只读、排版整屏（含预览折叠）、
  手机菜单分区跳转、手机「更多格式」弹出层（开→点命令→自动收起）
- [x] 文档同步：`docs/04-验证方案.md` 记 `ui-check` 的 V 条目与用法，`README.md` 验收清单加一行

## 遗留与提醒

- C5 的搜索面板文案是 `EditorState.phrases` facet，**切语言后不重建 state 就不会变**
  （重建会丢撤销栈）。这是有意的取舍，不是漏改。
- `layout-params-room` 与 `bottom-chrome-height` 两条断言原先各自有一个"假通过/假失败"，
  已在 E1/E4 里改成实测语义。以后写断言先问一句：**它测的是现象，还是我实现里的那个中间量？**
