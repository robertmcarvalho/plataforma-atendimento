export const PROSPECCAO_TEMPLATE_META_NAME = 'flux_prospeccao_formulario';

export type ProspeccaoTemplateOption = {
  id: string;
  name: string;
  body: string;
  variables: string[];
  meta_template_name?: string | null;
};

export function leadFirstName(contactName?: string | null, tradeName?: string | null): string {
  const src = (contactName || tradeName || '').trim();
  if (!src) return '';
  return src.split(/\s+/)[0] ?? src;
}

export function pickProspeccaoTemplate(templates: ProspeccaoTemplateOption[]): ProspeccaoTemplateOption | null {
  if (!templates.length) return null;
  return (
    templates.find((t) => t.meta_template_name === PROSPECCAO_TEMPLATE_META_NAME) ??
    templates.find((t) => t.name.toLowerCase().includes('prospec')) ??
    templates[0] ??
    null
  );
}

export function buildProspeccaoTemplateVariables(
  variableKeys: string[],
  leadName: string,
  sellerName: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (variableKeys.length === 0) return out;

  if (variableKeys.length === 2) {
    out[variableKeys[0]] = leadName;
    out[variableKeys[1]] = sellerName;
    return out;
  }

  for (const key of variableKeys) {
    const lower = key.toLowerCase();
    if (lower.includes('vendedor')) out[key] = sellerName;
    else if (lower.includes('nome') || lower === 'var_1' || lower === '1') out[key] = leadName;
    else out[key] = '';
  }
  return out;
}
