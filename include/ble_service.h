// BLE server using NimBLE-Arduino. Contract: docs/ble-protocol.md.
// Hardware-dependent: not for the native tests.
#pragma once
#include <stddef.h>
#include <functional>
#include "ble_protocol.h"

class BleService {
 public:
  // Called by poll() for every command written by the app. args holds 0..3 bytes.
  // Returns false if invalid: NimBLE cannot answer with ATT error 0x80,
  // so the caller reports it with error_code=3 in Status.
  using CommandHandler = std::function<bool(ble::Opcode op, const uint8_t* args, size_t len)>;

  // Starts GATT and advertising with the name "VBT-XXXX".
  void begin(CommandHandler onCommand);

  // Call from the loop: runs the received commands (they arrive on the BLE task, here they move to the loop).
  void poll();

  bool connected() const;
  // true once per new connection: the caller refreshes the Status value.
  bool takeNewConnection();
  const char* name() const;

  // Each one updates the "read" value and, if a client is subscribed, sends the notification.
  void notifyRep(const ble::RepPayload& p);
  void notifyStatus(const ble::StatusPayload& p);
  void notifySummary(const ble::SummaryPayload& p);
  void notifyLive(const ble::LivePayload& p);
};
