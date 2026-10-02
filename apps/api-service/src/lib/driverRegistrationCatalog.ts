import type { SupabaseClient } from '@supabase/supabase-js';
import { evaluateDriverDocuments, badgeLabelForState } from '@plataforma/operational-notes';
import { supabase } from './supabase';

export type DriverFieldRequirement = {
  key: string;
  label: string;
  required: boolean;
  source: 'web_form' | 'channel_webhook';
};

const WEB_FORM_FIELDS: DriverFieldRequirement[] = [
  { key: 'name', label: 'Nome completo', required: true, source: 'web_form' },
  { key: 'phone', label: 'Telefone', required: true, source: 'web_form' },
  { key: 'driver_type', label: 'Tipo de entregador (fixo/diária)', required: true, source: 'web_form' },
  { key: 'cpf', label: 'CPF', required: false, source: 'web_form' },
  { key: 'email', label: 'E-mail', required: false, source: 'web_form' },
  { key: 'state', label: 'Estado', required: true, source: 'web_form' },
  { key: 'city', label: 'Cidade', required: true, source: 'web_form' },
  { key: 'primary_pharmacy_id', label: 'Farmácia primária / unidade', required: false, source: 'web_form' },
  { key: 'pix_key', label: 'Chave PIX', required: false, source: 'web_form' },
  { key: 'cnh_number', label: 'CNH', required: false, source: 'web_form' },
  { key: 'address_cep', label: 'CEP / endereço', required: false, source: 'web_form' },
  { key: 'vehicle_plate', label: 'Veículo (placa)', required: false, source: 'web_form' },
  { key: 'mei_cnpj', label: 'CNPJ do MEI', required: false, source: 'web_form' },
  { key: 'digital_certificate_expires_at', label: 'Validade do certificado digital', required: false, source: 'web_form' },
];

export async function loadChannelPreRegistrationFields(
  workspaceId: string,
  db: SupabaseClient = supabase
): Promise<string[]> {
  const { data } = await db
    .from('workspace_channels')
    .select('config')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  const cfg = (data?.config || {}) as { profiles?: { pre_registration_fields?: Record<string, unknown> } };
  const fields = cfg.profiles?.pre_registration_fields?.entregador;
  if (Array.isArray(fields)) return fields.map((x) => String(x)).filter(Boolean);
  return ['Nome', 'CPF/CNPJ', 'Telefone'];
}

export async function getDriverRegistrationRequirements(
  workspaceId: string,
  db: SupabaseClient = supabase
): Promise<{ web_form: DriverFieldRequirement[]; channel_webhook: string[]; unified_labels: string[] }> {
  const channel = await loadChannelPreRegistrationFields(workspaceId, db);
  const unified = [
    ...WEB_FORM_FIELDS.filter((f) => f.required).map((f) => f.label),
    ...channel.filter((c) => !WEB_FORM_FIELDS.some((w) => w.label.toLowerCase().includes(c.toLowerCase().slice(0, 4)))),
  ];
  return {
    web_form: WEB_FORM_FIELDS,
    channel_webhook: channel,
    unified_labels: [...new Set(unified)],
  };
}

function isFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export async function analyzeDriverRegistrationGaps(
  driverId: string,
  workspaceId: string,
  db: SupabaseClient = supabase
): Promise<Record<string, unknown>> {
  const { data: driver, error } = await db
    .from('drivers')
    .select(
      'id, name, cpf, phone, whatsapp, email, city, state, status, driver_type, pix_key, pix_key_type, birth_date, cnh_number, cnh_expires_at, address_cep, address_street, vehicle_plate, mei_cnpj, is_mei, primary_pharmacy_id, has_digital_certificate, digital_certificate_expires_at, flux_delivery_driver_id, driver_pharmacy_links(id, is_active, is_primary)'
    )
    .eq('workspace_id', workspaceId)
    .eq('id', driverId)
    .maybeSingle();

  if (error) return { error: error.message };
  if (!driver) return { error: 'not_found' };

  const requirements = await getDriverRegistrationRequirements(workspaceId, db);
  const row = driver as Record<string, unknown>;
  const links = (row.driver_pharmacy_links as Array<{ is_active?: boolean; is_primary?: boolean }>) || [];
  const hasPharmacy = Boolean(row.primary_pharmacy_id) || links.some((l) => l.is_active !== false);

  const checks: Array<{ key: string; label: string; required: boolean; filled: boolean }> = WEB_FORM_FIELDS.map((f) => {
    let filled = false;
    if (f.key === 'primary_pharmacy_id') filled = hasPharmacy;
    else if (f.key === 'mei_cnpj') filled = !row.is_mei || isFilled(row.mei_cnpj);
    else if (f.key === 'digital_certificate_expires_at') {
      filled = !row.has_digital_certificate || isFilled(row.digital_certificate_expires_at);
    } else if (f.key === 'address_cep') {
      filled = Boolean(row.address_cep && row.address_street);
    } else filled = isFilled(row[f.key]);
    return { key: f.key, label: f.label, required: f.required, filled };
  });

  const missingRequired = checks.filter((c) => c.required && !c.filled);
  const missingOptional = checks.filter((c) => !c.required && !c.filled);

  const docEval = evaluateDriverDocuments({
    cnh_expires_at: row.cnh_expires_at as string | null | undefined,
    has_digital_certificate: row.has_digital_certificate as boolean | null | undefined,
    digital_certificate_expires_at: row.digital_certificate_expires_at as string | null | undefined,
  });

  const expiryLines: string[] = [];
  if (row.cnh_expires_at) {
    expiryLines.push(`CNH: ${badgeLabelForState(docEval.cnh, String(row.cnh_expires_at))} (${String(row.cnh_expires_at).slice(0, 10)})`);
  }
  if (row.has_digital_certificate) {
    const certDate = row.digital_certificate_expires_at ? String(row.digital_certificate_expires_at).slice(0, 10) : 'sem data';
    expiryLines.push(`Certificado: ${badgeLabelForState(docEval.certificate, row.digital_certificate_expires_at as string | null)} (${certDate})`);
  }

  const expirySummary =
    expiryLines.length === 0
      ? 'Sem datas de vencimento monitoradas.'
      : expiryLines.join('; ');

  return {
    driver_id: driverId,
    driver_name: row.name,
    status: row.status,
    requirements,
    fields: checks,
    missing_required: missingRequired.map((m) => m.label),
    missing_optional: missingOptional.map((m) => m.label),
    expiry_alerts: {
      doc_status: docEval.doc_status,
      cnh_state: docEval.cnh,
      certificate_state: docEval.certificate,
      cnh_expires_at: row.cnh_expires_at || null,
      digital_certificate_expires_at: row.digital_certificate_expires_at || null,
      lines: expiryLines,
    },
    summary_pt:
      missingRequired.length === 0
        ? `Cadastro com campos obrigatórios preenchidos. ${expirySummary}`
        : `Faltam ${missingRequired.length} campo(s) obrigatório(s): ${missingRequired.map((m) => m.label).join(', ')}. ${expirySummary}`,
  };
}
