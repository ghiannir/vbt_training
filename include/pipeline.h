// Catena completa campione -> rep: fermo, orientamento, velocita', segmentazione, metriche.
// Puro C++: la usano sia il firmware sia tools/replay.cpp sul PC.
#pragma once
#include "config.h"
#include "metrics.h"
#include "orientation.h"
#include "rep_detector.h"
#include "types.h"
#include "velocity.h"

class VbtPipeline {
 public:
  VbtPipeline();
  void reset();

  // Da chiamare per ogni campione IMU. Ritorna true quando e' finita una rep valida (vedi lastRep()).
  bool update(const ImuSample& s);

  bool isStill() const { return still_.isStill(); }
  float liveVelocity() const { return live_.velocity(); }
  float gravityG() const { return gravityG_; }
  const RepMetrics& lastRep() const { return rep_; }

  LiftType lift = cfg::DEFAULT_LIFT;

 private:
  Madgwick ahrs_;
  StillDetector still_;
  RepDetector reps_;
  LiveVelocity live_;
  RepMetrics rep_;
  float gravityG_ = 1.0f;  // modulo di |acc| a riposo, aggiornato a ogni fermo
  bool initialized_ = false;
};
