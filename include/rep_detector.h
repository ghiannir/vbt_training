// Segmentazione delle ripetizioni: fermo -> movimento -> fermo. Puro C++.
// Non calcola velocita': consegna il segmento di accelerazione verticale, poi ci pensa metrics.h.
#pragma once
#include <stddef.h>
#include <stdint.h>

// Decide se il sensore e' fermo guardando accelerazione e giroscopio.
class StillDetector {
 public:
  StillDetector();
  void reset();
  // accMagG = |acc| in g, gyroMagDps = |gyro| in dps. Ritorna true se fermo da almeno STILL_MIN_MS.
  bool update(float accMagG, float gyroMagDps, uint32_t t_us);
  bool isStill() const;
};

// Un movimento completo isolato dal detector.
struct RepSegment {
  const float* aUp = nullptr;  // accelerazione verticale m/s^2, valida fino alla prossima update()
  size_t n = 0;
  uint32_t startUs = 0;  // timestamp del primo campione
  uint32_t endUs = 0;
};

class RepDetector {
 public:
  RepDetector();
  void reset();

  // Da chiamare a ogni campione. aUp in m/s^2, still da StillDetector.
  // Ritorna true quando un movimento valido e' appena finito; il segmento e' in lastSegment().
  bool update(uint32_t t_us, float aUp, bool still);

  bool inMotion() const;
  const RepSegment& lastSegment() const;
};
