// Tunable parameters. All values are a starting point to tune with real data (step 3/7).
#pragma once
#include <stdint.h>
#include "types.h"

namespace cfg {

// --- IMU ---
constexpr int IMU_RATE_HZ = 400;  // sampling rate
constexpr float ACC_RANGE_G = 16.0f;
constexpr float GYRO_RANGE_DPS = 2000.0f;
constexpr float GRAVITY_MS2 = 9.81f;

// --- Calibration at rest ---
constexpr uint32_t CALIB_MS = 1500;          // duration (1-2 s)
constexpr float CALIB_MAX_GYRO_DPS = 5.0f;   // above: the device is moving, calibration rejected
constexpr float CALIB_MAX_ACC_DEV_G = 0.05f; // |acc| must stay within 1 g +- this value

// --- Orientation filter (Madgwick) ---
constexpr float MADGWICK_BETA = 0.1f;  // higher = trusts the accelerometer more

// --- "Still" detection ---
constexpr float STILL_ACC_DEV_G = 0.03f;  // ||acc|-1g| below this threshold ...
constexpr float STILL_GYRO_DPS = 8.0f;    // ... and |gyro| below this => still
constexpr uint32_t STILL_MIN_MS = 150;    // still for at least this long = at rest (end of rep / ZUPT)

// --- Rep detection ---
constexpr uint32_t REP_MIN_MS = 300;    // shorter movements are discarded
constexpr uint32_t REP_MAX_MS = 6000;   // above: rep discarded
constexpr float REP_MIN_ROM_M = 0.15f;  // minimum range of motion of the concentric phase
constexpr float CONC_MIN_VEL_MS = 0.05f;           // velocity above which we are "in the concentric"
constexpr float LOW_QUALITY_RESIDUAL_MS = 0.15f;   // corrected drift above this => low-quality flag

// --- Set ---
constexpr uint8_t DEFAULT_VLOSS_THRESHOLD_PCT = 20;  // 0 = disabled
constexpr uint32_t SET_IDLE_TIMEOUT_MS = 60000;      // no rep for this long => set closed
constexpr LiftType DEFAULT_LIFT = LiftType::EccentricFirst;

// --- UI / audio / power ---
constexpr uint32_t DISPLAY_SLEEP_MS = 30000;  // turns the screen off after inactivity
constexpr uint32_t DEEP_SLEEP_MS = 600000;    // powers everything off after inactivity in IDLE
constexpr uint8_t BEEP_VOLUME = 128;          // 0..255
constexpr uint16_t BEEP_REP_HZ = 1800;
constexpr uint16_t BEEP_LOSS_HZ = 600;

// --- BLE ---
constexpr uint32_t LIVE_PERIOD_MS = 100;
constexpr uint32_t STATUS_PERIOD_MS = 30000;

}  // namespace cfg
