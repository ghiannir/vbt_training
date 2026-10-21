// @ts-check
// Data model and pure set/rep logic. No DOM, no BLE, no storage.

/** @typedef {import("./protocol.js").Rep} Rep */

/**
 * A repetition as stored (same fields as the protocol Rep, SI units).
 * @typedef {Rep & { receivedAt: number, velocityLossPctLocal: number }} StoredRep
 *   receivedAt: Date.now() at arrival; velocityLossPctLocal: client-side recompute (WA-42).
 */

/**
 * @typedef {Object} VbtSet
 * @property {string} id            Client-generated unique id.
 * @property {string} sessionId
 * @property {number} deviceSetId   Device counter at the time (wraps; not unique).
 * @property {number} startedAt     epoch ms
 * @property {number|null} endedAt  null while the set is in progress.
 * @property {string} exercise      e.g. "squat"
 * @property {number|null} loadKg   null until entered (WA-31, WA-64).
 * @property {number} thresholdPct  Velocity-loss threshold used (0 = none).
 * @property {StoredRep[]} reps
 * @property {number|null} stopReason  StopReason or null if unknown.
 * @property {boolean} lostReps     true if reps were missed and not recoverable.
 */

/**
 * @typedef {Object} Session
 * @property {string} id
 * @property {number} startedAt
 * @property {number|null} endedAt
 * @property {string} [notes]
 * @property {VbtSet[]} sets
 */

/**
 * @typedef {Object} SetStats
 * @property {number} repCount
 * @property {number} bestMcv
 * @property {number} meanMcv
 * @property {number} lastVelocityLossPct
 * @property {number} maxVelocityLossPct
 */

/**
 * Velocity loss in percent vs the best MCV: (best - mcv) / best * 100, rounded
 * and clamped to 0..100 exactly as the firmware does (see docs/ble-protocol.md).
 * @param {number} mcv
 * @param {number} bestMcv
 * @returns {number}
 */
export function velocityLossPct(mcv, bestMcv) {
  throw new Error("not implemented");
}

/**
 * @param {StoredRep[]} reps
 * @returns {SetStats}
 */
export function setStats(reps) {
  throw new Error("not implemented");
}

/**
 * Tracks the current session/set and deduplicates reps by (deviceSetId, repIndex).
 */
export class SessionTracker {
  /** @param {{ exercise: string, thresholdPct: number, idleTimeoutMs?: number }} opts */
  constructor(opts) {
    throw new Error("not implemented");
  }

  /** @returns {Session} Current session (created on demand, WA-33). */
  get session() {
    throw new Error("not implemented");
  }

  /** @returns {VbtSet|null} Set in progress, or null. */
  get currentSet() {
    throw new Error("not implemented");
  }

  /**
   * Feed a rep from BLE (live or replay).
   * @param {Rep} rep
   * @returns {{ added: boolean, set: VbtSet, rep: StoredRep, alarm: boolean, gapFrom: number|null }}
   *   added=false for duplicates; alarm=true on first threshold crossing (WA-41);
   *   gapFrom = first missing repIndex if a gap was detected (caller sends requestReps).
   */
  addRep(rep) {
    throw new Error("not implemented");
  }

  /**
   * Begin a new set explicitly (user tap or device SET_ACTIVE transition).
   * @param {number} deviceSetId
   * @returns {VbtSet}
   */
  startSet(deviceSetId) {
    throw new Error("not implemented");
  }

  /**
   * Close the current set.
   * @param {number|null} stopReason
   * @returns {VbtSet|null}
   */
  endSet(stopReason) {
    throw new Error("not implemented");
  }

  /** @param {number|null} kg */
  setLoad(kg) {
    throw new Error("not implemented");
  }

  /** @param {string} exercise */
  setExercise(exercise) {
    throw new Error("not implemented");
  }

  /** @param {number} pct */
  setThreshold(pct) {
    throw new Error("not implemented");
  }

  /** Close the session (WA-33). @returns {Session} */
  endSession() {
    throw new Error("not implemented");
  }

  /**
   * Replace internal state, e.g. restoring a draft from storage (WA-51).
   * @param {Session} session
   */
  restore(session) {
    throw new Error("not implemented");
  }
}
