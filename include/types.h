// Shared types. No dependency on Arduino/M5: compilable on the PC (native env).
#pragma once
#include <stdint.h>

struct Vec3 {
  float x = 0, y = 0, z = 0;
};

// An IMU sample already converted to physical units.
struct ImuSample {
  uint32_t t_us = 0;  // monotonic timestamp in microseconds
  Vec3 acc;           // acceleration in g (1 g = 9.81 m/s^2), sensor axes
  Vec3 gyro;          // angular velocity in degrees/s, sensor axes
};

struct Quaternion {
  float w = 1, x = 0, y = 0, z = 0;
};

// Lift type: determines which phase comes first.
enum class LiftType : uint8_t {
  EccentricFirst,  // squat, bench: go down, then push
  ConcentricFirst  // deadlift: start going up right away
};
