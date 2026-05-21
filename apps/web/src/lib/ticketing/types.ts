export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'overdue';

export type OperationalTicket = {
  id: string;
  ticket_code: string;
  type: string;
  priority: string;
  status: TicketStatus;
  sla_minutes: number;
  due_at: string | null;
  created_at?: string;
  context_snap?: Record<string, unknown> | null;
};

export type TicketEventRow = {
  id: string;
  event_type: string;
  created_at: string;
};
