'use strict';

const vscode = require('vscode');

const { MarkStore } = require('./markStore');
const { MarkDecorationProvider } = require('./decorationProvider');
const { LineDecorations } = require('./lineDecorations');
const { DecorationPriority } = require('./decorationPriority');
const { registerCommands } = require('./commands');
const { resolveTarget } = require('./storage');

/** Milliseconds to let the Git extension finish its initial repository scan. */
const GIT_SETTLE_DELAY = 1500;

/**
 * Keeps marks in step with whoever else is writing the storage file — another
 * VS Code window, or another person's copy of a shared workspace. Our own
 * writes are recognised by content and ignored, and the store announces a real
 * change itself, so both the Explorer and the line stripes follow it.
 *
 * @param {vscode.ExtensionContext} context
 * @param {MarkStore} store
 * @param {import('./storage').Target} target
 */
async function watchStorage(context, store, target) {
  try {
    // Global storage is a folder of ours and may not exist yet. The workspace
    // file is watched through the folder that holds it, which is already being
    // watched recursively, so nothing has to be created to see it appear.
    if (target.createDir) await vscode.workspace.fs.createDirectory(target.dir);

    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(target.watchBase, target.watchPattern)
    );
    const reload = () => void store.reloadIfChanged();

    context.subscriptions.push(
      watcher,
      watcher.onDidChange(reload),
      watcher.onDidCreate(reload),
      // A delete is not a change to read — there is nothing to read — so it has
      // its own handler, which drops the marks the file was holding.
      watcher.onDidDelete(() => void store.clearIfDeleted())
    );
  } catch (err) {
    // Not fatal — marks still work, they just will not sync live between windows.
  }
}

/**
 * The storage mode is resolved once, at activation: a live swap would have to
 * drain the debounced saves, the queued writes and the watcher callbacks of the
 * store it is replacing, which is a great deal of machinery for something
 * nobody changes twice. Neither store is touched, so nothing is lost by
 * waiting — and nothing is copied between them either.
 *
 * @param {vscode.ExtensionContext} context
 * @param {import('./storage').Target} active
 */
async function offerReload(context, active) {
  if (resolveTarget(context).file.toString() === active.file.toString()) return;

  const answer = await vscode.window.showInformationMessage(
    'File Marks: marks are now stored somewhere else. Reload the window to use it.',
    'Reload Window'
  );
  if (answer === 'Reload Window') {
    await vscode.commands.executeCommand('workbench.action.reloadWindow');
  }
}

/** @param {vscode.ExtensionContext} context */
async function activate(context) {
  const target = resolveTarget(context);
  const store = new MarkStore(target);
  context.subscriptions.push(store);

  await store.load();
  // Global storage only; it returns immediately in workspace mode.
  await store.migrateLegacyStorage();

  const provider = new MarkDecorationProvider(store);
  context.subscriptions.push(provider);

  const lines = new LineDecorations(store);
  context.subscriptions.push(lines);

  context.subscriptions.push(
    store.onChanged((uris) => {
      provider.refresh(uris);
      lines.refresh(uris);
    })
  );

  const priority = new DecorationPriority(provider, () =>
    vscode.workspace.getConfiguration('fileMarks').get('priorityOverGit', true)
  );
  context.subscriptions.push(priority);
  priority.reassert(GIT_SETTLE_DELAY);
  void priority.watchGit();

  void watchStorage(context, store, target);

  // Marked lines are drawn per editor, so a newly opened or moved one needs
  // painting, and every edit can move the marks of the file being typed in.
  lines.refresh(undefined);
  context.subscriptions.push(
    vscode.window.onDidChangeVisibleTextEditors(() => lines.refresh(undefined)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      if (event.contentChanges.length === 0) return;
      if (!store.shiftLines(event.document.uri, event.contentChanges)) return;
      lines.refresh(event.document.uri);
      store.saveSoon();
    })
  );

  // Renames, moves and deletes made inside VS Code take their marks with them,
  // folders included — and a create puts them back when the delete is undone.
  context.subscriptions.push(
    vscode.workspace.onDidRenameFiles(async (event) => {
      let touched = false;
      for (const { oldUri, newUri } of event.files) {
        touched = store.renameInMemory(oldUri, newUri) || touched;
      }
      await store.commit(touched);
    }),
    vscode.workspace.onDidDeleteFiles(async (event) => {
      await store.commit(store.deleteInMemory(event.files));
    }),
    vscode.workspace.onDidCreateFiles(async (event) => {
      await store.commit(store.restoreDeleted(event.files));
    })
  );

  // Workspace storage is relative to the one folder of a single-folder
  // workspace, so opening a second one moves the marks elsewhere too.
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => void offerReload(context, target))
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('fileMarks')) return;
      if (event.affectsConfiguration('fileMarks.storage')) void offerReload(context, target);
      provider.reloadOptions();
      provider.refresh(undefined);
      lines.reloadOptions();
      lines.refresh(undefined);
    })
  );

  registerCommands(context, store, priority);
}

function deactivate() {}

module.exports = { activate, deactivate };
