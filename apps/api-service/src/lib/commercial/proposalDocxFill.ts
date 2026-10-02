import PizZip from 'pizzip';
import { injectValuesIntoDocxZip } from './docxInjectFieldValues';
import type { ProposalDocumentVars } from './proposalDocumentVars';
import { proposalVarsToMergeTags } from './proposalDocumentVars';
import { loadActiveProposalTemplate, readProposalTemplateBuffer } from './proposalTemplateCatalog';
import { slimDocxBuffer } from './proposalDocxSlim';

/** Preenche o template Word ativo e retorna o buffer .docx (enxuto para LibreOffice). */
export function fillProposalDocx(vars: ProposalDocumentVars): Buffer {
  const templateBuf = slimDocxBuffer(readProposalTemplateBuffer());
  const zip = injectValuesIntoDocxZip(new PizZip(templateBuf), proposalVarsToMergeTags(vars));
  return zip.generate({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer;
}

export function getActiveTemplateMeta(): { id: string; version: number } {
  const m = loadActiveProposalTemplate();
  return { id: m.id, version: m.version };
}
