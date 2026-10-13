// Interactive skyline: an instanced grid of towers that rise on load, follow the cursor
// and light up in the accent colour when hovered. Calls onProgress(0..1) while building.
// `landmarks` towers (rank 1 = tallest) carry a pulsing beacon; while one is hovered,
// onLandmark(rank, screenX, screenY) is called every frame (rank -1 when none).
import * as THREE from "three";

const NAVY = 0x041c2c, TOWER = 0x0d3a57, TOP = 0x1d6a8f, ACCENT = 0xdefe47;

export async function createScene(canvas, {
  onProgress = () => {}, reducedMotion = false,
  landmarks = 0, onLandmark = () => {}, onLandmarkClick = () => {},
} = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(NAVY);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(NAVY, 28, 70);

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
  const camBase = new THREE.Vector3(26, 22, 30);
  camera.position.copy(camBase);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0x8fb8d6, NAVY, 0.9));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(20, 40, 10);
  scene.add(sun);

  // Deterministic pseudo-random so the skyline looks the same on every visit
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

  const N = 26, gap = 1.25, half = (N * gap) / 2;
  const towers = [];
  for (let x = 0; x < N; x++) {
    for (let z = 0; z < N; z++) {
      const px = x * gap - half, pz = z * gap - half;
      const d = Math.hypot(px, pz);
      if (d > half * 1.02 || rand() < 0.12) continue;          // round plot, some empty lots
      const core = Math.max(0, 1 - d / half);                   // taller toward the centre
      const h = 0.4 + Math.pow(core, 2.2) * 14 * (0.45 + rand()) + rand() * 1.2;
      towers.push({ px, pz, h, delay: d * 0.035 + rand() * 0.25 });
    }
  }

  const geo = new THREE.BoxGeometry(0.9, 1, 0.9);
  geo.translate(0, 0.5, 0);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.25 });
  const mesh = new THREE.InstancedMesh(geo, mat, towers.length);
  // Instances move every frame, so give the mesh a fixed bound covering the whole city.
  // (Otherwise three.js computes it once while towers are still flat and raycasts miss.)
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 8, 0), half * 1.6 + 16);
  mesh.frustumCulled = false;
  scene.add(mesh);

  const base = new THREE.Color(TOWER), tall = new THREE.Color(TOP), accent = new THREE.Color(ACCENT);
  const dummy = new THREE.Object3D();
  const state = towers.map(t => ({ ...t, grow: reducedMotion ? 1 : 0, lift: 0, glow: 0, rank: -1 }));

  // ---------- Landmarks ----------
  // Pick well-separated tall towers (farthest-point sampling among the top third by height),
  // then order them so rank 1 is the tallest. Rank 1 is boosted to stand clearly above all.
  const lmIdx = [];
  if (landmarks > 0) {
    const byH = state.map((s, i) => i).sort((a, b) => state[b].h - state[a].h);
    const pool = byH.slice(0, Math.max(landmarks * 4, Math.floor(state.length / 3)));
    lmIdx.push(byH[0]);
    while (lmIdx.length < landmarks && lmIdx.length < pool.length) {
      let best = -1, bestD = -1;
      for (const i of pool) {
        if (lmIdx.includes(i)) continue;
        const d = Math.min(...lmIdx.map(j => Math.hypot(state[i].px - state[j].px, state[i].pz - state[j].pz)));
        const score = d * (0.6 + state[i].h / state[byH[0]].h); // prefer far apart AND tall
        if (score > bestD) { bestD = score; best = i; }
      }
      lmIdx.push(best);
    }
    lmIdx.sort((a, b) => state[b].h - state[a].h);
    state[lmIdx[0]].h *= 1.06;
    lmIdx.forEach((i, r) => { state[i].rank = r; });
  }

  // Build in chunks so the loader can report real progress
  const chunk = 60;
  const baseColors = state.map(s => {
    const c = base.clone().lerp(tall, Math.min(1, s.h / 14));
    return s.rank >= 0 ? c.lerp(accent, 0.22) : c;   // landmarks carry a hint of the accent
  });
  for (let i = 0; i < state.length; i++) {
    mesh.setColorAt(i, baseColors[i]);
    if (i % chunk === 0) { onProgress(i / state.length); await new Promise(r => setTimeout(r, 0)); }
  }
  onProgress(1);

  // Ground grid
  const grid = new THREE.GridHelper(N * gap * 1.6, N * 1.6, 0x1d4a66, 0x0a2c42);
  grid.position.y = -0.01;
  scene.add(grid);

  // ---------- Fireworks ----------
  // A fixed pool of additive points: each burst launches a rocket from a tower roof,
  // which explodes into a sphere of sparks that fall with gravity and fade out.
  const MAX = 4000;
  const fwPos = new Float32Array(MAX * 3), fwCol = new Float32Array(MAX * 3);
  const fwVel = new Float32Array(MAX * 3), fwLife = new Float32Array(MAX), fwMax = new Float32Array(MAX);
  const fwBase = new Float32Array(MAX * 3), fwRocket = new Uint8Array(MAX);
  const fwGeo = new THREE.BufferGeometry();
  fwGeo.setAttribute("position", new THREE.BufferAttribute(fwPos, 3).setUsage(THREE.DynamicDrawUsage));
  fwGeo.setAttribute("color", new THREE.BufferAttribute(fwCol, 3).setUsage(THREE.DynamicDrawUsage));
  const sprite = (() => {
    const c = document.createElement("canvas"); c.width = c.height = 64;
    const g = c.getContext("2d"), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, "rgba(255,255,255,1)"); grd.addColorStop(0.25, "rgba(255,255,255,.8)"); grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const fwMat = new THREE.PointsMaterial({
    size: 0.8, map: sprite, vertexColors: true, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const fireworks = new THREE.Points(fwGeo, fwMat);
  fireworks.frustumCulled = false;
  scene.add(fireworks);
  fwPos.fill(9999);
  let fwNext = 0;
  const PALETTES = [[0xdefe47, 0xffffff], [0x7fd8ff, 0xffffff], [0xffc857, 0xff6b6b], [0xdefe47, 0x7fd8ff], [0xc59bff, 0xffffff]];
  const pending = []; // rockets waiting to explode: {i, at, palette}

  function spawn(x, y, z, vx, vy, vz, color, life, rocket) {
    const i = fwNext; fwNext = (fwNext + 1) % MAX;
    fwPos.set([x, y, z], i * 3); fwVel.set([vx, vy, vz], i * 3);
    color.toArray(fwBase, i * 3); color.toArray(fwCol, i * 3);
    fwLife[i] = fwMax[i] = life; fwRocket[i] = rocket ? 1 : 0;
    return i;
  }
  const tmpC = new THREE.Color();
  function launch(x, roof, z) {
    const pal = PALETTES[Math.floor(Math.random() * PALETTES.length)];
    const i = spawn(x, roof, z, (Math.random() - .5) * .6, 9 + Math.random() * 3, (Math.random() - .5) * .6,
      tmpC.set(0xffffff), 1.2, true);
    pending.push({ i, at: 0.55 + Math.random() * 0.25, age: 0, pal });
  }
  function explode(x, y, z, pal) {
    const n = 110 + Math.floor(Math.random() * 60), speed = 5.5 + Math.random() * 2.5;
    for (let k = 0; k < n; k++) {
      // uniform directions on a sphere
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
      const sp = speed * (0.75 + Math.random() * 0.35);
      tmpC.set(pal[k % pal.length]);
      spawn(x, y, z, r * Math.cos(th) * sp, u * sp, r * Math.sin(th) * sp, tmpC, 1.4 + Math.random() * 0.8, false);
    }
  }
  function updateFireworks(dt) {
    for (let p = pending.length - 1; p >= 0; p--) {
      const r = pending[p]; r.age += dt;
      if (r.age >= r.at) {
        const j = r.i * 3;
        explode(fwPos[j], fwPos[j + 1], fwPos[j + 2], r.pal);
        fwLife[r.i] = 0; fwPos[j + 1] = 9999;
        pending.splice(p, 1);
      }
    }
    for (let i = 0; i < MAX; i++) {
      if (fwLife[i] <= 0) continue;
      const j = i * 3;
      fwLife[i] -= dt;
      if (fwLife[i] <= 0) { fwPos[j + 1] = 9999; continue; }
      const drag = fwRocket[i] ? 1 : 0.985;
      fwVel[j] *= drag; fwVel[j + 1] = fwVel[j + 1] * drag - (fwRocket[i] ? 4 : 5.5) * dt; fwVel[j + 2] *= drag;
      fwPos[j] += fwVel[j] * dt; fwPos[j + 1] += fwVel[j + 1] * dt; fwPos[j + 2] += fwVel[j + 2] * dt;
      const f = fwRocket[i] ? 1 : Math.pow(fwLife[i] / fwMax[i], 1.4);
      const twinkle = fwRocket[i] ? 1 : 0.75 + Math.random() * 0.25;
      fwCol[j] = fwBase[j] * f * twinkle; fwCol[j + 1] = fwBase[j + 1] * f * twinkle; fwCol[j + 2] = fwBase[j + 2] * f * twinkle;
    }
    fwGeo.attributes.position.needsUpdate = true;
    fwGeo.attributes.color.needsUpdate = true;
  }
  const lastShot = new Map(); // tower index -> time of last launch (per-tower cooldown)

  // Beacons: one pulsing point above each landmark roof
  const bcPos = new Float32Array(lmIdx.length * 3);
  const bcGeo = new THREE.BufferGeometry();
  bcGeo.setAttribute("position", new THREE.BufferAttribute(bcPos, 3).setUsage(THREE.DynamicDrawUsage));
  const bcMat = new THREE.PointsMaterial({
    size: 1.6, map: sprite, color: ACCENT, transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
  });
  const beacons = new THREE.Points(bcGeo, bcMat);
  beacons.frustumCulled = false;
  scene.add(beacons);
  const roof = new THREE.Vector3();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  const parallax = new THREE.Vector2();
  let hovered = -1, prevHovered = -1, clickShot = false, clickType = "mouse", scrollY = 0, startTime = null, lastT = null, running = true;

  window.addEventListener("pointermove", e => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    parallax.set(pointer.x, pointer.y);
  });
  window.addEventListener("pointerleave", () => pointer.set(9, 9));
  // Click / tap on the skyline (not on links or buttons) launches a firework there
  window.addEventListener("pointerdown", e => {
    if (e.target.closest("a, button, .panel, .nav")) return;
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    clickShot = true;
    clickType = e.pointerType;
  });
  window.addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });

  function resize() {
    const w = innerWidth, h = innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // On wide screens shift the city right so the hero text has room on the left
    if (w > 900) camera.setViewOffset(w, h, -w * 0.2, 0, w, h); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  }
  window.addEventListener("resize", resize);
  resize();

  const col = new THREE.Color();
  function frame(t) {
    if (!running) return;
    if (startTime === null) startTime = t;
    const time = (t - startTime) / 1000;
    const dt = Math.min(0.05, lastT === null ? 0.016 : (t - lastT) / 1000);
    lastT = t;

    raycaster.setFromCamera(pointer, camera);
    // Landmarks win even when a nearer tower occludes them, so every one stays discoverable
    const hits = raycaster.intersectObject(mesh);
    const lmHit = hits.find(h => state[h.instanceId].rank >= 0);
    hovered = lmHit ? lmHit.instanceId : hits.length ? hits[0].instanceId : -1;

    // Only landmark towers launch fireworks — they are the reward for finding one
    if (hovered !== -1 && state[hovered].rank >= 0 && (hovered !== prevHovered || clickShot)) {
      const s = state[hovered];
      if ((clickShot || time - (lastShot.get(hovered) ?? -9) > 1.2) && pending.length < 14) {
        launch(s.px, s.h + 1.2, s.pz);
        lastShot.set(hovered, time);
      }
    }
    const lmRank = hovered !== -1 ? state[hovered].rank : -1;
    if (clickShot && lmRank >= 0) onLandmarkClick(lmRank, clickType);
    clickShot = false;
    prevHovered = hovered;
    updateFireworks(dt);

    for (let i = 0; i < state.length; i++) {
      const s = state[i];
      if (!reducedMotion) s.grow = Math.min(1, Math.max(0, (time - s.delay) / 1.1));
      const ease = 1 - Math.pow(1 - s.grow, 3);
      const target = i === hovered ? 1 : 0;
      s.glow += (target - s.glow) * 0.12;
      s.lift += (target * 1.2 - s.lift) * 0.12;
      dummy.position.set(s.px, 0, s.pz);
      dummy.scale.set(1, Math.max(0.001, s.h * ease + s.lift), 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      if (s.glow > 0.01 || target) {
        col.copy(baseColors[i]).lerp(accent, s.glow);
        mesh.setColorAt(i, col);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    // Beacons follow the (growing / lifting) roofs and breathe
    lmIdx.forEach((i, r) => {
      const s = state[i], h = s.h * (1 - Math.pow(1 - s.grow, 3)) + s.lift;
      bcPos.set([s.px, h + 0.7, s.pz], r * 3);
    });
    bcGeo.attributes.position.needsUpdate = true;
    bcMat.size = 1.6 * (reducedMotion ? 1 : 0.8 + 0.35 * Math.sin(time * 3));

    // Camera: slow orbit + cursor parallax + descend while scrolling
    const orbit = reducedMotion ? 0 : time * 0.04;
    const r = Math.hypot(camBase.x, camBase.z);
    const a = Math.atan2(camBase.z, camBase.x) + orbit + parallax.x * 0.12;
    const sy = Math.min(scrollY / innerHeight, 3);
    camera.position.set(Math.cos(a) * r, camBase.y + parallax.y * 2 - sy * 4, Math.sin(a) * r);
    camera.lookAt(0, 3 + sy * 1.5, 0); // aim a little above ground so the tallest roof stays in frame

    renderer.render(scene, camera);

    // Report the hovered landmark's roof position in screen pixels (after camera update)
    if (lmRank >= 0) {
      const s = state[hovered];
      roof.set(s.px, s.h + s.lift + 0.7, s.pz).project(camera);
      onLandmark(lmRank, (roof.x + 1) / 2 * innerWidth, (1 - roof.y) / 2 * innerHeight);
    } else {
      onLandmark(-1);
    }
    requestAnimationFrame(frame);
  }

  // Firework show from the landmark towers (opening show, and the finale when all are found)
  function celebrate(count = 4) {
    const from = lmIdx.length ? lmIdx : state.map((s, i) => i).sort((a, b) => state[b].h - state[a].h).slice(0, 7);
    for (let k = 0; k < count; k++) {
      setTimeout(() => {
        const s = state[from[k % from.length]];
        launch(s.px, s.h + 1.2, s.pz);
      }, 1400 + k * 380);
    }
  }

  return {
    celebrate,
    start() { requestAnimationFrame(frame); if (!reducedMotion) celebrate(); },
    stop() { running = false; },
  };
}
