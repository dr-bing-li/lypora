import './style.css'
import { EditorView } from '@codemirror/view'
import { undo, redo, selectAll } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { createEditorState, setEditorPlaceholder } from './editor/setup'
import { previewSettings, refreshPreview } from './editor/live-preview'
import { cmd } from './editor/commands'
import { extractOutline, renderOutline, highlightOutline, type OutlineItem } from './ui/outline'
import { createMenubar, type MenuDef, type MenubarHandle } from './ui/menubar'
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
import { formatShortcutText } from './ui/keys'
import { initMobileShell, refreshMobileLabels } from './ui/mobile'
import {
  applyStaticDom,
  getLocale,
  getLocalePreference,
  initI18n,
  LANGUAGES,
  localeName,
  onLocaleChange,
  setLocale,
  t,
  type LocalePref,
  type MessageKey,
} from './i18n'
import { openFile, saveFile, openWorkspace, desktop, type ClipboardImage, type WorkspaceEntry } from './io/files'
import { bindIncomingIntent, consumeIncomingIntent, isNative, nativePlatform, imeInfo, showIme, primeAppDirUri, type IncomingIntent } from './io/native'
import {
  getImagePathMode,
  getImageRefMode,
  nextImagePathMode,
  setCurrentDocPath,
  setImagePathMode,
  setImageRefMode,
  type ImagePathMode,
  type ImageRefMode,
} from './io/image-path'
import { insertImages, isImageFile, type ImageInput } from './io/image-insert'
import { exportHtml, exportMarkdown, exportPdf } from './io/export'
import { createBeautifyPanel } from './ui/beautify-panel'
import { putDoc, listDocs, getDoc, readSetting, writeSetting, migrateLegacySettings } from './io/store'
import { SAMPLE_MD, SAMPLE_NAME } from './sample'
import { fmtNum } from './util'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

/** 菜单栏句柄：切语言时要整块重绘 */
let menubar: MenubarHandle | null = null

/** 版本号由 vite.config.ts 的 define 从 package.json 注入，只此一个来源 */
const VERSION = __APP_VERSION__

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
// 语言必须在任何 t() 之前定下来：下面的 app.fileName 就已经要用它了
initI18n()

const app: AppState = {
  view: null,
  fileName: t('app.untitled'),
  dirty: false,
  outline: [],
  docId: '',
  fontSize: readSetting('fontSize', 16),
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
function boot(): void {
  applyStaticDom()
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
  // Android 上相对路径图片的基准目录（Documents/Lypora）只能异步取，预热一次备用
  void primeAppDirUri()

  // 桌面版：接收"用本应用打开文件"（双击 .md / 命令行参数 / 第二实例转发）
  desktop()?.onOpenPath((payload) => {
    loadDocument(payload.content, payload.name, undefined, payload.path)
    toast(t('toast.opened', { name: payload.name }))
  })

  // Android：接收"打开方式"(ACTION_VIEW) 与"分享"(ACTION_SEND) 进来的内容。
  // 冷启动 payload 由原生暂存，这里领走；热启动走 window 'lyporaIntent' 事件。
  const openIncoming = (d: IncomingIntent): void => {
    loadDocument(d.content, d.name)
    toast(t('toast.opened', { name: d.name }))
  }
  bindIncomingIntent(openIncoming)
  void consumeIncomingIntent().then((d) => {
    if (d) openIncoming(d)
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
  // n 给单复数选型，value 给千分位显示（英文 "1 word" / "2,431 words" 都靠这一手）
  st.textContent = t('status.words', { n: chars, value: fmtNum(chars) })
  st.title = t('status.wordsTip', { cjk: fmtNum(cjk), words: fmtNum(words), chars: fmtNum(chars) })
  $('st-lines').textContent = t('status.lines', { n: lines, value: fmtNum(lines) })
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
  toast(t('toast.theme', { name: custom ? custom.name : builtin ? builtin.label : 'Github' }), 1600, silent)
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
const WIDTH_PRESETS: { labelKey: MessageKey; value: PageWidth }[] = [
  { labelKey: 'view.narrow', value: 620 },
  { labelKey: 'view.standard', value: WIDTH_STD },
  { labelKey: 'view.wide', value: 1080 },
  { labelKey: 'view.full', value: 'full' },
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
  if (!silent) toast(v === 'full' ? t('toast.pageWidthFull') : t('toast.pageWidth', { width: v }), 1500)
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
    toast(t('toast.pageWidthDragged', { px: pending }), 1800)
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
    cancel.textContent = t('dialog.cancel')
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'primary'
    ok.textContent = t('dialog.ok')
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
  $('chip-mode').textContent = previewSettings.sourceMode ? t('chip.source') : t('chip.preview')
  pushPreviewSettings()
  toast(previewSettings.sourceMode ? t('toast.sourceOn') : t('toast.sourceOff'))
}

function toggleFocus(): void {
  previewSettings.focusMode = !previewSettings.focusMode
  $('btn-focus').classList.toggle('on', previewSettings.focusMode)
  pushPreviewSettings()
  toast(previewSettings.focusMode ? t('toast.focusOn') : t('toast.focusOff'))
}

function toggleTypewriter(): void {
  previewSettings.typewriter = !previewSettings.typewriter
  $('btn-typewriter').classList.toggle('on', previewSettings.typewriter)
  applyTypewriter()
  toast(previewSettings.typewriter ? t('toast.typewriterOn') : t('toast.typewriterOff'))
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
  toast(t('toast.opened', { name: res.name }))
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
  // 相对路径图片的解析基准跟着文档走：切文档必须立刻同步，否则会按上一篇的目录去拼
  setCurrentDocPath(path)
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
  const pathBefore = app.path
  if (res.handle) app.handle = res.handle
  if (res.path) app.path = res.path
  app.fileName = res.name
  // 另存为之后基准目录变了，已渲染的图片必须按新目录重算一次。空事务即可触发
  // ViewPlugin.update（它靠 transactions.length > 0 判断要不要重建装饰）。
  setCurrentDocPath(app.path)
  if (pathBefore !== app.path) app.view?.dispatch({})
  setDirty(false)
  updateTitle()
  await persistCurrent()
  void renderRecents()
  toast(
    isNative()
      ? t('toast.savedToAppDir', { dir: nativePlatform() === 'android' ? 'Documents/Lypora' : 'Lypora' })
      : t('toast.saved', { name: res.name }),
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
    toast(t('toast.folderUnsupported'), 3000)
    return
  }
  renderWorkspace(ws.root, ws.entries)
  toast(t('toast.folderLoaded', { n: ws.entries.length, root: ws.root }))
}

function renderWorkspace(root: string, entries: WorkspaceEntry[]): void {
  const box = $('filetree')
  box.innerHTML = ''
  if (!entries.length) {
    const hint = document.createElement('div')
    hint.className = 'empty-hint'
    hint.textContent = t('sidebar.noMarkdown')
    box.appendChild(hint)
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
      if (!res) return toast(t('toast.readFailed'))
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
    const hint = document.createElement('div')
    hint.className = 'empty-hint'
    hint.textContent = t('sidebar.noRecents')
    box.appendChild(hint)
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
      if (!fresh) return toast(t('toast.recordExpired'))
      loadDocument(fresh.content, fresh.name)
      toast(t('toast.opened', { name: fresh.name }))
    })
    box.appendChild(node)
  }
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60000)
  if (m < 1) return t('time.justNow')
  if (m < 60) return t('time.minutes', { n: m })
  const h = Math.floor(m / 60)
  if (h < 24) return t('time.hours', { n: h })
  const d = Math.floor(h / 24)
  return d < 30 ? t('time.days', { n: d }) : new Date(ts).toLocaleDateString(getLocale())
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
    toast(t('toast.pdfOnMobile'), 3200)
    return
  }
  if (kind === 'md') {
    exportMarkdown(content, name)
    toast(isNative() ? t('toast.exportedMdShare') : t('toast.exportedMd'))
  } else if (kind === 'html') {
    exportHtml(content, name)
    toast(isNative() ? t('toast.exportedHtmlShare') : t('toast.exportedHtml'))
  } else {
    toast(t('toast.printing'), 2600)
    exportPdf(content, name)
  }
}

/* ------------------------------------------------------------------ *
 * 卡片导出（图片 / PDF）—— 与"导出 PDF（打印）"是两条不同的路：
 * 打印那条服从 A4 纸张与分页规则，这条按卡片版面重排，产物是可直接发布的图片。
 * ------------------------------------------------------------------ */
const beautify = createBeautifyPanel({
  getContent: () => app.view?.state.doc.toString() ?? '',
  getDocName: () => app.fileName,
})

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
  syncImagePathToggle()
}

/* ------------------------------------------------------------------ *
 * 图片路径开关（状态栏三态）
 *
 * 「设置 → 图片引用方式」优先级更高：选了内嵌 base64 之后，路径这个概念整个
 * 不参与插入，所以这里必须置灰而不是假装还能点 —— 点了没反应的按钮比没有更糟。
 * ------------------------------------------------------------------ */

function imagePathLabel(mode: ImagePathMode): string {
  if (mode === 'copy') return t('imagePath.copy')
  if (mode === 'relative') return t('imagePath.relative')
  return t('imagePath.absolute')
}

/** 状态栏只有一格的位置，用两字短标签；菜单和 toast 才用完整说法 */
function imagePathShort(mode: ImagePathMode): string {
  if (mode === 'copy') return t('imagePath.copyShort')
  if (mode === 'relative') return t('imagePath.relativeShort')
  return t('imagePath.absoluteShort')
}

function syncImagePathToggle(): void {
  const btn = document.getElementById('btn-image-path') as HTMLButtonElement | null
  if (!btn) return
  const embed = getImageRefMode() === 'embed'
  const mode = getImagePathMode()
  btn.textContent = embed ? t('imagePath.embeddedShort') : imagePathShort(mode)
  btn.disabled = embed
  btn.classList.toggle('is-disabled', embed)
  btn.classList.toggle('on', !embed && mode !== 'copy')
  btn.title = embed ? t('imagePath.locked') : t('imagePath.title')
}

function cycleImagePathMode(): void {
  if (getImageRefMode() === 'embed') return
  const next = nextImagePathMode()
  setImagePathMode(next)
  syncImagePathToggle()
  toast(t('toast.imagePathMode', { mode: imagePathLabel(next) }), 1600)
}

/* ------------------------------------------------------------------ *
 * 插入图片（菜单 / 快捷键 / 拖放 三条入口共用同一条管线）
 * ------------------------------------------------------------------ */

/** 「设置」里的引用方式：优先级最高，选 embed 后路径策略整段不参与 */
function applyImageRefMode(mode: ImageRefMode): void {
  setImageRefMode(mode)
  syncImagePathToggle()
  menubar?.redraw()
  toast(t(mode === 'embed' ? 'toast.imageRefEmbed' : 'toast.imageRefFile'), 2200)
}

function applyImagePathMode(mode: ImagePathMode): void {
  setImagePathMode(mode)
  syncImagePathToggle()
  menubar?.redraw()
  toast(t('toast.imagePathMode', { mode: imagePathLabel(mode) }), 1600)
}

function pickImages(): void {
  const input = $<HTMLInputElement>('image-file')
  input.value = ''
  input.click()
}

async function runImageInsert(files: File[], srcPath?: string): Promise<void> {
  const view = app.view
  if (!view) return
  const content = view.state.doc.toString()
  // srcPath 只对单文件有意义（剪贴板位图落盘后的临时文件）；
  // 多选/多拖放时每个文件的真实路径由 bridge.pathForFile 各自反查。
  const inputs: ImageInput[] = files.map((f) => (srcPath && files.length === 1 ? { file: f, srcPath } : f))
  await insertImages(view, inputs, app.path, content, (m) => toast(m), {
    inserted: () => t('toast.imageInserted'),
    copied: (n, dir) => t('toast.imageCopied', { value: String(n), dir }),
    linked: (n, mode) => t('toast.imageLinked', { value: String(n), mode: imagePathLabel(mode as ImagePathMode) }),
    needSave: t('toast.imageNeedSave'),
    noPath: t('toast.imageNoPath'),
    failed: t('toast.imageFailed'),
  })
}

/* ------------------------------------------------------------------ *
 * 粘贴剪贴板图片（截图 / 网页右键复制）
 * ------------------------------------------------------------------ *
 * 三段判断，顺序不能换：
 *   ① 事件里真有图片 file → **同步** preventDefault 抢下来自己处理。
 *      这一步必须同步：等异步逻辑跑完再拦，CM6 早就把内容当文本插进去了。
 *   ② 有 file 但查不到磁盘路径（截图位图不对应任何文件）→ 请主进程落成
 *      临时 PNG 换一个真实路径，这样才能走「复制到附件目录」而不是内嵌 base64。
 *   ③ 没有图片 → 直接放行，文本粘贴仍然交给 CM6 原生处理。
 * ------------------------------------------------------------------ */
function pastedImageFiles(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const items = Array.from(dt.items || [])
  const fromItems = items
    .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
    .map((it) => it.getAsFile())
    .filter((f): f is File => !!f)
  if (fromItems.length) return fromItems
  // 少数环境 items 不含图片但 files 有（老版本 Safari / 某些拖放模拟）
  return Array.from(dt.files || []).filter(isImageFile)
}

async function insertPastedImages(files: File[]): Promise<void> {
  const bridge = desktop()
  if (bridge && files.length === 1 && !bridge.pathForFile(files[0])) {
    const clip = await bridge.readClipboardImage()
    if (clip) {
      await runImageInsert(files, clip.path)
      return
    }
  }
  await runImageInsert(files)
}

function onPasteCapture(e: ClipboardEvent): void {
  const files = pastedImageFiles(e.clipboardData)
  if (!files.length) return
  e.preventDefault()
  e.stopPropagation()
  void insertPastedImages(files)
}

/* ------------------------------------------------------------------ *
 * 菜单（结构对齐参考实现：文件 / 编辑 / 段落 / 格式 / 显示 / 主题 / 帮助）
 * ------------------------------------------------------------------ */
async function copySelection(cut: boolean): Promise<void> {
  const view = app.view
  if (!view) return
  const { from, to } = view.state.selection.main
  if (from === to) return toast(t('toast.noSelection'))
  try {
    await navigator.clipboard.writeText(view.state.sliceDoc(from, to))
  } catch {
    return toast(t('toast.clipboardDenied'))
  }
  if (cut) view.dispatch({ changes: { from, to, insert: '' } })
  view.focus()
}

/** 剪贴板位图 → 可喂给插入管线的 File（内容只在 embed 模式才需要） */
function clipboardFile(clip: ClipboardImage): File {
  const name = clip.name || 'image.png'
  const comma = clip.dataUrl ? clip.dataUrl.indexOf(',') : -1
  if (comma < 0) return new File([], name, { type: 'image/png' })
  const bin = atob(clip.dataUrl!.slice(comma + 1))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new File([bytes], name, { type: 'image/png' })
}

async function pasteClipboard(): Promise<void> {
  const view = app.view
  if (!view) return

  // 剪贴板里是图片就先插图片——这条覆盖「截图后点菜单粘贴」，
  // 与 Ctrl+V 走的是同一条管线，路径模式同样生效。
  const bridge = desktop()
  if (bridge) {
    const clip = await bridge.readClipboardImage({ withData: getImageRefMode() === 'embed' })
    if (clip) {
      await runImageInsert([clipboardFile(clip)], clip.path)
      view.focus()
      return
    }
  }

  try {
    const text = await navigator.clipboard.readText()
    const { from, to } = view.state.selection.main
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length } })
    view.focus()
  } catch {
    toast(t('toast.clipboardReadDenied'))
  }
}

function clearFormat(): void {
  const view = app.view
  if (!view) return
  const { from, to } = view.state.selection.main
  if (from === to) return toast(t('toast.selectToClear'))
  const plain = view.state.sliceDoc(from, to).replace(/(\*\*|__|~~|`|\*|_)/g, '')
  view.dispatch({ changes: { from, to, insert: plain }, selection: { anchor: from + plain.length } })
  view.focus()
}

/**
 * 请出 Android 输入法。
 *
 * 平板接了蓝牙键盘时，系统默认不再弹软键盘，输入法退化成「物理键盘直通」——
 * 这时用户唯一的路就是应用内给的这个入口。先把编辑区焦点要回来（输入法要绑在
 * contenteditable 上才有用），再走原生 restartInput + showSoftInput。
 * 叫不回来就把原因说清楚：系统策略拦的和插件缺失不是一回事。
 */
async function revealIme(): Promise<void> {
  app.view?.focus()
  if (await showIme()) return
  const st = await imeInfo()
  toast(st.hardwareKeyboard ? t('toast.imeBlocked') : t('toast.imeUnavailable'), 6000)
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
  // 手机壳里没有打印管线、没有目录句柄、没有主题文件落点，三项置灰并写明原因
  const native = isNative()
  const pref = getLocalePreference()

  return [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        {
          id: 'file-create',
          label: t('file.create'),
          shortcut: 'Ctrl+N',
          action: () => {
            loadDocument(`# ${t('app.newDoc')}\n\n`, t('app.untitled'))
            toast(t('toast.created'))
          },
        },
        { id: 'file-open', label: t('file.open'), shortcut: 'Ctrl+O', action: () => void doOpen() },
        {
          id: 'file-open-folder',
          label: native ? t('file.openFolderUnsupported') : t('file.openFolder'),
          shortcut: native ? undefined : 'Ctrl+Shift+O',
          disabled: native,
          action: () => void doOpenWorkspace(),
        },
        { sep: true },
        { id: 'file-save', label: t('file.save'), shortcut: 'Ctrl+S', action: () => void doSave(false) },
        {
          id: 'file-save-as',
          label: t('file.saveAs'),
          shortcut: 'Ctrl+Shift+S',
          action: () => void doSave(true),
        },
        { sep: true },
        { id: 'file-export-md', label: t('file.exportMd'), action: () => doExport('md') },
        { id: 'file-export-html', label: t('file.exportHtml'), action: () => doExport('html') },
        {
          id: 'file-export-pdf',
          label: native ? t('file.exportPdfUnsupported') : t('file.exportPdf'),
          disabled: native,
          action: () => doExport('pdf'),
        },
        {
          id: 'file-beautify',
          label: t('file.beautify'),
          action: () => beautify.open(),
        },
      ],
    },
    {
      id: 'edit',
      label: t('menu.edit'),
      items: [
        { id: 'edit-undo', label: t('edit.undo'), shortcut: 'Ctrl+Z', action: withView(undo) },
        { id: 'edit-redo', label: t('edit.redo'), shortcut: 'Ctrl+Y', action: withView(redo) },
        { sep: true },
        { id: 'edit-cut', label: t('edit.cut'), shortcut: 'Ctrl+X', action: () => void copySelection(true) },
        { id: 'edit-copy', label: t('edit.copy'), shortcut: 'Ctrl+C', action: () => void copySelection(false) },
        { id: 'edit-paste', label: t('edit.paste'), shortcut: 'Ctrl+V', action: () => void pasteClipboard() },
        { sep: true },
        { id: 'edit-select-all', label: t('edit.selectAll'), shortcut: 'Ctrl+A', action: withView(selectAll) },
        { id: 'edit-find', label: t('edit.find'), shortcut: 'Ctrl+F', action: withView(openSearchPanel) },
      ],
    },
    {
      id: 'paragraph',
      label: t('menu.paragraph'),
      items: [
        ...[1, 2, 3, 4, 5, 6].map((lv) => ({
          id: `paragraph-h${lv}`,
          label: t('paragraph.heading', { level: lv }),
          shortcut: `Ctrl+${lv}`,
          action: withView((v) => cmd.heading(v, lv)),
        })),
        {
          id: 'paragraph-body',
          label: t('paragraph.body'),
          shortcut: 'Ctrl+0',
          action: withView((v) => cmd.heading(v, 0)),
        },
        { sep: true },
        {
          id: 'paragraph-bullet',
          label: t('paragraph.bullet'),
          shortcut: 'Ctrl+Shift+]',
          action: withView(cmd.bulletList),
        },
        {
          id: 'paragraph-ordered',
          label: t('paragraph.ordered'),
          shortcut: 'Ctrl+Shift+[',
          action: withView(cmd.orderedList),
        },
        { id: 'paragraph-task', label: t('paragraph.task'), action: withView(cmd.taskList) },
        {
          id: 'paragraph-quote',
          label: t('paragraph.quote'),
          shortcut: 'Ctrl+Shift+Q',
          action: withView(cmd.quote),
        },
        { sep: true },
        {
          id: 'paragraph-code',
          label: t('paragraph.code'),
          shortcut: 'Ctrl+Shift+K',
          action: withView(cmd.codeBlock),
        },
        {
          id: 'paragraph-math',
          label: t('paragraph.math'),
          shortcut: 'Ctrl+Shift+M',
          action: withView(cmd.mathBlock),
        },
        { id: 'paragraph-table', label: t('paragraph.table'), shortcut: 'Ctrl+Shift+T', action: withView(cmd.table) },
        { id: 'paragraph-hr', label: t('paragraph.hr'), action: withView(cmd.horizontalRule) },
      ],
    },
    {
      id: 'format',
      label: t('menu.format'),
      items: [
        { id: 'format-bold', label: t('format.bold'), shortcut: 'Ctrl+B', action: withView(cmd.bold) },
        { id: 'format-italic', label: t('format.italic'), shortcut: 'Ctrl+I', action: withView(cmd.italic) },
        { id: 'format-strike', label: t('format.strike'), shortcut: 'Alt+Shift+5', action: withView(cmd.strike) },
        { id: 'format-code', label: t('format.code'), shortcut: 'Ctrl+E', action: withView(cmd.code) },
        { sep: true },
        { id: 'format-link', label: t('format.link'), shortcut: 'Ctrl+K', action: withView(cmd.link) },
        { id: 'format-image', label: t('format.insertImage'), shortcut: 'Ctrl+Shift+I', action: () => pickImages() },
        { sep: true },
        { id: 'format-clear', label: t('format.clear'), action: clearFormat },
      ],
    },
    {
      id: 'view',
      label: t('menu.view'),
      items: [
        {
          id: 'view-sidebar',
          label: t('view.sidebar'),
          shortcut: 'Ctrl+Shift+L',
          checked: isSidebarOpen(),
          action: () => setSidebar(!isSidebarOpen()),
        },
        {
          id: 'view-outline',
          label: t('view.outline'),
          shortcut: 'Ctrl+Shift+1',
          checked: isSidebarOpen() && currentPane === 'outline',
          action: () => togglePane('outline'),
        },
        {
          id: 'view-files',
          label: t('view.files'),
          shortcut: 'Ctrl+Shift+2',
          checked: isSidebarOpen() && currentPane === 'files',
          action: () => togglePane('files'),
        },
        { sep: true },
        {
          id: 'view-source',
          label: t('view.source'),
          shortcut: 'Ctrl+/',
          checked: previewSettings.sourceMode,
          action: toggleSource,
        },
        {
          id: 'view-focus',
          label: t('view.focus'),
          shortcut: 'F8',
          checked: previewSettings.focusMode,
          action: toggleFocus,
        },
        {
          id: 'view-typewriter',
          label: t('view.typewriter'),
          shortcut: 'F9',
          checked: previewSettings.typewriter,
          action: toggleTypewriter,
        },
        { sep: true },
        {
          id: 'view-page-width',
          label: t('view.pageWidth'),
          items: [
            ...WIDTH_PRESETS.map((pr) => ({
              id: `view-width-${pr.value}`,
              label: t(pr.labelKey),
              checked: curWidth === pr.value,
              action: () => applyPageWidth(pr.value),
            })),
            { sep: true as const },
            {
              id: 'view-width-custom',
              label: t('view.custom'),
              action: () => {
                const cur = currentPageWidth()
                void askNumber({
                  title: t('view.customTitle'),
                  hint: t('view.customHint', { min: WIDTH_MIN, max: WIDTH_MAX }),
                  value: cur === 'full' ? WIDTH_STD : cur,
                }).then((v) => {
                  if (v) applyPageWidth(v)
                })
              },
            },
          ],
        },
        { sep: true },
        {
          id: 'view-zoom-in',
          label: t('view.zoomIn'),
          shortcut: 'Ctrl+Shift+=',
          action: () => applyFontSize(app.fontSize + 1),
        },
        {
          id: 'view-zoom-out',
          label: t('view.zoomOut'),
          shortcut: 'Ctrl+-',
          action: () => applyFontSize(app.fontSize - 1),
        },
        {
          id: 'view-zoom-reset',
          label: t('view.zoomReset'),
          shortcut: 'Ctrl+Shift+0',
          action: () => applyFontSize(16),
        },
        { id: 'view-fullscreen', label: t('view.fullscreen'), shortcut: 'F11', action: () => void toggleFullscreen() },
        // 平板接了蓝牙键盘时，Android 默认不给弹软键盘，输入法只剩「英文直通」。
        // 这一项是用户唯一的自救入口，只在 Android 上出现。
        ...(nativePlatform() === 'android'
          ? ([
              { sep: true },
              { id: 'view-ime', label: t('view.virtualKeyboard'), action: () => void revealIme() },
            ] as MenuDef['items'])
          : []),
      ],
    },
    {
      id: 'theme',
      label: t('menu.theme'),
      items: [
        ...BUILTIN_THEMES.map((th) => ({
          id: `theme-${th.id}`,
          label: th.label,
          checked: cur === th.id,
          action: () => applyTheme(th.id),
        })),
        ...(custom.length
          ? ([
              { sep: true },
              ...custom.map((th) => ({
                id: `theme-custom-${th.name}`,
                label: th.name,
                checked: cur === `custom:${th.name}`,
                action: () => applyTheme(`custom:${th.name}`),
              })),
              { sep: true },
              ...custom.map((th) => ({
                id: `theme-del-${th.name}`,
                label: th.name,
                action: () => {
                  removeCustomTheme(th.name)
                  applyTheme('github')
                  toast(t('toast.themeDeleted', { name: th.name }))
                },
              })),
            ] as MenuDef['items'])
          : []),
        { sep: true },
        {
          // 手机版不提供主题导入：文件选择器拿到 .css 后没有稳定的存放位置，
          // 且导入的是第三方主题时授权链说不清（见 docs/05 §3.2）
          id: 'theme-import',
          label: native ? t('theme.importCustomUnsupported') : t('theme.importCustom'),
          disabled: native,
          action: () => $<HTMLInputElement>('theme-file').click(),
        },
        {
          id: 'theme-help',
          label: t('theme.customHelp'),
          action: () => {
            void navigator.clipboard
              ?.writeText(THEME_TEMPLATE)
              .then(() => toast(t('toast.themeTemplateCopied'), 3200))
              .catch(() => toast(t('toast.themeDocRef'), 3200))
          },
        },
      ],
    },
    {
      // 语言单独一个顶级菜单：语言是"整个界面"的属性，藏在显示/帮助里没人找得到
      id: 'language',
      label: t('menu.language'),
      items: [
        {
          id: 'lang-system',
          label: t('language.followSystem'),
          checked: pref === 'system',
          action: () => applyLocale('system'),
        },
        { sep: true },
        // 各语言一律用母语名显示，不翻译（否则找不到自己那一项）
        ...LANGUAGES.map((l) => ({
          id: `lang-${l.id}`,
          label: l.native,
          checked: pref === l.id,
          action: () => applyLocale(l.id),
        })),
      ],
    },
    {
      // 「设置」独立成顶级菜单：图片引用方式是一个横跨"插入 / 渲染 / 导出"的全局策略，
      // 塞进「格式 → 图片」会让人以为它只管那一个菜单项。
      id: 'settings',
      label: t('menu.settings'),
      items: [
        {
          id: 'settings-image-ref',
          label: t('settings.imageRef'),
          items: [
            {
              id: 'settings-image-ref-file',
              label: t('settings.imageRefFile'),
              checked: getImageRefMode() === 'reference',
              action: () => applyImageRefMode('reference'),
            },
            {
              id: 'settings-image-ref-embed',
              label: t('settings.imageRefEmbed'),
              checked: getImageRefMode() === 'embed',
              action: () => applyImageRefMode('embed'),
            },
          ],
        },
        {
          // 父项不置灰：置灰的父项在菜单里连子菜单都展不开，用户就看不到"当前值是什么、
          // 为什么失效"。让子项各自 disabled，父项仍可 hover 查看。
          id: 'settings-image-path',
          label: t('settings.imagePath'),
          items: [
            {
              id: 'settings-image-path-copy',
              label: t('imagePath.copy'),
              checked: getImagePathMode() === 'copy',
              disabled: getImageRefMode() === 'embed',
              action: () => applyImagePathMode('copy'),
            },
            {
              id: 'settings-image-path-relative',
              label: t('imagePath.relative'),
              checked: getImagePathMode() === 'relative',
              disabled: getImageRefMode() === 'embed',
              action: () => applyImagePathMode('relative'),
            },
            {
              id: 'settings-image-path-absolute',
              label: t('imagePath.absolute'),
              checked: getImagePathMode() === 'absolute',
              disabled: getImageRefMode() === 'embed',
              action: () => applyImagePathMode('absolute'),
            },
          ],
        },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: [
        { id: 'help-shortcuts', label: t('help.shortcuts'), shortcut: 'F1', action: showHelp },
        { id: 'help-about', label: t('help.about'), action: () => toast(t('help.aboutText', { version: VERSION }), 3600) },
      ],
    },
  ]
}

/* ------------------------------------------------------------------ *
 * 语言切换：偏好 → 重绘
 * ------------------------------------------------------------------ */
/** 菜单项被点中时走这里；语言没变也会提示一次，避免"点了没反应" */
function applyLocale(pref: LocalePref): void {
  const next = setLocale(pref)
  toast(t('language.changed', { name: localeName(next) }), 1800)
}

/**
 * 把已经渲染出去的文字全部重画一遍。
 * 静态节点靠 data-i18n 标记 + applyStaticDom，动态节点（菜单、dock、大纲、统计）逐个刷新。
 */
function refreshLocaleUi(): void {
  applyStaticDom()
  menubar?.redraw()
  refreshMobileLabels()
  if (app.view) setEditorPlaceholder(app.view)
  // 静态标记里的 chip 写死的是"实时预览"，源码模式下要改回来
  $('chip-mode').textContent = previewSettings.sourceMode ? t('chip.source') : t('chip.preview')
  updateTitle()
  const doc = app.view?.state.doc.toString() ?? ''
  updateCounts(doc)
  refreshOutline(doc)
  if (currentPane === 'recent') void renderRecents()
  syncStatusToggles()
}

/* ------------------------------------------------------------------ *
 * UI 绑定
 * ------------------------------------------------------------------ */
function bindUI(): void {
  updateTitle()
  menubar = createMenubar($('menubar-items'), buildMenus)
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
  document.getElementById('btn-image-path')?.addEventListener('click', cycleImagePathMode)
  bindWidthGrip()

  // 自定义主题导入（对应参考实现「把 .css 丢进主题文件夹」）
  $<HTMLInputElement>('theme-file').addEventListener('change', (e) => {
    const input = e.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const name = file.name.replace(/\.css$/i, '') || t('menu.theme')
      addCustomTheme(name, String(reader.result ?? ''))
      const stats = applyTheme(`custom:${name}`)
      toast(
        stats?.foreign
          ? t('toast.themeImportedForeign', {
              name,
              kept: stats.kept,
              rules: stats.rules,
              vars: stats.vars,
            })
          : t('toast.themeImported', { name }),
        3600,
      )
    }
    reader.readAsText(file)
  })

  // 插入图片：菜单 / 快捷键 / 移动工具栏都只是这条 input 的触发器
  $<HTMLInputElement>('image-file').addEventListener('change', (e) => {
    const input = e.currentTarget as HTMLInputElement
    const files = Array.from(input.files ?? [])
    input.value = ''
    if (files.length) void runImageInsert(files)
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
        case 'image': pickImages(); break
      }
      v.focus()
    })
  })

  // 语言变化：重绘所有已经渲染出去的文字（切换点只有一个，这里统一兜住）
  onLocaleChange(() => refreshLocaleUi())

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
      loadDocument(`# ${t('app.newDoc')}\n\n`, t('app.untitled'))
      toast(t('toast.created'))
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

  // 拖入 .md 文件直接打开；拖入图片走与「格式 → 插入图片」完全相同的管线
  window.addEventListener('dragover', (e) => e.preventDefault())
  // capture 阶段：必须在 CM6 把剪贴板内容当文本处理之前拦下
  window.addEventListener('paste', onPasteCapture, true)
  window.addEventListener('drop', async (e) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer?.files ?? [])
    if (!files.length) return
    const f = files[0]
    if (/\.(md|markdown|txt)$/i.test(f.name)) {
      loadDocument(await f.text(), f.name)
      toast(t('toast.opened', { name: f.name }))
    } else if (f.type === 'text/css') {
      const css = await f.text()
      const name = f.name.replace(/\.css$/i, '')
      addCustomTheme(name, css)
      const stats = applyTheme(`custom:${name}`)
      toast(
        stats?.foreign
          ? t('toast.themeImportedForeign', {
              name,
              kept: stats.kept,
              rules: stats.rules,
              vars: stats.vars,
            })
          : t('toast.themeImported', { name }),
        3200,
      )
    } else {
      const images = files.filter(isImageFile)
      if (images.length) await runImageInsert(images)
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
    toast(t('toast.fullscreenUnsupported'))
  }
}

function showHelp(): void {
  // 帮助提示整句里嵌着 Ctrl+X，macOS 上要显示成 ⌘X（词表本身不按平台分叉）
  toast(formatShortcutText(t('help.shortcutsTip')), 4200)
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
