# Adjusting page width

There is exactly one source of truth for body width: the CSS variable `--content-width`. Every control below only changes that value, so the menu checkmark, dragging and scripts can never disagree.

## Three ways to change it

**1. Menu: View → Page width**

| Preset | Width |
| --- | --- |
| Narrow | 620px |
| Standard | 860px |
| Wide | 1080px |
| Full | follows the window |

**2. Drag the right edge**

A thin grip sits at the right edge of the body. Drag it for a continuous adjustment; the current pixel value appears in a badge while dragging.

- Double-click the grip to return to 860px.
- Range is 520–1600px; anything outside is clamped.

**3. Set the CSS variable**

Automation and screenshot scripts can write `--content-width` on the root element directly.

## Three widths that are easy to confuse

| Name | What it affects |
| --- | --- |
| Page width | Body column width; stored locally per machine |
| Text size | `--content-font-size`; `Ctrl+wheel`, `Ctrl+Shift+=`, `Ctrl+-` |
| Card size | Export canvas (e.g. 9:16, A4), unrelated to on-screen width |

Changing the on-screen width **does not** change the export: card output re-measures and re-paginates against the template's own size.

## Narrow screens and mobile

- Below 860px the sidebar collapses, the tab bar hides, and the body follows the viewport instead of `--content-width`.
- On phones the side margins tighten and the drag grip is hidden — horizontal dragging would fight with scrolling.
