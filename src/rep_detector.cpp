#include "rep_detector.h"

#include <math.h>

#include "config.h"

namespace {
constexpr uint32_t PERIOD_US = 1000000 / cfg::IMU_RATE_HZ;
}

StillDetector::StillDetector() { reset(); }

void StillDetector::reset() {
  quiet_ = still_ = false;
  quietSince_ = 0;
}

bool StillDetector::update(float accMagG, float gyroMagDps, uint32_t t_us) {
  bool quiet = fabsf(accMagG - 1.0f) < cfg::STILL_ACC_DEV_G && gyroMagDps < cfg::STILL_GYRO_DPS;
  if (quiet && !quiet_) quietSince_ = t_us;
  quiet_ = quiet;
  still_ = quiet && (t_us - quietSince_) >= cfg::STILL_MIN_MS * 1000;
  return still_;
}

bool StillDetector::isStill() const { return still_; }

RepDetector::RepDetector() { reset(); }

void RepDetector::reset() {
  n_ = preN_ = preHead_ = 0;
  moving_ = armed_ = overflow_ = false;
  seg_ = RepSegment();
}

bool RepDetector::update(uint32_t t_us, float aUp, bool still) {
  if (!moving_) {
    if (still || !armed_) {
      armed_ = armed_ || still;
      pre_[preHead_] = aUp;
      preHead_ = (preHead_ + 1) % PREROLL;
      if (preN_ < PREROLL) preN_++;
      return false;
    }
    // Inizio movimento: si parte dai campioni fermi appena precedenti.
    moving_ = true;
    overflow_ = false;
    n_ = 0;
    for (size_t i = 0; i < preN_; i++) buf_[n_++] = pre_[(preHead_ + PREROLL - preN_ + i) % PREROLL];
    startUs_ = t_us - preN_ * PERIOD_US;
  }

  if (n_ < MAX_SAMPLES) {
    buf_[n_++] = aUp;
  } else {
    overflow_ = true;
  }
  if (!still) return false;

  // Di nuovo fermo da STILL_MIN_MS: movimento concluso.
  moving_ = false;
  preN_ = preHead_ = 0;
  seg_ = {buf_, n_, startUs_, t_us};
  uint32_t ms = (t_us - startUs_) / 1000;
  return !overflow_ && ms >= cfg::REP_MIN_MS && ms <= cfg::REP_MAX_MS;
}

bool RepDetector::inMotion() const { return moving_; }
const RepSegment& RepDetector::lastSegment() const { return seg_; }
