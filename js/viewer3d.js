/* Read-only 3D view of the 2D layout (Three.js + OrbitControls).
 * Grid (x,y) maps to ground plane (x, z); pipe centerlines sit at a fixed height.
 * 1 world unit = 1 grid unit; radii use the same 500 mm/GU scale as the 2D view.
 */
(function () {
  'use strict';

  var renderer, scene, camera, controls, container;
  var built = false;
  var flowMats = [];   // {mat,tex,dir,speed,...} for flow-reached meshes, animated while running
  var prevNow = 0;     // last tick timestamp, for frame-rate-independent band scrolling
  var AXIS_H = 0.5;    // centerline height above ground

  // Ground/grid extend dynamically with camera distance so the world never
  // looks like it ends in a void, but stay capped at 100 divisions so the
  // geometry never gets big regardless of zoom level.
  var GRID_BUCKETS = [40, 80, 160, 320, 640, 1280, 2560, 5120, 10240];
  var gridHelper = null, gridBucket = 0, gridCX = null, gridCZ = null;
  var gridMinorColor = 0x3a4a60, gridMajorColor = 0x232b38;

  function available() { return typeof THREE !== 'undefined'; }

  function init() {
    container = document.getElementById('canvas3d');
  }

  function radiusGU(odMm) { return Math.max(0.03, odMm / 500 / 2); }

  function sizeOf(sizeKey) {
    return PipeStandards.sizeData(App.settings.family, App.settings.schedule, sizeKey);
  }

  function colorNum(c, fallback) {
    if (c.color) return parseInt(c.color.slice(1), 16);
    return fallback;
  }

  // One soft bright ring per texture tile; tiled and scrolled along a pipe's
  // length it reads as glowing slugs of fluid travelling through the line.
  function flowBandCanvas() {
    var cv = document.createElement('canvas');
    cv.width = 4; cv.height = 64;
    var g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, 4, 64);
    var grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0.00, '#000000');
    grd.addColorStop(0.24, '#5a5a5a');
    grd.addColorStop(0.40, '#ffffff');
    grd.addColorStop(0.56, '#5a5a5a');
    grd.addColorStop(0.80, '#000000');
    grd.addColorStop(1.00, '#000000');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 64);
    return cv;
  }

  // Band scroll direction (+1 toward the mesh's local +Y, -1 away). When flow.js
  // has resolved a real flow vector (reducers, tees) we dot it against the grid-
  // space direction the mesh's +Y points, so the slugs always travel with the
  // water regardless of how the geometry was built. Otherwise fall back to sign.
  function bandDir(reachEntry, axGx, axGy) {
    if (reachEntry.flowVec) {
      return (reachEntry.flowVec.x * axGx + reachEntry.flowVec.y * axGy) >= 0 ? 1 : -1;
    }
    return reachEntry.sign || 1;
  }

  // reachEntry: the App.flow.reach[id] record for this component, or null when
  // it carries no flow. lenHint (world units) sets how many bands tile the part.
  // scrollDir sets the band travel direction along the mesh's local +Y axis.
  function matFor(c, reachEntry, lenHint, scrollDir) {
    var m = PipeStandards.STANDARDS.materials[c.material];
    var base = colorNum(c, m ? m.color3d : 0x8a8f98);
    if (!reachEntry) {
      return new THREE.MeshStandardMaterial({ color: base, metalness: 0.6, roughness: 0.4 });
    }

    // Faster, hotter flow shifts the bands from calm cyan to an alarming red,
    // mirroring the velocity alert in the issues panel.
    var vel = reachEntry.vel || 0;
    var crit = vel > 30;
    var flowColor = crit ? 0xff4530 : 0x39c0ff;

    var tex = new THREE.CanvasTexture(flowBandCanvas());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, Math.max(2, Math.round((lenHint || 2) * 1.3)));

    var mat = new THREE.MeshStandardMaterial({
      color: base, metalness: 0.55, roughness: 0.4,
      emissive: new THREE.Color(flowColor),
      emissiveMap: tex,
      emissiveIntensity: crit ? 1.15 : 0.95
    });

    // band scroll speed scales gently with velocity; sign sets travel direction
    var speed = (crit ? 0.0022 : 0.0012) * (0.7 + Math.min(vel, 30) / 30 * 0.6);
    flowMats.push({
      mat: mat, tex: tex, dir: scrollDir !== undefined ? scrollDir : (reachEntry.sign || 1), speed: speed,
      base: crit ? 1.15 : 0.95, amp: crit ? 0.4 : 0.2, phase: Math.random() * 6.283
    });
    return mat;
  }

  function v3(gx, gy) { return new THREE.Vector3(gx, AXIS_H, gy); }

  function dir3(rot) {
    var u = Comp.unitVec(rot);
    return new THREE.Vector3(u.x, 0, u.y);
  }

  function alignY(mesh, dir) {
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  }

  function buildScene() {
    flowMats = [];
    scene = new THREE.Scene();
    var lightTheme = document.body.classList.contains('light');
    scene.background = new THREE.Color(lightTheme ? 0xe9edf3 : 0x11151c);

    scene.add(new THREE.AmbientLight(0xffffff, lightTheme ? 0.75 : 0.55));
    var sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(8, 14, 6);
    scene.add(sun);

    // Large flat ground so the world doesn't look like it ends in a black
    // void past the grid; lit so it still reads as "ground" rather than
    // a flat background-colour cutout.
    var groundColor = lightTheme ? 0xdde3ec : 0x161c26;
    var groundMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(20000, 20000),
      new THREE.MeshStandardMaterial({
        color: groundColor, roughness: 1, metalness: 0,
        polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
      })
    );
    groundMesh.rotation.x = -Math.PI / 2;
    // sit the ground well below the grid lines (y=0); a generous gap plus the
    // polygon offset keeps the two from z-fighting (which flickers) at the poor
    // depth precision you get out near the far plane.
    groundMesh.position.y = -0.6;
    scene.add(groundMesh);

    gridMinorColor = lightTheme ? 0x9fb0c8 : 0x3a4a60;
    gridMajorColor = lightTheme ? 0xd6deea : 0x232b38;
    gridHelper = null; gridBucket = 0; gridCX = null; gridCZ = null;

    var reach = App.flow.reach || {};

    App.components.forEach(function (c) {
      var rEntry = App.flow.running && reach[c.id] ? reach[c.id] : null;
      var mesh = null;

      if (c.type === 'pipe') {
        var e = Comp.pipeTrimmedEnds(c);
        var a = v3(e[0].x, e[0].y), b = v3(e[1].x, e[1].y);
        var len = a.distanceTo(b);
        var d = sizeOf(c.size);
        var geo = new THREE.CylinderGeometry(radiusGU(d ? d.od : 60), radiusGU(d ? d.od : 60), len, 20);
        mesh = new THREE.Mesh(geo, matFor(c, rEntry, len, rEntry ? (rEntry.sign || 1) : 1));
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        alignY(mesh, b.clone().sub(a));
      } else if (c.type === 'flange') {
        var df = sizeOf(c.size);
        var rf = radiusGU(df ? df.od : 60) * 1.8;
        var u = dir3(c.rot);
        var pair = Comp.flangeMate(c);
        var thick = 0.06;
        var geoF = new THREE.CylinderGeometry(rf, rf, thick, 24);
        mesh = new THREE.Mesh(geoF, new THREE.MeshStandardMaterial({ color: colorNum(c, 0xc9a648), metalness: 0.7, roughness: 0.35 }));
        var p = v3(c.pos.x, c.pos.y);
        if (pair) p.add(u.clone().multiplyScalar(thick / 2));   // pair renders as two touching disks
        mesh.position.copy(p);
        alignY(mesh, u);
      } else if (c.type === 'elbow') {
        var ap = Comp.elbowArcPts(c);
        var curve = new THREE.QuadraticBezierCurve3(
          v3(ap.a.x, ap.a.y), v3(ap.ctrl.x, ap.ctrl.y), v3(ap.b.x, ap.b.y)
        );
        var de = sizeOf(c.size);
        var geoE = new THREE.TubeGeometry(curve, 16, radiusGU(de ? de.od : 60), 16, false);
        mesh = new THREE.Mesh(geoE, matFor(c, rEntry, curve.getLength(), rEntry ? (rEntry.sign || 1) : 1));
      } else if (c.type === 'branch') {
        var tipB = Comp.branchTrimmedTip(c);
        var ab = v3(c.pos.x, c.pos.y), bb = v3(tipB.x, tipB.y);
        var lenB = ab.distanceTo(bb);
        var dB = sizeOf(c.size);
        var geoB = new THREE.CylinderGeometry(radiusGU(dB ? dB.od : 60), radiusGU(dB ? dB.od : 60), lenB, 16);
        var ubB = Comp.unitVec(c.rot);   // branch mesh +Y points pos -> tip = +unitVec
        mesh = new THREE.Mesh(geoB, matFor(c, rEntry, lenB, rEntry ? bandDir(rEntry, ubB.x, ubB.y) : 1));
        mesh.position.copy(ab).add(bb).multiplyScalar(0.5);
        alignY(mesh, bb.clone().sub(ab));
      } else if (c.type === 'reducer') {
        var dl = sizeOf(c.largeSize), ds = sizeOf(c.smallSize);
        var h = 0.64;
        // CylinderGeometry: top (+Y) gets radiusTop -> small end faces away from rot
        var geoR = new THREE.CylinderGeometry(radiusGU(ds ? ds.od : 50), radiusGU(dl ? dl.od : 80), h, 20);
        var uR = Comp.unitVec(c.rot);   // reducer mesh +Y points along rot+180 = -unitVec
        mesh = new THREE.Mesh(geoR, matFor(c, rEntry, h, rEntry ? bandDir(rEntry, -uR.x, -uR.y) : 1));
        mesh.position.copy(v3(c.pos.x, c.pos.y));
        alignY(mesh, dir3(c.rot + 180));
      }

      if (mesh) scene.add(mesh);
    });

    // center camera on layout
    var box = new THREE.Box3();
    if (App.components.length) {
      App.components.forEach(function (c) {
        box.expandByPoint(v3(c.pos.x, c.pos.y));
        if (c.type === 'pipe') {
          var e = Comp.pipeEnds(c);
          box.expandByPoint(v3(e[1].x, e[1].y));
        }
      });
    } else {
      box.expandByPoint(new THREE.Vector3(0, 0, 0));
    }
    var center = box.getCenter(new THREE.Vector3());
    var size = Math.max(6, box.getSize(new THREE.Vector3()).length());
    if (controls) {
      controls.target.copy(center);
      camera.position.copy(center).add(new THREE.Vector3(size * 0.7, size * 0.8, size * 0.7));
      controls.update();
    }
    updateGrid();
    built = true;
  }

  function pickGridSize(dist) {
    for (var i = 0; i < GRID_BUCKETS.length; i++) {
      if (dist * 2.2 <= GRID_BUCKETS[i]) return GRID_BUCKETS[i];
    }
    return GRID_BUCKETS[GRID_BUCKETS.length - 1];
  }

  // Re-centers and resizes the ground grid around the camera's look-at point
  // as the user zooms/pans, so it always extends past the visible area.
  // Divisions are capped at 100 regardless of size, so memory stays bounded —
  // the grid only gets coarser, never heavier, as it grows.
  function updateGrid() {
    if (!scene || !camera || !controls) return;
    var dist = camera.position.distanceTo(controls.target);
    var tx = controls.target.x, tz = controls.target.z;

    // Hysteresis: only rebuild once the camera has moved meaningfully past
    // the current grid's bounds. Without this, tiny per-frame jitter from
    // OrbitControls damping near a bucket/recenter boundary flips the grid
    // between two sizes or positions every frame, causing flicker.
    if (gridHelper) {
      var dx = tx - gridCX, dz = tz - gridCZ;
      var driftedTooFar = Math.sqrt(dx * dx + dz * dz) > gridBucket / 4;
      var tooSmall = dist * 2.2 > gridBucket;
      var tooLarge = dist * 2.2 < gridBucket / 2.5 && gridBucket > GRID_BUCKETS[0];
      if (!driftedTooFar && !tooSmall && !tooLarge) return;
    }

    var size = pickGridSize(dist);
    var step = Math.max(10, size / 8);
    var cx = Math.round(tx / step) * step;
    var cz = Math.round(tz / step) * step;
    if (gridHelper) {
      scene.remove(gridHelper);
      gridHelper.geometry.dispose();
      gridHelper.material.dispose();
    }
    var divisions = Math.min(size, 100);
    gridHelper = new THREE.GridHelper(size, divisions, gridMajorColor, gridMinorColor);
    gridHelper.position.set(cx, 0, cz);
    scene.add(gridHelper);
    gridBucket = size; gridCX = cx; gridCZ = cz;
  }

  function enter() {
    if (!available()) {
      container.innerHTML = '<div class="msg3d">3D view unavailable — vendor/three.min.js not found.</div>';
      container.style.display = 'block';
      return;
    }
    container.innerHTML = '';
    container.style.display = 'block';
    var w = container.clientWidth, h = container.clientHeight;

    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    container.appendChild(renderer.domElement);

    // far plane must clear the largest dynamic grid (up to ~10k wide) plus the
    // camera's distance from it, or the grid's far edge gets clipped away as
    // you zoom/orbit out — which looked like the grid flickering off entirely.
    camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 60000);
    camera.position.set(8, 10, 8);
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    buildScene();
    renderer.render(scene, camera);   // immediate first frame (RAF may be throttled)
  }

  function exit() {
    container.style.display = 'none';
    if (renderer) {
      renderer.dispose();
      container.innerHTML = '';
      renderer = null;
    }
    built = false;
  }

  function rebuild() {
    if (App.mode === '3d' && renderer) {
      buildScene();
      renderer.render(scene, camera);
    }
  }

  function resize() {
    if (App.mode !== '3d' || !renderer) return;
    var w = container.clientWidth, h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }

  function tick() {
    if (App.mode !== '3d' || !renderer || !built) return;
    controls.update();
    updateGrid();
    if (App.flow.running) {
      var now = performance.now();
      var dt = prevNow ? Math.min(80, now - prevNow) : 16;
      prevNow = now;
      flowMats.forEach(function (f) {
        // scroll the glowing bands along the part in the flow direction
        f.tex.offset.y -= f.dir * f.speed * dt;
        // gentle shimmer so the slugs throb as they travel
        f.mat.emissiveIntensity = f.base + f.amp * Math.sin(now * 0.004 + f.phase);
      });
    } else {
      prevNow = 0;
    }
    renderer.render(scene, camera);
  }

  window.Viewer3D = { init: init, enter: enter, exit: exit, rebuild: rebuild, resize: resize, tick: tick, available: available };
})();
