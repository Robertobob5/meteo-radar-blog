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

console.log('\n──────────────────────────────');
console.log(fallite === 0 ? 'TUTTE PASSATE: ' + passate : 'PASSATE ' + passate + ' · FALLITE ' + fallite);
await fs.rm(BANCO, { recursive: true, force: true });
process.exit(fallite === 0 ? 0 : 1);
