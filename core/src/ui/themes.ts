/**
 * 主题系统 —— 一套「主题 = 一份 CSS」的轻量模型。
 *
 * 内置 6 套主题：Github / Night / Pixyll / Whitey / Vue / Newsprint，
 * 主题就是一份 CSS，切换即时生效；第三方主题的做法是往主题目录里丢 .css。
 *   - 内置主题 = style.css 里的 [data-theme='x'] 变量块（本项目原创，非复制品）；
 *   - 自定义主题 = 用户导入的 .css，运行时注入 <style>，可覆盖任意变量与选择器；
 *   - 两者都进「主题」菜单，当前生效的打勾。
 *
 * 注意：外部编辑器生态的第三方主题写的是 #write h1 这类选择器，变量名是
 * --bg-color / --text-color，与本项目（CM6 的 .cm-line + --bg/--fg）完全不同名。
 * 因此导入时统一走 ui/theme-adapter.ts 做**选择器 + 变量双转译**，
 * 转译后第三方主题才能真的改到编辑区。手写主题仍可直接用本项目变量，模板见 THEME_TEMPLATE。
 */

import { translateThemeCss, type ThemeStats } from './theme-adapter'

export type { ThemeStats }

export interface ThemeDef {
  id: string
  label: string
  dark?: boolean
}

/** 6 套内置主题（样式全部自研，仅版面观感对齐参考实现） */
export const BUILTIN_THEMES: ThemeDef[] = [
  { id: 'github', label: 'Github' },
  { id: 'night', label: 'Night', dark: true },
  { id: 'pixyll', label: 'Pixyll' },
  { id: 'whitey', label: 'Whitey' },
  { id: 'vue', label: 'Vue' },
  { id: 'newsprint', label: 'Newsprint' },
]

export interface CustomTheme {
  name: string
  css: string
}

const STORE_KEY = 'lypora.customThemes'
const STYLE_ID = 'lypora-custom-theme'

export function listCustomThemes(): CustomTheme[] {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    if (!Array.isArray(arr)) return []
    return arr.filter((t) => t && typeof t.name === 'string' && typeof t.css === 'string')
  } catch {
    return []
  }
}

function persist(list: CustomTheme[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list))
  } catch {
    /* 配额满时静默失败，不影响当前会话 */
  }
}

export function addCustomTheme(name: string, css: string): boolean {
  const list = listCustomThemes().filter((t) => t.name !== name)
  list.push({ name, css })
  persist(list)
  return true
}

export function removeCustomTheme(name: string): void {
  persist(listCustomThemes().filter((t) => t.name !== name))
}

/**
 * 注入/清除自定义主题样式层（总是位于内置主题之后，因此优先级更高）。
 * 注入前统一过一遍适配层：外部格式的 .css（#write h1 / --bg-color 那一套）
 * 会被转译到本项目的 .cm-line 结构与 --bg/--fg 变量上，否则一条规则也命中不了。
 */
export function applyCustomCss(css: string | null): ThemeStats | null {
  let el = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (!css) {
    el?.remove()
    return null
  }
  const { css: translated, stats } = translateThemeCss(css)
  if (!el) {
    el = document.createElement('style')
    el.id = STYLE_ID
    document.head.appendChild(el)
  }
  el.textContent = translated
  return stats
}

/** 自定义主题骨架：把这份粘贴进 .css 改值即可 */
export const THEME_TEMPLATE = `/* Lypora 自定义主题模板
   —— 改下面的变量即可，其余保持默认。
   保存为 你的主题名.css，然后 主题 → 导入自定义主题… 选中它。 */

:root {
  --bg: #ffffff;          /* 页面底色 */
  --bg-elev: #f6f8fa;     /* 悬浮层 / 次级底色 */
  --bg-side: #f6f8fa;     /* 侧栏底色 */
  --fg: #24292f;          /* 正文 */
  --fg-muted: #6e7781;    /* 次要文字 */
  --fg-faint: #afb8c1;    /* 弱化文字（语法标记） */
  --border: #d0d7de;
  --border-soft: #e6eaef;
  --accent: #0969da;      /* 强调色：链接 / 光标 / 勾选 */
  --accent-soft: #ddf4ff;
  --code-bg: #f6f8fa;
  --code-fg: #24292f;
  --quote-fg: #57606a;
  --quote-bar: #d0d7de;
  --sel: #b6d7ff;         /* 选区 */
  --mark-bg: #fff8c5;     /* ==高亮== */
  --content-width: 860px; /* 版心宽度 */
  --content-font-size: 16px;
  --content-line-height: 1.75;
  --font-body: -apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  --font-mono: 'JetBrains Mono', Consolas, monospace;
  --font-head: var(--font-body);
}
`
