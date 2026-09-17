/* ============================================================
   voci.mjs — la prova delle voci per il filmato del giorno.
   Lo stesso pezzo di racconto, letto da sei voci di OpenAI: quella di
   oggi ("onyx") e cinque fra le più nuove e naturali. Ogni voce finisce
   dentro un filmatino con il suo nome scritto grande, e tutte in fila
   dentro tutte.mp4 (con un cartello fra una e l'altra). Si lancia a mano
   da GitHub ("Run workflow" di voci.yml) e pubblica sul ramo "voci":
     tutte.mp4          le sei voci una dopo l'altra
     voce_N_nome.mp4    una per una
     mp3/nome.mp3       l'audio nudo
     voci.json          l'elenco
   Costo: sei letture da ~25 secondi, meno di cinque centesimi in tutto.
   La chiave OpenAI arriva SOLO dall'ambiente (OPENAI_API_KEY, un segreto
   di GitHub): qui dentro non c'è e non ci sarà mai.
   Prova in casa senza chiave: PROVA_VOCI=1 mette un suono al posto della
   voce, per controllare cartelli, montaggio e coda dei file.
   ============================================================ */
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { createCanvas } from 'canvas';

const VOCI = ['onyx', 'marin', 'cedar', 'ash', 'verse', 'sage'];
const NOTE = {
  onyx: 'quella di oggi',
  marin: 'nuova (2025), fatta per suonare naturale',
  cedar: 'nuova (2025), fatta per suonare naturale',
  ash: 'voce maschile, calda',
  verse: 'voce espressiva',
  sage: 'voce femminile, tranquilla'
};

/* Lo stesso pezzo per tutte: un racconto come lo scrive mondo.mjs, coi numeri per esteso. */
const TESTO = 'Buongiorno e benvenuti al video del giorno di Meteo Radar News. ' +
  'Partiamo dal quadro generale: la bassa pressione più profonda oggi la troviamo a sud dell\'Islanda, ' +
  'e nei prossimi tre giorni si sposta verso la Scandinavia. ' +
  'Veniamo all\'Italia: la pioggia arriva domani sera sul Nord, e dietro al fronte entra aria più fresca: ' +
  'in quota, a millecinquecento metri, perdiamo circa sei gradi entro venerdì. ' +
  'Il vento in quota soffia da ovest, con punte intorno ai settanta chilometri orari. ' +
  'È tutto per oggi: buona giornata da Meteo Radar.';

/* Le stesse istruzioni di mondo.mjs: un presentatore a braccio, non un lettore. */
const ISTRUZIONI = 'Parla in italiano come un presentatore meteo simpatico che si rivolge al pubblico a braccio, ' +
  'non come chi legge un bollettino. Tono caldo, naturale e colloquiale, un sorriso nella voce, ritmo disinvolto ' +
  'con piccole pause fra una frase e l\'altra. Il saluto iniziale è accogliente, la chiusura è cordiale. ' +
  'Niente enfasi da pubblicità. Pronuncia i numeri per esteso.';

const W = 768, H = 432, FPS = 12;
const USCITA = process.env.USCITA_DIR || 'voci_out';
const PROVA = process.env.PROVA_VOCI === '1';
const CHIAVE = process.env.OPENAI_API_KEY || '';

const dice = s => console.log(s);

function trovaFfmpeg() {
  for (const c of ['ffmpeg', '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']) {
    try { execFileSync(c, ['-version'], { stdio: 'ignore' }); return c; } catch (e) { /* prossimo */ }
  }
  throw new Error('ffmpeg non trovato');
}

/* ─────────────── il cartello con il nome della voce ─────────────── */
function cartello(file, n, nome, nota) {
  const cv = createCanvas(W, H), g = cv.getContext('2d');
  const fondo = g.createLinearGradient(0, 0, 0, H);
  fondo.addColorStop(0, '#0b1220'); fondo.addColorStop(1, '#101c33');
  g.fillStyle = fondo; g.fillRect(0, 0, W, H);
  /* la barra rossa da telegiornale, come nella cornice del filmato del giorno */
  g.fillStyle = '#c8102e'; g.fillRect(0, 0, W, 8);
  g.fillStyle = '#ffffff'; g.font = 'bold 22px DejaVu Sans, sans-serif'; g.textAlign = 'left';
  g.fillText('METEO RADAR NEWS · PROVA DELLE VOCI', 36, 52);
  g.fillStyle = '#9fb3d9'; g.font = '20px DejaVu Sans, sans-serif';
  g.fillText('Lo stesso racconto, sei voci. Dimmi il numero di quella più vera.', 36, 84);
  g.textAlign = 'center';
  g.fillStyle = '#ffd166'; g.font = 'bold 44px DejaVu Sans, sans-serif';
  g.fillText('Voce ' + n + ' di ' + VOCI.length, W / 2, 190);
  g.fillStyle = '#ffffff'; g.font = 'bold 84px DejaVu Sans, sans-serif';
  g.fillText(nome, W / 2, 285);
  g.fillStyle = '#9fb3d9'; g.font = '24px DejaVu Sans, sans-serif';
  g.fillText(nota || '', W / 2, 335);
  g.fillStyle = '#5c6f95'; g.font = '18px DejaVu Sans, sans-serif';
  g.fillText('gpt-4o-mini-tts · voce "' + nome + '"', W / 2, H - 28);
  fs.writeFileSync(file, cv.toBuffer('image/png'));
}

/* ─────────────── la voce ─────────────── */
async function parla(testo, destinazione, voce) {
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + CHIAVE },
    body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: voce, input: testo, response_format: 'mp3', instructions: ISTRUZIONI }),
    signal: AbortSignal.timeout(120000)
  });
  if (!r.ok) throw new Error('OpenAI ' + r.status + ': ' + (await r.text()).slice(0, 200));
  fs.writeFileSync(destinazione, Buffer.from(await r.arrayBuffer()));
  if (fs.statSync(destinazione).size < 2000) throw new Error('audio troppo corto');
}

/* In prova, al posto della voce: tre secondi di un suono diverso per ogni voce. */
function suonoDiProva(destinazione, n, ffmpeg) {
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=' + (220 * n) + ':duration=3',
    '-c:a', 'libmp3lame', '-b:a', '96k', destinazione], { stdio: 'inherit' });
}

function durata(file, ffmpeg) {
  try {
    const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
    const s = execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file]).toString().trim();
    const v = Number(s); return Number.isFinite(v) ? v : 0;
  } catch (e) { return 0; }
}

/* ─────────────── il montaggio ─────────────── */
function filmatino(cartelloPng, mp3, mp4, ffmpeg) {
  /* immagine fissa + audio: un secondo di silenzio prima (si legge il nome), mezzo dopo */
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y',
    '-loop', '1', '-framerate', String(FPS), '-i', cartelloPng,
    '-i', mp3,
    '-af', 'adelay=1000|1000,apad=pad_dur=0.6',
    '-c:v', 'libx264', '-preset', 'medium', '-tune', 'stillimage', '-crf', '28', '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '112k', '-ar', '44100', '-ac', '2',
    '-shortest', '-movflags', '+faststart', mp4], { stdio: 'inherit' });
}

function inFila(pezzi, uscita, ffmpeg) {
  const lista = path.join(path.dirname(uscita), 'lista.txt');
  fs.writeFileSync(lista, pezzi.map(p => "file '" + path.resolve(p).replace(/'/g, "'\\''") + "'").join('\n') + '\n');
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lista,
    '-c', 'copy', '-movflags', '+faststart', uscita], { stdio: 'inherit' });
  fs.unlinkSync(lista);
}

/* ─────────────── il lavoro ─────────────── */
async function main() {
  if (!PROVA && !CHIAVE) throw new Error('manca OPENAI_API_KEY (il segreto di GitHub): senza chiave non si può dare voce a niente');
  const ffmpeg = trovaFfmpeg();
  fs.rmSync(USCITA, { recursive: true, force: true });
  fs.mkdirSync(path.join(USCITA, 'mp3'), { recursive: true });
  const tmp = fs.mkdtempSync(path.join(USCITA, 'tmp_'));
  const elenco = [], pezzi = [];
  let n = 0;
  for (const voce of VOCI) {
    n++;
    const mp3 = path.join(USCITA, 'mp3', voce + '.mp3');
    const png = path.join(tmp, voce + '.png');
    const mp4 = path.join(USCITA, 'voce_' + n + '_' + voce + '.mp4');
    dice('· voce ' + n + '/' + VOCI.length + ': ' + voce);
    try {
      if (PROVA) suonoDiProva(mp3, n, ffmpeg); else await parla(TESTO, mp3, voce);
    } catch (e) {
      dice('  ✘ ' + voce + ': ' + e.message + ' (si salta)');
      continue;
    }
    cartello(png, n, voce, NOTE[voce]);
    filmatino(png, mp3, mp4, ffmpeg);
    const s = durata(mp4, ffmpeg);
    dice('  ✔ ' + s.toFixed(1) + ' s, ' + Math.round(fs.statSync(mp4).size / 1024) + ' KB');
    pezzi.push(mp4);
    elenco.push({ numero: n, voce, nota: NOTE[voce] || '', file: path.basename(mp4), mp3: 'mp3/' + voce + '.mp3', secondi: Math.round(s * 10) / 10 });
  }
  if (!pezzi.length) throw new Error('nessuna voce è riuscita');
  inFila(pezzi, path.join(USCITA, 'tutte.mp4'), ffmpeg);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.writeFileSync(path.join(USCITA, 'voci.json'), JSON.stringify({
    generato: new Date().toISOString(), modello: 'gpt-4o-mini-tts', testo: TESTO, istruzioni: ISTRUZIONI, prova: PROVA, voci: elenco
  }, null, 1));
  fs.writeFileSync(path.join(USCITA, 'LEGGIMI.txt'),
    'Prova delle voci di Meteo Radar News.\n' +
    'tutte.mp4: le ' + elenco.length + ' voci una dopo l\'altra, ognuna col suo cartello.\n' +
    elenco.map(v => '  ' + v.numero + ' · ' + v.voce + (v.nota ? ' — ' + v.nota : '')).join('\n') + '\n');
  dice('✔ tutte.mp4: ' + durata(path.join(USCITA, 'tutte.mp4'), ffmpeg).toFixed(1) + ' s, ' + elenco.length + ' voci');
}

main().catch(e => { console.error('✘ ' + e.message); process.exit(1); });
