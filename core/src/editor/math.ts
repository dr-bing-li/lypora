import katex from 'katex'
import 'katex/dist/katex.min.css'

const inlineCache = new Map<string, string>()
const blockCache = new Map<string, string>()

function render(src: string, displayMode: boolean): string {
  const key = (displayMode ? 'B:' : 'I:') + src
  const cache = displayMode ? blockCache : inlineCache
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  let html: string
  try {
    html = katex.renderToString(src, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      output: 'html',
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    html = `<span class="cm-math-error">公式错误：${escapeHtml(msg)}</span>`
  }
  // 缓存上限，避免长时间编辑把内存吃穿
  if (cache.size > 400) cache.clear()
  cache.set(key, html)
  return html
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export function renderInlineMath(src: string): string {
  return render(src.trim(), false)
}

export function renderBlockMath(src: string): string {
  return render(src.trim(), true)
}

/** 行内公式匹配：$...$（排除 $$、转义 \$、跨行）。返回 [from, to, 源码内容] */
export function findInlineMath(text: string): Array<{ start: number; end: number; body: string }> {
  const out: Array<{ start: number; end: number; body: string }> = []
  const re = /(?<![\\$])\$(?!\$)([^\n$]{1,300}?)(?<![\\$])\$(?!\$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    // 排除 "$5 和 $10" 这类金额写法：内容必须含有数学特征或非纯数字加空格
    const body = m[1]
    if (/^\s*\d[\d,.]*\s*$/.test(body)) continue
    out.push({ start: m.index, end: m.index + m[0].length, body })
  }
  return out
}
