/* Grid math: world (grid units) <-> screen (pixels) transforms, zoom, snapping,
 * and the background grid rendering.
 */
(function () {
  'use strict';

  var MIN_ZOOM = 12, MAX_ZOOM = 160;

  function toScreen(gx, gy) {
    return { x: gx * App.view.zoom + App.view.panX, y: gy * App.view.zoom + App.view.panY };
  }

  function toWorld(sx, sy) {
    return { x: (sx - App.view.panX) / App.view.zoom, y: (sy - App.view.panY) / App.view.zoom };
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
    var styles = getComputedStyle(document.documentElement);
    ctx.fillStyle = styles.getPropertyValue('--canvas-bg').trim() || '#11151c';
    ctx.fillRect(0, 0, w, h);

    var x0 = Math.floor(toWorld(0, 0).x), y0 = Math.floor(toWorld(0, 0).y);
    var x1 = Math.ceil(toWorld(w, h).x), y1 = Math.ceil(toWorld(w, h).y);

    ctx.lineWidth = 1;
    for (var gx = x0; gx <= x1; gx++) {
      var sx = Math.round(gx * z + App.view.panX) + 0.5;
      ctx.strokeStyle = gx % 5 === 0 ? 'rgba(140,160,190,0.22)' : 'rgba(140,160,190,0.10)';
      ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, h); ctx.stroke();
    }
    for (var gy = y0; gy <= y1; gy++) {
      var sy = Math.round(gy * z + App.view.panY) + 0.5;
      ctx.strokeStyle = gy % 5 === 0 ? 'rgba(140,160,190,0.22)' : 'rgba(140,160,190,0.10)';
      ctx.beginPath(); ctx.moveTo(0, sy); ctx.lineTo(w, sy); ctx.stroke();
    }

    // grid intersection dots (snap points), only when zoomed in enough
    if (z >= 28) {
      ctx.fillStyle = 'rgba(140,160,190,0.28)';
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
