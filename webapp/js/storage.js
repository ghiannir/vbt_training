// @ts-check
// Persistence: IndexedDB for sessions/sets (WA-50), localStorage for small settings.
// Every localStorage/IndexedDB access must tolerate failure (private mode, eviction).

/** @typedef {import("./session.js").Session} Session */
/** @typedef {import("./session.js").VbtSet} VbtSet */

export const DB_NAME = "vbt";
export const SCHEMA_VERSION = 1;

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
 */

/**
 * @typedef {Object} BackupFile
 * @property {number} schemaVersion
 * @property {number} exportedAt
 * @property {Session[]} sessions
 * @property {Settings} [settings]
 */

/** @returns {Settings} Defaults merged with whatever is in localStorage. */
export function loadSettings() {
  throw new Error("not implemented");
}

/** @param {Partial<Settings>} patch */
export function saveSettings(patch) {
  throw new Error("not implemented");
}

/**
 * Open (and migrate) the database. Falls back to an in-memory store if
 * IndexedDB is unavailable (WA-57); `Store.persistent` tells which.
 * @returns {Promise<Store>}
 */
export async function openStore() {
  throw new Error("not implemented");
}

export class Store {
  /** @type {boolean} false when running in-memory. */
  persistent = false;

  /**
   * Insert or replace a session with all its sets (also used for drafts, WA-51).
   * @param {Session} session
   * @returns {Promise<void>}
   */
  async putSession(session) {
    throw new Error("not implemented");
  }

  /** @param {string} id @returns {Promise<Session|null>} */
  async getSession(id) {
    throw new Error("not implemented");
  }

  /** @returns {Promise<Session[]>} Newest first. */
  async listSessions() {
    throw new Error("not implemented");
  }

  /** @param {string} id @returns {Promise<void>} */
  async deleteSession(id) {
    throw new Error("not implemented");
  }

  /**
   * All sets of an exercise, for the load-velocity profile.
   * @param {string} exercise
   * @returns {Promise<VbtSet[]>}
   */
  async setsByExercise(exercise) {
    throw new Error("not implemented");
  }

  /** @returns {Promise<string[]>} Distinct exercise names. */
  async listExercises() {
    throw new Error("not implemented");
  }

  /** @returns {Promise<BackupFile>} */
  async exportBackup() {
    throw new Error("not implemented");
  }

  /**
   * Merge a backup without creating duplicates (WA-54).
   * @param {BackupFile} backup
   * @returns {Promise<{ sessionsAdded: number, sessionsSkipped: number }>}
   */
  async importBackup(backup) {
    throw new Error("not implemented");
  }
}

/**
 * Flatten sessions to CSV, one row per rep (WA-53). Columns:
 * date,session,exercise,load_kg,set,rep,mcv_mps,peak_mps,rom_m,conc_s,vloss_pct.
 * @param {Session[]} sessions
 * @returns {string}
 */
export function sessionsToCsv(sessions) {
  throw new Error("not implemented");
}

/**
 * Ask the browser not to evict our data, if supported (WA-52).
 * @returns {Promise<boolean>}
 */
export async function requestPersistence() {
  throw new Error("not implemented");
}

/**
 * Hand a text file to the user: Blob + download link, or Web Share API fallback.
 * Must be called from a tap handler.
 * @param {string} filename
 * @param {string} mimeType
 * @param {string} content
 * @returns {Promise<void>}
 */
export async function downloadTextFile(filename, mimeType, content) {
  throw new Error("not implemented");
}
