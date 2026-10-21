// Passo 1: "Ciao" sullo schermo, per verificare che il caricamento funzioni.
// Stampa anche una diagnostica sulla seriale USB (115200) per capire cosa non va.
#include <M5Unified.h>

void setup() {
  Serial.begin(115200);
  delay(2000);  // tempo al PC per aprire la porta USB
  Serial.println("\n[vbt] avvio");
  Serial.printf("[vbt] PSRAM: %s, %u byte\n", psramFound() ? "si" : "no", (unsigned)ESP.getPsramSize());

  M5.begin();

  Serial.printf("[vbt] scheda: %d (StickS3 = %d)\n", (int)M5.getBoard(), (int)m5::board_t::board_M5StickS3);
  Serial.printf("[vbt] display: %dx%d\n", M5.Display.width(), M5.Display.height());
  Serial.printf("[vbt] batteria: %d%%\n", M5.Power.getBatteryLevel());

  M5.Display.setBrightness(128);
  M5.Display.setRotation(1);  // orizzontale: 240x135
  M5.Display.fillScreen(TFT_BLACK);
  M5.Display.setTextColor(TFT_GREEN, TFT_BLACK);
  M5.Display.setTextDatum(middle_center);
  M5.Display.setTextSize(4);
  M5.Display.drawString("Ciao", M5.Display.width() / 2, M5.Display.height() / 2);

  M5.Display.setTextSize(1);
  M5.Display.setTextDatum(bottom_center);
  M5.Display.drawString(M5.getBoard() == m5::board_t::board_M5StickS3 ? "M5StickS3 ok" : "scheda non riconosciuta",
                        M5.Display.width() / 2, M5.Display.height() - 4);
}

void loop() {
  static uint32_t last = 0;
  M5.update();
  if (M5.BtnA.wasPressed()) {
    Serial.println("[vbt] pulsante A premuto");
  }
  if (millis() - last >= 1000) {
    last = millis();
    Serial.printf("[vbt] vivo, %lu s\n", (unsigned long)(last / 1000));
  }
  delay(10);
}
