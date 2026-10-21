#include "metrics.h"

#include <math.h>

#include "config.h"
#include "velocity.h"

namespace {
constexpr float DT = 1.0f / cfg::IMU_RATE_HZ;
float velBuf[RepDetector::MAX_SAMPLES];
float posBuf[RepDetector::MAX_SAMPLES];
}  // namespace

RepMetrics computeRepMetrics(const RepSegment& seg, LiftType lift) {
  (void)lift;  // la ricerca della salita piu' ampia vale sia per squat/panca sia per stacco
  RepMetrics m;
  if (seg.n < 2) return m;
  IntegratedRep ir = integrateWithDriftCorrection(seg.aUp, seg.n, DT, velBuf, posBuf);

  // Fase concentrica = la salita piu' ampia: dal punto piu' basso al piu' alto che lo segue.
  size_t lowIdx = 0, bestLow = 0, bestHigh = 0;
  float bestRise = 0;
  for (size_t i = 1; i < seg.n; i++) {
    if (posBuf[i] < posBuf[lowIdx]) lowIdx = i;
    float rise = posBuf[i] - posBuf[lowIdx];
    if (rise > bestRise) {
      bestRise = rise;
      bestLow = lowIdx;
      bestHigh = i;
    }
  }

  m.repMs = (seg.endUs - seg.startUs) / 1000;
  m.lowQuality = fabsf(ir.residualVel) > cfg::LOW_QUALITY_RESIDUAL_MS;
  if (bestHigh <= bestLow) return m;

  // Dentro la salita: il picco di velocita', poi i bordi dove la velocita' scende sotto CONC_MIN_VEL_MS.
  // Cosi' i tratti quasi fermi in fondo e in cima non abbassano la media.
  size_t peakIdx = bestLow;
  for (size_t i = bestLow; i <= bestHigh; i++) {
    if (velBuf[i] > velBuf[peakIdx]) peakIdx = i;
  }
  size_t start = peakIdx, end = peakIdx;
  while (start > bestLow && velBuf[start - 1] > cfg::CONC_MIN_VEL_MS) start--;
  while (end < bestHigh && velBuf[end + 1] > cfg::CONC_MIN_VEL_MS) end++;
  if (end <= start) return m;

  m.peakMs = velBuf[peakIdx];
  m.romM = posBuf[end] - posBuf[start];
  m.concMs = (uint32_t)((end - start) * DT * 1000.0f);
  m.mcvMs = m.romM / ((end - start) * DT);
  m.valid = m.romM >= cfg::REP_MIN_ROM_M && m.concMs >= 100;
  return m;
}

void SetTracker::start(uint8_t thresholdPct) {
  threshold_ = thresholdPct;
  count_ = 0;
  best_ = sum_ = 0;
}

void SetTracker::setThreshold(uint8_t pct) { threshold_ = pct; }

SetTracker::Result SetTracker::addRep(const RepMetrics& m) {
  Result r;
  if (count_ < 255) count_++;
  r.repIndex = count_;
  sum_ += m.mcvMs;
  r.isBest = m.mcvMs >= best_;
  if (r.isBest) best_ = m.mcvMs;
  // Formula del contratto BLE: clamp(round((best - mcv) / best * 100), 0, 100), best include la rep corrente
  float loss = best_ > 0 ? roundf((best_ - m.mcvMs) / best_ * 100.0f) : 0;
  r.velocityLossPct = (uint8_t)(loss < 0 ? 0 : loss > 100 ? 100 : loss);
  r.thresholdExceeded = threshold_ > 0 && r.velocityLossPct >= threshold_;
  return r;
}

uint8_t SetTracker::repCount() const { return count_; }
float SetTracker::bestMcvMs() const { return best_; }
float SetTracker::meanMcvMs() const { return count_ ? sum_ / count_ : 0; }
