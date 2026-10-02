export type JsonRecord = Record<string, unknown>;

export const AUTOMATION_RULE_COLUMNS =
  'id, workspace_id, name, trigger_type, cron_expression, event_type, audience_type, audience_filters, template_id, variables_mapping, dispatch_config, require_approval, created_by';

export type AutomationRule = {
  id: string;
  workspace_id: string;
  name: string;
  trigger_type: string;
  cron_expression: string | null;
  event_type: string | null;
  audience_type: string | null;
  audience_filters: JsonRecord | null;
  template_id: string | null;
  variables_mapping: JsonRecord | null;
  dispatch_config: JsonRecord | null;
  require_approval: boolean;
  created_by: string | null;
};

export type AudienceRecipient = {
  contact_id?: string | null;
  wa_phone: string;
  variables: Record<string, string>;
  source: JsonRecord;
};

export type JobHandler = () => Promise<void>;

export type JobCatalogEntry = {
  name: string;
  description: string;
  schedule?: string;
};
