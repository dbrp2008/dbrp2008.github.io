/* Component geometry, port model, 2D drawing and hit-testing.
 *
 * Port model: every component exposes ports {p:{x,y}, d:{dx,dy}, ...} where p is a
 * grid point and d the outward unit direction (towards where the neighbour's body
 * lies). Two ports connect when they share a grid point and have opposite dirs.
 */
(function () {
  'use strict';

  var SQ = Math.SQRT1_2;
  // rot (deg, 45° steps) -> exact unit vector and integer grid step
  var DIRS = {
    0:   { ux: 1,  uy: 0,  sx: 1,  sy: 0 },
    45:  { ux: SQ, uy: SQ, sx: 1,  sy: 1 },
    90:  { ux: 0,  uy: 1,  sx: 0,  sy: 1 },
    135: { ux: -SQ, uy: SQ, sx: -1, sy: 1 },
    180: { ux: -1, uy: 0,  sx: -1, sy: 0 },
    225: { ux: -SQ, uy: -SQ, sx: -1, sy: -1 },
    270: { ux: 0,  uy: -1, sx: 0,  sy: -1 },
    315: { ux: SQ, uy: -SQ, sx: 1,  sy: -1 }
  };

  function norm(rot) { return ((rot % 360) + 360) % 360; }
  function unitVec(rot) { var d = DIRS[norm(rot)]; return { x: d.ux, y: d.uy }; }
  function stepVec(rot) { var d = DIRS[norm(rot)]; return { x: d.sx, y: d.sy }; }
  function dirKey(rot) { var d = DIRS[norm(rot)]; return d.sx + ',' + d.sy; }
  function oppKey(rot) { return dirKey(rot + 180); }

  function pipeEnds(c) {
    var s = stepVec(c.rot);
    return [
      { x: c.pos.x, y: c.pos.y },
      { x: c.pos.x + s.x * c.lengthGU, y: c.pos.y + s.y * c.lengthGU }
    ];
  }

  // Second elbow leg: outward legs are (180 - bendAngle) apart.
  function elbowLeg2Rot(c) { return norm(c.rot + 180 - c.angle); }

  function getPorts(c) {
    if (c.type === 'pipe') {
      var e = pipeEnds(c);
      return [
        { p: e[0], dir: dirKey(c.rot + 180), comp: c, end: 0, size: c.size },
        { p: e[1], dir: dirKey(c.rot), comp: c, end: 1, size: c.size }
      ];
    }
    if (c.type === 'flange') {
      return [
        { p: c.pos, dir: dirKey(c.rot), comp: c, size: c.size },
        { p: c.pos, dir: dirKey(c.rot + 180), comp: c, size: c.size }
      ];
    }
    if (c.type === 'elbow') {
      return [
        { p: c.pos, dir: dirKey(c.rot), comp: c, size: c.size },
        { p: c.pos, dir: dirKey(elbowLeg2Rot(c)), comp: c, size: c.size }
      ];
    }
    if (c.type === 'reducer') {
      return [
        { p: c.pos, dir: dirKey(c.rot), comp: c, size: c.largeSize, side: 'large' },
        { p: c.pos, dir: dirKey(c.rot + 180), comp: c, size: c.smallSize, side: 'small' }
      ];
    }
    return [];
  }

  function compCenter(c) {
    if (c.type === 'pipe') {
      var e = pipeEnds(c);
      return { x: (e[0].x + e[1].x) / 2, y: (e[0].y + e[1].y) / 2 };
    }
    return { x: c.pos.x, y: c.pos.y };
  }

  // OD in px at current zoom (1 GU = 0.5 m = 500 mm real scale).
  function odPx(odMm) { return Math.max(3, odMm / 500 * App.view.zoom); }

  function matColor(c) {
    var m = PipeStandards.STANDARDS.materials[c.material];
    return m ? m.color : '#8a8f98';
  }

  // Another flange at the same point on the same axis => merged pair.
  function flangeMate(c) {
    if (c.type !== 'flange') return null;
    for (var i = 0; i < App.components.length; i++) {
      var o = App.components[i];
      if (o.id !== c.id && o.type === 'flange' &&
          o.pos.x === c.pos.x && o.pos.y === c.pos.y &&
          norm(o.rot) % 180 === norm(c.rot) % 180) {
        return o;
      }
    }
    return null;
  }

  /* ---------- drawing ---------- */

  function strokeStyleFor(c, opts) {
    if (opts && opts.ghost) return 'rgba(110,170,255,0.55)';
    if (c.condition && c.condition !== 'ok') return '#e06060';
    return matColor(c);
  }

  function drawPipe(ctx, c, opts) {
    var e = pipeEnds(c);
    var a = Grid.toScreen(e[0].x, e[0].y), b = Grid.toScreen(e[1].x, e[1].y);
    var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.size);
    var w = odPx(d ? d.od : 60);

    ctx.lineCap = 'butt';
    // dark outline pass then body pass gives a tube-like look
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = w + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.strokeStyle = strokeStyleFor(c, opts);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // center highlight
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = Math.max(1, w * 0.3);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // inlet/outlet end markers
    for (var i = 0; i < 2; i++) {
      var mark = c.endMarks && c.endMarks[i];
      if (!mark) continue;
      var pt = i === 0 ? a : b;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, Math.max(6, w * 0.7), 0, Math.PI * 2);
      ctx.lineWidth = 3;
      ctx.strokeStyle = mark.kind === 'inlet' ? '#39c46c' : '#e08f3c';
      ctx.stroke();
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = 'bold ' + Math.max(9, App.view.zoom * 0.22) + 'px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(mark.kind === 'inlet' ? 'IN' : 'OUT', pt.x, pt.y - Math.max(9, w * 0.7) - 4);
    }
  }

  function drawFlange(ctx, c, opts) {
    var p = Grid.toScreen(c.pos.x, c.pos.y);
    var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.size);
    var half = Math.max(8, odPx(d ? d.od : 60) * 0.95);
    var u = unitVec(c.rot);
    var px = -u.y, py = u.x;   // perpendicular to facing axis
    var merged = !!flangeMate(c);
    var w = Math.max(4, App.view.zoom * 0.12) * (merged ? 1.9 : 1);

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = w + 2;
    ctx.beginPath();
    ctx.moveTo(p.x - px * half, p.y - py * half);
    ctx.lineTo(p.x + px * half, p.y + py * half);
    ctx.stroke();
    ctx.strokeStyle = opts && opts.ghost ? strokeStyleFor(c, opts) : '#c9a648';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p.x - px * half, p.y - py * half);
    ctx.lineTo(p.x + px * half, p.y + py * half);
    ctx.stroke();

    if (merged) {
      // seam line hint that this is a bolted pair
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(p.x - px * half, p.y - py * half);
      ctx.lineTo(p.x + px * half, p.y + py * half);
      ctx.stroke();
    }
  }

  function elbowArcPts(c) {
    var L = 0.45;
    var u1 = unitVec(c.rot), u2 = unitVec(elbowLeg2Rot(c));
    return {
      a: { x: c.pos.x + u1.x * L, y: c.pos.y + u1.y * L },
      b: { x: c.pos.x + u2.x * L, y: c.pos.y + u2.y * L },
      ctrl: { x: c.pos.x, y: c.pos.y }
    };
  }

  function drawElbow(ctx, c, opts) {
    var pts = elbowArcPts(c);
    var a = Grid.toScreen(pts.a.x, pts.a.y);
    var b = Grid.toScreen(pts.b.x, pts.b.y);
    var q = Grid.toScreen(pts.ctrl.x, pts.ctrl.y);
    var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.size);
    var w = odPx(d ? d.od : 60);

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = w + 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(q.x, q.y, b.x, b.y); ctx.stroke();
    ctx.strokeStyle = strokeStyleFor(c, opts);
    ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(q.x, q.y, b.x, b.y); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, w * 0.3);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(q.x, q.y, b.x, b.y); ctx.stroke();
  }

  function reducerPoly(c) {
    // trapezoid in screen px: base (large end) faces rot, top edge faces rot+180
    var p = Grid.toScreen(c.pos.x, c.pos.y);
    var u = unitVec(c.rot);
    var px = -u.y, py = u.x;
    var dl = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.largeSize);
    var ds = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.smallSize);
    var wL = Math.max(6, odPx(dl ? dl.od : 80) / 2 + 2);
    var wS = Math.max(4, odPx(ds ? ds.od : 50) / 2 + 1);
    var hl = App.view.zoom * 0.32;
    return [
      { x: p.x + u.x * hl + px * wL, y: p.y + u.y * hl + py * wL },
      { x: p.x + u.x * hl - px * wL, y: p.y + u.y * hl - py * wL },
      { x: p.x - u.x * hl - px * wS, y: p.y - u.y * hl - py * wS },
      { x: p.x - u.x * hl + px * wS, y: p.y - u.y * hl + py * wS }
    ];
  }

  function drawReducer(ctx, c, opts) {
    var poly = reducerPoly(c);
    ctx.beginPath();
    ctx.moveTo(poly[0].x, poly[0].y);
    for (var i = 1; i < 4; i++) ctx.lineTo(poly[i].x, poly[i].y);
    ctx.closePath();
    ctx.fillStyle = opts && opts.ghost ? 'rgba(110,170,255,0.35)' : strokeStyleFor(c, opts);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawComponent(ctx, c, opts) {
    if (c.type === 'pipe') drawPipe(ctx, c, opts);
    else if (c.type === 'flange') drawFlange(ctx, c, opts);
    else if (c.type === 'elbow') drawElbow(ctx, c, opts);
    else if (c.type === 'reducer') drawReducer(ctx, c, opts);
  }

  /* ---------- hit testing (world coords in, px tolerances) ---------- */

  function distToSegPx(w, a, b) {
    var z = App.view.zoom;
    var ax = a.x, ay = a.y, bx = b.x, by = b.y;
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? ((w.x - ax) * dx + (w.y - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy;
    return Math.hypot(w.x - cx, w.y - cy) * z;
  }

  function hitTest(c, w) {
    var z = App.view.zoom;
    if (c.type === 'pipe') {
      var e = pipeEnds(c);
      var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.size);
      return distToSegPx(w, e[0], e[1]) <= Math.max(7, odPx(d ? d.od : 60) / 2 + 4);
    }
    var distPx = Math.hypot(w.x - c.pos.x, w.y - c.pos.y) * z;
    if (c.type === 'flange') {
      var dd = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.size);
      return distPx <= Math.max(12, odPx(dd ? dd.od : 60) * 0.95);
    }
    return distPx <= Math.max(14, z * 0.45);   // elbow / reducer
  }

  // Screen-space bounding box for selection chrome.
  function screenBBox(c) {
    var pts = [];
    if (c.type === 'pipe') {
      pipeEnds(c).forEach(function (e) { pts.push(Grid.toScreen(e.x, e.y)); });
      var d = PipeStandards.sizeData(App.settings.family, App.settings.schedule, c.size);
      var pad = odPx(d ? d.od : 60) / 2 + 6;
      return bbox(pts, pad);
    }
    if (c.type === 'reducer') return bbox(reducerPoly(c), 6);
    if (c.type === 'elbow') {
      var ap = elbowArcPts(c);
      [ap.a, ap.b, ap.ctrl].forEach(function (e) { pts.push(Grid.toScreen(e.x, e.y)); });
      return bbox(pts, 10);
    }
    var p = Grid.toScreen(c.pos.x, c.pos.y);
    var half = Math.max(12, App.view.zoom * 0.3);
    return { minx: p.x - half, miny: p.y - half, maxx: p.x + half, maxy: p.y + half };
  }

  function bbox(pts, pad) {
    var minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
    pts.forEach(function (p) {
      minx = Math.min(minx, p.x); miny = Math.min(miny, p.y);
      maxx = Math.max(maxx, p.x); maxy = Math.max(maxy, p.y);
    });
    return { minx: minx - pad, miny: miny - pad, maxx: maxx + pad, maxy: maxy + pad };
  }

  /* ---------- overlap detection (a pipe must not lie on top of another pipe) ---------- */

  // The unit grid segments a pipe occupies, each keyed with endpoints in canonical order
  // so two pipes running opposite directions over the same span produce identical keys.
  function pipeSegKeys(c) {
    var s = stepVec(c.rot);
    var keys = [];
    for (var i = 0; i < c.lengthGU; i++) {
      var ax = c.pos.x + s.x * i, ay = c.pos.y + s.y * i;
      var bx = c.pos.x + s.x * (i + 1), by = c.pos.y + s.y * (i + 1);
      if (ax > bx || (ax === bx && ay > by)) {
        var tx = ax, ty = ay; ax = bx; ay = by; bx = tx; by = ty;
      }
      keys.push(ax + ',' + ay + '|' + bx + ',' + by);
    }
    return keys;
  }

  // True if pipe c shares any unit segment with another pipe. Perpendicular pipes that
  // merely cross at a point share no segment, so they are not treated as overlapping.
  function pipeOverlapsOther(c) {
    if (c.type !== 'pipe') return false;
    var mine = {};
    pipeSegKeys(c).forEach(function (k) { mine[k] = true; });
    for (var i = 0; i < App.components.length; i++) {
      var o = App.components[i];
      if (o.type !== 'pipe' || o.id === c.id) continue;
      var ok = pipeSegKeys(o);
      for (var j = 0; j < ok.length; j++) if (mine[ok[j]]) return true;
    }
    return false;
  }

  /* ---------- flow overlay path ---------- */

  // Strokes the dashed flow path for a component; dashSign flips animation direction.
  function strokeFlowPath(ctx, c, dashOffset, dashSign) {
    ctx.save();
    ctx.strokeStyle = 'rgba(80,200,255,0.95)';
    ctx.lineWidth = Math.max(2, App.view.zoom * 0.07);
    ctx.lineCap = 'round';
    ctx.setLineDash([App.view.zoom * 0.22, App.view.zoom * 0.3]);
    ctx.lineDashOffset = dashSign >= 0 ? -dashOffset : dashOffset;
    ctx.beginPath();
    if (c.type === 'pipe') {
      var e = pipeEnds(c);
      var a = Grid.toScreen(e[0].x, e[0].y), b = Grid.toScreen(e[1].x, e[1].y);
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
    } else if (c.type === 'elbow') {
      var ap = elbowArcPts(c);
      var sa = Grid.toScreen(ap.a.x, ap.a.y), sb = Grid.toScreen(ap.b.x, ap.b.y), q = Grid.toScreen(ap.ctrl.x, ap.ctrl.y);
      ctx.moveTo(sa.x, sa.y); ctx.quadraticCurveTo(q.x, q.y, sb.x, sb.y);
    } else {
      ctx.restore();
      return;
    }
    ctx.stroke();
    ctx.restore();
  }

  window.Comp = {
    norm: norm, unitVec: unitVec, stepVec: stepVec, dirKey: dirKey, oppKey: oppKey,
    pipeEnds: pipeEnds, elbowLeg2Rot: elbowLeg2Rot, elbowArcPts: elbowArcPts,
    getPorts: getPorts, compCenter: compCenter, odPx: odPx,
    flangeMate: flangeMate, drawComponent: drawComponent, hitTest: hitTest,
    screenBBox: screenBBox, strokeFlowPath: strokeFlowPath, reducerPoly: reducerPoly,
    pipeOverlapsOther: pipeOverlapsOther, pipeSegKeys: pipeSegKeys
  };
})();
