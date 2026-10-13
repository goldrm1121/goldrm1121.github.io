// Interactive skyline: an instanced grid of towers that rise on load, follow the cursor
// and light up in the accent colour when hovered. Calls onProgress(0..1) while building.
import * as THREE from "three";

const NAVY = 0x041c2c, TOWER = 0x0d3a57, TOP = 0x1d6a8f, ACCENT = 0xdefe47;

export async function createScene(canvas, { onProgress = () => {}, reducedMotion = false } = {}) {
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
  scene.add(mesh);

  const base = new THREE.Color(TOWER), tall = new THREE.Color(TOP), accent = new THREE.Color(ACCENT);
  const dummy = new THREE.Object3D();
  const state = towers.map(t => ({ ...t, grow: reducedMotion ? 1 : 0, lift: 0, glow: 0 }));

  // Build in chunks so the loader can report real progress
  const chunk = 60;
  for (let i = 0; i < state.length; i++) {
    mesh.setColorAt(i, base.clone().lerp(tall, Math.min(1, state[i].h / 14)));
    if (i % chunk === 0) { onProgress(i / state.length); await new Promise(r => setTimeout(r, 0)); }
  }
  onProgress(1);

  // Ground grid
  const grid = new THREE.GridHelper(N * gap * 1.6, N * 1.6, 0x1d4a66, 0x0a2c42);
  grid.position.y = -0.01;
  scene.add(grid);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(9, 9);
  const parallax = new THREE.Vector2();
  let hovered = -1, scrollY = 0, startTime = null, running = true;

  window.addEventListener("pointermove", e => {
    pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    parallax.set(pointer.x, pointer.y);
  });
  window.addEventListener("pointerleave", () => pointer.set(9, 9));
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

    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(mesh)[0];
    hovered = hit ? hit.instanceId : -1;

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
        col.copy(base).lerp(tall, Math.min(1, s.h / 14)).lerp(accent, s.glow);
        mesh.setColorAt(i, col);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;

    // Camera: slow orbit + cursor parallax + descend while scrolling
    const orbit = reducedMotion ? 0 : time * 0.04;
    const r = Math.hypot(camBase.x, camBase.z);
    const a = Math.atan2(camBase.z, camBase.x) + orbit + parallax.x * 0.12;
    const sy = Math.min(scrollY / innerHeight, 3);
    camera.position.set(Math.cos(a) * r, camBase.y + parallax.y * 2 - sy * 4, Math.sin(a) * r);
    camera.lookAt(0, sy * 1.5, 0);

    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  return {
    start() { requestAnimationFrame(frame); },
    stop() { running = false; },
  };
}
