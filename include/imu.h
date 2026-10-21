// BMI270 readout through M5Unified. Hardware-dependent: not for the native tests.
#pragma once
#include "types.h"

class Imu {
 public:
  // Initializes the IMU at IMU_RATE_HZ, +-16 g, +-2000 dps. Returns false if it does not respond.
  bool begin();

  // If there is a new sample, writes it to out and returns true. Does not block.
  // The timestamp (micros) is taken as close as possible to the read.
  bool read(ImuSample& out);

  // Samples lost since the last call (timestamp gaps > 1.5 periods): for diagnostics.
  uint32_t droppedSamples() const;

 private:
  // Samples come from the BMI270 FIFO (12-byte frames: gyr then acc), read in blocks.
  static constexpr int FRAME_BYTES = 12;
  static constexpr int BUF_FRAMES = 16;

  bool fillFromFifo();

  uint8_t addr_ = 0;       // I2C address of the BMI270 (0x68 or 0x69)
  uint8_t buf_[BUF_FRAMES * FRAME_BYTES];
  int bufFrames_ = 0, bufPos_ = 0;
  uint32_t t0_us_ = 0;     // time of the first sample
  uint32_t count_ = 0;     // samples emitted (or lost) since t0: the timestamp is t0 + count * period
  mutable uint32_t dropped_ = 0;
};

// Result of the calibration at rest.
struct Calibration {
  bool ok = false;
  Vec3 gravityG;   // mean direction of acceleration at rest (g, sensor axes)
  Vec3 gyroBias;   // mean gyroscope offset (dps) to subtract
};

// Accumulates samples at rest for CALIB_MS and computes the calibration. Pure C++ (no hardware access).
class Calibrator {
 public:
  void start();
  // Returns true when done (check result().ok for the outcome; fails if the device moves).
  bool update(const ImuSample& s);
  uint8_t progressPct() const;
  const Calibration& result() const;
};
