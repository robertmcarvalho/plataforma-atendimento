import { supabase } from '../supabase';

export type CommercialNotificationInput = {
  workspaceId: string;
  userId: string;
  type: string;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
};

export async function createCommercialNotification(input: CommercialNotificationInput): Promise<void> {
  const { error } = await supabase.from('commercial_notifications').insert({
    workspace_id: input.workspaceId,
    user_id: input.userId,
    type: input.type,
    title: input.title,
    body: input.body || null,
    entity_type: input.entityType || null,
    entity_id: input.entityId || null,
  });
  if (error) throw new Error(error.message);
}
