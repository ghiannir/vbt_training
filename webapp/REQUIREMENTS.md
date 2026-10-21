# VBT web app requirements

Static client (HTML + JavaScript ES modules, no framework, no npm, no build) that connects via Web Bluetooth to the VBT sensor (M5Stack StickS3) and shows repetitions in real time. It runs on iPhone in the **Bluefy** browser (Safari does not support Web Bluetooth), hosted on **GitHub Pages** (HTTPS required).

The BLE contract (UUIDs, binary layout, commands) is defined in `docs/ble-protocol.md` (owner: firmware agent). `webapp/js/protocol.js` must mirror it exactly.

Every requirement is testable: the verification method is in parentheses (T = automated test in Node/browser without hardware, M = manual with sensor, R = code review).

## 1. Platform constraints

- **WA-01** The app consists only of static files (`index.html`, `css/`, `js/*.js` as ES modules with `<script type="module">`). No `package.json`, no bundler, no transpiler. (R)
- **WA-02** Deployment is a push to GitHub Pages (`webapp/` folder or dedicated branch); the web app `README` (in English) describes the steps for a beginner. (R)
- **WA-03** All paths are relative (no leading `/`) so the app works under `https://user.github.io/repo/`. (R)
- **WA-04** At startup the app detects `navigator.bluetooth`; if absent it shows a clear message in English ("Open this page in Bluefy") and disables the Connect button. (M)
- **WA-05** `navigator.bluetooth.requestDevice()` is called **only** inside a tap/click handler (user gesture) and never on page load. (R, M)
- **WA-06** `requestDevice` filters by the VBT service (`filters: [{services:[SERVICE_UUID]}]`, possibly `namePrefix`) and declares in `optionalServices` every service read afterwards (protocol v1 does not expose Battery/Device Information: battery is in `Status.battery_pct`, so the VBT service is enough). Without `optionalServices` access would fail. (R)
- **WA-07** No background operation: Bluefy suspends the page when the screen is off / app in the background. The app requests the Screen Wake Lock (`navigator.wakeLock`) during a set, if available, and shows a warning if the connection drops in the background. (M)
- **WA-08** No requirement on the negotiated MTU: all notification payloads fit in 20 bytes (default MTU 23). Decoding checks the length and discards/reports payloads shorter than expected. (T)
- **WA-09** Decoding with `DataView` and an explicit `littleEndian = true` on every multi-byte read. (T, R)

## 2. Connection and reconnection

- **WA-10** A large "Connect" button opens the Bluetooth picker, connects to GATT, discovers the service and characteristics, reads the protocol version and state, and subscribes to notifications (`startNotifications`). (M)
- **WA-11** If the firmware protocol version differs from the supported one, the app shows "Incompatible firmware (fw X, app Y)" and does not start the session. (T with simulated payload)
- **WA-12** Connection state always visible (Disconnected / Connecting / Connected + battery %) in a top bar. (M)
- **WA-13** On an involuntary disconnection (`gattserverdisconnected`) the app attempts automatic reconnection to the **same** device (`device.gatt.connect()` without a new picker) with backoff (1 s, 2 s, 4 s, max 5 attempts) and then shows the manual "Reconnect" button. The manual attempt is a user gesture. (M)
- **WA-14** After every (re)connection the app performs resynchronization: it reads the current state (set id, number of repetitions) and requests the missing repetitions from the device; repetitions already received are not duplicated (key `setSeq + repIndex`). (T deduplication, M)
- **WA-15** The "Disconnect" button cleanly closes GATT and removes listeners; repeating connect/disconnect 10 times does not accumulate listeners (verifiable by counting handlers). (R, M)
- **WA-16** If the device is already connected to another client, or the connection fails, the error is shown in English without leaving the interface blocked. (M)

## 3. Live repetition display

- **WA-20** On receiving a repetition the screen shows, in very large type (at least 30% of the screen height for the main value): **mean concentric velocity (MCV)** in m/s with 2 decimals, repetition number, and in a smaller size peak velocity, ROM (cm) and duration (s). (M)
- **WA-21** Shows the set's **velocity loss** % relative to the best repetition and a bar/color: green below threshold * 0.5, yellow up to the threshold, red when the threshold is exceeded. Color is not the only indicator (text too). (M)
- **WA-22** List of the current set's repetitions (scrollable, latest on top) with MCV and loss. (M)
- **WA-23** All touch targets (buttons) are at least 56x56 CSS px, at least 8 px apart, usable with sweaty hands; no destructive action with a single tap without confirmation or undo (e.g. "Delete set" asks for confirmation). (M)
- **WA-24** High contrast (dark theme by default, ratio >= 7:1 for large numbers), portrait and landscape layout, no horizontal scroll at 360 px width. (M)
- **WA-25** Latency between the BLE notification and the screen update is under 100 ms (no heavy computation in the handler; asynchronous storage). (M)

## 4. Set management

- **WA-30** The user can start and end a set with a large button (sends `START_SET` / `STOP_SET` to the device); set events originating from the device (automatic start/end) still update the interface. (M)
- **WA-31** Before or during the set the user enters **exercise**, **load (kg)** with +/- steps (default 2.5 kg, long tap repeats) and can correct it at the end of the set. The load is saved with the set. (M)
- **WA-32** Each saved set contains: id, start/end timestamps, exercise, load, loss threshold used, repetitions (with all protocol fields), end-of-set reason. (T)
- **WA-33** A session (workout) groups the day's sets; it starts automatically at the first set and closes with "End workout" or after 3 hours of inactivity. (T)
- **WA-34** The "Tare / Reset sensor" button sends `TARE`, shows the outcome and stays disabled during a set. (M)
- **WA-35** The velocity loss threshold (default 20%, range 5-50% in steps of 5) is editable in settings, saved locally and sent to the device on every connection (`SET_THRESHOLD`). (M)

## 5. Velocity loss alarm

- **WA-40** When a repetition's velocity loss reaches or exceeds the threshold, the app emits a **beep** (Web Audio, `OscillatorNode`) and a **vibration** (`navigator.vibrate` if available; often absent on iOS, so not mandatory) and colors the screen red. Audio is unlocked at the first tap (Connect) to respect autoplay policies. (M)
- **WA-41** The alarm fires only once per set at the first crossing, with a "repeat on every rep above threshold" option. (T)
- **WA-42** The alarm is also handled if the firmware's `thresholdExceeded` flag is absent: the client recomputes the loss from MCV and best rep (`session.js`), and in case of discrepancy the firmware value prevails, and is recorded as the source of truth. (T)
- **WA-43** Sound volume/enabling is a setting (on/off) with a test button. (M)

## 6. History and storage

- **WA-50** Local persistence with **IndexedDB** (native API, no libraries): supports lots of data, asynchronous writes, structured objects and indexes by date/exercise; `localStorage` is synchronous, limited (~5 MB) and string-only, so it is used only for simple settings (threshold, sound, last device). Object stores: `sessions`, `sets` (index `exercise`, `startedAt`). (R)
- **WA-51** Each set is saved **at the end of the set** and also incrementally on every repetition (draft), so a crash or tab closure does not lose the set. (T, M)
- **WA-52** iOS may delete site data (ITP: after ~7 days without use in Safari; apps added to the Home Screen are less affected; Bluefy has its own storage). The app calls `navigator.storage.persist()` if available, and shows a "last backup: N days ago" reminder after 7 days without export. (M)
- **WA-53** **Export** the whole history as **JSON** (full backup, re-importable) and **CSV** (one row per repetition: date, session, exercise, load, set, rep, MCV, peak, ROM, duration, loss). Download via `Blob` + `download` link, or Web Share API (`navigator.share({files})`) if download is not available. (T for format, M on Bluefy)
- **WA-54** **Import** a JSON backup (merge without duplicates by id). (T)
- **WA-55** History screen: list of sessions by date, set/rep detail, deletion with confirmation, filter by exercise. (M)
- **WA-56** Schema with a version number (`schemaVersion`) and migrations; opening an older database does not lose data. (T)
- **WA-57** If IndexedDB is not available (private mode), the app works in memory and warns that data will not be saved. (M)

## 7. Load-velocity profile and 1RM estimate

- **WA-60** For an exercise, the Profile screen uses one point per distinct load, taken from the MCV of the **best repetition** (or mean of the first 2) of each set; at least 3 distinct loads are needed (4+ recommended, with at least a 15 kg range) otherwise it shows "insufficient data". (T)
- **WA-61** Least-squares linear regression velocity = a + b * load, with the R^2 coefficient shown; warning if R^2 < 0.90. (T with known data)
- **WA-62** **Estimated 1RM** = load at which the predicted velocity equals the exercise's minimum velocity threshold (MVT). Editable defaults: squat 0.30, bench press 0.17, deadlift 0.15, military press 0.20 m/s, generic 0.25. The value is shown as an estimate with a simple uncertainty interval (derived from the regression's standard error) and is rejected if the slope is not negative. (T)
- **WA-63** The load-velocity chart (inline SVG/canvas, no libraries) shows points, line and the 1RM point. (M)
- **WA-64** User-entered data: each set's load is mandatory for including it in the profile; sets without a load are excluded with an indicator. (T)
- **WA-65** Given a load, the app suggests the expected velocity and vice versa (load at a target velocity), using the line. (T)

## 8. Offline and PWA

- **WA-70** Once loaded, the app works without a network (BLE does not require Internet): a service worker (`sw.js`) pre-caches all static files (cache-first strategy with cache versioning). (M: airplane mode + restart)
- **WA-71** `manifest.webmanifest` with name, icons and `display: standalone` for "Add to Home Screen"; its use is **optional**: the app also works without the service worker and if registration fails nothing is blocked. (R)
- **WA-72** When a new version is published, the app shows "Update available, reload" instead of updating in the middle of a set. (M)

## 9. Code structure and quality

- **WA-80** Modules: `protocol.js` (pure encode/decode, no DOM), `ble.js` (Web Bluetooth, no DOM), `session.js` (model and calculations, pure), `storage.js` (IndexedDB and export), `lvprofile.js` (regression, pure), `ui.js` (DOM), `main.js` (wires everything). Pure modules are importable in Node without changes so they can be tested. (R)
- **WA-81** `protocol.js` has a test mode with sample payloads (test vectors copied from `docs/ble-protocol.md`) and a simulator (`js/simulator.js`) that emits fake repetitions, so the interface can be tried without the sensor (`?demo=1`). (T, M)
- **WA-82** Unhandled errors are shown in a visible "Log" panel (useful on iPhone without a console). (M)
- **WA-83** All interface texts are in English and collected in a single object to make them easy to edit. (R)
- **WA-84** Internal units: velocity in m/s (float), ROM in meters, duration in seconds, load in kg; conversion from the protocol's integer units (mm/s, mm, ms) happens only in `protocol.js`. (T)
