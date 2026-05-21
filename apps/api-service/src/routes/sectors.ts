import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';
import {
  formatNextOpenHuman,
  hasCanonicalBusinessHours,
  isOpen,
  nextOpenAt,
  normalizeBusinessHours,
  todayIntervalsForApi,
} from '../lib/businessHours';

const intervalSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
});

const dayScheduleSchema = z.object({
  is_open: z.boolean(),
  intervals: z.array(intervalSchema),
});

const weeklySchema = z.object({
  monday: dayScheduleSchema.optional(),
  tuesday: dayScheduleSchema.optional(),
  wednesday: dayScheduleSchema.optional(),
  thursday: dayScheduleSchema.optional(),
  friday: dayScheduleSchema.optional(),
  saturday: dayScheduleSchema.optional(),
  sunday: dayScheduleSchema.optional(),
});

const businessHoursSchema = z.object({
  timezone: z.string().min(2),
  weekly: weeklySchema.optional(),
  holidays: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        is_open: z.boolean(),
        intervals: z.array(intervalSchema).optional(),
        name: z.string().optional(),
      })
    )
    .optional(),
});

const sectorSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  is_active: z.boolean().default(true),
  business_hours: z.union([businessHoursSchema, z.record(z.unknown())]).optional(),
});

export async function sectorRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase.from('sectors').select('*').eq('workspace_id', workspaceId).order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get('/:id/status', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase.from('sectors').select('business_hours').eq('workspace_id', workspaceId).eq('id', id).single();
    if (error) return reply.status(404).send({ error: 'Setor não encontrado' });

    const cfg = normalizeBusinessHours(data?.business_hours ?? {});
    const now = new Date();
    const canonical = hasCanonicalBusinessHours(data?.business_hours);
    const open = !canonical || isOpen(cfg, now);
    const nextOpen = canonical && !open ? nextOpenAt(cfg, now) : null;

    return reply.send({
      is_open: open,
      next_open_at: nextOpen?.toISOString() ?? null,
      next_open_at_label: nextOpen ? formatNextOpenHuman(cfg, nextOpen) : null,
      today_intervals: todayIntervalsForApi(canonical ? cfg : null, now),
    });
  });

  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase.from('sectors').select('*').eq('workspace_id', workspaceId).eq('id', id).single();
    if (error) return reply.status(404).send({ error: 'Setor não encontrado' });
    return reply.send(data);
  });

  app.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = sectorSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const payload = {
      workspace_id: workspaceId,
      ...body.data,
      business_hours: normalizeBusinessHours(body.data.business_hours ?? {}),
    };
    const { data, error } = await supabase.from('sectors').insert({ ...payload, workspace_id: workspaceId }).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  app.put('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = sectorSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const updates: Record<string, unknown> = { ...body.data, updated_at: new Date().toISOString() };
    if (body.data.business_hours !== undefined) {
      updates.business_hours = normalizeBusinessHours(body.data.business_hours);
    }
    const { data, error } = await supabase
      .from('sectors')
      .update(updates)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('sectors').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(204).send();
  });
}
