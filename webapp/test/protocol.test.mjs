import { test } from "node:test";
import assert from "node:assert/strict";
import * as P from "../js/protocol.js";

/** @param {string} hex */
const view = (hex) => {
  const bytes = Uint8Array.from(hex.trim().split(/\s+/).map((h) => parseInt(h, 16)));
  return new DataView(bytes.buffer);
};
const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, "0")).join(" ").toUpperCase();

test("Rep test vector", () => {
  const r = P.decodeRep(view("01 03 64 02 F2 03 E0 01 0C 03 72 06 08 00 39 30 00 00"));
  assert.deepEqual(r, {
    setId: 1, repIndex: 3, mcv: 0.612, peak: 1.01, rom: 0.48,
    concDuration: 0.78, repDuration: 1.65, velocityLossPct: 8,
    thresholdExceeded: false, newBest: false, lowQuality: false, tMs: 12345,
  });
});

test("Rep flags and u32 t_ms", () => {
  const r = P.decodeRep(view("FF 0A 00 00 00 00 00 00 00 00 00 00 00 07 FF FF FF FF"));
  assert.equal(r.setId, 255);
  assert.equal(r.repIndex, 10);
  assert.ok(r.thresholdExceeded && r.newBest && r.lowQuality);
  assert.equal(r.tMs, 0xffffffff);
});

test("Status test vector", () => {
  const s = P.decodeStatus(view("01 03 57 06 01 03 14 00 80 02 08 00"));
  assert.deepEqual(s, {
    protoVersion: 1, state: P.State.SET_ACTIVE, batteryPct: 87,
    charging: false, beepOn: true, calibrationValid: true,
    setId: 1, repCount: 3, thresholdPct: 20, errorCode: 0,
    bestMcv: 0.64, lastVelocityLossPct: 8,
  });
});

test("Status charging flag", () => {
  const s = P.decodeStatus(view("01 02 10 01 01 00 00 00 00 00 00 00"));
  assert.ok(s.charging);
  assert.ok(!s.beepOn);
});

test("SetSummary test vector", () => {
  const s = P.decodeSetSummary(view("01 05 02 15 80 02 4E 02 26 00 00 00"));
  assert.deepEqual(s, {
    setId: 1, repCount: 5, stopReason: P.StopReason.THRESHOLD,
    finalVelocityLossPct: 21, bestMcv: 0.64, meanMcv: 0.59, durationS: 38,
  });
});

test("Live test vector (signed values)", () => {
  const l = P.decodeLive(view("5E 01 88 FF"));
  assert.equal(l.velocity, 0.35);
  assert.equal(l.displacement, -0.12);
});

test("decoders reject short payloads", () => {
  assert.throws(() => P.decodeRep(view("01 03 64")));
  assert.throws(() => P.decodeStatus(view("01 03 57 06 01 03 14 00 80 02 08")));
  assert.throws(() => P.decodeSetSummary(view("01 05 02")));
  assert.throws(() => P.decodeLive(view("5E 01 88")));
});

test("decoders accept longer payloads", () => {
  const r = P.decodeRep(view("01 03 64 02 F2 03 E0 01 0C 03 72 06 08 00 39 30 00 00 AA BB"));
  assert.equal(r.tMs, 12345);
});

test("encoders", () => {
  assert.equal(hex(P.encodeStartSet()), "01");
  assert.equal(hex(P.encodeStopSet()), "02");
  assert.equal(hex(P.encodeTare()), "03");
  assert.equal(hex(P.encodeSetThreshold(25)), "04 19");
  assert.equal(hex(P.encodeSetThreshold(0)), "04 00");
  assert.equal(hex(P.encodeSetBeep(true)), "05 01");
  assert.equal(hex(P.encodeSetBeep(false)), "05 00");
  assert.equal(hex(P.encodeRequestReps(1, 4)), "06 01 04");
  assert.equal(hex(P.encodeRequestStatus()), "07");
});

test("encoder range checks", () => {
  for (const bad of [1, 4, 61, 100, 7.5, -1, NaN]) assert.throws(() => P.encodeSetThreshold(bad), RangeError);
  assert.doesNotThrow(() => P.encodeSetThreshold(5));
  assert.doesNotThrow(() => P.encodeSetThreshold(60));
  assert.throws(() => P.encodeRequestReps(0, 1), RangeError);
  assert.throws(() => P.encodeRequestReps(1, 0), RangeError);
  assert.throws(() => P.encodeRequestReps(256, 1), RangeError);
});

test("constants match the contract", () => {
  assert.equal(P.PROTOCOL_VERSION, 1);
  assert.equal(P.SERVICE_UUID, "b972a2b5-fe5d-481c-8293-5ad78d77ae5e");
  assert.equal(P.CHAR_UUID.rep, "89826146-e413-4d2a-9c5b-7882e6d4973c");
  assert.equal(P.CHAR_UUID.status, "74fe761a-78be-41fd-b4aa-d75e861395db");
  assert.equal(P.CHAR_UUID.command, "19407613-018f-4ad7-a1f9-9170de45328e");
  assert.equal(P.CHAR_UUID.setSummary, "1bea91e2-4768-45a9-8498-f412cba0add8");
  assert.equal(P.CHAR_UUID.live, "8e3b1485-73ca-4dd1-b16a-0b3da91237f2");
  assert.deepEqual({ ...P.SIZE }, { rep: 18, status: 12, setSummary: 12, live: 4 });
});
