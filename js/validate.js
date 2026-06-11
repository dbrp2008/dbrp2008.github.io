/* Connectivity graph builder + design rule validation.
 * Issues: {compId, level:'error'|'warn', msg}
 */
(function () {
  'use strict';

  function ptKey(p) { return p.x + ',' + p.y; }

  function oppositeDir(dirStr) {
    var parts = dirStr.split(',');
    return (-parts[0]) + ',' + (-parts[1]);
  }

  // Builds {edges:[{a,b}], openPorts:[port], portsByPoint:{key:[port]}}
  function buildConnectivity() {
    var ports = [];
    App.components.forEach(function (c) {
      Comp.getPorts(c).forEach(function (p) { ports.push(p); });
    });

    var byPoint = {};
    ports.forEach(function (p) {
      var k = ptKey(p.p);
      (byPoint[k] = byPoint[k] || []).push(p);
    });

    var edges = [];
    var connected = new Set();
    Object.keys(byPoint).forEach(function (k) {
      var list = byPoint[k];
      for (var i = 0; i < list.length; i++) {
        for (var j = i + 1; j < list.length; j++) {
          var a = list[i], b = list[j];
          if (a.comp.id === b.comp.id) continue;
          if (a.dir === oppositeDir(b.dir)) {
            edges.push({ a: a, b: b });
            connected.add(a); connected.add(b);
          }
        }
      }
    });

    var openPorts = ports.filter(function (p) { return !connected.has(p); });
    return { edges: edges, openPorts: openPorts, portsByPoint: byPoint };
  }

  function odOf(sizeKey) { return PipeState.sizeOD(sizeKey); }

  function run() {
    var issues = [];
    var net = buildConnectivity();
    var fam = App.settings.family, sch = App.settings.schedule;

    // 0. sizes valid in current schedule
    App.components.forEach(function (c) {
      var keys = c.type === 'reducer' ? [c.largeSize, c.smallSize] : [c.size];
      keys.forEach(function (k) {
        if (!PipeStandards.sizeData(fam, sch, k)) {
          issues.push({ compId: c.id, level: 'error', msg: 'Size ' + k + ' is not available in ' + fam + ' schedule ' + sch });
        }
      });
    });

    // 0b. pipe-on-pipe overlap (safety net; interactive edits already block this)
    App.components.forEach(function (c) {
      if (c.type === 'pipe' && Comp.pipeOverlapsOther(c)) {
        issues.push({ compId: c.id, level: 'error', msg: 'Pipe overlaps another pipe — pipes cannot share the same run' });
      }
    });

    // 1. open pipe ends without inlet/outlet mark
    net.openPorts.forEach(function (p) {
      if (p.comp.type === 'pipe') {
        var mark = p.comp.endMarks && p.comp.endMarks[p.end];
        if (!mark) {
          issues.push({ compId: p.comp.id, level: 'warn', msg: 'Open pipe end at (' + p.p.x + ',' + p.p.y + ') — connect it or mark as inlet/outlet' });
        }
      } else if (p.comp.type !== 'flange') {
        issues.push({ compId: p.comp.id, level: 'warn', msg: 'Unconnected ' + p.comp.type + ' port at (' + p.p.x + ',' + p.p.y + ')' });
      }
    });

    // 2. diameter mismatch at joints (reducer ports carry their own per-side size)
    net.edges.forEach(function (e) {
      // skip direct pipe-pipe "edge" when a fitting sits at the same point —
      // the pipes connect through the fitting (flange pair, reducer), not to each other
      if (e.a.comp.type === 'pipe' && e.b.comp.type === 'pipe') {
        var fittingsHere = (net.portsByPoint[ptKey(e.a.p)] || []).filter(function (p) { return p.comp.type !== 'pipe'; });
        if (fittingsHere.length) return;
      }
      var odA = odOf(e.a.size), odB = odOf(e.b.size);
      if (Math.abs(odA - odB) > 0.01) {
        issues.push({
          compId: e.a.comp.id, level: 'error',
          msg: 'Diameter mismatch at (' + e.a.p.x + ',' + e.a.p.y + '): ' + e.a.size + ' vs ' + e.b.size + ' — use a reducer'
        });
      }
    });

    // 3. reducer orientation / sizing
    App.components.forEach(function (c) {
      if (c.type !== 'reducer') return;
      if (odOf(c.largeSize) <= odOf(c.smallSize)) {
        issues.push({ compId: c.id, level: 'error', msg: 'Reducer large end (' + c.largeSize + ') must be larger than small end (' + c.smallSize + ')' });
      }
    });

    // 4. flange pairing: pipe-flange-flange-pipe
    App.components.forEach(function (c) {
      if (c.type !== 'flange') return;
      var mates = App.components.filter(function (o) {
        return o.id !== c.id && o.type === 'flange' &&
               o.pos.x === c.pos.x && o.pos.y === c.pos.y &&
               Comp.norm(o.rot) % 180 === Comp.norm(c.rot) % 180;
      });
      if (mates.length === 0) {
        issues.push({ compId: c.id, level: 'warn', msg: 'Unpaired flange at (' + c.pos.x + ',' + c.pos.y + ') — flanges must be installed face-to-face in pairs' });
      } else if (mates.length > 1) {
        issues.push({ compId: c.id, level: 'error', msg: 'More than two flanges stacked at (' + c.pos.x + ',' + c.pos.y + ')' });
      }
    });

    // 5. pressure rating vs system pressure (when an inlet is defined)
    var hasInlet = App.components.some(function (c) {
      return c.type === 'pipe' && c.endMarks && c.endMarks.some(function (m) { return m && m.kind === 'inlet'; });
    });
    if (hasInlet) {
      var P = App.flow.pressureBar;
      App.components.forEach(function (c) {
        if (c.type === 'flange') {
          var fr = PipeStandards.flangeRatingBar(c.cls);
          if (P > fr) {
            issues.push({ compId: c.id, level: 'error', msg: 'System pressure ' + P + ' bar exceeds Class ' + c.cls + ' flange rating (' + fr + ' bar)' });
          }
          return;
        }
        var keys = c.type === 'reducer' ? [c.largeSize, c.smallSize] : [c.size];
        keys.forEach(function (k) {
          var d = PipeStandards.sizeData(fam, sch, k);
          if (!d) return;
          var rating = PipeStandards.ratedPressureBar(d.od, d.wall, c.material);
          if (P > rating) {
            issues.push({ compId: c.id, level: 'error', msg: 'System pressure ' + P + ' bar exceeds ' + c.type + ' rating ' + rating + ' bar (' + k + ', sch ' + sch + ')' });
          }
        });
      });
    }

    App.issues = issues;
    App.dirty = true;
    return issues;
  }

  window.Validate = { run: run, buildConnectivity: buildConnectivity, ptKey: ptKey };
})();
