// ST7789 135x240 display (portrait), buttons and beep. Uses M5Unified: not for the native tests.
#pragma once
#include <stdint.h>
#include "ble_protocol.h"
#include "metrics.h"

enum class Button : uint8_t { None, A_Short, A_Long, B_Short, B_Long };

class Ui {
 public:
  void begin();

  // Reads the buttons (call in the loop). Returns the event that occurred, or None.
  Button poll();

  // They redraw only if something changed (max ~10 Hz).
  void showIdle(uint8_t batteryPct, bool bleConnected);
  void showCalibrating(uint8_t progressPct);
  void showReady(uint8_t batteryPct, bool bleConnected, uint8_t thresholdPct);
  void showSetActive(uint8_t repCount, const RepMetrics& last, uint8_t velocityLossPct, float liveVelMs);
  void showSetDone(uint8_t repCount, float bestMcvMs, float meanMcvMs, uint8_t finalLossPct);
  void showError(ble::ErrorCode code);

  void beepRep();
  void beepThreshold();

  void sleepDisplay();
  void wakeDisplay();
};
