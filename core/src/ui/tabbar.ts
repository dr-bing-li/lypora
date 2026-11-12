/**
 * 标签栏（v0.11.0）。
 *
 * 设计要点：
 * 1. **纯渲染**：标签数据的真源在 main.ts 的 tabs 数组，这里只负责画和转发点击。
 *    渲染函数每次整块重建 —— 标签数量是个位到十几，重建比 diff 便宜，也不会残留旧监听。
 * 2. **横滑而不是压缩**：长度超出时横向滚动（`overflow-x`），标签自己 `flex: 0 0 auto`。
 *    压缩宽度会让标题全变成省略号，反而找不到东西。
 * 3. **`*` 跟在标题后面**：与标题同一行、颜色用告警色，宽度固定，避免切换时整排抖动。
 */

import { t } from '../i18n'

export interface TabbarItem {
  id: string
  title: string
  /** 磁盘未保存标记（内容与上次落盘不一致） */
  dirty: boolean
  /** 文档 / 帮助。帮助标签带一个图标，且永不显示 `*` */
  kind: 'doc' | 'help'
}

export interface TabbarDeps {
  onActivate: (id: string) => void
  onClose: (id: string) => void
  onNew: () => void
}

export interface TabbarHandle {
  render: (items: TabbarItem[], activeId: string) => void
  /** 显示/隐藏整条（仅多窗口模式、手机窄屏都不显示） */
  setVisible: (v: boolean) => void
}

export function createTabbar(host: HTMLElement, deps: TabbarDeps): TabbarHandle {
  const render = (items: TabbarItem[], activeId: string): void => {
    host.innerHTML = ''

    for (const it of items) {
      const tab = document.createElement('div')
      tab.className = 'tab-item'
      tab.dataset.tabId = it.id
      tab.setAttribute('role', 'tab')
      tab.setAttribute('aria-selected', String(it.id === activeId))
      if (it.id === activeId) tab.classList.add('active')
      if (it.dirty) tab.classList.add('is-dirty')
      tab.title = it.dirty ? t('tab.unsavedTip', { name: it.title }) : it.title

      if (it.kind === 'help') {
        const ico = document.createElement('span')
        ico.className = 'tb-icon'
        ico.textContent = '?'
        ico.setAttribute('aria-hidden', 'true')
        tab.appendChild(ico)
      }

      const label = document.createElement('span')
      label.className = 'tb-title'
      label.textContent = it.title
      tab.appendChild(label)

      // `*` 常驻占位（未保存时显示），否则切换标签整排文字会左右跳
      const dot = document.createElement('span')
      dot.className = 'tb-dirty'
      dot.textContent = it.dirty && it.kind === 'doc' ? '*' : ''
      tab.appendChild(dot)

      const close = document.createElement('button')
      close.type = 'button'
      close.className = 'tb-close'
      close.dataset.act = 'close'
      close.setAttribute('aria-label', t('tab.close'))
      close.title = t('tab.close')
      close.textContent = '×'
      tab.appendChild(close)

      // 用 mousedown 激活：与菜单栏一致，避免与 document 上的 click 抢跑
      tab.addEventListener('mousedown', (e) => {
        if ((e.target as HTMLElement).dataset.act === 'close') return
        if (e.button !== 0) return
        e.preventDefault()
        deps.onActivate(it.id)
      })
      // 中键关闭（Windows/Linux 浏览器的肌肉记忆）
      tab.addEventListener('auxclick', (e) => {
        if (e.button !== 1) return
        e.preventDefault()
        deps.onClose(it.id)
      })
      close.addEventListener('click', (e) => {
        e.stopPropagation()
        deps.onClose(it.id)
      })
      host.appendChild(tab)
    }

    const add = document.createElement('button')
    add.type = 'button'
    add.className = 'tb-new'
    add.dataset.act = 'new-tab'
    add.title = t('tab.new')
    add.setAttribute('aria-label', t('tab.new'))
    add.textContent = '+'
    add.addEventListener('click', () => deps.onNew())
    host.appendChild(add)

    // 切到靠后的标签时让它自己滑进可视区
    const active = host.querySelector<HTMLElement>('.tab-item.active')
    if (active && host.scrollWidth > host.clientWidth) {
      const l = active.offsetLeft
      const r = l + active.offsetWidth
      if (l < host.scrollLeft) host.scrollLeft = l - 8
      else if (r > host.scrollLeft + host.clientWidth) host.scrollLeft = r - host.clientWidth + 8
    }
  }

  const setVisible = (v: boolean): void => {
    // hidden 属性配 CSS 的 !important 才能压过 .tabbar 的 display:flex（项目约定 V11）
    host.hidden = !v
  }

  return { render, setVisible }
}
