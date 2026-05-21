/**
 * Catálogo dinâmico de tipos de lançamento financeiro.
 * Persistido em `app_settings.financial_entry_types` (chave permitida pelo prefixo `financial_*`).
 *
 * Defaults intencionalmente NÃO incluem `fine` (multa) e `adjustment` (ajuste) — esses tipos
 * só são exibidos se o tenant os tiver explicitamente ativos no catálogo (compat com registros antigos).
 */

import { supabase } from './supabase';

export type AffectsNet = 'discount' | 'daily' | 'ignore';

export interface FinancialEntryType {
  slug: string;
  label: string;
  active: boolean;
  is_system: boolean;
  affects_net: AffectsNet;
  created_at: string;
}

export const DEFAULT_ENTRY_TYPES: FinancialEntryType[] = [
  { slug: 'daily',        label: 'Diária',              active: true, is_system: true, affects_net: 'daily',    created_at: '1970-01-01T00:00:00.000Z' },
  { slug: 'advance',      label: 'Adiantamento',        active: true, is_system: true, affects_net: 'discount', created_at: '1970-01-01T00:00:00.000Z' },
  { slug: 'absence',      label: 'Falta',               active: true, is_system: true, affects_net: 'discount', created_at: '1970-01-01T00:00:00.000Z' },
  { slug: 'uniform',      label: 'Uniforme',            active: true, is_system: true, affects_net: 'discount', created_at: '1970-01-01T00:00:00.000Z' },
  { slug: 'bag',          label: 'Bag',                 active: true, is_system: true, affects_net: 'discount', created_at: '1970-01-01T00:00:00.000Z' },
  { slug: 'quota',        label: 'Cota',                active: true, is_system: true, affects_net: 'discount', created_at: '1970-01-01T00:00:00.000Z' },
  { slug: 'digital_cert', label: 'Certificado digital', active: true, is_system: true, affects_net: 'discount', created_at: '1970-01-01T00:00:00.000Z' },
  { slug: 'other',        label: 'Outros',              active: true, is_system: true, affects_net: 'discount', created_at: '1970-01-01T00:00:00.000Z' },
];

const SLUG_REGEX = /^[a-z][a-z0-9_]{0,30}$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug);
}

/** Mescla defaults com o que estiver persistido (preservando overrides do tenant). */
export function mergeEntryTypesFromJson(raw: unknown): FinancialEntryType[] {
  const bySlug = new Map<string, FinancialEntryType>();
  for (const t of DEFAULT_ENTRY_TYPES) bySlug.set(t.slug, { ...t });

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    const list = Array.isArray(obj.types) ? obj.types : Array.isArray(raw) ? (raw as unknown[]) : null;
    if (Array.isArray(list)) {
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const t = item as Partial<FinancialEntryType>;
        if (typeof t.slug !== 'string' || !isValidSlug(t.slug)) continue;
        const existing = bySlug.get(t.slug);
        const affects: AffectsNet = (t.affects_net === 'daily' || t.affects_net === 'discount' || t.affects_net === 'ignore')
          ? t.affects_net
          : (existing?.affects_net ?? 'discount');
        bySlug.set(t.slug, {
          slug: t.slug,
          label: typeof t.label === 'string' && t.label.trim() ? t.label.trim() : (existing?.label ?? t.slug),
          active: typeof t.active === 'boolean' ? t.active : (existing?.active ?? true),
          is_system: existing?.is_system ?? Boolean(t.is_system),
          affects_net: affects,
          created_at: existing?.created_at ?? (typeof t.created_at === 'string' ? t.created_at : new Date().toISOString()),
        });
      }
    }
  }

  return Array.from(bySlug.values()).sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export async function loadEntryTypes(): Promise<FinancialEntryType[]> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'financial_entry_types')
    .maybeSingle();
  return mergeEntryTypesFromJson(data?.value ?? null);
}

export async function saveEntryTypes(types: FinancialEntryType[]): Promise<FinancialEntryType[]> {
  const merged = mergeEntryTypesFromJson({ types });
  const { error } = await supabase
    .from('app_settings')
    .upsert({
      key: 'financial_entry_types',
      value: { types: merged },
      updated_at: new Date().toISOString(),
    });
  if (error) throw error;
  return merged;
}
