# Il blog di Meteo Radar

Ogni mattina alle 8, ora italiana, GitHub esegue uno script che:

1. legge i feed degli istituti elencati in `fonti.json`;
2. sceglie una notizia a tema meteo, clima, atmosfera, terremoti o mare, **mai usata prima**;
3. si scarica il testo della **fonte originale** (il comunicato dell'istituto, non l'articolo di un giornale);
4. da quel testo fa scrivere un articolo **inedito in italiano**, dai 700 ai 1500 parole a seconda di quanta sostanza c'è;
5. **controlla che ogni numero e ogni data dell'articolo esistano davvero nella fonte**: se salta fuori una cifra dal nulla, l'articolo viene buttato e si riprova con un'altra notizia;
6. genera la copertina e fino a due immagini interne, in WebP;
7. salva tutto e aggiorna `indice.json`, che è il file che l'app va a leggere.

Il tuo computer può stare spento. La chiave OpenAI non esce mai da GitHub e non finisce dentro l'app.

---

## Come si mette in piedi (dieci minuti, una volta sola)

**1 · Crea il repository.** Su GitHub: *New repository* → nome **esattamente `meteo-radar-blog`** → **Public** (serve pubblico, altrimenti l'app non può leggere i file) → *Create*.

> Il nome deve essere quello, lettera per lettera: l'app cerca gli articoli in `Robertobob5/meteo-radar-blog`, e quell'indirizzo è già scritto dentro il file dell'app. Se un giorno vuoi cambiarlo, non serve rifare l'app: tieni premuto per due secondi il titolo **Dal blog** in fondo alla schermata e puoi correggerlo lì.

**2 · Carica questi file.** Trascina tutto il contenuto di questa cartella nella pagina del repository (*Add file* → *Upload files*), compresa la cartella nascosta `.github`. Se il trascinamento perde `.github`, creala a mano: *Add file* → *Create new file* → scrivi `.github/workflows/articolo.yml` e incolla dentro il contenuto del file.

**3 · Metti la chiave in cassaforte.** Nel repository: *Settings* → *Secrets and variables* → *Actions* → *New repository secret*
- Name: `OPENAI_API_KEY`
- Secret: la tua chiave (quella che comincia con `sk-`)

Da qui in poi la chiave è cifrata: non compare nei log, non si può rileggere, nemmeno tu.

**4 · Dai il permesso di scrivere.** *Settings* → *Actions* → *General* → in fondo, *Workflow permissions* → **Read and write permissions** → *Save*. Senza questo lo script scrive l'articolo ma non riesce a pubblicarlo.

**5 · Prova subito.** Scheda *Actions* → *Articolo del giorno* → *Run workflow* → spunta **forza** → *Run*. In due o tre minuti dovresti vedere apparire `indice.json` e i primi file in `articoli/` e `immagini/`.

**6 · Niente da fare nell'app.** L'indirizzo è già dentro Meteo Radar e non si vede da nessuna parte. Appena il primo articolo è online, compare da solo in fondo alla schermata; se vuoi anticipare, nelle impostazioni alla voce *Blog* c'è il pulsante **Aggiorna**.

---

## Quanto costa

Circa **un euro e mezzo al mese**: qualche centesimo di testo e mezzo centesimo per immagine, un articolo al giorno. GitHub Actions è gratuito sui repository pubblici.

Se vuoi spendere meno, in *Settings → Secrets and variables → Actions → Variables* puoi aggiungere:

| Variabile | Cosa fa | Esempio |
|---|---|---|
| `MODELLO_TESTO` | quale modello scrive | `gpt-5.6-luna` (il più economico) |
| `MODELLO_IMMAGINI` | quale genera le immagini | `gpt-image-2` |
| `MAX_IMMAGINI_INTERNE` | quante immagini oltre alla copertina | `0` per la sola copertina |

I nomi dei modelli OpenAI cambiano ogni pochi mesi: quando succede, cambi la variabile qui senza toccare il codice.

---

## Le fonti

Stanno in `fonti.json`. Sono tutte **fonti primarie**: istituti che pubblicano i propri comunicati. Non giornali — riscrivere il pezzo di un giornalista, anche con parole diverse, resta prendere il suo lavoro.

Per aggiungerne una basta una riga. Per spegnerla senza cancellarla: `"attiva": false`.

Dopo ogni modifica, dal tuo computer:

```
node prova-fonti.mjs --leggi
```

Ti dice quali feed rispondono, quante notizie portano e quali sarebbero le candidate di oggi. Non chiama OpenAI e non spende niente.

---

## Se qualcosa non va

**Non esce nessun articolo.** Guarda in *Actions* l'ultima esecuzione. Le tre righe che contano:

- `Nessuna notizia nuova` → i feed non hanno pubblicato niente di nuovo a tema. Normale, capita.
- `CONTROLLO NUMERI` → il modello aveva inventato delle cifre e l'articolo è stato buttato. **Sta funzionando come deve.**
- `Manca OPENAI_API_KEY` → il segreto non è stato salvato, o ha un nome diverso.

**Un articolo non ti convince.** Cancella il suo file da `articoli/`, le sue immagini da `immagini/` e la sua riga da `indice.json`. Sparisce dai telefoni di tutti al successivo aggiornamento.

**Vuoi un articolo adesso.** *Actions* → *Run workflow* con la spunta *forza*.

---

## Una cosa da sapere, e da dire

Gli articoli li scrive un'intelligenza artificiale a partire dalle fonti citate. In fondo a ogni articolo l'app lo dichiara apertamente, e mostra il link alla fonte.

Non è una formalità burocratica: chi legge ha il diritto di sapere come è nato quello che sta leggendo, e un testo dichiarato per quello che è non diventa mai un falso — nemmeno il giorno in cui contiene un errore.

Il controllo sui numeri riduce di molto il rischio di invenzioni, ma non lo azzera: il modello potrebbe sbagliare un nesso o una sfumatura pur senza inventare cifre. Se un pezzo ti sembra storto, il link alla fonte è lì apposta.

## Prove

```
node prova/finto-openai.mjs
```

Mette al posto di internet e di OpenAI dei finti servizi e verifica 39 comportamenti, fra cui il più importante: che un articolo con i numeri inventati **non venga pubblicato** e non faccia nemmeno spendere per le immagini.
