# BLE protocol: firmware <-> web app

**Status: agreed (v1)** - aligned with `webapp/js/protocol.js` (UUIDs, sizes, opcodes); test vectors added at the end.

This file is the single contract between the firmware (`include/ble_protocol.h`) and the web app. If it changes here, it changes in both.
Owner: firmware agent. The web app proposes changes; it does not edit this file.

## General rules

- All multi-byte integers are **little-endian** (in JS: `DataView.getUint16(off, true)`).
- Protocol version: **1** (`proto_version` field of the Status characteristic).
- All payloads are **<= 20 bytes** (default ATT MTU 23): they also work without negotiation.
- Velocities in **mm/s**, distances in **mm**, times in **ms**, percentages in **%** (integers). No floats on the wire.
- Device name (advertising): `VBT-XXXX` where XXXX = last 2 bytes of the MAC in hexadecimal (e.g. `VBT-A3F1`).
  The web app filters with `namePrefix: "VBT-"` and declares the service in `optionalServices`.
- The device supports **a single connection** at a time. After disconnection it resumes advertising.

## Service and characteristics

Service: `b972a2b5-fe5d-481c-8293-5ad78d77ae5e`

| Name | UUID | Properties | Size |
|---|---|---|---|
| Rep | `89826146-e413-4d2a-9c5b-7882e6d4973c` | notify, read | 18 B |
| Status | `74fe761a-78be-41fd-b4aa-d75e861395db` | notify, read | 12 B |
| Command | `19407613-018f-4ad7-a1f9-9170de45328e` | write (with response) | 1..4 B |
| SetSummary | `1bea91e2-4768-45a9-8498-f412cba0add8` | notify, read | 12 B |
| Live | `8e3b1485-73ca-4dd1-b16a-0b3da91237f2` | notify | 4 B |

### Rep (one notification per completed repetition)

| Off | Type | Field | Notes |
|---|---|---|---|
| 0 | u8 | `set_id` | set counter, 1..255 then wraps back to 1 |
| 1 | u8 | `rep_index` | 1-based within the set |
| 2 | u16 | `mcv_mmps` | mean concentric velocity (MCV) |
| 4 | u16 | `peak_mmps` | peak concentric velocity |
| 6 | u16 | `rom_mm` | vertical range of motion of the concentric phase |
| 8 | u16 | `conc_ms` | duration of the concentric phase |
| 10 | u16 | `rep_ms` | total rep duration (eccentric + concentric) |
| 12 | u8 | `vloss_pct` | velocity loss vs. the best rep of the set so far (0 for the best rep) |
| 13 | u8 | `flags` | bit0 loss threshold exceeded, bit1 new best rep, bit2 low-quality rep (doubtful estimate) |
| 14 | u32 | `t_ms` | milliseconds from the start of the set to the end of the rep |

Total 18 B. `read` returns the last rep.

### Status (device state)

| Off | Type | Field | Notes |
|---|---|---|---|
| 0 | u8 | `proto_version` | 1 |
| 1 | u8 | `state` | 0 IDLE, 1 CALIBRATING, 2 READY, 3 SET_ACTIVE, 4 SET_DONE, 5 ERROR |
| 2 | u8 | `battery_pct` | 0..100 |
| 3 | u8 | `flags` | bit0 charging, bit1 beep enabled, bit2 calibration valid |
| 4 | u8 | `set_id` | current (or last completed) set |
| 5 | u8 | `rep_count` | reps in the current set |
| 6 | u8 | `vloss_thr_pct` | velocity loss threshold (0 = disabled) |
| 7 | u8 | `error_code` | 0 none, 1 IMU, 2 calibration failed (device moved), 3 invalid command |
| 8 | u16 | `best_mcv_mmps` | best MCV of the current set |
| 10 | u8 | `last_vloss_pct` | loss of the last rep |
| 11 | u8 | reserved | 0 |

Notified on every state/threshold/beep change and at least every 30 s for the battery (not on every rep: Rep covers that).

### SetSummary (notification at end of set)

| Off | Type | Field | Notes |
|---|---|---|---|
| 0 | u8 | `set_id` | |
| 1 | u8 | `rep_count` | |
| 2 | u8 | `stop_reason` | 0 button, 1 app command, 2 loss threshold reached, 3 inactivity timeout |
| 3 | u8 | `final_vloss_pct` | loss of the last rep |
| 4 | u16 | `best_mcv_mmps` | |
| 6 | u16 | `mean_mcv_mmps` | mean MCV of the reps |
| 8 | u16 | `duration_s` | set duration |
| 10 | u16 | reserved | 0 |

`read` returns the summary of the last completed set (all zeros if none).

### Live (optional, only during SET_ACTIVE, ~10 Hz)

| Off | Type | Field |
|---|---|---|
| 0 | i16 | `v_mmps` estimated instantaneous vertical velocity (+ = up) |
| 2 | i16 | `h_mm` vertical displacement since the start of the current rep |

The live estimate is not corrected by ZUPT: it is only indicative (bar/indicator). The official values are those in Rep.

### Command (write; byte 0 = opcode)

| Opcode | Name | Arguments | Effect |
|---|---|---|---|
| 0x01 | START_SET | - | from READY starts a set (equivalent to the button) |
| 0x02 | STOP_SET | - | ends the set |
| 0x03 | TARE | - | recalibrates at rest (only IDLE/READY/SET_DONE) |
| 0x04 | SET_THRESHOLD | u8 `pct` (0 = off, 5..60) | velocity loss threshold |
| 0x05 | SET_BEEP | u8 0/1 | enables beep |
| 0x06 | REQUEST_REPS | u8 `set_id`, u8 `from_rep` | resends via Rep the reps from `from_rep` (1-based) onwards |
| 0x07 | REQUEST_STATUS | - | resends Status and SetSummary |

Unknown command, out-of-range arguments, or command not allowed in the current state: `error_code=3` in Status, notified immediately
(the write succeeds anyway: see "Clarifications (round 2)"). The firmware keeps the last **64 reps** of the current and previous set in RAM.

## Reconnection and resynchronization

1. The set **continues** even if the phone disconnects (the reps stay in RAM).
2. On reconnection the app: (a) enables notifications on Status, Rep, SetSummary, Live; (b) reads Status;
   (c) if `set_id`/`rep_count` are ahead of what the app has received, writes `REQUEST_REPS(set_id, last_known_rep+1)`;
   (d) if `state==SET_DONE` reads SetSummary.
3. Resent reps have the same format and are ordered; the app must deduplicate by `(set_id, rep_index)`.
4. If `proto_version` differs from the one the app expects, the app shows "update firmware/app" and does not use the rest.

## Notes for the web app

- Bluefy requires a user gesture (tap) for `requestDevice`.
- Multiple closely spaced notifications: enable `startNotifications()` sequentially (await), not in parallel.

## Standard services

The firmware does **not** expose Battery Service (0x180F) or Device Information: the battery is in `Status.battery_pct`.
The web app must therefore declare only the VBT service in `optionalServices`.

## Test vectors (hexadecimal, little-endian)

Rep: set 1, rep 3, MCV 612 mm/s, peak 1010 mm/s, ROM 480 mm, conc 780 ms, rep 1650 ms, loss 8 %, flags 0, t 12345 ms
```
01 03 64 02 F2 03 E0 01 0C 03 72 06 08 00 39 30 00 00
```
Status: version 1, SET_ACTIVE, battery 87 %, flags beep+calibrated (0x06), set 1, 3 reps, threshold 20 %, no error, best MCV 640 mm/s, last loss 8 %
```
01 03 57 06 01 03 14 00 80 02 08 00
```
SetSummary: set 1, 5 reps, stopped by threshold (2), final loss 21 %, best 640, mean 590 mm/s, duration 38 s
```
01 05 02 15 80 02 4E 02 26 00 00 00
```
Live: v = +350 mm/s, h = -120 mm
```
5E 01 88 FF
```
Command REQUEST_REPS(set 1, from rep 4): `06 01 04`   SET_THRESHOLD 25 %: `04 19`

## Clarifications (review round 1, agreed with `webapp`)

1. **Velocity loss**: `vloss_pct = clamp(round((best_mcv - mcv) / best_mcv * 100), 0, 100)`, where `best_mcv` is the best MCV of the set *including* the current rep (so 0 for the best rep). The Rep flag bit0 (threshold exceeded) is 1 if `vloss_thr_pct > 0 && vloss_pct >= vloss_thr_pct` (>=, not >).
2. **Valid commands per state** (otherwise `error_code=3`, see Clarifications round 2):

| Command | IDLE | CALIBRATING | READY | SET_ACTIVE | SET_DONE | ERROR |
|---|---|---|---|---|---|---|
| START_SET | no | no | yes | no | **yes** (direct, without going through READY) | no |
| STOP_SET | no | no | no | yes | no | no |
| TARE | yes | no | yes | no | yes | yes |
| SET_THRESHOLD / SET_BEEP | yes | yes | yes | yes | yes | yes |
| REQUEST_REPS / REQUEST_STATUS | always | always | always | always | always | always |

   After a successful TARE the state becomes READY. From SET_DONE, START_SET and TARE remain valid with no automatic timeout.
3. **Replay**: the reps resent by REQUEST_REPS arrive on the same Rep characteristic, in ascending `rep_index` order. Reps no longer in RAM: nothing is sent and there is no error; the app infers it from `Status.rep_count`.
4. **set_id**: never 0; goes 1..255 then wraps back to 1. After a device restart it starts again from 1: a Status with a `set_id` lower than the known one indicates a reboot (new session epoch).
5. **Ordering**: Rep notifications are queued in order and never merged. The app detects lost reps from gaps in `rep_index` and uses REQUEST_REPS.
6. **Status on connection**: reading right after connection returns the real state even with a set in progress. Threshold and beep stay in RAM until restart (defaults from `config.h`); the app may resend them on every connection.
7. **Advertising**: the 128-bit UUID goes in the advertising packet (18 B), the `VBT-XXXX` name in the scan response. Bluefy/Web Bluetooth sees both.
8. **Live**: optional; the app may not subscribe (the firmware sends nothing without subscribers).

## Clarifications (round 2, firmware implementation)

1. **Invalid commands**: the firmware uses NimBLE-Arduino, which cannot answer a write with ATT error `0x80`. The write therefore always succeeds; an invalid command (unknown opcode, wrong arguments, not allowed in the current state) sets `error_code=3` in Status and Status is notified immediately. A subsequent valid command resets `error_code` to 0. The web app must observe Status after writes, not rely on a failed write.
2. **Asynchronous execution**: commands are queued from the BLE task to the main loop and executed within a few ms. Status is notified after every command that changes state.
3. **Automatic start**: in READY or SET_DONE, a valid rep detected without START_SET automatically starts a new set (`set_id` incremented, state SET_ACTIVE), as if START_SET had arrived. The device's A button toggles start/stop (`stop_reason` 0).
4. **End of set**: for now the firmware never stops a set because of velocity loss (`stop_reason` 2 unused). Sets end by button, app command, or after `SET_IDLE_TIMEOUT_MS` (60 s) without reps (`stop_reason` 3).
5. **Restart detection**: a Rep with a lower `set_id` may be the replay of the previous set (kept in RAM); only a Status with a `set_id` lower than the last known indicates a restart. The web app must run the detection on every Status.
6. **CALIBRATING**: the state is not used yet; the device goes from IDLE to READY when it first detects that it is still (the valid-calibration flag, bit2, is then set).
