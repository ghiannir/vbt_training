// Server BLE con NimBLE-Arduino. Contratto: docs/ble-protocol.md.
// Dipende dall'hardware: non va nei test native.
#pragma once
#include <stddef.h>
#include <functional>
#include "ble_protocol.h"

class BleService {
 public:
  // Chiamato da poll() per ogni comando scritto dall'app. args contiene 0..3 byte.
  // Ritorna false se non valido: NimBLE non permette di rispondere con errore ATT 0x80,
  // quindi il chiamante lo segnala con error_code=3 in Status.
  using CommandHandler = std::function<bool(ble::Opcode op, const uint8_t* args, size_t len)>;

  // Avvia GATT e advertising con nome "VBT-XXXX".
  void begin(CommandHandler onCommand);

  // Da chiamare nel loop: esegue i comandi ricevuti (arrivano dal task BLE, qui si passa al loop).
  void poll();

  bool connected() const;
  // true una volta per ogni nuova connessione: il chiamante aggiorna il valore di Status.
  bool takeNewConnection();
  const char* name() const;

  // Ognuna aggiorna il valore "read" e, se c'e' un client iscritto, manda la notifica.
  void notifyRep(const ble::RepPayload& p);
  void notifyStatus(const ble::StatusPayload& p);
  void notifySummary(const ble::SummaryPayload& p);
  void notifyLive(const ble::LivePayload& p);
};
