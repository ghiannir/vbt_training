// Filtro di Madgwick per IMU a 6 assi (S. Madgwick, 2010), in float.
// Convenzione: v_terra = q * v_sensore * q^-1, con z terra verso l'alto.
#include "orientation.h"

#include <math.h>

#include "config.h"

namespace {
constexpr float DEG2RAD = 0.017453292519943295f;

float invSqrt(float x) { return 1.0f / sqrtf(x); }
}  // namespace

Madgwick::Madgwick(float beta) : beta_(beta) {}

void Madgwick::reset() { q_ = Quaternion(); }

void Madgwick::initFromGravity(const Vec3& a) {
  // Rotazione piu' corta che porta la gravita' misurata sull'asse z terra.
  float n = sqrtf(a.x * a.x + a.y * a.y + a.z * a.z);
  if (n < 1e-6f) return reset();
  float x = a.x / n, y = a.y / n, z = a.z / n;
  if (z < -0.9999f) {  // sottosopra: rotazione di 180 gradi attorno a x
    q_ = {0, 1, 0, 0};
    return;
  }
  float w = 1.0f + z;
  float k = invSqrt(w * w + y * y + x * x);
  q_ = {w * k, y * k, -x * k, 0};
}

void Madgwick::update(const Vec3& acc, const Vec3& gyro, float dt) {
  float q0 = q_.w, q1 = q_.x, q2 = q_.y, q3 = q_.z;
  float gx = gyro.x * DEG2RAD, gy = gyro.y * DEG2RAD, gz = gyro.z * DEG2RAD;

  float qDot1 = 0.5f * (-q1 * gx - q2 * gy - q3 * gz);
  float qDot2 = 0.5f * (q0 * gx + q2 * gz - q3 * gy);
  float qDot3 = 0.5f * (q0 * gy - q1 * gz + q3 * gx);
  float qDot4 = 0.5f * (q0 * gz + q1 * gy - q2 * gx);

  float ax = acc.x, ay = acc.y, az = acc.z;
  float an = ax * ax + ay * ay + az * az;
  if (an > 1e-6f) {
    float r = invSqrt(an);
    ax *= r;
    ay *= r;
    az *= r;

    float _2q0 = 2 * q0, _2q1 = 2 * q1, _2q2 = 2 * q2, _2q3 = 2 * q3;
    float _4q0 = 4 * q0, _4q1 = 4 * q1, _4q2 = 4 * q2;
    float _8q1 = 8 * q1, _8q2 = 8 * q2;
    float q0q0 = q0 * q0, q1q1 = q1 * q1, q2q2 = q2 * q2, q3q3 = q3 * q3;

    // Gradiente dell'errore tra gravita' stimata e misurata
    float s0 = _4q0 * q2q2 + _2q2 * ax + _4q0 * q1q1 - _2q1 * ay;
    float s1 = _4q1 * q3q3 - _2q3 * ax + 4 * q0q0 * q1 - _2q0 * ay - _4q1 + _8q1 * q1q1 + _8q1 * q2q2 + _4q1 * az;
    float s2 = 4 * q0q0 * q2 + _2q0 * ax + _4q2 * q3q3 - _2q3 * ay - _4q2 + _8q2 * q1q1 + _8q2 * q2q2 + _4q2 * az;
    float s3 = 4 * q1q1 * q3 - _2q1 * ax + 4 * q2q2 * q3 - _2q2 * ay;
    float sn = s0 * s0 + s1 * s1 + s2 * s2 + s3 * s3;
    if (sn > 1e-12f) {
      float k = invSqrt(sn);
      qDot1 -= beta_ * s0 * k;
      qDot2 -= beta_ * s1 * k;
      qDot3 -= beta_ * s2 * k;
      qDot4 -= beta_ * s3 * k;
    }
  }

  q0 += qDot1 * dt;
  q1 += qDot2 * dt;
  q2 += qDot3 * dt;
  q3 += qDot4 * dt;
  float k = invSqrt(q0 * q0 + q1 * q1 + q2 * q2 + q3 * q3);
  q_ = {q0 * k, q1 * k, q2 * k, q3 * k};
}

Quaternion Madgwick::quaternion() const { return q_; }

Vec3 Madgwick::toEarth(const Vec3& v) const {
  // v' = v + 2w (u x v) + 2 u x (u x v), con u = (x, y, z) del quaternione
  float w = q_.w, x = q_.x, y = q_.y, z = q_.z;
  float tx = 2 * (y * v.z - z * v.y);
  float ty = 2 * (z * v.x - x * v.z);
  float tz = 2 * (x * v.y - y * v.x);
  return {v.x + w * tx + (y * tz - z * ty), v.y + w * ty + (z * tx - x * tz), v.z + w * tz + (x * ty - y * tx)};
}

float Madgwick::verticalAccel(const Vec3& accG) const {
  return (toEarth(accG).z - gravityG_) * cfg::GRAVITY_MS2;
}
