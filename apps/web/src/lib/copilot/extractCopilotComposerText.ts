const CLIENT_SECTION_HEADER =
  /(?:^|\n)(?:#{1,3}\s*)?(?:\*\*)?\s*(?:resposta\s+sugerida(?:\s+para\s+o\s+cliente)?|rascunho\s+(?:de\s+)?resposta(?:\s+para\s+o\s+cliente)?|mensagem\s+sugerida(?:\s+para\s+o\s+cliente)?|texto\s+(?:sugerido\s+)?para\s+o\s+cliente)(?:\*\*)?\s*:?\s*(?:\n|$)/i;

const ANALYSIS_SECTION_HEADER =
  /\n(?:#{1,3}\s*(?:\*\*)?\s*(?:resumo|dados encontrados|alertas|limita(?:ç|c)(?:õ|o)es|pr[oó]ximos passos|observa(?:ç|c)(?:õ|o)es)|\*\*(?:resumo|dados encontrados|alertas|limita))/i;

function stripMarkdownForComposer(text: string): string {
  return text
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Extrai só o texto destinado ao cliente (WhatsApp), sem análise interna do copiloto. */
export function extractCopilotComposerText(full: string): string {
  const text = String(full || '').trim();
  if (!text) return '';

  const headerMatch = CLIENT_SECTION_HEADER.exec(text);
  if (headerMatch) {
    const start = headerMatch.index + headerMatch[0].length;
    let body = text.slice(start).replace(/^\s*\n/, '');
    const nextSection = body.search(ANALYSIS_SECTION_HEADER);
    if (nextSection >= 0) body = body.slice(0, nextSection);
    const nextHeading = body.search(/\n#{1,3}\s+/);
    if (nextHeading >= 0) body = body.slice(0, nextHeading);
    const cleaned = stripMarkdownForComposer(body.trim());
    if (cleaned.length >= 8) return cleaned;
  }

  const blockquoteMatch = /resposta\s+sugerida[^:\n]*:\s*\n+((?:>\s*.+(?:\n|$))+)/i.exec(text);
  if (blockquoteMatch) {
    const cleaned = stripMarkdownForComposer(blockquoteMatch[1].replace(/^>\s?/gm, ''));
    if (cleaned.length >= 8) return cleaned;
  }

  const hasAnalysisSections = /(?:^|\n)#{1,3}\s+(?:resumo|dados encontrados|alertas)/im.test(text);
  if (!hasAnalysisSections && text.length <= 900) {
    return stripMarkdownForComposer(text);
  }

  return stripMarkdownForComposer(text.slice(text.lastIndexOf('\n\n') + 2).trim()) || '';
}
