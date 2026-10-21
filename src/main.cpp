// Passo 2: valori grezzi di accelerometro e giroscopio sullo schermo e sulla seriale.
#include <M5Unified.h>
#include <math.h>

#include "imu.h"

static Imu imu;
static ImuSample last;
static uint32_t samples = 0;  // campioni letti nell'ultimo secondo
static uint32_t dropped = 0;
static float rateHz = 0;

static void drawStatic() {
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextDatum(top_left);
  M5.Display.setTextSize(2);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_BLACK);
  M5.Display.drawString("acc g", 4, 2);
  M5.Display.drawString("gyro dps", 124, 2);
}

static void drawValues() {
  M5.Display.setTextSize(2);
  const char* axes = "xyz";
  const float acc[3] = {last.acc.x, last.acc.y, last.acc.z};
  const float gyr[3] = {last.gyro.x, last.gyro.y, last.gyro.z};
  for (int i = 0; i < 3; i++) {
    int y = 24 + i * 22;
    M5.Display.setTextColor(TFT_GREEN, TFT_BLACK);
    M5.Display.setCursor(4, y);
    M5.Display.printf("%c%+6.2f ", axes[i], acc[i]);
    M5.Display.setTextColor(TFT_CYAN, TFT_BLACK);
    M5.Display.setCursor(124, y);
    M5.Display.printf("%c%+6.0f ", axes[i], gyr[i]);
  }
  float norm = sqrtf(last.acc.x * last.acc.x + last.acc.y * last.acc.y + last.acc.z * last.acc.z);
  M5.Display.setTextColor(TFT_WHITE, TFT_BLACK);
  M5.Display.setCursor(4, 94);
  M5.Display.printf("|a| %.3f g   ", norm);
  M5.Display.setTextSize(1);
  M5.Display.setTextColor(TFT_DARKGREY, TFT_BLACK);
  M5.Display.setCursor(4, 122);
  M5.Display.printf("%.0f Hz  persi %lu  batt %d%%   ", rateHz, (unsigned long)dropped,
                    M5.Power.getBatteryLevel());
}

void setup() {
  Serial.begin(115200);
  M5.begin();
  M5.Display.setBrightness(128);
  M5.Display.setRotation(1);  // orizzontale: 240x135

  if (!imu.begin()) {
    M5.Display.fillScreen(TFT_RED);
    M5.Display.setTextColor(TFT_WHITE, TFT_RED);
    M5.Display.setTextSize(2);
    M5.Display.setCursor(8, 50);
    M5.Display.print("IMU non risponde");
    Serial.println("[vbt] IMU non risponde");
    while (true) delay(1000);
  }
  Serial.println("[vbt] IMU ok: 400 Hz, +-16 g, +-2000 dps");
  drawStatic();
}

void loop() {
  static uint32_t lastDraw = 0, lastRate = 0;
  M5.update();

  ImuSample s;
  if (imu.read(s)) {
    last = s;
    samples++;
  }

  uint32_t now = millis();
  if (now - lastRate >= 1000) {
    rateHz = samples * 1000.0f / (now - lastRate);
    dropped = imu.droppedSamples();
    samples = 0;
    lastRate = now;
  }
  if (now - lastDraw >= 100) {  // schermo e seriale a 10 Hz
    lastDraw = now;
    drawValues();
    Serial.printf("acc %+.3f %+.3f %+.3f  gyro %+.1f %+.1f %+.1f  %.0f Hz\n", last.acc.x, last.acc.y,
                  last.acc.z, last.gyro.x, last.gyro.y, last.gyro.z, rateHz);
  }
}
