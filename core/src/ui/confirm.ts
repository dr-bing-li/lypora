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
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    mask.dataset.role = 'save-confirm'

    const box = document.createElement('div')
    box.className = 'modal'

    const h = document.createElement('h3')
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
      resolve(v)
    }
    // 捕获阶段：编辑器在 document 上监听快捷键，Ctrl+S / Esc 不能漏到下面去
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        finish('cancel')
      } else if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        finish('save')
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
