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

  // Compute which components carry water and their flow direction, at
  // sub-segment granularity: pipes are split at their tee taps, and water
  // spreads from EVERY inlet junction through live segments only — stagnant
  // sections (no guaranteed flow) and contradiction pipes block it. So a dead
  // bridge stops animating while both self-sufficient sides keep flowing.
  // reach[compId] = {sign, vel, segs?} ; segs = [[f0,f1],...] live sub-spans
  // of a partially flowing pipe (fractions along it; absent = full length).
  function compute() {
    var reach = {};
    App.flow.reach = reach;
    App.flow.hasOutlet = false;
    if (!findInlet()) return false;

    var net = Validate.buildConnectivity();
    var sg = Validate.buildSegmentGraph(net);
    var stagnant = Validate.findStagnantSegs(sg);
    var solved = Validate.solveDirections(net);
    var conflict = {};
    solved.conflicts.forEach(function (cf) { conflict[cf.compId] = true; });

    // junction BFS over sound segments, seeded from every node carrying the
    // given mark kind ('ins' or 'outs')
    function spreadFrom(kind) {
      var node = {}, seg = {};
      var queue = [];
      Object.keys(sg.nodeMarks).forEach(function (n) {
        if (sg.nodeMarks[n][kind] > 0) { node[n] = true; queue.push(n); }
      });
      while (queue.length) {
        var n = queue.shift();
        (sg.segAdj[n] || []).forEach(function (i) {
          if (seg[i]) return;
          var s = sg.segs[i];
          if (stagnant[i] || conflict[s.pipe.id]) return;
          seg[i] = s.ra === n ? 1 : -1;        // spread ra->rb = f0->f1 = +1
          var o = s.ra === n ? s.rb : s.ra;
          if (!node[o]) { node[o] = true; queue.push(o); }
        });
      }
      return { node: node, seg: seg };
    }

    // Water is only guaranteed to MOVE where a segment lies on some
    // inlet->outlet path: reachable from an inlet AND from an outlet. A
    // dead-ended spur, or a detached piece carrying a lone IN mark, fills up
    // but has no through-flow — it must not animate.
    var fromIn = spreadFrom('ins'), fromOut = spreadFrom('outs');
    var liveNode = {}, liveSeg = {};
    Object.keys(fromIn.seg).forEach(function (i) {
      if (fromOut.seg[i]) liveSeg[i] = fromIn.seg[i];   // keep the inlet-side direction
    });

    // prune dead-end spurs: a live segment ending at an unmarked junction with
    // no other live segment is a cul-de-sac — water fills it but never moves
    var pruned = true;
    while (pruned) {
      pruned = false;
      Object.keys(liveSeg).forEach(function (i) {
        var s = sg.segs[i];
        [s.ra, s.rb].forEach(function (n) {
          if (!liveSeg[i]) return;
          var mk = sg.nodeMarks[n];
          if (mk && (mk.ins > 0 || mk.outs > 0)) return;
          var deg = (sg.segAdj[n] || []).filter(function (j) { return liveSeg[j]; }).length;
          if (deg === 1) { delete liveSeg[i]; pruned = true; }
        });
      });
    }

    Object.keys(liveSeg).forEach(function (i) {
      var s = sg.segs[i];
      liveNode[s.ra] = true; liveNode[s.rb] = true;
    });

    // water reaching a marked outlet junction?
    Object.keys(sg.nodeMarks).forEach(function (n) {
      if (sg.nodeMarks[n].outs > 0 && liveNode[n] &&
          (sg.segAdj[n] || []).some(function (i) { return liveSeg[i]; })) {
        App.flow.hasOutlet = true;
      }
    });

    // pipes: animate their live sub-segments. The solver's pipe direction only
    // holds if the whole run is sound — a stagnant segment elsewhere on the
    // pipe invalidates it (the constraint travelled through dead water), so
    // those segments use the direction the water actually spread in.
    var stagnantPipe = {};
    Object.keys(stagnant).forEach(function (i) { stagnantPipe[sg.segs[i].pipe.id] = true; });
    Object.keys(liveSeg).forEach(function (i) {
      var s = sg.segs[i];
      var sgn = (!stagnantPipe[s.pipe.id] && solved.pipeSign[s.pipe.id] !== undefined)
        ? solved.pipeSign[s.pipe.id] : liveSeg[i];
      var r = reach[s.pipe.id];
      if (!r) r = reach[s.pipe.id] = { sign: sgn, vel: velocityFor(s.pipe.size), segs: [] };
      r.segs.push([s.f0, s.f1, sgn]);
    });
    Object.keys(reach).forEach(function (id) {
      var r = reach[id];
      if (r.segs.length === 1 && r.segs[0][0] === 0 && r.segs[0][1] === 1) {
        r.sign = r.segs[0][2];
        delete r.segs;
      }
    });

    // fittings: animate when their junction actually carries water. A branch
    // stub only carries water when its TIP side flows — its host run flowing
    // past the tap doesn't move the water standing in the stub — and tip and
    // tap collapse to one node, so test for a live segment off the host pipe.
    App.components.forEach(function (c) {
      if (c.type === 'pipe') return;
      var n = sg.compNode[c.id];
      if (n === undefined || !liveNode[n]) return;
      var host = c.type === 'branch' ? Comp.hostPipeAt(c.pos) : null;
      var carries = (sg.segAdj[n] || []).some(function (i) {
        return liveSeg[i] && (!host || sg.segs[i].pipe !== host);
      });
      if (!carries) return;
      var sign = 1;
      if (c.type === 'elbow' && solved.fitSign[c.id] !== undefined) sign = solved.fitSign[c.id];
      reach[c.id] = { sign: sign, vel: velocityFor(c.type === 'reducer' ? c.smallSize : c.size) };
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
      Comp.strokeFlowPath(ctx, c, App.flow.t, r.sign, r.segs);
    });
  }

  // Re-derive reach after edits while running.
  function refresh() { if (App.flow.running) compute(); }

  window.Flow = {
    start: start, stop: stop, tick: tick, drawOverlay: drawOverlay,
    compute: compute, refresh: refresh, findInlet: findInlet, velocityFor: velocityFor
  };
})();
