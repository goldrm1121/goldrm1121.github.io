import { zh } from "./i18n.js?v=20261013204909";

const $ = s => document.querySelector(s);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ---------- Language ---------- */
const en = {};
document.querySelectorAll("[data-i18n]").forEach(el => { en[el.dataset.i18n] ??= el.innerHTML; });
const enExtra = {
  "loader.fonts": "Loading fonts", "loader.engine": "Loading 3D engine",
  "loader.city": "Building the skyline", "loader.icons": "Preparing icons", "loader.done": "Ready",
};
const t = key => (lang === "zh" ? zh[key] : en[key] ?? enExtra[key]) ?? en[key] ?? key;

let lang = (() => {
  try { const saved = localStorage.getItem("lang"); if (saved) return saved; } catch {}
  return navigator.language?.toLowerCase().startsWith("zh") ? "zh" : "en";
})();

function applyLang(next) {
  lang = next;
  document.documentElement.lang = lang === "zh" ? "zh-Hant" : "en";
  document.documentElement.dataset.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach(el => { el.innerHTML = t(el.dataset.i18n); });
  document.querySelectorAll("[data-set-lang]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.setLang === lang)));
  try { localStorage.setItem("lang", lang); } catch {}
}
document.querySelectorAll("[data-set-lang]").forEach(b => b.addEventListener("click", () => applyLang(b.dataset.setLang)));
applyLang(lang);

/* ---------- Loader with real progress ---------- */
// Each step has a weight; the counter eases toward the real completed share.
const steps = { fonts: 0.2, icons: 0.05, engine: 0.35, city: 0.4 };
const done = Object.fromEntries(Object.keys(steps).map(k => [k, 0]));
let shown = 0;
const target = () => Object.entries(steps).reduce((s, [k, w]) => s + w * done[k], 0) * 100;
function setStep(key, frac, label) {
  done[key] = frac;
  if (label) $("#loader-step").textContent = t(label);
}
function tickLoader() {
  shown += (target() - shown) * 0.12;
  if (target() - shown < 0.4) shown = target();
  const pct = Math.floor(shown);
  $("#loader-pct").textContent = pct;
  $("#loader-fill").style.transform = `scaleX(${shown / 100})`;
  if (pct >= 100) return finishLoader();
  setTimeout(tickLoader, 16); // timer, not rAF: keeps counting in throttled/background tabs
}
tickLoader();

let scene = null;
function finishLoader() {
  $("#loader-step").textContent = t("loader.done");
  const enter = $("#enter");
  enter.hidden = false;
  enter.focus({ preventScroll: true });
  const go = () => {
    document.body.classList.remove("is-loading");
    $("#loader").classList.add("is-done");
    scene?.start();
    // Deep links (#projects) can't scroll while the loader locks the page — jump once it's gone
    if (location.hash) {
      const el = document.querySelector(location.hash);
      if (el) requestAnimationFrame(() => { el.classList.add("in"); el.scrollIntoView({ behavior: "instant" }); });
    }
    setTimeout(() => $("#loader").remove(), 900);
  };
  enter.addEventListener("click", go, { once: true });
  const q = new URLSearchParams(location.search);
  if (q.get("lang")) applyLang(q.get("lang"));
  if (q.has("debug")) window.__scene = scene;
  if (q.has("enter")) go(); // dev/preview: skip the Enter click
}

(async () => {
  setStep("fonts", 0, "loader.fonts");
  await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 2500))]);
  setStep("fonts", 1);

  if (window.feather) feather.replace({ "stroke-width": 1.75 });
  setStep("icons", 1);

  setStep("engine", 0.1, "loader.engine");
  try {
    const { createScene, LANDMARK_COLORS } = await import("./scene.js?v=20261013204909");
    setStep("engine", 1, "loader.city");
    scene = await createScene($("#scene"), {
      reducedMotion,
      onProgress: f => setStep("city", f),
      landmarks: LANDMARKS.length,
      onLandmark: showLandmark,
      onLandmarkClick: clickLandmark,
    });
    lmColors = LANDMARK_COLORS.map(([c]) => "#" + c.toString(16).padStart(6, "0"));
  } catch (err) {
    console.warn("3D scene unavailable:", err);
    document.body.classList.add("no-webgl");
    setStep("engine", 1); setStep("city", 1);
  }
})();

/* ---------- Landmarks ---------- */
// Data lives in #landmarks (EN) + i18n.js (ZH); order = rank (1 = tallest tower).
const LANDMARKS = [...document.querySelectorAll("#landmarks [data-lm]")].map(el => ({
  key: el.dataset.lm, icon: el.dataset.icon, href: el.dataset.href,
}));
const card = $("#lm-card");
const isTouch = matchMedia("(hover: none)").matches;
const found = new Set((() => { try { return JSON.parse(sessionStorage.getItem("lm-found") || "[]"); } catch { return []; } })());
let lmColors = [];
let shownRank = -1, hideTimer = null, pinned = false, finaleShown = found.size >= LANDMARKS.length;
$("#lm-total").textContent = LANDMARKS.length;
$("#lm-count").textContent = found.size;

function fillCard(rank) {
  const lm = LANDMARKS[rank];
  $("#lm-rank").textContent = `${rank + 1} / ${LANDMARKS.length}`;
  $("#lm-title").dataset.i18n = `lm.${lm.key}.t`;
  $("#lm-desc").dataset.i18n = `lm.${lm.key}.d`;
  $("#lm-title").innerHTML = t(`lm.${lm.key}.t`);
  $("#lm-desc").innerHTML = t(`lm.${lm.key}.d`);
  $("#lm-link").setAttribute("href", lm.href);
  $("#lm-icon").innerHTML = window.feather?.icons[lm.icon]?.toSvg({ "stroke-width": 1.75 }) ?? "";
  if (lmColors[rank]) card.style.setProperty("--lm", lmColors[rank]);
}

function markFound(rank) {
  const key = LANDMARKS[rank].key;
  if (found.has(key)) return;
  found.add(key);
  try { sessionStorage.setItem("lm-found", JSON.stringify([...found])); } catch {}
  $("#lm-count").textContent = found.size;
  $("#lm-progress").classList.add("bump");
  setTimeout(() => $("#lm-progress").classList.remove("bump"), 500);
  if (found.size === LANDMARKS.length && !finaleShown) {
    finaleShown = true;
    setTimeout(() => {
      hideCard();
      scene?.celebrate(21);
      openFinale();
    }, 900);
  }
}

// Called every frame by the scene: rank of hovered landmark + roof position, or -1
function showLandmark(rank, x, y) {
  if (rank < 0) {
    if (shownRank >= 0 && !pinned && !hideTimer) hideTimer = setTimeout(hideCard, 450);
    return;
  }
  clearTimeout(hideTimer); hideTimer = null;
  if (rank !== shownRank) {
    shownRank = rank;
    fillCard(rank);
    card.hidden = false;
    requestAnimationFrame(() => card.classList.add("show"));
    markFound(rank);
  }
  if (!isTouch && innerWidth > 860) {
    const w = card.offsetWidth, h = card.offsetHeight;
    const left = Math.min(innerWidth - w - 16, Math.max(16, x + 22));
    const top = Math.min(innerHeight - h - 16, Math.max(72, y - h / 2));
    card.style.transform = `translate(${left}px, ${top}px)`;
  }
}
function hideCard() {
  hideTimer = null; pinned = false; shownRank = -1;
  card.classList.remove("show");
  setTimeout(() => { if (shownRank < 0) card.hidden = true; }, 250);
}
function clickLandmark(rank, pointerType) {
  if (pointerType === "mouse") {
    document.querySelector(LANDMARKS[rank].href)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  } else {
    pinned = true; // touch: keep the card open until closed or scrolled away
  }
}
card.addEventListener("pointerenter", () => { clearTimeout(hideTimer); hideTimer = null; pinned = true; });
card.addEventListener("pointerleave", () => { if (!isTouch) { pinned = false; hideTimer = setTimeout(hideCard, 450); } });
$("#lm-close").addEventListener("click", hideCard);
$("#lm-link").addEventListener("click", hideCard);
// Award dialog: one badge per landmark in its own colour
function openFinale() {
  $("#lm-badges").innerHTML = LANDMARKS.map((lm, r) =>
    `<span class="lm-badge" style="--lm:${lmColors[r] ?? "var(--accent)"}">${window.feather?.icons[lm.icon]?.toSvg({ "stroke-width": 1.75 }) ?? ""}</span>`
  ).join("");
  const f = $("#lm-finale");
  f.hidden = false;
  requestAnimationFrame(() => f.classList.add("show"));
}
function closeFinale() {
  const f = $("#lm-finale");
  f.classList.remove("show");
  setTimeout(() => { f.hidden = true; }, 400);
}
$("#lm-finale-close").addEventListener("click", closeFinale);
$("#lm-finale-cta").addEventListener("click", closeFinale);
$("#lm-finale").addEventListener("click", e => { if (e.target.id === "lm-finale") closeFinale(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !$("#lm-finale").hidden) closeFinale(); });
addEventListener("scroll", () => { if (scrollY > innerHeight * 0.5 && shownRank >= 0) hideCard(); }, { passive: true });

/* ---------- Navigation ---------- */
$("#menu-btn").addEventListener("click", () => document.body.classList.toggle("menu-open"));
document.querySelectorAll(".nav-links a").forEach(a => a.addEventListener("click", () => document.body.classList.remove("menu-open")));
addEventListener("scroll", () => document.body.classList.toggle("scrolled", scrollY > 40), { passive: true });

/* ---------- Reveal on scroll ---------- */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
}, { threshold: 0.12 });
document.querySelectorAll(".reveal").forEach(el => io.observe(el));

/* ---------- Card tilt ---------- */
if (!reducedMotion && matchMedia("(hover: hover)").matches) {
  document.querySelectorAll(".card").forEach(card => {
    card.addEventListener("pointermove", e => {
      const r = card.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      card.style.transform = `perspective(800px) rotateY(${x * 6}deg) rotateX(${-y * 6}deg) translateY(-4px)`;
      card.style.setProperty("--mx", `${(x + 0.5) * 100}%`);
      card.style.setProperty("--my", `${(y + 0.5) * 100}%`);
    });
    card.addEventListener("pointerleave", () => { card.style.transform = ""; });
  });
}

$("#year").textContent = new Date().getFullYear();
