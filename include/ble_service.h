// Server BLE (libreria da scegliere allo step 5, es. NimBLE-Arduino). Contratto: docs/ble-protocol.md.
// Dipende dall'hardware: non va nei test native.
#pragma once
#include <stddef.h>
#include <functional>
#include "ble_protocol.h"

class BleService {
 public:
  // Chiamato quando l'app scrive un comando. args contiene 0..3 byte. Ritorna false se non valido
  // (il servizio risponde allora con errore ATT 0x80).
  using CommandHandler = std::function<bool(ble::Opcode op, const uint8_t* args, size_t len)>;

  // Avvia GATT e advertising con nome "VBT-XXXX".
  void begin(CommandHandler onCommand);

  bool connected() const;

  // Ognuna aggiorna il valore "read" e, se c'e' un client iscritto, manda la notifica.
  void notifyRep(const ble::RepPayload& p);
  void notifyStatus(const ble::StatusPayload& p);
  void notifySummary(const ble::SummaryPayload& p);
  void notifyLive(const ble::LivePayload& p);
};
