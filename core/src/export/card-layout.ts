/**
 * 卡片排版与分页 —— 把一份 Markdown 切成若干张固定尺寸的卡片。
 *
 * 三条设计原则（沿用 v0.8.2，已在实战里验证过）：
 * 1. **复用既有渲染器**：markdown → HTML 仍走 io/export.ts 的 `mdToHtml`，只做顶层块切分，
 *    绝不复刻第二套解析器——两套解析器的行为漂移是这类功能最常见的腐坏源。
 * 2. **用真实 DOM 测量分页，不估算**。中文混排下"字符数 × 行高"必然出错，做法是把块
 *    逐个塞进同尺寸离屏卡片量 `scrollHeight`，超了就回退换页——与浏览器自己的排版一致。
 * 3. **分页结果是纯 HTML 字符串**，不持有 DOM 引用；预览、PNG、PDF 三条出口共用同一份。
 *
 * Lypora 的变化：所有样式来自**当前模板**，测量容器、预览、截图注入的是
 * 同一份 `stylesheetFor(template)`。模板参数一改，分页结果自动重算。
 */

import { escapeHtml } from '../util'
import { mdToHtml } from '../io/export'
import { KATEX_CSS } from '../io/katex-inline'
import { highlightCode } from '../editor/highlight'
import { findSize, type CardSize } from './card-themes'
import { decorAttrs, stylesheetFor } from './template/compile'
import type { CardTemplate } from './template/types'

export type SplitMode = 'auto' | 'rule' | 'none'

export interface CardPage {
  kind: 'cover' | 'content'
  /** 卡片 `.ly-inner` 内部 HTML（不含装饰元素） */
  inner: string
  /** 该页首个标题，用于页眉 */
  section?: string
}

export interface LayoutOptions {
  template: CardTemplate
  sizeId: string
  mode: SplitMode
  withCover: boolean
  /** 文档名，用于页眉 */
  docTitle: string
}

export interface LayoutResult {
  pages: CardPage[]
  size: CardSize
  template: CardTemplate
  /** 被裁掉的长块数量（拆无可拆时） */
  clipped: number
}

/* ------------------------------------------------------------------ *
 * markdown → 顶层块
 * ------------------------------------------------------------------ */

const RULE_PAGE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/

function splitSource(md: string, mode: SplitMode): string[] {
  const src = md.replace(/\r\n?/g, '\n')
  if (mode !== 'rule') return [src]
  const out: string[] = []
  let buf: string[] = []
  for (const line of src.split('\n')) {
    if (RULE_PAGE.test(line)) {
      out.push(buf.join('\n'))
      buf = []
    } else buf.push(line)
  }
  out.push(buf.join('\n'))
  return out.filter((s) => s.trim() !== '')
}

const PARSER = new DOMParser()

function htmlToBlocks(html: string): HTMLElement[] {
  const doc = PARSER.parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')
  if (!root) return []
  return Array.from(root.children) as HTMLElement[]
}

/** 给代码块上色：把 textContent 换成 token span，语义与编辑器高亮器一致 */
function paintCode(el: HTMLElement): void {
  const pre = el.matches('pre.code-block') ? el : (el.querySelector('pre.code-block') as HTMLElement | null)
  if (!pre) return
  pre.classList.remove('code-block')
  pre.classList.add('ly-code')
  const code = pre.querySelector('code')
  if (!code) return
  const lang = pre.getAttribute('data-lang') || ''
  const raw = code.textContent ?? ''
  const toks = highlightCode(raw, lang)
  if (!toks.length) {
    code.textContent = raw
  } else {
    let out = ''
    let at = 0
    for (const tk of toks) {
      if (tk.from > at) out += escapeHtml(raw.slice(at, tk.from))
      out += `<span class="${tk.cls}">${escapeHtml(raw.slice(tk.from, tk.to))}</span>`
      at = tk.to
    }
    if (at < raw.length) out += escapeHtml(raw.slice(at))
    code.innerHTML = out
  }
  if (lang) {
    const tag = document.createElement('span')
    tag.className = 'ly-lang'
    tag.textContent = lang
    pre.appendChild(tag)
  }
}

function normalizeMath(el: HTMLElement): void {
  for (const m of Array.from(el.querySelectorAll('.math-block'))) m.classList.add('ly-math')
  if (el.classList.contains('math-block')) el.classList.add('ly-math')
}

/* ------------------------------------------------------------------ *
 * 卡片骨架（页眉 / 页脚 / 版面开关都由模板决定）
 * ------------------------------------------------------------------ */

function shellHtml(tpl: CardTemplate, bodyHtml: string, docTitle: string, section: string, page: string): string {
  const m = tpl.metrics
  const head = m.headRule
    ? `<div class="ly-head"><span class="ly-doc">${escapeHtml(docTitle)}</span><span class="ly-sec">${escapeHtml(section)}</span></div>`
    : ''
  const showPage = m.pageNo && page !== ''
  const showBrand = !!m.brand
  const foot =
    showPage || showBrand
      ? `<div class="ly-foot">${showBrand ? `<span class="ly-brand">${escapeHtml(m.brand)}</span>` : ''}${
          showPage ? `<span class="ly-page">${escapeHtml(page)}</span>` : ''
        }</div>`
      : ''
  return `<div class="ly-inner">${head}<div class="ly-body">${bodyHtml}</div>${foot}</div>`
}

/* ------------------------------------------------------------------ *
 * 离屏测量容器
 * ------------------------------------------------------------------ */

const MEASURE_ID = 'ly-card-measure'

interface Measurer {
  card: HTMLElement
  body: HTMLElement
  dispose(): void
}

function createMeasurer(size: CardSize, tpl: CardTemplate, docTitle: string): Measurer {
  let host = document.getElementById(MEASURE_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = MEASURE_ID
    // 不可见但保留真实布局上下文：display:none 量不出高度
    host.style.cssText =
      'position:fixed;left:-30000px;top:0;width:0;height:0;overflow:visible;pointer-events:none;opacity:0;z-index:-1'
    document.body.appendChild(host)
  }
  host.innerHTML = ''
  const style = document.createElement('style')
  // KaTeX 的 HTML 只是骨架，高度全靠 .vlist/.strut 定位；测量容器不带这份 CSS，
  // 公式会被当平铺文字量高度，分页从第一张卡就偏
  style.textContent = stylesheetFor(tpl) + '\n' + KATEX_CSS
  host.appendChild(style)

  const card = document.createElement('div')
  card.className = 'ly-card'
  card.setAttribute('data-tpl', tpl.id)
  card.setAttribute('data-tex', tpl.decor.texture)
  card.setAttribute('data-acc', tpl.decor.accent)
  card.setAttribute('data-corner', tpl.decor.corner)
  card.setAttribute('data-cover', tpl.decor.cover)
  card.style.setProperty('--ly-card-w', `${size.w}px`)
  card.style.setProperty('--ly-card-h', `${size.h}px`)
  // 页眉页脚必须原样带上：它们占掉的高度直接决定 body 的可用高度
  card.innerHTML = shellHtml(tpl, '', docTitle, '', '1')
  host.appendChild(card)
  const body = card.querySelector('.ly-body') as HTMLElement
  return {
    card,
    body,
    dispose: () => {
      host?.replaceChildren()
    },
  }
}

/* ------------------------------------------------------------------ *
 * 长块按行拆（代码块 / 表格）
 * ------------------------------------------------------------------ */

function splitTallBlock(el: HTMLElement, measurer: Measurer, budget: number): HTMLElement[] | null {
  const pre = el.matches('pre.ly-code') ? el : (el.querySelector('pre.ly-code') as HTMLElement | null)
  if (pre) {
    const code = pre.querySelector('code')
    const lines = (code?.textContent ?? '').split('\n')
    if (lines.length < 4) return null
    return bisect(
      lines,
      (chunk) => {
        const node = pre.cloneNode(true) as HTMLElement
        const c = node.querySelector('code')
        if (c) c.textContent = chunk.join('\n')
        return node
      },
      measurer,
      budget,
    )
  }

  if (el.matches('table')) {
    const rows = Array.from(el.querySelectorAll('tbody tr')) as HTMLElement[]
    if (rows.length < 3) return null
    const head = el.querySelector('thead')
    return bisect(
      rows,
      (chunk) => {
        const node = document.createElement('table')
        if (head) node.appendChild(head.cloneNode(true))
        const tb = document.createElement('tbody')
        for (const r of chunk) tb.appendChild(r.cloneNode(true))
        node.appendChild(tb)
        return node
      },
      measurer,
      budget,
    )
  }
  return null
}

function bisect<T>(items: T[], make: (chunk: T[]) => HTMLElement, measurer: Measurer, budget: number): HTMLElement[] {
  const fits = (node: HTMLElement): boolean => {
    measurer.body.appendChild(node)
    const ok = measurer.body.scrollHeight <= budget
    node.remove()
    return ok
  }
  const half = Math.ceil(items.length / 2)
  const out: HTMLElement[] = []
  for (const chunk of [items.slice(0, half), items.slice(half)]) {
    const node = make(chunk)
    if (!node.childNodes.length) continue
    if (fits(node)) out.push(node)
    else {
      const deeper = node.matches('pre.ly-code') ? splitTallBlock(node, measurer, budget) : splitTableDeeper(node, measurer, budget)
      out.push(...(deeper ?? [node]))
    }
  }
  return out
}

function splitTableDeeper(node: HTMLElement, measurer: Measurer, budget: number): HTMLElement[] | null {
  const rows = Array.from(node.querySelectorAll('tbody tr')) as HTMLElement[]
  if (rows.length < 2) return null
  const head = node.querySelector('thead')
  return bisect(
    rows,
    (chunk) => {
      const t = document.createElement('table')
      if (head) t.appendChild(head.cloneNode(true))
      const tb = document.createElement('tbody')
      for (const r of chunk) tb.appendChild(r.cloneNode(true))
      t.appendChild(tb)
      return t
    },
    measurer,
    budget,
  )
}

/* ------------------------------------------------------------------ *
 * 分页主流程
 * ------------------------------------------------------------------ */

function firstHeadingText(blocks: HTMLElement[]): string {
  for (const b of blocks) if (/^H[1-6]$/.test(b.tagName)) return (b.textContent ?? '').trim()
  return ''
}

export function paginate(md: string, opts: LayoutOptions): LayoutResult {
  const size = findSize(opts.sizeId)
  const tpl = opts.template
  const segments = splitSource(md, opts.mode)

  const allBlocks: HTMLElement[] = []
  for (const seg of segments) {
    for (const b of htmlToBlocks(mdToHtml(seg))) {
      paintCode(b)
      normalizeMath(b)
      allBlocks.push(b)
    }
    if (opts.mode === 'rule') {
      const br = document.createElement('hr')
      br.dataset.pagebreak = '1'
      allBlocks.push(br)
    }
  }
  while (
    allBlocks.length &&
    allBlocks[allBlocks.length - 1] instanceof HTMLHRElement &&
    allBlocks[allBlocks.length - 1].dataset.pagebreak
  ) {
    allBlocks.pop()
  }

  // 封面素材：首个 h1 作标题，紧随的段落作摘要
  let coverTitle = opts.docTitle.replace(/\.(md|markdown|txt)$/i, '')
  let coverSub = ''
  let body = allBlocks
  if (opts.withCover) {
    const idx = allBlocks.findIndex((b) => b.tagName === 'H1')
    if (idx >= 0) {
      coverTitle = (allBlocks[idx].textContent ?? '').trim() || coverTitle
      const after = allBlocks[idx + 1]
      if (after && after.tagName === 'P') coverSub = (after.textContent ?? '').trim()
      const drop = new Set<number>([idx])
      if (after && after.tagName === 'P') drop.add(idx + 1)
      body = allBlocks.filter((_, i) => !drop.has(i))
    }
  }

  const pages: CardPage[] = []

  if (opts.withCover) {
    pages.push({
      kind: 'cover',
      inner: `<div class="ly-inner">
  <span class="ly-kicker">${escapeHtml(tpl.name)}</span>
  <h1 class="ly-title">${escapeHtml(coverTitle)}</h1>
  ${coverSub ? `<p class="ly-sub">${escapeHtml(coverSub)}</p>` : ''}
  <div class="ly-cover-rule"></div>
  <div class="ly-meta"><span>${escapeHtml(tpl.metrics.brand || 'Lypora')}</span><span>·</span><span>${new Date().toLocaleDateString('zh-CN')}</span></div>
</div>`,
    })
  }

  // mode=none：全部塞进一页（溢出裁切），用于"就想要一张长图"的场景
  if (opts.mode === 'none' && body.length) {
    const html = body.map((b) => b.outerHTML).join('\n')
    const sec = firstHeadingText(body)
    pages.push({ kind: 'content', section: sec, inner: shellHtml(tpl, html, opts.docTitle, sec, '1') })
    return { pages, size, template: tpl, clipped: 0 }
  }

  const measurer = createMeasurer(size, tpl, opts.docTitle)
  const budget = measurer.body.clientHeight
  const limit = budget > 40 ? budget : size.h * 0.62
  let clipped = 0

  let current: HTMLElement[] = []
  let section = ''
  const flush = (sec: string) => {
    if (!current.length) return
    const html = current.map((b) => b.outerHTML).join('\n')
    pages.push({
      kind: 'content',
      section: sec,
      inner: shellHtml(tpl, html, opts.docTitle, sec, String(pages.length + 1)),
    })
    current = []
    measurer.body.innerHTML = ''
  }

  for (let i = 0; i < body.length; i++) {
    const block = body[i]
    if (block.dataset.pagebreak) {
      flush(section)
      section = ''
      continue
    }
    const heading = /^H[1-6]$/.test(block.tagName) ? (block.textContent ?? '').trim() : ''

    // 真刀真枪塞进去量：这就是浏览器自己的排版，没有估算误差
    measurer.body.appendChild(block)
    if (measurer.body.scrollHeight <= limit + 1) {
      current.push(block)
      if (heading && !section) section = heading
      continue
    }
    measurer.body.removeChild(block)

    if (current.length) {
      flush(section)
      section = ''
      i--
      continue
    }

    const parts = splitTallBlock(block, measurer, limit)
    if (parts && parts.length > 1) {
      body.splice(i, 1, ...parts)
      i--
      continue
    }
    current.push(block)
    measurer.body.appendChild(block)
    clipped++
    if (heading) section = heading
  }
  flush(section)
  measurer.dispose()

  if (!pages.length) {
    pages.push({ kind: 'content', inner: shellHtml(tpl, '<p></p>', opts.docTitle, '', '1') })
  }
  // 页码回填（封面不计入）
  let n = 0
  for (const p of pages) {
    if (p.kind !== 'content') continue
    n++
    p.inner = p.inner.replace(/<span class="ly-page">[^<]*<\/span>/, `<span class="ly-page">${n}</span>`)
  }
  return { pages, size, template: tpl, clipped }
}

/** 单页独立成卡片 DOM 字符串（预览、截图、导出共用） */
export function pageAsFragment(page: CardPage, size: CardSize, tpl: CardTemplate): string {
  // 背景层用真实元素而不是 ::before：::before 已经被「纹理」占了，
  // 而且真实元素能随 HTML 一起序列化进 foreignObject，不依赖伪元素的绘制时机。
  const deco =
    (tpl.decor.binding && tpl.decor.binding !== 'none' ? '<i class="ly-bind"></i>' : '') +
    (tpl.decor.tape ? '<i class="ly-tape"></i>' : '') +
    (tpl.decor.stamp ? '<i class="ly-stamp"></i>' : '')
  return `<div class="ly-card${page.kind === 'cover' ? ' ly-cover' : ''}" data-tpl="${tpl.id}"${decorAttrs(tpl)} style="--ly-card-w:${size.w}px;--ly-card-h:${size.h}px"><i class="ly-bg"></i>${deco}${page.inner}</div>`
}

/** 面板里直接预览 DOM 时注入的样式（截图走 capture 自己的内联，不依赖这里） */
export function ensureCardCss(tpl: CardTemplate): void {
  let st = document.getElementById('ly-card-css') as HTMLStyleElement | null
  if (!st) {
    st = document.createElement('style')
    st.id = 'ly-card-css'
    document.head.appendChild(st)
  }
  st.textContent = stylesheetFor(tpl)
}
