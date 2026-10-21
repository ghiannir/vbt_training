// @ts-check
// BLE protocol codec. Must match docs/ble-protocol.md exactly (protocol version 1).
// Pure module: no DOM, no Web Bluetooth. Integer wire units (mm/s, mm, ms) are
// converted to SI floats (m/s, m, s) only here (WA-84).

export const PROTOCOL_VERSION = 1;

export const SERVICE_UUID = "b972a2b5-fe5d-481c-8293-5ad78d77ae5e";
export const CHAR_UUID = Object.freeze({
  rep: "89826146-e413-4d2a-9c5b-7882e6d4973c",
  status: "74fe761a-78be-41fd-b4aa-d75e861395db",
  command: "19407613-018f-4ad7-a1f9-9170de45328e",
  setSummary: "1bea91e2-4768-45a9-8498-f412cba0add8",
  live: "8e3b1485-73ca-4dd1-b16a-0b3da91237f2",
});
export const DEVICE_NAME_PREFIX = "VBT-";

/** Payload sizes in bytes. */
export const SIZE = Object.freeze({ rep: 18, status: 12, setSummary: 12, live: 4 });

/** Device states (Status.state). */
export const State = Object.freeze({
  IDLE: 0, CALIBRATING: 1, READY: 2, SET_ACTIVE: 3, SET_DONE: 4, ERROR: 5,
});

/** Command opcodes (first byte of a Command write). */
export const Opcode = Object.freeze({
  START_SET: 0x01,
  STOP_SET: 0x02,
  TARE: 0x03,
  SET_THRESHOLD: 0x04,
  SET_BEEP: 0x05,
  REQUEST_REPS: 0x06,
  REQUEST_STATUS: 0x07,
});

/** Rep.flags bits. */
export const RepFlag = Object.freeze({
  THRESHOLD_EXCEEDED: 1 << 0,
  NEW_BEST: 1 << 1,
  LOW_QUALITY: 1 << 2,
});

/** Status.flags bits. */
export const StatusFlag = Object.freeze({
  CHARGING: 1 << 0,
  BEEP_ON: 1 << 1,
  CALIBRATION_VALID: 1 << 2,
});

/** SetSummary.stop_reason values. */
export const StopReason = Object.freeze({
  BUTTON: 0, APP_COMMAND: 1, THRESHOLD: 2, TIMEOUT: 3,
});

/**
 * One repetition as sent by the device (SI units).
 * @typedef {Object} Rep
 * @property {number} setId        Device set counter (1..255, wraps).
 * @property {number} repIndex     1-based index within the set.
 * @property {number} mcv          Mean concentric velocity, m/s.
 * @property {number} peak         Peak concentric velocity, m/s.
 * @property {number} rom          Concentric range of motion, m.
 * @property {number} concDuration Concentric duration, s.
 * @property {number} repDuration  Total rep duration, s.
 * @property {number} velocityLossPct Loss vs best rep so far, % (device value).
 * @property {boolean} thresholdExceeded
 * @property {boolean} newBest
 * @property {boolean} lowQuality
 * @property {number} tMs          ms since set start at rep end.
 */

/**
 * @typedef {Object} DeviceStatus
 * @property {number} protoVersion
 * @property {number} state        One of State.
 * @property {number} batteryPct
 * @property {boolean} charging
 * @property {boolean} beepOn
 * @property {boolean} calibrationValid
 * @property {number} setId
 * @property {number} repCount
 * @property {number} thresholdPct 0 = disabled.
 * @property {number} errorCode
 * @property {number} bestMcv      m/s
 * @property {number} lastVelocityLossPct
 */

/**
 * @typedef {Object} SetSummary
 * @property {number} setId
 * @property {number} repCount
 * @property {number} stopReason   One of StopReason.
 * @property {number} finalVelocityLossPct
 * @property {number} bestMcv      m/s
 * @property {number} meanMcv      m/s
 * @property {number} durationS
 */

/**
 * @typedef {Object} LiveSample
 * @property {number} velocity     m/s, signed (+ = up), indicative only.
 * @property {number} displacement m, signed, indicative only.
 */

/**
 * Decode a Rep notification. Throws if the payload is shorter than SIZE.rep.
 * @param {DataView} view
 * @returns {Rep}
 */
export function decodeRep(view) {
  throw new Error("not implemented");
}

/**
 * @param {DataView} view
 * @returns {DeviceStatus}
 */
export function decodeStatus(view) {
  throw new Error("not implemented");
}

/**
 * @param {DataView} view
 * @returns {SetSummary}
 */
export function decodeSetSummary(view) {
  throw new Error("not implemented");
}

/**
 * @param {DataView} view
 * @returns {LiveSample}
 */
export function decodeLive(view) {
  throw new Error("not implemented");
}

/** @returns {Uint8Array} */
export function encodeStartSet() {
  throw new Error("not implemented");
}

/** @returns {Uint8Array} */
export function encodeStopSet() {
  throw new Error("not implemented");
}

/** @returns {Uint8Array} */
export function encodeTare() {
  throw new Error("not implemented");
}

/**
 * @param {number} pct 0 (off) or 5..60.
 * @returns {Uint8Array}
 */
export function encodeSetThreshold(pct) {
  throw new Error("not implemented");
}

/**
 * @param {boolean} on
 * @returns {Uint8Array}
 */
export function encodeSetBeep(on) {
  throw new Error("not implemented");
}

/**
 * @param {number} setId
 * @param {number} fromRep 1-based.
 * @returns {Uint8Array}
 */
export function encodeRequestReps(setId, fromRep) {
  throw new Error("not implemented");
}

/** @returns {Uint8Array} */
export function encodeRequestStatus() {
  throw new Error("not implemented");
}
