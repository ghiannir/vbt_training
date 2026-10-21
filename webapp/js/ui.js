// @ts-check
// DOM layer. The only module (with main.js) that touches document/window.
// All visible strings come from STRINGS (WA-83).

import { velocityAtLoad, loadAtVelocity } from "./lvprofile.js";

/** @typedef {import("./protocol.js").DeviceStatus} DeviceStatus */
/** @typedef {import("./session.js").StoredRep} StoredRep */
/** @typedef {import("./session.js").VbtSet} VbtSet */
/** @typedef {import("./session.js").Session} Session */
/** @typedef {import("./ble.js").ConnectionState} ConnectionState */
/** @typedef {import("./lvprofile.js").OneRmEstimate} OneRmEstimate */
/** @typedef {import("./lvprofile.js").LvPoint} LvPoint */

/** Italian UI strings. */
export const STRINGS = Object.freeze({
  conn: Object.freeze({
    disconnected: "Disconnesso",
    connecting: "Connessione...",
    connected: "Connesso",
    reconnecting: "Riconnessione...",
  }),
  btn: Object.freeze({
    connect: "Connetti",
    reconnect: "Riconnetti",
    disconnect: "Disconnetti",
    busy: "Attendi...",
    startSet: "AVVIA SERIE",
    stopSet: "TERMINA SERIE",
    wait: "ATTENDI...",
    tare: "Tara",
    endWorkout: "Fine allenamento",
    endWorkoutConfirm: "Tocca ancora per confermare",
    delete: "Elimina",
    deleteConfirm: "Confermi? Tocca ancora",
    dismiss: "Chiudi",
    reload: "Ricarica",
    exportJson: "Esporta JSON",
  }),
  state: Object.freeze({
    0: "Inattivo",
    1: "Calibrazione...",
    2: "Pronto",
    3: "Serie in corso",
    4: "Serie conclusa",
    5: "Errore",
  }),
  errors: Object.freeze({
    1: "Errore sensore IMU",
    2: "Calibrazione fallita: il sensore si e' mosso",
    3: "Comando non valido",
  }),
  level: Object.freeze({ ok: "OK", warn: "ATTENZIONE", alarm: "SOGLIA SUPERATA" }),
  live: Object.freeze({
    rep: (/** @type {number} */ n) => `Rep ${n}`,
    noRep: "Rep -",
    peak: "picco m/s",
    lowQuality: "Stima dubbia per questa ripetizione",
    lostReps: "Alcune ripetizioni non sono state recuperate",
    threshold: (/** @type {number} */ t) => (t > 0 ? `soglia ${t}%` : "soglia off"),
    set: (/** @type {number} */ n) => `Serie ${n}`,
    reps: (/** @type {number} */ n) => `${n} ${n === 1 ? "rep" : "rep"}`,
    empty: "Nessuna ripetizione ancora.",
    best: "migliore",
  }),
  banner: Object.freeze({
    unsupported: "Apri questa pagina in Bluefy per usare il Bluetooth.",
    demo: "Modalita demo: sensore simulato, nessun Bluetooth.",
    update: "Aggiornamento disponibile.",
    suspended: "La pagina era in background: alcune ripetizioni potrebbero mancare. Risincronizzo il sensore.",
    memoryOnly: "Archivio non disponibile (modalita privata?): i dati non verranno salvati.",
    backupNever: "Non hai ancora fatto un backup dei dati.",
    backupOld: (/** @type {number} */ d) => `Ultimo backup: ${d} giorni fa.`,
    noWakeLock: "Il blocco schermo non e' supportato: tieni lo schermo acceso a mano.",
  }),
  history: Object.freeze({
    empty: "Nessun allenamento salvato.",
    all: "Tutti gli esercizi",
    sets: (/** @type {number} */ n) => `${n} ${n === 1 ? "serie" : "serie"}`,
    noLoad: "carico ?",
    bestMcv: "migliore",
    meanMcv: "media",
    lossFinal: "perdita finale",
    inProgress: "in corso",
    persistent: "I dati sono salvati su questo dispositivo. Esporta un backup ogni tanto.",
    volatile: "Archivio non persistente: i dati si perdono alla chiusura della pagina.",
  }),
  profile: Object.freeze({
    insufficient: "Dati insufficienti",
    estimate: "1RM stimato",
    range: "intervallo",
    r2: "R²",
    mvt: "vel. minima",
    excluded: (/** @type {number} */ n) => `${n} ${n === 1 ? "serie esclusa" : "serie escluse"} (carico non inserito)`,
    expected: (/** @type {number} */ v) => `${v.toFixed(2)} m/s`,
    loadFor: (/** @type {number} */ kg) => `${Math.round(kg * 10) / 10} kg`,
    needMore: (/** @type {number} */ n) =>
      `Servono almeno 3 carichi diversi (ne hai ${n}), meglio 4+ con 15 kg di intervallo.`,
    badSlope: "La velocita non cala all'aumentare del carico: stima non valida.",
    noData: "Nessuna serie con carico per questo esercizio.",
  }),
  settings: Object.freeze({
    version: "VBT Training",
  }),
  toast: Object.freeze({
    copied: "Fatto",
  }),
});

/** Exercise keys match DEFAULT_MVT in lvprofile.js. */
export const EXERCISES = Object.freeze([
  { key: "squat", label: "Squat" },
  { key: "bench", label: "Panca piana" },
  { key: "deadlift", label: "Stacco" },
  { key: "press", label: "Military press" },
  { key: "generic", label: "Generico" },
]);

/** @param {string} key */
export function exerciseLabel(key) {
  return EXERCISES.find((e) => e.key === key)?.label ?? key;
}

/**
 * @typedef {Object} UiHandlers
 * @property {() => void} onConnect          tap: connect (user gesture)
 * @property {() => void} onReconnect        tap: manual reconnect to the same device
 * @property {() => void} onDisconnect
 * @property {() => void} onStartSet
 * @property {() => void} onStopSet
 * @property {() => void} onTare
 * @property {(kg: number) => void} onLoadChange
 * @property {(kg: number) => void} onLoadStepChange
 * @property {(exercise: string) => void} onExerciseChange
 * @property {(pct: number) => void} onThresholdChange
 * @property {(on: boolean) => void} onSoundChange
 * @property {(on: boolean) => void} onRepeatAlarmChange
 * @property {() => void} onEndWorkout
 * @property {(format: "json"|"csv") => void} onExport
 * @property {(file: File) => void} onImport
 * @property {(sessionId: string) => void} onDeleteSession
 * @property {(viewId: string) => void} onViewChange
 * @property {(exercise: string) => void} onProfileExercise
 * @property {(exercise: string, mvt: number) => void} onMvtChange
 * @property {() => void} onResume           page visible again after being hidden while connected
 * @property {(cfg: { enabled: boolean, repo: string, token: string }) => void} onGithubChange
 * @property {() => Promise<{ ok: boolean, message: string }>} onGithubTest
 */

/** @type {UiHandlers} */
let H = /** @type {any} */ (null);

const ui = {
  soundOn: true,
  loadStep: 2.5,
  load: 0,
  thresholdPct: 20,
  /** @type {ConnectionState} */
  connState: "disconnected",
  canReconnect: false,
  btSupported: true,
  /** @type {DeviceStatus|null} */
  status: null,
  /** @type {AudioContext|null} */
  audio: null,
  wakeWanted: false,
  /** @type {any} */
  wakeSentinel: null,
  hiddenAt: 0,
  /** @type {Session[]} */
  sessions: [],
  historyFilter: "",
  /** @type {import("./lvprofile.js").LvFit|null} */
  fit: null,
  /** @type {number|undefined} */
  toastTimer: undefined,
};

/** @param {string} id @returns {any} */
const $ = (id) => /** @type {any} */ (document.getElementById(id));

/**
 * Tiny DOM builder. `class`, `text`, `on<event>` and plain attributes are supported.
 * @param {string} tag
 * @param {Record<string, any>} [props]
 * @param {...any} kids
 * @returns {HTMLElement}
 */
function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of kids.flat()) if (c != null) n.append(c);
  return n;
}

/** @param {number} v @param {number} d */
const fmt = (v, d = 2) => v.toFixed(d);

// ---------------------------------------------------------------- init

/**
 * Build the UI and bind handlers. Call once after DOMContentLoaded.
 * @param {UiHandlers} handlers
 * @returns {void}
 */
export function initUi(handlers) {
  H = handlers;

  window.addEventListener("error", (e) => log(`${e.message} (${e.filename?.split("/").pop()}:${e.lineno})`, "error"));
  window.addEventListener("unhandledrejection", (e) =>
    log(`Promise rifiutata: ${/** @type {any} */ (e.reason)?.message ?? e.reason}`, "error"));

  // Audio must be unlocked by a gesture (WA-40): any first touch does it.
  document.addEventListener("pointerdown", unlockAudio, { passive: true });

  // Tabs
  for (const b of document.querySelectorAll("#tabs button")) {
    b.addEventListener("click", () => showView(/** @type {HTMLElement} */ (b).dataset.view ?? "view-live"));
  }

  // Connection button
  $("btn-connect").addEventListener("click", () => {
    unlockAudio();
    if (ui.connState === "connected" || ui.connState === "reconnecting") H.onDisconnect();
    else if (ui.canReconnect) H.onReconnect();
    else H.onConnect();
  });

  // Set controls
  $("btn-set").addEventListener("click", () => {
    unlockAudio();
    if (ui.status?.state === 3) H.onStopSet();
    else H.onStartSet();
  });
  $("btn-tare").addEventListener("click", () => H.onTare());

  // Exercise and load
  const sel = $("exercise");
  for (const ex of EXERCISES) sel.append(el("option", { value: ex.key, text: ex.label }));
  sel.addEventListener("change", () => H.onExerciseChange(sel.value));

  bindRepeat($("load-minus"), () => stepLoad(-1));
  bindRepeat($("load-plus"), () => stepLoad(1));
  $("load").addEventListener("change", () => setLoad(parseFloat($("load").value) || 0));
  $("load").addEventListener("focus", (/** @type {any} */ e) => e.target.select());

  // Settings
  $("thr-minus").addEventListener("click", () => stepThreshold(-5));
  $("thr-plus").addEventListener("click", () => stepThreshold(5));
  $("sound").addEventListener("change", () => {
    ui.soundOn = $("sound").checked;
    if (ui.soundOn) unlockAudio();
    H.onSoundChange(ui.soundOn);
  });
  $("repeat-alarm").addEventListener("change", () => H.onRepeatAlarmChange($("repeat-alarm").checked));
  $("load-step").addEventListener("change", () => {
    ui.loadStep = parseFloat($("load-step").value) || 2.5;
    H.onLoadStepChange(ui.loadStep);
  });
  $("btn-test-sound").addEventListener("click", () => { unlockAudio(); beep(); });
  const ghChanged = () => H.onGithubChange({
    enabled: $("gh-enabled").checked,
    repo: $("gh-repo").value.trim(),
    token: $("gh-token").value.trim(),
  });
  for (const id of ["gh-enabled", "gh-repo", "gh-token"]) $(id).addEventListener("change", ghChanged);
  $("btn-gh-test").addEventListener("click", async () => {
    ghChanged();
    const out = $("gh-test-result");
    out.textContent = "Verifica in corso...";
    $("btn-gh-test").disabled = true;
    try {
      const r = await H.onGithubTest();
      out.textContent = r.message;
      out.dataset.ok = String(r.ok);
    } finally { $("btn-gh-test").disabled = false; }
  });
  confirmButton($("btn-end-workout"), STRINGS.btn.endWorkout, STRINGS.btn.endWorkoutConfirm, () => H.onEndWorkout());

  // History
  $("btn-export-json").addEventListener("click", () => H.onExport("json"));
  $("btn-export-csv").addEventListener("click", () => H.onExport("csv"));
  $("import-file").addEventListener("change", (/** @type {any} */ e) => {
    const f = e.target.files?.[0];
    if (f) H.onImport(f);
    e.target.value = "";
  });
  $("history-filter").addEventListener("change", () => {
    ui.historyFilter = $("history-filter").value;
    renderHistory();
  });

  // Profile
  const psel = $("profile-exercise");
  for (const ex of EXERCISES) psel.append(el("option", { value: ex.key, text: ex.label }));
  psel.addEventListener("change", () => H.onProfileExercise(psel.value));
  $("mvt").addEventListener("change", () => {
    const v = parseFloat($("mvt").value);
    if (v > 0) H.onMvtChange(psel.value, v);
  });
  $("calc-load").addEventListener("input", updateCalc);
  $("calc-v").addEventListener("input", updateCalc);

  // Wake lock and background detection
  document.addEventListener("visibilitychange", onVisibility);

  $("app-version").textContent = STRINGS.settings.version;
  setBluetoothSupported(true);
  updateControls();
}

/**
 * Press-and-hold repeats the action (WA-31).
 * @param {HTMLElement} btn
 * @param {() => void} fn
 */
function bindRepeat(btn, fn) {
  /** @type {number|undefined} */ let delay;
  /** @type {number|undefined} */ let timer;
  const stop = () => { clearTimeout(delay); clearInterval(timer); };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fn();
    delay = window.setTimeout(() => { timer = window.setInterval(fn, 110); }, 450);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) btn.addEventListener(ev, stop);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  btn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
  });
}

/**
 * Two-tap button for destructive actions (WA-23).
 * @param {HTMLElement} btn
 * @param {string} label
 * @param {string} armedLabel
 * @param {() => void} action
 */
function confirmButton(btn, label, armedLabel, action) {
  /** @type {number|undefined} */ let t;
  const reset = () => { clearTimeout(t); btn.textContent = label; btn.classList.remove("armed"); };
  btn.textContent = label;
  btn.addEventListener("click", () => {
    if (btn.classList.contains("armed")) { reset(); action(); return; }
    btn.textContent = armedLabel;
    btn.classList.add("armed");
    t = window.setTimeout(reset, 4000);
  });
}

// ---------------------------------------------------------------- views

/** @param {string} viewId */
export function showView(viewId) {
  for (const v of document.querySelectorAll(".view")) /** @type {HTMLElement} */ (v).hidden = v.id !== viewId;
  for (const b of document.querySelectorAll("#tabs button")) {
    b.setAttribute("aria-selected", String(/** @type {HTMLElement} */ (b).dataset.view === viewId));
  }
  window.scrollTo(0, 0);
  H?.onViewChange(viewId);
}

/**
 * Apply persisted settings to the controls.
 * @param {{ exercise?: string, loadKg?: number, loadStepKg?: number, thresholdPct?: number,
 *           soundOn?: boolean, repeatAlarm?: boolean,
 *           githubEnabled?: boolean, githubRepo?: string, githubToken?: string }} s
 */
export function applySettings(s) {
  if (s.exercise != null) $("exercise").value = s.exercise;
  if (s.loadStepKg != null) { ui.loadStep = s.loadStepKg; $("load-step").value = String(s.loadStepKg); }
  if (s.loadKg != null) { ui.load = s.loadKg; $("load").value = String(s.loadKg); }
  if (s.thresholdPct != null) {
    ui.thresholdPct = s.thresholdPct;
    $("threshold").textContent = `${s.thresholdPct}%`;
    $("bar-thr").textContent = STRINGS.live.threshold(s.thresholdPct);
  }
  if (s.soundOn != null) { ui.soundOn = s.soundOn; $("sound").checked = s.soundOn; }
  if (s.repeatAlarm != null) $("repeat-alarm").checked = s.repeatAlarm;
  if (s.githubEnabled != null) $("gh-enabled").checked = s.githubEnabled;
  if (s.githubRepo != null) $("gh-repo").value = s.githubRepo;
  if (s.githubToken != null) $("gh-token").value = s.githubToken;
}

/**
 * Show the GitHub upload state: status line in settings and a small chip in the top bar.
 * @param {{ enabled: boolean, busy: boolean, pending: number, lastAt: number|null, error: string|null }} st
 */
export function showGithubStatus(st) {
  const chip = $("gh-status");
  chip.hidden = !st.enabled;
  chip.dataset.state = st.error ? "error" : st.busy || st.pending ? "pending" : "ok";
  chip.title = st.error ? `GitHub: ${st.error}` : "Salvataggio su GitHub";
  const parts = [];
  if (st.lastAt) parts.push(`Ultimo salvataggio: ${new Date(st.lastAt).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}`);
  else parts.push("Nessun salvataggio ancora");
  if (st.pending) parts.push(`In attesa: ${st.pending} ${st.pending === 1 ? "sessione" : "sessioni"}`);
  if (st.error) parts.push(`Errore: ${st.error}`);
  $("gh-sync").textContent = parts.join(" - ");
}

/** @param {number} dir */
function stepLoad(dir) { setLoad(ui.load + dir * ui.loadStep); }

/** @param {number} kg */
function setLoad(kg) {
  kg = Math.min(500, Math.max(0, Math.round(kg * 100) / 100));
  ui.load = kg;
  $("load").value = String(kg);
  H.onLoadChange(kg);
}

/** Update the load field without notifying (e.g. when a set is restored). @param {number} kg */
export function showLoad(kg) {
  ui.load = kg;
  $("load").value = String(kg);
}

/** @param {number} delta */
function stepThreshold(delta) {
  const pct = Math.min(50, Math.max(5, ui.thresholdPct + delta));
  if (pct === ui.thresholdPct) return;
  applySettings({ thresholdPct: pct });
  H.onThresholdChange(pct);
}

// ---------------------------------------------------------------- connection

/** @param {boolean} supported */
export function setBluetoothSupported(supported) {
  ui.btSupported = supported;
  if (!supported) showBanner("unsupported", STRINGS.banner.unsupported, { level: "error" });
  else hideBanner("unsupported");
  updateConnectButton();
}

/**
 * @param {ConnectionState} state
 * @param {{ batteryPct?: number, message?: string, canReconnect?: boolean }} [info]
 */
export function showConnection(state, info) {
  ui.connState = state;
  ui.canReconnect = !!info?.canReconnect;
  $("statusbar").dataset.state = state;
  $("conn-state").textContent = STRINGS.conn[state];
  $("conn-detail").textContent = info?.message ?? "";
  if (info?.batteryPct != null) showBattery(info.batteryPct, false);
  if (state === "disconnected") {
    $("battery").hidden = true;
    ui.status = null;
    $("dev-state").textContent = "--";
  }
  updateConnectButton();
  updateControls();
}

function updateConnectButton() {
  const b = $("btn-connect");
  const s = ui.connState;
  b.disabled = !ui.btSupported || s === "connecting";
  b.classList.toggle("btn-primary", s === "disconnected");
  b.classList.toggle("btn-secondary", s !== "disconnected");
  b.textContent =
    s === "connecting" ? STRINGS.btn.busy
    : s === "connected" || s === "reconnecting" ? STRINGS.btn.disconnect
    : ui.canReconnect ? STRINGS.btn.reconnect
    : STRINGS.btn.connect;
}

/**
 * @param {number} pct
 * @param {boolean} charging
 */
function showBattery(pct, charging) {
  const b = $("battery");
  b.hidden = false;
  b.textContent = `${charging ? "+" : ""}${pct}%`;
  b.dataset.low = String(pct <= 15 && !charging);
  b.title = charging ? "In carica" : "Batteria sensore";
}

/** @param {DeviceStatus} status */
export function showStatus(status) {
  ui.status = status;
  showBattery(status.batteryPct, status.charging);
  const chip = $("dev-state");
  chip.textContent = status.state === 5 && status.errorCode
    ? /** @type {any} */ (STRINGS.errors)[status.errorCode] ?? STRINGS.state[5]
    : /** @type {any} */ (STRINGS.state)[status.state] ?? "--";
  chip.dataset.state = String(status.state);
  updateControls();
}

function updateControls() {
  const connected = ui.connState === "connected";
  const st = ui.status?.state;
  const btn = $("btn-set");
  const active = st === 3;
  btn.textContent = active ? STRINGS.btn.stopSet : st === 1 || st == null ? (connected ? STRINGS.btn.wait : STRINGS.btn.startSet) : STRINGS.btn.startSet;
  btn.classList.toggle("btn-go", !active);
  btn.classList.toggle("btn-stop", active);
  btn.disabled = !connected || !(active || st === 2 || st === 4);
  $("btn-tare").disabled = !connected || !(st === 0 || st === 2 || st === 4 || st === 5);
}

// ---------------------------------------------------------------- live display

/**
 * @param {number} loss
 * @param {number} thr
 * @returns {"ok"|"warn"|"alarm"}
 */
function levelFor(loss, thr) {
  if (thr <= 0) return "ok";
  if (loss >= thr) return "alarm";
  if (loss >= thr * 0.5) return "warn";
  return "ok";
}

/**
 * Big live display of the latest rep (WA-20, WA-21).
 * @param {StoredRep} rep
 * @param {number} thresholdPct
 */
export function showRep(rep, thresholdPct) {
  const loss = rep.velocityLossPct;
  const level = rep.thresholdExceeded ? "alarm" : levelFor(loss, thresholdPct);
  $("view-live").dataset.level = level;
  $("live-mcv").textContent = fmt(rep.mcv);
  $("live-rep").textContent = STRINGS.live.rep(rep.repIndex);
  $("live-loss").textContent = `${loss}%`;
  $("live-level").textContent = STRINGS.level[level];
  $("live-level").dataset.level = level;
  $("x-peak").textContent = fmt(rep.peak);
  $("x-rom").textContent = String(Math.round(rep.rom * 100));
  $("x-dur").textContent = fmt(rep.concDuration);
  $("live-note").textContent = rep.lowQuality ? STRINGS.live.lowQuality : "";
  const scaleMax = thresholdPct > 0 ? thresholdPct * 1.5 : 50;
  $("loss-fill").style.width = `${Math.min(100, (loss / scaleMax) * 100)}%`;
  $("loss-fill").dataset.level = level;
  $("loss-mark").style.left = thresholdPct > 0 ? `${(thresholdPct / scaleMax) * 100}%` : "100%";
  $("bar-thr").textContent = STRINGS.live.threshold(thresholdPct);
}

function resetLive() {
  $("view-live").dataset.level = "idle";
  $("live-mcv").textContent = "--";
  $("live-rep").textContent = STRINGS.live.noRep;
  $("live-loss").textContent = "--";
  $("live-level").innerHTML = "&nbsp;";
  $("live-level").dataset.level = "idle";
  $("x-peak").textContent = $("x-rom").textContent = $("x-dur").textContent = "--";
  $("live-note").textContent = "";
  $("loss-fill").style.width = "0%";
  $("loss-mark").style.left = `${100 / 1.5}%`;
}

/**
 * Re-render the rep list and set header.
 * @param {VbtSet|null} set
 * @param {number} [setNumber] 1-based position of the set in the workout
 */
export function showSet(set, setNumber) {
  const list = $("rep-list");
  list.replaceChildren();
  if (!set || set.reps.length === 0) {
    resetLive();
    $("set-info").textContent = set ? STRINGS.live.set(setNumber ?? 1) : "";
    $("list-count").textContent = "";
    if (set?.lostReps) $("live-note").textContent = STRINGS.live.lostReps;
    return;
  }
  const reps = [...set.reps].sort((a, b) => b.repIndex - a.repIndex);
  const best = Math.max(...reps.map((r) => r.mcv));
  const thr = set.thresholdPct;
  for (const r of reps) {
    const level = r.thresholdExceeded ? "alarm" : levelFor(r.velocityLossPct, thr);
    list.append(el("li", { class: "rep-row", "data-level": level },
      el("span", { class: "rep-n", text: `#${r.repIndex}` }),
      el("span", { class: "rep-v", text: `${fmt(r.mcv)} m/s` }),
      r.mcv === best ? el("span", { class: "tag", text: STRINGS.live.best }) : el("span"),
      el("span", { class: "rep-l", text: `-${r.velocityLossPct}%` })));
  }
  const parts = [STRINGS.live.set(setNumber ?? 1)];
  if (set.loadKg) parts.push(`${set.loadKg} kg`);
  $("set-info").textContent = parts.join(" - ");
  $("list-count").textContent = STRINGS.live.reps(reps.length);
  const last = reps[0];
  showRep(last, thr);
  if (set.lostReps) $("live-note").textContent = STRINGS.live.lostReps;
}

// ---------------------------------------------------------------- alarm

/** Visual (and sound/vibration) velocity-loss alarm (WA-40). */
export function triggerAlarm() {
  const f = $("flash");
  f.classList.remove("on");
  void f.offsetWidth; // restart the CSS animation
  f.classList.add("on");
  if (ui.soundOn) beep();
  try { navigator.vibrate?.([200, 100, 200, 100, 200]); } catch { /* not on iOS */ }
}

/** Unlock WebAudio on the first user gesture (WA-40). */
export function unlockAudio() {
  try {
    const AC = window.AudioContext ?? /** @type {any} */ (window).webkitAudioContext;
    if (!AC) return;
    ui.audio ??= new AC();
    if (ui.audio.state === "suspended") ui.audio.resume();
  } catch (e) { /* audio is optional */ }
}

function beep() {
  const ctx = ui.audio;
  if (!ctx) return;
  const t0 = ctx.currentTime + 0.02;
  for (let i = 0; i < 3; i++) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = i === 2 ? 1175 : 880;
    const t = t0 + i * 0.22;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.4, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  }
}

// ---------------------------------------------------------------- wake lock

/** @param {boolean} on */
export function setWakeLock(on) {
  ui.wakeWanted = on;
  if (on) acquireWake();
  else releaseWake();
}

async function acquireWake() {
  const wl = /** @type {any} */ (navigator).wakeLock;
  if (!wl) { showBanner("nowake", STRINGS.banner.noWakeLock, { level: "info", dismissible: true }); return; }
  if (ui.wakeSentinel || document.visibilityState !== "visible") return;
  try {
    const s = await wl.request("screen");
    s.addEventListener("release", () => { if (ui.wakeSentinel === s) ui.wakeSentinel = null; });
    ui.wakeSentinel = s;
  } catch (e) {
    log(`Wake lock non ottenuto: ${/** @type {any} */ (e)?.message ?? e}`, "warn");
  }
}

function releaseWake() {
  const s = ui.wakeSentinel;
  ui.wakeSentinel = null;
  try { s?.release(); } catch { /* ignore */ }
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    ui.hiddenAt = Date.now();
    return;
  }
  const away = ui.hiddenAt ? Date.now() - ui.hiddenAt : 0;
  ui.hiddenAt = 0;
  if (!ui.wakeWanted) return;
  acquireWake();
  if (away > 2000) {
    showBanner("suspended", STRINGS.banner.suspended, { level: "warn", dismissible: true });
    H.onResume();
  }
}

// ---------------------------------------------------------------- banners, toast, log

/**
 * @param {string} id
 * @param {string} text
 * @param {{ level?: "info"|"warn"|"error", dismissible?: boolean,
 *           actions?: Array<{ label: string, onClick: () => void }> }} [opts]
 */
export function showBanner(id, text, opts = {}) {
  hideBanner(id);
  const b = el("div", { class: "banner", id: `banner-${id}`, "data-level": opts.level ?? "info" },
    el("span", { class: "banner-text", text }),
    (opts.actions ?? []).map((a) => el("button", { type: "button", class: "btn btn-small", onclick: a.onClick, text: a.label })),
    opts.dismissible ? el("button", { type: "button", class: "btn btn-small", onclick: () => hideBanner(id), text: STRINGS.btn.dismiss }) : null);
  $("banners").append(b);
}

/** @param {string} id */
export function hideBanner(id) {
  document.getElementById(`banner-${id}`)?.remove();
}

/** @param {string} message */
export function toast(message) {
  const t = $("toast");
  t.textContent = message;
  t.hidden = false;
  clearTimeout(ui.toastTimer);
  ui.toastTimer = window.setTimeout(() => { t.hidden = true; }, 4000);
}

/** @param {string} message @param {"info"|"warn"|"error"} [level] */
export function log(message, level = "info") {
  const box = $("log");
  if (level !== "info") console[level === "error" ? "error" : "warn"](message);
  if (!box) return;
  const time = new Date().toLocaleTimeString("it-IT");
  box.textContent += `${time} ${level === "info" ? "" : level.toUpperCase() + " "}${message}\n`;
  const lines = box.textContent.split("\n");
  if (lines.length > 300) box.textContent = lines.slice(-250).join("\n");
  if (level === "error") toast(message);
}

/** Show the "backup reminder" banner (WA-52). @param {number|null} daysSince */
export function showBackupReminder(daysSince) {
  showBanner("backup", daysSince == null ? STRINGS.banner.backupNever : STRINGS.banner.backupOld(daysSince), {
    level: "warn",
    dismissible: true,
    actions: [{ label: STRINGS.btn.exportJson, onClick: () => { H.onExport("json"); hideBanner("backup"); } }],
  });
}

/** @param {boolean} persistent */
export function showStorageMode(persistent) {
  $("storage-note").textContent = persistent ? STRINGS.history.persistent : STRINGS.history.volatile;
  if (!persistent) showBanner("memory", STRINGS.banner.memoryOnly, { level: "warn", dismissible: true });
}

// ---------------------------------------------------------------- history

/** @param {Session[]} sessions */
export function showHistory(sessions) {
  ui.sessions = sessions;
  const exercises = new Set();
  for (const s of sessions) for (const set of s.sets) exercises.add(set.exercise);
  const sel = $("history-filter");
  const current = ui.historyFilter;
  sel.replaceChildren(el("option", { value: "", text: STRINGS.history.all }),
    ...[...exercises].map((k) => el("option", { value: k, text: exerciseLabel(k) })));
  ui.historyFilter = exercises.has(current) ? current : "";
  sel.value = ui.historyFilter;
  renderHistory();
}

const dateFmt = new Intl.DateTimeFormat("it-IT", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function renderHistory() {
  const root = $("history-list");
  root.replaceChildren();
  const filter = ui.historyFilter;
  let shown = 0;
  for (const s of ui.sessions) {
    const sets = s.sets.filter((x) => !filter || x.exercise === filter);
    if (!sets.length) continue;
    shown++;
    const body = el("div", { class: "session-body" });
    sets.forEach((set, i) => body.append(renderSetCard(set, i + 1)));
    const del = el("button", { type: "button", class: "btn btn-danger" });
    confirmButton(del, STRINGS.btn.delete, STRINGS.btn.deleteConfirm, () => H.onDeleteSession(s.id));
    body.append(del);
    root.append(el("details", { class: "card session" },
      el("summary", {},
        el("span", { class: "s-date", text: dateFmt.format(new Date(s.startedAt)) }),
        el("span", { class: "muted", text: STRINGS.history.sets(s.sets.length) + (s.endedAt ? "" : ` - ${STRINGS.history.inProgress}`) })),
      body));
  }
  if (!shown) root.append(el("p", { class: "muted", text: STRINGS.history.empty }));
}

/** @param {VbtSet} set @param {number} n */
function renderSetCard(set, n) {
  const reps = [...set.reps].sort((a, b) => a.repIndex - b.repIndex);
  const best = reps.length ? Math.max(...reps.map((r) => r.mcv)) : 0;
  const mean = reps.length ? reps.reduce((a, r) => a + r.mcv, 0) / reps.length : 0;
  const lastLoss = reps.length ? reps[reps.length - 1].velocityLossPct : 0;
  const title = `${exerciseLabel(set.exercise)} - ${set.loadKg ? set.loadKg + " kg" : STRINGS.history.noLoad}`;
  return el("div", { class: "set-card" },
    el("div", { class: "set-title" }, el("b", { text: `${n}. ${title}` }), el("span", { class: "muted", text: STRINGS.live.reps(reps.length) })),
    el("div", { class: "muted", text: `${STRINGS.history.bestMcv} ${fmt(best)} - ${STRINGS.history.meanMcv} ${fmt(mean)} m/s - ${STRINGS.history.lossFinal} ${lastLoss}%` }),
    el("div", { class: "chips" }, reps.map((r) =>
      el("span", { class: "chip-rep", "data-level": levelFor(r.velocityLossPct, set.thresholdPct) }, `${fmt(r.mcv)}`))));
}

// ---------------------------------------------------------------- profile

/**
 * @param {string} exercise
 * @param {number} mvt
 */
export function setProfileControls(exercise, mvt) {
  $("profile-exercise").value = exercise;
  $("mvt").value = String(mvt);
}

/**
 * @param {LvPoint[]} points
 * @param {OneRmEstimate|null} estimate  null => "dati insufficienti"
 * @param {string} [reason]
 * @param {{ excluded?: number }} [extra]
 */
export function showProfile(points, estimate, reason, extra) {
  const res = $("lv-result");
  res.replaceChildren();
  ui.fit = estimate?.fit ?? null;
  drawChart($("lv-chart"), points, estimate);
  if (!estimate) {
    res.append(el("b", { text: STRINGS.profile.insufficient }));
    if (reason) res.append(el("p", { text: reason }));
  } else {
    res.append(
      el("div", { class: "oneRm" }, el("span", { class: "muted", text: STRINGS.profile.estimate }),
        el("b", { class: "big", text: `${Math.round(estimate.oneRmKg)} kg` })),
      el("div", { class: "muted", text: `${STRINGS.profile.range} ${Math.round(estimate.lowKg)}-${Math.round(estimate.highKg)} kg - ${STRINGS.profile.r2} ${estimate.fit.r2.toFixed(2)} - ${STRINGS.profile.mvt} ${estimate.mvt} m/s` }),
      ...estimate.warnings.map((w) => el("p", { class: "warn-text", text: w })));
  }
  if (extra?.excluded) res.append(el("p", { class: "muted", text: STRINGS.profile.excluded(extra.excluded) }));
  $("lv-calc").hidden = !ui.fit;
  updateCalc();
}

function updateCalc() {
  const fit = ui.fit;
  const out1 = $("calc-vel");
  const out2 = $("calc-kg");
  out1.textContent = out2.textContent = "--";
  if (!fit) return;
  const kg = parseFloat($("calc-load").value);
  if (kg >= 0) out1.textContent = STRINGS.profile.expected(Math.max(0, velocityAtLoad(fit, kg)));
  const v = parseFloat($("calc-v").value);
  if (v > 0) {
    try { out2.textContent = STRINGS.profile.loadFor(loadAtVelocity(fit, v)); } catch { out2.textContent = "--"; }
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * @param {string} tag
 * @param {Record<string, string|number>} attrs
 * @param {string} [text]
 */
function svg(tag, attrs, text) {
  const n = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text != null) n.textContent = text;
  return n;
}

/**
 * Load-velocity scatter + fitted line + 1RM marker (WA-63). Inline SVG, no libraries.
 * @param {SVGElement} root
 * @param {LvPoint[]} points
 * @param {OneRmEstimate|null} est
 */
function drawChart(root, points, est) {
  root.replaceChildren();
  const W = 360, Ht = 260, L = 44, R = 12, T = 14, B = 36;
  const maxLoad = Math.max(10, ...points.map((p) => p.loadKg), est ? est.oneRmKg : 0) * 1.08;
  const maxV = Math.max(0.5, ...points.map((p) => p.velocity)) * 1.15;
  const x = (/** @type {number} */ kg) => L + (kg / maxLoad) * (W - L - R);
  const y = (/** @type {number} */ v) => Ht - B - (v / maxV) * (Ht - T - B);

  root.append(svg("line", { x1: L, y1: Ht - B, x2: W - R, y2: Ht - B, class: "axis" }),
    svg("line", { x1: L, y1: T, x2: L, y2: Ht - B, class: "axis" }));
  const xStep = maxLoad > 200 ? 50 : maxLoad > 100 ? 20 : 10;
  for (let k = 0; k <= maxLoad; k += xStep) {
    root.append(svg("line", { x1: x(k), y1: Ht - B, x2: x(k), y2: Ht - B + 4, class: "axis" }),
      svg("text", { x: x(k), y: Ht - B + 18, class: "tick", "text-anchor": "middle" }, String(k)));
  }
  for (let v = 0; v <= maxV; v += 0.2) {
    root.append(svg("line", { x1: L - 4, y1: y(v), x2: W - R, y2: y(v), class: "grid" }),
      svg("text", { x: L - 7, y: y(v) + 4, class: "tick", "text-anchor": "end" }, v.toFixed(1)));
  }
  root.append(svg("text", { x: (L + W - R) / 2, y: Ht - 4, class: "tick", "text-anchor": "middle" }, "kg"),
    svg("text", { x: 12, y: T + 4, class: "tick" }, "m/s"));

  if (est) {
    const { intercept, slope } = est.fit;
    const x2 = est.oneRmKg;
    root.append(
      svg("line", { x1: L, y1: y(est.mvt), x2: W - R, y2: y(est.mvt), class: "mvt-line" }),
      svg("line", { x1: x(0), y1: y(intercept), x2: x(x2), y2: y(intercept + slope * x2), class: "fit-line" }),
      svg("circle", { cx: x(x2), cy: y(est.mvt), r: 8, class: "rm-dot" }),
      svg("text", { x: Math.min(x(x2), W - 40), y: y(est.mvt) - 14, class: "rm-label", "text-anchor": "middle" }, `1RM ${Math.round(x2)}`));
  }
  for (const p of points) root.append(svg("circle", { cx: x(p.loadKg), cy: y(p.velocity), r: 6, class: "pt" }));
}
