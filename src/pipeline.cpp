#include "pipeline.h"

#include <math.h>

#include "config.h"

namespace {
constexpr float DT = 1.0f / cfg::IMU_RATE_HZ;
constexpr float BETA_STILL = 0.5f;  // when still, trust the accelerometer to realign the vertical
constexpr float GRAVITY_EMA = 0.01f;

float norm(const Vec3& v) { return sqrtf(v.x * v.x + v.y * v.y + v.z * v.z); }
}  // namespace

VbtPipeline::VbtPipeline() : ahrs_(cfg::MADGWICK_BETA) {}

void VbtPipeline::reset() {
  ahrs_.reset();
  still_.reset();
  reps_.reset();
  live_.reset();
  rep_ = RepMetrics();
  gravityG_ = 1.0f;
  initialized_ = false;
}

bool VbtPipeline::update(const ImuSample& s) {
  float accMag = norm(s.acc);
  if (!initialized_) {
    ahrs_.initFromGravity(s.acc);
    gravityG_ = accMag;
    initialized_ = true;
  }

  bool still = still_.update(accMag / gravityG_, norm(s.gyro), s.t_us);
  if (still) gravityG_ += GRAVITY_EMA * (accMag - gravityG_);
  ahrs_.setGravityG(gravityG_);
  ahrs_.setBeta(still ? BETA_STILL : cfg::MADGWICK_BETA);
  ahrs_.update(s.acc, s.gyro, DT);

  float aUp = ahrs_.verticalAccel(s.acc);
  live_.update(aUp, DT, still);

  if (!reps_.update(s.t_us, aUp, still)) return false;
  rep_ = computeRepMetrics(reps_.lastSegment(), lift);
  return rep_.valid;
}
