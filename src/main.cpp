// Passo 5: algoritmo + Bluetooth. Dopo ogni rep mostra la MCV e la invia all'app (docs/ble-protocol.md).
// Il log grezzo su USB resta attivo (passo 3) e ogni rep aggiunge una riga "#REP,...".
// Tasto A (frontale): avvia/ferma la serie. Tasto B (laterale): segna un evento (#NOTE).
// Una rep fatta da PRONTO o da serie finita avvia da sola una nuova serie.
#include <M5Unified.h>
#include <math.h>

#include "ble_service.h"
#include "config.h"
#include "imu.h"
#include "logger.h"
#include "pipeline.h"

using ble::DeviceState;

static Imu imu;
static RawLogger logger;
static VbtPipeline pipeline;
static SetTracker set;
static BleService bleSvc;

static DeviceState state = DeviceState::Idle;
static uint8_t setId = 0;  // 1..255, mai 0
static uint8_t threshold = cfg::DEFAULT_VLOSS_THRESHOLD_PCT;
static bool beepOn = false;
static uint8_t errorCode = 0;
static uint8_t lastLoss = 0;
static uint32_t setStartMs = 0, lastRepMs = 0;
static bool dirty = true;  // da ridisegnare

// Ultime REP_HISTORY rep della serie corrente e della precedente, per REQUEST_REPS
struct RepHistory {
  uint8_t setId = 0;
  uint8_t count = 0;
  ble::RepPayload reps[ble::REP_HISTORY];
};
static RepHistory history[2];  // [0] = corrente, [1] = precedente

static uint16_t mm(float m) { return (uint16_t)lroundf(m * 1000.0f); }

static ble::StatusPayload makeStatus() {
  ble::StatusPayload p{};
  p.proto_version = ble::PROTO_VERSION;
  p.state = (uint8_t)state;
  p.battery_pct = (uint8_t)constrain(M5.Power.getBatteryLevel(), 0, 100);
  p.flags = (M5.Power.isCharging() == m5::Power_Class::is_charging ? ble::ST_FLAG_CHARGING : 0) |
            (beepOn ? ble::ST_FLAG_BEEP : 0) | (state != DeviceState::Idle ? ble::ST_FLAG_CALIB_OK : 0);
  p.set_id = setId;
  p.rep_count = set.repCount();
  p.vloss_thr_pct = threshold;
  p.error_code = errorCode;
  p.best_mcv_mmps = mm(set.bestMcvMs());
  p.last_vloss_pct = lastLoss;
  return p;
}

static void sendStatus() {
  bleSvc.notifyStatus(makeStatus());
  dirty = true;
}

static void startSet() {
  setId = setId == 255 ? 1 : setId + 1;
  set.start(threshold);
  history[1] = history[0];
  history[0] = RepHistory();
  history[0].setId = setId;
  lastLoss = 0;
  setStartMs = lastRepMs = millis();
  state = DeviceState::SetActive;
  logger.mark("SET_START");
  sendStatus();
}

static void stopSet(ble::StopReason reason) {
  ble::SummaryPayload p{};
  p.set_id = setId;
  p.rep_count = set.repCount();
  p.stop_reason = (uint8_t)reason;
  p.final_vloss_pct = lastLoss;
  p.best_mcv_mmps = mm(set.bestMcvMs());
  p.mean_mcv_mmps = mm(set.meanMcvMs());
  p.duration_s = (uint16_t)((millis() - setStartMs) / 1000);
  bleSvc.notifySummary(p);
  state = DeviceState::SetDone;
  logger.mark("SET_STOP");
  sendStatus();
}

static void onRep(const RepMetrics& m, uint32_t t_us) {
  if (state == DeviceState::Ready || state == DeviceState::SetDone) startSet();
  if (state != DeviceState::SetActive) return;

  SetTracker::Result r = set.addRep(m);
  lastLoss = r.velocityLossPct;
  lastRepMs = millis();

  ble::RepPayload p{};
  p.set_id = setId;
  p.rep_index = r.repIndex;
  p.mcv_mmps = mm(m.mcvMs);
  p.peak_mmps = mm(m.peakMs);
  p.rom_mm = mm(m.romM);
  p.conc_ms = (uint16_t)m.concMs;
  p.rep_ms = (uint16_t)m.repMs;
  p.vloss_pct = r.velocityLossPct;
  p.flags = (r.thresholdExceeded ? ble::REP_FLAG_THRESHOLD : 0) | (r.isBest ? ble::REP_FLAG_BEST : 0) |
            (m.lowQuality ? ble::REP_FLAG_LOW_QUAL : 0);
  p.t_ms = lastRepMs - setStartMs;
  if (history[0].count < ble::REP_HISTORY) history[0].reps[history[0].count++] = p;
  bleSvc.notifyRep(p);
  dirty = true;

  if (beepOn) M5.Speaker.tone(r.thresholdExceeded ? cfg::BEEP_LOSS_HZ : cfg::BEEP_REP_HZ, 120);
  Serial.printf("#REP,%lu,n=%u,mcv=%.3f,peak=%.3f,rom=%.3f,conc_ms=%lu,loss=%u%s\n", (unsigned long)t_us,
                r.repIndex, m.mcvMs, m.peakMs, m.romM, (unsigned long)m.concMs, r.velocityLossPct,
                m.lowQuality ? ",lowq" : "");
}

// Comandi dall'app. Tabella dei comandi validi per stato: docs/ble-protocol.md, precisazione 2.
static bool onCommand(ble::Opcode op, const uint8_t* args, size_t len) {
  bool ok = true;
  switch (op) {
    case ble::Opcode::StartSet:
      ok = state == DeviceState::Ready || state == DeviceState::SetDone;
      if (ok) startSet();
      break;
    case ble::Opcode::StopSet:
      ok = state == DeviceState::SetActive;
      if (ok) stopSet(ble::StopReason::App);
      break;
    case ble::Opcode::Tare:
      ok = state != DeviceState::Calibrating && state != DeviceState::SetActive;
      if (ok) {
        pipeline.reset();  // si ricalibra al prossimo fermo
        state = DeviceState::Idle;
      }
      break;
    case ble::Opcode::SetThreshold:
      ok = len >= 1 && (args[0] == 0 || (args[0] >= 5 && args[0] <= 60));
      if (ok) {
        threshold = args[0];
        set.setThreshold(threshold);
      }
      break;
    case ble::Opcode::SetBeep:
      ok = len >= 1 && args[0] <= 1;
      if (ok) beepOn = args[0];
      break;
    case ble::Opcode::RequestReps:
      ok = len >= 2 && args[0] != 0 && args[1] != 0;
      if (ok) {
        for (const RepHistory& h : history) {
          if (h.setId != args[0]) continue;
          for (int i = args[1] - 1; i < h.count; i++) bleSvc.notifyRep(h.reps[i]);
        }
      }
      break;
    case ble::Opcode::RequestStatus:
      break;  // Status si rimanda sotto; SetSummary ha gia' il valore "read" aggiornato
    default:
      ok = false;
  }
  errorCode = ok ? 0 : (uint8_t)ble::ErrorCode::BadCommand;
  sendStatus();
  return ok;
}

static const char* stateLabel() {
  switch (state) {
    case DeviceState::Idle: return "fermo...";
    case DeviceState::Ready: return "PRONTO";
    case DeviceState::SetDone: return "FINE";
    default: return "VIA";
  }
}

static void draw() {
  auto& d = M5.Display;
  bool hasRep = state == DeviceState::SetActive && set.repCount() > 0;
  bool alert = hasRep && threshold > 0 && lastLoss >= threshold;
  uint16_t bg = alert ? TFT_RED : TFT_BLACK;
  d.fillScreen(bg);
  d.setTextColor(TFT_DARKGREY, bg);
  d.setTextSize(2);
  d.setTextDatum(top_left);
  d.drawString(String("serie ") + setId, 6, 4);
  d.setTextDatum(top_right);
  d.drawString(String("rep ") + set.repCount(), 234, 4);

  d.setTextDatum(middle_center);
  if (!hasRep) {
    d.setTextColor(TFT_WHITE, bg);
    d.setTextSize(3);
    d.drawString(stateLabel(), 120, 64);
  } else {
    const RepMetrics& m = pipeline.lastRep();
    d.setTextColor(m.lowQuality ? TFT_YELLOW : TFT_GREEN, bg);
    d.setTextSize(6);
    d.drawString(String(m.mcvMs, 2), 120, 60);
    d.setTextSize(2);
    d.setTextColor(TFT_WHITE, bg);
    d.drawString(String("-") + lastLoss + "%  ROM " + String(m.romM * 100, 0) + "cm", 120, 104);
  }
  d.setTextSize(1);
  d.setTextColor(bleSvc.connected() ? TFT_CYAN : TFT_DARKGREY, bg);
  d.setTextDatum(bottom_left);
  d.drawString(String(bleSvc.name()) + (bleSvc.connected() ? " connesso" : "") + "  batt " +
                   M5.Power.getBatteryLevel() + "%",
               6, 133);
}

void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);  // la seriale non deve mai bloccare il ciclo (NF-01)
  M5.begin();
  M5.Display.setBrightness(128);
  M5.Display.setRotation(1);  // orizzontale: 240x135

  if (!imu.begin()) {
    state = DeviceState::Error;
    errorCode = (uint8_t)ble::ErrorCode::Imu;
    M5.Display.fillScreen(TFT_RED);
    M5.Display.setTextColor(TFT_WHITE, TFT_RED);
    M5.Display.setTextSize(2);
    M5.Display.setCursor(8, 50);
    M5.Display.print("IMU non risponde");
    Serial.println("# IMU non risponde");
    while (true) delay(1000);
  }
  logger.begin();
  bleSvc.begin(onCommand);
  sendStatus();
}

void loop() {
  static uint32_t lastDraw = 0, lastStatus = 0, lastLive = 0;
  M5.update();
  bleSvc.poll();
  if (bleSvc.takeNewConnection()) sendStatus();

  if (M5.BtnA.wasPressed()) {
    if (state == DeviceState::SetActive) {
      stopSet(ble::StopReason::Button);
    } else if (state == DeviceState::Ready || state == DeviceState::SetDone) {
      startSet();
    }
  }
  if (M5.BtnB.wasPressed()) logger.mark("NOTE");

  ImuSample s;
  for (int i = 0; i < 32 && imu.read(s); i++) {  // a blocchi, cosi' resta tempo per tasti, BLE e schermo
    logger.logSample(s);
    if (pipeline.update(s)) onRep(pipeline.lastRep(), s.t_us);
  }
  if (state == DeviceState::Idle && pipeline.isStill()) {
    state = DeviceState::Ready;  // la gravita' e' stimata: si puo' misurare
    sendStatus();
  }

  uint32_t now = millis();
  if (state == DeviceState::SetActive && now - lastRepMs >= cfg::SET_IDLE_TIMEOUT_MS) {
    stopSet(ble::StopReason::Timeout);
  }
  if (state == DeviceState::SetActive && bleSvc.connected() && now - lastLive >= cfg::LIVE_PERIOD_MS) {
    lastLive = now;
    bleSvc.notifyLive({(int16_t)lroundf(pipeline.liveVelocity() * 1000), 0});
  }
  if (now - lastStatus >= cfg::STATUS_PERIOD_MS) {  // batteria
    lastStatus = now;
    sendStatus();
  }
  if (dirty && now - lastDraw >= 200) {
    lastDraw = now;
    dirty = false;
    draw();
  }
}
