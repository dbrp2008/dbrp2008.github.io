/* Grid math: world (grid units) <-> screen (pixels) transforms, zoom, snapping,
 * and the background grid rendering.
 */
(function () {
  'use strict';

  var MIN_ZOOM = 12, MAX_ZOOM = 160;

  // Isometric projection of the (still square) logical grid. Grid X maps to the
  // 30°-up-right axis, grid Y maps to the vertical axis — so horizontal runs are
  // drawn at 30° and risers stand straight up, the classic piping-isometric look.
  // The underlying model stays a square integer lattice; only the screen mapping
  // changes, so connectivity / flow / snapping are unaffected.
  var ISO_COS = Math.cos(Math.PI / 6);   // 0.866…
  var ISO_SIN = Math.sin(Math.PI / 6);   // 0.5

  function isoOn() { return !!App.view.iso; }

  function toScreen(gx, gy) {
    var z = App.view.zoom;
    if (isoOn()) {
      return {
        x: gx * ISO_COS * z + App.view.panX,
        y: (gy - gx * ISO_SIN) * z + App.view.panY
      };
    }
    return { x: gx * z + App.view.panX, y: gy * z + App.view.panY };
  }

  function toWorld(sx, sy) {
    var z = App.view.zoom;
    if (isoOn()) {
      var gx = (sx - App.view.panX) / (ISO_COS * z);
      return { x: gx, y: (sy - App.view.panY) / z + gx * ISO_SIN };
    }
    return { x: (sx - App.view.panX) / z, y: (sy - App.view.panY) / z };
  }

  function snap(g) { return { x: Math.round(g.x), y: Math.round(g.y) }; }

  // Zoom keeping the given screen point fixed.
  function zoomAt(sx, sy, factor) {
    var before = toWorld(sx, sy);
    App.view.zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, App.view.zoom * factor));
    var after = toScreen(before.x, before.y);
    App.view.panX += sx - after.x;
    App.view.panY += sy - after.y;
    App.dirty = true;
  }

  function drawGrid(ctx, w, h) {
    var z = App.view.zoom;
    var styles = getComputedStyle(document.body);   // body carries the .light theme class
    var lineMinor = styles.getPropertyValue('--grid-line').trim() || 'rgba(140,160,190,0.10)';
    var lineMajor = styles.getPropertyValue('--grid-line-major').trim() || 'rgba(140,160,190,0.22)';
    ctx.fillStyle = styles.getPropertyValue('--canvas-bg').trim() || '#11151c';
    ctx.fillRect(0, 0, w, h);

    ctx.lineWidth = 1;

    if (isoOn()) {
      // visible grid range from the four screen corners (iso shear means we must
      // sample all corners, not just two)
      var corners = [toWorld(0, 0), toWorld(w, 0), toWorld(0, h), toWorld(w, h)];
      var gxs = corners.map(function (c) { return c.x; });
      var gys = corners.map(function (c) { return c.y; });
      var ix0 = Math.floor(Math.min.apply(null, gxs)) - 1, ix1 = Math.ceil(Math.max.apply(null, gxs)) + 1;
      var iy0 = Math.floor(Math.min.apply(null, gys)) - 1, iy1 = Math.ceil(Math.max.apply(null, gys)) + 1;

      for (var igx = ix0; igx <= ix1; igx++) {       // constant X -> vertical lines
        var va = toScreen(igx, iy0), vb = toScreen(igx, iy1);
        ctx.strokeStyle = igx % 5 === 0 ? lineMajor : lineMinor;
        ctx.beginPath(); ctx.moveTo(va.x, va.y); ctx.lineTo(vb.x, vb.y); ctx.stroke();
      }
      for (var igy = iy0; igy <= iy1; igy++) {        // constant Y -> 30° lines
        var ha = toScreen(ix0, igy), hb = toScreen(ix1, igy);
        ctx.strokeStyle = igy % 5 === 0 ? lineMajor : lineMinor;
        ctx.beginPath(); ctx.moveTo(ha.x, ha.y); ctx.lineTo(hb.x, hb.y); ctx.stroke();
      }

      if (z >= 28) {
        ctx.fillStyle = styles.getPropertyValue('--grid-dot').trim() || 'rgba(140,160,190,0.28)';
        for (igx = ix0; igx <= ix1; igx++) {
          for (igy = iy0; igy <= iy1; igy++) {
            var ip = toScreen(igx, igy);
            ctx.fillRect(ip.x - 1, ip.y - 1, 2, 2);
          }
        }
      }
      return;
    }

    var x0 = Math.floor(toWorld(0, 0).x), y0 = Math.floor(toWorld(0, 0).y);
    var x1 = Math.ceil(toWorld(w, h).x), y1 = Math.ceil(toWorld(w, h).y);

    for (var gx = x0; gx <= x1; gx++) {
      var sx = Math.round(gx * z + App.view.panX) + 0.5;
      ctx.strokeStyle = gx % 5 === 0 ? lineMajor : lineMinor;
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    }
    for (var gy = y0; gy <= y1; gy++) {
      var sy = Math.round(gy * z + App.view.panY) + 0.5;
      ctx.strokeStyle = gy % 5 === 0 ? lineMajor : lineMinor;
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }

    // grid intersection dots (snap points), only when zoomed in enough
    if (z >= 28) {
      ctx.fillStyle = styles.getPropertyValue('--grid-dot').trim() || 'rgba(140,160,190,0.28)';
      for (gx = x0; gx <= x1; gx++) {
        for (gy = y0; gy <= y1; gy++) {
          var p = toScreen(gx, gy);
          ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
        }
      }
    }
  }

  window.Grid = {
    toScreen: toScreen, toWorld: toWorld, snap: snap,
    zoomAt: zoomAt, drawGrid: drawGrid,
    MIN_ZOOM: MIN_ZOOM, MAX_ZOOM: MAX_ZOOM
  };
})();
