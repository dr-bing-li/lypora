/**
 * 三键确认框（保存 / 不保存 / 取消）。
 *
 * 与 ask.ts 共用 .modal-mask / .modal 这套视觉，区别在于这里问的是"要不要保存"，
 * 返回值必须是三态 —— 用两个按钮的 confirm 表达不了"取消"（用户想反悔、回去继续写）。
 *
 * 为什么不用 window.confirm：Electron 里 confirm 是同步阻塞的原生框，样式和语言都不受控；
 * 手机 WebView 的 confirm 还会把软键盘顶掉。自绘才能三端一致、跟着界面语言走。
 */

import { t } from '../i18n'

export type SaveChoice = 'save' | 'discard' | 'cancel'

export interface AskSaveOptions {
  /** 文档名，用「」包起来显示 */
  name: string
  /** 一次有多篇时列在正文里（关窗口的场景） */
  extraNames?: string[]
  /** 保存按钮文案（关窗口时是"保存并关闭"） */
  saveText?: string
}

/**
 * 弹一次"是否保存更改"。
 * Enter = 保存，Esc = 取消（与系统原生对话框的默认键一致，误触不会丢内容）。
 */
export function askSave(o: AskSaveOptions): Promise<SaveChoice> {
  return new Promise((resolve) => {
    // 记下打开前的焦点：关闭后要还回去，否则键盘用户会掉到 body，
    // 下一次 Tab 从菜单栏重新开始（审计 DLG-1）
    const prevFocus = document.activeElement as HTMLElement | null

    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    mask.dataset.role = 'save-confirm'

    const box = document.createElement('div')
    box.className = 'modal'
    // 没有这套语义，读屏软件不会把下面的内容当成"暂时不可操作"，
    // 也不会播报标题是哪一句
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    const titleId = 'lypora-confirm-title'
    box.setAttribute('aria-labelledby', titleId)

    const h = document.createElement('h3')
    h.id = titleId
    h.textContent = t('confirm.unsavedTitle', { name: o.name })

    const p = document.createElement('p')
    const extra = o.extraNames ?? []
    p.textContent = extra.length
      ? t('confirm.unsavedMore', { n: extra.length, names: extra.join('、') })
      : t('confirm.unsavedDetail')

    const actions = document.createElement('div')
    actions.className = 'modal-actions'

    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = t('dialog.cancel')
    cancel.dataset.act = 'cancel'

    const discard = document.createElement('button')
    discard.type = 'button'
    discard.className = 'danger'
    discard.textContent = t('confirm.discard')
    discard.dataset.act = 'discard'

    const save = document.createElement('button')
    save.type = 'button'
    save.className = 'primary'
    save.textContent = o.saveText ?? t('confirm.save')
    save.dataset.act = 'save'

    actions.append(cancel, discard, save)
    box.append(h, p, actions)
    mask.append(box)
    document.body.append(mask)

    const finish = (v: SaveChoice) => {
      window.removeEventListener('keydown', onKey, true)
      mask.remove()
      // 焦点还给打开前的元素（编辑器或标签），别让它掉到 body 上
      if (prevFocus && document.contains(prevFocus)) prevFocus.focus()
      resolve(v)
    }
    const btns = [cancel, discard, save]
    // 捕获阶段：编辑器在 document 上监听快捷键，Ctrl+S / Esc 不能漏到下面去
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish('cancel')
      } else if (e.key === 'Tab') {
        // 焦点陷阱：只在三个按钮之间循环（首尾互跳）。
        // 不做这一步，按一次 Tab 就跑到菜单栏去了，键盘用户会以为框已经关掉。
        e.preventDefault()
        e.stopPropagation()
        const cur = btns.indexOf(document.activeElement as HTMLButtonElement)
        const next = cur < 0 ? (e.shiftKey ? btns.length - 1 : 0) : (cur + (e.shiftKey ? -1 : 1) + btns.length) % btns.length
        btns[next].focus()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        // Enter 触发当前焦点所在的按钮；焦点不在按钮上时（比如点了正文）按默认走"保存"
        const f = document.activeElement as HTMLButtonElement | null
        const act = f && box.contains(f) ? (f.dataset.act as SaveChoice | undefined) : undefined
        finish(act ?? 'save')
      }
    }
    window.addEventListener('keydown', onKey, true)
    save.addEventListener('click', () => finish('save'))
    discard.addEventListener('click', () => finish('discard'))
    cancel.addEventListener('click', () => finish('cancel'))
    mask.addEventListener('mousedown', (e) => {
      // 点遮罩当取消：与"关掉这个框"语义一致，绝不默认丢弃
      if (e.target === mask) finish('cancel')
    })

    save.focus()
  })
}
