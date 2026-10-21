#!/bin/sh
# Builds tools/replay.cpp with the same algorithm code as the firmware.
# Uses zig as the C++ compiler through uv (nothing installed system-wide).
cd "$(dirname "$0")/.." || exit 1
mkdir -p .pio/replay
uv run --with ziglang python -m ziglang c++ -std=c++17 -O2 -Iinclude \
  tools/replay.cpp src/pipeline.cpp src/orientation.cpp src/velocity.cpp src/rep_detector.cpp src/metrics.cpp \
  -o .pio/replay/replay.exe && echo "ok: .pio/replay/replay.exe"
