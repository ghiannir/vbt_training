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

 private:
  uint32_t quietSince_ = 0;
  bool quiet_ = false;  // campione corrente sotto le soglie
  bool still_ = false;
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

  // Campioni tenuti prima dell'inizio del movimento (il "fermo" scatta con un po' di ritardo).
  static constexpr size_t PREROLL = 40;        // 100 ms a 400 Hz
  static constexpr size_t MAX_SAMPLES = 2600;  // REP_MAX_MS a 400 Hz + margine

 private:
  float buf_[MAX_SAMPLES];
  size_t n_ = 0;
  float pre_[PREROLL];
  size_t preN_ = 0, preHead_ = 0;
  uint32_t startUs_ = 0;
  bool moving_ = false;
  bool armed_ = false;  // un movimento conta solo se prima il sensore era fermo
  bool overflow_ = false;
  RepSegment seg_;
};
