// BMI270 letto direttamente dai registri: M5Unified lo lascia a 100 Hz e +-8 g,
// qui lo portiamo a cfg::IMU_RATE_HZ, +-16 g e +-2000 dps (FW-01).
// I campioni passano dalla FIFO del sensore, cosi' display e seriale non ne fanno perdere.
#include "imu.h"

#include <M5Unified.h>

#include "config.h"

namespace {

constexpr uint8_t REG_CHIP_ID = 0x00;   // vale 0x24 sul BMI270
constexpr uint8_t REG_FIFO_LENGTH = 0x24;  // 2 byte, 14 bit
constexpr uint8_t REG_FIFO_DATA = 0x26;
constexpr uint8_t REG_ACC_CONF = 0x40;
constexpr uint8_t REG_ACC_RANGE = 0x41;
constexpr uint8_t REG_GYR_CONF = 0x42;
constexpr uint8_t REG_GYR_RANGE = 0x43;
constexpr uint8_t REG_FIFO_CONFIG_0 = 0x48;
constexpr uint8_t REG_FIFO_CONFIG_1 = 0x49;
constexpr uint8_t REG_PWR_CTRL = 0x7D;
constexpr uint8_t REG_CMD = 0x7E;
constexpr uint8_t CMD_FIFO_FLUSH = 0xB0;

constexpr uint32_t I2C_FREQ = 400000;
constexpr int FIFO_BYTES = 6144;

static_assert(cfg::IMU_RATE_HZ == 400, "ODR_CODE va aggiornato insieme a cfg::IMU_RATE_HZ");
constexpr uint8_t ODR_CODE = 0x0A;  // 400 Hz

// filter_perf | bwp normale | ODR
constexpr uint8_t ACC_CONF = 0x80 | 0x20 | ODR_CODE;
// filter_perf | noise_perf | bwp normale | ODR
constexpr uint8_t GYR_CONF = 0x80 | 0x40 | 0x20 | ODR_CODE;
constexpr uint8_t ACC_RANGE_16G = 0x03;
constexpr uint8_t GYR_RANGE_2000 = 0x00;
// FIFO senza header con gyr + acc: ogni frame e' gyr x,y,z poi acc x,y,z
constexpr uint8_t FIFO_GYR_ACC_HEADERLESS = 0x80 | 0x40;

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
  M5.In_I2C.writeRegister8(addr_, REG_FIFO_CONFIG_0, 0x00, I2C_FREQ);  // stream: se piena sovrascrive
  M5.In_I2C.writeRegister8(addr_, REG_FIFO_CONFIG_1, FIFO_GYR_ACC_HEADERLESS, I2C_FREQ);
  delay(50);
  M5.In_I2C.writeRegister8(addr_, REG_CMD, CMD_FIFO_FLUSH, I2C_FREQ);
  t0_us_ = micros();
  count_ = 0;
  bufFrames_ = bufPos_ = 0;

  return M5.In_I2C.readRegister8(addr_, REG_ACC_RANGE, I2C_FREQ) == ACC_RANGE_16G;
}

bool Imu::fillFromFifo() {
  uint8_t len[2];
  if (!M5.In_I2C.readRegister(addr_, REG_FIFO_LENGTH, len, 2, I2C_FREQ)) return false;
  int bytes = (len[0] | (len[1] << 8)) & 0x3FFF;
  if (bytes >= FIFO_BYTES - 2 * FRAME_BYTES) {
    // FIFO (quasi) piena: probabilmente ha sovrascritto dati. Si svuota e si conta il buco.
    M5.In_I2C.writeRegister8(addr_, REG_CMD, CMD_FIFO_FLUSH, I2C_FREQ);
    uint32_t expected = (micros() - t0_us_) / PERIOD_US;
    if (expected > count_) {
      dropped_ += expected - count_;
      count_ = expected;
    }
    return false;
  }
  int frames = bytes / FRAME_BYTES;
  if (frames == 0) return false;
  if (frames > BUF_FRAMES) frames = BUF_FRAMES;
  if (!M5.In_I2C.readRegister(addr_, REG_FIFO_DATA, buf_, frames * FRAME_BYTES, I2C_FREQ)) return false;
  bufFrames_ = frames;
  bufPos_ = 0;
  return true;
}

bool Imu::read(ImuSample& out) {
  if (bufPos_ >= bufFrames_ && !fillFromFifo()) return false;

  const uint8_t* f = buf_ + bufPos_ * FRAME_BYTES;
  bufPos_++;
  out.t_us = t0_us_ + count_ * PERIOD_US;
  count_++;
  out.gyro = {le16(f + 0) * GYR_RES, le16(f + 2) * GYR_RES, le16(f + 4) * GYR_RES};
  out.acc = {le16(f + 6) * ACC_RES, le16(f + 8) * ACC_RES, le16(f + 10) * ACC_RES};
  return true;
}

uint32_t Imu::droppedSamples() const {
  uint32_t d = dropped_;
  dropped_ = 0;
  return d;
}
