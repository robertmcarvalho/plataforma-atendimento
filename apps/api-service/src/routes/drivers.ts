import { FastifyInstance, type FastifyReply } from 'fastify';
import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireCadastroManage } from '../lib/permissions';
import { writeAuditLog } from '../lib/auditLog';
import { normalizeNameLike } from '../lib/textNormalization';
import { normalizeCpf } from '../lib/brCadastroNormalize';
import {
  buildDriverImportTemplate,
  parseDriverImportWorkbook,
  IMPORT_MAX_BYTES,
} from '../lib/excelCadastroImport';
import { syncDriverLeaderContext } from '../lib/driverLeaderSync';
import { buildCadastroSearchOrFilter, DRIVER_SEARCH_CONFIG } from '../lib/cadastroSearch';
import { offboardDriver, endDriverPharmacyLinks } from '../lib/driverOffboarding';
import { loadDriverOperationalLastWorkedAt } from '../lib/billingSettlementLastWorked';
import { requireWorkspace } from '../lib/workspaceContext';
import { syncDriverDocumentsAfterSave, buildDocumentStatusPayload } from '../lib/driverDocumentAlerts';

const driverSchema = z.object({
  name: z.string().min(2),
  cpf: z.string().optional(),
  phone: z.string().min(10),
  email: z.string().email().optional().nullable(),
  city: z.string().optional(),
  state: z.string().optional(),
  status: z.enum(['active', 'inactive', 'blocked']).default('active'),
  driver_type: z.enum(['fixed', 'daily']).default('fixed'),
  primary_pharmacy_id: z.string().uuid().optional().nullable(),
  inherit_from_primary: z.boolean().default(true),
  override_attendant_id: z.string().uuid().optional().nullable(),
  override_leader_id: z.string().uuid().optional().nullable(),
  is_mei: z.boolean().default(false),
  mei_cnpj: z.string().optional().nullable(),
  is_leader: z.boolean().default(false),
  leader_role: z.string().optional().nullable(),
  leader_notes: z.string().optional().nullable(),
  has_digital_certificate: z.boolean().default(false),
  digital_certificate_expires_at: z.string().optional().nullable(),
  doc_status: z.enum(['ok', 'pending', 'expired']).default('ok'),
  notes: z.string().optional(),
  pix_key: z.string().optional().nullable(),
  pix_key_type: z.string().optional().nullable(),
  whatsapp: z.string().optional().nullable(),
  birth_date: z.string().optional().nullable(),
  cnh_number: z.string().optional().nullable(),
  cnh_expires_at: z.string().optional().nullable(),
  address_cep: z.string().optional().nullable(),
  address_street: z.string().optional().nullable(),
  address_number: z.string().optional().nullable(),
  address_neighborhood: z.string().optional().nullable(),
  address_complement: z.string().optional().nullable(),
  vehicle_plate: z.string().optional().nullable(),
  vehicle_model: z.string().optional().nullable(),
  vehicle_color: z.string().optional().nullable(),
  vehicle_renavam: z.string().optional().nullable(),
  vehicle_model_year: z.string().optional().nullable(),
  flux_delivery_driver_id: z.string().optional().nullable(),
  flux_delivery_synced_at: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  work_schedule: z.any().optional(),
});

const linkSchema = z.object({
  pharmacy_id: z.string().uuid(),
  is_primary: z.boolean().default(false),
  started_at: z.string().optional(),
  notes: z.string().optional(),
});

function stripUndefined<T extends Record<string, unknown>>(row: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined));
}

async function replyDriverUniqueConflict(
  reply: FastifyReply,
  db: SupabaseClient,
  workspaceId: string,
  error: PostgrestError | { message?: string; code?: string },
  hints?: { cpf?: string | null; phone?: string | null }
) {
  if (error.code !== '23505' && !(error.message || '').toLowerCase().includes('unique')) {
    return null;
  }
  const msg = (error.message || '').toLowerCase();
  if (msg.includes('cpf')) {
    let existing: { id: string; name: string } | null = null;
    if (hints?.cpf) {
      const { data } = await db
        .from('drivers')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('cpf', hints.cpf)
        .maybeSingle();
      if (data?.id) existing = { id: String(data.id), name: String(data.name || '') };
    }
    return reply.status(409).send({
      error: 'Já existe um entregador cadastrado com este CPF.',
      code: 'DUPLICATE_CPF',
      existing_driver_id: existing?.id ?? null,
      existing_driver_name: existing?.name ?? null,
    });
  }
  if (msg.includes('phone')) {
    let existing: { id: string; name: string } | null = null;
    if (hints?.phone) {
      const { data } = await db
        .from('drivers')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('phone', hints.phone)
        .maybeSingle();
      if (data?.id) existing = { id: String(data.id), name: String(data.name || '') };
    }
    return reply.status(409).send({
      error: 'Já existe um entregador cadastrado com este telefone.',
      code: 'DUPLICATE_PHONE',
      existing_driver_id: existing?.id ?? null,
      existing_driver_name: existing?.name ?? null,
    });
  }
  return reply.status(409).send({
    error: 'Já existe um entregador com os mesmos dados (telefone ou CPF).',
    code: 'DUPLICATE_DRIVER',
  });
}

const importPre = [authenticate, requireRole('admin', 'supervisor')] as const;

export async function driverRoutes(app: FastifyInstance) {
  app.get('/import/template', { preHandler: [...importPre] }, async (_request, reply) => {
    const buf = await buildDriverImportTemplate();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', 'attachment; filename=template_entregadores.xlsx')
      .send(buf);
  });

  app.post('/import', { preHandler: [...importPre] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const file = await request.file();
    if (!file) return reply.status(400).send({ error: 'Nenhum arquivo enviado' });
    const buffer = await file.toBuffer();
    if (buffer.length > IMPORT_MAX_BYTES) return reply.status(413).send({ error: 'Arquivo muito grande' });

    const { rows, errors: parseErrors } = await parseDriverImportWorkbook(buffer);
    const skipped: Array<{ row: number; reason: string }> = [];
    const rowErrors: Array<{ row: number; message: string }> = [...parseErrors];
    let created = 0;

    const cpfList = [...new Set(rows.map((r) => r.cpf).filter(Boolean))] as string[];
    const phoneList = [...new Set(rows.map((r) => r.phone))];

    const existingCpfs = new Set<string>();
    const existingPhones = new Set<string>();

    if (cpfList.length > 0) {
      const { data } = await supabase.from('drivers').select('cpf').eq('workspace_id', workspaceId).in('cpf', cpfList);
      for (const r of data || []) {
        if (r.cpf) existingCpfs.add(String(r.cpf));
      }
    }
    if (phoneList.length > 0) {
      const { data } = await supabase.from('drivers').select('phone').eq('workspace_id', workspaceId).in('phone', phoneList);
      for (const r of data || []) {
        if (r.phone) existingPhones.add(String(r.phone));
      }
    }

    const seenPhones = new Set<string>();
    const seenCpfs = new Set<string>();

    const actor = (request.user as { sub: string }).sub;

    for (const row of rows) {
      if (existingPhones.has(row.phone) || seenPhones.has(row.phone)) {
        skipped.push({ row: row.row, reason: 'Telefone já cadastrado' });
        continue;
      }
      if (row.cpf && (existingCpfs.has(row.cpf) || seenCpfs.has(row.cpf))) {
        skipped.push({ row: row.row, reason: 'CPF já cadastrado' });
        continue;
      }

      let sync: Awaited<ReturnType<typeof syncDriverLeaderContext>>;
      try {
        sync = await syncDriverLeaderContext(supabase, {
          workspace_id: workspaceId,
          phone: row.phone,
          name: row.name,
          email: row.email || null,
          is_leader: row.is_leader,
          primary_pharmacy_id: row.primary_pharmacy_id || null,
        });
      } catch (e) {
        rowErrors.push({ row: row.row, message: e instanceof Error ? e.message : 'Falha ao sincronizar líder' });
        continue;
      }

      const insertRow = stripUndefined({
        workspace_id: workspaceId,
        name: normalizeNameLike(row.name),
        phone: row.phone,
        cpf: row.cpf || undefined,
        email: row.email || undefined,
        state: row.state || undefined,
        city: row.city || undefined,
        status: row.status,
        driver_type: 'fixed',
        primary_pharmacy_id: row.primary_pharmacy_id || undefined,
        is_mei: row.is_mei,
        mei_cnpj: row.mei_cnpj || undefined,
        has_digital_certificate: row.has_digital_certificate,
        digital_certificate_expires_at: row.digital_certificate_expires_at || undefined,
        is_leader: row.is_leader,
        leader_role: row.leader_role || undefined,
        leader_notes: row.leader_notes || undefined,
        pix_key: row.pix_key || undefined,
        notes: row.notes || undefined,
        inherit_from_primary: true,
        override_leader_id: sync.override_leader_id,
        doc_status: 'ok',
        tags: [],
      } as Record<string, unknown>);

      const { error } = await supabase.from('drivers').insert({ ...insertRow, workspace_id: workspaceId });
      if (error) {
        if ((error.message || '').toLowerCase().includes('unique') || error.code === '23505') {
          skipped.push({ row: row.row, reason: 'Duplicidade no banco (telefone ou CPF)' });
        } else {
          rowErrors.push({ row: row.row, message: error.message });
        }
        continue;
      }
      created += 1;
      seenPhones.add(row.phone);
      if (row.cpf) seenCpfs.add(row.cpf);
    }

    await writeAuditLog({
      actor_id: actor,
      action: 'drivers.import',
      entity_type: 'drivers',
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

  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { search, status, pharmacy_id, doc_status } = request.query as Record<string, string>;

    let query = supabase
      .from('drivers')
      .select(`
        *,
        primary_pharmacy:pharmacies!primary_pharmacy_id(id, trade_name, city, state, leader_id, leader:leaders(id, name)),
        override_leader:leaders!override_leader_id(id, name, city, state, status),
        driver_pharmacy_links(
          id, is_primary, is_active,
          pharmacies(id, trade_name)
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('name');

    if (status) query = query.eq('status', status);
    if (doc_status) query = query.eq('doc_status', doc_status);
    if (search) {
      const orFilter = buildCadastroSearchOrFilter(search, DRIVER_SEARCH_CONFIG);
      if (orFilter) query = query.or(orFilter);
    }
    if (pharmacy_id) query = query.eq('primary_pharmacy_id', pharmacy_id);
    if (search?.trim()) query = query.limit(25);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get('/:id/registration-gaps', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { getDriverRegistrationGapsPublic } = await import('../lib/driverRegistrationGaps.js');
    const data = await getDriverRegistrationGapsPublic(id, workspaceId);
    if ((data as { error?: string }).error === 'not_found') return reply.status(404).send({ error: 'Entregador não encontrado' });
    if ((data as { error?: string }).error) return reply.status(500).send({ error: String((data as { error?: string }).error) });
    return reply.send(data);
  });

  app.get('/:id/document-status', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: driver, error } = await supabase
      .from('drivers')
      .select('cnh_expires_at, has_digital_certificate, digital_certificate_expires_at, doc_status')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!driver) return reply.status(404).send({ error: 'Entregador não encontrado' });
    return reply.send(buildDocumentStatusPayload(driver));
  });

  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('drivers')
      .select(`
        *,
        primary_pharmacy:pharmacies!primary_pharmacy_id(id, trade_name, city, primary_attendant_id, leader_id, leader:leaders(id, name)),
        override_attendant:users!override_attendant_id(id, name),
        override_leader:leaders!override_leader_id(id, name),
        driver_pharmacy_links(
          id, is_primary, is_active, started_at, ended_at, notes,
          pharmacies(id, trade_name, city)
        ),
        financial_entries(id, type, total_amount, status, created_at)
      `)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Entregador nao encontrado' });
    return reply.send(data);
  });

  app.post('/', { preHandler: [authenticate, requireCadastroManage('drivers')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = driverSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });
    let sync: Awaited<ReturnType<typeof syncDriverLeaderContext>>;
    try {
      sync = await syncDriverLeaderContext(supabase, { ...body.data, workspace_id: workspaceId });
    } catch (e) {
      app.log.error(
        {
          route: 'POST /api/drivers',
          driver_name: body.data.name,
          driver_phone: body.data.phone,
          is_leader: body.data.is_leader,
          primary_pharmacy_id: body.data.primary_pharmacy_id || null,
          err: e,
        },
        'Falha ao sincronizar líder ao salvar entregador'
      );
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao sincronizar líder' });
    }
    const cpfNorm = body.data.cpf ? normalizeCpf(body.data.cpf) : '';
    if (cpfNorm) {
      const { data: existingByCpf } = await supabase
        .from('drivers')
        .select('id, name')
        .eq('workspace_id', workspaceId)
        .eq('cpf', cpfNorm)
        .maybeSingle();
      if (existingByCpf?.id) {
        return reply.status(409).send({
          error: 'Já existe um entregador cadastrado com este CPF.',
          code: 'DUPLICATE_CPF',
          existing_driver_id: String(existingByCpf.id),
          existing_driver_name: String(existingByCpf.name || ''),
        });
      }
    }
    const insertRow = stripUndefined({
      workspace_id: workspaceId,
      ...(body.data as Record<string, unknown>),
      name: normalizeNameLike(body.data.name),
      cpf: cpfNorm || body.data.cpf || undefined,
      override_leader_id: sync.override_leader_id,
    });
    const { data, error } = await supabase.from('drivers').insert({ ...insertRow, workspace_id: workspaceId }).select().single();
    if (error) {
      const conflict = await replyDriverUniqueConflict(reply, supabase, workspaceId, error, {
        cpf: body.data.cpf || null,
        phone: body.data.phone,
      });
      if (conflict) return conflict;
      return reply.status(500).send({ error: error.message });
    }
    return reply.status(201).send(data);
  });

  app.put('/:id', { preHandler: [authenticate, requireCadastroManage('drivers')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = driverSchema.partial().safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });
    const { data: currentDriver, error: currentDriverError } = await supabase
      .from('drivers')
      .select('phone, name, email, is_leader, primary_pharmacy_id, status')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (currentDriverError) return reply.status(404).send({ error: 'Entregador nao encontrado' });

    const becomingInactive =
      body.data.status === 'inactive' && String(currentDriver.status || '') !== 'inactive';
    const becomingBlocked =
      body.data.status === 'blocked' && String(currentDriver.status || '') !== 'blocked';

    let sync: Awaited<ReturnType<typeof syncDriverLeaderContext>>;
    try {
      sync = await syncDriverLeaderContext(supabase, {
        workspace_id: workspaceId,
        phone: (body.data.phone as string | undefined) ?? currentDriver.phone,
        previous_phone: currentDriver.phone,
        name: (body.data.name as string | undefined) ?? currentDriver.name,
        email: (body.data.email as string | null | undefined) ?? currentDriver.email,
        is_leader: (body.data.is_leader as boolean | undefined) ?? currentDriver.is_leader,
        primary_pharmacy_id:
          (body.data.primary_pharmacy_id as string | null | undefined) ?? currentDriver.primary_pharmacy_id,
      });
    } catch (e) {
      app.log.error(
        {
          route: 'PUT /api/drivers/:id',
          driver_id: id,
          driver_name: (body.data.name as string | undefined) ?? currentDriver.name,
          driver_phone: (body.data.phone as string | undefined) ?? currentDriver.phone,
          is_leader: (body.data.is_leader as boolean | undefined) ?? currentDriver.is_leader,
          primary_pharmacy_id:
            (body.data.primary_pharmacy_id as string | null | undefined) ?? currentDriver.primary_pharmacy_id,
          err: e,
        },
        'Falha ao sincronizar líder ao atualizar entregador'
      );
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao sincronizar líder' });
    }

    if (becomingInactive) {
      try {
        const actorId = (request.user as { sub?: string }).sub || null;
        const offboarding = await offboardDriver(supabase, {
          driverId: id,
          lastWorkedAt: new Date().toISOString().slice(0, 10),
          actorId,
          source: 'workspace_driver_update',
          reason: 'manual_inactivation',
        });
        const { status: _status, ...rest } = body.data;
        const patch = stripUndefined({
          ...(rest as Record<string, unknown>),
          name: body.data.name !== undefined ? normalizeNameLike(body.data.name) : undefined,
          override_leader_id: sync.override_leader_id,
          updated_at: new Date().toISOString(),
        });
        if (Object.keys(patch).length > 0) {
          const { data: patched, error: patchErr } = await supabase
            .from('drivers')
            .update(patch)
            .eq('workspace_id', workspaceId)
            .eq('id', id)
            .select()
            .single();
          if (patchErr) return reply.status(500).send({ error: patchErr.message });
          await syncDriverDocumentsAfterSave(supabase, id, workspaceId);
          return reply.send({ ...patched, offboarding });
        }
        const { data: refreshed } = await supabase
          .from('drivers')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('id', id)
          .single();
        await syncDriverDocumentsAfterSave(supabase, id, workspaceId);
        return reply.send({ ...(refreshed || {}), offboarding });
      } catch (e) {
        return reply.status(500).send({
          error: e instanceof Error ? e.message : 'Falha ao encerrar vínculos do entregador',
        });
      }
    }

    if (becomingBlocked) {
      try {
        await endDriverPharmacyLinks(supabase, {
          driverId: id,
          endedAt: new Date().toISOString().slice(0, 10),
        });
      } catch (e) {
        return reply.status(500).send({
          error: e instanceof Error ? e.message : 'Falha ao encerrar vínculos do entregador',
        });
      }
    }

    const updateRow = stripUndefined({
      ...(body.data as Record<string, unknown>),
      name: body.data.name !== undefined ? normalizeNameLike(body.data.name) : undefined,
      override_leader_id: sync.override_leader_id,
      updated_at: new Date().toISOString(),
      ...(becomingBlocked ? { primary_pharmacy_id: null, override_leader_id: null } : {}),
    });
    const { data, error } = await supabase.from('drivers').update(updateRow).eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) {
      const conflict = await replyDriverUniqueConflict(reply, supabase, workspaceId, error, {
        cpf: (body.data.cpf as string | undefined) ?? null,
        phone: (body.data.phone as string | undefined) ?? currentDriver.phone,
      });
      if (conflict) return conflict;
      return reply.status(500).send({ error: error.message });
    }

    try {
      await syncDriverDocumentsAfterSave(supabase, id, workspaceId);
    } catch (e) {
      app.log.warn({ err: e, driver_id: id }, 'Falha ao sincronizar alertas de documentos');
    }

    return reply.send(data);
  });

  app.post('/:id/pharmacies', { preHandler: [authenticate, requireCadastroManage('drivers')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = linkSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });

    const { data: driverRow, error: driverErr } = await supabase
      .from('drivers')
      .select('status')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (driverErr || !driverRow) return reply.status(404).send({ error: 'Entregador nao encontrado' });
    if (driverRow.status !== 'active') {
      return reply.status(400).send({ error: 'Entregador inativo ou bloqueado não pode receber vínculo com farmácia' });
    }

    const { data: pharmacyRow, error: pharmacyErr } = await supabase
      .from('pharmacies')
      .select('status')
      .eq('workspace_id', workspaceId)
      .eq('id', body.data.pharmacy_id)
      .single();
    if (pharmacyErr || !pharmacyRow) return reply.status(404).send({ error: 'Farmácia não encontrada' });
    if (pharmacyRow.status !== 'active') {
      return reply.status(400).send({ error: 'Farmácia inativa não pode receber vínculo com entregador' });
    }

    if (body.data.is_primary) {
      await supabase.from('driver_pharmacy_links').update({ is_primary: false }).eq('workspace_id', workspaceId).eq('driver_id', id);
    }

    const { data, error } = await supabase
      .from('driver_pharmacy_links')
      .upsert(
        {
          workspace_id: workspaceId,
          driver_id: id,
          ...body.data,
          is_active: true,
          ended_at: null,
        },
        { onConflict: 'driver_id,pharmacy_id' },
      )
      .select('*, pharmacies(id, trade_name)')
      .single();

    if (error) return reply.status(500).send({ error: error.message });

    if (body.data.is_primary) {
      await supabase
        .from('drivers')
        .update(
          stripUndefined({
            primary_pharmacy_id: body.data.pharmacy_id,
            updated_at: new Date().toISOString(),
            ...(await syncDriverLeaderContext(supabase, {
              primary_pharmacy_id: body.data.pharmacy_id,
              workspace_id: workspaceId,
            })),
          })
        )
        .eq('workspace_id', workspaceId)
        .eq('id', id);
    }

    return reply.status(201).send(data);
  });

  app.delete('/:id/pharmacies/:pharmacyId', { preHandler: [authenticate, requireCadastroManage('drivers')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id, pharmacyId } = request.params as { id: string; pharmacyId: string };
    const currentDriver = await supabase.from('drivers').select('primary_pharmacy_id').eq('workspace_id', workspaceId).eq('id', id).single();

    const operationalLastWorked = await loadDriverOperationalLastWorkedAt(workspaceId, id);
    const endedAt = operationalLastWorked || new Date().toISOString().split('T')[0];

    const { error } = await supabase
      .from('driver_pharmacy_links')
      .update({ is_active: false, ended_at: endedAt })
      .eq('workspace_id', workspaceId)
      .eq('driver_id', id)
      .eq('pharmacy_id', pharmacyId);

    if (error) return reply.status(500).send({ error: error.message });

    if (currentDriver.data?.primary_pharmacy_id === pharmacyId) {
      await supabase
        .from('drivers')
        .update({ primary_pharmacy_id: null, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('id', id);
    }

    return reply.status(204).send();
  });

  app.get('/:id/pharmacies', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('driver_pharmacy_links')
      .select('*, pharmacies(id, trade_name, city, phone, primary_attendant_id, leader_id)')
      .eq('workspace_id', workspaceId)
      .eq('driver_id', id)
      .eq('is_active', true);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });
}
