// Log CSV dei campioni grezzi su USB seriale (firmware/REQUIREMENTS.md, sezione 6).
#include "logger.h"

#include <Arduino.h>

#include "config.h"

void RawLogger::begin() {
  Serial.printf("# VBT raw v1 rate_hz=%d acc_fs_g=%d gyro_fs_dps=%d units=g,dps\n", cfg::IMU_RATE_HZ,
                (int)cfg::ACC_RANGE_G, (int)cfg::GYRO_RANGE_DPS);
  Serial.println("t_us,ax,ay,az,gx,gy,gz");
}

void RawLogger::logSample(const ImuSample& s) {
  // Senza un PC che legge, il buffer USB si riempie: meglio perdere righe di log che bloccare il ciclo.
  if (Serial.availableForWrite() < 64) return;
  Serial.printf("%lu,%.4f,%.4f,%.4f,%.2f,%.2f,%.2f\n", (unsigned long)s.t_us, s.acc.x, s.acc.y, s.acc.z,
                s.gyro.x, s.gyro.y, s.gyro.z);
}

void RawLogger::mark(const char* label) {
  Serial.printf("#%s,%lu\n", label, (unsigned long)micros());
}
