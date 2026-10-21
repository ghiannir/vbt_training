// Parametri regolabili. Tutti i valori sono un punto di partenza da tarare con i dati reali (step 3/7).
#pragma once
#include <stdint.h>
#include "types.h"

namespace cfg {

// --- IMU ---
constexpr int IMU_RATE_HZ = 400;  // frequenza di campionamento
constexpr float ACC_RANGE_G = 16.0f;
constexpr float GYRO_RANGE_DPS = 2000.0f;
constexpr float GRAVITY_MS2 = 9.81f;

// --- Calibrazione a riposo ---
constexpr uint32_t CALIB_MS = 1500;          // durata (1-2 s)
constexpr float CALIB_MAX_GYRO_DPS = 5.0f;   // oltre: il dispositivo si muove, calibrazione rifiutata
constexpr float CALIB_MAX_ACC_DEV_G = 0.05f; // |acc| deve restare entro 1 g +- questo valore

// --- Filtro di orientamento (Madgwick) ---
constexpr float MADGWICK_BETA = 0.1f;  // piu' alto = si fida di piu' dell'accelerometro

// --- Rilevamento "fermo" ---
constexpr float STILL_ACC_DEV_G = 0.03f;  // ||acc|-1g| sotto questa soglia ...
constexpr float STILL_GYRO_DPS = 8.0f;    // ... e |gyro| sotto questa => fermo
constexpr uint32_t STILL_MIN_MS = 150;    // fermo per almeno tanto = riposo (fine rep / ZUPT)

// --- Rilevamento rep ---
constexpr uint32_t REP_MIN_MS = 300;    // movimenti piu' brevi sono scartati
constexpr uint32_t REP_MAX_MS = 6000;   // oltre: rep scartata
constexpr float REP_MIN_ROM_M = 0.15f;  // escursione minima della fase concentrica
constexpr float CONC_MIN_VEL_MS = 0.05f;           // velocita' sopra cui si e' "in concentrica"
constexpr float LOW_QUALITY_RESIDUAL_MS = 0.15f;   // drift corretto oltre questo => flag bassa qualita'

// --- Serie ---
constexpr uint8_t DEFAULT_VLOSS_THRESHOLD_PCT = 20;  // 0 = disattivata
constexpr uint32_t SET_IDLE_TIMEOUT_MS = 60000;      // nessuna rep per tanto => serie chiusa
constexpr LiftType DEFAULT_LIFT = LiftType::EccentricFirst;

// --- UI / audio / energia ---
constexpr uint32_t DISPLAY_SLEEP_MS = 30000;  // spegne lo schermo dopo inattivita'
constexpr uint32_t DEEP_SLEEP_MS = 600000;    // spegne tutto dopo inattivita' in IDLE
constexpr uint8_t BEEP_VOLUME = 128;          // 0..255
constexpr uint16_t BEEP_REP_HZ = 1800;
constexpr uint16_t BEEP_LOSS_HZ = 600;

// --- BLE ---
constexpr uint32_t LIVE_PERIOD_MS = 100;
constexpr uint32_t STATUS_PERIOD_MS = 30000;

}  // namespace cfg
