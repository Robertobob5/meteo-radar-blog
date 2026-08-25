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
const MAX_IMMAGINI_INTERNE = Number(process.env.MAX_IMMAGINI_INTERNE || 2);

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
        'Scrivi l\'articolo in italiano seguendo le regole. Se la fonte è in inglese, traduci i concetti: ' +
        'il lettore è italiano e non deve incontrare frasi in inglese.' }
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
      quality: 'medium',
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

/* ─────────────── archivio ─────────────── */
async function leggiIndice() {
  try { return JSON.parse(await fs.readFile(path.join(QUI, 'indice.json'), 'utf8')); }
  catch { return { aggiornato: null, articoli: [] }; }
}
const perUrl = s => String(s).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);

/* ─────────────── il giro completo ─────────────── */
async function main() {
  const config = JSON.parse(await fs.readFile(path.join(QUI, 'fonti.json'), 'utf8'));
  const indice = await leggiIndice();
  const oggi = oggiLocale();

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

  const attive = config.fonti.filter(f => f.attiva !== false);
  dice('Fonti attive: ' + attive.length);
  const tutte = (await Promise.all(attive.map(scaricaFeed))).flat();
  dice('Notizie trovate: ' + tutte.length);

  const usate = new Set(indice.articoli.map(a => a.fonteUrl));
  const candidate = tutte
    .filter(v => !usate.has(v.url))
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
      fonte: voce.fonte.nome, fonteUrl: voce.url, file: 'articoli/' + id + '.json'
    });
    indice.aggiornato = new Date().toISOString();
    await fs.writeFile(path.join(QUI, 'indice.json'), JSON.stringify(indice, null, 1));

    dice('\n✔ PUBBLICATO: ' + articolo.titolo);
    dice('  ' + parole + ' parole · ' + articolo.minuti + ' min · fonte: ' + voce.fonte.nome);
    return;
  }

  dice('\nNessuna notizia ha superato i controlli. Oggi il blog resta fermo: è il comportamento giusto.');
}

/* I pezzi si possono provare uno per uno dal banco di prova; il giro completo
   parte da solo soltanto quando il file viene lanciato davvero da riga di comando. */
export { main, controllaNumeri, punteggio, testoDaHtml, numeriDi, normalizza, perUrl };

const lanciatoDaSolo = (() => {
  try {
    const mio = new URL(import.meta.url).pathname;
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(mio);
  } catch { return false; }
})();
if (lanciatoDaSolo) main().catch(e => { console.error('Errore: ' + e.message); process.exit(1); });
