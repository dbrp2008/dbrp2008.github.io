/* App bootstrap: startup modal, toolbar wiring, canvas sizing, render loop. */
(function () {
  'use strict';

  var canvas, lastTs = 0;

  function init() {
    canvas = document.getElementById('canvas2d');
    Editor.init();
    Panel.init();
    Viewer3D.init();

    sizeCanvas();
    window.addEventListener('resize', function () { sizeCanvas(); Viewer3D.resize(); });

    wireToolbar();
    wirePaletteResizer();

    History.onChange(function () {
      Validate.run();
      Flow.refresh();
      Storage2.save();
      Viewer3D.rebuild();
    });

    if (Storage2.load()) {
      History.reset();
      Validate.run();
      Panel.refresh();
      centerView();
    } else {
      showStartupModal();
    }

    requestAnimationFrame(loop);
  }

  function sizeCanvas() {
    var wrap = document.getElementById('canvasWrap');
    canvas.width = wrap.clientWidth;
    canvas.height = wrap.clientHeight;
    App.dirty = true;
  }

  function centerView() {
    App.view.panX = canvas.width / 2;
    App.view.panY = canvas.height / 2;
    App.dirty = true;
  }

  /* ---------- startup modal ---------- */

  function showStartupModal() {
    var modal = document.getElementById('startupModal');
    var famSel = document.getElementById('modalFamily');
    var schSel = document.getElementById('modalSchedule');
    var noteEl = document.getElementById('modalNote');
    var fams = PipeStandards.STANDARDS.families;

    famSel.innerHTML = '';
    Object.keys(fams).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k; o.textContent = fams[k].label;
      famSel.appendChild(o);
    });

    function fillSchedules() {
      schSel.innerHTML = '';
      PipeStandards.scheduleNames(famSel.value).forEach(function (s) {
        var o = document.createElement('option');
        o.value = s; o.textContent = s;
        schSel.appendChild(o);
      });
      // sensible default: most common schedule
      var prefer = ['40', 'Sch 40', 'Medium (Series 2)', '40S'];
      for (var i = 0; i < prefer.length; i++) {
        if ([].some.call(schSel.options, function (o) { return o.value === prefer[i]; })) {
          schSel.value = prefer[i];
          break;
        }
      }
      noteEl.textContent = fams[famSel.value].note;
    }
    famSel.addEventListener('change', fillSchedules);
    fillSchedules();

    document.getElementById('modalStart').onclick = function () {
      App.settings.family = famSel.value;
      App.settings.schedule = schSel.value;
      modal.style.display = 'none';
      History.reset();
      Validate.run();
      Panel.refresh();
      centerView();
    };

    modal.style.display = 'flex';
  }

  /* ---------- palette resizer ---------- */

  function wirePaletteResizer() {
    var palette = document.getElementById('palette');
    var resizer = document.getElementById('paletteResizer');
    var MIN_W = 100, MAX_W = 420;

    try {
      var saved = parseInt(localStorage.getItem('palette-width'), 10);
      if (saved >= MIN_W && saved <= MAX_W) palette.style.flexBasis = saved + 'px';
    } catch (err) {}

    resizer.addEventListener('mousedown', function (e) {
      e.preventDefault();
      resizer.classList.add('dragging');
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';

      function onMove(ev) {
        var rect = palette.getBoundingClientRect();
        var w = Math.max(MIN_W, Math.min(MAX_W, ev.clientX - rect.left));
        palette.style.flexBasis = w + 'px';
        sizeCanvas();
        Viewer3D.resize();
      }
      function onUp() {
        resizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        try { localStorage.setItem('palette-width', palette.getBoundingClientRect().width.toFixed(0)); } catch (err) {}
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }

  /* ---------- toolbar ---------- */

  function wireToolbar() {
    document.getElementById('btnUndo').addEventListener('click', function () { History.undo(); Panel.refresh(); });
    document.getElementById('btnRedo').addEventListener('click', function () { History.redo(); Panel.refresh(); });

    document.getElementById('btnZoomIn').addEventListener('click', function () {
      Grid.zoomAt(canvas.width / 2, canvas.height / 2, 1.25);
    });
    document.getElementById('btnZoomOut').addEventListener('click', function () {
      Grid.zoomAt(canvas.width / 2, canvas.height / 2, 1 / 1.25);
    });

    document.getElementById('btnLasso').addEventListener('click', function () {
      Editor.toggleLasso();
    });

    var btnTheme = document.getElementById('btnTheme');
    function applyTheme(light) {
      document.body.classList.toggle('light', light);
      btnTheme.textContent = light ? '🌙 Dark' : '☀ Light';
      try { localStorage.setItem('pipe-theme', light ? 'light' : 'dark'); } catch (err) {}
      App.dirty = true;
      Viewer3D.rebuild();
    }
    btnTheme.addEventListener('click', function () {
      applyTheme(!document.body.classList.contains('light'));
    });
    try { if (localStorage.getItem('pipe-theme') === 'light') applyTheme(true); } catch (err) {}

    var btnMode = document.getElementById('btnMode');
    btnMode.addEventListener('click', function () {
      if (App.mode === '2d') {
        App.mode = '3d';
        canvas.style.display = 'none';
        document.getElementById('palette').classList.add('disabled');
        Editor.hidePopover();
        Viewer3D.enter();
        btnMode.textContent = '2D view';
      } else {
        App.mode = '2d';
        Viewer3D.exit();
        canvas.style.display = 'block';
        document.getElementById('palette').classList.remove('disabled');
        btnMode.textContent = '3D view';
        App.dirty = true;
      }
    });

    document.getElementById('btnExport').addEventListener('click', function () { Storage2.exportFile(); });

    var importInput = document.getElementById('importFile');
    document.getElementById('btnImport').addEventListener('click', function () { importInput.click(); });
    importInput.addEventListener('change', function () {
      if (!importInput.files.length) return;
      Storage2.importFile(importInput.files[0], function (err) {
        if (err) {
          Panel.setFlowStatus('Import failed: ' + err.message);
        } else {
          Panel.refresh();
          centerView();
          Viewer3D.rebuild();
          Panel.setFlowStatus('Project imported.');
        }
        importInput.value = '';
      });
    });

    document.getElementById('btnNew').addEventListener('click', function () {
      if (App.components.length && !confirm('Start a new project? The current layout will be cleared.')) return;
      App.components = [];
      App.selection = null;
      App.flow.running = false;
      Storage2.clear();
      History.reset();
      if (App.mode === '3d') document.getElementById('btnMode').click();
      Validate.run();
      Panel.refresh();
      showStartupModal();
    });
  }

  /* ---------- render loop ---------- */

  function loop(ts) {
    var dt = lastTs ? ts - lastTs : 16;
    lastTs = ts;

    Flow.tick(dt);

    if (App.mode === '2d') {
      if (App.dirty) {
        Editor.render();
        App.dirty = false;
      }
    } else {
      Viewer3D.tick();
    }
    requestAnimationFrame(loop);
  }

  window.addEventListener('DOMContentLoaded', init);
})();
