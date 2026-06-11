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

    // Branches tee into whatever pipe they sit on — add a virtual edge linking the
    // branch to its host pipe at the attach point so flow/diameter logic treats them
    // as connected, without affecting the branch's own (real) port at its tip.
    App.components.forEach(function (c) {
      if (c.type !== 'branch') return;
      var host = Comp.hostPipeAt(c.pos);
      if (!host) return;
      edges.push({
        a: { p: c.pos, dir: Comp.oppKey(c.rot), comp: c, size: c.size, virtual: true },
        b: { p: c.pos, dir: Comp.dirKey(c.rot), comp: host, size: host.size, virtual: true }
      });
    });

    return { edges: edges, openPorts: openPorts, portsByPoint: byPoint };
  }

  function odOf(sizeKey) { return PipeState.sizeOD(sizeKey); }

  function isPortConnected(net, compId, end) {
    return net.edges.some(function (e) {
      return (e.a.comp.id === compId && e.a.end === end) || (e.b.comp.id === compId && e.b.end === end);
    });
  }

  function run() {
    var issues = [];
    var net = buildConnectivity();
    var fam = App.settings.family, sch = App.settings.schedule;

    // -1. a pipe end that becomes connected to another component can no longer be an
    // open inlet/outlet — clear any stale mark automatically (e.g. extending an outlet pipe).
    App.components.forEach(function (c) {
      if (c.type !== 'pipe' || !c.endMarks) return;
      for (var e = 0; e < 2; e++) {
        if (c.endMarks[e] && isPortConnected(net, c.id, e)) c.endMarks[e] = null;
      }
    });

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

    // 0. a single pipe can't have both ends marked inlet — flow can't flow away
    // from both ends of the same run at once.
    App.components.forEach(function (c) {
      if (c.type === 'pipe' && c.endMarks &&
          c.endMarks[0] && c.endMarks[0].kind === 'inlet' &&
          c.endMarks[1] && c.endMarks[1].kind === 'inlet') {
        issues.push({ compId: c.id, level: 'error', msg: 'Both ends of this pipe are marked as inlet — they would flow in opposite directions' });
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
      // virtual branch<->host-pipe edges represent a tee tap, where a smaller branch
      // size is normal — skip the diameter check for these.
      if (e.a.virtual || e.b.virtual) return;
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

    // 6a. branch/lock points must sit on a pipe's interior (not its own ends)
    App.components.forEach(function (c) {
      if (c.type !== 'branch') return;
      if (!Comp.hostPipeAt(c.pos)) {
        issues.push({ compId: c.id, level: 'error', msg: 'Branch at (' + c.pos.x + ',' + c.pos.y + ') is not sitting on a pipe' });
      }
    });

    // 6. multiple outlets in one continuous (connected) pipe run — the flow sim
    // only follows a single path from the inlet, so more than one outlet is invalid.
    // (Multiple inlets are fine: each inlet-marked pipe is forced to flow away
    // from its own inlet end, so several feeds can merge into one network.)
    var outletEnds = [];
    App.components.forEach(function (c) {
      if (c.type === 'pipe' && c.endMarks) {
        c.endMarks.forEach(function (m, idx) { if (m && m.kind === 'outlet') outletEnds.push({ comp: c, end: idx }); });
      }
    });
    if (outletEnds.length > 1) {
      var adj = {};
      net.edges.forEach(function (e) {
        (adj[e.a.comp.id] = adj[e.a.comp.id] || []).push(e.b.comp.id);
        (adj[e.b.comp.id] = adj[e.b.comp.id] || []).push(e.a.comp.id);
      });
      var compGroup = function (startId) {
        var seen = {}; var stack = [startId]; seen[startId] = true;
        while (stack.length) {
          var id = stack.pop();
          (adj[id] || []).forEach(function (n) { if (!seen[n]) { seen[n] = true; stack.push(n); } });
        }
        return seen;
      };
      outletEnds.forEach(function (o) {
        var grp = compGroup(o.comp.id);
        var countInGrp = outletEnds.filter(function (other) { return grp[other.comp.id]; }).length;
        if (countInGrp > 1) {
          issues.push({ compId: o.comp.id, level: 'error', msg: 'Multiple outlets in one continuous pipe run — only one outlet is supported per network' });
        }
      });
    }

    // 7. contradicting inlets — propagate flow direction from every inlet end
    // through series connections (pipe-pipe, flanges, elbows, reducers). Branch
    // taps are skipped: a tee feed merges into whatever way the host run flows,
    // so it never dictates direction. If two inlets force opposite directions on
    // the same pipe (e.g. both ends of one continuous run marked IN), flag it.
    var dirAdj = {};
    net.edges.forEach(function (e) {
      if (e.a.virtual || e.b.virtual) return;
      (dirAdj[e.a.comp.id] = dirAdj[e.a.comp.id] || []).push({ own: e.a, other: e.b });
      (dirAdj[e.b.comp.id] = dirAdj[e.b.comp.id] || []).push({ own: e.b, other: e.a });
    });
    var pipeSign = {};          // pipe id -> +1 (flows e0->e1) | -1
    var conflictFlagged = {};
    var seenFit = {};           // 'id@dir' fitting visits, to stop loops
    var enterComp = function (port, queue) {
      var c = port.comp;
      if (c.type === 'pipe') {
        queue.push({ pipe: c, sign: port.end === 0 ? 1 : -1 });
      } else {
        var key = c.id + '@' + port.dir;
        if (seenFit[key]) return;
        seenFit[key] = true;
        queue.push({ fit: c, enteredDir: port.dir });
      }
    };
    var propagate = function (startPipe, startEnd) {
      var queue = [{ pipe: startPipe, sign: startEnd === 0 ? 1 : -1 }];
      while (queue.length) {
        var cur = queue.shift();
        if (cur.pipe) {
          var p = cur.pipe;
          if (pipeSign[p.id] !== undefined) {
            if (pipeSign[p.id] !== cur.sign && !conflictFlagged[p.id]) {
              conflictFlagged[p.id] = true;
              issues.push({ compId: p.id, level: 'error', msg: 'Contradicting inlets — two inlets push flow in opposite directions through the same run' });
            }
            continue;
          }
          pipeSign[p.id] = cur.sign;
          var exitEnd = cur.sign === 1 ? 1 : 0;
          (dirAdj[p.id] || []).forEach(function (link) {
            if (link.own.end === exitEnd) enterComp(link.other, queue);
          });
        } else {
          // fitting: flow entered at enteredDir, exits at every other port
          (dirAdj[cur.fit.id] || []).forEach(function (link) {
            if (link.own.dir !== cur.enteredDir) enterComp(link.other, queue);
          });
        }
      }
    };
    App.components.forEach(function (c) {
      if (c.type !== 'pipe' || !c.endMarks) return;
      c.endMarks.forEach(function (m, e) {
        if (m && m.kind === 'inlet') propagate(c, e);
      });
    });

    App.issues = issues;
    App.dirty = true;
    return issues;
  }

  window.Validate = { run: run, buildConnectivity: buildConnectivity, ptKey: ptKey };
})();
