export type Attendant = { id: string; name: string };
export type ApiTemplate = { id: string; name: string };

export type RoutingRulePayload = {
  name: string;
  priority: number;
  profile_type: 'driver' | 'pharmacy' | 'leader' | 'unknown' | null;
  intent_sector_id: string | null;
  intent: string | null;
  keywords_any: string[];
  keywords_all: string[];
  requires_context_pharmacy: boolean;
  route_to: 'sector' | 'pharmacy_attendant' | 'attendant';
  target_id: string | null;
  target_name: string | null;
  is_active: boolean;
};

export type BotFlowPayload = {
  name: string;
  trigger_keywords: string[];
  message: string;
  is_active: boolean;
};

export type AutomationRulePayload = {
  name: string;
  trigger_type: 'event' | 'schedule';
  cron_expression: string | null;
  event_type: string | null;
  audience_type: string | null;
  audience_filters: Record<string, unknown>;
  template_id: string | null;
  variables_mapping: Record<string, unknown>;
  dispatch_config: Record<string, unknown>;
  is_active: boolean;
  require_approval: boolean;
  notes?: string | null;
};

export type ModelKey =
  | 'blank'
  | 'triagem_perfil'
  | 'triage_bot'
  | 'keyword_routing'
  | 'out_of_hours'
  | 'csat'
  | 'sla_escalation';
export type KindKey = 'automation_rule' | 'routing_rule' | 'bot_flow' | 'out_of_hours' | 'conversation_flow';

export type Step = 1 | 2 | 3 | 4;
