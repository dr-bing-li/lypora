let timer: number | undefined
let el: HTMLElement | null = null

export function toast(msg: string, ms = 1900, silent = false): void {
  if (silent) return
  if (!el) el = document.getElementById('toast')
  if (!el) return
  el.textContent = msg
  el.hidden = false
  if (timer !== undefined) clearTimeout(timer)
  timer = window.setTimeout(() => {
    if (el) el.hidden = true
  }, ms)
}
