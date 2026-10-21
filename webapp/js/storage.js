// @ts-check
// Persistence: IndexedDB for sessions/sets (WA-50), localStorage for small settings.
// Every localStorage/IndexedDB access must tolerate failure (private mode, eviction).
// The serialization parts (CSV, backup parsing/merging) and the in-memory store are
// pure and tested in Node; the IndexedDB backend is deliberately thin.

import { DEFAULT_MVT } from "./lvprofile.js";

/** @typedef {import("./session.js").Session} Session */
/** @typedef {import("./session.js").VbtSet} VbtSet */

export const DB_NAME = "vbt";
export const SCHEMA_VERSION = 1;
export const SETTINGS_KEY = "vbt.settings";

/**
 * @typedef {Object} Settings
 * @property {number} thresholdPct       default 20
 * @property {boolean} soundOn
 * @property {boolean} repeatAlarm
 * @property {string} exercise
 * @property {number} loadKg
 * @property {number} loadStepKg         default 2.5
 * @property {Record<string, number>} minVelocityThreshold  per exercise, m/s (WA-62)
 * @property {number|null} lastBackupAt  epoch ms (WA-52)
 * @property {boolean} githubEnabled     upload sessions to GitHub after each set
 * @property {string} githubRepo         "owner/name"
 * @property {string} githubToken        secret: never exported in backups
 */

/**
 * @typedef {Object} BackupFile
 * @property {number} schemaVersion
 * @property {number} exportedAt
 * @property {Session[]} sessions
 * @property {Settings} [settings]
 */

/** @returns {Settings} */
export function defaultSettings() {
  return {
    thresholdPct: 20,
    soundOn: true,
    repeatAlarm: false,
    exercise: "squat",
    loadKg: 60,
    loadStepKg: 2.5,
    minVelocityThreshold: { ...DEFAULT_MVT },
    lastBackupAt: null,
    githubEnabled: false,
    githubRepo: "ghiannir/vbt-data",
    githubToken: "",
  };
}

/**
 * Defaults overlaid with a stored (possibly partial or corrupt) object.
 * @param {unknown} stored
 * @returns {Settings}
 */
export function mergeSettings(stored) {
  const base = defaultSettings();
  if (!stored || typeof stored !== "object") return base;
  const s = /** @type {Record<string, any>} */ (stored);
  const out = /** @type {Record<string, any>} */ (base);
  for (const key of Object.keys(base)) {
    if (key === "minVelocityThreshold") {
      if (s[key] && typeof s[key] === "object") {
        for (const [ex, v] of Object.entries(s[key])) {
          if (typeof v === "number" && Number.isFinite(v) && v > 0) base.minVelocityThreshold[ex] = v;
        }
      }
    } else if (key in s && typeof s[key] === typeof out[key] && !(typeof s[key] === "number" && !Number.isFinite(s[key]))) {
      out[key] = s[key];
    } else if (key === "lastBackupAt" && typeof s[key] === "number") {
      out[key] = s[key];
    }
  }
  return base;
}

/** @returns {Storage|null} */
function localStore() {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** @returns {Settings} Defaults merged with whatever is in localStorage. */
export function loadSettings() {
  try {
    const raw = localStore()?.getItem(SETTINGS_KEY);
    return mergeSettings(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultSettings();
  }
}

/** @param {Partial<Settings>} patch */
export function saveSettings(patch) {
  const next = mergeSettings({ ...loadSettings(), ...patch });
  try {
    localStore()?.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // private mode / quota: settings just won't persist
  }
}

// ---------------------------------------------------------------------------
// Backup (JSON) and CSV: pure functions
// ---------------------------------------------------------------------------

/**
 * @param {Session[]} sessions
 * @param {Settings} [settings]
 * @param {number} [now]
 * @returns {BackupFile}
 */
export function buildBackup(sessions, settings, now = Date.now()) {
  /** @type {BackupFile} */
  const b = { schemaVersion: SCHEMA_VERSION, exportedAt: now, sessions };
  if (settings) b.settings = { ...settings, githubToken: "" }; // the token never leaves the device
  return b;
}

/**
 * Parse and validate a backup. Accepts the JSON text or an already parsed object.
 * Older schema versions are migrated; newer ones are refused (data loss risk).
 * @param {string|object} input
 * @returns {BackupFile}
 */
export function parseBackup(input) {
  let obj;
  try {
    obj = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw new Error("File di backup non valido (JSON illeggibile)");
  }
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.sessions)) {
    throw new Error("File di backup non valido (mancano le sessioni)");
  }
  const version = obj.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new Error("File di backup non valido (schemaVersion mancante)");
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`Backup creato da una versione piu' recente (schema ${version}): aggiorna l'app`);
  }
  const sessions = obj.sessions.map(migrateSession);
  /** @type {BackupFile} */
  const out = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: typeof obj.exportedAt === "number" ? obj.exportedAt : Date.now(),
    sessions,
  };
  if (obj.settings && typeof obj.settings === "object") out.settings = { ...mergeSettings(obj.settings), githubToken: "" };
  return out;
}

/**
 * Bring a stored session to the current shape (fills missing fields, never drops data).
 * @param {any} s
 * @returns {Session}
 */
export function migrateSession(s) {
  if (!s || typeof s !== "object" || typeof s.id !== "string" || !Array.isArray(s.sets)) {
    throw new Error("File di backup non valido (sessione malformata)");
  }
  return {
    ...s,
    startedAt: typeof s.startedAt === "number" ? s.startedAt : 0,
    endedAt: typeof s.endedAt === "number" ? s.endedAt : null,
    sets: s.sets.map((/** @type {any} */ set) => {
      if (!set || typeof set !== "object" || typeof set.id !== "string") {
        throw new Error("File di backup non valido (serie malformata)");
      }
      return {
        ...set,
        sessionId: set.sessionId ?? s.id,
        loadKg: typeof set.loadKg === "number" ? set.loadKg : null,
        stopReason: typeof set.stopReason === "number" ? set.stopReason : null,
        lostReps: Boolean(set.lostReps),
        epoch: typeof set.epoch === "number" ? set.epoch : 0,
        reps: Array.isArray(set.reps) ? set.reps : [],
      };
    }),
  };
}

/**
 * @param {unknown} v
 * @returns {string}
 */
function csvField(v) {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * @param {number} n
 * @param {number} digits
 */
function fixed(n, digits) {
  return Number.isFinite(n) ? n.toFixed(digits) : "";
}

export const CSV_HEADER = "date,session,exercise,load_kg,set,rep,mcv_mps,peak_mps,rom_m,conc_s,vloss_pct";

/**
 * Flatten sessions to CSV, one row per rep (WA-53). Columns:
 * date,session,exercise,load_kg,set,rep,mcv_mps,peak_mps,rom_m,conc_s,vloss_pct.
 * date = set start (ISO 8601 UTC), session = session id, set = 1-based position in the
 * session, vloss_pct = the device value (source of truth, WA-42).
 * @param {Session[]} sessions
 * @returns {string}
 */
export function sessionsToCsv(sessions) {
  const lines = [CSV_HEADER];
  for (const session of sessions) {
    session.sets.forEach((set, i) => {
      for (const r of set.reps) {
        lines.push(
          [
            new Date(set.startedAt).toISOString(),
            session.id,
            set.exercise,
            set.loadKg === null || set.loadKg === undefined ? "" : set.loadKg,
            i + 1,
            r.repIndex,
            fixed(r.mcv, 3),
            fixed(r.peak, 3),
            fixed(r.rom, 3),
            fixed(r.concDuration, 3),
            r.velocityLossPct,
          ].map(csvField).join(",")
        );
      }
    });
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Store: backend-agnostic logic on top of a tiny backend interface
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Backend
 * @property {(s: Session) => Promise<void>} put
 * @property {(id: string) => Promise<Session|null>} get
 * @property {() => Promise<Session[]>} all
 * @property {(id: string) => Promise<void>} remove
 * @property {(exercise: string) => Promise<VbtSet[]>} setsByExercise
 */

/** @template T @param {T} v @returns {T} */
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

/** @returns {Backend} Volatile backend (used when IndexedDB is unavailable, and in tests). */
function memoryBackend() {
  /** @type {Map<string, Session>} */
  const m = new Map();
  return {
    async put(s) { m.set(s.id, clone(s)); },
    async get(id) { const s = m.get(id); return s ? clone(s) : null; },
    async all() { return [...m.values()].map(clone); },
    async remove(id) { m.delete(id); },
    async setsByExercise(exercise) {
      return [...m.values()].flatMap((s) => s.sets.filter((x) => x.exercise === exercise)).map(clone);
    },
  };
}

export class Store {
  /** @type {boolean} false when running in-memory. */
  persistent = false;

  /**
   * @param {Backend} [backend] defaults to a volatile in-memory backend
   * @param {boolean} [persistent]
   */
  constructor(backend, persistent = false) {
    this._b = backend ?? memoryBackend();
    this.persistent = persistent;
  }

  /**
   * Insert or replace a session with all its sets (also used for drafts, WA-51).
   * @param {Session} session
   * @returns {Promise<void>}
   */
  async putSession(session) {
    await this._b.put(session);
  }

  /** @param {string} id @returns {Promise<Session|null>} */
  async getSession(id) {
    return this._b.get(id);
  }

  /** @returns {Promise<Session[]>} Newest first. */
  async listSessions() {
    const all = await this._b.all();
    return all.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** @param {string} id @returns {Promise<void>} */
  async deleteSession(id) {
    await this._b.remove(id);
  }

  /**
   * All sets of an exercise, for the load-velocity profile.
   * @param {string} exercise
   * @returns {Promise<VbtSet[]>}
   */
  async setsByExercise(exercise) {
    const sets = await this._b.setsByExercise(exercise);
    return sets.sort((a, b) => a.startedAt - b.startedAt);
  }

  /** @returns {Promise<string[]>} Distinct exercise names. */
  async listExercises() {
    const all = await this._b.all();
    return [...new Set(all.flatMap((s) => s.sets.map((x) => x.exercise)))].sort();
  }

  /** @returns {Promise<BackupFile>} */
  async exportBackup() {
    return buildBackup(await this.listSessions(), loadSettings());
  }

  /**
   * Merge a backup without creating duplicates (WA-54): sessions whose id already
   * exists are kept as they are.
   * @param {BackupFile} backup
   * @returns {Promise<{ sessionsAdded: number, sessionsSkipped: number }>}
   */
  async importBackup(backup) {
    const parsed = parseBackup(/** @type {object} */ (backup));
    const known = new Set((await this._b.all()).map((s) => s.id));
    let sessionsAdded = 0;
    let sessionsSkipped = 0;
    for (const s of parsed.sessions) {
      if (known.has(s.id)) {
        sessionsSkipped++;
        continue;
      }
      await this._b.put(s);
      known.add(s.id);
      sessionsAdded++;
    }
    return { sessionsAdded, sessionsSkipped };
  }
}

/** @returns {Store} A volatile store (WA-57 fallback, tests). */
export function createMemoryStore() {
  return new Store(memoryBackend(), false);
}

// ---------------------------------------------------------------------------
// IndexedDB backend (browser only; thin on purpose)
// ---------------------------------------------------------------------------

/** @template T @param {IDBRequest<T>} req @returns {Promise<T>} */
function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** @param {IDBTransaction} tx @returns {Promise<void>} */
function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("transazione annullata"));
  });
}

/**
 * Schema migrations; each step upgrades from version (n-1) to n and must keep data.
 * @param {IDBDatabase} db
 * @param {IDBTransaction} tx
 * @param {number} oldVersion
 */
function migrate(db, tx, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore("sessions", { keyPath: "id" }).createIndex("startedAt", "startedAt");
    const sets = db.createObjectStore("sets", { keyPath: "id" });
    sets.createIndex("exercise", "exercise");
    sets.createIndex("startedAt", "startedAt");
    sets.createIndex("sessionId", "sessionId");
  }
  // future: if (oldVersion < 2) { ... }
}

/**
 * @param {IDBDatabase} db
 * @returns {Backend}
 */
function idbBackend(db) {
  /** @param {IDBTransaction} tx @param {string} id @returns {Promise<VbtSet[]>} */
  const setsOf = (tx, id) => wrap(tx.objectStore("sets").index("sessionId").getAll(id));
  return {
    async put(session) {
      const tx = db.transaction(["sessions", "sets"], "readwrite");
      const finished = done(tx);
      const { sets, ...head } = session;
      tx.objectStore("sessions").put(head);
      const setStore = tx.objectStore("sets");
      const old = await wrap(setStore.index("sessionId").getAllKeys(session.id));
      for (const k of old) setStore.delete(k);
      for (const s of sets) setStore.put({ ...s, sessionId: session.id });
      await finished;
    },
    async get(id) {
      const tx = db.transaction(["sessions", "sets"], "readonly");
      const head = await wrap(tx.objectStore("sessions").get(id));
      if (!head) return null;
      const sets = (await setsOf(tx, id)).sort((a, b) => a.startedAt - b.startedAt);
      return { ...head, sets };
    },
    async all() {
      const tx = db.transaction(["sessions", "sets"], "readonly");
      const heads = await wrap(tx.objectStore("sessions").getAll());
      const sets = await wrap(tx.objectStore("sets").getAll());
      /** @type {Map<string, VbtSet[]>} */
      const by = new Map();
      for (const s of sets) {
        if (!by.has(s.sessionId)) by.set(s.sessionId, []);
        /** @type {VbtSet[]} */ (by.get(s.sessionId)).push(s);
      }
      return heads.map((h) => ({
        ...h,
        sets: (by.get(h.id) ?? []).sort((/** @type {VbtSet} */ a, /** @type {VbtSet} */ b) => a.startedAt - b.startedAt),
      }));
    },
    async remove(id) {
      const tx = db.transaction(["sessions", "sets"], "readwrite");
      const finished = done(tx);
      const keys = await wrap(tx.objectStore("sets").index("sessionId").getAllKeys(id));
      for (const k of keys) tx.objectStore("sets").delete(k);
      tx.objectStore("sessions").delete(id);
      await finished;
    },
    async setsByExercise(exercise) {
      const tx = db.transaction("sets", "readonly");
      return wrap(tx.objectStore("sets").index("exercise").getAll(exercise));
    },
  };
}

/**
 * Open (and migrate) the database. Falls back to an in-memory store if
 * IndexedDB is unavailable (WA-57); `Store.persistent` tells which.
 * @returns {Promise<Store>}
 */
export async function openStore() {
  try {
    if (typeof indexedDB === "undefined" || !indexedDB) throw new Error("no indexedDB");
    const req = indexedDB.open(DB_NAME, SCHEMA_VERSION);
    req.onupgradeneeded = (ev) => {
      migrate(req.result, /** @type {IDBTransaction} */ (req.transaction), ev.oldVersion);
    };
    const db = await wrap(req);
    db.onversionchange = () => db.close();
    return new Store(idbBackend(db), true);
  } catch {
    return createMemoryStore();
  }
}

/**
 * Ask the browser not to evict our data, if supported (WA-52).
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
  try {
    const sm = typeof navigator !== "undefined" ? navigator.storage : undefined;
    if (!sm || typeof sm.persist !== "function") return false;
    if (typeof sm.persisted === "function" && (await sm.persisted())) return true;
    return await sm.persist();
  } catch {
    return false;
  }
}

/**
 * Whole days since the last backup, or null if never (for the WA-52 reminder).
 * @param {number|null} lastBackupAt
 * @param {number} [now]
 * @returns {number|null}
 */
export function daysSinceBackup(lastBackupAt, now = Date.now()) {
  if (lastBackupAt === null || lastBackupAt === undefined) return null;
  return Math.max(0, Math.floor((now - lastBackupAt) / 86400000));
}

/**
 * Hand a text file to the user: Blob + download link, or Web Share API fallback.
 * Must be called from a tap handler. On touch devices the share sheet (which offers
 * "Save to Files") is tried first when it can take files; if it fails other than by
 * user cancel, falls back to the download link.
 * @param {string} filename
 * @param {string} mimeType
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function downloadTextFile(filename, mimeType, content) {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const touch = !!nav && (/iPhone|iPad|iPod|Android/i.test(nav.userAgent) || nav.maxTouchPoints > 1);

  if (touch && nav && typeof nav.share === "function" && typeof File !== "undefined") {
    try {
      const file = new File([content], filename, { type: mimeType });
      if (typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
        await nav.share({ files: [file], title: filename });
        return;
      }
    } catch (e) {
      if (e && /** @type {any} */ (e).name === "AbortError") return; // user cancelled
      // otherwise fall through to download
    }
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}
