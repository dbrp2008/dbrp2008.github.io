/* Right-hand sidebar: properties for the selected component, project/flow
 * controls, and the validation issues list.
 */
(function () {
  'use strict';

  var propsEl, issuesEl, flowStatusEl;

  function init() {
    propsEl = document.getElementById('propsPanel');
    issuesEl = document.getElementById('issuesPanel');
    flowStatusEl = document.getElementById('flowStatus');

    document.getElementById('flowPressure').addEventListener('change', function () {
      App.flow.pressureBar = Math.max(0.1, parseFloat(this.value) || 10);
      this.value = App.flow.pressureBar;
      Validate.run(); Flow.refresh(); refresh();
    });
    var flowRateEl = document.getElementById('flowRate');
    var FLOW_RATE_MAX = +flowRateEl.max || 25000;
    flowRateEl.addEventListener('input', function () { sizeFlowRateInput(this); });
    flowRateEl.addEventListener('change', function () {
      App.flow.rateM3h = Math.min(FLOW_RATE_MAX, Math.max(0.1, parseFloat(this.value) || 36));
      this.value = App.flow.rateM3h;
      sizeFlowRateInput(this);
      Validate.run(); Flow.refresh(); refresh();
    });
    sizeFlowRateInput(flowRateEl);
    document.getElementById('flowToggle').addEventListener('click', function () {
      if (App.flow.running) {
        Flow.stop();
        setFlowStatus('Flow stopped.');
      } else {
        var res = Flow.start();
        setFlowStatus(res.msg);
      }
      refresh();
    });
  }

  function setFlowStatus(msg) { if (flowStatusEl) flowStatusEl.textContent = msg || ''; }

  // Grow the flow-rate box as the user types more digits than the default
  // width fits, so big numbers stay fully visible while typing.
  function sizeFlowRateInput(el) {
    var len = String(el.value).length;
    el.style.width = Math.max(62, (len + 1) * 9) + 'px';
  }

  function el(tag, attrs, text) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function row(label, control) {
    var r = el('div', { class: 'prop-row' });
    r.appendChild(el('label', null, label));
    r.appendChild(control);
    return r;
  }

  function readout(label, value) {
    var r = el('div', { class: 'prop-row readout' });
    r.appendChild(el('label', null, label));
    r.appendChild(el('span', null, value));
    return r;
  }

  function colorPicker(c) {
    var wrap = el('div', { class: 'color-picker' });
    Comp.COLOR_PALETTE.forEach(function (col) {
      var sw = el('button', { class: 'swatch' + (Comp.colorFor(c) === col ? ' active' : ''), title: col });
      sw.style.background = col;
      sw.addEventListener('click', function () {
        mutate(function () { c.color = col; });
      });
      wrap.appendChild(sw);
    });
    var inp = el('input', { type: 'color', class: 'swatch-custom', value: Comp.colorFor(c), title: 'Custom colour' });
    inp.addEventListener('input', function () {
      mutate(function () { c.color = inp.value; });
    });
    wrap.appendChild(inp);
    return wrap;
  }

  function select(options, current, onChange) {
    var s = el('select');
    options.forEach(function (o) {
      var opt = el('option', { value: o.value }, o.label);
      if (String(o.value) === String(current)) opt.selected = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', function () { onChange(s.value); });
    return s;
  }

  function mutate(fn) {
    History.capture();
    fn();
    History.commit();
    Flow.refresh();
    App.dirty = true;
    refresh();
  }

  function sizeOptions() {
    return PipeStandards.sizeKeys(App.settings.family, App.settings.schedule).map(function (k) {
      return { value: k, label: PipeStandards.sizeLabel(App.settings.family, k) };
    });
  }

  function materialOptions() {
    var mats = PipeStandards.STANDARDS.materials;
    return Object.keys(mats).map(function (k) { return { value: k, label: mats[k].label }; });
  }

  function dimsReadouts(container, sizeKey, material) {
    var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, sizeKey);
    if (!d) {
      container.appendChild(readout('Dimensions', 'n/a in this schedule'));
      return;
    }
    container.appendChild(readout('Outer Ø', d.od + ' mm'));
    container.appendChild(readout('Wall', d.wall + ' mm'));
    container.appendChild(readout('Inner Ø', d.id + ' mm'));
    container.appendChild(readout('Rated (Barlow)', PipeStandards.ratedPressureBar(d.od, d.wall, material) + ' bar'));
  }

  /* ---------- per-type property forms ---------- */

  function buildProps() {
    propsEl.innerHTML = '';

    var ms = (App.multiSel || []).map(PipeState.getComp).filter(Boolean);
    if (ms.length > 1) {
      buildMultiProps(ms);
      return;
    }

    var c = PipeState.selected();

    if (!c) {
      buildProjectProps();
      return;
    }

    propsEl.appendChild(el('h3', null, ({ pipe: 'Pipe', flange: 'Flange', elbow: 'Elbow', reducer: 'Reducer', branch: 'Branch' })[c.type] + '  #' + c.id));

    if (c.type === 'reducer') {
      propsEl.appendChild(row('Large end', select(sizeOptions(), c.largeSize, function (v) {
        mutate(function () { c.largeSize = v; PipeState.setDefaultSize(v); });
      })));
      propsEl.appendChild(row('Small end', select(sizeOptions(), c.smallSize, function (v) {
        mutate(function () { c.smallSize = v; });
      })));
    } else {
      propsEl.appendChild(row('Size', select(sizeOptions(), c.size, function (v) {
        mutate(function () {
          c.size = v;
          PipeState.setDefaultSize(v);
          if (c.type === 'flange') {
            var mate = Comp.flangeMate(c);
            if (mate) mate.size = v;
          }
        });
      })));
    }

    propsEl.appendChild(row('Material', select(materialOptions(), c.material, function (v) {
      mutate(function () { c.material = v; });
    })));

    propsEl.appendChild(row('Colour', colorPicker(c)));

    if (c.type === 'flange') {
      var clsOpts = Object.keys(PipeStandards.STANDARDS.flangeClasses).map(function (k) {
        return { value: k, label: 'Class ' + k + ' (' + PipeStandards.STANDARDS.flangeClasses[k] + ' bar)' };
      });
      propsEl.appendChild(row('Pressure class', select(clsOpts, c.cls, function (v) {
        mutate(function () {
          c.cls = v;
          var mate = Comp.flangeMate(c);
          if (mate) mate.cls = v;
        });
      })));
      var mate = Comp.flangeMate(c);
      propsEl.appendChild(readout('Pairing', mate ? 'Merged pair with #' + mate.id : 'Unpaired'));
      if (mate) {
        var btn = el('button', { class: 'btn small' }, 'Split flange pair');
        btn.addEventListener('click', function () { Editor.splitFlangePair(c); });
        propsEl.appendChild(btn);
      }

      var fd = PipeStandards.flangeDims(App.settings.family, App.settings.schedule, c.size, c.cls);
      propsEl.appendChild(el('h4', null, 'Flange dimensions'));
      if (fd) {
        propsEl.appendChild(readout('Outer Ø (OD)', fd.od + ' mm'));
        propsEl.appendChild(readout('Bore Ø (ID)', fd.id + ' mm'));
        propsEl.appendChild(readout('Bolt circle (PCD)', fd.pcd + ' mm'));
        propsEl.appendChild(readout('Thickness', fd.thickness + ' mm'));
        propsEl.appendChild(readout('Bolt holes', fd.boltCount + ' × Ø' + fd.boltDia + ' mm'));
      } else {
        propsEl.appendChild(readout('Flange dimensions', 'n/a in this schedule'));
      }
    }

    if (c.type === 'elbow') {
      propsEl.appendChild(row('Bend angle', select(
        [{ value: 90, label: '90°' }, { value: 45, label: '45°' }], c.angle,
        function (v) { mutate(function () { c.angle = +v; }); }
      )));
    }

    if (c.type === 'pipe') {
      var lenInput = el('input', { type: 'number', min: 1, step: 1, value: c.lengthGU });
      lenInput.addEventListener('change', function () {
        var v = Math.max(1, Math.round(parseFloat(lenInput.value) || 1));
        var prev = c.lengthGU;
        c.lengthGU = v;
        if (Comp.pipeOverlapsOther(c)) {        // reject a length that would overlap another pipe
          c.lengthGU = prev;
          lenInput.value = prev;
          setFlowStatus('Length would overlap another pipe — kept at ' + prev + '.');
          return;
        }
        c.lengthGU = prev;
        mutate(function () { c.lengthGU = v; });
      });
      propsEl.appendChild(row('Length (grid)', lenInput));
      var diag = Comp.norm(c.rot) % 90 !== 0;
      var meters = c.lengthGU * PipeState.METERS_PER_GU * (diag ? Math.SQRT2 : 1);
      propsEl.appendChild(readout('Length (m)', meters.toFixed(2) + ' m'));

      // inlet/outlet end marks
      ['A (start)', 'B (end)'].forEach(function (label, endIdx) {
        var cur = (c.endMarks && c.endMarks[endIdx]) ? c.endMarks[endIdx].kind : 'none';
        propsEl.appendChild(row('End ' + label, select(
          [{ value: 'none', label: '—' }, { value: 'inlet', label: 'Inlet' }, { value: 'outlet', label: 'Outlet' }],
          cur,
          function (v) {
            mutate(function () {
              if (!c.endMarks) c.endMarks = [null, null];
              c.endMarks[endIdx] = v === 'none' ? null : { kind: v };
              Validate.run();
            });
          }
        )));
      });
    }

    propsEl.appendChild(readout('Rotation', Comp.norm(c.rot) + '°'));

    var sizeForDims = c.type === 'reducer' ? c.largeSize : c.size;
    dimsReadouts(propsEl, sizeForDims, c.material);
    if (c.type === 'reducer') {
      propsEl.appendChild(el('h4', null, 'Small end'));
      dimsReadouts(propsEl, c.smallSize, c.material);
    }

    if (App.flow.reach[c.id] && App.flow.running) {
      propsEl.appendChild(readout('Flow velocity', App.flow.reach[c.id].vel + ' m/s'));
      propsEl.appendChild(readout('Line pressure', App.flow.pressureBar + ' bar'));
    }

    var hint = el('p', { class: 'hint' });
    hint.textContent = 'Drag to move · handle above rotates (45° steps, or press R) · double-click deletes' +
      (c.type === 'pipe' ? ' · drag square end handles to resize' : '');
    propsEl.appendChild(hint);
  }

  // Group editing for everything circled with the lasso select tool.
  function buildMultiProps(ms) {
    propsEl.appendChild(el('h3', null, ms.length + ' parts selected'));

    propsEl.appendChild(row('Size (all)', select(
      [{ value: '', label: '— pick —' }].concat(sizeOptions()), '',
      function (v) {
        if (!v) return;
        mutate(function () {
          var keys = PipeStandards.sizeKeys(App.settings.family, App.settings.schedule);
          ms.forEach(function (c) {
            if (c.type === 'reducer') {
              c.largeSize = v;
              var i = keys.indexOf(v);
              c.smallSize = i > 0 ? keys[i - 1] : v;
            } else {
              c.size = v;
            }
          });
          PipeState.setDefaultSize(v);
        });
      }
    )));

    var wrap = el('div', { class: 'color-picker' });
    Comp.COLOR_PALETTE.forEach(function (col) {
      var sw = el('button', { class: 'swatch', title: col });
      sw.style.background = col;
      sw.addEventListener('click', function () {
        mutate(function () { ms.forEach(function (c) { c.color = col; }); });
      });
      wrap.appendChild(sw);
    });
    var inp = el('input', { type: 'color', class: 'swatch-custom', value: '#8a8f98', title: 'Custom colour' });
    inp.addEventListener('input', function () {
      mutate(function () { ms.forEach(function (c) { c.color = inp.value; }); });
    });
    wrap.appendChild(inp);
    propsEl.appendChild(row('Colour (all)', wrap));

    var lockBtn = el('button', { class: 'btn small' + (App.lockRatio ? ' active' : '') },
      App.lockRatio ? '🔒 Ratio locked' : '🔓 Lock ratio');
    lockBtn.title = 'When locked, the 4 corner squares stretch width and height proportionally';
    lockBtn.addEventListener('click', function () {
      App.lockRatio = !App.lockRatio;
      refresh();
    });
    propsEl.appendChild(lockBtn);

    var rotBtn = el('button', { class: 'btn small' }, '⟳ Rotate group 90°');
    rotBtn.addEventListener('click', function () {
      mutate(function () {
        // rigid rotation about the selection's snapped centroid keeps every
        // joint mated; 90° steps because 45° would leave the grid
        var cx = 0, cy = 0;
        ms.forEach(function (c) { var ct = Comp.compCenter(c); cx += ct.x; cy += ct.y; });
        cx = Math.round(cx / ms.length); cy = Math.round(cy / ms.length);
        ms.forEach(function (c) {
          var dx = c.pos.x - cx, dy = c.pos.y - cy;
          c.pos.x = cx - dy;
          c.pos.y = cy + dx;
          c.rot = Comp.norm(c.rot + 90);
        });
      });
    });
    propsEl.appendChild(rotBtn);

    var delBtn = el('button', { class: 'btn small' }, '🗑 Delete selected');
    delBtn.addEventListener('click', function () {
      mutate(function () {
        ms.forEach(function (c) { PipeState.removeComp(c.id); });
        App.multiSel = [];
      });
    });
    propsEl.appendChild(delBtn);

    var clrBtn = el('button', { class: 'btn small' }, 'Clear selection');
    clrBtn.addEventListener('click', function () {
      App.multiSel = [];
      App.dirty = true;
      refresh();
    });
    propsEl.appendChild(clrBtn);

    var hint = el('p', { class: 'hint' });
    hint.textContent = 'Drag the squares on the selection box to stretch/resize the group ' +
      '(corners scale both ways, edges one way, the centre square moves it). The circle above ' +
      'rotates the group in 90° steps. Changes here apply to every circled part; reducers take ' +
      'the picked size on their large end.';
    propsEl.appendChild(hint);
  }

  function buildProjectProps() {
    propsEl.appendChild(el('h3', null, 'Project'));
    var fams = PipeStandards.STANDARDS.families;

    propsEl.appendChild(row('Standard', select(
      Object.keys(fams).map(function (k) { return { value: k, label: fams[k].label }; }),
      App.settings.family,
      function (v) { changeStandard(v, null); }
    )));
    propsEl.appendChild(row('Schedule', select(
      PipeStandards.scheduleNames(App.settings.family).map(function (k) { return { value: k, label: k }; }),
      App.settings.schedule,
      function (v) { changeStandard(App.settings.family, v); }
    )));
    var note = el('p', { class: 'hint' });
    note.textContent = fams[App.settings.family].note;
    propsEl.appendChild(note);

    var help = el('p', { class: 'hint' });
    help.textContent = 'Drag parts from the left palette onto the grid. Click a part to edit its dimensions here. ' +
      'Flanges merge when two share a point on the same axis (pipe–flange–flange–pipe).';
    propsEl.appendChild(help);
  }

  // Switch standard/schedule; remap component sizes by position in the size list.
  function changeStandard(family, schedule) {
    History.capture();
    var oldFam = App.settings.family, oldSch = App.settings.schedule;
    var newSch = schedule || PipeStandards.scheduleNames(family)[0];
    if (family === oldFam && PipeStandards.sizeKeys(family, newSch).length === 0) { History.abort(); return; }

    var oldKeys = PipeStandards.sizeKeys(oldFam, oldSch);
    App.settings.family = family;
    App.settings.schedule = newSch;
    var newKeys = PipeStandards.sizeKeys(family, newSch);

    function remap(key) {
      var i = oldKeys.indexOf(key);
      if (i < 0) i = Math.floor(newKeys.length / 2);
      return newKeys[Math.min(i, newKeys.length - 1)];
    }
    App.components.forEach(function (c) {
      if (c.type === 'reducer') {
        c.largeSize = remap(c.largeSize);
        c.smallSize = remap(c.smallSize);
      } else {
        c.size = remap(c.size);
      }
    });
    if (App.settings.defaultSize) App.settings.defaultSize = remap(App.settings.defaultSize);
    History.commit();
    Validate.run();
    Flow.refresh();
    App.dirty = true;
    refresh();
  }

  /* ---------- issues list ---------- */

  function buildIssues() {
    issuesEl.innerHTML = '';
    var h = el('h3', null, 'Checks' + (App.issues.length ? ' (' + App.issues.length + ')' : ''));
    issuesEl.appendChild(h);
    if (!App.issues.length) {
      issuesEl.appendChild(el('p', { class: 'hint ok' }, App.components.length ? '✓ No issues found' : 'Nothing placed yet'));
      return;
    }
    App.issues.forEach(function (iss) {
      var d = el('div', { class: 'issue ' + iss.level + (iss.anim ? ' pulse' : '') });
      d.textContent = iss.msg;
      if (iss.compId) {
        d.addEventListener('click', function () {
          App.selection = iss.compId;
          App.dirty = true;
          refresh();
        });
      }
      issuesEl.appendChild(d);
    });
  }

  function refreshToolbar() {
    document.getElementById('btnUndo').disabled = !History.canUndo();
    document.getElementById('btnRedo').disabled = !History.canRedo();
    var ft = document.getElementById('flowToggle');
    ft.textContent = App.flow.running ? '⏹ Stop flow' : '▶ Start flow';
    ft.classList.toggle('active', App.flow.running);
    document.getElementById('flowPressure').value = App.flow.pressureBar;
    var flowRateEl = document.getElementById('flowRate');
    flowRateEl.value = App.flow.rateM3h;
    sizeFlowRateInput(flowRateEl);
  }

  function refresh() {
    buildProps();
    buildIssues();
    refreshToolbar();
  }

  window.Panel = { init: init, refresh: refresh, setFlowStatus: setFlowStatus, changeStandard: changeStandard };
})();
