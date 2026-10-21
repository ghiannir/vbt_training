// Full sample -> rep chain: still detection, orientation, velocity, segmentation, metrics.
// Pure C++: used by both the firmware and tools/replay.cpp on the PC.
#pragma once
#include "config.h"
#include "metrics.h"
#include "orientation.h"
#include "rep_detector.h"
#include "types.h"
#include "velocity.h"

class VbtPipeline {
 public:
  VbtPipeline();
  void reset();

  // Call for every IMU sample. Returns true when a valid rep has finished (see lastRep()).
  bool update(const ImuSample& s);

  bool isStill() const { return still_.isStill(); }
  float liveVelocity() const { return live_.velocity(); }
  float gravityG() const { return gravityG_; }
  const RepMetrics& lastRep() const { return rep_; }

  LiftType lift = cfg::DEFAULT_LIFT;

 private:
  Madgwick ahrs_;
  StillDetector still_;
  RepDetector reps_;
  LiveVelocity live_;
  RepMetrics rep_;
  float gravityG_ = 1.0f;  // magnitude of |acc| at rest, updated at every still period
  bool initialized_ = false;
};
