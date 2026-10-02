/**
 * Leitura / CRUD de config NFS-e (Sprint 1) — sem emissão Sefin.
 */

import {
  BILLING_NFSE_DEFAULTS,
  BILLING_NFSE_SEFIN_HOSTS,
  type BillingNfseCertificatePublic,
  type BillingNfseEntityType,
  type BillingNfseEnvironment,
  type BillingNfseIssuerConfig,
  type BillingNfseRevenueLine,
  type BillingNfseServiceProfile,
} from './billingNfseTypes';

type SupabaseClient = typeof import('./supabase').supabase;

async function getSupabase(): Promise<SupabaseClient> {
  const mod = await import('./supabase');
  return mod.supabase;
}

/** Feature flag master — default false (off até homologação / go-live). */
export function isBillingNfseEnabled(): boolean {
  const raw = process.env.BILLING_NFSE_ENABLED?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return false;
}

export function isBillingNfseSaasEnabled(): boolean {
  if (!isBillingNfseEnabled()) return false;
  const raw = process.env.BILLING_NFSE_SAAS_ENABLED?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}

export function resolveNfseEnvironment(
  configured?: BillingNfseEnvironment | null
): BillingNfseEnvironment {
  if (configured === 'producao' || configured === 'producao_restrita') return configured;
  return BILLING_NFSE_DEFAULTS.environment;
}

export function sefinBaseHosts(environment: BillingNfseEnvironment) {
  return BILLING_NFSE_SEFIN_HOSTS[environment];
}

/**
 * Recusa host de produção Sefin quando o ambiente configurado é produção restrita.
 * Também bloqueia host "aberto" se a env var forçar restrita.
 */
export function assertSefinHostAllowedForEnvironment(
  environment: BillingNfseEnvironment,
  hostOrUrl: string
): void {
  const raw = String(hostOrUrl || '').trim().toLowerCase();
  const host = raw.replace(/^https?:\/\//, '').split('/')[0] || '';

  const forceRestrita =
    process.env.BILLING_NFSE_FORCE_PRODUCAO_RESTRITA?.trim().toLowerCase() === 'true' ||
    process.env.BILLING_NFSE_FORCE_PRODUCAO_RESTRITA?.trim() === '1';

  const effective: BillingNfseEnvironment =
    forceRestrita || environment === 'producao_restrita' ? 'producao_restrita' : environment;

  if (effective === 'producao_restrita') {
    const isProdHost =
      host === BILLING_NFSE_SEFIN_HOSTS.producao.sefin ||
      host === BILLING_NFSE_SEFIN_HOSTS.producao.adn ||
      (host.endsWith('.nfse.gov.br') && !host.includes('producaorestrita'));
    if (isProdHost) {
      throw new Error(
        `PROIBIDO: host Sefin de produção (${host}) com ambiente producao_restrita. ` +
          'Use sefin.producaorestrita.nfse.gov.br / adn.producaorestrita.nfse.gov.br.'
      );
    }
    if (host && !host.includes('producaorestrita') && host.includes('nfse.gov.br')) {
      throw new Error(
        `PROIBIDO: host Sefin não reconhecido como produção restrita: ${host}`
      );
    }
  }
}

export function buildSefinHttpsBaseUrl(
  environment: BillingNfseEnvironment,
  kind: 'sefin' | 'adn' = 'sefin'
): string {
  const hosts = sefinBaseHosts(resolveNfseEnvironment(environment));
  const host = hosts[kind];
  assertSefinHostAllowedForEnvironment(environment, host);
  return `https://${host}`;
}

export type NfseConfigBundle = {
  issuer: BillingNfseIssuerConfig;
  profiles: BillingNfseServiceProfile[];
};

/** Seleciona perfil ativo por revenue_line (SaaS só se flag + active). */
export function pickServiceProfile(
  profiles: BillingNfseServiceProfile[],
  revenueLine: BillingNfseRevenueLine
): BillingNfseServiceProfile | null {
  const effective = effectiveRevenueLine(revenueLine);
  const row = profiles.find((p) => p.revenue_line === effective && p.active);
  if (!row) return null;
  if (isSaasRevenueLine(effective) && !isBillingNfseSaasEnabled()) {
    return null;
  }
  return row;
}

export function deliveryDefaultsForEntity(entityType: 'coop' | 'flux') {
  return {
    ...BILLING_NFSE_DEFAULTS.delivery,
    iss_rate_pct: entityType === 'coop' ? BILLING_NFSE_DEFAULTS.coop_iss_rate_pct : null,
    simples_nacional: entityType === 'flux',
    environment: BILLING_NFSE_DEFAULTS.environment,
    ibge_city_code: BILLING_NFSE_DEFAULTS.ibge_city_code,
  };
}

/** Defaults SaaS (CTN/NBS/templates) — emitente típico Flux; perfis seedam Coop/Flux. */
export function saasDefaultsForRevenueLine(
  revenueLine: 'saas_monthly' | 'saas_per_delivery',
  entityType: 'coop' | 'flux' = 'flux'
) {
  const delivery = deliveryDefaultsForEntity(entityType);
  return {
    ctn: BILLING_NFSE_DEFAULTS.saas.ctn,
    nbs: BILLING_NFSE_DEFAULTS.saas.nbs,
    iss_rate_pct: delivery.iss_rate_pct,
    description_template:
      revenueLine === 'saas_monthly'
        ? BILLING_NFSE_DEFAULTS.saas.monthly_description_template
        : BILLING_NFSE_DEFAULTS.saas.per_delivery_description_template,
    active: false,
  };
}

export function isSaasRevenueLine(line: BillingNfseRevenueLine): boolean {
  return line === 'saas_monthly' || line === 'saas_per_delivery';
}

export function parseNfseRevenueLine(raw: unknown): BillingNfseRevenueLine | null {
  const v = String(raw ?? '').trim();
  if (v === 'delivery' || v === 'saas_monthly' || v === 'saas_per_delivery') return v;
  return null;
}

/**
 * Com BILLING_NFSE_SAAS_ENABLED off, SaaS cai para delivery (comportamento legado).
 */
export function effectiveRevenueLine(line: BillingNfseRevenueLine): BillingNfseRevenueLine {
  if (isSaasRevenueLine(line) && !isBillingNfseSaasEnabled()) return 'delivery';
  return line;
}

/**
 * Resolve linha de receita da fatura para escolha do perfil NFS-e.
 * Ordem: coluna `billing_invoices.revenue_line` → metadata da fatura → metadata de linhas
 * (`nfse_revenue_line` ou `revenue_line`) → `delivery`.
 * Sem produto SaaS billing: setar coluna manualmente em billing-dev para UAT.
 */
export function resolveInvoiceRevenueLine(input: {
  revenue_line?: unknown;
  metadata?: Record<string, unknown> | null;
  lines?: Array<{ metadata?: Record<string, unknown> | null }> | null;
  fallback?: unknown;
}): BillingNfseRevenueLine {
  const fromCol = parseNfseRevenueLine(input.revenue_line);
  if (fromCol) return effectiveRevenueLine(fromCol);

  const meta = input.metadata;
  if (meta && typeof meta === 'object') {
    const fromMeta = parseNfseRevenueLine(meta.nfse_revenue_line ?? meta.revenue_line);
    if (fromMeta) return effectiveRevenueLine(fromMeta);
  }

  for (const line of input.lines || []) {
    const m = line?.metadata;
    if (!m || typeof m !== 'object') continue;
    const fromLine = parseNfseRevenueLine(m.nfse_revenue_line ?? m.revenue_line);
    if (fromLine) return effectiveRevenueLine(fromLine);
  }

  const fromFallback = parseNfseRevenueLine(input.fallback);
  if (fromFallback) return effectiveRevenueLine(fromFallback);

  return 'delivery';
}

export function normalizeIbgeCityCode(raw: string | null | undefined): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 7);
}

/** Retorna mensagem de erro ou null se válido. */
export function validateIbgeCityCode(raw: string | null | undefined): string | null {
  const digits = normalizeIbgeCityCode(raw);
  if (digits.length !== 7) return 'Código IBGE deve ter 7 dígitos.';
  return null;
}

export type IssuerConfigPatch = {
  environment?: BillingNfseEnvironment;
  auto_emit_on_approve?: boolean;
  municipal_registration?: string | null;
  ibge_city_code?: string;
  tax_regime?: string | null;
  simples_nacional?: boolean;
  dps_series?: string | null;
  dps_next_number?: number | null;
  active?: boolean;
};

export type ServiceProfilePatch = {
  ctn?: string;
  nbs?: string;
  iss_rate_pct?: number | null;
  description_template?: string;
  active?: boolean;
};

export type CertificateMetadataPatch = {
  secret_ref?: string | null;
  thumbprint?: string | null;
  subject_cn?: string | null;
  valid_from?: string | null;
  valid_until?: string | null;
  active?: boolean;
};

export class BillingNfseConfigError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'BillingNfseConfigError';
    this.status = status;
  }
}

export function validateIssuerConfigPatch(patch: IssuerConfigPatch): IssuerConfigPatch {
  const out: IssuerConfigPatch = { ...patch };

  if (out.environment !== undefined) {
    out.environment = resolveNfseEnvironment(out.environment);
  }

  if (out.ibge_city_code !== undefined) {
    const digits = normalizeIbgeCityCode(out.ibge_city_code);
    const err = validateIbgeCityCode(digits);
    if (err) throw new BillingNfseConfigError(err);
    out.ibge_city_code = digits;
  }

  if (out.municipal_registration !== undefined) {
    const v = out.municipal_registration == null ? null : String(out.municipal_registration).trim();
    out.municipal_registration = v || null;
  }

  if (out.tax_regime !== undefined) {
    const v = out.tax_regime == null ? null : String(out.tax_regime).trim();
    out.tax_regime = v || null;
  }

  if (out.dps_series !== undefined) {
    const v = out.dps_series == null ? null : String(out.dps_series).trim();
    out.dps_series = v || null;
  }

  if (out.dps_next_number !== undefined && out.dps_next_number != null) {
    const n = Number(out.dps_next_number);
    if (!Number.isInteger(n) || n < 1) {
      throw new BillingNfseConfigError('Número DPS deve ser inteiro ≥ 1.');
    }
    out.dps_next_number = n;
  }

  return out;
}

/**
 * Valida patch de perfil. Recusa ativar SaaS sem BILLING_NFSE_SAAS_ENABLED.
 */
export function validateServiceProfilePatch(
  revenueLine: BillingNfseRevenueLine,
  patch: ServiceProfilePatch
): ServiceProfilePatch {
  const out: ServiceProfilePatch = { ...patch };

  if (out.ctn !== undefined) {
    const ctn = String(out.ctn || '').trim();
    if (!ctn) throw new BillingNfseConfigError('CTN é obrigatório.');
    out.ctn = ctn;
  }
  if (out.nbs !== undefined) {
    const nbs = String(out.nbs || '').trim();
    if (!nbs) throw new BillingNfseConfigError('NBS é obrigatório.');
    out.nbs = nbs;
  }
  if (out.description_template !== undefined) {
    const tpl = String(out.description_template || '').trim();
    if (!tpl) throw new BillingNfseConfigError('Template de descrição é obrigatório.');
    out.description_template = tpl;
  }
  if (out.iss_rate_pct !== undefined && out.iss_rate_pct != null) {
    const rate = Number(out.iss_rate_pct);
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
      throw new BillingNfseConfigError('Alíquota ISS deve estar entre 0 e 100.');
    }
    out.iss_rate_pct = rate;
  }

  if (out.active === true && isSaasRevenueLine(revenueLine) && !isBillingNfseSaasEnabled()) {
    throw new BillingNfseConfigError(
      'Perfis SaaS não podem ser ativados enquanto BILLING_NFSE_SAAS_ENABLED estiver off (Sprint 5).',
      403
    );
  }

  return out;
}

export function validateCertificateMetadataPatch(patch: CertificateMetadataPatch): CertificateMetadataPatch {
  const out: CertificateMetadataPatch = { ...patch };
  if (out.secret_ref !== undefined) {
    const v = out.secret_ref == null ? null : String(out.secret_ref).trim();
    if (v && (v.includes('..') || v.includes('/') || v.includes('\\') || v.includes('\0'))) {
      throw new BillingNfseConfigError(
        'secret_ref inválido. Use um nome simples (ex.: billing-nfse-coop-pfx).'
      );
    }
    out.secret_ref = v || null;
  }
  if (out.thumbprint !== undefined) {
    const v = out.thumbprint == null ? null : String(out.thumbprint).trim();
    out.thumbprint = v || null;
  }
  if (out.subject_cn !== undefined) {
    const v = out.subject_cn == null ? null : String(out.subject_cn).trim();
    out.subject_cn = v || null;
  }
  for (const key of ['valid_from', 'valid_until'] as const) {
    if (out[key] !== undefined && out[key] != null) {
      const iso = String(out[key]).trim();
      if (iso && Number.isNaN(Date.parse(iso))) {
        throw new BillingNfseConfigError(`${key} inválido (use ISO-8601).`);
      }
      out[key] = iso || null;
    }
  }
  return out;
}

export function defaultSecretRefForEntity(entityType: BillingNfseEntityType): string {
  return `billing-nfse-${entityType}-pfx`;
}

function mapIssuerRow(row: Record<string, unknown>): BillingNfseIssuerConfig {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    entity_type: row.entity_type as BillingNfseEntityType,
    environment: resolveNfseEnvironment(row.environment as BillingNfseEnvironment),
    auto_emit_on_approve: row.auto_emit_on_approve !== false,
    municipal_registration: (row.municipal_registration as string | null) ?? null,
    ibge_city_code: String(row.ibge_city_code || BILLING_NFSE_DEFAULTS.ibge_city_code),
    tax_regime: (row.tax_regime as string | null) ?? null,
    simples_nacional: Boolean(row.simples_nacional),
    dps_series: (row.dps_series as string | null) ?? null,
    dps_next_number: row.dps_next_number != null ? Number(row.dps_next_number) : null,
    active: row.active !== false,
  };
}

function mapProfileRow(row: Record<string, unknown>): BillingNfseServiceProfile {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    issuer_config_id: String(row.issuer_config_id),
    revenue_line: row.revenue_line as BillingNfseRevenueLine,
    ctn: String(row.ctn || ''),
    nbs: String(row.nbs || ''),
    iss_rate_pct: row.iss_rate_pct != null ? Number(row.iss_rate_pct) : null,
    description_template: String(row.description_template || ''),
    active: row.active !== false,
  };
}

function mapCertificatePublic(row: Record<string, unknown>): BillingNfseCertificatePublic {
  const secretRef = row.secret_ref != null ? String(row.secret_ref).trim() : '';
  const storagePath = row.pfx_storage_path != null ? String(row.pfx_storage_path).trim() : '';
  const hasSecretRef =
    typeof row.has_secret_ref === 'boolean' ? row.has_secret_ref : Boolean(secretRef);
  const hasStoragePath =
    typeof row.has_storage_path === 'boolean' ? row.has_storage_path : Boolean(storagePath);
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    issuer_config_id: String(row.issuer_config_id),
    thumbprint: (row.thumbprint as string | null) ?? null,
    subject_cn: (row.subject_cn as string | null) ?? null,
    valid_from: row.valid_from != null ? String(row.valid_from) : null,
    valid_until: row.valid_until != null ? String(row.valid_until) : null,
    active: row.active !== false,
    uploaded_at: row.uploaded_at != null ? String(row.uploaded_at) : null,
    has_secret_ref: hasSecretRef,
    has_storage_path: hasStoragePath,
  };
}

async function seedMissingProfilesForIssuer(
  workspaceId: string,
  issuer: BillingNfseIssuerConfig
): Promise<void> {
  const defaults = deliveryDefaultsForEntity(issuer.entity_type);
  const now = new Date().toISOString();
  const rows = [
    {
      workspace_id: workspaceId,
      issuer_config_id: issuer.id,
      revenue_line: 'delivery' as const,
      ctn: defaults.ctn,
      nbs: defaults.nbs,
      iss_rate_pct: defaults.iss_rate_pct,
      description_template: defaults.description_template,
      active: true,
      updated_at: now,
    },
    {
      workspace_id: workspaceId,
      issuer_config_id: issuer.id,
      revenue_line: 'saas_monthly' as const,
      ...saasDefaultsForRevenueLine('saas_monthly', issuer.entity_type),
      updated_at: now,
    },
    {
      workspace_id: workspaceId,
      issuer_config_id: issuer.id,
      revenue_line: 'saas_per_delivery' as const,
      ...saasDefaultsForRevenueLine('saas_per_delivery', issuer.entity_type),
      updated_at: now,
    },
  ];
  const { error } = await (await getSupabase())
    .from('billing_nfse_service_profiles')
    .upsert(rows, { onConflict: 'issuer_config_id,revenue_line', ignoreDuplicates: true });
  if (error) throw new BillingNfseConfigError(error.message, 500);
}

/** Garante issuers Coop/Flux + profiles seed (idempotente). */
export async function ensureNfseIssuerConfigs(workspaceId: string): Promise<BillingNfseIssuerConfig[]> {
  const supabase = await getSupabase();
  const { data: legal, error: legalErr } = await supabase
    .from('billing_legal_entities')
    .select('entity_type, municipal_registration, tax_regime')
    .eq('workspace_id', workspaceId)
    .in('entity_type', ['coop', 'flux']);
  if (legalErr) throw new BillingNfseConfigError(legalErr.message, 500);

  const now = new Date().toISOString();
  for (const entityType of ['coop', 'flux'] as const) {
    const le = (legal || []).find((r) => r.entity_type === entityType);
    const defaults = deliveryDefaultsForEntity(entityType);
    const { error: upsertErr } = await supabase.from('billing_nfse_issuer_configs').upsert(
      {
        workspace_id: workspaceId,
        entity_type: entityType,
        environment: BILLING_NFSE_DEFAULTS.environment,
        auto_emit_on_approve: true,
        municipal_registration: (le?.municipal_registration as string | null) ?? null,
        ibge_city_code: defaults.ibge_city_code,
        tax_regime: (le?.tax_regime as string | null) ?? null,
        simples_nacional: defaults.simples_nacional,
        active: true,
        updated_at: now,
      },
      { onConflict: 'workspace_id,entity_type', ignoreDuplicates: true }
    );
    if (upsertErr) throw new BillingNfseConfigError(upsertErr.message, 500);
  }

  const { data: issuers, error } = await supabase
    .from('billing_nfse_issuer_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('entity_type');
  if (error) throw new BillingNfseConfigError(error.message, 500);

  const mapped = (issuers || []).map((r) => mapIssuerRow(r as Record<string, unknown>));
  for (const issuer of mapped) {
    await seedMissingProfilesForIssuer(workspaceId, issuer);
  }
  return mapped;
}

export type NfseWorkspaceConfig = {
  flags: {
    nfse_enabled: boolean;
    saas_enabled: boolean;
  };
  issuers: BillingNfseIssuerConfig[];
  profiles: BillingNfseServiceProfile[];
  certificates: BillingNfseCertificatePublic[];
};

export async function loadNfseWorkspaceConfig(workspaceId: string): Promise<NfseWorkspaceConfig> {
  const issuers = await ensureNfseIssuerConfigs(workspaceId);
  const supabase = await getSupabase();

  const { data: profiles, error: profilesErr } = await supabase
    .from('billing_nfse_service_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('revenue_line');
  if (profilesErr) throw new BillingNfseConfigError(profilesErr.message, 500);

  const issuerIds = issuers.map((i) => i.id);
  let certificates: BillingNfseCertificatePublic[] = [];
  if (issuerIds.length > 0) {
    const { data: certRows, error: certErr } = await supabase
      .from('billing_nfse_certificates')
      .select(
        'id, workspace_id, issuer_config_id, thumbprint, subject_cn, valid_from, valid_until, active, uploaded_at, secret_ref, pfx_storage_path'
      )
      .eq('workspace_id', workspaceId)
      .in('issuer_config_id', issuerIds);
    if (certErr) throw new BillingNfseConfigError(certErr.message, 500);
    certificates = (certRows || []).map((r) => mapCertificatePublic(r as Record<string, unknown>));
  }

  return {
    flags: {
      nfse_enabled: isBillingNfseEnabled(),
      saas_enabled: isBillingNfseSaasEnabled(),
    },
    issuers,
    profiles: (profiles || []).map((r) => mapProfileRow(r as Record<string, unknown>)),
    certificates,
  };
}

export async function updateNfseIssuerConfig(
  workspaceId: string,
  entityType: BillingNfseEntityType,
  patch: IssuerConfigPatch
): Promise<BillingNfseIssuerConfig> {
  await ensureNfseIssuerConfigs(workspaceId);
  const validated = validateIssuerConfigPatch(patch);
  const updateRow: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of [
    'environment',
    'auto_emit_on_approve',
    'municipal_registration',
    'ibge_city_code',
    'tax_regime',
    'simples_nacional',
    'dps_series',
    'dps_next_number',
    'active',
  ] as const) {
    if (validated[key] !== undefined) updateRow[key] = validated[key];
  }

  const { data, error } = await (await getSupabase())
    .from('billing_nfse_issuer_configs')
    .update(updateRow)
    .eq('workspace_id', workspaceId)
    .eq('entity_type', entityType)
    .select('*')
    .maybeSingle();
  if (error) throw new BillingNfseConfigError(error.message, 500);
  if (!data) throw new BillingNfseConfigError('Config de emitente não encontrada', 404);
  return mapIssuerRow(data as Record<string, unknown>);
}

export async function updateNfseServiceProfile(
  workspaceId: string,
  profileId: string,
  patch: ServiceProfilePatch
): Promise<BillingNfseServiceProfile> {
  const supabase = await getSupabase();
  const { data: existing, error: loadErr } = await supabase
    .from('billing_nfse_service_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', profileId)
    .maybeSingle();
  if (loadErr) throw new BillingNfseConfigError(loadErr.message, 500);
  if (!existing) throw new BillingNfseConfigError('Perfil de serviço não encontrado', 404);

  const revenueLine = existing.revenue_line as BillingNfseRevenueLine;
  const validated = validateServiceProfilePatch(revenueLine, patch);
  const updateRow: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const key of ['ctn', 'nbs', 'iss_rate_pct', 'description_template', 'active'] as const) {
    if (validated[key] !== undefined) updateRow[key] = validated[key];
  }

  const { data, error } = await supabase
    .from('billing_nfse_service_profiles')
    .update(updateRow)
    .eq('workspace_id', workspaceId)
    .eq('id', profileId)
    .select('*')
    .maybeSingle();
  if (error) throw new BillingNfseConfigError(error.message, 500);
  if (!data) throw new BillingNfseConfigError('Perfil de serviço não encontrado', 404);
  return mapProfileRow(data as Record<string, unknown>);
}

export async function upsertNfseCertificateMetadata(
  workspaceId: string,
  issuerConfigId: string,
  patch: CertificateMetadataPatch
): Promise<BillingNfseCertificatePublic> {
  const supabase = await getSupabase();
  const { data: issuer, error: issuerErr } = await supabase
    .from('billing_nfse_issuer_configs')
    .select('id, entity_type')
    .eq('workspace_id', workspaceId)
    .eq('id', issuerConfigId)
    .maybeSingle();
  if (issuerErr) throw new BillingNfseConfigError(issuerErr.message, 500);
  if (!issuer) throw new BillingNfseConfigError('Emitente não encontrado', 404);

  const validated = validateCertificateMetadataPatch(patch);
  const now = new Date().toISOString();
  const entityType = issuer.entity_type as BillingNfseEntityType;
  const secretRef =
    validated.secret_ref !== undefined
      ? validated.secret_ref
      : defaultSecretRefForEntity(entityType);

  const row = {
    workspace_id: workspaceId,
    issuer_config_id: issuerConfigId,
    secret_ref: secretRef,
    thumbprint: validated.thumbprint ?? null,
    subject_cn: validated.subject_cn ?? null,
    valid_from: validated.valid_from ?? null,
    valid_until: validated.valid_until ?? null,
    active: validated.active !== false,
    uploaded_at: now,
    updated_at: now,
  };

  const { data, error } = await supabase
    .from('billing_nfse_certificates')
    .upsert(row, { onConflict: 'issuer_config_id' })
    .select(
      'id, workspace_id, issuer_config_id, thumbprint, subject_cn, valid_from, valid_until, active, uploaded_at, secret_ref, pfx_storage_path'
    )
    .single();
  if (error) throw new BillingNfseConfigError(error.message, 500);
  return mapCertificatePublic(data as Record<string, unknown>);
}
