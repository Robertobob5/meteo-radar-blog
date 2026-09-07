/* ============================================================
   animazioni.mjs — le "Previsioni in video" fatte da Meteo Radar

   Come fa Meteored con le sue animazioni a pagamento, ma gratis per
   tutti: si prende la griglia dell'Italia (0,5° · 625 punti) dal
   modello di Open-Meteo, si disegna un fotogramma per ogni ora sopra
   la mappa chiara di CARTO (la stessa dell'app) e con ffmpeg si fanno
   sei filmati brevi:
     temperature · 5 giorni     pioggia e temporali · 48 ore
     vento e raffiche · weekend  neve accumulata · 7 giorni
     nuvolosità · domani        mare e onde · 48 ore
   Escono in previsioni/*.mp4 con una locandina (*.jpg) e l'elenco in
   previsioni.json, sul ramo "filmati" del repository. Il calcolo lo fa
   GitHub una volta sola per tutti: il telefono scarica solo i filmati.

   Costo: circa 1.250 "chiamate" Open-Meteo per giro (625 punti per le
   previsioni + 625 per il mare), entro il limite gratuito anche con
   quattro giri al giorno. Se un servizio non risponde, quel filmato
   resta quello del giro prima e gli altri si fanno lo stesso.

   Uso:   node animazioni.mjs        (RAMO_DIR = cartella del ramo filmati, default "ramo")
   Prove: import { giro, ... } con una rete finta.
   Serve: npm install canvas@3 · ffmpeg nel PATH
   ============================================================ */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { createCanvas, loadImage } from 'canvas';

const FUSO = process.env.FUSO || 'Europe/Rome';
const QUI = path.dirname(new URL(import.meta.url).pathname);
const dice = (...a) => console.log(...a);

/* ─────────────── la griglia e la mappa ─────────────── */
const G = { latMin: 35.5, latMax: 47.5, lonMin: 6.5, lonMax: 18.5, passo: 0.5 };
const NLAT = Math.round((G.latMax - G.latMin) / G.passo) + 1;   /* 25 */
const NLON = Math.round((G.lonMax - G.lonMin) / G.passo) + 1;   /* 25 */
const Z = 6, TX0 = 33, TX1 = 35, TY0 = 22, TY1 = 25;
const MONDO = 256 * Math.pow(2, Z);
const mercX = lon => (lon + 180) / 360 * MONDO;
const mercY = lat => (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * MONDO;
const daMercY = y => Math.atan(Math.sinh(Math.PI * (1 - 2 * y / MONDO))) * 180 / Math.PI;
const daMercX = x => x / MONDO * 360 - 180;
const X0 = mercX(G.lonMin), X1 = mercX(G.lonMax), Y0 = mercY(G.latMax), Y1 = mercY(G.latMin);
const W = 544, H = 728;                                           /* dimensioni pari: piacciono a H.264 */
const CHIAVE_CARTO = 'cb1_25vc_1_c419815e8f7b2b406d15aa41';

function puntiGriglia() {
  const p = [];
  for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) p.push({ lat: G.latMin + i * G.passo, lon: G.lonMin + j * G.passo, i, j });
  return p;
}

/* ─────────────── la rete (sostituibile nelle prove) ─────────────── */
const RETE = {
  async json(url) {
    for (let tentativo = 1; tentativo <= 3; tentativo++) {
      const r = await fetch(url, { headers: { 'user-agent': 'MeteoRadar-animazioni/1.0 (contatto: videopromo2000@gmail.com)' }, signal: AbortSignal.timeout(60000) });
      if (r.ok) return r.json();
      const corpo = await r.text().catch(() => '');
      if (r.status === 429 || r.status >= 500) { dice('  · HTTP ' + r.status + ', riprovo fra ' + (20 * tentativo) + ' s'); await new Promise(res => setTimeout(res, 20000 * tentativo)); continue; }
      throw new Error('HTTP ' + r.status + ' ' + corpo.slice(0, 200));
    }
    throw new Error('servizio non disponibile');
  },
  async immagine(url) {
    const r = await fetch(url, { headers: { 'user-agent': 'MeteoRadar-animazioni/1.0' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return Buffer.from(await r.arrayBuffer());
  }
};

/* ─────────────── Open-Meteo ─────────────── */
const VARIABILI = 'temperature_2m,precipitation,weather_code,cape,wind_gusts_10m,wind_direction_10m,snowfall,cloud_cover';

/** Scarica la griglia a pezzi di 125 punti. Torna { time, punti[i]: { lat, lon, elevation, hourly } }. */
async function scaricaGriglia(rete, tipo) {
  const punti = puntiGriglia();
  const risultato = new Array(punti.length);
  let time = null;
  for (let da = 0; da < punti.length; da += 125) {
    const pezzo = punti.slice(da, da + 125);
    const lat = pezzo.map(p => p.lat.toFixed(2)).join(','), lon = pezzo.map(p => p.lon.toFixed(2)).join(',');
    const url = tipo === 'mare'
      ? 'https://marine-api.open-meteo.com/v1/marine?latitude=' + lat + '&longitude=' + lon + '&hourly=wave_height,wave_direction&forecast_days=3&timezone=' + encodeURIComponent(FUSO)
      : 'https://api.open-meteo.com/v1/forecast?latitude=' + lat + '&longitude=' + lon + '&hourly=' + VARIABILI + '&forecast_days=8&timezone=' + encodeURIComponent(FUSO);
    const j = await rete.json(url);
    const lista = Array.isArray(j) ? j : [j];
    if (lista.length !== pezzo.length) throw new Error('risposta con ' + lista.length + ' punti invece di ' + pezzo.length);
    lista.forEach((r, k) => {
      if (!time) time = r.hourly.time;
      risultato[da + k] = { lat: pezzo[k].lat, lon: pezzo[k].lon, i: pezzo[k].i, j: pezzo[k].j, elevation: Number(r.elevation), hourly: r.hourly,
                            cella: { lat: Number(r.latitude), lon: Number(r.longitude) } };
    });
  }
  return { time, punti: risultato };
}

/** Il campo di una variabile a un'ora: matrice [i][j] (NaN dove manca). */
function campo(griglia, variabile, indiceOra, trasforma) {
  const m = [];
  for (let i = 0; i < NLAT; i++) { m.push(new Array(NLON).fill(NaN)); }
  griglia.punti.forEach(p => {
    if (!p || !p.hourly || !p.hourly[variabile]) return;
    const v = Number(p.hourly[variabile][indiceOra]);
    m[p.i][p.j] = trasforma ? trasforma(v, p) : v;
  });
  return m;
}
/** Campionamento bilineare della matrice in (lat, lon). */
function campiona(m, lat, lon) {
  const fi = (lat - G.latMin) / G.passo, fj = (lon - G.lonMin) / G.passo;
  if (fi < 0 || fj < 0 || fi > NLAT - 1 || fj > NLON - 1) return NaN;
  const i0 = Math.min(NLAT - 2, Math.floor(fi)), j0 = Math.min(NLON - 2, Math.floor(fj));
  const ti = fi - i0, tj = fj - j0;
  const a = m[i0][j0], b = m[i0][j0 + 1], c = m[i0 + 1][j0], d = m[i0 + 1][j0 + 1];
  const vicino = () => { const cand = [[a, (1 - ti) * (1 - tj)], [b, (1 - ti) * tj], [c, ti * (1 - tj)], [d, ti * tj]].filter(x => Number.isFinite(x[0])); if (!cand.length) return NaN; cand.sort((x, y) => y[1] - x[1]); return cand[0][0]; };
  if (![a, b, c, d].every(Number.isFinite)) return vicino();
  return (a * (1 - tj) + b * tj) * (1 - ti) + (c * (1 - tj) + d * tj) * ti;
}

/* ─────────────── colori ─────────────── */
const esa = c => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
/** scala: [[valore, "#colore", alfa], …] ordinata; sotto il primo valore → trasparente se "sotto" è true */
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
const TAPPE = {
  temperature: [[-12, '#3f0c7a', .62], [-5, '#283593', .62], [0, '#1e88e5', .62], [5, '#26c6da', .6], [10, '#66bb6a', .58], [15, '#c0ca33', .58], [20, '#ffeb3b', .6], [25, '#ffa726', .62], [30, '#f4511e', .66], [35, '#c62828', .7], [42, '#4a0000', .74]],
  pioggia:     [[0.1, '#a5d8ff', .35], [0.5, '#4dabf7', .55], [2, '#1c7ed6', .65], [5, '#0b5394', .75], [10, '#7b1fa2', .8], [20, '#e53935', .85], [40, '#ffeb3b', .9]],
  vento:       [[20, '#b2ebf2', .35], [40, '#4dd0e1', .5], [60, '#ffb74d', .6], [80, '#ef5350', .7], [100, '#ab47bc', .8], [130, '#4a148c', .85]],
  neve:        [[0.5, '#e3f2fd', .5], [2, '#90caf9', .6], [5, '#42a5f5', .7], [10, '#1e88e5', .78], [20, '#6a1b9a', .85], [50, '#ff4081', .9]],
  nuvole:      [[10, '#ffffff', .0], [50, '#ffffff', .45], [100, '#e2e8f0', .82]],
  mare:        [[0.05, '#e0f7fa', .4], [0.5, '#4dd0e1', .5], [1, '#039be5', .6], [2, '#1e88e5', .7], [3, '#7b1fa2', .8], [4, '#d81b60', .85], [6, '#ffeb3b', .9]]
};
const SCALE = {
  temperature: scala([[-12, '#3f0c7a', .62], [-5, '#283593', .62], [0, '#1e88e5', .62], [5, '#26c6da', .6], [10, '#66bb6a', .58], [15, '#c0ca33', .58], [20, '#ffeb3b', .6], [25, '#ffa726', .62], [30, '#f4511e', .66], [35, '#c62828', .7], [42, '#4a0000', .74]], false),
  pioggia:     scala([[0.1, '#a5d8ff', .35], [0.5, '#4dabf7', .55], [2, '#1c7ed6', .65], [5, '#0b5394', .75], [10, '#7b1fa2', .8], [20, '#e53935', .85], [40, '#ffeb3b', .9]]),
  vento:       scala([[20, '#b2ebf2', .35], [40, '#4dd0e1', .5], [60, '#ffb74d', .6], [80, '#ef5350', .7], [100, '#ab47bc', .8], [130, '#4a148c', .85]]),
  neve:        scala([[0.5, '#e3f2fd', .5], [2, '#90caf9', .6], [5, '#42a5f5', .7], [10, '#1e88e5', .78], [20, '#6a1b9a', .85], [50, '#ff4081', .9]]),
  nuvole:      scala([[10, '#ffffff', .0], [50, '#ffffff', .45], [100, '#e2e8f0', .82]]),
  mare:        scala([[0.05, '#e0f7fa', .4], [0.5, '#4dd0e1', .5], [1, '#039be5', .6], [2, '#1e88e5', .7], [3, '#7b1fa2', .8], [4, '#d81b60', .85], [6, '#ffeb3b', .9]])
};
const LEGENDE = { temperature: '°C', pioggia: 'mm/h', vento: 'km/h', neve: 'cm', nuvole: '%', mare: 'm' };

/* ─────────────── il tempo ─────────────── */
const MESI = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
const GIORNI = ['dom', 'lun', 'mar', 'mer', 'gio', 'ven', 'sab'];
/** "2026-09-07T15:00" (ora locale di Open-Meteo) → "lun 7 set · 15:00" */
function etichetta(t) {
  const d = new Date(t + ':00Z');
  return GIORNI[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MESI[d.getUTCMonth()] + ' · ' + t.slice(11, 16);
}
const dataLocale = (adesso, fuso, spostaGiorni = 0) => new Date(adesso.getTime() + spostaGiorni * 86400000).toLocaleDateString('sv-SE', { timeZone: fuso });
const oraLocale = (adesso, fuso) => Number(adesso.toLocaleTimeString('en-GB', { timeZone: fuso, hour: '2-digit', hour12: false }).slice(0, 2)) % 24;
const giornoSettimana = (aaaammgg) => new Date(aaaammgg + 'T12:00:00Z').getUTCDay();   /* 0 = domenica */

/** Gli indici delle ore da disegnare per ogni filmato, dati gli orari della griglia. */
function finestre(time, adesso, fuso = FUSO) {
  const oggi = dataLocale(adesso, fuso), ora = oraLocale(adesso, fuso);
  const inizio = Math.max(0, time.findIndex(t => t >= oggi + 'T' + String(ora).padStart(2, '0') + ':00'));
  const fino = (n) => time.slice(inizio, inizio + n).map((_, k) => inizio + k);
  const ogni = (lista, passo) => lista.filter((_, k) => k % passo === 0);
  /* il weekend: il prossimo sabato e domenica (se è già weekend, da adesso alla domenica sera) */
  const gs = giornoSettimana(oggi);
  let aSabato = gs === 6 ? 0 : gs === 0 ? -1 : 6 - gs;
  const finestraWeekend = (a) => {
    const sab = dataLocale(adesso, fuso, a), dom = dataLocale(adesso, fuso, a + 1);
    return { sabato: sab, domenica: dom, indici: time.map((t, k) => ({ t, k })).filter(x => x.k >= inizio && x.t >= sab + 'T00:00' && x.t <= dom + 'T23:00').map(x => x.k) };
  };
  let wk = finestraWeekend(aSabato);
  if (wk.indici.length < 12) wk = finestraWeekend(aSabato + 7);     /* weekend quasi finito: si guarda al prossimo */
  const sabato = wk.sabato, domenica = wk.domenica, weekend = wk.indici;
  const domani = dataLocale(adesso, fuso, 1);
  const nuvole = time.map((t, k) => ({ t, k })).filter(x => x.t.startsWith(domani)).map(x => x.k);
  return {
    temperature: ogni(fino(5 * 24), 3),
    pioggia: fino(48),
    vento: weekend.length ? weekend : ogni(fino(48), 1),
    neve: ogni(fino(7 * 24), 3),
    nuvole: nuvole.length ? nuvole : fino(24),
    mare: fino(48),
    inizio, weekend: { sabato, domenica }
  };
}

/* ─────────────── il disegno ─────────────── */
async function sfondo(rete) {
  const tela = createCanvas((TX1 - TX0 + 1) * 256, (TY1 - TY0 + 1) * 256);
  const g = tela.getContext('2d');
  g.fillStyle = '#dde6ee'; g.fillRect(0, 0, tela.width, tela.height);
  let mancanti = 0;
  for (let tx = TX0; tx <= TX1; tx++) for (let ty = TY0; ty <= TY1; ty++) {
    try {
      const img = await loadImage(await rete.immagine('https://basemaps.cartocdn.com/rastertiles/light_all/' + Z + '/' + tx + '/' + ty + '.png?key=' + CHIAVE_CARTO));
      g.drawImage(img, (tx - TX0) * 256, (ty - TY0) * 256);
    } catch (e) { mancanti++; }
  }
  if (mancanti) dice('  · sfondo: ' + mancanti + ' tessere mancanti');
  const fuori = createCanvas(W, H);
  fuori.getContext('2d').drawImage(tela, X0 - TX0 * 256, Y0 - TY0 * 256, X1 - X0, Y1 - Y0, 0, 0, W, H);
  return fuori;
}

/** Il colore del campo pixel per pixel (bilineare sulla griglia), come ImageData. */
function strato(g, matrice, colore, maschera) {
  const img = g.createImageData(W, H), d = img.data;
  const lats = new Float64Array(H), lons = new Float64Array(W);
  for (let y = 0; y < H; y++) lats[y] = daMercY(Y0 + (y + 0.5) / H * (Y1 - Y0));
  for (let x = 0; x < W; x++) lons[x] = daMercX(X0 + (x + 0.5) / W * (X1 - X0));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = campiona(matrice, lats[y], lons[x]);
    if (maschera && !maschera(lats[y], lons[x])) continue;
    const c = colore(v);
    if (c[3] <= 0) continue;
    const o = (y * W + x) * 4;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = Math.round(c[3] * 255);
  }
  return img;
}

function riquadro(g, x, y, w, h, r = 12, fill = 'rgba(255,255,255,.86)') {
  g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  g.fillStyle = fill; g.fill();
}
function legenda(g, nome) {
  /* le tappe della scala sono a distanza uguale fra loro (come nelle legende meteo): così 0,5 e 2 non si pestano */
  const tappe = TAPPE[nome], sc = SCALE[nome];
  const x = 16, y = H - 58, w = W - 32, h = 14, n = tappe.length;
  riquadro(g, x - 6, y - 24, w + 12, 62, 12);
  const grad = g.createLinearGradient(x, 0, x + w, 0);
  for (let k = 0; k < n; k++) {
    for (let q = 0; q < 4; q++) {
      if (k === n - 1 && q > 0) break;
      const v = k === n - 1 ? tappe[k][0] : tappe[k][0] + (tappe[k + 1][0] - tappe[k][0]) * q / 4;
      const c = sc(v);
      grad.addColorStop(Math.min(1, (k + q / 4) / (n - 1)), 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + Math.min(1, c[3] + .25) + ')');
    }
  }
  g.fillStyle = grad; g.fillRect(x, y, w, h);
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.strokeRect(x + .5, y + .5, w - 1, h - 1);
  g.fillStyle = '#172033'; g.font = 'bold 11px "DejaVu Sans"'; g.textAlign = 'center';
  tappe.forEach((t, k) => {
    if (nome === 'pioggia' && k === 0) return;                    /* "0,1" non serve: sotto è trasparente */
    const px = x + k / (n - 1) * w;
    g.fillText(String(t[0]).replace('.', ','), Math.min(x + w - 10, Math.max(x + 10, px)), y + h + 14);
  });
  g.textAlign = 'left'; g.font = '11px "DejaVu Sans"'; g.fillStyle = '#4a5568';
  g.fillText(LEGENDE[nome], x, y - 8);
  g.textAlign = 'right'; g.fillText('Meteo Radar · dati Open-Meteo · mappa © CARTO, © OpenStreetMap', x + w, y - 8);
  g.textAlign = 'left';
}
function freccia(g, x, y, verso, lunghezza) {
  /* verso = da dove SOFFIA il vento (gradi); la freccia punta dove VA */
  const a = (verso + 180) * Math.PI / 180;
  const dx = Math.sin(a) * lunghezza, dy = -Math.cos(a) * lunghezza;
  g.beginPath(); g.moveTo(x - dx / 2, y - dy / 2); g.lineTo(x + dx / 2, y + dy / 2); g.stroke();
  const px = x + dx / 2, py = y + dy / 2, t = Math.atan2(dy, dx);
  g.beginPath(); g.moveTo(px, py); g.lineTo(px - 6 * Math.cos(t - .5), py - 6 * Math.sin(t - .5)); g.lineTo(px - 6 * Math.cos(t + .5), py - 6 * Math.sin(t + .5)); g.closePath(); g.fill();
}
function fulmine(g, x, y) {
  g.beginPath(); g.moveTo(x + 2, y - 9); g.lineTo(x - 4, y + 1); g.lineTo(x, y + 1); g.lineTo(x - 2, y + 9); g.lineTo(x + 5, y - 2); g.lineTo(x + 1, y - 2); g.closePath();
  g.fillStyle = '#ffd600'; g.fill(); g.strokeStyle = 'rgba(0,0,0,.45)'; g.lineWidth = 1; g.stroke();
}
const px = (lat, lon) => [(mercX(lon) - X0) / (X1 - X0) * W, (mercY(lat) - Y0) / (Y1 - Y0) * H];

/** Un fotogramma completo. extra: { frecce: matrice direzioni + matrice forza, fulmini: matrice booleana } */
function fotogramma(base, nome, matrice, titolo, sotto, quando, extra = {}) {
  const tela = createCanvas(W, H), g = tela.getContext('2d');
  g.drawImage(base, 0, 0);
  const st = strato(g, matrice, SCALE[nome], extra.maschera);
  const tmp = createCanvas(W, H); tmp.getContext('2d').putImageData(st, 0, 0);
  g.drawImage(tmp, 0, 0);
  if (extra.frecce) {
    g.strokeStyle = 'rgba(20,30,50,.8)'; g.fillStyle = 'rgba(20,30,50,.8)'; g.lineWidth = 1.5;
    for (let i = 0; i < NLAT; i += 2) for (let j = 0; j < NLON; j += 2) {
      const forza = extra.frecce.forza[i][j], verso = extra.frecce.verso[i][j];
      if (!Number.isFinite(forza) || !Number.isFinite(verso) || forza < 15) continue;
      const [x, y] = px(G.latMin + i * G.passo, G.lonMin + j * G.passo);
      freccia(g, x, y, verso, 10 + Math.min(14, forza / 6));
    }
  }
  if (extra.fulmini) {
    for (let i = 0; i < NLAT; i++) for (let j = 0; j < NLON; j++) {
      if (!extra.fulmini[i][j]) continue;
      const [x, y] = px(G.latMin + i * G.passo, G.lonMin + j * G.passo);
      fulmine(g, x, y);
    }
  }
  /* titolo, sottotitolo, orario */
  riquadro(g, 12, 12, W - 24, 64, 14);
  g.fillStyle = '#172033'; g.font = 'bold 21px "DejaVu Sans"'; g.textAlign = 'left';
  g.fillText(titolo, 24, 40);
  g.font = 'bold 15px "DejaVu Sans"'; g.fillStyle = '#0878f9'; g.textAlign = 'right';
  g.fillText(quando, W - 24, 40);
  g.textAlign = 'left'; g.font = '13px "DejaVu Sans"'; g.fillStyle = '#4a5568';
  let riga = sotto;
  while (riga.length > 4 && g.measureText(riga).width > W - 48) riga = riga.slice(0, -2).trimEnd() + '…';
  g.fillText(riga, 24, 62);
  legenda(g, nome);
  return tela;
}

/* ─────────────── i sei filmati ─────────────── */
function descrizioni(griglia, mare, fin) {
  const time = griglia && griglia.time;
  const t0 = k => time[k];
  const elenco = [];
  if (griglia) {
    elenco.push({ id: 'temperature', titolo: 'Temperature', sotto: 'ogni 3 ore per 5 giorni · modello Open-Meteo', indici: fin.temperature,
      matrice: k => campo(griglia, 'temperature_2m', k) });
    elenco.push({ id: 'pioggia', titolo: 'Pioggia e temporali', sotto: 'ora per ora per 48 ore · ⚡ dove il modello vede temporali', indici: fin.pioggia,
      matrice: k => campo(griglia, 'precipitation', k),
      extra: k => ({ fulmini: campo(griglia, 'weather_code', k, (v, p) => (v >= 95) || (Number(p.hourly.cape[k]) >= 1200 && Number(p.hourly.precipitation[k]) >= 0.5)) }) });
    elenco.push({ id: 'vento', titolo: 'Vento e raffiche', sotto: 'raffiche massime ora per ora · ' + (fin.weekend ? 'sabato ' + fin.weekend.sabato.slice(8) + ' e domenica ' + fin.weekend.domenica.slice(8) : 'prossime 48 ore'), indici: fin.vento,
      matrice: k => campo(griglia, 'wind_gusts_10m', k),
      extra: k => ({ frecce: { forza: campo(griglia, 'wind_gusts_10m', k), verso: campo(griglia, 'wind_direction_10m', k) } }) });
    /* neve: accumulata dall'inizio del filmato */
    const acc = new Map();
    elenco.push({ id: 'neve', titolo: 'Neve accumulata', sotto: 'centimetri caduti dall\'inizio del filmato · 7 giorni', indici: fin.neve,
      matrice: k => {
        const m = campo(griglia, 'snowfall', k, () => 0);
        griglia.punti.forEach(p => {
          if (!p || !p.hourly.snowfall) return;
          let somma = 0; for (let q = fin.inizio; q <= k; q++) somma += Number(p.hourly.snowfall[q]) || 0;
          m[p.i][p.j] = somma;
        });
        return m;
      } });
    elenco.push({ id: 'nuvole', titolo: 'Nuvolosità', sotto: 'copertura del cielo ora per ora · domani', indici: fin.nuvole,
      matrice: k => campo(griglia, 'cloud_cover', k) });
  }
  if (mare) {
    /* solo il mare: i punti con quota zero della griglia meteo sono acqua */
    const acqua = new Set();
    if (griglia) griglia.punti.forEach(p => { if (p && Number.isFinite(p.elevation) && p.elevation <= 0) acqua.add(p.i + ',' + p.j); });
    const maschera = (lat, lon) => {
      if (!griglia) return true;
      const i = Math.round((lat - G.latMin) / G.passo), j = Math.round((lon - G.lonMin) / G.passo);
      return acqua.has(i + ',' + j);
    };
    elenco.push({ id: 'mare', titolo: 'Mare e onde', sotto: 'altezza delle onde ora per ora · 48 ore', indici: fin.mare, tempo: mare.time,
      matrice: k => campo(mare, 'wave_height', k),
      extra: () => ({ maschera }) });
  }
  return elenco;
}

async function filmato(base, voce, time, cartella, ffmpeg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'anim-'));
  const tempo = voce.tempo || time;
  let n = 0;
  for (const k of voce.indici) {
    if (k >= tempo.length) break;
    const extra = voce.extra ? voce.extra(k) : {};
    const tela = fotogramma(base, voce.id, voce.matrice(k), voce.titolo, voce.sotto, etichetta(tempo[k]), extra);
    const png = tela.toBuffer('image/png');
    fs.writeFileSync(path.join(dir, 'f_' + String(n).padStart(3, '0') + '.png'), png);
    if (n === Math.floor(voce.indici.length / 3)) fs.writeFileSync(path.join(cartella, voce.id + '.jpg'), tela.toBuffer('image/jpeg', { quality: 0.82 }));
    n++;
  }
  if (!n) throw new Error('nessun fotogramma');
  /* l'ultimo fotogramma resta fermo un secondo e mezzo */
  const ultimo = fs.readFileSync(path.join(dir, 'f_' + String(n - 1).padStart(3, '0') + '.png'));
  for (let q = 0; q < 9; q++) fs.writeFileSync(path.join(dir, 'f_' + String(n + q).padStart(3, '0') + '.png'), ultimo);
  const uscita = path.join(cartella, voce.id + '.mp4');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '6', '-i', path.join(dir, 'f_%03d.png'),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', uscita], { stdio: 'inherit' });
  fs.rmSync(dir, { recursive: true, force: true });
  return { fotogrammi: n, secondi: Math.round((n + 9) / 6 * 10) / 10, da: tempo[voce.indici[0]], a: tempo[voce.indici[Math.min(voce.indici.length, n) - 1]], byte: fs.statSync(uscita).size };
}

/** @param opzioni { rete, adesso, dir, ffmpeg, solo: [id…] } */
async function giro(opzioni = {}) {
  const rete = opzioni.rete || RETE;
  const adesso = opzioni.adesso ? new Date(opzioni.adesso) : new Date();
  const dir = opzioni.dir || process.env.RAMO_DIR || path.join(QUI, 'ramo');
  const ffmpeg = opzioni.ffmpeg || process.env.FFMPEG || 'ffmpeg';
  const cartella = path.join(dir, 'previsioni');
  fs.mkdirSync(cartella, { recursive: true });
  let precedente = { video: [] };
  try { precedente = JSON.parse(fs.readFileSync(path.join(dir, 'previsioni.json'), 'utf8')); } catch {}

  dice('· sfondo della mappa');
  const base = await sfondo(rete);
  let griglia = null, mare = null;
  try { dice('· griglia meteo (625 punti, 8 giorni)'); griglia = await scaricaGriglia(rete, 'meteo'); }
  catch (e) { dice('  ✘ griglia meteo non disponibile: ' + e.message); }
  try { dice('· griglia del mare (625 punti, 3 giorni)'); mare = await scaricaGriglia(rete, 'mare'); }
  catch (e) { dice('  ✘ griglia del mare non disponibile: ' + e.message); }
  if (!griglia && !mare) throw new Error('nessun dato: si tiene tutto com\'era');

  const time = (griglia || mare).time;
  const fin = finestre(time, adesso);
  if (mare && !griglia) Object.assign(fin, finestre(mare.time, adesso));
  const elenco = descrizioni(griglia, mare, fin).filter(v => !opzioni.solo || opzioni.solo.includes(v.id));
  const fatti = [];
  for (const voce of elenco) {
    try {
      const esito = await filmato(base, voce, time, cartella, ffmpeg);
      fatti.push({ id: voce.id, titolo: voce.titolo, sotto: voce.sotto, file: 'previsioni/' + voce.id + '.mp4', poster: 'previsioni/' + voce.id + '.jpg',
                   fotogrammi: esito.fotogrammi, secondi: esito.secondi, da: esito.da, a: esito.a, byte: esito.byte, generato: adesso.toISOString() });
      dice('  ✔ ' + voce.titolo + ': ' + esito.fotogrammi + ' fotogrammi, ' + Math.round(esito.byte / 1024) + ' KB');
    } catch (e) {
      dice('  ✘ ' + voce.titolo + ': ' + e.message);
      const vecchio = (precedente.video || []).find(v => v.id === voce.id);
      if (vecchio && fs.existsSync(path.join(dir, vecchio.file))) { fatti.push(vecchio); dice('    (resta quello del giro prima)'); }
    }
  }
  /* quello che non si è potuto rifare (per esempio il mare senza dati) resta dal giro prima */
  for (const vecchio of (precedente.video || [])) {
    if (!fatti.some(f => f.id === vecchio.id) && fs.existsSync(path.join(dir, vecchio.file))) fatti.push(vecchio);
  }
  const ordine = ['temperature', 'pioggia', 'vento', 'neve', 'nuvole', 'mare'];
  fatti.sort((a, b) => ordine.indexOf(a.id) - ordine.indexOf(b.id));
  const fuori = { versione: 1, generato: adesso.toISOString(), modello: 'Open-Meteo (modello migliore per l\'Italia, di solito ICON)', griglia: '0,5° · ' + (NLAT * NLON) + ' punti', video: fatti };
  fs.writeFileSync(path.join(dir, 'previsioni.json'), JSON.stringify(fuori, null, 1));
  dice('✔ previsioni.json: ' + fatti.length + ' filmati');
  return fuori;
}

export { giro, finestre, campiona, campo, scala, SCALE, TAPPE, etichetta, puntiGriglia, fotogramma, sfondo, scaricaGriglia, W, H };

const lanciatoDaSolo = (() => {
  try { return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname); } catch { return false; }
})();
if (lanciatoDaSolo) giro().catch(e => { console.error('Errore: ' + e.message); process.exit(1); });
