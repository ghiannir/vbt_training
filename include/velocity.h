// Integration of the vertical acceleration with ZUPT correction. Pure C++.
#pragma once
#include <stddef.h>

// "Live" estimate during movement: just integrates, no correction.
// Used only for the display indicator; resets to zero when the sensor is still (ZUPT).
class LiveVelocity {
 public:
  void reset();
  // aUp in m/s^2 (gravity already removed), still = sensor at rest. Returns the velocity in m/s.
  float update(float aUp, float dt, bool still);
  float velocity() const;
  float height() const;  // vertical displacement since the last reset, in m

 private:
  float v_ = 0, z_ = 0;
};

// Result of integrating an already finished rep.
struct IntegratedRep {
  size_t n = 0;
  float residualVel = 0;  // final velocity before correction (m/s): a measure of the drift
};

// Integrates aUp[0..n) (m/s^2, step dt) into vel[] (m/s) and pos[] (m), starting from v=0 and z=0.
// Then removes the linear drift so that vel[n-1] = 0 (the rep is assumed to end at rest).
// vel and pos must have room for n elements.
IntegratedRep integrateWithDriftCorrection(const float* aUp, size_t n, float dt, float* vel, float* pos);
