/* ============================================================
   mondo.mjs — "Da dove arriva il tempo": il filmato del giorno

   Una volta al giorno (la sveglia arriva dalle 7 del mattino) si
   prende una griglia larga su Atlantico, Europa e Nord Africa dal
   modello di Open-Meteo e si disegna un filmato solo, in formato
   televisivo, con dentro:

     · il vento in quota (850 hPa, circa 1.500 metri) coi filamenti
       bianchi che scorrono come su Windy, e le piogge sopra;
     · il calo termico: l'aria in quota che si raffredda dietro al
       fronte;
     · la cornice da telegiornale — barra del marchio, fascia rossa
       del titolo, striscia delle notizie in basso — disegnata QUI
       DENTRO e non nell'app: così la grafica si può cambiare quando
       si vuole senza rifare l'APK;
     · la voce che racconta, montata nel filmato (OpenAI, la stessa
       chiave del blog: OPENAI_API_KEY). Senza chiave il filmato si
       fa lo stesso, muto, e il racconto resta scritto.

   Il filmato si chiama sempre previsioni/mondo.mp4: quello di oggi
   prende il posto di quello di ieri, che sparisce da solo (il ramo
   "filmati" viene rifatto da capo a ogni pubblicazione). Niente da
   cancellare a mano, niente archivio che cresce.

   Il racconto NON è inventato da un modello di linguaggio: le frasi
   nascono dai numeri della griglia (dove sta la depressione, quando
   arriva la pioggia, di quanto scende la temperatura, quanto tira il
   vento). Al modello si chiede solo di leggerle ad alta voce.

   Costo: circa 760 chiamate a Open-Meteo al giorno, più qualche
   centesimo di voce. Dentro al gratuito insieme ai sei filmati
   dell'Italia (che ne usano circa 5.000 al giorno).
   ============================================================ */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createCanvas } from 'canvas';
import { leggiConfini, creaVista, fondoScuro, contorni, citta, Scie } from './confini.mjs';

const dice = (...a) => console.log(...a);

/* ─────────────── la finestra e la griglia ─────────────── */
const M = { latMin: 28, latMax: 68, lonMin: -35, lonMax: 35, passo: 2 };
const NLAT = Math.round((M.latMax - M.latMin) / M.passo) + 1;   /* 21 */
const NLON = Math.round((M.lonMax - M.lonMin) / M.passo) + 1;   /* 36 */
const W = 768, H = 432;                                          /* 16:9, pari: piace a H.264 */
const FPS = 12;
const VARIABILI = 'wind_speed_850hPa,wind_direction_850hPa,temperature_850hPa,geopotential_height_850hPa,precipitation,temperature_2m';

/* la scatola dell'Italia, per le frasi che riguardano noi */
const ITALIA = { latMin: 36, latMax: 47, lonMin: 7, lonMax: 18 };

function puntiGriglia() {
  const p = [];
  for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) p.push({ lat: M.latMin + i * M.passo, lon: M.lonMin + j * M.passo, i, j });
  return p;
}

async function scaricaGriglia(rete, fuso) {
  const punti = puntiGriglia();
  const risultato = new Array(punti.length);
  let time = null;
  for (let da = 0; da < punti.length; da += 100) {
    if (da > 0) await new Promise(r => setTimeout(r, 1500));   /* un respiro fra un pezzo e l'altro: non si tempesta il servizio */
    const pezzo = punti.slice(da, da + 100);
    const lat = pezzo.map(p => p.lat.toFixed(2)).join(','), lon = pezzo.map(p => p.lon.toFixed(2)).join(',');
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon +
      '&hourly=' + VARIABILI + '&forecast_days=4&timezone=' + encodeURIComponent(fuso);
    const j = await rete.json(url);
    const lista = Array.isArray(j) ? j : [j];
    if (lista.length !== pezzo.length) throw new Error('risposta con ' + lista.length + ' punti invece di ' + pezzo.length);
    lista.forEach((r, k) => {
      if (!time) time = r.hourly.time;
      risultato[da + k] = { lat: pezzo[k].lat, lon: pezzo[k].lon, i: pezzo[k].i, j: pezzo[k].j, hourly: r.hourly };
    });
  }
  return { time, punti: risultato };
}

function campo(griglia, variabile, k, trasforma) {
  const m = [];
  for (let i = 0; i < NLAT; i++) m.push(new Array(NLON).fill(NaN));
  griglia.punti.forEach(p => {
    if (!p || !p.hourly || !p.hourly[variabile]) return;
    const v = Number(p.hourly[variabile][k]);
    m[p.i][p.j] = trasforma ? trasforma(v, p) : v;
  });
  return m;
}

function campiona(m, lat, lon) {
  const fi = (lat - M.latMin) / M.passo, fj = (lon - M.lonMin) / M.passo;
  if (fi < 0 || fj < 0 || fi > NLAT - 1 || fj > NLON - 1) return NaN;
  const i0 = Math.min(NLAT - 2, Math.floor(fi)), j0 = Math.min(NLON - 2, Math.floor(fj));
  const ti = fi - i0, tj = fj - j0;
  const a = m[i0][j0], b = m[i0][j0 + 1], c = m[i0 + 1][j0], d = m[i0 + 1][j0 + 1];
  if (![a, b, c, d].every(Number.isFinite)) {
    const cand = [[a, (1 - ti) * (1 - tj)], [b, (1 - ti) * tj], [c, ti * (1 - tj)], [d, ti * tj]].filter(x => Number.isFinite(x[0]));
    if (!cand.length) return NaN;
    cand.sort((x, y) => y[1] - x[1]);
    return cand[0][0];
  }
  return (a * (1 - tj) + b * tj) * (1 - ti) + (c * (1 - tj) + d * tj) * ti;
}

/* ─────────────── colori ─────────────── */
const esa = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
function scala(tappe, sotto = true) {
  const t = tappe.map(([v, c, a]) => [v, esa(c), a == null ? 0.65 : a]);
  return v => {
    if (!Number.isFinite(v)) return [0, 0, 0, 0];
    if (v <= t[0][0]) return sotto ? [0, 0, 0, 0] : [...t[0][1], t[0][2]];
    for (let k = 1; k < t.length; k++) {
      if (v <= t[k][0]) {
        const f = (v - t[k - 1][0]) / (t[k][0] - t[k - 1][0]);
        const c = t[k - 1][1].map((x, q) => Math.round(x + (t[k][1][q] - x) * f));
        return [...c, t[k - 1][2] + (t[k][2] - t[k - 1][2]) * f];
      }
    }
    const u = t[t.length - 1]; return [...u[1], u[2]];
  };
}
const TAPPE_VENTO = [[10, '#25548c', .30], [30, '#2fa8c4', .48], [50, '#3fc98e', .58], [70, '#ddc63c', .66], [95, '#ef6a3a', .74], [120, '#e0447a', .80], [160, '#a34bd6', .86]];
const TAPPE_TEMP  = [[-24, '#4b1f7a', .78], [-16, '#2b3fa0', .74], [-8, '#2483d6', .70], [-2, '#2fb5c0', .66], [4, '#49bf70', .62], [10, '#ccc93c', .64], [16, '#ef9b36', .70], [22, '#e2563c', .76], [28, '#8e1f2a', .82]];
const TAPPE_PIOG  = [[0.2, '#8fd0ff', .35], [1, '#3f9bee', .55], [3, '#2f6ee0', .70], [7, '#6a4fdc', .80], [15, '#c74ad0', .88]];
const VENTO = scala(TAPPE_VENTO), TEMP = scala(TAPPE_TEMP, false), PIOG = scala(TAPPE_PIOG);

/* ─────────────── il tempo ─────────────── */
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];
const MESI3 = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];
const GIORNI3 = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
const giornoDi = t => new Date(t + ':00Z').getUTCDay();
const oraDi = t => Number(t.slice(11, 13));
/** "2026-09-17T18:00" → "giovedì sera" */
function quandoAParole(t, oggi) {
  const h = oraDi(t), g = giornoDi(t);
  const parte = h < 6 ? 'nella notte' : h < 12 ? 'in mattinata' : h < 18 ? 'nel pomeriggio' : 'in serata';
  const giorno = t.slice(0, 10) === oggi ? 'oggi' : GIORNI[g];
  if (giorno === 'oggi') return 'oggi ' + (h < 6 ? 'nella notte' : h < 12 ? 'in mattinata' : h < 18 ? 'nel pomeriggio' : 'in serata');
  return giorno + ' ' + parte;
}
const orarioBreve = t => GIORNI3[giornoDi(t)] + ' ' + Number(t.slice(8, 10)) + ' ' + MESI3[Number(t.slice(5, 7)) - 1] + ' · ' + t.slice(11, 16);

/* ─────────────── i posti, per dire dove sta la depressione ─────────────── */
const POSTI = [
  { n: 'in mezzo all\'Atlantico', v: 'verso il centro dell\'Atlantico', b: 'ATLANTICO', lat: 45, lon: -30 },
  { n: 'sull\'Atlantico a ovest dell\'Irlanda', v: 'verso l\'Atlantico a ovest dell\'Irlanda', b: 'ATLANTICO A OVEST DELL\'IRLANDA', lat: 52, lon: -20 },
  { n: 'fra Islanda e Groenlandia', v: 'verso l\'Islanda', b: 'FRA ISLANDA E GROENLANDIA', lat: 65, lon: -25 },
  { n: 'a sud dell\'Islanda', v: 'verso sud dell\'Islanda', b: 'A SUD DELL\'ISLANDA', lat: 60, lon: -18 },
  { n: 'sulle Isole britanniche', v: 'verso le Isole britanniche', b: 'ISOLE BRITANNICHE', lat: 54, lon: -3 },
  { n: 'sul Mare del Nord', v: 'verso il Mare del Nord', b: 'MARE DEL NORD', lat: 56, lon: 3 },
  { n: 'sulla Scandinavia', v: 'verso la Scandinavia', b: 'SCANDINAVIA', lat: 63, lon: 15 },
  { n: 'sul Mar Baltico', v: 'verso il Mar Baltico', b: 'MAR BALTICO', lat: 58, lon: 20 },
  { n: 'sull\'Europa centrale', v: 'verso l\'Europa centrale', b: 'EUROPA CENTRALE', lat: 50, lon: 13 },
  { n: 'sulla Francia', v: 'verso la Francia', b: 'FRANCIA', lat: 47, lon: 2 },
  { n: 'sul Golfo di Biscaglia', v: 'verso il Golfo di Biscaglia', b: 'GOLFO DI BISCAGLIA', lat: 45, lon: -6 },
  { n: 'sulla Penisola iberica', v: 'verso la Penisola iberica', b: 'PENISOLA IBERICA', lat: 40, lon: -4 },
  { n: 'sulle Azzorre', v: 'verso le Azzorre', b: 'AZZORRE', lat: 38, lon: -27 },
  { n: 'sul Mediterraneo occidentale', v: 'verso il Mediterraneo occidentale', b: 'MEDITERRANEO OCCIDENTALE', lat: 40, lon: 6 },
  { n: 'sull\'Italia', v: 'verso l\'Italia', b: 'ITALIA', lat: 42, lon: 13 },
  { n: 'sui Balcani', v: 'verso i Balcani', b: 'BALCANI', lat: 44, lon: 21 },
  { n: 'sul Mediterraneo orientale', v: 'verso il Mediterraneo orientale', b: 'MEDITERRANEO ORIENTALE', lat: 35, lon: 25 },
  { n: 'sul Nord Africa', v: 'verso il Nord Africa', b: 'NORD AFRICA', lat: 31, lon: 5 },
  { n: 'sull\'Europa orientale', v: 'verso l\'Europa orientale', b: 'EUROPA ORIENTALE', lat: 52, lon: 30 }
];
function vicino(lat, lon) {
  let mig = POSTI[0], d = Infinity;
  for (const p of POSTI) {
    const dx = (p.lon - lon) * Math.cos(lat * Math.PI / 180), dy = p.lat - lat;
    const q = dx * dx + dy * dy;
    if (q < d) { d = q; mig = p; }
  }
  return mig;
}
const posto = (lat, lon) => vicino(lat, lon).n;
const ROSA = ['nord', 'nord-est', 'est', 'sud-est', 'sud', 'sud-ovest', 'ovest', 'nord-ovest'];
const daDove = gradi => ROSA[Math.round(((gradi % 360) + 360) % 360 / 45) % 8];

/* ─────────────── i numeri e il racconto ─────────────── */
const dentroItalia = (lat, lon) => lat >= ITALIA.latMin && lat <= ITALIA.latMax && lon >= ITALIA.lonMin && lon <= ITALIA.lonMax;

/** Legge la griglia e tira fuori i numeri veri su cui si basa il racconto. */
function numeri(griglia, indici) {
  const t = griglia.time;
  const puntiIt = griglia.punti.filter(p => p && dentroItalia(p.lat, p.lon));
  const media = (p, v, k) => {
    let s = 0, n = 0;
    p.forEach(q => { const x = Number(q.hourly[v] && q.hourly[v][k]); if (Number.isFinite(x)) { s += x; n++; } });
    return n ? s / n : NaN;
  };
  const massimo = (p, v, k) => {
    let m = -Infinity;
    p.forEach(q => { const x = Number(q.hourly[v] && q.hourly[v][k]); if (Number.isFinite(x) && x > m) m = x; });
    return Number.isFinite(m) ? m : NaN;
  };
  /* la depressione: il minimo di altezza geopotenziale a 850 hPa */
  const minimo = k => {
    let m = Infinity, dove = null;
    griglia.punti.forEach(p => {
      const x = Number(p.hourly.geopotential_height_850hPa && p.hourly.geopotential_height_850hPa[k]);
      if (Number.isFinite(x) && x < m) { m = x; dove = p; }
    });
    return dove ? { h: m, lat: dove.lat, lon: dove.lon } : null;
  };
  const k0 = indici[0], kFine = indici[indici.length - 1];
  const kMezzo = indici[Math.floor(indici.length / 2)];
  const bassa0 = minimo(k0), bassa1 = minimo(kMezzo), bassa2 = minimo(kFine);

  /* la pioggia sull'Italia: la prima ora in cui la media supera la soglia */
  let primaPioggia = null, piovosa = 0;
  for (const k of indici) {
    const m = media(puntiIt, 'precipitation', k);
    if (Number.isFinite(m) && m >= 0.25) { if (primaPioggia === null) primaPioggia = k; piovosa++; }
  }
  /* la temperatura in quota sull'Italia: adesso e il minimo dei tre giorni */
  let t850ora = media(puntiIt, 'temperature_850hPa', k0), t850min = Infinity, kFreddo = k0;
  let t2ora = media(puntiIt, 'temperature_2m', k0), t2min = Infinity;
  for (const k of indici) {
    const a = media(puntiIt, 'temperature_850hPa', k);
    if (Number.isFinite(a) && a < t850min) { t850min = a; kFreddo = k; }
    const b = media(puntiIt, 'temperature_2m', k);
    if (Number.isFinite(b) && b < t2min) t2min = b;
  }
  /* il vento in quota sull'Italia: il massimo e da dove soffia in quel momento */
  let ventoMax = -Infinity, kVento = k0;
  for (const k of indici) {
    const v = massimo(puntiIt, 'wind_speed_850hPa', k);
    if (Number.isFinite(v) && v > ventoMax) { ventoMax = v; kVento = k; }
  }
  const versoVento = media(puntiIt, 'wind_direction_850hPa', kVento);

  return {
    t, k0, kFine, kMezzo, bassa0, bassa1, bassa2,
    primaPioggia, orePiovose: piovosa,
    t850ora, t850min, kFreddo, calo: Number.isFinite(t850ora) && Number.isFinite(t850min) ? t850ora - t850min : NaN,
    t2ora, t2min, caloSuolo: Number.isFinite(t2ora) && Number.isFinite(t2min) ? t2ora - t2min : NaN,
    ventoMax, kVento, versoVento
  };
}

/** Le frasi del racconto (quelle che legge la voce) e i titoli della striscia. */
function racconto(n, oggi) {
  const f = [], ev = [];
  const arr = x => Math.round(x);
  if (n.bassa0) {
    let frase = 'La bassa pressione più profonda si trova ' + posto(n.bassa0.lat, n.bassa0.lon);
    if (n.bassa2) {
      const dLon = n.bassa2.lon - n.bassa0.lon, dLat = n.bassa2.lat - n.bassa0.lat;
      const spostata = Math.hypot(dLon * Math.cos(n.bassa0.lat * Math.PI / 180), dLat) > 4;
      if (spostata) frase += ' e nei tre giorni si sposta ' + vicino(n.bassa2.lat, n.bassa2.lon).v;
      else frase += ' e nei tre giorni resta lì';
    }
    f.push(frase + '.');
    ev.push('BASSA PRESSIONE ' + posto(n.bassa0.lat, n.bassa0.lon).toUpperCase());
  }
  if (n.primaPioggia !== null) {
    f.push('Sull\'Italia la pioggia arriva ' + quandoAParole(n.t[n.primaPioggia], oggi) + '.');
    ev.push('PIOGGIA SULL\'ITALIA ' + quandoAParole(n.t[n.primaPioggia], oggi).toUpperCase());
  } else {
    f.push('Sull\'Italia, in questi tre giorni, il modello non vede pioggia di rilievo.');
    ev.push('TRE GIORNI SENZA PIOGGIA DI RILIEVO');
  }
  if (Number.isFinite(n.calo) && n.calo >= 2) {
    f.push('Dietro al fronte entra aria più fredda: in quota, a millecinquecento metri, la temperatura sull\'Italia scende di ' + arr(n.calo) + ' gradi entro ' + quandoAParole(n.t[n.kFreddo], oggi) + '.');
    ev.push('IN QUOTA ' + arr(n.calo) + ' GRADI IN MENO');
  } else if (Number.isFinite(n.calo)) {
    f.push('In quota la temperatura sull\'Italia resta più o meno com\'è, senza cali importanti.');
    ev.push('IN QUOTA NESSUN CALO IMPORTANTE');
  }
  if (Number.isFinite(n.ventoMax) && n.ventoMax >= 40) {
    f.push('Il vento in quota soffia da ' + daDove(n.versoVento) + ', fino a ' + arr(n.ventoMax) + ' chilometri orari.');
    ev.push('VENTO IN QUOTA DA ' + daDove(n.versoVento).toUpperCase() + ' FINO A ' + arr(n.ventoMax) + ' KM/H');
  }
  return { frasi: f, evidenza: ev };
}

/* ─────────────── il disegno ─────────────── */
function strato(vista, matrice, colore, mezzo) {
  /* il colore si calcola a metà risoluzione e poi si ingrandisce: quattro volte più veloce e non si vede la differenza */
  const w = Math.round(vista.W / (mezzo || 2)), h = Math.round(vista.H / (mezzo || 2));
  const tela = createCanvas(w, h), g = tela.getContext('2d');
  const img = g.createImageData(w, h), d = img.data;
  const lats = new Float64Array(h), lons = new Float64Array(w);
  for (let y = 0; y < h; y++) lats[y] = vista.lat(y * (mezzo || 2));
  for (let x = 0; x < w; x++) lons[x] = vista.lon(x * (mezzo || 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = colore(campiona(matrice, lats[y], lons[x]));
    if (c[3] <= 0) continue;
    const o = (y * w + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.round(c[3] * 255);
  }
  g.putImageData(img, 0, 0);
  return tela;
}

function testoTagliato(g, testo, larghezza) {
  let r = testo;
  while (r.length > 4 && g.measureText(r).width > larghezza) r = r.slice(0, -2).trimEnd() + '…';
  return r;
}

/** La cornice da telegiornale, disegnata sopra la mappa. */
function cornice(g, o) {
  /* barra in alto */
  const barra = 34;
  const grad = g.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, '#08182e'); grad.addColorStop(1, '#153561');
  g.fillStyle = grad; g.fillRect(0, 0, W, barra);
  g.fillStyle = '#c8102e'; g.fillRect(11, 8, 30, 18);
  g.fillStyle = '#fff'; g.font = 'bold 12px "DejaVu Sans"'; g.textAlign = 'center';
  g.fillText('MR', 26, 21);
  g.textAlign = 'left'; g.font = 'bold 14px "DejaVu Sans"';
  g.fillText('METEO RADAR NEWS', 50, 22);
  g.textAlign = 'right'; g.font = 'bold 11px "DejaVu Sans"'; g.fillStyle = 'rgba(255,255,255,.78)';
  g.fillText(o.edizione, W - 12, 21);
  g.textAlign = 'left';

  /* cornice bianca attorno alla mappa */
  const striscia = 26;
  g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2;
  g.strokeRect(8.5, barra + 6.5, W - 17, H - barra - striscia - 13);

  /* bollo rosso in alto a sinistra */
  g.fillStyle = '#c8102e'; g.fillRect(16, barra + 14, 130, 20);
  g.fillStyle = '#fff'; g.beginPath(); g.arc(27, barra + 24, 3.4, 0, 7); g.fill();
  g.font = 'bold 10px "DejaVu Sans"';
  g.fillText('EDIZIONE DI OGGI', 35, barra + 28);

  /* il momento, in alto a destra */
  const q = g.measureText(o.quando).width;
  g.fillStyle = 'rgba(0,0,0,.62)'; g.fillRect(W - 28 - q - 12, barra + 14, q + 24, 20);
  g.fillStyle = '#eaf4ff'; g.font = 'bold 11px "DejaVu Sans"';
  g.fillText(o.quando, W - 28 - q, barra + 28);

  /* terzo inferiore: fascia rossa col titolo + riga blu col sottotitolo */
  const base = H - striscia;
  g.font = 'bold 19px "DejaVu Sans"';
  const lt = g.measureText(o.titolo).width;
  g.fillStyle = '#c8102e'; g.fillRect(0, base - 54, lt + 32, 28);
  g.fillStyle = '#fff'; g.fillText(o.titolo, 16, base - 34);
  g.fillStyle = 'rgba(6,18,36,.93)'; g.fillRect(0, base - 26, W, 26);
  g.fillStyle = '#c8102e'; g.fillRect(0, base - 28, W, 2);
  g.fillStyle = '#e8f1ff'; g.font = '12px "DejaVu Sans"';
  g.fillText(testoTagliato(g, o.sotto, W - 32), 16, base - 9);

  /* striscia delle notizie che scorre */
  g.fillStyle = '#060b14'; g.fillRect(0, base, W, striscia);
  g.fillStyle = '#c8102e'; g.fillRect(0, base, 86, striscia);
  g.fillStyle = '#fff'; g.font = 'bold 10px "DejaVu Sans"';
  g.fillText('IN EVIDENZA', 9, base + 17);
  g.save();
  g.beginPath(); g.rect(90, base, W - 90, striscia); g.clip();
  g.font = 'bold 11px "DejaVu Sans"';
  const testo = o.evidenza;
  const largo = g.measureText(testo).width + 60;
  let x = 96 - (o.scorrimento % largo);
  for (let r = 0; r < 3 && x < W; r++) { g.fillStyle = '#e9f0fb'; g.fillText(testo, x, base + 17); x += largo; }
  g.restore();

  /* il bollo delle prove: c'è solo quando il filmato è fatto con dati finti */
  if (o.prova) {
    g.font = 'bold 11px "DejaVu Sans"';
    const l = g.measureText('PROVA · DATI FINTI').width;
    g.fillStyle = '#b3001b'; g.fillRect(W / 2 - l / 2 - 10, 42, l + 20, 20);
    g.fillStyle = '#fff'; g.textAlign = 'center';
    g.fillText('PROVA · DATI FINTI', W / 2, 56);
    g.textAlign = 'left';
  }

  /* legenda della scala, sopra la striscia a destra */
  if (o.legenda) {
    const lw = 150, lh = 8, lx = W - lw - 16, ly = base - 70;
    const gr = g.createLinearGradient(lx, 0, lx + lw, 0);
    const tp = o.legenda.tappe;
    for (let k = 0; k < tp.length; k++) {
      const c = o.legenda.scala(tp[k][0]);
      gr.addColorStop(k / (tp.length - 1), 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.min(1, c[3] + .3) + ')');
    }
    g.fillStyle = 'rgba(6,14,26,.6)'; g.fillRect(lx - 8, ly - 16, lw + 16, lh + 28);
    g.fillStyle = gr; g.fillRect(lx, ly, lw, lh);
    g.fillStyle = 'rgba(230,240,255,.9)'; g.font = 'bold 9px "DejaVu Sans"';
    g.fillText(o.legenda.unita, lx, ly - 5);
    g.textAlign = 'center';
    g.fillText(String(tp[0][0]).replace('.', ','), lx + 6, ly + lh + 10);
    g.fillText(String(tp[tp.length - 1][0]).replace('.', ','), lx + lw - 8, ly + lh + 10);
    g.textAlign = 'left';
  }
}

/* ─────────────── il filmato ─────────────── */
/** @param o { rete, adesso, dir, cartella, ffmpeg, fuso, chiave, voce, prova } */
async function filmatoMondo(o) {
  const fuso = o.fuso || 'Europe/Rome';
  const adesso = o.adesso ? new Date(o.adesso) : new Date();
  const ffmpeg = o.ffmpeg || 'ffmpeg';
  const cartella = o.cartella;
  const conf = leggiConfini().mondo;
  const vista = creaVista({ lonMin: M.lonMin, lonMax: M.lonMax, latMin: M.latMin, latMax: M.latMax, W, H });

  dice('· griglia larga su Atlantico, Europa e Nord Africa (' + (NLAT * NLON) + ' punti, 4 giorni)');
  const griglia = await scaricaGriglia(o.rete, fuso);
  const t = griglia.time;
  const oggi = adesso.toLocaleDateString('sv-SE', { timeZone: fuso });
  const ora = Number(adesso.toLocaleTimeString('en-GB', { timeZone: fuso, hour: '2-digit', hour12: false }).slice(0, 2)) % 24;
  const inizio = Math.max(0, t.findIndex(x => x >= oggi + 'T' + String(ora).padStart(2, '0') + ':00'));
  const finoA = Math.min(t.length - 1, inizio + 72);
  const oreTutte = [];
  for (let k = inizio; k <= finoA; k++) oreTutte.push(k);
  if (oreTutte.length < 12) throw new Error('la griglia non copre abbastanza ore');

  const n = numeri(griglia, oreTutte);
  const r = racconto(n, oggi);
  const evidenza = r.evidenza.join('   ●   ') + '   ●   ';
  const edizione = GIORNI3[adesso.getUTCDay()].toUpperCase() + ' ' + Number(oggi.slice(8, 10)) + ' ' + MESI3[Number(oggi.slice(5, 7)) - 1].toUpperCase() + ' · ORE ' + String(ora).padStart(2, '0');

  const fondo = fondoScuro(vista, conf);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mondo-'));
  const sc = new Scie({ vista, quante: 3000, veloce: 0.06, sbiadisce: 0.06, vita: [40, 110] });
  let nf = 0;

  /* due capitoli dentro allo stesso filmato */
  const capitoli = [
    { titolo: 'Da dove arriva il tempo', sotto: 'le piogge in arrivo e il vento in quota che le porta · prossime 72 ore',
      ore: oreTutte, sub: 2, tipo: 'pioggia' },
    { titolo: 'Calo termico', sotto: 'la temperatura dell\'aria in quota, a 1.500 metri · prossime 72 ore',
      ore: oreTutte.filter((_, i) => i % 2 === 0), sub: 2, tipo: 'temperatura' }
  ];

  for (const cap of capitoli) {
    for (const k of cap.ore) {
      const vento = campo(griglia, 'wind_speed_850hPa', k);
      const verso = campo(griglia, 'wind_direction_850hPa', k);
      const colore = cap.tipo === 'pioggia'
        ? strato(vista, campo(griglia, 'precipitation', k), PIOG)
        : strato(vista, campo(griglia, 'temperature_850hPa', k), TEMP);
      const dove = (lat, lon) => {
        const f = campiona(vento, lat, lon), v = campiona(verso, lat, lon);
        return (Number.isFinite(f) && Number.isFinite(v)) ? [f, v] : null;
      };
      for (let q = 0; q < cap.sub; q++) {
        const tela = createCanvas(W, H), g = tela.getContext('2d');
        g.drawImage(fondo, 0, 0);
        g.imageSmoothingEnabled = true;
        g.drawImage(colore, 0, 0, W, H);
        g.drawImage(sc.passo(dove, { colore: cap.tipo === 'pioggia' ? 'rgba(255,255,255,.8)' : 'rgba(255,255,255,.5)', spessore: 1 }), 0, 0);
        contorni(g, vista, conf, { costa: 'rgba(195,232,255,.92)', spessore: 1.4, stati: 'rgba(170,200,235,.4)', spessoreStati: .9, alone: 'rgba(0,0,0,.3)' });
        citta(g, vista, conf, { corpo: 11, minimo: 0 });          /* solo le capitali: sulla mappa larga i nomi piccoli si pesterebbero */
        cornice(g, {
          titolo: cap.titolo, sotto: cap.sotto, quando: orarioBreve(t[k]), edizione,
          evidenza, scorrimento: nf * 1.6, prova: !!o.prova,
          legenda: cap.tipo === 'pioggia' ? { tappe: TAPPE_PIOG, scala: PIOG, unita: 'PIOGGIA · mm/h' } : { tappe: TAPPE_TEMP, scala: TEMP, unita: 'ARIA A 1.500 m · °C' }
        });
        fs.writeFileSync(path.join(dir, 'f_' + String(nf).padStart(4, '0') + '.png'), tela.toBuffer('image/png'));
        if (nf === 18) fs.writeFileSync(path.join(cartella, 'mondo.jpg'), tela.toBuffer('image/jpeg', { quality: 0.84 }));
        nf++;
      }
    }
  }
  if (!nf) throw new Error('nessun fotogramma');

  /* la voce */
  let audio = null, secondiVoce = 0;
  const parlatore = o.parlatore || parla;
  if ((o.chiave || o.parlatore) && r.frasi.length) {
    try {
      audio = path.join(dir, 'voce.mp3');
      await parlatore(r.frasi.join(' '), audio, o.chiave, o.voce || 'onyx');
      secondiVoce = durataAudio(audio, ffmpeg);
      dice('  · voce: ' + secondiVoce.toFixed(1) + ' s');
    } catch (e) { dice('  ✘ voce non fatta: ' + e.message); audio = null; }
  } else if (!o.chiave) dice('  · niente chiave OpenAI: filmato muto, il racconto resta scritto');

  /* l'ultimo fotogramma tiene botta finché la voce non ha finito (e almeno un secondo e mezzo) */
  const durataVideo = nf / FPS;
  const fermo = Math.max(Math.round(1.5 * FPS), Math.ceil((secondiVoce + 0.8 - durataVideo) * FPS));
  const ultimo = fs.readFileSync(path.join(dir, 'f_' + String(nf - 1).padStart(4, '0') + '.png'));
  for (let q = 0; q < fermo; q++) fs.writeFileSync(path.join(dir, 'f_' + String(nf + q).padStart(4, '0') + '.png'), ultimo);

  const uscita = path.join(cartella, 'mondo.mp4');
  const arg = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(FPS), '-i', path.join(dir, 'f_%04d.png')];
  if (audio) arg.push('-i', audio);
  arg.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '30', '-pix_fmt', 'yuv420p');
  if (audio) arg.push('-c:a', 'aac', '-b:a', '96k', '-shortest');
  arg.push('-movflags', '+faststart', uscita);
  execFileSync(ffmpeg, arg, { stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });

  const secondi = Math.round((nf + fermo) / FPS * 10) / 10;
  return {
    id: 'mondo', titolo: 'Da dove arriva il tempo',
    sotto: 'Atlantico, Europa e Nord Africa · vento in quota, piogge e calo termico · 72 ore',
    file: 'previsioni/mondo.mp4', poster: 'previsioni/mondo.jpg',
    secondi, fotogrammi: nf, da: t[inizio], a: t[finoA],
    byte: fs.statSync(uscita).size, generato: adesso.toISOString(),
    edizione, parlato: !!audio, racconto: r.frasi, evidenza: r.evidenza,
    griglia: M.passo.toFixed(1).replace('.', ',') + '° · ' + (NLAT * NLON) + ' punti',
    finestra: [M.lonMin, M.latMin, M.lonMax, M.latMax]
  };
}

/* ─────────────── la voce ─────────────── */
async function parla(testo, destinazione, chiave, voce) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + chiave },
    body: JSON.stringify({
      model: 'gpt-4o-mini-tts',
      voice: voce,
      input: testo,
      response_format: 'mp3',
      instructions: 'Parla in italiano, con la calma e la chiarezza di chi legge le previsioni del tempo in televisione. Tono cortese e sicuro, ritmo tranquillo, senza enfasi da pubblicità. Pronuncia i numeri per esteso.'
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
    const v = Number(s);
    return Number.isFinite(v) ? v : 0;
  } catch (e) { return 0; }
}

/** Il filmato del giorno è ancora fresco? (fatto da meno di minOre, col file al suo posto) */
function frescoMondo(precedente, dir, adesso, minOre) {
  const v = precedente && precedente.mondo;
  if (!v || !v.generato || !v.file) return false;
  const eta = (adesso.getTime() - new Date(v.generato).getTime()) / 3600000;
  if (!(eta >= 0 && eta < minOre)) return false;
  return fs.existsSync(path.join(dir, v.file)) && (!v.poster || fs.existsSync(path.join(dir, v.poster)));
}

export { filmatoMondo, frescoMondo, numeri, racconto, scaricaGriglia, campo, campiona, puntiGriglia, posto, vicino, daDove, quandoAParole, M, W, H, NLAT, NLON };
