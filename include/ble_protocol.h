// BLE protocol constants. Mirror of docs/ble-protocol.md: if you change one, change the other.
#pragma once
#include <stdint.h>

namespace ble {

constexpr uint8_t PROTO_VERSION = 1;
constexpr const char* NAME_PREFIX = "VBT-";  // full name: VBT-XXXX (last 2 bytes of the MAC)

constexpr const char* SERVICE_UUID = "b972a2b5-fe5d-481c-8293-5ad78d77ae5e";
constexpr const char* REP_UUID     = "89826146-e413-4d2a-9c5b-7882e6d4973c";  // notify, read
constexpr const char* STATUS_UUID  = "74fe761a-78be-41fd-b4aa-d75e861395db";  // notify, read
constexpr const char* COMMAND_UUID = "19407613-018f-4ad7-a1f9-9170de45328e";  // write
constexpr const char* SUMMARY_UUID = "1bea91e2-4768-45a9-8498-f412cba0add8";  // notify, read
constexpr const char* LIVE_UUID    = "8e3b1485-73ca-4dd1-b16a-0b3da91237f2";  // notify

constexpr uint8_t ATT_ERR_BAD_COMMAND = 0x80;
constexpr int REP_HISTORY = 64;  // reps kept in RAM for REQUEST_REPS

enum class DeviceState : uint8_t { Idle = 0, Calibrating, Ready, SetActive, SetDone, Error };
enum class ErrorCode : uint8_t { None = 0, Imu, CalibrationFailed, BadCommand };
enum class StopReason : uint8_t { Button = 0, App, VelocityLoss, Timeout };
enum class Opcode : uint8_t {
  StartSet = 0x01, StopSet = 0x02, Tare = 0x03, SetThreshold = 0x04,
  SetBeep = 0x05, RequestReps = 0x06, RequestStatus = 0x07
};

// Flag bits
constexpr uint8_t REP_FLAG_THRESHOLD = 1 << 0;
constexpr uint8_t REP_FLAG_BEST      = 1 << 1;
constexpr uint8_t REP_FLAG_LOW_QUAL  = 1 << 2;
constexpr uint8_t ST_FLAG_CHARGING   = 1 << 0;
constexpr uint8_t ST_FLAG_BEEP       = 1 << 1;
constexpr uint8_t ST_FLAG_CALIB_OK   = 1 << 2;

// Little-endian payloads, no padding: the ESP32-S3 is little-endian, so the struct is copied as-is.
#pragma pack(push, 1)
struct RepPayload {  // 18 B
  uint8_t set_id, rep_index;
  uint16_t mcv_mmps, peak_mmps, rom_mm, conc_ms, rep_ms;
  uint8_t vloss_pct, flags;
  uint32_t t_ms;
};
struct StatusPayload {  // 12 B
  uint8_t proto_version, state, battery_pct, flags, set_id, rep_count, vloss_thr_pct, error_code;
  uint16_t best_mcv_mmps;
  uint8_t last_vloss_pct, reserved;
};
struct SummaryPayload {  // 12 B
  uint8_t set_id, rep_count, stop_reason, final_vloss_pct;
  uint16_t best_mcv_mmps, mean_mcv_mmps, duration_s, reserved;
};
struct LivePayload {  // 4 B
  int16_t v_mmps, h_mm;
};
#pragma pack(pop)

static_assert(sizeof(RepPayload) == 18, "RepPayload must be 18 bytes");
static_assert(sizeof(StatusPayload) == 12, "StatusPayload must be 12 bytes");
static_assert(sizeof(SummaryPayload) == 12, "SummaryPayload must be 12 bytes");
static_assert(sizeof(LivePayload) == 4, "LivePayload must be 4 bytes");

}  // namespace ble
