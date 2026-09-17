/* ============================================================
   steve_foto.mjs — Steve in carne e ossa (sintetica): la foto che parla.
   Cinque foto della stessa persona (bocca chiusa, socchiusa, aperta, "o",
   occhi chiusi), fatte da ChatGPT a partire dalla stessa immagine. Da
   quella a bocca chiusa (la base) si parte; dalle altre si ritaglia SOLO
   la bocca (o gli occhi) con i bordi sfumati e la si incolla sopra la
   base, dopo aver riallineato di qualche pixel. Fotogramma per fotogramma
   si sceglie la bocca in base al volume della voce, si sbattono le
   palpebre ogni tanto, e un respiro lento (zoom di un centesimo) toglie
   l'effetto "foto ferma". Niente servizi, niente chiavi: canvas e ffmpeg.

   Uso dentro al montaggio:
     const steve = await preparaSteve(cartellaFoto)      // una volta
     const stati = statiDallaVoce(mp3, fps, ffmpeg)      // per ogni fotogramma: {bocca, palpebre}
     steve.disegna(ctx, x, y, larghezza, stato, t)      // nel fotogramma

   Le foto stanno nel repository del blog (cartella "steve/"): sono di
   una persona inventata, possono stare in pubblico.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createCanvas, loadImage } from 'canvas';

/* Le cinque foto, gli spostamenti rispetto alla base (misurati sugli occhi/occhiali) e le zone da ritagliare.
   Le coordinate sono in pixel delle foto originali (1122×1402). */
const FOTO = {
  chiusa:    { file: 'chiusa.jpg' },
  socchiusa: { file: 'socchiusa.jpg', dx: 0,  dy: -1, zona: 'bocca' },
  aperta:    { file: 'aperta.jpg',    dx: 0,  dy: -2, zona: 'bocca' },
  o:         { file: 'o.jpg',         dx: -3, dy: -6, zona: 'bocca' },
  occhi:     { file: 'occhi.jpg',     dx: 0,  dy: 0,  zona: 'occhi' }
};
const ZONE = {
  bocca: { cx: 560, cy: 722, rx: 135, ry: 118, sfuma: 34 },
  occhi: { cx: 559, cy: 472, rx: 215, ry: 82,  sfuma: 30 }
};
/* il ritaglio della foto che si usa nel filmato: viso e spalle, formato 4:5 */
const RITAGLIO = { x: 100, y: 40, w: 920, h: 1150 };
const BOCCHE = ['chiusa', 'socchiusa', 'aperta', 'o'];

/** maschera ellittica sfumata (canvas con alpha), grande come la foto */
function maschera(w, h, z) {
  const cv = createCanvas(w, h), g = cv.getContext('2d');
  const grad = g.createRadialGradient(z.cx, z.cy, 0, z.cx, z.cy, 1);
  /* si disegna un cerchio unitario e lo si scala a ellisse: il gradiente resta radiale */
  g.save(); g.translate(z.cx, z.cy); g.scale(z.rx, z.ry); g.translate(-z.cx, -z.cy);
  const dentro = 1 - z.sfuma / Math.max(z.rx, z.ry);
  grad.addColorStop(0, 'rgba(0,0,0,1)'); grad.addColorStop(Math.max(0.05, dentro), 'rgba(0,0,0,1)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad; g.beginPath(); g.arc(z.cx, z.cy, 1, 0, Math.PI * 2); g.fill();
  g.restore();
  return cv;
}

/** base + una toppa (bocca o occhi) presa da un'altra foto, riallineata e sfumata */
function toppa(base, foto, spec, W, H) {
  const cv = createCanvas(W, H), g = cv.getContext('2d');
  g.drawImage(base, 0, 0);
  const strato = createCanvas(W, H), s = strato.getContext('2d');
  s.drawImage(foto, -spec.dx, -spec.dy);                 /* riporta la foto sulla base */
  s.globalCompositeOperation = 'destination-in';
  s.drawImage(maschera(W, H, ZONE[spec.zona]), 0, 0);    /* resta solo la zona, coi bordi sfumati */
  g.drawImage(strato, 0, 0);
  return cv;
}

/* ─────────────── la bocca che si muove davvero: una deformazione, non uno scambio di foto ───────────────
   Scambiare quattro foto, anche in dissolvenza, resta "a scatti": le labbra saltano da una forma
   all'altra. Qui invece la mascella scende in modo continuo: tutto quello che sta sotto la linea
   delle labbra (labbro inferiore, mento) viene spostato in giù di una quantità che segue il volume,
   di più al centro e meno agli angoli; nello spazio che si apre si dipinge l'interno della bocca
   (denti e buio) preso dalla foto a bocca aperta. Per la "o" le labbra si stringono verso il centro.
   Coordinate nella foto originale (1122×1402): la linea delle labbra a y=662, la mascella scende al
   massimo di 27 px, il collo (dove il movimento si spegne) da y=830 a y=880. */
const BOCCA = { cx: 560, linea: 662, salto: 32, sigma: 95, mentoFine: 830, colloFine: 880, x0: 380, x1: 740, y0: 600, y1: 890, labbraY0: 630, labbraY1: 730, labbroSopra: 22, mezzaBocca: 74, sfumaBocca: 18 };

export async function preparaSteve(cartella, larghezzaLavoro = 460) {
  const img = {};
  for (const [k, v] of Object.entries(FOTO)) img[k] = await loadImage(path.join(cartella, v.file));
  const W = img.chiusa.width, H = img.chiusa.height;
  const scala = larghezzaLavoro / RITAGLIO.w;
  const w = Math.round(RITAGLIO.w * scala), h = Math.round(RITAGLIO.h * scala);
  const ridotto = (pieno) => {
    const cv = createCanvas(w, h), g = cv.getContext('2d');
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
    g.drawImage(pieno, RITAGLIO.x, RITAGLIO.y, RITAGLIO.w, RITAGLIO.h, 0, 0, w, h);
    return cv;
  };
  const allineata = (foto, spec) => { const cv = createCanvas(W, H); cv.getContext('2d').drawImage(foto, -spec.dx, -spec.dy); return cv; };
  const strato = (foto, spec) => {
    const cv = createCanvas(W, H), s = cv.getContext('2d');
    s.drawImage(foto, -spec.dx, -spec.dy);
    s.globalCompositeOperation = 'destination-in';
    s.drawImage(maschera(W, H, ZONE[spec.zona]), 0, 0);
    return ridotto(cv);
  };
  const base = ridotto(img.chiusa);
  const aperta = ridotto(allineata(img.aperta, FOTO.aperta));
  const occhi = strato(img.occhi, FOTO.occhi);
  /* la zona della bocca in coordinate ridotte */
  const k = scala, ox = RITAGLIO.x, oy = RITAGLIO.y;
  const Z = { x0: Math.round((BOCCA.x0 - ox) * k), x1: Math.round((BOCCA.x1 - ox) * k), y0: Math.round((BOCCA.y0 - oy) * k), y1: Math.round((BOCCA.y1 - oy) * k),
              cx: (BOCCA.cx - ox) * k, linea: (BOCCA.linea - oy) * k, salto: BOCCA.salto * k, sigma: BOCCA.sigma * k,
              mentoFine: (BOCCA.mentoFine - oy) * k, colloFine: (BOCCA.colloFine - oy) * k, labbraY0: (BOCCA.labbraY0 - oy) * k, labbraY1: (BOCCA.labbraY1 - oy) * k,
              labbroSopra: BOCCA.labbroSopra * k, mezzaBocca: BOCCA.mezzaBocca * k, sfumaBocca: BOCCA.sfumaBocca * k };
  const pw = Z.x1 - Z.x0, ph = Z.y1 - Z.y0;
  const pxBase = base.getContext('2d').getImageData(0, 0, w, h).data;
  const pxAperta = aperta.getContext('2d').getImageData(0, 0, w, h).data;
  const patch = createCanvas(pw, ph), pg = patch.getContext('2d');
  const out = pg.createImageData(pw, ph);
  const lisci = x => Math.max(0, Math.min(1, x));
  /* campionamento bilineare da un'immagine ridotta */
  const campiona = (px, x, y, o, i) => {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
    const a = (y0 * w + x0) * 4, b = (y0 * w + x1) * 4, c = (y1 * w + x0) * 4, d = (y1 * w + x1) * 4;
    for (let ch = 0; ch < 3; ch++) {
      const top = px[a + ch] * (1 - fx) + px[b + ch] * fx, bot = px[c + ch] * (1 - fx) + px[d + ch] * fx;
      o[i + ch] = top * (1 - fy) + bot * fy;
    }
    o[i + 3] = 255;
  };
  /** disegna la bocca deformata: apertura 0..1, o 0..1 */
  const bocca = (ap, vo) => {
    const D = ap * Z.salto;
    for (let yy = 0; yy < ph; yy++) {
      const y = Z.y0 + yy;
      /* dove il movimento si spegne verso il collo */
      const wy = y < Z.linea ? 0 : y > Z.colloFine ? 0 : y > Z.mentoFine ? (Z.colloFine - y) / (Z.colloFine - Z.mentoFine) : 1;
      /* la stretta della "o": solo attorno alle labbra */
      const wl = y < Z.labbraY0 || y > Z.labbraY1 + D ? 0 : Math.sin(Math.PI * lisci((y - Z.labbraY0) / (Z.labbraY1 + D - Z.labbraY0)));
      for (let xx = 0; xx < pw; xx++) {
        const x = Z.x0 + xx, i = (yy * pw + xx) * 4;
        const wx = Math.exp(-(((x - Z.cx) / Z.sigma) ** 2));
        const d = D * wx;                                   /* di quanto scende la mascella in questa colonna */
        const stringi = 1 + 0.26 * vo * wl * wx;             /* la "o": si campiona più largo, le labbra si stringono */
        const sx = Z.cx + (x - Z.cx) * stringi;
        /* l'apertura esiste solo fra gli angoli della bocca: oltre, la pelle resta pelle */
        const wm = lisci((Z.mezzaBocca + Z.sfumaBocca - Math.abs(x - Z.cx)) / Z.sfumaBocca);
        const dentro = wm > 0 && y >= Z.linea && y < Z.linea + d && d >= 0.9;
        if (dentro) {
          /* lo spazio che si apre: l'interno della bocca dalla foto aperta, compresso sull'apertura di adesso */
          const t = (y - Z.linea) / Math.max(1e-6, d);
          const ya = Z.linea + t * Z.salto * wx * 0.95;
          campiona(pxAperta, sx, ya, out.data, i);
          const buio = 0.78 + 0.22 * (1 - ap);              /* un filo più scuro dentro */
          out.data[i] *= buio; out.data[i + 1] *= buio; out.data[i + 2] *= buio;
          /* bordi morbidi: la riga più bassa dell'apertura e le aperture piccole si fondono con la pelle */
          const copertura = Math.min(1, Z.linea + d - y) * Math.min(1, (d - 0.9) / 1.5) * wm;
          if (copertura < 0.999) {
            const tmp = [0, 0, 0, 255];
            campiona(pxBase, sx, Math.max(0, Math.min(h - 1, y - d * wy)), tmp, 0);
            for (let ch = 0; ch < 3; ch++) out.data[i + ch] = out.data[i + ch] * copertura + tmp[ch] * (1 - copertura);
          }
        } else {
          let sy = y - d * wy;
          /* il labbro di sopra si alza un poco (un quarto di quanto scende la mascella) */
          if (y < Z.linea && y > Z.linea - Z.labbroSopra) sy = y + 0.25 * d * (1 - (Z.linea - y) / Z.labbroSopra);
          campiona(pxBase, sx, Math.max(0, Math.min(h - 1, sy)), out.data, i);
        }
      }
    }
    pg.putImageData(out, 0, 0);
    return patch;
  };
  return {
    w, h, base,
    /** stato: { apertura: 0..1, o: 0..1, palpebre: 0..1 } */
    disegna(g, x, y, larghezza, stato, t) {
      const altezza = larghezza * h / w;
      const respiro = 1 + 0.008 * Math.sin((t || 0) * 2 * Math.PI / 4.2);
      const ondeggia = 1.2 * Math.sin((t || 0) * 2 * Math.PI / 6.5);
      const ap = lisci(stato.apertura || 0), vo = lisci(stato.o || 0), pa = lisci(stato.palpebre || 0);
      const cenno = 1.6 * ap;                                    /* parlando la testa si abbassa di un pelo */
      g.save();
      g.translate(x + larghezza / 2 + ondeggia, y + altezza + cenno);
      g.scale(respiro, respiro);
      const dx = -larghezza / 2, dy = -altezza, r = larghezza / w;
      g.drawImage(base, dx, dy, larghezza, altezza);
      const b = bocca(ap, vo);
      g.drawImage(b, dx + Z.x0 * r, dy + Z.y0 * r, pw * r, ph * r);
      if (pa > 0.01) { g.globalAlpha = pa; g.drawImage(occhi, dx, dy, larghezza, altezza); g.globalAlpha = 1; }
      g.restore();
    }
  };
}

/** Il volume della voce per fotogramma, in due bande: tutto e solo gli acuti (1400–4000 Hz).
 *  Le vocali "o" e "u" hanno pochissima energia lassù (la seconda formante sta sotto i 1000 Hz),
 *  "a", "e" e "i" molta di più: la quota di acuti dice quando fare la "o". */
export function inviluppo(mp3, fps, ffmpeg = 'ffmpeg') {
  const sr = 16000;
  const leggi = (filtro) => {
    const arg = ['-hide_banner', '-loglevel', 'error', '-i', mp3, '-ac', '1', '-ar', String(sr)];
    if (filtro) arg.push('-af', filtro);
    arg.push('-f', 's16le', '-');
    const pcm = execFileSync(ffmpeg, arg, { maxBuffer: 1 << 28 });
    return new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 2));
  };
  const tutto = leggi(null), acuti = leggi('highpass=f=1400,lowpass=f=4000');
  const perFrame = sr / fps;
  const n = Math.ceil(tutto.length / perFrame);
  const rms = (c, i) => {
    const a = Math.floor(i * perFrame), b = Math.min(c.length, Math.floor((i + 1) * perFrame));
    let s = 0; for (let j = a; j < b; j++) { const v = c[j] / 32768; s += v * v; }
    return b > a ? Math.sqrt(s / (b - a)) : 0;
  };
  const vol = new Float32Array(n), alto = new Float32Array(n);
  for (let i = 0; i < n; i++) { vol[i] = rms(tutto, i); alto[i] = rms(acuti, i); }
  const ord = Array.from(vol).sort((p, q) => p - q);
  const tetto = ord[Math.floor(ord.length * 0.95)] || 1;
  return Array.from(vol, (v, i) => ({ vol: Math.min(1, v / tetto), acuti: v > 1e-4 ? Math.min(1, alto[i] / v) : 1 }));
}

/** Da volume a stati continui: apertura con attacco svelto e rilascio più lento (niente scatti),
 *  la "o" quando il suono è quasi tutto grave, e le palpebre con un battito morbido (chiude in 2
 *  fotogrammi, resta 2, riapre in 3) ogni 2–5 secondi. */
export function statiDallaVoce(mp3, fps, ffmpeg = 'ffmpeg', seme = 7) {
  const env = inviluppo(mp3, fps, ffmpeg);
  const stati = [];
  let apertura = 0, o = 0;
  let rnd = seme;
  const caso = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  const BATTITO = [0.45, 0.9, 1, 1, 0.7, 0.4, 0.15];
  let prossimo = Math.round(fps * (1.5 + caso() * 3)), dentro = -1;
  for (let i = 0; i < env.length; i++) {
    const v = env[i].vol;
    const voluta = v < 0.06 ? 0 : Math.pow(v, 0.8);
    apertura += (voluta - apertura) * (voluta > apertura ? 0.62 : 0.30);       /* attacco svelto, rilascio lento */
    const oVoluta = (v > 0.15 && env[i].acuti < 0.075) ? 1 : 0;        /* i suoni più "scuri": circa un quinto del parlato */
    o += (oVoluta - o) * (oVoluta > o ? 0.5 : 0.35);
    let palpebre = 0;
    if (dentro >= 0) { palpebre = BATTITO[dentro]; dentro++; if (dentro >= BATTITO.length) { dentro = -1; prossimo = i + Math.round(fps * (1.8 + caso() * 3.2)); } }
    else if (i >= prossimo) { dentro = 0; palpebre = BATTITO[0]; dentro = 1; }
    stati.push({ apertura: Math.round(apertura * 1000) / 1000, o: Math.round(o * 1000) / 1000, palpebre, vol: v, acuti: env[i].acuti });
  }
  return stati;
}
