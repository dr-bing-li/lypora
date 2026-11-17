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
/**
 * 贴纸上的字用什么颜色。
 *
 * 规则：有描边就用描边色（波普那枚「蓝底黑边黑字」的 POP! 就是这么来的），
 * 没描边就按填充色的亮度自己选 —— 浅粉/浅黄底上写白字是彻底看不见的，
 * 而这套面板的默认填充就是模板的强调色，谁也不知道用户会挑多浅的颜色。
 */
function ornInk(o: { fill: string; stroke: string }): string {
  if (o.stroke) return o.stroke
  const m = /^#([0-9a-f]{6})$/i.exec(o.fill || '')
  if (!m) return '#ffffff'
  const n = parseInt(m[1], 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  // 感知亮度（Rec.601 权重足够区分「浅色纸」与「饱和色」两类，不必转 LAB）
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.66 ? '#1a1d21' : '#ffffff'
}

function ornGlyph(o: { shape: string; fill: string; stroke: string }): string {
  const fill = o.fill || 'var(--c-accent)'
  const ink = ornInk(o)
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
      `<circle cx="50" cy="50" r="38" fill="none" stroke="${ink}" stroke-width="2.5" opacity="0.55"/>` +
      '</svg>'
    )
  }
  /*
   * 对话气泡：一块圆角矩形 + 左下角的小尾巴，走一条闭合路径。
   * 尾巴不能单独画一个三角形再叠上去 —— 两段描边在接缝处会多一条横线。
   * 气泡占上方 72%，下面的 28% 留给尾巴，所以文字要往上挪（见 compile.ts）。
   */
  if (o.shape === 'say') {
    return (
      '<svg viewBox="0 0 100 100">' +
      '<path d="M26 6 H74 A20 20 0 0 1 94 26 V52 A20 20 0 0 1 74 72 H46 L30 94 L27 72 H26 ' +
      `A20 20 0 0 1 6 52 V26 A20 20 0 0 1 26 6 Z" fill="${fill}"${stroke}/>` +
      '</svg>'
    )
  }
  /*
   * 气球：椭圆 + 下方的打结小三角 + 左上角一道高光。
   * 高光是"气球是鼓的"唯一线索，去掉就只剩一个椭圆，跟墨点分不出来。
   */
  if (o.shape === 'balloon') {
    return (
      '<svg viewBox="0 0 100 100">' +
      `<ellipse cx="50" cy="44" rx="41" ry="38" fill="${fill}"${stroke}/>` +
      `<path d="M43 82 h14 l-7 13 z" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="3" stroke-linejoin="round"` : ''}/>` +
      '<path d="M28 30 C34 16 50 10 62 14" fill="none" stroke="rgba(255,255,255,0.55)" ' +
      'stroke-width="6" stroke-linecap="round"/>' +
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
      // 文字的色取描边色；没描边时按填充亮度自动选深/浅（见 ornInk）
      // --o-size 里直接乘缩放系数（--o-k）：宽/高/字号三处都引它，一处改完全跟着缩
      const style =
        `--o-size:calc(${o.size}px * var(--o-k, 1));--o-rot:${o.rotate}deg;` +
        `--o-bleed:${o.bleed}px;--o-text:${ornInk(o)}`
      const text = o.text ? `<b>${escapeHtml(o.text)}</b>` : ''
      return (
        `<i class="ly-orn" data-shape="${o.shape}" data-pos="${o.pos}" style="${style}" aria-hidden="true">` +
        `${ornGlyph(o)}${text}</i>`
      )
    })
    .join('')
}

/**
 * 装订件的图形（0.14.2 按真实物件重画）。
 *
 * v0.11 及以前是「三个 CSS 边框拼的」：`border: 2.6px + border-bottom-color: transparent`
 * 拼出来的其实是个缺底的口袋，形状与位置都不对。v0.12 换成 SVG 路径，但仍有
 * 三处"一眼假"：回形针是一条平灰线、订书钉把两条腿画在纸面上（钉子在纸上是
 * 贴着的，不是浮着的）、没有长尾夹。这一版按三个物件的真实形态重画：
 *
 *   回形针：0.9mm 钢丝。正面看是「外圈长 U + 顶部小 U + 内线收在 2/3」。
 *           金属质感靠同一条路径叠三层：基准灰、右下暗边、左上高光 —— 相当于
 *           给线材画了圆柱截面，而不是描一条灰度恒定的线。
 *   订书钉：钉冠是 1.2mm 宽的扁带，正面**只有这一条**露在纸面上；两条腿穿进
 *           纸里，纸面留下的是两端的小孔和钉冠下沿一道浅影。
 *   长尾夹：黑色夹体（上宽下窄、顶部一道卷边）+ 两根折叠下来的钢丝手柄。
 */
function bindSvg(kind: string): string {
  if (kind === 'clip') {
    /*
     * 一根线走完回形针：左外线下 → 底部大 U → 右外线上 → 顶部小 U → 内线向下「收在中段」。
     *
     * 内线必须比外圈短：v0.12 初版让它一路画到底部大 U 之外，视觉上就是一根多余的尾巴 ——
     * 真回形针的内圈收在 2/3 处。
     */
    const wire = 'M7 9 V71 a11.4 11.4 0 0 0 22.8 0 V15 a5.4 5.4 0 0 0 -10.8 0 V54'
    return (
      '<svg viewBox="0 0 37 88" aria-hidden="true">' +
      `<path d="${wire}" fill="none" stroke="#9aa3ad" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round"/>` +
      // 暗边压向右下、高光提向左上：两者都不与基准线同心，才有"圆柱"的错觉
      `<path d="${wire}" transform="translate(0.55 0.9)" fill="none" stroke="rgba(44,51,60,0.5)" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${wire}" transform="translate(-0.55 -0.75)" fill="none" stroke="rgba(255,255,255,0.9)" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"/>` +
      '</svg>'
    )
  }
  if (kind === 'staple') {
    /*
     * 只画钉冠。真实 24/6 钉：冠宽 11.7mm、线材 1.2mm × 0.7mm —— 扁带，
     * 不是圆铁丝，所以用填充矩形 + 上亮下暗的渐变，而不是 stroke。
     * 两端各压一个小孔：腿从那里穿下去，这是"钉进纸里"唯一的可见证据。
     */
    return (
      '<svg viewBox="0 0 48 16" aria-hidden="true">' +
      '<defs><linearGradient id="ly-staple-g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#c7ced6"/><stop offset="0.4" stop-color="#8f97a1"/><stop offset="1" stop-color="#606770"/>' +
      '</linearGradient></defs>' +
      // 接触影只有一条：钉冠把纸压出一点点凹，纸面上就是 1px 的浅影。
      // 画宽了就变成"钉冠下面还垫了一条"，像个小板凳。
      '<rect x="5" y="8.1" width="38" height="1.6" rx="0.8" fill="rgba(40,44,50,0.13)"/>' +
      '<rect x="3" y="3.4" width="42" height="4.8" rx="2.4" fill="url(#ly-staple-g)"/>' +
      '<rect x="5" y="4.2" width="38" height="1.1" rx="0.55" fill="rgba(255,255,255,0.62)"/>' +
      // 两端下折的暗：腿从这里穿进纸里，正面只剩一点点弯折的阴影
      '<rect x="4.4" y="6.9" width="2.8" height="1.7" rx="0.85" fill="rgba(30,34,40,0.34)"/>' +
      '<rect x="40.8" y="6.9" width="2.8" height="1.7" rx="0.85" fill="rgba(30,34,40,0.34)"/>' +
      '</svg>'
    )
  }
  if (kind === 'binder') {
    /*
     * 长尾夹按实物画。上一版的毛病是**比例和手柄走向都不对**：
     * 夹体画成 36×73 的瘦高条、两根钢丝从顶上一路绕到底，围成一个圈 ——
     * 那是"文件夹夹子"，不是长尾夹。
     *
     * 真实长尾夹夹在纸上时看到的是：一条横着的卷边（手柄的转轴）、下面一块
     * **接近方形**的深色夹体（上宽下窄，下沿是咬着纸的钳口）、以及**折下来
     * 垂在纸面上**的一根 U 形钢丝（两端挂在卷边两端，弯在夹体下方）。
     * 所以这里：卷边 58×14、夹体 50→40 宽 54 高、手柄是一条开口朝上的 U。
     */
    return (
      '<svg viewBox="0 0 96 116" aria-hidden="true">' +
      '<defs>' +
      '<linearGradient id="ly-binder-body" x1="0" y1="0" x2="1" y2="0">' +
      '<stop offset="0" stop-color="#3d444c"/><stop offset="0.3" stop-color="#242a30"/><stop offset="1" stop-color="#0f1317"/>' +
      '</linearGradient>' +
      '<linearGradient id="ly-binder-roll" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#6a737d"/><stop offset="0.45" stop-color="#333a41"/><stop offset="1" stop-color="#12171c"/>' +
      '</linearGradient>' +
      '</defs>' +
      // 手柄：开口朝上的 U（两端挂在卷边两端，弯在夹体下方），三层错位出金属圆柱感
      (() => {
        // 折下来的手柄贴着夹体两腋走（x 26 / 70），弯在钳口下方 —— 画在夹体**之前**，
        // 被夹体挡住的部分正好不可见，露出来的就是"夹体下方挂着一只 U"
        const wire = 'M26 28 V72 C26 96 34 110 48 110 C62 110 70 96 70 72 V28'
        return (
          `<path d="${wire}" fill="none" stroke="#c3c9d1" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="${wire}" transform="translate(0.7 1)" fill="none" stroke="rgba(38,45,53,0.55)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>` +
          `<path d="${wire}" transform="translate(-0.7 -0.8)" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`
        )
      })() +
      // 夹体：上宽 50 → 下宽 40，下沿圆弧是钳口（咬着纸的那一侧）
      '<path d="M23 30 H73 L70 74 Q69.5 83 64 83 H32 Q26.5 83 26 74 Z" fill="url(#ly-binder-body)"/>' +
      // 卷边（转轴）：比夹体略宽，顶部一道亮线表现圆柱
      '<rect x="19" y="16" width="58" height="15" rx="7.5" fill="url(#ly-binder-roll)"/>' +
      '<rect x="23.5" y="18.4" width="49" height="2" rx="1" fill="rgba(255,255,255,0.36)"/>' +
      // 夹体中线的折痕 + 左侧反光
      '<path d="M48 36 V79" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="1.4"/>' +
      '<path d="M27.5 34 L30.5 34 L27.5 72" fill="none" stroke="rgba(255,255,255,0.14)" stroke-width="2.6" stroke-linecap="round"/>' +
      // 钳口下沿压出的一道深色投影：夹子和纸接触的地方总要暗一点
      '<path d="M26.5 74 V77 Q26.5 83 32 83 H64 Q69.5 83 69.5 77 V74" fill="none" stroke="rgba(0,0,0,0.34)" stroke-width="2"/>' +
      '</svg>'
    )
  }
  return ''
}

/**
 * 印章预设里的字：朱文圆印「阅」、白文方印「已阅」竖排、长条「已阅」、手写「签名」。
 * 用户填了 `decor.stampText` 就以那个为准，这里只是各预设的缺省字。
 */
const STAMP_GLYPH: Record<string, string> = {
  seal: '阅',
  square: '已阅',
  strip: '已阅',
  signature: '签名',
}

/**
 * 印章字号系数（相对 `--c-stamp-size`）与可用空间。
 *
 * 默认的一两个字走 `base`，所以老模板像素一个不差（C5 回归）；
 * 用户把印章文字改长（签名填真名）时才按 `room / 字数` 收一收，免得字戳出印章边框。
 * `room` 是"这个形状的容纳区相当于几倍字号"：圆印 ≈ 0.85、方印竖排看高度 0.85、
 * 长条横排 1.93、签名横排 1.61。
 */
const STAMP_FIT: Record<string, { base: number; room: number }> = {
  seal: { base: 0.46, room: 0.85 },
  square: { base: 0.4, room: 0.85 },
  strip: { base: 0.3, room: 1.93 },
  signature: { base: 0.52, room: 1.61 },
}

function stampHtml(tpl: CardTemplate): string {
  const d = tpl.decor
  if (!d.stamp) return ''
  const pos = d.stampPos ?? 'br'
  if (d.stampImage) {
    /*
     * data-stamp="image" 不能省 —— 尺寸规则挂在它上面。
     * 早先上传图只按 `[data-pos="bl"|"br"] .ly-stamp-img` 限了 max-height，
     * 于是左上 / 右上的印章图不受 stampSize 约束，按原图像素直接铺开
     * （「大小不可调」就是这么来的，而且大图会把标题盖住）。
     */
    return `<span class="ly-stamp" data-pos="${pos}" data-stamp="image"><img class="ly-stamp-img" src="${d.stampImage}" alt="" style="width:100%;height:100%"></span>`
  }
  const preset = d.stampPreset ?? 'seal'
  const glyph = (d.stampText ?? '').trim() || STAMP_GLYPH[preset] || '阅'
  const fit = STAMP_FIT[preset]
  const n = Array.from(glyph).length
  const k = fit ? Math.min(fit.base, fit.room / Math.max(1, n)) : null
  // 只在"字数超出默认"时才写内联字号：默认字保持 CSS 里的原系数，老模板逐像素不变
  const shrink = k !== null && fit !== undefined && k < fit.base - 1e-6
  const style = shrink ? ` style="font-size:calc(var(--c-stamp-size) * ${k.toFixed(3)})"` : ''
  return `<span class="ly-stamp" data-pos="${pos}" data-stamp="${preset}"><b${style}>${escapeHtml(glyph)}</b></span>`
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
