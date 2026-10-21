// Tipi condivisi. Nessuna dipendenza da Arduino/M5: compilabile sul PC (env native).
#pragma once
#include <stdint.h>

struct Vec3 {
  float x = 0, y = 0, z = 0;
};

// Un campione IMU gia' convertito in unita' fisiche.
struct ImuSample {
  uint32_t t_us = 0;  // timestamp monotono in microsecondi
  Vec3 acc;           // accelerazione in g (1 g = 9.81 m/s^2), assi del sensore
  Vec3 gyro;          // velocita' angolare in gradi/s, assi del sensore
};

struct Quaternion {
  float w = 1, x = 0, y = 0, z = 0;
};

// Tipo di alzata: determina quale fase viene per prima.
enum class LiftType : uint8_t {
  EccentricFirst,  // squat, panca: scendo e poi spingo
  ConcentricFirst  // stacco da terra: parto subito in salita
};
