# 关于 Lypora

**Lypora** 是一个独立实现的即时渲染 Markdown 编辑器：源码即真源，实时预览是装饰出来的，文件始终是纯 Markdown。

## 版本

- 当前版本：**{{version}}**
- 许可：**MIT**（见仓库 `LICENSE`）
- 代码仓库：`github.com/dr-bing-li/lypora`

## 独立实现声明

Lypora 是**独立实现**的软件，与任何第三方商业产品（包括但不限于 Typora）没有关联、没有授权关系，也不包含其任何代码或资源。

界面上的功能布局参考了同类编辑器的通用做法（菜单分组、快捷键习惯），这是交互惯例层面的借鉴；实现、数据结构、渲染管线均为自研：

- 编辑器内核：CodeMirror 6 + 自研装饰层（块级 `blockDecosField` + 行内 `livePreview`）。
- 排版引擎：自研模板系统（模板即数据 + 编译器 + 参数表，{{templates}} 套内置模板）。
- 主题适配：自研选择器 / 变量双向转译。

## 技术栈

| 层 | 用到的开源项目 |
| --- | --- |
| 编辑器 | CodeMirror 6、`@codemirror/lang-markdown` |
| 公式 | KaTeX |
| 桌面壳 | Electron |
| 移动壳 | Capacitor |
| 构建 | Vite、TypeScript |

完整第三方清单与许可见 `THIRD-PARTY-NOTICES.md`。

## 数据与隐私

- **不联网**：除了你主动打开的本地文件，应用不发任何请求；没有账号、没有埋点、没有遥测。
- **本地存储**：草稿、设置、自定义主题都存在本机（IndexedDB / localStorage）。
- **不上传**：文档内容不会离开这台设备。导出、分享都是你手动触发的本地动作。

## 平台

- Windows（安装版 / 便携版）
- macOS（arm64 / x64）
- Linux（tar.gz / AppImage / deb / rpm）
- Android（APK）
- 浏览器 / PWA（直接打开网页版，可离线）

## 已知限制

- PDF 导出在手机壳里不可用（WebView 没有系统打印管线），菜单里已置灰。
- 第三方 Typora 主题不会 100% 还原，见「主题使用与兼容性」。
- 排版参数不能改盒模型（宽度 / 内边距语义由尺寸决定），这是为了让预览与导出严格一致。

## 反馈

问题与建议请提到仓库的 Issues。提交时附上：版本号（本页右上）、平台、复现步骤；涉及排版/导出的问题请附一张截图。
