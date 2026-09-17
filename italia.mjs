/* ============================================================
   italia.mjs — "Il video del giorno · Italia", presentato da Steve.
   Un filmato al giorno (edizione delle 7, come quello del mondo) in cui
   Steve — la foto che parla di steve_foto.mjs — racconta il tempo di oggi
   sull'Italia in capitoli: cielo e temperature, pioggia e temporali,
   vento, mare, neve (quando c'è). A sinistra scorre la mappa animata del
   capitolo (sono i sei filmati dell'Italia già fatti da animazioni.mjs:
   niente chiamate in più per le mappe), al centro i numeri delle città,
   a destra Steve; sotto, la striscia col titolo del capitolo.
   Il racconto lo scrivono le regole sui numeri veri: DUE chiamate a
   Open-Meteo (quattordici città in una richiesta sola, e sette punti di mare)
   — dentro il gratuito con largo margine. La voce è la stessa del mondo
   (cedar), un pezzo per capitolo così ogni mappa resta in scena quanto
   dura il suo racconto. Sigla e cornice da telegiornale come per il mondo.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { createCanvas, loadImage } from 'canvas';
import { preparaSteve, statiDallaVoce } from './steve_foto.mjs';

const dice = (...a) => console.log(...a);
const QUI = path.dirname(new URL(import.meta.url).pathname);
const SIGLA = path.join(QUI, 'sigla.mp3');
const CARTELLA_STEVE = path.join(QUI, 'steve');
const VOCE = (process.env.VOCE || 'cedar').trim();
const ATTACCO_VOCE = 5.0, CALA_DA = 4.2, CALA_A = 5.8, SOTTO = 0.14, CODA = 1.5;
const W = 768, H = 432, FPS = 25;
const PAUSA = 0.55;                     /* secondi di respiro fra un capitolo e l'altro */

/* ─────────────── le città e i mari ─────────────── */
const CITTA = [
  { n: 'Milano', la: 45.46, lo: 9.19, area: 'Nord' }, { n: 'Torino', la: 45.07, lo: 7.69, area: 'Nord' },
  { n: 'Venezia', la: 45.44, lo: 12.33, area: 'Nord' }, { n: 'Genova', la: 44.41, lo: 8.93, area: 'Nord' },
  { n: 'Bologna', la: 44.49, lo: 11.34, area: 'Nord' }, { n: 'Firenze', la: 43.77, lo: 11.25, area: 'Centro' },
  { n: 'Roma', la: 41.89, lo: 12.49, area: 'Centro' }, { n: 'Ancona', la: 43.62, lo: 13.52, area: 'Centro' },
  { n: 'Napoli', la: 40.85, lo: 14.27, area: 'Sud' }, { n: 'Bari', la: 41.12, lo: 16.87, area: 'Sud' },
  { n: 'Reggio Calabria', la: 38.11, lo: 15.65, area: 'Sud' }, { n: 'Palermo', la: 38.12, lo: 13.36, area: 'Isole' },
  { n: 'Cagliari', la: 39.22, lo: 9.11, area: 'Isole' }, { n: 'Bolzano', la: 46.50, lo: 11.35, area: 'Alpi' }
];
const MARI = [
  { n: 'Mar Ligure', breve: 'Ligure', la: 43.9, lo: 9.0 }, { n: 'Tirreno centrale', breve: 'Tirreno centrale', la: 41.3, lo: 12.0 }, { n: 'Tirreno meridionale', breve: 'Tirreno sud', la: 39.5, lo: 14.5 },
  { n: 'Adriatico settentrionale', breve: 'Adriatico nord', la: 44.5, lo: 13.2 }, { n: 'Adriatico meridionale', breve: 'Adriatico sud', la: 41.5, lo: 17.2 }, { n: 'Ionio', breve: 'Ionio', la: 38.5, lo: 17.5 },
  { n: 'Canale di Sardegna', breve: 'Canale di Sardegna', la: 38.6, lo: 8.8 }
];
const AREE = ['Nord', 'Centro', 'Sud', 'Isole'];

function urlMeteo() {
  const la = CITTA.map(c => c.la).join(','), lo = CITTA.map(c => c.lo).join(',');
  return 'https://api.open-meteo.com/v1/forecast?latitude=' + la + '&longitude=' + lo +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_gusts_10m_max,snowfall_sum' +
    '&hourly=precipitation,weather_code,wind_gusts_10m,freezing_level_height&forecast_days=2&timezone=Europe%2FRome&wind_speed_unit=kmh';
}
function urlMare() {
  const la = MARI.map(c => c.la).join(','), lo = MARI.map(c => c.lo).join(',');
  return 'https://marine-api.open-meteo.com/v1/marine?latitude=' + la + '&longitude=' + lo + '&daily=wave_height_max&hourly=wave_height&forecast_days=2&timezone=Europe%2FRome';
}

/* ─────────────── i numeri, letti con calma ─────────────── */
const PIOVE = c => (c >= 51 && c <= 67) || (c >= 80 && c <= 82) || c === 95 || c === 96 || c === 99;
const TEMPORALE = c => c === 95 || c === 96 || c === 99;
const NEVICA = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
function cielo(c) {
  if (TEMPORALE(c)) return 'temporali';
  if (PIOVE(c)) return 'pioggia';
  if (NEVICA(c)) return 'neve';
  if (c === 45 || c === 48) return 'nebbia';
  if (c === 0 || c === 1) return 'sole';
  if (c === 2) return 'nuvole e schiarite';
  return 'nuvole';
}
const arr = x => Math.round(x);
const fasce = (ore) => ore.map(h => h < 6 ? 'notte' : h < 12 ? 'mattina' : h < 18 ? 'pomeriggio' : 'sera');
function quandoPiove(h, giorno) {
  /* le ore del giorno (0 = oggi) con pioggia: da che fascia a che fascia */
  const ore = [];
  for (let i = giorno * 24; i < giorno * 24 + 24 && i < h.time.length; i++) if ((h.precipitation[i] || 0) >= 0.3) ore.push(i - giorno * 24);
  if (!ore.length) return null;
  const f = fasce(ore);
  const prima = f[0], ultima = f[f.length - 1];
  if (ore.length >= 16) return 'per quasi tutto il giorno';
  const UNA = { notte: 'nella notte', mattina: 'in mattinata', pomeriggio: 'nel pomeriggio', sera: 'in serata' };
  const DA = { notte: 'dalla notte', mattina: 'dal mattino', pomeriggio: 'dal pomeriggio', sera: 'dalla sera' };
  if (prima === ultima) return UNA[prima];
  return DA[prima];
}
function elenco(nomi) {
  if (!nomi.length) return '';
  if (nomi.length === 1) return nomi[0];
  return nomi.slice(0, -1).join(', ') + ' e ' + nomi[nomi.length - 1];
}
const statoMare = m => m < 0.5 ? 'calmo' : m < 1.25 ? 'poco mosso' : m < 2.5 ? 'mosso' : m < 4 ? 'molto mosso' : 'agitato';
/* "sul Mar Ligure", "sul Tirreno centrale", "sull'Adriatico settentrionale", "sullo Ionio", "sul Canale di Sardegna" */
const sulMare = n => /^Ionio/.test(n) ? 'sullo ' + n : /^[AEIOU]/.test(n) ? 'sull\'' + n : 'sul ' + n;

/** Dai due JSON di Open-Meteo, i numeri del bollettino. Pura: si prova al banco. */
export function numeriItalia(meteo, mare) {
  const lista = Array.isArray(meteo) ? meteo : [meteo];
  const citta = CITTA.map((c, i) => {
    const d = lista[i] && lista[i].daily, h = lista[i] && lista[i].hourly;
    if (!d) return null;
    return {
      n: c.n, area: c.area,
      codOggi: d.weather_code[0], codDomani: d.weather_code[1],
      tmax: d.temperature_2m_max[0], tmin: d.temperature_2m_min[0], tmaxDomani: d.temperature_2m_max[1],
      mm: d.precipitation_sum[0] || 0, mmDomani: d.precipitation_sum[1] || 0, prob: d.precipitation_probability_max[0] || 0,
      raffica: d.wind_gusts_10m_max[0] || 0, neve: d.snowfall_sum[0] || 0,
      quandoOggi: h ? quandoPiove(h, 0) : null, quandoDomani: h ? quandoPiove(h, 1) : null,
      zeroTermico: h && h.freezing_level_height ? Math.min(...h.freezing_level_height.slice(0, 24).filter(Number.isFinite)) : NaN
    };
  }).filter(Boolean);
  const listaMare = Array.isArray(mare) ? mare : mare ? [mare] : [];
  const mari = MARI.map((m, i) => {
    const d = listaMare[i] && listaMare[i].daily;
    return d ? { n: m.n, breve: m.breve, onda: d.wave_height_max[0] || 0, ondaDomani: d.wave_height_max[1] || 0 } : null;
  }).filter(Boolean);
  const aree = AREE.map(a => {
    const cs = citta.filter(c => c.area === a);
    if (!cs.length) return null;
    const conta = {};
    cs.forEach(c => { const k = cielo(c.codOggi); conta[k] = (conta[k] || 0) + 1; });
    const cieloPrev = Object.entries(conta).sort((p, q) => q[1] - p[1])[0][0];
    return { area: a, cielo: cieloPrev, tmaxMin: Math.min(...cs.map(c => c.tmax)), tmaxMax: Math.max(...cs.map(c => c.tmax)), citta: cs };
  }).filter(Boolean);
  const alpi = citta.find(c => c.area === 'Alpi');
  return { citta, mari, aree, alpi };
}

/** Il racconto, capitolo per capitolo: { id, titolo, film, frasi[], numeri[] }. */
export function raccontoItalia(n, adesso, ora) {
  const h = Number.isFinite(Number(ora)) ? Number(ora) : 7;
  const saluto = h < 12 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera';
  const cap = [];
  /* 1 · apertura */
  cap.push({ id: 'apertura', titolo: 'Il tempo di oggi sull\'Italia', film: 'temperature',
    frasi: [saluto + ', sono Steve di Meteo Radar News: ecco il tempo di oggi sull\'Italia, città per città.'], numeri: [] });
  /* 2 · cielo e temperature per area */
  const frasiCielo = [];
  for (const a of n.aree) {
    const dove = a.area === 'Nord' ? 'Al Nord' : a.area === 'Centro' ? 'Al Centro' : a.area === 'Sud' ? 'Al Sud' : 'Sulle isole';
    const c = a.cielo === 'sole' ? 'cielo sereno' : a.cielo === 'nuvole e schiarite' ? 'nuvole alternate a schiarite' : a.cielo === 'nuvole' ? 'cielo coperto' : a.cielo === 'pioggia' ? 'pioggia' : a.cielo === 'temporali' ? 'temporali' : a.cielo === 'neve' ? 'neve' : 'nebbia';
    const t = a.tmaxMin === a.tmaxMax ? 'massime intorno ai ' + arr(a.tmaxMax) + ' gradi' : 'massime fra ' + arr(a.tmaxMin) + ' e ' + arr(a.tmaxMax) + ' gradi';
    frasiCielo.push(dove + ' ' + c + ', ' + t + '.');
  }
  cap.push({ id: 'cielo', titolo: 'Cielo e temperature', film: 'temperature', frasi: frasiCielo,
    numeri: n.citta.filter(c => c.area !== 'Alpi').map(c => ({ n: c.n, v: arr(c.tmax) + '°', sub: arr(c.tmin) + '°' })) });
  /* 3 · pioggia e temporali */
  const bagnate = n.citta.filter(c => c.area !== 'Alpi' && (c.mm >= 1 || TEMPORALE(c.codOggi)));
  const temporali = bagnate.filter(c => TEMPORALE(c.codOggi));
  const frasiP = [];
  if (!bagnate.length) frasiP.push('Pioggia: oggi niente di rilevante, tutte le città restano asciutte.');
  else {
    const forte = bagnate.filter(c => c.mm >= 10).sort((p, q) => q.mm - p.mm);
    const dove = elenco(bagnate.map(c => c.n));
    const quando = bagnate[0].quandoOggi ? ' ' + bagnate[0].quandoOggi : '';
    const abbondante = !forte.length ? '' : forte.length === 1 ? ', abbondante su ' + forte[0].n + ' con ' + arr(forte[0].mm) + ' millimetri'
      : ', abbondante su ' + (forte.length > 3 ? forte.slice(0, 3).map(c => c.n).join(', ') + ' e altre città' : elenco(forte.map(c => c.n))) + ', fino a ' + arr(forte[0].mm) + ' millimetri a ' + forte[0].n;
    frasiP.push('Pioggia oggi su ' + dove + quando + abbondante + '.');
    if (temporali.length) frasiP.push('Attenzione ai temporali su ' + elenco(temporali.map(c => c.n)) + '.');
  }
  const bagnateDomani = n.citta.filter(c => c.area !== 'Alpi' && c.mmDomani >= 1);
  frasiP.push(bagnateDomani.length ? 'Domani pioggia su ' + elenco(bagnateDomani.map(c => c.n)) + (bagnateDomani[0].quandoDomani ? ' ' + bagnateDomani[0].quandoDomani : '') + '.' : 'Domani asciutto quasi ovunque.');
  cap.push({ id: 'pioggia', titolo: 'Pioggia e temporali', film: 'pioggia', frasi: frasiP,
    numeri: n.citta.filter(c => c.area !== 'Alpi').map(c => ({ n: c.n, v: c.mm >= 0.5 ? (Math.round(c.mm * 10) / 10).toFixed(c.mm >= 10 ? 0 : 1).replace('.', ',') + ' mm' : '—', sub: c.prob + '%' })) });
  /* 4 · vento */
  const ventose = n.citta.filter(c => c.area !== 'Alpi').sort((p, q) => q.raffica - p.raffica);
  const top = ventose[0];
  const frasiV = [];
  if (!top || top.raffica < 40) frasiV.push('Vento debole o moderato su tutta la penisola.');
  else {
    const forti = ventose.filter(c => c.raffica >= 40).slice(0, 3);
    frasiV.push('Vento ' + (top.raffica >= 70 ? 'molto forte' : 'forte') + ' su ' + elenco(forti.map(c => c.n)) + ', con raffiche fino a ' + arr(top.raffica) + ' chilometri orari a ' + top.n + '.');
  }
  cap.push({ id: 'vento', titolo: 'Vento', film: 'vento', frasi: frasiV,
    numeri: n.citta.filter(c => c.area !== 'Alpi').map(c => ({ n: c.n, v: arr(c.raffica) + ' km/h', sub: 'raffiche' })) });
  /* 5 · mare */
  if (n.mari.length) {
    const mossi = n.mari.filter(m => m.onda >= 1.25).sort((p, q) => q.onda - p.onda);
    const frasiM = [];
    if (!mossi.length) frasiM.push('Mari calmi o poco mossi su tutte le coste.');
    else {
      const m = mossi[0];
      frasiM.push('Mare ' + statoMare(m.onda) + ' ' + sulMare(m.n) + ' con onde fino a ' + (Math.round(m.onda * 10) / 10).toString().replace('.', ',') + ' metri' +
        (mossi.length > 1 ? ', mosso anche ' + elenco(mossi.slice(1, 3).map(x => sulMare(x.n))) : '') + '; altrove poco mosso o calmo.');
    }
    cap.push({ id: 'mare', titolo: 'Mare', film: 'mare', frasi: frasiM, numeri: n.mari.map(m => ({ n: m.breve || m.n, v: (Math.round(m.onda * 10) / 10).toString().replace('.', ',') + ' m', sub: statoMare(m.onda) })) });
  }
  /* 6 · neve (solo quando c'è) */
  const a = n.alpi;
  const nevose = n.citta.filter(c => c.neve >= 0.5);
  if (nevose.length || (a && Number.isFinite(a.zeroTermico) && a.zeroTermico < 2600)) {
    const quota = a && Number.isFinite(a.zeroTermico) ? Math.max(0, Math.round((a.zeroTermico - 300) / 100) * 100) : null;
    const frasiN = [];
    if (nevose.length) frasiN.push('Neve su ' + elenco(nevose.map(c => c.n)) + '.');
    if (quota !== null) frasiN.push('Sulle Alpi la quota neve è intorno ai ' + quota + ' metri.');
    cap.push({ id: 'neve', titolo: 'Neve', film: 'neve', frasi: frasiN, numeri: (a ? [{ n: 'Quota neve Alpi', v: quota !== null ? quota + ' m' : '—', sub: 'zero termico ' + (Number.isFinite(a.zeroTermico) ? arr(a.zeroTermico) + ' m' : '—') }] : []) });
  }
  /* 7 · chiusura */
  cap.push({ id: 'chiusura', titolo: 'A domani', film: 'nuvole', frasi: ['È tutto per oggi. Buona giornata da Meteo Radar News, e a domani.'], numeri: [] });
  return cap;
}

/* ─────────────── i fotogrammi delle sei mappe ─────────────── */
function fotogrammiFilm(cartella, id, ffmpeg, dirTmp) {
  const src = path.join(cartella, id + '.mp4');
  if (!fs.existsSync(src)) return null;
  const dir = path.join(dirTmp, 'mappa_' + id);
  fs.mkdirSync(dir, { recursive: true });
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', src, path.join(dir, 'm_%04d.png')], { stdio: 'inherit' });
  const file = fs.readdirSync(dir).filter(f => /^m_\d+\.png$/.test(f)).sort();
  return file.length ? { dir, file, fps: 6 } : null;
}

/* ─────────────── la voce ─────────────── */
async function parla(testo, destinazione, chiave, voce) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + chiave },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts', voice: voce, input: testo, response_format: 'mp3',
      instructions: 'Parla in italiano come un presentatore meteo simpatico che si rivolge al pubblico a braccio, non come chi legge un bollettino. Tono caldo, naturale e colloquiale, un sorriso nella voce, ritmo disinvolto con piccole pause fra una frase e l\'altra. Il saluto iniziale è accogliente, la chiusura è cordiale. Niente enfasi da pubblicità. Pronuncia i numeri per esteso.'
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + (await r.text()).slice(0, 200));
  fs.writeFileSync(destinazione, Buffer.from(await r.arrayBuffer()));
  if (fs.statSync(destinazione).size < 2000) throw new Error('audio troppo corto');
}
function durataAudio(file, ffmpeg) {
  try {
    const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
    const s = execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim();
    const v = Number(s); return Number.isFinite(v) ? v : 0;
  } catch (e) { return 0; }
}

/* ─────────────── il disegno di un fotogramma ─────────────── */
const GIORNI3 = ['DOM', 'LUN', 'MAR', 'MER', 'GIO', 'VEN', 'SAB'];
const MESI3 = ['GEN', 'FEB', 'MAR', 'APR', 'MAG', 'GIU', 'LUG', 'AGO', 'SET', 'OTT', 'NOV', 'DIC'];
function tondo(g, x, y, w, h, r) {
  g.beginPath(); g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r); g.lineTo(x + w, y + h - r);
  g.quadraticCurveTo(x + w, y + h, x + w - r, y + h); g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r); g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y); g.closePath();
}
function disegnaFotogramma(g, o) {
  /* fondo */
  const fondo = g.createLinearGradient(0, 0, 0, H); fondo.addColorStop(0, '#0b1220'); fondo.addColorStop(1, '#14233d');
  g.fillStyle = fondo; g.fillRect(0, 0, W, H);
  /* la mappa a sinistra (portrait 544×728 → 246×329) */
  const MX = 22, MY = 34, MW = 246, MH = 329;
  g.save(); tondo(g, MX, MY, MW, MH, 10); g.clip();
  if (o.mappa) g.drawImage(o.mappa, MX, MY, MW, MH); else { g.fillStyle = '#122a44'; g.fillRect(MX, MY, MW, MH); }
  g.restore();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 1.5; tondo(g, MX, MY, MW, MH, 10); g.stroke();
  /* i numeri delle città al centro */
  const CX = 284, CY = 34, CW = 188, CH = 329;
  g.fillStyle = 'rgba(8,24,46,0.72)'; tondo(g, CX, CY, CW, CH, 10); g.fill();
  g.fillStyle = '#ffd166'; g.font = 'bold 11px DejaVu Sans, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  if ((o.capitolo.numeri || []).length) g.fillText(o.capitolo.titolo.toUpperCase(), CX + 12, CY + 20);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(CX + 12, CY + 26, CW - 24, 1);
  let righe = (o.capitolo.numeri || []).slice(0, 13);
  if (!righe.length) {
    /* apertura e chiusura: la scaletta dell'edizione, come in un telegiornale */
    g.fillStyle = '#ffd166'; g.font = 'bold 11px DejaVu Sans, sans-serif'; g.textAlign = 'left';
    g.fillText('IN QUESTA EDIZIONE', CX + 12, CY + 20);
    o.capitoli.filter(c => c.numeri && c.numeri.length).forEach((c, i) => {
      const y = CY + 56 + i * 34;
      g.fillStyle = c === o.capitolo ? '#ffffff' : '#c8102e'; g.beginPath(); g.arc(CX + 20, y - 5, 4, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e6edf7'; g.font = '14px DejaVu Sans, sans-serif'; g.fillText(c.titolo, CX + 34, y);
    });
    righe = [];
  }
  const passo = righe.length > 9 ? 22 : 30;
  righe.forEach((r, i) => {
    const y = CY + 46 + i * passo;
    g.fillStyle = '#ffffff'; g.font = 'bold ' + (passo > 24 ? '14px' : '12px') + ' DejaVu Sans, sans-serif'; g.textAlign = 'right';
    g.fillText(r.v, CX + CW - 12, y);
    const largoValore = g.measureText(r.v).width;
    g.fillStyle = '#e6edf7'; g.font = (passo > 24 ? '13px' : '11px') + ' DejaVu Sans, sans-serif'; g.textAlign = 'left';
    let nome = String(r.n); const posto = CW - 24 - largoValore - 10;
    while (nome.length > 3 && g.measureText(nome).width > posto) nome = nome.slice(0, -2).trimEnd() + '…';
    g.fillText(nome, CX + 12, y);
    if (r.sub && passo > 24) { g.fillStyle = '#8ea3c4'; g.font = '9px DejaVu Sans, sans-serif'; g.textAlign = 'right'; g.fillText(r.sub, CX + CW - 12, y + 10); g.textAlign = 'left'; }
  });
  /* Steve a destra, nel suo riquadro */
  const SW = 268, SX = W - SW - 16;
  const alt = SW * o.steve.h / o.steve.w, SY = H - alt + 26;
  g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = 18; g.shadowOffsetY = 6;
  g.beginPath(); g.moveTo(SX + 22, SY); g.lineTo(SX + SW - 22, SY); g.quadraticCurveTo(SX + SW, SY, SX + SW, SY + 22); g.lineTo(SX + SW, H); g.lineTo(SX, H); g.lineTo(SX, SY + 22); g.quadraticCurveTo(SX, SY, SX + 22, SY); g.closePath();
  g.fillStyle = '#c9d6e8'; g.fill(); g.restore();
  g.save(); g.beginPath(); g.moveTo(SX + 22, SY); g.lineTo(SX + SW - 22, SY); g.quadraticCurveTo(SX + SW, SY, SX + SW, SY + 22); g.lineTo(SX + SW, H); g.lineTo(SX, H); g.lineTo(SX, SY + 22); g.quadraticCurveTo(SX, SY, SX + 22, SY); g.closePath(); g.clip();
  o.steve.disegna(g, SX, SY, SW, o.stato, o.t);
  g.restore();
  /* la cornice da telegiornale: barra rossa, marchio, edizione, striscia in basso */
  g.fillStyle = '#c8102e'; g.fillRect(0, 0, W, 6);
  g.fillStyle = 'rgba(8,24,46,0.85)'; g.fillRect(0, 6, W, 24);
  g.fillStyle = '#c8102e'; tondo(g, 10, 10, 28, 16, 3); g.fill();
  g.fillStyle = '#fff'; g.font = 'bold 10px DejaVu Sans, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('MR', 24, 18);
  g.textAlign = 'left'; g.font = 'bold 11px DejaVu Sans, sans-serif'; g.fillText('METEO RADAR NEWS · IL VIDEO DEL GIORNO · ITALIA', 46, 18);
  g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,0.75)'; g.font = 'bold 10px DejaVu Sans, sans-serif'; g.fillText(o.edizione, W - 12, 18);
  g.textBaseline = 'alphabetic';
  /* la striscia del capitolo */
  g.fillStyle = 'rgba(8,24,46,0.88)'; g.fillRect(0, H - 40, 456, 40);
  g.fillStyle = '#c8102e'; g.fillRect(0, H - 40, 6, 40);
  g.fillStyle = '#fff'; g.font = 'bold 15px DejaVu Sans, sans-serif'; g.textAlign = 'left'; g.fillText(o.capitolo.titolo.toUpperCase(), 18, H - 16);
  g.fillStyle = '#ffd166'; g.font = 'bold 10px DejaVu Sans, sans-serif'; g.fillText('CON STEVE', 18, H - 30);
  /* la barra dei capitoli */
  const nCap = o.capitoli.length, bx = 18, bw = 420;
  for (let i = 0; i < nCap; i++) {
    g.fillStyle = i < o.indice ? '#ffd166' : i === o.indice ? '#ffffff' : 'rgba(255,255,255,0.25)';
    g.fillRect(bx + i * (bw / nCap), H - 44, bw / nCap - 3, 2);
  }
}

/* ─────────────── il filmato ─────────────── */
export async function filmatoItalia(o) {
  const rete = o.rete, adesso = o.adesso ? new Date(o.adesso) : new Date(), ffmpeg = o.ffmpeg || 'ffmpeg';
  const cartella = o.cartella, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'italia-'));   /* fuori dal ramo: se qualcosa va storto non resta niente da pubblicare */
  const oggi = new Intl.DateTimeFormat('sv-SE', { timeZone: o.fuso || 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(adesso);
  const ora = Number(new Intl.DateTimeFormat('en-GB', { timeZone: o.fuso || 'Europe/Rome', hour: '2-digit', hour12: false }).format(adesso)) % 24;
  const edizione = GIORNI3[new Date(oggi + 'T12:00:00Z').getUTCDay()] + ' ' + Number(oggi.slice(8, 10)) + ' ' + MESI3[Number(oggi.slice(5, 7)) - 1] + ' · ORE ' + String(ora).padStart(2, '0');

  /* 1 · i numeri: due chiamate */
  dice('· Italia: quattordici città in una chiamata, sette mari in un\'altra');
  const meteo = await rete.json(urlMeteo());
  let mare = null;
  try { mare = await rete.json(urlMare()); } catch (e) { dice('  ✘ mare non disponibile: ' + e.message + ' (il capitolo salta)'); }
  const n = numeriItalia(meteo, mare);
  const capitoli = raccontoItalia(n, adesso, ora);
  dice('  · ' + capitoli.length + ' capitoli: ' + capitoli.map(c => c.id).join(', '));

  /* 2 · Steve */
  const cartellaSteve = o.cartellaSteve || CARTELLA_STEVE;
  const steve = await preparaSteve(cartellaSteve, 460);

  /* 3 · la voce, un pezzo per capitolo (così ogni mappa resta quanto dura il suo racconto) */
  const parlatore = o.parlatore || parla;
  const pezzi = [];
  let parlato = false;
  if (o.chiave || o.parlatore) {
    for (let i = 0; i < capitoli.length; i++) {
      const file = path.join(dir, 'voce_' + i + '.mp3');
      try {
        await parlatore(capitoli[i].frasi.join(' '), file, o.chiave, o.voce || VOCE);
        const s = durataAudio(file, ffmpeg);
        pezzi.push({ file, secondi: s });
        parlato = true;
      } catch (e) { dice('  ✘ voce del capitolo ' + capitoli[i].id + ': ' + e.message); pezzi.push({ file: null, secondi: 4 }); }
    }
  } else {
    dice('  · niente chiave OpenAI: filmato muto, ogni capitolo dura 6 secondi');
    capitoli.forEach(() => pezzi.push({ file: null, secondi: 6 }));
  }
  /* la voce intera, in fila con le pause, per le labbra e per il mix */
  let voce = null;
  if (parlato) {
    const lista = path.join(dir, 'lista.txt');
    const righe = [];
    const silenzio = path.join(dir, 'pausa.mp3');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', String(PAUSA), '-c:a', 'libmp3lame', '-b:a', '64k', silenzio], { stdio: 'inherit' });
    pezzi.forEach((p, i) => {
      if (p.file) righe.push("file '" + p.file + "'"); else righe.push("file '" + silenzio + "'");
      if (i < pezzi.length - 1) righe.push("file '" + silenzio + "'");
    });
    fs.writeFileSync(lista, righe.join('\n') + '\n');
    voce = path.join(dir, 'voce.mp3');
    execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista, '-c:a', 'libmp3lame', '-b:a', '96k', '-ar', '24000', voce], { stdio: 'inherit' });
    dice('  · voce: ' + durataAudio(voce, ffmpeg).toFixed(1) + ' s in tutto');
  }
  const stati = voce ? statiDallaVoce(voce, FPS, ffmpeg) : [];
  const attacco = Math.round(ATTACCO_VOCE * FPS);
  const BATTITO = [0.45, 0.9, 1, 1, 0.7, 0.4, 0.15];      /* fuori dalla voce (sigla, coda, filmato muto): bocca chiusa e un battito di ciglia ogni 3,6 s */
  const statoA = (f) => { const i = f - attacco; if (i >= 0 && i < stati.length) return stati[i]; const k = f % 90; return { apertura: 0, o: 0, palpebre: k < BATTITO.length ? BATTITO[k] : 0 }; };

  /* 4 · i fotogrammi delle mappe */
  const mappe = {};
  for (const c of capitoli) if (!mappe[c.film]) mappe[c.film] = fotogrammiFilm(cartella, c.film, ffmpeg, dir);
  const cacheMappa = new Map();
  const mappaA = async (film, t) => {
    const m = mappe[film]; if (!m) return null;
    const idx = Math.floor(t * m.fps) % m.file.length;
    const k = film + '|' + idx;
    if (!cacheMappa.has(k)) cacheMappa.set(k, await loadImage(path.join(m.dir, m.file[idx])));
    return cacheMappa.get(k);
  };

  /* 5 · il montaggio: sigla per cinque secondi sulla prima mappa, poi i capitoli uno dopo l'altro */
  const durate = capitoli.map((c, i) => pezzi[i].secondi + PAUSA);
  const inizio = [ATTACCO_VOCE];
  for (let i = 1; i < capitoli.length; i++) inizio.push(inizio[i - 1] + durate[i - 1]);
  const fine = inizio[capitoli.length - 1] + durate[capitoli.length - 1] + CODA;
  const nf = Math.ceil(fine * FPS);
  const tela = createCanvas(W, H), g = tela.getContext('2d');
  let poster = false;
  for (let f = 0; f < nf; f++) {
    const t = f / FPS;
    let indice = 0; for (let i = 0; i < capitoli.length; i++) if (t >= inizio[i]) indice = i;
    const cap = capitoli[indice];
    const tCap = Math.max(0, t - inizio[indice]);
    const mappa = await mappaA(cap.film, tCap);
    disegnaFotogramma(g, { mappa, capitolo: cap, capitoli, indice, steve, stato: statoA(f), t, edizione });
    fs.writeFileSync(path.join(dir, 'f_' + String(f).padStart(5, '0') + '.png'), tela.toBuffer('image/png'));
    if (!poster && t >= 1.2) { fs.writeFileSync(path.join(cartella, 'italia.jpg'), tela.toBuffer('image/jpeg', { quality: 0.84 })); poster = true; }
  }

  /* 6 · l'audio: sigla piena per cinque secondi, poi sotto la voce */
  let traccia = voce;
  if (fs.existsSync(SIGLA)) {
    try {
      const mix = path.join(dir, 'audio.mp3');
      const tot = fine;
      const sfuma = Math.max(0.5, tot - CODA);
      const arg = ['-hide_banner', '-loglevel', 'error', '-y', '-i', SIGLA];
      if (voce) arg.push('-i', voce);
      const filtro = voce
        ? "[0:a]volume='if(lt(t," + CALA_DA + "),1,if(lt(t," + CALA_A + "),1-" + (1 - SOTTO) + "*(t-" + CALA_DA + ")/" + (CALA_A - CALA_DA) + "," + SOTTO + "))':eval=frame[m];" +
          "[1:a]adelay=" + Math.round(ATTACCO_VOCE * 1000) + "|" + Math.round(ATTACCO_VOCE * 1000) + "[v];" +
          "[m][v]amix=inputs=2:normalize=0:duration=longest,afade=t=out:st=" + sfuma.toFixed(2) + ":d=" + CODA + ",alimiter=limit=0.95[a]"
        : "[0:a]afade=t=out:st=" + sfuma.toFixed(2) + ":d=" + CODA + "[a]";
      arg.push('-filter_complex', filtro, '-map', '[a]', '-t', tot.toFixed(2), '-c:a', 'libmp3lame', '-b:a', '128k', mix);
      execFileSync(ffmpeg, arg, { stdio: 'inherit' });
      traccia = mix;
    } catch (e) { dice('  ✘ sigla non montata (' + e.message + '): resta la sola voce'); }
  }

  const uscita = path.join(cartella, 'italia.mp4');
  const arg = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f_%05d.png')];
  if (traccia) arg.push('-i', traccia);
  arg.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '27', '-pix_fmt', 'yuv420p');
  if (traccia) arg.push('-c:a', 'aac', '-b:a', '112k', '-shortest');
  arg.push('-movflags', '+faststart', uscita);
  execFileSync(ffmpeg, arg, { stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });

  return {
    id: 'italia', titolo: 'Il video del giorno · Italia', sotto: 'Steve racconta cielo, temperature, pioggia, vento, mare e neve, città per città',
    file: 'previsioni/italia.mp4', poster: 'previsioni/italia.jpg', secondi: Math.round(fine * 10) / 10, fotogrammi: nf,
    byte: fs.statSync(uscita).size, generato: adesso.toISOString(), edizione, parlato, presentatore: 'Steve',
    capitoli: capitoli.map((c, i) => ({ id: c.id, titolo: c.titolo, da: Math.round(inizio[i] * 10) / 10 })),
    racconto: capitoli.flatMap(c => c.frasi)
  };
}

/** Il filmato dell'Italia è ancora fresco? Stessa regola del mondo: l'edizione delle 7. */
export function frescoItalia(precedente, dir, adesso, inizioEdizione) {
  const v = precedente && precedente.italia;
  if (!v || !v.generato || !v.file) return false;
  const fatto = new Date(v.generato).getTime();
  if (!(adesso.getTime() - fatto >= 0 && adesso.getTime() - fatto < 36 * 3600000)) return false;
  const inizio = typeof inizioEdizione === 'function' ? inizioEdizione(adesso) : null;
  if (inizio !== null && fatto < inizio) return false;
  return fs.existsSync(path.join(dir, v.file)) && (!v.poster || fs.existsSync(path.join(dir, v.poster)));
}

export { CITTA, MARI, urlMeteo, urlMare, cielo, statoMare };
