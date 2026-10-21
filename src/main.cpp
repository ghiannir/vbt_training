// Passo 3: log dei dati grezzi su USB per tarare l'algoritmo sul PC (FW-27).
// Tasto A (frontale): inizio/fine serie. Tasto B (laterale): segna un evento (#NOTE).
// Sul PC: uv run --with pyserial tools/record.py
#include <M5Unified.h>
#include <math.h>

#include "imu.h"
#include "logger.h"

static Imu imu;
static RawLogger logger;
static ImuSample last;
static bool inSet = false;
static uint32_t setCount = 0, notes = 0;
static uint32_t samples = 0, dropped = 0;
static float rateHz = 0;

static void draw() {
  M5.Display.setTextDatum(top_left);
  M5.Display.setTextSize(3);
  M5.Display.setTextColor(inSet ? TFT_BLACK : TFT_WHITE, inSet ? TFT_GREEN : TFT_BLACK);
  M5.Display.fillRect(0, 0, 240, 34, inSet ? TFT_GREEN : TFT_BLACK);
  M5.Display.setCursor(6, 6);
  M5.Display.printf(inSet ? "SERIE %lu" : "PRONTO", (unsigned long)setCount);

  M5.Display.setTextSize(2);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  float norm = sqrtf(last.acc.x * last.acc.x + last.acc.y * last.acc.y + last.acc.z * last.acc.z);
  M5.Display.setCursor(6, 46);
  M5.Display.printf("|a| %.3f g   ", norm);
  M5.Display.setCursor(6, 70);
  M5.Display.printf("note %lu   ", (unsigned long)notes);

  M5.Display.setTextSize(1);
  M5.Display.setTextColor(dropped ? TFT_RED : TFT_DARKGREY, TFT_BLACK);
  M5.Display.setCursor(6, 100);
  M5.Display.printf("%.0f Hz  persi %lu  batt %d%%   ", rateHz, (unsigned long)dropped,
                    M5.Power.getBatteryLevel());
  M5.Display.setTextColor(TFT_DARKGREY, TFT_BLACK);
  M5.Display.setCursor(6, 118);
  M5.Display.print("A: serie   B: nota");
}

void setup() {
  Serial.begin(115200);
  M5.begin();
  M5.Display.setBrightness(128);
  M5.Display.setRotation(1);  // orizzontale: 240x135
  M5.Display.fillScreen(TFT_BLACK);

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
}

void loop() {
  static uint32_t lastDraw = 0, lastRate = 0;
  M5.update();

  if (M5.BtnA.wasPressed()) {
    inSet = !inSet;
    if (inSet) setCount++;
    logger.mark(inSet ? "SET_START" : "SET_STOP");
  }
  if (M5.BtnB.wasPressed()) {
    notes++;
    logger.mark("NOTE");
  }

  ImuSample s;
  while (imu.read(s)) {  // svuota tutto quello che la FIFO ha accumulato
    logger.logSample(s);
    last = s;
    samples++;
  }

  uint32_t now = millis();
  if (now - lastRate >= 1000) {
    rateHz = samples * 1000.0f / (now - lastRate);
    dropped += imu.droppedSamples();
    samples = 0;
    lastRate = now;
  }
  if (now - lastDraw >= 250) {
    lastDraw = now;
    draw();
  }
}
