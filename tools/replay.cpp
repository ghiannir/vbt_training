// Rigioca l'algoritmo del firmware sul PC.
//   replay --synthetic        squat finto da 0,5 m: controlla che ROM e MCV tornino
//   replay data/raw_X.csv     stampa le rep trovate in una registrazione (passo 3)
// Compilazione: vedi tools/build_replay.sh
#define _USE_MATH_DEFINES
#include <math.h>
#include <stdio.h>
#include <string.h>

#include <vector>

#include "config.h"
#include "pipeline.h"

static int reportRep(const VbtPipeline& p, uint32_t t_us, int n) {
  const RepMetrics& m = p.lastRep();
  printf("rep %2d  t=%7.2f s  MCV %.3f m/s  picco %.3f m/s  ROM %.3f m  conc %4u ms  rep %4u ms%s\n", n,
         t_us / 1e6, m.mcvMs, m.peakMs, m.romM, (unsigned)m.concMs, (unsigned)m.repMs,
         m.lowQuality ? "  [bassa qualita']" : "");
  return n + 1;
}

// Squat finto: fermo, discesa di 0,5 m in 1,2 s, salita di 0,5 m in 0,8 s, fermo. Ripetuto 3 volte.
static int synthetic() {
  const float dt = 1.0f / cfg::IMU_RATE_HZ;
  const float rom = 0.5f, down = 1.2f, up = 0.8f, rest = 1.0f;
  std::vector<float> a;
  auto still = [&](float s) { for (int i = 0; i < s / dt; i++) a.push_back(0); };
  // Profilo di posizione a coseno: z(t) = -rom/2 (1 - cos(pi t / T)), quindi a(t) = -rom/2 (pi/T)^2 cos(pi t / T)
  auto move = [&](float T, float sign) {
    for (int i = 0; i < T / dt; i++) a.push_back(sign * rom / 2 * powf(M_PI / T, 2) * cosf(M_PI * i * dt / T));
  };
  still(rest);
  for (int r = 0; r < 3; r++) {
    move(down, -1);
    move(up, +1);
    still(rest);
  }

  VbtPipeline p;
  int n = 1;
  uint32_t t = 0;
  for (float az : a) {
    ImuSample s;
    s.t_us = t;
    s.acc = {0.01f, -0.02f, 1.015f * (1 + az / cfg::GRAVITY_MS2)};  // errore di scala come il sensore vero
    if (p.update(s)) n = reportRep(p, t, n);
    t += 1000000 / cfg::IMU_RATE_HZ;
  }
  printf("atteso: 3 rep, ROM 0.500 m, MCV %.3f m/s, picco %.3f m/s\n", rom / up, rom / 2 * M_PI / up);
  return n == 4 ? 0 : 1;
}

static int replayCsv(const char* path) {
  FILE* f = fopen(path, "r");
  if (!f) {
    perror(path);
    return 1;
  }
  VbtPipeline p;
  char line[256];
  int n = 1;
  while (fgets(line, sizeof line, f)) {
    if (line[0] == '#') {
      if (strncmp(line, "#SET_", 5) == 0 || strncmp(line, "#NOTE", 5) == 0) printf("%s", line);
      continue;
    }
    ImuSample s;
    unsigned long t;
    if (sscanf(line, "%lu,%f,%f,%f,%f,%f,%f", &t, &s.acc.x, &s.acc.y, &s.acc.z, &s.gyro.x, &s.gyro.y,
               &s.gyro.z) != 7)
      continue;
    s.t_us = t;
    if (p.update(s)) n = reportRep(p, s.t_us, n);
  }
  fclose(f);
  printf("%d rep trovate\n", n - 1);
  return 0;
}

int main(int argc, char** argv) {
  if (argc > 1 && strcmp(argv[1], "--synthetic") == 0) return synthetic();
  if (argc > 1) return replayCsv(argv[1]);
  fprintf(stderr, "uso: replay --synthetic | replay file.csv\n");
  return 2;
}
