# Themes and compatibility

## Built-in themes

Six themes under the *Theme* menu, all built on the same set of CSS variables. Switching only swaps variables on the root element — the editor is never rebuilt.

| Theme | Description |
| --- | --- |
| Github | Default; light, closest to a repository README |
| Night | Dark, for long sessions |
| Pixyll | Minimal white with serif body text |
| Whitey | Soft grey paper |
| Vue | Green accent, lighter headings |
| Newsprint | Newspaper feel, generous letter spacing |

## Importing custom CSS

*Theme → Import theme…* accepts a `.css` file. It is stored in local storage (never uploaded) and appears as "Custom: filename", removable at any time.

Importing is not a raw injection. Four translation steps happen:

1. **Selectors** — rules aimed at another editor's DOM (`#write`, `h1`, `pre.md-fences`, `.CodeMirror`) are mapped onto this editor's structure (`.cm-line.md-*` plus the table, image and math containers).
2. **Combinators** — a `>` after the page container is treated as a descendant; `p + p` style adjacencies cannot be expressed in a flat-line model and are dropped (and counted).
3. **Variables** — colours, fonts and spacing are folded into this project's CSS variables, with per-region contrast guards for the menu bar, sidebar and status bar.
4. **Layout protection** — declarations that would break the line model (`margin`, `width`, `position` on a line) are dropped; block box properties for code blocks (border, radius, shadow, padding) are split across the first and last line so a fence stays one block instead of one box per line.

After importing, a toast reports how many rules and variables were kept, so you can tell how much actually took effect.

## Compatibility with third-party Typora themes

**Short answer: conventional layout themes now get close to the original, but not pixel-identical.**

Carried over since v0.14.4:

- **Paper textures and full-page gradients** — gradients on `html`/`body` are painted behind the document;
- **Automatic heading numbering** — `counter` + `::before` numbering appears as intended;
- **Paragraph cards, quote bars, list bullets** — pseudo-element decoration survives, and lines get a positioning context so it cannot escape to the window corner;
- **The theme's own base font size** — `#write{font-size}` and `html{font-size:11pt}` are folded into a scale factor, so `rem`-based layouts no longer inflate by ~9%; the font-size slider then scales on top of the theme's baseline;
- **Code block colours and traffic-light dots** — one set of dots per block, not per line, and the border/radius wraps the whole block.

What genuinely cannot be done (a model difference, not an unfixed bug):

| The theme relies on | This project's model | Result |
| --- | --- | --- |
| Spacing *between* paragraphs (`p + p`) | One flat sequence of lines; lines have no margin | Rule dropped |
| Decoration spanning several lines (watermarks, vertical text) | One box per line | Lands on a single line |
| `display:table` style re-layout of body text | Line order *is* source order | Text layer kept, layout layer dropped |
| Remote fonts / remote background images | Offline-first, and untrusted input makes no requests | Blocked |

If a theme looks wrong, suspect these three first: an unrecognised selector, a different variable name, or a dependency on the other editor's structure.
To check for yourself, open the theme pack's own `preview.html` next to this app — same CSS, two hosts — and the difference is immediately visible.

## Dark mode and the shell

- A dark theme also updates the `theme-color` meta tag, so the mobile status bar follows.
- The theme is a per-machine preference stored locally; it never touches the document.
- The theme does not affect card export: layout templates carry their own colour variables, decoupled from the UI theme.
