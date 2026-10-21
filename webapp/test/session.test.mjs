import { test } from "node:test";
import assert from "node:assert/strict";
import { velocityLossPct, setStats, thresholdReached, SessionTracker } from "../js/session.js";

let t;
const mk = (opts = {}) => {
  t = 1_700_000_000_000;
  return new SessionTracker({ exercise: "squat", thresholdPct: 20, now: () => t, ...opts });
};
const rep = (setId, repIndex, mcv, extra = {}) => ({
  setId, repIndex, mcv, peak: mcv * 1.5, rom: 0.5, concDuration: 0.7, repDuration: 1.6,
  velocityLossPct: 0, thresholdExceeded: false, newBest: false, lowQuality: false,
  tMs: repIndex * 2000, ...extra,
});

test("velocityLossPct contract formula", () => {
  assert.equal(velocityLossPct(0.64, 0.64), 0);
  assert.equal(velocityLossPct(0.612, 0.64), 4); // 4.375
  assert.equal(velocityLossPct(0.5, 0.64), 22); // 21.875
  assert.equal(velocityLossPct(0, 0.64), 100);
  assert.equal(velocityLossPct(0.7, 0.64), 0); // mcv above best: clamped
  assert.equal(velocityLossPct(0.5, 0), 0); // no division by zero
});

test("velocityLossPct rounds half up exactly (integer mm/s)", () => {
  assert.equal(velocityLossPct(0.995, 1.0), 1); // 0.5 -> 1
  assert.equal(velocityLossPct(0.9, 1.0), 10);
  assert.equal(velocityLossPct(0.805, 1.0), 20); // 19.5 -> 20
  assert.equal(velocityLossPct(0.8, 1.0), 20);
  assert.equal(velocityLossPct(0.804, 1.0), 20); // 19.6
  assert.equal(velocityLossPct(0.8051, 1.0), 20);
});

test("thresholdReached uses >= and 0 disables", () => {
  assert.ok(thresholdReached(20, 20));
  assert.ok(!thresholdReached(19, 20));
  assert.ok(!thresholdReached(50, 0));
});

test("setStats", () => {
  assert.deepEqual(setStats([]), { repCount: 0, bestMcv: 0, meanMcv: 0, lastVelocityLossPct: 0, maxVelocityLossPct: 0 });
  const tr = mk();
  tr.addRep(rep(1, 1, 0.6));
  tr.addRep(rep(1, 2, 0.5));
  const st = setStats(tr.currentSet.reps);
  assert.equal(st.repCount, 2);
  assert.equal(st.bestMcv, 0.6);
  assert.ok(Math.abs(st.meanMcv - 0.55) < 1e-12);
  assert.equal(st.lastVelocityLossPct, 17);
  assert.equal(st.maxVelocityLossPct, 17);
});

test("rep auto-creates session and set; local loss includes current rep in best", () => {
  const tr = mk();
  const a = tr.addRep(rep(1, 1, 0.6));
  assert.ok(a.added);
  assert.equal(a.rep.velocityLossPctLocal, 0);
  assert.equal(a.gapFrom, null);
  assert.equal(tr.session.sets.length, 1);
  const b = tr.addRep(rep(1, 2, 0.7)); // new best -> 0
  assert.equal(b.rep.velocityLossPctLocal, 0);
  const c = tr.addRep(rep(1, 3, 0.63));
  assert.equal(c.rep.velocityLossPctLocal, 10);
  assert.equal(tr.currentSet.exercise, "squat");
  assert.equal(tr.currentSet.thresholdPct, 20);
});

test("dedupe by (deviceSetId, repIndex)", () => {
  const tr = mk();
  tr.addRep(rep(1, 1, 0.6));
  const dup = tr.addRep(rep(1, 1, 0.6));
  assert.equal(dup.added, false);
  assert.equal(dup.alarm, false);
  assert.equal(tr.currentSet.reps.length, 1);
});

test("alarm fires once per set at first crossing (>= threshold)", () => {
  const tr = mk();
  assert.ok(!tr.addRep(rep(1, 1, 1.0)).alarm);
  assert.ok(!tr.addRep(rep(1, 2, 0.81)).alarm); // 19%
  const x = tr.addRep(rep(1, 3, 0.8)); // exactly 20%
  assert.ok(x.alarm && x.exceeded);
  const y = tr.addRep(rep(1, 4, 0.7));
  assert.ok(!y.alarm && y.exceeded); // exceeded still reported, alarm only once
  tr.endSet(2);
  tr.startSet(2);
  tr.addRep(rep(2, 1, 1.0));
  assert.ok(tr.addRep(rep(2, 2, 0.7)).alarm); // new set re-arms
});

test("firmware flag alone triggers exceeded; threshold 0 never triggers locally", () => {
  const tr = mk();
  tr.addRep(rep(1, 1, 1.0));
  const r = tr.addRep(rep(1, 2, 0.95, { thresholdExceeded: true }));
  assert.ok(r.alarm && r.exceeded);
  const tr2 = mk({ thresholdPct: 0 });
  tr2.addRep(rep(1, 1, 1.0));
  assert.ok(!tr2.addRep(rep(1, 2, 0.3)).exceeded);
});

test("gap detection and replay fill", () => {
  const tr = mk();
  tr.addRep(rep(1, 1, 0.6));
  const g = tr.addRep(rep(1, 4, 0.55));
  assert.equal(g.gapFrom, 2);
  const f2 = tr.addRep(rep(1, 2, 0.58));
  const f3 = tr.addRep(rep(1, 3, 0.57));
  assert.ok(f2.added && f3.added);
  assert.equal(f2.gapFrom, null);
  assert.equal(f3.alarm, false); // replayed old rep never alarms
  assert.deepEqual(tr.currentSet.reps.map((r) => r.repIndex), [1, 2, 3, 4]);
});

test("gap at the start (joined mid-set)", () => {
  const tr = mk();
  const g = tr.addRep(rep(1, 3, 0.6));
  assert.equal(g.gapFrom, 1);
});

test("replay recomputes local loss in order", () => {
  const tr = mk();
  tr.addRep(rep(1, 2, 0.5));
  tr.addRep(rep(1, 1, 1.0)); // best arrives late
  const reps = tr.currentSet.reps;
  assert.deepEqual(reps.map((r) => r.repIndex), [1, 2]);
  assert.equal(reps[0].velocityLossPctLocal, 0);
  assert.equal(reps[1].velocityLossPctLocal, 50);
});

test("replay into a closed set of the same epoch", () => {
  const tr = mk();
  tr.startSet(1);
  tr.addRep(rep(1, 1, 0.6));
  tr.endSet(0);
  tr.startSet(2);
  const r = tr.addRep(rep(1, 2, 0.55));
  assert.ok(r.added);
  assert.equal(r.set.deviceSetId, 1);
  assert.equal(tr.session.sets.length, 2);
  assert.equal(tr.currentSet.deviceSetId, 2);
});

test("explicit startSet is idempotent for the same open set and closes the previous", () => {
  const tr = mk();
  const s1 = tr.startSet(1);
  assert.equal(tr.startSet(1), s1);
  const s2 = tr.startSet(2);
  assert.notEqual(s1, s2);
  assert.notEqual(s1.endedAt, null);
  assert.equal(tr.currentSet, s2);
});

test("set_id wrap 255 -> 1 is not a reboot", () => {
  const tr = mk();
  tr.startSet(255);
  tr.addRep(rep(255, 1, 0.6));
  tr.endSet(0);
  tr.startSet(1);
  assert.equal(tr.epoch, 0);
});

test("reboot (lower set_id) starts a new epoch and does not dedupe against old sets", () => {
  const tr = mk();
  tr.startSet(5);
  tr.addRep(rep(5, 1, 0.6));
  tr.endSet(0);
  assert.equal(tr.noteDeviceSetId(1), true);
  assert.equal(tr.epoch, 1);
  const r = tr.addRep(rep(1, 1, 0.7));
  assert.ok(r.added);
  assert.equal(r.set.epoch, 1);
  // a set 1 from before the reboot must not swallow the new set 1
  const tr2 = mk();
  tr2.addRep(rep(1, 1, 0.6));
  tr2.endSet(0);
  tr2.addRep(rep(3, 1, 0.6));
  tr2.endSet(0);
  assert.ok(tr2.noteDeviceSetId(1)); // from Status
  const r2 = tr2.addRep(rep(1, 1, 0.65));
  assert.ok(r2.added);
  assert.equal(tr2.session.sets.length, 3);
});

test("reboot closes the open set", () => {
  const tr = mk();
  tr.startSet(4);
  const open = tr.currentSet;
  tr.noteDeviceSetId(1);
  assert.notEqual(open.endedAt, null);
  assert.equal(tr.currentSet, null);
});

test("load, exercise, threshold apply to current set and to the next", () => {
  const tr = mk();
  tr.setLoad(100);
  const s = tr.startSet(1);
  assert.equal(s.loadKg, 100);
  tr.setLoad(102.5);
  assert.equal(s.loadKg, 102.5);
  tr.setExercise("bench");
  tr.setThreshold(30);
  assert.equal(s.exercise, "bench");
  assert.equal(s.thresholdPct, 30);
  tr.endSet(1);
  assert.equal(s.stopReason, 1);
  assert.equal(tr.setLastSetLoad(105), s);
  assert.equal(s.loadKg, 105);
  const s2 = tr.startSet(2);
  assert.equal(s2.loadKg, 105);
  assert.equal(s2.exercise, "bench");
  assert.equal(s2.thresholdPct, 30);
});

test("session idles out after 3 h and endSession closes", () => {
  const tr = mk();
  const first = tr.session;
  tr.startSet(1);
  tr.endSet(0);
  t += 3 * 3600_000 + 1;
  tr.startSet(2);
  assert.notEqual(tr.session.id, first.id);
  assert.notEqual(first.endedAt, null);
  const s = tr.session;
  const ended = tr.endSession();
  assert.equal(ended, s);
  assert.notEqual(ended.endedAt, null);
  assert.equal(tr.currentSet, null);
  assert.notEqual(tr.session.id, s.id);
});

test("session does not idle out while a set is open", () => {
  const tr = mk();
  const first = tr.session;
  tr.startSet(1);
  t += 4 * 3600_000;
  assert.equal(tr.session.id, first.id);
});

test("restore resumes an open set with dedupe and without a stale alarm", () => {
  const tr = mk();
  tr.addRep(rep(7, 1, 1.0));
  tr.addRep(rep(7, 2, 0.7)); // alarm fired
  const saved = JSON.parse(JSON.stringify(tr.session));
  const tr2 = mk();
  tr2.restore(saved);
  assert.equal(tr2.currentSet.deviceSetId, 7);
  assert.ok(!tr2.addRep(rep(7, 2, 0.7)).added);
  assert.ok(!tr2.addRep(rep(7, 3, 0.6)).alarm);
  assert.equal(tr2.epoch, 0);
});

test("markLost flags the set", () => {
  const tr = mk();
  tr.startSet(1);
  tr.markLost();
  assert.equal(tr.currentSet.lostReps, true);
});
