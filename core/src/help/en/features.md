# Features

Lypora renders Markdown as you type, but the file on disk is always plain Markdown — the visual formatting is drawn by a decoration layer, never written into the document.

## Live preview

- Type `**bold**` and the markers fade once the caret leaves the line, leaving just the bold text.
- Move the caret back and the raw syntax returns.
- Headings, lists, quotes, code blocks, tables and math are all rendered.
- Press `Ctrl+/` for source mode; the decoration layer turns off entirely. Same file, same caret, no second copy.

## Multiple documents: tabs and windows

- **Tabs**: opening more files adds tabs below the menu bar. Each tab keeps its own undo history, selection and scroll position.
- **Windows**: `Settings → Display mode` offers *tabs only*, *windows only*, or *both*. In windows-only mode, opening a file creates a new window — handy for putting two drafts on two monitors.
- Unsaved tabs are marked with `*`, mirrored in the file tree, the recent list and the window title.

## Outline and file tree

- The left sidebar has three views: outline, file tree, recent files.
- The outline is built from headings; clicking one jumps there, and it follows the caret while you scroll.
- Opening a folder lists Markdown and plain-text files; clicking one opens it as a tab.

## Focus and typewriter modes

- **Focus** (`F8`): dims everything except the current paragraph.
- **Typewriter** (`F9`): keeps the caret vertically centred.

## Math, tables, code

- Inline `$...$` and block `$$...$$` math are rendered with KaTeX.
- Table column widths can be dragged on the rendered table; the widths are written back to the Markdown delimiter row.
- Code blocks are highlighted per language, using the language name after the opening fence.

## Export

- **Markdown**: exported verbatim.
- **HTML**: single file with inline styles — offline-friendly, easy to send.
- **PDF**: through the system print pipeline on desktop.
- **Cards / long images**: see the "Layout output" page.

## Offline and cross-platform

- Desktop (Windows / macOS / Linux), Android and the browser share one front end.
- The web build caches for offline use, and file I/O degrades gracefully (native filesystem → file picker → download).
- UI in seven languages: 简体中文, English, 日本語, 한국어, Español, Français, Deutsch.

## Where your data lives

- While you type, a draft is written to IndexedDB every 4 seconds so *recent files* can restore it — **that is not your file on disk**.
- The disk is only touched when you press `Ctrl+S`, or choose *Save* in the confirmation shown when closing a tab or window.
