# File Marks Explorer (Workspace Storage)

> **Internal build.** This is [T0ks1k24/vscode-file-marks](https://github.com/T0ks1k24/vscode-file-marks) with [workspace-backed mark storage](https://github.com/T0ks1k24/vscode-file-marks/pull/1) added, packaged under its own extension id so it installs alongside the Marketplace version instead of being auto-updated over it. Disable **File Marks Explorer** while this one is installed, or both will decorate the same files. On first run in global mode it copies the marks from the Marketplace build, leaving those untouched.
>
> Once the upstream pull request is merged, install the Marketplace version again and drop this one; the feature is identical.

Colour your files and folders in the VS Code Explorer. Right-click → **Mark** — pick a colour, a
tag and a note. Marks are stored globally, so they follow you into every project.

[![Marketplace](https://img.shields.io/visual-studio-marketplace/v/T0ks1k24.file-marks-explorer?label=marketplace&color=1f9cf0)](https://marketplace.visualstudio.com/items?itemName=T0ks1k24.file-marks-explorer)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/T0ks1k24.file-marks-explorer?color=1f9cf0)](https://marketplace.visualstudio.com/items?itemName=T0ks1k24.file-marks-explorer)
[![Rating](https://img.shields.io/visual-studio-marketplace/stars/T0ks1k24.file-marks-explorer?color=1f9cf0)](https://marketplace.visualstudio.com/items?itemName=T0ks1k24.file-marks-explorer&ssr=false#review-details)
[![Licence](https://img.shields.io/badge/licence-MIT-blue)](LICENSE)

![Files and folders marked in the Explorer](images/view_mark_file.png)

## Why

- Find the files you actually work in, in a tree full of everything else.
- No config files in your repo, nothing committed by accident — unless you ask for it, and then a whole team can share one set of marks.
- Works on a multi-selection, on folders, and on remote / WSL / container workspaces.
- No runtime dependencies, no network access, no telemetry.

## Install

From the Extensions view (`Ctrl+Shift+X`) search for **File Marks Explorer**, or:

```
ext install T0ks1k24.file-marks-explorer
```

Also on [Open VSX](https://open-vsx.org/extension/T0ks1k24/file-marks-explorer) for VSCodium, Cursor and
Gitpod.

## Use it

Right-click a file or folder in the Explorer (or an editor tab) → **Mark**:

| | |
|---|---|
| **Quick Preset…** | colour + tag + note in one click — TODO, Important, Broken… |
| **Colour…** | 10 colours, themeable |
| **Tag / Badge…** | 1–2 characters or an emoji next to the name |
| **Description…** | note shown on hover |
| **Remove** | clear the mark |
| **List All Marks** | jump to any marked file |

Everything is also in the Command Palette under `File Marks:`.

The eight presets that ship with it — 📌 TODO, ⭐ Important, 🚧 In progress, ✅ Done, 💥 Broken,
🚫 Do not touch, ❓ Question, 🗄 Archive — are only a starting point. Replace them with your own
workflow through `fileMarks.presets`.

## Lines, not just files

Select some code, right-click the **line numbers** → **Mark Lines** → **Colour…**:

![Mark Lines in the line-number context menu](images/mark_for_line.png)

The lines get a stripe in that colour where the numbers end, and a tick in the overview ruler so you
can find them from anywhere in the file. The code itself is left alone — nothing is highlighted or
recoloured:

![Marked lines, striped beside the line numbers](images/view_mark_line.png)

| | |
|---|---|
| **Colour…** | paint the selected lines |
| **Remove Mark** | take the stripe off them |
| **Remove Every Mark in This File** | clear the file in one go |

Right-clicking a line number inside a selection marks the whole selection; right-clicking outside one
marks that single line. All three are in the Command Palette too, where they work on whatever is
selected.

Marks follow the text while you edit: everything below an insertion or a deletion moves with it, and
a mark on a line you delete goes away with the line. Edits made outside VS Code are not seen — marks
are stored by line number, not by content — so a file rewritten by another tool can end up with its
stripes a few lines off.

Clearing the mark of a *file* leaves the lines inside it alone; they are separate work. **Delete All
Marks** removes both.

## Where marks are stored

By default they are yours alone: one JSON file in your VS Code profile, nothing written into any project. That is `fileMarks.storage` left at `global`, and it is what the rest of this page describes.

Set it to `workspace` and the same marks go into the workspace instead:

```jsonc
// .vscode/settings.json
"fileMarks.storage": "workspace"
```

Marks then live in `.vscode/file-marks.json`, stored as paths relative to the workspace — `Workpapers/Cash.xlsx`, never `C:\Users\you\...` — so **everyone who opens that folder sees the same marks**, wherever they keep it. Share the folder however you already do: commit it, put it on a network drive, sync it with OneDrive, Dropbox or SharePoint. A colour someone else applies shows up in your Explorer as soon as the file reaches you; no reload, and marked lines follow too.

It is an opt-in second mode, not a better default. Worth knowing before you turn it on:

- **The file is part of your project.** It can be committed like any other file under `.vscode/`. Add `.vscode/file-marks.json` to `.gitignore` if you would rather it was not, and remember the setting itself is shareable — putting it in the workspace's own `settings.json` is how you hand the mode to a whole team.
- **Only files inside the workspace can be marked.** A file from somewhere else on disk, or an untitled editor, has no portable name inside this workspace, and its absolute path is exactly what must not end up in a file other people read. Marking one says so and writes nothing. Global mode has no such limit.
- **Only single-folder workspaces.** A multi-root workspace has no single folder to be relative to, so it keeps using global storage. So does a window with no folder open.
- **The last writer wins.** Two people marking things at the same time, on copies that have not yet synchronized, both write the whole file, and your sync client picks a winner — or leaves you a `file-marks (1).json` beside it. It is fine for ordinary use, where marks are made minutes apart and each person works in their own corner. It is not a merge, and nothing here can make a sync client merge.
- **Your global marks stay where they are.** Switching modes copies nothing in either direction, so nothing is lost by trying it. VS Code needs a window reload to pick the change up, and offers one.
- **Untrusted and virtual workspaces.** Marks are only a colour, a tag and a note; nothing in the file is executed, and every value read from it is checked, including the paths — a key that points outside the workspace is dropped. On a read-only file system the write fails and says so.

## Keybindings

One press. They act on the file open in the editor, and on the Explorer selection while the
Explorer has focus.

| | |
|---|---|
| `Ctrl+Alt+1` … `Ctrl+Alt+5` | apply preset 1–5 — colour, tag and note in one go |
| `Ctrl+Alt+0` | remove the mark |
| `Ctrl+Alt+M` | the preset picker — everything else is in there |
| `Ctrl+Alt+C` | colour… |
| `Ctrl+Alt+L` | list all marks |

Press the same shortcut again and the mark comes off, so `Ctrl+Alt+1` is a toggle.

The shortcuts are bound to key *positions* (`[Digit1]`, `[KeyM]`), not to the letters printed on
them, so they keep working on a Ukrainian, Russian, Greek or any other non-Latin layout — where a
plain `alt+m` binding does nothing at all, because no key on that layout produces an `m`.

### Bind your own

`fileMarks.apply` takes arguments, so any mark can go on a key of your own in `keybindings.json`:

```jsonc
{
  "key": "ctrl+alt+r",
  "command": "fileMarks.apply",
  "args": { "color": "red", "badge": "💥", "description": "Broken" }
}
```

| Argument | Accepts |
|---|---|
| `color` | `red`, `orange`, `yellow`, `green`, `teal`, `blue`, `purple`, `pink`, `grey`, `contrast`, any theme colour id, or `null` to clear it |
| `badge` | 1–2 characters, or `null` |
| `description` | any text, or `null` |
| `preset` | a position in `fileMarks.presets` (`1`) or its label (`"TODO"`) |
| `toggle` | `false` to keep writing the mark instead of taking it off on the second press |
| `target` | `"explorer"` marks the Explorer selection instead of the file in the editor |

With no `args` at all the key opens the preset picker.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `fileMarks.storage` | `global` | `workspace` keeps marks in `.vscode/file-marks.json` instead, to share them — see [above](#where-marks-are-stored) |
| `fileMarks.presets` | 8 presets | the ready-made marks in **Quick Preset…** — replace them with your own |
| `fileMarks.badgeSuggestions` | `[]` | the tags offered in the picker; empty keeps the built-in emoji |
| `fileMarks.propagateToParents` | `false` | colour a folder when something inside it is marked |
| `fileMarks.showTagInTooltip` | `true` | put the tag in front of the note in the hover text |
| `fileMarks.priorityOverGit` | `true` | keep mark colours in front of git status colours |
| `fileMarks.explorerKeybindings` | `true` | let the shortcuts mark the Explorer selection |
| `fileMarks.lineMarkWidth` | `3` | width in pixels of the stripe beside a marked line |

Change the colours to your own:

```jsonc
"workbench.colorCustomizations": {
  "fileMarks.red": "#ff0055"
}
```

Available ids: `fileMarks.red`, `.orange`, `.yellow`, `.green`, `.teal`, `.blue`, `.purple`,
`.pink`, `.grey`, `.white`.

## Good to know

**A tag is 1–2 characters** — one emoji counts as one, so `📌`, `🇺🇦` and `🚧✅` all fit. Longer
input is cut down to the first two: `work` becomes `wo`.

That is not our choice. VS Code gives the spot next to a file name exactly two characters and
rejects anything longer — the badge is not truncated for you, the whole decoration is thrown away
and the file loses its colour as well. Use the hover note for anything that needs words.

**Git colours.** VS Code keeps the colour of whichever extension registered last, so File Marks
re-registers itself after Git has started. If a colour still gets overridden, run
**File Marks: Give Marks Priority Over Git Colours**. On a folder containing changed files, Git
replaces the badge with a grey dot; the mark colour stays. Problem markers (errors, warnings)
always win — turn them off if marks must be unconditionally visible:

```jsonc
"git.decorations.enabled": false,
"problems.decorations.enabled": false
```

**The Explorer selection behind a keybinding.** VS Code exposes no API for what is selected in the
Explorer. The shortcuts read it through the built-in *Copy Path* command and put the clipboard back
immediately afterwards — set `fileMarks.explorerKeybindings` to `false` and they only ever mark the
file open in the editor, leaving the clipboard alone. The context menu never needs any of this.

**Renames and deletions** made inside VS Code take the mark with them, folders included: a renamed file keeps its colour, and a deleted one gives it up, so a new file created later at that path does not inherit a colour and a note from whatever used to be there. Undoing a delete brings the marks back. Changes made outside the editor are not seen — use **File Marks: Remove Marks of Missing Files** to clean up after those.

**Backup.** *Export / Import Marks* moves everything to another machine, and **File Marks: Open the Marks Storage File** opens whichever file is in use. By default that is one JSON file in the extension's global storage and nothing is written into your projects; see [Where marks are stored](#where-marks-are-stored) for the mode that puts it in the workspace instead.

## Contributing

Bugs and ideas are welcome in the [issues](https://github.com/T0ks1k24/vscode-file-marks/issues),
pull requests just as much. Plain JavaScript, no build step: clone it, `npm install`, press `F5`.
[CONTRIBUTING.md](CONTRIBUTING.md) has the rest — where things live, what the code expects of
itself, and how a release is cut.

## Licence

MIT © T0ks1k24 · [Source](https://github.com/T0ks1k24/vscode-file-marks) ·
[Changelog](CHANGELOG.md)
