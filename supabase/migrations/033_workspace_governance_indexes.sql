-- Governance indexes for tenant-scoped reads.
-- Safe rollout: all indexes are non-unique and guarded by IF NOT EXISTS.

-- P0: hot queues, reports and SLA.
CREATE INDEX IF NOT EXISTS idx_campaign_recipients_workspace_campaign_status
  ON public.campaign_recipients(workspace_id, campaign_id, status);

CREATE INDEX IF NOT EXISTS idx_campaign_dispatch_logs_workspace_campaign_created
  ON public.campaign_dispatch_logs(workspace_id, campaign_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workspace_started
  ON public.automation_runs(workspace_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_runs_workspace_rule_started
  ON public.automation_runs(workspace_id, rule_id, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_installments_workspace_status_due
  ON public.financial_installments(workspace_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_ticket_events_workspace_type_created
  ON public.ticket_events(workspace_id, event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sla_events_workspace_created
  ON public.sla_events(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sla_events_workspace_severity_created
  ON public.sla_events(workspace_id, severity, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created
  ON public.audit_logs(workspace_id, created_at DESC);

-- P1: inbox, tickets and internal messages.
CREATE INDEX IF NOT EXISTS idx_internal_notes_workspace_conversation_created
  ON public.internal_notes(workspace_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_internal_chat_messages_workspace_conversation_created
  ON public.internal_chat_messages(workspace_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_assignments_workspace_conversation_created
  ON public.conversation_assignments(workspace_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bot_sessions_workspace_contact_updated
  ON public.bot_sessions(workspace_id, contact_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_ticket_events_workspace_ticket_created
  ON public.ticket_events(workspace_id, ticket_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_conversation_created
  ON public.messages(workspace_id, conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_workspace_direction_created
  ON public.messages(workspace_id, direction, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_status_sla
  ON public.conversations(workspace_id, status, sla_resolution_deadline);

CREATE INDEX IF NOT EXISTS idx_tickets_workspace_status_due
  ON public.tickets(workspace_id, status, due_at);

-- P1/P2: remaining tenant-scoped tables without explicit workspace index.
CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_id
  ON public.financial_entries(workspace_id);

CREATE INDEX IF NOT EXISTS idx_financial_exports_workspace_created
  ON public.financial_exports(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_templates_workspace_active
  ON public.message_templates(workspace_id, is_active);

CREATE INDEX IF NOT EXISTS idx_sla_policies_workspace_id
  ON public.sla_policies(workspace_id);

CREATE INDEX IF NOT EXISTS idx_api_tokens_workspace_id
  ON public.api_tokens(workspace_id);

CREATE INDEX IF NOT EXISTS idx_bot_flows_workspace_id
  ON public.bot_flows(workspace_id);

CREATE INDEX IF NOT EXISTS idx_routing_rules_workspace_active_priority
  ON public.routing_rules(workspace_id, is_active, priority);

CREATE INDEX IF NOT EXISTS idx_user_sectors_workspace_user
  ON public.user_sectors(workspace_id, user_id);

CREATE INDEX IF NOT EXISTS idx_pharmacy_sector_attendants_workspace_sector
  ON public.pharmacy_sector_attendants(workspace_id, sector_id);

CREATE INDEX IF NOT EXISTS idx_driver_pharmacy_links_workspace_driver
  ON public.driver_pharmacy_links(workspace_id, driver_id);

CREATE INDEX IF NOT EXISTS idx_leader_pharmacy_links_workspace_leader
  ON public.leader_pharmacy_links(workspace_id, leader_id);
