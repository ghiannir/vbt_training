// @ts-check
// Load-velocity profile and 1RM estimate. Pure functions (WA-60..WA-65).

/** @typedef {import("./session.js").VbtSet} VbtSet */

/** Default minimum velocity thresholds (m/s) at 1RM, by exercise key (WA-62). */
export const DEFAULT_MVT = Object.freeze({
  squat: 0.30,
  bench: 0.17,
  deadlift: 0.15,
  press: 0.20,
  generic: 0.25,
});

/**
 * @typedef {Object} LvPoint
 * @property {number} loadKg
 * @property {number} velocity  m/s, best-rep MCV for that load.
 */

/**
 * @typedef {Object} LvFit
 * @property {number} intercept   a in v = a + b * load (m/s)
 * @property {number} slope       b (m/s per kg, normally negative)
 * @property {number} r2
 * @property {number} n           number of points
 * @property {number} stdError    standard error of the estimate (m/s)
 */

/**
 * @typedef {Object} OneRmEstimate
 * @property {number} oneRmKg
 * @property {number} lowKg      simple uncertainty interval
 * @property {number} highKg
 * @property {number} mvt        threshold used
 * @property {LvFit} fit
 * @property {string[]} warnings  e.g. "R2 < 0.90", "range < 15 kg"
 */

/**
 * MVT for an exercise: user override first, then the default, then generic.
 * @param {string} exercise
 * @param {Record<string, number>} [overrides]
 * @returns {number} m/s
 */
export function mvtForExercise(exercise, overrides = {}) {
  const pick = (/** @type {Record<string, number>} */ o) =>
    Object.prototype.hasOwnProperty.call(o, exercise) && Number.isFinite(o[exercise]) ? o[exercise] : null;
  return pick(overrides) ?? pick(DEFAULT_MVT) ?? overrides.generic ?? DEFAULT_MVT.generic;
}

/**
 * One point per distinct load: best-rep MCV of the sets at that load.
 * Sets with null load or no reps are ignored (WA-64).
 * @param {VbtSet[]} sets
 * @returns {LvPoint[]}  sorted by load ascending
 */
export function pointsFromSets(sets) {
  /** @type {Map<number, number>} */
  const byLoad = new Map();
  for (const s of sets) {
    if (s.loadKg === null || s.loadKg === undefined || !Number.isFinite(s.loadKg) || s.loadKg <= 0) continue;
    if (!s.reps || s.reps.length === 0) continue;
    let best = 0;
    for (const r of s.reps) if (r.mcv > best) best = r.mcv;
    if (best <= 0) continue;
    const prev = byLoad.get(s.loadKg);
    if (prev === undefined || best > prev) byLoad.set(s.loadKg, best);
  }
  return [...byLoad.entries()]
    .map(([loadKg, velocity]) => ({ loadKg, velocity }))
    .sort((a, b) => a.loadKg - b.loadKg);
}

/**
 * Ordinary least squares v = a + b * load. Throws if fewer than 3 distinct loads
 * (WA-60) or if all loads are equal.
 * @param {LvPoint[]} points
 * @returns {LvFit}
 */
export function fitLinear(points) {
  const distinct = new Set(points.map((p) => p.loadKg)).size;
  if (distinct < 3) throw new Error("Dati insufficienti: servono almeno 3 carichi distinti");
  const n = points.length;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.loadKg;
    sy += p.velocity;
  }
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of points) {
    const dx = p.loadKg - mx;
    const dy = p.velocity - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  let ssRes = 0;
  for (const p of points) {
    const e = p.velocity - (intercept + slope * p.loadKg);
    ssRes += e * e;
  }
  const r2 = syy === 0 ? 0 : Math.max(0, 1 - ssRes / syy);
  const stdError = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
  return { intercept, slope, r2, n, stdError };
}

/**
 * Load at which the fitted line reaches the minimum velocity threshold.
 * Throws if slope >= 0 (WA-62).
 * @param {LvFit} fit
 * @param {number} mvt
 * @returns {number} kg
 */
export function loadAtVelocity(fit, mvt) {
  if (!(fit.slope < 0)) throw new Error("Pendenza non negativa: stima impossibile");
  return (mvt - fit.intercept) / fit.slope;
}

/**
 * Expected velocity at a given load (WA-65).
 * @param {LvFit} fit
 * @param {number} loadKg
 * @returns {number} m/s
 */
export function velocityAtLoad(fit, loadKg) {
  return fit.intercept + fit.slope * loadKg;
}

/**
 * Full pipeline: fit + 1RM at mvt + uncertainty + warnings.
 * The interval is oneRm +- stdError / |slope|, i.e. the velocity scatter of the
 * regression converted to kg (a simple, not a statistical-prediction, interval).
 * @param {LvPoint[]} points
 * @param {number} mvt
 * @returns {OneRmEstimate}
 */
export function estimateOneRm(points, mvt) {
  const fit = fitLinear(points);
  const oneRmKg = loadAtVelocity(fit, mvt);
  const half = fit.stdError / Math.abs(fit.slope);
  /** @type {string[]} */
  const warnings = [];
  if (fit.r2 < 0.9) warnings.push("R2 < 0.90: relazione carico-velocita' poco lineare");
  const loads = points.map((p) => p.loadKg);
  if (Math.max(...loads) - Math.min(...loads) < 15) warnings.push("Intervallo di carichi < 15 kg: stima poco affidabile");
  if (new Set(loads).size < 4) warnings.push("Meno di 4 carichi: stima poco affidabile");
  const maxLoad = Math.max(...loads);
  if (oneRmKg < maxLoad) warnings.push("1RM stimato inferiore al carico massimo provato");
  return { oneRmKg, lowKg: oneRmKg - half, highKg: oneRmKg + half, mvt, fit, warnings };
}
