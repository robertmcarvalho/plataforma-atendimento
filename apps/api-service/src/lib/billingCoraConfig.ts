/**

 * CRUD config Cora (boletos) — espelha billingNfseConfig.

 * client_id e mtls_secret_ref via UI; PEM/KEY só em .secrets / Secret Manager.

 */



import {

  BILLING_CORA_BASE_URLS,

  BILLING_CORA_DEFAULTS,

  type BillingCoraBoletoTerms,

  type BillingCoraConfig,

  type BillingCoraEntityType,

  type BillingCoraEnvironment,

  type BillingCoraFineMode,

} from './billingCoraTypes';

import {

  assertSafeSecretRef,

  coraMtlsMaterialExists,

  defaultMtlsSecretRefForEntity,

  readLocalCoraClientIdFile,

} from './billingCoraSecrets';



type SupabaseClient = typeof import('./supabase').supabase;



async function getSupabase(): Promise<SupabaseClient> {

  const mod = await import('./supabase');

  return mod.supabase;

}



/** Feature flag master — default false até Stage validado. */

export function isBillingCoraEnabled(): boolean {

  const raw = process.env.BILLING_CORA_ENABLED?.trim().toLowerCase();

  if (raw === 'true' || raw === '1' || raw === 'yes') return true;

  if (raw === 'false' || raw === '0' || raw === 'no') return false;

  return false;

}



export function resolveCoraEnvironment(

  configured?: BillingCoraEnvironment | null

): BillingCoraEnvironment {

  if (configured === 'production' || configured === 'stage') return configured;

  return BILLING_CORA_DEFAULTS.environment;

}



export function coraBaseUrl(environment: BillingCoraEnvironment): string {

  return BILLING_CORA_BASE_URLS[resolveCoraEnvironment(environment)];

}



export function assertCoraHostAllowedForEnvironment(

  environment: BillingCoraEnvironment,

  hostOrUrl: string

): void {

  const raw = String(hostOrUrl || '').trim().toLowerCase();

  const host = raw.replace(/^https?:\/\//, '').split('/')[0] || '';

  const expected = new URL(coraBaseUrl(environment)).hostname.toLowerCase();

  if (host && host !== expected) {

    throw new BillingCoraConfigError(

      `PROIBIDO: host Cora ${host} não corresponde ao ambiente ${environment} (esperado ${expected}).`

    );

  }

}



export class BillingCoraConfigError extends Error {

  status: number;

  constructor(message: string, status = 400) {

    super(message);

    this.name = 'BillingCoraConfigError';

    this.status = status;

  }

}



export type CoraConfigPatch = {

  environment?: BillingCoraEnvironment;

  client_id?: string | null;

  mtls_secret_ref?: string | null;

  enabled?: boolean;

  fine_mode?: BillingCoraFineMode;

  fine_rate?: number | null;

  fine_amount_cents?: number | null;

  interest_rate?: number | null;

  pix_qr_enabled?: boolean;

  service_name_template?: string;

  service_description_template?: string;

};



export function maskCoraClientId(clientId: string | null | undefined): string | null {

  const v = String(clientId || '').trim();

  if (!v) return null;

  if (v.length <= 8) return '*'.repeat(v.length);

  return `${v.slice(0, 4)}${'*'.repeat(Math.max(v.length - 8, 0))}${v.slice(-4)}`;

}



function parseRate(value: unknown, field: string): number | null {

  if (value === null || value === undefined || value === '') return null;

  const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));

  if (!Number.isFinite(n)) {

    throw new BillingCoraConfigError(`${field} inválido.`);

  }

  if (n < 0 || n > 100) {

    throw new BillingCoraConfigError(`${field} deve estar entre 0 e 100.`);

  }

  return Math.round(n * 100) / 100;

}



function parseNonNegInt(value: unknown, field: string): number | null {

  if (value === null || value === undefined || value === '') return null;

  const n = Math.round(Number(value));

  if (!Number.isFinite(n) || n < 0) {

    throw new BillingCoraConfigError(`${field} inválido.`);

  }

  return n;

}



export function validateCoraConfigPatch(patch: CoraConfigPatch): CoraConfigPatch {

  const out: CoraConfigPatch = { ...patch };



  if (out.environment !== undefined) {

    out.environment = resolveCoraEnvironment(out.environment);

  }



  if (out.client_id !== undefined) {

    const v = out.client_id == null ? null : String(out.client_id).trim();

    if (v != null && v.length > 200) {

      throw new BillingCoraConfigError('client_id muito longo.');

    }

    if (v != null && v.length > 0 && !/^[\w.-]+$/.test(v)) {

      throw new BillingCoraConfigError('client_id contém caracteres inválidos.');

    }

    out.client_id = v || null;

  }



  if (out.mtls_secret_ref !== undefined) {

    const v = out.mtls_secret_ref == null ? null : String(out.mtls_secret_ref).trim();

    if (v) {

      try {

        out.mtls_secret_ref = assertSafeSecretRef(v);

      } catch (err) {

        throw new BillingCoraConfigError(err instanceof Error ? err.message : String(err));

      }

    } else {

      out.mtls_secret_ref = null;

    }

  }



  if (out.fine_mode !== undefined) {

    if (out.fine_mode !== 'none' && out.fine_mode !== 'rate' && out.fine_mode !== 'amount') {

      throw new BillingCoraConfigError('fine_mode deve ser none, rate ou amount.');

    }

  }



  if (out.fine_rate !== undefined) {

    out.fine_rate = parseRate(out.fine_rate, 'fine_rate');

  }



  if (out.fine_amount_cents !== undefined) {

    out.fine_amount_cents = parseNonNegInt(out.fine_amount_cents, 'fine_amount_cents');

  }



  if (out.interest_rate !== undefined) {

    out.interest_rate = parseRate(out.interest_rate, 'interest_rate');

  }



  if (out.service_name_template !== undefined) {

    const v = String(out.service_name_template || '').trim();

    if (!v) throw new BillingCoraConfigError('service_name_template não pode ser vazio.');

    if (v.length > 200) {

      throw new BillingCoraConfigError(

        'service_name_template muito longo (máx. 200 antes do truncamento Cora).'

      );

    }

    out.service_name_template = v;

  }



  if (out.service_description_template !== undefined) {

    const v = String(out.service_description_template || '').trim();

    if (!v) throw new BillingCoraConfigError('service_description_template não pode ser vazio.');

    if (v.length > 200) {

      throw new BillingCoraConfigError(

        'service_description_template muito longo (máx. 200; Cora corta em 100 na emissão).'

      );

    }

    out.service_description_template = v;

  }



  return out;

}



function mapBoletoTerms(row: Record<string, unknown>): BillingCoraBoletoTerms {

  const fineModeRaw = String(row.fine_mode || BILLING_CORA_DEFAULTS.fine_mode);

  const fine_mode: BillingCoraFineMode =

    fineModeRaw === 'none' || fineModeRaw === 'amount' || fineModeRaw === 'rate'

      ? fineModeRaw

      : BILLING_CORA_DEFAULTS.fine_mode;



  const fineRate =

    row.fine_rate != null && row.fine_rate !== ''

      ? Number(row.fine_rate)

      : BILLING_CORA_DEFAULTS.fine_rate;

  const interestRate =

    row.interest_rate != null && row.interest_rate !== ''

      ? Number(row.interest_rate)

      : row.interest_rate === null

        ? null

        : BILLING_CORA_DEFAULTS.interest_rate;



  return {

    fine_mode,

    fine_rate: Number.isFinite(fineRate) ? fineRate : BILLING_CORA_DEFAULTS.fine_rate,

    fine_amount_cents:

      row.fine_amount_cents != null && Number.isFinite(Number(row.fine_amount_cents))

        ? Math.round(Number(row.fine_amount_cents))

        : null,

    interest_rate:

      interestRate == null

        ? null

        : Number.isFinite(interestRate)

          ? interestRate

          : BILLING_CORA_DEFAULTS.interest_rate,

    pix_qr_enabled:

      row.pix_qr_enabled === undefined || row.pix_qr_enabled === null

        ? BILLING_CORA_DEFAULTS.pix_qr_enabled

        : row.pix_qr_enabled === true,

    service_name_template:

      (row.service_name_template != null && String(row.service_name_template).trim()) ||

      BILLING_CORA_DEFAULTS.service_name_template,

    service_description_template:

      (row.service_description_template != null &&

        String(row.service_description_template).trim()) ||

      BILLING_CORA_DEFAULTS.service_description_template,

  };

}



function mapConfigRow(

  row: Record<string, unknown>,

  options?: { includeClientId?: boolean }

): BillingCoraConfig {

  const entityType = row.entity_type as BillingCoraEntityType;

  const clientId = row.client_id != null ? String(row.client_id).trim() : '';

  const secretRef =

    (row.mtls_secret_ref != null && String(row.mtls_secret_ref).trim()) ||

    defaultMtlsSecretRefForEntity(entityType);

  return {

    id: String(row.id),

    workspace_id: String(row.workspace_id),

    entity_type: entityType,

    environment: resolveCoraEnvironment(row.environment as BillingCoraEnvironment),

    client_id: options?.includeClientId ? clientId || null : null,

    client_id_masked: maskCoraClientId(clientId || null),

    has_client_id: Boolean(clientId),

    mtls_secret_ref: secretRef,

    has_mtls_material: coraMtlsMaterialExists(secretRef),

    enabled: row.enabled === true,

    ...mapBoletoTerms(row),

  };

}



/** Garante linha Flux (MVP). Coop não é auto-criada nesta rodada. */

export async function ensureCoraConfigs(workspaceId: string): Promise<BillingCoraConfig[]> {

  const supabase = await getSupabase();

  const { data: existing, error } = await supabase

    .from('billing_cora_configs')

    .select('*')

    .eq('workspace_id', workspaceId);

  if (error) throw new BillingCoraConfigError(error.message, 500);



  const rows = existing || [];

  const hasFlux = rows.some((r) => r.entity_type === 'flux');

  if (!hasFlux) {

    const localClientId = readLocalCoraClientIdFile('flux');

    const { error: insertErr } = await supabase.from('billing_cora_configs').insert({

      workspace_id: workspaceId,

      entity_type: 'flux',

      environment: 'stage',

      mtls_secret_ref: defaultMtlsSecretRefForEntity('flux'),

      client_id: localClientId,

      enabled: false,

      fine_mode: BILLING_CORA_DEFAULTS.fine_mode,

      fine_rate: BILLING_CORA_DEFAULTS.fine_rate,

      interest_rate: BILLING_CORA_DEFAULTS.interest_rate,

      pix_qr_enabled: BILLING_CORA_DEFAULTS.pix_qr_enabled,

      service_name_template: BILLING_CORA_DEFAULTS.service_name_template,

      service_description_template: BILLING_CORA_DEFAULTS.service_description_template,

      updated_at: new Date().toISOString(),

    });

    if (insertErr && !/duplicate|unique/i.test(insertErr.message)) {

      throw new BillingCoraConfigError(insertErr.message, 500);

    }

    const { data: again, error: againErr } = await supabase

      .from('billing_cora_configs')

      .select('*')

      .eq('workspace_id', workspaceId);

    if (againErr) throw new BillingCoraConfigError(againErr.message, 500);

    return (again || []).map((r) =>

      mapConfigRow(r as Record<string, unknown>, { includeClientId: true })

    );

  }



  return rows.map((r) => mapConfigRow(r as Record<string, unknown>, { includeClientId: true }));

}



export type CoraWorkspaceConfig = {

  flags: { cora_enabled: boolean };

  configs: BillingCoraConfig[];

};



export async function loadCoraWorkspaceConfig(workspaceId: string): Promise<CoraWorkspaceConfig> {

  const configs = await ensureCoraConfigs(workspaceId);

  return {

    flags: { cora_enabled: isBillingCoraEnabled() },

    configs,

  };

}



/** Linha Coop criada sob demanda (desabilitada); emissão/sync Coop seguem bloqueados nos engines. */
async function ensureCoopCoraConfigRow(workspaceId: string): Promise<void> {

  const { error } = await (await getSupabase()).from('billing_cora_configs').insert({

    workspace_id: workspaceId,

    entity_type: 'coop',

    environment: 'stage',

    mtls_secret_ref: defaultMtlsSecretRefForEntity('coop'),

    client_id: readLocalCoraClientIdFile('coop'),

    enabled: false,

    updated_at: new Date().toISOString(),

  });

  if (error && !/duplicate|unique/i.test(error.message)) {

    throw new BillingCoraConfigError(error.message, 500);

  }

}



const CORA_CONFIG_UPDATE_KEYS = [

  'environment',

  'client_id',

  'mtls_secret_ref',

  'enabled',

  'fine_mode',

  'fine_rate',

  'fine_amount_cents',

  'interest_rate',

  'pix_qr_enabled',

  'service_name_template',

  'service_description_template',

] as const;



export async function updateCoraConfig(

  workspaceId: string,

  entityType: BillingCoraEntityType,

  patch: CoraConfigPatch

): Promise<BillingCoraConfig> {

  await ensureCoraConfigs(workspaceId);

  if (entityType === 'coop') await ensureCoopCoraConfigRow(workspaceId);

  const validated = validateCoraConfigPatch(patch);

  const updateRow: Record<string, unknown> = { updated_at: new Date().toISOString() };

  for (const key of CORA_CONFIG_UPDATE_KEYS) {

    if (validated[key] !== undefined) updateRow[key] = validated[key];

  }



  const { data, error } = await (await getSupabase())

    .from('billing_cora_configs')

    .update(updateRow)

    .eq('workspace_id', workspaceId)

    .eq('entity_type', entityType)

    .select('*')

    .maybeSingle();

  if (error) throw new BillingCoraConfigError(error.message, 500);

  if (!data) throw new BillingCoraConfigError('Config Cora não encontrada', 404);

  return mapConfigRow(data as Record<string, unknown>, { includeClientId: true });

}



export async function getCoraConfigForEntity(

  workspaceId: string,

  entityType: BillingCoraEntityType

): Promise<BillingCoraConfig | null> {

  const configs = await ensureCoraConfigs(workspaceId);

  return configs.find((c) => c.entity_type === entityType) || null;

}



/**

 * Resolve client_id efetivo: DB → arquivo local bootstrap.

 * Nunca logar o valor.

 */

export function resolveEffectiveCoraClientId(config: BillingCoraConfig): string | null {

  if (config.client_id && config.client_id.trim()) return config.client_id.trim();

  return readLocalCoraClientIdFile(config.entity_type);

}


