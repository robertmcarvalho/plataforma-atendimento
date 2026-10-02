import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    leaderId?: string;
    leaderWorkspaceId?: string;
  }
}

export function getLeaderId(request: FastifyRequest): string {
  return request.leaderId!;
}

export function getLeaderWorkspaceId(request: FastifyRequest, fallback = ''): string {
  return String(request.leaderWorkspaceId || fallback);
}
