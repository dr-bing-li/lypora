/**
 * Live Preview 装饰层 —— Lypora 的核心算法
 * ==========================================================================
 * 实现 docs/02 §3.3 记录的三条规则：
 *   规则 A 块级双态：光标不在块内 → 语法标记隐藏；光标进入 → 标记以灰色显形
 *   规则 B 行内双态：光标/选区不触碰 span → 定界符隐藏
 *   规则 C 活控件：复选框 / 表格 / 公式 / 图片 / 图表 用 widget 替代源码
 *
 * ⚠ 关键架构约束（实测踩坑，见 docs/04 验证记录 V3）：
 *   CodeMirror 6 禁止 ViewPlugin 提供 **块级装饰**（block:true 的 replace），
 *   否则抛 "Block decorations may not be specified via plugins"。
 *   因此装饰层拆成两个来源：
 *     · blockDecosField (StateField) → 表格 / 分割线 / 块公式 / Mermaid 的块级 widget
 *     · livePreview     (ViewPlugin) → 其余行内装饰与行装饰（行装饰允许来自插件）
 *   两者通过 BlockState.covered 协作，避免同一行被两个来源同时装饰。
 *
 * 其余工程约束（对应 docs/01 §6 风险对策）：
 *   · 行内装饰只算视口范围 → R4 卡顿
 *   · 被 replace 的定界符注册为 atomicRanges → R2 退格跨段
 *   · 输入法组合期间光标所在行天然处于"活动态"（选区就在这行），结构不被改写 → R1
 * ==========================================================================
 */

import { EditorState, Range, RangeSet, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { highlightCode } from './highlight'
import { findInlineMath } from './math'
import {
  BlockMathWidget,
  BulletWidget,
  HrWidget,
  ImageWidget,
  InlineMathWidget,
  LangLabelWidget,
  MermaidWidget,
  TableWidget,
  TaskBoxWidget,
  ZeroWidthWidget,
} from './widgets'

export interface PreviewSettings {
  sourceMode: boolean
  focusMode: boolean
  typewriter: boolean
}

export const previewSettings: PreviewSettings = {
  sourceMode: false,
  focusMode: false,
  typewriter: false,
}

/** 设置变更后强制重建装饰 */
export const refreshPreview = StateEffect.define<null>()

const hiddenMark = Decoration.replace({})

interface Span {
  from: number
  to: number
}

/* ================================================================== *
 * 选区谓词（StateField 与 ViewPlugin 共用同一套判定，保证两态一致）
 * ================================================================== */

function selectionLineSpans(state: EditorState): Span[] {
  return state.selection.ranges.map((r) => {
    const a = state.doc.lineAt(r.from)
    const b = state.doc.lineAt(r.to)
    return { from: a.from, to: b.to }
  })
}

function isLineActive(state: EditorState, pos: number, spans?: Span[]): boolean {
  const s = spans ?? selectionLineSpans(state)
  const ln = state.doc.lineAt(pos)
  return s.some((x) => x.from <= ln.to && x.to >= ln.from)
}

function isRangeActive(state: EditorState, from: number, to: number, spans?: Span[]): boolean {
  const s = spans ?? selectionLineSpans(state)
  return s.some((x) => x.from <= to && x.to >= from)
}

function isTouched(state: EditorState, from: number, to: number): boolean {
  for (const r of state.selection.ranges) {
    if (r.empty) {
      if (r.from >= from && r.from <= to) return true
    } else if (r.from <= to && r.to >= from) return true
  }
  return false
}

/* ================================================================== *
 * 块级装饰 StateField
 * ================================================================== */

export class BlockState {
  constructor(
    readonly deco: DecorationSet,
    /** 已被块级 widget 覆盖的行起始位置，供行内插件跳过 */
    readonly covered: ReadonlySet<number>,
  ) {}
}

function isContainer(name: string): boolean {
  return (
    name === 'Document' ||
    name === 'Blockquote' ||
    name === 'BulletList' ||
    name === 'OrderedList' ||
    name === 'ListItem'
  )
}

function computeBlockDecos(state: EditorState): BlockState {
  const doc = state.doc
  const ranges: Range<Decoration>[] = []
  const covered = new Set<number>()
  if (previewSettings.sourceMode) return new BlockState(Decoration.none, covered)

  const spans = selectionLineSpans(state)
  const tree = syntaxTree(state)

  const coverLines = (from: number, to: number) => {
    const a = doc.lineAt(from).number
    const b = doc.lineAt(to).number
    for (let n = a; n <= b; n++) covered.add(doc.line(n).from)
  }

  tree.iterate({
    enter: (node) => {
      const nm = node.name
      if (isContainer(nm)) return true

      /* 表格：非活动态渲染为真实 <table> */
      if (nm === 'Table') {
        const startLine = doc.lineAt(node.from)
        const endLine = doc.lineAt(node.to)
        if (!isRangeActive(state, startLine.from, endLine.to, spans)) {
          const src = doc.sliceString(startLine.from, endLine.to)
          ranges.push(
            Decoration.replace({
              widget: new TableWidget(src, startLine.from),
              block: true,
            }).range(startLine.from, endLine.to),
          )
          coverLines(startLine.from, endLine.to)
        }
        return false
      }

      /* 分割线 */
      if (nm === 'HorizontalRule') {
        const line = doc.lineAt(node.from)
        if (!isLineActive(state, node.from, spans)) {
          ranges.push(
            Decoration.replace({
              widget: new HrWidget(line.from),
              block: true,
            }).range(line.from, line.to),
          )
          coverLines(line.from, line.to)
        }
        return false
      }

      /* 围栏代码块：Mermaid 整块渲染为图表；普通代码块交给行内插件做行装饰 */
      if (nm === 'FencedCode') {
        const info = node.node.getChild('CodeInfo')
        const lang = info ? doc.sliceString(info.from, info.to).trim() : ''
        if (/^mermaid$/i.test(lang)) {
          const startLine = doc.lineAt(node.from)
          const endLine = doc.lineAt(node.to)
          if (!isRangeActive(state, startLine.from, endLine.to, spans)) {
            const codeNode = node.node.getChild('CodeText')
            const body = codeNode ? doc.sliceString(codeNode.from, codeNode.to).trim() : ''
            ranges.push(
              Decoration.replace({
                widget: new MermaidWidget(body, startLine.from),
                block: true,
              }).range(startLine.from, endLine.to),
            )
            coverLines(startLine.from, endLine.to)
          }
        }
        return false
      }

      /* 块公式：$$ ... $$ 在语法树里是一个 Paragraph */
      if (nm === 'Paragraph') {
        const text = doc.sliceString(node.from, node.to)
        if (text.startsWith('$$') && text.endsWith('$$') && text.length > 4) {
          const startLine = doc.lineAt(node.from)
          const endLine = doc.lineAt(node.to)
          if (!isRangeActive(state, startLine.from, endLine.to, spans)) {
            const body = text.slice(2, -2).replace(/^\n/, '').replace(/\n$/, '')
            ranges.push(
              Decoration.replace({
                widget: new BlockMathWidget(body, startLine.from),
                block: true,
              }).range(startLine.from, endLine.to),
            )
            coverLines(startLine.from, endLine.to)
          }
        }
        return false
      }

      return false
    },
  })

  return new BlockState(Decoration.set(ranges, true), covered)
}

export const blockDecosField = StateField.define<BlockState>({
  create: (state) => computeBlockDecos(state),
  update: (value, tr) => {
    const forced = tr.effects.some((e) => e.is(refreshPreview))
    if (!tr.docChanged && !tr.selection && !forced) return value
    return computeBlockDecos(tr.state)
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

/* ================================================================== *
 * 行内 / 行装饰 ViewPlugin
 * ================================================================== */

interface BuildResult {
  deco: DecorationSet
  atomics: RangeSet<Decoration>
}

function buildInline(view: EditorView): BuildResult {
  const state = view.state
  const doc = state.doc

  if (previewSettings.sourceMode) {
    return { deco: Decoration.none, atomics: Decoration.none }
  }

  const spans = selectionLineSpans(state)
  const blocked = state.field(blockDecosField, false)?.covered ?? new Set<number>()

  const ranges: Range<Decoration>[] = []
  const atomics: Range<Decoration>[] = []
  const lineClasses = new Map<number, Set<string>>()
  const protectedSpans: Span[] = []

  const addLineClass = (lineFrom: number, cls: string) => {
    if (blocked.has(lineFrom)) return
    let set = lineClasses.get(lineFrom)
    if (!set) {
      set = new Set()
      lineClasses.set(lineFrom, set)
    }
    for (const c of cls.split(/\s+/)) if (c) set.add(c)
  }

  const hide = (from: number, to: number) => {
    if (to <= from) return
    ranges.push(hiddenMark.range(from, to))
    atomics.push(Decoration.mark({}).range(from, to))
  }

  const hideWithWidget = (from: number, to: number, spec: { widget: WidgetType }) => {
    if (to <= from) return
    ranges.push(Decoration.replace(spec).range(from, to))
    atomics.push(Decoration.mark({}).range(from, to))
  }

  const dim = (from: number, to: number) => {
    if (to <= from) return
    ranges.push(Decoration.mark({ class: 'md-mark' }).range(from, to))
  }

  const isProtected = (from: number, to: number) =>
    protectedSpans.some((s) => s.from < to && s.to > from)

  const tree = syntaxTree(state)
  const vpFrom = view.viewport.from
  const vpTo = view.viewport.to

  tree.iterate({
    from: vpFrom,
    to: vpTo,
    enter: (node) => {
      const name = node.name
      const nFrom = node.from
      const nTo = node.to
      if (nFrom === nTo) return

      /* ---------------- 标题 ---------------- */
      if (/^ATXHeading[1-6]$/.test(name)) {
        const level = Number(name.slice(-1))
        const line = doc.lineAt(nFrom)
        ranges.push(
          Decoration.mark({ class: `md-h md-h${level}` }).range(nFrom, Math.min(nTo, line.to)),
        )
        addLineClass(line.from, `md-line-h${level}`)
        const hdr = node.node.getChild('HeaderMark')
        if (hdr) {
          let end = hdr.to
          while (end < line.to && doc.sliceString(end, end + 1) === ' ') end++
          if (isLineActive(state, hdr.from, spans)) dim(hdr.from, end)
          else hide(hdr.from, end)
        }
        return
      }

      /* ---------------- 引用 ---------------- */
      if (name === 'QuoteMark') {
        const line = doc.lineAt(nFrom)
        let end = nTo
        while (end < line.to && doc.sliceString(end, end + 1) === ' ') end++
        if (isLineActive(state, nFrom, spans)) dim(nFrom, end)
        else hide(nFrom, end)
        addLineClass(line.from, 'md-quote-line')
        return
      }

      /* ---------------- 列表 ---------------- */
      if (name === 'ListMark') {
        const parent = node.node.parent
        // 语法树层级：ListMark → ListItem → OrderedList/BulletList
        // 用标记文本首字符判定更稳（"1." 开头即有序列表）
        const markText = doc.sliceString(nFrom, nTo)
        const isOrdered = /^\d/.test(markText)
        const taskNode = parent?.getChild('Task')
        const line = doc.lineAt(nFrom)
        // 行级标记：给主题适配层一个稳定的 li 落点（第三方主题的 li 选择器靠它命中）
        addLineClass(line.from, 'md-li')
        if (isOrdered) {
          // 有序列表保留数字，仅补一点右侧间距
          ranges.push(Decoration.mark({ class: 'md-ol-mark' }).range(nFrom, nTo))
          return
        }
        if (isLineActive(state, nFrom, spans)) {
          dim(nFrom, nTo)
          return
        }
        if (taskNode) {
          let end = nTo
          while (end < line.to && doc.sliceString(end, end + 1) === ' ') end++
          hideWithWidget(nFrom, end, { widget: new ZeroWidthWidget() })
        } else {
          hideWithWidget(nFrom, nTo, { widget: new BulletWidget('•') })
        }
        return
      }

      /* ---------------- 任务标记 ---------------- */
      if (name === 'TaskMarker') {
        const txt = doc.sliceString(nFrom, nTo)
        const checked = /\[[xX]\]/.test(txt)
        if (checked) addLineClass(doc.lineAt(nFrom).from, 'md-task-done')
        if (isLineActive(state, nFrom, spans)) dim(nFrom, nTo)
        else hideWithWidget(nFrom, nTo, { widget: new TaskBoxWidget(checked, nFrom) })
        return
      }

      /* ---------------- 围栏代码块（行装饰） ---------------- */
      if (name === 'FencedCode') {
        const startLine = doc.lineAt(nFrom)
        const endLine = doc.lineAt(nTo)
        const info = node.node.getChild('CodeInfo')
        const lang = info ? doc.sliceString(info.from, info.to).trim() : ''
        protectedSpans.push({ from: nFrom, to: nTo })
        if (/^mermaid$/i.test(lang)) return false // 整块由 StateField 渲染

        const only = startLine.number === endLine.number
        for (let n = startLine.number; n <= endLine.number; n++) {
          const ln = doc.line(n)
          let cls = 'md-code-line'
          if (only) cls += ' md-code-only'
          else if (n === startLine.number) cls += ' md-code-first'
          else if (n === endLine.number) cls += ' md-code-last'
          addLineClass(ln.from, cls)
        }

        for (let ch = node.node.firstChild; ch; ch = ch.nextSibling) {
          if (ch.name === 'CodeMark') {
            if (isLineActive(state, ch.from, spans)) dim(ch.from, ch.to)
            else hide(ch.from, ch.to)
          } else if (ch.name === 'CodeInfo') {
            if (isLineActive(state, ch.from, spans)) dim(ch.from, ch.to)
            else {
              ranges.push(
                Decoration.replace({ widget: new LangLabelWidget(lang) }).range(ch.from, ch.to),
              )
            }
          } else if (ch.name === 'CodeText') {
            const code = doc.sliceString(ch.from, ch.to)
            for (const t of highlightCode(code, lang)) {
              ranges.push(Decoration.mark({ class: t.cls }).range(ch.from + t.from, ch.from + t.to))
            }
          }
        }
        return false
      }

      /* ---------------- 表格（活动态显示源码） ---------------- */
      if (name === 'Table') {
        const startLine = doc.lineAt(nFrom)
        const endLine = doc.lineAt(nTo)
        protectedSpans.push({ from: startLine.from, to: endLine.to })
        let rowIndex = 0
        for (let n = startLine.number; n <= endLine.number; n++) {
          const ln = doc.line(n)
          addLineClass(ln.from, rowIndex === 1 ? 'md-table-line md-table-delim' : 'md-table-line')
          rowIndex++
        }
        return false
      }

      /* ---------------- 分割线（活动态显示源码） ---------------- */
      if (name === 'HorizontalRule') {
        dim(nFrom, nTo)
        return false
      }

      /* ---------------- 行内代码 ---------------- */
      if (name === 'InlineCode') {
        protectedSpans.push({ from: nFrom, to: nTo })
        ranges.push(Decoration.mark({ class: 'md-code-inline' }).range(nFrom, nTo))
        const touched = isTouched(state, nFrom, nTo)
        for (let ch = node.node.firstChild; ch; ch = ch.nextSibling) {
          if (ch.name === 'CodeMark') {
            if (touched) dim(ch.from, ch.to)
            else hide(ch.from, ch.to)
          }
        }
        return false
      }

      /* ---------------- 强调类 ---------------- */
      if (name === 'StrongEmphasis' || name === 'Emphasis' || name === 'Strikethrough') {
        const cls =
          name === 'StrongEmphasis' ? 'md-strong' : name === 'Emphasis' ? 'md-em' : 'md-strike'
        ranges.push(Decoration.mark({ class: cls }).range(nFrom, nTo))
        const touched = isTouched(state, nFrom, nTo)
        for (let ch = node.node.firstChild; ch; ch = ch.nextSibling) {
          if (ch.name === 'EmphasisMark' || ch.name === 'StrikethroughMark') {
            if (touched) dim(ch.from, ch.to)
            else hide(ch.from, ch.to)
          }
        }
        return
      }

      /* ---------------- 链接 ---------------- */
      if (name === 'Link') {
        protectedSpans.push({ from: nFrom, to: nTo })
        const marks: Span[] = []
        let url: Span | null = null
        for (let ch = node.node.firstChild; ch; ch = ch.nextSibling) {
          if (ch.name === 'LinkMark') marks.push({ from: ch.from, to: ch.to })
          else if (ch.name === 'URL') url = { from: ch.from, to: ch.to }
        }
        const touched = isTouched(state, nFrom, nTo)
        if (marks.length >= 2 && marks[1].from > marks[0].to) {
          ranges.push(Decoration.mark({ class: 'md-link' }).range(marks[0].to, marks[1].from))
        }
        for (const t of [...marks, ...(url ? [url] : [])]) {
          if (touched) dim(t.from, t.to)
          else hide(t.from, t.to)
        }
        return false
      }

      /* ---------------- 图片 ---------------- */
      if (name === 'Image') {
        protectedSpans.push({ from: nFrom, to: nTo })
        let url: Span | null = null
        const marks: Span[] = []
        for (let ch = node.node.firstChild; ch; ch = ch.nextSibling) {
          if (ch.name === 'URL') url = { from: ch.from, to: ch.to }
          else if (ch.name === 'LinkMark') marks.push({ from: ch.from, to: ch.to })
        }
        const touched = isTouched(state, nFrom, nTo)
        if (touched) {
          for (const t of [...marks, ...(url ? [url] : [])]) dim(t.from, t.to)
        } else if (url) {
          const src = doc.sliceString(url.from, url.to)
          const alt = marks.length >= 2 ? doc.sliceString(marks[0].to, marks[1].from) : ''
          hideWithWidget(nFrom, nTo, { widget: new ImageWidget(src, alt, nFrom) })
        }
        return false
      }
    },
  })

  /* ---------------- 行内公式（语法树不识别，正则扫描） ---------------- */
  const startLineNo = doc.lineAt(vpFrom).number
  const endLineNo = doc.lineAt(vpTo).number

  for (let n = startLineNo; n <= endLineNo; n++) {
    const ln = doc.line(n)
    if (blocked.has(ln.from)) continue
    if (!ln.text.includes('$')) continue
    if (protectedSpans.some((s) => s.from <= ln.from && s.to >= ln.to)) continue
    for (const m of findInlineMath(ln.text)) {
      const absFrom = ln.from + m.start
      const absTo = ln.from + m.end
      if (isProtected(absFrom, absTo)) continue
      if (isTouched(state, absFrom, absTo)) {
        dim(absFrom, absFrom + 1)
        dim(absTo - 1, absTo)
      } else {
        hideWithWidget(absFrom, absTo, { widget: new InlineMathWidget(m.body, absFrom) })
      }
    }
  }

  /* ---------------- 空行压缩（对齐参考实现的紧凑观感） ---------------- */
  for (let n = startLineNo; n <= endLineNo; n++) {
    const ln = doc.line(n)
    if (ln.text.trim() !== '') continue
    if (blocked.has(ln.from)) continue
    if (isProtected(ln.from, ln.to)) continue
    if (isLineActive(state, ln.from, spans)) continue
    addLineClass(ln.from, 'md-blank')
  }

  /* ---------------- 普通段落行（供第三方主题的 p 选择器对齐） ---------------- */
  const NON_PARA = /^md-line-h[1-6]$|^md-code-line$|^md-table-line$/
  for (let n = startLineNo; n <= endLineNo; n++) {
    const ln = doc.line(n)
    if (ln.text.trim() === '') continue
    if (blocked.has(ln.from)) continue
    const set = lineClasses.get(ln.from)
    if (set && [...set].some((c) => NON_PARA.test(c))) continue
    if (protectedSpans.some((s) => s.from <= ln.from && s.to >= ln.to)) continue
    addLineClass(ln.from, 'md-p')
  }

  /* ---------------- ==高亮==（第三方主题用 --text-highlight-bg 给 mark 上色） ---------------- */
  const selRanges = state.selection.ranges
  for (let n = startLineNo; n <= endLineNo; n++) {
    const ln = doc.line(n)
    if (!ln.text.includes('==')) continue
    const re = /==([^=\n]+)==/g
    let m: RegExpExecArray | null
    while ((m = re.exec(ln.text))) {
      const s = ln.from + m.index
      const e = s + m[0].length
      if (isProtected(s, e)) continue
      // 光标落在这段里就露出原文，与其它行内标记一致
      if (selRanges.some((r) => r.from <= e && r.to >= s)) continue
      dim(s, s + 2)
      dim(e - 2, e)
      ranges.push(Decoration.mark({ class: 'md-hl' }).range(s + 2, e - 2))
    }
  }

  /* ---------------- 专注模式 ---------------- */
  if (previewSettings.focusMode) {
    const blockSpan = currentBlockSpan(state, state.selection.main.head)
    for (let n = startLineNo; n <= endLineNo; n++) {
      const ln = doc.line(n)
      if (ln.to < blockSpan.from || ln.from > blockSpan.to) addLineClass(ln.from, 'md-focus-dim')
    }
  }

  for (const [lineFrom, classes] of lineClasses) {
    ranges.push(Decoration.line({ class: [...classes].join(' ') }).range(lineFrom))
  }

  return { deco: Decoration.set(ranges, true), atomics: Decoration.set(atomics, true) }
}

function currentBlockSpan(state: EditorState, pos: number): Span {
  const doc = state.doc
  const line = doc.lineAt(pos)

  // 光标在空行上时没有"当前段落"，目光所及应该落在最近的正文块上，
  // 否则专注模式会把整篇都压暗，等于没开。
  let probe = pos
  if (line.text.trim() === '') {
    let up = line.number - 1
    let down = line.number + 1
    while (up >= 1 && doc.line(up).text.trim() === '') up--
    while (down <= doc.lines && doc.line(down).text.trim() === '') down++
    if (up >= 1) probe = doc.line(up).from
    else if (down <= doc.lines) probe = doc.line(down).from
    else return { from: line.from, to: line.to }
  }

  const tree = syntaxTree(state)
  let node = tree.resolveInner(probe, 1)
  while (node.parent && node.parent.name !== 'Document') node = node.parent
  if (node.name === 'Document') {
    const ln = doc.lineAt(probe)
    return { from: ln.from, to: ln.to }
  }
  return { from: node.from, to: node.to }
}

export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    atomics: RangeSet<Decoration>

    constructor(view: EditorView) {
      const r = buildInline(view)
      this.decorations = r.deco
      this.atomics = r.atomics
    }

    update(u: ViewUpdate) {
      // 必须包含 viewportChanged：滚动不产生事务，但新进入视口的块需要装饰。
      // 这是已验证的坑（见 docs/04 V5），漏掉会导致滚动后代码块/标题露出源码。
      if (
        u.docChanged ||
        u.selectionSet ||
        u.viewportChanged ||
        u.focusChanged ||
        u.transactions.length > 0
      ) {
        const r = buildInline(u.view)
        this.decorations = r.deco
        this.atomics = r.atomics
      }
    }
  },
  {
    decorations: (v) => v.decorations,
    provide: (plugin) =>
      EditorView.atomicRanges.of((view) => view.plugin(plugin)?.atomics ?? Decoration.none),
  },
)
