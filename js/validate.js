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

  // Shared flow-direction solver, used by both validation and the flow
  // animation. Propagates the direction forced by every inlet/outlet mark
  // through series connections (pipe-pipe, flanges, elbows, reducers):
  // inlets force flow AWAY from their end, outlets force flow TOWARD theirs,
  // and a fitting passes the constraint through to its other ports — both
  // downstream (where this water goes) and upstream (what must feed it).
  // Branch taps are skipped: a tee can feed or drain its host run without
  // dictating the host's direction.
  // Returns:
  //   pipeSign[id]  +1 (flows end0->end1) | -1, for every constrained pipe
  //   fitSign[id]   elbow animation sign (+1 entered leg1, -1 entered leg2)
  //   conflicts     [{compId}] pipes whose marks force both directions at once
  function solveDirections(net) {
    var dirAdj = {};
    net.edges.forEach(function (e) {
      if (e.a.virtual || e.b.virtual) return;
      (dirAdj[e.a.comp.id] = dirAdj[e.a.comp.id] || []).push({ own: e.a, other: e.b });
      (dirAdj[e.b.comp.id] = dirAdj[e.b.comp.id] || []).push({ own: e.b, other: e.a });
    });
    var pipeSign = {};
    var fitSign = {};
    var conflicts = [];
    var conflictFlagged = {};
    var seenFit = {};           // 'in:/out:id@dir' fitting visits, to stop loops
    // Flow ENTERS comp through this port (constraint travels downstream).
    var enterComp = function (port, queue) {
      var c = port.comp;
      if (c.type === 'pipe') {
        queue.push({ pipe: c, sign: port.end === 0 ? 1 : -1 });
      } else {
        var key = 'in:' + c.id + '@' + port.dir;
        if (seenFit[key]) return;
        seenFit[key] = true;
        if (c.type === 'elbow' && fitSign[c.id] === undefined) {
          fitSign[c.id] = port.dir === Comp.dirKey(c.rot) ? 1 : -1;
        }
        queue.push({ fit: c, enteredDir: port.dir });
      }
    };
    // Flow EXITS comp through this port (constraint travels upstream).
    var exitComp = function (port, queue) {
      var c = port.comp;
      if (c.type === 'pipe') {
        queue.push({ pipe: c, sign: port.end === 1 ? 1 : -1 });
      } else {
        var key = 'out:' + c.id + '@' + port.dir;
        if (seenFit[key]) return;
        seenFit[key] = true;
        if (c.type === 'elbow' && fitSign[c.id] === undefined) {
          // exited through leg1 means it entered through leg2, and vice versa
          fitSign[c.id] = port.dir === Comp.dirKey(c.rot) ? -1 : 1;
        }
        queue.push({ fit: c, exitedDir: port.dir });
      }
    };
    var propagate = function (startPipe, startSign) {
      var queue = [{ pipe: startPipe, sign: startSign }];
      while (queue.length) {
        var cur = queue.shift();
        if (cur.pipe) {
          var p = cur.pipe;
          if (pipeSign[p.id] !== undefined) {
            if (pipeSign[p.id] !== cur.sign && !conflictFlagged[p.id]) {
              conflictFlagged[p.id] = true;
              conflicts.push({ compId: p.id });
            }
            continue;
          }
          pipeSign[p.id] = cur.sign;
          var exitEnd = cur.sign === 1 ? 1 : 0;
          (dirAdj[p.id] || []).forEach(function (link) {
            if (link.own.end === exitEnd) enterComp(link.other, queue);
            else exitComp(link.other, queue);          // upstream neighbour feeds us
          });
        } else if (cur.enteredDir !== undefined) {
          // fitting: flow entered at enteredDir, exits at every other port
          (dirAdj[cur.fit.id] || []).forEach(function (link) {
            if (link.own.dir !== cur.enteredDir) enterComp(link.other, queue);
          });
        } else {
          // fitting: flow exits at exitedDir, so it enters at every other port —
          // the neighbours there are upstream and exit into this fitting
          (dirAdj[cur.fit.id] || []).forEach(function (link) {
            if (link.own.dir !== cur.exitedDir) exitComp(link.other, queue);
          });
        }
      }
    };
    App.components.forEach(function (c) {
      if (c.type !== 'pipe' || !c.endMarks) return;
      c.endMarks.forEach(function (m, e) {
        if (!m) return;
        if (m.kind === 'inlet') propagate(c, e === 0 ? 1 : -1);          // away from inlet end
        else if (m.kind === 'outlet') propagate(c, e === 1 ? 1 : -1);    // toward outlet end
      });
    });
    return { pipeSign: pipeSign, fitSign: fitSign, conflicts: conflicts };
  }

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
    var bothEndsIn = {};
    App.components.forEach(function (c) {
      if (c.type === 'pipe' && c.endMarks &&
          c.endMarks[0] && c.endMarks[0].kind === 'inlet' &&
          c.endMarks[1] && c.endMarks[1].kind === 'inlet') {
        bothEndsIn[c.id] = true;
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

    // 6b. a tee tap can't be larger than the pipe it taps into
    App.components.forEach(function (c) {
      if (c.type !== 'branch') return;
      var host = Comp.hostPipeAt(c.pos);
      if (host && odOf(c.size) > odOf(host.size) + 0.01) {
        issues.push({ compId: c.id, level: 'error', msg: 'Branch (' + c.size + ') is larger than its host pipe (' + host.size + ') — a tap cannot exceed the run size' });
      }
    });

    // 6c. a flange clamped onto a continuous pipe joins nothing — flanges
    // belong at pipe ends (hostPipeAt only matches pipe interiors)
    App.components.forEach(function (c) {
      if (c.type !== 'flange') return;
      if (Comp.hostPipeAt(c.pos)) {
        issues.push({ compId: c.id, level: 'warn', msg: 'Flange at (' + c.pos.x + ',' + c.pos.y + ') sits on a continuous pipe — flanges join two pipe ends' });
      }
    });

    // 6. contradicting inlets/outlets — the direction solver propagates the
    // flow direction forced by every mark through series connections; a pipe
    // forced both ways at once is a genuine contradiction. Branch-fed inlets
    // and branch-fed outlets never conflict (taps don't dictate host direction).
    var solved = solveDirections(net);
    solved.conflicts.forEach(function (cf) {
      if (bothEndsIn[cf.compId]) return;          // already flagged by check 0
      issues.push({ compId: cf.compId, level: 'error', msg: 'Contradicting flow markers — inlet/outlet marks force opposite flow directions through the same run' });
    });

    // 7. a finished network needs both an inlet and an outlet. Group components
    // (taps included), and once a group has no unmarked open ends left — i.e.
    // it's not mid-construction — all-inlet or all-outlet marking is flagged.
    var groupAdj = {};
    net.edges.forEach(function (e) {
      (groupAdj[e.a.comp.id] = groupAdj[e.a.comp.id] || []).push(e.b.comp.id);
      (groupAdj[e.b.comp.id] = groupAdj[e.b.comp.id] || []).push(e.a.comp.id);
    });
    var groupOf = {};
    var nGroups = 0;
    App.components.forEach(function (c) {
      if (groupOf[c.id] !== undefined) return;
      nGroups++;
      var stack = [c.id];
      groupOf[c.id] = nGroups;
      while (stack.length) {
        var id = stack.pop();
        (groupAdj[id] || []).forEach(function (n) {
          if (groupOf[n] === undefined) { groupOf[n] = nGroups; stack.push(n); }
        });
      }
    });
    var groups = {};   // group id -> {ins:[pipe], outs:[pipe], openUnmarked}
    App.components.forEach(function (c) {
      var g = (groups[groupOf[c.id]] = groups[groupOf[c.id]] || { ins: [], outs: [], openUnmarked: 0 });
      if (c.type === 'pipe' && c.endMarks) {
        c.endMarks.forEach(function (m) {
          if (m && m.kind === 'inlet') g.ins.push(c);
          else if (m && m.kind === 'outlet') g.outs.push(c);
        });
      }
    });
    net.openPorts.forEach(function (p) {
      if (p.comp.type === 'pipe' && !(p.comp.endMarks && p.comp.endMarks[p.end])) {
        groups[groupOf[p.comp.id]].openUnmarked++;
      }
    });
    Object.keys(groups).forEach(function (gid) {
      var g = groups[gid];
      if (g.openUnmarked > 0) return;             // still under construction
      if (g.ins.length && !g.outs.length) {
        issues.push({ compId: g.ins[0].id, level: 'warn', msg: 'This network has an inlet but no outlet — water has nowhere to go' });
      } else if (g.outs.length && !g.ins.length) {
        issues.push({ compId: g.outs[0].id, level: 'warn', msg: 'This network has an outlet but no inlet — nothing feeds it' });
      }
    });

    // 8. every section must be guaranteed to carry water — see findStagnantPipes.
    var stagnant = findStagnantPipes(net);
    Object.keys(stagnant).forEach(function (id) {
      issues.push({ compId: +id, level: 'error', msg: 'No guaranteed flow through this section — each side of it already has its own inlet and outlet, so the water here could stand completely still' });
    });

    App.issues = issues;
    App.dirty = true;
    return issues;
  }

  // Pipes with no guaranteed flow. Build a junction graph (pipes split into
  // sub-segments at their tee taps; fittings collapse into their junction) and
  // try cutting each sub-segment: if BOTH halves of the network are
  // self-sufficient — each already has its own inlet AND outlet — then nothing
  // forces water through the cut section, so it could sit completely stagnant.
  // Returns {pipeId: true}.
  function findStagnantPipes(net) {
    var pc = 0, portKey = new Map();
    var pkey = function (p) { if (!portKey.has(p)) portKey.set(p, 'p' + (++pc)); return portKey.get(p); };
    var parent = {};
    var find = function (k) { if (parent[k] === undefined) parent[k] = k; return parent[k] === k ? k : (parent[k] = find(parent[k])); };
    var union = function (a, b) { parent[find(a)] = find(b); };
    var portsOfComp = {};
    Object.keys(net.portsByPoint).forEach(function (k) {
      net.portsByPoint[k].forEach(function (p) {
        (portsOfComp[p.comp.id] = portsOfComp[p.comp.id] || []).push(p);
      });
    });
    App.components.forEach(function (c) {
      var ps = portsOfComp[c.id] || [];
      if (c.type === 'flange' || c.type === 'elbow' || c.type === 'reducer') {
        for (var i = 1; i < ps.length; i++) union(pkey(ps[0]), pkey(ps[i]));   // flow passes through
      } else if (c.type === 'branch') {
        ps.forEach(function (p) { union(pkey(p), 'tap:' + c.id); });           // tip joins the tap point
      }
    });
    net.edges.forEach(function (e) {
      if (e.a.virtual || e.b.virtual) return;
      union(pkey(e.a), pkey(e.b));
    });
    var segEdges = [];
    App.components.forEach(function (c) {
      if (c.type !== 'pipe') return;
      var e0 = null, e1 = null;
      (portsOfComp[c.id] || []).forEach(function (p) {
        if (p.end === 0) e0 = p; else if (p.end === 1) e1 = p;
      });
      if (!e0 || !e1) return;
      var taps = App.components.filter(function (b) {
        return b.type === 'branch' && Comp.hostPipeAt(b.pos) === c;
      });
      taps.sort(function (a, b) {
        return (Math.abs(a.pos.x - e0.p.x) + Math.abs(a.pos.y - e0.p.y)) -
               (Math.abs(b.pos.x - e0.p.x) + Math.abs(b.pos.y - e0.p.y));
      });
      var chain = [pkey(e0)].concat(taps.map(function (b) { return 'tap:' + b.id; })).concat([pkey(e1)]);
      for (var i = 0; i < chain.length - 1; i++) {
        segEdges.push({ pipe: c, a: chain[i], b: chain[i + 1] });
      }
    });
    var nodeMarks = {};
    App.components.forEach(function (c) {
      if (c.type !== 'pipe' || !c.endMarks) return;
      (portsOfComp[c.id] || []).forEach(function (p) {
        var m = c.endMarks[p.end];
        if (!m) return;
        var n = find(pkey(p));
        var nm = (nodeMarks[n] = nodeMarks[n] || { ins: 0, outs: 0 });
        if (m.kind === 'inlet') nm.ins++; else nm.outs++;
      });
    });
    segEdges.forEach(function (s) { s.ra = find(s.a); s.rb = find(s.b); });
    var segAdj = {};
    segEdges.forEach(function (s, i) {
      (segAdj[s.ra] = segAdj[s.ra] || []).push(i);
      (segAdj[s.rb] = segAdj[s.rb] || []).push(i);
    });
    var sideMarks = function (startNode, skipIdx) {
      var seen = {}; seen[startNode] = true;
      var stack = [startNode];
      var res = { ins: 0, outs: 0, nodes: seen };
      while (stack.length) {
        var n = stack.pop();
        if (nodeMarks[n]) { res.ins += nodeMarks[n].ins; res.outs += nodeMarks[n].outs; }
        (segAdj[n] || []).forEach(function (i) {
          if (i === skipIdx) return;
          var s = segEdges[i];
          var o = s.ra === n ? s.rb : s.ra;
          if (!seen[o]) { seen[o] = true; stack.push(o); }
        });
      }
      return res;
    };
    var stagnantFlagged = {};
    segEdges.forEach(function (s, i) {
      if (s.ra === s.rb || stagnantFlagged[s.pipe.id]) return;
      var A = sideMarks(s.ra, i);
      if (A.nodes[s.rb]) return;                  // in a loop — not a clean cut
      var B = sideMarks(s.rb, i);
      if (A.ins && A.outs && B.ins && B.outs) {
        stagnantFlagged[s.pipe.id] = true;
      }
    });
    return stagnantFlagged;
  }

  window.Validate = {
    run: run, buildConnectivity: buildConnectivity, ptKey: ptKey,
    solveDirections: solveDirections, findStagnantPipes: findStagnantPipes
  };
})();
