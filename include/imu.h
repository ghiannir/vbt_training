// Lettura del BMI270 tramite M5Unified. Dipende dall'hardware: non va nei test native.
#pragma once
#include "types.h"

class Imu {
 public:
  // Inizializza l'IMU a IMU_RATE_HZ, +-16 g, +-2000 dps. Ritorna false se non risponde.
  bool begin();

  // Se c'e' un nuovo campione lo scrive in out e ritorna true. Non blocca.
  // Il timestamp (micros) e' preso il piu' vicino possibile alla lettura.
  bool read(ImuSample& out);

  // Campioni persi dall'ultima chiamata (buchi nei timestamp > 1.5 periodi): per diagnostica.
  uint32_t droppedSamples() const;
};

// Risultato della calibrazione a riposo.
struct Calibration {
  bool ok = false;
  Vec3 gravityG;   // direzione media dell'accelerazione a riposo (g, assi sensore)
  Vec3 gyroBias;   // offset medio del giroscopio (dps) da sottrarre
};

// Accumula campioni a riposo per CALIB_MS e calcola la calibrazione. Puro C++ (nessun accesso hardware).
class Calibrator {
 public:
  void start();
  // Ritorna true quando ha finito (guarda result().ok per l'esito; fallisce se il dispositivo si muove).
  bool update(const ImuSample& s);
  uint8_t progressPct() const;
  const Calibration& result() const;
};
