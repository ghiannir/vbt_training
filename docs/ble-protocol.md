# Protocollo BLE firmware <-> web app

**Stato: concordato (v1)** - allineato con `webapp/js/protocol.js` (UUID, dimensioni, opcode); aggiunti vettori di test in fondo.

Questo file e' il contratto unico tra firmware (`include/ble_protocol.h`) e web app. Se cambia qui, cambia in entrambi.
Proprietario: agente firmware. La web app propone modifiche, non edita questo file.

## Regole generali

- Tutti gli interi multi-byte sono **little-endian** (in JS: `DataView.getUint16(off, true)`).
- Versione protocollo: **1** (campo `proto_version` della caratteristica Status).
- Tutti i payload sono **<= 20 byte** (MTU ATT di default 23): funzionano anche senza negoziazione.
- Velocita' in **mm/s**, distanze in **mm**, tempi in **ms**, percentuali in **%** (interi). Niente float sul filo.
- Nome dispositivo (advertising): `VBT-XXXX` dove XXXX = ultimi 2 byte del MAC in esadecimale (es. `VBT-A3F1`).
  La web app filtra con `namePrefix: "VBT-"` e dichiara il servizio in `optionalServices`.
- Il dispositivo supporta **una sola connessione** alla volta. Dopo la disconnessione riprende l'advertising.

## Servizio e caratteristiche

Servizio: `b972a2b5-fe5d-481c-8293-5ad78d77ae5e`

| Nome | UUID | Proprieta' | Dimensione |
|---|---|---|---|
| Rep | `89826146-e413-4d2a-9c5b-7882e6d4973c` | notify, read | 18 B |
| Status | `74fe761a-78be-41fd-b4aa-d75e861395db` | notify, read | 12 B |
| Command | `19407613-018f-4ad7-a1f9-9170de45328e` | write (con risposta) | 1..4 B |
| SetSummary | `1bea91e2-4768-45a9-8498-f412cba0add8` | notify, read | 12 B |
| Live | `8e3b1485-73ca-4dd1-b16a-0b3da91237f2` | notify | 4 B |

### Rep (una notifica per ripetizione conclusa)

| Off | Tipo | Campo | Note |
|---|---|---|---|
| 0 | u8 | `set_id` | contatore serie, 1..255 poi riparte da 1 |
| 1 | u8 | `rep_index` | 1-based dentro la serie |
| 2 | u16 | `mcv_mmps` | velocita' media concentrica (MCV) |
| 4 | u16 | `peak_mmps` | velocita' di picco concentrica |
| 6 | u16 | `rom_mm` | escursione verticale della fase concentrica |
| 8 | u16 | `conc_ms` | durata fase concentrica |
| 10 | u16 | `rep_ms` | durata totale rep (eccentrica + concentrica) |
| 12 | u8 | `vloss_pct` | perdita di velocita' vs miglior rep della serie finora (0 per la rep migliore) |
| 13 | u8 | `flags` | bit0 soglia perdita superata, bit1 nuova rep migliore, bit2 rep di bassa qualita' (stima dubbia) |
| 14 | u32 | `t_ms` | millisecondi dall'inizio serie alla fine della rep |

Totale 18 B. `read` restituisce l'ultima rep.

### Status (stato del dispositivo)

| Off | Tipo | Campo | Note |
|---|---|---|---|
| 0 | u8 | `proto_version` | 1 |
| 1 | u8 | `state` | 0 IDLE, 1 CALIBRATING, 2 READY, 3 SET_ACTIVE, 4 SET_DONE, 5 ERROR |
| 2 | u8 | `battery_pct` | 0..100 |
| 3 | u8 | `flags` | bit0 in carica, bit1 beep attivo, bit2 calibrazione valida |
| 4 | u8 | `set_id` | serie corrente (o ultima conclusa) |
| 5 | u8 | `rep_count` | rep nella serie corrente |
| 6 | u8 | `vloss_thr_pct` | soglia perdita velocita' (0 = disattivata) |
| 7 | u8 | `error_code` | 0 nessuno, 1 IMU, 2 calibrazione fallita (dispositivo mosso), 3 comando non valido |
| 8 | u16 | `best_mcv_mmps` | miglior MCV della serie corrente |
| 10 | u8 | `last_vloss_pct` | perdita dell'ultima rep |
| 11 | u8 | reserved | 0 |

Notificato a ogni cambio di stato/soglia/beep e almeno ogni 30 s per la batteria (non a ogni rep: per quelle c'e' Rep).

### SetSummary (notifica a fine serie)

| Off | Tipo | Campo | Note |
|---|---|---|---|
| 0 | u8 | `set_id` | |
| 1 | u8 | `rep_count` | |
| 2 | u8 | `stop_reason` | 0 pulsante, 1 comando app, 2 soglia perdita raggiunta, 3 timeout inattivita' |
| 3 | u8 | `final_vloss_pct` | perdita dell'ultima rep |
| 4 | u16 | `best_mcv_mmps` | |
| 6 | u16 | `mean_mcv_mmps` | media MCV delle rep |
| 8 | u16 | `duration_s` | durata serie |
| 10 | u16 | reserved | 0 |

`read` restituisce il riepilogo dell'ultima serie conclusa (tutti zero se nessuna).

### Live (opzionale, solo durante SET_ACTIVE, ~10 Hz)

| Off | Tipo | Campo |
|---|---|---|
| 0 | i16 | `v_mmps` velocita' verticale istantanea stimata (+ = su) |
| 2 | i16 | `h_mm` spostamento verticale dall'inizio della rep corrente |

La stima live non e' corretta dalla ZUPT: e' solo indicativa (barra/indicatore). I valori ufficiali sono quelli di Rep.

### Command (scrittura; byte 0 = opcode)

| Opcode | Nome | Argomenti | Effetto |
|---|---|---|---|
| 0x01 | START_SET | - | da READY avvia una serie (equivale al pulsante) |
| 0x02 | STOP_SET | - | termina la serie |
| 0x03 | TARE | - | ricalibra a riposo (solo IDLE/READY/SET_DONE) |
| 0x04 | SET_THRESHOLD | u8 `pct` (0 = off, 5..60) | soglia perdita velocita' |
| 0x05 | SET_BEEP | u8 0/1 | abilita beep |
| 0x06 | REQUEST_REPS | u8 `set_id`, u8 `from_rep` | rinvia via Rep le rep dalla `from_rep` (1-based) in poi |
| 0x07 | REQUEST_STATUS | - | rinvia Status e SetSummary |

Comando sconosciuto, argomenti fuori range o non ammesso nello stato corrente: `error_code=3` in Status, notificato subito
(la write riesce comunque: vedi "Precisazioni (round 2)"). Il firmware conserva in RAM le ultime **64 rep** della serie corrente e della precedente.

## Riconnessione e risincronizzazione

1. La serie **continua** anche se il telefono si disconnette (le rep restano in RAM).
2. Alla riconnessione l'app: (a) abilita le notifiche su Status, Rep, SetSummary, Live; (b) legge Status;
   (c) se `set_id`/`rep_count` sono piu' avanti di quanto l'app ha ricevuto, scrive `REQUEST_REPS(set_id, ultima_rep_nota+1)`;
   (d) se `state==SET_DONE` legge SetSummary.
3. Le rep rinviate hanno lo stesso formato e sono ordinate; l'app deve deduplicare per `(set_id, rep_index)`.
4. Se `proto_version` e' diverso da quello atteso dall'app, l'app mostra "aggiorna firmware/app" e non usa il resto.

## Note per la web app

- Bluefy richiede un gesto utente (tap) per `requestDevice`.
- Notifiche multiple ravvicinate: abilitare `startNotifications()` in sequenza (await), non in parallelo.

## Servizi standard

Il firmware **non** espone Battery Service (0x180F) ne' Device Information: la batteria e' in `Status.battery_pct`.
La web app deve quindi dichiarare in `optionalServices` solo il servizio VBT.

## Vettori di test (esadecimale, little-endian)

Rep: set 1, rep 3, MCV 612 mm/s, picco 1010 mm/s, ROM 480 mm, conc 780 ms, rep 1650 ms, perdita 8 %, flags 0, t 12345 ms
```
01 03 64 02 F2 03 E0 01 0C 03 72 06 08 00 39 30 00 00
```
Status: versione 1, SET_ACTIVE, batteria 87 %, flags beep+calibrato (0x06), set 1, 3 rep, soglia 20 %, nessun errore, miglior MCV 640 mm/s, ultima perdita 8 %
```
01 03 57 06 01 03 14 00 80 02 08 00
```
SetSummary: set 1, 5 rep, stop per soglia (2), perdita finale 21 %, miglior 640, media 590 mm/s, durata 38 s
```
01 05 02 15 80 02 4E 02 26 00 00 00
```
Live: v = +350 mm/s, h = -120 mm
```
5E 01 88 FF
```
Command REQUEST_REPS(set 1, da rep 4): `06 01 04`   SET_THRESHOLD 25 %: `04 19`

## Precisazioni (round di revisione 1, concordate con `webapp`)

1. **Perdita di velocita'**: `vloss_pct = clamp(round((best_mcv - mcv) / best_mcv * 100), 0, 100)`, dove `best_mcv` e' la migliore MCV della serie *incluse* la rep corrente (quindi 0 per la rep migliore). Il flag bit0 di Rep (soglia superata) e' 1 se `vloss_thr_pct > 0 && vloss_pct >= vloss_thr_pct` (>=, non >).
2. **Comandi validi per stato** (altrimenti `error_code=3`, vedi Precisazioni round 2):

| Comando | IDLE | CALIBRATING | READY | SET_ACTIVE | SET_DONE | ERROR |
|---|---|---|---|---|---|---|
| START_SET | no | no | si | no | **si** (diretto, senza passare da READY) | no |
| STOP_SET | no | no | no | si | no | no |
| TARE | si | no | si | no | si | si |
| SET_THRESHOLD / SET_BEEP | si | si | si | si | si | si |
| REQUEST_REPS / REQUEST_STATUS | sempre | sempre | sempre | sempre | sempre | sempre |

   Dopo TARE riuscito lo stato diventa READY. Da SET_DONE restano validi START_SET e TARE senza timeout automatico.
3. **Replay**: le rep rinviate da REQUEST_REPS arrivano sulla stessa caratteristica Rep, in ordine crescente di `rep_index`. Rep non piu' in RAM: non si invia nulla e non c'e' errore; l'app lo deduce da `Status.rep_count`.
4. **set_id**: mai 0; va 1..255 poi riparte da 1. Dopo un riavvio del dispositivo riparte da 1: un Status con `set_id` minore di quello noto indica reboot (nuova epoca di sessione).
5. **Ordine**: le notifiche Rep sono accodate in ordine e mai fuse. L'app rileva rep perse da buchi in `rep_index` e usa REQUEST_REPS.
6. **Status in connessione**: la lettura subito dopo la connessione restituisce lo stato reale anche a serie in corso. Soglia e beep restano in RAM fino al riavvio (default da `config.h`); l'app puo' reinviarli a ogni connessione.
7. **Advertising**: l'UUID a 128 bit va nel pacchetto di advertising (18 B), il nome `VBT-XXXX` nella scan response. Bluefy/Web Bluetooth vede entrambi.
8. **Live**: opzionale; l'app puo' non iscriversi (il firmware non invia nulla senza iscritti).

## Precisazioni (round 2, implementazione firmware)

1. **Comandi non validi**: il firmware usa NimBLE-Arduino, che non puo' rispondere a una write con errore ATT `0x80`. La write quindi riesce sempre; un comando non valido (opcode sconosciuto, argomenti errati, non ammesso nello stato corrente) imposta `error_code=3` in Status e Status viene notificato subito. Un comando valido successivo riporta `error_code` a 0. La web app deve osservare Status dopo le write, non affidarsi a una write fallita.
2. **Esecuzione asincrona**: i comandi sono accodati dal task BLE al loop principale e eseguiti entro pochi ms. Status viene notificato dopo ogni comando che cambia stato.
3. **Avvio automatico**: in READY o SET_DONE, una rep valida rilevata senza START_SET avvia automaticamente una nuova serie (`set_id` incrementato, stato SET_ACTIVE), come se fosse arrivato START_SET. Il pulsante A del dispositivo alterna avvio/stop (`stop_reason` 0).
4. **Fine serie**: il firmware per ora non ferma mai una serie per perdita di velocita' (`stop_reason` 2 non usato). Le serie terminano per pulsante, comando dell'app o dopo `SET_IDLE_TIMEOUT_MS` (60 s) senza rep (`stop_reason` 3).
5. **Rilevamento riavvio**: una Rep con `set_id` inferiore puo' essere il replay della serie precedente (conservata in RAM); solo uno Status con `set_id` inferiore all'ultimo noto indica un riavvio. La web app deve invocare il rilevamento a ogni Status.
6. **CALIBRATING**: lo stato non e' ancora usato; il dispositivo passa da IDLE a READY quando rileva per la prima volta di essere fermo (allora il flag di calibrazione valida, bit2, e' impostato).
