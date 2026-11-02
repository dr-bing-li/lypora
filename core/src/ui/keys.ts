/**
 * 修饰键的平台化显示。
 *
 * 功能层面不需要这个文件：CodeMirror 的 `Mod-` 会自己映射到 Cmd，全局 keydown 也一直用
 * `e.ctrlKey || e.metaKey`。但**显示**必须分开——菜单上写着「Ctrl+S」而用户手里是 Mac，
 * 那就是错的说明。macOS 的惯例是符号化并按 ⌃⌥⇧⌘ 的顺序连排：⌘S、⇧⌘Z。
 *
 * 平台判定优先级：
 *   1. `window.lyporaDesktop.platform`（Electron 预加载脚本注入，最准）；
 *   2. `navigator.platform` / UA（浏览器 / PWA 下兜底）。
 * 移动端（Android/iOS）一律按非 mac 处理——触屏外壳里根本不显示这些提示。
 */

const MAC: boolean = (() => {
  const w = window as unknown as { lyporaDesktop?: { platform?: string } }
  const p = w.lyporaDesktop?.platform
  if (p) return p === 'darwin'
  if (typeof navigator === 'undefined') return false
  const plat = (navigator.platform || '') + ' ' + (navigator.userAgent || '')
  return /Mac|iPhone|iPad|iPod/i.test(plat)
})()

export function isMacPlatform(): boolean {
  return MAC
}

/** 符号与顺序：macOS 习惯 ⌃⌥⇧⌘ 从外到内 */
const SYMBOL: Record<string, string> = {
  ctrl: '⌃',
  control: '⌃',
  alt: '⌥',
  option: '⌥',
  opt: '⌥',
  shift: '⇧',
  cmd: '⌘',
  command: '⌘',
  meta: '⌘',
  super: '⌘',
  win: '⌘',
}
const ORDER = ['⌃', '⌥', '⇧', '⌘']

/**
 * 少数几个键位在 macOS 上不是"把 Ctrl 换成 ⌘"就对的：重做在 Windows 是 Ctrl+Y，
 * 在 macOS 是 ⇧⌘Z。这类差异集中写在这里，别散落到各个菜单项。
 */
const MAC_ALIAS: Record<string, string> = {
  'Ctrl+Y': 'Ctrl+Shift+Z',
  'Ctrl+Del': 'Ctrl+Backspace',
}

/** 把 "Ctrl+Shift+S" 这类写法按当前平台格式化 */
export function formatShortcut(s: string): string {
  if (!s) return ''
  if (!MAC) return s
  const src = MAC_ALIAS[s] || s
  const parts = src.split('+').map((x) => x.trim()).filter(Boolean)
  if (parts.length === 0) return ''

  const mods: string[] = []
  const keys: string[] = []
  for (const p of parts) {
    const sym = SYMBOL[p.toLowerCase()]
    if (sym) mods.push(sym)
    else keys.push(p)
  }
  const ordered = [...new Set(mods)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b))
  // 单一可打印字符不加大写化处理（"=" "/" "-" 之类），字母统一大写更接近原生菜单
  const tail = keys.map((k) => (k.length === 1 ? k.toUpperCase() : k)).join('')
  return ordered.join('') + tail
}

/**
 * 自由文本里的快捷键（帮助提示那种整句话）——只做符号替换，不改顺序。
 * 例：`Ctrl+B 粗体 · Ctrl+K 链接` → `⌘B 粗体 · ⌘K 链接`
 */
export function formatShortcutText(s: string): string {
  if (!MAC || !s) return s
  return s
    .replace(/\bCtrl\+/g, '⌘')
    .replace(/\bShift\+/g, '⇧')
    .replace(/\bAlt\+/g, '⌥')
}
