/* Persistence: localStorage autosave + JSON file export/import. */
(function () {
  'use strict';

  var KEY = 'pipe-sim-project-v1';

  function save() {
    try { localStorage.setItem(KEY, PipeState.serialize()); } catch (e) { /* storage may be unavailable on file:// in some browsers */ }
  }

  function hasSave() {
    try { return !!localStorage.getItem(KEY); } catch (e) { return false; }
  }

  function load() {
    try {
      var json = localStorage.getItem(KEY);
      if (!json) return false;
      PipeState.deserialize(json);
      return true;
    } catch (e) {
      console.warn('Failed to restore saved project:', e);
      return false;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (e) {}
  }

  function exportFile() {
    var blob = new Blob([PipeState.serialize()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'pipe-project.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  function importFile(file, done) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        PipeState.deserialize(reader.result);
        History.reset();
        Validate.run();
        save();
        done(null);
      } catch (e) {
        done(e);
      }
    };
    reader.onerror = function () { done(new Error('Could not read file')); };
    reader.readAsText(file);
  }

  window.Storage2 = { save: save, load: load, hasSave: hasSave, clear: clear, exportFile: exportFile, importFile: importFile };
})();
