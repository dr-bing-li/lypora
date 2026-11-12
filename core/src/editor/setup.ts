import { Compartment, EditorState, Prec } from '@codemirror/state'
import { EditorView, keymap, drawSelection, dropCursor, placeholder } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
import { markdown, markdownLanguage, insertNewlineContinueMarkup, deleteMarkupBackward } from '@codemirror/lang-markdown'
import { bracketMatching } from '@codemirror/language'
import { livePreview, blockDecosField } from './live-preview'
import { cmd } from './commands'
import { t } from '../i18n'

export interface EditorHooks {
  onChange?: (doc: string) => void
  onCursor?: (line: number, col: number, total: number) => void
  onSave?: () => void
  onSearch?: () => void
  onSourceToggle?: () => void
}

/**
 * 占位文案单独装在一个 Compartment 里。
 * 切界面语言时要能换掉它，而 placeholder() 是构造期扩展——不隔一层就只能重建整个
 * EditorState，那会把撤销历史和光标一起丢掉。
 */
export const placeholderComp = new Compartment()

/**
 * 只读开关单独一个 Compartment：帮助文档这类"只让看"的标签要能编辑态与只读态共存于
 * 同一个 EditorView（切标签只是 view.setState），把只读做成构造期扩展就没法复用了。
 *   EditorState.readOnly —— 拦住所有事务里的 doc 改动（含粘贴、命令）
 *   EditorView.editable —— 去掉 caret 与输入法，视觉上也不再像输入框
 */
export const readOnlyComp = new Compartment()

/** 切语言后调用：只重配占位符，文档、历史、选区都不动 */
export function setEditorPlaceholder(view: EditorView): void {
  view.dispatch({ effects: placeholderComp.reconfigure(placeholder(t('editor.placeholder'))) })
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
    placeholderComp.of(placeholder(t('editor.placeholder'))),

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

export function createEditorState(
  doc: string,
  hooks: EditorHooks,
  selection?: number,
  opts?: { readonly?: boolean },
) {
  const pos = Math.max(0, Math.min(selection ?? 0, doc.length))
  return EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [
      // 只读态：帮助文档等"只看不改"的标签。
      // 同一个 Compartment 只能 of() 一次，所以它只能出现在这里，不能同时放进
      // buildExtensions —— 否则会抛 "Duplicate use of compartment in extensions"。
      readOnlyComp.of(
        opts?.readonly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [],
      ),
      ...buildExtensions(hooks),
    ],
  })
}
