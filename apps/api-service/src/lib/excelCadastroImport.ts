import ExcelJS from 'exceljs';
import { z } from 'zod';

export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_BYTES = 8 * 1024 * 1024;

export function onlyDigits(input: string): string {
  return String(input || '').replace(/\D/g, '');
}

/** Telefone BR para armazenamento (55 + DDD + número), alinhado ao web. */
export function normalizeBrazilPhone(input: string): string {
  const d = onlyDigits(input);
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length === 10 || d.length === 11) return `55${d}`;
  return d;
}

export function normalizeCpf(input: string): string {
  const d = onlyDigits(input).slice(0, 11);
  return d.length === 11 ? d : '';
}

export function normalizeCnpj(input: string): string {
  const d = onlyDigits(input).slice(0, 14);
  return d.length === 14 ? d : '';
}

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const truthy = new Set(['1', 'true', 'sim', 'yes', 'y']);

function parseBool(input: string, fallback = false): boolean {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return fallback;
  return truthy.has(v);
}

const driverImportRowSchema = z.object({
  name: z.string().min(2),
  phone: z.string().min(12, 'Telefone inválido (use DDD + número)'),
  cpf: z.preprocess(emptyToNull, z.union([z.string().length(11), z.null()]).optional()),
  email: z.preprocess(emptyToNull, z.union([z.string().email(), z.null()]).optional()),
  state: z.preprocess(emptyToNull, z.union([z.string().max(2), z.null()]).optional()),
  city: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  status: z.enum(['active', 'inactive', 'blocked']),
  primary_pharmacy_id: z.preprocess(emptyToNull, z.union([z.string().uuid(), z.null()]).optional()),
  is_mei: z.boolean().default(false),
  mei_cnpj: z.preprocess(emptyToNull, z.union([z.string().length(14), z.null()]).optional()),
  has_digital_certificate: z.boolean().default(false),
  digital_certificate_expires_at: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  is_leader: z.boolean().default(false),
  leader_role: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  leader_notes: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  pix_key: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  notes: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
});

const pharmacyImportRowSchema = z.object({
  legal_name: z.string().min(2),
  trade_name: z.string().min(2),
  cnpj: z.preprocess(emptyToNull, z.union([z.string().length(14), z.null()]).optional()),
  address_cep: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  address_street: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  address_number: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  address_neighborhood: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  address_complement: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  city: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  state: z.preprocess(emptyToNull, z.union([z.string().max(2), z.null()]).optional()),
  phone: z.preprocess(emptyToNull, z.union([z.string().min(12), z.null()]).optional()),
  email: z.preprocess(emptyToNull, z.union([z.string().email(), z.null()]).optional()),
  contact_expedition_name: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  contact_expedition_phone: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  contact_expedition_email: z.preprocess(emptyToNull, z.union([z.string().email(), z.null()]).optional()),
  contact_financial_name: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  contact_financial_phone: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  contact_financial_email: z.preprocess(emptyToNull, z.union([z.string().email(), z.null()]).optional()),
  contact_manager_name: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  contact_manager_phone: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  contact_manager_email: z.preprocess(emptyToNull, z.union([z.string().email(), z.null()]).optional()),
  leader_id: z.preprocess(emptyToNull, z.union([z.string().uuid(), z.null()]).optional()),
  status: z.enum(['active', 'inactive']),
  notes: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
});

export type DriverImportParsed = z.infer<typeof driverImportRowSchema> & { row: number };
export type PharmacyImportParsed = z.infer<typeof pharmacyImportRowSchema> & { row: number };

function cellText(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null && 'text' in v) return String((v as { text?: string }).text ?? '').trim();
  if (typeof v === 'object' && v !== null && 'result' in v) return String((v as { result?: unknown }).result ?? '').trim();
  return String(v).trim();
}

export async function buildDriverImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dados', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'name', key: 'name', width: 28 },
    { header: 'phone', key: 'phone', width: 18 },
    { header: 'cpf', key: 'cpf', width: 16 },
    { header: 'email', key: 'email', width: 28 },
    { header: 'state', key: 'state', width: 8 },
    { header: 'city', key: 'city', width: 18 },
    { header: 'status', key: 'status', width: 12 },
    { header: 'primary_pharmacy_id', key: 'primary_pharmacy_id', width: 38 },
    { header: 'is_mei', key: 'is_mei', width: 10 },
    { header: 'mei_cnpj', key: 'mei_cnpj', width: 18 },
    { header: 'has_digital_certificate', key: 'has_digital_certificate', width: 16 },
    { header: 'digital_certificate_expires_at', key: 'digital_certificate_expires_at', width: 20 },
    { header: 'is_leader', key: 'is_leader', width: 10 },
    { header: 'leader_role', key: 'leader_role', width: 18 },
    { header: 'leader_notes', key: 'leader_notes', width: 28 },
    { header: 'pix_key', key: 'pix_key', width: 24 },
    { header: 'notes', key: 'notes', width: 32 },
  ];
  ws.addRow({
    name: 'João Entregador Exemplo',
    phone: '(34) 99999-1000',
    cpf: '123.456.789-09',
    email: 'joao@exemplo.com.br',
    state: 'MG',
    city: 'Uberlândia',
    status: 'active',
    primary_pharmacy_id: '',
    is_mei: 'false',
    mei_cnpj: '',
    has_digital_certificate: 'false',
    digital_certificate_expires_at: '',
    is_leader: 'false',
    leader_role: '',
    leader_notes: '',
    pix_key: '',
    notes: 'Linha fictícia — apague antes de importar produção.',
  });
  const info = wb.addWorksheet('Instrucoes');
  info.getCell('A1').value =
    'Importação de entregadores — apenas administradores e supervisores.\n' +
    '- Colunas na aba Dados: use exatamente os cabeçalhos da linha 1.\n' +
    '- Telefone: DDD + número (com ou sem máscara). Será normalizado para formato internacional (55…).\n' +
    '- CPF: opcional; 11 dígitos. Linhas com CPF ou telefone já existentes serão ignoradas (não atualiza).\n' +
    '- status: active | inactive | blocked\n' +
    '- is_mei, has_digital_certificate e is_leader: true/false, sim/nao ou 1/0.\n' +
    '- digital_certificate_expires_at: formato ISO (yyyy-mm-dd) quando houver.\n' +
    '- primary_pharmacy_id: UUID da farmácia (opcional), vazio se não houver.\n' +
    `- Limite: ${IMPORT_MAX_ROWS} linhas de dados.`;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function buildPharmacyImportTemplate(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dados', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'legal_name', key: 'legal_name', width: 32 },
    { header: 'trade_name', key: 'trade_name', width: 28 },
    { header: 'cnpj', key: 'cnpj', width: 20 },
    { header: 'address_cep', key: 'address_cep', width: 14 },
    { header: 'address_street', key: 'address_street', width: 24 },
    { header: 'address_number', key: 'address_number', width: 10 },
    { header: 'address_neighborhood', key: 'address_neighborhood', width: 18 },
    { header: 'address_complement', key: 'address_complement', width: 18 },
    { header: 'city', key: 'city', width: 18 },
    { header: 'state', key: 'state', width: 8 },
    { header: 'phone', key: 'phone', width: 18 },
    { header: 'email', key: 'email', width: 28 },
    { header: 'contact_expedition_name', key: 'contact_expedition_name', width: 20 },
    { header: 'contact_expedition_phone', key: 'contact_expedition_phone', width: 18 },
    { header: 'contact_expedition_email', key: 'contact_expedition_email', width: 26 },
    { header: 'contact_financial_name', key: 'contact_financial_name', width: 20 },
    { header: 'contact_financial_phone', key: 'contact_financial_phone', width: 18 },
    { header: 'contact_financial_email', key: 'contact_financial_email', width: 26 },
    { header: 'contact_manager_name', key: 'contact_manager_name', width: 20 },
    { header: 'contact_manager_phone', key: 'contact_manager_phone', width: 18 },
    { header: 'contact_manager_email', key: 'contact_manager_email', width: 26 },
    { header: 'leader_id', key: 'leader_id', width: 38 },
    { header: 'status', key: 'status', width: 12 },
    { header: 'notes', key: 'notes', width: 32 },
  ];
  ws.addRow({
    legal_name: 'Farmácia Exemplo LTDA',
    trade_name: 'Farmácia Centro',
    cnpj: '12.345.678/0001-90',
    address_cep: '38400-100',
    address_street: 'Av. Afonso Pena',
    address_number: '123',
    address_neighborhood: 'Centro',
    address_complement: 'Sala 2',
    city: 'Uberlândia',
    state: 'MG',
    phone: '(34) 3333-4444',
    email: 'contato@exemplo.com.br',
    contact_expedition_name: 'Maria Expedição',
    contact_expedition_phone: '(34) 99999-1001',
    contact_expedition_email: 'expedicao@exemplo.com.br',
    contact_financial_name: 'Paulo Financeiro',
    contact_financial_phone: '(34) 99999-1002',
    contact_financial_email: 'financeiro@exemplo.com.br',
    contact_manager_name: 'Ana Gestora',
    contact_manager_phone: '(34) 99999-1003',
    contact_manager_email: 'gestora@exemplo.com.br',
    leader_id: '',
    status: 'active',
    notes: 'Linha fictícia — apague antes de importar produção.',
  });
  const info = wb.addWorksheet('Instrucoes');
  info.getCell('A1').value =
    'Importação de farmácias — apenas administradores e supervisores.\n' +
    '- Colunas na aba Dados: use exatamente os cabeçalhos da linha 1.\n' +
    '- CNPJ: 14 dígitos (com ou sem máscara). Se o CNPJ já existir, a linha será ignorada (não atualiza).\n' +
    '- Telefones (geral e contatos) aceitam com/sem máscara e serão normalizados para 55 + DDD + número.\n' +
    '- status: active | inactive\n' +
    `- Limite: ${IMPORT_MAX_ROWS} linhas de dados.`;

  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function parseDriverImportWorkbook(buffer: Buffer | Uint8Array): Promise<{
  rows: DriverImportParsed[];
  errors: Array<{ row: number; message: string }>;
}> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings expect Node Buffer shape; Buffer.from normalizes Uint8Array.
  await wb.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet('Dados') || wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: 0, message: 'Planilha vazia' }] };

  const errors: Array<{ row: number; message: string }> = [];
  const rows: DriverImportParsed[] = [];
  let dataRows = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    dataRows += 1;
    if (dataRows > IMPORT_MAX_ROWS) {
      errors.push({ row: rowNumber, message: `Limite de ${IMPORT_MAX_ROWS} linhas excedido` });
      return false;
    }
    const name = cellText(row, 1);
    const phoneRaw = cellText(row, 2);
    const cpfRaw = cellText(row, 3);
    const email = cellText(row, 4) || null;
    const state = cellText(row, 5) || null;
    const city = cellText(row, 6) || null;
    const statusRaw = (cellText(row, 7) || 'active').toLowerCase();
    const primaryId = cellText(row, 8).trim() || null;
    const isMei = parseBool(cellText(row, 9), false);
    const meiCnpjRaw = cellText(row, 10);
    const hasCert = parseBool(cellText(row, 11), false);
    const certExpiresAt = cellText(row, 12) || null;
    const isLeader = parseBool(cellText(row, 13), false);
    const leaderRole = cellText(row, 14) || null;
    const leaderNotes = cellText(row, 15) || null;
    const pixKey = cellText(row, 16) || null;
    const notes = cellText(row, 17) || null;

    if (!name && !phoneRaw) return;

    const phone = normalizeBrazilPhone(phoneRaw);
    const cpfNorm = cpfRaw ? normalizeCpf(cpfRaw) : '';
    const cpf = cpfNorm || null;
    const meiCnpjNorm = meiCnpjRaw ? normalizeCnpj(meiCnpjRaw) : '';

    const statusNorm =
      statusRaw === 'inactive' || statusRaw === 'blocked' || statusRaw === 'active' ? statusRaw : null;
    if (!statusNorm) {
      errors.push({ row: rowNumber, message: 'status inválido (use active, inactive ou blocked)' });
      return;
    }

    const parsed = driverImportRowSchema.safeParse({
      name,
      phone,
      cpf,
      email: email || null,
      city,
      state: state ? state.toUpperCase() : null,
      status: statusNorm,
      primary_pharmacy_id: primaryId,
      is_mei: isMei,
      mei_cnpj: meiCnpjNorm || null,
      has_digital_certificate: hasCert,
      digital_certificate_expires_at: certExpiresAt,
      is_leader: isLeader,
      leader_role: leaderRole,
      leader_notes: leaderNotes,
      pix_key: pixKey,
      notes,
    });

    if (!parsed.success) {
      errors.push({ row: rowNumber, message: parsed.error.issues.map((e) => e.message).join('; ') });
      return;
    }
    rows.push({ ...parsed.data, row: rowNumber });
  });

  return { rows, errors };
}

export async function parsePharmacyImportWorkbook(buffer: Buffer | Uint8Array): Promise<{
  rows: PharmacyImportParsed[];
  errors: Array<{ row: number; message: string }>;
}> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings expect Node Buffer shape; Buffer.from normalizes Uint8Array.
  await wb.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet('Dados') || wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: 0, message: 'Planilha vazia' }] };

  const errors: Array<{ row: number; message: string }> = [];
  const rows: PharmacyImportParsed[] = [];
  let dataRows = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    dataRows += 1;
    if (dataRows > IMPORT_MAX_ROWS) {
      errors.push({ row: rowNumber, message: `Limite de ${IMPORT_MAX_ROWS} linhas excedido` });
      return false;
    }
    const legal_name = cellText(row, 1);
    const trade_name = cellText(row, 2);
    const cnpjRaw = cellText(row, 3);
    const address_cep = cellText(row, 4) || null;
    const address_street = cellText(row, 5) || null;
    const address_number = cellText(row, 6) || null;
    const address_neighborhood = cellText(row, 7) || null;
    const address_complement = cellText(row, 8) || null;
    const city = cellText(row, 9) || null;
    const state = cellText(row, 10) || null;
    const phoneRaw = cellText(row, 11);
    const email = cellText(row, 12) || null;
    const contact_expedition_name = cellText(row, 13) || null;
    const contact_expedition_phone = normalizeBrazilPhone(cellText(row, 14) || '') || null;
    const contact_expedition_email = cellText(row, 15) || null;
    const contact_financial_name = cellText(row, 16) || null;
    const contact_financial_phone = normalizeBrazilPhone(cellText(row, 17) || '') || null;
    const contact_financial_email = cellText(row, 18) || null;
    const contact_manager_name = cellText(row, 19) || null;
    const contact_manager_phone = normalizeBrazilPhone(cellText(row, 20) || '') || null;
    const contact_manager_email = cellText(row, 21) || null;
    const leader_id = cellText(row, 22) || null;
    const statusRaw = (cellText(row, 23) || 'active').toLowerCase();
    const notes = cellText(row, 24) || null;

    if (!legal_name && !trade_name) return;

    const cnpjNorm = cnpjRaw ? normalizeCnpj(cnpjRaw) : '';
    const cnpj = cnpjNorm || null;
    const phoneNorm = phoneRaw ? normalizeBrazilPhone(phoneRaw) : '';
    const phone = phoneNorm || null;

    const statusNorm = statusRaw === 'inactive' || statusRaw === 'active' ? statusRaw : null;
    if (!statusNorm) {
      errors.push({ row: rowNumber, message: 'status inválido (use active ou inactive)' });
      return;
    }

    const parsed = pharmacyImportRowSchema.safeParse({
      legal_name,
      trade_name,
      cnpj,
      address_cep,
      address_street,
      address_number,
      address_neighborhood,
      address_complement,
      city,
      state: state ? state.toUpperCase() : null,
      phone,
      email: email || null,
      contact_expedition_name,
      contact_expedition_phone,
      contact_expedition_email,
      contact_financial_name,
      contact_financial_phone,
      contact_financial_email,
      contact_manager_name,
      contact_manager_phone,
      contact_manager_email,
      leader_id,
      status: statusNorm,
      notes,
    });

    if (!parsed.success) {
      errors.push({ row: rowNumber, message: parsed.error.issues.map((e) => e.message).join('; ') });
      return;
    }
    rows.push({ ...parsed.data, row: rowNumber });
  });

  return { rows, errors };
}
