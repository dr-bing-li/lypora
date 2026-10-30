# Lypora

**跨端即时渲染 Markdown 编辑器** —— 一套 TypeScript 核心，同时交付 Windows 便携版、浏览器 / PWA 与 Android（APK）版本。

源码即文档：编辑区里写的是 Markdown 原文，光标移开就渲染成最终样式，光标落进去又显形为源码。
没有「左源码右预览」的分栏，也没有把 Markdown 转成富文本再序列化回去的往返损耗。

> 本项目为**独立实现**：全部代码、样式、图标均从零编写，不含任何第三方专有软件或商业产品的代码与资源。
> 设计取舍与法律边界见 [`docs/01-工程论证.md`](docs/01-工程论证.md)，开源自查见 [`docs/05-开源合规说明.md`](docs/05-开源合规说明.md)。

![Lypora 界面](docs/images/lypora.png)

---

## 快速开始

```bash
# 1. 构建核心（npm scripts 会先生成 KaTeX 内联样式，再 typecheck / build）
cd core && npm install && npm run typecheck && npm run build

# 2. Windows 便携版（一条命令出可分发的 exe）
cd .. && node tools/pack-win.mjs --zip
#    → release/Lypora/Lypora.exe          双击即用
#    → release/Lypora-0.4.0-win-x64.zip   可直接分发

# 3. 浏览器 / 手机预览（同网段）
cd core && npx vite preview --host 0.0.0.0 --port 4173
```

要求 Node.js ≥ 20。Windows 打包依赖 `desktop/node_modules/electron/dist`（`npm install` 会自动下载）。

---

## 界面结构

```
┌───────────────────────────────────────────────┐
│ 文件  编辑  段落  格式  显示  主题  帮助        │ ← 菜单栏（数据驱动，勾选态实时）
├───────────────┬───────────────────────────────┤
│ 侧栏 250px    │                               │
│ [大纲][文件树] │        编辑区                  │
│ [最近]        │                               │
├───────────────┴───────────────────────────────┤
│ 大纲 文件树              1,051 字 94 行 UTF-8 │ ← 状态栏
└───────────────────────────────────────────────┘
```

- **大纲在左侧栏**，与文件树是同一侧栏的两个视图（`Ctrl+Shift+1` / `Ctrl+Shift+2` / `Ctrl+Shift+L` 收起），点当前视图的图标即收起。
- **打开文件走菜单**（文件 → 打开 / 打开文件夹），不是侧栏按钮。
- 窄屏（≤860px）菜单栏变成可横向滑动的紧凑条，功能入口一个不丢。

---

## 已实现能力

**渲染**：标题 H1–H6、粗体、斜体、删除线、行内代码、链接、图片、引用、有序/无序/任务列表、围栏代码（语法高亮 + 语言标签）、表格、分割线、KaTeX 行内与块公式、Mermaid 图表

**交互**：块级/行内双态无缝切换、可点击任务复选框、列表自动续行、智能回车、Tab 缩进、格式化快捷键、查找替换、撤销重做、拖放打开/插图/导入主题

**字号缩放**：`Ctrl+滚轮` 连续平滑调字号（10–40px，触控板微增量也跟手，滚完 300ms 才落盘），
顶部浮层实时显示 `px · 百分比`；`Ctrl+Shift+=` / `Ctrl+-` 步进、`Ctrl+Shift+0` 回到 16px

**表格列宽**：悬停列间隔出现 `col-resize` 光标与竖向高亮线，拖动实时调整相邻两列宽度并在气泡里
显示 `px · 百分比`，双击分隔线均分；列宽按「表头 + 列数」记在本地，重开文档仍生效（不改 Markdown 源码）

**菜单与视图**：7 个顶级菜单（文件/编辑/段落/格式/显示/主题/帮助，含二级菜单）、左侧栏三视图、源代码模式、专注模式、打字机模式、全屏、字号缩放

**版式宽度可调**：显示 → 页面宽度（窄 620 / 标准 860 / 宽 1080 / 全宽 / 自定义），
或直接拖正文右边缘的竖条（双击把手回到标准），选择记在本地、重启保持

**关窗流程**：点叉号先问「保存并退出 / 不保存 / 取消」；选保存会先写盘再退出，
未命名文档走"另存为"、取消则留在窗口——不会出现点叉号没反应

**主题**：6 套内置（Github / Night / Pixyll / Whitey / Vue / Newsprint，样式全部原创）+ **第三方主题 CSS 导入**
（选文件或直接拖进来）。外部主题用的是另一套选择器与变量名，导入时经 `theme-adapter` 做
「选择器 + 变量」双转译与变量桥，实测 12 套第三方主题 12/12 通过（见 `docs/04` §3.3）

**文件与导出**：打开/保存/另存、最近文件、工作区文件树、导出 Markdown / 单文件 HTML / PDF（公式与字体在导出物内自包含）

---

## 三端形态

| | Windows 便携版 | Windows（Edge app 兜底） | Android (PWA) | Android (APK) |
|---|---|---|---|---|
| 无缝渲染 | ✅ | ✅ | ✅ | ✅ |
| 单文件读写 | ✅ 原生对话框 | ✅ | ✅ | ✅ |
| 目录树 | ✅ | ❌ | ❌ 沙盒限制 | ✅ |
| 离线 | ✅ | ✅ | ✅ Service Worker | ✅ |
| 文件关联 / 单实例 | ✅ | ❌ | — | ✅ |
| 包体 | 270MB（zip 111MB） | ~2MB | 0 | ~10MB |

APK 需 Android SDK（本机 `ANDROID_HOME` 为空），工程已就绪：见 `android/README.md`。

---

## 目录

| 路径 | 内容 |
|---|---|
| `docs/01-工程论证.md` | 为什么不做二进制逆向、选型论证（CM6 vs ProseMirror vs 自研）、跨端外壳决策、风险清单 |
| `docs/03-架构与技术规格.md` | 技术栈、项目结构、模块职责、布局与主题系统、打包约定、数据流 |
| `docs/04-验证方案.md` | 16 步自动验证（含导出公式专项）+ 12 套主题验收 + 关窗四场景、打包自检、流畅度定量、实测数字、**35 条踩坑记录**、手工验证清单、已知差异 |
| `docs/05-开源合规说明.md` | 许可证与知识产权自查：第三方依赖、素材来源、商标边界、遗留风险 |
| `core/` | 跨端核心（TypeScript + CodeMirror 6，零 UI 框架） |
| `desktop/` | Electron 外壳（原生对话框 / 目录树 / 单实例 / `--selftest`） |
| `tools/pack-win.mjs` | Windows 便携包一键打包（含 rcedit 写图标与版本信息） |
| `android/` | Capacitor 配置 + APK 出包说明 + PWA 安装说明 |

> `release/`、`artifacts/`、`docs/internal/` 为本地构建产物与内部资料，不纳入版本库（见 `.gitignore`）。

---

## 验证

```bash
# 网页层：15 步断言 + 截图（需先启动 vite preview）
cd core && node verify.mjs
node theme-check.mjs               # 第三方主题逐套验收（需自备主题目录，见下）

# 桌面层：关窗流程四场景（点叉号 = WM_CLOSE），退出码 + 磁盘内容判定
node tools/closetest.mjs          # 源码态 Electron
node tools/closetest.mjs --exe    # 打包产物

# 安装包层：让 exe 自己跑起来上报指标并截图
node tools/pack-win.mjs
env -u ELECTRON_RUN_AS_NODE ./release/Lypora/Lypora.exe --selftest --shot=shot.png
# 退出码：0 全绿 / 1 加载失败 / 2 有控制台错误

# 安装包层交互：CDP 连真进程，真实鼠标事件验证 Ctrl+滚轮与表格列宽
node tools/interacttest.mjs

# 流畅度定量：基线 / 派发对照 / 逐帧改字号 三段帧间隔 + longtask 计数
node tools/zoomperf.mjs

# 导出公式专项：导出的 HTML 单开 / @media print / 真 PDF / 打印 iframe 四条路径
cd core && node export-check.mjs

# 打包版「输出 PDF（打印）」：CDP 抓打印 iframe，断言 KaTeX 字体与版心宽度
cd .. && node tools/pdfexporttest.mjs
```

`theme-check.mjs` 需要一个第三方主题合集目录（授权链完整的合集不进仓库）：

```bash
THEMES_DIR=/path/to/themes node core/theme-check.mjs http://127.0.0.1:4173/
# 目录不存在时脚本打印 skipped 并以 0 退出
```

最近一次结果见 `docs/04-验证方案.md` §3，网页与安装包两层均为**控制台零报错**。

---

## 兼容性说明

Lypora 可以导入为**外部编辑器格式**编写的第三方主题 `.css`（常见于各类 Markdown 编辑器主题站）。
本项目与这些主题的作者、以及任何第三方编辑器厂商**均无关联**，也不代表其认可本项目；
导入仅发生在用户自己的机器上，仓库内不附带任何第三方主题文件。

---

## 许可证

以 [MIT](LICENSE) 协议发布，Copyright (c) 2026 Lypora contributors。

依赖与素材的许可证见 [`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md)：
运行期依赖（CodeMirror 6 / Lezer / KaTeX）全部为 MIT；Electron 分发物内含 Chromium 的第三方许可清单，
随包保留于 `release/Lypora/LICENSES.chromium.html`。

---

## 合规声明

- 本项目是**独立实现**，不是任何商业 Markdown 编辑器的派生作品，不含其源代码、CSS、图标或字体资源。
- 仓库内不出现任何第三方产品的名称、标识或截图；文档中一律以「参考实现」指代被借鉴交互的对象。
- 功能层面的兼容（快捷键、交互模型、排版观感）属于思想与方法的借鉴，不构成著作权侵权；
  但**请勿**向本仓库提交任何来自第三方产品的主题文件、图标或代码片段。
- 商标：本项目名 `Lypora` 与自带图标均为原创；如你 fork 后二次分发，请保留本节的合规声明。
