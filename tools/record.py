"""Records the raw VBT sensor log into a CSV file (step 3).

Usage (from the project folder):
    uv run --with pyserial tools/record.py            # finds the sensor port by itself
    uv run --with pyserial tools/record.py COM5       # or specify it
Ctrl+C to stop. The file ends up in data/raw_YYYYMMDD_HHMMSS.csv.
Lines starting with '#' are markers (SET_START, SET_STOP, NOTE):
in pandas read with pd.read_csv(path, comment="#").
"""

import sys
import time
from datetime import datetime
from pathlib import Path

import serial
from serial.tools import list_ports

ESPRESSIF_VID = 0x303A
COLUMNS = "t_us,ax,ay,az,gx,gy,gz"


def find_port() -> str:
    for p in list_ports.comports():
        if p.vid == ESPRESSIF_VID:
            return p.device
    sys.exit("Sensor not found: connect it over USB or specify the port (e.g. COM5).")


def main() -> None:
    port = sys.argv[1] if len(sys.argv) > 1 else find_port()
    out_dir = Path(__file__).resolve().parent.parent / "data"
    out_dir.mkdir(exist_ok=True)
    path = out_dir / f"raw_{datetime.now():%Y%m%d_%H%M%S}.csv"

    samples = 0
    started = time.time()
    with serial.Serial(port, 115200, timeout=0.5) as ser, open(path, "w", newline="\n") as f:
        f.write(COLUMNS + "\n")
        print(f"Recording from {port} to {path}  (Ctrl+C to stop)")
        buf = b""
        try:
            while True:
                buf += ser.read(ser.in_waiting or 1)
                *lines, buf = buf.split(b"\n")
                for raw in lines:
                    line = raw.decode("ascii", "replace").strip()
                    if not line or line == COLUMNS:
                        continue
                    f.write(line + "\n")
                    if line.startswith("#"):
                        print(f"  {line}")
                    else:
                        samples += 1
                        if samples % 4000 == 0:
                            print(f"  {samples} samples, {time.time() - started:.0f} s")
        except KeyboardInterrupt:
            pass
    print(f"Saved {samples} samples to {path}")


if __name__ == "__main__":
    main()
