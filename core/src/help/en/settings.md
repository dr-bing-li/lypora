# Settings explained

Everything under *Settings* affects **this machine only**. None of it is written into the document.

## Display mode

How multiple documents are presented:

| Option | Behaviour |
| --- | --- |
| Tabs only | Opening a file adds a tab; no "New window" item |
| Windows only | Opening a file creates a new window; the tab bar hides (existing tabs are kept, not destroyed) |
| Both | Default. Tabs, plus manually created windows |

Browsers and the mobile shell cannot create real system windows, so *Windows only* and *Both* are greyed out there. Greyed out is better than hidden — you can at least see why it is unavailable.

## Language

- **Follow system**: picks the OS language, falling back to English.
- Seven languages: 简体中文, English, 日本語, 한국어, Español, Français, Deutsch.
- Each language is listed in its own script (`Français`, not "French"); otherwise switching to a language you cannot read would be a one-way trip.
- Switching does not rebuild the editor: document, undo history and caret stay put. Only UI strings and help text change.

## Image reference

| Setting | Values | Notes |
| --- | --- | --- |
| Reference mode | File reference / Embedded Base64 | Base64 disables the path strategy entirely |
| Path strategy | Copy to assets / Relative / Absolute | See "Image references" |

## Preferences that live elsewhere

These are also stored locally, but their controls sit where they belong:

- **Theme**: the *Theme* menu.
- **Text size**: `Ctrl+wheel`, or *View → Larger / Smaller*.
- **Page width**: *View → Page width*, or drag the right-edge grip.
- **Layout parameters**: inside the layout panel; saved with the template.

## Resetting

There is no "reset everything" button; change items back one by one. If you must clear manually: DevTools → Application → Local Storage, delete keys starting with `lypora:`. That also clears custom themes and stored preferences — your `.md` files are untouched.
