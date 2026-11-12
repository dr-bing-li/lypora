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

Importing is not a raw injection. Two translations happen:

1. **Selectors** — rules aimed at another editor's DOM (`#write`, `.markdown-body`, …) are mapped onto this editor's structure.
2. **Variables** — colours, fonts and spacing are folded into this project's CSS variables, so one theme cannot break unrelated parts of the UI.

After importing, a toast reports how many rules and variables were kept, so you can tell how much actually took effect.

## Compatibility with third-party Typora themes

**Short answer: the portable parts port, but nothing is guaranteed to be pixel-identical.**

- Themes that only change colours, fonts, line height or heading styles usually port almost completely.
- Themes that depend on the other editor's DOM (specific `div` nesting, pseudo-element decorations, fluid layout) only partially apply.
- `mark` highlighting maps to this project's `.md-hl`; background colours on `mark` are carried over.
- Remote resources in a theme (`@font-face` pointing at a CDN, `background-image: url(http…)`) are blocked: they cannot load offline, and a theme file is untrusted input that should not be allowed to make requests.

If a theme looks wrong, suspect these three first: an unrecognised selector, a different variable name, or a dependency on the other editor's structure.

## Dark mode and the shell

- A dark theme also updates the `theme-color` meta tag, so the mobile status bar follows.
- The theme is a per-machine preference stored locally; it never touches the document.
- The theme does not affect card export: layout templates carry their own colour variables, decoupled from the UI theme.
