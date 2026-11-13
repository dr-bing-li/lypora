import './style.css'
import type { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { undo, redo, selectAll } from '@codemirror/commands'
import { openSearchPanel } from '@codemirror/search'
import { createEditorState, setEditorPlaceholder } from './editor/setup'
import { previewSettings, refreshPreview } from './editor/live-preview'
import { cmd } from './editor/commands'
import { extractOutline, renderOutline, highlightOutline, type OutlineItem } from './ui/outline'
import { createMenubar, type MenuDef, type MenuEntry, type MenubarHandle } from './ui/menubar'
import { createTabbar, type TabbarHandle, type TabbarItem } from './ui/tabbar'
import { askSave } from './ui/confirm'
import { HELP_DOCS, helpText, helpTitle, type HelpId } from './help'
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
import { CARD_SIZES } from './export/card-themes'
import { putDoc, listDocs, getDoc, readSetting, writeSetting, migrateLegacySettings } from './io/store'
import { SAMPLE_MD, SAMPLE_NAME } from './sample'
import { fmtNum } from './util'

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T

/** 菜单栏句柄：切语言时要整块重绘 */
let menubar: MenubarHandle | null = null

/** 标签栏句柄（v0.11.0） */
let tabbar: TabbarHandle | null = null

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
  /** 打开着的标签（v0.11.0）。至少一个，关掉最后一个会补一个空文档 */
  tabs: TabDoc[]
  activeId: string
}

/**
 * 一个标签 = 一份完整的编辑器状态。
 *
 * 关键点：`state` 是完整的 CM6 EditorState（自带撤销历史、选区、折叠），
 * 切标签走 `view.setState(tab.state)`，所以来回切换不会丢撤销栈 —— 这也是不把
 * 各标签内容塞进同一个 EditorState 用"切换文档"的方式实现的根本原因。
 */
interface TabDoc {
  id: string
  kind: 'doc' | 'help'
  name: string
  handle?: FileSystemFileHandle
  path?: string
  state: EditorState
  /** 上次落盘（或刚打开）时的内容快照：`dirty = 当前内容 !== saved`，以磁盘为准 */
  saved: string
  dirty: boolean
  /** 切走时记住滚动位置，切回来还原 */
  scrollTop: number
  docId: string
  /** 帮助页：只读、不写 IndexedDB、不进最近文件 */
  readonly: boolean
  /** 帮助页的稳定 id（切界面语言时按它重取正文） */
  helpId?: HelpId
}

/** 显示模式：仅标签 / 仅多窗口 / 两者并存（「设置」菜单里切） */
export type DisplayMode = 'tabs' | 'windows' | 'both'

const KEY_DISPLAY_MODE = 'displayMode'

function displayMode(): DisplayMode {
  const v = readSetting<DisplayMode>(KEY_DISPLAY_MODE, 'tabs')
  return v === 'windows' || v === 'both' ? v : 'tabs'
}

function tabsEnabled(): boolean {
  return displayMode() !== 'windows'
}

/** 只有桌面壳能开真窗口；浏览器/PWA 与手机壳里这一项不出现 */
function canMultiWindow(): boolean {
  return !!desktop()?.newWindow && displayMode() !== 'tabs'
}

/**
 * 开一个新窗口。带 payload 时新窗口直接打开这篇文档（"仅多窗口"模式下点打开文件）。
 * 主进程负责建窗并在 did-finish-load 后投递，这里不等结果 —— 窗口起来要几百毫秒，
 * 卡住当前窗口没必要。
 */
function openNewWindow(payload?: { name: string; path?: string; content: string }): void {
  const d = desktop()
  if (!d?.newWindow) {
    toast(t('toast.windowUnsupported'))
    return
  }
  void d.newWindow(payload)
}

/**
 * 切显示模式。
 * 注意：切到「仅多窗口」只是把标签栏藏起来，已有标签**不销毁** —— 切回来还在，
 * 这样用户来回改主意不会丢文档。
 */
function setDisplayMode(m: DisplayMode): void {
  writeSetting(KEY_DISPLAY_MODE, m)
  renderTabs()
  menubar?.redraw()
  const label =
    m === 'tabs' ? t('settings.displayTabs') : m === 'windows' ? t('settings.displayWindows') : t('settings.displayBoth')
  toast(t('toast.displayMode', { mode: label }))
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
  tabs: [],
  activeId: '',
}

/* ------------------------------------------------------------------ *
 * 标签：创建 / 切换 / 关闭
 * ------------------------------------------------------------------ */

let tabSeq = 0
const nextTabId = (): string => `tab-${++tabSeq}`

/**
 * 编辑器回调。所有标签共用同一套回调：只有"当前在 view 里那个 state"会触发它们，
 * 而那时它一定就是活动标签，所以这里直接用 activeTab() 而不是把 tab 绑进闭包
 * （绑进闭包反而会在切回来后指向旧对象）。
 */
function editorHooks() {
  return {
    onChange: (doc: string) => {
      const tab = activeTab()
      if (tab) {
        tab.dirty = doc !== tab.saved
        app.dirty = tab.dirty
      }
      if (tab?.readonly) return
      $('dirty-dot').hidden = !app.dirty
      updateTitle()
      renderTabs()
      refreshWorkspaceMarks()
      updateCounts(doc)
      scheduleOutline(doc)
      scheduleAutosave()
    },
    onCursor: (_line: number, _col: number) => {
      applyTypewriter()
      highlightOutline($('outline-body'), app.view?.state.selection.main.head ?? 0, app.outline)
    },
    onSave: () => void doSave(false),
    onSourceToggle: () => toggleSource(),
  }
}

function makeTab(o: {
  name: string
  content: string
  handle?: FileSystemFileHandle
  path?: string
  readonly?: boolean
  kind?: 'doc' | 'help'
  helpId?: HelpId
  /** 初始光标位置（首屏示例文档停在标题行之后） */
  selection?: number
}): TabDoc {
  const tab: TabDoc = {
    id: nextTabId(),
    kind: o.kind ?? 'doc',
    name: o.name,
    handle: o.handle,
    path: o.path,
    state: createEditorState(o.content, editorHooks(), o.selection ?? 0, { readonly: o.readonly }),
    saved: o.content,
    dirty: false,
    scrollTop: 0,
    docId: `doc:${o.path || o.name}`,
    readonly: o.readonly ?? false,
    helpId: o.helpId,
  }
  app.tabs.push(tab)
  return tab
}

function activeTab(): TabDoc | undefined {
  return app.tabs.find((x) => x.id === app.activeId)
}

/** 把当前 view 的状态与滚动位置存回活动标签（切走 / 关窗前调用） */
function stashActive(): void {
  const tab = activeTab()
  if (!tab || !app.view) return
  tab.state = app.view.state
  tab.scrollTop = app.view.scrollDOM.scrollTop
}

/** 用标签里的状态重建视图（镜像字段一起同步） */
function applyTab(tab: TabDoc, focus = true): void {
  app.activeId = tab.id
  app.fileName = tab.name
  app.handle = tab.handle
  app.path = tab.path
  app.dirty = tab.dirty
  app.docId = tab.docId
  setCurrentDocPath(tab.path)
  if (app.view) {
    // setState 会把撤销历史、选区、折叠一起换过来
    app.view.setState(tab.state)
    app.view.scrollDOM.scrollTop = tab.scrollTop
    // 相对路径图片的基准目录可能变了：空事务触发 ViewPlugin 重建装饰
    app.view.dispatch({})
    if (focus && !tab.readonly) app.view.focus()
  }
  $('dirty-dot').hidden = !tab.dirty
  updateTitle()
  updateCounts(tab.state.doc.toString())
  refreshOutline(tab.state.doc.toString())
  renderTabs()
  refreshWorkspaceMarks()
  syncReadonlyUi()
}

function activateTab(id: string): void {
  if (id === app.activeId) return
  stashActive()
  const tab = app.tabs.find((x) => x.id === id)
  if (!tab) return
  applyTab(tab)
}

/** 只读标签（帮助）要藏掉"能改"的入口：源码模式、打字机；并保证不停在源码视图 */
function syncReadonlyUi(): void {
  const ro = activeTab()?.readonly ?? false
  $('btn-source').hidden = ro
  $('btn-typewriter').hidden = ro
  document.body.classList.toggle('tab-readonly', ro)
  if (ro && $('btn-source').classList.contains('on')) toggleSource()
}

function tabbarItems(): TabbarItem[] {
  return app.tabs.map((x) => ({ id: x.id, title: x.name, dirty: x.dirty, kind: x.kind }))
}

function renderTabs(): void {
  if (!tabbar) return
  const show = tabsEnabled() && app.tabs.length > 0 && window.innerWidth > 860
  tabbar.setVisible(show)
  // 标签栏与菜单栏同处一行（v0.11.2）：显示时顶栏右侧的"文件名 + *"与当前标签重复，
  // 用这个类把它们让给标签条；隐藏时（手机 / 单窗口模式）两个提示照常显示。
  document.body.classList.toggle('tabs-on', show)
  if (show) tabbar.render(tabbarItems(), app.activeId)
}

/**
 * 关一个标签。未保存的走三键框：
 *   保存 → 落盘（无路径的弹另存为，用户取消就整体中止）
 *   不保存 → 丢弃，直接关
 *   取消 → 什么都不做
 * 关掉最后一个标签不退出应用，而是补一个空白文档 —— 窗口上空着比"整个窗口跟着消失"好懂。
 */
async function closeTab(id: string): Promise<boolean> {
  const tab = app.tabs.find((x) => x.id === id)
  if (!tab) return false
  const wasActive = id === app.activeId
  const prevId = app.activeId

  /** 为了保存而临时切过去的，取消时要切回原来那篇 */
  const backToPrev = (): void => {
    if (wasActive) return
    const p = app.tabs.find((x) => x.id === prevId)
    if (p && app.activeId !== p.id) applyTab(p)
  }

  if (tab.dirty && !tab.readonly) {
    stashActive()
    if (!wasActive) applyTab(tab, false)
    const choice = await askSave({ name: tab.name })
    if (choice === 'cancel') {
      backToPrev()
      return false
    }
    if (choice === 'save') {
      const ok = await doSave(false)
      if (!ok) {
        backToPrev()
        return false
      }
    }
  }

  const i = app.tabs.indexOf(tab)
  app.tabs.splice(i, 1)

  if (!app.tabs.length) {
    // 兜底：永远至少有一个标签
    const blank = makeTab({ name: t('app.untitled'), content: '' })
    app.activeId = ''
    applyTab(blank)
    return true
  }

  if (wasActive) {
    const next = app.tabs[Math.min(i, app.tabs.length - 1)]
    app.activeId = ''
    applyTab(next)
  } else if (app.activeId === tab.id) {
    backToPrev()
    renderTabs()
  } else {
    renderTabs()
  }
  return true
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
  // 首屏示例文档以实名呈现。docId 由 makeTab 一并给定，否则首次编辑时自动保存会落到
  // 空 id 上（最近文件里出现一条无名记录）。详见 sample.ts 的 SAMPLE_NAME 注释。
  const first = makeTab({
    name: SAMPLE_NAME,
    content: SAMPLE_MD,
    // 光标落在第一行内容之后（示例文档第一行是标题），比停在 0 更像个能直接写的文档
    selection: SAMPLE_MD.indexOf('\n') + 1,
  })

  app.view = new EditorView({ state: first.state, parent: host })
  app.activeId = first.id
  app.fileName = first.name
  app.docId = first.docId
  app.view.focus()

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
  const tab = activeTab()
  // 只读标签（帮助）永远不脏
  if (tab && !tab.readonly) tab.dirty = v
  app.dirty = v
  $('dirty-dot').hidden = !v
  updateTitle()
  renderTabs()
  refreshWorkspaceMarks()
}

/**
 * 文件树 / 最近文件里的 `*` 标记。
 * 只改文字前缀、不动节点结构：这两个列表会被整块重建（打开文件夹、刷新最近），
 * 每次重建后由这里补一次标记即可，不需要额外的状态。
 */
function refreshWorkspaceMarks(): void {
  const dirty = app.tabs.filter((x) => x.dirty && !x.readonly)
  const isDirty = (name: string, path?: string): boolean =>
    dirty.some((x) => (path && x.path ? x.path === path : x.name === name))
  document.querySelectorAll<HTMLElement>('.filetree .node').forEach((node) => {
    const nm = node.querySelector<HTMLElement>('.nm')
    if (!nm) return
    const base = node.dataset.base ?? (node.dataset.base = nm.textContent ?? '')
    const mark = isDirty(base, node.dataset.path) ? '* ' : ''
    const next = mark + base
    if (nm.textContent !== next) nm.textContent = next
  })
}

function updateTitle(): void {
  const name = app.fileName
  $('doc-title').textContent = name
  // `*` 前缀进窗口标题：任务栏/窗口切换器里也能看出没保存（与主流编辑器一致）
  document.title = `${app.dirty ? '* ' : ''}${name} — Lypora`
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
  // 手机隐藏了状态栏，同一份字数在顶栏再挂一份（≤767px 才 display，桌面零成本）
  const mb = document.getElementById('mb-words')
  if (mb) mb.textContent = st.textContent
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
  // 「仅多窗口」模式下打开文件进新窗口，当前窗口的文档原样留着
  if (displayMode() === 'windows' && canMultiWindow()) {
    openNewWindow({ name: res.name, path: res.path, content: res.content })
    toast(t('toast.opened', { name: res.name }))
    return
  }
  loadDocument(res.content, res.name, res.handle, res.path)
  await persistCurrent()
  void renderRecents()
  toast(t('toast.opened', { name: res.name }))
}

/** 新建文档：永远开一个新标签（复用"空白"标签的规则只对"打开文件"生效） */
function newDocument(): void {
  stashActive()
  const tab = makeTab({ name: t('app.untitled'), content: `# ${t('app.newDoc')}\n\n` })
  applyTab(tab)
  toast(t('toast.created'))
}

/**
 * 打开帮助文档（只读标签）。
 * 同一篇帮助只开一个标签：再点一次就切过去，不会越点越多 —— 帮助不是工作文档，
 * 攒一排在标签栏里只会碍事。
 */
function openHelp(id: HelpId): void {
  const exist = app.tabs.find((x) => x.kind === 'help' && x.helpId === id)
  if (exist) {
    activateTab(exist.id)
    return
  }
  stashActive()
  const tab = makeTab({
    name: t(helpTitle(id)),
    content: helpText(id),
    readonly: true,
    kind: 'help',
    helpId: id,
  })
  app.activeId = ''
  applyTab(tab)
}

/**
 * 打开一篇文档到标签栏。
 *  ① 同一个磁盘文件已经在标签里 → 切过去（内容若被外部改过则刷新，脏标记清掉）
 *  ② 当前是"空白未命名且没改过"的标签 → 直接复用，别在旁边留一个空标签
 *  ③ 其余情况 → 新开一个标签
 * 传进来的内容就是磁盘内容，所以同时是 dirty 基准。
 */
function loadDocument(
  content: string,
  name: string,
  handle?: FileSystemFileHandle,
  path?: string,
): void {
  const existing = path ? app.tabs.find((x) => x.path === path) : undefined
  stashActive()

  if (existing) {
    if (existing.state.doc.toString() !== content) {
      existing.state = createEditorState(content, editorHooks(), 0)
      existing.saved = content
      existing.dirty = false
    }
    app.activeId = ''
    applyTab(existing)
    return
  }

  const cur = activeTab()
  // 当前是"没改过、也没落过盘"的标签（首屏示例 / 刚新建的空文档）→ 直接复用。
  // 包括首屏示例：从菜单或命令行打开一篇文档时，没人希望它旁边还挂着一份功能演示。
  const reusable = !!cur && cur.kind === 'doc' && !cur.dirty && !cur.path

  if (reusable && cur) {
    cur.name = name
    cur.handle = handle
    cur.path = path
    cur.docId = `doc:${path || name}`
    cur.saved = content
    cur.dirty = false
    cur.state = createEditorState(content, editorHooks(), 0)
    app.activeId = ''
    applyTab(cur)
    return
  }

  const tab = makeTab({ name, content, handle, path })
  app.activeId = ''
  applyTab(tab)
}

async function doSave(forceAs: boolean): Promise<boolean> {
  if (!app.view) return false
  const tab = activeTab()
  const content = app.view.state.doc.toString()
  const target = forceAs ? undefined : { handle: app.handle, path: app.path }
  const res = await saveFile(content, app.fileName, target)
  if (!res) return false
  const pathBefore = app.path
  if (res.handle) app.handle = res.handle
  if (res.path) app.path = res.path
  app.fileName = res.name
  // 标签自身的字段也要跟着走，否则切走再切回来会退回旧的路径/名字
  if (tab) {
    tab.name = res.name
    tab.handle = app.handle
    tab.path = app.path
    tab.docId = `doc:${app.path || res.name}`
    tab.saved = content
    tab.dirty = false
    tab.state = app.view.state
  }
  // 另存为之后基准目录变了，已渲染的图片必须按新目录重算一次。空事务即可触发
  // ViewPlugin.update（它靠 transactions.length > 0 判断要不要重建装饰）。
  setCurrentDocPath(app.path)
  if (pathBefore !== app.path) app.view?.dispatch({})
  setDirty(false)
  updateTitle()
  renderTabs()
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
  // 帮助文档是内置内容，不进最近文件
  if (activeTab()?.readonly) return
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

/**
 * 侧栏空状态：一句说明 + 一个直接可点的入口。
 * 原先只有两行弱色文字，用户看完还得自己记住去菜单里找（审计 SIDE-1）。
 */
function emptyState(
  box: HTMLElement,
  title: string,
  sub: string,
  actionLabel: string,
  action: () => void,
): void {
  box.innerHTML = ''
  const wrap = document.createElement('div')
  wrap.className = 'empty-hint'
  const t1 = document.createElement('span')
  t1.textContent = title
  wrap.appendChild(t1)
  if (sub) {
    const t2 = document.createElement('span')
    t2.className = 'eh-sub'
    t2.textContent = sub
    wrap.appendChild(t2)
  }
  if (actionLabel) {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'eh-action'
    b.textContent = actionLabel
    b.addEventListener('click', action)
    wrap.appendChild(b)
  }
  box.appendChild(wrap)
}

function renderWorkspace(root: string, entries: WorkspaceEntry[]): void {
  const box = $('filetree')
  box.innerHTML = ''
  if (!entries.length) {
    emptyState(box, t('sidebar.noMarkdown'), t('sidebar.noFolderHint'), t('file.openFolder'), () =>
      void doOpenWorkspace(),
    )
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
      // 记住真实路径：文件树的 `*` 标记与"同文件已开则切过去"都靠它
      if (res.path) node.dataset.path = res.path
      loadDocument(res.content, res.name, res.handle, res.path)
      document.querySelectorAll('.filetree .node').forEach((n) => n.classList.remove('active'))
      node.classList.add('active')
      refreshWorkspaceMarks()
    })
    box.appendChild(node)
  }
  refreshWorkspaceMarks()
}

async function renderRecents(): Promise<void> {
  const docs = await listDocs()
  const box = $('recent-list')
  box.innerHTML = ''
  if (!docs.length) {
    emptyState(box, t('sidebar.noRecents'), '', t('file.open'), () => void doOpen())
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
  refreshWorkspaceMarks()
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

/**
 * 打开排版面板的统一入口。
 * 面板铺满整个编辑区，而菜单是 fixed 浮层 —— 菜单开着时用快捷键开面板，
 * 下拉菜单会浮在面板上盖住标题栏（审计 MENU-3）。所以先主动收起菜单。
 */
function openLayout(): void {
  menubar?.close()
  beautify.open()
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
  // 一级「排版」菜单要画勾选：直接问面板要当前布局，不另存一份（两处真源必然漂）
  const layoutNow = beautify.getLayout()

  /**
   * 主题与设置从顶级降到二级（v0.12.0）。
   *
   * 顶级菜单原来是 9 个（文件/编辑/段落/格式/显示/主题/排版/设置/帮助），
   * 而顶栏从 v0.11.2 起还要和标签条挤一行 —— 每一项都值 40–60px 宽度。
   * 主题本质是"这一屏怎么画"，归「显示」；设置是"这台机器怎么工作"，归「文件」。
   * 这是 Typora 自己的分法，用户的肌肉记忆也在这儿。
   */
  const themeItems: MenuEntry[] = [
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
        ] as MenuEntry[])
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
  ]

  const settingsItems: MenuEntry[] = [
    // 分两个可读的组：前两项是应用级偏好，后两项只管图片（审计 MENU-2）。
    // 只有分隔线时，用户得点进去才知道是哪一类。
    { group: t('settings.groupUi') },
    {
      // 多文档的呈现方式（v0.11.0）：仅标签 / 仅多窗口 / 两者并存。
      // 放在设置里而不是「显示」菜单：它改变的是"文档怎么组织"，不是"这一屏怎么画"。
      id: 'settings-display',
      label: t('settings.displayMode'),
      items: [
        {
          id: 'settings-display-tabs',
          label: t('settings.displayTabs'),
          checked: displayMode() === 'tabs',
          action: () => setDisplayMode('tabs'),
        },
        {
          id: 'settings-display-windows',
          label: t('settings.displayWindows'),
          checked: displayMode() === 'windows',
          // 浏览器 / 手机壳里开不了真窗口，置灰并说明原因
          disabled: !desktop()?.newWindow,
          action: () => setDisplayMode('windows'),
        },
        {
          id: 'settings-display-both',
          label: t('settings.displayBoth'),
          checked: displayMode() === 'both',
          disabled: !desktop()?.newWindow,
          action: () => setDisplayMode('both'),
        },
      ],
    },
    {
      // 语言从顶级降到这里（v0.10.0）：语言是低频设置项，
      // 和"图片怎么存"属于同一类"这台机器怎么工作"的偏好。
      // 各语言一律用母语名显示，不翻译（否则找不到自己那一项）。
      id: 'settings-language',
      label: t('menu.language'),
      items: [
        {
          id: 'lang-system',
          label: t('language.followSystem'),
          checked: pref === 'system',
          action: () => applyLocale('system'),
        },
        { sep: true },
        ...LANGUAGES.map((l) => ({
          id: `lang-${l.id}`,
          label: l.native,
          checked: pref === l.id,
          action: () => applyLocale(l.id),
        })),
      ],
    },
    { group: t('settings.groupImage') },
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
  ]

  return [
    {
      id: 'file',
      label: t('menu.file'),
      items: [
        {
          id: 'file-create',
          label: t('file.create'),
          shortcut: 'Ctrl+N',
          action: () => newDocument(),
        },
        // 「新建窗口」只在允许窗口的模式下出现（仅 tabs 模式给了也没用）
        ...(canMultiWindow()
          ? [
              {
                id: 'file-new-window',
                label: t('file.newWindow'),
                shortcut: 'Ctrl+Shift+N',
                action: () => openNewWindow(),
              },
            ]
          : []),
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
        // 「美化输出」在 v0.10.0 升成一级菜单「排版」，不再挂在文件菜单下：
        // 它是输出层的独立板块（模板/背景/尺寸/分页），不属于"导出这份文件"。
        { sep: true },
        // v0.12.0：设置从顶级降到这里（主题降进「显示」）—— 顶级 9 → 7 项
        { id: 'file-settings', label: t('menu.settings'), items: settingsItems },
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
        { sep: true },
        // v0.12.0：主题降进「显示」—— 它本来就是"这一屏怎么画"
        { id: 'view-theme', label: t('menu.theme'), items: themeItems },
      ],
    },
    {
      // 「排版」一级菜单（v0.10.0 从「文件 → 美化输出」升上来）：
      // 输出层已经是独立板块（20 套模板 / 背景 / 装订 / 尺寸 / 分页），
      // 再挂在文件菜单下会让人以为它只是又一种"导出格式"。
      id: 'layout',
      label: t('menu.layout'),
      items: [
        { id: 'layout-open', label: t('layout.open'), shortcut: 'Ctrl+Shift+P', action: () => openLayout() },
        { sep: true },
        {
          id: 'layout-size',
          label: t('card.size'),
          items: CARD_SIZES.map((s) => ({
            id: `layout-size-${s.id}`,
            label: t(s.labelKey as MessageKey),
            checked: layoutNow.sizeId === s.id,
            action: () => beautify.setLayout({ sizeId: s.id }),
          })),
        },
        {
          id: 'layout-split',
          label: t('card.split'),
          items: [
            { id: 'layout-split-auto', label: t('card.splitAuto'), checked: layoutNow.mode === 'auto', action: () => beautify.setLayout({ mode: 'auto' }) },
            { id: 'layout-split-rule', label: t('card.splitRule'), checked: layoutNow.mode === 'rule', action: () => beautify.setLayout({ mode: 'rule' }) },
            { id: 'layout-split-none', label: t('card.splitNone'), checked: layoutNow.mode === 'none', action: () => beautify.setLayout({ mode: 'none' }) },
          ],
        },
        {
          id: 'layout-cover',
          label: t('card.cover'),
          checked: layoutNow.withCover,
          action: () => beautify.setLayout({ withCover: !layoutNow.withCover }),
        },
      ],
    },
    {
      id: 'help',
      label: t('menu.help'),
      items: HELP_DOCS.map((d) => ({
        id: `help-${d.id}`,
        label: t(d.titleKey),
        // F1 直通快捷键那一篇（旧版 F1 弹的是一句提示）
        shortcut: d.id === 'shortcuts' ? 'F1' : undefined,
        action: () => openHelp(d.id),
      })),
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
  refreshHelpTabs()
}

/**
 * 切语言后把帮助标签的正文与标题换成新语种。
 * 只重建帮助标签的 EditorState：它们是只读的、没有取舍成本，重建最省事；
 * 普通文档绝不重建（会丢撤销历史）。
 */
function refreshHelpTabs(): void {
  for (const tab of app.tabs) {
    if (tab.kind !== 'help' || !tab.helpId) continue
    tab.name = t(helpTitle(tab.helpId))
    tab.saved = helpText(tab.helpId)
    tab.state = createEditorState(tab.saved, editorHooks(), 0, { readonly: true })
    if (tab.id === app.activeId) {
      app.fileName = tab.name
      app.view?.setState(tab.state)
      updateTitle()
      updateCounts(tab.saved)
      refreshOutline(tab.saved)
    }
  }
  renderTabs()
}

/* ------------------------------------------------------------------ *
 * UI 绑定
 * ------------------------------------------------------------------ */
function bindUI(): void {
  updateTitle()
  menubar = createMenubar($('menubar-items'), buildMenus)
  // 标签栏：mousedown 激活、× / 中键关闭、+ 新建（新建走与"新建文档"菜单同一条路径）
  tabbar = createTabbar($('tabbar'), {
    onActivate: (id) => activateTab(id),
    onClose: (id) => void closeTab(id),
    onNew: () => void newDocument(),
  })
  renderTabs()
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

  // 侧栏空状态里的两个入口（index.html 静态那一份；动态渲染走 emptyState()）。
  // 空状态是新用户第一眼看到的东西，得能直接点进下一步（审计 SIDE-1）。
  $('eh-open-folder').addEventListener('click', () => void doOpenWorkspace())
  $('eh-open-file').addEventListener('click', () => void doOpen())
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
      const c = btn.dataset.cmd
      // 「更多」这类外壳按钮没有 data-cmd，交回 mobile.ts 处理；这里不要抢焦点
      if (!c || !app.view) return
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
    beautify: () => openLayout(),
  })

  // 全局快捷键（与菜单上标注的一致）
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey

    if (e.key === 'F1') {
      e.preventDefault()
      showHelp()
      return
    }
    // Ctrl+Shift+N：新窗口（仅标签模式下不响应，菜单项也没给）
    if (mod && e.shiftKey && e.key.toLowerCase() === 'n') {
      if (canMultiWindow()) {
        e.preventDefault()
        openNewWindow()
      }
      return
    }
    // Ctrl+W：关当前标签（不直接关窗口 —— 关窗口仍走叉号/系统快捷键的守卫流程）
    if (mod && !e.shiftKey && e.key.toLowerCase() === 'w' && tabsEnabled()) {
      e.preventDefault()
      void closeTab(app.activeId)
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
      // 必须走 newDocument()：loadDocument() 命中"复用干净无路径标签"的规则，
      // 连按 Ctrl+N 只会把当前标签换个名字，与菜单「新建」和帮助文档写的行为都相反（审计 TAB-1）
      newDocument()
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
    if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
      e.preventDefault()
      openLayout()
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
    if (desktop() || !app.tabs.some((x) => x.dirty && !x.readonly)) return
    e.preventDefault()
    e.returnValue = ''
  })

  // 同一套关闭流程中，主进程需要知道"是否脏"并能触发保存（多标签下要报全部脏标签）
  if (desktop()) {
    window.__lyporaCloseState = () => {
      const dirty = app.tabs.filter((x) => x.dirty && !x.readonly)
      return { dirty: dirty.length > 0, name: dirty[0]?.name ?? app.fileName, names: dirty.map((x) => x.name) }
    }
    window.__lyporaSaveAndClose = async () => {
      try {
        // 逐篇保存：切到该标签再走正常保存流程（未命名的会弹另存为，取消即整体中止）
        for (const tab of app.tabs.filter((x) => x.dirty && !x.readonly)) {
          stashActive()
          if (app.activeId !== tab.id) applyTab(tab, false)
          const ok = await doSave(false)
          if (!ok) return { ok: false, cancelled: true }
        }
        return { ok: true }
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
  // v0.11.0 起帮助是只读文档，不再是 toast；F1 直接开「快捷键」那一篇
  openHelp('shortcuts')
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
