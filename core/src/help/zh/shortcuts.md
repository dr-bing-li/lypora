# 快捷键

> 下表按 Windows / Linux 列出。macOS 上把 `Ctrl` 换成 `⌘`、`Alt` 换成 `⌥` 即可 —— 菜单里显示的也是换算后的写法（`Ctrl+Y` 这类平台差异见文末）。

## 文件

| 操作 | 快捷键 |
| --- | --- |
| 新建文档（新标签） | `Ctrl+N` |
| 新建窗口 | `Ctrl+Shift+N` |
| 打开文件 | `Ctrl+O` |
| 打开文件夹为工作区 | `Ctrl+Shift+O` |
| 保存 | `Ctrl+S` |
| 另存为 | `Ctrl+Shift+S` |
| 关闭当前标签 | `Ctrl+W` |
| 关闭窗口 | 点右上角叉号（会先确认未保存内容） |

`Ctrl+Shift+N` 与「仅多窗口」模式只在桌面版出现；浏览器与手机壳里没有系统窗口可开，菜单项会置灰。

## 编辑

| 操作 | 快捷键 |
| --- | --- |
| 撤销 / 重做 | `Ctrl+Z` / `Ctrl+Y` |
| 全选 | `Ctrl+A` |
| 剪切 / 复制 / 粘贴 | `Ctrl+X` / `Ctrl+C` / `Ctrl+V` |
| 查找（含替换） | `Ctrl+F` |

## 格式

| 操作 | 快捷键 |
| --- | --- |
| 粗体 | `Ctrl+B` |
| 斜体 | `Ctrl+I` |
| 删除线 | `Ctrl+Shift+X`（兼容旧习惯 `Alt+Shift+5`） |
| 行内代码 | `Ctrl+E` |
| 链接 | `Ctrl+K` |
| 插入图片 | `Ctrl+Shift+I` |

## 段落

| 操作 | 快捷键 |
| --- | --- |
| 一至六级标题 | `Ctrl+1` … `Ctrl+6` |
| 正文（取消标题） | `Ctrl+0` |
| 无序列表 | `Ctrl+Shift+]` |
| 有序列表 | `Ctrl+Shift+[` |
| 任务列表 | `Ctrl+Shift+9` |
| 引用 | `Ctrl+Shift+Q` |
| 表格 | `Ctrl+Shift+T` |
| 代码块 | `Ctrl+Shift+C` 或 `Ctrl+Enter` |
| 行内公式 / 公式块 | `Ctrl+Shift+M` |
| 分隔线 | `Ctrl+Shift+-` |
| 增加 / 减少缩进 | `Tab` / `Shift+Tab` |

## 视图

| 操作 | 快捷键 |
| --- | --- |
| 源码模式（关掉实时预览） | `Ctrl+/` |
| 专注模式 | `F8` |
| 打字机模式 | `F9` |
| 侧栏 | `Ctrl+Shift+L` |
| 大纲 / 文件树 | `Ctrl+Shift+1` / `Ctrl+Shift+2` |
| 放大 / 缩小字号 | `Ctrl+Shift+=` / `Ctrl+-` |
| 实际大小（16px） | `Ctrl+Shift+0` |
| 系统全屏 | `F11` |

字号也可以用 `Ctrl` + 鼠标滚轮连续调整，停止滚动后才落盘（滚动期间不写 localStorage，就是为了不卡）。

## 排版与帮助

| 操作 | 快捷键 |
| --- | --- |
| 打开排版（美化输出） | `Ctrl+Shift+P` |
| 帮助 | `F1` |

## 平台差异

- **重做**：Windows / Linux 是 `Ctrl+Y`，macOS 习惯 `⌘⇧Z`，菜单会按平台显示。
- **删除整词**：`Ctrl+Del` 在 macOS 上是 `⌥⌫`。
- 快捷键在输入框、弹窗里会被拦在弹窗一层，不会漏到编辑器（例如在「另存为」文件名框里按 `Ctrl+S` 不会触发保存）。
