import fs from 'fs';
import path from 'path';

export type ProposalTemplateManifest = {
  id: string;
  version: number;
  file: string;
  fields: string[];
  optional_fields?: string[];
  currency_fields?: string[];
  notes?: string;
};

const PROPOSALS_ASSETS = 'assets/proposals';

function assetsDir(): string {
  const fromDist = path.join(__dirname, '../../../', PROPOSALS_ASSETS);
  if (fs.existsSync(fromDist)) return fromDist;
  const fromCwd = path.join(process.cwd(), PROPOSALS_ASSETS);
  if (fs.existsSync(fromCwd)) return fromCwd;
  throw new Error(`Diretório ${PROPOSALS_ASSETS} não encontrado no api-service`);
}

export function loadActiveProposalTemplate(): ProposalTemplateManifest {
  const dir = assetsDir();
  const manifestPath = path.join(dir, 'Proposta_Royal_Farma.v1.manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('Manifest Proposta_Royal_Farma.v1.manifest.json não encontrado');
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as ProposalTemplateManifest;
  const docxPath = path.join(dir, manifest.file);
  if (!fs.existsSync(docxPath)) {
    throw new Error(`Template ${manifest.file} não encontrado em ${dir}`);
  }
  return manifest;
}

export function readProposalTemplateBuffer(manifest?: ProposalTemplateManifest): Buffer {
  const m = manifest ?? loadActiveProposalTemplate();
  const docxPath = path.join(assetsDir(), m.file);
  return fs.readFileSync(docxPath);
}
