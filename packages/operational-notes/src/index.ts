export * from './constants';
export * from './driverDocumentExpiry';
export * from './templateBodyResolve';
export * from './autentiqueSignature';
export * from './autentiqueClient';
export * from './signatureSyncCore';
export * from './gestorScope';
export * from './gestorSectorResolve';
export * from './systemNoteAuthor';

export type QueueSlaDeadlines = {
  first?: Date | string | null;
  treatment?: Date | string | null;
  resolution?: Date | string | null;
};

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

function formatPtShort(iso: Date | string | null | undefined): string {
  const d = toDate(iso);
  if (!d) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${dd}/${mm} ${hh}:${min}`;
}

export function formatQueueSlaAppliedNote(input: {
  nodeLabel: string;
  firstMin: number;
  treatmentMin: number;
  resolutionMin: number;
  deadlines: QueueSlaDeadlines;
  businessHours: boolean;
}): string {
  const { nodeLabel, firstMin, treatmentMin, resolutionMin, deadlines, businessHours } = input;
  const lines = [
    `SLA da fila aplicado (${nodeLabel})`,
    `1ª resposta: ${firstMin} min (até ${formatPtShort(deadlines.first)}) · Tratamento: ${treatmentMin} min (até ${formatPtShort(deadlines.treatment)}) · Resolução: ${resolutionMin} min (até ${formatPtShort(deadlines.resolution)})`,
    `Horário comercial: ${businessHours ? 'sim' : 'não'}`,
  ];
  return lines.join('\n');
}

export function formatQueueSlaWarningNote(): string {
  return 'Alerta de SLA: o prazo de tratamento atingiu 80% do tempo configurado. Priorize esta conversa.';
}

export function formatQueueSlaOverdueNote(): string {
  return 'SLA de tratamento vencido. Avalie reatribuição ou escalonamento conforme a política da fila.';
}

export function formatQueueSlaReassignNote(hasSupervisor: boolean): string {
  return hasSupervisor
    ? 'Reatribuição automática após vencimento do SLA de tratamento (encaminhado ao supervisor).'
    : 'Tentativa de reatribuição após vencimento do SLA — nenhum supervisor disponível no momento.';
}

export function formatQueueSlaEscalationNote(): string {
  return 'Escalonamento automático para supervisão após vencimento do SLA de tratamento.';
}

export function formatTriagemGuidadaNote(profile: string, sectorName: string, demandTitle: string, _demandId?: string): string {
  return `Triagem guiada concluída: perfil ${profile}, setor ${sectorName}, demanda ${demandTitle}.`;
}

/** Nota única ao concluir triagem (SLA + resumo). */
export function formatTriagemCompleteNote(input: {
  profile: string;
  sectorName: string;
  demandTitle: string;
  nodeLabel: string;
  firstMin: number;
  treatmentMin: number;
  resolutionMin: number;
  deadlines: QueueSlaDeadlines;
  businessHours: boolean;
}): string {
  const slaBlock = formatQueueSlaAppliedNote({
    nodeLabel: input.nodeLabel,
    firstMin: input.firstMin,
    treatmentMin: input.treatmentMin,
    resolutionMin: input.resolutionMin,
    deadlines: input.deadlines,
    businessHours: input.businessHours,
  });
  const summary = formatTriagemGuidadaNote(input.profile, input.sectorName, input.demandTitle);
  return `${summary}\n\n${slaBlock}`;
}

/** Converte notas legadas `[Queue SLA]` / `[Triagem guiada]` para texto operacional. */
export function humanizeInternalNoteContent(raw: string): string {
  const text = String(raw || '').trim();
  if (!text) return text;

  if (text.startsWith('[Triagem guiada]')) {
    const m = text.match(/Perfil\s+(\w+),\s*setor\s+([^,]+),\s*demanda\s+(.+?)\s+\(([^)]+)\)/i);
    if (m) return formatTriagemGuidadaNote(m[1], m[2].trim(), m[3].trim(), m[4].trim());
    return text.replace(/^\[Triagem guiada\]\s*/i, 'Triagem guiada: ');
  }

  if (text.includes('[Queue SLA] aplicado')) {
    const applied = text.match(/\[Queue SLA\]\s*aplicado\s*\(([^)]+)\):\s*1R=(\d+)m\s*\(até\s*([^)]+)\),\s*Trat=(\d+)m\s*\(até\s*([^)]+)\),\s*Res=(\d+)m\s*\(até\s*([^)]+)\),\s*business_hours=(true|false)/i);
    if (applied) {
      return formatQueueSlaAppliedNote({
        nodeLabel: applied[1].trim(),
        firstMin: Number(applied[2]),
        treatmentMin: Number(applied[4]),
        resolutionMin: Number(applied[6]),
        deadlines: {
          first: applied[3],
          treatment: applied[5],
          resolution: applied[7],
        },
        businessHours: applied[8] === 'true',
      });
    }
  }

  if (/^\[Queue SLA\]\s*Alerta preventivo/i.test(text)) return formatQueueSlaWarningNote();
  if (/^\[Queue SLA\]\s*SLA de tratamento vencido/i.test(text)) return formatQueueSlaOverdueNote();
  if (/^\[Queue SLA\]\s*Reatribuição automática/i.test(text)) {
    return formatQueueSlaReassignNote(/supervisor/i.test(text) && !/sem supervisor/i.test(text));
  }
  if (/^\[Queue SLA\]\s*Escalonamento automático/i.test(text)) return formatQueueSlaEscalationNote();

  return text.replace(/^\[(Queue SLA|Triagem guiada)\]\s*/i, '');
}
