# Changelog

All notable changes to File Marks are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- **`fileMarks.storage`.** Left at `global` nothing changes: marks stay in your VS Code profile, keyed by absolute path, and no project is written into. Set to `workspace` and they go to `.vscode/file-marks.json` inside the workspace instead, keyed relative to it, so everyone who opens that folder — shared through git, a network drive or a sync client such as OneDrive — sees the same marks, wherever they keep it. Colours, tags, notes and marked lines all follow the setting, and a change made by someone else shows up as soon as the file reaches you.
- Workspace storage refuses anything it cannot name portably: a file outside the workspace, or an untitled editor, is reported rather than stored as an absolute path in a file other people read. A key in the storage file that points outside the workspace is dropped when it is loaded.

### Fixed
- Deleting a marked file or folder in VS Code now takes its mark with it. The mark used to stay behind, so a file created later at the same path inherited a colour, a tag and a note from whatever used to be there — folders that come round again under the same name, like a per-year or per-client directory, picked up the previous one's state. Marks inside a deleted folder go too, and undoing the delete puts them all back.

Deletions made outside the editor are still not seen; **Remove Marks of Missing Files** remains the way to clear those.

### Changed
- A storage file changed outside the editor now refreshes the marked lines as well as the Explorer, instead of only the Explorer.

## [1.2.0]

### Added
- **Marked lines.** Select code, right-click the line numbers → **Mark Lines** → **Colour…**, and
  those lines get a stripe in that colour beside the numbers plus a tick in the overview ruler. The
  code is not highlighted or recoloured — only the margin is.
- Marks follow the text as the file is edited: everything below an insertion or deletion moves with
  it, and a mark on a deleted line goes with the line.
- Marked lines show up in **List All Marks** as `file.js:42` and open the file on that line.
- `fileMarks.lineMarkWidth` (`3`) sets how thick the stripe is.

### Changed
- Removing the mark of a file now keeps the marked lines inside it — losing them to a click aimed at
  the file name was too easy. **Delete All Marks** still removes everything.

## [1.1.0]

### Added
- **Keybindings.** `Ctrl+Alt+1` … `Ctrl+Alt+5` apply the first five presets, `Ctrl+Alt+0` removes the
  mark, `Ctrl+Alt+M` opens the preset picker, `Ctrl+Alt+C` the colours and `Ctrl+Alt+L` the list of
  marks. They work on the file open in the editor and on the Explorer selection.
- The shortcuts are bound to key positions (`[Digit1]`, `[KeyM]`) rather than to letters, so they
  also work on layouts that have no Latin letters — a `alt+m` binding cannot even be resolved while
  a Ukrainian or Russian layout is active.
- **`fileMarks.apply`** takes arguments, so any mark fits on a key of your own — `color` (short name,
  theme colour id or `null`), `badge`, `description`, `preset` (position or label), `toggle` and
  `target`. Combine them freely; leave `args` out and the key opens the picker.
- Pressing a shortcut a second time takes the mark back off. `"toggle": false` in the arguments
  keeps it on.
- `fileMarks.explorerKeybindings` (`true`) decides whether the shortcuts may act on the Explorer
  selection. VS Code exposes no API for it, so it is read through the built-in *Copy Path* command
  with the clipboard restored right after; turning the setting off keeps the shortcuts to the editor
  and never touches the clipboard.

## [1.0.1]

### Fixed
- The repository, issues and homepage links pointed at a GitHub account that does not exist, which
  also left the screenshot in this page broken.

## [1.0.0]

First release.

- Mark any file or folder in the Explorer with a **colour**, a **tag** and a **hover note**, from
  the context menu, an editor tab or the Command Palette. Multi-selection is supported.
- **Quick Preset…** applies colour, tag and note in one click. The eight presets that ship with the
  extension can be replaced through `fileMarks.presets`.
- A tag is 1-2 characters, counted the way the editor counts them, so a multi-code-point emoji such
  as `🇺🇦` or `🗄️` is one character and `🚧✅` fits. Longer input is cut to the first two. Two is a
  hard limit of the VS Code decoration API: it rejects a longer badge and drops the colour with it.
- 10 themeable colours, overridable through `workbench.colorCustomizations`.
- Marks live in one JSON file in the extension's global storage, so they follow you into every
  project. Nothing is written into your workspaces.
- Several VS Code windows stay in sync — the storage file is watched, and the extension recognises
  its own writes by content.
- Renames and moves made inside VS Code carry their marks along, including everything inside a
  renamed folder.
- Mark colours stay in front of git decorations; `fileMarks.priorityOverGit` turns that off.
- **Export / Import**, **List All Marks**, **Remove Marks of Missing Files**, **Delete All Marks**
  and **Open the Marks Storage File**.
- Works in untrusted and virtual workspaces. No runtime dependencies, no network access.
