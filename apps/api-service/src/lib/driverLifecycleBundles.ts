import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildAutentiqueDocumentName,
  buildSignatureMetadataForTask,
} from '@plataforma/operational-notes';
import { syncDriverLeaderContext } from './driverLeaderSync';
import { normalizeNameLike } from './textNormalization';
import {
  catalogEntryByType,
  formatTaskTitle,
  isTaskTypeCreatableForWorkspace,
  loadOpsTaskCatalog,
} from './opsTaskCatalog';
import {
  computeTaskDueAtIso,
  loadOpsTaskPlaybooks,
  loadOpsTaskSlaConfig,
  resolveTaskPlaybook,
} from './opsTaskConfig';
import { insertPendingTask, hasOpenTerminationTask, TASK_SECTOR_NAMES } from './pendingTaskFactory';

export type LifecycleSource = 'leader_portal' | 'operacao_analyst';

function playbookChecklist(
  taskType: string,
  playbooksConfig: Awaited<ReturnType<typeof loadOpsTaskPlaybooks>>
) {
  const pb = resolveTaskPlaybook(taskType, playbooksConfig);
  return pb.steps.map((s) => ({ id: s.id, label: s.label, done: Boolean(s.done) }));
}

export type PreCadastroInput = {
  workspaceId: string;
  leaderId: string;
  initiatedBy?: string | null;
  source: LifecycleSource;
  name: string;
  cpf?: string | null;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  driver_type: 'fixed' | 'daily';
  work_schedule?: Record<string, unknown>;
  pharmacy_ids: string[];
  primary_pharmacy_id?: string | null;
  notes?: string | null;
};

export async function createPreCadastroBundle(db: SupabaseClient, input: PreCadastroInput) {
  const uniquePharmacyIds = Array.from(new Set(input.pharmacy_ids.filter(Boolean)));
  const primaryPharmacyId = input.primary_pharmacy_id || uniquePharmacyIds[0] || null;
  if (!primaryPharmacyId) throw new Error('Informe pharmacy_ids');

  let sync: Awaited<ReturnType<typeof syncDriverLeaderContext>>;
  try {
    sync = await syncDriverLeaderContext(db, {
      workspace_id: input.workspaceId,
      phone: input.phone,
      name: input.name,
      email: input.email || null,
      is_leader: false,
      primary_pharmacy_id: primaryPharmacyId,
    });
  } catch (e) {
    throw new Error(e instanceof Error ? e.message : 'Falha ao sincronizar contexto');
  }

  const insertRow = {
    workspace_id: input.workspaceId,
    name: normalizeNameLike(input.name),
    cpf: input.cpf || null,
    phone: input.phone,
    email: input.email || null,
    city: input.city || null,
    state: input.state || null,
    status: 'active',
    doc_status: 'pending',
    driver_type: input.driver_type,
    primary_pharmacy_id: primaryPharmacyId,
    inherit_from_primary: true,
    override_leader_id: sync.override_leader_id,
    tags: ['cadastro-pendente'],
    notes: input.notes || null,
    work_schedule: input.work_schedule || {},
    updated_at: new Date().toISOString(),
  } as Record<string, unknown>;

  const { data: driver, error } = await db.from('drivers').insert(insertRow).select().single();
  if (error) {
    const msg = error.message || '';
    if (error.code === '23505' || msg.toLowerCase().includes('unique')) {
      throw new Error('Já existe um entregador com este telefone/CPF');
    }
    throw new Error(msg);
  }

  const nowIso = new Date().toISOString();
  const linkRows = uniquePharmacyIds.map((pharmacy_id) => ({
    workspace_id: input.workspaceId,
    driver_id: driver.id,
    pharmacy_id,
    is_primary: pharmacy_id === primaryPharmacyId,
    is_active: true,
    started_at: nowIso,
    notes: input.source === 'leader_portal' ? 'Pré-cadastro (portal do líder)' : 'Pré-cadastro (analista operacional)',
  }));

  const { error: linkErr } = await db.from('driver_pharmacy_links').insert(linkRows);
  if (linkErr) throw new Error(linkErr.message);

  const requestId = randomUUID();
  const [catalog, playbooksConfig, slaConfig] = await Promise.all([
    loadOpsTaskCatalog(db, input.workspaceId),
    loadOpsTaskPlaybooks(db, input.workspaceId),
    loadOpsTaskSlaConfig(db, input.workspaceId),
  ]);

  const driverId = String(driver.id);
  const driverName = String(driver.name || input.name);
  const baseMeta = {
    request_id: requestId,
    leader_id: input.leaderId,
    initiated_by: input.initiatedBy ?? null,
    source: input.source,
    driver_id: driverId,
    driver_name: driverName,
    pharmacy_ids: uniquePharmacyIds,
    driver_type: input.driver_type,
    requested_at: nowIso,
    phases: ['registration', 'enrollment'],
    current_phase: 'registration',
  };

  const insertedTasks: Array<Record<string, unknown>> = [];

  const canCreateUnified = await isTaskTypeCreatableForWorkspace(
    db,
    input.workspaceId,
    'driver_pre_registration',
    'leader_precadastro'
  );

  if (canCreateUnified) {
    const entry = catalogEntryByType(catalog, 'driver_pre_registration');
    const sigMeta = buildSignatureMetadataForTask('driver_enrollment_prep', driverId, driverName);
    const task = await insertPendingTask(
      db,
      {
        workspace_id: input.workspaceId,
        task_type: 'driver_pre_registration',
        title: formatTaskTitle(entry?.title_template || 'Pré-cadastro: {driver_name}', {
          driver_name: driverName,
        }),
        description:
          input.source === 'leader_portal'
            ? 'Pré-cadastro enviado pelo líder. Validar cadastro, gerar matrícula e acompanhar assinatura.'
            : 'Pré-cadastro enviado pelo analista. Validar cadastro, gerar matrícula e acompanhar assinatura.',
        status: 'open',
        priority: 'normal',
        driver_id: driverId,
        sector_name: TASK_SECTOR_NAMES.ATENDIMENTO_GERAL,
        assign_strategy: 'least_open',
        source: input.source,
        due_at: computeTaskDueAtIso('driver_pre_registration', slaConfig),
        metadata: {
          ...baseMeta,
          ...sigMeta,
          playbook_progress: playbookChecklist('driver_pre_registration', playbooksConfig),
        },
      },
      { kind: 'pre_registration' }
    );
    if (task) insertedTasks.push(task);
  }

  return {
    driver,
    pharmacy_ids: uniquePharmacyIds,
    request_id: requestId,
    tasks: insertedTasks,
    autentique_document_name_expected: buildAutentiqueDocumentName('MATRICULA', driverId, driverName),
  };
}

export type TerminationRequestInput = {
  workspaceId: string;
  driverId: string;
  leaderId: string;
  initiatedBy?: string | null;
  source: LifecycleSource;
  last_worked_at: string;
  reason: 'driver_request' | 'performance' | 'absence' | 'route_ended' | 'other';
  notes?: string | null;
};

export async function createTerminationRequestBundle(db: SupabaseClient, input: TerminationRequestInput) {
  const { data: driver, error: driverErr } = await db
    .from('drivers')
    .select('id, name, phone, status')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.driverId)
    .single();
  if (driverErr || !driver) throw new Error('Entregador não encontrado');
  if (String(driver.status || '') !== 'active') {
    throw new Error('Entregador já está inativo ou bloqueado.');
  }

  if (await hasOpenTerminationTask(db, input.workspaceId, input.driverId)) {
    throw new Error('Já existe uma solicitação de desligamento aberta para este entregador.');
  }

  const { data: links, error: linksErr } = await db
    .from('driver_pharmacy_links')
    .select('pharmacy_id, is_primary, pharmacies(id, trade_name, city)')
    .eq('driver_id', input.driverId)
    .eq('is_active', true);
  if (linksErr) throw new Error(linksErr.message);

  const activePharmacyIds = Array.from(
    new Set((links || []).map((l: { pharmacy_id: string }) => String(l.pharmacy_id)).filter(Boolean))
  );
  if (!activePharmacyIds.length) throw new Error('Entregador não possui vínculos ativos.');

  const [catalog, playbooksConfig, slaConfig] = await Promise.all([
    loadOpsTaskCatalog(db, input.workspaceId),
    loadOpsTaskPlaybooks(db, input.workspaceId),
    loadOpsTaskSlaConfig(db, input.workspaceId),
  ]);

  const requestId = randomUUID();
  const nowIso = new Date().toISOString();
  const driverName = String(driver.name || '');
  const sigMeta = buildSignatureMetadataForTask('driver_termination_request', input.driverId, driverName);

  const canCreateTermination = await isTaskTypeCreatableForWorkspace(
    db,
    input.workspaceId,
    'driver_termination_request',
    'leader_termination'
  );
  const canCreateFinancial = await isTaskTypeCreatableForWorkspace(
    db,
    input.workspaceId,
    'driver_termination_financial_review',
    'leader_termination'
  );
  if (!canCreateTermination && !canCreateFinancial) {
    throw new Error('Tipos de tarefa de desligamento desabilitados nas configurações de Operação.');
  }

  const baseMetadata = {
    request_id: requestId,
    leader_id: input.leaderId,
    initiated_by: input.initiatedBy ?? null,
    source: input.source,
    workspace_id: input.workspaceId,
    driver_id: input.driverId,
    driver_name: driverName,
    pharmacy_ids: activePharmacyIds,
    pharmacies: (links || []).map((l: Record<string, unknown>) => {
      const p = l.pharmacies as { trade_name?: string; city?: string } | null;
      return {
        id: l.pharmacy_id,
        is_primary: Boolean(l.is_primary),
        trade_name: p?.trade_name || null,
        city: p?.city || null,
      };
    }),
    last_worked_at: input.last_worked_at,
    reason: input.reason,
    notes: input.notes || null,
    requested_at: nowIso,
  };

  const termEntry = catalogEntryByType(catalog, 'driver_termination_request');
  const finEntry = catalogEntryByType(catalog, 'driver_termination_financial_review');

  const inserted: Array<Record<string, unknown>> = [];

  if (canCreateTermination) {
    const opTask = await insertPendingTask(
      db,
      {
        workspace_id: input.workspaceId,
        task_type: 'driver_termination_request',
        title: formatTaskTitle(termEntry?.title_template || 'Termo de desligamento: {driver_name}', {
          driver_name: driverName,
        }),
        description:
          input.source === 'leader_portal'
            ? 'Solicitação enviada pelo líder. Gerar termo no Autentique e acompanhar assinatura.'
            : 'Solicitação registrada pelo analista operacional.',
        status: 'open',
        priority: 'high',
        driver_id: input.driverId,
        sector_name: TASK_SECTOR_NAMES.ATENDIMENTO_GERAL,
        assign_strategy: 'least_open',
        source: input.source,
        due_at: computeTaskDueAtIso('driver_termination_request', slaConfig),
        metadata: {
          ...baseMetadata,
          ...sigMeta,
          sector_action: 'ag_signature',
          playbook_progress: playbookChecklist('driver_termination_request', playbooksConfig),
        },
      },
      { kind: 'termination' }
    );
    if (opTask) inserted.push(opTask);
  }

  if (canCreateFinancial) {
    const finTask = await insertPendingTask(
      db,
      {
        workspace_id: input.workspaceId,
        task_type: 'driver_termination_financial_review',
        title: formatTaskTitle(finEntry?.title_template || 'Acerto de desligamento: {driver_name}', {
          driver_name: driverName,
        }),
        description: 'Verificar pendências, acertos e descontos após assinatura do termo de desligamento.',
        status: 'open',
        priority: 'normal',
        driver_id: input.driverId,
        sector_name: TASK_SECTOR_NAMES.FINANCEIRO,
        assign_strategy: 'least_open',
        source: input.source,
        due_at: null,
        metadata: {
          ...baseMetadata,
          sector_action: 'financial_review',
          phase: 'awaiting_signature',
          termination_signature_status: sigMeta.signature_status,
          settlement_business_days: slaConfig.driver_termination_financial_review?.settlement_business_days ?? 7,
          playbook_progress: playbookChecklist('driver_termination_financial_review', playbooksConfig),
        },
      },
      { kind: 'driver_task_type' }
    );
    if (finTask) inserted.push(finTask);
  }

  if (!inserted.length) {
    throw new Error('Nenhuma tarefa de desligamento disponível (tipos desabilitados ou duplicadas).');
  }

  const opTask = inserted.find((t) => t.task_type === 'driver_termination_request');
  const finTask = inserted.find((t) => t.task_type === 'driver_termination_financial_review');
  if (opTask?.id && finTask?.id) {
    const finMeta = (finTask.metadata || {}) as Record<string, unknown>;
    await db
      .from('pending_tasks')
      .update({
        metadata: { ...finMeta, operational_task_id: String(opTask.id) },
        updated_at: new Date().toISOString(),
      })
      .eq('id', finTask.id);
  }

  return {
    ok: true,
    request_id: requestId,
    tasks: inserted,
    pharmacies: baseMetadata.pharmacies,
    autentique_document_name_expected: buildAutentiqueDocumentName('DESLIGAMENTO', input.driverId, driverName),
  };
}
