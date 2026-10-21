import { test } from "node:test";
import assert from "node:assert/strict";
import * as S from "../js/storage.js";

const mkRep = (i, mcv) => ({
  setId: 1, repIndex: i, mcv, peak: mcv * 1.6, rom: 0.512, concDuration: 0.75, repDuration: 1.6,
  velocityLossPct: i === 2 ? 8 : 0, thresholdExceeded: false, newBest: i === 1, lowQuality: false,
  tMs: i * 2000, receivedAt: 0, velocityLossPctLocal: 0,
});
const mkSet = (id, sessionId, exercise, loadKg, startedAt) => ({
  id, sessionId, deviceSetId: 1, startedAt, endedAt: startedAt + 30000, exercise, loadKg,
  thresholdPct: 20, reps: [mkRep(1, 0.6), mkRep(2, 0.552)], stopReason: 0, lostReps: false, epoch: 0,
});
const mkSession = (id, startedAt, sets) => ({ id, startedAt, endedAt: null, sets });
const A = () => mkSession("a", 1_700_000_000_000, [
  mkSet("a1", "a", "squat", 100, 1_700_000_000_000),
  mkSet("a2", "a", "bench", null, 1_700_000_100_000),
]);
const B = () => mkSession("b", 1_700_100_000_000, [mkSet("b1", "b", 'pull, "up"', 60, 1_700_100_000_000)]);

test("CSV: header, one row per rep, values", () => {
  const lines = S.sessionsToCsv([A()]).trimEnd().split("\n");
  assert.equal(lines[0], "date,session,exercise,load_kg,set,rep,mcv_mps,peak_mps,rom_m,conc_s,vloss_pct");
  assert.equal(lines.length, 1 + 4);
  assert.equal(lines[1], "2023-11-14T22:13:20.000Z,a,squat,100,1,1,0.600,0.960,0.512,0.750,0");
  assert.equal(lines[2].split(",")[5], "2");
  assert.equal(lines[2].split(",")[10], "8");
  // null load -> empty cell; set index is 2
  assert.match(lines[3], /^[^,]+,a,bench,,2,1,/);
});

test("CSV: escaping and empty input", () => {
  const csv = S.sessionsToCsv([B()]);
  assert.ok(csv.includes('"pull, ""up"""'));
  assert.equal(S.sessionsToCsv([]), S.CSV_HEADER + "\n");
});

test("backup roundtrip through JSON", () => {
  const b = S.buildBackup([A(), B()], S.defaultSettings(), 123);
  assert.equal(b.schemaVersion, S.SCHEMA_VERSION);
  const back = S.parseBackup(JSON.stringify(b));
  assert.deepEqual(back.sessions, b.sessions);
  assert.equal(back.exportedAt, 123);
  assert.deepEqual(back.settings, S.defaultSettings());
});

test("parseBackup rejects garbage and newer schemas", () => {
  assert.throws(() => S.parseBackup("not json"), /non valido/);
  assert.throws(() => S.parseBackup("{}"), /non valido/);
  assert.throws(() => S.parseBackup({ schemaVersion: 1, sessions: [{ id: 1, sets: [] }] }), /non valido/);
  assert.throws(() => S.parseBackup({ sessions: [] }), /schemaVersion/);
  assert.throws(() => S.parseBackup({ schemaVersion: S.SCHEMA_VERSION + 1, sessions: [] }), /recente/);
});

test("parseBackup migrates sparse older data without losing it", () => {
  const old = {
    schemaVersion: 1,
    sessions: [{ id: "x", startedAt: 5, sets: [{ id: "s", exercise: "squat", startedAt: 5, reps: [mkRep(1, 0.5)] }] }],
  };
  const b = S.parseBackup(old);
  const set = b.sessions[0].sets[0];
  assert.equal(set.sessionId, "x");
  assert.equal(set.loadKg, null);
  assert.equal(set.reps.length, 1);
  assert.equal(b.sessions[0].endedAt, null);
});

test("settings defaults and merge", () => {
  const d = S.defaultSettings();
  assert.equal(d.thresholdPct, 20);
  assert.equal(d.loadStepKg, 2.5);
  assert.deepEqual(d.minVelocityThreshold, { squat: 0.30, bench: 0.17, deadlift: 0.15, press: 0.20, generic: 0.25 });
  const m = S.mergeSettings({
    thresholdPct: 30, soundOn: "yes", minVelocityThreshold: { squat: 0.28, junk: "x" }, lastBackupAt: 99,
  });
  assert.equal(m.thresholdPct, 30);
  assert.equal(m.soundOn, true); // wrong type ignored
  assert.equal(m.minVelocityThreshold.squat, 0.28);
  assert.equal(m.minVelocityThreshold.bench, 0.17);
  assert.ok(!("junk" in m.minVelocityThreshold));
  assert.equal(m.lastBackupAt, 99);
  assert.deepEqual(S.mergeSettings(null), d);
});

test("loadSettings/saveSettings tolerate missing localStorage", () => {
  assert.deepEqual(S.loadSettings(), S.defaultSettings());
  assert.doesNotThrow(() => S.saveSettings({ thresholdPct: 25 }));
});

test("daysSinceBackup", () => {
  assert.equal(S.daysSinceBackup(null), null);
  assert.equal(S.daysSinceBackup(0, 8 * 86400000 + 5), 8);
});

test("memory store: put/get/list/delete, newest first", async () => {
  const st = S.createMemoryStore();
  assert.equal(st.persistent, false);
  await st.putSession(A());
  await st.putSession(B());
  assert.deepEqual((await st.listSessions()).map((s) => s.id), ["b", "a"]);
  assert.equal((await st.getSession("a")).sets.length, 2);
  assert.equal(await st.getSession("zzz"), null);
  await st.deleteSession("a");
  assert.deepEqual((await st.listSessions()).map((s) => s.id), ["b"]);
});

test("memory store: draft overwrite, exercises, setsByExercise", async () => {
  const st = new S.Store();
  const a = A();
  await st.putSession(a);
  a.sets[0].reps.push(mkRep(3, 0.5));
  await st.putSession(a);
  assert.equal((await st.getSession("a")).sets[0].reps.length, 3);
  await st.putSession(B());
  assert.deepEqual(await st.listExercises(), ["bench", 'pull, "up"', "squat"]);
  const sq = await st.setsByExercise("squat");
  assert.equal(sq.length, 1);
  assert.equal(sq[0].loadKg, 100);
});

test("import merges without duplicates", async () => {
  const src = S.createMemoryStore();
  await src.putSession(A());
  await src.putSession(B());
  const backup = await src.exportBackup();
  const dst = S.createMemoryStore();
  await dst.putSession(A());
  const res = await dst.importBackup(JSON.parse(JSON.stringify(backup)));
  assert.deepEqual(res, { sessionsAdded: 1, sessionsSkipped: 1 });
  assert.equal((await dst.listSessions()).length, 2);
  assert.deepEqual(await dst.importBackup(backup), { sessionsAdded: 0, sessionsSkipped: 2 });
});

test("openStore falls back to memory without indexedDB", async () => {
  const st = await S.openStore();
  assert.equal(st.persistent, false);
  await st.putSession(A());
  assert.equal((await st.listSessions()).length, 1);
});

test("requestPersistence returns false without navigator.storage", async () => {
  assert.equal(await S.requestPersistence(), false);
});
