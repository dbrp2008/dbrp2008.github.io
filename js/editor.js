/* Canvas editor: palette drag-drop, selection, move, Slides-style rotation handle
 * (45° snap), pipe endpoint resizing, double-click delete, pan/zoom, popover for
 * flange pair splitting, and the main 2D render pass.
 */
(function () {
  'use strict';

  var canvas, ctx, popover;
  var drag = null;       // active drag descriptor
  var ghost = null;      // palette-drag preview component
  var hoverPt = null;
  var lassoArmed = false;   // next left-drag draws a circle-select lasso

  var ROT_HANDLE_DIST = 28;

  function init() {
    canvas = document.getElementById('canvas2d');
    ctx = canvas.getContext('2d');
    popover = document.getElementById('popover');

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('dblclick', onDblClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    document.querySelectorAll('.palette-item').forEach(function (el) {
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        var w = { x: 0, y: 0 };
        ghost = PipeState.newComponent(el.dataset.type, w.x, w.y);
        ghost._offscreen = true;
        drag = { kind: 'palette' };
        hidePopover();
      });
    });

    window.addEventListener('keydown', onKeyDown);
  }

  function mousePos(e) {
    var r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function snap45(deg) { return Comp.norm(Math.round(deg / 45) * 45); }

  // A branch lying ALONG its host run is always wrong — stand it up perpendicular.
  // Branches already across the run (either side) are left as the user set them.
  function orientBranch(b) {
    var host = Comp.hostPipeAt(b.pos);
    if (host && Comp.norm(b.rot - host.rot) % 180 === 0) b.rot = Comp.norm(host.rot + 90);
  }

  // Everything connected to c through mating ports (and branch taps) — the rigid
  // assembly that moves together when c is dragged.
  function connectedGroup(c) {
    var adj = {};
    Validate.buildConnectivity().edges.forEach(function (e) {
      (adj[e.a.comp.id] = adj[e.a.comp.id] || []).push(e.b.comp.id);
      (adj[e.b.comp.id] = adj[e.b.comp.id] || []).push(e.a.comp.id);
    });
    var seen = {}; seen[c.id] = true;
    var out = [c], stack = [c.id];
    while (stack.length) {
      (adj[stack.pop()] || []).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        var o = PipeState.getComp(id);
        if (o) { out.push(o); stack.push(id); }
      });
    }
    return out;
  }

  function stepLen(rot) { return Comp.norm(rot) % 90 === 0 ? 1 : Math.SQRT2; }

  /* ---------- selection chrome geometry ---------- */

  function rotHandlePos(c) {
    var bb = Comp.screenBBox(c);
    return { x: (bb.minx + bb.maxx) / 2, y: bb.miny - ROT_HANDLE_DIST };
  }

  function pipeEndHandles(c) {
    return Comp.pipeEnds(c).map(function (e) { return Grid.toScreen(e.x, e.y); });
  }

  /* ---------- events ---------- */

  function onMouseDown(e) {
    if (App.mode !== '2d') return;
    var m = mousePos(e);
    var w = Grid.toWorld(m.x, m.y);
    hidePopover();

    if (e.button === 1 || e.button === 2) {
      // right-click on a joint: offer to separate it; anywhere else: pan
      if (e.button === 2 && showSeparatePopover(m)) { e.preventDefault(); return; }
      drag = { kind: 'pan', sx: m.x, sy: m.y, panX: App.view.panX, panY: App.view.panY };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

    if (lassoArmed) {
      drag = { kind: 'lasso', pts: [m] };
      return;
    }

    var sel = PipeState.selected();
    if (sel) {
      var rh = rotHandlePos(sel);
      if (Math.hypot(m.x - rh.x, m.y - rh.y) <= 11) {
        History.capture();
        drag = { kind: 'rotate', comp: sel, moved: false };
        return;
      }
      if (sel.type === 'pipe') {
        var ends = pipeEndHandles(sel);
        for (var i = 0; i < 2; i++) {
          if (Math.hypot(m.x - ends[i].x, m.y - ends[i].y) <= 9) {
            History.capture();
            drag = { kind: 'resize', comp: sel, end: i, moved: false };
            return;
          }
        }
      }
    }

    var hit = hitAt(w);
    if (hit) {
      App.selection = hit.id;
      App.multiSel = [];
      App.dirty = true;
      History.capture();
      drag = {
        kind: 'move', comp: hit, members: connectedGroup(hit), moved: false, m0: m,
        grab: { x: w.x - hit.pos.x, y: w.y - hit.pos.y }
      };
      Panel.refresh();
      return;
    }

    if (App.selection !== null || (App.multiSel && App.multiSel.length)) {
      App.selection = null; App.multiSel = []; App.dirty = true; Panel.refresh();
    }
    drag = { kind: 'pan', sx: m.x, sy: m.y, panX: App.view.panX, panY: App.view.panY };
  }

  // Fittings sit on top of pipes visually, so hit-test them first.
  function hitAt(w) {
    var fittings = [], pipes = [];
    App.components.forEach(function (c) { (c.type === 'pipe' ? pipes : fittings).push(c); });
    var lists = [fittings, pipes];
    for (var li = 0; li < 2; li++) {
      var list = lists[li];
      for (var i = list.length - 1; i >= 0; i--) {
        if (Comp.hitTest(list[i], w)) return list[i];
      }
    }
    return null;
  }

  function onMouseMove(e) {
    var m = mousePos(e);
    var w = Grid.toWorld(m.x, m.y);
    hoverPt = m;

    if (!drag) {
      if (App.mode === '2d') updateCursor(m, w);
      return;
    }
    App.dirty = true;

    if (drag.kind === 'pan') {
      App.view.panX = drag.panX + (m.x - drag.sx);
      App.view.panY = drag.panY + (m.y - drag.sy);
      return;
    }
    if (drag.kind === 'lasso') {
      var lp = drag.pts[drag.pts.length - 1];
      if (Math.hypot(m.x - lp.x, m.y - lp.y) > 4) drag.pts.push(m);
      return;
    }
    if (drag.kind === 'palette') {
      if (ghost) {
        var g = Grid.snap(w);
        ghost.pos.x = g.x; ghost.pos.y = g.y;
        if (ghost.type === 'branch') orientBranch(ghost);
        ghost._offscreen = !overCanvas(e);
      }
      return;
    }
    if (drag.kind === 'move') {
      var c = drag.comp;
      var g2 = Grid.snap({ x: w.x - drag.grab.x, y: w.y - drag.grab.y });
      var mdx = g2.x - c.pos.x, mdy = g2.y - c.pos.y;
      if (mdx !== 0 || mdy !== 0) {
        drag.members.forEach(function (mm) { mm.pos.x += mdx; mm.pos.y += mdy; });
        // group keeps its internal geometry, so only outside pipes can clash
        var clash = drag.members.some(function (mm) { return Comp.pipeOverlapsOther(mm); });
        if (clash) drag.members.forEach(function (mm) { mm.pos.x -= mdx; mm.pos.y -= mdy; });
        else drag.moved = true;
      }
      return;
    }
    if (drag.kind === 'rotate') {
      var rc = drag.comp;
      var center = Comp.compCenter(rc);
      var cs = Grid.toScreen(center.x, center.y);
      var ang = Math.atan2(m.y - cs.y, m.x - cs.x) * 180 / Math.PI;
      var newRot = snap45(ang + 90);   // handle points "up" at rot 0
      if (newRot !== Comp.norm(rc.rot)) {
        var orot = rc.rot; rc.rot = newRot;
        if (Comp.pipeOverlapsOther(rc)) rc.rot = orot;
        else drag.moved = true;
      }
      return;
    }
    if (drag.kind === 'resize') {
      var p = drag.comp;
      var u = Comp.unitVec(p.rot);
      var s = Comp.stepVec(p.rot);
      var sl = stepLen(p.rot);
      var t = ((w.x - p.pos.x) * u.x + (w.y - p.pos.y) * u.y) / sl;  // GU steps along axis
      if (drag.end === 1) {
        var nl = Math.max(1, Math.round(t));
        if (nl !== p.lengthGU) {
          var ol = p.lengthGU; p.lengthGU = nl;
          if (Comp.pipeOverlapsOther(p)) p.lengthGU = ol;   // don't grow into another pipe
          else drag.moved = true;
        }
      } else {
        var shift = Math.min(p.lengthGU - 1, Math.round(t));
        if (shift !== 0) {
          var px = p.pos.x, py = p.pos.y, pl = p.lengthGU;
          p.pos.x += s.x * shift; p.pos.y += s.y * shift;
          p.lengthGU -= shift;
          if (Comp.pipeOverlapsOther(p)) { p.pos.x = px; p.pos.y = py; p.lengthGU = pl; }
          else drag.moved = true;
        }
      }
      return;
    }
  }

  function overCanvas(e) {
    var r = canvas.getBoundingClientRect();
    return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
  }

  function onMouseUp(e) {
    if (!drag) return;
    var d = drag;
    drag = null;

    if (d.kind === 'lasso') {
      setLasso(false);
      if (d.pts.length >= 3) {
        var ids = [];
        App.components.forEach(function (c) {
          var ct = Comp.compCenter(c);
          if (pointInPoly(Grid.toScreen(ct.x, ct.y), d.pts)) ids.push(c.id);
        });
        if (ids.length === 1) { App.selection = ids[0]; App.multiSel = []; }
        else { App.multiSel = ids; App.selection = null; }
        Panel.refresh();
      }
      App.dirty = true;
      return;
    }

    if (d.kind === 'palette') {
      if (ghost && !ghost._offscreen && overCanvas(e)) {
        if (Comp.pipeOverlapsOther(ghost)) {
          Panel.setFlowStatus('Cannot place a pipe overlapping another pipe.');
        } else {
          if (ghost.type === 'branch' && !Comp.hostPipeAt(ghost.pos)) {
            Panel.setFlowStatus('Branch placed off-pipe — move it onto a pipe run to tap in.');
          }
          History.capture();
          delete ghost._offscreen;
          PipeState.addComp(ghost);
          App.selection = ghost.id;
          History.commit();
          Panel.refresh();
        }
      }
      ghost = null;
      App.dirty = true;
      return;
    }
    if (d.kind === 'move' || d.kind === 'rotate' || d.kind === 'resize') {
      if (d.moved) {
        // only when moved alone — rotating would tear it off parts dragged with it
        if (d.kind === 'move' && d.comp.type === 'branch' && d.members.length === 1) orientBranch(d.comp);
        History.commit();
      } else {
        History.abort();
      }
      Panel.refresh();
      App.dirty = true;
    }
  }

  function onDblClick(e) {
    if (App.mode !== '2d') return;
    var w = Grid.toWorld(mousePos(e).x, mousePos(e).y);
    var hit = hitAt(w);
    if (hit) {
      History.capture();
      PipeState.removeComp(hit.id);
      History.commit();
      Panel.refresh();
    }
  }

  function onWheel(e) {
    if (App.mode !== '2d') return;
    e.preventDefault();
    var m = mousePos(e);
    Grid.zoomAt(m.x, m.y, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }

  function onKeyDown(e) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault(); History.undo(); Panel.refresh();
    } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
      e.preventDefault(); History.redo(); Panel.refresh();
    } else if ((e.key === 'Delete' || e.key === 'Backspace') &&
               (App.selection || (App.multiSel && App.multiSel.length))) {
      History.capture();
      if (App.multiSel && App.multiSel.length) {
        App.multiSel.forEach(function (id) { PipeState.removeComp(id); });
        App.multiSel = [];
      } else {
        PipeState.removeComp(App.selection);
      }
      History.commit();
      Panel.refresh();
    } else if (e.key === 'Escape') {
      App.selection = null; App.multiSel = []; setLasso(false);
      App.dirty = true; Panel.refresh(); hidePopover();
    } else if (e.key.toLowerCase() === 'r' && App.selection) {
      var c = PipeState.selected();
      History.capture();
      var orot = c.rot;
      c.rot = Comp.norm(c.rot + 45);
      if (Comp.pipeOverlapsOther(c)) { c.rot = orot; History.abort(); }
      else History.commit();
      Panel.refresh();
    }
  }

  function updateCursor(m, w) {
    if (lassoArmed) { canvas.style.cursor = 'crosshair'; return; }
    var sel = PipeState.selected();
    if (sel) {
      var rh = rotHandlePos(sel);
      if (Math.hypot(m.x - rh.x, m.y - rh.y) <= 11) { canvas.style.cursor = 'grab'; return; }
      if (sel.type === 'pipe') {
        var ends = pipeEndHandles(sel);
        for (var i = 0; i < 2; i++) {
          if (Math.hypot(m.x - ends[i].x, m.y - ends[i].y) <= 9) { canvas.style.cursor = 'ew-resize'; return; }
        }
      }
    }
    canvas.style.cursor = hitAt(w) ? 'pointer' : 'default';
  }

  /* ---------- lasso (circle) selection ---------- */

  function setLasso(on) {
    lassoArmed = on;
    var btn = document.getElementById('btnLasso');
    if (btn) btn.classList.toggle('active', on);
    if (on) { App.selection = null; Panel.refresh(); }
    App.dirty = true;
  }

  function toggleLasso() { setLasso(!lassoArmed); return lassoArmed; }

  function pointInPoly(p, pts) {
    var inside = false;
    for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      if ((pts[i].y > p.y) !== (pts[j].y > p.y) &&
          p.x < (pts[j].x - pts[i].x) * (p.y - pts[i].y) / (pts[j].y - pts[i].y) + pts[i].x) {
        inside = !inside;
      }
    }
    return inside;
  }

  function drawLasso() {
    if (!drag || drag.kind !== 'lasso' || drag.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#5b9dff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(drag.pts[0].x, drag.pts[0].y);
    drag.pts.forEach(function (p) { ctx.lineTo(p.x, p.y); });
    ctx.closePath();
    ctx.fillStyle = 'rgba(91,157,255,0.07)';
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  function drawMultiSel() {
    if (!App.multiSel || !App.multiSel.length) return;
    ctx.save();
    ctx.strokeStyle = '#5b9dff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    App.multiSel.forEach(function (id) {
      var c = PipeState.getComp(id);
      if (!c) return;
      var bb = Comp.screenBBox(c);
      ctx.strokeRect(bb.minx, bb.miny, bb.maxx - bb.minx, bb.maxy - bb.miny);
    });
    ctx.restore();
  }

  /* ---------- joint separation popover ---------- */

  function compLabel(c) {
    return c.type.charAt(0).toUpperCase() + c.type.slice(1) + ' #' + c.id;
  }

  // All components on fromComp's side of the joint when the edges matching
  // skipFn are cut — the sub-assembly that stays locked together after
  // separating there.
  function sideMembers(edges, fromComp, skipFn) {
    var adj = {};
    edges.forEach(function (ed) {
      if (skipFn(ed)) return;
      (adj[ed.a.comp.id] = adj[ed.a.comp.id] || []).push(ed.b.comp.id);
      (adj[ed.b.comp.id] = adj[ed.b.comp.id] || []).push(ed.a.comp.id);
    });
    var seen = {}; seen[fromComp.id] = true;
    var out = [fromComp], stack = [fromComp.id];
    while (stack.length) {
      (adj[stack.pop()] || []).forEach(function (id) {
        if (seen[id]) return;
        seen[id] = true;
        var o = PipeState.getComp(id);
        if (o) { out.push(o); stack.push(id); }
      });
    }
    return out;
  }

  // Break a joint: pull one side back one grid step, away from the joint, with
  // everything on that side moving as one piece. Retreating from the joint
  // point physically parts ALL connections there, so the sides are computed
  // with every edge at that point cut (e.g. at pipe-flange-pipe joints the two
  // pipes also mate directly — cutting a single edge could never part them).
  function separateEdge(ed, edges) {
    var pk = ed.a.p.x + ',' + ed.a.p.y;
    var atJoint = function (e2) { return (e2.a.p.x + ',' + e2.a.p.y) === pk; };
    var sideA = sideMembers(edges, ed.a.comp, atJoint);
    var inA = {};
    sideA.forEach(function (c) { inA[c.id] = true; });
    if (inA[ed.b.comp.id]) {
      Panel.setFlowStatus('These parts are also connected through another path — separate that joint too.');
      return;
    }
    var sideB = sideMembers(edges, ed.b.comp, atJoint);

    function tryMove(side, port) {
      var dv = port.dir.split(',').map(Number);   // port faces its neighbour
      var dx = -dv[0], dy = -dv[1];               // so retreat the other way
      side.forEach(function (c) { c.pos.x += dx; c.pos.y += dy; });
      if (side.some(function (c) { return Comp.pipeOverlapsOther(c); })) {
        side.forEach(function (c) { c.pos.x -= dx; c.pos.y -= dy; });
        return false;
      }
      return true;
    }

    History.capture();
    // a branch tap retreats off its host run (virtual edges put the branch on
    // side a); otherwise pull back whichever side carries less with it
    var first = (ed.a.virtual || sideA.length <= sideB.length)
      ? { side: sideA, port: ed.a } : { side: sideB, port: ed.b };
    var second = first.side === sideA
      ? { side: sideB, port: ed.b } : { side: sideA, port: ed.a };
    if (tryMove(first.side, first.port) || tryMove(second.side, second.port)) {
      History.commit();
      App.dirty = true;
      Panel.refresh();
    } else {
      History.abort();
      Panel.setFlowStatus('No room to separate here — clear some space first.');
    }
  }

  // Returns true if any joint was close enough to offer separation.
  function showSeparatePopover(m) {
    var edges = Validate.buildConnectivity().edges;
    var opts = [];
    edges.forEach(function (ed) {
      var sp = Grid.toScreen(ed.a.p.x, ed.a.p.y);
      var dist = Math.hypot(m.x - sp.x, m.y - sp.y);
      if (dist <= 20) opts.push({ edge: ed, dist: dist });
    });
    if (!opts.length) return false;
    opts.sort(function (x, y) { return x.dist - y.dist; });

    popover.innerHTML = '';
    opts.slice(0, 4).forEach(function (o) {
      var btn = document.createElement('button');
      btn.textContent = 'Separate ' + compLabel(o.edge.a.comp) + ' ↔ ' + compLabel(o.edge.b.comp);
      btn.addEventListener('click', function () {
        separateEdge(o.edge, edges);
        hidePopover();
      });
      popover.appendChild(btn);
    });
    popover.style.display = 'block';
    popover.style.left = (m.x + 14) + 'px';
    popover.style.top = (m.y - 14) + 'px';
    return true;
  }

  function splitFlangePair(flange) {
    var mate = Comp.flangeMate(flange);
    if (!mate) return;
    History.capture();
    var s = Comp.stepVec(mate.rot);
    mate.pos.x += s.x; mate.pos.y += s.y;
    History.commit();
    App.dirty = true;
    Panel.refresh();
  }

  function hidePopover() { if (popover) popover.style.display = 'none'; }

  /* ---------- render ---------- */

  function render() {
    var w = canvas.width, h = canvas.height;
    Grid.drawGrid(ctx, w, h);

    // pipes underneath, fittings on top
    var pipes = [], fittings = [];
    App.components.forEach(function (c) { (c.type === 'pipe' ? pipes : fittings).push(c); });
    pipes.forEach(function (c) { Comp.drawComponent(ctx, c); });

    if (App.flow.running) Flow.drawOverlay(ctx);

    fittings.forEach(function (c) { Comp.drawComponent(ctx, c); });

    if (ghost && !ghost._offscreen) Comp.drawComponent(ctx, ghost, { ghost: true });

    drawPorts();
    drawIssueBadges();
    drawSelection();
    drawMultiSel();
    drawLasso();
  }

  // Connection nodes: every component port gets a small marker, nudged outward along
  // its facing direction. Open ports (nothing mating) show as bright amber rings so the
  // user can see exactly where to bring another part's end; connected ports show as small
  // green dots. This makes the "ends must meet on the same grid point" rule visible.
  function drawPorts() {
    if (App.view.zoom < 18) return;
    var byPoint = {};
    App.components.forEach(function (c) {
      Comp.getPorts(c).forEach(function (pt) {
        var k = pt.p.x + ',' + pt.p.y;
        (byPoint[k] = byPoint[k] || []).push(pt);
      });
    });
    function opp(dir) { var a = dir.split(','); return (-a[0]) + ',' + (-a[1]); }

    ctx.save();
    Object.keys(byPoint).forEach(function (k) {
      var list = byPoint[k];
      list.forEach(function (pt) {
        var connected = list.some(function (o) { return o.comp.id !== pt.comp.id && o.dir === opp(pt.dir); });
        var a = pt.dir.split(',').map(Number);
        var len = Math.hypot(a[0], a[1]) || 1;
        var off = 0.17;
        var sp = Grid.toScreen(pt.p.x + a[0] / len * off, pt.p.y + a[1] / len * off);
        if (connected) {
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, Math.max(2.5, App.view.zoom * 0.05), 0, Math.PI * 2);
          ctx.fillStyle = '#39c46c';
          ctx.fill();
        } else {
          var rr = Math.max(4, App.view.zoom * 0.08);
          ctx.beginPath();
          ctx.arc(sp.x, sp.y, rr, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(216,162,60,0.18)';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = '#e0a23c';
          ctx.stroke();
        }
      });
    });
    ctx.restore();
  }

  function drawSelection() {
    var c = PipeState.selected();
    if (!c || App.mode !== '2d') return;
    var bb = Comp.screenBBox(c);

    ctx.save();
    ctx.strokeStyle = '#5b9dff';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.strokeRect(bb.minx, bb.miny, bb.maxx - bb.minx, bb.maxy - bb.miny);
    ctx.setLineDash([]);

    // rotation handle (Slides-style: stem + circle above the box)
    var rh = rotHandlePos(c);
    ctx.beginPath();
    ctx.moveTo((bb.minx + bb.maxx) / 2, bb.miny);
    ctx.lineTo(rh.x, rh.y + 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rh.x, rh.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(rh.x, rh.y, 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#5b9dff';
    ctx.fill();

    // pipe endpoint resize handles
    if (c.type === 'pipe') {
      pipeEndHandles(c).forEach(function (p) {
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#5b9dff';
        ctx.lineWidth = 1.5;
        ctx.fillRect(p.x - 5, p.y - 5, 10, 10);
        ctx.strokeRect(p.x - 5, p.y - 5, 10, 10);
      });
    }
    ctx.restore();
  }

  function drawIssueBadges() {
    if (!App.issues.length) return;
    var byComp = {};
    App.issues.forEach(function (iss) {
      if (iss.compId && !byComp[iss.compId]) byComp[iss.compId] = iss;
    });
    ctx.save();
    Object.keys(byComp).forEach(function (id) {
      var c = PipeState.getComp(+id);
      if (!c) return;
      var ctr = Comp.compCenter(c);
      var p = Grid.toScreen(ctr.x, ctr.y);
      var bx = p.x + 12, by = p.y - 14;
      ctx.beginPath();
      ctx.arc(bx, by, 8, 0, Math.PI * 2);
      ctx.fillStyle = byComp[id].level === 'error' ? '#d84b4b' : '#d8a23c';
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', bx, by + 0.5);
    });
    ctx.restore();
  }

  window.Editor = {
    init: init, render: render, hidePopover: hidePopover,
    splitFlangePair: splitFlangePair, toggleLasso: toggleLasso
  };
})();
