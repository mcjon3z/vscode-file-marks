'use strict';

const vscode = require('vscode');
const path = require('path');

const { sanitizeTag, sanitizeDescription } = require('./badge');
const {
  COLOR_ID,
  MAX_LINE,
  MAX_KEY_LENGTH,
  MODE_GLOBAL,
  STORAGE_FILE,
  LEGACY_STORAGE_DIRS,
} = require('./constants');

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Line marks are shifted on every keystroke that changes the line count, and
 * writing the file that often would be silly. Long enough to coalesce typing,
 * short enough that a crash cannot cost more than the last moment of it.
 */
const SAVE_DELAY = 800;

/**
 * How long the marks of a deleted item are kept aside so that undoing the
 * delete can put them back. The Explorer's undo arrives as an ordinary create
 * with nothing to say it was an undo, so the age of the delete is the only
 * thing telling the two apart — and past this, a file appearing where a marked
 * one used to be is a new file that should not inherit the old colour.
 */
const UNDO_WINDOW = 30000;

/** @param {string} text */
function countNewlines(text) {
  let count = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) count++;
  return count;
}

/** Keys that would walk the prototype chain instead of being stored as data. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/**
 * @typedef {object} LineMark
 * @property {string} color theme colour id of the stripe drawn beside the line
 */

/**
 * @typedef {object} Mark
 * @property {string} [color]       theme colour id
 * @property {string} [tag]         one or two characters, drawn next to the name
 * @property {string} [description] hover text
 * @property {Record<string, LineMark>} [lines] marked lines, keyed by 1-based number
 */

/**
 * Line marks live under the file they belong to, keyed by line number as a
 * string because that is what JSON gives back. A line outside the range any
 * real file can have is junk, and so is a key that is not a plain integer.
 *
 * @param {unknown} raw
 * @returns {Record<string, LineMark> | undefined}
 */
function normalizeLines(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;

  /** @type {Record<string, LineMark>} */
  const lines = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!/^[1-9][0-9]*$/.test(key) || Number(key) > MAX_LINE) continue;
    if (!value || typeof value !== 'object') continue;
    if (typeof value.color !== 'string' || !COLOR_ID.test(value.color)) continue;
    lines[key] = { color: value.color };
  }
  return Object.keys(lines).length > 0 ? lines : undefined;
}

/** Numerically, so the file stays readable and diffs stay small. */
function serializeLines(lines) {
  /** @type {Record<string, LineMark>} */
  const out = {};
  for (const key of Object.keys(lines).sort((a, b) => Number(a) - Number(b))) {
    out[key] = { color: lines[key].color };
  }
  return out;
}

/**
 * Turns whatever is in the JSON file into a mark we can trust — the file is
 * user editable and can also arrive through Import, so nothing in it is taken
 * at face value. Sanitising happens here, once, and never on the hot path
 * where the Explorer asks for a decoration.
 *
 * @param {unknown} raw
 * @returns {Mark | undefined}
 */
function normalizeMark(raw) {
  if (!raw || typeof raw !== 'object') return undefined;

  /** @type {Mark} */
  const mark = {};
  if (typeof raw.color === 'string' && COLOR_ID.test(raw.color)) mark.color = raw.color;

  const tag = sanitizeTag(raw.tag);
  if (tag) mark.tag = tag;

  const description = sanitizeDescription(raw.description);
  if (description) mark.description = description;

  const lines = normalizeLines(raw.lines);
  if (lines) mark.lines = lines;

  return Object.keys(mark).length > 0 ? mark : undefined;
}

/** The fields that go to disk, in a fixed order and nothing else. */
function serializeMark(mark) {
  const out = {};
  if (mark.color) out.color = mark.color;
  if (mark.tag) out.tag = mark.tag;
  if (mark.description) out.description = mark.description;
  if (mark.lines) out.lines = serializeLines(mark.lines);
  return out;
}

/**
 * Marks live in one JSON file. Where that file is, and how a resource becomes a
 * key in it, is the storage target — global storage outside every project by
 * default, or a file inside the workspace when `fileMarks.storage` says so.
 * Nothing else on disk is touched either way.
 */
class MarkStore {
  /** @param {import('./storage').Target} target */
  constructor(target) {
    this.mode = target.mode;
    this.dir = target.dir;
    this.file = target.file;
    this._codec = target.codec;

    /** @type {Map<string, Mark>} */
    this.marks = new Map();

    this._emitter = new vscode.EventEmitter();
    /** Fires with the affected uris, or undefined when everything changed. */
    this.onChanged = this._emitter.event;

    /** Serialised form of the last write, so the watcher can ignore our own I/O. */
    this._lastWritten = '';
    /** Writes are chained — concurrent commands can never interleave. */
    this._writes = Promise.resolve();
    /** @type {ReturnType<typeof setTimeout> | undefined} */
    this._saveTimer = undefined;

    /**
     * Marks of recently deleted items, kept for `UNDO_WINDOW`.
     * @type {Map<string, { mark: Mark, at: number }>}
     */
    this._deleted = new Map();
  }

  dispose() {
    if (this._saveTimer !== undefined) {
      clearTimeout(this._saveTimer);
      // Whatever the debounce was still holding goes to disk now.
      void this.save();
    }
    this._emitter.dispose();
  }

  /**
   * The key of a resource, or undefined when the active storage cannot hold it —
   * in workspace mode, anything outside the workspace folder.
   *
   * @param {vscode.Uri} uri
   */
  key(uri) {
    return this._codec.key(uri);
  }

  /**
   * The resource a stored key names, or undefined when it cannot be resolved.
   * A key that does not resolve is not necessarily stale, so callers skip it
   * rather than treating the item as missing.
   *
   * @param {string} key
   */
  uri(key) {
    return this._codec.uri(key);
  }

  /**
   * The resources a command was invoked on, split into the ones this storage
   * can hold and the ones it cannot.
   *
   * @param {readonly vscode.Uri[]} uris
   */
  _split(uris) {
    /** @type {string[]} */
    const keys = [];
    /** @type {vscode.Uri[]} */
    const outside = [];
    for (const uri of uris) {
      const key = this.key(uri);
      if (key === undefined) outside.push(uri);
      else keys.push(key);
    }
    return { keys, outside };
  }

  /**
   * Says why nothing happened. Only ever called from a command the user just
   * ran — never from the document-change path, which would talk on every
   * keystroke in an untitled file.
   *
   * @param {readonly vscode.Uri[]} outside
   */
  _warnOutside(outside) {
    if (outside.length === 0) return;
    const first = path.posix.basename(outside[0].path) || outside[0].toString();
    const what = outside.length === 1 ? first : `${first} and ${outside.length - 1} more`;
    vscode.window.showWarningMessage(
      `File Marks: ${what} cannot be marked — workspace storage only covers files inside the workspace.`
    );
  }

  /** @param {vscode.Uri} uri */
  get(uri) {
    const key = this.key(uri);
    return key === undefined ? undefined : this.marks.get(key);
  }

  entries() {
    return [...this.marks.entries()];
  }

  get size() {
    return this.marks.size;
  }

  /**
   * A null-prototype object: a mark could otherwise be keyed `__proto__` and
   * silently set the prototype instead of becoming a property.
   */
  toPlainObject() {
    /** @type {Record<string, object>} */
    const out = Object.create(null);
    for (const [key, mark] of this.marks) out[key] = serializeMark(mark);
    return out;
  }

  /** @param {unknown} plain */
  _adopt(plain) {
    const next = new Map();
    if (plain && typeof plain === 'object' && !Array.isArray(plain)) {
      for (const [key, raw] of Object.entries(plain)) {
        if (!key || key.length > MAX_KEY_LENGTH || FORBIDDEN_KEYS.has(key)) continue;
        // A key the active storage will not resolve is dropped rather than kept
        // around unusable: in workspace mode that is what keeps an absolute path
        // or a `../` escape out of a file several people can edit.
        if (!this._codec.accepts(key)) continue;
        const mark = normalizeMark(raw);
        if (mark) next.set(key, mark);
      }
    }
    this.marks = next;
  }

  async _readText() {
    const bytes = await vscode.workspace.fs.readFile(this.file);
    return decoder.decode(bytes);
  }

  /** Reads the storage file. A missing or broken file simply means "no marks". */
  async load() {
    try {
      const text = await this._readText();
      this._lastWritten = text;
      this._adopt(JSON.parse(text));
    } catch (err) {
      this._adopt(undefined);
    }
  }

  /**
   * Watcher callback. Returns true when the file really changed underneath us —
   * another VS Code window, or another person's copy of a shared workspace —
   * false for our own writes. The change is announced here rather than by the
   * caller, so both the Explorer decorations and the line stripes follow it.
   */
  async reloadIfChanged() {
    let text;
    try {
      text = await this._readText();
    } catch (err) {
      return false;
    }
    if (text === this._lastWritten) return false;

    this._lastWritten = text;
    try {
      this._adopt(JSON.parse(text));
    } catch (err) {
      return false;
    }
    this._emitter.fire(undefined);
    return true;
  }

  /**
   * Delete callback. The storage file going away means the marks went with it —
   * a branch that does not have the file, a sync removing it, someone deleting
   * it by hand. Keeping them would show colours for a file that no longer says
   * so, and write the whole lot back on the next save.
   *
   * The delete is confirmed against the file system first. An atomic replace —
   * write a temporary file, rename it over this one — also arrives as a delete,
   * and throwing everything away because of one would be far worse than a
   * moment of stale colour. `_lastWritten` is cleared too, so a file that comes
   * back with exactly its old contents is still seen as a change.
   *
   * @returns {Promise<boolean>} true when marks were dropped
   */
  async clearIfDeleted() {
    try {
      await vscode.workspace.fs.stat(this.file);
      return false;
    } catch (err) {
      // Really gone.
    }

    this._lastWritten = '';
    if (this.marks.size === 0) return false;

    this._adopt(undefined);
    this._emitter.fire(undefined);
    return true;
  }

  /**
   * Picks up marks written by an older build that used a different publisher
   * id (the global storage folder is named `<publisher>.<name>`).
   * Runs only when we have nothing of our own.
   */
  async migrateLegacyStorage() {
    // Global storage only: the probe below walks out of `this.dir`, which in
    // workspace mode would mean rummaging around next to someone's project.
    if (this.mode !== MODE_GLOBAL) return 0;
    if (this.marks.size > 0) return 0;

    for (const folder of LEGACY_STORAGE_DIRS) {
      const legacy = vscode.Uri.joinPath(this.dir, '..', folder, STORAGE_FILE);
      if (legacy.fsPath === this.file.fsPath) continue;
      try {
        const bytes = await vscode.workspace.fs.readFile(legacy);
        const parsed = JSON.parse(decoder.decode(bytes));
        this._adopt(parsed);
        if (this.marks.size === 0) continue;
        await this.save();
        return this.marks.size;
      } catch (err) {
        // no such folder / unreadable — nothing to migrate
      }
    }
    return 0;
  }

  /** Debounced `save`, for changes that arrive while someone is typing. */
  saveSoon() {
    if (this._saveTimer !== undefined) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      this._saveTimer = undefined;
      void this.save();
    }, SAVE_DELAY);
  }

  save() {
    this._writes = this._writes.then(
      () => this._write(),
      () => this._write()
    );
    return this._writes;
  }

  async _write() {
    const text = JSON.stringify(this.toPlainObject(), null, 2);
    try {
      await vscode.workspace.fs.createDirectory(this.dir);
      await vscode.workspace.fs.writeFile(this.file, encoder.encode(text));
      this._lastWritten = text;
    } catch (err) {
      vscode.window.showErrorMessage(`File Marks: could not save marks — ${err.message}`);
    }
  }

  /**
   * @param {readonly vscode.Uri[]} uris
   * @param {{ color?: string | null, tag?: string | null, description?: string | null }} patch
   *        `null` (or an empty string) removes the field.
   */
  async update(uris, patch) {
    const { keys, outside } = this._split(uris);
    this._warnOutside(outside);
    if (keys.length === 0) return;

    for (const key of keys) {
      const raw = Object.assign({}, serializeMark(this.marks.get(key) || {}));

      for (const [field, value] of Object.entries(patch)) {
        if (value === null || value === undefined || value === '') delete raw[field];
        else raw[field] = value;
      }

      const mark = normalizeMark(raw);
      if (mark) this.marks.set(key, mark);
      else this.marks.delete(key);
    }
    await this.save();
    this._emitter.fire(uris);
  }

  /**
   * Clears the colour, tag and note of the file itself. Marked lines inside it
   * are left alone — they are separate work, and losing them to a click aimed at
   * the file name would be a nasty surprise. `setLines` and **Delete All Marks**
   * are what remove those.
   *
   * @param {readonly vscode.Uri[]} uris
   */
  async remove(uris) {
    const { keys, outside } = this._split(uris);
    this._warnOutside(outside);

    let touched = false;
    for (const key of keys) {
      const mark = this.marks.get(key);
      if (!mark || (!mark.color && !mark.tag && !mark.description)) continue;

      if (mark.lines) this.marks.set(key, { lines: mark.lines });
      else this.marks.delete(key);
      touched = true;
    }
    if (!touched) return;
    await this.save();
    this._emitter.fire(uris);
  }

  /**
   * @param {vscode.Uri} uri
   * @returns {Record<string, import('./markStore').LineMark> | undefined}
   */
  getLines(uri) {
    const key = this.key(uri);
    const mark = key === undefined ? undefined : this.marks.get(key);
    return mark && mark.lines;
  }

  /** Replaces the lines of one file, or drops them when nothing is left. */
  _setLines(key, mark, lines) {
    const next = Object.assign({}, mark);
    if (Object.keys(lines).length > 0) next.lines = lines;
    else delete next.lines;

    const normalized = normalizeMark(next);
    if (normalized) this.marks.set(key, normalized);
    else this.marks.delete(key);
  }

  /**
   * Paints or clears whole lines of one file.
   *
   * @param {vscode.Uri} uri
   * @param {readonly number[]} lineNumbers 1-based
   * @param {string | null} color `null` takes the mark off those lines
   */
  async setLines(uri, lineNumbers, color) {
    const key = this.key(uri);
    if (key === undefined) {
      this._warnOutside([uri]);
      return;
    }
    const mark = this.marks.get(key) || {};
    const lines = Object.assign({}, mark.lines);

    let touched = false;
    for (const line of lineNumbers) {
      if (!Number.isInteger(line) || line < 1 || line > MAX_LINE) continue;
      const at = String(line);

      if (color === null) {
        if (at in lines) {
          delete lines[at];
          touched = true;
        }
      } else {
        if (!lines[at] || lines[at].color !== color) touched = true;
        lines[at] = { color };
      }
    }
    if (!touched) return;

    this._setLines(key, mark, lines);
    await this.save();
    this._emitter.fire([uri]);
  }

  /**
   * Keeps line marks attached to the text they were put on while the file is
   * edited: everything below an edit moves by the lines it added or removed, and
   * a mark on a line that was replaced away goes with it.
   *
   * Called for every document change, so it does nothing at all — and touches no
   * disk — for a file without line marks. Saving is left to the caller, which
   * debounces it.
   *
   * @param {vscode.Uri} uri
   * @param {readonly vscode.TextDocumentContentChangeEvent[]} changes
   * @returns {boolean} true when a mark moved or was lost
   */
  shiftLines(uri, changes) {
    const key = this.key(uri);
    if (key === undefined) return false;
    const mark = this.marks.get(key);
    if (!mark || !mark.lines) return false;

    let lines = mark.lines;
    let touched = false;

    for (const change of changes) {
      const from = change.range.start.line + 1;
      const to = change.range.end.line + 1;
      const removed = to - from;
      const added = countNewlines(change.text);
      if (removed === 0 && added === 0) continue;

      /** @type {Record<string, import('./markStore').LineMark>} */
      const next = {};
      for (const [at, value] of Object.entries(lines)) {
        const line = Number(at);
        // The first line of the edit survives it: what was replaced starts
        // inside it, and whatever is typed ends up on it.
        if (line <= from) {
          next[at] = value;
        } else if (line <= to) {
          touched = true;
        } else {
          next[String(line + added - removed)] = value;
          touched = true;
        }
      }
      lines = next;
    }

    if (!touched) return false;
    this._setLines(key, mark, lines);
    return true;
  }

  /** @param {readonly string[]} keys */
  async removeKeys(keys) {
    let touched = false;
    for (const key of keys) touched = this.marks.delete(key) || touched;
    if (!touched) return;
    await this.save();
    this._emitter.fire(undefined);
  }

  /** @param {unknown} plain */
  async replaceAll(plain) {
    this._adopt(plain);
    await this.save();
    this._emitter.fire(undefined);
  }

  /** Everything stored beneath an item, since only the folder itself is named. */
  _childPrefix(uri, key) {
    return key + this._codec.childSeparator(uri);
  }

  /**
   * Moves the mark of an item, and of everything inside it, to another key — or
   * takes them away when there is nowhere to move them to.
   *
   * @param {vscode.Uri} uri
   * @param {string | undefined} to `undefined` removes them
   * @param {Map<string, Mark>} [removed] collects what was taken away
   */
  _moveSubtree(uri, to, removed) {
    const from = this.key(uri);
    if (from === undefined || from === to) return false;

    const prefix = this._childPrefix(uri, from);
    let touched = false;

    for (const [key, mark] of [...this.marks]) {
      const rest = key === from ? '' : key.startsWith(prefix) ? key.slice(from.length) : undefined;
      if (rest === undefined) continue;

      this.marks.delete(key);
      if (to !== undefined) this.marks.set(to + rest, mark);
      else if (removed) removed.set(key, mark);
      touched = true;
    }
    return touched;
  }

  /**
   * Follows a rename or move, including every mark inside a renamed folder.
   * @param {vscode.Uri} oldUri
   * @param {vscode.Uri} newUri
   */
  renameInMemory(oldUri, newUri) {
    // An undefined destination means the item left this storage altogether —
    // moved out of the workspace in workspace mode. Its marks go with it:
    // leaving them behind would paint whatever turns up at the old path next.
    return this._moveSubtree(oldUri, this.key(newUri));
  }

  /**
   * Follows a delete: the marks of the item and of everything inside it go with
   * it, so a file later created at the same path starts clean instead of
   * inheriting a colour and a note from whatever used to be there.
   *
   * Only deletes made through VS Code are seen. One made outside the editor
   * still leaves its mark behind — **Remove Marks of Missing Files** is what
   * clears those.
   *
   * @param {readonly vscode.Uri[]} uris
   */
  deleteInMemory(uris) {
    const now = Date.now();
    for (const [key, entry] of this._deleted) {
      if (now - entry.at > UNDO_WINDOW) this._deleted.delete(key);
    }

    let touched = false;
    for (const uri of uris) {
      /** @type {Map<string, Mark>} */
      const removed = new Map();
      if (!this._moveSubtree(uri, undefined, removed)) continue;

      for (const [key, mark] of removed) this._deleted.set(key, { mark, at: now });
      touched = true;
    }
    return touched;
  }

  /**
   * Puts the marks back when a delete is undone. The Explorer's undo is an
   * ordinary create as far as we are told, so a create is only treated as one
   * while the delete it would undo is still recent.
   *
   * @param {readonly vscode.Uri[]} uris
   */
  restoreDeleted(uris) {
    if (this._deleted.size === 0) return false;

    const now = Date.now();
    let touched = false;

    for (const uri of uris) {
      const key = this.key(uri);
      if (key === undefined) continue;
      const prefix = this._childPrefix(uri, key);

      // A restored folder is announced as one create, so its contents come back
      // with it.
      for (const [at, entry] of [...this._deleted]) {
        if (at !== key && !at.startsWith(prefix)) continue;

        this._deleted.delete(at);
        if (now - entry.at > UNDO_WINDOW) continue;
        this.marks.set(at, entry.mark);
        touched = true;
      }
    }
    return touched;
  }

  /** Saves and redraws after a rename, a delete or an undone delete. */
  async commit(touched) {
    if (!touched) return;
    await this.save();
    this._emitter.fire(undefined);
  }
}

module.exports = { MarkStore };
