/* Controllo delle fonti: le legge tutte davvero e dice quali funzionano,
   quante notizie portano e quali sarebbero le candidate di oggi.
   Non chiama OpenAI e non spende niente.

   Uso: node prova-fonti.mjs                                              */

import fs from 'node:fs/promises';
import path from 'node:path';
import { punteggio, testoDaHtml } from './genera.mjs';

const QUI = path.dirname(new URL(import.meta.url).pathname);

/* stessa lettura del generatore, tenuta qui a parte per non doverlo importare tutto */
function pezzi(xml, tag) {
  const out = []; const re = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'gi');
  let m; while ((m = re.exec(xml)) !== null) out.push(m[1]); return out;
}
function ripulisci(s) {
  return String(s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"')
    .replace(/&#039;|&apos;/gi, "'").replace(/\s+/g, ' ').trim();
}
function campo(b, tag) {
  const m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(b);
  return m ? ripulisci(m[1]) : '';
}
function collegamento(b) {
  const d = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i.exec(b);
  if (d && d[1].trim()) return ripulisci(d[1]);
  const h = /<link[^>]*\shref=["']([^"']+)["']/i.exec(b);
  return h ? h[1] : '';
}

const config = JSON.parse(await fs.readFile(path.join(QUI, 'fonti.json'), 'utf8'));
let indice = { articoli: [] };
try { indice = JSON.parse(await fs.readFile(path.join(QUI, 'indice.json'), 'utf8')); } catch {}
const usate = new Set(indice.articoli.map(a => a.fonteUrl));

console.log('\nControllo di ' + config.fonti.length + ' fonti…\n');
const tutte = [];
let vive = 0;

for (const f of config.fonti) {
  if (f.attiva === false) { console.log('  –  ' + f.nome.padEnd(26) + 'spenta'); continue; }
  try {
    const r = await fetch(f.url, { headers: { 'user-agent': 'MeteoRadarBlog/1.0' }, signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const xml = await r.text();
    const voci = [...pezzi(xml, 'item'), ...pezzi(xml, 'entry')].map(v => ({
      titolo: campo(v, 'title'), url: collegamento(v),
      sommario: campo(v, 'description') || campo(v, 'summary') || campo(v, 'content:encoded'),
      quando: campo(v, 'pubDate') || campo(v, 'published') || campo(v, 'updated'),
      fonte: f
    })).filter(v => v.titolo && v.url);
    vive++;
    console.log('  ✔  ' + f.nome.padEnd(26) + String(voci.length).padStart(3) + ' notizie   ' +
      (voci[0] ? '· ultima: ' + voci[0].titolo.slice(0, 52) : ''));
    tutte.push(...voci);
  } catch (e) {
    console.log('  ✘  ' + f.nome.padEnd(26) + 'NON FUNZIONA → ' + e.message);
  }
}

console.log('\nFonti vive: ' + vive + ' su ' + config.fonti.filter(f => f.attiva !== false).length);
console.log('Notizie in tutto: ' + tutte.length);

const candidate = tutte
  .filter(v => !usate.has(v.url))
  .map(v => ({ v, p: punteggio(v, config.parole_chiave) }))
  .filter(x => x.p > 0)
  .sort((a, b) => b.p - a.p);

console.log('A tema e mai usate: ' + candidate.length + '\n');
console.log('Le prime cinque che il generatore proverebbe oggi:');
candidate.slice(0, 5).forEach((x, i) => {
  console.log('  ' + (i + 1) + ')  [' + String(x.p).padStart(2) + ' punti]  ' + x.v.fonte.nome);
  console.log('      ' + x.v.titolo.slice(0, 92));
});

if (candidate.length && process.argv.includes('--leggi')) {
  console.log('\nProva di lettura della prima fonte…');
  try {
    const html = await (await fetch(candidate[0].v.url, { headers: { 'user-agent': 'MeteoRadarBlog/1.0' }, signal: AbortSignal.timeout(30000) })).text();
    const t = testoDaHtml(html);
    console.log('  testo estratto: ' + t.length + ' caratteri' + (t.length < 700 ? '  ⚠ troppo poco, verrebbe saltata' : '  ✔ sufficiente'));
    console.log('  inizio: ' + t.slice(0, 200).replace(/\n/g, ' ') + '…');
  } catch (e) { console.log('  ✘ non leggibile: ' + e.message); }
}

console.log('');
if (!vive) process.exit(1);
