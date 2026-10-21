// @ts-check
// Web Bluetooth transport. No DOM access. connect() must be called from a user gesture (WA-05).

/** @typedef {import("./protocol.js").Rep} Rep */
/** @typedef {import("./protocol.js").DeviceStatus} DeviceStatus */
/** @typedef {import("./protocol.js").SetSummary} SetSummary */
/** @typedef {import("./protocol.js").LiveSample} LiveSample */

/** @typedef {"disconnected"|"connecting"|"connected"|"reconnecting"} ConnectionState */

/**
 * @typedef {Object} BleEvents
 * @property {(r: Rep) => void} [rep]
 * @property {(s: DeviceStatus) => void} [status]
 * @property {(s: SetSummary) => void} [setSummary]
 * @property {(l: LiveSample) => void} [live]
 * @property {(c: ConnectionState, detail?: string) => void} [connection]
 */

export class VbtBle {
  /** @param {{ subscribeLive?: boolean }} [options] */
  constructor(options) {
    throw new Error("not implemented");
  }

  /** @returns {boolean} true if navigator.bluetooth exists (WA-04). */
  static isSupported() {
    throw new Error("not implemented");
  }

  /** @type {ConnectionState} */
  get state() {
    throw new Error("not implemented");
  }

  /**
   * Register a listener. Returns an unsubscribe function (WA-15).
   * @template {keyof BleEvents} K
   * @param {K} event
   * @param {NonNullable<BleEvents[K]>} handler
   * @returns {() => void}
   */
  on(event, handler) {
    throw new Error("not implemented");
  }

  /**
   * Open the chooser (filter namePrefix "VBT-", optionalServices [SERVICE_UUID]),
   * connect GATT, discover characteristics, check protocol version, enable
   * notifications sequentially, read Status. Must run inside a tap handler.
   * @returns {Promise<DeviceStatus>}
   */
  async connect() {
    throw new Error("not implemented");
  }

  /**
   * Reconnect to the previously chosen device without the chooser (WA-13).
   * Safe to call from a timer; manual retries call it from a tap.
   * @returns {Promise<DeviceStatus>}
   */
  async reconnect() {
    throw new Error("not implemented");
  }

  /** Clean disconnect, remove all listeners. */
  async disconnect() {
    throw new Error("not implemented");
  }

  /** @returns {Promise<DeviceStatus>} */
  async readStatus() {
    throw new Error("not implemented");
  }

  /** @returns {Promise<SetSummary>} */
  async readSetSummary() {
    throw new Error("not implemented");
  }

  /**
   * Write raw bytes to the Command characteristic (write with response).
   * Rejects if the device answers ATT error 0x80 (invalid command for state).
   * @param {Uint8Array} bytes
   * @returns {Promise<void>}
   */
  async sendCommand(bytes) {
    throw new Error("not implemented");
  }

  /** @returns {Promise<void>} */
  async startSet() {
    throw new Error("not implemented");
  }

  /** @returns {Promise<void>} */
  async stopSet() {
    throw new Error("not implemented");
  }

  /** @returns {Promise<void>} */
  async tare() {
    throw new Error("not implemented");
  }

  /**
   * @param {number} pct
   * @returns {Promise<void>}
   */
  async setThreshold(pct) {
    throw new Error("not implemented");
  }

  /**
   * @param {boolean} on
   * @returns {Promise<void>}
   */
  async setBeep(on) {
    throw new Error("not implemented");
  }

  /**
   * Ask the device to resend reps from `fromRep` (1-based) of `setId` (WA-14).
   * Replies arrive through the "rep" event.
   * @param {number} setId
   * @param {number} fromRep
   * @returns {Promise<void>}
   */
  async requestReps(setId, fromRep) {
    throw new Error("not implemented");
  }

  /** @returns {Promise<void>} */
  async requestStatus() {
    throw new Error("not implemented");
  }
}
