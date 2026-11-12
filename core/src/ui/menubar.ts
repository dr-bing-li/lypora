/**
 * 菜单栏（对齐参考实现的「文件 / 编辑 / 段落 / 格式 / 显示 / 主题 / 帮助」）
 *
 * 设计要点：
 * 1. 菜单项数据由外部每次 open 时现取（getMenus），这样勾选态、禁用态永远是最新的，
 *    不需要任何 refresh 通道。
 * 2. 纯 DOM 手写，不引框架；下拉层是独立浮层，用 fixed 定位，避免被 overflow 裁切。
 * 3. 菜单开着时鼠标划过其它顶级菜单直接切换（Windows 原生菜单的肌肉记忆）。
 */

import { formatShortcut } from './keys'

export interface MenuEntry {
  /**
   * 稳定的动作标识（与显示语言无关）。给两处用：
   *   ① 自动化测试按 `[data-mi="export-html"]` 定位，切了语言也不会失配；
   *   ② 移动端面板按 id 滚到对应菜单，不靠中文标签当 key。
   */
  id?: string
  label?: string
  shortcut?: string
  action?: () => void
  /** 打勾态（单选菜单用）；undefined 表示不显示勾选位 */
  checked?: boolean
  disabled?: boolean
  /** 分隔线 */
  sep?: true
  /**
   * 不可点的分组小标题（设置菜单里把"界面"和"图片"分开用）。
   * 与 sep 的区别：sep 只是留白，group 还给出层级语义（审计 MENU-2）。
   */
  group?: string
  /** 子菜单：有值时该项变成二级菜单入口（点击不触发 action） */
  items?: MenuEntry[]
}

export interface MenuDef {
  id: string
  label: string
  items: MenuEntry[]
}

export interface MenubarHandle {
  /** 重新取菜单数据并重绘（切语言、菜单项状态变化时用） */
  redraw: () => void
  /** 收起当前下拉层（整屏面板打开前调用） */
  close: () => void
}

export function createMenubar(host: HTMLElement, getMenus: () => MenuDef[]): MenubarHandle {
  let openIndex = -1
  let pop: HTMLElement | null = null
  let subPop: HTMLElement | null = null
  let subAnchor: HTMLElement | null = null

  const closeSub = () => {
    subPop?.remove()
    subPop = null
    subAnchor = null
  }

  const close = () => {
    openIndex = -1
    closeSub()
    pop?.remove()
    pop = null
    host.querySelectorAll('.menu-root').forEach((b) => b.classList.remove('open'))
  }

  /** 建一个下拉层（顶层与二级共用同一套渲染，二级只是定位不同） */
  const buildPop = (items: MenuEntry[], sub: boolean): HTMLElement => {
    const el = document.createElement('div')
    el.className = sub ? 'menu-drop sub' : 'menu-drop'

    for (const it of items) {
      if (it.sep) {
        el.appendChild(document.createElement('hr'))
        continue
      }
      if (it.group) {
        // 不可点的小标题：给出"这两项属于哪一类"的层级，比一条分隔线信息量大
        const h = document.createElement('div')
        h.className = 'mi-group'
        h.textContent = it.group
        el.appendChild(h)
        continue
      }
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'menu-item'
      if (it.id) btn.dataset.mi = it.id
      if (it.disabled) btn.disabled = true
      if (it.checked) btn.classList.add('checked')

      const check = document.createElement('span')
      check.className = 'mi-check'
      check.textContent = it.checked ? '✓' : ''
      const lab = document.createElement('span')
      lab.className = 'mi-label'
      lab.textContent = it.label ?? ''
      const sc = document.createElement('span')
      sc.className = 'mi-shortcut'
      // 平台化显示：macOS 上 Ctrl+S 要显示成 ⌘S（见 ui/keys.ts 的说明）
      sc.textContent = formatShortcut(it.shortcut ?? '')
      btn.append(check, lab, sc)

      if (it.items) {
        // 二级菜单：父项不可点，靠 hover 展开（与 Windows 原生菜单一致）
        btn.classList.add('has-sub')
        const arrow = document.createElement('span')
        arrow.className = 'mi-arrow'
        // 用 12px chevron 而不是 `›` 字符：字符的实际盒宽只有 4px，
        // 用户看不出这一项还能展开（v0.11.0 审计 MENU-1）。SVG 是常量串，不走模板注入。
        arrow.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        btn.appendChild(arrow)
        btn.addEventListener('mouseenter', () => openSub(btn, it.items as MenuEntry[]))
        btn.addEventListener('click', () => {
          /* 父项点击不关闭菜单，避免手抖误关 */
        })
      } else {
        btn.addEventListener('mouseenter', () => {
          // 只有"顶层下拉"里的兄弟项才收起二级；二级自己的项如果也走这里，
          // 鼠标一进子菜单就会把子菜单关掉（自食其尾，实测菜单点不中）。
          if (!sub && subAnchor && subAnchor !== btn) closeSub()
        })
        btn.addEventListener('click', () => {
          close()
          it.action?.()
        })
      }
      el.appendChild(btn)
    }
    document.body.appendChild(el)
    return el
  }

  /** 二级菜单定位：优先贴父项右侧，越界则翻到左侧 */
  const openSub = (anchor: HTMLElement, items: MenuEntry[]) => {
    if (subAnchor === anchor) return
    closeSub()
    const el = buildPop(items, true)
    const r = anchor.getBoundingClientRect()
    const w = el.offsetWidth
    const h = el.offsetHeight
    let left = r.right - 3
    if (left + w > window.innerWidth - 6) left = Math.max(6, r.left - w + 3)
    let top = r.top - 4
    if (top + h > window.innerHeight - 6) top = Math.max(6, window.innerHeight - h - 6)
    el.style.left = `${left}px`
    el.style.top = `${top}px`
    subPop = el
    subAnchor = anchor
  }

  const renderPop = (rootBtn: HTMLElement, def: MenuDef) => {
    closeSub()
    pop?.remove()
    const el = buildPop(def.items, false)
    pop = el
    const r = rootBtn.getBoundingClientRect()
    const w = el.offsetWidth
    el.style.left = `${Math.max(6, Math.min(window.innerWidth - w - 6, r.left))}px`
    el.style.top = `${r.bottom}px`
    rootBtn.classList.add('open')
  }

  const openAt = (idx: number, menus: MenuDef[]) => {
    const btns = host.querySelectorAll<HTMLElement>('.menu-root')
    const btn = btns[idx]
    if (!btn) return
    close()
    openIndex = idx
    renderPop(btn, menus[idx])
  }

  const draw = () => {
    const menus = getMenus()
    host.innerHTML = ''
    menus.forEach((m, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'menu-root'
      btn.dataset.menu = m.id
      btn.textContent = m.label
      btn.addEventListener('mousedown', (e) => {
        // mousedown 而不是 click：避免与"点击外部关闭"的 document click 抢跑
        e.preventDefault()
        e.stopPropagation()
        if (openIndex === i) close()
        else openAt(i, getMenus())
      })
      btn.addEventListener('mouseenter', () => {
        if (openIndex >= 0 && openIndex !== i) openAt(i, getMenus())
      })
      host.appendChild(btn)
    })
  }

  draw()

  document.addEventListener('mousedown', (e) => {
    if (openIndex < 0) return
    const t = e.target as Node
    if (pop?.contains(t) || subPop?.contains(t) || host.contains(t)) return
    close()
  })

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || openIndex < 0) return
    e.preventDefault()
    // Esc 逐级退：先收二级，再关顶层
    if (subPop) closeSub()
    else close()
  })

  window.addEventListener('resize', () => {
    if (openIndex >= 0) close()
  })

  window.addEventListener('blur', () => {
    if (openIndex >= 0) close()
  })

  return {
    redraw: () => {
      // 下拉层开着时重绘会把定位算法算在旧尺寸上，先收再画最省事
      close()
      draw()
    },
    /**
     * 主动收起下拉层。整屏面板打开前要调用：
     * 菜单是 fixed 浮层，面板铺满时它会浮在面板标题栏上，看起来像渲染错乱（审计 MENU-3）。
     * 靠调 z-index 解决不了这个场景 —— 面板里还有二级弹层要用更高的层。
     */
    close,
  }
}
