import { EditorView, WidgetType } from '@codemirror/view'
import { renderBlockMath, renderInlineMath } from './math'
import { escapeHtml, parseTable, renderInlineMd } from '../util'
import { clearColRatios, loadColRatios, saveColRatios, tableSignature } from './table-widths'
import { toast } from '../ui/toast'

/* ------------------------------------------------------------------ *
 * 任务复选框
 * ------------------------------------------------------------------ */
export function toggleTaskAt(view: EditorView, pos: number): void {
  const doc = view.state.doc
  const text = doc.sliceString(pos, Math.min(pos + 3, doc.length))
  const m = /^\[(.)\]$/.exec(text)
  if (!m) return
  const inner = m[1] === ' ' ? 'x' : ' '
  view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: inner } })
}

export class TaskBoxWidget extends WidgetType {
  constructor(readonly checked: boolean, readonly pos: number) {
    super()
  }
  eq(o: TaskBoxWidget) {
    return o.checked === this.checked && o.pos === this.pos
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = 'cm-task-box' + (this.checked ? ' is-checked' : '')
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.title = this.checked ? '标记为未完成' : '标记为已完成'
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
      toggleTaskAt(view, this.pos)
    })
    return box
  }
  ignoreEvent() {
    return true
  }
}

/* ------------------------------------------------------------------ *
 * 无序列表圆点
 * ------------------------------------------------------------------ */
export class BulletWidget extends WidgetType {
  constructor(readonly char = '•') {
    super()
  }
  eq(o: BulletWidget) {
    return o.char === this.char
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-bullet-widget'
    s.textContent = this.char
    return s
  }
  ignoreEvent() {
    return true
  }
}

/** 零宽占位：用于把源码里的标记位"吃掉"但不产生可见宽度 */
export class ZeroWidthWidget extends WidgetType {
  eq() {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.style.display = 'inline-block'
    s.style.width = '0'
    s.style.overflow = 'hidden'
    return s
  }
  ignoreEvent() {
    return true
  }
}

/* ------------------------------------------------------------------ *
 * 分割线
 * ------------------------------------------------------------------ */
export class HrWidget extends WidgetType {
  constructor(readonly pos: number) {
    super()
  }
  eq(o: HrWidget) {
    return o.pos === this.pos
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-hr-widget'
    wrap.appendChild(document.createElement('hr'))
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true })
      view.focus()
    })
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 图片
 * ------------------------------------------------------------------ */
export class ImageWidget extends WidgetType {
  constructor(readonly src: string, readonly alt: string, readonly pos: number) {
    super()
  }
  eq(o: ImageWidget) {
    return o.src === this.src && o.alt === this.alt
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-img-widget'
    wrap.title = this.alt || this.src
    const img = document.createElement('img')
    img.src = this.src
    img.alt = this.alt
    img.loading = 'lazy'
    img.addEventListener('error', () => {
      wrap.textContent = `🖼 ${this.alt || this.src}（图片无法加载）`
      wrap.style.color = 'var(--fg-muted)'
      wrap.style.fontSize = '0.85em'
    })
    wrap.appendChild(img)
    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true })
      view.focus()
    })
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 公式
 * ------------------------------------------------------------------ */
export class InlineMathWidget extends WidgetType {
  constructor(readonly src: string, readonly pos: number) {
    super()
  }
  eq(o: InlineMathWidget) {
    return o.src === this.src
  }
  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-math-inline'
    span.innerHTML = renderInlineMath(this.src)
    span.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true })
      view.focus()
    })
    return span
  }
  ignoreEvent() {
    return false
  }
}

export class BlockMathWidget extends WidgetType {
  constructor(readonly src: string, readonly pos: number) {
    super()
  }
  eq(o: BlockMathWidget) {
    return o.src === this.src
  }
  toDOM(view: EditorView): HTMLElement {
    const div = document.createElement('div')
    div.className = 'cm-math-block'
    div.innerHTML = renderBlockMath(this.src)
    div.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true })
      view.focus()
    })
    return div
  }
  ignoreEvent() {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 表格
 *
 * 结构（拖动列宽需要一层专门定位的 stage）：
 *   .cm-table-widget            ← 块级容器，widget 挂在这里
 *     .cm-table-scroll          ← 列过多/过窄时横向滚动
 *       .cm-table-stage         ← position:relative，拖拽线按它定位
 *         table > colgroup/col  ← 列宽真源（比例）
 *         .cm-col-grips > .cm-col-grip  ← 每两列之间的分隔线，默认透明、hover 显示
 *
 * 列宽只改 col 的 width，不动 markdown 源码，也不重新 dispatch —— 拖动过程中
 * 浏览器只做一次本地重排，因此是实时的（见 table-widths.ts 的存储约定）。
 * ------------------------------------------------------------------ */
/** 单列下限：再窄连一个汉字都放不下（padding 24px + 一个 16px 字） */
const MIN_COL_PX = 48

let colBadge: HTMLElement | null = null

function ensureColBadge(): HTMLElement {
  if (!colBadge) {
    colBadge = document.createElement('div')
    colBadge.className = 'cm-col-badge'
    document.body.appendChild(colBadge)
  }
  return colBadge
}

function showColBadge(px: number, total: number, x: number, y: number): void {
  const el = ensureColBadge()
  el.textContent = `${Math.round(px)} px · ${Math.round((px / (total || 1)) * 100)}%`
  el.classList.add('on')
  const pad = 10
  const w = el.offsetWidth || 90
  el.style.left = `${Math.min(window.innerWidth - w - pad, Math.max(pad, x + 14))}px`
  el.style.top = `${Math.min(window.innerHeight - 30, y + 18)}px`
}

function hideColBadge(): void {
  colBadge?.classList.remove('on')
}

export class TableWidget extends WidgetType {
  constructor(readonly src: string, readonly pos: number) {
    super()
  }
  eq(o: TableWidget) {
    return o.src === this.src && o.pos === this.pos
  }
  destroy(dom: HTMLElement): void {
    // 拖动过程中 widget 被销毁（撤销/切源码态）时 pointerup 不会再来，
    // 全局的 col-resizing 类必须在这里兜底清掉，否则整页光标卡在 col-resize。
    document.body.classList.remove('col-resizing')
    ;(dom as unknown as { __cleanup?: () => void }).__cleanup?.()
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-widget'
    const scroller = document.createElement('div')
    scroller.className = 'cm-table-scroll'
    const stage = document.createElement('div')
    stage.className = 'cm-table-stage'

    const model = parseTable(this.src)
    const colCount = Math.max(1, model.header.length)
    const table = document.createElement('table')

    const colgroup = document.createElement('colgroup')
    const colEls: HTMLTableColElement[] = []
    for (let i = 0; i < colCount; i++) {
      const col = document.createElement('col')
      colgroup.appendChild(col)
      colEls.push(col)
    }
    table.appendChild(colgroup)

    const thead = document.createElement('thead')
    const htr = document.createElement('tr')
    model.header.forEach((cell, i) => {
      const th = document.createElement('th')
      th.dataset.align = model.aligns[i]
      th.innerHTML = renderInlineMd(cell)
      htr.appendChild(th)
    })
    thead.appendChild(htr)
    table.appendChild(thead)

    const tbody = document.createElement('tbody')
    model.rows.forEach((row) => {
      const tr = document.createElement('tr')
      row.forEach((cell, i) => {
        const td = document.createElement('td')
        td.dataset.align = model.aligns[i]
        td.innerHTML = renderInlineMd(cell)
        tr.appendChild(td)
      })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody)
    stage.appendChild(table)

    const sig = tableSignature(this.src)
    const setRatios = (r: number[] | null) => {
      stage.classList.toggle('manual', !!r)
      colEls.forEach((col, i) => {
        col.style.width = r ? `${(r[i] * 100).toFixed(3)}%` : ''
      })
    }
    setRatios(loadColRatios(sig, colCount))

    const ths = () => Array.from(table.querySelectorAll('thead th')) as HTMLElement[]
    let ro: ResizeObserver | null = null
    const cleanups: Array<() => void> = []
    /** 把分隔线吸附到真实列边界；列数 <2 时是空操作，由下面的 if 块填充 */
    let syncGrips: () => void = () => {}

    /* 拖动第 i 条分隔线：只在 i 与 i+1 之间重新分配宽度（表格总宽不变）。
       这是 Word/飞书文档的默认手感，也避免了"拖最后一列把表格撑出正文"的歧义。 */
    const bindGrip = (grip: HTMLElement, i: number): void => {
      let dragging = false
      let startX = 0
      let startW: number[] = []
      let total = 0
      let pair = 0
      let pending: number[] | null = null
      let lastTap = 0

      // wrap 上有 mousedown → 光标跳到表首（表格回源码态），拖拽线必须自己吃掉
      grip.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
      })

      grip.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        const cells = ths()
        if (cells.length < 2) return
        startW = cells.map((c) => c.getBoundingClientRect().width)
        total = startW.reduce((a, b) => a + b, 0)
        pair = startW[i] + startW[i + 1]
        if (!(total > 0) || !(pair > MIN_COL_PX * 2)) return
        startX = e.clientX
        pending = startW.map((w) => w / total)
        // 先把当前像素宽快照成比例并切 fixed：拖动时只有这两列在动，其余列不抖
        stage.classList.add('manual', 'resizing')
        grip.classList.add('active')
        setRatios(pending)
        dragging = true
        document.body.classList.add('col-resizing')
        try {
          grip.setPointerCapture(e.pointerId)
        } catch {
          /* 指针已释放 */
        }
        showColBadge(startW[i], total, e.clientX, e.clientY)
      })

      const onMove = (e: PointerEvent) => {
        if (!dragging) return
        const width = Math.min(pair - MIN_COL_PX, Math.max(MIN_COL_PX, startW[i] + (e.clientX - startX)))
        const next = startW.slice()
        next[i] = width
        next[i + 1] = pair - width
        pending = next.map((w) => w / total)
        setRatios(pending)
        // 拖动中必须每帧重新吸附：表格总宽不变，ResizeObserver 不会触发，
        // 不主动同步的话高亮线会停在起点不动（V33）
        syncGrips()
        showColBadge(width, total, e.clientX, e.clientY)
      }

      /** 双击 = 均分。不用原生 dblclick：pointerdown 里 preventDefault 会抑制兼容的
       *  mouse 事件链，Chromium 下 dblclick 永远不来（踩坑记录 V28）。 */
      const evenOut = () => {
        clearColRatios(sig)
        const even = Array.from({ length: colCount }, () => 1 / colCount)
        stage.classList.add('manual')
        setRatios(even)
        syncGrips()
        saveColRatios(sig, even)
        toast('列宽已均分', 1200)
      }

      const end = (e: PointerEvent) => {
        if (!dragging) return
        dragging = false
        stage.classList.remove('resizing')
        grip.classList.remove('active')
        document.body.classList.remove('col-resizing')
        try {
          grip.releasePointerCapture(e.pointerId)
        } catch {
          /* 指针已释放 */
        }
        hideColBadge()
        syncGrips()

        // 没有位移 = 单击/双击，不写列宽
        if (Math.abs(e.clientX - startX) <= 3) {
          const now = Date.now()
          if (now - lastTap < 350) {
            lastTap = 0
            evenOut()
          } else {
            lastTap = now
          }
          return
        }
        lastTap = 0
        if (pending) {
          saveColRatios(sig, pending)
          toast(`列宽 ${Math.round(pending[i] * total)} px（双击分隔线均分）`, 1400)
        }
      }

      grip.addEventListener('pointermove', onMove)
      grip.addEventListener('pointerup', end)
      grip.addEventListener('pointercancel', end)

      cleanups.push(() => grip.classList.remove('active'))
    }

    if (colCount > 1) {
      const layer = document.createElement('div')
      layer.className = 'cm-col-grips'
      const grips: HTMLElement[] = []
      for (let i = 0; i < colCount - 1; i++) {
        const grip = document.createElement('div')
        grip.className = 'cm-col-grip'
        grip.dataset.col = String(i)
        grip.title = '拖动调整列宽 · 双击均分'
        layer.appendChild(grip)
        grips.push(grip)
        bindGrip(grip, i)
      }
      stage.appendChild(layer)

      // 拖拽线贴着第 i 列的右边界；表格宽度会随正文宽度/字号/窗口变化，用 RO 跟随
      const layout = () => {
        const cells = ths()
        if (!cells.length) return
        const stageRect = stage.getBoundingClientRect()
        for (let i = 0; i < grips.length; i++) {
          const cell = cells[i]
          if (!cell) continue
          grips[i].style.left = `${Math.round(cell.getBoundingClientRect().right - stageRect.left)}px`
        }
      }
      syncGrips = layout
      requestAnimationFrame(layout)
      ro = new ResizeObserver(layout)
      // 只观察 table 不够：换主题改表头 padding、字号变化都会重分配列宽，
      // 但表格总宽仍是 100% 不变 → 观察不到。每个 th 也要盯（V33）。
      ro.observe(table)
      ths().forEach((th) => ro?.observe(th))
    }

    scroller.appendChild(stage)
    wrap.appendChild(scroller)

    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      // 点击表格 → 光标落到表格块首，表格切回源码态可编辑（降级交互，见 docs/02 §8）
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true })
      view.focus()
    })

    ;(wrap as unknown as { __cleanup?: () => void }).__cleanup = () => {
      ro?.disconnect()
      hideColBadge()
      cleanups.forEach((fn) => fn())
    }
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 代码块语言标签
 * ------------------------------------------------------------------ */
export class LangLabelWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(o: LangLabelWidget) {
    return o.lang === this.lang
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-lang-label'
    span.textContent = this.lang || 'text'
    return span
  }
  ignoreEvent() {
    return true
  }
}

/* ------------------------------------------------------------------ *
 * Mermaid 图表
 * 运行时探测 window.mermaid（可选注入），缺失时优雅退化为源码视图。
 * ------------------------------------------------------------------ */
let mermaidSeq = 0

export class MermaidWidget extends WidgetType {
  constructor(readonly src: string, readonly pos: number) {
    super()
  }
  eq(o: MermaidWidget) {
    return o.src === this.src
  }
  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-mermaid-widget'

    const g = (window as unknown as { mermaid?: MermaidLike }).mermaid
    if (!g || typeof g.render !== 'function') {
      const pre = document.createElement('pre')
      pre.className = 'cm-mermaid-fallback'
      pre.textContent = this.src
      wrap.appendChild(pre)
      const tip = document.createElement('div')
      tip.textContent = 'Mermaid 未加载，显示源码'
      tip.style.cssText = 'font-size:10.5px;color:var(--fg-faint);margin-top:4px'
      wrap.appendChild(tip)
      return wrap
    }

    const id = `mmd-${++mermaidSeq}`
    g.render(id, this.src)
      .then((res: { svg: string }) => {
        wrap.innerHTML = res.svg
      })
      .catch(() => {
        const pre = document.createElement('pre')
        pre.className = 'cm-mermaid-fallback'
        pre.textContent = this.src
        wrap.innerHTML = ''
        wrap.appendChild(pre)
      })

    wrap.addEventListener('mousedown', (e) => {
      e.preventDefault()
      view.dispatch({ selection: { anchor: this.pos }, scrollIntoView: true })
      view.focus()
    })
    return wrap
  }
  ignoreEvent() {
    return false
  }
}

interface MermaidLike {
  render(id: string, src: string): Promise<{ svg: string }>
}
