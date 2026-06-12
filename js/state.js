/* Central application state and component model.
 * Grid coordinates are integers ("grid units", GU). One GU represents 0.5 m.
 * rot is degrees in 45° increments, 0 = +x (right), 90 = +y (down, screen space).
 */
(function () {
  'use strict';

  var App = {
    settings: { family: 'ASME', schedule: '40' },
    components: [],
    selection: null,          // component id or null
    multiSel: [],             // ids circled with the lasso select tool
    lockRatio: false,         // corner handles of the group box scale proportionally
    view: { zoom: 48, panX: 0, panY: 0 },   // zoom = pixels per GU
    mode: '2d',               // '2d' | '3d'
    flow: {
      running: false,
      rateM3h: 36,            // flow rate at inlet
      pressureBar: 10,        // inlet pressure
      reach: {},              // compId -> {dir} computed by flow.js
      t: 0
    },
    issues: [],               // validation results
    nextId: 1,
    dirty: true               // 2d canvas needs redraw
  };

  var METERS_PER_GU = 0.2;

  function defaultSizeKey() {
    var keys = PipeStandards.sizeKeys(App.settings.family, App.settings.schedule);
    // prefer a mid-range size (2" / DN50-ish), else first available
    var prefer = ['2', 'DN50', '50A'];
    for (var i = 0; i < prefer.length; i++) {
      if (keys.indexOf(prefer[i]) >= 0) return prefer[i];
    }
    return keys[Math.floor(keys.length / 2)] || keys[0];
  }

  function smallerSizeKey(sizeKey) {
    var keys = PipeStandards.sizeKeys(App.settings.family, App.settings.schedule);
    var i = keys.indexOf(sizeKey);
    return i > 0 ? keys[i - 1] : sizeKey;
  }

  // Last size the user picked anywhere in the UI; new parts default to it so a whole
  // run stays the same diameter unless the user deliberately changes one.
  function setDefaultSize(sizeKey) {
    if (PipeStandards.sizeKeys(App.settings.family, App.settings.schedule).indexOf(sizeKey) >= 0) {
      App.settings.defaultSize = sizeKey;
    }
  }

  function newComponent(type, gx, gy) {
    var c = {
      id: App.nextId++,
      type: type,
      pos: { x: gx, y: gy },
      rot: 0,
      material: 'carbon',
      condition: 'ok',        // hook for future repair/failure scenarios
      color: (type === 'flange' || type === 'reducer')
        ? Comp.CYCLE_PALETTE[(App.nextId - 1) % Comp.CYCLE_PALETTE.length]
        : '#8a8f98'
    };
    var size = (App.settings.defaultSize &&
      PipeStandards.sizeKeys(App.settings.family, App.settings.schedule).indexOf(App.settings.defaultSize) >= 0)
      ? App.settings.defaultSize : defaultSizeKey();
    if (type === 'pipe') {
      c.size = size;
      c.lengthGU = 4;
      c.endMarks = [null, null];   // per end: null | {kind:'inlet'|'outlet'}
    } else if (type === 'flange') {
      c.size = size;
      c.cls = '150';
    } else if (type === 'elbow') {
      c.size = size;
      c.angle = 90;                // bend angle: 90 or 45
    } else if (type === 'reducer') {
      c.largeSize = size;
      c.smallSize = smallerSizeKey(size);
    } else if (type === 'branch') {
      c.size = size;
    }
    return c;
  }

  function getComp(id) {
    for (var i = 0; i < App.components.length; i++) {
      if (App.components[i].id === id) return App.components[i];
    }
    return null;
  }

  function addComp(c) { App.components.push(c); App.dirty = true; }

  function removeComp(id) {
    App.components = App.components.filter(function (c) { return c.id !== id; });
    if (App.selection === id) App.selection = null;
    App.dirty = true;
  }

  function selected() { return App.selection ? getComp(App.selection) : null; }

  // Outer diameter (mm) of a component; reducers report per-port elsewhere.
  function compOD(c) {
    var key = c.type === 'reducer' ? c.largeSize : c.size;
    var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, key);
    return d ? d.od : 60;
  }

  function sizeOD(sizeKey) {
    var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, sizeKey);
    return d ? d.od : 60;
  }

  function serialize() {
    return JSON.stringify({
      version: 1,
      settings: App.settings,
      components: App.components,
      nextId: App.nextId,
      flow: { rateM3h: App.flow.rateM3h, pressureBar: App.flow.pressureBar }
    });
  }

  function deserialize(json) {
    var data = JSON.parse(json);
    if (!data || !data.components) throw new Error('Invalid project file');
    App.settings = data.settings || App.settings;
    App.components = data.components;
    App.nextId = data.nextId || (App.components.reduce(function (m, c) { return Math.max(m, c.id); }, 0) + 1);
    if (data.flow) {
      App.flow.rateM3h = data.flow.rateM3h || App.flow.rateM3h;
      App.flow.pressureBar = data.flow.pressureBar || App.flow.pressureBar;
    }
    App.selection = null;
    App.flow.running = false;
    App.dirty = true;
  }

  window.App = App;
  window.PipeState = {
    METERS_PER_GU: METERS_PER_GU,
    newComponent: newComponent,
    getComp: getComp,
    addComp: addComp,
    removeComp: removeComp,
    selected: selected,
    compOD: compOD,
    sizeOD: sizeOD,
    defaultSizeKey: defaultSizeKey,
    setDefaultSize: setDefaultSize,
    serialize: serialize,
    deserialize: deserialize
  };
})();
