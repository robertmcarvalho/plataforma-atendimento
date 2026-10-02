export function activeMentionQuery(text: string, caret: number): string | null {
  const before = text.slice(0, caret);
  const match = before.match(/@([^\n@]*)$/);
  if (!match) return null;
  return match[1];
}

export function insertMentionAtCaret(text: string, caret: number, name: string): { text: string; caret: number } {
  const before = text.slice(0, caret);
  const after = text.slice(caret);
  const match = before.match(/@([^\n@]*)$/);
  if (!match) return { text, caret };
  const start = before.length - match[0].length;
  const next = `${text.slice(0, start)}@${name} ${after}`;
  return { text: next, caret: start + name.length + 2 };
}
