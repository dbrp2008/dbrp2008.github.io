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
      drag = { kind: 'pan', sx: m.x, sy: m.y, panX: App.view.panX, panY: App.view.panY };
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;

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
      App.dirty = true;
      History.capture();
      drag = {
        kind: 'move', comp: hit, moved: false, m0: m,
        grab: { x: w.x - hit.pos.x, y: w.y - hit.pos.y }
      };
      Panel.refresh();
      return;
    }

    if (App.selection !== null) { App.selection = null; App.dirty = true; Panel.refresh(); }
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
    if (drag.kind === 'palette') {
      if (ghost) {
        var g = Grid.snap(w);
        ghost.pos.x = g.x; ghost.pos.y = g.y;
        ghost._offscreen = !overCanvas(e);
      }
      return;
    }
    if (drag.kind === 'move') {
      var c = drag.comp;
      var g2 = Grid.snap({ x: w.x - drag.grab.x, y: w.y - drag.grab.y });
      if (g2.x !== c.pos.x || g2.y !== c.pos.y) {
        var ox = c.pos.x, oy = c.pos.y;
        c.pos.x = g2.x; c.pos.y = g2.y;
        if (Comp.pipeOverlapsOther(c)) { c.pos.x = ox; c.pos.y = oy; }  // refuse to overlap a pipe
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

    if (d.kind === 'palette') {
      if (ghost && !ghost._offscreen && overCanvas(e)) {
        if (ghost.type === 'branch') {
          if (!Comp.hostPipeAt(ghost.pos)) {
            Panel.setFlowStatus('A branch must be dropped on a pipe, between its two ends.');
          } else {
            History.capture();
            delete ghost._offscreen;
            PipeState.addComp(ghost);
            App.selection = ghost.id;
            History.commit();
            Panel.refresh();
          }
        } else if (Comp.pipeOverlapsOther(ghost)) {
          Panel.setFlowStatus('Cannot place a pipe overlapping another pipe.');
        } else {
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
        History.commit();
      } else {
        History.abort();
        // plain click: offer flange-pair split
        if (d.kind === 'move' && d.comp.type === 'flange' && Comp.flangeMate(d.comp)) {
          showSplitPopover(d.comp);
        }
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
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && App.selection) {
      History.capture();
      PipeState.removeComp(App.selection);
      History.commit();
      Panel.refresh();
    } else if (e.key === 'Escape') {
      App.selection = null; App.dirty = true; Panel.refresh(); hidePopover();
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

  /* ---------- flange split popover ---------- */

  function showSplitPopover(flange) {
    var p = Grid.toScreen(flange.pos.x, flange.pos.y);
    popover.innerHTML = '';
    var btn = document.createElement('button');
    btn.textContent = 'Split flange pair';
    btn.addEventListener('click', function () {
      splitFlangePair(flange);
      hidePopover();
    });
    popover.appendChild(btn);
    popover.style.display = 'block';
    popover.style.left = (p.x + 14) + 'px';
    popover.style.top = (p.y - 14) + 'px';
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

  window.Editor = { init: init, render: render, hidePopover: hidePopover, splitFlangePair: splitFlangePair };
})();
