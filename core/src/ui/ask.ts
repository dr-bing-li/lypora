/**
 * 极简文本输入弹窗。
 *
 * 为什么不用 window.prompt：Electron 里 `prompt()` 不存在（抛 not implemented），
 * 手机 WebView 里的原生 prompt 又会挡住软键盘、样式不可控。所以自绘一个。
 *
 * 与 main.ts 里的 askNumber 是同一套视觉（复用 .modal-mask / .modal / .modal-actions），
 * 只是这里要的是字符串，所以单独抽出来给需要命名的地方用（模板、后续的收藏夹等）。
 */

import { t } from '../i18n'

export interface AskTextOptions {
  title: string
  hint?: string
  value?: string
  /** 最多允许输入多少个字符（按 UTF-16 长度算，中文够用） */
  maxLength?: number
  okText?: string
  cancelText?: string
}

export function askText(o: AskTextOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const max = o.maxLength ?? 40
    const mask = document.createElement('div')
    mask.className = 'modal-mask'
    const box = document.createElement('div')
    box.className = 'modal'
    const h = document.createElement('h3')
    h.textContent = o.title
    const p = document.createElement('p')
    p.textContent = o.hint ?? ''
    p.hidden = !o.hint

    const input = document.createElement('input')
    input.type = 'text'
    input.maxLength = max
    input.value = o.value ?? ''
    input.setAttribute('autocomplete', 'off')
    input.style.width = '100%'

    const actions = document.createElement('div')
    actions.className = 'modal-actions'
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = o.cancelText ?? t('dialog.cancel')
    const ok = document.createElement('button')
    ok.type = 'button'
    ok.className = 'primary'
    ok.textContent = o.okText ?? t('dialog.ok')
    actions.append(cancel, ok)

    box.append(h, p, input, actions)
    mask.append(box)
    document.body.append(mask)

    const finish = (v: string | null) => {
      window.removeEventListener('keydown', onKey, true)
      mask.remove()
      resolve(v)
    }
    const commit = () => {
      const v = input.value.trim().slice(0, max)
      finish(v || null)
    }
    // 捕获阶段：编辑器在 document 上监听快捷键，不拦住的话 ⌘S / Esc 会漏到编辑器
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
