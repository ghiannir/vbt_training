#include "velocity.h"

void LiveVelocity::reset() { v_ = z_ = 0; }

float LiveVelocity::update(float aUp, float dt, bool still) {
  if (still) {
    v_ = 0;  // ZUPT
  } else {
    v_ += aUp * dt;
    z_ += v_ * dt;
  }
  return v_;
}

float LiveVelocity::velocity() const { return v_; }
float LiveVelocity::height() const { return z_; }

IntegratedRep integrateWithDriftCorrection(const float* aUp, size_t n, float dt, float* vel, float* pos) {
  IntegratedRep r;
  r.n = n;
  if (n == 0) return r;

  // Velocita' con la regola dei trapezi
  vel[0] = 0;
  for (size_t i = 1; i < n; i++) vel[i] = vel[i - 1] + 0.5f * (aUp[i - 1] + aUp[i]) * dt;
  r.residualVel = vel[n - 1];

  // La rep finisce da fermo: la velocita' finale deve essere 0. Si toglie la deriva come rampa lineare.
  if (n > 1) {
    for (size_t i = 0; i < n; i++) vel[i] -= r.residualVel * (float)i / (float)(n - 1);
  }

  pos[0] = 0;
  for (size_t i = 1; i < n; i++) pos[i] = pos[i - 1] + 0.5f * (vel[i - 1] + vel[i]) * dt;
  return r;
}
