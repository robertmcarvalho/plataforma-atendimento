import type { TicketClassification } from './mappings';

export function computeDueAt(classification: TicketClassification, now = new Date()): string {
  return new Date(now.getTime() + classification.sla_minutes * 60 * 1000).toISOString();
}

export function computeAlert80At(classification: TicketClassification, now = new Date()): string {
  const minutes = Math.floor(classification.sla_minutes * 0.8);
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
}
