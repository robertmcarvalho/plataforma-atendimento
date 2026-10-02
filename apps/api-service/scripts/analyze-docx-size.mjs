import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const p = process.argv[2] || path.join(root, 'assets/proposals/Proposta_Royal_Farma.v1.docx');
const buf = fs.readFileSync(p);
const zip = new PizZip(buf);

let gfxChars = 0;
let gfxCount = 0;
for (const name of Object.keys(zip.files)) {
  if (!name.endsWith('.xml')) continue;
  const xml = zip.file(name)?.asText() ?? '';
  for (const m of xml.matchAll(/o:gfxdata="([^"]*)"/g)) {
    gfxCount += 1;
    gfxChars += m[1].length;
  }
}

console.log('file', p);
console.log('total KB', Math.round(buf.length / 1024));
const doc = zip.file('word/document.xml')?.asText() ?? '';
console.log('document.xml KB', Math.round(doc.length / 1024));
console.log('gfxdata attrs', gfxCount, 'chars MB', (gfxChars / 1e6).toFixed(2));
