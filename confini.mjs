/* ============================================================
   confini.mjs — il disegno "alla Windy" delle animazioni

   Tre cose che servono sia ai sei filmati dell'Italia sia al
   filmato del giorno su Atlantico ed Europa:

   1 · la VISTA: dalla finestra geografica (gradi) ai pixel del
       fotogramma, in proiezione di Mercatore come le mappe;
   2 · i CONTORNI: coste, laghi e confini degli stati, presi una
       volta sola da GSHHS/WDB (pubblico dominio) e tenuti in
       confini.json dentro al repository. Si disegnano SOPRA i
       colori, così restano ben visibili anche dove il colore è
       forte — prima si perdevano sotto le macchie;
   3 · le SCIE: i filamenti bianchi che seguono il vento (o la
       direzione delle onde) come su Windy. Sono puntini che
       scorrono sul campo lasciando una coda che sbiadisce: il
       colore resta allo sfondo, la scia è solo bianca e sottile.

   Niente rete: tutto quello che serve è nel file confini.json.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { createCanvas } from 'canvas';

const QUI = path.dirname(new URL(import.meta.url).pathname);

/* ─────────────── i contorni ─────────────── */
let CACHE = null;
/** Legge confini.json una volta sola. Se manca, torna gruppi vuoti: i filmati si fanno lo stesso, solo senza contorni. */
function leggiConfini(file) {
  if (CACHE && !file) return CACHE;
  const dove = file || path.join(QUI, 'confini.json');
  let dati;
  try { dati = JSON.parse(fs.readFileSync(dove, 'utf8')); }
  catch (e) { dati = { italia: { finestra: [0, 0, 0, 0], terra: [], laghi: [], stati: [] }, mondo: { finestra: [0, 0, 0, 0], terra: [], laghi: [], stati: [] } }; }
  if (!file) CACHE = dati;
  return dati;
}

/* ─────────────── la vista (Mercatore) ─────────────── */
const MERC = lat => Math.log(Math.tan(Math.PI / 4 + Math.max(-85, Math.min(85, lat)) * Math.PI / 360));
const DAMERC = y => (Math.atan(Math.exp(y)) - Math.PI / 4) * 360 / Math.PI;

/** creaVista({ lonMin, latMin, lonMax, latMax, W, H }) → oggetto con px(lat,lon), lat(y), lon(x). */
function creaVista(o) {
  const y0 = MERC(o.latMax), y1 = MERC(o.latMin);
  const v = {
    W: o.W, H: o.H, lonMin: o.lonMin, lonMax: o.lonMax, latMin: o.latMin, latMax: o.latMax, y0, y1,
    px(lat, lon) { return [(lon - o.lonMin) / (o.lonMax - o.lonMin) * o.W, (MERC(lat) - y0) / (y1 - y0) * o.H]; },
    lon(x) { return o.lonMin + (x + 0.5) / o.W * (o.lonMax - o.lonMin); },
    lat(y) { return DAMERC(y0 + (y + 0.5) / o.H * (y1 - y0)); },
    /** quanti gradi di longitudine e latitudine vale un pixel, dove siamo */
    gradiPerPixel(lat) {
      const dlon = (o.lonMax - o.lonMin) / o.W;
      const dy = (y1 - y0) / o.H;
      const dlat = Math.abs(DAMERC(MERC(lat) + dy) - lat);
      return [dlon, dlat];
    }
  };
  return v;
}

/* ─────────────── disegnare terra, laghi, contorni ─────────────── */
/** true se il punto sta sul bordo della finestra: i tagli del ritaglio non vanno disegnati come se fossero coste. */
function sulBordo(g, lon, lat, tol) {
  const [a, b, c, d] = g.finestra;
  return Math.abs(lon - a) < tol || Math.abs(lon - c) < tol || Math.abs(lat - b) < tol || Math.abs(lat - d) < tol;
}

/** Il fondo scuro alla Windy: mare scuro, terre un filo più chiare, laghi come il mare. */
function fondoScuro(vista, gruppo, colori = {}) {
  const c = Object.assign({ mare: '#050b16', terra: '#1d2e4d', laghi: '#050b16' }, colori);
  const tela = createCanvas(vista.W, vista.H), g = tela.getContext('2d');
  g.fillStyle = c.mare; g.fillRect(0, 0, vista.W, vista.H);
  const poligono = (v) => {
    g.beginPath();
    for (let i = 0; i < v.length; i += 2) {
      const [x, y] = vista.px(v[i + 1], v[i]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath();
  };
  g.fillStyle = c.terra; (gruppo.terra || []).forEach(v => { poligono(v); g.fill(); });
  g.fillStyle = c.laghi; (gruppo.laghi || []).forEach(v => { poligono(v); g.fill(); });
  return tela;
}

/** Una maschera vera del mare, disegnata dalle coste: torna (lat, lon) → true dove c'è acqua salata.
    Serve al filmato del mare: con la sola griglia a mezzo grado i bordi venivano a quadretti. */
function mascheraAcqua(vista, gruppo) {
  const tela = createCanvas(vista.W, vista.H), g = tela.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, vista.W, vista.H);
  const poligono = (v) => {
    g.beginPath();
    for (let i = 0; i < v.length; i += 2) {
      const [x, y] = vista.px(v[i + 1], v[i]);
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.closePath(); g.fill();
  };
  g.fillStyle = '#fff';
  (gruppo.terra || []).forEach(poligono);
  (gruppo.laghi || []).forEach(poligono);          /* niente onde sui laghi */
  const d = g.getImageData(0, 0, vista.W, vista.H).data;
  const terra = new Uint8Array(vista.W * vista.H);
  for (let i = 0; i < terra.length; i++) terra[i] = d[i * 4] > 127 ? 1 : 0;
  return (lat, lon) => {
    const [x, y] = vista.px(lat, lon);
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= vista.W || yi >= vista.H) return false;
    return terra[yi * vista.W + xi] === 0;
  };
}

/** I contorni luminosi sopra i colori. stile: { costa, spessore, stati, spessoreStati, alone } */
function contorni(g, vista, gruppo, stile = {}) {
  const s = Object.assign({ costa: 'rgba(168,220,255,.95)', spessore: 1.6, stati: 'rgba(150,180,215,.55)', spessoreStati: 1, alone: 'rgba(0,0,0,.35)' }, stile);
  const tol = 1e-6 + Math.abs(vista.lonMax - vista.lonMin) * 1e-4;
  const tratti = (lista, chiudi) => {
    lista.forEach(v => {
      let dentro = false;
      g.beginPath();
      for (let i = 0; i < v.length; i += 2) {
        const bordo = sulBordo(gruppo, v[i], v[i + 1], tol);
        const [x, y] = vista.px(v[i + 1], v[i]);
        if (bordo) { dentro = false; continue; }              /* il taglio del ritaglio non è costa: si stacca la penna */
        if (!dentro) { g.moveTo(x, y); dentro = true; } else g.lineTo(x, y);
      }
      if (chiudi && dentro) { /* niente: il poligono si chiude da solo se non è stato tagliato */ }
      g.stroke();
    });
  };
  g.lineJoin = 'round'; g.lineCap = 'round';
  if (s.alone && s.spessore > 1.2) {
    g.strokeStyle = s.alone; g.lineWidth = s.spessore + 1.6;
    tratti(gruppo.terra || [], true);
  }
  g.strokeStyle = s.stati; g.lineWidth = s.spessoreStati;
  tratti(gruppo.stati || [], false);
  g.strokeStyle = s.costa; g.lineWidth = s.spessore;
  tratti(gruppo.terra || [], true);
  tratti(gruppo.laghi || [], true);
}

/** I nomi delle città, come li mette Windy: punto piccolo e scritta chiara, sopra a tutto.
    livello 0 = città grande (sempre), 1 = città piccola (solo se c'è spazio). */
function citta(g, vista, gruppo, stile = {}) {
  const s = Object.assign({ colore: 'rgba(255,255,255,.92)', alone: 'rgba(0,0,0,.75)', punto: 'rgba(255,255,255,.85)', corpo: 11, minimo: 1 }, stile);
  const lista = (gruppo.citta || []).filter(c => c[3] <= s.minimo);
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  for (const [nome, lat, lon, livello] of lista) {
    const [x, y] = vista.px(lat, lon);
    if (x < 6 || y < 6 || x > vista.W - 6 || y > vista.H - 6) continue;
    const grande = livello === 0;
    g.font = (grande ? 'bold ' : '') + (grande ? s.corpo : s.corpo - 1) + 'px "DejaVu Sans"';
    const r = grande ? 2.6 : 1.9;
    g.fillStyle = s.alone;
    g.beginPath(); g.arc(x, y, r + 1.2, 0, 7); g.fill();
    g.fillStyle = s.punto;
    g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
    g.lineWidth = 3; g.strokeStyle = s.alone; g.lineJoin = 'round';
    g.strokeText(nome, x + r + 3, y + 3.5);
    g.fillStyle = s.colore;
    g.fillText(nome, x + r + 3, y + 3.5);
  }
}

/* ─────────────── le scie alla Windy ─────────────── */
/* Puntini che scorrono sul campo: a ogni fotogramma la coda di prima
   sbiadisce un po' (destination-out) e si disegna il trattino nuovo.
   Il risultato sono filamenti bianchi sottili e lunghi, esattamente
   come le "particles" di Windy: il colore resta allo sfondo. */
class Scie {
  /** @param o { vista, quante, veloce (px per km/h per fotogramma), sbiadisce (0..1), vita [min,max], seme } */
  constructor(o) {
    this.v = o.vista;
    this.quante = o.quante || 2200;
    this.veloce = o.veloce != null ? o.veloce : 0.055;
    this.sbiadisce = o.sbiadisce != null ? o.sbiadisce : 0.12;
    this.vitaMin = (o.vita && o.vita[0]) || 30;
    this.vitaMax = (o.vita && o.vita[1]) || 80;
    this.tela = createCanvas(this.v.W, this.v.H);
    this.g = this.tela.getContext('2d');
    this.g.lineCap = 'round';
    let s = o.seme || 20260915;
    this.caso = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    this.p = [];
    for (let i = 0; i < this.quante; i++) this.p.push(this.nuova());
  }
  nuova() {
    return { x: this.caso() * this.v.W, y: this.caso() * this.v.H, eta: 0, vita: this.vitaMin + this.caso() * (this.vitaMax - this.vitaMin) };
  }
  /** un fotogramma. dove(lat,lon) → [forza km/h, verso in gradi DA CUI soffia] oppure null dove non c'è campo. */
  passo(dove, opzioni = {}) {
    const g = this.g, v = this.v;
    /* la coda di prima sbiadisce */
    g.globalCompositeOperation = 'destination-out';
    g.fillStyle = 'rgba(0,0,0,' + this.sbiadisce + ')';
    g.fillRect(0, 0, v.W, v.H);
    g.globalCompositeOperation = 'source-over';
    const colore = opzioni.colore || 'rgba(255,255,255,.85)';
    const spessore = opzioni.spessore || 1;
    g.strokeStyle = colore; g.lineWidth = spessore;
    g.beginPath();
    for (const q of this.p) {
      const lat = v.lat(q.y), lon = v.lon(q.x);
      const c = dove(lat, lon);
      q.eta++;
      if (!c || !Number.isFinite(c[0]) || !Number.isFinite(c[1]) || q.eta > q.vita || q.x < 0 || q.y < 0 || q.x >= v.W || q.y >= v.H) {
        Object.assign(q, this.nuova());
        continue;
      }
      const forza = c[0], verso = c[1];
      const a = (verso + 180) * Math.PI / 180;               /* dove VA il vento */
      const est = Math.sin(a) * forza, nord = Math.cos(a) * forza;
      const [dlon, dlat] = v.gradiPerPixel(lat);
      /* km/h → gradi: 111,32 km per grado di longitudine all'equatore, ridotti col coseno */
      const cos = Math.max(0.15, Math.cos(lat * Math.PI / 180));
      const pxEst = est / (111.32 * cos) / dlon;
      const pxNord = nord / 110.57 / dlat;
      const k = this.veloce;
      const nx = q.x + pxEst * k, ny = q.y - pxNord * k;
      g.moveTo(q.x, q.y); g.lineTo(nx, ny);
      q.x = nx; q.y = ny;
    }
    g.stroke();
    return this.tela;
  }
}

export { leggiConfini, creaVista, fondoScuro, contorni, mascheraAcqua, citta, Scie, MERC, DAMERC };
