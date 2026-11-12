# Image references

Two independent strategies, both under *Settings*. Together they cover six behaviours.

## 1. Reference mode (what gets written into the Markdown)

| Option | Written into the document | Use when |
| --- | --- | --- |
| **File reference** (default) | `![](assets/photo.png)` | You want images alongside the file, e.g. in a repo or a synced folder |
| **Embedded Base64** | `![](data:image/png;base64,iVBOR…)` | Single-file delivery with no attachments folder |

With Base64, the path strategy is irrelevant (there is no path), so those menu items are greyed out.

## 2. Path strategy (file-reference mode only)

| Option | Path written | Notes |
| --- | --- | --- |
| **Copy to assets folder** (default) | `assets/photo.png` | Copies the image next to the document |
| **Relative path** | `../images/photo.png` | References the image where it already is |
| **Absolute path** | `/home/me/pics/photo.png` | Fixed location on this machine |

The assets folder is chosen in this order: a folder already referenced in the document → `assets` → `images` → `img` → otherwise `assets` is created. Name collisions get a timestamp prefix (`20261112-101530-photo.png`); existing images are never overwritten.

## Three ways to insert

1. *Format → Insert image* (`Ctrl+Shift+I`), or the image button in the mobile toolbar.
2. Drag and drop image files onto the editor.
3. Paste directly with `Ctrl+V` (screenshots, images from web pages).

All three share one pipeline, so all three honour the path mode. Pasting is special: a bitmap on the clipboard has **no path on disk**, so it is first written to a temporary PNG. That temp file is deliberately kept — in relative/absolute modes the document references it, and deleting it would break the image.

## Path pitfalls

- Relative paths resolve against the **document's folder**, not the application directory. Saving or Save-As re-bases them immediately.
- On desktop, a dropped file's real path comes from Electron's `webUtils` (`File.path` was removed); if it cannot be resolved, the image falls back to embedded Base64.
- On Android the base directory is `Documents/Lypora`; exported documents and images live under that tree.

## Recommendations

- Notes and repos: **file reference + copy to assets**.
- Sending a single article with images: **Base64**, or export to PDF / long image via *Layout*.
- Many images, size-sensitive: **file reference + relative path**, manage the folder yourself.
