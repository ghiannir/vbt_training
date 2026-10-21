// Raw data log over USB serial (step 3). Format in firmware/REQUIREMENTS.md, section 6 "Raw data serial log".
#pragma once
#include "types.h"

class RawLogger {
 public:
  void begin();                         // prints the "# VBT raw v1 ..." header
  void logSample(const ImuSample& s);   // one CSV line per sample
  void mark(const char* label);         // line "#label,t_us" (e.g. SET_START, SET_STOP, REP)
};
