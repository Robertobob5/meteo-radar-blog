/* Banco di prova del generatore: niente OpenAI vero, niente internet vero.
   Si mettono al posto di fetch un finto servizio e dei finti feed, poi si
   guarda se il generatore fa quello che deve — soprattutto se BUTTA gli
   articoli con i numeri inventati.

   Uso: node prova/finto-openai.mjs                                        */

import fs from 'node:fs/promises';
import path from 'node:path';

const QUI = path.dirname(new URL(import.meta.url).pathname);
const RADICE = path.join(QUI, '..');
const BANCO = path.join(QUI, 'banco');

let passate = 0, fallite = 0;
const ok = (c, cosa) => { if (c) { passate++; console.log('  ✔ ' + cosa); } else { fallite++; console.log('  ✘ FALLITA: ' + cosa); } };

/* ─── il testo della fonte finta: i numeri che si possono usare sono questi ─── */
const FONTE_HTML = `<html><body><article>
<h1>I temporali come sismografi: cosa raccontano i "thunderquakes"</h1>
<p>Un gruppo di ricercatori ha misurato le vibrazioni che i fulmini producono nel terreno.
Il fenomeno, chiamato thunderquake, si osserva quando l'onda sonora del tuono colpisce il suolo
e lo fa oscillare per qualche istante.</p>
<p>Nell'esperimento sono state analizzate 173 scariche registrate da una rete di 42 stazioni
sismiche installate a profondità comprese fra 3 e 45 metri. Le vibrazioni misurate hanno
raggiunto un'ampiezza massima di 1,8 micron al secondo, con energie confrontabili a quelle
di un terremoto di magnitudo 1,2.</p>
<p>Il segnale si propaga per circa 250 metri attorno al punto in cui il fulmine tocca terra e
si esaurisce in meno di 4 secondi. Secondo gli autori, questo permette di usare i temporali
come una sorgente naturale e gratuita per studiare i primi metri di sottosuolo, dove le onde
si propagano a velocità comprese fra 180 e 400 metri al secondo.</p>
<p>La tecnica è stata provata in tre siti diversi nel corso di due stagioni temporalesche e
i risultati sono stati pubblicati su una rivista di geofisica.</p>
</article></body></html>`;

const FEED = `<?xml version="1.0"?><rss version="2.0"><channel>
<title>INGV Terremoti</title>
<item>
  <title>I temporali come sismografi: cosa raccontano i thunderquakes</title>
  <link>https://esempio.test/thunderquakes</link>
  <description>Uno studio misura le vibrazioni sismiche prodotte dai fulmini e propone di usare i temporali per esplorare il sottosuolo. Un lavoro che unisce meteorologia e sismologia.</description>
  <pubDate>${new Date(Date.now() - 3600000).toUTCString()}</pubDate>
</item>
<item>
  <title>Notizia senza sostanza sul clima</title>
  <link>https://esempio.test/corta</link>
  <description>Poche righe di clima e nulla più.</description>
  <pubDate>${new Date(Date.now() - 7200000).toUTCString()}</pubDate>
</item>
</channel></rss>`;

/* ─── articoli finti che il "modello" restituisce ─── */
const BUONO = {
  titolo: "I temporali come sismografi naturali",
  sottotitolo: "Le vibrazioni dei fulmini nel terreno diventano uno strumento per esplorare il sottosuolo",
  categoria: "Ricerca",
  copertina: "A thunderstorm over a plain with seismic wave rings in the ground",
  copertinaAlt: "Un temporale su una pianura con onde che si propagano nel terreno",
  blocchi: [
    { tipo: "paragrafo", testo: "Quando un fulmine tocca terra, il tuono non si limita a farsi sentire nell'aria: fa vibrare anche il suolo. Il fenomeno ha un nome, thunderquake, e i ricercatori hanno provato a misurarlo." },
    { tipo: "sottotitolo", testo: "Come si misura un tuono nel terreno" },
    { tipo: "paragrafo", testo: "Nell'esperimento sono state analizzate 173 scariche, registrate da 42 stazioni sismiche interrate fra 3 e 45 metri di profondità. L'ampiezza massima delle vibrazioni ha toccato 1,8 micron al secondo." },
    { tipo: "immagine", prompt: "Cross-section illustration of soil layers with seismic sensors", alt: "Sezione del terreno con i sensori", didascalia: "I sensori sono interrati fino a 45 metri." },
    { tipo: "paragrafo", testo: "L'energia in gioco è paragonabile a quella di un terremoto di magnitudo 1,2, un valore che nessuno percepisce ma che gli strumenti registrano senza difficoltà. Il segnale si spegne in meno di 4 secondi e non si allontana oltre 250 metri dal punto d'impatto." },
    { tipo: "riquadro", titolo: "In breve", testo: "I temporali diventano una sorgente gratuita per studiare i primi metri di sottosuolo, dove le onde viaggiano fra 180 e 400 metri al secondo." }
  ]
};

const BUGIARDO = JSON.parse(JSON.stringify(BUONO));
BUGIARDO.blocchi[2].testo = "Nell'esperimento sono state analizzate 4200 scariche, registrate da 137 stazioni sismiche, con vibrazioni fino a 96 micron al secondo.";

/* ─── il finto mondo ─── */
function montaFintoMondo(articolo) {
  globalThis.fetch = async (url, opzioni = {}) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions'))
      return risposta(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(articolo) } }] }));
    if (u.includes('api.openai.com/v1/images/generations'))
      return risposta(200, JSON.stringify({ data: [{ b64_json: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }] }));
    if (u.includes('/feed') || u.includes('rss') || u.includes('esempio.test/lista'))
      return risposta(200, FEED, 'application/rss+xml');
    if (u.includes('esempio.test/thunderquakes')) return risposta(200, FONTE_HTML, 'text/html');
    if (u.includes('esempio.test/corta')) return risposta(200, '<html><body><p>Tre righe.</p></body></html>', 'text/html');
    return risposta(404, 'non trovato');
  };
}
function risposta(stato, corpo, tipo = 'application/json') {
  return {
    ok: stato >= 200 && stato < 300, status: stato,
    text: async () => corpo, json: async () => JSON.parse(corpo),
    headers: new Map([['content-type', tipo]])
  };
}

async function pulisci() {
  await fs.rm(BANCO, { recursive: true, force: true });
  await fs.mkdir(path.join(BANCO, 'articoli'), { recursive: true });
  await fs.mkdir(path.join(BANCO, 'immagini'), { recursive: true });
  await fs.copyFile(path.join(RADICE, 'genera.mjs'), path.join(BANCO, 'genera.mjs'));
  await fs.writeFile(path.join(BANCO, 'fonti.json'), JSON.stringify({
    fonti: [{ nome: 'INGV Terremoti', url: 'https://esempio.test/feed', lingua: 'it', attiva: true }],
    parole_chiave: ['temporal', 'fulmin', 'terremot', 'sismic', 'clima', 'sottosuolo', 'thunderquake']
  }, null, 1));
}

/* il generatore viene caricato ogni volta da capo, così legge la cartella del
   banco e rilegge gli argomenti; poi si aspetta che abbia davvero finito */
async function carica(argomenti = []) {
  process.argv = ['node', 'prova', ...argomenti];
  return await import(path.join(BANCO, 'genera.mjs') + '?v=' + Math.random());
}
async function esegui(argomenti = []) {
  const righe = [];
  const veroLog = console.log;
  const modulo = await carica(argomenti);
  console.log = (...a) => righe.push(a.join(' '));
  try { await modulo.main(); }
  finally { console.log = veroLog; }
  return righe.join('\n');
}

const leggiIndice = async () => {
  try { return JSON.parse(await fs.readFile(path.join(BANCO, 'indice.json'), 'utf8')); }
  catch { return { articoli: [] }; }
};

/* ══════════ 1 · l'articolo buono viene pubblicato ══════════ */
console.log('\n══ 1 · una fonte vera, un articolo onesto ══');
{
  await pulisci();
  montaFintoMondo(BUONO);
  const uscita = await esegui(['--forza']);
  const indice = await leggiIndice();
  ok(/PUBBLICATO/.test(uscita), 'il generatore pubblica' + (/PUBBLICATO/.test(uscita) ? '' : ' → ' + uscita.slice(-300)));
  ok(/controllo numeri superato/.test(uscita), 'e dichiara di aver superato il controllo sui numeri');
  ok(indice.articoli.length === 1, 'l\'indice ha un articolo (' + indice.articoli.length + ')');

  const a = indice.articoli[0];
  ok(a && a.titolo === BUONO.titolo, 'col titolo giusto → ' + (a ? a.titolo : '?'));
  ok(a && /^\d{4}-\d{2}-\d{2}$/.test(a.data), 'e la data di oggi → ' + (a ? a.data : '?'));
  ok(a && a.fonteUrl === 'https://esempio.test/thunderquakes', 'con l\'indirizzo della fonte, per non riusarla domani');

  const pieno = JSON.parse(await fs.readFile(path.join(BANCO, a.file), 'utf8'));
  ok(pieno.fonte && pieno.fonte.nome === 'INGV Terremoti' && pieno.fonte.url, 'l\'articolo porta con sé la fonte citata');
  ok(pieno.parole > 40, 'ha un corpo di testo (' + pieno.parole + ' parole)');
  ok(pieno.minuti >= 2, 'e il tempo di lettura → ' + pieno.minuti + ' min');
  ok(pieno.copertina && pieno.copertina.endsWith('.webp'), 'la copertina è un file webp → ' + pieno.copertina);
  const interne = pieno.blocchi.filter(b => b.tipo === 'immagine');
  ok(interne.length === 1 && interne[0].file.endsWith('.webp'), 'e l\'immagine interna pure');
  ok(interne.every(b => !b.prompt), 'le descrizioni per il generatore non finiscono nel file pubblicato');
  const file = await fs.readdir(path.join(BANCO, 'immagini'));
  ok(file.length === 2, 'sul disco ci sono davvero due immagini (' + file.join(', ') + ')');
  ok(pieno.generato && pieno.generato.testo, 'e resta scritto quale modello l\'ha generato → ' + JSON.stringify(pieno.generato));
}

/* ══════════ 2 · l'articolo con i numeri inventati viene buttato ══════════ */
console.log('\n══ 2 · numeri che nella fonte non ci sono: si butta ══');
{
  await pulisci();
  montaFintoMondo(BUGIARDO);
  const uscita = await esegui(['--forza']);
  const indice = await leggiIndice();
  ok(/CONTROLLO NUMERI/.test(uscita), 'il controllo scatta');
  ok(/4200|137|96/.test(uscita), 'e dice quali cifre non tornano → ' + (uscita.match(/→ .*/) || [''])[0].slice(0, 70));
  ok(!/PUBBLICATO/.test(uscita), 'l\'articolo NON viene pubblicato');
  ok(indice.articoli.length === 0, 'l\'indice resta vuoto (' + indice.articoli.length + ')');
  const file = await fs.readdir(path.join(BANCO, 'immagini'));
  ok(file.length === 0, 'e non si spende un centesimo in immagini per un pezzo da buttare');
}

/* ══════════ 3 · non si pubblica due volte lo stesso giorno ══════════ */
console.log('\n══ 3 · un articolo al giorno, non due ══');
{
  await pulisci();
  montaFintoMondo(BUONO);
  await esegui(['--forza']);
  const uscita = await esegui([]);
  const indice = await leggiIndice();
  ok(/c'è già/.test(uscita), 'al secondo giro si ferma subito → "' + uscita.split('\n')[0] + '"');
  ok(indice.articoli.length === 1, 'e l\'articolo resta uno solo');
}

/* ══════════ 4 · la stessa notizia non si riusa ══════════ */
console.log('\n══ 4 · la notizia di ieri non si ricicla ══');
{
  const indice = await leggiIndice();
  indice.articoli[0].data = '2020-01-01';                 /* fingo che sia di ieri */
  await fs.writeFile(path.join(BANCO, 'indice.json'), JSON.stringify(indice, null, 1));
  montaFintoMondo(BUONO);
  const uscita = await esegui(['--forza']);
  ok(/Nessuna notizia nuova|magra|Nessuna notizia ha superato/.test(uscita),
     'la stessa fonte non viene ripresa → "' + uscita.split('\n').slice(-1)[0].slice(0, 80) + '"');
  const dopo = await leggiIndice();
  ok(dopo.articoli.length === 1, 'e non nasce un doppione');
}

/* ══════════ 5 · senza chiave non si combina niente (e non si spende) ══════════ */
console.log('\n══ 5 · senza chiave si ferma prima di spendere ══');
{
  await pulisci();
  montaFintoMondo(BUONO);
  const chiave = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  const vecchioExit = process.exit;
  let uscito = null;
  process.exit = (c) => { uscito = c; throw new Error('__uscita__'); };
  let uscita = '';
  try { uscita = await esegui(['--forza']); } catch (e) { if (!/__uscita__/.test(e.message)) throw e; }
  process.exit = vecchioExit;
  if (chiave) process.env.OPENAI_API_KEY = chiave;
  ok(uscito === 1, 'esce con un errore vero, così GitHub lo segnala');
  const indice = await leggiIndice();
  ok(indice.articoli.length === 0, 'e non pubblica niente');
}

/* ══════════ 6 · il controllo numeri, caso per caso ══════════ */
console.log('\n══ 6 · il controllo numeri non è né cieco né isterico ══');
{
  await pulisci();
  const { controllaNumeri } = await carica([]);
  const anno = new Date().getFullYear();
  const casi = [
    { n: 'la cifra esatta della fonte passa',              t: 'Sono state analizzate 173 scariche.',            pulito: true },
    { n: 'un arrotondamento onesto passa (1,8 → 2)',       t: 'Vibrazioni di quasi 2 micron al secondo.',       pulito: true },
    { n: 'i numeri piccoli passano ("in 3 siti")',         t: 'La prova si è svolta in 3 siti diversi.',        pulito: true },
    { n: 'l\'anno in corso passa',                         t: 'Nel ' + anno + ' la ricerca è proseguita.',      pulito: true },
    { n: 'la profondità della fonte passa',                t: 'Sensori interrati fino a 45 metri.',             pulito: true },
    { n: 'una cifra inventata NON passa',                  t: 'Sono state analizzate 9999 scariche.',           pulito: false },
    { n: 'una percentuale inventata NON passa',            t: 'Accade nell\'87% dei casi.',                     pulito: false },
    { n: 'una magnitudo gonfiata NON passa',               t: 'Come un terremoto di magnitudo 6,4.',            pulito: false },
    { n: 'una distanza inventata NON passa',               t: 'Il segnale corre per 1800 metri.',               pulito: false }
  ];
  const fonte = FONTE_HTML.replace(/<[^>]+>/g, ' ');
  for (const c of casi) {
    const sospetti = controllaNumeri({ titolo: '', sottotitolo: '', blocchi: [{ testo: c.t }] }, fonte);
    const pulito = sospetti.length === 0;
    ok(pulito === c.pulito, c.n + (pulito === c.pulito ? '' : ' → sospetti: ' + JSON.stringify(sospetti)));
  }
}

/* ══════════ 7 · i feed in formato Atom, non solo RSS ══════════ */
console.log('\n══ 7 · legge anche i feed in formato Atom ══');
{
  const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
 <title>Istituto di prova</title>
 <entry>
  <title>I temporali come sismografi: cosa raccontano i thunderquakes</title>
  <link rel="alternate" type="text/html" href="https://esempio.test/thunderquakes"/>
  <summary>Uno studio misura le vibrazioni sismiche prodotte dai fulmini e propone di usare i temporali per esplorare il sottosuolo, unendo meteorologia e sismologia.</summary>
  <updated>${new Date(Date.now() - 3600000).toISOString()}</updated>
 </entry>
</feed>`;
  await pulisci();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions'))
      return risposta(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(BUONO) } }] }));
    if (u.includes('api.openai.com/v1/images/generations'))
      return risposta(200, JSON.stringify({ data: [{ b64_json: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }] }));
    if (u.includes('/feed')) return risposta(200, ATOM, 'application/atom+xml');
    if (u.includes('esempio.test/thunderquakes')) return risposta(200, FONTE_HTML, 'text/html');
    return risposta(404, 'non trovato');
  };
  const uscita = await esegui(['--forza']);
  const indice = await leggiIndice();
  ok(/PUBBLICATO/.test(uscita), 'anche con Atom l\'articolo esce');
  ok(indice.articoli.length === 1 && indice.articoli[0].fonteUrl === 'https://esempio.test/thunderquakes',
     'e l\'indirizzo viene preso dall\'attributo href → ' + (indice.articoli[0] || {}).fonteUrl);
}

/* ══════════ 8 · fonte irraggiungibile: si passa oltre senza schiantare ══════════ */
console.log('\n══ 8 · una fonte che non risponde non ferma il blog ══');
{
  await pulisci();
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions'))
      return risposta(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(BUONO) } }] }));
    if (u.includes('api.openai.com/v1/images/generations'))
      return risposta(200, JSON.stringify({ data: [{ b64_json: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }] }));
    if (u.includes('/feed')) throw new Error('rete giù');
    return risposta(404, 'non trovato');
  };
  let scoppiato = false;
  let uscita = '';
  try { uscita = await esegui(['--forza']); } catch (e) { scoppiato = true; }
  ok(!scoppiato, 'il generatore non si schianta');
  ok(/feed non raggiungibile/.test(uscita), 'lo dice nel resoconto');
  ok(/Nessuna notizia/.test(uscita), 'e conclude che oggi non si pubblica');
}


/* ══════════ 9 · varietà (10 settembre 2026): turno delle fonti, parole d'ufficio, vicinanza di tema ══════════ */
console.log('\n══ 9 · varietà: turno delle fonti, parole d\'ufficio, vicinanza di tema ══');
{
  await pulisci();
  const { punteggio, turnoFonti, vicinanzaTema } = await carica([]);
  const cfg = JSON.parse(await fs.readFile(path.join(RADICE, 'fonti.json'), 'utf8'));
  const noaa = cfg.fonti.find(f => f.nome === 'NOAA'), nasa = cfg.fonti.find(f => f.nome === 'NASA Science'), clima = cfg.fonti.find(f => f.nome === 'NOAA Climate.gov');
  ok(noaa && noaa.ente === 'NOAA' && noaa.peso === -3 && clima && clima.ente === 'NOAA', 'in fonti.json i feed NOAA hanno lo stesso ente e il feed generale parte da −3');
  ok(Array.isArray(cfg.parole_burocratiche) && cfg.parole_burocratiche.length > 50 && cfg.turno_giorni === 2 && cfg.max_per_ente_settimana === 2, 'e ci sono le parole d\'ufficio, il turno di due giorni e il tetto di due a settimana');

  /* le quattro notizie NOAA uscite davvero, contro una notizia di scienza vera */
  const fresca = new Date(Date.now() - 3600000).toUTCString();
  const voce = (titolo, sommario, fonte) => ({ titolo, sommario, quando: fresca, url: 'https://esempio.test/' + titolo.slice(0, 10), fonte });
  const p = v => punteggio(v, cfg.parole_chiave, cfg.parole_escluse, cfg.parole_burocratiche);
  const istituto = voce('NOAA names Mississippi State University to lead new institute for Gulf of America research',
    'NOAA today announced that Mississippi State University will lead a new cooperative institute focused on ocean, coastal and climate research in the Gulf of America, with funding of up to $30 million over five years.', noaa);
  const beaufort = voce('NOAA to rebuild historic sea lab in Beaufort, North Carolina',
    'NOAA announced plans to rebuild its historic marine laboratory in Beaufort, damaged by hurricane winds and flooding. The facility supports ocean and fisheries research.', noaa);
  const mesonet = voce('NOAA boosts weather data collection with new Mesonet contract',
    'NOAA has awarded a contract to expand the collection of surface weather observations from mesonet networks, improving forecast models with more temperature and wind data.', noaa);
  const neve = voce('Rare widespread snow in the Atacama Desert',
    'Satellite images show snow blanketing parts of the Atacama Desert after a series of winter storms brought cold air and precipitation to the driest place on Earth.', nasa);
  const nino = voce('September 2026 ENSO update: El Niño strengthens',
    'Sea surface temperatures in the tropical Pacific continued to warm in August, and forecasters expect a strong El Niño by winter, with impacts on rain and temperature patterns.', clima);
  ok(p(istituto) <= 0, 'il nuovo istituto NOAA (nomina, istituto, finanziamenti) scende a zero o sotto → ' + p(istituto));
  ok(p(beaufort) <= 0, 'il laboratorio da ricostruire pure → ' + p(beaufort));
  ok(p(mesonet) < p(neve), 'il contratto Mesonet vale meno della neve nell\'Atacama (' + p(mesonet) + ' contro ' + p(neve) + ')');
  ok(p(neve) >= 9 && p(nino) >= 9, 'le notizie di scienza restano alte: Atacama ' + p(neve) + ', El Niño ' + p(nino));
  ok(p(voce('NASA\'s SWOT satellite maps river heights', 'The satellite measured the height of rivers and lakes, showing floods and drought.', nasa)) > 0, 'un titolo che comincia con "NASA\'s" perde tre punti ma resta in gara se ha sostanza');

  /* il turno delle fonti, sull'indice vero del blog (10 settembre 2026) */
  /* l'indice vero del blog al 10 settembre 2026 (solo data, fonte e titoli) */
  const indice = { articoli: [
   {
    "data": "2026-09-10",
    "fonte": "NOAA",
    "titolo": "Un nuovo istituto di ricerca NOAA per il Golfo d’America",
    "fonteTitolo": "NOAA names Mississippi State University to host new Northern Gulf research institute"
   },
   {
    "data": "2026-09-09",
    "fonte": "NASA Science",
    "titolo": "Anak Krakatau: cenere e gas vulcanici osservati dai satelliti",
    "fonteTitolo": "Anak Krakatau Rumbles Again"
   },
   {
    "data": "2026-09-08",
    "fonte": "ESA Observing the Earth",
    "titolo": "FLEX e Sentinel-3C pronti al lancio insieme per osservare la Terra",
    "fonteTitolo": "FLEX and Sentinel-3C launch re-watch event on 15 September at ESA's Space Operations Centre"
   },
   {
    "data": "2026-09-07",
    "fonte": "NASA Science",
    "titolo": "Il lago di lava persistente del Mount Michael osservato dallo spazio",
    "fonteTitolo": "A Bright Spot at Mount Michael"
   },
   {
    "data": "2026-09-06",
    "fonte": "NASA Science",
    "titolo": "L’isola di ghiaccio del Petermann supera l’urto con Joe Island",
    "fonteTitolo": "Ice Island Survives Run-In With Joe Island"
   },
   {
    "data": "2026-09-05",
    "fonte": "ESA Observing the Earth",
    "titolo": "Sentinel-3 osserva oceani, ghiacci, terre emerse e atmosfera per seguire il clima",
    "fonteTitolo": "How Sentinel-3 tracks climate change"
   },
   {
    "data": "2026-09-04",
    "fonte": "INGV Terremoti",
    "titolo": "Le faglie silenti dell’Appennino centrale lasciano tracce nel paesaggio",
    "fonteTitolo": "Faglie attive silenti riconosciute con dati geologici come lacune sismiche dell’Appennino centrale"
   },
   {
    "data": "2026-09-03",
    "fonte": "ESA Observing the Earth",
    "titolo": "MTG-I2 pronto al lancio per rafforzare le osservazioni meteorologiche su Europa e Nord Africa",
    "fonteTitolo": "Watch live: MTG-I2 set for liftoff"
   },
   {
    "data": "2026-09-03",
    "fonte": "NOAA",
    "titolo": "NOAA Fisheries indica le priorità per rafforzare la filiera ittica statunitense",
    "fonteTitolo": "NOAA announces priorities to promote science-based American seafood dominance"
   },
   {
    "data": "2026-09-02",
    "fonte": "NASA Science",
    "titolo": "La siccità si intensifica a Porto Rico",
    "fonteTitolo": "Drought Intensifies Across Puerto Rico"
   },
   {
    "data": "2026-09-01",
    "fonte": "ESA Observing the Earth",
    "titolo": "Le immagini satellitari mostrano l’estensione dell’alluvione improvvisa nel Nepal settentrionale",
    "fonteTitolo": "Nepal flash flood imaged by satellites"
   },
   {
    "data": "2026-08-31",
    "fonte": "NASA Science",
    "titolo": "Il ghiacciaio Pasterze resta unito da una stretta cascata di ghiaccio",
    "fonteTitolo": "Pasterze Hangs on as Austria’s Largest Glacier"
   },
   {
    "data": "2026-08-30",
    "fonte": "INGV Ambiente",
    "titolo": "Posidonia oceanica: una prateria marina che protegge coste e clima",
    "fonteTitolo": "Posidonia oceanica: un alleato del clima in un Mediterraneo sempre più caldo"
   },
   {
    "data": "2026-08-30",
    "fonte": "ESA Observing the Earth",
    "titolo": "Un grande iceberg si stacca dal ghiacciaio Petermann in Groenlandia",
    "fonteTitolo": "Sentinel-1 captures major ice loss from Greenland glacier"
   },
   {
    "data": "2026-08-29",
    "fonte": "ESA Observing the Earth",
    "titolo": "MTG-I2 è sul lanciatore Ariane 6 per il decollo dalla Guyana francese",
    "fonteTitolo": "MTG-I2 ready for launch on Ariane 6"
   },
   {
    "data": "2026-08-29",
    "fonte": "ESA Observing the Earth",
    "titolo": "FLEX e Sentinel-3C pronti al lancio insieme per osservare piante, oceani e atmosfera",
    "fonteTitolo": "Media invitation: FLEX and Copernicus Sentinel-3C online media briefings"
   },
   {
    "data": "2026-08-28",
    "fonte": "NOAA",
    "titolo": "NOAA ricostruirà lo storico laboratorio marino di Beaufort",
    "fonteTitolo": "NOAA to rebuild historic science lab in Beaufort, North Carolina"
   },
   {
    "data": "2026-08-27",
    "fonte": "NOAA",
    "titolo": "NOAA amplia la rete di osservazioni meteo con un nuovo contratto Mesonet",
    "fonteTitolo": "NOAA boosts weather data collection capabilities with new Mesonet contract"
   },
   {
    "data": "2026-08-27",
    "fonte": "NASA Science",
    "titolo": "Neve estesa nel deserto di Atacama dopo le tempeste di agosto",
    "fonteTitolo": "Rare, Widespread Snow in the Atacama Desert"
   },
   {
    "data": "2026-08-26",
    "fonte": "ESA Observing the Earth",
    "titolo": "L’ombra della Luna attraversa l’Europa nelle immagini di MTG-I1",
    "fonteTitolo": "MTG-I1 captures eclipse path of totality over Europe"
   },
   {
    "data": "2026-08-26",
    "fonte": "INGV Terremoti",
    "titolo": "Una story map ripercorre la sequenza sismica del 2016-17 e la risposta dell’INGV",
    "fonteTitolo": "Una story map per raccontare la lunga sequenza sismica in Italia centrale del 2016-17 e la risposta dell’INGV"
   },
   {
    "data": "2026-08-26",
    "fonte": "NASA Science",
    "titolo": "I pinguini imperatore cambiano sito di riproduzione quando il ghiaccio si rompe",
    "fonteTitolo": "A Changing World for Emperor Penguins"
   },
   {
    "data": "2026-08-25",
    "fonte": "ESA Observing the Earth",
    "titolo": "Sentinel-3 accelera l’arrivo dei dati sugli incendi in Europa",
    "fonteTitolo": "Sentinel-3 provides faster data for Europe fires"
   },
   {
    "data": "2026-08-25",
    "fonte": "INGV Vulcani",
    "titolo": "Etna, l’intrusione del 2008 che ha mostrato l’arresto di un dicco magmatico",
    "fonteTitolo": "L’intrusione magmatica del 13 maggio 2008: un evento chiave per interpretare le eruzioni laterali dell’Etna"
   },
   {
    "data": "2026-08-25",
    "fonte": "INGV Terremoti",
    "titolo": "Dieci anni dalla sequenza del 2016: le lezioni della scienza sui terremoti dell’Appennino centrale"
   },
   {
    "data": "2026-08-25",
    "fonte": "INGV Vulcani",
    "titolo": "Campi Flegrei, lo sciame del 31 luglio visto con oltre mille terremoti"
   },
   {
    "data": "2026-08-25",
    "fonte": "NASA Science",
    "titolo": "Un sensore sul tetto osserva il particolato fine ad Addis Ababa"
   },
   {
    "data": "2026-08-25",
    "fonte": "ESA Observing the Earth",
    "titolo": "MTG-I2 completa la costellazione per le immagini meteo sull’Europa"
   },
   {
    "data": "2026-08-25",
    "fonte": "ESA Observing the Earth",
    "titolo": "Caldo estremo, siccità e incendi: il monitoraggio dallo spazio nel 2026"
   }
  ] };
  const perche = turnoFonti(indice, cfg, '2026-09-11');
  ok(/NOAA ha firmato il 2026-09-10/.test(perche(nino) || ''), 'l\'11 settembre la NOAA riposa: ha firmato il 10 → "' + (perche(nino) || '').slice(0, 60) + '"');
  ok(/NOAA ha firmato/.test(perche(istituto) || '') && /NOAA/.test(perche(voce('x', 'y', clima)) || ''), 'e riposano TUTTI i feed NOAA, perché l\'ente è lo stesso');
  ok(/NASA Science ha firmato il 2026-09-09/.test(perche(neve) || ''), 'la NASA ha firmato l\'altro ieri (il 9): riposa → "' + (perche(neve) || '').slice(0, 45) + '"');
  ok(/NASA Science ha già firmato 3 articoli/.test(turnoFonti(indice, cfg, '2026-09-12')(neve) || ''), 'e il 12, passato il turno, la ferma ancora il tetto: tre pezzi in sette giorni (6, 7 e 9)');
  const ingv = cfg.fonti.find(f => f.nome === 'INGV Terremoti');
  ok(perche(voce('x', 'y', ingv)) === null, 'l\'INGV Terremoti (ultimo pezzo il 4) può firmare l\'11');
  const perche13 = turnoFonti(indice, cfg, '2026-09-13'), perche15 = turnoFonti(indice, cfg, '2026-09-15');
  ok(perche13(nino) === null && perche13(neve) !== null && perche15(neve) === null, 'il 13 la NOAA è libera, la NASA lo diventa il 15 (quando nella settimana le resta un pezzo solo)');
  /* due in sette giorni: tetto */
  const finto = { articoli: [
    { data: '2026-09-09', fonte: 'NOAA Climate.gov', titolo: 'a', fonteTitolo: 'a' },
    { data: '2026-09-06', fonte: 'NOAA', titolo: 'b', fonteTitolo: 'b' },
    { data: '2026-09-05', fonte: 'ESA Observing the Earth', titolo: 'c', fonteTitolo: 'c' }
  ] };
  const perche12 = turnoFonti(finto, cfg, '2026-09-12');
  ok(/2 articoli negli ultimi sette giorni/.test(perche12(nino) || ''), 'con due pezzi NOAA in una settimana (feed diversi, stesso ente) il terzo aspetta → "' + (perche12(nino) || '') + '"');
  ok(perche12(voce('x', 'y', cfg.fonti.find(f => f.nome === 'ESA Observing the Earth'))) === null, 'l\'ESA con un pezzo solo può');

  /* la vicinanza di tema: il terzo comunicato su MTG-I2 e il secondo ghiacciaio */
  const recenti = indice.articoli;
  ok(vicinanzaTema('MTG-I2 ready for launch on Ariane 6 from Kourou', recenti) >= 3, 'un altro pezzo su MTG-I2 perde punti anche se le parole attorno cambiano: la sigla basta → −' + vicinanzaTema('MTG-I2 ready for launch on Ariane 6 from Kourou', recenti));
  ok(vicinanzaTema('Ice island from Petermann Glacier drifts past Joe Island', recenti) >= 3, 'il seguito dell\'isola di ghiaccio del Petermann pure → −' + vicinanzaTema('Ice island from Petermann Glacier drifts past Joe Island', recenti));
  ok(vicinanzaTema('Rare widespread snow in the Atacama Desert', recenti) <= 3, 'la neve nell\'Atacama, già raccontata una volta, ne perde al massimo tre → −' + vicinanzaTema('Rare widespread snow in the Atacama Desert', recenti));
  ok(vicinanzaTema('Lightning strikes measured from orbit over the Mediterranean', recenti) === 0, 'una notizia nuova di zecca non perde niente');
  ok(vicinanzaTema('Sentinel', recenti) === 0, 'un titolo di una parola sola non si giudica');

  /* nel giro completo: la NOAA ha firmato ieri e oggi riposa; se è l'unica, il turno si allenta */
  const FEED2 = `<?xml version="1.0"?><rss version="2.0"><channel><title>NOAA</title>
<item><title>I temporali come sismografi: cosa raccontano i thunderquakes</title><link>https://esempio.test/thunderquakes</link>
<description>Uno studio misura le vibrazioni sismiche prodotte dai fulmini e propone di usare i temporali per esplorare il sottosuolo. Un lavoro che unisce meteorologia e sismologia.</description>
<pubDate>${new Date(Date.now() - 3600000).toUTCString()}</pubDate></item></channel></rss>`;
  const ieri = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  await fs.writeFile(path.join(BANCO, 'fonti.json'), JSON.stringify({
    fonti: [{ nome: 'NOAA', url: 'https://esempio.test/feed', lingua: 'en', attiva: true, ente: 'NOAA' }, { nome: 'INGV Terremoti', url: 'https://esempio.test/feed2', lingua: 'it', attiva: true }],
    parole_chiave: ['temporal', 'fulmin', 'terremot', 'sismic', 'clima', 'sottosuolo', 'thunderquake']
  }, null, 1));
  await fs.writeFile(path.join(BANCO, 'indice.json'), JSON.stringify({ articoli: [
    { id: 'x', data: ieri, titolo: 'Un pezzo di ieri sugli uragani', fonteTitolo: 'Hurricane season outlook', fonte: 'NOAA', fonteUrl: 'https://esempio.test/ieri', file: 'articoli/x.json' } ] }, null, 1));
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions')) return risposta(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(BUONO) } }] }));
    if (u.includes('api.openai.com/v1/images/generations')) return risposta(200, JSON.stringify({ data: [{ b64_json: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }] }));
    if (u.includes('esempio.test/feed2')) return risposta(200, '<?xml version="1.0"?><rss version="2.0"><channel><title>x</title></channel></rss>', 'application/rss+xml');
    if (u.includes('esempio.test/feed')) return risposta(200, FEED2, 'application/rss+xml');
    if (u.includes('esempio.test/thunderquakes')) return risposta(200, FONTE_HTML, 'text/html');
    return risposta(404, 'non trovato');
  };
  const uscita = await esegui(['--forza']);
  ok(/Fonti in turno di riposo: 1 \(tutte: il turno si allenta/.test(uscita), 'la NOAA ha firmato ieri e riposerebbe, ma è l\'unica con una notizia: il turno si allenta e lo dice');
  ok(/PUBBLICATO/.test(uscita), 'e l\'articolo esce lo stesso');
  /* con un'altra fonte in gara, la NOAA resta a riposo davvero */
  await fs.writeFile(path.join(BANCO, 'indice.json'), JSON.stringify({ articoli: [
    { id: 'x', data: ieri, titolo: 'Un pezzo di ieri sugli uragani', fonteTitolo: 'Hurricane season outlook', fonte: 'NOAA', fonteUrl: 'https://esempio.test/ieri', file: 'articoli/x.json' } ] }, null, 1));
  const FEED3 = FEED2.replace('esempio.test/thunderquakes', 'esempio.test/thunderquakes?ingv').replace('<title>NOAA</title>', '<title>INGV</title>');
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions')) return risposta(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(BUONO) } }] }));
    if (u.includes('api.openai.com/v1/images/generations')) return risposta(200, JSON.stringify({ data: [{ b64_json: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }] }));
    if (u.includes('esempio.test/feed2')) return risposta(200, FEED3, 'application/rss+xml');
    if (u.includes('esempio.test/feed')) return risposta(200, FEED2, 'application/rss+xml');
    if (u.includes('esempio.test/thunderquakes')) return risposta(200, FONTE_HTML, 'text/html');
    return risposta(404, 'non trovato');
  };
  const uscita2 = await esegui(['--forza']);
  const indice2 = await leggiIndice();
  ok(/Fonti in turno di riposo: 1\n/.test(uscita2 + '\n') && /NOAA ha firmato il/.test(uscita2), 'con l\'INGV in gara la NOAA riposa davvero');
  ok(/PUBBLICATO/.test(uscita2) && indice2.articoli[0] && indice2.articoli[0].fonte === 'INGV Terremoti', 'e firma l\'INGV → ' + (indice2.articoli[0] || {}).fonte);
}


/* ══════════ 10 · i collegamenti relativi dei feed (NCEI) si completano ══════════ */
console.log('\n══ 10 · un feed coi collegamenti relativi (NCEI) ══');
{
  await pulisci();
  const RELATIVO = `<?xml version="1.0"?><rss version="2.0"><channel><title>NCEI</title>
<item><title>I temporali come sismografi: cosa raccontano i thunderquakes</title><link>/notizie/thunderquakes</link>
<description>Uno studio misura le vibrazioni sismiche prodotte dai fulmini e propone di usare i temporali per esplorare il sottosuolo. Un lavoro che unisce meteorologia e sismologia.</description>
<pubDate>${new Date(Date.now() - 3600000).toUTCString()}</pubDate></item></channel></rss>`;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('api.openai.com/v1/chat/completions')) return risposta(200, JSON.stringify({ choices: [{ message: { content: JSON.stringify(BUONO) } }] }));
    if (u.includes('api.openai.com/v1/images/generations')) return risposta(200, JSON.stringify({ data: [{ b64_json: 'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA' }] }));
    if (u === 'https://esempio.test/feed') return risposta(200, RELATIVO, 'application/rss+xml');
    if (u === 'https://esempio.test/notizie/thunderquakes') return risposta(200, FONTE_HTML, 'text/html');
    return risposta(404, 'non trovato ' + u);
  };
  const uscita = await esegui(['--forza']);
  const indice = await leggiIndice();
  ok(/PUBBLICATO/.test(uscita), 'l\'articolo esce anche se il feed scrive "/notizie/…"');
  ok(indice.articoli[0] && indice.articoli[0].fonteUrl === 'https://esempio.test/notizie/thunderquakes', 'e l\'indirizzo salvato è quello completo → ' + (indice.articoli[0] || {}).fonteUrl);
}

console.log('\n──────────────────────────────');
console.log(fallite === 0 ? 'TUTTE PASSATE: ' + passate : 'PASSATE ' + passate + ' · FALLITE ' + fallite);
await fs.rm(BANCO, { recursive: true, force: true });
process.exit(fallite === 0 ? 0 : 1);
