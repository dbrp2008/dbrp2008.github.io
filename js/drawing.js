/* Generates a printable piping-isometric fabrication drawing from the current
 * layout: the run projected onto isometric axes (horizontal runs at 30°, risers
 * vertical), auto dimensions (overall extents + per-run lengths), and a bill of
 * materials / specification table (size, schedule/class, pipe type, galvanising,
 * cut length). Opens in a new window so it can be printed or saved as PDF.
 */
(function () {
  'use strict';

  var COS30 = Math.cos(Math.PI / 6), SIN30 = 0.5;
  function mmPerGU() { return 1000 * (PipeState.METERS_PER_GU || 0.2); }   // 1 GU = 200 mm
  function iso(gx, gy) { return { x: gx * COS30, y: gy - gx * SIN30 }; }
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]; });
  }

  function sizeLabelOf(c) {
    var fam = App.settings.family;
    if (c.type === 'reducer') {
      return PipeStandards.sizeLabel(fam, c.largeSize) + ' × ' + PipeStandards.sizeLabel(fam, c.smallSize);
    }
    return PipeStandards.sizeLabel(fam, c.size);
  }
  function lenMM(c) {
    if (c.type === 'branch') return Math.round(Comp.BRANCH_LEN * mmPerGU());
    if (c.type !== 'pipe') return null;
    var diag = Comp.norm(c.rot) % 90 !== 0;
    return Math.round(c.lengthGU * mmPerGU() * (diag ? Math.SQRT2 : 1));
  }
  function descOf(c) {
    return ({ pipe: 'Pipe, straight', branch: 'Branch / tee', elbow: 'Elbow ' + (c.angle || 90) + '°',
      flange: 'Flange', reducer: 'Reducer' })[c.type];
  }

  // Group identical parts into BOM line items with a quantity.
  function buildBOM() {
    var map = {}, order = [];
    App.components.forEach(function (c) {
      var size = sizeLabelOf(c);
      var sch = c.type === 'flange' ? ('Class ' + c.cls) : App.settings.schedule;
      var ptype = (c.type === 'pipe' || c.type === 'branch') ? (c.pipeType || 'STPG-E') : '—';
      var galv = c.galvanized ? 'Galvanised' : 'Ungalvanised';
      var L = lenMM(c);
      var key = [descOf(c), size, sch, ptype, galv, L].join('|');
      if (!map[key]) { map[key] = { qty: 0, desc: descOf(c), size: size, sch: sch, ptype: ptype, galv: galv, L: L }; order.push(key); }
      map[key].qty++;
    });
    return order.map(function (k) { return map[k]; });
  }

  function generate() {
    if (!App.components.length) {
      alert('Add some pipe to the layout first — the drawing is generated from your current model.');
      return;
    }

    // ---- fit the isometric projection into the drawing area ----
    var pts = [];
    function addP(gx, gy) { pts.push(iso(gx, gy)); }
    App.components.forEach(function (c) {
      if (c.type === 'pipe') { var e = Comp.pipeEnds(c); addP(e[0].x, e[0].y); addP(e[1].x, e[1].y); }
      else if (c.type === 'branch') { addP(c.pos.x, c.pos.y); var t = Comp.branchTip(c); addP(t.x, t.y); }
      else if (c.type === 'elbow') { var ap = Comp.elbowArcPts(c); [ap.a, ap.b, ap.ctrl].forEach(function (p) { addP(p.x, p.y); }); }
      else { addP(c.pos.x, c.pos.y); }
    });
    var xs = pts.map(function (p) { return p.x; }), ys = pts.map(function (p) { return p.y; });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys), maxY = Math.max.apply(null, ys);
    var PAD = 80, DRAW_W = 780;
    var spanX = Math.max(0.001, maxX - minX), spanY = Math.max(0.001, maxY - minY);
    var scale = Math.min((DRAW_W - 2 * PAD) / spanX, 480 / spanY);
    if (!isFinite(scale) || scale <= 0) scale = 40;
    var W = DRAW_W, H = spanY * scale + 2 * PAD;
    function SX(gx, gy) { return +(PAD + (iso(gx, gy).x - minX) * scale).toFixed(1); }
    function SY(gx, gy) { return +(PAD + (iso(gx, gy).y - minY) * scale).toFixed(1); }

    var body = [], dims = [];

    function pipeLine(x1, y1, x2, y2) {
      body.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#10151b" stroke-width="9" stroke-linecap="round"/>');
      body.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="#aab3bf" stroke-width="6" stroke-linecap="round"/>');
    }
    function dimFor(x1, y1, x2, y2, label) {
      var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
      var dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy) || 1;
      var ox = -dy / len * 16, oy = dx / len * 16;   // perpendicular offset
      dims.push('<text x="' + (mx + ox).toFixed(1) + '" y="' + (my + oy + 4).toFixed(1) + '" text-anchor="middle" class="dim">' + label + '</text>');
    }

    App.components.forEach(function (c) {
      if (c.type === 'pipe') {
        var e = Comp.pipeTrimmedEnds(c), ef = Comp.pipeEnds(c);
        pipeLine(SX(e[0].x, e[0].y), SY(e[0].x, e[0].y), SX(e[1].x, e[1].y), SY(e[1].x, e[1].y));
        dimFor(SX(ef[0].x, ef[0].y), SY(ef[0].x, ef[0].y), SX(ef[1].x, ef[1].y), SY(ef[1].x, ef[1].y), '' + lenMM(c));
      } else if (c.type === 'branch') {
        var t = Comp.branchTrimmedTip(c);
        pipeLine(SX(c.pos.x, c.pos.y), SY(c.pos.x, c.pos.y), SX(t.x, t.y), SY(t.x, t.y));
      } else if (c.type === 'elbow') {
        var ap = Comp.elbowArcPts(c);
        body.push('<path d="M ' + SX(ap.a.x, ap.a.y) + ' ' + SY(ap.a.x, ap.a.y) + ' Q ' + SX(ap.ctrl.x, ap.ctrl.y) + ' ' + SY(ap.ctrl.x, ap.ctrl.y) + ' ' + SX(ap.b.x, ap.b.y) + ' ' + SY(ap.b.x, ap.b.y) + '" fill="none" stroke="#10151b" stroke-width="9"/>');
        body.push('<path d="M ' + SX(ap.a.x, ap.a.y) + ' ' + SY(ap.a.x, ap.a.y) + ' Q ' + SX(ap.ctrl.x, ap.ctrl.y) + ' ' + SY(ap.ctrl.x, ap.ctrl.y) + ' ' + SX(ap.b.x, ap.b.y) + ' ' + SY(ap.b.x, ap.b.y) + '" fill="none" stroke="#aab3bf" stroke-width="6"/>');
      } else if (c.type === 'flange') {
        var u = Comp.unitVec(c.rot + 90), k = 0.42;
        body.push('<line x1="' + SX(c.pos.x - u.x * k, c.pos.y - u.y * k) + '" y1="' + SY(c.pos.x - u.x * k, c.pos.y - u.y * k) + '" x2="' + SX(c.pos.x + u.x * k, c.pos.y + u.y * k) + '" y2="' + SY(c.pos.x + u.x * k, c.pos.y + u.y * k) + '" stroke="#b8860b" stroke-width="6" stroke-linecap="round"/>');
      } else if (c.type === 'reducer') {
        var ud = Comp.unitVec(c.rot), kk = 0.3;
        body.push('<line x1="' + SX(c.pos.x - ud.x * kk, c.pos.y - ud.y * kk) + '" y1="' + SY(c.pos.x - ud.x * kk, c.pos.y - ud.y * kk) + '" x2="' + SX(c.pos.x + ud.x * kk, c.pos.y + ud.y * kk) + '" y2="' + SY(c.pos.x + ud.x * kk, c.pos.y + ud.y * kk) + '" stroke="#10151b" stroke-width="13" stroke-linecap="butt"/>');
      }
    });

    // overall bounding dimensions (grid extents -> mm), drawn along the bbox edges
    var gxs = [], gys = [];
    App.components.forEach(function (c) {
      gxs.push(c.pos.x); gys.push(c.pos.y);
      if (c.type === 'pipe') Comp.pipeEnds(c).forEach(function (e) { gxs.push(e.x); gys.push(e.y); });
      if (c.type === 'branch') { var t = Comp.branchTip(c); gxs.push(t.x); gys.push(t.y); }
    });
    var gMinX = Math.min.apply(null, gxs), gMaxX = Math.max.apply(null, gxs);
    var gMinY = Math.min.apply(null, gys), gMaxY = Math.max.apply(null, gys);
    var overallW = Math.round((gMaxX - gMinX) * mmPerGU());
    var overallH = Math.round((gMaxY - gMinY) * mmPerGU());

    var svg = '<svg viewBox="0 0 ' + W + ' ' + H.toFixed(0) + '" width="100%" xmlns="http://www.w3.org/2000/svg">' +
      body.join('') + dims.join('') +
      '<g class="ind"><line x1="36" y1="' + (H - 30) + '" x2="36" y2="' + (H - 70) + '" marker-end="url(#a)"/><text x="26" y="' + (H - 72) + '">UP</text>' +
      '<line x1="36" y1="' + (H - 30) + '" x2="' + (36 + 36 * COS30) + '" y2="' + (H - 30 - 36 * SIN30) + '" marker-end="url(#a)"/><text x="' + (40 + 36 * COS30) + '" y="' + (H - 26 - 36 * SIN30) + '">N</text></g>' +
      '<defs><marker id="a" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto"><path d="M0,0 L7,3 L0,6" fill="none" stroke="#444" stroke-width="1"/></marker></defs>' +
      '</svg>';

    // ---- BOM table ----
    var bom = buildBOM();
    var rows = bom.map(function (r, i) {
      return '<tr><td>' + (i + 1) + '</td><td>' + r.qty + '</td><td class="l">' + esc(r.desc) + '</td><td>' +
        esc(r.size) + '</td><td>' + esc(r.sch) + '</td><td>' + esc(r.ptype) + '</td><td>' + esc(r.galv) +
        '</td><td>' + (r.L == null ? '—' : r.L) + '</td></tr>';
    }).join('');

    var fam = PipeStandards.STANDARDS.families[App.settings.family];
    var famLabel = fam ? fam.label : App.settings.family;
    var today = new Date().toISOString().slice(0, 10);

    var html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Piping isometric</title><style>' +
      'body{margin:0;background:#525659;font:13px/1.4 Segoe UI,system-ui,sans-serif;color:#1a1f26;}' +
      '.bar{position:sticky;top:0;background:#2b2f36;padding:8px 14px;display:flex;gap:10px;align-items:center;}' +
      '.bar button{font:inherit;padding:6px 14px;border:0;border-radius:6px;background:#5b9dff;color:#fff;cursor:pointer;}' +
      '.bar span{color:#cdd4de;}' +
      '.sheet{background:#fff;max-width:840px;margin:18px auto;border:1.5px solid #10151b;}' +
      '.hd{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;border-bottom:1px solid #10151b;}' +
      '.hd .t{font-size:17px;font-weight:600;} .hd .n{font-size:12px;color:#444;letter-spacing:.04em;}' +
      '.draw{padding:10px;border-bottom:1px solid #10151b;}' +
      '.dim{font:11px sans-serif;fill:#222;} .ind line{stroke:#444;stroke-width:1;} .ind text{font:11px sans-serif;fill:#444;}' +
      'h4{margin:0;padding:8px 16px 4px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#555;}' +
      'table{width:100%;border-collapse:collapse;font-size:12px;}' +
      'th,td{border:0.5px solid #c6ccd4;padding:4px 8px;text-align:center;} th{background:#eef1f5;color:#333;} td.l,th.l{text-align:left;}' +
      '.tb{display:flex;flex-wrap:wrap;border-top:1px solid #10151b;}' +
      '.tb div{flex:1 1 120px;padding:6px 16px;border-right:0.5px solid #c6ccd4;} .tb .k{color:#666;font-size:11px;}' +
      '@media print{.bar{display:none;}body{background:#fff;}.sheet{margin:0;border:0;max-width:none;}}' +
      '</style></head><body>' +
      '<div class="bar"><button onclick="window.print()">Print / Save PDF</button><span>ALL DIMENSIONS IN MILLIMETERS · NTS</span></div>' +
      '<div class="sheet">' +
      '<div class="hd"><div class="t">Piping isometric</div><div class="n">ALL DIMENSIONS IN MILLIMETERS &nbsp;·&nbsp; NTS</div></div>' +
      '<div class="draw">' + svg + '</div>' +
      '<h4>Bill of materials / specification</h4>' +
      '<table><thead><tr><th>#</th><th>Qty</th><th class="l">Description</th><th>Size</th><th>Sch / Class</th><th>Pipe type</th><th>Galvanising</th><th>L (mm)</th></tr></thead><tbody>' + rows + '</tbody></table>' +
      '<div class="tb">' +
      '<div><div class="k">Standard</div>' + esc(famLabel) + '</div>' +
      '<div><div class="k">Schedule</div>' + esc(App.settings.schedule) + '</div>' +
      '<div><div class="k">Projection</div>Isometric</div>' +
      '<div><div class="k">Overall</div>' + overallW + ' × ' + overallH + ' mm</div>' +
      '<div><div class="k">Units</div>mm</div>' +
      '<div><div class="k">Date</div>' + today + '</div>' +
      '<div><div class="k">Sheet</div>1 / 1</div>' +
      '</div></div></body></html>';

    var win = window.open('', '_blank');
    if (!win) { alert('Allow pop-ups for this site to view the fabrication drawing.'); return; }
    win.document.open();
    win.document.write(html);
    win.document.close();
  }

  window.Drawing = { generate: generate };
})();
