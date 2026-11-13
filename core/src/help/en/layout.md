# Layout output

*Layout* (`Ctrl+Shift+P`, or the "Layout" menu) turns the current document into shareable cards: long images for social platforms, or an A4 print sheet.

## The panel

It takes over the whole editor area (the menu bar stays). Three columns, left to right:

1. **Preview** — produced by the very same pipeline as the export, not a separately drawn mock-up.
2. **Template gallery** — 28 built-in templates plus your own, as three-column landscape cards whose thumbnails are real layouts.
3. **Parameters** — 29 controls for colours, type, spacing and decoration, in 7 groups.

`Esc` or the close button returns to editing. Parameter changes re-paginate automatically (~160ms debounce), so dragging a slider stays smooth.

## Templates

- **28 built-ins**, each named with four characters, covering minimal, newspaper/magazine, journal/collage, neon and film looks.
- Gallery thumbnails are **that template actually laying out a card** — not colour swatches, not cached screenshots — so names, fonts, quote frames and stamps all change with the language and the parameters.
- **Save as my template**: the current parameter set plus a name, up to 40 entries.
- **Export / import style package**: see "Style packages" below.
- Importing a template whose id already exists appends a suffix; built-ins are never overwritten.

## Parameters (29 in 7 groups)

| Group | Items |
| --- | --- |
| Colour | paper, ink, muted, accent, code background, quote background, quote rule |
| Metrics | body size, line height, title size, side padding, corner radius |
| Toggles | header rule, page numbers |
| Background | 8 texture presets (none / kraft / lined / grid / dots / watercolour / fibre / mesh / perforated) or your own image, plus opacity |
| Typography | 5 quote styles, 6 bullet styles, 5 title marks, 5 outer frames |
| Stamp | on/off, 4 presets (round Chinese seal, square seal, strip, handwritten signature), corner position, size |
| Header & footer | free text for header-left, header-right and footer |

**Header/footer placeholders**: `{doc}` document name, `{sec}` current section heading, `{date}` today, `{page}` page number, `{total}` total pages. Empty means hidden.

A footer of `{doc} · {page}/{total}` prints "filename · 3/8" at the bottom of every exported page.

**Templates may only change variables, never box model.** Allowing `display/width/padding` would shift the measurement basis used for pagination, and the preview would stop matching the export — which is why those are not in the parameter list.

## Decoration

- **Binding**: none / spiral / paperclip / staple. The last two are real SVG wire and metal-ribbon shapes hooked over the top edge.
- **Corner**: none / folded / cut. "Cut" adds 16px on top of the radius slider, so the two stack.
- **Stamp**: the 4 presets are drawn in CSS (double-ring round seal, vertical square seal, strip, handwritten signature); you can also upload a **transparent PNG** and it is scaled to fit. Position (4 corners) and size are adjustable.
- **Tape / accent mark / cover motif**: small props the template brings along; just toggle them.

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

## Style packages (.zip)

"Export style package" gives you a `.zip` holding one template in full:

```
template.json   the template itself (colours, metrics, decoration, fonts)
bg.png          background image (only if used)
stamp.png       stamp image (only if a transparent PNG was uploaded)
README.txt      notes for whoever opens it next
```

Images are referenced relatively inside `template.json` (`"bgImage": "@bg.png"`), so the package can be copied to another machine or sent to someone else and still unpack to the same template.

- **Download sample package**: one click in the panel gives you `sample-ink.zip`. Edit its `template.json` (colours, `name`), re-zip, import — fastest way to author your own.
- **Legacy single-file `.lyt.json` still imports**; images are inlined as data URLs there.
- Import is fully local; nothing is uploaded.

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
