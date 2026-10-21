# Requisiti firmware - sensore VBT (M5Stack StickS3)

Hardware: ESP32-S3, IMU BMI270, display 135x240, LiPo 250 mAh, 2 pulsanti utente (A = grande frontale, B = laterale), speaker, BLE.
Toolchain: PlatformIO + Arduino + M5Unified. Moduli degli algoritmi in `include/` senza dipendenze Arduino (testabili con env `native`).
Parametri numerici: `include/config.h`. Contratto BLE: `docs/ble-protocol.md`.

## 1. Stati

```
        accensione
            |
         [IDLE] --A corto--> [CALIBRATING] --ok--> [READY] --A corto--> [SET_ACTIVE]
            ^                      |  fallita           |  ^                  |
            |                      v                    |  |                  | A corto / app / soglia / timeout
            |                  [ERROR] <--- IMU KO      |  +---- B lungo -----+---> [SET_DONE]
            |                                           |                              |
            +---------- inattivita' lunga (deep sleep) -+<------ A corto (nuova serie) +
```

| Stato | Significato |
|---|---|
| IDLE | Acceso, sensore non calibrato. Schermo e BLE attivi. |
| CALIBRATING | Fermo per 1,5 s: misura gravita' e offset giroscopio. |
| READY | Calibrato, in attesa di START. Calcolo orientamento attivo. |
| SET_ACTIVE | Serie in corso: rileva rep, calcola metriche, notifica via BLE. |
| SET_DONE | Serie conclusa: mostra riepilogo; la memoria rep resta per la risincronizzazione. |
| ERROR | IMU non risponde o calibrazione fallita (dispositivo mosso). Codice in Status. |

## 2. Pulsanti

| Pulsante | Azione | Stato | Effetto |
|---|---|---|---|
| A | corto | IDLE | calibra (tare) |
| A | corto | READY / SET_DONE | avvia serie |
| A | corto | SET_ACTIVE | termina serie |
| A | lungo (>1 s) | qualsiasi | ricalibra (TARE), solo se non SET_ACTIVE |
| B | corto | READY / SET_DONE | cicla soglia perdita velocita' (off, 10, 20, 30 %) |
| B | corto | SET_ACTIVE | nessun effetto (evita pressioni accidentali) |
| B | lungo (>1 s) | SET_ACTIVE | annulla serie (scarta) |
| B | lungo (>1 s) | READY / IDLE | attiva/disattiva beep |

(La mappatura esatta dei tasti fisici StickS3 va verificata al momento dell'implementazione.)

## 3. Requisiti funzionali

**Acquisizione**
- FW-01: l'IMU e' campionato a `IMU_RATE_HZ` (400 Hz), range +-16 g e +-2000 dps.
- FW-02: ogni campione ha timestamp in microsecondi; se i buchi superano 1,5 periodi il contatore `droppedSamples` aumenta e viene mostrato in debug.
- FW-03: la frequenza effettiva misurata su 10 s deve essere entro 2 % di quella nominale (test: log seriale).

**Calibrazione**
- FW-04: la calibrazione dura `CALIB_MS` e stima direzione della gravita' e bias del giroscopio.
- FW-05: se durante la calibrazione il gyro supera `CALIB_MAX_GYRO_DPS` o |acc| devia oltre `CALIB_MAX_ACC_DEV_G`, la calibrazione e' rifiutata (stato ERROR code 2, si puo' ripetere).
- FW-06: la calibrazione puo' essere ripetuta in qualsiasi momento fuori da SET_ACTIVE (tasto A lungo o comando TARE).

**Algoritmo**
- FW-07: l'orientamento e' stimato con Madgwick 6 assi (`MADGWICK_BETA`), inizializzato dalla gravita' misurata a riposo.
- FW-08: l'accelerazione verticale terrestre e' ottenuta ruotando il campione e sottraendo 9,81 m/s^2.
- FW-09: il sensore e' "fermo" quando |acc|-1 g e |gyro| restano sotto soglia per `STILL_MIN_MS`.
- FW-10: una rep e' un segmento fermo -> movimento -> fermo con durata tra `REP_MIN_MS` e `REP_MAX_MS` e ROM concentrico >= `REP_MIN_ROM_M`. Segmenti non conformi sono scartati senza notifica.
- FW-11: la velocita' di ogni rep e' ottenuta integrando l'accelerazione verticale solo durante il segmento, con correzione lineare del drift in modo che la velocita' finale sia 0 (ZUPT).
- FW-12: la fase concentrica e' definita da velocita' > `CONC_MIN_VEL_MS` (dopo la fase eccentrica per `EccentricFirst`, subito per `ConcentricFirst`).
- FW-13: per ogni rep si calcolano MCV, velocita' di picco, ROM, durata concentrica e totale (struct `RepMetrics`).
- FW-14: `vloss_pct = clamp(round(100 * (best_mcv - mcv) / best_mcv), 0, 100)`, con `best_mcv` = MCV massima della serie finora inclusa la rep corrente. Flag soglia (e beep di soglia) quando `vloss_thr_pct > 0 && vloss_pct >= vloss_thr_pct`. Comandi validi per stato: vedi `docs/ble-protocol.md`, sezione Precisazioni.
- FW-15: se il drift corretto supera `LOW_QUALITY_RESIDUAL_MS` la rep e' marcata bassa qualita' (flag).
- FW-16: la serie termina con: tasto A, comando STOP_SET, soglia di perdita superata (se attiva), o `SET_IDLE_TIMEOUT_MS` senza rep.
- FW-17: tutta l'elaborazione avviene sul dispositivo; il telefono non e' necessario per misurare.

**Display e audio**
- FW-18: contenuti per stato (sezione 5); aggiornamento schermo a ~10 Hz, mai nel percorso di campionamento.
- FW-19: se il beep e' attivo: bip breve a fine rep, bip grave doppio quando la soglia di perdita e' superata.
- FW-20: lo schermo si spegne dopo `DISPLAY_SLEEP_MS` senza input ne' serie attiva; qualsiasi tasto lo riaccende.

**BLE** (dettagli in `docs/ble-protocol.md`)
- FW-21: advertising come `VBT-XXXX` con il servizio definito; una sola connessione.
- FW-22: ogni rep valida produce una notifica Rep entro 100 ms dalla fine del movimento.
- FW-23: i comandi dell'app (start, stop, tare, soglia, beep, richiesta rep/stato) producono gli stessi effetti dei tasti.
- FW-24: le ultime `REP_HISTORY` (64) rep della serie corrente e di quella precedente restano in RAM e possono essere rinviate.
- FW-25: una disconnessione non interrompe una serie in corso; riconnettendosi l'app puo' risincronizzarsi.
- FW-26: nessun dato personale e' trasmesso o salvato; BLE senza pairing obbligatorio (v1).

**Log seriale (step 3)**
- FW-27: una modalita' di build/avvio "raw log" trasmette tutti i campioni IMU via USB seriale nel formato della sezione 6, senza eseguire l'algoritmo.
- FW-28: nel log nessuna perdita di campioni a 400 Hz per almeno 5 minuti (verificabile dai timestamp).

## 4. Requisiti non funzionali

- NF-01: ciclo di campionamento e algoritmo non devono bloccarsi su display, BLE o seriale (nessun `delay()` nel percorso critico).
- NF-02: tempo di elaborazione per campione < 1 ms (budget: 2,5 ms a 400 Hz); la fine rep (integrazione del segmento) < 20 ms.
- NF-03: RAM per i buffer dell'algoritmo < 64 KB (6 s x 400 Hz x 4 B x 3 array ~ 29 KB). La PSRAM non e' necessaria.
- NF-04: moduli algoritmici (`orientation`, `velocity`, `rep_detector`, `metrics`, `Calibrator`) senza `#include <Arduino.h>` / `M5*`; usano solo `types.h` e `config.h`.
- NF-05: un principiante deve poter leggere ogni header in pochi minuti: commenti in italiano, nomi chiari, una responsabilita' per file.
- NF-06: nessuna allocazione dinamica nel loop di campionamento.

### Budget energetico (stima, da misurare)

| Voce | Corrente tipica | Note |
|---|---|---|
| ESP32-S3 attivo 240 MHz, BLE connesso | ~50-70 mA | puo' scendere clock a 160 MHz |
| IMU BMI270 400 Hz | ~1 mA | |
| Display acceso | ~15-25 mA | spento dopo 30 s |
| Totale sessione allenamento | ~60-80 mA | ~3 ore con 250 mAh |

- NF-07: autonomia in uso >= 2 ore (batteria 250 mAh, schermo al 50 %).
- NF-08: in IDLE inattivo per `DEEP_SLEEP_MS` il dispositivo va in deep sleep; un tasto lo risveglia.
- NF-09: il livello batteria e' mostrato sul display e inviato in Status (flag carica incluso).

## 5. Contenuto del display (135x240 verticale)

- **IDLE**: nome `VBT-XXXX`, icona BLE (connesso/no), batteria, "A = calibra".
- **CALIBRATING**: "Tieni fermo", barra di progresso.
- **READY**: "Pronto", soglia perdita (es. "Stop a 20 %"), batteria, BLE. "A = inizia".
- **SET_ACTIVE**: numero rep (grande), MCV ultima rep in m/s (grande), perdita % ultima rep (colore verde < soglia, rosso oltre), barra velocita' live, miglior MCV.
- **SET_DONE**: rep totali, miglior MCV, media MCV, perdita finale, "A = nuova serie".
- **ERROR**: messaggio breve per codice ("IMU non risponde", "Muoviti meno: ripeti calibrazione").

## 6. Log seriale dei dati grezzi (step 3)

Trasporto: USB CDC (porta seriale dell'USB-C), testo ASCII, una riga per campione, fine riga `\n`. Il PC registra con uno script Python o `pio device monitor > file.csv`.

Intestazione (prima riga, una volta):
```
# VBT raw v1 rate_hz=400 acc_fs_g=16 gyro_fs_dps=2000 units=g,dps
t_us,ax,ay,az,gx,gy,gz
```
Righe campione:
```
1234567,0.0123,-0.0045,0.9987,0.12,-0.05,0.01
```
| Colonna | Tipo | Unita' | Decimali |
|---|---|---|---|
| `t_us` | uint32 | microsecondi dall'avvio (riparte da 0 dopo ~71 min) | - |
| `ax,ay,az` | float | g | 4 |
| `gx,gy,gz` | float | gradi/s | 2 |

Marcatori (righe che iniziano con `#`, ignorate da un parser CSV con `comment='#'`):
`#SET_START,<t_us>`, `#SET_STOP,<t_us>`, `#TARE,<t_us>`, `#NOTE,<t_us>` (tasto B per segnare un evento, es. "rep fatta" durante l'acquisizione di riferimento).

Dimensione: ~45 byte/riga x 400 = ~18 kB/s ~ 1 MB/minuto. Il valore di baud e' irrilevante su USB-CDC.
Il log non esegue l'algoritmo (FW-27) e ha priorita' su display/BLE (BLE spento in questa modalita').

## 7. Test di accettazione (indicativi)

- Rep a mano su 0,5 m a velocita' circa nota: MCV entro 0,05 m/s dal riferimento video (step 7).
- Sensore fermo 60 s in SET_ACTIVE: nessuna rep rilevata.
- 5 rep lente vs 5 rep veloci: l'ordine delle MCV rispecchia la realta'.
- Spegnere BLE sul telefono a meta' serie e riaccendere: tutte le rep arrivano senza duplicati (FW-24/25).

## 8. Domande aperte

- Orientamento di montaggio sul bilanciere e posizione (centro bilanciere vs manicotto): influisce sull'asse verticale e sul tipo di movimento.
- Soglia di perdita predefinita: 20 % va bene come partenza?
- Mappatura reale dei pulsanti dello StickS3 (da confermare sull'hardware).
- Libreria BLE: NimBLE-Arduino (consigliata, piu' leggera) vs libreria inclusa.
