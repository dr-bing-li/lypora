import './style.css'
import { EditorView } from '@codemirror/view'
import { undo, redo, selectAll } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { createEditorState } from './editor/setup'
import { previewSettings, refreshPreview } from './editor/live-preview'
import { cmd } from './editor/commands'
import { extractOutline, renderOutline, highlightOutline, type OutlineItem } from './ui/outline'
import { createMenubar, type MenuDef } from './ui/menubar'
import {
  BUILTIN_THEMES,
  listCustomThemes,
  addCustomTheme,
  removeCustomTheme,
  applyCustomCss,
  THEME_TEMPLATE,
  type ThemeStats,
} from './ui/themes'
import { toast } from './ui/toast'
import { initMobileShell } from './ui/mobile'
import { openFile, saveFile, openWorkspace, desktop, type WorkspaceEntry } from './io/files'
import { isNative, nativePlatform } from './io/native'
import { exportHtml, exportMarkdown, exportPdf } from './io/export'
import { putDoc, listDocs, getDoc, readSetting, writeSetting, migrateLegacySettings } from './io/store'
import { SAMPLE_MD, SAMPLE_NAME } from './sample'
import { fmtNum } from './util'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

/** 内置主题 id 来自 ui/themes.ts（与参考实现同序的 6 套）；自定义主题用 `custom:<名称>` */
type ThemeName = string

interface AppState {
  view: EditorView | null
  fileName: string
  handle?: FileSystemFileHandle
  path?: string
  dirty: boolean
  outline: OutlineItem[]
  docId: string
  fontSize: number
}

// 更名前缀迁移必须早于任何 readSetting（下面的 app 初始化就会读 fontSize）
migrateLegacySettings()

const app: AppState = {
  view: null,
  fileName: '未命名.md',
  dirty: false,
  outline: [],
  docId: '',
  fontSize: readSetting('fontSize', 16),
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
function boot(): void {
  applyTheme(readSetting<ThemeName>('theme', 'github'), true)
  applyFontSize(readSetting('fontSize', FONT_STD))
  fontReady = true
  initPageWidth()

  const host = $('editor-host')
  const state = createEditorState(SAMPLE_MD, {
    onChange: (doc) => {
      setDirty(true)
      updateCounts(doc)
      scheduleOutline(doc)
      scheduleAutosave()
    },
    onCursor: (line, _col) => {
      void line
      applyTypewriter()
      highlightOutline($('outline-body'), app.view?.state.selection.main.head ?? 0, app.outline)
    },
    onSave: () => void doSave(false),
    onSourceToggle: () => toggleSource(),
  }, SAMPLE_MD.indexOf('\n') + 1)

  app.view = new EditorView({ state, parent: host })
  app.view.focus()

  // 首屏示例文档以实名呈现。docId 一并给定，否则首次编辑时自动保存会落到
  // 空 id 上（最近文件里出现一条无名记录）。详见 sample.ts 的 SAMPLE_NAME 注释。
  app.fileName = SAMPLE_NAME
  app.docId = `doc:${SAMPLE_NAME}`

  updateCounts(SAMPLE_MD)
  refreshOutline(SAMPLE_MD)
  bindUI()
  showPane('outline')
  syncStatusToggles()
  // 窄屏默认收起侧栏（移动端侧栏是覆盖层，展开会挡住正文）
  if (window.innerWidth <= 860) $('sidebar').classList.add('collapsed')
  void renderRecents()
  registerServiceWorker()

  // 桌面版：接收"用本应用打开文件"（双击 .md / 命令行参数 / 第二实例转发）
  desktop()?.onOpenPath((payload) => {
    loadDocument(payload.content, payload.name, undefined, payload.path)
    toast(`已打开 ${payload.name}`)
  })
}

/* ------------------------------------------------------------------ *
 * 标题 / 脏标记 / 统计
 * ------------------------------------------------------------------ */
function setDirty(v: boolean): void {
  if (app.dirty === v) return
  app.dirty = v
  $('dirty-dot').hidden = !v
  updateTitle()
}

function updateTitle(): void {
  const name = app.fileName
  $('doc-title').textContent = name
  document.title = `${app.dirty ? '● ' : ''}${name} — Lypora`
}

function updateCounts(doc: string): void {
  const cjk = (doc.match(/[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const words = (doc.replace(/[\u3400-\u9fff]/g, ' ').match(/[A-Za-z0-9][A-Za-z0-9_'’-]*/g) || []).length
  const chars = doc.replace(/\s/g, '').length
  const lines = doc.split('\n').length
  const st = $('st-words')
  st.textContent = `${fmtNum(chars)} 字`
  st.title = `中日韩字符 ${fmtNum(cjk)} · 西文词 ${fmtNum(words)} · 非空白字符 ${fmtNum(chars)}`
  $('st-lines').textContent = `${fmtNum(lines)} 行`
}

/* ------------------------------------------------------------------ *
 * 大纲
 * ------------------------------------------------------------------ */
let outlineTimer: number | undefined
function scheduleOutline(doc: string): void {
  if (outlineTimer !== undefined) clearTimeout(outlineTimer)
  outlineTimer = window.setTimeout(() => refreshOutline(doc), 150)
}

function refreshOutline(doc: string): void {
  app.outline = extractOutline(doc)
  renderOutline(app.outline, $('outline-body'), (from) => {
    app.view?.dispatch({ selection: { anchor: from }, scrollIntoView: true })
    app.view?.focus()
  })
  highlightOutline($('outline-body'), app.view?.state.selection.main.head ?? 0, app.outline)
}

/* ------------------------------------------------------------------ *
 * 主题 / 字号
 * ------------------------------------------------------------------ */
function currentTheme(): ThemeName {
  return readSetting<ThemeName>('theme', 'github')
}

function applyTheme(theme: ThemeName, silent = false): ThemeStats | null {
  const builtin = BUILTIN_THEMES.find((t) => t.id === theme)
  const custom = theme.startsWith('custom:')
    ? listCustomThemes().find((t) => `custom:${t.name}` === theme)
    : undefined
  const id = builtin ? builtin.id : custom ? 'github' : 'github'

  document.documentElement.dataset.theme = id
  // 自定义主题叠在内置变量之上，所以它只需要覆盖想改的变量
  const stats = applyCustomCss(custom ? custom.css : null)

  const dark = BUILTIN_THEMES.find((t) => t.id === id)?.dark ?? false
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#282c34' : '#ffffff')

  writeSetting('theme', theme)
  toast(`主题：${custom ? custom.name : builtin ? builtin.label : 'Github'}`, 1600, silent)
  return stats
}

/* ------------------------------------------------------------------ *
 * 字号（三个入口共用同一个 --content-font-size）
 *   ① 显示 → 放大 / 缩小 / 实际大小（Ctrl+Shift+=、Ctrl+-、Ctrl+Shift+0）
 *   ② Ctrl + 滚轮：连续、平滑、按滚动距离成比例变化
 *   ③ 演示/截图脚本通过 CSS 变量直接改（无需接入）
 *
 * 关键的"不卡顿"设计：字号只是 CSS 变量，EditorView.theme 里 fontSize 写的是
 * var(--content-font-size)，所以改变量只会触发一次样式重算 + 重排，不需要
 * view.dispatch/reconfigure（那会重建整个编辑器）。滚轮期间只在 rAF 里改变量，
 * 不写 localStorage（同步 IO 是滚轮卡顿的典型来源），停止滚动 300ms 后落盘。
 * ------------------------------------------------------------------ */
const FONT_MIN = 10
const FONT_MAX = 40
const FONT_STD = 16
/** 鼠标滚轮一格（Chromium 下 deltaY=100）≈ 1.5px；触控板的小 delta 会累加成连续变化 */
const FONT_PX_PER_WHEEL_PX = 0.015

let fontReady = false

function clampFont(px: number): number {
  return Math.round(Math.min(FONT_MAX, Math.max(FONT_MIN, px)) * 10) / 10
}

function applyFontSize(px: number, persist = true): void {
  app.fontSize = clampFont(px)
  wheelTarget = app.fontSize
  document.documentElement.style.setProperty('--content-font-size', `${app.fontSize}px`)
  if (persist) writeSetting('fontSize', app.fontSize)
  if (fontReady) showFontOsd(app.fontSize)
}

let osdTimer = 0
let osdText = ''

/** 顶部浮层：滚动过程中持续刷新，松手后淡出（对标参考实现的缩放提示） */
function showFontOsd(px: number): void {
  const el = document.getElementById('font-osd')
  if (!el) return
  const text = `${px % 1 === 0 ? px : px.toFixed(1)} px · ${Math.round((px / FONT_STD) * 100)}%`
  if (text !== osdText) {
    osdText = text
    el.textContent = text
  }
  el.classList.add('on')
  clearTimeout(osdTimer)
  osdTimer = window.setTimeout(() => {
    osdText = ''
    el.classList.remove('on')
  }, 900)
}

/* ------------------------------------------------------------------ *
 * Ctrl + 滚轮：平滑调字号
 * deltaMode 归一化 → 线性换算 → rAF 合并 → 落盘节流
 * ------------------------------------------------------------------ */
let wheelTarget = FONT_STD
let wheelRaf = 0
let wheelPersistTimer = 0

function initWheelZoom(): void {
  wheelTarget = app.fontSize
  // 捕获阶段拦截：必须在 Chromium 的「Ctrl+滚轮整页缩放」之前 preventDefault，
  // 否则字号变化会和页面 zoom 叠加（Electron 里表现为界面整体忽大忽小）。
  window.addEventListener(
    'wheel',
    (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const target = e.target as Element | null
      if (!target || typeof target.closest !== 'function' || !target.closest('.editor-wrap')) return
      e.preventDefault()

      let dy = e.deltaY
      if (e.deltaMode === 1) dy *= 16 // 行 → 像素
      else if (e.deltaMode === 2) dy *= window.innerHeight // 页 → 像素
      if (!dy) return

      wheelTarget = clampFont(wheelTarget - dy * FONT_PX_PER_WHEEL_PX)

      // 一帧只应用一次：滚轮事件频率可达 120Hz，逐事件写样式会重复重排
      if (!wheelRaf) {
        wheelRaf = requestAnimationFrame(() => {
          wheelRaf = 0
          applyFontSize(wheelTarget, false)
        })
      }
      clearTimeout(wheelPersistTimer)
      wheelPersistTimer = window.setTimeout(() => writeSetting('fontSize', app.fontSize), 300)
    },
    { passive: false, capture: true },
  )
}

/* ------------------------------------------------------------------ *
 * 页面宽度（对标参考实现的正文栏宽可调）
 * 三个入口共用同一个 --content-width：
 *   ① 显示 → 页面宽度（窄/标准/宽/全宽/自定义）
 *   ② 正文右边缘的拖动把手（任意像素）
 *   ③ 双击把手回到标准
 * ------------------------------------------------------------------ */
type PageWidth = number | 'full'

const WIDTH_MIN = 520
const WIDTH_MAX = 1600
const WIDTH_STD = 860
const WIDTH_PRESETS: { label: string; value: PageWidth }[] = [
  { label: '窄（620）', value: 620 },
  { label: '标准（860）', value: WIDTH_STD },
  { label: '宽（1080）', value: 1080 },
  { label: '全宽', value: 'full' },
]

function clampWidth(n: number): number {
  return Math.round(Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, n)))
}

function currentPageWidth(): PageWidth {
  const raw = readSetting<number | string>('pageWidth', WIDTH_STD)
  if (raw === 'full') return 'full'
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? clampWidth(n) : WIDTH_STD
}

function applyPageWidth(w: PageWidth, silent = false, persist = true): void {
  const v: PageWidth = w === 'full' ? 'full' : clampWidth(w)
  document.documentElement.style.setProperty('--content-width', v === 'full' ? '100%' : `${v}px`)
  document.body.classList.toggle('full-width', v === 'full')
  if (persist) writeSetting('pageWidth', v)
  if (!silent) toast(v === 'full' ? '页面宽度：全宽' : `页面宽度：${v}px`, 1500)
}

/**
 * 启动时的宽度初始化。
 * 只有用户**明确选过**宽度才写行内样式；否则留空，让主题自带的
 * `#write{max-width}`（经适配层转成 --content-width）生效——
 * 行内样式的优先级高于任何样式表，一旦无脑写入就把主题宽度废掉了。
 */
function initPageWidth(): void {
  const stored = readSetting<number | string | null>('pageWidth', null)
  if (stored == null) {
    document.documentElement.style.removeProperty('--content-width')
    return
  }
  applyPageWidth(stored === 'full' ? 'full' : Number(stored), true, false)
}

/** 拖动把手：向右拖 = 变宽（对称居中，所以按中心距离反推宽度） */
function bindWidthGrip(): void {
  const grip = $('width-grip')
  const badge = $('width-badge')
  const wrap = $('editor-wrap')
  let dragging = false
  let pending: number = typeof currentPageWidth() === 'number' ? (currentPageWidth() as number) : WIDTH_STD

  const paintBadge = (px: number) => {
    const r = wrap.getBoundingClientRect()
    badge.hidden = false
    badge.textContent = `${px}px`
    badge.style.top = `${r.top + 14}px`
    badge.style.left = `${Math.min(window.innerWidth - 66, r.left + r.width / 2 + px / 2 + 10)}px`
  }

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    dragging = true
    grip.classList.add('dragging')
    grip.setPointerCapture(e.pointerId)
  })

  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return
    const r = wrap.getBoundingClientRect()
    const center = r.left + r.width / 2
    pending = clampWidth(Math.abs(e.clientX - center) * 2)
    document.documentElement.style.setProperty('--content-width', `${pending}px`)
    document.body.classList.remove('full-width')
    paintBadge(pending)
  })

  const end = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    grip.classList.remove('dragging')
    badge.hidden = true
    try {
      grip.releasePointerCapture(e.pointerId)
    } catch {
      /* 指针已释放 */
    }
    applyPageWidth(pending, true)
    toast(`页面宽度 ${pending}px（双击把手恢复标准）`, 1800)
  }
  grip.addEventListener('pointerup', end)
  grip.addEventListener('pointercancel', end)

  grip.addEventListener('dblclick', () => applyPageWidth(WIDTH_STD))
}

/** 极简数字输入弹窗（Electron 里没有 window.prompt，必须自绘） */
function askNumber(o: { title: string; hint: string; value: number; suffix?: string }): Promise<number | null> {
  return new Promise((resolve) => {
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    const box = document.createElement('div')
    box.className = 'modal'
    const h = document.createElement('h3')
    h.textContent = o.title
    const p = document.createElement('p')
    p.textContent = o.hint
    const input = document.createElement('input')
    input.type = 'number'
    input.min = String(WIDTH_MIN)
    input.max = String(WIDTH_MAX)
    input.step = '10'
    input.value = String(o.value)
    const actions = document.createElement('div')
    actions.className = 'modal-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = '取消'
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'primary'
    ok.textContent = '确定'
    actions.append(cancel, ok)
    box.append(h, p, input, actions)
    mask.append(box)
    document.body.append(mask)

    const finish = (v: number | null) => {
      window.removeEventListener('keydown', onKey, true)
      mask.remove()
      resolve(v)
    }
    const commit = () => {
      const n = Number(input.value)
      finish(Number.isFinite(n) && n > 0 ? clampWidth(n) : null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish(null)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        commit()
      }
    }
    window.addEventListener('keydown', onKey, true)
    ok.addEventListener('click', commit)
    cancel.addEventListener('click', () => finish(null))
    mask.addEventListener('mousedown', (e) => {
      if (e.target === mask) finish(null)
    })
    input.focus()
    input.select()
  })
}

/* ------------------------------------------------------------------ *
 * 视图模式
 * ------------------------------------------------------------------ */
function pushPreviewSettings(): void {
  app.view?.dispatch({ effects: refreshPreview.of(null) })
}

function toggleSource(): void {
  previewSettings.sourceMode = !previewSettings.sourceMode
  $('editor-host').classList.toggle('source-mode', previewSettings.sourceMode)
  $('btn-source').classList.toggle('on', previewSettings.sourceMode)
  $('chip-mode').textContent = previewSettings.sourceMode ? '源代码' : '实时预览'
  pushPreviewSettings()
  toast(previewSettings.sourceMode ? '源代码模式' : '实时预览模式')
}

function toggleFocus(): void {
  previewSettings.focusMode = !previewSettings.focusMode
  $('btn-focus').classList.toggle('on', previewSettings.focusMode)
  pushPreviewSettings()
  toast(previewSettings.focusMode ? '专注模式开' : '专注模式关')
}

function toggleTypewriter(): void {
  previewSettings.typewriter = !previewSettings.typewriter
  $('btn-typewriter').classList.toggle('on', previewSettings.typewriter)
  applyTypewriter()
  toast(previewSettings.typewriter ? '打字机模式开' : '打字机模式关')
}

function applyTypewriter(): void {
  if (!previewSettings.typewriter || !app.view) return
  const head = app.view.state.selection.main.head
  requestAnimationFrame(() => {
    app.view?.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) })
  })
}

/* ------------------------------------------------------------------ *
 * 文件操作
 * ------------------------------------------------------------------ */
async function doOpen(): Promise<void> {
  const res = await openFile()
  if (!res) return
  loadDocument(res.content, res.name, res.handle, res.path)
  await persistCurrent()
  void renderRecents()
  toast(`已打开 ${res.name}`)
}

function loadDocument(
  content: string,
  name: string,
  handle?: FileSystemFileHandle,
  path?: string,
): void {
  app.fileName = name
  app.handle = handle
  app.path = path
  app.docId = `doc:${path || name}`
  if (app.view) {
    app.view.dispatch({
      changes: { from: 0, to: app.view.state.doc.length, insert: content },
      selection: { anchor: 0 },
      scrollIntoView: false,
    })
  }
  setDirty(false)
  updateTitle()
  updateCounts(content)
  refreshOutline(content)
}

async function doSave(forceAs: boolean): Promise<boolean> {
  if (!app.view) return false
  const content = app.view.state.doc.toString()
  const target = forceAs ? undefined : { handle: app.handle, path: app.path }
  const res = await saveFile(content, app.fileName, target)
  if (!res) return false
  if (res.handle) app.handle = res.handle
  if (res.path) app.path = res.path
  app.fileName = res.name
  setDirty(false)
  updateTitle()
  await persistCurrent()
  void renderRecents()
  toast(
    isNative()
      ? `已保存到应用文稿目录（${nativePlatform() === 'android' ? 'Documents/Lypora' : 'Lypora'}）`
      : `已保存 ${res.name}`,
  )
  return true
}

async function persistCurrent(): Promise<void> {
  if (!app.view) return
  await putDoc({
    id: app.docId,
    name: app.fileName,
    content: app.view.state.doc.toString(),
    updated: Date.now(),
  })
}

let autosaveTimer: number | undefined
function scheduleAutosave(): void {
  if (autosaveTimer !== undefined) clearTimeout(autosaveTimer)
  autosaveTimer = window.setTimeout(() => void persistCurrent(), 4000)
}

async function doOpenWorkspace(): Promise<void> {
  const ws = await openWorkspace()
  if (!ws) {
    toast('当前环境不支持目录访问（PWA 沙盒限制），可用桌面版或 Chrome/Edge', 3000)
    return
  }
  renderWorkspace(ws.root, ws.entries)
  toast(`已加载文件夹 ${ws.root}（${ws.entries.length} 个文档）`)
}

function renderWorkspace(root: string, entries: WorkspaceEntry[]): void {
  const box = $('filetree')
  box.innerHTML = ''
  if (!entries.length) {
    box.innerHTML = '<div class="empty-hint">该文件夹下没有 Markdown 文件</div>'
    return
  }
  const head = document.createElement('div')
  head.className = 'node'
  head.style.fontWeight = '600'
  head.style.cursor = 'default'
  head.textContent = `📁 ${root}`
  box.appendChild(head)

  for (const e of entries) {
    const node = document.createElement('div')
    node.className = 'node'
    node.dataset.path = e.label
    const nm = document.createElement('span')
    nm.className = 'nm'
    nm.textContent = e.label
    node.appendChild(nm)
    node.addEventListener('click', async () => {
      const res = await e.open()
      if (!res) return toast('读取失败')
      loadDocument(res.content, res.name, res.handle, res.path)
      document.querySelectorAll('.filetree .node').forEach((n) => n.classList.remove('active'))
      node.classList.add('active')
    })
    box.appendChild(node)
  }
}

async function renderRecents(): Promise<void> {
  const docs = await listDocs()
  const box = $('recent-list')
  box.innerHTML = ''
  if (!docs.length) {
    box.innerHTML = '<div class="empty-hint">暂无最近文件</div>'
    return
  }
  for (const d of docs.slice(0, 30)) {
    const node = document.createElement('div')
    node.className = 'node'
    const nm = document.createElement('span')
    nm.className = 'nm'
    nm.textContent = d.name
    const sub = document.createElement('span')
    sub.className = 'sub'
    sub.textContent = timeAgo(d.updated)
    node.append(nm, sub)
    node.addEventListener('click', async () => {
      const fresh = await getDoc(d.id)
      if (!fresh) return toast('记录已失效')
      loadDocument(fresh.content, fresh.name)
      toast(`已打开 ${fresh.name}`)
    })
    box.appendChild(node)
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return '刚刚'
  if (m < 60) return `${m} 分钟前`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} 小时前`
  const d = Math.floor(h / 24)
  return d < 30 ? `${d} 天前` : new Date(ts).toLocaleDateString('zh-CN')
}

/* ------------------------------------------------------------------ *
 * 导出
 * ------------------------------------------------------------------ */
function doExport(kind: 'md' | 'html' | 'pdf'): void {
  if (!app.view) return
  const content = app.view.state.doc.toString()
  const name = app.fileName
  // Android 壳里没有打印管线（WebView 的 window.print 不弹系统打印），
  // PDF 一律由菜单置灰，这里再兜一层，避免用户点了没反应。
  if (kind === 'pdf' && isNative()) {
    toast('手机版请先「导出 HTML」，再用浏览器或文档应用转 PDF', 3200)
    return
  }
  if (kind === 'md') {
    exportMarkdown(content, name)
    toast(isNative() ? '已生成 Markdown，正在唤起分享…' : '已导出 Markdown')
  } else if (kind === 'html') {
    exportHtml(content, name)
    toast(isNative() ? '已生成 HTML，正在唤起分享…' : '已导出 HTML')
  } else {
    toast('正在唤起打印，选择"另存为 PDF"即可', 2600)
    exportPdf(content, name)
  }
}

/* ------------------------------------------------------------------ *
 * 侧边栏：大纲 / 文件树 / 最近（对齐参考实现的左侧栏视图切换）
 * ------------------------------------------------------------------ */
type PaneKey = 'outline' | 'files' | 'recent'
const PANE_ID: Record<PaneKey, string> = {
  outline: 'pane-outline',
  files: 'pane-files',
  recent: 'pane-recent',
}
let currentPane: PaneKey = 'outline'

function isSidebarOpen(): boolean {
  return !$('sidebar').classList.contains('collapsed')
}

function showPane(key: PaneKey): void {
  currentPane = key
  document.querySelectorAll<HTMLButtonElement>('#sidebar .tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === key)
  })
  for (const k of Object.keys(PANE_ID) as PaneKey[]) $(PANE_ID[k]).hidden = k !== key
  syncStatusToggles()
  if (key === 'recent') void renderRecents()
}

function setSidebar(open: boolean): void {
  $('sidebar').classList.toggle('collapsed', !open)
  syncStatusToggles()
}

/** Ctrl+Shift+1/2、状态栏「大纲 / 文件树」走这里：已是目标视图则收起，否则切过去并展开 */
function togglePane(key: PaneKey): void {
  if (isSidebarOpen() && currentPane === key) {
    setSidebar(false)
    return
  }
  showPane(key)
  setSidebar(true)
}

function syncStatusToggles(): void {
  const open = isSidebarOpen()
  $('btn-outline').classList.toggle('on', open && currentPane === 'outline')
  const filesBtn = document.getElementById('btn-files')
  filesBtn?.classList.toggle('on', open && currentPane === 'files')
  $('btn-source').classList.toggle('on', previewSettings.sourceMode)
  $('btn-focus').classList.toggle('on', previewSettings.focusMode)
  $('btn-typewriter').classList.toggle('on', previewSettings.typewriter)
}

/* ------------------------------------------------------------------ *
 * 菜单（结构对齐参考实现：文件 / 编辑 / 段落 / 格式 / 显示 / 主题 / 帮助）
 * ------------------------------------------------------------------ */
async function copySelection(cut: boolean): Promise<void> {
  const view = app.view
  if (!view) return
  const { from, to } = view.state.selection.main
  if (from === to) return toast('没有选中内容')
  try {
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to))
  } catch {
    return toast('当前环境不允许访问剪贴板，请用 Ctrl+C')
  }
  if (cut) view.dispatch({ changes: { from, to, insert: '' } })
  view.focus()
}

async function pasteClipboard(): Promise<void> {
  const view = app.view
  if (!view) return
  try {
    const text = await navigator.clipboard.readText()
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    view.focus()
  } catch {
    toast('浏览器拒绝读取剪贴板，请用 Ctrl+V')
  }
}

function clearFormat(): void {
  const view = app.view
  if (!view) return
  const { from, to } = view.state.selection.main
  if (from === to) return toast('选中要清除格式的文字')
  const plain = view.state.sliceDoc(from, to).replace(/(\*\*|__|~~|`|\*|_)/g, '')
  view.dispatch({ changes: { from, to, insert: plain }, selection: { anchor: from + plain.length } })
  view.focus()
}

function buildMenus(): MenuDef[] {
  const withView = (fn: (v: EditorView) => unknown) => () => {
    const view = app.view
    if (!view) return
    fn(view)
    view.focus()
  }
  const custom = listCustomThemes()
  const cur = currentTheme()
  const curWidth = currentPageWidth()

  return [
    {
      label: '文件',
      items: [
        { label: '新建', shortcut: 'Ctrl+N', action: () => { loadDocument('# 新文档\n\n', '未命名.md'); toast('已新建文档') } },
        { label: '打开…', shortcut: 'Ctrl+O', action: () => void doOpen() },
        {
          label: isNative() ? '打开文件夹（手机版不支持）' : '打开文件夹…',
          shortcut: isNative() ? undefined : 'Ctrl+Shift+O',
          disabled: isNative(),
          action: () => void doOpenWorkspace(),
        },
        { sep: true },
        { label: '保存', shortcut: 'Ctrl+S', action: () => void doSave(false) },
        { label: '另存为…', shortcut: 'Ctrl+Shift+S', action: () => void doSave(true) },
        { sep: true },
        { label: '导出 Markdown', action: () => doExport('md') },
        { label: '导出 HTML', action: () => doExport('html') },
        {
          label: isNative() ? '导出 PDF（手机版不支持）' : '导出 PDF（打印）',
          disabled: isNative(),
          action: () => doExport('pdf'),
        },
      ],
    },
    {
      label: '编辑',
      items: [
        { label: '撤销', shortcut: 'Ctrl+Z', action: withView(undo) },
        { label: '重做', shortcut: 'Ctrl+Y', action: withView(redo) },
        { sep: true },
        { label: '剪切', shortcut: 'Ctrl+X', action: () => void copySelection(true) },
        { label: '复制', shortcut: 'Ctrl+C', action: () => void copySelection(false) },
        { label: '粘贴', shortcut: 'Ctrl+V', action: () => void pasteClipboard() },
        { sep: true },
        { label: '全选', shortcut: 'Ctrl+A', action: withView(selectAll) },
        { label: '查找与替换', shortcut: 'Ctrl+F', action: withView(openSearchPanel) },
      ],
    },
    {
      label: '段落',
      items: [
        ...[1, 2, 3, 4, 5, 6].map((lv) => ({
          label: `标题 ${lv}`,
          shortcut: `Ctrl+${lv}`,
          action: withView((v) => cmd.heading(v, lv)),
        })),
        { label: '段落', shortcut: 'Ctrl+0', action: withView((v) => cmd.heading(v, 0)) },
        { sep: true },
        { label: '无序列表', shortcut: 'Ctrl+Shift+]', action: withView(cmd.bulletList) },
        { label: '有序列表', shortcut: 'Ctrl+Shift+[', action: withView(cmd.orderedList) },
        { label: '任务列表', action: withView(cmd.taskList) },
        { label: '引用', shortcut: 'Ctrl+Shift+Q', action: withView(cmd.quote) },
        { sep: true },
        { label: '代码块', shortcut: 'Ctrl+Shift+K', action: withView(cmd.codeBlock) },
        { label: '公式块', shortcut: 'Ctrl+Shift+M', action: withView(cmd.mathBlock) },
        { label: '表格', shortcut: 'Ctrl+Shift+T', action: withView(cmd.table) },
        { label: '分隔线', action: withView(cmd.horizontalRule) },
      ],
    },
    {
      label: '格式',
      items: [
        { label: '加粗', shortcut: 'Ctrl+B', action: withView(cmd.bold) },
        { label: '斜体', shortcut: 'Ctrl+I', action: withView(cmd.italic) },
        { label: '删除线', shortcut: 'Alt+Shift+5', action: withView(cmd.strike) },
        { label: '行内代码', shortcut: 'Ctrl+E', action: withView(cmd.code) },
        { sep: true },
        { label: '超链接', shortcut: 'Ctrl+K', action: withView(cmd.link) },
        { label: '图像', shortcut: 'Ctrl+Shift+I', action: withView(cmd.image) },
        { sep: true },
        { label: '清除格式', action: clearFormat },
      ],
    },
    {
      label: '显示',
      items: [
        { label: '侧边栏', shortcut: 'Ctrl+Shift+L', checked: isSidebarOpen(), action: () => setSidebar(!isSidebarOpen()) },
        { label: '大纲', shortcut: 'Ctrl+Shift+1', checked: isSidebarOpen() && currentPane === 'outline', action: () => togglePane('outline') },
        { label: '文件树', shortcut: 'Ctrl+Shift+2', checked: isSidebarOpen() && currentPane === 'files', action: () => togglePane('files') },
        { sep: true },
        { label: '源代码模式', shortcut: 'Ctrl+/', checked: previewSettings.sourceMode, action: toggleSource },
        { label: '专注模式', shortcut: 'F8', checked: previewSettings.focusMode, action: toggleFocus },
        { label: '打字机模式', shortcut: 'F9', checked: previewSettings.typewriter, action: toggleTypewriter },
        { sep: true },
        {
          label: '页面宽度',
          items: [
            ...WIDTH_PRESETS.map((pr) => ({
              label: pr.label,
              checked: curWidth === pr.value,
              action: () => applyPageWidth(pr.value),
            })),
            { sep: true as const },
            {
              label: '自定义…',
              action: () => {
                const cur = currentPageWidth()
                void askNumber({
                  title: '自定义页面宽度',
                  hint: `正文栏宽 ${WIDTH_MIN}–${WIDTH_MAX} 像素；也可以直接拖正文右边缘的竖条。`,
                  value: cur === 'full' ? WIDTH_STD : cur,
                }).then((v) => {
                  if (v) applyPageWidth(v)
                })
              },
            },
          ],
        },
        { sep: true },
        { label: '放大', shortcut: 'Ctrl+Shift+=', action: () => applyFontSize(app.fontSize + 1) },
        { label: '缩小', shortcut: 'Ctrl+-', action: () => applyFontSize(app.fontSize - 1) },
        { label: '实际大小', shortcut: 'Ctrl+Shift+0', action: () => applyFontSize(16) },
        { label: '全屏', shortcut: 'F11', action: () => void toggleFullscreen() },
      ],
    },
    {
      label: '主题',
      items: [
        ...BUILTIN_THEMES.map((t) => ({
          label: t.label,
          checked: cur === t.id,
          action: () => applyTheme(t.id),
        })),
        ...(custom.length
          ? ([
              { sep: true },
              ...custom.map((t) => ({
                label: t.name,
                checked: cur === `custom:${t.name}`,
                action: () => applyTheme(`custom:${t.name}`),
              })),
              { sep: true },
              ...custom.map((t) => ({
                label: `删除自定义主题「${t.name}」`,
                action: () => {
                  removeCustomTheme(t.name)
                  applyTheme('github')
                  toast(`已删除主题 ${t.name}`)
                },
              })),
            ] as MenuDef['items'])
          : []),
        { sep: true },
        {
          // 手机版不提供主题导入：文件选择器拿到 .css 后没有稳定的存放位置，
          // 且导入的是第三方主题时授权链说不清（见 docs/05 §3.2）
          label: isNative() ? '导入自定义主题（手机版不支持）' : '导入自定义主题…',
          disabled: isNative(),
          action: () => $<HTMLInputElement>('theme-file').click(),
        },
        {
          label: '自定义主题说明',
          action: () => {
            void navigator.clipboard
              ?.writeText(THEME_TEMPLATE)
              .then(() => toast('主题模板已复制到剪贴板，改值后存成 .css 再导入', 3200))
              .catch(() => toast('主题变量见 docs/03-架构与技术规格.md', 3200))
          },
        },
      ],
    },
    {
      label: '帮助',
      items: [
        { label: '快捷键', shortcut: 'F1', action: showHelp },
        {
          label: '关于 Lypora',
          // 版本号与 desktop/package.json 保持一致（v0.4.0 起产品定名 Lypora）
          action: () => toast('Lypora 0.4.0 · 独立实现的即时渲染 Markdown 编辑器 · MIT', 3600),
        },
      ],
    },
  ]
}

/* ------------------------------------------------------------------ *
 * UI 绑定
 * ------------------------------------------------------------------ */
function bindUI(): void {
  updateTitle()
  createMenubar($('menubar-items'), buildMenus)
  initWheelZoom()

  // 侧栏页签：点已激活的页签 = 收起侧栏（与参考实现点开当前视图即收起一致）
  document.querySelectorAll<HTMLButtonElement>('#sidebar .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      const key = tab.dataset.tab as PaneKey | undefined
      if (key) togglePane(key)
    })
  })
  $('btn-collapse-sidebar').addEventListener('click', () => setSidebar(false))
  $('btn-outline').addEventListener('click', () => togglePane('outline'))
  document.getElementById('btn-files')?.addEventListener('click', () => togglePane('files'))

  $('btn-source').addEventListener('click', toggleSource)
  $('btn-focus').addEventListener('click', toggleFocus)
  $('btn-typewriter').addEventListener('click', toggleTypewriter)
  bindWidthGrip()

  // 自定义主题导入（对应参考实现「把 .css 丢进主题文件夹」）
  $<HTMLInputElement>('theme-file').addEventListener('change', (e) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const name = file.name.replace(/\.css$/i, '') || '自定义主题'
      addCustomTheme(name, String(reader.result ?? ''))
      const stats = applyTheme(`custom:${name}`)
      toast(
        stats?.foreign
          ? `已导入「${name}」：第三方主题格式，映射 ${stats.kept}/${stats.rules} 条规则、${stats.vars} 个变量`
          : `已导入主题 ${name}，可在「主题」菜单切换`,
        3600,
      )
    }
    reader.readAsText(file)
  })

  // 移动端工具栏
  document.querySelectorAll<HTMLButtonElement>('#mobile-toolbar button').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => e.preventDefault())
    btn.addEventListener('click', () => {
      if (!app.view) return
      const c = btn.dataset.cmd
      const v = app.view
      switch (c) {
        case 'bold': cmd.bold(v); break
        case 'italic': cmd.italic(v); break
        case 'strike': cmd.strike(v); break
        case 'code': cmd.code(v); break
        case 'h1': cmd.heading(v, 1); break
        case 'ul': cmd.bulletList(v); break
        case 'task': cmd.taskList(v); break
        case 'quote': cmd.quote(v); break
        case 'table': cmd.table(v); break
        case 'math': cmd.mathBlock(v); break
        case 'link': cmd.link(v); break
        case 'image': cmd.image(v); break
      }
      v.focus()
    })
  })

  // 移动外壳：底部动作栏 / 抽屉遮罩 / 菜单面板。窄屏才显示，桌面布局不变。
  // 动作全部回调到本文件，编辑状态只有一处真源。
  initMobileShell(buildMenus, {
    open: () => void doOpen(),
    save: () => void doSave(false),
    toggleOutline: () => togglePane('outline'),
  })

  // 全局快捷键（与菜单上标注的一致）
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey

    if (e.key === 'F1') {
      e.preventDefault()
      showHelp()
      return
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void doSave(true)
      return
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
      e.preventDefault()
      void doSave(false)
      return
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      void doOpen()
      return
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'o') {
      e.preventDefault()
      void doOpenWorkspace()
      return
    }
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'n') {
      e.preventDefault()
      loadDocument('# 新文档\n\n', '未命名.md')
      toast('已新建文档')
      return
    }
    if (mod && e.key === '/') {
      e.preventDefault()
      toggleSource()
      return
    }
    if (mod && e.shiftKey && e.key === '1') {
      e.preventDefault()
      togglePane('outline')
      return
    }
    if (mod && e.shiftKey && e.key === '2') {
      e.preventDefault()
      togglePane('files')
      return
    }
    if (mod && e.shiftKey && e.key.toLowerCase() === 'l') {
      e.preventDefault()
      setSidebar(!isSidebarOpen())
      return
    }
    if (mod && e.shiftKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      applyFontSize(app.fontSize + 1)
      return
    }
    if (mod && e.shiftKey && e.key === '0') {
      e.preventDefault()
      applyFontSize(16)
      return
    }
    if (mod && !e.shiftKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault()
      applyFontSize(app.fontSize + 1)
      return
    }
    if (mod && !e.shiftKey && e.key === '-') {
      e.preventDefault()
      applyFontSize(app.fontSize - 1)
      return
    }
    if (e.key === 'F8') {
      e.preventDefault()
      toggleFocus()
      return
    }
    if (e.key === 'F9') {
      e.preventDefault()
      toggleTypewriter()
      return
    }
    if (e.key === 'F11') {
      e.preventDefault()
      void toggleFullscreen()
      return
    }
  })

  window.addEventListener('beforeunload', (e) => {
    // 桌面版关窗由主进程统一处理（询问 → 保存 → 退出，见 desktop/main.js）：
    // 这里再 preventDefault 会被 Electron 静默拦下，表现就是"点叉号关不掉"。
    if (desktop() || !app.dirty) return
    e.preventDefault()
    e.returnValue = ''
  })

  // 同一套关闭流程中，主进程需要知道"是否脏"并能触发保存
  if (desktop()) {
    window.__lyporaCloseState = () => ({ dirty: app.dirty, name: app.fileName })
    window.__lyporaSaveAndClose = async () => {
      try {
        const ok = await doSave(false)
        return ok ? { ok: true } : { ok: false, cancelled: true }
      } catch (err) {
        return { ok: false, error: String(err) }
      }
    }
  }

  // 拖入 .md 文件直接打开
  window.addEventListener('dragover', (e) => e.preventDefault())
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    const f = e.dataTransfer?.files?.[0]
    if (!f) return
    if (/\.(md|markdown|txt)$/i.test(f.name)) {
      loadDocument(await f.text(), f.name)
      toast(`已打开 ${f.name}`)
    } else if (f.type === 'text/css') {
      const css = await f.text()
      const name = f.name.replace(/\.css$/i, '')
      addCustomTheme(name, css)
      const stats = applyTheme(`custom:${name}`)
      toast(
        stats?.foreign
          ? `已导入「${name}」：映射 ${stats.kept}/${stats.rules} 条规则、${stats.vars} 个变量`
          : `已导入主题 ${name}`,
        3200,
      )
    } else if (f.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onload = () => {
        const src = String(reader.result)
        const v = app.view
        if (!v) return
        const r = v.state.selection.main
        const insert = `![${f.name}](${src})`
        v.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: r.from + insert.length } })
        toast('已插入图片（内嵌 base64）')
      }
      reader.readAsDataURL(f)
    }
  })

  // 软键盘适配：visualViewport 变化时把光标滚进可视区
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      if (!app.view) return
      const head = app.view.state.selection.main.head
      app.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'nearest' }) })
    })
  }
}

async function toggleFullscreen(): Promise<void> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen()
    else await document.exitFullscreen()
  } catch {
    toast('当前环境不支持全屏')
  }
}

function showHelp(): void {
  toast('Ctrl+B 粗体 · Ctrl+K 链接 · Ctrl+1~6 标题 · Ctrl+/ 源码 · F8 专注 · F9 打字机 · Ctrl+S 保存', 4200)
}

function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return
  if (location.protocol === 'file:') return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* 开发环境或未部署时忽略 */
    })
  })
}

boot()
