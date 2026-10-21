// Integrazione dell'accelerazione verticale con correzione ZUPT. Puro C++.
#pragma once
#include <stddef.h>

// Stima "live" durante il movimento: integra e basta, nessuna correzione.
// Serve solo per l'indicatore sul display; si azzera quando il sensore e' fermo (ZUPT).
class LiveVelocity {
 public:
  void reset();
  // aUp in m/s^2 (gravita' gia' tolta), still = sensore fermo. Ritorna la velocita' in m/s.
  float update(float aUp, float dt, bool still);
  float velocity() const;
  float height() const;  // spostamento verticale dall'ultimo reset, in m

 private:
  float v_ = 0, z_ = 0;
};

// Risultato dell'integrazione di una rep gia' conclusa.
struct IntegratedRep {
  size_t n = 0;
  float residualVel = 0;  // velocita' finale prima della correzione (m/s): misura del drift
};

// Integra aUp[0..n) (m/s^2, passo dt) in vel[] (m/s) e pos[] (m), partendo da v=0 e z=0.
// Poi toglie la deriva lineare in modo che vel[n-1] = 0 (si assume che la rep finisca da fermo).
// vel e pos devono avere spazio per n elementi.
IntegratedRep integrateWithDriftCorrection(const float* aUp, size_t n, float dt, float* vel, float* pos);
