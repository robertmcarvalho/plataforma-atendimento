import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireCadastroManage } from '../lib/permissions';
import {
  enrichPharmacyApiRow,
  normalizeDeliveryScheduleInput,
  parseCommercialTermsInput,
  validateCommercialTerms,
} from '../lib/pharmacyCommercial';
import { offboardPharmacy } from '../lib/pharmacyOffboarding';
import { writeAuditLog } from '../lib/auditLog';
import { normalizeNameLike } from '../lib/textNormalization';
import { requireWorkspace } from '../lib/workspaceContext';
import {
  buildPharmacyImportTemplate,
  parsePharmacyImportWorkbook,
  IMPORT_MAX_BYTES,
} from '../lib/excelCadastroImport';

const sectorAttendantRowSchema = z.object({
  sector_id: z.string().uuid(),
  attendant_id: z.string().uuid().nullable(),
});

function isTableMissingError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: string } | null)?.message || '').toLowerCase();
  return code === '42P01' || message.includes('does not exist') || message.includes('pharmacy_sector_attendants');
}

function stripUndefined<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

const PHARMACY_COMMERCIAL_KEYS = [
  'delivery_fee_cents',
  'delivery_fee_driver_payout_cents',
  'minimum_guaranteed_cents',
  'minimum_guaranteed_driver_payout_cents',
] as const;

async function replacePharmacySectorAttendants(
  workspaceId: string,
  pharmacyId: string,
  rows: z.infer<typeof sectorAttendantRowSchema>[]
) {
  const { error: delErr } = await supabase.from('pharmacy_sector_attendants').delete().eq('workspace_id', workspaceId).eq('pharmacy_id', pharmacyId);
  if (delErr) {
    if (isTableMissingError(delErr)) return;
    throw delErr;
  }
  const ins = rows.filter((r): r is { sector_id: string; attendant_id: string } => Boolean(r.attendant_id));
  if (ins.length === 0) return;
  const { error: insErr } = await supabase.from('pharmacy_sector_attendants').insert(
    ins.map((r) => ({
      pharmacy_id: pharmacyId,
      workspace_id: workspaceId,
      sector_id: r.sector_id,
      attendant_id: r.attendant_id,
      updated_at: new Date().toISOString(),
    }))
  );
  if (insErr) {
    if (isTableMissingError(insErr)) return;
    throw insErr;
  }
}

async function syncPharmacyLeaderConsistency(workspaceId: string, pharmacyId: string, leaderId: string | null) {
  if (leaderId) {
    const { error: deactivateOthersErr } = await supabase
      .from('leader_pharmacy_links')
      .update({ is_active: false })
      .eq('workspace_id', workspaceId)
      .eq('pharmacy_id', pharmacyId)
      .neq('leader_id', leaderId);
    if (deactivateOthersErr) throw deactivateOthersErr;

    const { error: upsertErr } = await supabase
      .from('leader_pharmacy_links')
      .upsert(
        {
          leader_id: leaderId,
          pharmacy_id: pharmacyId,
          workspace_id: workspaceId,
          is_active: true,
        },
        { onConflict: 'leader_id,pharmacy_id' }
      );
    if (upsertErr) throw upsertErr;
    return;
  }

  const { error: deactivateErr } = await supabase
    .from('leader_pharmacy_links')
    .update({ is_active: false })
    .eq('workspace_id', workspaceId)
    .eq('pharmacy_id', pharmacyId);
  if (deactivateErr) throw deactivateErr;
}

const pharmacySchema = z.object({
  legal_name: z.string().min(2),
  trade_name: z.string().min(2),
  cnpj: z.string().optional(),
  address_cep: z.string().optional().nullable(),
  address_street: z.string().optional().nullable(),
  address_number: z.string().optional().nullable(),
  address_neighborhood: z.string().optional().nullable(),
  address_complement: z.string().optional().nullable(),
  contact_expedition_name: z.string().optional().nullable(),
  contact_expedition_phone: z.string().optional().nullable(),
  contact_expedition_email: z.string().email().optional().nullable(),
  contact_financial_name: z.string().optional().nullable(),
  contact_financial_phone: z.string().optional().nullable(),
  contact_financial_email: z.string().email().optional().nullable(),
  contact_manager_name: z.string().optional().nullable(),
  contact_manager_phone: z.string().optional().nullable(),
  contact_manager_email: z.string().email().optional().nullable(),
  city: z.string().optional(),
  state: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  status: z.enum(['active', 'inactive']).default('active'),
  primary_attendant_id: z.string().uuid().optional().nullable(),
  secondary_attendant_id: z.string().uuid().optional().nullable(),
  leader_id: z.string().uuid().optional().nullable(),
  notes: z.string().optional(),
  tags: z.array(z.string()).default([]),
  sector_attendants: z.array(sectorAttendantRowSchema).optional(),
  delivery_fee_cents: z.number().int().min(0).optional().nullable(),
  delivery_fee_driver_payout_cents: z.number().int().min(0).optional().nullable(),
  minimum_guaranteed_cents: z.number().int().min(0).optional().nullable(),
  minimum_guaranteed_driver_payout_cents: z.number().int().min(0).optional().nullable(),
  delivery_schedule: z.record(z.unknown()).optional(),
});

function applyPharmacyCommercialFields(row: Record<string, unknown>): { row: Record<string, unknown>; error?: string } {
  const hasCommercial = PHARMACY_COMMERCIAL_KEYS.some((k) => k in row);
  const next: Record<string, unknown> = { ...row };
  if (hasCommercial) {
    const commercial = parseCommercialTermsInput(row);
    const commercialErr = validateCommercialTerms(commercial);
    if (commercialErr) return { row, error: commercialErr };
    Object.assign(next, commercial);
  }
  if (row.delivery_schedule !== undefined) {
    try {
      next.delivery_schedule = normalizeDeliveryScheduleInput(row.delivery_schedule);
    } catch (e) {
      return { row, error: e instanceof Error ? e.message : 'Horário de delivery inválido.' };
    }
  }
  return { row: next };
}

function startOfDaysAgoIso(days: number) {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

const importPre = [authenticate, requireRole('admin', 'supervisor')] as const;

export async function pharmacyRoutes(app: FastifyInstance) {
  app.get('/import/template', { preHandler: [...importPre] }, async (_request, reply) => {
    const buf = await buildPharmacyImportTemplate();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename=template_farmacias.xlsx')
      .send(buf);
  });

  app.post('/import', { preHandler: [...importPre] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Nenhum arquivo enviado' });
    const buffer = await file.toBuffer();
    if (buffer.length > IMPORT_MAX_BYTES) return reply.status(413).send({ error: 'Arquivo muito grande' });

    const { rows, errors: parseErrors } = await parsePharmacyImportWorkbook(buffer);
    const skipped: Array<{ row: number; reason: string }> = [];
    const rowErrors: Array<{ row: number; message: string }> = [...parseErrors];
    let created = 0;

    const cnpjList = [...new Set(rows.map((r) => r.cnpj).filter(Boolean))] as string[];
    const existingCnpjs = new Set<string>();
    if (cnpjList.length > 0) {
      const { data } = await supabase.from('pharmacies').select('cnpj').eq('workspace_id', workspaceId).in('cnpj', cnpjList);
      for (const r of data || []) {
        if (r.cnpj) existingCnpjs.add(String(r.cnpj));
      }
    }

    const seenCnpjs = new Set<string>();
    const actor = (request.user as { sub: string }).sub;

    for (const row of rows) {
      if (row.cnpj && (existingCnpjs.has(row.cnpj) || seenCnpjs.has(row.cnpj))) {
        skipped.push({ row: row.row, reason: 'CNPJ já cadastrado' });
        continue;
      }

      const insertRow = {
        workspace_id: workspaceId,
        legal_name: normalizeNameLike(row.legal_name),
        trade_name: normalizeNameLike(row.trade_name),
        cnpj: row.cnpj || null,
        address_cep: row.address_cep || null,
        address_street: row.address_street || null,
        address_number: row.address_number || null,
        address_neighborhood: row.address_neighborhood || null,
        address_complement: row.address_complement || null,
        city: row.city || null,
        state: row.state || null,
        phone: row.phone || null,
        email: row.email || null,
        contact_expedition_name: row.contact_expedition_name || null,
        contact_expedition_phone: row.contact_expedition_phone || null,
        contact_expedition_email: row.contact_expedition_email || null,
        contact_financial_name: row.contact_financial_name || null,
        contact_financial_phone: row.contact_financial_phone || null,
        contact_financial_email: row.contact_financial_email || null,
        contact_manager_name: row.contact_manager_name || null,
        contact_manager_phone: row.contact_manager_phone || null,
        contact_manager_email: row.contact_manager_email || null,
        leader_id: row.leader_id || null,
        status: row.status,
        notes: row.notes || null,
        tags: [] as string[],
      };

      const { error } = await supabase.from('pharmacies').insert({ ...insertRow, workspace_id: workspaceId });
      if (error) {
        if ((error.message || '').toLowerCase().includes('unique') || error.code === '23505') {
          skipped.push({ row: row.row, reason: 'Duplicidade no banco (CNPJ)' });
        } else {
          rowErrors.push({ row: row.row, message: error.message });
        }
        continue;
      }
      created += 1;
      if (row.cnpj) seenCnpjs.add(row.cnpj);
    }

    await writeAuditLog({
      actor_id: actor,
      action: 'pharmacies.import',
      entity_type: 'pharmacies',
      metadata: {
        file: file.filename,
        created,
        skipped: skipped.length,
        errors: rowErrors.length,
      },
    });

    return reply.send({
      ok: true,
      created,
      skipped,
      errors: rowErrors,
    });
  });

  // GET /api/pharmacies/summary — lista com contadores (drivers/abertas/SLA)
  app.get('/summary', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { status, search, sla_days = '30' } = request.query as Record<string, string>;
    const slaDays = Math.max(1, Math.min(90, Number(sla_days) || 30));
    const sinceSla = startOfDaysAgoIso(slaDays);

    let pharmacyQuery = supabase
      .from('pharmacies')
      .select(
        `
        id, trade_name, legal_name, city, state, phone, status, leader_id,
        leader:leaders(id, name),
        leader_pharmacy_links(leader_id, is_active, leaders(id, name))
      `
      )
      .eq('workspace_id', workspaceId)
      .order('trade_name');

    if (status) pharmacyQuery = pharmacyQuery.eq('status', status);
    if (search) pharmacyQuery = pharmacyQuery.or(`trade_name.ilike.%${search}%,legal_name.ilike.%${search}%,cnpj.ilike.%${search}%`);

    const { data: pharmacies, error } = await pharmacyQuery;
    if (error) return reply.status(500).send({ error: error.message });

    const ids = (pharmacies || []).map((p) => p.id).filter(Boolean);
    if (ids.length === 0) return reply.send([]);

    const [driverLinks, openConvs, slaConvs] = await Promise.all([
      supabase
        .from('driver_pharmacy_links')
        .select('pharmacy_id')
        .eq('workspace_id', workspaceId)
        .in('pharmacy_id', ids)
        .eq('is_active', true)
        .limit(20000),
      supabase
        .from('conversations')
        .select('context_pharmacy_id')
        .eq('workspace_id', workspaceId)
        .in('context_pharmacy_id', ids)
        .in('status', ['open', 'pending'])
        .limit(20000),
      supabase
        .from('conversations')
        .select('context_pharmacy_id, sla_resolved_ok')
        .eq('workspace_id', workspaceId)
        .in('context_pharmacy_id', ids)
        .gte('created_at', sinceSla)
        .not('sla_resolved_ok', 'is', null)
        .limit(20000),
    ]);

    const driversCount = new Map<string, number>();
    for (const r of (driverLinks.data || []) as Array<{ pharmacy_id?: string }>) {
      const id = r.pharmacy_id;
      if (!id) continue;
      driversCount.set(id, (driversCount.get(id) || 0) + 1);
    }

    const openCount = new Map<string, number>();
    for (const r of (openConvs.data || []) as Array<{ context_pharmacy_id?: string }>) {
      const id = r.context_pharmacy_id;
      if (!id) continue;
      openCount.set(id, (openCount.get(id) || 0) + 1);
    }

    const slaOk = new Map<string, number>();
    const slaTotal = new Map<string, number>();
    for (const r of (slaConvs.data || []) as Array<{ context_pharmacy_id?: string; sla_resolved_ok?: boolean }>) {
      const id = r.context_pharmacy_id;
      if (!id) continue;
      slaTotal.set(id, (slaTotal.get(id) || 0) + 1);
      if (r.sla_resolved_ok === true) slaOk.set(id, (slaOk.get(id) || 0) + 1);
    }

    const enriched = (pharmacies || []).map((p: any) => {
      const total = slaTotal.get(p.id) || 0;
      const ok = slaOk.get(p.id) || 0;
      const slaPercent = total > 0 ? Math.round((ok / total) * 1000) / 10 : 0;
      const linkedLeader = (p.leader_pharmacy_links || []).find((x: any) => x?.is_active)?.leaders;
      return {
        ...p,
        leader: p.leader || linkedLeader || null,
        drivers_count: driversCount.get(p.id) || 0,
        open_conversations: openCount.get(p.id) || 0,
        sla_percent: slaPercent,
        sla_days: slaDays,
      };
    });

    return reply.send(enriched);
  });

  // GET /api/pharmacies
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { status, search } = request.query as { status?: string; search?: string };

    let query = supabase
      .from('pharmacies')
      .select(
        `
        *,
        primary_attendant:users!primary_attendant_id(id, name),
        secondary_attendant:users!secondary_attendant_id(id, name),
        leader:leaders(id, name)
      `
      )
      .eq('workspace_id', workspaceId)
      .order('trade_name');

    if (status) query = query.eq('status', status);
    if (search) query = query.or(`trade_name.ilike.%${search}%,legal_name.ilike.%${search}%,cnpj.ilike.%${search}%`);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/pharmacies/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('pharmacies')
      .select(
        `
        *,
        primary_attendant:users!primary_attendant_id(id, name, email),
        secondary_attendant:users!secondary_attendant_id(id, name, email),
        leader:leaders(id, name, phone),
        leader_pharmacy_links(leader_id, is_active, leaders(id, name, phone)),
        driver_pharmacy_links(
          id, is_primary, is_active, started_at,
          drivers(id, name, phone, status, work_schedule)
        )
      `
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Farmácia não encontrada' });

    let pharmacySectorAttendants: Array<{
      sector_id: string;
      attendant_id: string;
      sector?: { id: string; name: string } | null;
      attendant?: { id: string; name: string } | null;
    }> = [];

    const { data: sectorRows, error: sectorErr } = await supabase
      .from('pharmacy_sector_attendants')
      .select(
        `
        sector_id,
        attendant_id,
        sector:sectors(id, name),
        attendant:users!attendant_id(id, name)
      `
      )
      .eq('workspace_id', workspaceId)
      .eq('pharmacy_id', id);

    if (sectorErr && !isTableMissingError(sectorErr)) {
      return reply.status(500).send({ error: sectorErr.message });
    }
    if (sectorRows) pharmacySectorAttendants = sectorRows as any[];

    const linkedLeader = (data as any).leader || ((data as any).leader_pharmacy_links || []).find((x: any) => x?.is_active)?.leaders || null;
    return reply.send(
      enrichPharmacyApiRow({
        ...(data as Record<string, unknown>),
        leader: linkedLeader,
        pharmacy_sector_attendants: pharmacySectorAttendants,
      }),
    );
  });

  // POST /api/pharmacies
  app.post('/', { preHandler: [authenticate, requireCadastroManage('pharmacies')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = pharmacySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const { sector_attendants, ...row } = body.data;
    const commercialApplied = applyPharmacyCommercialFields(row as Record<string, unknown>);
    if (commercialApplied.error) return reply.status(400).send({ error: commercialApplied.error });
    const normalizedRow: Record<string, unknown> = {
      ...commercialApplied.row,
      trade_name: normalizeNameLike(row.trade_name) || row.trade_name,
      legal_name: normalizeNameLike(row.legal_name) || row.legal_name,
    };
    const { data, error } = await supabase.from('pharmacies').insert({ workspace_id: workspaceId, ...normalizedRow }).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    try {
      await syncPharmacyLeaderConsistency(workspaceId, data.id as string, (normalizedRow.leader_id as string | null | undefined) || null);
      if (sector_attendants !== undefined && data?.id) {
        await replacePharmacySectorAttendants(workspaceId, data.id as string, sector_attendants);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao salvar atendentes por setor';
      return reply.status(500).send({ error: msg });
    }
    return reply.status(201).send(data);
  });

  // PUT /api/pharmacies/:id
  app.put('/:id', { preHandler: [authenticate, requireCadastroManage('pharmacies')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = pharmacySchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const { sector_attendants, ...updates } = body.data;
    const commercialApplied = applyPharmacyCommercialFields(updates as Record<string, unknown>);
    if (commercialApplied.error) return reply.status(400).send({ error: commercialApplied.error });
    const normalizedUpdates: Record<string, unknown> = {
      ...commercialApplied.row,
      trade_name: updates.trade_name !== undefined ? normalizeNameLike(updates.trade_name) : undefined,
      legal_name: updates.legal_name !== undefined ? normalizeNameLike(updates.legal_name) : undefined,
    };
    const { data: currentPharmacy, error: currentErr } = await supabase
      .from('pharmacies')
      .select('leader_id, status')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (currentErr) return reply.status(404).send({ error: 'Farmácia não encontrada' });

    const becomingInactive =
      updates.status === 'inactive' && String(currentPharmacy.status || '') !== 'inactive';
    if (becomingInactive) {
      normalizedUpdates.leader_id = null;
      normalizedUpdates.primary_attendant_id = null;
      normalizedUpdates.secondary_attendant_id = null;
      try {
        const actorId = (request.user as { sub?: string }).sub || null;
        const offboarding = await offboardPharmacy(supabase, {
          workspaceId,
          pharmacyId: id,
          actorId,
          source: 'workspace_pharmacy_update',
          reason: 'manual_inactivation',
        });
        const { data, error } = await supabase
          .from('pharmacies')
          .update(
            stripUndefined({
              ...normalizedUpdates,
              updated_at: new Date().toISOString(),
            }),
          )
          .eq('workspace_id', workspaceId)
          .eq('id', id)
          .select()
          .single();
        if (error) {
          request.log.error({ pharmacyId: id, err: error }, 'pharmacy inactive update failed after offboard');
          return reply.status(500).send({ error: error.message });
        }
        return reply.send({ ...data, offboarding });
      } catch (e) {
        request.log.error({ pharmacyId: id, err: e }, 'pharmacy offboard failed');
        return reply.status(500).send({
          error: e instanceof Error ? e.message : 'Falha ao encerrar vínculos da farmácia',
        });
      }
    }

    const { data, error } = await supabase
      .from('pharmacies')
      .update(
        stripUndefined({
          ...normalizedUpdates,
          updated_at: new Date().toISOString(),
        }),
      )
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    try {
      const nextLeaderId =
        normalizedUpdates.leader_id !== undefined
          ? ((normalizedUpdates.leader_id as string | null) || null)
          : (currentPharmacy.leader_id as string | null);
      await syncPharmacyLeaderConsistency(workspaceId, id, nextLeaderId);
      if (sector_attendants !== undefined) {
        await replacePharmacySectorAttendants(workspaceId, id, sector_attendants);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao salvar atendentes por setor';
      return reply.status(500).send({ error: msg });
    }
    return reply.send(data);
  });

  // DELETE /api/pharmacies/:id
  app.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('pharmacies').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(204).send();
  });
}
