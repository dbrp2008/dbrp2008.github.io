/* Flow simulation: BFS from the inlet over the connectivity graph, per-segment
 * velocity from continuity (v = Q/A), animated dashed overlay in 2D.
 */
(function () {
  'use strict';

  function findInlet() {
    for (var i = 0; i < App.components.length; i++) {
      var c = App.components[i];
      if (c.type !== 'pipe' || !c.endMarks) continue;
      for (var e = 0; e < 2; e++) {
        if (c.endMarks[e] && c.endMarks[e].kind === 'inlet') return { comp: c, end: e };
      }
    }
    return null;
  }

  function velocityFor(sizeKey) {
    var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, sizeKey);
    if (!d || d.id <= 0) return 0;
    var area = Math.PI / 4 * Math.pow(d.id / 1000, 2);   // m²
    return +(App.flow.rateM3h / 3600 / area).toFixed(2);  // m/s
  }

  // Compute reachable components and their flow direction.
  // reach[compId] = {sign, vel} ; sign = dash animation direction.
  function compute() {
    var reach = {};
    var inlet = findInlet();
    App.flow.reach = reach;
    App.flow.hasOutlet = false;
    if (!inlet) return false;

    var net = Validate.buildConnectivity();
    // adjacency: comp id -> [{port (own), other (port)}]
    var adj = {};
    net.edges.forEach(function (e) {
      (adj[e.a.comp.id] = adj[e.a.comp.id] || []).push({ own: e.a, other: e.b });
      (adj[e.b.comp.id] = adj[e.b.comp.id] || []).push({ own: e.b, other: e.a });
    });

    // BFS queue entries: {comp, enteredAtPortDir or end}
    var queue = [{ comp: inlet.comp, enterEnd: inlet.end }];
    reach[inlet.comp.id] = {
      sign: inlet.end === 0 ? 1 : -1,    // flow e0 -> e1 when entering at end 0
      vel: velocityFor(inlet.comp.size)
    };

    while (queue.length) {
      var cur = queue.shift();
      var c = cur.comp;
      if (c.type === 'pipe' && c.endMarks) {
        c.endMarks.forEach(function (m) { if (m && m.kind === 'outlet') App.flow.hasOutlet = true; });
      }
      (adj[c.id] || []).forEach(function (link) {
        var next = link.other.comp;
        if (reach[next.id]) return;
        var entry = { sign: 1, vel: 0 };
        if (next.type === 'pipe') {
          entry.sign = link.other.end === 0 ? 1 : -1;
          entry.vel = velocityFor(next.size);
          queue.push({ comp: next, enterEnd: link.other.end });
        } else {
          if (next.type === 'elbow') {
            // drawn curve runs leg1 (rot) -> leg2; flow follows entry leg
            var enteredLeg1 = link.other.dir === Comp.dirKey(next.rot);
            entry.sign = enteredLeg1 ? 1 : -1;
            entry.vel = velocityFor(next.size);
          } else if (next.type === 'reducer') {
            entry.vel = velocityFor(next.smallSize);
          } else {
            entry.vel = velocityFor(next.size);
          }
          queue.push({ comp: next });
        }
        reach[next.id] = entry;
      });
    }

    // Any other pipe with its own inlet mark feeds this network too — force its
    // direction to flow away from its marked end, regardless of which side BFS
    // reached it from, so its animation always enters through the "IN" marker.
    App.components.forEach(function (c) {
      if (c.type !== 'pipe' || !c.endMarks || !reach[c.id]) return;
      for (var e = 0; e < 2; e++) {
        if (c.endMarks[e] && c.endMarks[e].kind === 'inlet') {
          reach[c.id].sign = e === 0 ? 1 : -1;
        }
      }
    });
    return true;
  }

  function start() {
    if (!findInlet()) {
      return { ok: false, msg: 'Mark a pipe end as inlet first (select a pipe, use the end buttons in the panel).' };
    }
    compute();
    App.flow.running = true;
    App.flow.t = 0;
    App.dirty = true;
    Viewer3D.rebuild();
    var n = Object.keys(App.flow.reach).length;
    var msg = 'Flow running through ' + n + ' component' + (n === 1 ? '' : 's') + '.';
    if (!App.flow.hasOutlet) msg += ' No outlet marked — flow dead-ends.';
    return { ok: true, msg: msg };
  }

  function stop() {
    App.flow.running = false;
    App.dirty = true;
    Viewer3D.rebuild();
  }

  function tick(dtMs) {
    if (!App.flow.running) return;
    App.flow.t += dtMs * 0.06;   // dash px per ms
    App.dirty = true;
  }

  function drawOverlay(ctx) {
    Object.keys(App.flow.reach).forEach(function (id) {
      var c = PipeState.getComp(+id);
      if (!c) return;
      var r = App.flow.reach[id];
      Comp.strokeFlowPath(ctx, c, App.flow.t, r.sign);
    });
  }

  // Re-derive reach after edits while running.
  function refresh() { if (App.flow.running) compute(); }

  window.Flow = {
    start: start, stop: stop, tick: tick, drawOverlay: drawOverlay,
    compute: compute, refresh: refresh, findInlet: findInlet, velocityFor: velocityFor
  };
})();
