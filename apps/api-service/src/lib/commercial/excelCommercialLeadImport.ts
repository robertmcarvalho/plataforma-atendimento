import ExcelJS from 'exceljs';
import { z } from 'zod';
import { normalizeBrazilPhone, normalizeCnpj } from '../brCadastroNormalize';
import { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS } from '../excelCadastroImport';

export { IMPORT_MAX_BYTES, IMPORT_MAX_ROWS };

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const truthy = new Set(['1', 'true', 'sim', 'yes', 'y']);

function parseBool(input: string, fallback = false): boolean {
  const v = String(input || '').trim().toLowerCase();
  if (!v) return fallback;
  return truthy.has(v);
}

function parseTime(input: string): string | null {
  const v = String(input || '').trim();
  if (!v) return null;
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const leadSourceSchema = z.enum([
  'manual',
  'instagram',
  'indicacao',
  'whatsapp',
  'campanha',
  'referral',
  'other',
]);

const leadImportRowSchema = z.object({
  trade_name: z.string().min(1),
  phone: z.string().min(12),
  city: z.string().min(1),
  state: z.string().length(2).transform((v) => v.toUpperCase()),
  legal_name: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  cnpj: z.preprocess(emptyToNull, z.union([z.string().length(14), z.null()]).optional()),
  contact_name: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  contact_email: z.preprocess(emptyToNull, z.union([z.string().email(), z.null()]).optional()),
  contact_role: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  source: leadSourceSchema.default('manual'),
  campaign: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  monthly_deliveries: z.preprocess(
    emptyToNull,
    z.union([z.coerce.number().int().min(0), z.null()]).optional(),
  ),
  erp: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  notes: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  tags: z.array(z.string()).default([]),
  perfil_cidade: z.preprocess(
    emptyToNull,
    z.union([z.enum(['pequena', 'media', 'grande']), z.null()]).optional(),
  ),
  delivery_seg_sex: z.boolean().default(true),
  delivery_sabado: z.boolean().default(true),
  delivery_domingo: z.boolean().default(false),
  horario_seg_sex_inicio: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  horario_seg_sex_fim: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  horario_sabado_inicio: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  horario_sabado_fim: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  horario_domingo_inicio: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
  horario_domingo_fim: z.preprocess(emptyToNull, z.union([z.string(), z.null()]).optional()),
});

export type LeadImportParsed = z.infer<typeof leadImportRowSchema> & {
  row: number;
  custom_fields: Record<string, string | number | boolean>;
};

function cellText(row: ExcelJS.Row, col: number): string {
  const v = row.getCell(col).value;
  if (v === null || v === undefined) return '';
  if (typeof v === 'object' && v !== null && 'text' in v) return String((v as { text?: string }).text ?? '').trim();
  if (typeof v === 'object' && v !== null && 'result' in v) return String((v as { result?: unknown }).result ?? '').trim();
  return String(v).trim();
}

const LEAD_COLUMNS = [
  'trade_name',
  'phone',
  'city',
  'state',
  'legal_name',
  'cnpj',
  'contact_name',
  'contact_email',
  'contact_role',
  'source',
  'campaign',
  'monthly_deliveries',
  'erp',
  'notes',
  'tags',
  'perfil_cidade',
  'delivery_seg_sex',
  'delivery_sabado',
  'delivery_domingo',
  'horario_seg_sex_inicio',
  'horario_seg_sex_fim',
  'horario_sabado_inicio',
  'horario_sabado_fim',
  'horario_domingo_inicio',
  'horario_domingo_fim',
] as const;

export async function buildCommercialLeadImportTemplate(erpOptions: string[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Dados', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = LEAD_COLUMNS.map((key) => ({ header: key, key, width: key.length > 20 ? 22 : 16 }));
  ws.addRow({
    trade_name: 'Farmácia Exemplo',
    phone: '(34) 99999-2000',
    city: 'Uberlândia',
    state: 'MG',
    legal_name: 'Farmácia Exemplo LTDA',
    cnpj: '12.345.678/0001-90',
    contact_name: 'Maria Gestora',
    contact_email: 'maria@exemplo.com.br',
    contact_role: 'Gerente',
    source: 'manual',
    campaign: '',
    monthly_deliveries: 200,
    erp: erpOptions[0] ?? 'Trier',
    notes: 'Linha fictícia — apague antes de importar produção.',
    tags: 'prioridade,indicação',
    perfil_cidade: 'media',
    delivery_seg_sex: 'sim',
    delivery_sabado: 'sim',
    delivery_domingo: 'nao',
    horario_seg_sex_inicio: '08:00',
    horario_seg_sex_fim: '22:00',
    horario_sabado_inicio: '08:00',
    horario_sabado_fim: '14:00',
    horario_domingo_inicio: '',
    horario_domingo_fim: '',
  });
  const info = wb.addWorksheet('Instrucoes');
  info.getCell('A1').value =
    'Importação de leads comerciais — até 2000 linhas.\n\n' +
    'Obrigatórios: trade_name, phone, city, state (UF 2 letras).\n' +
    'Telefone: DDD + número. CNPJ opcional — duplicados no workspace são ignorados.\n' +
    'source: manual|instagram|indicacao|whatsapp|campanha|referral|other\n' +
    'perfil_cidade: pequena|media|grande\n' +
    'delivery_*: sim|nao|1|0\n' +
    'Horários: HH:MM (ex.: 08:00). Se informar horários válidos, a ficha fica pronta para viabilidade.\n' +
    `erp (opcional): ${erpOptions.join(', ') || 'cadastre em Configuração > ERPs'}\n` +
    'tags: separadas por vírgula.';
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}

export async function parseCommercialLeadImportWorkbook(
  buffer: Buffer,
  validErpNames: string[],
): Promise<{ rows: LeadImportParsed[]; errors: Array<{ row: number; message: string }> }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer) as unknown as ExcelJS.Buffer);
  const ws = wb.getWorksheet('Dados') ?? wb.worksheets[0];
  if (!ws) return { rows: [], errors: [{ row: 0, message: 'Planilha vazia ou aba Dados ausente.' }] };

  const erpLookup = new Map(validErpNames.map((n) => [n.toLowerCase(), n]));
  const rows: LeadImportParsed[] = [];
  const errors: Array<{ row: number; message: string }> = [];

  const lastRow = Math.min(ws.rowCount, IMPORT_MAX_ROWS + 1);
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    const tradeName = cellText(row, 1);
    const phoneRaw = cellText(row, 2);
    if (!tradeName && !phoneRaw) continue;

    const tagsRaw = cellText(row, 15);
    const tags = tagsRaw
      ? tagsRaw.split(',').map((t) => t.trim()).filter(Boolean)
      : [];

    const segSexIni = parseTime(cellText(row, 20));
    const segSexFim = parseTime(cellText(row, 21));
    const sabIni = parseTime(cellText(row, 22));
    const sabFim = parseTime(cellText(row, 23));
    const domIni = parseTime(cellText(row, 24));
    const domFim = parseTime(cellText(row, 25));

    let phone = phoneRaw;
    try {
      phone = normalizeBrazilPhone(phoneRaw);
    } catch {
      errors.push({ row: r, message: 'Telefone inválido' });
      continue;
    }

    let cnpj: string | null = null;
    const cnpjRaw = cellText(row, 6);
    if (cnpjRaw) {
      cnpj = normalizeCnpj(cnpjRaw);
      if (cnpj.length !== 14) {
        errors.push({ row: r, message: 'CNPJ inválido' });
        continue;
      }
    }

    const erpRaw = cellText(row, 13);
    let erp: string | null = null;
    if (erpRaw) {
      const matched = erpLookup.get(erpRaw.toLowerCase());
      if (!matched) {
        errors.push({
          row: r,
          message: `ERP inválido "${erpRaw}". Opções: ${validErpNames.join(', ') || 'nenhuma cadastrada'}`,
        });
        continue;
      }
      erp = matched;
    }

    const deliverySegSex = parseBool(cellText(row, 17), true);
    const deliverySabado = parseBool(cellText(row, 18), true);
    const deliveryDomingo = parseBool(cellText(row, 19), false);

    const raw = {
      trade_name: tradeName,
      phone,
      city: cellText(row, 3),
      state: cellText(row, 4),
      legal_name: cellText(row, 5) || null,
      cnpj,
      contact_name: cellText(row, 7) || null,
      contact_email: cellText(row, 8) || null,
      contact_role: cellText(row, 9) || null,
      source: cellText(row, 10) || 'manual',
      campaign: cellText(row, 11) || null,
      monthly_deliveries: cellText(row, 12) ? Number(cellText(row, 12)) : null,
      erp,
      notes: cellText(row, 14) || null,
      tags,
      perfil_cidade: cellText(row, 16) || null,
      delivery_seg_sex: deliverySegSex,
      delivery_sabado: deliverySabado,
      delivery_domingo: deliveryDomingo,
      horario_seg_sex_inicio: segSexIni,
      horario_seg_sex_fim: segSexFim,
      horario_sabado_inicio: sabIni,
      horario_sabado_fim: sabFim,
      horario_domingo_inicio: domIni,
      horario_domingo_fim: domFim,
    };

    const parsed = leadImportRowSchema.safeParse(raw);
    if (!parsed.success) {
      errors.push({ row: r, message: parsed.error.errors.map((e) => e.message).join('; ') });
      continue;
    }

    const custom_fields: Record<string, string | number | boolean> = {};
    if (parsed.data.perfil_cidade) custom_fields.perfil_cidade = parsed.data.perfil_cidade;
    custom_fields.delivery_seg_sex = parsed.data.delivery_seg_sex;
    custom_fields.delivery_sabado = parsed.data.delivery_sabado;
    custom_fields.delivery_domingo = parsed.data.delivery_domingo;
    if (segSexIni) custom_fields.horario_seg_sex_inicio = segSexIni;
    if (segSexFim) custom_fields.horario_seg_sex_fim = segSexFim;
    if (sabIni) custom_fields.horario_sabado_inicio = sabIni;
    if (sabFim) custom_fields.horario_sabado_fim = sabFim;
    if (domIni) custom_fields.horario_domingo_inicio = domIni;
    if (domFim) custom_fields.horario_domingo_fim = domFim;
    const hasHours =
      (deliverySegSex && segSexIni && segSexFim) ||
      (deliverySabado && sabIni && sabFim) ||
      (deliveryDomingo && domIni && domFim);
    if (hasHours) custom_fields.delivery_hours_informed = true;

    rows.push({ ...parsed.data, row: r, custom_fields });
  }

  return { rows, errors };
}
