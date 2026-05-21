import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return new Map();
  const values = new Map();
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    values.set(key, value);
  }
  return values;
}

function resolveSupabaseSettings() {
  const envPath = path.join(process.cwd(), 'apps', 'api-service', '.env');
  const envValues = parseEnvFile(envPath);
  const url = process.env.SUPABASE_URL || envValues.get('SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envValues.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url) throw new Error('SUPABASE_URL ausente (apps/api-service/.env ou env var)');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente (apps/api-service/.env ou env var)');
  return { url, serviceKey };
}

function getDailyStartDate(now) {
  const day = now.getDay();
  const hour = now.getHours();
  const paymentDate = new Date(now);

  const isAfterTueLimit = (day === 2 && hour >= 11) || day > 2;
  const isBeforeQuiLimit = day < 4 || (day === 4 && hour < 11);

  if (isAfterTueLimit && isBeforeQuiLimit) {
    paymentDate.setDate(now.getDate() + ((4 + 7 - now.getDay()) % 7));
  } else {
    paymentDate.setDate(now.getDate() + ((2 + 7 - now.getDay()) % 7));
    if (day === 4 && hour >= 11) paymentDate.setDate(paymentDate.getDate() + 7);
  }
  return paymentDate.toISOString().split('T')[0];
}

function buildEntry(type, driverId, pharmacyId, startDate, createdBy) {
  const total_amount = 100 + Math.floor(Math.random() * 100);
  const installments_count = 1;
  return {
    driver_id: driverId,
    pharmacy_id: pharmacyId || undefined,
    type,
    description: `Lançamento de exemplo: ${type}`,
    total_amount,
    installment_amount: Number((total_amount / installments_count).toFixed(2)),
    installments_count,
    frequency: 'weekly',
    start_date: startDate,
    status: ['daily', 'absence'].includes(type) ? 'pending_approval' : 'active',
    created_by: createdBy,
    notes: `Exemplo de ${type} gerado automaticamente`,
  };
}

function assertDevOnlyScript() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SCRIPTS !== 'true') {
    throw new Error('Script dev-only bloqueado em producao. Defina ALLOW_DEV_SCRIPTS=true apenas em ambiente controlado.');
  }
}

async function main() {
  assertDevOnlyScript();
  const { url, serviceKey } = resolveSupabaseSettings();
  const supabase = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: drivers, error: driversError } = await supabase.from('drivers').select('id, name, cpf').limit(5);
  if (driversError) throw driversError;
  if (!drivers || drivers.length === 0) throw new Error('Nenhum driver encontrado para criar lançamentos');

  const driver = drivers[0];

  const { data: users, error: usersError } = await supabase.from('users').select('id').limit(1);
  if (usersError) throw usersError;
  if (!users || users.length === 0) throw new Error('Nenhum usuário encontrado para atribuir created_by');
  const createdBy = users[0].id;

  const { data: pharmacies, error: pharmaciesError } = await supabase.from('pharmacies').select('id, trade_name').limit(1);
  if (pharmaciesError) throw pharmaciesError;
  const pharmacyId = pharmacies?.[0]?.id;

  const today = new Date();
  const formatDate = (date) => date.toISOString().split('T')[0];
  const startDate = formatDate(today);
  const dailyStartDate = getDailyStartDate(today);

  const types = ['uniform', 'bag', 'quota', 'digital_cert', 'fine', 'adjustment', 'absence', 'daily'];
  const createdEntries = [];

  for (const type of types) {
    const entryStartDate = type === 'daily' ? dailyStartDate : startDate;
    const payload = buildEntry(type, driver.id, pharmacyId, entryStartDate, createdBy);
    const { data, error } = await supabase.from('financial_entries').insert(payload).select().single();
    if (error) {
      console.error('Erro criando', type, error.message);
      continue;
    }

    const installment_amount = Number((payload.total_amount / payload.installments_count).toFixed(2));
    const installments = [{
      entry_id: data.id,
      installment_number: 1,
      amount: installment_amount,
      due_date: payload.start_date,
      status: 'pending',
    }];
    const { error: installmentError } = await supabase.from('financial_installments').insert(installments);
    if (installmentError) {
      console.error('Erro criando parcela para', type, installmentError.message);
      continue;
    }

    createdEntries.push({
      type,
      id: data.id,
      status: data.status,
      description: data.description,
      start_date: data.start_date,
    });
  }

  console.log('Lançamentos criados:');
  console.table(createdEntries);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});