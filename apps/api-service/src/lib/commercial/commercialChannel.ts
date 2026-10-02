import { supabase } from '../supabase';
import { isCommercialMessageTemplate } from './templatePickerFilter';

export {
  LEGACY_COMMERCIAL_TEMPLATE_NAMES,
  isCommercialMessageTemplate,
  resolveTemplatePickerPurpose,
  templateMatchesPickerPurpose,
  type TemplatePickerPurpose,
} from './templatePickerFilter';

export async function resolveCommercialWhatsAppChannel(workspaceId: string): Promise<string> {
  const { data: rows, error } = await supabase
    .from('workspace_channels')
    .select('id, config, is_default, is_active')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true);

  if (error) throw new Error(error.message);

  const commercial = (rows || []).find((r) => {
    const cfg = (r.config as Record<string, unknown>) || {};
    return String(cfg.purpose || '').toLowerCase() === 'commercial';
  });

  if (commercial?.id) return String(commercial.id);

  // Nunca cair no canal operacional: templates comerciais só existem na WABA comercial (#132001).
  throw new Error('Canal WhatsApp comercial não configurado. Defina workspace_channels.config.purpose = "commercial".');
}

/**
 * Escolhe o canal WhatsApp cujo WABA possui o template.
 * Templates comerciais → canal purpose=commercial; demais → canal preferido/default.
 */
export async function resolveWhatsAppChannelIdForTemplate(
  workspaceId: string,
  template: { category?: string | null; meta_template_name?: string | null },
  preferredChannelId?: string | null,
): Promise<string | null> {
  if (isCommercialMessageTemplate(template)) {
    return resolveCommercialWhatsAppChannel(workspaceId);
  }
  const preferred = String(preferredChannelId || '').trim();
  return preferred || null;
}
