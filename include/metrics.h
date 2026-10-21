// Per-rep and per-set metrics. Pure C++.
#pragma once
#include <stdint.h>
#include "rep_detector.h"
#include "types.h"

struct RepMetrics {
  bool valid = false;       // false = not a rep (ROM too small, duration out of bounds...)
  bool lowQuality = false;  // very large corrected drift: doubtful estimate
  float mcvMs = 0;          // mean concentric velocity, m/s
  float peakMs = 0;         // peak concentric velocity, m/s
  float romM = 0;           // range of motion of the concentric phase, m
  uint32_t concMs = 0;      // concentric phase duration
  uint32_t repMs = 0;       // total duration
};

// Integrates the segment (velocity.h), finds the concentric phase (v > CONC_MIN_VEL_MS) and computes the metrics.
RepMetrics computeRepMetrics(const RepSegment& seg, LiftType lift);

// Accumulated state of a set.
class SetTracker {
 public:
  void start(uint8_t thresholdPct);
  void setThreshold(uint8_t pct);

  struct Result {
    uint8_t repIndex = 0;
    uint8_t velocityLossPct = 0;  // (best - mcv) / best * 100 on the MCV of the current rep
    bool isBest = false;
    bool thresholdExceeded = false;
  };

  // Records a valid rep and returns the velocity loss relative to the best one.
  Result addRep(const RepMetrics& m);

  uint8_t repCount() const;
  float bestMcvMs() const;
  float meanMcvMs() const;

 private:
  uint8_t threshold_ = 0;
  uint8_t count_ = 0;
  float best_ = 0, sum_ = 0;
};
