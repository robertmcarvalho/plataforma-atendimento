export type TemplatePickerPurpose = 'commercial' | 'operational';

/** Nomes Meta legados tratados como comerciais no picker/envio. */
export const LEGACY_COMMERCIAL_TEMPLATE_NAMES = new Set([
  'flux_prospeccao_formulario',
  'retormar_contato',
  // WABA comercial; sem category=commercial ainda gerava #132001 no canal operacional.
  'saudacao_generico',
]);

export function isCommercialMessageTemplate(template: {
  category?: string | null;
  meta_template_name?: string | null;
}): boolean {
  const category = String(template.category || '').trim().toLowerCase();
  const metaName = String(template.meta_template_name || '').trim();
  return category === 'commercial' || LEGACY_COMMERCIAL_TEMPLATE_NAMES.has(metaName);
}

/**
 * Resolve o purpose do picker de templates Meta.
 * Sem canal/purpose explícito → operacional (nunca misturar WABAs no inbox).
 */
export function resolveTemplatePickerPurpose(opts: {
  purpose?: string | null;
  channelPurpose?: string | null;
}): TemplatePickerPurpose {
  const explicit = String(opts.purpose || '').trim().toLowerCase();
  if (explicit === 'commercial' || explicit === 'operational') return explicit;
  if (String(opts.channelPurpose || '').trim().toLowerCase() === 'commercial') return 'commercial';
  return 'operational';
}

/** Template aprovado visível no picker do purpose informado. */
export function templateMatchesPickerPurpose(
  template: { category?: string | null; meta_template_name?: string | null },
  purpose: TemplatePickerPurpose
): boolean {
  const isCommercial = isCommercialMessageTemplate(template);
  return purpose === 'commercial' ? isCommercial : !isCommercial;
}
