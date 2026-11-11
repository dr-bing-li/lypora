/**
 * 移动外壳（触屏优先）—— 只在窄屏启用，桌面布局一行不改。
 *
 * 为什么单开一层而不是把桌面 DOM 改窄：
 *   桌面那套「7 个顶级菜单 + 左侧栏常驻」在 390px 宽度上会横向溢出，
 *   而菜单的 hover 二级、拖拽把手、`title` 提示在触屏上根本不成立。
 *   这里做的事是：窄屏时把菜单收进一个底部弹出的分区面板（sheet），
 *   把最常用的 6 个动作放到拇指能勾到的底部工具栏，侧栏改成抽屉 + 遮罩。
 *
 * 约定：
 *   - 组件只负责「布局与手势」，所有动作都通过 handlers 回调交回 main.ts，
 *     不在这里碰编辑器状态（避免两处真源）。
 *   - 菜单数据每次打开时现取 getMenus()，勾选态永远最新，与桌面菜单同一份真源。
 *   - 断点 767px：与 CSS 里的 `@media (max-width: 767px)` 保持同一数值。
 */

import type { MenuDef, MenuEntry } from './menubar'
import { t, type MessageKey } from '../i18n'

export const MOBILE_BREAKPOINT = 860

export interface MobileHandlers {
  /** 打开本地文件（系统文件选择器） */
  open: () => void
  /** 保存到应用文稿目录 */
  save: () => void
  /** 切换侧栏（大纲） */
  toggleOutline: () => void
  /** 打开「排版」面板（v0.10.0 起是一级功能，手机端给一个直达按钮） */
  beautify: () => void
}

/** 底部工具栏的 7 个动作；`sheet` 表示"打开分区面板并滚到该菜单" */
const DOCK: Array<{ id: string; labelKey: MessageKey; icon: string; sheet?: string }> = [
  { id: 'open', labelKey: 'dock.open', icon: '<path d="M2.5 5.2A1.2 1.2 0 013.7 4h2.9l1.1 1.4h4.6a1.2 1.2 0 011.2 1.2v5.2A1.2 1.2 0 0112.3 13H3.7A1.2 1.2 0 012.5 11.8V5.2z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/>' },
  { id: 'save', labelKey: 'dock.save', icon: '<path d="M3.5 2.6h6.6L13.4 5.9v7.5H3.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/><path d="M5.6 2.6v3.6h4.3V2.6M5.6 13.4V9.1h4.8v4.3" fill="none" stroke="currentColor" stroke-width="1.2"/>' },
  { id: 'outline', labelKey: 'dock.outline', icon: '<path d="M3 4h4M3 8h7M3 12h10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" fill="none"/>' },
  { id: 'export', labelKey: 'dock.export', icon: '<path d="M8 2.6v7.2M5.2 7l2.8 2.8L10.8 7" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><path d="M2.8 11v1.8h10.4V11" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>', sheet: 'file' },
  { id: 'layout', labelKey: 'dock.layout', icon: '<rect x="2.3" y="2.7" width="11.4" height="10.6" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M4.6 5.9h6.8M4.6 8h6.8M4.6 10.1h3.9" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" fill="none"/>' },
  { id: 'theme', labelKey: 'dock.theme', icon: '<circle cx="8" cy="8" r="5.2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 2.8v10.4a5.2 5.2 0 000-10.4z" fill="currentColor"/>', sheet: 'theme' },
  { id: 'menu', labelKey: 'dock.menu', icon: '<path d="M3 4.5h10M3 8h10M3 11.5h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" fill="none"/>' },
]

let sheetEl: HTMLElement | null = null
let sheetBackdrop: HTMLElement | null = null
let scrimEl: HTMLElement | null = null
let dockEl: HTMLElement | null = null
let menusRef: (() => MenuDef[]) | null = null

/** 按钮的可见文案与 aria-label 同源，切语言时整块重画 */
function paintDockButton(btn: HTMLButtonElement, item: (typeof DOCK)[number]): void {
  const label = t(item.labelKey)
  btn.setAttribute('aria-label', label)
  btn.innerHTML = `<svg viewBox="0 0 16 16" width="21" height="21" aria-hidden="true">${item.icon}</svg><span>${label}</span>`
}

/**
 * 切语言后重画移动端的文字（dock 按钮、面板标题、面板内容）。
 * 由 main.ts 在 locale 变化时调用；面板没打开时不重铺内容，省一次渲染。
 */
export function refreshMobileLabels(): void {
  if (dockEl) {
    for (const item of DOCK) {
      const btn = dockEl.querySelector<HTMLButtonElement>(`.ma-btn[data-act="${item.id}"]`)
      if (btn) paintDockButton(btn, item)
    }
  }
  const title = sheetEl?.querySelector('.sheet-title')
  if (title) title.textContent = t('dock.menu')
  const close = sheetEl?.querySelector<HTMLElement>('.sheet-close')
  if (close) close.setAttribute('aria-label', t('dock.close'))
  if (sheetEl && !sheetEl.hidden && menusRef) {
    fillSheet(sheetEl, menusRef(), () => {})
  }
}

export function isMobileViewport(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches
}

/* ------------------------------------------------------------------ *
 * 视口 / 软键盘：把可视区高度写成 CSS 变量
 * ------------------------------------------------------------------ */
function bindViewport(): void {
  const app = document.getElementById('app')
  if (!app) return
  const vv = window.visualViewport

  const apply = () => {
    // 用视觉视口高度当外壳高度：无论 WebView 是 adjustResize 还是 adjustPan，
    // 工具栏都会自动贴在键盘上沿，不需要猜系统行为。
    const h = vv ? vv.height : window.innerHeight
    app.style.setProperty('--app-h', `${Math.round(h)}px`)
    const hidden = vv ? Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0)) : 0
    document.body.classList.toggle('kb-open', hidden > 120)
  }

  apply()
  vv?.addEventListener('resize', apply)
  vv?.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', () => setTimeout(apply, 120))
}

/* ------------------------------------------------------------------ *
 * 底部工具栏
 * ------------------------------------------------------------------ */
function buildDock(handlers: MobileHandlers, openSheet: (section?: string) => void): HTMLElement {
  const dock = document.createElement('div')
  dock.className = 'mobile-dock'
  dock.id = 'mobile-dock'

  // 把原有的格式化条（粗体/斜体/标题…）搬进来，放在动作行之上：
  // 写作时它就在键盘正上方，不写作时只占一行的视觉噪声。
  const fmt = document.getElementById('mobile-toolbar')
  if (fmt) dock.appendChild(fmt)

  const row = document.createElement('div')
  row.className = 'mobile-actions'
  for (const item of DOCK) {
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'ma-btn'
    btn.dataset.act = item.id
    paintDockButton(btn, item)
    btn.addEventListener('click', () => {
      switch (item.id) {
        case 'open':
          handlers.open()
          break
        case 'save':
          handlers.save()
          break
        case 'outline':
          handlers.toggleOutline()
          break
        case 'export':
          openSheet('file')
          break
        case 'layout':
          handlers.beautify()
          break
        case 'theme':
          openSheet('theme')
          break
        default:
          openSheet()
      }
    })
    row.appendChild(btn)
  }
  dock.appendChild(row)
  // 底座永远是最下层的一个元素：状态栏（若可见）排在它上面，
  // 否则平板上会出现"工具栏下面还压着一条状态栏"的怪样子
  document.getElementById('app')?.appendChild(dock)
  return dock
}

/* ------------------------------------------------------------------ *
 * 分区面板（sheet）：把 7 个菜单摊平成"分区 + 行"
 * ------------------------------------------------------------------ */
function renderEntries(items: MenuEntry[], depth: number, onDone: () => void): HTMLElement[] {
  const out: HTMLElement[] = []
  for (const it of items) {
    if (it.sep) {
      const hr = document.createElement('div')
      hr.className = 'sheet-sep'
      out.push(hr)
      continue
    }
    if (it.items) {
      // 二级菜单（页面宽度那一组）：平铺成带小标题的一组行，触屏上没有 hover
      const head = document.createElement('div')
      head.className = 'sheet-sub'
      head.textContent = it.label ?? ''
      out.push(head)
      out.push(...renderEntries(it.items, depth + 1, onDone))
      continue
    }
    const row = document.createElement('button')
    row.type = 'button'
    row.className = 'sheet-row'
    if (it.id) row.dataset.mi = it.id
    if (depth > 0) row.classList.add('nested')
    if (it.disabled) row.disabled = true
    if (it.checked) row.classList.add('checked')

    const check = document.createElement('span')
    check.className = 'sr-check'
    check.textContent = it.checked ? '✓' : ''
    const label = document.createElement('span')
    label.className = 'sr-label'
    label.textContent = it.label ?? ''
    const sc = document.createElement('span')
    sc.className = 'sr-shortcut'
    // 触屏没有物理键盘，快捷键只对连着键盘的平板/桌面模式有意义，弱化显示
    sc.textContent = it.shortcut && /^(Ctrl|Alt|F\d)/.test(it.shortcut) ? '' : (it.shortcut ?? '')
    row.append(check, label, sc)

    row.addEventListener('click', () => {
      onDone()
      // 让面板先收起，再把控制权交回菜单动作（动作可能弹系统对话框）
      requestAnimationFrame(() => it.action?.())
    })
    out.push(row)
  }
  return out
}

function buildSheet(getMenus: () => MenuDef[], closeSheet: () => void): HTMLElement {
  const sheet = document.createElement('div')
  sheet.className = 'sheet'
  sheet.id = 'menu-sheet'
  sheet.hidden = true

  const head = document.createElement('div')
  head.className = 'sheet-head'
  const title = document.createElement('span')
  title.className = 'sheet-title'
  title.textContent = t('dock.menu')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'sheet-close'
  close.setAttribute('aria-label', t('dock.close'))
  close.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>'
  close.addEventListener('click', closeSheet)
  head.append(title, close)

  const body = document.createElement('div')
  body.className = 'sheet-body'
  body.id = 'sheet-body'

  sheet.append(head, body)

  // 独立遮罩：不跟面板抢 z-index，避免 z-index:-1 的伪元素把面板内容一起压暗（实测过）
  const backdrop = document.createElement('div')
  backdrop.className = 'sheet-backdrop'
  backdrop.hidden = true
  backdrop.addEventListener('click', closeSheet)
  document.body.append(backdrop, sheet)
  sheetBackdrop = backdrop
  // 面板自身也要能挡住点击，否则点空白处会穿透到编辑器
  sheet.addEventListener('click', (e) => {
    if (e.target === sheet) closeSheet()
  })
  return sheet
}

function fillSheet(sheet: HTMLElement, menus: MenuDef[], onDone: () => void): void {
  const body = sheet.querySelector<HTMLElement>('#sheet-body')
  if (!body) return
  body.innerHTML = ''
  for (const menu of menus) {
    const sec = document.createElement('section')
    sec.className = 'sheet-section'
    // 用菜单 id 而不是显示名做 key：切语言后 data-section 不变，滚动定位与测试都稳
    sec.dataset.section = menu.id
    const h = document.createElement('h4')
    h.className = 'sheet-section-title'
    h.textContent = menu.label
    sec.appendChild(h)
    for (const row of renderEntries(menu.items, 0, onDone)) sec.appendChild(row)
    body.appendChild(sec)
  }
}

/* ------------------------------------------------------------------ *
 * 侧栏抽屉：给现有 #sidebar 配遮罩，选中项后自动收起
 * ------------------------------------------------------------------ */
function bindDrawer(): void {
  const sidebar = document.getElementById('sidebar')
  if (!sidebar) return

  const sync = () => {
    const open = !sidebar.classList.contains('collapsed') && isMobileViewport()
    document.body.classList.toggle('drawer-open', open)
    if (scrimEl) scrimEl.hidden = !open
  }

  scrimEl = document.createElement('div')
  scrimEl.className = 'drawer-scrim'
  scrimEl.hidden = true
  scrimEl.addEventListener('click', () => {
    document.getElementById('btn-collapse-sidebar')?.click()
  })
  // 挂在 .workspace 里而不是 #app 上：侧栏本身就在 .workspace 的坐标系里（top:0 = 菜单栏下方），
  // 遮罩必须和它同坐标系，否则顶到菜单栏上会把菜单也一起挡住（实测点不到）。
  const workspace = sidebar.closest('.workspace') ?? document.getElementById('app')
  workspace?.insertBefore(scrimEl, workspace.firstChild)

  new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] })
  window.addEventListener('resize', sync)
  sync()

  // 点大纲条目 / 最近文件 = 已经完成导航，抽屉该收起来（手机上遮罩会挡住正文）
  for (const id of ['outline-body', 'recent-list']) {
    document.getElementById(id)?.addEventListener('click', (e) => {
      if (!isMobileViewport()) return
      if ((e.target as HTMLElement).closest('button, .outline-item, .node, .file-item, a')) {
        document.getElementById('btn-collapse-sidebar')?.click()
      }
    })
  }
}

/* ------------------------------------------------------------------ *
 * 入口
 * ------------------------------------------------------------------ */
export function initMobileShell(getMenus: () => MenuDef[], handlers: MobileHandlers): void {
  bindViewport()
  menusRef = getMenus

  let closeSheet = () => {}
  const sheet = buildSheet(getMenus, () => closeSheet())
  sheetEl = sheet

  closeSheet = () => {
    sheet.hidden = true
    if (sheetBackdrop) sheetBackdrop.hidden = true
    document.body.classList.remove('sheet-open')
  }

  const openSheet = (section?: string) => {
    fillSheet(sheet, getMenus(), closeSheet)
    sheet.hidden = false
    if (sheetBackdrop) sheetBackdrop.hidden = false
    document.body.classList.add('sheet-open')
    const target = section
      ? sheet.querySelector<HTMLElement>(`.sheet-section[data-section="${section}"]`)
      : null
    const body = sheet.querySelector<HTMLElement>('#sheet-body')
    if (target && body) body.scrollTop = Math.max(0, target.offsetTop - 8)
    else if (body) body.scrollTop = 0
  }

  dockEl = buildDock(handlers, openSheet)
  bindDrawer()

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !sheet.hidden) closeSheet()
  })

  // 桌面 ↔ 手机切换：dock 由 CSS 控制显隐，这里只清理面板状态
  window.addEventListener('resize', () => {
    if (!isMobileViewport() && !sheet.hidden) closeSheet()
  })

  void dockEl
}
