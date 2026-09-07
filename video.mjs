/* ============================================================
   video.mjs — il robot dei "Video meteo · Attualità"

   Legge i feed pubblici dei canali elencati in video-fonti.json
   (YouTube: il feed Atom di ogni canale o playlist, senza chiavi;
   Dailymotion: l'API pubblica dell'utente, senza chiavi), tiene solo
   i video di attualità meteo (parole chiave / parole escluse), butta
   i doppioni, verifica che si possano incorporare, rispetta il tetto
   di video al giorno e per canale, e scrive video.json — che l'app
   legge dal ramo "filmati" del repository.

   I titoli dei canali stranieri vengono riscritti in italiano con la
   stessa chiave OpenAI del blog, se c'è (OPENAI_API_KEY); senza chiave
   restano in originale. Nessun filmato viene copiato o scaricato: nel
   file ci sono solo id, titoli, miniature e link, e l'app incorpora il
   player ufficiale del canale.

   Uso:   node video.mjs                (RAMO_DIR = cartella del ramo filmati, default "ramo")
   Prove: import { giro } from './video.mjs' con una rete finta.
   ============================================================ */
import fs from 'fs';
import path from 'path';

const CHIAVE = process.env.OPENAI_API_KEY || '';
const MODELLO_TESTO = process.env.MODELLO_TESTO || 'gpt-5.6-terra';
const FUSO = process.env.FUSO || 'Europe/Rome';
const QUI = path.dirname(new URL(import.meta.url).pathname);

const dice = (...a) => console.log(...a);

/* ─────────────── piccoli attrezzi ─────────────── */
const senzaAccenti = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizza = s => senzaAccenti(s).toLowerCase().replace(/\s+/g, ' ').trim();
const giornoIn = (iso, fuso) => {
  try { return new Date(iso).toLocaleDateString('sv-SE', { timeZone: fuso }); } catch { return String(iso).slice(0, 10); }
};
const scappaXml = s => String(s || '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const tag = (xml, nome) => { const m = new RegExp('<' + nome + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + nome + '>').exec(xml); return m ? scappaXml(m[1].trim()) : ''; };
const attributo = (xml, nome, attr) => { const m = new RegExp('<' + nome + '\\b[^>]*\\b' + attr + '="([^"]*)"').exec(xml); return m ? scappaXml(m[1]) : ''; };

/** Una parola chiave "prende" se compare nel testo; le parole corte (fino a 5 lettere,
 *  senza spazi) devono essere parole intere, per non prendere lucciole per lanterne ("dana" sì, "danaro" no). */
function contiene(testo, parola) {
  const p = normalizza(parola), t = normalizza(testo);
  if (!p) return false;
  if (p.length <= 5 && !p.includes(' ')) return new RegExp('(^|[^a-z0-9])' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])').test(t);
  return t.includes(p);
}

/* le parole "di sostanza" di un titolo, per riconoscere lo stesso filmato ricaricato da due canali */
const VUOTE = new Set(['della', 'delle', 'dello', 'degli', 'nella', 'nelle', 'sulla', 'sulle', 'con', 'per', 'che', 'una', 'uno', 'gli', 'the', 'and', 'with', 'from', 'over', 'this', 'that', 'los', 'las', 'del', 'por', 'para', 'con', 'una', 'video', 'immagini', 'images', 'footage']);
function radici(titolo) {
  const fuori = new Set();
  normalizza(titolo).replace(/[^a-z0-9 ]+/g, ' ').split(' ').forEach(p => {
    if (!p || VUOTE.has(p) || p.length < 4) return;
    fuori.add(p.slice(0, 5));
  });
  return fuori;
}
function stessoFilmato(a, b) {
  const A = [...radici(a)], B = [...radici(b)];
  if (A.length < 2 || B.length < 2) return false;
  const comuni = A.filter(x => B.includes(x)).length;
  return comuni / Math.min(A.length, B.length) >= 0.6;
}

/* ─────────────── la rete (sostituibile nelle prove) ─────────────── */
const RETE = {
  async testo(url) {
    const r = await fetch(url, { headers: { 'user-agent': 'MeteoRadar-video/1.0 (blog; contatto: videopromo2000@gmail.com)', accept: 'application/xml,text/html,application/json,*/*' }, signal: AbortSignal.timeout(25000) });
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.stato = r.status; throw e; }
    return r.text();
  },
  async json(url) { return JSON.parse(await this.testo(url)); }
};

/* ─────────────── YouTube ─────────────── */
/** Da "UC…", "PL…", "@nome" o un indirizzo /c/… /user/… /@… si arriva al feed Atom. */
async function feedYoutube(fonte, rete, memoriaCanali) {
  const id = String(fonte.id || '').trim();
  if (/^PL[\w-]{10,}$/.test(id)) return { url: 'https://www.youtube.com/feeds/videos.xml?playlist_id=' + id, canaleId: id };
  if (/^UC[\w-]{20,}$/.test(id)) return { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + id, canaleId: id };
  /* handle o indirizzo: si legge la pagina del canale UNA volta e si ricorda l'id */
  const chiave = id.replace(/^https?:\/\/(www\.)?youtube\.com\//, '').replace(/\/+$/, '');
  if (memoriaCanali[chiave]) return { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + memoriaCanali[chiave], canaleId: memoriaCanali[chiave] };
  const indirizzo = /^https?:/.test(id) ? id : 'https://www.youtube.com/' + (id.startsWith('@') ? id : '@' + id);
  const pagina = await rete.testo(indirizzo);
  const m = /"channelId":"(UC[\w-]{20,})"/.exec(pagina) || /"externalId":"(UC[\w-]{20,})"/.exec(pagina)
         || /<meta itemprop="identifier" content="(UC[\w-]{20,})"/.exec(pagina) || /youtube\.com\/channel\/(UC[\w-]{20,})/.exec(pagina);
  if (!m) throw new Error('canale non riconosciuto: ' + id);
  memoriaCanali[chiave] = m[1];
  return { url: 'https://www.youtube.com/feeds/videos.xml?channel_id=' + m[1], canaleId: m[1] };
}

function leggiAtom(xml) {
  const voci = [];
  const pezzi = xml.split('<entry>').slice(1);
  for (const pezzo of pezzi) {
    const e = pezzo.split('</entry>')[0];
    const idVideo = tag(e, 'yt:videoId');
    if (!idVideo) continue;
    voci.push({
      chiave: idVideo,
      titolo: tag(e, 'title'),
      descrizione: tag(e, 'media:description').slice(0, 600),
      data: tag(e, 'published'),
      canale: tag(e, 'name'),
      anteprima: attributo(e, 'media:thumbnail', 'url') || ('https://i.ytimg.com/vi/' + idVideo + '/hqdefault.jpg')
    });
  }
  return voci;
}

/** Si può incorporare? YouTube risponde 401/403 al servizio oEmbed quando il canale lo vieta. */
async function incorporabileYoutube(chiave, rete) {
  try {
    const j = await rete.json('https://www.youtube.com/oembed?url=' + encodeURIComponent('https://www.youtube.com/watch?v=' + chiave) + '&format=json');
    return { ok: true, anteprima: j && j.thumbnail_url, canale: j && j.author_name };
  } catch (e) {
    if (e && (e.stato === 401 || e.stato === 403 || e.stato === 404)) return { ok: false };
    return { ok: null };            /* rete incerta: si riprova al giro dopo */
  }
}

/* ─────────────── Dailymotion ─────────────── */
async function feedDailymotion(fonte, rete) {
  const url = 'https://api.dailymotion.com/user/' + encodeURIComponent(fonte.id) + '/videos?fields=id,title,description,created_time,duration,thumbnail_480_url,allow_embed,url,owner.screenname&sort=recent&limit=30';
  const j = await rete.json(url);
  return (j && j.list || []).map(v => ({
    chiave: v.id,
    titolo: v.title || '',
    descrizione: String(v.description || '').slice(0, 600),
    data: v.created_time ? new Date(v.created_time * 1000).toISOString() : '',
    canale: (v['owner.screenname'] || fonte.nome),
    anteprima: v.thumbnail_480_url || '',
    durata: Number(v.duration) || 0,
    incorporabile: v.allow_embed !== false,
    url: v.url || ('https://www.dailymotion.com/video/' + v.id)
  }));
}

/* ─────────────── il setaccio ─────────────── */
/** -1 = fuori (parola esclusa nel titolo o nella descrizione), 0 = fuori tema, >0 = quante parole
 *  chiave ha preso NEL TITOLO. La descrizione non fa passare nessuno: i cacciatori di tempeste
 *  scrivono "storm chasing" in ogni descrizione, anche sotto il video dell'auto da corsa. */
function setaccio(voce, config, fonte) {
  const tutto = normalizza(voce.titolo + ' ' + voce.descrizione);
  if ((config.parole_escluse || []).some(p => contiene(tutto, p))) return -1;
  const titolo = normalizza(voce.titolo);
  const prese = (config.parole_chiave || []).filter(p => contiene(titolo, p)).length;
  if (fonte.fidato) return Math.max(1, prese);
  return prese;
}

/* ─────────────── i titoli in italiano ─────────────── */
async function inItaliano(voci, rete) {
  if (!CHIAVE || !voci.length) return 0;
  const lotto = voci.slice(0, 25);
  const corpo = {
    model: MODELLO_TESTO,
    messages: [
      { role: 'system', content: 'Sei il redattore della sezione video dell\'app meteo "Meteo Radar". Riscrivi in italiano naturale e asciutto i titoli di video meteo, senza toni da acchiappaclic. Per ogni video: "titolo" (massimo 80 caratteri, dice cosa si vede) e "riga" (massimo 110 caratteri, una frase che spiega il fatto, luogo e fenomeno). Usa SOLO le informazioni del titolo e della descrizione originali: niente cifre, luoghi o date che lì non ci sono. Rispondi solo con JSON: {"voci":[{"i":0,"titolo":"…","riga":"…"}]}' },
      { role: 'user', content: JSON.stringify({ voci: lotto.map((v, i) => ({ i, lingua: v.lingua, titolo: v.titolo, descrizione: v.descrizione.slice(0, 300) })) }) }
    ],
    response_format: { type: 'json_object' }
  };
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CHIAVE },
    body: JSON.stringify(corpo), signal: AbortSignal.timeout(120000)
  });
  const t = await r.text();
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + t.slice(0, 300));
  const j = JSON.parse(t);
  const contenuto = JSON.parse(j.choices[0].message.content);
  let fatte = 0;
  for (const v of (contenuto.voci || [])) {
    const dest = lotto[Number(v.i)];
    if (!dest || !v.titolo) continue;
    dest.titoloIt = String(v.titolo).trim().slice(0, 90);
    dest.riga = String(v.riga || '').trim().slice(0, 130);
    fatte++;
  }
  return fatte;
}

/* ─────────────── il giro ─────────────── */
/** @param opzioni { rete, adesso, config, precedente, traduci } → il nuovo video.json (oggetto) */
async function giro(opzioni = {}) {
  const rete = opzioni.rete || RETE;
  const adesso = opzioni.adesso ? new Date(opzioni.adesso) : new Date();
  const config = opzioni.config || JSON.parse(fs.readFileSync(path.join(QUI, 'video-fonti.json'), 'utf8'));
  const precedente = opzioni.precedente || { video: [], canali: {} };
  const tetto = Number(config.tetto_giorno) || 12, perCanale = Number(config.per_canale) || 4, giorni = Number(config.giorni) || 7;
  const limite = adesso.getTime() - giorni * 86400000;
  const memoriaCanali = Object.assign({}, precedente.canali || {});

  /* 1 · quello che c'era già resta (se ancora nei giorni buoni); ma se il setaccio è
     cambiato di versione, si riparte da zero: le regole nuove valgono anche per il passato */
  const setaccioCambiato = Number(precedente.versione_setaccio || 1) !== Number(config.versione_setaccio || 1);
  if (setaccioCambiato && (precedente.video || []).length) dice('· setaccio cambiato (v' + (precedente.versione_setaccio || 1) + ' → v' + (config.versione_setaccio || 1) + '): l\'elenco si rifà da zero');
  const tenuti = setaccioCambiato ? [] : (precedente.video || []).filter(v => v && v.data && new Date(v.data).getTime() >= limite && new Date(v.data).getTime() <= adesso.getTime() + 3600000);
  const gia = new Set(tenuti.map(v => v.id));
  dice('· in memoria ' + tenuti.length + ' video degli ultimi ' + giorni + ' giorni');

  /* 2 · i feed */
  const candidati = [];
  const esiti = [];
  for (const fonte of (config.fonti || [])) {
    try {
      let voci;
      if (fonte.tipo === 'dailymotion') voci = await feedDailymotion(fonte, rete);
      else {
        const f = await feedYoutube(fonte, rete, memoriaCanali);
        voci = leggiAtom(await rete.testo(f.url)).map(v => Object.assign(v, { url: 'https://www.youtube.com/watch?v=' + v.chiave }));
      }
      let fresche = 0, aTema = 0, fuori = 0;
      for (const v of voci) {
        if (!v.data || new Date(v.data).getTime() < limite) continue;
        fresche++;
        const p = setaccio(v, config, fonte);
        if (p <= 0) { fuori++; continue; }
        aTema++;
        candidati.push(Object.assign(v, { fonte, punti: p * (Number(fonte.peso) || 1), id: (fonte.tipo === 'dailymotion' ? 'dm:' : 'yt:') + v.chiave, lingua: fonte.lingua || 'it' }));
      }
      esiti.push(fonte.nome + ': ' + voci.length + ' nel feed, ' + fresche + ' fresche, ' + aTema + ' a tema, ' + fuori + ' scartate');
    } catch (e) {
      esiti.push(fonte.nome + ': NON LETTO (' + (e && e.message || e) + ')');
    }
  }
  esiti.forEach(r => dice('  · ' + r));

  /* 3 · doppioni: contro quelli già tenuti e fra di loro */
  const nuovi = [];
  candidati.sort((a, b) => b.punti - a.punti || new Date(b.data) - new Date(a.data));
  for (const c of candidati) {
    if (gia.has(c.id)) continue;
    if (tenuti.some(t => stessoFilmato(t.titolo, c.titolo)) || nuovi.some(n => stessoFilmato(n.titolo, c.titolo))) continue;
    nuovi.push(c);
  }

  /* 4 · il tetto: per giorno di pubblicazione e per canale nello stesso giorno */
  const contaGiorno = {}, contaCanale = {};
  const chiaveG = v => giornoIn(v.data, FUSO);
  for (const t of tenuti) { const g = chiaveG(t); contaGiorno[g] = (contaGiorno[g] || 0) + 1; const k = g + '|' + t.canale; contaCanale[k] = (contaCanale[k] || 0) + 1; }
  const scelti = [];
  for (const c of nuovi) {
    const g = chiaveG(c), k = g + '|' + c.fonte.nome;
    if ((contaGiorno[g] || 0) >= tetto) continue;
    if ((contaCanale[k] || 0) >= (Number(c.fonte.max_giorno) || perCanale)) continue;
    /* 5 · si può incorporare? (Dailymotion lo dice nel feed; YouTube lo si chiede) */
    if (c.fonte.tipo === 'dailymotion') { if (c.incorporabile === false) continue; }
    else {
      const e = await incorporabileYoutube(c.chiave, rete);
      if (e.ok === false) continue;
      if (e.ok === null) continue;                     /* incerto: al prossimo giro */
      if (e.anteprima) c.anteprima = e.anteprima;
      if (e.canale && !c.canale) c.canale = e.canale;
    }
    contaGiorno[g] = (contaGiorno[g] || 0) + 1; contaCanale[k] = (contaCanale[k] || 0) + 1;
    scelti.push(c);
  }

  /* 6 · i titoli stranieri in italiano */
  const daTradurre = scelti.filter(c => c.lingua && c.lingua !== 'it');
  let tradotti = 0;
  if (daTradurre.length) {
    try { tradotti = opzioni.traduci ? await opzioni.traduci(daTradurre) : await inItaliano(daTradurre, rete); }
    catch (e) { dice('  · titoli in italiano: rimandato (' + (e && e.message || e) + ')'); }
  }

  /* 7 · il file */
  const video = tenuti.concat(scelti.map(c => ({
    id: c.id, fonte: c.fonte.tipo, chiave: c.chiave,
    titolo: c.titolo, titoloIt: c.titoloIt || undefined, riga: c.riga || undefined,
    canale: c.fonte.nome, canaleNome: c.canale || c.fonte.nome, lingua: c.lingua,
    data: new Date(c.data).toISOString(), durata: c.durata || undefined,
    anteprima: c.anteprima || undefined, url: c.url
  }))).sort((a, b) => new Date(b.data) - new Date(a.data)).slice(0, tetto * giorni);

  const fuori = { versione: 1, versione_setaccio: Number(config.versione_setaccio || 1), aggiornato: adesso.toISOString(), tetto_giorno: tetto, per_canale: perCanale, giorni,
                  canali: memoriaCanali, video };
  dice('✔ video.json: ' + video.length + ' video (' + scelti.length + ' nuovi, ' + tradotti + ' titoli riscritti in italiano)');
  return fuori;
}

async function main() {
  const dir = process.env.RAMO_DIR || path.join(QUI, 'ramo');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'video.json');
  let precedente = null;
  try { precedente = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { precedente = null; }
  const fuori = await giro({ precedente });
  fs.writeFileSync(file, JSON.stringify(fuori, null, 1));
  dice('scritto ' + file);
}

export { giro, setaccio, leggiAtom, stessoFilmato, contiene, normalizza, feedYoutube, feedDailymotion, inItaliano };

const lanciatoDaSolo = (() => {
  try { return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname); } catch { return false; }
})();
if (lanciatoDaSolo) main().catch(e => { console.error('Errore: ' + e.message); process.exit(1); });
