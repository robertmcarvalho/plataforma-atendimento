import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import PizZip from 'pizzip';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'apps/api-service/assets/proposals');
const manifest = JSON.parse(
  fs.readFileSync(path.join(dir, 'Proposta_Royal_Farma.v1.manifest.json'), 'utf8'),
);
const docxPath = path.join(dir, manifest.file);
if (!fs.existsSync(docxPath)) {
  console.error('Missing', docxPath);
  process.exit(1);
}

const xml = new PizZip(fs.readFileSync(docxPath)).file('word/document.xml')?.asText() ?? '';
const normTag = (s) =>
  s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/\s+/g, '_');
const normXml = normTag(xml);
const mergeLeft = (xml.match(/MERGEFIELD/gi) || []).length;
const required = [...manifest.fields, ...(manifest.optional_fields ?? [])];

let ok = true;
for (const field of required) {
  const normField = normTag(field);
  const inXml =
    normXml.includes(normField) ||
    xml.includes(field) ||
    xml.includes(`MERGEFIELD ${field}`) ||
    xml.includes(`MERGEFIELD "${field}"`);
  if (!inXml && !manifest.optional_fields?.includes(field)) {
    console.warn('Campo obrigatório não encontrado no XML:', field);
    ok = false;
  }
}

if (mergeLeft > 0) {
  console.warn('MERGEFIELD restantes:', mergeLeft, '(ok se injeção runtime trata)');
}

console.log(ok ? 'Template OK' : 'Template com avisos');
process.exit(ok ? 0 : 1);
