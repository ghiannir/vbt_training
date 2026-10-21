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
 * @property {number} epoch         Device-boot epoch, bumped when the device counter resets.
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

const DEFAULT_IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000; // WA-33

/**
 * Velocity loss in percent vs the best MCV: (best - mcv) / best * 100, rounded
 * and clamped to 0..100 exactly as the firmware does (see docs/ble-protocol.md).
 * Computed on integer mm/s so rounding matches the firmware bit for bit.
 * @param {number} mcv
 * @param {number} bestMcv
 * @returns {number}
 */
export function velocityLossPct(mcv, bestMcv) {
  const best = Math.round(bestMcv * 1000);
  const cur = Math.round(mcv * 1000);
  if (!(best > 0)) return 0;
  // round-half-up of (best - cur) * 100 / best, in exact integer arithmetic
  const loss = Math.floor(((best - cur) * 200 + best) / (2 * best));
  return Math.min(100, Math.max(0, loss));
}

/**
 * True if the loss reaches the threshold (>=, threshold 0 = disabled).
 * @param {number} lossPct
 * @param {number} thresholdPct
 * @returns {boolean}
 */
export function thresholdReached(lossPct, thresholdPct) {
  return thresholdPct > 0 && lossPct >= thresholdPct;
}

/**
 * @param {StoredRep[]} reps
 * @returns {SetStats}
 */
export function setStats(reps) {
  if (!reps.length) {
    return { repCount: 0, bestMcv: 0, meanMcv: 0, lastVelocityLossPct: 0, maxVelocityLossPct: 0 };
  }
  let best = 0;
  let sum = 0;
  let maxLoss = 0;
  let last = reps[0];
  for (const r of reps) {
    if (r.mcv > best) best = r.mcv;
    sum += r.mcv;
    if (r.velocityLossPctLocal > maxLoss) maxLoss = r.velocityLossPctLocal;
    if (r.repIndex > last.repIndex) last = r;
  }
  return {
    repCount: reps.length,
    bestMcv: best,
    meanMcv: sum / reps.length,
    lastVelocityLossPct: last.velocityLossPctLocal,
    maxVelocityLossPct: maxLoss,
  };
}

/**
 * Recompute velocityLossPctLocal for every rep, in repIndex order, against the
 * running best (so replayed/out-of-order reps get consistent values).
 * @param {StoredRep[]} reps sorted by repIndex
 */
function recomputeLoss(reps) {
  let best = 0;
  for (const r of reps) {
    if (r.mcv > best) best = r.mcv;
    r.velocityLossPctLocal = velocityLossPct(r.mcv, best);
  }
}

/**
 * Tracks the current session/set and deduplicates reps by (deviceSetId, repIndex).
 *
 * Reboot detection: the device counter restarts from 1 after a reboot, so a
 * lower set_id than the last known one (other than the 255 -> 1 wrap) starts a
 * new "epoch"; dedupe only looks at sets of the current epoch. Callers should feed
 * every Status.setId to noteDeviceSetId(); a rep whose set_id matches an existing
 * set of the epoch is treated as a replay, never as a reboot.
 */
export class SessionTracker {
  /**
   * @param {{ exercise: string, thresholdPct: number, idleTimeoutMs?: number,
   *           loadKg?: number|null, now?: () => number }} opts
   */
  constructor(opts) {
    this._exercise = opts.exercise;
    this._thresholdPct = opts.thresholdPct;
    this._loadKg = opts.loadKg ?? null;
    this._idleTimeoutMs = opts.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;
    this._now = opts.now ?? Date.now;
    /** @type {Session|null} */
    this._session = null;
    /** @type {VbtSet|null} */
    this._set = null;
    this._epoch = 0;
    /** @type {number|null} */
    this._lastDeviceSetId = null;
    this._lastActivity = 0;
    this._seq = 0;
    /** @type {Set<string>} ids of sets that already raised their alarm */
    this._alarmed = new Set();
  }

  /** @returns {number} Current device epoch (increments on detected reboot). */
  get epoch() {
    return this._epoch;
  }

  /** @returns {Session} Current session (created on demand, WA-33). */
  get session() {
    return this._ensureSession();
  }

  /** @returns {VbtSet|null} Set in progress, or null. */
  get currentSet() {
    return this._set;
  }

  /**
   * @param {string} prefix
   * @returns {string}
   */
  _newId(prefix) {
    this._seq += 1;
    return `${prefix}-${this._now().toString(36)}-${this._seq}`;
  }

  /** @returns {Session} */
  _ensureSession() {
    const now = this._now();
    if (this._session && !this._set && now - this._lastActivity > this._idleTimeoutMs) {
      this._session.endedAt = this._lastActivity;
      this._session = null;
    }
    if (!this._session) {
      this._session = { id: this._newId("s"), startedAt: now, endedAt: null, sets: [] };
    }
    this._lastActivity = now;
    return this._session;
  }

  /**
   * Feed a device set_id seen in Status (or anywhere). Detects reboot.
   * @param {number} deviceSetId
   * @returns {boolean} true if a reboot (new epoch) was detected
   */
  noteDeviceSetId(deviceSetId) {
    const last = this._lastDeviceSetId;
    let reboot = false;
    if (last !== null && deviceSetId < last && !(last === 255 && deviceSetId === 1)) {
      reboot = true;
      this._epoch += 1;
      // the open set belongs to the dead epoch
      if (this._set) this.endSet(null);
    }
    this._lastDeviceSetId = deviceSetId;
    return reboot;
  }

  /**
   * Feed a rep from BLE (live or replay).
   * @param {Rep} rep
   * @returns {{ added: boolean, set: VbtSet, rep: StoredRep, alarm: boolean,
   *             gapFrom: number|null, exceeded: boolean, reboot: boolean }}
   *   added=false for duplicates; alarm=true on first threshold crossing (WA-41);
   *   gapFrom = first missing repIndex if a gap was detected (caller sends requestReps);
   *   exceeded = firmware flag OR local recompute reached the threshold (WA-42);
   *   reboot = a device reboot was detected while processing this rep.
   */
  addRep(rep) {
    const session = this._ensureSession();
    let reboot = false;

    /** @type {VbtSet|undefined} */
    let set;
    if (this._set && this._set.deviceSetId === rep.setId && this._set.epoch === this._epoch) {
      set = this._set;
    } else {
      // replay into a past set of the same epoch? (never a reboot signal)
      for (let i = session.sets.length - 1; i >= 0; i--) {
        const s = session.sets[i];
        if (s.epoch === this._epoch && s.deviceSetId === rep.setId) {
          set = s;
          break;
        }
      }
      if (!set) {
        reboot = this.noteDeviceSetId(rep.setId);
        const now = this._now();
        set = this.startSet(rep.setId);
        // joined mid-set: back-date the start by the device clock
        set.startedAt = Math.min(set.startedAt, now - rep.tMs);
      }
    }

    const existing = set.reps.find((r) => r.repIndex === rep.repIndex);
    if (existing) {
      return { added: false, set, rep: existing, alarm: false, gapFrom: null, exceeded: false, reboot };
    }

    /** @type {StoredRep} */
    const stored = { ...rep, receivedAt: this._now(), velocityLossPctLocal: 0 };
    const maxIdx = set.reps.length ? set.reps[set.reps.length - 1].repIndex : 0;
    set.reps.push(stored);
    set.reps.sort((a, b) => a.repIndex - b.repIndex);
    recomputeLoss(set.reps);

    // A gap exists only when the new rep is ahead of what we hold.
    const gapFrom = rep.repIndex > maxIdx + 1 ? maxIdx + 1 : null;

    const exceeded =
      rep.thresholdExceeded || thresholdReached(stored.velocityLossPctLocal, set.thresholdPct);
    const isNewest = rep.repIndex > maxIdx;
    let alarm = false;
    if (exceeded && isNewest && set.endedAt === null && !this._alarmed.has(set.id)) {
      this._alarmed.add(set.id);
      alarm = true;
    }
    this._lastActivity = this._now();
    return { added: true, set, rep: stored, alarm, gapFrom, exceeded, reboot };
  }

  /**
   * Begin a new set explicitly (user tap or device SET_ACTIVE transition).
   * Idempotent: if a set with the same deviceSetId is already open, returns it.
   * @param {number} deviceSetId
   * @returns {VbtSet}
   */
  startSet(deviceSetId) {
    const session = this._ensureSession();
    this.noteDeviceSetId(deviceSetId);
    if (this._set && this._set.deviceSetId === deviceSetId && this._set.epoch === this._epoch) {
      return this._set;
    }
    if (this._set) this.endSet(null);
    const now = this._now();
    /** @type {VbtSet} */
    const set = {
      id: this._newId("set"),
      sessionId: session.id,
      deviceSetId,
      startedAt: now,
      endedAt: null,
      exercise: this._exercise,
      loadKg: this._loadKg,
      thresholdPct: this._thresholdPct,
      reps: [],
      stopReason: null,
      lostReps: false,
      epoch: this._epoch,
    };
    session.sets.push(set);
    this._set = set;
    return set;
  }

  /**
   * Close the current set.
   * @param {number|null} stopReason
   * @returns {VbtSet|null}
   */
  endSet(stopReason) {
    const set = this._set;
    if (!set) return null;
    set.endedAt = this._now();
    set.stopReason = stopReason;
    this._set = null;
    this._lastActivity = set.endedAt;
    return set;
  }

  /**
   * Flag the current (or given) set as having unrecoverable missing reps.
   * @param {VbtSet|null} [set]
   */
  markLost(set = this._set) {
    if (set) set.lostReps = true;
  }

  /**
   * Set the load for the current set, or for the next one if none is open.
   * @param {number|null} kg
   */
  setLoad(kg) {
    this._loadKg = kg;
    if (this._set) this._set.loadKg = kg;
  }

  /**
   * Correct the load of the most recent set after it ended (WA-31).
   * Also becomes the default for the next set.
   * @param {number|null} kg
   * @returns {VbtSet|null} the corrected set
   */
  setLastSetLoad(kg) {
    this._loadKg = kg;
    const sets = this._session ? this._session.sets : [];
    const last = this._set ?? sets[sets.length - 1] ?? null;
    if (last) last.loadKg = kg;
    return last;
  }

  /** @param {string} exercise */
  setExercise(exercise) {
    this._exercise = exercise;
    if (this._set) this._set.exercise = exercise;
  }

  /** @param {number} pct */
  setThreshold(pct) {
    this._thresholdPct = pct;
    if (this._set) this._set.thresholdPct = pct;
  }

  /** Close the session (WA-33). @returns {Session} */
  endSession() {
    const session = this._ensureSession();
    if (this._set) this.endSet(null);
    session.endedAt = this._now();
    this._session = null;
    return session;
  }

  /**
   * Replace internal state, e.g. restoring a draft from storage (WA-51).
   * @param {Session} session
   */
  restore(session) {
    this._session = session;
    this._set = null;
    this._epoch = 0;
    this._lastDeviceSetId = null;
    this._lastActivity = session.startedAt;
    for (const s of session.sets) {
      s.epoch ??= 0;
      if (s.epoch >= this._epoch) {
        this._epoch = s.epoch;
        this._lastDeviceSetId = s.deviceSetId;
      }
      this._lastActivity = Math.max(this._lastActivity, s.endedAt ?? 0, ...s.reps.map((r) => r.receivedAt));
      if (s.endedAt === null) this._set = s;
    }
    // The alarm of a restored open set is assumed to have fired already if the
    // threshold was crossed; avoids a stale beep after a reload.
    const cur = this._set;
    if (cur && cur.thresholdPct > 0 &&
        cur.reps.some((r) => r.thresholdExceeded || r.velocityLossPctLocal >= cur.thresholdPct)) {
      this._alarmed.add(cur.id);
    }
  }
}
