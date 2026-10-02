/** Parse "Nome:\nconteúdo" usado em mensagens outbound do atendimento. */
export function parseStaffMessageSignature(content: string): { signature: string | null; body: string } {
  const raw = (content || '').trim();
  const match = raw.match(/^([^:\n]{1,120}):\n([\s\S]*)$/);
  if (!match) return { signature: null, body: raw };
  return { signature: match[1].trim(), body: match[2] };
}

export function stripLeadingSignature(content: string): string {
  const { body } = parseStaffMessageSignature(content);
  return body;
}
