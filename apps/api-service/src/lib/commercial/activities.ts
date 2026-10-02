import { supabase } from '../supabase';

export async function appendLeadActivity(args: {
  workspaceId: string;
  leadId: string;
  activityType: string;
  title: string;
  detail?: string | null;
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}) {
  const { error } = await supabase.from('commercial_lead_activities').insert({
    workspace_id: args.workspaceId,
    lead_id: args.leadId,
    activity_type: args.activityType,
    title: args.title,
    detail: args.detail ?? null,
    metadata: args.metadata ?? {},
    created_by: args.createdBy ?? null,
  });
  if (error) throw new Error(error.message);
}
