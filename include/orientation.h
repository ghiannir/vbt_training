// Madgwick orientation filter (6-axis IMU). Pure C++, testable on the PC.
#pragma once
#include "types.h"

class Madgwick {
 public:
  explicit Madgwick(float beta);

  // Resets the orientation to "at rest, z up" and clears the state.
  void reset();

  // Sets the initial orientation from the mean gravity direction measured at rest (in g).
  void initFromGravity(const Vec3& accAtRest);

  // Updates with one sample. dt in seconds. acc in g, gyro in degrees/s (sensor axes).
  void update(const Vec3& acc, const Vec3& gyro, float dt);

  Quaternion quaternion() const;

  // Rotates a vector from the sensor frame to the earth frame (z = up).
  Vec3 toEarth(const Vec3& v) const;

  // Linear vertical acceleration in m/s^2 (positive upward), gravity subtracted.
  float verticalAccel(const Vec3& accG) const;

  // Gravity magnitude measured at rest (in g): compensates the accelerometer scale error.
  void setGravityG(float g) { gravityG_ = g; }
  void setBeta(float beta) { beta_ = beta; }

 private:
  float beta_;
  float gravityG_ = 1.0f;
  Quaternion q_;
};
