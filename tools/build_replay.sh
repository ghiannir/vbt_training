#!/bin/sh
# Compila tools/replay.cpp con lo stesso codice dell'algoritmo del firmware.
# Usa zig come compilatore C++ tramite uv (nessuna installazione nel sistema).
cd "$(dirname "$0")/.." || exit 1
mkdir -p .pio/replay
uv run --with ziglang python -m ziglang c++ -std=c++17 -O2 -Iinclude \
  tools/replay.cpp src/pipeline.cpp src/orientation.cpp src/velocity.cpp src/rep_detector.cpp src/metrics.cpp \
  -o .pio/replay/replay.exe && echo "ok: .pio/replay/replay.exe"
