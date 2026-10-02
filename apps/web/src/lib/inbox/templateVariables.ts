/**
 * Extrai chaves de variáveis válidas da Meta ({{1}} → var_1, {{nome}} → nome).
 * `{{}}` vazio NÃO é parâmetro — gera #132000 se enviado.
 */
export function extractTemplateVariablesFromBody(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const re = /\{\{(\d+|\w+)\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(text || ''))) !== null) {
    const key = m[1];
    const varName = /^\d+$/.test(key) ? `var_${key}` : key;
    if (!seen.has(varName)) {
      seen.add(varName);
      out.push(varName);
    }
  }
  return out;
}

export function hasInvalidEmptyPlaceholders(text: string): boolean {
  return /\{\{\s*\}\}/.test(String(text || ''));
}

/** Usa variables da API; se body só tem {{}} inválido, não inventa params. */
export function resolveTemplateVariableKeys(template: {
  variables?: string[] | null;
  body?: string | null;
} | null | undefined): string[] {
  const body = String(template?.body || '');
  const validInBody = extractTemplateVariablesFromBody(body);
  if (hasInvalidEmptyPlaceholders(body) && validInBody.length === 0) {
    return [];
  }
  const fromApi = Array.isArray(template?.variables)
    ? template!.variables!.map(String).filter(Boolean)
    : [];
  if (fromApi.length) return fromApi;
  return validInBody;
}
