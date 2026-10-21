#include "ble_service.h"

#include <NimBLEDevice.h>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <string.h>

namespace {

struct Command {
  uint8_t len;
  uint8_t data[4];
};

QueueHandle_t commands;
BleService::CommandHandler handler;
NimBLECharacteristic *repChr, *statusChr, *commandChr, *summaryChr, *liveChr;
volatile bool isConnected = false;
volatile bool newConnection = false;
char deviceName[12];

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer*, NimBLEConnInfo&) override {
    isConnected = true;
    newConnection = true;
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    isConnected = false;
    NimBLEDevice::startAdvertising();  // one connection at a time, then become visible again
  }
};

class CommandCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic* chr, NimBLEConnInfo&) override {
    NimBLEAttValue v = chr->getValue();
    Command c{};
    c.len = v.length() > sizeof(c.data) ? sizeof(c.data) : v.length();
    memcpy(c.data, v.data(), c.len);
    xQueueSend(commands, &c, 0);  // queue full: the command is lost, the app retries
  }
};

ServerCallbacks serverCallbacks;
CommandCallbacks commandCallbacks;

template <typename T>
void setAndNotify(NimBLECharacteristic* chr, const T& p) {
  chr->setValue(reinterpret_cast<const uint8_t*>(&p), sizeof(p));
  if (isConnected) chr->notify();
}

}  // namespace

void BleService::begin(CommandHandler onCommand) {
  handler = onCommand;
  commands = xQueueCreate(8, sizeof(Command));

  NimBLEDevice::init("");
  const uint8_t* mac = NimBLEDevice::getAddress().getVal();  // little-endian: mac[0] is the last byte
  snprintf(deviceName, sizeof deviceName, "%s%02X%02X", ble::NAME_PREFIX, mac[1], mac[0]);
  NimBLEDevice::setDeviceName(deviceName);

  NimBLEServer* server = NimBLEDevice::createServer();
  server->setCallbacks(&serverCallbacks);
  NimBLEService* svc = server->createService(ble::SERVICE_UUID);
  repChr = svc->createCharacteristic(ble::REP_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  statusChr = svc->createCharacteristic(ble::STATUS_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  commandChr = svc->createCharacteristic(ble::COMMAND_UUID, NIMBLE_PROPERTY::WRITE);
  summaryChr = svc->createCharacteristic(ble::SUMMARY_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);
  liveChr = svc->createCharacteristic(ble::LIVE_UUID, NIMBLE_PROPERTY::NOTIFY);
  commandChr->setCallbacks(&commandCallbacks);

  setAndNotify(repChr, ble::RepPayload{});
  setAndNotify(summaryChr, ble::SummaryPayload{});
  svc->start();

  // 128-bit UUID in the advertising packet, name in the scan response (clarification 7)
  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  NimBLEAdvertisementData advData, scanData;
  advData.setFlags(BLE_HS_ADV_F_DISC_GEN | BLE_HS_ADV_F_BREDR_UNSUP);
  advData.addServiceUUID(ble::SERVICE_UUID);
  scanData.setName(deviceName);
  adv->setAdvertisementData(advData);
  adv->setScanResponseData(scanData);
  adv->enableScanResponse(true);
  adv->start();
}

void BleService::poll() {
  Command c;
  while (xQueueReceive(commands, &c, 0) == pdTRUE) {
    if (c.len == 0) continue;
    handler(static_cast<ble::Opcode>(c.data[0]), c.data + 1, c.len - 1);
  }
}

bool BleService::connected() const { return isConnected; }

bool BleService::takeNewConnection() {
  bool n = newConnection;
  newConnection = false;
  return n;
}

const char* BleService::name() const { return deviceName; }

void BleService::notifyRep(const ble::RepPayload& p) { setAndNotify(repChr, p); }
void BleService::notifyStatus(const ble::StatusPayload& p) { setAndNotify(statusChr, p); }
void BleService::notifySummary(const ble::SummaryPayload& p) { setAndNotify(summaryChr, p); }
void BleService::notifyLive(const ble::LivePayload& p) {
  if (isConnected) liveChr->notify(reinterpret_cast<const uint8_t*>(&p), sizeof(p));
}
