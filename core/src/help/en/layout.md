# Layout output

*Layout* (`Ctrl+Shift+P`, or the "Layout" menu) turns the current document into shareable cards: long images for social platforms, or an A4 print sheet.

## The panel

It takes over the whole editor area (the menu bar stays). Three columns, left to right:

1. **Preview** — produced by the very same pipeline as the export, not a separately drawn mock-up.
2. **Template gallery** — 20 built-in templates plus your own.
3. **Parameters** — 19 controls for colours, type, spacing and decoration.

`Esc` or the close button returns to editing. Parameter changes re-paginate automatically (~160ms debounce), so dragging a slider stays smooth.

## Templates

- 20 built-ins, grouped by style (minimal, newspaper, magazine, journal…).
- **Save as my template**: the current parameter set plus a name, up to 40 entries.
- **Export / import**: `.json` with a schema version. Older templates with missing fields fall back to defaults instead of failing.
- Importing a template whose id already exists appends a suffix; built-ins are never overwritten.

## Parameters (19)

| Group | Items |
| --- | --- |
| Colour | paper, ink, accent, code background |
| Metrics | body size, line height, title size, side padding, corner radius |
| Toggles | header rule, page numbers |
| Decoration | texture, accent mark, corner fold, cover motif, tape, stamp, background opacity, binding |
| Fonts | 4 presets (each swaps the whole font stack) |

**Templates may only change variables, never box model.** Allowing `display/width/padding` would shift the measurement basis used for pagination, and the preview would stop matching the export — which is why those are not in the parameter list.

## Sizes and pagination

| Size | Canvas | Output |
| --- | --- | --- |
| Portrait 3:4 | 540 × 720 | 1080 × 1440 |
| Square 1:1 | 540 × 540 | 1080 × 1080 |
| Story 9:16 | 540 × 960 | 1080 × 1920 |
| A4 | 595 × 842 | 1190 × 1684 |

Three pagination modes:

- **Auto**: split by content height, filling each page.
- **By rule**: `---` forces a page break.
- **None**: one long image.

## Background and binding

- Textures: none, kraft, lined, grid, dots, watercolour, rice paper.
- Custom background image: downscaled to 1600px on the long edge and stored as WebP locally; opacity is adjustable.
- Binding: left, right or none — with page margins it makes a multi-page export read like a booklet.

## Export

| Format | Use |
| --- | --- |
| PNG (per page) | Post directly to social platforms |
| PDF (multi-page) | Printing and archiving |
| ZIP | All pages at once |
| Copy | Current page to clipboard |

Preview and export share the same render function, size and scale factor — what you see is what you get.

## Relationship to the UI theme

Card templates carry their own colour variables, **decoupled from the UI theme**: a dark UI can still export cream-coloured paper.
