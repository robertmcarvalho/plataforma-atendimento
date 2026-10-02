import { waPhoneLookupVariants } from '@plataforma/channel-runtime';
import { supabase } from '../supabase';

export async function findCommercialLeadByPhone(
  workspaceId: string,
  phone: string,
): Promise<{ id: string } | null> {
  const variants = waPhoneLookupVariants(phone);
  for (const variant of variants) {
    const { data } = await supabase
      .from('commercial_leads')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('phone', variant)
      .maybeSingle();
    if (data?.id) return { id: String(data.id) };
  }
  return null;
}
