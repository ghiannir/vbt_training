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
 * One point per distinct load: best-rep MCV of the sets at that load.
 * Sets with null load or no reps are ignored (WA-64).
 * @param {VbtSet[]} sets
 * @returns {LvPoint[]}  sorted by load ascending
 */
export function pointsFromSets(sets) {
  throw new Error("not implemented");
}

/**
 * Ordinary least squares v = a + b * load. Throws if fewer than 3 distinct loads
 * (WA-60) or if all loads are equal.
 * @param {LvPoint[]} points
 * @returns {LvFit}
 */
export function fitLinear(points) {
  throw new Error("not implemented");
}

/**
 * Load at which the fitted line reaches the minimum velocity threshold.
 * Throws if slope >= 0 (WA-62).
 * @param {LvFit} fit
 * @param {number} mvt
 * @returns {number} kg
 */
export function loadAtVelocity(fit, mvt) {
  throw new Error("not implemented");
}

/**
 * Expected velocity at a given load (WA-65).
 * @param {LvFit} fit
 * @param {number} loadKg
 * @returns {number} m/s
 */
export function velocityAtLoad(fit, loadKg) {
  throw new Error("not implemented");
}

/**
 * Full pipeline: fit + 1RM at mvt + uncertainty + warnings.
 * @param {LvPoint[]} points
 * @param {number} mvt
 * @returns {OneRmEstimate}
 */
export function estimateOneRm(points, mvt) {
  throw new Error("not implemented");
}
