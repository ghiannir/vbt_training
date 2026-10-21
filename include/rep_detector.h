// Rep segmentation: still -> movement -> still. Pure C++.
// Does not compute velocity: it hands over the vertical acceleration segment, then metrics.h takes over.
#pragma once
#include <stddef.h>
#include <stdint.h>

// Decides whether the sensor is still by looking at acceleration and gyroscope.
class StillDetector {
 public:
  StillDetector();
  void reset();
  // accMagG = |acc| in g, gyroMagDps = |gyro| in dps. Returns true if still for at least STILL_MIN_MS.
  bool update(float accMagG, float gyroMagDps, uint32_t t_us);
  bool isStill() const;

 private:
  uint32_t quietSince_ = 0;
  bool quiet_ = false;  // current sample below the thresholds
  bool still_ = false;
};

// A complete movement isolated by the detector.
struct RepSegment {
  const float* aUp = nullptr;  // vertical acceleration m/s^2, valid until the next update()
  size_t n = 0;
  uint32_t startUs = 0;  // timestamp of the first sample
  uint32_t endUs = 0;
};

class RepDetector {
 public:
  RepDetector();
  void reset();

  // Call for every sample. aUp in m/s^2, still from StillDetector.
  // Returns true when a valid movement has just finished; the segment is in lastSegment().
  bool update(uint32_t t_us, float aUp, bool still);

  bool inMotion() const;
  const RepSegment& lastSegment() const;

  // Samples kept before the movement starts ("still" triggers with a bit of delay).
  static constexpr size_t PREROLL = 40;        // 100 ms at 400 Hz
  static constexpr size_t MAX_SAMPLES = 2600;  // REP_MAX_MS at 400 Hz + margin

 private:
  float buf_[MAX_SAMPLES];
  size_t n_ = 0;
  float pre_[PREROLL];
  size_t preN_ = 0, preHead_ = 0;
  uint32_t startUs_ = 0;
  bool moving_ = false;
  bool armed_ = false;  // a movement counts only if the sensor was still before
  bool overflow_ = false;
  RepSegment seg_;
};
