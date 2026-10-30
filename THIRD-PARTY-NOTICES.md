# 第三方组件与素材声明（THIRD-PARTY NOTICES）

Lypora 本体以 MIT 协议发布（见 `LICENSE`）。本文件列出随项目分发或构建时使用的第三方组件，
以及各自的许可证与义务。**本仓库不附带任何第三方主题文件、图标或字体资源。**

## 1. 运行期依赖（会进入最终产物）

| 组件 | 版本 | 许可证 | 说明 |
|---|---|---|---|
| `@codemirror/*`（state / view / language / commands / search / lang-markdown / lang-css / lang-javascript） | 6.x | MIT | 编辑器内核与语言包 |
| `@lezer/*`（common / highlight / markdown） | 1.x | MIT | 增量语法树与高亮 |
| `katex` | 0.16.x | MIT | 公式渲染；其自带的 KaTeX_* 字体同样以 MIT 分发，构建时以 `data:` URL 内联进导出的单文件 HTML |

以上组件的版权声明随 `node_modules` 中的 `LICENSE` 文件分发。二次分发时应保留这些声明；
本项目在 `core/src/io/export.ts` 与 `core/scripts/gen-katex-css.mjs` 中仅调用其公开 API。

## 2. 构建期依赖（不进入产物）

| 组件 | 许可证 | 备注 |
|---|---|---|
| `vite` | MIT | 打包器 |
| `typescript` | Apache-2.0 | 若二次分发其代码需保留 NOTICE，本项目仅在构建时调用 |
| `playwright-core` | Apache-2.0 | 自动化验收脚本 |
| `electron` / `rcedit` | MIT | 桌面外壳与图标资源写入 |
| `lightningcss` | MPL-2.0 | vite 的 CSS 转换器；其产物（CSS 文本）不受 MPL 传染，仅当分发 lightningcss 本体时才需附带源码 |

## 3. 桌面分发物中的 Chromium / Electron

`release/Lypora/` 是由 Electron 官方发行包复制而成，内含：

- `LICENSES.chromium.html` —— Chromium 及其全部第三方组件的许可证清单（BSD 类、MIT、Apache-2.0 等）。
- `LICENSE` / `LICENSES.chromium.html` 必须随 exe 一起分发，**不要删除**。

Electron 本体为 MIT；Chromium 的多重许可证要求「保留版权与许可声明」，本项目已按原样保留文件。

## 4. 主题与素材

- **内置 6 套主题**（Github / Night / Pixyll / Whitey / Vue / Newsprint）：`core/src/style.css` 中的
  CSS 变量块，全部为本项目自行编写。主题**名称**为通用词（Github、Night、Vue 等），
  不代表与同名项目或公司存在关联或获得其认可。
- **第三方主题导入**：功能上支持用户导入外部编辑器格式的 `.css`。仓库内**不包含**任何这类文件；
  用户自行导入的主题，其授权由用户与该主题作者之间的许可决定。
- **图标**：`desktop/icon.ico` 与 `core/public/icons/*.png` 为本项目自绘（蓝色圆角方块 + 白色文本行），
  未使用任何第三方产品的 logo 或商标图形。
- **文档与截图**：`docs/` 下的截图均为本项目自身界面的截图。

## 5. 字体

项目**不打包任何字体文件**。界面字体走系统字体栈（`-apple-system` / `Segoe UI` / 思源黑体等本机可用字体），
导出的 PDF 由 Chromium 打印引擎嵌入本机字体子集，与 Lypora 的许可证无关。
唯一例外是 KaTeX 数学字体，随 `katex` 包以 MIT 分发（见上表）。

## 6. 商标

`Lypora` 名称与自带图标为本项目原创。项目不声称与任何第三方编辑器、主题作者或公司存在关联。
若你认为本仓库包含应署名的内容，请提 issue，我们会补充署名或移除该内容。
