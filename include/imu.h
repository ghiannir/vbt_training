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

 private:
  // I campioni arrivano dalla FIFO del BMI270 (frame da 12 byte: gyr poi acc), letti a blocchi.
  static constexpr int FRAME_BYTES = 12;
  static constexpr int BUF_FRAMES = 16;

  bool fillFromFifo();

  uint8_t addr_ = 0;       // indirizzo I2C del BMI270 (0x68 o 0x69)
  uint8_t buf_[BUF_FRAMES * FRAME_BYTES];
  int bufFrames_ = 0, bufPos_ = 0;
  uint32_t t0_us_ = 0;     // istante del primo campione
  uint32_t count_ = 0;     // campioni emessi (o persi) da t0: il timestamp e' t0 + count * periodo
  mutable uint32_t dropped_ = 0;
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
