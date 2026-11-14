# Layout output

*Layout* (`Ctrl+Shift+P`, or the "Layout" menu) turns the current document into shareable cards: long images for social platforms, or an A4 print sheet.

## The panel

It takes over the whole editor area (the menu bar stays). Three columns, left to right:

1. **Preview** — produced by the very same pipeline as the export, not a separately drawn mock-up.
2. **Template gallery** — 33 built-in templates plus your own, as three-column landscape cards whose thumbnails are real layouts.
3. **Parameters** — 46 controls for colours, type, spacing and decoration, in 12 groups (heading levels and stickers expand on demand).

`Esc` or the close button returns to editing. Parameter changes re-paginate automatically (~160ms debounce), so dragging a slider stays smooth.

## Templates

- **33 built-ins**, each named with four characters, covering minimal, newspaper/magazine, journal/collage, neon and film looks.
- Gallery thumbnails are **that template actually laying out a card** — not colour swatches, not cached screenshots — so names, fonts, quote frames and stamps all change with the language and the parameters.
- **Save as my template**: the current parameter set plus a name, up to 40 entries.
- **Export / import style package**: see "Style packages" below.
- Importing a template whose id already exists appends a suffix; built-ins are never overwritten.

## Parameters (46 items)

| Group | Items |
| --- | --- |
| Colour | paper, ink, muted, accent, code background, quote background, quote rule |
| Metrics | body size, line height, title size, side padding, corner radius |
| Toggles | header rule, page numbers |
| Background | 7 paper presets (kraft / ruled / grid / dots / watercolour / xuan paper / mesh glow) + your own image + opacity |
| Texture & decoration | 9 textures (grain / grid / dots / ruled / fibre / halo / stripe / sprockets / lattice), accent mark (left / top / corner), corner treatment (fold / round cut), 5 outer frames, tape, binding |
| Typography | 6 quote styles, 7 bullet styles, 5 title marks, 5 outer frames |
| Stamp | on/off, 4 presets (round Chinese seal, square seal, strip, handwritten signature), corner position, size |
| Header & footer | free text for header-left, header-right and footer |
| Band & panel | band width, panel fill (may be empty), border, radius, shadow kind, inner padding |
| Rules | solid / dashed / stripe / tape / fade / dotted / none, with height, two colours and angle |
| Table, code, image | 3 states each (flat / boxed / pop; plain / framed / taped) |
| List numbers | plain / circle badge / square badge |
| Heading levels | one set per h1–h4 (18 items each): fill (may be a gradient), text colour, padding, radius and **alternate radius**, rotation, shadow and **block shadow**, **weight**, **tracking**, **leading mark** (bar / diamond) and its colour, underline (none / solid / stripe / fade / bar), caps, italic, alignment, inline shrink |
| Top bar | height, start colour, end colour — two different colours make it a gradient; height 0 draws nothing |
| Stickers | shape, corner, size, rotation, fill, stroke, text, bleed — up to 6 |
| Colour variants | only for templates that ship them (Pop Print: pink-blue / mint / night) |

**Header/footer placeholders**: `{doc}` document name, `{sec}` current section heading, `{date}` today, `{page}` page number, `{total}` total pages. Empty means hidden.

A footer of `{doc} · {page}/{total}` prints "filename · 3/8" at the bottom of every exported page.

**Templates may only change variables, never box model.** Allowing `display/width/padding` would shift the measurement basis used for pagination, and the preview would stop matching the export — which is why those are not in the parameter list.

## Decoration

- **Binding**: none / spiral / paperclip / staple. The last two are real SVG wire and metal-ribbon shapes hooked over the top edge.
- **Corner**: none / folded / cut. "Cut" adds 16px on top of the radius slider, so the two stack.
- **Stamp**: the 4 presets are drawn in CSS (double-ring round seal, vertical square seal, strip, handwritten signature); you can also upload a **transparent PNG** and it is scaled to fit. Position (4 corners) and size are adjustable.
- **Tape / accent mark / cover motif**: small props the template brings along; just toggle them.

## The art layer (0.13.0)

Templates like *Pop Print* are not about new colours — they are six structural layers. The panel exposes them as four groups:

- **Band** — the coloured rim around the card. It is not a `border`; it is `.ly-card` padding over the paper colour, so widening it shrinks the inner panel rather than adding a line.
- **Inner panel** — the white card: fill, border, radius, padding and **shadow kind** (none / hard sticker shadow / soft). The hard variant is `10px 10px 0` with zero blur — that zero blur *is* the sticker look; any blur turns it into an ordinary drop shadow.
- **Heading levels** — separate settings for h1–h4: colour block, striped underline, inline shrink (block only as wide as its text), rotation up to ±3°, text shadow. Everything defaults to "draw nothing", which is why the 29 older templates look identical.
- **Rules** — `---` becomes a thin line, dashed line, 45° stripe or tape; stripes take two colours and an angle.
- **Stickers** — up to 6, shaped as five-point star, four-point star, burst, badge or blob, anchored to a corner. *Bleed* controls how far it hangs over the edge. For badges the stroke colour doubles as the text colour (the `POP!` badge).
- **Colour variants** — swap the whole palette (paper / pattern ink / accent) in one click. A variant **writes those colours into the current template**; use *Reset* to get the built-in palette back.

All of it still compiles to CSS variables and `data-*` attributes only. No template can inject arbitrary CSS, so a style package cannot restyle the app or smuggle in scripts.

## The style layer (0.14.0)

0.14.0 makes "a heading is not just text, it is a shape" expressible as data. Four new templates each show one way:

- **Amber Capsule** (`pillorange`) — h2 is a gradient capsule: radius 30, soft shadow, centred and shrunk to its text, with a thin orange gradient bar across the top of the card.
- **Cyan Flow** (`cyanflow`) — h2 is a blue-to-cyan block with **asymmetric corners**: 8px on one side, 24px on the opposite one.
- **Art Deco** (`deco`) — near-black paper under a full-page diamond lattice, gold top bar, upper-case letter-spaced h1 and a gold diamond before h2.
- **Cream Typewriter** (`typograph`) — cream paper over a slightly brighter inner card, dotted rules, centred light headings.

The new parameters behind them:

- **Alternate radius** — alternates with *radius* (corners 1 and 3 use radius, corners 2 and 4 use this one). Zero means all four corners match.
- **Block shadow** — shadow on a heading block: none / soft (`0 4px 12px`) / glow (`0 0 18px`, tinted with the accent colour).
- **Weight / tracking** — "inherit" for weight means *unset* and falls through to the skeleton; tracking is in px and may be negative.
- **Leading mark** — a bar or a diamond in front of the block or heading, with its own colour.
- **Top bar** — a full-width band along the top edge; different start and end colours make it a gradient.

All of it still compiles to CSS variables and `data-*` attributes only — not a single line of template CSS.

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
