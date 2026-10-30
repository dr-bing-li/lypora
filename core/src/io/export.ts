/**
 * 导出管线 —— 对应 docs/02 §5.3 / §3.4
 *   · Markdown：原文直出（保证无损）
 *   · HTML：自研 md→html 转换器 + 当前主题 CSS 内联，产出单文件
 *   · PDF：把导出的 HTML 注入隐藏 iframe 后调用 print()，由浏览器/Chromium 打印引擎出 PDF
 *     （桌面环境等同于参考实现的 printToPDF 路径）
 */

import katex from 'katex'
import { escapeHtml } from '../util'
import { downloadBlob } from './files'
import { toast } from '../ui/toast'
import { KATEX_CSS } from './katex-inline'

/* ------------------------------------------------------------------ *
 * 行内转换
 * ------------------------------------------------------------------ */
export function inlineToHtml(text: string): string {
  const holes: string[] = []
  const hold = (html: string): string => {
    holes.push(html)
    return `\u0000${holes.length - 1}\u0000`
  }

  let s = text

  // 1) 行内代码
  s = s.replace(/`([^`]+)`/g, (_m, c: string) => hold(`<code>${escapeHtml(c)}</code>`))
  // 2) 行内公式
  s = s.replace(/(?<![\\$])\$(?!\$)([^\n$]+?)\$(?!\$)/g, (_m, c: string) => {
    try {
      return hold(katex.renderToString(c.trim(), { displayMode: false, throwOnError: false, output: 'html' }))
    } catch {
      return hold(escapeHtml(_m as string))
    }
  })
  // 3) 图片
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, alt: string, src: string, title?: string) =>
    hold(`<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${title ? ` title="${escapeHtml(title)}"` : ''}>`),
  )
  // 4) 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_m, t: string, href: string, title?: string) =>
    hold(`<a href="${escapeHtml(href)}"${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(t)}</a>`),
  )

  s = escapeHtml(s)

  // 5) 强调
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, '<strong><em>$1</em></strong>')
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>')
  s = s.replace(/(^|[^\w*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  s = s.replace(/(^|[^\w_])_([^_\n]+)_/g, '$1<em>$2</em>')
  s = s.replace(/~~([^~]+)~~/g, '<del>$1</del>')
  s = s.replace(/==([^=]+)==/g, '<mark>$1</mark>')
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!$])/g, '$1')

  // 6) 换行：行尾两个空格
  s = s.replace(/ {2,}$/gm, '<br>')

  // 还原占位
  s = s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => holes[Number(i)] ?? '')
  return s
}

/* ------------------------------------------------------------------ *
 * 块级转换
 * ------------------------------------------------------------------ */
interface ListFrame {
  ordered: boolean
  start: number
}

export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let i = 0

  const isBlank = (s: string) => s.trim() === ''

  while (i < lines.length) {
    const line = lines[i]

    if (isBlank(line)) {
      i++
      continue
    }

    // 围栏代码
    const fence = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
    if (fence) {
      const mark = fence[1][0]
      const lang = fence[2] || ''
      const buf: string[] = []
      i++
      while (i < lines.length && !new RegExp(`^\\s{0,3}${mark}{${fence[1].length},}\\s*$`).test(lines[i])) {
        buf.push(lines[i])
        i++
      }
      i++
      out.push(
        `<pre class="code-block"${lang ? ` data-lang="${escapeHtml(lang)}"` : ''}><code>${escapeHtml(buf.join('\n'))}</code></pre>`,
      )
      continue
    }

    // 块公式
    if (line.trim() === '$$') {
      const buf: string[] = []
      i++
      while (i < lines.length && lines[i].trim() !== '$$') {
        buf.push(lines[i])
        i++
      }
      i++
      try {
        out.push(
          `<div class="math-block">${katex.renderToString(buf.join('\n'), { displayMode: true, throwOnError: false, output: 'html' })}</div>`,
        )
      } catch {
        out.push(`<pre class="code-block"><code>${escapeHtml(buf.join('\n'))}</code></pre>`)
      }
      continue
    }

    // 标题
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      out.push(`<h${h[1].length}>${inlineToHtml(h[2])}</h${h[1].length}>`)
      i++
      continue
    }

    // 分割线
    if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(line)) {
      out.push('<hr>')
      i++
      continue
    }

    // 表格
    if (line.includes('|') && i + 1 < lines.length && /^[\s:|-]+$/.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      const rows: string[][] = [splitRow(line)]
      const aligns = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':')
        const r = c.endsWith(':')
        return l && r ? 'center' : r ? 'right' : 'left'
      })
      i += 2
      while (i < lines.length && lines[i].includes('|') && !isBlank(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      const head = rows[0]
      const body = rows.slice(1)
      out.push('<table>')
      out.push('<thead><tr>' + head.map((c, k) => `<th style="text-align:${aligns[k] || 'left'}">${inlineToHtml(c)}</th>`).join('') + '</tr></thead>')
      if (body.length) {
        out.push('<tbody>')
        for (const r of body) {
          out.push('<tr>' + head.map((_c, k) => `<td style="text-align:${aligns[k] || 'left'}">${inlineToHtml(r[k] ?? '')}</td>`).join('') + '</tr>')
        }
        out.push('</tbody>')
      }
      out.push('</table>')
      continue
    }

    // 引用
    if (/^\s{0,3}>/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s{0,3}>\s?/, ''))
        i++
      }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'))}</blockquote>`)
      continue
    }

    // 列表
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const res = parseList(lines, i)
      out.push(res.html)
      i = res.next
      continue
    }

    // HTML 块（原样透传，与参考实现行为一致）
    if (/^\s*<([a-zA-Z][\w-]*)/.test(line) && !/^\s*</.test(lines[i + 1] ?? '')) {
      const tag = /^\s*<([a-zA-Z][\w-]*)/.exec(line)![1].toLowerCase()
      const voidTags = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source'])
      if (!voidTags.has(tag)) {
        const buf: string[] = []
        const closeRe = new RegExp(`</${tag}>`, 'i')
        while (i < lines.length) {
          buf.push(lines[i])
          const done = closeRe.test(lines[i])
          i++
          if (done) break
        }
        out.push(buf.join('\n'))
        continue
      }
    }

    // 段落
    const para: string[] = []
    while (i < lines.length && !isBlank(lines[i]) && !isBlockStart(lines, i)) {
      para.push(lines[i])
      i++
    }
    if (para.length) out.push(`<p>${inlineToHtml(para.join('\n'))}</p>`)
  }

  return out.join('\n')
}

function isBlockStart(lines: string[], i: number): boolean {
  const l = lines[i]
  if (/^\s{0,3}(`{3,}|~{3,})/.test(l)) return true
  if (l.trim() === '$$') return true
  if (/^(#{1,6})\s+/.test(l)) return true
  if (/^\s{0,3}>/.test(l)) return true
  if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) return true
  if (/^\s{0,3}([-*_])\s*(\1\s*){2,}$/.test(l)) return true
  if (l.includes('|') && i + 1 < lines.length && /^[\s:|-]+$/.test(lines[i + 1])) return true
  return false
}

function splitRow(line: string): string[] {
  const cells: string[] = []
  let cur = ''
  for (let k = 0; k < line.length; k++) {
    const ch = line[k]
    if (ch === '\\' && line[k + 1] === '|') {
      cur += '|'
      k++
    } else if (ch === '|') {
      cells.push(cur)
      cur = ''
    } else cur += ch
  }
  cells.push(cur)
  if (cells.length && cells[0].trim() === '') cells.shift()
  if (cells.length && cells[cells.length - 1].trim() === '') cells.pop()
  return cells.map((c) => c.trim())
}

function parseList(lines: string[], start: number): { html: string; next: number } {
  const first = /^(\s*)([-*+]|\d+[.)])\s+/.exec(lines[start])!
  const baseIndent = first[1].length
  const ordered = /\d/.test(first[2])
  let i = start

  const items: string[] = []
  while (i < lines.length) {
    const m = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(lines[i])
    if (!m) {
      // 续行
      if (!/^\s*$/.test(lines[i]) && items.length && /^\s{2,}/.test(lines[i])) {
        items[items.length - 1] += '\n' + lines[i].trim()
        i++
        continue
      }
      break
    }
    if (m[1].length < baseIndent) break
    if (m[1].length > baseIndent) {
      // 嵌套：把连续嵌套行整体交给递归
      const sub = parseList(lines, i)
      items[items.length - 1] += '\n\n' + sub.html
      i = sub.next
      continue
    }
    items.push(m[3])
    i++
  }

  const startNum = ordered ? parseInt(first[2], 10) || 1 : 1
  const html: string[] = []
  html.push(ordered ? `<ol${startNum !== 1 ? ` start="${startNum}"` : ''}>` : '<ul>')
  for (const raw of items) {
    const task = /^\[([ xX])\]\s+(.*)$/s.exec(raw)
    if (task) {
      const checked = task[1].toLowerCase() === 'x'
      html.push(
        `<li class="task${checked ? ' done' : ''}"><input type="checkbox" disabled${checked ? ' checked' : ''}> ${inlineToHtml(task[2])}</li>`,
      )
    } else if (/\n\n<(ul|ol)>/.test(raw)) {
      const [head, , nested] = raw.split(/\n\n(?=<(?:ul|ol)>)/)
      html.push(`<li>${inlineToHtml(head)}${nested ?? ''}</li>`)
    } else {
      html.push(`<li>${inlineToHtml(raw)}</li>`)
    }
  }
  html.push(ordered ? '</ol>' : '</ul>')
  return { html: html.join('\n'), next: i }
}

/* ------------------------------------------------------------------ *
 * 导出文档骨架
 * ------------------------------------------------------------------ */
const THEME_VARS = [
  '--bg', '--bg-elev', '--fg', '--fg-muted', '--fg-faint', '--border', '--border-soft',
  '--accent', '--accent-soft', '--code-bg', '--code-fg', '--quote-fg', '--quote-bar',
  '--mark-bg', '--font-body', '--font-mono', '--font-head',
  '--content-width', '--content-font-size', '--content-line-height',
]

function collectThemeVars(): string {
  const cs = getComputedStyle(document.documentElement)
  return THEME_VARS.map((v) => `${v}: ${cs.getPropertyValue(v).trim()};`).join('\n  ')
}

export function buildHtmlDocument(md: string, title: string): string {
  const body = mdToHtml(md)
  // 公式：KaTeX 的 HTML 只是「骨架」，排版完全靠 katex.min.css（.vlist/.strut/.sizing 的
  // 定位规则）+ 20 个 KaTeX 字体。导出的是独立文档，应用内的样式不会跟过去，
  // 所以这里必须把这份 CSS（字体已 base64 内联）一并塞进去，否则公式会退化成一串
  // 平铺文字、还带一条横向滚动条（docs/04 V34）。
  // 文档里没有公式就不塞，避免给纯文字导出白白加 360KB。
  const mathCss = body.includes('class="katex') ? KATEX_CSS : ''
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${mathCss}
:root {
  ${collectThemeVars()}
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font-family: var(--font-body);
  font-size: var(--content-font-size);
  line-height: var(--content-line-height);
  -webkit-font-smoothing: antialiased;
}
main {
  max-width: var(--content-width);
  margin: 0 auto;
  padding: 48px 28px 80px;
}
h1, h2, h3, h4, h5, h6 { font-family: var(--font-head); font-weight: 650; line-height: 1.4; }
h1 { font-size: 2em; margin: 1.5em 0 0.4em; }
h2 { font-size: 1.6em; margin: 1.4em 0 0.3em; }
h3 { font-size: 1.32em; margin: 1.25em 0 0.25em; }
h4 { font-size: 1.13em; margin: 1.05em 0 0.2em; }
h5 { font-size: 1em; margin: 1.05em 0 0.2em; }
h6 { font-size: 0.92em; margin: 1.05em 0 0.2em; color: var(--fg-muted); }
h1:first-child, h2:first-child { margin-top: 0; }
p { margin: 0.85em 0; }
a { color: var(--accent); text-decoration: underline; text-underline-offset: 2px; }
code {
  font-family: var(--font-mono);
  font-size: 0.875em;
  background: var(--code-bg);
  color: var(--code-fg);
  padding: 0.15em 0.36em;
  border-radius: 4px;
  border: 1px solid var(--border-soft);
}
pre.code-block {
  background: var(--code-bg);
  border-radius: 6px;
  padding: 14px 16px;
  overflow-x: auto;
  margin: 1em 0;
  position: relative;
}
pre.code-block code { background: none; border: none; padding: 0; font-size: 0.875em; line-height: 1.62; }
pre.code-block[data-lang]::before {
  content: attr(data-lang);
  position: absolute;
  top: 6px; right: 10px;
  font-size: 10.5px;
  color: var(--fg-faint);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
blockquote {
  margin: 1em 0;
  padding: 0.1em 0 0.1em 1em;
  border-left: 3px solid var(--quote-bar);
  color: var(--quote-fg);
}
ul, ol { margin: 0.85em 0; padding-left: 1.6em; }
li { margin: 0.28em 0; }
li.task { list-style: none; margin-left: -1.3em; }
li.task input { margin-right: 0.4em; vertical-align: -0.08em; }
li.task.done { color: var(--fg-muted); }
table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.94em; }
th, td { border: 1px solid var(--border); padding: 7px 12px; text-align: left; vertical-align: top; }
th { background: var(--bg-elev); font-weight: 650; }
hr { border: none; border-top: 1px solid var(--border); margin: 1.6em 0; }
img { max-width: 100%; border-radius: 4px; }
.math-block { margin: 1em 0; overflow-x: auto; text-align: center; }
.math-block:empty { display: none; }
math-field, .katex-display { margin: 0.4em 0; }
/* 行内公式不要被行高裁掉上下伸部（积分号、根号、分式） */
.katex { line-height: 1.2; }
.katex-display > .katex { display: inline-block; max-width: 100%; }
mark { background: var(--mark-bg); padding: 0 2px; border-radius: 3px; }
del { color: var(--fg-muted); }
@media print {
  body { background: #fff; }
  main { max-width: 100%; padding: 0; }
  pre, table, blockquote, .math-block, .katex-display { break-inside: avoid; }
  /* 打印时不能出现横向滚动条：宽公式宁可露出边界也不裁掉内容 */
  .math-block { overflow: visible; }
  @page { size: A4; margin: 18mm 16mm; }
}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>`
}

export function exportMarkdown(content: string, name: string): void {
  downloadBlob(content, ensureExt(name, '.md'), 'text/markdown;charset=utf-8')
}

export function exportHtml(content: string, name: string): void {
  downloadBlob(buildHtmlDocument(content, stripExt(name)), ensureExt(name, '.html'), 'text/html;charset=utf-8')
}

/** PDF：注入隐藏 iframe 后走浏览器打印引擎 */
export function exportPdf(content: string, name: string): void {
  const html = buildHtmlDocument(content, stripExt(name))
  const iframe = document.createElement('iframe')
  // 不能给 0×0：那样 iframe 内部排版宽度是 0，数学块/代码块会撑出横向滚动条，
  // 而打印快照会把这条滚动条一起印进 PDF（V35）。这里按 A4 的可打印宽度
  // （210mm - 左右各 16mm = 178mm ≈ 672 CSS px）给它真实版面，再移出视口隐藏。
  iframe.style.cssText =
    'position:fixed;left:-20000px;top:0;width:672px;height:1123px;border:0;opacity:0;pointer-events:none'
  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    document.body.removeChild(iframe)
    openInNewWindow(html)
    return
  }
  doc.open()
  doc.write(html)
  doc.close()

  const cleanup = () => setTimeout(() => iframe.parentNode && iframe.parentNode.removeChild(iframe), 800)

  let printed = false
  const doPrint = async () => {
    if (printed) return
    printed = true
    const win = iframe.contentWindow
    // 等字体就位再打印：KaTeX 的上下标/分式/根号定位依赖字体度量，
    // 字体没加载完就 print() 会印出「平铺」版公式（V34）。
    try {
      const fonts = (iframe.contentDocument as Document | null)?.fonts
      if (fonts?.ready) {
        await Promise.race([fonts.ready, new Promise((r) => setTimeout(r, 3000))])
        // 再等两帧，确保字体度量重排后的版面已经落到打印快照里
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      }
    } catch {
      /* 无 document.fonts 的环境直接打印 */
    }
    try {
      win?.focus()
      win?.print()
    } catch {
      openInNewWindow(html)
    }
    cleanup()
  }

  iframe.onload = doPrint
  // onload 在某些情况下不触发，兜底一次
  setTimeout(doPrint, 900)
}

function openInNewWindow(html: string): void {
  const w = window.open('', '_blank')
  if (!w) {
    toast('浏览器拦截了弹出窗口，请允许后重试')
    return
  }
  w.document.write(html)
  w.document.close()
  const print = () => w.print()
  const fonts = (w.document as Document | null)?.fonts
  if (fonts?.ready) void fonts.ready.then(() => setTimeout(print, 60), () => setTimeout(print, 500))
  else setTimeout(print, 500)
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '')
}

function ensureExt(name: string, ext: string): string {
  return name.toLowerCase().endsWith(ext) ? name : stripExt(name) + ext
}
