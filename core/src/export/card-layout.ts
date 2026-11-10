/**
 * 卡片排版与分页 —— 把一份 Markdown 切成若干张固定尺寸的卡片。
 *
 * 三条设计原则：
 * 1. **复用既有渲染器**：markdown → HTML 仍然走 io/export.ts 的 `mdToHtml`
 *    （它已经被 export-check 覆盖），这里只在它产出的 HTML 上做顶层块切分，
 *    绝不复刻第二套 markdown 解析器——两套解析器的行为漂移是这类功能最常见的腐坏源。
 * 2. **用真实 DOM 测量分页，不用估算**。行高、字体、图片高度、表格换行都会影响
 *    实际高度，任何"字符数 × 行高"的估算在中文混排下都会错。做法是把块逐个塞进
 *    一个同尺寸的离屏卡片里量 `scrollHeight`，超了就回退换页——和浏览器自己的排版
 *    完全一致，无误差项。
 * 3. **分页结果是纯 HTML 字符串**，不持有 DOM 引用。截图、预览、PDF 三条出口
 *    共用同一份数据，谁也不会改到别人的状态。
 */

import { escapeHtml } from '../util'
import { mdToHtml } from '../io/export'
import { KATEX_CSS } from '../io/katex-inline'
import { highlightCode } from '../editor/highlight'
import { CARD_CSS, findStyle, findSize, type CardSize } from './card-themes'

export type SplitMode = 'auto' | 'rule' | 'none'

export interface CardPage {
  kind: 'cover' | 'content'
  /** 卡片 `.ly-inner` 内部的 HTML */
  inner: string
  /** 内容页的节标题（取该页首个标题） */
  section?: string
}

export interface LayoutOptions {
  styleId: string
  sizeId: string
  mode: SplitMode
  withCover: boolean
  /** 文档名，用于页眉与品牌行 */
  docTitle: string
  brand?: string
}

export interface LayoutResult {
  pages: CardPage[]
  size: CardSize
  /** 分页过程中被裁掉的长块数量（超长代码块/表格无法再拆时） */
  clipped: number
}

/* ------------------------------------------------------------------ *
 * 1) markdown → 顶层块
 * ------------------------------------------------------------------ */

/** 手动分页符：独占一行的 `---` / `***` / `___`（只在 rule 模式下当分页符，否则是分割线） */
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

/** 给代码块上色：把 textContent 换成等价的 token span，语义与编辑器高亮器完全一致 */
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

/** 数学块：mdToHtml 已经产出 .math-block，这里只统一 class 名 */
function normalizeMath(el: HTMLElement): void {
  for (const m of Array.from(el.querySelectorAll('.math-block'))) m.classList.add('ly-math')
  if (el.classList.contains('math-block')) el.classList.add('ly-math')
}

/* ------------------------------------------------------------------ *
 * 2) 离屏测量容器
 * ------------------------------------------------------------------ */

const MEASURE_ID = 'ly-card-measure'

interface Measurer {
  card: HTMLElement
  body: HTMLElement
  dispose(): void
}

function createMeasurer(size: CardSize, styleId: string, docTitle: string): Measurer {
  let host = document.getElementById(MEASURE_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = MEASURE_ID
    // 视觉上完全不可见，但仍是真实布局上下文（不能用 display:none，那样量不出高度）
    host.style.cssText =
      'position:fixed;left:-30000px;top:0;width:0;height:0;overflow:visible;pointer-events:none;opacity:0;z-index:-1'
    const style = document.createElement('style')
    // KaTeX 的 HTML 只是骨架，高度全靠 katex.min.css 的 .vlist/.strut 定位规则。
    // 测量容器不带这份 CSS 的话，公式会被当成平铺文字量高度 —— 分页从第一张卡就偏。
    style.textContent = CARD_CSS + '\n' + KATEX_CSS
    host.appendChild(style)
    document.body.appendChild(host)
  }
  const card = document.createElement('div')
  card.className = 'ly-card'
  card.setAttribute('data-style', styleId)
  card.style.setProperty('--ly-card-w', `${size.w}px`)
  card.style.setProperty('--ly-card-h', `${size.h}px`)
  card.innerHTML = contentCardShell('', docTitle, '')
  host.appendChild(card)
  const body = card.querySelector('.ly-body') as HTMLElement
  return {
    card,
    body,
    dispose: () => card.remove(),
  }
}

/** 内容页骨架。head/foot 都参与高度计算，所以测量容器必须原样带上一份 */
function contentCardShell(bodyHtml: string, docTitle: string, section: string, page?: string): string {
  return `<div class="ly-inner">
  <div class="ly-head"><span class="ly-doc">${escapeHtml(docTitle)}</span><span class="ly-sec">${escapeHtml(section)}</span></div>
  <div class="ly-body">${bodyHtml}</div>
  <div class="ly-foot"><span class="ly-brand">Lypora</span><span class="ly-page">${escapeHtml(page ?? '')}</span></div>
</div>`
}

/* ------------------------------------------------------------------ *
 * 3) 长块按行拆（代码块 / 表格）
 * ------------------------------------------------------------------ */

/**
 * 单个块超过一整页时，按"行"拆成多个等高优先的块。
 * 只对 `pre` 和 `table` 做——段落如果在页首还放不下，那是卡片尺寸太小，
 * 强行拆段落会切碎语义，宁可裁切。
 */
function splitTallBlock(el: HTMLElement, measurer: Measurer, budget: number): HTMLElement[] | null {
  const pre = el.matches('pre.ly-code') ? el : (el.querySelector('pre.ly-code') as HTMLElement | null)
  if (pre) {
    const code = pre.querySelector('code')
    const lines = (code?.textContent ?? '').split('\n')
    if (lines.length < 4) return null
    // 二分：每次取一半，递归到能装下为止
    return bisect(lines, (chunk) => {
      const node = pre.cloneNode(true) as HTMLElement
      const c = node.querySelector('code')
      if (c) c.textContent = chunk.join('\n')
      return node
    }, measurer, budget)
  }

  if (el.matches('table')) {
    const rows = Array.from(el.querySelectorAll('tbody tr')) as HTMLElement[]
    if (rows.length < 3) return null
    const head = el.querySelector('thead')
    return bisect(rows, (chunk) => {
      const node = document.createElement('table')
      if (head) node.appendChild(head.cloneNode(true))
      const tb = document.createElement('tbody')
      for (const r of chunk) tb.appendChild(r.cloneNode(true))
      node.appendChild(tb)
      return node
    }, measurer, budget)
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
  const a = make(items.slice(0, half))
  const b = make(items.slice(half))
  const out: HTMLElement[] = []
  for (const node of [a, b]) {
    if (!node.childNodes.length) continue
    if (fits(node)) out.push(node)
    else {
      const deeper = node.matches('pre.ly-code')
        ? splitTallBlock(node, measurer, budget)
        : splitTableDeeper(node, measurer, budget)
      if (deeper) out.push(...deeper)
      else out.push(node) // 拆无可拆，保留（溢出由卡片 overflow:hidden 收口）
    }
  }
  return out
}

function splitTableDeeper(node: HTMLElement, measurer: Measurer, budget: number): HTMLElement[] | null {
  const rows = Array.from(node.querySelectorAll('tbody tr')) as HTMLElement[]
  if (rows.length < 2) return null
  const head = node.querySelector('thead')
  return bisect(rows, (chunk) => {
    const t = document.createElement('table')
    if (head) t.appendChild(head.cloneNode(true))
    const tb = document.createElement('tbody')
    for (const r of chunk) tb.appendChild(r.cloneNode(true))
    t.appendChild(tb)
    return t
  }, measurer, budget)
}

/* ------------------------------------------------------------------ *
 * 4) 分页主流程
 * ------------------------------------------------------------------ */

function firstHeadingText(blocks: HTMLElement[]): string {
  for (const b of blocks) {
    if (/^H[1-6]$/.test(b.tagName)) return (b.textContent ?? '').trim()
  }
  return ''
}

export function paginate(md: string, opts: LayoutOptions): LayoutResult {
  const size = findSize(opts.sizeId)
  const style = findStyle(opts.styleId)
  const segments = splitSource(md, opts.mode)

  // 全篇解析成顶层块
  const allBlocks: HTMLElement[] = []
  for (const seg of segments) {
    const blocks = htmlToBlocks(mdToHtml(seg))
    for (const b of blocks) {
      paintCode(b)
      normalizeMath(b)
      allBlocks.push(b)
    }
    // 手动分页模式下，段与段之间强制换页：用一个哨兵块标记
    if (opts.mode === 'rule') {
      const br = document.createElement('hr')
      br.dataset.pagebreak = '1'
      allBlocks.push(br)
    }
  }
  // 去掉尾部哨兵
  while (allBlocks.length && allBlocks[allBlocks.length - 1] instanceof HTMLHRElement && allBlocks[allBlocks.length - 1].dataset.pagebreak) allBlocks.pop()

  const withCover = opts.withCover

  // 封面素材：首个 h1 作标题，紧随的段落作摘要
  let coverTitle = opts.docTitle.replace(/\.(md|markdown|txt)$/i, '')
  let coverSub = ''
  let body = allBlocks
  if (withCover) {
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

  if (withCover) {
    pages.push({
      kind: 'cover',
      inner: `<div class="ly-inner">
  <span class="ly-kicker">${escapeHtml(style.label)}</span>
  <h1 class="ly-title">${escapeHtml(coverTitle)}</h1>
  ${coverSub ? `<p class="ly-sub">${escapeHtml(coverSub)}</p>` : ''}
  <div class="ly-cover-rule"></div>
  <div class="ly-meta"><span>${escapeHtml(opts.brand || 'Lypora')}</span><span>·</span><span>${new Date().toLocaleDateString('zh-CN')}</span></div>
</div>`,
    })
  }

  // mode=none：全部塞进一页（溢出裁切），用于"我就想要一张长图"的场景
  if (opts.mode === 'none' && body.length) {
    const html = body.map((b) => b.outerHTML).join('\n')
    pages.push({ kind: 'content', section: firstHeadingText(body), inner: contentCardShell(html, opts.docTitle, firstHeadingText(body), '') })
    return { pages, size, clipped: 0 }
  }

  const measurer = createMeasurer(size, style.id, opts.docTitle)
  const budget = measurer.body.clientHeight
  // clientHeight 为 0 说明离屏容器还没被布局（极端时序），退化成固定估算兜底
  const limit = budget > 40 ? budget : size.h * 0.62
  let clipped = 0

  const queue: HTMLElement[] = []
  for (const b of body) {
    if (b.dataset.pagebreak) {
      queue.push(b)
      continue
    }
    queue.push(b)
  }

  let current: HTMLElement[] = []
  const flush = (section: string) => {
    if (!current.length) return
    const html = current.map((b) => b.outerHTML).join('\n')
    pages.push({
      kind: 'content',
      section,
      inner: contentCardShell(html, opts.docTitle, section, String(pages.length + 1)),
    })
    current = []
    measurer.body.innerHTML = ''
  }

  let section = ''
  for (let i = 0; i < queue.length; i++) {
    const block = queue[i]
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

    // 本页已有内容 → 换页后重试同一块
    if (current.length) {
      flush(section)
      section = ''
      i--
      continue
    }

    // 空页都装不下：尝试按行拆，拆不动就整块放入并标记裁切
    const parts = splitTallBlock(block, measurer, limit)
    if (parts && parts.length > 1) {
      queue.splice(i, 1, ...parts)
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
    pages.push({ kind: 'content', inner: contentCardShell('<p></p>', opts.docTitle, '', '1') })
  }
  // 页码统一回填（封面不计入）
  let n = 0
  for (const p of pages) {
    if (p.kind !== 'content') continue
    n++
    p.inner = p.inner.replace(/<span class="ly-page">[^<]*<\/span>/, `<span class="ly-page">${n}</span>`)
  }
  return { pages, size, clipped }
}

/** 供面板预览用：单页独立成文档字符串 */
export function pageAsFragment(page: CardPage, size: CardSize, styleId: string): string {
  return `<div class="ly-card${page.kind === 'cover' ? ' ly-cover' : ''}" data-style="${styleId}" style="--ly-card-w:${size.w}px;--ly-card-h:${size.h}px">${page.inner}</div>`
}

/** 测量容器样式注入（预览复用同一份 CSS，避免预览与导出不一致） */
export function ensureCardCss(): void {
  if (document.getElementById('ly-card-css')) return
  const st = document.createElement('style')
  st.id = 'ly-card-css'
  st.textContent = CARD_CSS
  document.head.appendChild(st)
}
