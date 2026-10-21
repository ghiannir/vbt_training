// @ts-check
// DOM layer. The only module (with main.js) that touches document/window.
// All visible strings come from STRINGS (WA-83).

/** @typedef {import("./protocol.js").DeviceStatus} DeviceStatus */
/** @typedef {import("./session.js").StoredRep} StoredRep */
/** @typedef {import("./session.js").VbtSet} VbtSet */
/** @typedef {import("./session.js").Session} Session */
/** @typedef {import("./ble.js").ConnectionState} ConnectionState */
/** @typedef {import("./lvprofile.js").OneRmEstimate} OneRmEstimate */
/** @typedef {import("./lvprofile.js").LvPoint} LvPoint */

/** Italian UI strings. */
export const STRINGS = Object.freeze({});

/**
 * @typedef {Object} UiHandlers
 * @property {() => void} onConnect          tap: connect (user gesture)
 * @property {() => void} onDisconnect
 * @property {() => void} onStartSet
 * @property {() => void} onStopSet
 * @property {() => void} onTare
 * @property {(kg: number) => void} onLoadChange
 * @property {(exercise: string) => void} onExerciseChange
 * @property {(pct: number) => void} onThresholdChange
 * @property {(on: boolean) => void} onSoundChange
 * @property {() => void} onEndWorkout
 * @property {(format: "json"|"csv") => void} onExport
 * @property {(file: File) => void} onImport
 * @property {(sessionId: string) => void} onDeleteSession
 */

/**
 * Build the UI and bind handlers. Call once after DOMContentLoaded.
 * @param {UiHandlers} handlers
 * @returns {void}
 */
export function initUi(handlers) {
  throw new Error("not implemented");
}

/**
 * @param {ConnectionState} state
 * @param {{ batteryPct?: number, message?: string }} [info]
 */
export function showConnection(state, info) {
  throw new Error("not implemented");
}

/** @param {DeviceStatus} status */
export function showStatus(status) {
  throw new Error("not implemented");
}

/**
 * Big live display of the latest rep (WA-20, WA-21).
 * @param {StoredRep} rep
 * @param {number} thresholdPct
 */
export function showRep(rep, thresholdPct) {
  throw new Error("not implemented");
}

/**
 * Re-render the rep list and set header.
 * @param {VbtSet|null} set
 */
export function showSet(set) {
  throw new Error("not implemented");
}

/** Visual (and sound/vibration) velocity-loss alarm (WA-40). */
export function triggerAlarm() {
  throw new Error("not implemented");
}

/** Unlock WebAudio on the first user gesture (WA-40). */
export function unlockAudio() {
  throw new Error("not implemented");
}

/** @param {boolean} on */
export function setWakeLock(on) {
  throw new Error("not implemented");
}

/** @param {Session[]} sessions */
export function showHistory(sessions) {
  throw new Error("not implemented");
}

/**
 * @param {LvPoint[]} points
 * @param {OneRmEstimate|null} estimate  null => "dati insufficienti"
 * @param {string} [reason]
 */
export function showProfile(points, estimate, reason) {
  throw new Error("not implemented");
}

/** @param {string} message @param {"info"|"warn"|"error"} [level] */
export function log(message, level) {
  throw new Error("not implemented");
}

/** Show the "backup reminder" banner (WA-52). @param {number|null} daysSince */
export function showBackupReminder(daysSince) {
  throw new Error("not implemented");
}
