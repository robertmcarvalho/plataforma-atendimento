import fs from 'fs';
import PizZip from 'pizzip';

const [a, b] = process.argv.slice(2);
const xmlA = new PizZip(fs.readFileSync(a)).file('word/document.xml')?.asText() ?? '';
const xmlB = new PizZip(fs.readFileSync(b)).file('word/document.xml')?.asText() ?? '';

const idx = xmlA.indexOf('NOME_FANTASIA');
console.log('template field snippet:\n', xmlA.slice(idx - 200, idx + 1200));
const idx2 = xmlB.indexOf('TESTE');
console.log('\nfilled around TESTE:\n', xmlB.slice(idx2 - 200, idx2 + 800));
