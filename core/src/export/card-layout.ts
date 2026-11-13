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
import { decorAttrMap, decorAttrs, stylesheetFor } from './template/compile'
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

/** `{total}` 在分页完成前未知，先写一个控制字符占位，最后统一回填 */
const TOTAL_MARK = '\u0000'

/**
 * 页眉页脚的占位符替换。
 * 支持的占位符（见 params.ts 的 tpl.p.textHint）：`{doc} {sec} {date} {page} {total}`。
 * 未知占位符原样保留 —— 用户敲了 `{word}` 时看到字面上写着 `{word}`，
 * 比静默吞掉更像"我知道你写了什么，但这个我不认识"。
 */
export function fillSlots(
  text: string,
  ctx: { doc: string; sec: string; page: string; date: string },
): string {
  if (!text) return ''
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => {
    if (key === 'doc') return ctx.doc
    if (key === 'sec') return ctx.sec
    if (key === 'page') return ctx.page
    if (key === 'date') return ctx.date
    if (key === 'total') return TOTAL_MARK
    return whole
  })
}

function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function shellHtml(tpl: CardTemplate, bodyHtml: string, docTitle: string, section: string, page: string): string {
  const m = tpl.metrics
  const ctx = { doc: docTitle, sec: section, page, date: today() }
  // 页眉两槽：左 {doc} 右侧 {sec}，都可改成任意文本/占位符组合（schema 4）
  const left = fillSlots(m.headText ?? '', ctx)
  const right = fillSlots(m.headSide ?? '', ctx)
  const head =
    m.headRule && (left || right)
      ? `<div class="ly-head"><span class="ly-doc">${escapeHtml(left)}</span>${
          right ? `<span class="ly-sec">${escapeHtml(right)}</span>` : ''
        }</div>`
      : ''
  // 页脚：左文本 + 右页码。footText 空 = 不显示（不再回落 brand：
  // "清空了又冒出来"是最难解释的交互，品牌字样只留在封面）
  const footLeft = fillSlots(m.footText ?? '', ctx)
  const showPage = m.pageNo && page !== ''
  const foot =
    footLeft || showPage
      ? `<div class="ly-foot">${footLeft ? `<span class="ly-foot-text">${escapeHtml(footLeft)}</span>` : ''}${
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
  for (const [k, v] of Object.entries(decorAttrMap(tpl))) card.setAttribute(k, v)
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
  <div class="ly-meta"><span>${escapeHtml(tpl.metrics.brand || 'Lypora')}</span><span>·</span><span>${escapeHtml(today())}</span></div>
</div>`,
    })
  }

  // mode=none：全部塞进一页（溢出裁切），用于"就想要一张长图"的场景
  if (opts.mode === 'none' && body.length) {
    const html = body.map((b) => b.outerHTML).join('\n')
    const sec = firstHeadingText(body)
    pages.push({
      kind: 'content',
      section: sec,
      inner: shellHtml(tpl, html, opts.docTitle, sec, '1').split(TOTAL_MARK).join('1'),
    })
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
  // 页码回填（封面不计入）；`{total}` 只有此刻才知道，所以两件事一起做
  let n = 0
  const total = pages.filter((p) => p.kind === 'content').length
  for (const p of pages) {
    if (p.kind !== 'content') continue
    n++
    p.inner = p.inner.replace(/<span class="ly-page">[^<]*<\/span>/, `<span class="ly-page">${n}</span>`)
    if (p.inner.includes(TOTAL_MARK)) p.inner = p.inner.split(TOTAL_MARK).join(String(total))
  }
  return { pages, size, template: tpl, clipped }
}

/** 单页独立成卡片 DOM 字符串（预览、截图、导出共用） */
export function pageAsFragment(page: CardPage, size: CardSize, tpl: CardTemplate): string {
  // 背景层用真实元素而不是 ::before：::before 已经被「纹理」占了，
  // 而且真实元素能随 HTML 一起序列化进 foreignObject，不依赖伪元素的绘制时机。
  return `<div class="ly-card${page.kind === 'cover' ? ' ly-cover' : ''}" data-tpl="${tpl.id}"${decorAttrs(tpl)} style="--ly-card-w:${size.w}px;--ly-card-h:${size.h}px"><i class="ly-bg"></i>${decoHtml(tpl)}${page.inner}</div>`
}

/**
 * 装饰元素（背景之外的四个"实体"）：装订、胶带、印章、外边框。
 * 全部是真实元素而不是伪元素 —— 一张卡片只有 ::before/::after 两个名额，
 * 纹理、强调条、折角已经占满了，而且真实元素能随 HTML 一起进 foreignObject。
 */
export function decoHtml(tpl: CardTemplate): string {
  const d = tpl.decor
  return (
    (d.topBar && d.topBar.height > 0 ? '<i class="ly-topbar"></i>' : '') +
    (d.binding && d.binding !== 'none' ? `<i class="ly-bind">${bindSvg(d.binding)}</i>` : '') +
    (d.tape ? '<i class="ly-tape"></i>' : '') +
    ornHtml(tpl) +
    stampHtml(tpl) +
    (d.frame && d.frame !== 'none' ? '<i class="ly-frame"></i>' : '')
  )
}

/* ------------------------------------------------------------------ *
 * 角饰贴纸（schema 5）
 * ------------------------------------------------------------------ */

/**
 * 正多角星的顶点串。
 *
 * 写死一串 d 属性当然也行，但五个图元里有三个是星（五角/四角/爆炸星），
 * 只有内径与外角数不同 —— 一个函数生成，改比例时三处一起改，不会漏。
 * 角度从 −90° 起，第一只角朝正上方（"星"这个字形在中文里都是朝上的）。
 */
function starPath(points: number, outer: number, inner: number): string {
  const pts: string[] = []
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner
    const a = (Math.PI / points) * i - Math.PI / 2
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`)
  }
  return `M${pts.join(' L')} Z`
}

/** 单个贴纸的内联 SVG：颜色走变量，导出时随 foreignObject 一起被浏览器画出来 */
function ornGlyph(o: { shape: string; fill: string; stroke: string }): string {
  const fill = o.fill || 'var(--c-accent)'
  const stroke = o.stroke ? ` stroke="${o.stroke}" stroke-width="4" stroke-linejoin="round"` : ''
  if (o.shape === 'star4') {
    return `<svg viewBox="0 0 100 100"><path d="${starPath(4, 48, 16)}" fill="${fill}"${stroke}/></svg>`
  }
  if (o.shape === 'burst') {
    return `<svg viewBox="0 0 100 100"><path d="${starPath(12, 48, 33)}" fill="${fill}"${stroke}/></svg>`
  }
  if (o.shape === 'blob') {
    return (
      '<svg viewBox="0 0 100 100"><path d="M53 3 C78 5 97 24 96 49 C95 77 73 97 47 96 ' +
      `C21 95 3 74 4 48 C5 22 27 1 53 3 Z" fill="${fill}"${stroke}/></svg>`
    )
  }
  if (o.shape === 'badge') {
    return (
      '<svg viewBox="0 0 100 100">' +
      `<circle cx="50" cy="50" r="47" fill="${fill}"${stroke}/>` +
      '<circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="2.5" opacity="0.55"/>' +
      '</svg>'
    )
  }
  return `<svg viewBox="0 0 100 100"><path d="${starPath(5, 48, 20)}" fill="${fill}"${stroke}/></svg>`
}

function ornHtml(tpl: CardTemplate): string {
  const list = tpl.decor.ornaments ?? []
  if (!list.length) return ''
  return list
    .map((o) => {
      // 文字的色取描边色：波普那枚 POP! 徽标就是"蓝底 + 黑描边 + 黑字"，
      // 再开一个 textColor 字段只会让面板多一行没人调的控件
      // --o-size 里直接乘缩放系数（--o-k）：宽/高/字号三处都引它，一处改完全跟着缩
      const style =
        `--o-size:calc(${o.size}px * var(--o-k, 1));--o-rot:${o.rotate}deg;` +
        `--o-bleed:${o.bleed}px;--o-text:${o.stroke || '#ffffff'}`
      const text = o.text ? `<b>${escapeHtml(o.text)}</b>` : ''
      return (
        `<i class="ly-orn" data-shape="${o.shape}" data-pos="${o.pos}" style="${style}" aria-hidden="true">` +
        `${ornGlyph(o)}${text}</i>`
      )
    })
    .join('')
}

/**
 * 回形针与订书钉的形状。
 *
 * v0.11 及以前是「三个 CSS 边框拼的」：`border: 2.6px + border-bottom-color: transparent`
 * 拼出来的其实是个缺底的口袋，形状与位置都不对（用户一眼看出"显示错误"）。
 * 这里是真正画出线材路径的 SVG，随卡片一起进 foreignObject，缩放不糊、导出不丢。
 */
function bindSvg(kind: string): string {
  if (kind === 'clip') {
    /*
     * 一根线走完回形针：左外线下 → 底部大 U → 右外线上 → 顶部小 U → 内线向下「收在中段」。
     *
     * 内线必须比外圈短：v0.12 初版让它一路画到 y=74，越过了底部大 U（y=70），
     * 视觉上就是一根多余的尾巴 —— 真回形针的内圈是短的，收在 2/3 处才像。
     */
    return (
      '<svg viewBox="0 0 26 72" aria-hidden="true">' +
      '<path d="M5 6 V58 a8 8 0 0 0 16 0 V14 a4 4 0 0 0 -8 0 V50" fill="none" stroke="rgba(118,124,132,0.95)" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>' +
      // 线材高光：同一条路径向外偏 1.4，压一条半透明白，线才有「金属圆柱」的厚度
      '<path d="M3.6 6 V58 a9.4 9.4 0 0 0 18.8 0 V14 a5.4 5.4 0 0 0 -10.8 0 V50" fill="none" stroke="rgba(255,255,255,0.6)" stroke-width="1.1" stroke-linecap="round"/>' +
      '</svg>'
    )
  }
  if (kind === 'staple') {
    /*
     * 订书钉是「扁金属带」不是「铁丝」：v0.12 初版用三条等宽 stroke 画的，
     * 腿长 9、冠宽 38，比例 1:4 → 出来就是一个「⊓」括号字符。
     *
     * 真实 24/6 钉：冠 11.7mm、腿 6mm ≈ 1:2，所以这里冠 40、腿 18。
     * 用填充路径画带状截面（不是描边），腿根压两个暗点表示"扎进纸里"。
     */
    return (
      '<svg viewBox="0 0 48 26" aria-hidden="true">' +
      '<defs><linearGradient id="ly-staple-g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#a3aab3"/><stop offset="0.4" stop-color="#7b828c"/><stop offset="1" stop-color="#5f666f"/>' +
      '</linearGradient></defs>' +
      '<path d="M4 4.6 h40 v17.2 h-4.4 V8.6 H8.4 v13.2 H4 Z" fill="url(#ly-staple-g)"/>' +
      '<path d="M6.2 5.9 h35.6" fill="none" stroke="rgba(255,255,255,0.5)" stroke-width="1.1" stroke-linecap="round"/>' +
      '<circle cx="6.2" cy="21.4" r="1.5" fill="rgba(0,0,0,0.3)"/>' +
      '<circle cx="41.8" cy="21.4" r="1.5" fill="rgba(0,0,0,0.3)"/>' +
      '</svg>'
    )
  }
  return ''
}

/** 印章预设里的字：朱文圆印「阅」、白文方印「已阅」竖排、长条「已阅」、手写「签名」 */
const STAMP_GLYPH: Record<string, string> = {
  seal: '阅',
  square: '已阅',
  strip: '已阅',
  signature: '签名',
}

function stampHtml(tpl: CardTemplate): string {
  const d = tpl.decor
  if (!d.stamp) return ''
  const pos = d.stampPos ?? 'br'
  if (d.stampImage) {
    return `<span class="ly-stamp" data-pos="${pos}"><img class="ly-stamp-img" src="${d.stampImage}" alt="" style="width:100%;height:100%"></span>`
  }
  const preset = d.stampPreset ?? 'seal'
  return `<span class="ly-stamp" data-pos="${pos}" data-stamp="${preset}"><b>${STAMP_GLYPH[preset] ?? '阅'}</b></span>`
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
