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
 * @param {DataView} view
 * @param {number} size
 * @param {string} name
 */
function requireSize(view, size, name) {
  if (!view || view.byteLength < size) {
    throw new Error(`Payload ${name} too short: ${view ? view.byteLength : 0} < ${size} bytes`);
  }
}

/**
 * Decode a Rep notification. Throws if the payload is shorter than SIZE.rep.
 * @param {DataView} view
 * @returns {Rep}
 */
export function decodeRep(view) {
  requireSize(view, SIZE.rep, "Rep");
  const flags = view.getUint8(13);
  return {
    setId: view.getUint8(0),
    repIndex: view.getUint8(1),
    mcv: view.getUint16(2, true) / 1000,
    peak: view.getUint16(4, true) / 1000,
    rom: view.getUint16(6, true) / 1000,
    concDuration: view.getUint16(8, true) / 1000,
    repDuration: view.getUint16(10, true) / 1000,
    velocityLossPct: view.getUint8(12),
    thresholdExceeded: (flags & RepFlag.THRESHOLD_EXCEEDED) !== 0,
    newBest: (flags & RepFlag.NEW_BEST) !== 0,
    lowQuality: (flags & RepFlag.LOW_QUALITY) !== 0,
    tMs: view.getUint32(14, true),
  };
}

/**
 * @param {DataView} view
 * @returns {DeviceStatus}
 */
export function decodeStatus(view) {
  requireSize(view, SIZE.status, "Status");
  const flags = view.getUint8(3);
  return {
    protoVersion: view.getUint8(0),
    state: view.getUint8(1),
    batteryPct: view.getUint8(2),
    charging: (flags & StatusFlag.CHARGING) !== 0,
    beepOn: (flags & StatusFlag.BEEP_ON) !== 0,
    calibrationValid: (flags & StatusFlag.CALIBRATION_VALID) !== 0,
    setId: view.getUint8(4),
    repCount: view.getUint8(5),
    thresholdPct: view.getUint8(6),
    errorCode: view.getUint8(7),
    bestMcv: view.getUint16(8, true) / 1000,
    lastVelocityLossPct: view.getUint8(10),
  };
}

/**
 * @param {DataView} view
 * @returns {SetSummary}
 */
export function decodeSetSummary(view) {
  requireSize(view, SIZE.setSummary, "SetSummary");
  return {
    setId: view.getUint8(0),
    repCount: view.getUint8(1),
    stopReason: view.getUint8(2),
    finalVelocityLossPct: view.getUint8(3),
    bestMcv: view.getUint16(4, true) / 1000,
    meanMcv: view.getUint16(6, true) / 1000,
    durationS: view.getUint16(8, true),
  };
}

/**
 * @param {DataView} view
 * @returns {LiveSample}
 */
export function decodeLive(view) {
  requireSize(view, SIZE.live, "Live");
  return {
    velocity: view.getInt16(0, true) / 1000,
    displacement: view.getInt16(2, true) / 1000,
  };
}

/** @returns {Uint8Array} */
export function encodeStartSet() {
  return Uint8Array.of(Opcode.START_SET);
}

/** @returns {Uint8Array} */
export function encodeStopSet() {
  return Uint8Array.of(Opcode.STOP_SET);
}

/** @returns {Uint8Array} */
export function encodeTare() {
  return Uint8Array.of(Opcode.TARE);
}

/**
 * @param {number} pct 0 (off) or 5..60.
 * @returns {Uint8Array}
 */
export function encodeSetThreshold(pct) {
  if (!Number.isInteger(pct) || (pct !== 0 && (pct < 5 || pct > 60))) {
    throw new RangeError(`Invalid threshold: ${pct} (0 or 5..60)`);
  }
  return Uint8Array.of(Opcode.SET_THRESHOLD, pct);
}

/**
 * @param {boolean} on
 * @returns {Uint8Array}
 */
export function encodeSetBeep(on) {
  return Uint8Array.of(Opcode.SET_BEEP, on ? 1 : 0);
}

/**
 * @param {number} setId
 * @param {number} fromRep 1-based.
 * @returns {Uint8Array}
 */
export function encodeRequestReps(setId, fromRep) {
  if (!Number.isInteger(setId) || setId < 1 || setId > 255) {
    throw new RangeError(`invalid set_id: ${setId}`);
  }
  if (!Number.isInteger(fromRep) || fromRep < 1 || fromRep > 255) {
    throw new RangeError(`invalid from_rep: ${fromRep}`);
  }
  return Uint8Array.of(Opcode.REQUEST_REPS, setId, fromRep);
}

/** @returns {Uint8Array} */
export function encodeRequestStatus() {
  return Uint8Array.of(Opcode.REQUEST_STATUS);
}
