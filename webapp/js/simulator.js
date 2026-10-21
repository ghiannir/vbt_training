// @ts-check
// Fake device for testing the UI without hardware (?demo=1, WA-81).
// Exposes the same event surface as VbtBle. Payloads are encoded to the real wire
// format and run through the protocol.js decoders, so the whole decode path is exercised.

import {
  PROTOCOL_VERSION, State, StopReason, RepFlag, StatusFlag,
  decodeRep, decodeStatus, decodeSetSummary, decodeLive,
} from "./protocol.js";

/** @typedef {import("./ble.js").BleEvents} BleEvents */
/** @typedef {import("./ble.js").ConnectionState} ConnectionState */
/** @typedef {import("./protocol.js").DeviceStatus} DeviceStatus */
/** @typedef {import("./protocol.js").SetSummary} SetSummary */

const MAX_REPS = 15;

/** @param {number} v @param {number} max */
const clampInt = (v, max) => Math.max(0, Math.min(max, Math.round(v)));
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));
/** Roughly gaussian noise, sd 1. */
const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) * 2;

/**
 * @param {{setId:number, repIndex:number, mcv:number, peak:number, rom:number, conc:number,
 *          rep:number, loss:number, flags:number, tMs:number}} r  mm/s, mm, ms units
 */
function encodeRep(r) {
  const dv = new DataView(new ArrayBuffer(18));
  dv.setUint8(0, r.setId);
  dv.setUint8(1, r.repIndex);
  dv.setUint16(2, clampInt(r.mcv, 65535), true);
  dv.setUint16(4, clampInt(r.peak, 65535), true);
  dv.setUint16(6, clampInt(r.rom, 65535), true);
  dv.setUint16(8, clampInt(r.conc, 65535), true);
  dv.setUint16(10, clampInt(r.rep, 65535), true);
  dv.setUint8(12, clampInt(r.loss, 100));
  dv.setUint8(13, r.flags);
  dv.setUint32(14, r.tMs, true);
  return dv;
}

export class SimulatedBle {
  /** @type {Map<string, Set<Function>>} */
  #handlers = new Map();
  /** @type {ConnectionState} */
  #state = "disconnected";
  #opts;
  #hasDevice = false;
  #deviceState = State.IDLE;
  #battery = 94;
  #thresholdPct = 20;
  #beep = true;
  #setId = 0;
  #setNo = 0;
  #repCount = 0;
  #best = 0;
  #lastLoss = 0;
  /** Reps produced since the threshold was first crossed (the demo ends the set after 2). */
  #overCount = -1;
  #setStartMs = 0;
  #tMs = 0;
  /** Encoded reps of the current and previous set, keyed by setId. @type {Map<number, DataView[]>} */
  #buffer = new Map();
  /** @type {SetSummary|null} */
  #lastSummary = null;
  /** Highest rep index of the current set delivered to the app. */
  #delivered = 0;
  #linkUp = false;
  #repTimer = 0;
  #batTimer = 0;
  #epoch = 0;

  /**
   * @param {{ startMcv?: number, fatiguePerRep?: number, repIntervalMs?: number }} [options]
   */
  constructor(options) {
    this.#opts = {
      startMcv: options?.startMcv ?? 0.62,
      fatiguePerRep: options?.fatiguePerRep ?? 0.03,
      repIntervalMs: options?.repIntervalMs ?? 3500,
    };
  }

  static isSupported() { return true; }

  get state() { return this.#state; }
  get hasDevice() { return this.#hasDevice; }
  get gattListenerCount() { return 0; }

  /**
   * @template {keyof BleEvents} K
   * @param {K} event
   * @param {NonNullable<BleEvents[K]>} handler
   * @returns {() => void}
   */
  on(event, handler) {
    let set = this.#handlers.get(event);
    if (!set) this.#handlers.set(event, (set = new Set()));
    set.add(handler);
    return () => { set.delete(handler); };
  }

  /** @param {string} event @param {...any} args */
  #emit(event, ...args) {
    for (const h of [...(this.#handlers.get(event) ?? [])]) {
      try { h(...args); } catch (e) { console.error("SimulatedBle handler error", e); }
    }
  }

  /** @param {ConnectionState} s @param {string} [detail] */
  #setState(s, detail) {
    this.#state = s;
    this.#emit("connection", s, detail);
  }

  // ---- wire encoders (device side) ----

  #statusView() {
    const dv = new DataView(new ArrayBuffer(12));
    dv.setUint8(0, PROTOCOL_VERSION);
    dv.setUint8(1, this.#deviceState);
    dv.setUint8(2, Math.round(this.#battery));
    dv.setUint8(3, (this.#beep ? StatusFlag.BEEP_ON : 0) | StatusFlag.CALIBRATION_VALID);
    dv.setUint8(4, this.#setId);
    dv.setUint8(5, this.#repCount);
    dv.setUint8(6, this.#thresholdPct);
    dv.setUint8(7, 0);
    dv.setUint16(8, clampInt(this.#best * 1000, 65535), true);
    dv.setUint8(10, this.#lastLoss);
    return dv;
  }

  /** @param {SetSummary & {}} s */
  #summaryView(s) {
    const dv = new DataView(new ArrayBuffer(12));
    dv.setUint8(0, s.setId);
    dv.setUint8(1, s.repCount);
    dv.setUint8(2, s.stopReason);
    dv.setUint8(3, s.finalVelocityLossPct);
    dv.setUint16(4, clampInt(s.bestMcv * 1000, 65535), true);
    dv.setUint16(6, clampInt(s.meanMcv * 1000, 65535), true);
    dv.setUint16(8, s.durationS, true);
    return dv;
  }

  /** @returns {DeviceStatus} */
  #currentStatus() { return decodeStatus(this.#statusView()); }

  #emitStatus() {
    if (this.#linkUp) this.#emit("status", this.#currentStatus());
  }

  // ---- connection ----

  async connect() {
    this.#epoch++;
    this.#setState("connecting");
    await sleep(700);
    this.#hasDevice = true;
    this.#linkUp = true;
    if (this.#deviceState === State.IDLE) {
      this.#deviceState = State.CALIBRATING;
      this.#setState("connected");
      this.#emitStatus();
      const epoch = this.#epoch;
      setTimeout(() => {
        if (epoch !== this.#epoch || this.#deviceState !== State.CALIBRATING) return;
        this.#deviceState = State.READY;
        this.#emitStatus();
      }, 1500);
    } else {
      this.#setState("connected");
      this.#emitStatus();
    }
    this.#startBatteryTimer();
    return this.#currentStatus();
  }

  async reconnect() { return this.connect(); }

  async disconnect() {
    this.#epoch++;
    clearTimeout(this.#repTimer);
    clearInterval(this.#batTimer);
    this.#linkUp = false;
    // The real device keeps its set running; the demo just parks it.
    if (this.#deviceState === State.SET_ACTIVE) this.#finishSet(StopReason.APP_COMMAND, true);
    this.#deviceState = State.IDLE;
    this.#setState("disconnected", "can-reconnect");
  }

  #startBatteryTimer() {
    clearInterval(this.#batTimer);
    this.#batTimer = setInterval(() => {
      this.#battery = Math.max(5, this.#battery - 0.2);
      this.#emitStatus();
    }, 30000);
  }

  /** Same job as VbtBle.resync(): status, then replay what the app is missing. */
  async resync() {
    if (!this.#linkUp) return;
    const st = await this.readStatus();
    if (st.repCount > this.#delivered) await this.requestReps(st.setId, this.#delivered + 1);
    if (st.state === State.SET_DONE && this.#lastSummary) this.#emit("setSummary", this.#lastSummary);
  }

  async readStatus() {
    const st = this.#currentStatus();
    this.#emit("status", st);
    return st;
  }

  async readSetSummary() {
    if (!this.#lastSummary) throw new Error("Nessuna serie conclusa.");
    return this.#lastSummary;
  }

  // ---- commands ----

  /** @param {string} what @param {number[]} validStates */
  #require(what, validStates) {
    if (!this.#linkUp) throw new Error("Sensore non connesso.");
    if (!validStates.includes(this.#deviceState)) {
      throw new Error(`Comando non accettato dal sensore (${what} non valido nello stato attuale)`);
    }
  }

  async startSet() {
    this.#require("START_SET", [State.READY, State.SET_DONE]);
    this.#setId = this.#setId >= 255 ? 1 : this.#setId + 1;
    this.#setNo++;
    this.#repCount = 0;
    this.#delivered = 0;
    this.#best = 0;
    this.#lastLoss = 0;
    this.#overCount = -1;
    this.#tMs = 0;
    this.#setStartMs = Date.now();
    this.#buffer.set(this.#setId, []);
    this.#buffer.delete(this.#setId - 2);
    this.#deviceState = State.SET_ACTIVE;
    this.#emitStatus();
    this.#scheduleRep(this.#opts.repIntervalMs * 0.8);
  }

  async stopSet() {
    this.#require("STOP_SET", [State.SET_ACTIVE]);
    this.#finishSet(StopReason.APP_COMMAND);
  }

  async tare() {
    this.#require("TARE", [State.IDLE, State.READY, State.SET_DONE, State.ERROR]);
    this.#deviceState = State.CALIBRATING;
    this.#emitStatus();
    const epoch = this.#epoch;
    await sleep(1500);
    if (epoch !== this.#epoch) return;
    this.#deviceState = State.READY;
    this.#emitStatus();
  }

  /** @param {number} pct */
  async setThreshold(pct) {
    if (!this.#linkUp) throw new Error("Sensore non connesso.");
    this.#thresholdPct = pct;
    this.#emitStatus();
  }

  /** @param {boolean} on */
  async setBeep(on) {
    if (!this.#linkUp) throw new Error("Sensore non connesso.");
    this.#beep = on;
    this.#emitStatus();
  }

  async requestStatus() {
    this.#emitStatus();
    if (this.#lastSummary && this.#deviceState === State.SET_DONE) this.#emit("setSummary", this.#lastSummary);
  }

  /**
   * @param {number} setId
   * @param {number} fromRep
   */
  async requestReps(setId, fromRep) {
    if (!this.#linkUp) throw new Error("Sensore non connesso.");
    const reps = this.#buffer.get(setId) ?? [];
    for (const dv of reps) {
      if (dv.getUint8(1) >= fromRep) this.#deliverRep(dv);
    }
  }

  // ---- set simulation ----

  /** @param {number} ms */
  #scheduleRep(ms) {
    clearTimeout(this.#repTimer);
    this.#repTimer = setTimeout(() => this.#produceRep(), ms);
  }

  #produceRep() {
    if (this.#deviceState !== State.SET_ACTIVE) return;
    const i = ++this.#repCount;
    const { startMcv, fatiguePerRep, repIntervalMs } = this.#opts;
    const n = i - 1;
    const mcv = Math.max(0.1, startMcv * (1 - fatiguePerRep * n - 0.004 * n * n) + gauss() * 0.012);
    const rom = 0.46 + gauss() * 0.012;
    const conc = rom / mcv;
    const ecc = 1.1 + Math.random() * 0.4;
    const peak = mcv * (1.55 + Math.random() * 0.1);
    this.#tMs += Math.round((conc + ecc) * 1000);
    const newBest = mcv > this.#best;
    if (newBest) this.#best = mcv;
    const loss = clampInt(((this.#best - mcv) / this.#best) * 100, 100);
    const exceeded = this.#thresholdPct > 0 && loss >= this.#thresholdPct;
    this.#lastLoss = loss;
    const lowQuality = Math.random() < 0.04;
    const dv = encodeRep({
      setId: this.#setId, repIndex: i,
      mcv: mcv * 1000, peak: peak * 1000, rom: rom * 1000,
      conc: conc * 1000, rep: (conc + ecc) * 1000,
      loss,
      flags: (exceeded ? RepFlag.THRESHOLD_EXCEEDED : 0) | (newBest ? RepFlag.NEW_BEST : 0) |
        (lowQuality ? RepFlag.LOW_QUALITY : 0),
      tMs: this.#tMs,
    });
    this.#buffer.get(this.#setId)?.push(dv);

    // Exercise resync: every 3rd set loses one notification (gap detection),
    // and the set after that drops the link for a few seconds on rep 3.
    const dropNotification = this.#setNo % 3 === 2 && i === 3;
    const dropLink = this.#setNo % 3 === 0 && i === 3;
    if (dropLink) this.#dropLink();
    else if (!dropNotification) this.#deliverRep(dv);

    if (exceeded && this.#overCount < 0) this.#overCount = 0;
    else if (this.#overCount >= 0) this.#overCount++;

    if (this.#overCount >= 2) this.#finishSet(StopReason.THRESHOLD);
    else if (i >= MAX_REPS) this.#finishSet(StopReason.TIMEOUT);
    else {
      this.#scheduleRep(repIntervalMs * (0.85 + Math.random() * 0.3));
      this.#emitStatus();
    }
  }

  /** @param {DataView} dv */
  #deliverRep(dv) {
    if (!this.#linkUp) return;
    const rep = decodeRep(dv);
    if (rep.setId === this.#setId) this.#delivered = Math.max(this.#delivered, rep.repIndex);
    this.#emit("rep", rep);
  }

  #dropLink() {
    this.#linkUp = false;
    this.#setState("reconnecting", "1");
    const epoch = this.#epoch;
    setTimeout(async () => {
      if (epoch !== this.#epoch) return;
      this.#linkUp = true;
      this.#setState("connected");
      await this.resync();
    }, 6000);
  }

  /**
   * @param {number} reason
   * @param {boolean} [silent]
   */
  #finishSet(reason, silent = false) {
    clearTimeout(this.#repTimer);
    const reps = (this.#buffer.get(this.#setId) ?? []).map(decodeRep);
    const mean = reps.length ? reps.reduce((a, r) => a + r.mcv, 0) / reps.length : 0;
    this.#deviceState = State.SET_DONE;
    /** @type {SetSummary} */
    this.#lastSummary = decodeSetSummary(this.#summaryView({
      setId: this.#setId, repCount: this.#repCount, stopReason: reason,
      finalVelocityLossPct: this.#lastLoss, bestMcv: this.#best, meanMcv: mean,
      durationS: Math.round((Date.now() - this.#setStartMs) / 1000),
    }));
    if (silent || !this.#linkUp) return;
    this.#emitStatus();
    this.#emit("setSummary", this.#lastSummary);
  }

  /** Optional live stream (not used by the UI yet); kept for interface parity. */
  emitLiveSample(vMps = 0, hM = 0) {
    const dv = new DataView(new ArrayBuffer(4));
    dv.setInt16(0, Math.round(vMps * 1000), true);
    dv.setInt16(2, Math.round(hM * 1000), true);
    this.#emit("live", decodeLive(dv));
  }
}
