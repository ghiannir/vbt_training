// Metriche per ripetizione e per serie. Puro C++.
#pragma once
#include <stdint.h>
#include "rep_detector.h"
#include "types.h"

struct RepMetrics {
  bool valid = false;       // false = non e' una rep (ROM troppo piccolo, durata fuori limiti...)
  bool lowQuality = false;  // drift corretto molto grande: stima dubbia
  float mcvMs = 0;          // velocita' media concentrica, m/s
  float peakMs = 0;         // velocita' di picco concentrica, m/s
  float romM = 0;           // escursione della fase concentrica, m
  uint32_t concMs = 0;      // durata fase concentrica
  uint32_t repMs = 0;       // durata totale
};

// Integra il segmento (velocity.h), individua la fase concentrica (v > CONC_MIN_VEL_MS) e calcola le metriche.
RepMetrics computeRepMetrics(const RepSegment& seg, LiftType lift);

// Stato accumulato di una serie.
class SetTracker {
 public:
  void start(uint8_t thresholdPct);
  void setThreshold(uint8_t pct);

  struct Result {
    uint8_t repIndex = 0;
    uint8_t velocityLossPct = 0;  // (best - mcv) / best * 100 sull'MCV della rep corrente
    bool isBest = false;
    bool thresholdExceeded = false;
  };

  // Registra una rep valida e ritorna la perdita di velocita' rispetto alla migliore.
  Result addRep(const RepMetrics& m);

  uint8_t repCount() const;
  float bestMcvMs() const;
  float meanMcvMs() const;
};
