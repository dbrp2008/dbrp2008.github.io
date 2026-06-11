/* Undo/redo via state snapshots. Every mutation is wrapped in
 * History.capture() ... History.commit(), producing one undo step.
 */
(function () {
  'use strict';

  var undoStack = [];
  var redoStack = [];
  var pending = null;
  var MAX = 200;
  var listeners = [];

  function snapshot() {
    return {
      components: JSON.parse(JSON.stringify(App.components)),
      nextId: App.nextId,
      settings: JSON.parse(JSON.stringify(App.settings))
    };
  }

  function restore(snap) {
    App.components = JSON.parse(JSON.stringify(snap.components));
    App.nextId = snap.nextId;
    App.settings = JSON.parse(JSON.stringify(snap.settings));
    if (App.selection && !PipeState.getComp(App.selection)) App.selection = null;
    App.flow.running = false;
    App.dirty = true;
    notify();
  }

  function capture() { pending = snapshot(); }

  function commit() {
    if (!pending) return;
    var after = snapshot();
    // skip no-op commits
    if (JSON.stringify(pending) !== JSON.stringify(after)) {
      undoStack.push(pending);
      if (undoStack.length > MAX) undoStack.shift();
      redoStack.length = 0;
    }
    pending = null;
    notify();
  }

  function abort() { pending = null; }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restore(undoStack.pop());
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restore(redoStack.pop());
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  function onChange(fn) { listeners.push(fn); }
  function notify() { listeners.forEach(function (fn) { fn(); }); }

  function reset() { undoStack.length = 0; redoStack.length = 0; pending = null; notify(); }

  window.History = {
    capture: capture, commit: commit, abort: abort,
    undo: undo, redo: redo, canUndo: canUndo, canRedo: canRedo,
    onChange: onChange, notify: notify, reset: reset
  };
})();
