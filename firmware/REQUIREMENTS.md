# Firmware requirements - VBT sensor (M5Stack StickS3)

Hardware: ESP32-S3, BMI270 IMU, 135x240 display, 250 mAh LiPo, 2 user buttons (A = large front, B = side), speaker, BLE.
Toolchain: PlatformIO + Arduino + M5Unified. Algorithm modules in `include/` with no Arduino dependencies (testable with the `native` env).
Numeric parameters: `include/config.h`. BLE contract: `docs/ble-protocol.md`.

## 1. States

```
        power on
            |
         [IDLE] --A short--> [CALIBRATING] --ok--> [READY] --A short--> [SET_ACTIVE]
            ^                      |  failed            |  ^                  |
            |                      v                    |  |                  | A short / app / threshold / timeout
            |                  [ERROR] <--- IMU KO      |  +---- B long ------+---> [SET_DONE]
            |                                           |                              |
            +---------- long inactivity (deep sleep) ---+<------ A short (new set) ----+
```

| State | Meaning |
|---|---|
| IDLE | Powered on, sensor not calibrated. Screen and BLE active. |
| CALIBRATING | Still for 1.5 s: measures gravity and gyroscope offset. |
| READY | Calibrated, waiting for START. Orientation computation active. |
| SET_ACTIVE | Set in progress: detects reps, computes metrics, notifies via BLE. |
| SET_DONE | Set finished: shows summary; the rep memory is kept for resynchronization. |
| ERROR | IMU not responding or calibration failed (device moved). Code in Status. |

## 2. Buttons

| Button | Action | State | Effect |
|---|---|---|---|
| A | short | IDLE | calibrate (tare) |
| A | short | READY / SET_DONE | start set |
| A | short | SET_ACTIVE | end set |
| A | long (>1 s) | any | recalibrate (TARE), only if not SET_ACTIVE |
| B | short | READY / SET_DONE | cycle velocity loss threshold (off, 10, 20, 30 %) |
| B | short | SET_ACTIVE | no effect (avoids accidental presses) |
| B | long (>1 s) | SET_ACTIVE | cancel set (discard) |
| B | long (>1 s) | READY / IDLE | enable/disable beep |

(The exact mapping of the StickS3 physical keys must be verified at implementation time.)

## 3. Functional requirements

**Acquisition**
- FW-01: the IMU is sampled at `IMU_RATE_HZ` (400 Hz), range +-16 g and +-2000 dps.
- FW-02: every sample has a microsecond timestamp; if gaps exceed 1.5 periods the `droppedSamples` counter increases and is shown in debug.
- FW-03: the effective rate measured over 10 s must be within 2 % of the nominal one (test: serial log).

**Calibration**
- FW-04: calibration lasts `CALIB_MS` and estimates the gravity direction and gyroscope bias.
- FW-05: if during calibration the gyro exceeds `CALIB_MAX_GYRO_DPS` or |acc| deviates beyond `CALIB_MAX_ACC_DEV_G`, calibration is rejected (state ERROR code 2, can be repeated).
- FW-06: calibration can be repeated at any time outside SET_ACTIVE (long A press or TARE command).

**Algorithm**
- FW-07: orientation is estimated with 6-axis Madgwick (`MADGWICK_BETA`), initialized from the gravity measured at rest.
- FW-08: the earth-frame vertical acceleration is obtained by rotating the sample and subtracting 9.81 m/s^2.
- FW-09: the sensor is "still" when |acc|-1 g and |gyro| stay below threshold for `STILL_MIN_MS`.
- FW-10: a rep is a still -> motion -> still segment with duration between `REP_MIN_MS` and `REP_MAX_MS` and concentric ROM >= `REP_MIN_ROM_M`. Non-conforming segments are discarded without notification.
- FW-11: the velocity of each rep is obtained by integrating the vertical acceleration only during the segment, with linear drift correction so that the final velocity is 0 (ZUPT).
- FW-12: the concentric phase is defined by velocity > `CONC_MIN_VEL_MS` (after the eccentric phase for `EccentricFirst`, immediately for `ConcentricFirst`).
- FW-13: for each rep, MCV, peak velocity, ROM, concentric and total duration are computed (struct `RepMetrics`).
- FW-14: `vloss_pct = clamp(round(100 * (best_mcv - mcv) / best_mcv), 0, 100)`, with `best_mcv` = maximum MCV of the set so far including the current rep. Threshold flag (and threshold beep) when `vloss_thr_pct > 0 && vloss_pct >= vloss_thr_pct`. Valid commands per state: see `docs/ble-protocol.md`, Clarifications section.
- FW-15: if the corrected drift exceeds `LOW_QUALITY_RESIDUAL_MS` the rep is marked low quality (flag).
- FW-16: the set ends with: button A, STOP_SET command, loss threshold exceeded (if active), or `SET_IDLE_TIMEOUT_MS` without reps.
- FW-17: all processing happens on the device; the phone is not needed to measure.

**Display and audio**
- FW-18: content per state (section 5); screen refresh at ~10 Hz, never in the sampling path.
- FW-19: if the beep is enabled: short beep at the end of a rep, low double beep when the loss threshold is exceeded.
- FW-20: the screen turns off after `DISPLAY_SLEEP_MS` with no input and no active set; any button turns it back on.

**BLE** (details in `docs/ble-protocol.md`)
- FW-21: advertising as `VBT-XXXX` with the defined service; a single connection.
- FW-22: every valid rep produces a Rep notification within 100 ms of the end of the movement.
- FW-23: app commands (start, stop, tare, threshold, beep, rep/status request) produce the same effects as the buttons.
- FW-24: the last `REP_HISTORY` (64) reps of the current and previous set stay in RAM and can be resent.
- FW-25: a disconnection does not interrupt a set in progress; on reconnecting the app can resynchronize.
- FW-26: no personal data is transmitted or stored; BLE without mandatory pairing (v1).

**Serial log (step 3)**
- FW-27: a "raw log" build/boot mode streams all IMU samples over USB serial in the format of section 6, without running the algorithm.
- FW-28: no sample loss in the log at 400 Hz for at least 5 minutes (verifiable from the timestamps).

## 4. Non-functional requirements

- NF-01: the sampling loop and the algorithm must not block on display, BLE or serial (no `delay()` in the critical path).
- NF-02: processing time per sample < 1 ms (budget: 2.5 ms at 400 Hz); end of rep (segment integration) < 20 ms.
- NF-03: RAM for the algorithm buffers < 64 KB (6 s x 400 Hz x 4 B x 3 arrays ~ 29 KB). PSRAM is not needed.
- NF-04: algorithm modules (`orientation`, `velocity`, `rep_detector`, `metrics`, `Calibrator`) without `#include <Arduino.h>` / `M5*`; they use only `types.h` and `config.h`.
- NF-05: a beginner must be able to read each header in a few minutes: comments in English, clear names, one responsibility per file.
- NF-06: no dynamic allocation in the sampling loop.

### Energy budget (estimate, to be measured)

| Item | Typical current | Notes |
|---|---|---|
| ESP32-S3 active 240 MHz, BLE connected | ~50-70 mA | clock can be lowered to 160 MHz |
| BMI270 IMU 400 Hz | ~1 mA | |
| Display on | ~15-25 mA | off after 30 s |
| Total training session | ~60-80 mA | ~3 hours with 250 mAh |

- NF-07: battery life in use >= 2 hours (250 mAh battery, screen at 50 %).
- NF-08: when inactive in IDLE for `DEEP_SLEEP_MS` the device goes into deep sleep; a button wakes it.
- NF-09: the battery level is shown on the display and sent in Status (charging flag included).

## 5. Display content (135x240 portrait)

- **IDLE**: name `VBT-XXXX`, BLE icon (connected/not), battery, "A = calibrate".
- **CALIBRATING**: "Hold still", progress bar.
- **READY**: "Ready", loss threshold (e.g. "Stop at 20 %"), battery, BLE. "A = start".
- **SET_ACTIVE**: rep number (large), MCV of the last rep in m/s (large), loss % of the last rep (green < threshold, red beyond), live velocity bar, best MCV.
- **SET_DONE**: total reps, best MCV, mean MCV, final loss, "A = new set".
- **ERROR**: short message per code ("IMU not responding", "Move less: repeat calibration").

## 6. Raw data serial log (step 3)

Transport: USB CDC (the USB-C serial port), ASCII text, one line per sample, line ending `\n`. The PC records with a Python script or `pio device monitor > file.csv`.

Header (first line, once):
```
# VBT raw v1 rate_hz=400 acc_fs_g=16 gyro_fs_dps=2000 units=g,dps
t_us,ax,ay,az,gx,gy,gz
```
Sample lines:
```
1234567,0.0123,-0.0045,0.9987,0.12,-0.05,0.01
```
| Column | Type | Unit | Decimals |
|---|---|---|---|
| `t_us` | uint32 | microseconds since boot (restarts from 0 after ~71 min) | - |
| `ax,ay,az` | float | g | 4 |
| `gx,gy,gz` | float | degrees/s | 2 |

Markers (lines starting with `#`, ignored by a CSV parser with `comment='#'`):
`#SET_START,<t_us>`, `#SET_STOP,<t_us>`, `#TARE,<t_us>`, `#NOTE,<t_us>` (button B to mark an event, e.g. "rep done" during reference acquisition).

Size: ~45 bytes/line x 400 = ~18 kB/s ~ 1 MB/minute. The baud rate is irrelevant on USB-CDC.
The log does not run the algorithm (FW-27) and has priority over display/BLE (BLE off in this mode).

## 7. Acceptance tests (indicative)

- Hand rep over 0.5 m at roughly known velocity: MCV within 0.05 m/s of the video reference (step 7).
- Sensor still for 60 s in SET_ACTIVE: no rep detected.
- 5 slow reps vs 5 fast reps: the order of the MCVs reflects reality.
- Turn off BLE on the phone mid-set and turn it back on: all reps arrive without duplicates (FW-24/25).

## 8. Open questions

- Mounting orientation on the barbell and position (barbell center vs. sleeve): affects the vertical axis and the type of movement.
- Default loss threshold: is 20 % OK as a starting point?
- Real button mapping of the StickS3 (to be confirmed on the hardware).
- BLE library: NimBLE-Arduino (recommended, lighter) vs. the bundled library.
