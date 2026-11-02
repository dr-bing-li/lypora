/**
 * 简体中文 —— **键集合的真源**。
 *
 * 约束（两道闸）：
 *   1. 其它语言对象被赋值给 `Dict = typeof zhCN`（见 i18n/index.ts），少一个键
 *      `npm run typecheck` 就报错；值的类型也必须是 string / {one, other}。
 *   2. 多出来的键类型系统查不出（结构类型），由 `node i18n-check.mjs` 报错。
 *
 * 占位符统一写成 `{name}`，参数由 `t(key, { name })` 传入；
 * 需要按数量变形的文案写成 `{ one: '…', other: '…' }`，由 `n` 选型。
 * 加新语言：复制本文件 → 逐键翻译 → 在 index.ts 的 DICTS 里注册。
 */
export default {
  app: {
    untitled: '未命名.md',
    newDoc: '新文档',
  },

  chip: {
    preview: '实时预览',
    source: '源代码',
  },

  dialog: {
    cancel: '取消',
    ok: '确定',
  },

  menu: {
    file: '文件',
    edit: '编辑',
    paragraph: '段落',
    format: '格式',
    view: '显示',
    theme: '主题',
    language: '语言',
    help: '帮助',
  },

  file: {
    create: '新建',
    open: '打开…',
    openFolder: '打开文件夹…',
    openFolderUnsupported: '打开文件夹（手机版不支持）',
    save: '保存',
    saveAs: '另存为…',
    exportMd: '导出 Markdown',
    exportHtml: '导出 HTML',
    exportPdf: '导出 PDF（打印）',
    exportPdfUnsupported: '导出 PDF（手机版不支持）',
  },

  edit: {
    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',
    find: '查找与替换',
  },

  paragraph: {
    heading: '标题 {level}',
    heading1: '一级标题',
    body: '段落',
    bullet: '无序列表',
    ordered: '有序列表',
    task: '任务列表',
    quote: '引用',
    code: '代码块',
    math: '公式块',
    table: '表格',
    hr: '分隔线',
  },

  format: {
    bold: '加粗',
    italic: '斜体',
    strike: '删除线',
    code: '行内代码',
    link: '超链接',
    image: '图像',
    clear: '清除格式',
  },

  view: {
    sidebar: '侧边栏',
    outline: '大纲',
    files: '文件树',
    source: '源代码模式',
    focus: '专注模式',
    typewriter: '打字机模式',
    pageWidth: '页面宽度',
    narrow: '窄（620）',
    standard: '标准（860）',
    wide: '宽（1080）',
    full: '全宽',
    custom: '自定义…',
    customTitle: '自定义页面宽度',
    customHint: '正文栏宽 {min}–{max} 像素；也可以直接拖正文右边缘的竖条。',
    widthGrip: '拖动调整页面宽度（双击恢复标准）',
    zoomIn: '放大',
    zoomOut: '缩小',
    zoomReset: '实际大小',
    fullscreen: '全屏',
  },

  theme: {
    importCustom: '导入自定义主题…',
    importCustomUnsupported: '导入自定义主题（手机版不支持）',
    customHelp: '自定义主题说明',
  },

  language: {
    followSystem: '跟随系统',
    changed: '界面语言：{name}',
  },

  help: {
    shortcuts: '快捷键',
    shortcutsTip: 'Ctrl+B 粗体 · Ctrl+K 链接 · Ctrl+1~6 标题 · Ctrl+/ 源码 · F8 专注 · F9 打字机 · Ctrl+S 保存',
    about: '关于 Lypora',
    aboutText: 'Lypora {version} · 独立实现的即时渲染 Markdown 编辑器 · MIT',
  },

  sidebar: {
    outline: '大纲',
    files: '文件树',
    recent: '最近文件',
    collapse: '收起侧栏',
    noMarkdown: '该文件夹下没有 Markdown 文件',
    noHeading: '文档无标题',
    noFolder: '尚未打开文件夹',
    noFolderHint: '用「文件 → 打开文件夹」选择目录',
    noRecents: '暂无最近文件',
  },

  dock: {
    open: '打开',
    save: '保存',
    outline: '大纲',
    export: '导出',
    theme: '主题',
    menu: '菜单',
    close: '关闭',
  },

  editor: {
    placeholder: '开始写点什么…  支持 Markdown、公式、表格、代码块',
    emptyHeading: '（空标题）',
    imageBroken: '🖼 {alt}（图片无法加载）',
    taskDone: '标记为未完成',
    taskTodo: '标记为已完成',
    columnGrip: '拖动调整列宽 · 双击均分',
    mermaidFallback: 'Mermaid 未加载，显示源码',
    linkText: '链接文字',
    imageAlt: '图片',
    tableCell: '列',
    tableBody: '内容',
    mathError: '公式错误：{msg}',
  },

  status: {
    words: { one: '{value} 字', other: '{value} 字' },
    lines: { one: '{value} 行', other: '{value} 行' },
    wordsTip: '中日韩字符 {cjk} · 西文词 {words} · 非空白字符 {chars}',
  },

  time: {
    justNow: '刚刚',
    minutes: '{n} 分钟前',
    hours: '{n} 小时前',
    days: '{n} 天前',
  },

  io: {
    markdownDoc: 'Markdown 文档',
  },

  toast: {
    opened: '已打开 {name}',
    created: '已新建文档',
    saved: '已保存 {name}',
    savedToAppDir: '已保存到应用文稿目录（{dir}）',
    theme: '主题：{name}',
    themeDeleted: '已删除主题 {name}',
    themeImported: '已导入主题 {name}，可在「主题」菜单切换',
    themeImportedForeign: '已导入「{name}」：第三方主题格式，映射 {kept}/{rules} 条规则、{vars} 个变量',
    themeTemplateCopied: '主题模板已复制到剪贴板，改值后存成 .css 再导入',
    themeDocRef: '主题变量见 docs/03-架构与技术规格.md',
    pageWidth: '页面宽度：{width}',
    pageWidthFull: '页面宽度：全宽',
    pageWidthDragged: '页面宽度 {px}px（双击把手恢复标准）',
    sourceOn: '源代码模式',
    sourceOff: '实时预览模式',
    focusOn: '专注模式开',
    focusOff: '专注模式关',
    typewriterOn: '打字机模式开',
    typewriterOff: '打字机模式关',
    folderUnsupported: '当前环境不支持目录访问（PWA 沙盒限制），可用桌面版或 Chrome/Edge',
    folderLoaded: { one: '已加载文件夹 {root}（{n} 个文档）', other: '已加载文件夹 {root}（{n} 个文档）' },
    readFailed: '读取失败',
    recordExpired: '记录已失效',
    pdfOnMobile: '手机版请先「导出 HTML」，再用浏览器或文档应用转 PDF',
    exportedMd: '已导出 Markdown',
    exportedMdShare: '已生成 Markdown，正在唤起分享…',
    exportedHtml: '已导出 HTML',
    exportedHtmlShare: '已生成 HTML，正在唤起分享…',
    printing: '正在唤起打印，选择"另存为 PDF"即可',
    noSelection: '没有选中内容',
    clipboardDenied: '当前环境不允许访问剪贴板，请用 Ctrl+C',
    clipboardReadDenied: '浏览器拒绝读取剪贴板，请用 Ctrl+V',
    selectToClear: '选中要清除格式的文字',
    imageInserted: '已插入图片（内嵌 base64）',
    fullscreenUnsupported: '当前环境不支持全屏',
    popupBlocked: '浏览器拦截了弹出窗口，请允许后重试',
    columnEven: '列宽已均分',
    columnPx: '列宽 {px} px（双击分隔线均分）',
  },
}
