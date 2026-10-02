import type { SupabaseClient } from '@supabase/supabase-js';
import type { FluxDeliveryClient } from './client';

type DriverRow = Record<string, unknown> & {
  id: string;
  cpf?: string | null;
  phone?: string | null;
  flux_delivery_driver_id?: string | null;
};

export type FluxDriverSyncResult = {
  workspace_id: string;
  flux_total: number;
  created: number;
  updated: number;
  skipped_no_phone: number;
  warnings: Array<{ type: string; flux_id?: string; message?: string }>;
  error?: string;
};

function onlyDigits(s: string) {
  return String(s || '').replace(/\D/g, '');
}

function normalizePhone(input: string) {
  const d = onlyDigits(input);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

function emptyToNull(v: unknown) {
  const s = String(v ?? '').trim();
  return s ? s : null;
}

function parseDateOnly(v: unknown) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function mapFluxStatus(raw: unknown) {
  const s = String(raw || '').toUpperCase();
  if (s === 'ATIVO' || s === 'ACTIVE') return 'active';
  if (s === 'INATIVO' || s === 'INACTIVE') return 'inactive';
  if (s === 'BLOQUEADO' || s === 'BLOCKED') return 'blocked';
  return null;
}

function fluxRowToDriverPatch(row: Record<string, unknown>) {
  const phone = normalizePhone(String(row.celular || row.telefone || ''));
  const whatsappRaw = normalizePhone(String(row.whatsapp || ''));
  const whatsapp = whatsappRaw && whatsappRaw !== phone ? whatsappRaw : null;

  return {
    flux_delivery_driver_id: emptyToNull(row.idEntregador),
    name: emptyToNull(row.nomeEntregador),
    cpf: onlyDigits(String(row.cpfEntregador || '')) || null,
    phone: phone || null,
    whatsapp,
    email: emptyToNull(row.email),
    birth_date: parseDateOnly(row.dataNascimento),
    cnh_number: emptyToNull(row.cnh),
    cnh_expires_at: parseDateOnly(row.vencimentoCnh),
    pix_key_type: emptyToNull(row.tipoChavePix),
    pix_key: emptyToNull(row.chavePix),
    address_cep: onlyDigits(String(row.cep || '')) || null,
    address_street: emptyToNull(row.endereco),
    address_number: emptyToNull(row.numeroEndereco),
    address_neighborhood: emptyToNull(row.bairro),
    address_complement: emptyToNull(row.complementoEndereco),
    city: emptyToNull(row.cidade),
    state: emptyToNull(row.estado)?.toUpperCase()?.slice(0, 2) || null,
    vehicle_plate: emptyToNull(row.placaVeiculo),
    vehicle_model: emptyToNull(row.modeloVeiculo),
    vehicle_color: emptyToNull(row.corVeiculo),
    vehicle_renavam: emptyToNull(row.renavam),
    vehicle_model_year: emptyToNull(row.modeloAno),
    status: mapFluxStatus(row.status) || 'active',
  };
}

const FLUX_ALWAYS = new Set(['flux_delivery_driver_id', 'flux_delivery_synced_at']);

const MERGE_FIELDS = [
  'name',
  'cpf',
  'phone',
  'whatsapp',
  'email',
  'birth_date',
  'cnh_number',
  'cnh_expires_at',
  'pix_key_type',
  'pix_key',
  'address_cep',
  'address_street',
  'address_number',
  'address_neighborhood',
  'address_complement',
  'city',
  'state',
  'vehicle_plate',
  'vehicle_model',
  'vehicle_color',
  'vehicle_renavam',
  'vehicle_model_year',
  'status',
] as const;

function buildMerge(
  existing: DriverRow | null,
  patch: ReturnType<typeof fluxRowToDriverPatch>,
  forceOverwrite: boolean,
) {
  const out: Record<string, unknown> = { ...patch };
  out.flux_delivery_synced_at = new Date().toISOString();
  for (const key of MERGE_FIELDS) {
    if (FLUX_ALWAYS.has(key)) continue;
    const incoming = patch[key as keyof typeof patch];
    const current = existing?.[key];
    if (incoming == null || incoming === '') {
      delete out[key];
      continue;
    }
    if (!forceOverwrite && current != null && String(current).trim() !== '') {
      delete out[key];
    }
  }
  return out;
}

const DRIVER_SELECT =
  'id, name, cpf, phone, flux_delivery_driver_id, email, city, state, status, whatsapp, birth_date, cnh_number, cnh_expires_at, pix_key_type, pix_key, address_cep, address_street, address_number, address_neighborhood, address_complement, vehicle_plate, vehicle_model, vehicle_color, vehicle_renavam, vehicle_model_year';

export async function resolveFluxSyncWorkspaceId(db: SupabaseClient): Promise<string | null> {
  const fromEnv = process.env.FLUX_SYNC_WORKSPACE_ID?.trim();
  if (fromEnv) return fromEnv;
  const { data } = await db.from('workspaces').select('id').order('created_at', { ascending: true }).limit(1).maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function runFluxDriverSyncForWorkspace(
  db: SupabaseClient,
  opts: {
    workspaceId: string;
    fluxClient: FluxDeliveryClient;
    forceOverwrite?: boolean;
    pageSize?: number;
  },
): Promise<FluxDriverSyncResult> {
  const result: FluxDriverSyncResult = {
    workspace_id: opts.workspaceId,
    flux_total: 0,
    created: 0,
    updated: 0,
    skipped_no_phone: 0,
    warnings: [],
  };

  const { data: existingRows, error: loadErr } = await db
    .from('drivers')
    .select(DRIVER_SELECT)
    .eq('workspace_id', opts.workspaceId);

  if (loadErr) {
    result.error = loadErr.message;
    return result;
  }

  const byFluxId = new Map<string, DriverRow>();
  const byCpf = new Map<string, DriverRow>();
  const byPhone = new Map<string, DriverRow>();

  for (const raw of existingRows || []) {
    const d = raw as DriverRow;
    if (d.flux_delivery_driver_id) byFluxId.set(String(d.flux_delivery_driver_id), d);
    if (d.cpf) byCpf.set(onlyDigits(String(d.cpf)), d);
    if (d.phone) byPhone.set(normalizePhone(String(d.phone)), d);
  }

  const fluxRows = await opts.fluxClient.fetchAllEntregadores({ pageSize: opts.pageSize ?? 50 });
  result.flux_total = fluxRows.length;

  for (const row of fluxRows) {
    const patch = fluxRowToDriverPatch(row);
    if (!patch.flux_delivery_driver_id) continue;
    if (!patch.phone) {
      result.skipped_no_phone += 1;
      continue;
    }
    if (!patch.name) patch.name = `ENTREGADOR FLUX ${patch.flux_delivery_driver_id}`;

    let match = byFluxId.get(String(patch.flux_delivery_driver_id));
    if (!match && patch.cpf) {
      const m = byCpf.get(patch.cpf);
      if (m?.flux_delivery_driver_id && m.flux_delivery_driver_id !== patch.flux_delivery_driver_id) {
        result.warnings.push({
          type: 'cpf_flux_id_mismatch_ignored',
          flux_id: String(patch.flux_delivery_driver_id),
        });
      }
      if (m) match = m;
    }
    if (!match && patch.phone) {
      const m = byPhone.get(patch.phone);
      if (m && patch.cpf && m.cpf && onlyDigits(String(m.cpf)) !== patch.cpf) {
        result.warnings.push({
          type: 'phone_cpf_mismatch_ignored',
          flux_id: String(patch.flux_delivery_driver_id),
        });
      }
      if (m) match = m;
    }

    if (match) {
      const merged = buildMerge(match, patch, Boolean(opts.forceOverwrite));
      const { error } = await db
        .from('drivers')
        .update({ ...merged, updated_at: new Date().toISOString() })
        .eq('id', match.id)
        .eq('workspace_id', opts.workspaceId);
      if (error) {
        result.warnings.push({ type: 'update_failed', flux_id: String(patch.flux_delivery_driver_id), message: error.message });
        continue;
      }
      const updatedDriver = { ...match, ...merged };
      byFluxId.set(String(patch.flux_delivery_driver_id), updatedDriver);
      if (patch.cpf) byCpf.set(patch.cpf, updatedDriver);
      if (patch.phone) byPhone.set(patch.phone, updatedDriver);
      result.updated += 1;
      continue;
    }

    const createRow = {
      workspace_id: opts.workspaceId,
      ...patch,
      flux_delivery_synced_at: new Date().toISOString(),
      driver_type: 'fixed',
      doc_status: 'ok',
      inherit_from_primary: true,
      is_mei: false,
      is_leader: false,
      has_digital_certificate: false,
    };

    const { data: inserted, error: insertErr } = await db.from('drivers').insert(createRow).select('id').single();

    if (insertErr?.code === '23505') {
      const existing = byPhone.get(patch.phone) || (patch.cpf ? byCpf.get(patch.cpf) : null);
      if (existing) {
        const merged = buildMerge(existing, patch, Boolean(opts.forceOverwrite));
        const { error: updErr } = await db
          .from('drivers')
          .update({ ...merged, updated_at: new Date().toISOString() })
          .eq('id', existing.id)
          .eq('workspace_id', opts.workspaceId);
        if (updErr) {
          result.warnings.push({ type: 'link_update_failed', flux_id: String(patch.flux_delivery_driver_id), message: updErr.message });
        } else {
          const linked = { ...existing, ...merged };
          byFluxId.set(String(patch.flux_delivery_driver_id), linked);
          result.updated += 1;
        }
      } else {
        result.warnings.push({
          type: 'insert_unique_violation',
          flux_id: String(patch.flux_delivery_driver_id),
          message: insertErr.message,
        });
      }
      continue;
    }

    if (insertErr || !inserted?.id) {
      result.warnings.push({
        type: 'insert_failed',
        flux_id: String(patch.flux_delivery_driver_id),
        message: insertErr?.message || 'unknown',
      });
      continue;
    }

    const createdDriver: DriverRow = { id: String(inserted.id), ...createRow };
    if (patch.cpf) byCpf.set(patch.cpf, createdDriver);
    if (patch.phone) byPhone.set(patch.phone, createdDriver);
    byFluxId.set(String(patch.flux_delivery_driver_id), createdDriver);
    result.created += 1;
  }

  return result;
}
