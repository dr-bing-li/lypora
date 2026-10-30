/**
 * 编辑命令层 —— 对应 docs/02 §2 M3「编辑交互」
 * 全部命令签名统一为 (view) => boolean，便于 keymap 与工具栏共用。
 */

import { EditorView } from '@codemirror/view'
import { EditorSelection } from '@codemirror/state'

function eachSelectedLine(view: EditorView, fn: (line: { from: number; to: number; text: string }, index: number) => { text: string; caretOffset?: number } | null) {
  const { state } = view
  const changes: Array<{ from: number; to: number; insert: string }> = []
  const seen = new Set<number>()
  let caret: number | null = null

  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from)
    const endLine = state.doc.lineAt(range.to)
    for (let n = startLine.number; n <= endLine.number; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const ln = state.doc.line(n)
      const res = fn({ from: ln.from, to: ln.to, text: ln.text }, n - startLine.number)
      if (!res) continue
      if (res.text !== ln.text) changes.push({ from: ln.from, to: ln.to, insert: res.text })
      if (res.caretOffset !== undefined && n === startLine.number) caret = ln.from + res.caretOffset
    }
  }

  if (!changes.length) return false
  view.dispatch({
    changes,
    selection: caret !== null ? { anchor: caret } : undefined,
    scrollIntoView: true,
  })
  return true
}

/** 用定界符包裹选区（无选区时插入成对定界符并置于中间） */
function wrapSelection(view: EditorView, before: string, after = before): boolean {
  const { state } = view
  const changes: Array<{ from: number; to?: number; insert: string }> = []
  const ranges: Array<{ anchor: number; head: number }> = []

  for (const r of state.selection.ranges) {
    if (r.empty) {
      changes.push({ from: r.from, insert: before + after })
      ranges.push({ anchor: r.from + before.length, head: r.from + before.length })
    } else {
      changes.push({ from: r.from, to: r.to, insert: before + state.sliceDoc(r.from, r.to) + after })
      ranges.push({ anchor: r.from + before.length, head: r.to + before.length })
    }
  }
  view.dispatch({ changes, selection: EditorSelection.create(ranges.map((r) => EditorSelection.range(r.anchor, r.head))) })
  return true
}

/** 若选区已被同一对定界符包裹，则解包 */
function toggleWrap(view: EditorView, marker: string): boolean {
  const { state } = view
  const r = state.selection.main
  if (!r.empty) {
    const before = state.sliceDoc(Math.max(0, r.from - marker.length), r.from)
    const after = state.sliceDoc(r.to, Math.min(state.doc.length, r.to + marker.length))
    if (before === marker && after === marker) {
      view.dispatch({
        changes: [
          { from: r.from - marker.length, to: r.from, insert: '' },
          { from: r.to, to: r.to + marker.length, insert: '' },
        ],
        selection: { anchor: r.from - marker.length, head: r.to - marker.length },
      })
      return true
    }
  }
  return wrapSelection(view, marker)
}

export const cmd = {
  bold: (v: EditorView) => toggleWrap(v, '**'),
  italic: (v: EditorView) => toggleWrap(v, '*'),
  strike: (v: EditorView) => toggleWrap(v, '~~'),
  code: (v: EditorView) => toggleWrap(v, '`'),

  heading: (v: EditorView, level: number) => {
    return eachSelectedLine(v, ({ text }) => {
      const m = /^(#{1,6})\s+/.exec(text)
      const cur = m ? m[1].length : 0
      const body = m ? text.slice(m[0].length) : text
      if (level === 0) return { text: body }
      if (cur === level) return { text: body }
      return { text: '#'.repeat(level) + ' ' + body, caretOffset: level + 1 }
    })
  },

  bulletList: (v: EditorView) =>
    eachSelectedLine(v, ({ text }) => {
      const m = /^(\s*)([-*+])\s+(\[[ xX]\]\s+)?/.exec(text)
      if (m) {
        if (m[3]) return { text: m[1] + '- ' + text.slice(m[0].length) }
        return { text: m[1] + text.slice(m[0].length) }
      }
      return { text: '- ' + text, caretOffset: 2 }
    }),

  orderedList: (v: EditorView) => {
    let idx = 1
    return eachSelectedLine(v, ({ text }) => {
      const m = /^(\s*)(\d+[.)])\s+/.exec(text)
      if (m) return { text: m[1] + text.slice(m[0].length) }
      const prefix = `${idx++}. `
      return { text: prefix + text, caretOffset: prefix.length }
    })
  },

  taskList: (v: EditorView) =>
    eachSelectedLine(v, ({ text }) => {
      const m = /^(\s*)([-*+])\s+(\[[ xX]\])\s+/.exec(text)
      if (m) return { text: m[1] + m[2] + ' ' + text.slice(m[0].length) }
      const m2 = /^(\s*)([-*+])\s+/.exec(text)
      if (m2) return { text: m2[1] + m2[2] + ' [ ] ' + text.slice(m2[0].length) }
      return { text: '- [ ] ' + text, caretOffset: 6 }
    }),

  quote: (v: EditorView) =>
    eachSelectedLine(v, ({ text }) => {
      const m = /^(\s*)>\s?/.exec(text)
      if (m) return { text: m[1] + text.slice(m[0].length) }
      return { text: '> ' + text, caretOffset: 2 }
    }),

  horizontalRule: (v: EditorView) => {
    const { from } = v.state.selection.main
    const line = v.state.doc.lineAt(from)
    const atLineEnd = from === line.to
    const insert = (atLineEnd ? '' : '\n') + '\n---\n'
    v.dispatch({ changes: { from: atLineEnd ? from : line.to, insert }, selection: { anchor: (atLineEnd ? from : line.to) + insert.length } })
    return true
  },

  link: (v: EditorView) => {
    const r = v.state.selection.main
    const text = r.empty ? '链接文字' : v.state.sliceDoc(r.from, r.to)
    const insert = `[${text}](https://)`
    v.dispatch({
      changes: { from: r.from, to: r.to, insert },
      selection: { anchor: r.from + insert.length - 1 - 'https://'.length, head: r.from + insert.length - 1 },
    })
    return true
  },

  image: (v: EditorView) => {
    const r = v.state.selection.main
    const alt = r.empty ? '图片' : v.state.sliceDoc(r.from, r.to)
    const insert = `![${alt}](./assets/image.png)`
    v.dispatch({ changes: { from: r.from, to: r.to, insert }, selection: { anchor: r.from + 2, head: r.from + 2 + alt.length } })
    return true
  },

  table: (v: EditorView) => insertBlock(v, '| 列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n| 内容 | 内容 | 内容 |\n', 2, 2),
  mathBlock: (v: EditorView) => insertBlock(v, '$$\n\n$$\n', 3, 3),
  codeBlock: (v: EditorView) => insertBlock(v, '```\n\n```\n', 4, 4),

  indent: (v: EditorView) => shiftIndent(v, true),
  dedent: (v: EditorView) => shiftIndent(v, false),
}

/** 在光标处插入一个空行包裹的块，并把光标放到指定偏移 */
function insertBlock(view: EditorView, block: string, anchorOff: number, headOff: number): boolean {
  const r = view.state.selection.main
  const line = view.state.doc.lineAt(r.from)
  const prefix = line.text.trim() === '' ? '' : '\n'
  const suffix = '\n'
  const insert = prefix + block + suffix
  view.dispatch({
    changes: { from: r.from, to: r.to, insert },
    selection: { anchor: r.from + prefix.length + anchorOff, head: r.from + prefix.length + headOff },
    scrollIntoView: true,
  })
  return true
}

function shiftIndent(view: EditorView, forward: boolean): boolean {
  const { state } = view
  const unit = '  '
  const r = state.selection.main
  const line = state.doc.lineAt(r.from)
  const isListItem = /^(\s*)([-*+]|\d+[.)])\s/.test(line.text)

  if (r.empty && isListItem) {
    // 列表项：整体缩进 / 反缩进该行
    if (forward) {
      view.dispatch({ changes: { from: line.from, insert: unit }, selection: { anchor: r.from + unit.length } })
      return true
    }
    const m = /^(\s{1,2})/.exec(line.text)
    if (m) {
      view.dispatch({ changes: { from: line.from, to: line.from + m[1].length, insert: '' }, selection: { anchor: Math.max(line.from, r.from - m[1].length) } })
      return true
    }
    return false
  }

  if (r.empty) {
    view.dispatch({ changes: { from: r.from, insert: forward ? unit : '' }, selection: { anchor: r.from + (forward ? unit.length : 0) } })
    return true
  }

  let acc = 0
  return eachSelectedLine(view, ({ text }) => {
    void acc
    if (forward) return { text: unit + text }
    return { text: text.replace(/^ {1,2}/, '') }
  })
}

export type CmdName = keyof typeof cmd
