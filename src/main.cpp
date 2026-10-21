// Passo 4: algoritmo sul dispositivo. Dopo ogni rep mostra la velocita' media concentrica (MCV).
// Il log grezzo su USB resta attivo (passo 3) e ogni rep aggiunge una riga "#REP,...".
// Tasto A (frontale): nuova serie. Tasto B (laterale): segna un evento (#NOTE).
// Sul PC: uv run --with pyserial tools/record.py
#include <M5Unified.h>

#include "config.h"
#include "imu.h"
#include "logger.h"
#include "pipeline.h"

static Imu imu;
static RawLogger logger;
static VbtPipeline pipeline;
static SetTracker set;
static SetTracker::Result lastResult;
static uint32_t setCount = 0;
static bool repShown = false;
static bool dirty = true;  // da ridisegnare

static void startSet() {
  setCount++;
  set.start(cfg::DEFAULT_VLOSS_THRESHOLD_PCT);
  repShown = false;
  dirty = true;
  logger.mark("SET_START");
}

static void draw() {
  auto& d = M5.Display;
  bool alert = repShown && lastResult.thresholdExceeded;
  uint16_t bg = alert ? TFT_RED : TFT_BLACK;
  d.fillScreen(bg);
  d.setTextColor(TFT_DARKGREY, bg);
  d.setTextSize(2);
  d.setTextDatum(top_left);
  d.drawString(String("serie ") + setCount, 6, 4);
  d.setTextDatum(top_right);
  d.drawString(String("rep ") + set.repCount(), 234, 4);

  d.setTextDatum(middle_center);
  if (!repShown) {
    d.setTextColor(TFT_WHITE, bg);
    d.setTextSize(3);
    d.drawString(pipeline.isStill() ? "PRONTO" : "...", 120, 64);
  } else {
    const RepMetrics& m = pipeline.lastRep();
    d.setTextColor(m.lowQuality ? TFT_YELLOW : TFT_GREEN, bg);
    d.setTextSize(6);
    d.drawString(String(m.mcvMs, 2), 120, 60);
    d.setTextSize(2);
    d.setTextColor(TFT_WHITE, bg);
    d.drawString(String("-") + lastResult.velocityLossPct + "%  ROM " + String(m.romM * 100, 0) + "cm", 120, 104);
  }
  d.setTextSize(1);
  d.setTextColor(TFT_DARKGREY, bg);
  d.setTextDatum(bottom_left);
  d.drawString(String("m/s  batt ") + M5.Power.getBatteryLevel() + "%  A: nuova serie", 6, 133);
}

void setup() {
  Serial.begin(115200);
  Serial.setTxTimeoutMs(0);  // la seriale non deve mai bloccare il ciclo (NF-01)
  M5.begin();
  M5.Display.setBrightness(128);
  M5.Display.setRotation(1);  // orizzontale: 240x135

  if (!imu.begin()) {
    M5.Display.fillScreen(TFT_RED);
    M5.Display.setTextColor(TFT_WHITE, TFT_RED);
    M5.Display.setTextSize(2);
    M5.Display.setCursor(8, 50);
    M5.Display.print("IMU non risponde");
    Serial.println("# IMU non risponde");
    while (true) delay(1000);
  }
  logger.begin();
  startSet();
}

void loop() {
  static uint32_t lastDraw = 0;
  static bool wasStill = false;
  M5.update();

  if (M5.BtnA.wasPressed()) startSet();
  if (M5.BtnB.wasPressed()) logger.mark("NOTE");

  ImuSample s;
  for (int i = 0; i < 32 && imu.read(s); i++) {  // a blocchi, cosi' resta tempo per tasti e schermo
    logger.logSample(s);
    if (pipeline.update(s)) {
      const RepMetrics& m = pipeline.lastRep();
      lastResult = set.addRep(m);
      repShown = true;
      dirty = true;
      Serial.printf("#REP,%lu,n=%u,mcv=%.3f,peak=%.3f,rom=%.3f,conc_ms=%lu,loss=%u%s\n", (unsigned long)s.t_us,
                    lastResult.repIndex, m.mcvMs, m.peakMs, m.romM, (unsigned long)m.concMs,
                    lastResult.velocityLossPct, m.lowQuality ? ",lowq" : "");
    }
  }
  if (pipeline.isStill() != wasStill) {
    wasStill = pipeline.isStill();
    if (!repShown) dirty = true;
  }

  // Si ridisegna solo quando cambia qualcosa, al massimo 5 volte al secondo
  uint32_t now = millis();
  if (dirty && now - lastDraw >= 200) {
    lastDraw = now;
    dirty = false;
    draw();
  }
}
