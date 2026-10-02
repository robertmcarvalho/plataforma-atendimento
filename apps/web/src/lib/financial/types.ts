import type { DiscountRule } from '@/lib/financialCycle';
import type {
  FinancialEntryStatusValue,
  OccurrenceKindValue,
} from '@plataforma/operational-notes';

export type EntryStatus = FinancialEntryStatusValue;
export type InstallmentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';
export type CoverageEntryRef = {
  id: string;
  type?: string;
  occurrence_kind?: string | null;
  event_date?: string | null;
  status?: string;
  total_amount?: number;
  notes?: string | null;
  absence_disposition?: string | null;
  proposed_discount_amount?: number | null;
  drivers?: { id: string; name: string } | null;
};
export interface ApiEntry {
  id: string;
  type: string;
  description: string | null;
  total_amount: number;
  installments_count: number;
  installment_amount: number;
  frequency: string;
  start_date: string;
  status: EntryStatus;
  notes?: string | null;
  event_date?: string | null;
  occurrence_kind?: OccurrenceKindValue | null;
  absence_disposition?: 'pending' | 'discounted' | 'excused' | null;
  proposed_discount_amount?: number | null;
  disposition_notes?: string | null;
  coverage_of_entry_id?: string | null;
  coverage_of_entry?: CoverageEntryRef | null;
  coverage_dailies?: CoverageEntryRef[] | null;
  daily_billing_treatment?: 'charge_pharmacy' | 'absorb_operation' | 'pending_audit' | null;
  daily_pharmacy_charge_amount?: number | null;
  daily_billing_notes?: string | null;
  daily_billing_decided_at?: string | null;
  apuracao_start?: string | null;
  apuracao_end?: string | null;
  created_at: string;
  updated_at?: string;
  approved_at?: string | null;
  rejection_reason?: string | null;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  drivers?: { id: string; name: string; cpf: string; phone: string; pix_key?: string } | null;
  pharmacies?: {
    id: string;
    trade_name: string;
    leader_id?: string | null;
    daily_billing_enabled?: boolean | null;
    daily_billing_rule?: 'per_driver_delivery_day' | 'fixed_per_driver_cycle' | null;
    daily_billing_quantity?: number | null;
    daily_billing_pharmacy_amount_cents?: number | null;
    daily_billing_driver_payout_cents?: number | null;
  } | null;
  pharmacy_id?: string | null;
  created_by_user?: { id: string; name: string; role: string };
  approved_by_user?: { id: string; name: string } | null;
  cancelled_by_user?: { id: string; name: string; role?: string } | null;
  financial_installments?: Array<{
    id: string;
    installment_number: number;
    amount: number;
    due_date: string;
    status: InstallmentStatus;
    paid_at: string | null;
  }>;
}
export interface FinancialEntryTypeMeta {
  slug: string;
  label: string;
  active: boolean;
  is_system: boolean;
  affects_net: 'discount' | 'daily' | 'ignore';
}
export interface EntryTypesCtx {
  types: FinancialEntryTypeMeta[];
  labels: Record<string, string>;
}
export type InstallmentSettlementFilter = 'all' | 'pending' | 'paid' | 'discounted';
export type PharmacyOption = {
  id: string;
  trade_name: string;
  leader?: { id: string; name: string } | null;
  leader_id?: string | null;
};

export type DriverOption = {
  id: string;
  name: string;
  cpf: string;
  primary_pharmacy_id?: string | null;
  driver_pharmacy_links?: Array<{ is_active?: boolean; pharmacies?: { id: string } | null }>;
};
