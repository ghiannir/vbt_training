// @ts-check
// Web Bluetooth transport. No DOM access. connect() must be called from a user gesture (WA-05).

import {
  SERVICE_UUID, CHAR_UUID, DEVICE_NAME_PREFIX, PROTOCOL_VERSION, State,
  decodeRep, decodeStatus, decodeSetSummary, decodeLive,
  encodeStartSet, encodeStopSet, encodeTare, encodeSetThreshold, encodeSetBeep,
  encodeRequestReps, encodeRequestStatus,
} from "./protocol.js";

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

/** Delay before each automatic reconnection attempt (WA-13). */
const BACKOFF_MS = [1000, 2000, 4000, 8000, 8000];
const COMMAND_REPLY_MS = 1500;  // wait for the Status the firmware sends after every command
const ERROR_BAD_COMMAND = 3;    // Status.error_code: invalid command

/** @param {string} why */
function commandRejected(why) {
  const err = new Error(`Command not accepted by the sensor (${why})`);
  err.name = "CommandRejected";
  return err;
}

export class VbtBle {
  /** @type {Map<string, Set<Function>>} */
  #handlers = new Map();
  /** @type {ConnectionState} */
  #state = "disconnected";
  /** @type {any} BluetoothDevice */
  #device = null;
  /** @type {Record<string, any>|null} characteristics by name */
  #chars = null;
  /** @type {Array<[any, Function]>} (characteristic, listener) pairs currently attached */
  #attached = [];
  /** Bumped on disconnect()/reconnect() to cancel a pending automatic retry loop. */
  #epoch = 0;
  #subscribeLive;
  /** Last rep received, for gap detection on resync. @type {{setId:number, repIndex:number}|null} */
  #lastRep = null;
  /** True once a connection was fully established at least once. */
  #everConnected = false;
  /** Tail of the GATT operation queue: reads/writes run one at a time (iOS rejects overlapping ops). */
  #tail = Promise.resolve();

  /** @param {{ subscribeLive?: boolean }} [options] */
  constructor(options) {
    this.#subscribeLive = options?.subscribeLive ?? false;
    this.onGattDisconnected = this.onGattDisconnected.bind(this);
  }

  /** @returns {boolean} true if navigator.bluetooth exists (WA-04). */
  static isSupported() {
    return typeof navigator !== "undefined" && "bluetooth" in navigator;
  }

  /** @type {ConnectionState} */
  get state() {
    return this.#state;
  }

  /** True once a device was chosen, so reconnect() is possible without the chooser. */
  get hasDevice() {
    return this.#device !== null;
  }

  /** Number of GATT listeners currently attached (WA-15 check: must not grow). */
  get gattListenerCount() {
    return this.#attached.length + (this.#device ? 1 : 0);
  }

  /**
   * Register a listener. Returns an unsubscribe function (WA-15).
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

  /**
   * @param {string} event
   * @param {...any} args
   */
  #emit(event, ...args) {
    for (const h of [...(this.#handlers.get(event) ?? [])]) {
      try { h(...args); } catch (e) { console.error("VbtBle handler error", e); }
    }
  }

  /**
   * @param {ConnectionState} state
   * @param {string} [detail]
   */
  #setState(state, detail) {
    this.#state = state;
    this.#emit("connection", state, detail);
  }

  /**
   * Open the chooser (filter namePrefix "VBT-", optionalServices [SERVICE_UUID]),
   * connect GATT, discover characteristics, check protocol version, enable
   * notifications sequentially, read Status. Must run inside a tap handler.
   * @returns {Promise<DeviceStatus>}
   */
  async connect() {
    if (!VbtBle.isSupported()) throw new Error("Web Bluetooth not available: open the page in Bluefy.");
    this.#epoch++;
    this.#setState("connecting");
    let device;
    try {
      device = await /** @type {any} */ (navigator).bluetooth.requestDevice({
        filters: [{ namePrefix: DEVICE_NAME_PREFIX }, { services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
    } catch (e) {
      this.#setState("disconnected", this.#device ? "can-reconnect" : undefined);
      throw e;
    }
    this.#adoptDevice(device);
    return this.#establishOrFail();
  }

  /**
   * Reconnect to the previously chosen device without the chooser (WA-13).
   * Safe to call from a timer; manual retries call it from a tap.
   * @returns {Promise<DeviceStatus>}
   */
  async reconnect() {
    if (!this.#device) throw new Error("No device to reconnect to.");
    this.#epoch++;
    this.#setState("connecting");
    return this.#establishOrFail();
  }

  /** Clean disconnect: closes GATT and removes our GATT listeners (app handlers added via on() stay). */
  async disconnect() {
    this.#epoch++;
    const device = this.#device;
    const chars = this.#chars;
    this.#detachChars();
    if (chars) {
      for (const name of ["status", "rep", "setSummary", "live"]) {
        try { await chars[name]?.stopNotifications(); } catch { /* already gone */ }
      }
    }
    try { device?.gatt?.disconnect(); } catch { /* ignore */ }
    this.#lastRep = null;
    this.#setState("disconnected", device ? "can-reconnect" : undefined);
  }

  /** @param {any} device */
  #adoptDevice(device) {
    if (this.#device && this.#device !== device) {
      this.#device.removeEventListener("gattserverdisconnected", this.onGattDisconnected);
    }
    if (this.#device !== device) {
      this.#device = device;
      this.#lastRep = null;
      device.addEventListener("gattserverdisconnected", this.onGattDisconnected);
    }
  }

  /** @returns {Promise<DeviceStatus>} */
  async #establishOrFail() {
    try {
      const status = await this.#establish();
      this.#everConnected = true;
      this.#setState("connected");
      // Resync runs after "connected" so the UI is already up; failures are not fatal.
      this.resync(status).catch((e) => console.warn("resync failed", e));
      return status;
    } catch (e) {
      this.#detachChars();
      try { this.#device?.gatt?.disconnect(); } catch { /* ignore */ }
      this.#setState("disconnected", this.#device ? "can-reconnect" : undefined);
      throw e;
    }
  }

  /** GATT connect + discovery + version check + notifications + first Status read. */
  async #establish() {
    const server = await this.#device.gatt.connect();
    const service = await server.getPrimaryService(SERVICE_UUID);
    const chars = {
      status: await service.getCharacteristic(CHAR_UUID.status),
      rep: await service.getCharacteristic(CHAR_UUID.rep),
      setSummary: await service.getCharacteristic(CHAR_UUID.setSummary),
      command: await service.getCharacteristic(CHAR_UUID.command),
      live: this.#subscribeLive ? await service.getCharacteristic(CHAR_UUID.live) : null,
    };
    this.#chars = chars;

    // Version check before trusting any other payload (WA-11).
    const first = decodeStatus(await chars.status.readValue());
    if (first.protoVersion !== PROTOCOL_VERSION) {
      const err = new Error(`Incompatible firmware (fw ${first.protoVersion}, app ${PROTOCOL_VERSION})`);
      err.name = "FirmwareMismatch";
      throw err;
    }

    // Sequential, never in parallel (contract notes).
    this.#detachChars();
    this.#chars = chars;
    await this.#subscribe(chars.status, (v) => this.#emit("status", decodeStatus(v)));
    await this.#subscribe(chars.rep, (v) => this.#onRep(decodeRep(v)));
    await this.#subscribe(chars.setSummary, (v) => this.#emit("setSummary", decodeSetSummary(v)));
    if (chars.live) await this.#subscribe(chars.live, (v) => this.#emit("live", decodeLive(v)));

    return this.readStatus();
  }

  /**
   * @param {any} characteristic
   * @param {(v: DataView) => void} decode
   */
  async #subscribe(characteristic, decode) {
    const listener = (/** @type {any} */ ev) => {
      try { decode(ev.target.value); } catch (e) { console.warn("bad notification", e); }
    };
    characteristic.addEventListener("characteristicvaluechanged", listener);
    this.#attached.push([characteristic, listener]);
    await characteristic.startNotifications();
  }

  #detachChars() {
    for (const [c, l] of this.#attached) c.removeEventListener("characteristicvaluechanged", l);
    this.#attached = [];
    this.#chars = null;
  }

  /** @param {Rep} rep */
  #onRep(rep) {
    const last = this.#lastRep;
    if (!last || last.setId !== rep.setId || rep.repIndex > last.repIndex) {
      this.#lastRep = { setId: rep.setId, repIndex: rep.repIndex };
    }
    this.#emit("rep", rep);
  }

  /** gattserverdisconnected: retry on the same device with backoff (WA-13). */
  onGattDisconnected() {
    this.#detachChars();
    if (this.#state === "connected") this.#autoReconnect();
  }

  async #autoReconnect() {
    const epoch = ++this.#epoch;
    this.#setState("reconnecting", "0");
    for (let i = 0; i < BACKOFF_MS.length; i++) {
      await new Promise((r) => setTimeout(r, BACKOFF_MS[i]));
      if (epoch !== this.#epoch) return; // user disconnected or reconnected manually
      this.#setState("reconnecting", String(i + 1));
      try {
        const status = await this.#establish();
        if (epoch !== this.#epoch) return;
        this.#setState("connected");
        this.resync(status).catch((e) => console.warn("resync failed", e));
        return;
      } catch (e) {
        if (/** @type {any} */ (e)?.name === "FirmwareMismatch") break;
        this.#detachChars();
        try { this.#device?.gatt?.disconnect(); } catch { /* ignore */ }
      }
    }
    if (epoch === this.#epoch) this.#setState("disconnected", "can-reconnect");
  }

  /**
   * Resynchronise after a (re)connection or a page resume: read Status, request the
   * reps we did not receive, read the SetSummary if the set is over. Duplicates are
   * harmless: the session layer deduplicates by (setId, repIndex).
   * @param {DeviceStatus} [known] Status just read, to avoid a second read.
   */
  async resync(known) {
    if (this.#state !== "connected") return;
    const st = known ?? await this.readStatus();
    const last = this.#lastRep;
    if (last && st.setId < last.setId) this.#lastRep = null; // device rebooted
    const have = this.#lastRep && this.#lastRep.setId === st.setId ? this.#lastRep.repIndex : 0;
    const active = st.state === State.SET_ACTIVE;
    // On a first connection to an idle device, do not import its previous set.
    if (st.repCount > have && (active || this.#everConnected || have > 0)) {
      await this.requestReps(st.setId, have + 1);
    }
    if (st.state === State.SET_DONE) {
      const sum = await this.readSetSummary();
      if (sum.setId === st.setId) this.#emit("setSummary", sum);
    }
  }

  /**
   * @template T
   * @param {() => Promise<T>} fn
   * @returns {Promise<T>}
   */
  #serial(fn) {
    const run = this.#tail.then(fn, fn);
    this.#tail = run.then(() => {}, () => {});
    return run;
  }

  /** @returns {Promise<DeviceStatus>} */
  readStatus() {
    return this.#serial(async () => {
      const c = this.#requireChar("status");
      const st = decodeStatus(await c.readValue());
      this.#emit("status", st);
      return st;
    });
  }

  /** @returns {Promise<SetSummary>} */
  readSetSummary() {
    return this.#serial(async () => {
      const c = this.#requireChar("setSummary");
      return decodeSetSummary(await c.readValue());
    });
  }

  /**
   * @param {string} name
   * @returns {any}
   */
  #requireChar(name) {
    const c = this.#chars?.[name];
    if (!c) throw new Error("Sensor not connected.");
    return c;
  }

  /**
   * Write raw bytes to the Command characteristic (write with response).
   * The firmware can't fail the write (NimBLE has no ATT 0x80): it notifies Status after every
   * command, with error_code=3 if the command was invalid (protocol, round 2). Rejects in that case.
   * @param {Uint8Array} bytes
   * @returns {Promise<void>}
   */
  sendCommand(bytes) {
    return this.#serial(async () => {
      const c = this.#requireChar("command");
      const reply = this.#nextStatus(COMMAND_REPLY_MS);
      try {
        if (c.writeValueWithResponse) await c.writeValueWithResponse(bytes);
        else await c.writeValue(bytes);
      } catch (e) {
        reply.cancel();
        throw commandRejected(/** @type {any} */ (e)?.message ?? String(e));
      }
      const st = await reply.promise;
      if (st?.errorCode === ERROR_BAD_COMMAND) throw commandRejected("not valid in this state");
    });
  }

  /**
   * Resolves with the next Status notification, or null after `ms` (older firmware: no reply).
   * @param {number} ms
   * @returns {{promise: Promise<DeviceStatus|null>, cancel: () => void}}
   */
  #nextStatus(ms) {
    /** @type {() => void} */
    let cancel = () => {};
    const promise = new Promise((resolve) => {
      const timer = setTimeout(() => { off(); resolve(null); }, ms);
      const off = this.on("status", (st) => { clearTimeout(timer); off(); resolve(st); });
      cancel = () => { clearTimeout(timer); off(); resolve(null); };
    });
    return { promise, cancel };
  }

  /** @returns {Promise<void>} */
  async startSet() { await this.sendCommand(encodeStartSet()); }

  /** @returns {Promise<void>} */
  async stopSet() { await this.sendCommand(encodeStopSet()); }

  /** @returns {Promise<void>} */
  async tare() { await this.sendCommand(encodeTare()); }

  /** @param {number} pct @returns {Promise<void>} */
  async setThreshold(pct) { await this.sendCommand(encodeSetThreshold(pct)); }

  /** @param {boolean} on @returns {Promise<void>} */
  async setBeep(on) { await this.sendCommand(encodeSetBeep(on)); }

  /**
   * Ask the device to resend reps from `fromRep` (1-based) of `setId` (WA-14).
   * Replies arrive through the "rep" event.
   * @param {number} setId
   * @param {number} fromRep
   * @returns {Promise<void>}
   */
  async requestReps(setId, fromRep) { await this.sendCommand(encodeRequestReps(setId, fromRep)); }

  /** @returns {Promise<void>} */
  async requestStatus() { await this.sendCommand(encodeRequestStatus()); }
}
