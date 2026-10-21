// @ts-check
// Fake device for testing the UI without hardware (?demo=1, WA-81).
// Exposes the same event surface as VbtBle.

/** @typedef {import("./ble.js").BleEvents} BleEvents */

export class SimulatedBle {
  /**
   * @param {{ startMcv?: number, fatiguePerRep?: number, repIntervalMs?: number }} [options]
   */
  constructor(options) {
    throw new Error("not implemented");
  }

  /**
   * @template {keyof BleEvents} K
   * @param {K} event
   * @param {NonNullable<BleEvents[K]>} handler
   * @returns {() => void}
   */
  on(event, handler) {
    throw new Error("not implemented");
  }

  async connect() {
    throw new Error("not implemented");
  }

  async disconnect() {
    throw new Error("not implemented");
  }

  async startSet() {
    throw new Error("not implemented");
  }

  async stopSet() {
    throw new Error("not implemented");
  }
}
