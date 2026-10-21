// BMI270 letto direttamente dai registri: M5Unified lo lascia a 100 Hz e +-8 g,
// qui lo portiamo a cfg::IMU_RATE_HZ, +-16 g e +-2000 dps (FW-01).
#include "imu.h"

#include <M5Unified.h>

#include "config.h"

namespace {

constexpr uint8_t REG_CHIP_ID = 0x00;   // vale 0x24 sul BMI270
constexpr uint8_t REG_STATUS = 0x03;    // bit 7 drdy_acc, bit 6 drdy_gyr
constexpr uint8_t REG_DATA = 0x0C;      // acc x,y,z poi gyr x,y,z: 12 byte little-endian
constexpr uint8_t REG_ACC_CONF = 0x40;
constexpr uint8_t REG_ACC_RANGE = 0x41;
constexpr uint8_t REG_GYR_CONF = 0x42;
constexpr uint8_t REG_GYR_RANGE = 0x43;
constexpr uint8_t REG_PWR_CTRL = 0x7D;

constexpr uint32_t I2C_FREQ = 400000;

static_assert(cfg::IMU_RATE_HZ == 400, "ODR_CODE va aggiornato insieme a cfg::IMU_RATE_HZ");
constexpr uint8_t ODR_CODE = 0x0A;  // 400 Hz

// filter_perf | bwp normale | ODR
constexpr uint8_t ACC_CONF = 0x80 | 0x20 | ODR_CODE;
// filter_perf | noise_perf | bwp normale | ODR
constexpr uint8_t GYR_CONF = 0x80 | 0x40 | 0x20 | ODR_CODE;
constexpr uint8_t ACC_RANGE_16G = 0x03;
constexpr uint8_t GYR_RANGE_2000 = 0x00;

constexpr float ACC_RES = cfg::ACC_RANGE_G / 32768.0f;      // g per LSB
constexpr float GYR_RES = cfg::GYRO_RANGE_DPS / 32768.0f;   // dps per LSB
constexpr uint32_t PERIOD_US = 1000000 / cfg::IMU_RATE_HZ;

int16_t le16(const uint8_t* p) { return (int16_t)(p[0] | (p[1] << 8)); }

}  // namespace

bool Imu::begin() {
  // M5.begin() ha gia' caricato il firmware interno del BMI270: qui cambiamo solo la configurazione.
  if (!M5.Imu.isEnabled()) return false;

  for (uint8_t a : {0x68, 0x69}) {
    if (M5.In_I2C.readRegister8(a, REG_CHIP_ID, I2C_FREQ) == 0x24) {
      addr_ = a;
      break;
    }
  }
  if (addr_ == 0) return false;

  M5.In_I2C.writeRegister8(addr_, REG_ACC_CONF, ACC_CONF, I2C_FREQ);
  M5.In_I2C.writeRegister8(addr_, REG_ACC_RANGE, ACC_RANGE_16G, I2C_FREQ);
  M5.In_I2C.writeRegister8(addr_, REG_GYR_CONF, GYR_CONF, I2C_FREQ);
  M5.In_I2C.writeRegister8(addr_, REG_GYR_RANGE, GYR_RANGE_2000, I2C_FREQ);
  M5.In_I2C.writeRegister8(addr_, REG_PWR_CTRL, 0x0E, I2C_FREQ);  // temp | acc | gyr
  delay(50);

  return M5.In_I2C.readRegister8(addr_, REG_ACC_RANGE, I2C_FREQ) == ACC_RANGE_16G;
}

bool Imu::read(ImuSample& out) {
  uint8_t status = M5.In_I2C.readRegister8(addr_, REG_STATUS, I2C_FREQ);
  if ((status & 0x80) == 0) return false;  // nessun nuovo campione dell'accelerometro

  uint8_t buf[12];
  uint32_t t = micros();
  if (!M5.In_I2C.readRegister(addr_, REG_DATA, buf, sizeof(buf), I2C_FREQ)) return false;

  out.t_us = t;
  out.acc = {le16(buf + 0) * ACC_RES, le16(buf + 2) * ACC_RES, le16(buf + 4) * ACC_RES};
  out.gyro = {le16(buf + 6) * GYR_RES, le16(buf + 8) * GYR_RES, le16(buf + 10) * GYR_RES};

  if (lastT_us_ != 0) {
    uint32_t gap = t - lastT_us_;
    if (gap > PERIOD_US * 3 / 2) dropped_ += gap / PERIOD_US - 1;
  }
  lastT_us_ = t;
  return true;
}

uint32_t Imu::droppedSamples() const {
  uint32_t d = dropped_;
  dropped_ = 0;
  return d;
}
