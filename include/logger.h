// Log dei dati grezzi su USB seriale (step 3). Formato in firmware/REQUIREMENTS.md, sezione "Log seriale".
#pragma once
#include "types.h"

class RawLogger {
 public:
  void begin();                         // stampa l'intestazione "# VBT raw v1 ..."
  void logSample(const ImuSample& s);   // una riga CSV per campione
  void mark(const char* label);         // riga "#label,t_us" (es. SET_START, SET_STOP, REP)
};
