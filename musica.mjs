/* musica.mjs — v76 · LA MUSICA DEI VIDEO DELLA FOTOCAMERA
   Dodici brani liberi (CC0: dominio pubblico, niente diritti né obblighi),
   presi da OpenGameArt, tagliati a 60 secondi con dissolvenza in entrata e
   in uscita, portati allo stesso volume e salvati in MP3 leggero (96 kbps,
   ~700 KB l'uno) nella cartella musica/ del ramo main, con l'elenco in
   musica/musica.json (titolo, autore, umore, licenza, pagina d'origine).
   L'app legge l'elenco, scarica solo il brano scelto e lo mette sotto la
   voce nel video da condividere.
   Lo fa GitHub (musica.yml, "Run workflow"): il telefono non scarica mai i
   file grossi d'origine (uno pesa 63 MB), solo i 60 secondi tagliati.
   Niente chiavi, niente segreti: sono file pubblici.
   Uso: node musica.mjs            (rifà solo i brani che mancano)
        RIFAI=1 node musica.mjs    (riscarica e ritaglia tutto)
   ============================================================ */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';

export const SECONDI = 60;                 /* quanto dura ogni brano tagliato */
export const ENTRA = 1.5, ESCE = 3;        /* le dissolvenze, in secondi */
export const BITRATE = '96k';

/** i brani: verificati uno per uno sulla pagina d'origine (licenza CC0 dichiarata dall'autore) */
export const BRANI = [
  { id: 'alba', titolo: 'First Light Particles', autore: 'Yoiyami', umore: 'Rilassata', nota: 'piano e tappeti, calmo', da: 0,
    url: 'https://opengameart.org/sites/default/files/first_light_particles_0.wav',
    fonte: 'https://opengameart.org/content/first-light-particles-%E2%80%93-cc0-atmospheric-pianoambient-track', licenza: 'CC0 1.0' },
  { id: 'tramonto', titolo: 'Sunset Plains', autore: 'Yoiyami', umore: 'Calma', nota: 'chitarra e tappeti, new age', da: 0,
    url: 'https://opengameart.org/sites/default/files/sunset_plains.wav',
    fonte: 'https://opengameart.org/content/sunset-plains', licenza: 'CC0 1.0' },
  { id: 'autunno', titolo: 'Aimless Autumn', autore: 'Icerider007', umore: 'Allegra', nota: 'leggera, a ciclo', da: 0,
    url: 'https://opengameart.org/sites/default/files/bgmloopabledearyekate_1.mp3',
    fonte: 'https://opengameart.org/content/aimless-autumn', licenza: 'CC0 1.0 (l\'autore la offre anche come OGA-BY 4.0)' },
  { id: 'neve', titolo: 'November Snow', autore: 'cynicmusic', umore: 'Inverno', nota: 'lenta, di neve', da: 0,
    url: 'https://opengameart.org/sites/default/files/155%20November_snow-33_tape_leveled.mp3',
    fonte: 'https://opengameart.org/content/november-snow', licenza: 'CC0 1.0' },
  { id: 'epica', titolo: 'A Legend Will Rise', autore: 'CodeManu', umore: 'Epica', nota: 'orchestra, da temporale', da: 0,
    url: 'https://opengameart.org/sites/default/files/A%20Legend%20Will%20Rise.mp3',
    fonte: 'https://opengameart.org/content/a-legend-will-rise-orchestral', licenza: 'CC0 1.0' },
  { id: 'sera', titolo: 'Crickets', autore: 'SpringySpringo', umore: 'Sera', nota: 'piano calmo', da: 0,
    url: 'https://opengameart.org/sites/default/files/crickets_3.mp3',
    fonte: 'https://opengameart.org/content/crickets-general-calm-ambient-music', licenza: 'CC0 1.0 (l\'autore la offre anche come CC-BY 3.0)' },
  /* v77 · sei brani in più, sempre CC0, con umori che mancavano: la tempesta, la tensione, il sereno, il sospeso, l'energia, il mare */
  { id: 'tempesta', titolo: 'Eye of the Storm', autore: 'Joth', umore: 'Tempesta', nota: 'cupa, incalzante', da: 0,
    url: 'https://opengameart.org/sites/default/files/Eye%20of%20the%20Storm.mp3',
    fonte: 'https://opengameart.org/content/eye-of-the-storm', licenza: 'CC0 1.0' },
  { id: 'tensione', titolo: 'Determined Pursuit', autore: 'Emma_MA', umore: 'Tensione', nota: 'orchestra che corre', da: 0,
    url: 'https://opengameart.org/sites/default/files/determined_pursuit_loop.wav',
    fonte: 'https://opengameart.org/content/determined-pursuit-epic-orchestra-loop', licenza: 'CC0 1.0' },
  { id: 'sole', titolo: 'New Sunrise', autore: 'nene', umore: 'Sereno', nota: 'luminosa, apre', da: 0,
    url: 'https://opengameart.org/sites/default/files/new_sunrise_V2_0.wav',
    fonte: 'https://opengameart.org/content/new-sunrise', licenza: 'CC0 1.0' },
  { id: 'spazio', titolo: 'Magic Space', autore: 'CodeManu', umore: 'Sospesa', nota: 'ampia, da cielo grande', da: 0,
    url: 'https://opengameart.org/sites/default/files/magic%20space.mp3',
    fonte: 'https://opengameart.org/content/magic-space', licenza: 'CC0 1.0' },
  { id: 'energia', titolo: 'We Are Prophet', autore: 'TinyWorlds', umore: 'Energica', nota: 'ritmata, allegra', da: 0,
    url: 'https://opengameart.org/sites/default/files/bu-offensive-birds.mp3',
    fonte: 'https://opengameart.org/content/we-are-prophet-happy-energetic-tune', licenza: 'CC0 1.0' },
  { id: 'mare', titolo: 'Pacific Ocean', autore: 'josepharaoh99', umore: 'Mare', nota: 'onde e archi', da: 0,
    url: 'https://opengameart.org/sites/default/files/Pacific%20Ocean_0.mp3',
    fonte: 'https://opengameart.org/content/pacific-ocean', licenza: 'CC0 1.0' }
];

const dice = (...a) => console.log(...a);

/** scarica un file (segue i rimandi); rifiuta le risposte troppo piccole (una pagina d'errore, non un brano) */
export async function scarica(url, dest, fetchFn = fetch) {
  const r = await fetchFn(url, { redirect: 'follow', headers: { 'User-Agent': 'MeteoNewsRadar/76 (musica CC0 per i video; github.com/Robertobob5/meteo-radar-blog)' } });
  if (!r.ok) throw new Error('risposta ' + r.status + ' da ' + url);
  const dati = Buffer.from(await r.arrayBuffer());
  if (dati.length < 20000) throw new Error('file troppo piccolo (' + dati.length + ' byte): non è un brano');
  fs.writeFileSync(dest, dati);
  return dati.length;
}

/** quanti secondi dura un file audio (ffprobe se c'è, altrimenti ffmpeg) */
export function durata(file, ffmpeg = 'ffmpeg') {
  try {
    const probe = ffmpeg.replace(/ffmpeg(\.exe)?$/, 'ffprobe$1');
    const out = execFileSync(probe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', file], { encoding: 'utf8' });
    const s = Number(String(out).trim());
    if (Number.isFinite(s) && s > 0) return s;
  } catch (_) {}
  try {
    const out = execFileSync(ffmpeg, ['-hide_banner', '-i', file, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g; let ultimo = null, x; while ((x = m.exec(out))) ultimo = x;
    if (ultimo) return Number(ultimo[1]) * 3600 + Number(ultimo[2]) * 60 + Number(ultimo[3]);
  } catch (e) {
    const out = String(e.stderr || e.stdout || '');
    const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/g; let ultimo = null, x; while ((x = m.exec(out))) ultimo = x;
    if (ultimo) return Number(ultimo[1]) * 3600 + Number(ultimo[2]) * 60 + Number(ultimo[3]);
  }
  return NaN;
}

/** da un file qualunque a 60 secondi di MP3: si ripete a ciclo se è più corto, dissolvenza dentro e fuori, volume pareggiato.
    Due passi (prima il taglio in WAV, poi le dissolvenze sul taglio) così le dissolvenze cadono sempre a 0 e a 57 secondi
    del pezzo tagliato, qualunque sia il punto d'inizio. */
export function taglia(ffmpeg, sorgente, uscita, b, o = {}) {
  const secondi = o.secondi || SECONDI, entra = o.entra ?? ENTRA, esce = o.esce ?? ESCE;
  const tmp = path.join(o.tmp || os.tmpdir(), 'mr_musica_' + b.id + '_' + process.pid + '.wav');
  const da = Number(b.da) > 0 ? Number(b.da) : 0;
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-stream_loop', '-1', '-i', sorgente, '-ss', String(da), '-t', String(secondi),
    '-vn', '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le', tmp], { stdio: 'inherit' });
  const filtro = 'afade=t=in:st=0:d=' + entra + ',afade=t=out:st=' + (secondi - esce) + ':d=' + esce +
                 ',loudnorm=I=-18:TP=-1.5:LRA=11,alimiter=limit=0.95';
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-i', tmp, '-t', String(secondi), '-af', filtro,
    '-ac', '2', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', o.bitrate || BITRATE, '-id3v2_version', '3',
    '-metadata', 'title=' + b.titolo, '-metadata', 'artist=' + b.autore, '-metadata', 'comment=' + (b.licenza || 'CC0') + ' · ' + (b.fonte || ''),
    uscita], { stdio: 'inherit' });
  try { fs.unlinkSync(tmp); } catch (_) {}
  return fs.statSync(uscita).size;
}

/** l'elenco che legge l'app */
export function indice(brani, cartella, adesso = new Date()) {
  const voci = brani.filter(b => fs.existsSync(path.join(cartella, b.id + '.mp3'))).map(b => ({
    id: b.id, titolo: b.titolo, autore: b.autore, umore: b.umore, nota: b.nota || '',
    file: path.basename(cartella) + '/' + b.id + '.mp3', byte: fs.statSync(path.join(cartella, b.id + '.mp3')).size,
    secondi: SECONDI, licenza: b.licenza || 'CC0 1.0', fonte: b.fonte || ''
  }));
  return { versione: 1, generato: adesso.toISOString(), secondi: SECONDI, licenza: 'CC0 1.0 · dominio pubblico (opengameart.org)', brani: voci };
}

export function crediti(ind) {
  const righe = ['# La musica dei video della fotocamera', '',
    'Brani liberi (**CC0 1.0**, dominio pubblico) presi da [OpenGameArt](https://opengameart.org), tagliati a ' + SECONDI + ' secondi con dissolvenze e volume pareggiato.',
    'La licenza CC0 non chiede di citare l\'autore: lo facciamo lo stesso, per ringraziare.', '',
    '| File | Titolo | Autore | Umore | Licenza | Pagina d\'origine |', '|---|---|---|---|---|---|'];
  ind.brani.forEach(b => righe.push('| `' + b.file + '` | ' + b.titolo + ' | ' + b.autore + ' | ' + b.umore + ' | ' + b.licenza + ' | ' + b.fonte + ' |'));
  righe.push('', 'Rifatto il ' + ind.generato + ' da `musica.mjs` (workflow "Musica dei video").', '');
  return righe.join('\n');
}

export async function main(o = {}) {
  const ffmpeg = o.ffmpeg || process.env.FFMPEG || 'ffmpeg';
  const cartella = o.cartella || process.env.CARTELLA_MUSICA || 'musica';
  const rifai = o.rifai ?? !!process.env.RIFAI;
  const brani = o.brani || BRANI;
  fs.mkdirSync(cartella, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mr_musica_'));
  let fatti = 0, tenuti = 0, falliti = 0;
  for (const b of brani) {
    const uscita = path.join(cartella, b.id + '.mp3');
    if (!rifai && fs.existsSync(uscita) && fs.statSync(uscita).size > 20000) { tenuti++; dice('· ' + b.id + ': c\'è già (' + Math.round(fs.statSync(uscita).size / 1024) + ' KB), lo tengo'); continue; }
    try {
      const sorgente = path.join(tmp, b.id + path.extname(new URL(b.url).pathname).toLowerCase());
      const byte = await scarica(b.url, sorgente, o.fetch);
      const s = durata(sorgente, ffmpeg);
      dice('· ' + b.id + ' · "' + b.titolo + '" di ' + b.autore + ': scaricato (' + Math.round(byte / 1024) + ' KB' + (Number.isFinite(s) ? ', ' + Math.round(s) + ' s' : '') + ')');
      const fine = taglia(ffmpeg, sorgente, uscita, b, { tmp });
      dice('  → ' + uscita + ' (' + Math.round(fine / 1024) + ' KB, ' + SECONDI + ' s)');
      fatti++;
    } catch (e) {
      falliti++;
      dice('  ✘ ' + b.id + ': ' + (e && e.message || e) + (fs.existsSync(uscita) ? ' (resta quello di prima)' : ''));
    }
    try { fs.readdirSync(tmp).forEach(f => fs.unlinkSync(path.join(tmp, f))); } catch (_) {}
  }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  const ind = indice(brani, cartella, o.adesso);
  fs.writeFileSync(path.join(cartella, 'musica.json'), JSON.stringify(ind, null, 1) + '\n');
  fs.writeFileSync(path.join(cartella, 'CREDITI.md'), crediti(ind));
  dice('musica.json: ' + ind.brani.length + ' brani (' + fatti + ' rifatti, ' + tenuti + ' tenuti, ' + falliti + ' falliti)');
  if (!ind.brani.length) throw new Error('nessun brano: niente da pubblicare');
  return ind;
}

if (process.argv[1] && /musica\.mjs$/.test(process.argv[1])) {
  main().catch(e => { console.error('✘ ' + (e && e.message || e)); process.exit(1); });
}
