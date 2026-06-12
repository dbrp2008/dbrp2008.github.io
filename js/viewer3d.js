/* Read-only 3D view of the 2D layout (Three.js + OrbitControls).
 * Grid (x,y) maps to ground plane (x, z); pipe centerlines sit at a fixed height.
 * 1 world unit = 1 grid unit; radii use the same 500 mm/GU scale as the 2D view.
 */
(function () {
  'use strict';

  var renderer, scene, camera, controls, container;
  var built = false;
  var flowMats = [];   // materials of flow-reached meshes, pulsed while running
  var AXIS_H = 0.5;    // centerline height above ground

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

  function matFor(c, reached) {
    var m = PipeStandards.STANDARDS.materials[c.material];
    var mat = new THREE.MeshStandardMaterial({
      color: colorNum(c, m ? m.color3d : 0x8a8f98),
      metalness: 0.6,
      roughness: 0.4
    });
    if (reached) {
      mat.emissive = new THREE.Color(0x1888aa);
      mat.emissiveIntensity = 0.0;
      flowMats.push(mat);
    }
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
    scene.background = new THREE.Color(0x11151c);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    var sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(8, 14, 6);
    scene.add(sun);

    var grid = new THREE.GridHelper(60, 60, 0x3a4a60, 0x232b38);
    scene.add(grid);

    var reach = App.flow.reach || {};

    App.components.forEach(function (c) {
      var reached = App.flow.running && !!reach[c.id];
      var mesh = null;

      if (c.type === 'pipe') {
        var e = Comp.pipeTrimmedEnds(c);
        var a = v3(e[0].x, e[0].y), b = v3(e[1].x, e[1].y);
        var len = a.distanceTo(b);
        var d = sizeOf(c.size);
        var geo = new THREE.CylinderGeometry(radiusGU(d ? d.od : 60), radiusGU(d ? d.od : 60), len, 20);
        mesh = new THREE.Mesh(geo, matFor(c, reached));
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
        mesh = new THREE.Mesh(geoE, matFor(c, reached));
      } else if (c.type === 'branch') {
        var tipB = Comp.branchTrimmedTip(c);
        var ab = v3(c.pos.x, c.pos.y), bb = v3(tipB.x, tipB.y);
        var lenB = ab.distanceTo(bb);
        var dB = sizeOf(c.size);
        var geoB = new THREE.CylinderGeometry(radiusGU(dB ? dB.od : 60), radiusGU(dB ? dB.od : 60), lenB, 16);
        mesh = new THREE.Mesh(geoB, matFor(c, reached));
        mesh.position.copy(ab).add(bb).multiplyScalar(0.5);
        alignY(mesh, bb.clone().sub(ab));
      } else if (c.type === 'reducer') {
        var dl = sizeOf(c.largeSize), ds = sizeOf(c.smallSize);
        var h = 0.64;
        // CylinderGeometry: top (+Y) gets radiusTop -> small end faces away from rot
        var geoR = new THREE.CylinderGeometry(radiusGU(ds ? ds.od : 50), radiusGU(dl ? dl.od : 80), h, 20);
        mesh = new THREE.Mesh(geoR, matFor(c, reached));
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
    built = true;
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

    camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 500);
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
    if (App.flow.running) {
      var pulse = 0.35 + 0.3 * Math.sin(performance.now() * 0.005);
      flowMats.forEach(function (m) { m.emissiveIntensity = pulse; });
    }
    renderer.render(scene, camera);
  }

  window.Viewer3D = { init: init, enter: enter, exit: exit, rebuild: rebuild, resize: resize, tick: tick, available: available };
})();
