// Filtro di orientamento Madgwick (IMU a 6 assi). Puro C++, testabile sul PC.
#pragma once
#include "types.h"

class Madgwick {
 public:
  explicit Madgwick(float beta);

  // Riporta l'orientamento a "fermo, z in alto" e azzera lo stato.
  void reset();

  // Imposta l'orientamento iniziale dalla direzione media della gravita' misurata a riposo (in g).
  void initFromGravity(const Vec3& accAtRest);

  // Aggiorna con un campione. dt in secondi. acc in g, gyro in gradi/s (assi sensore).
  void update(const Vec3& acc, const Vec3& gyro, float dt);

  Quaternion quaternion() const;

  // Ruota un vettore dal sistema sensore al sistema terra (z = su).
  Vec3 toEarth(const Vec3& v) const;

  // Accelerazione verticale lineare in m/s^2 (positiva verso l'alto), gravita' sottratta.
  float verticalAccel(const Vec3& accG) const;
};
