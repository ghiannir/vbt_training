# Requisiti della web app VBT

Client statico (HTML + JavaScript ES modules, nessun framework, nessun npm, nessuna build) che si collega via Web Bluetooth al sensore VBT (M5Stack StickS3) e mostra le ripetizioni in tempo reale. Gira su iPhone nel browser **Bluefy** (Safari non supporta Web Bluetooth), ospitata su **GitHub Pages** (HTTPS obbligatorio).

Il contratto BLE (UUID, layout binario, comandi) e' definito in `docs/ble-protocol.md` (proprietario: agente firmware). `webapp/js/protocol.js` deve rispecchiarlo esattamente.

Ogni requisito e' testabile: tra parentesi il modo di verifica (T = test automatico in Node/browser senza hardware, M = manuale con sensore, R = revisione del codice).

## 1. Vincoli di piattaforma

- **WA-01** L'app e' composta solo da file statici (`index.html`, `css/`, `js/*.js` come ES modules con `<script type="module">`). Nessun `package.json`, nessun bundler, nessun transpiler. (R)
- **WA-02** Il deploy consiste nel push su GitHub Pages (cartella `webapp/` o branch dedicato); `README` della web app (in italiano) descrive i passi per un principiante. (R)
- **WA-03** Tutti i percorsi sono relativi (niente `/` iniziale) cosi' l'app funziona sotto `https://utente.github.io/repo/`. (R)
- **WA-04** All'avvio l'app rileva `navigator.bluetooth`; se assente mostra un messaggio chiaro in italiano ("Apri questa pagina in Bluefy") e disabilita il pulsante Connetti. (M)
- **WA-05** `navigator.bluetooth.requestDevice()` e' chiamata **solo** dentro un handler di tap/click (gesto utente) e mai al caricamento della pagina. (R, M)
- **WA-06** `requestDevice` filtra per il servizio VBT (`filters: [{services:[SERVICE_UUID]}]`, eventualmente `namePrefix`) e dichiara in `optionalServices` ogni servizio letto dopo (il protocollo v1 non espone Battery/Device Information: batteria in `Status.battery_pct`, quindi basta il servizio VBT). Senza `optionalServices` l'accesso fallirebbe. (R)
- **WA-07** Nessuna funzione in background: Bluefy sospende la pagina a schermo spento / app in secondo piano. L'app richiede il Screen Wake Lock (`navigator.wakeLock`) durante una serie, se disponibile, e mostra un avviso se la connessione cade in background. (M)
- **WA-08** Nessun requisito sulla MTU negoziata: tutti i payload di notifica stanno in 20 byte (MTU predefinita 23). La decodifica verifica la lunghezza e scarta/segnala payload piu' corti del previsto. (T)
- **WA-09** Decodifica con `DataView` e `littleEndian = true` esplicito su ogni lettura multi-byte. (T, R)

## 2. Connessione e riconnessione

- **WA-10** Pulsante grande "Connetti" apre il selettore Bluetooth, connette al GATT, scopre servizio e caratteristiche, legge versione protocollo e stato, si sottoscrive alle notifiche (`startNotifications`). (M)
- **WA-11** Se la versione di protocollo del firmware e' diversa da quella supportata, l'app mostra "Firmware non compatibile (fw X, app Y)" e non avvia la sessione. (T con payload simulato)
- **WA-12** Stato connessione sempre visibile (Disconnesso / Connessione / Connesso + batteria %) in una barra in alto. (M)
- **WA-13** Alla disconnessione involontaria (`gattserverdisconnected`) l'app tenta la riconnessione automatica allo **stesso** dispositivo (`device.gatt.connect()` senza nuovo selettore) con backoff (1 s, 2 s, 4 s, max 5 tentativi) e poi mostra il pulsante manuale "Riconnetti". Il tentativo manuale e' un gesto utente. (M)
- **WA-14** Dopo ogni (ri)connessione l'app esegue la risincronizzazione: legge lo stato corrente (id serie, numero ripetizioni) e richiede al dispositivo le ripetizioni mancanti; le ripetizioni gia' ricevute non vengono duplicate (chiave `setSeq + repIndex`). (T deduplica, M)
- **WA-15** Il pulsante "Disconnetti" chiude pulito il GATT e rimuove i listener; ripetere connetti/disconnetti 10 volte non accumula listener (verificabile contando gli handler). (R, M)
- **WA-16** Se il dispositivo e' gia' collegato ad un altro client, o la connessione fallisce, l'errore e' mostrato in italiano senza lasciare l'interfaccia bloccata. (M)

## 3. Visualizzazione live delle ripetizioni

- **WA-20** Alla ricezione di una ripetizione la schermata mostra, in carattere molto grande (almeno 30% dell'altezza schermo per il valore principale): **velocita' media concentrica (MCV)** in m/s con 2 decimali, numero ripetizione, e in dimensione minore velocita' di picco, ROM (cm) e durata (s). (M)
- **WA-21** Mostra la **perdita di velocita'** % della serie rispetto alla ripetizione migliore e una barra/colore: verde sotto la soglia * 0.5, giallo fino alla soglia, rosso a soglia superata. Il colore non e' l'unico indicatore (anche testo). (M)
- **WA-22** Elenco delle ripetizioni della serie corrente (scorrevole, ultima in alto) con MCV e perdita. (M)
- **WA-23** Tutti i target touch (pulsanti) sono almeno 56x56 px CSS, distanti almeno 8 px, usabili con mani sudate; nessuna azione distruttiva a un solo tap senza conferma o annulla (es. "Elimina serie" chiede conferma). (M)
- **WA-24** Contrasto elevato (tema scuro predefinito, rapporto >= 7:1 per i numeri grandi), layout verticale e orizzontale, nessuno scroll orizzontale a 360 px di larghezza. (M)
- **WA-25** La latenza tra la notifica BLE e l'aggiornamento a schermo e' inferiore a 100 ms (nessun calcolo pesante nel handler; storage asincrono). (M)

## 4. Gestione delle serie

- **WA-30** L'utente puo' avviare e terminare una serie con un pulsante grande (invia `START_SET` / `END_SET` al dispositivo); gli eventi di serie originati dal dispositivo (inizio/fine automatici) aggiornano comunque l'interfaccia. (M)
- **WA-31** Prima o durante la serie l'utente inserisce **esercizio**, **carico (kg)** con passi +/- (default 2.5 kg, tap lungo ripete) e puo' correggerlo a fine serie. Il carico viene salvato con la serie. (M)
- **WA-32** Ogni serie salvata contiene: id, timestamp inizio/fine, esercizio, carico, soglia di perdita usata, ripetizioni (con tutti i campi del protocollo), motivo di fine serie. (T)
- **WA-33** Una sessione (allenamento) raggruppa le serie della giornata; si avvia automaticamente alla prima serie e si chiude con "Fine allenamento" o dopo 3 ore di inattivita'. (T)
- **WA-34** Il tasto "Tara / Azzera sensore" invia `TARE`, mostra l'esito e resta disabilitato durante una serie. (M)
- **WA-35** La soglia di perdita di velocita' (default 20%, intervallo 5-50% a passi di 5) e' modificabile nelle impostazioni, salvata localmente e inviata al dispositivo a ogni connessione (`SET_THRESHOLD`). (M)

## 5. Allarme di perdita di velocita'

- **WA-40** Quando la perdita di velocita' di una ripetizione raggiunge o supera la soglia, l'app emette un **beep** (Web Audio, `OscillatorNode`) e una **vibrazione** (`navigator.vibrate` se disponibile; su iOS spesso assente, quindi non obbligatoria) e colora lo schermo di rosso. L'audio viene sbloccato al primo tap (Connetti) per rispettare le policy autoplay. (M)
- **WA-41** L'allarme scatta una sola volta per serie al primo superamento, con opzione "ripeti a ogni rep sopra soglia". (T)
- **WA-42** L'allarme viene gestito anche se il flag `thresholdExceeded` del firmware e' assente: il client ricalcola la perdita da MCV e miglior rep (`session.js`), e in caso di discrepanza prevale il valore del firmware, che e' registrato come fonte di verita'. (T)
- **WA-43** Il volume/attivazione del suono e' un'impostazione (on/off) con pulsante di prova. (M)

## 6. Storico e archiviazione

- **WA-50** Persistenza locale con **IndexedDB** (API nativa, senza librerie): supporta molti dati, scritture asincrone, oggetti strutturati e indici per data/esercizio; `localStorage` e' sincrono, limitato (~5 MB) e solo stringhe, quindi usato solo per impostazioni semplici (soglia, suono, ultimo dispositivo). Object store: `sessions`, `sets` (indice `exercise`, `startedAt`). (R)
- **WA-51** Ogni serie viene salvata **alla fine della serie** e anche in modo incrementale a ogni ripetizione (bozza), cosi' un crash o chiusura della scheda non perde la serie. (T, M)
- **WA-52** iOS puo' cancellare i dati del sito (ITP: dopo ~7 giorni senza uso in Safari; le app aggiunte alla Home sono meno colpite; Bluefy ha storage proprio). L'app chiama `navigator.storage.persist()` se disponibile, e mostra un promemoria "ultimo backup: N giorni fa" dopo 7 giorni senza esportazione. (M)
- **WA-53** **Esporta** tutto lo storico in **JSON** (backup completo, reimportabile) e in **CSV** (una riga per ripetizione: data, sessione, esercizio, carico, serie, rep, MCV, picco, ROM, durata, perdita). Download tramite `Blob` + link `download`, oppure Web Share API (`navigator.share({files})`) se il download non e' disponibile. (T per formato, M su Bluefy)
- **WA-54** **Importa** un backup JSON (merge senza duplicati per id). (T)
- **WA-55** Schermata Storico: elenco sessioni per data, dettaglio serie/rep, eliminazione con conferma, filtro per esercizio. (M)
- **WA-56** Schema con numero di versione (`schemaVersion`) e migrazioni; l'apertura di un database piu' vecchio non perde dati. (T)
- **WA-57** Se IndexedDB non e' disponibile (modalita' privata), l'app funziona in memoria e avvisa che i dati non verranno salvati. (M)

## 7. Profilo carico-velocita' e stima 1RM

- **WA-60** Per un esercizio, la schermata Profilo usa un punto per carico distinto, preso dalla MCV della **ripetizione migliore** (o media delle prime 2) di ogni serie; servono almeno 3 carichi distinti (consigliati 4+, con almeno 15 kg di intervallo) altrimenti mostra "dati insufficienti". (T)
- **WA-61** Regressione lineare ai minimi quadrati velocita' = a + b * carico, con coefficiente R^2 mostrato; avviso se R^2 < 0.90. (T con dati noti)
- **WA-62** **1RM stimato** = carico per cui la velocita' prevista eguaglia la velocita' minima di soglia (MVT) dell'esercizio. Valori predefiniti modificabili: squat 0.30, panca 0.17, stacco 0.15, military press 0.20 m/s, generico 0.25. Il valore e' indicato come stima con intervallo di incertezza semplice (derivato dall'errore standard della regressione) e viene rifiutato se la pendenza non e' negativa. (T)
- **WA-63** Il grafico carico-velocita' (SVG/canvas inline, senza librerie) mostra punti, retta e punto 1RM. (M)
- **WA-64** Dati inseriti dall'utente: il carico di ogni serie e' obbligatorio per includerla nel profilo; le serie senza carico sono escluse con un indicatore. (T)
- **WA-65** Dato un carico, l'app suggerisce la velocita' attesa e viceversa (carico a una velocita' obiettivo), usando la retta. (T)

## 8. Offline e PWA

- **WA-70** Una volta caricata, l'app funziona senza rete (il BLE non richiede Internet): un service worker (`sw.js`) pre-memorizza in cache tutti i file statici (strategia cache-first con versione della cache). (M: modalita' aereo + riavvio)
- **WA-71** `manifest.webmanifest` con nome, icone e `display: standalone` per "Aggiungi a Home"; il suo uso e' **facoltativo**: l'app funziona anche senza service worker e se la registrazione fallisce non blocca nulla. (R)
- **WA-72** Quando viene pubblicata una nuova versione, l'app mostra "Aggiornamento disponibile, ricarica" invece di aggiornarsi nel mezzo di una serie. (M)

## 9. Struttura del codice e qualita'

- **WA-80** Moduli: `protocol.js` (codifica/decodifica pura, nessun DOM), `ble.js` (Web Bluetooth, nessun DOM), `session.js` (modello e calcoli, puri), `storage.js` (IndexedDB e export), `lvprofile.js` (regressione, pura), `ui.js` (DOM), `main.js` (collega tutto). I moduli puri sono importabili in Node senza modifiche cosi' da poterli testare. (R)
- **WA-81** `protocol.js` ha una modalita' di test con payload d'esempio (vettori di test copiati da `docs/ble-protocol.md`) e un simulatore (`js/simulator.js`) che emette ripetizioni finte, cosi' l'interfaccia si prova senza sensore (`?demo=1`). (T, M)
- **WA-82** Gli errori non gestiti vengono mostrati in un pannello "Log" visibile (utile su iPhone senza console). (M)
- **WA-83** Tutti i testi dell'interfaccia sono in italiano e raccolti in un unico oggetto per facilitarne la modifica. (R)
- **WA-84** Unita' interne: velocita' in m/s (float), ROM in metri, durata in secondi, carico in kg; la conversione dalle unita' intere del protocollo (mm/s, mm, ms) avviene solo in `protocol.js`. (T)
