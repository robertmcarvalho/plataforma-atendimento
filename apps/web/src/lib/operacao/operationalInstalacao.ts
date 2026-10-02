export const OPERATIONAL_INSTALACAO_TEMPLATE_META_NAME = 'flux_operacional_instalacao';

export type OperacionalInstalacaoTemplateOption = {
  id: string;
  name: string;
  body: string;
  variables: string[];
  meta_template_name?: string | null;
};

export type PharmacyContactFields = {
  trade_name?: string | null;
  contact_expedition_name?: string | null;
  contact_manager_name?: string | null;
  contact_financial_name?: string | null;
};

export function pharmacyContactFirstName(pharmacy: PharmacyContactFields): string {
  const src = (
    pharmacy.contact_expedition_name ||
    pharmacy.contact_manager_name ||
    pharmacy.contact_financial_name ||
    ''
  ).trim();
  if (!src) return '';
  return src.split(/\s+/)[0] ?? src;
}

export function pickOperacionalInstalacaoTemplate(
  templates: OperacionalInstalacaoTemplateOption[],
): OperacionalInstalacaoTemplateOption | null {
  if (!templates.length) return null;
  return (
    templates.find((t) => t.meta_template_name === OPERATIONAL_INSTALACAO_TEMPLATE_META_NAME) ??
    templates.find((t) => t.name.toLowerCase().includes('instalacao')) ??
    templates.find((t) => t.name.toLowerCase().includes('instalação')) ??
    null
  );
}

export function buildOperacionalInstalacaoTemplateVariables(
  variableKeys: string[],
  contactName: string,
  pharmacyTradeName: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (variableKeys.length === 0) return out;

  if (variableKeys.length === 2) {
    out[variableKeys[0]] = contactName;
    out[variableKeys[1]] = pharmacyTradeName;
    return out;
  }

  for (const key of variableKeys) {
    const lower = key.toLowerCase();
    if (lower.includes('farmacia') || lower.includes('fantasia') || lower === 'var_2' || lower === '2') {
      out[key] = pharmacyTradeName;
    } else if (lower.includes('contato') || lower.includes('nome') || lower === 'var_1' || lower === '1') {
      out[key] = contactName;
    } else {
      out[key] = '';
    }
  }
  return out;
}
