import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../js/lvprofile.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const set = (loadKg, mcvs) => ({ loadKg, reps: mcvs.map((mcv, i) => ({ repIndex: i + 1, mcv })) });
const pts = (pairs) => pairs.map(([loadKg, velocity]) => ({ loadKg, velocity }));

// v = 1.2 - 0.01 * load, exact
const exact = [60, 80, 100, 120].map((l) => ({ loadKg: l, velocity: 1.2 - 0.01 * l }));

test("fitLinear on exact line", () => {
  const f = L.fitLinear(exact);
  near(f.intercept, 1.2);
  near(f.slope, -0.01);
  near(f.r2, 1);
  near(f.stdError, 0);
  assert.equal(f.n, 4);
});

test("fitLinear with known noisy data", () => {
  // x=1..5, y=[2,4,5,4,5]: slope 0.6, intercept 2.2, r2 0.6, SSres 2.4
  const f = L.fitLinear(pts([[1, 2], [2, 4], [3, 5], [4, 4], [5, 5]]));
  near(f.slope, 0.6);
  near(f.intercept, 2.2);
  near(f.r2, 0.6);
  near(f.stdError, Math.sqrt(2.4 / 3));
});

test("fitLinear needs 3 distinct loads", () => {
  assert.throws(() => L.fitLinear(exact.slice(0, 2)));
  assert.throws(() => L.fitLinear(pts([[50, 1], [50, 0.9], [50, 0.8]])));
});

test("loadAtVelocity and velocityAtLoad", () => {
  const f = L.fitLinear(exact);
  near(L.loadAtVelocity(f, 0.3), 90);
  near(L.velocityAtLoad(f, 90), 0.3);
  near(L.velocityAtLoad(f, 0), 1.2);
});

test("loadAtVelocity rejects non-negative slope", () => {
  assert.throws(() => L.loadAtVelocity({ intercept: 0.5, slope: 0, r2: 0, n: 3, stdError: 0 }, 0.3));
  assert.throws(() => L.loadAtVelocity({ intercept: 0.5, slope: 0.01, r2: 1, n: 3, stdError: 0 }, 0.3));
});

test("estimateOneRm: exact data", () => {
  const e = L.estimateOneRm(exact, 0.3);
  near(e.oneRmKg, 90);
  near(e.lowKg, 90);
  near(e.highKg, 90);
  assert.equal(e.mvt, 0.3);
  assert.ok(!e.warnings.some((w) => w.startsWith("R2")));
  assert.ok(!e.warnings.some((w) => w.includes("15 kg")));
});

test("estimateOneRm warnings and interval", () => {
  const e = L.estimateOneRm(pts([[100, 0.8], [104, 0.6], [108, 0.7], [110, 0.5]]), 0.25);
  assert.ok(e.warnings.some((w) => w.includes("15 kg")));
  assert.ok(e.highKg > e.oneRmKg && e.lowKg < e.oneRmKg);
  near(e.highKg - e.oneRmKg, e.fit.stdError / Math.abs(e.fit.slope));
  const noisy = L.estimateOneRm(pts([[60, 0.9], [80, 0.5], [100, 0.8], [120, 0.4]]), 0.3);
  assert.ok(noisy.warnings.some((w) => w.startsWith("R2 < 0.90")));
});

test("estimateOneRm rejects insufficient data and positive slope", () => {
  assert.throws(() => L.estimateOneRm(exact.slice(0, 2), 0.3));
  const up = [60, 80, 100].map((l) => ({ loadKg: l, velocity: 0.3 + l / 1000 }));
  assert.throws(() => L.estimateOneRm(up, 0.3));
});

test("pointsFromSets: best rep per load, ignores null load and empty sets", () => {
  const out = L.pointsFromSets([
    set(100, [0.5, 0.6, 0.4]),
    set(100, [0.55]),
    set(80, [0.8, 0.7]),
    set(null, [0.9]),
    set(60, []),
    set(120, [0.3]),
  ]);
  assert.deepEqual(out, [
    { loadKg: 80, velocity: 0.8 },
    { loadKg: 100, velocity: 0.6 },
    { loadKg: 120, velocity: 0.3 },
  ]);
});

test("DEFAULT_MVT and mvtForExercise", () => {
  assert.deepEqual({ ...L.DEFAULT_MVT }, { squat: 0.30, bench: 0.17, deadlift: 0.15, press: 0.20, generic: 0.25 });
  assert.equal(L.mvtForExercise("squat"), 0.30);
  assert.equal(L.mvtForExercise("squat", { squat: 0.28 }), 0.28);
  assert.equal(L.mvtForExercise("curl"), 0.25);
  assert.equal(L.mvtForExercise("curl", { generic: 0.22 }), 0.22);
});
