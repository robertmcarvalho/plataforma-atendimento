function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Substitui placeholders {{var_N}} e {{N}} (1-based) pelo valor correspondente. */
export function resolveTemplateBody(
  body: string,
  variableNames: string[],
  values: Record<string, string> | undefined,
): string {
  if (!body) return '';
  const vars = values || {};
  let out = body;

  variableNames.forEach((name, index) => {
    const val = vars[name] ?? '';
    if (name) {
      out = out.replace(new RegExp(`\\{\\{${escapeRegExp(name)}\\}\\}`, 'g'), val);
    }
    out = out.replace(new RegExp(`\\{\\{${index + 1}\\}\\}`, 'g'), val);
  });

  return out;
}
