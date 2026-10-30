import { EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, drawSelection, dropCursor, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown'
import { bracketMatching } from '@codemirror/language'
import { livePreview, blockDecosField } from './live-preview'
import { cmd } from './commands'

export interface EditorHooks {
  onChange?: (doc: string) => void
  onCursor?: (line: number, col: number, total: number) => void
  onSave?: () => void
  onSearch?: () => void
  onSourceToggle?: () => void
}

const themeSpec = EditorView.theme({
  '&': {
    fontSize: 'var(--content-font-size)',
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: 'var(--font-body)',
    overflow: 'visible',
  },
  '.cm-content': {
    caretColor: 'var(--accent)',
    paddingBottom: '1px',
  },
  '.cm-line': {
    padding: '0',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent)',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--sel)',
  },
  '.cm-panels': {
    backgroundColor: 'var(--bg-elev)',
  },
})

export function buildExtensions(hooks: EditorHooks) {
  return [
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    bracketMatching(),
    highlightSelectionMatches(),
    search({ top: true }),
    placeholder('开始写点什么…  支持 Markdown、公式、表格、代码块'),

    markdown({ base: markdownLanguage, addKeymap: false }),

    // 智能回车：列表自动续行、空列表项退出、引用续行
    Prec.high(
      keymap.of([
        { key: 'Enter', run: insertNewlineContinueMarkup },
        { key: 'Backspace', run: deleteMarkupBackward },
      ]),
    ),

    keymap.of([
      { key: 'Mod-b', run: cmd.bold, preventDefault: true },
      { key: 'Mod-i', run: cmd.italic, preventDefault: true },
      { key: 'Mod-Shift-x', run: cmd.strike, preventDefault: true },
      { key: 'Mod-e', run: cmd.code, preventDefault: true },
      { key: 'Mod-k', run: cmd.link, preventDefault: true },
      { key: 'Mod-Shift-i', run: cmd.image, preventDefault: true },
      { key: 'Mod-1', run: (v) => cmd.heading(v, 1), preventDefault: true },
      { key: 'Mod-2', run: (v) => cmd.heading(v, 2), preventDefault: true },
      { key: 'Mod-3', run: (v) => cmd.heading(v, 3), preventDefault: true },
      { key: 'Mod-4', run: (v) => cmd.heading(v, 4), preventDefault: true },
      { key: 'Mod-5', run: (v) => cmd.heading(v, 5), preventDefault: true },
      { key: 'Mod-6', run: (v) => cmd.heading(v, 6), preventDefault: true },
      { key: 'Mod-0', run: (v) => cmd.heading(v, 0) || true, preventDefault: true },
      // 列表快捷键对齐参考实现：Ctrl+Shift+] 无序、Ctrl+Shift+[ 有序
      { key: 'Mod-Shift-]', run: cmd.bulletList, preventDefault: true },
      { key: 'Mod-Shift-[', run: cmd.orderedList, preventDefault: true },
      // 旧习惯保留为别名，别让已有用户的手感断掉
      { key: 'Mod-Shift-8', run: cmd.bulletList, preventDefault: true },
      { key: 'Mod-Shift-7', run: cmd.orderedList, preventDefault: true },
      { key: 'Alt-Shift-5', run: cmd.strike, preventDefault: true },
      { key: 'Mod-Shift-9', run: cmd.taskList, preventDefault: true },
      { key: 'Mod-Shift-q', run: cmd.quote, preventDefault: true },
      { key: 'Mod-Shift-t', run: cmd.table, preventDefault: true },
      { key: 'Mod-Shift-m', run: cmd.mathBlock, preventDefault: true },
      { key: 'Mod-Shift-c', run: cmd.codeBlock, preventDefault: true },
      { key: 'Mod-Shift--', run: cmd.horizontalRule, preventDefault: true },
      { key: 'Mod-Enter', run: cmd.codeBlock, preventDefault: true },
      { key: 'Tab', run: cmd.indent, preventDefault: true },
      { key: 'Shift-Tab', run: cmd.dedent, preventDefault: true },
      ...searchKeymap,
      ...defaultKeymap,
      ...historyKeymap,
    ]),

    blockDecosField,
    livePreview,
    themeSpec,

    EditorView.updateListener.of((u) => {
      if (u.docChanged) hooks.onChange?.(u.state.doc.toString())
      if (u.selectionSet || u.docChanged) {
        const head = u.state.selection.main.head
        const line = u.state.doc.lineAt(head)
        hooks.onCursor?.(line.number, head - line.from + 1, u.state.doc.lines)
      }
    }),

  ]
}

// Prec 已在顶部从 state 包导入

export function createEditorState(doc: string, hooks: EditorHooks, selection?: number) {
  const pos = Math.max(0, Math.min(selection ?? 0, doc.length))
  return EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: buildExtensions(hooks),
  })
}
