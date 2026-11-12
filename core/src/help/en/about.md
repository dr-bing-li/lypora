# About Lypora

**Lypora** is an independent implementation of a live-rendering Markdown editor: the source is the truth, the preview is drawn on top of it, and the file is always plain Markdown.

## Version

- Current version: **0.11.1**
- Licence: **MIT** (see `LICENSE`)
- Repository: `github.com/dr-bing-li/lypora`

## Independent implementation

Lypora is **independently implemented**. It is not affiliated with, authorised by, or derived from any commercial product (including but not limited to Typora), and it contains no code or assets from such products.

Menu grouping and shortcut conventions follow common practice across editors; that is interaction convention, not code. The implementation, data model and rendering pipeline are original:

- Editor core: CodeMirror 6 with a custom decoration layer (`blockDecosField` for blocks, `livePreview` for inline).
- Layout engine: a custom template system (37-field data, a compiler, and a parameter table).
- Theme adapter: custom two-way translation of selectors and CSS variables.

## Technology

| Layer | Open source projects |
| --- | --- |
| Editor | CodeMirror 6, `@codemirror/lang-markdown` |
| Math | KaTeX |
| Desktop shell | Electron |
| Mobile shell | Capacitor |
| Build | Vite, TypeScript |

The full third-party list and licences are in `THIRD-PARTY-NOTICES.md`.

## Data and privacy

- **No network**: apart from files you open yourself, the app makes no requests. No account, no analytics, no telemetry.
- **Local storage**: drafts, settings and custom themes live on this machine (IndexedDB / localStorage).
- **No upload**: document content never leaves the device. Exporting and sharing are local actions you trigger.

## Platforms

- Windows (installer / portable)
- macOS (arm64 / x64)
- Linux (tar.gz / AppImage / deb / rpm)
- Android (APK)
- Browser / PWA (open the web build, works offline)

## Known limitations

- PDF export is unavailable in the mobile shell (no system print pipeline in the WebView); the menu item is greyed out.
- Third-party Typora themes do not port perfectly — see "Themes and compatibility".
- Layout parameters cannot change the box model (width / padding semantics come from the size), which keeps preview and export strictly consistent.

## Feedback

Please file issues on the repository. Include the version (top right of this page), platform, and reproduction steps; for layout or export issues, add a screenshot.
