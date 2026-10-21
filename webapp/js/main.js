// @ts-check
// Entry point: wires ble.js, session.js, storage.js, lvprofile.js and ui.js together.
// Also registers the optional service worker (WA-71) and handles ?demo=1 (WA-81).

import { State } from "./protocol.js";
import { VbtBle } from "./ble.js";
import { SimulatedBle } from "./simulator.js";
import { SessionTracker } from "./session.js";
import {
  loadSettings, saveSettings, openStore, sessionsToCsv, requestPersistence, downloadTextFile,
} from "./storage.js";
import { pointsFromSets, estimateOneRm, mvtForExercise } from "./lvprofile.js";
import { createUploader, testConnection } from "./github.js";
import * as ui from "./ui.js";

/** @typedef {import("./session.js").VbtSet} VbtSet */
/** @typedef {import("./session.js").Session} Session */

const DAY_MS = 86400000;
const BACKUP_REMINDER_DAYS = 7;
const DRAFT_MAX_AGE_MS = 3 * 3600 * 1000;
/** A load change within this window of a set ending also corrects that set (WA-31). */
const LOAD_CORRECTION_MS = 20000;
const MAX_RECONNECT_ATTEMPTS = 5;

/** Called once on DOMContentLoaded. */
export async function main() {
  const demo = new URLSearchParams(location.search).get("demo") === "1";
  let settings = loadSettings();

  /** @type {import("./storage.js").Store|null} Demo data is never persisted. */
  let store = null;
  if (!demo) {
    try { store = await openStore(); } catch (e) { ui.log(`Storage unavailable: ${errText(e)}`, "error"); }
  }

  const tracker = new SessionTracker({
    exercise: settings.exercise,
    thresholdPct: settings.thresholdPct,
    loadKg: settings.loadKg > 0 ? settings.loadKg : null,
  });

  /** @type {VbtBle|SimulatedBle} */
  const ble = demo ? new SimulatedBle() : new VbtBle();

  let profileExercise = settings.exercise;
  let tareWaiting = false;
  /** When the most recent set ended (for load correction). */
  let lastSetEndedAt = 0;

  // ---------------------------------------------------------------- helpers

  /** @param {unknown} e */
  function errText(e) {
    return /** @type {any} */ (e)?.message ?? String(e);
  }

  /** @param {unknown} e */
  function reportError(e) {
    const err = /** @type {any} */ (e);
    if (err?.name === "NotFoundError") { ui.log("No device selected."); return; }
    let msg = errText(e);
    if (err?.name === "NetworkError") msg = "Connection failed: the sensor is off, out of range or connected to another phone.";
    else if (err?.name === "SecurityError") msg = "Bluetooth not allowed from this page.";
    ui.log(msg, "error");
  }

  /** @param {VbtSet} set */
  function setNumber(set) {
    return Math.max(1, tracker.session.sets.indexOf(set) + 1);
  }

  /** @returns {VbtSet|null} Most recent set of the current session. */
  function lastSet() {
    const sets = tracker.session.sets;
    return tracker.currentSet ?? sets[sets.length - 1] ?? null;
  }

  function renderLastSet() {
    const set = lastSet();
    ui.showSet(set, set ? setNumber(set) : undefined);
  }

  // GitHub sync: never in demo mode, never awaited by the workout code.
  const github = demo || !store ? null : createUploader({
    fetch: (...args) => fetch(...args),
    getConfig: () => settings,
    getSession: (id) => /** @type {import("./storage.js").Store} */ (store).getSession(id),
    onStatus: ui.showGithubStatus,
    log: ui.log,
  });
  /** @param {string} id */
  function uploadSession(id) {
    github?.notifySession(id).catch((e) => ui.log(`GitHub: ${errText(e)}`, "warn"));
  }

  // Saving: coalesced so a burst of notifications never queues up writes (WA-25, WA-51).
  let saving = false;
  let dirty = false;
  let uploadWanted = false;
  /** @param {boolean} [upload] also send the session to GitHub once saved (a set has ended) */
  function scheduleSave(upload = false) {
    if (!store) return;
    dirty = true;
    if (upload) uploadWanted = true;
    if (saving) return;
    saving = true;
    (async () => {
      while (dirty) {
        dirty = false;
        const s = tracker.session;
        if (!s.sets.length) continue;
        const upload = uploadWanted;
        uploadWanted = false;
        try {
          await store.putSession(s);
          if (upload) uploadSession(s.id);
        } catch (e) { ui.log(`Save failed: ${errText(e)}`, "error"); }
      }
      saving = false;
    })();
  }

  /** @returns {Promise<Session[]>} */
  async function allSessions() {
    if (store) return store.listSessions();
    const s = tracker.session;
    return s.sets.length ? [s] : [];
  }

  /** @param {string} exercise @returns {Promise<VbtSet[]>} */
  async function setsFor(exercise) {
    if (store) return store.setsByExercise(exercise);
    return tracker.session.sets.filter((s) => s.exercise === exercise);
  }

  async function refreshHistory() {
    try { ui.showHistory(await allSessions()); } catch (e) { ui.log(`History: ${errText(e)}`, "error"); }
  }

  async function refreshProfile() {
    const ex = profileExercise;
    const mvt = mvtForExercise(ex, settings.minVelocityThreshold);
    ui.setProfileControls(ex, mvt);
    try {
      const sets = await setsFor(ex);
      const points = pointsFromSets(sets);
      const excluded = sets.filter((s) => s.reps.length > 0 && !(s.loadKg && s.loadKg > 0)).length;
      const distinct = points.length;
      if (distinct < 3) {
        ui.showProfile(points, null, distinct === 0 ? ui.STRINGS.profile.noData : ui.STRINGS.profile.needMore(distinct), { excluded });
        return;
      }
      try {
        ui.showProfile(points, estimateOneRm(points, mvt), undefined, { excluded });
      } catch (e) {
        ui.showProfile(points, null, ui.STRINGS.profile.badSlope, { excluded });
        ui.log(errText(e));
      }
    } catch (e) {
      ui.log(`Profile: ${errText(e)}`, "error");
    }
  }

  /**
   * After a gap or a summary: if reps are still missing a few seconds later, flag the
   * set as incomplete (WA-14).
   * @param {VbtSet} set
   * @param {number} [expected] rep count announced by the device
   */
  function verifyLater(set, expected) {
    setTimeout(() => {
      const top = Math.max(0, ...set.reps.map((r) => r.repIndex), expected ?? 0);
      if (set.reps.length < top && !set.lostReps) {
        tracker.markLost(set);
        ui.log(`Set with missing reps (${set.reps.length}/${top}).`, "warn");
        scheduleSave(set.endedAt !== null);
        if (set === lastSet()) renderLastSet();
      }
    }, 5000);
  }

  /** @param {VbtSet} set */
  function isLatest(set) {
    return set === lastSet();
  }

  // ---------------------------------------------------------------- BLE events

  ble.on("connection", (state, detail) => {
    /** @type {{ message?: string, canReconnect?: boolean }} */
    const info = {};
    if (state === "reconnecting" && detail && detail !== "0") info.message = `attempt ${detail}/${MAX_RECONNECT_ATTEMPTS}`;
    if (state === "disconnected" && detail === "can-reconnect") info.canReconnect = true;
    if (demo && state === "connected") info.message = "demo";
    ui.showConnection(state, info);
    if (state === "connected") {
      ui.setWakeLock(true);
      ble.setThreshold(settings.thresholdPct).catch((e) => ui.log(`Threshold not sent: ${errText(e)}`, "warn"));
    } else if (state === "disconnected") {
      ui.setWakeLock(false);
      if (info.canReconnect && !demo) ui.log("Connection lost. Tap Reconnect.", "warn");
    }
  });

  ble.on("status", (st) => {
    ui.showStatus(st);
    if (st.setId > 0) {
      const reboot = tracker.noteDeviceSetId(st.setId);
      if (reboot) { ui.log("Sensor restarted: new set sequence."); renderLastSet(); }
    }
    const open = tracker.currentSet;
    if (st.state === State.SET_ACTIVE) {
      if (!open || open.deviceSetId !== st.setId) {
        const set = tracker.startSet(st.setId);
        if (set.loadKg == null && settings.loadKg > 0) tracker.setLoad(settings.loadKg);
        ui.showSet(set, setNumber(set));
        scheduleSave();
      }
    } else if (open) {
      const ended = tracker.endSet(null);
      lastSetEndedAt = Date.now();
      if (ended) { renderLastSet(); scheduleSave(true); }
    }
    if (tareWaiting && (st.state === State.READY || st.state === State.ERROR)) {
      tareWaiting = false;
      ui.toast(st.state === State.READY ? "Tare complete" : "Tare failed: hold the sensor still and try again");
    }
  });

  ble.on("setSummary", (sum) => {
    const sets = tracker.session.sets;
    /** @type {VbtSet|null} */
    let set = null;
    for (let i = sets.length - 1; i >= 0; i--) {
      if (sets[i].deviceSetId === sum.setId && sets[i].epoch === tracker.epoch) { set = sets[i]; break; }
    }
    if (!set) return;
    if (tracker.currentSet === set) { tracker.endSet(sum.stopReason); lastSetEndedAt = Date.now(); }
    else set.stopReason = sum.stopReason;
    if (set.reps.length < sum.repCount) {
      const top = Math.max(0, ...set.reps.map((r) => r.repIndex));
      const missing = set.reps.length === top ? top + 1 : 1;
      ble.requestReps(sum.setId, missing).catch((e) => ui.log(`Rep request: ${errText(e)}`, "warn"));
      verifyLater(set, sum.repCount);
    }
    scheduleSave(set.endedAt !== null);
    if (isLatest(set)) renderLastSet();
  });

  ble.on("rep", (rep) => {
    const res = tracker.addRep(rep);
    if (res.reboot) ui.log("Sensor restarted: new set sequence.");
    if (res.gapFrom != null) {
      ui.log(`Missing rep (from #${res.gapFrom}): requested from the sensor.`, "warn");
      ble.requestReps(rep.setId, res.gapFrom).catch((e) => ui.log(`Rep request: ${errText(e)}`, "warn"));
      verifyLater(res.set);
    }
    if (!res.added) return;
    if (isLatest(res.set)) ui.showSet(res.set, setNumber(res.set));
    const newest = res.rep.repIndex === Math.max(...res.set.reps.map((r) => r.repIndex));
    if (res.alarm || (settings.repeatAlarm && res.exceeded && newest && res.set.endedAt === null)) ui.triggerAlarm();
    scheduleSave();
  });

  // ---------------------------------------------------------------- UI handlers

  ui.initUi({
    onConnect: async () => { try { await ble.connect(); } catch (e) { reportError(e); } },
    onReconnect: async () => { try { await ble.reconnect(); } catch (e) { reportError(e); } },
    onDisconnect: () => { ble.disconnect().catch(reportError); },
    onStartSet: () => {
      tracker.setLoad(settings.loadKg > 0 ? settings.loadKg : null);
      ble.startSet().catch(reportError);
    },
    onStopSet: () => { ble.stopSet().catch(reportError); },
    onTare: () => {
      tareWaiting = true;
      ble.tare().then(() => ui.toast("Taring: hold the sensor still")).catch((e) => {
        tareWaiting = false;
        reportError(e);
      });
    },
    onLoadChange: (kg) => {
      settings = { ...settings, loadKg: kg };
      saveSettings({ loadKg: kg });
      const value = kg > 0 ? kg : null;
      if (tracker.currentSet) tracker.setLoad(value);
      else if (lastSetEndedAt && Date.now() - lastSetEndedAt < LOAD_CORRECTION_MS) {
        tracker.setLastSetLoad(value);
        scheduleSave(true);
        renderLastSet();
      } else tracker.setLoad(value);
    },
    onLoadStepChange: (kg) => { settings = { ...settings, loadStepKg: kg }; saveSettings({ loadStepKg: kg }); },
    onExerciseChange: (exercise) => {
      settings = { ...settings, exercise };
      saveSettings({ exercise });
      tracker.setExercise(exercise);
      profileExercise = exercise;
    },
    onThresholdChange: (pct) => {
      settings = { ...settings, thresholdPct: pct };
      saveSettings({ thresholdPct: pct });
      tracker.setThreshold(pct);
      if (ble.state === "connected") ble.setThreshold(pct).catch((e) => ui.log(`Threshold not sent: ${errText(e)}`, "warn"));
      renderLastSet();
    },
    onSoundChange: (on) => { settings = { ...settings, soundOn: on }; saveSettings({ soundOn: on }); },
    onRepeatAlarmChange: (on) => { settings = { ...settings, repeatAlarm: on }; saveSettings({ repeatAlarm: on }); },
    onEndWorkout: async () => {
      const ended = tracker.endSession();
      lastSetEndedAt = 0;
      if (store && ended.sets.length) {
        const saved = await store.putSession(ended).then(() => true, (e) => { ui.log(errText(e), "error"); return false; });
        if (saved) uploadSession(ended.id);
      }
      ui.showSet(null);
      ui.toast("Workout finished");
      refreshHistory();
    },
    onExport: async (format) => {
      try {
        const sessions = store ? (await store.exportBackup()).sessions : await allSessions();
        const day = new Date().toISOString().slice(0, 10);
        if (format === "csv") {
          await downloadTextFile(`vbt-${day}.csv`, "text/csv", sessionsToCsv(sessions));
        } else {
          const backup = store ? await store.exportBackup() : { schemaVersion: 1, exportedAt: Date.now(), sessions };
          await downloadTextFile(`vbt-backup-${day}.json`, "application/json", JSON.stringify(backup));
          settings = { ...settings, lastBackupAt: Date.now() };
          saveSettings({ lastBackupAt: settings.lastBackupAt });
          ui.hideBanner("backup");
        }
      } catch (e) { ui.log(`Export failed: ${errText(e)}`, "error"); }
    },
    onImport: async (file) => {
      if (!store) { ui.toast("Import not available in demo mode"); return; }
      try {
        const res = await store.importBackup(JSON.parse(await file.text()));
        ui.toast(`Imported ${res.sessionsAdded} sessions (${res.sessionsSkipped} already present)`);
        refreshHistory();
      } catch (e) { ui.log(`Import failed: ${errText(e)}`, "error"); }
    },
    onDeleteSession: async (id) => {
      try {
        if (tracker.session.id === id) tracker.endSession();
        await store?.deleteSession(id);
        await refreshHistory();
      } catch (e) { ui.log(`Delete failed: ${errText(e)}`, "error"); }
    },
    onViewChange: (viewId) => {
      if (viewId === "view-history") refreshHistory();
      else if (viewId === "view-profile") refreshProfile();
    },
    onProfileExercise: (exercise) => { profileExercise = exercise; refreshProfile(); },
    onMvtChange: (exercise, mvt) => {
      settings = { ...settings, minVelocityThreshold: { ...settings.minVelocityThreshold, [exercise]: mvt } };
      saveSettings({ minVelocityThreshold: settings.minVelocityThreshold });
      refreshProfile();
    },
    onGithubChange: ({ enabled, repo, token }) => {
      settings = { ...settings, githubEnabled: enabled, githubRepo: repo, githubToken: token };
      saveSettings({ githubEnabled: enabled, githubRepo: repo, githubToken: token });
      if (github) { ui.showGithubStatus(github.status()); github.flush(); }
    },
    onGithubTest: async () => {
      if (demo) return { ok: false, message: "Not available in demo mode" };
      return testConnection({ fetch: (...args) => fetch(...args), repo: settings.githubRepo, token: settings.githubToken });
    },
    onResume: () => {
      if (ble.state === "connected") /** @type {any} */ (ble).resync?.().catch((e) => ui.log(`Resync: ${errText(e)}`, "warn"));
    },
  });

  // ---------------------------------------------------------------- startup

  ui.applySettings(settings);
  ui.setBluetoothSupported(demo || VbtBle.isSupported());
  ui.showConnection("disconnected");
  if (demo) ui.showBanner("demo", ui.STRINGS.banner.demo, { level: "info" });

  if (store) {
    ui.showStorageMode(store.persistent);
    requestPersistence().catch(() => {});
    try {
      const sessions = await store.listSessions();
      const draft = sessions[0];
      if (draft && !draft.endedAt) {
        const last = Math.max(draft.startedAt, ...draft.sets.map((s) => s.endedAt ?? s.reps.at(-1)?.receivedAt ?? 0));
        if (Date.now() - last < DRAFT_MAX_AGE_MS) { tracker.restore(draft); renderLastSet(); }
      }
      if (sessions.length) {
        const days = settings.lastBackupAt ? Math.floor((Date.now() - settings.lastBackupAt) / DAY_MS) : null;
        if (days == null || days >= BACKUP_REMINDER_DAYS) ui.showBackupReminder(days);
      }
    } catch (e) { ui.log(`Draft restore failed: ${errText(e)}`, "warn"); }
  }

  if (github) {
    ui.showGithubStatus(github.status());
    // Retry pending uploads when connectivity or visibility comes back, and now.
    window.addEventListener("online", () => { github.flush(); });
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") github.flush(); });
    github.flush();
  }

  registerServiceWorker();
}

/** Optional: register sw.js; failures must not block the app. */
export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  try {
    const reg = await navigator.serviceWorker.register("sw.js");
    const offer = (/** @type {ServiceWorker} */ worker) => {
      ui.showBanner("update", ui.STRINGS.banner.update, {
        level: "info",
        actions: [{
          label: ui.STRINGS.btn.reload,
          onClick: () => {
            navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        }],
      });
    };
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const w = reg.installing;
      w?.addEventListener("statechange", () => {
        if (w.state === "installed" && navigator.serviceWorker.controller) offer(w);
      });
    });
  } catch (e) {
    ui.log(`Service worker not registered: ${/** @type {any} */ (e)?.message ?? e}`, "warn");
  }
}
