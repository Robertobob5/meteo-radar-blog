/* ============================================================
   Meteo Radar · il blog che si scrive da solo
   ------------------------------------------------------------
   Una volta al giorno: legge i feed degli istituti di ricerca,
   sceglie una notizia che non è già stata usata, si scarica il
   testo della FONTE ORIGINALE, e da quello fa scrivere un
   articolo inedito in italiano. Poi genera copertina e, se
   servono, un paio di immagini interne. Infine salva tutto e
   aggiorna l'indice che l'app va a leggere.

   La regola che tiene in piedi tutto: l'articolo può dire SOLO
   ciò che c'è nella fonte. Prima di salvare, un controllo verifica
   che ogni numero e ogni data scritti nel pezzo compaiano davvero
   nel testo di partenza. Se salta fuori una cifra dal nulla,
   l'articolo viene buttato e si riprova con un'altra notizia.

   Uso:  node genera.mjs            (serve OPENAI_API_KEY nell'ambiente)
         node genera.mjs --prova    (non chiama OpenAI: usa risposte finte)
         node genera.mjs --forza    (rifà l'articolo anche se oggi c'è già)
   ============================================================ */

import fs from 'node:fs/promises';
import path from 'node:path';

const QUI = path.dirname(new URL(import.meta.url).pathname);
const ARG = process.argv.slice(2);
const PROVA = ARG.includes('--prova');
const FORZA = ARG.includes('--forza');

const CHIAVE = process.env.OPENAI_API_KEY || '';
const MODELLO_TESTO = process.env.MODELLO_TESTO || 'gpt-5.6-terra';
const MODELLO_IMMAGINI = process.env.MODELLO_IMMAGINI || 'gpt-image-2';
const FUSO = process.env.FUSO || 'Europe/Rome';
const MAX_TENTATIVI = Number(process.env.MAX_TENTATIVI || 4);
const MAX_IMMAGINI_INTERNE = Number(process.env.MAX_IMMAGINI_INTERNE || 1);
/* Le immagini sono la voce di spesa vera: il testo di un articolo costa
   un paio di centesimi, ogni immagine molto di più, e cresce con la
   qualità. "low" basta e avanza per una copertina di blog letta su un
   telefono; si può alzare da GitHub senza toccare il codice. */
const QUALITA_IMMAGINI = process.env.QUALITA_IMMAGINI || 'low';

const dice = (...t) => console.log(...t);

/* ─────────────── date nel fuso giusto ─────────────── */
function oggiLocale() {
  const f = new Intl.DateTimeFormat('sv-SE', { timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());                    /* "2026-08-25" */
}
function oraLocale() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: FUSO, hour: '2-digit', hour12: false }).format(new Date()));
}

/* ─────────────── lettura dei feed, senza librerie ─────────────── */
function pezzi(xml, tag) {
  const out = [];
  const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}
function campo(blocco, tag) {
  const m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(blocco);
  if (!m) return '';
  return ripulisci(m[1]);
}
function ripulisci(s) {
  return String(s)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#039;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
function collegamento(blocco) {
  /* RSS: <link>…</link> · Atom: <link href="…"/> */
  const diretto = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(blocco);
  if (diretto && diretto[1].trim()) return ripulisci(diretto[1]);
  const href = /<link[^>]*\shref=["']([^"']+)["']/i.exec(blocco);
  return href ? href[1] : '';
}

async function prendi(url, opzioni = {}) {
  const r = await fetch(url, {
    ...opzioni,
    headers: { 'user-agent': 'MeteoRadarBlog/1.0 (+blog dell\'app Meteo Radar)', ...(opzioni.headers || {}) },
    signal: AbortSignal.timeout(Number(process.env.TIMEOUT || 30000))
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' su ' + url);
  return r;
}

async function scaricaFeed(fonte) {
  try {
    const xml = await (await prendi(fonte.url)).text();
    const voci = [...pezzi(xml, 'item'), ...pezzi(xml, 'entry')];
    return voci.map(v => ({
      titolo: campo(v, 'title'),
      url: collegamento(v),
      sommario: campo(v, 'description') || campo(v, 'summary') || campo(v, 'content:encoded'),
      quando: campo(v, 'pubDate') || campo(v, 'published') || campo(v, 'updated') || campo(v, 'dc:date'),
      fonte
    })).filter(v => v.titolo && v.url);
  } catch (e) {
    dice('  ⚠ feed non raggiungibile: ' + fonte.nome + ' → ' + e.message);
    return [];
  }
}

/* ─────────────── niente doppioni sull'argomento ───────────────
   Fino alla v1 si scartava soltanto lo stesso INDIRIZZO. Ma la stessa
   storia esce spesso due volte — l'istituto la ripubblica aggiornata,
   oppure la raccontano due enti diversi — e uscivano due articoli
   gemelli. Ora si confrontano anche le parole del titolo: se due
   titoli condividono più della metà delle parole che contano, è la
   stessa notizia e si passa oltre. */
const VUOTE = new Set(('il lo la i gli le un uno una di a da in con su per tra fra e o ma che chi cui non ' +
  'del della dei delle dal dalla al alla allo agli alle nel nella nei sul sulla come dove quando più meno ' +
  'nuovo nuova nuovi nuove primo prima ancora anche dopo sono stato stata dalle degli sull dell nell ' +
  'the a an of to in on for with and or from that this at by is are as new study research about into ' +
  'science scientists researchers).').split(' '));

/* Le parole si accorciano a cinque lettere: così "sensori" e "sensore",
   "osserva" e "osservare" diventano la stessa cosa. Le sigle con dentro
   un numero (MTG-I2, Sentinel-1, 2016) restano intere: sono le impronte
   digitali di una notizia, accorciarle vorrebbe dire buttarle via. */
function paroleChiave(titolo){
  const fuori = new Set();
  String(titolo).toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[-'’]/g, '')                 /* MTG-I2 → mtgi2, l'aria → laria */
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .forEach(p => {
      if (!p || VUOTE.has(p)) return;
      if (/\d/.test(p)) { fuori.add(p); return; }      /* sigle e anni: interi */
      if (p.length < 4) return;
      fuori.add(p.slice(0, 5));
    });
  return fuori;
}
const conNumero = p => /\d/.test(p);
/* due parole si somigliano se sono uguali o se ballano di una lettera
   sola: "abeba" e "ababa" sono lo stesso posto scritto in due modi */
function quasiUguali(a, b){
  if (a === b) return true;
  if (conNumero(a) || conNumero(b)) return false;      /* sulle sigle nessuno sconto */
  if (a.length < 5 || Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, sgarri = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++sgarri > 1) return false;
    if (a.length === b.length) { i++; j++; }
    else if (a.length > b.length) i++;
    else j++;
  }
  return sgarri + (a.length - i) + (b.length - j) <= 1;
}

/* Stessa storia? Due strade:
   · le parole in comune sono tante (quasi metà), oppure
   · c'è una sigla in comune (MTG-I2, un anno) e un po' di parole intorno.
   Il filtro è volutamente severo: saltare una notizia buona costa poco
   (se ne prende un'altra), pubblicare due volte la stessa costa a te. */
function stessaStoria(a, b){
  const A = [...paroleChiave(a)], B = [...paroleChiave(b)];
  if (A.length < 2 || B.length < 2) return false;
  let comuni = 0, sigla = false;
  A.forEach(x => {
    const trovata = B.find(y => quasiUguali(x, y));
    if (!trovata) return;
    comuni++;
    if (conNumero(x)) sigla = true;
  });
  const quota = comuni / Math.min(A.length, B.length);
  return quota >= 0.45 || (sigla && quota >= 0.3);
}

/* ─────────────── scelta della notizia ─────────────── */
function punteggio(voce, chiavi) {
  const t = (voce.titolo + ' ' + voce.sommario).toLowerCase();
  let p = 0;
  chiavi.forEach(k => { if (t.includes(k)) p += 3; });
  const q = Date.parse(voce.quando);
  if (Number.isFinite(q)) {
    const giorni = (Date.now() - q) / 86400000;
    if (giorni < 0.0) p -= 5;                       /* datata nel futuro: sospetta */
    else if (giorni <= 2) p += 6;
    else if (giorni <= 5) p += 3;
    else if (giorni <= 10) p += 1;
    else p -= 4;
  }
  if (voce.sommario.length > 300) p += 2;
  return p;
}

/* ─────────────── il testo della fonte ─────────────── */
function testoDaHtml(html) {
  let s = String(html);
  s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ')
       .replace(/<style[\s\S]*?<\/style>/gi, ' ')
       .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
       .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
       .replace(/<header[\s\S]*?<\/header>/gi, ' ')
       .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
  /* se c'è un <article> o un contenitore di contenuto, si prende quello */
  const art = /<article[\s\S]*?<\/article>/i.exec(s);
  if (art && art[0].length > 800) s = art[0];
  /* i paragrafi diventano righe vere, così il modello legge un testo e non una poltiglia */
  s = s.replace(/<\/(p|div|h[1-6]|li|br)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n');
  return ripulisci(s.replace(/<[^>]+>/g, ' ')).replace(/ ?\n ?/g, '\n');
}
async function testoFonte(voce) {
  try {
    const html = await (await prendi(voce.url)).text();
    const t = testoDaHtml(html);
    if (t.length > 700) return t.slice(0, 16000);
  } catch (e) {
    dice('  ⚠ pagina non leggibile: ' + e.message);
  }
  /* ripiego: il sommario del feed, se è sostanzioso */
  return voce.sommario.length > 500 ? voce.sommario : '';
}

/* ─────────────── il controllo antiballe ─────────────── */
/* Ogni numero scritto nell'articolo deve esistere nella fonte. Si perdona
   solo ciò che non può essere una notizia inventata: numeri piccoli (che
   nel testo fanno da "due motivi", "tre fasi"), l'anno in corso e quello
   scorso, e le percentuali arrotondate che nella fonte compaiono con i
   decimali. Tutto il resto, se non c'è nella fonte, è una bugia. */
function numeriDi(testo) {
  const fuori = [];
  const t = String(testo);
  const re = /(\d[\d.,]*)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const g = m[1].replace(/[.,]$/, '');
    fuori.push({ g, prima: t.slice(Math.max(0, m.index - 28), m.index), dopo: t.slice(m.index + m[1].length, m.index + m[1].length + 28) });
  }
  return fuori;
}
function normalizza(n) {
  let s = String(n).trim();
  /* 1.234,5 → 1234.5 · 1,234.5 → 1234.5 · 1.234 → 1234 (migliaia) */
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  else s = s.replace(',', '.');
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}
/* Parole che tradiscono un DATO: se il numero sta accanto a una di queste,
   va verificato sempre, anche se è piccolo. "Magnitudo 6,4" e "in 3 siti"
   sono due cose diverse, e la differenza la fa la parola che sta a fianco. */
const PAROLE_DATO = new RegExp(
  'magnitud|grad[oi]|°|km|chilometr|metr[oi]|miglia|micron|nanometr|millimetr|centimetr|' +
  'second[oi]|minut[oi]|or[ae]\\b|giorn[oi]|settiman|mes[ei]|ann[oi]|decenn|secol|' +
  '%|percent|per cento|volt[ae]|milion|miliard|mila\\b|migliaia|' +
  'tonnellat|chilogramm|litr[oi]|ettar|nod[oi]|hpa|millibar|kelvin|celsius|fahrenheit|' +
  'scala|indice|stazion|campion|scarich|sensor|misur|profondit|quot|altitudin|' +
  'velocit|frequenz|hertz|watt|joule|energi|ampiezz|intensit|concentrazion|' +
  '\\bmg\\b|\\bµg\\b|\\bkm/h|\\bm/s|\\bkm²|\\bkm2|\\bmq\\b', 'i');

function controllaNumeri(articolo, fonte) {
  const anno = new Date().getFullYear();
  const nellaFonte = new Set();
  numeriDi(fonte).forEach(({ g }) => {
    const v = normalizza(g);
    if (v !== null) {
      nellaFonte.add(v);
      nellaFonte.add(Math.round(v));                 /* la fonte dice 1,8 → l'articolo può dire 2 */
      nellaFonte.add(Math.round(v * 10) / 10);
    }
  });
  const conosciuto = (v) => {
    if (nellaFonte.has(v) || nellaFonte.has(Math.round(v)) || nellaFonte.has(Math.round(v * 10) / 10)) return true;
    for (const f of nellaFonte) if (f > 0 && Math.abs(f - v) / f < 0.01) return true;   /* arrotondamenti onesti */
    return false;
  };

  const testo = [articolo.titolo, articolo.sottotitolo,
    ...(articolo.blocchi || []).map(b => (b.testo || '') + ' ' + (b.didascalia || ''))].join(' ');

  const sospetti = [];
  numeriDi(testo).forEach(({ g, prima, dopo }) => {
    const v = normalizza(g);
    if (v === null) return;
    if (v === anno || v === anno - 1) return;                    /* la data di oggi */
    if (conosciuto(v)) return;
    /* un numero accanto a un'unità di misura è un dato: si verifica sempre */
    const eDato = PAROLE_DATO.test(prima) || PAROLE_DATO.test(dopo) || /[.,]/.test(g);
    if (!eDato && Number.isInteger(v) && v <= 12) return;        /* "in 3 siti", "due fasi" */
    sospetti.push(g);
  });
  return sospetti;
}

/* ─────────────── OpenAI ─────────────── */
async function openai(percorso, corpo) {
  const r = await fetch('https://api.openai.com/v1/' + percorso, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CHIAVE },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(180000)
  });
  const t = await r.text();
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + t.slice(0, 400));
  return JSON.parse(t);
}

const ISTRUZIONI = `Sei il redattore del blog dell'app meteo "Meteo Radar". Scrivi in italiano, per lettori curiosi ma non addetti ai lavori.

REGOLE NON NEGOZIABILI
1. Puoi scrivere SOLO ciò che è contenuto nel TESTO DELLA FONTE che ti viene dato. Non aggiungere fatti, cifre, date, nomi, luoghi o citazioni che lì non ci sono, nemmeno se li conosci.
2. Non inventare MAI numeri. Se la fonte non dà una cifra, scrivi a parole ("pochi chilometri", "in pochi anni") oppure non dirlo.
3. Non attribuire virgolettati a nessuno se la frase esatta non è nella fonte.
4. Se la fonte è troppo povera per farci un articolo dignitoso, rispondi {"scarta": true, "perche": "..."} e basta.
5. Niente toni da acchiappaclic: nessun "incredibile", "shock", "quello che non ti aspetti". Titolo che dice la cosa, non che la nasconde.
6. Spiega i termini tecnici la prima volta che li usi, in mezza riga.

LUNGHEZZA
Dai 700 ai 1500 parole, in proporzione a quanta sostanza ha la fonte. Una fonte magra fa un articolo corto e onesto: non gonfiare.

IMMAGINI
Descrivi 1 copertina e da 0 a ${MAX_IMMAGINI_INTERNE} immagini interne, solo se aggiungono qualcosa. Le descrizioni servono a un generatore di immagini: scene naturali, fenomeni, strumenti, paesaggi, schemi visivi. MAI persone reali riconoscibili, mai loghi, mai testo o scritte dentro l'immagine, mai finte fotografie di eventi di cronaca spacciabili per vere. Stile: illustrazione scientifica pulita e luminosa, colori naturali.

RISPOSTA
Solo JSON, senza commenti, in questa forma:
{
  "titolo": "...",
  "sottotitolo": "una riga che dice di cosa si tratta",
  "categoria": "una parola fra: Ricerca, Clima, Terremoti, Vulcani, Atmosfera, Spazio, Mare, Aria",
  "copertina": "descrizione della copertina per il generatore di immagini, in inglese",
  "copertinaAlt": "descrizione breve in italiano per chi non vede l'immagine",
  "blocchi": [
    {"tipo": "paragrafo", "testo": "..."},
    {"tipo": "sottotitolo", "testo": "..."},
    {"tipo": "immagine", "prompt": "descrizione in inglese", "alt": "descrizione in italiano", "didascalia": "didascalia in italiano"},
    {"tipo": "riquadro", "titolo": "In breve", "testo": "..."}
  ]
}`;

async function scriviArticolo(voce, testo) {
  if (PROVA) return JSON.parse(await fs.readFile(path.join(QUI, 'prova', 'articolo-finto.json'), 'utf8'));
  const r = await openai('chat/completions', {
    model: MODELLO_TESTO,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: ISTRUZIONI },
      { role: 'user', content:
        'FONTE: ' + voce.fonte.nome + ' (' + voce.fonte.lingua + ')\n' +
        'TITOLO ORIGINALE: ' + voce.titolo + '\n' +
        'INDIRIZZO: ' + voce.url + '\n\n' +
        'TESTO DELLA FONTE:\n"""\n' + testo + '\n"""\n\n' +
        (voce.giaFatti && voce.giaFatti.length
          ? 'ARTICOLI GIÀ PUBBLICATI SU QUESTO BLOG (non rifare la stessa storia):\n- ' +
            voce.giaFatti.join('\n- ') + '\n\n' : '') +
        'Scrivi l\'articolo in italiano seguendo le regole. Se la fonte è in inglese, traduci i concetti: ' +
        'il lettore è italiano e non deve incontrare frasi in inglese. ' +
        'Se questa notizia racconta la stessa cosa di uno degli articoli già pubblicati qui sopra, ' +
        'rispondi {"scarta": true, "perche": "doppione"}.' }
    ]
  });
  const grezzo = r.choices?.[0]?.message?.content || '{}';
  return JSON.parse(grezzo);
}

async function generaImmagine(prompt, destinazione) {
  if (PROVA) {
    await fs.writeFile(destinazione, Buffer.from(
      'UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'));
    return true;
  }
  try {
    const r = await openai('images/generations', {
      model: MODELLO_IMMAGINI,
      prompt: prompt + '. Clean scientific illustration, natural colours, no text, no words, no letters, no logos, no recognisable real people.',
      size: '1024x1024',
      quality: QUALITA_IMMAGINI,
      output_format: 'webp',
      n: 1
    });
    const b64 = r.data?.[0]?.b64_json;
    if (!b64) throw new Error('nessuna immagine nella risposta');
    await fs.writeFile(destinazione, Buffer.from(b64, 'base64'));
    return true;
  } catch (e) {
    dice('  ⚠ immagine non generata: ' + e.message);
    return false;
  }
}

/* ─────────────── le pagine da leggere sul web ───────────────
   Gli stessi articoli, ma come pagine vere: servono per CONDIVIDERE.
   Un file JSON non si può mandare a nessuno; questa pagina invece si
   apre in qualunque telefono, mostra la copertina nell'anteprima di
   WhatsApp o Telegram (sono i tag "og:") e non ha bisogno dell'app.
   Le pubblica GitHub Pages, gratis, dal repository stesso. */

const scappa = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const STILE_WEB = `*{box-sizing:border-box}
:root{--sf:#eef3fa;--ct:#fff;--mo:#f6f8fc;--tx:#172033;--mu:#6d788d;--li:#dce4ef;--bl:#0878f9;--cy:#0bb6d4}
@media(prefers-color-scheme:dark){:root{--sf:#0d1420;--ct:#172131;--mo:#1d293b;--tx:#edf4ff;--mu:#a8b4c7;--li:#2b3a51;--bl:#4ba2ff;--cy:#38c6df}}
body{margin:0;background:var(--sf);color:var(--tx);font:16px/1.65 Inter,system-ui,-apple-system,"Segoe UI",sans-serif}
.gu{max-width:720px;margin:0 auto;background:var(--ct);min-height:100vh}
.tt{display:flex;align-items:center;gap:10px;padding:13px 18px;border-bottom:1px solid var(--li);position:sticky;top:0;background:var(--ct);z-index:5}
.mk{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;color:#fff;font-size:18px;background:linear-gradient(135deg,var(--bl),var(--cy))}
.tt b{font-size:15px}.tt small{display:block;color:var(--mu);font-size:11px}
.tt a{margin-left:auto;color:var(--bl);text-decoration:none;font-size:13px;font-weight:700}
.cp{width:100%;aspect-ratio:16/10;object-fit:cover;display:block}
.dd{padding:20px 18px 46px}
.pl{display:inline-block;padding:5px 11px;margin:0 6px 6px 0;border-radius:99px;font-size:11px;font-weight:800;background:color-mix(in srgb,var(--bl) 15%,var(--mo));color:var(--tx)}
h1{margin:14px 0 8px;font-size:29px;line-height:1.18;letter-spacing:-.5px}
.so{margin:0 0 20px;color:var(--mu);font-size:17px;line-height:1.45}
h2{margin:30px 0 10px;font-size:20px;line-height:1.3}
p{margin:0 0 17px}
figure{margin:24px -18px}figure img{width:100%;display:block}
figcaption{padding:8px 18px 0;color:var(--mu);font-size:12.5px;line-height:1.45}
.rq{margin:24px 0;padding:16px 18px;border-left:3px solid var(--bl);border-radius:0 14px 14px 0;background:var(--mo)}
.rq b{display:block;margin-bottom:6px;font-size:12px;letter-spacing:.4px;text-transform:uppercase;color:var(--bl)}
.rq p{margin:0}
blockquote{margin:24px 0;padding:0 0 0 18px;border-left:3px solid var(--li);font-style:italic;font-size:18px}
.fo{margin-top:34px;padding:16px 18px;border:1px solid var(--li);border-radius:16px;background:var(--mo)}
.fo small{display:block;color:var(--mu);font-size:11px;text-transform:uppercase;letter-spacing:.4px}
.fo b{display:block;margin:5px 0 10px;font-size:15px;line-height:1.4}
.fo a{display:inline-block;padding:9px 15px;border-radius:11px;background:var(--bl);color:#fff;text-decoration:none;font-weight:800;font-size:13px}
.ia{margin-top:14px;padding:13px 16px;border:1px dashed var(--li);border-radius:14px;color:var(--mu);font-size:12.5px;line-height:1.55}
.ia b{color:var(--tx)}
.el{display:grid;gap:13px;padding:18px}
.rg{display:grid;grid-template-columns:118px 1fr;gap:14px;overflow:hidden;border:1px solid var(--li);border-radius:17px;background:var(--ct);text-decoration:none;color:inherit}
.rg img{width:100%;height:100%;aspect-ratio:1/1;object-fit:cover;display:block}
.rg div{padding:13px 15px 13px 0;align-self:center}
.rg b{display:block;font-size:15px;line-height:1.34}
.ad{margin:34px 0 0;padding:22px 20px 20px;border-radius:20px;color:#fff;text-align:center;
  background:linear-gradient(150deg,#0b5fd0,#0878f9 45%,#0bb6d4)}
.ad .mk2{width:52px;height:52px;margin:0 auto 12px;border-radius:17px;display:grid;place-items:center;
  font-size:27px;background:rgba(255,255,255,.17);border:1px solid rgba(255,255,255,.28)}
.ad b{display:block;font-size:21px;line-height:1.25;letter-spacing:-.3px}
.ad p{margin:11px auto 0;max-width:430px;font-size:14.5px;line-height:1.55;opacity:.94}
.ad .btn{display:inline-block;margin-top:17px;padding:14px 26px;border-radius:14px;background:#fff;color:#0a4fa8;
  text-decoration:none;font-weight:800;font-size:15px;box-shadow:0 10px 24px rgba(4,30,66,.28)}
.ad .btn:active{transform:translateY(1px)}
.ad .nota{display:block;margin:13px auto 0;max-width:420px;font-size:11.5px;line-height:1.5;opacity:.8}
.ad .cose{display:flex;flex-wrap:wrap;justify-content:center;gap:6px;margin-top:15px}
.ad .cose span{padding:5px 11px;border-radius:99px;background:rgba(255,255,255,.16);font-size:11.5px;font-weight:700}
@media(max-width:520px){.ad{margin-left:-4px;margin-right:-4px;padding:20px 16px 18px}.ad b{font-size:19px}}
.rg small{display:block;margin-top:6px;color:var(--mu);font-size:12px}
/* il lettore vocale */
.vc{display:inline-flex;align-items:center;gap:9px;margin:0 0 22px;padding:10px 17px 10px 13px;border:1px solid var(--li);
  border-radius:99px;background:var(--mo);color:var(--tx);font:inherit;font-size:14px;font-weight:700;cursor:pointer}
.vc:hover{border-color:var(--bl)}
.vc[data-on="1"]{background:var(--bl);border-color:var(--bl);color:#fff}
.vc .ic{width:24px;height:24px;border-radius:50%;display:grid;place-items:center;font-size:11px;
  background:var(--bl);color:#fff}
.vc[data-on="1"] .ic{background:rgba(255,255,255,.24)}
.vc small{font-weight:600;opacity:.72}
.leggo{background:color-mix(in srgb,var(--bl) 12%,transparent);border-radius:8px;
  box-shadow:0 0 0 6px color-mix(in srgb,var(--bl) 12%,transparent)}
@media(max-width:520px){.rg{grid-template-columns:96px 1fr}h1{font-size:25px}}`;

/* Il lettore vocale delle pagine da condividere.
   Usa la voce che c'è già dentro il browser di chi legge: nessuna chiave,
   nessun file audio da pubblicare, nessun costo. Legge un pezzo alla volta
   perché Chrome, su letture lunghe, si spegne da solo dopo poco — è un
   difetto noto — e perché così si vede dove sta leggendo e si può fermare
   e riprendere. In fondo dice che l'ha scritto un'intelligenza artificiale:
   chi ascolta senza guardare lo schermo quella nota non la vede. */
const VOCE_WEB = (fonte) => `<script>
(function(){
 var S=window.speechSynthesis;
 var b=document.getElementById('vc');
 if(!S||!b){ if(b) b.remove(); return; }
 b.hidden=false;
 var giro=0,acceso=false;
 function pezzi(){
  var dd=document.querySelector('.dd'); if(!dd) return [];
  var out=[];
  dd.querySelectorAll('h1,.so,h2,.rq b,.rq p,blockquote,p').forEach(function(el){
   if(el.closest('.fo')||el.closest('.ia')||el.closest('.ad')||el.closest('figcaption')) return;
   var t=(el.textContent||'').trim();
   if(t.length>1) out.push({el:el,testo:t});
  });
  return out;
 }
 function luce(el){
  var v=document.querySelector('.leggo'); if(v) v.classList.remove('leggo');
  if(!el) return;
  el.classList.add('leggo');
  try{ el.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){}
 }
 function stato(on){
  acceso=on; b.dataset.on=on?'1':'0';
  b.querySelector('.ic').textContent=on?'\\u25a0':'\\u25b6';
  b.querySelector('.tx').textContent=on?'Ferma':'Ascolta';
 }
 function dire(t){
  return new Promise(function(fine){
   var u=new SpeechSynthesisUtterance(t);
   u.lang='it-IT'; u.onend=fine; u.onerror=fine;
   S.speak(u);
  });
 }
 function stop(){ giro++; S.cancel(); luce(null); stato(false); }
 b.onclick=async function(){
  if(acceso){ stop(); return; }
  var mio=++giro; stato(true);
  var lista=pezzi();
  for(var i=0;i<lista.length;i++){
   if(mio!==giro) return;
   luce(lista[i].el);
   await dire(lista[i].testo);
  }
  if(mio!==giro) return;
  luce(null);
  await dire('Fine dell\\'articolo. Il testo \\u00e8 stato scritto da un\\'intelligenza artificiale a partire da ${fonte}.');
  if(mio===giro) stop();
 };
 window.addEventListener('pagehide',function(){ try{S.cancel();}catch(e){} });
})();
<\/script>`;

/* Lo spot. Sta in fondo, dopo la fonte: chi è arrivato fin lì ha appena
   letto la prova di quello che gli stiamo promettendo. Nessun numero
   inventato, nessuna stellina, nessuna finta recensione — il blog vive
   sull'essere verificabile e una bugia qui butterebbe via proprio quello.
   L'indirizzo dell'apk si cambia dalla variabile APK, senza toccare il codice. */
const APK = process.env.APK || 'https://drive.google.com/drive/folders/12S14HNl9zudUCuLCyeIYXtYYD1Sf6I07';

const SPOT = () => `<div class="ad">
<div class="mk2">\u25c9</div>
<b>Il meteo spiegato, non solo previsto</b>
<p>Questo articolo l'hai letto sul blog di <strong>Meteo Radar</strong>: un'app che ti mostra da dove
vengono i numeri, invece di limitarsi a dartelo. E ogni mattina ne trovi uno nuovo come questo.</p>
<div class="cose"><span>Radar della pioggia</span><span>Allerte Protezione Civile</span>
<span>Qualit\u00e0 dell'aria</span><span>Mare e onde</span><span>Pollini</span></div>
<a class="btn" href="${scappa(APK)}" target="_blank" rel="noopener">Scarica l'app per Android</a>
<small class="nota">Gratis, senza pubblicit\u00e0 e senza account. Il file arriva da Google Drive:
la prima volta Android chieder\u00e0 di autorizzare l'installazione da questa origine \u2014 succede con
tutte le app che non passano dallo store.</small>
</div>`;

const TESTATA_WEB = (attiva) =>
  '<div class="tt"><div class="mk">\u25c9</div><div><b>Meteo Radar</b><small>il blog</small></div>' +
  (attiva ? '<a href="../">Tutti gli articoli</a>' : '') + '</div>';

function paginaArticolo(a, sito) {
  const su = '../';
  const corpo = (a.blocchi || []).map(b => {
    if (b.tipo === 'sottotitolo') return '<h2>' + scappa(b.testo) + '</h2>';
    if (b.tipo === 'citazione') return '<blockquote>' + scappa(b.testo) + '</blockquote>';
    if (b.tipo === 'riquadro') return '<div class="rq">' + (b.titolo ? '<b>' + scappa(b.titolo) + '</b>' : '') +
      '<p>' + scappa(b.testo) + '</p></div>';
    if (b.tipo === 'immagine' && b.file) return '<figure><img src="' + su + scappa(b.file) + '" alt="' +
      scappa(b.alt || '') + '" loading="lazy">' +
      (b.didascalia ? '<figcaption>' + scappa(b.didascalia) + '</figcaption>' : '') + '</figure>';
    return '<p>' + scappa(b.testo || '') + '</p>';
  }).join('\n');

  const f = a.fonte || {};
  const img = a.copertina ? sito + a.copertina : '';
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${scappa(a.titolo)} · Meteo Radar</title>
<meta name="description" content="${scappa(a.sottotitolo || a.titolo)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${scappa(a.titolo)}">
<meta property="og:description" content="${scappa(a.sottotitolo || '')}">
${img ? '<meta property="og:image" content="' + scappa(img) + '">' : ''}
<meta property="og:site_name" content="Meteo Radar · il blog">
<meta property="article:published_time" content="${scappa(a.data)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#0878f9">
<style>${STILE_WEB}</style>
</head>
<body><div class="gu">
${TESTATA_WEB(true)}
${a.copertina ? '<img class="cp" src="' + su + scappa(a.copertina) + '" alt="' + scappa(a.copertinaAlt || '') + '">' : ''}
<div class="dd">
<span class="pl">${scappa(a.categoria || 'Ricerca')}</span><span class="pl">${scappa(a.data)}</span><span class="pl">${scappa(String(a.minuti || 3))} min</span>
<h1>${scappa(a.titolo)}</h1>
${a.sottotitolo ? '<p class="so">' + scappa(a.sottotitolo) + '</p>' : ''}
<button id="vc" class="vc" type="button" hidden data-on="0"><span class="ic">▶</span><span class="tx">Ascolta</span><small>${scappa(String(a.minuti || 3))} min</small></button>
${corpo}
<div class="fo"><small>Da dove viene</small><b>${scappa(f.titolo || '')}</b>
${f.url ? '<a href="' + scappa(f.url) + '" target="_blank" rel="noopener">Leggi la fonte originale \u00b7 ' + scappa(f.nome || '') + ' \u2197</a>' : scappa(f.nome || '')}</div>
<div class="ia"><b>Come \u00e8 nato questo articolo.</b> Il testo e le immagini sono stati generati da un'intelligenza
artificiale a partire dalla fonte qui sopra, e prima della pubblicazione un controllo automatico verifica che ogni
numero citato compaia davvero nella fonte. Non \u00e8 un articolo scritto da una persona, e le immagini sono
illustrazioni, non fotografie di quello che \u00e8 successo.</div>
${SPOT()}
</div></div>
${VOCE_WEB(scappa((a.fonte && a.fonte.nome) || 'la fonte citata').replace(/'/g, "\\'"))}
</body></html>`;
}

function paginaIndice(indice) {
  const righe = indice.articoli.map(a =>
    '<a class="rg" href="p/' + scappa(a.id) + '.html">' +
     (a.copertina ? '<img src="' + scappa(a.copertina) + '" alt="" loading="lazy">' : '<div></div>') +
     '<div><b>' + scappa(a.titolo) + '</b><small>' + scappa(a.categoria || '') + ' \u00b7 ' +
       scappa(String(a.minuti || 3)) + ' min \u00b7 ' + scappa(a.fonte || '') + '</small></div></a>').join('\n');
  return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Meteo Radar \u00b7 il blog</title>
<meta name="description" content="Un articolo al giorno su meteo, clima, atmosfera e terremoti, scritto a partire dai comunicati degli istituti di ricerca.">
<meta property="og:title" content="Meteo Radar \u00b7 il blog">
<meta property="og:description" content="Un articolo al giorno su meteo, clima, atmosfera e terremoti.">
<meta name="theme-color" content="#0878f9">
<style>${STILE_WEB}</style>
</head>
<body><div class="gu">
${TESTATA_WEB(false)}
<div class="el">${righe || '<p style="color:var(--mu)">Ancora nessun articolo.</p>'}</div>
<div class="dd" style="padding-top:0">${SPOT()}</div>
</div></body></html>`;
}

/* ─────────────── archivio ─────────────── */
async function leggiIndice() {
  try { return JSON.parse(await fs.readFile(path.join(QUI, 'indice.json'), 'utf8')); }
  catch { return { aggiornato: null, articoli: [] }; }
}
const perUrl = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ─────────────── pulizia dei doppioni già pubblicati ───────────────
   Chi era uscito prima che il controllo esistesse resta lì. A ogni giro
   si guarda l'archivio: se due articoli raccontano la stessa storia si
   tiene il PRIMO (di solito il più completo, ed è quello che la gente
   ha già letto) e si butta l'altro, file, immagini e pagina compresi. */
async function butta(nome){
  try { await fs.unlink(path.join(QUI, nome)); return true; } catch { return false; }
}
async function ripulisciDoppioni(indice){
  const tenuti = [], buttati = [];
  /* dal più vecchio al più recente, così a restare è il primo uscito */
  const ordinati = indice.articoli.slice().reverse();
  for (const a of ordinati) {
    const gemello = tenuti.find(t => stessaStoria(t.titolo, a.titolo));
    if (gemello) buttati.push({ a, gemello });
    else tenuti.push(a);
  }
  if (!buttati.length) return 0;

  dice('\nPulizia: ' + buttati.length + (buttati.length === 1 ? ' doppione trovato' : ' doppioni trovati') + ' nell\'archivio');
  for (const { a, gemello } of buttati) {
    dice('  \u2716 "' + a.titolo + '"');
    dice('     stessa storia di "' + gemello.titolo + '"');
    await butta(a.file || ('articoli/' + a.id + '.json'));
    await butta('p/' + a.id + '.html');
    if (a.copertina) await butta(a.copertina);
    /* le immagini interne portano il nome dell'articolo con un numero in coda */
    for (let n = 1; n <= 4; n++) await butta('immagini/' + a.id + '-' + n + '.webp');
  }
  indice.articoli = tenuti.reverse();
  indice.aggiornato = new Date().toISOString();
  await fs.writeFile(path.join(QUI, 'indice.json'), JSON.stringify(indice, null, 1));
  await fs.writeFile(path.join(QUI, 'index.html'), paginaIndice(indice));
  return buttati.length;
}

/* Rifà le pagine web di TUTTI gli articoli già in archivio, partendo dai file
   JSON che sono già qui: non chiama OpenAI, non scarica niente, non spende un
   centesimo. Serve perché le pagine da condividere vengono scritte una volta
   sola, il giorno in cui nasce l'articolo: senza questo passaggio, una modifica
   all'impaginazione (per dire, il riquadro dell'app in fondo) comparirebbe solo
   sui pezzi futuri, e i sei già pubblicati resterebbero indietro per sempre. */
async function rifaiPagine(indice, sito) {
  let rifatte = 0;
  await fs.mkdir(path.join(QUI, 'p'), { recursive: true });
  for (const voce of indice.articoli) {
    try {
      const dove = voce.file || ('articoli/' + voce.id + '.json');
      const a = JSON.parse(await fs.readFile(path.join(QUI, dove), 'utf8'));
      const nuova = paginaArticolo(a, sito);
      const pagina = path.join(QUI, 'p', voce.id + '.html');
      const vecchia = await fs.readFile(pagina, 'utf8').catch(() => '');
      if (vecchia === nuova) continue;          // già a posto: non si tocca
      await fs.writeFile(pagina, nuova);
      rifatte++;
    } catch (e) { /* un articolo senza il suo file non deve fermare il giro */ }
  }
  if (rifatte) dice('Pagine da condividere rimesse a nuovo: ' + rifatte + ' (nessuna spesa)');
  return rifatte;
}

/* ─────────────── il giro completo ─────────────── */
async function main() {
  const config = JSON.parse(await fs.readFile(path.join(QUI, 'fonti.json'), 'utf8'));
  const indice = await leggiIndice();
  const oggi = oggiLocale();
  const SITO_WEB = (process.env.SITO || '').replace(/\/?$/, '/');

  /* prima di tutto, e comunque vada il resto: le pagine da condividere degli
     articoli già pubblicati vengono riallineate all'impaginazione di oggi.
     Non costa niente e non chiama nessuno. */
  await rifaiPagine(indice, SITO_WEB);

  if (!FORZA && indice.articoli.some(a => a.data === oggi)) {
    dice('L\'articolo di oggi (' + oggi + ') c\'è già. Niente da fare.');
    return;
  }
  /* GitHub lavora in UTC e l'Italia cambia ora due volte l'anno: il lavoro
     parte due volte (alle 6 e alle 7 UTC) e qui si tiene solo il passaggio
     che in Italia cade alle 8. L'altro esce subito senza spendere niente. */
  if (!FORZA && !PROVA && oraLocale() < 8) {
    dice('In Italia sono le ' + oraLocale() + ': troppo presto, l\'articolo esce alle 8.');
    return;
  }
  if (!PROVA && !CHIAVE) {
    dice('Manca OPENAI_API_KEY. Mi fermo qui senza spendere niente.');
    process.exit(1);
  }

  /* prima di scrivere: si mette in ordine la casa */
  const puliti = await ripulisciDoppioni(indice);

  const attive = config.fonti.filter(f => f.attiva !== false);
  dice('Fonti attive: ' + attive.length);
  const tutte = (await Promise.all(attive.map(scaricaFeed))).flat();
  dice('Notizie trovate: ' + tutte.length);

  const usate = new Set(indice.articoli.map(a => a.fonteUrl));
  /* i titoli già raccontati: quelli della fonte e quelli dei nostri articoli */
  const gia = indice.articoli.flatMap(a => [a.fonteTitolo, a.titolo]).filter(Boolean);
  const candidate = tutte
    .filter(v => !usate.has(v.url))
    .filter(v => !gia.some(t => stessaStoria(t, v.titolo)))
    .map(v => ({ v, p: punteggio(v, config.parole_chiave) }))
    .filter(x => x.p > 0)
    .sort((a, b) => b.p - a.p)
    .map(x => x.v);

  dice('Candidate mai usate e a tema: ' + candidate.length);
  if (!candidate.length) { dice('Nessuna notizia nuova. Meglio non pubblicare niente che pubblicare per forza.'); return; }

  for (let t = 0; t < Math.min(MAX_TENTATIVI, candidate.length); t++) {
    const voce = candidate[t];
    dice('\n[' + (t + 1) + '] ' + voce.fonte.nome + ' — ' + voce.titolo);

    const testo = await testoFonte(voce);
    if (testo.length < 700) { dice('  · fonte troppo magra (' + testo.length + ' caratteri): passo oltre'); continue; }
    dice('  · testo della fonte: ' + testo.length + ' caratteri');

    voce.giaFatti = indice.articoli.slice(0, 12).map(a => a.titolo);
    let art;
    try { art = await scriviArticolo(voce, testo); }
    catch (e) { dice('  ⚠ scrittura fallita: ' + e.message); continue; }

    if (art.scarta) { dice('  · scartata dal redattore: ' + (art.perche || '')); continue; }
    if (!art.titolo || !Array.isArray(art.blocchi) || !art.blocchi.length) { dice('  ⚠ risposta incompleta'); continue; }

    const sospetti = controllaNumeri(art, testo + ' ' + voce.titolo);
    if (sospetti.length) {
      dice('  ✘ CONTROLLO NUMERI: cifre che nella fonte non ci sono → ' + sospetti.join(', '));
      dice('    articolo buttato, provo con un\'altra notizia');
      continue;
    }
    dice('  ✔ controllo numeri superato');

    /* ---- immagini ---- */
    /* le cartelle potrebbero non esistere: su GitHub una cartella vuota non
       viene caricata, e senza questa riga le immagini si perderebbero in
       silenzio (fs.writeFile fallisce e l'errore verrebbe solo annotato) */
    await fs.mkdir(path.join(QUI, 'immagini'), { recursive: true });
    await fs.mkdir(path.join(QUI, 'articoli'), { recursive: true });
    const id = oggi + '-' + perUrl(art.titolo);
    const nomeCop = 'immagini/' + id + '-copertina.webp';
    const okCop = await generaImmagine(art.copertina || art.titolo, path.join(QUI, nomeCop));
    let quante = 0;
    for (const b of art.blocchi) {
      if (b.tipo !== 'immagine') continue;
      if (quante >= MAX_IMMAGINI_INTERNE) { b.salta = true; continue; }
      const nome = 'immagini/' + id + '-' + (quante + 1) + '.webp';
      if (await generaImmagine(b.prompt || art.titolo, path.join(QUI, nome))) { b.file = nome; quante++; }
      else b.salta = true;
      delete b.prompt;
    }
    art.blocchi = art.blocchi.filter(b => !b.salta);
    dice('  · immagini: copertina ' + (okCop ? 'sì' : 'no') + ', interne ' + quante);

    /* ---- salvataggio ---- */
    const parole = art.blocchi.filter(b => b.testo).map(b => b.testo).join(' ').split(/\s+/).length;
    const articolo = {
      id, data: oggi, scritto: new Date().toISOString(),
      titolo: art.titolo, sottotitolo: art.sottotitolo || '',
      categoria: art.categoria || 'Ricerca',
      copertina: okCop ? nomeCop : '', copertinaAlt: art.copertinaAlt || art.titolo,
      blocchi: art.blocchi, parole, minuti: Math.max(2, Math.round(parole / 200)),
      fonte: { nome: voce.fonte.nome, titolo: voce.titolo, url: voce.url, lingua: voce.fonte.lingua },
      generato: { testo: PROVA ? 'prova' : MODELLO_TESTO, immagini: PROVA ? 'prova' : MODELLO_IMMAGINI }
    };

    await fs.mkdir(path.join(QUI, 'articoli'), { recursive: true });
    await fs.writeFile(path.join(QUI, 'articoli', id + '.json'), JSON.stringify(articolo, null, 1));

    indice.articoli.unshift({
      id, data: articolo.data, titolo: articolo.titolo, sottotitolo: articolo.sottotitolo,
      categoria: articolo.categoria, minuti: articolo.minuti, copertina: articolo.copertina,
      fonte: voce.fonte.nome, fonteUrl: voce.url, fonteTitolo: voce.titolo,
      file: 'articoli/' + id + '.json'
    });
    indice.aggiornato = new Date().toISOString();
    await fs.writeFile(path.join(QUI, 'indice.json'), JSON.stringify(indice, null, 1));

    /* Le pagine da leggere sul web: una per l'articolo, più l'elenco.
       Servono a CONDIVIDERE un pezzo con chi non ha l'app — un file JSON
       non si può mandare a nessuno, una pagina sì. */
    const sito = (process.env.SITO || '').replace(/\/?$/, '/');
    await fs.mkdir(path.join(QUI, 'p'), { recursive: true });
    await fs.writeFile(path.join(QUI, 'p', id + '.html'), paginaArticolo(articolo, sito));
    await fs.writeFile(path.join(QUI, 'index.html'), paginaIndice(indice));
    /* senza questo file GitHub Pages passerebbe le pagine in un frullatore
       per blog e salterebbe le cartelle che cominciano con l'underscore */
    await fs.writeFile(path.join(QUI, '.nojekyll'), '');

    dice('\n✔ PUBBLICATO: ' + articolo.titolo);
    dice('  ' + parole + ' parole · ' + articolo.minuti + ' min · fonte: ' + voce.fonte.nome);
    dice('  pagina da condividere: p/' + id + '.html');
    return;
  }

  dice('\nNessuna notizia ha superato i controlli. Oggi il blog resta fermo: è il comportamento giusto.');
  if (puliti) dice('(ma l\'archivio è stato ripulito: ' + puliti + ' doppioni in meno)');
}

/* I pezzi si possono provare uno per uno dal banco di prova; il giro completo
   parte da solo soltanto quando il file viene lanciato davvero da riga di comando. */
export { main, controllaNumeri, punteggio, testoDaHtml, numeriDi, normalizza, perUrl, stessaStoria, paroleChiave,
         paginaArticolo, paginaIndice, SPOT };

const lanciatoDaSolo = (() => {
  try {
    const mio = new URL(import.meta.url).pathname;
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(mio);
  } catch { return false; }
})();
if (lanciatoDaSolo) main().catch(e => { console.error('Errore: ' + e.message); process.exit(1); });
