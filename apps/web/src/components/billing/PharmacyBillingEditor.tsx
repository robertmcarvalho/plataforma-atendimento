'use client';

import { CadastroField, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { FormSelect } from '@/components/form/FormSelect';
import { FormControl } from '@/components/form/FormControl';
import { BrCentsInput } from '@/components/form/BrCentsInput';
import { Switch } from '@/components/ui/Switch';
import type { PharmacyBillingForm } from '@/lib/billing/billingApi';

type Props = {
  value: PharmacyBillingForm;
  onChange: (next: PharmacyBillingForm) => void;
  disabled?: boolean;
};

export function PharmacyBillingEditor({ value, onChange, disabled }: Props) {
  const set = <K extends keyof PharmacyBillingForm>(k: K, v: PharmacyBillingForm[K]) =>
    onChange({ ...value, [k]: v });

  const showSplit = value.contract_scope === 'both';

  return (
    <CadastroSection title="Faturamento" desc="Contrato, e-mail de cobrança, integração Flux, MG e diárias automáticas.">
      <div className="grid gap-4 md:grid-cols-2">
        <CadastroField label="Escopo do contrato">
          <FormSelect
            disabled={disabled}
            value={value.contract_scope}
            onChange={(v) => set('contract_scope', v as PharmacyBillingForm['contract_scope'])}
            options={[
              { value: 'both', label: 'CoopMob + Flux Farma' },
              { value: 'coop_only', label: 'Somente CoopMob' },
              { value: 'flux_only', label: 'Somente Flux Farma' },
            ]}
          />
        </CadastroField>
        <CadastroField label="E-mail de faturamento">
          <FormControl
            type="email"
            disabled={disabled}
            value={value.billing_email}
            onChange={(e) => set('billing_email', e.target.value)}
            placeholder="financeiro@farmacia.com.br"
          />
        </CadastroField>
        {showSplit && (
          <>
            <CadastroField label="Split Coop (%) — override farmácia">
              <FormControl
                type="number"
                disabled={disabled}
                value={value.split_coop_pct ?? ''}
                onChange={(e) => set('split_coop_pct', e.target.value === '' ? null : Number(e.target.value))}
              />
            </CadastroField>
            <CadastroField label="Split Flux (%) — override farmácia">
              <FormControl
                type="number"
                disabled={disabled}
                value={value.split_flux_pct ?? ''}
                onChange={(e) => set('split_flux_pct', e.target.value === '' ? null : Number(e.target.value))}
              />
            </CadastroField>
          </>
        )}
        <CadastroField label="Mínimo de entregas (override MG)">
          <FormControl
            type="number"
            disabled={disabled}
            value={value.minimum_deliveries_count ?? ''}
            onChange={(e) =>
              set('minimum_deliveries_count', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </CadastroField>
        <CadastroField label="Cód. Flux (CodPes / CodLoc)">
          <div className="grid grid-cols-2 gap-2">
            <FormControl
              type="number"
              disabled={disabled}
              placeholder="CodPes"
              value={value.flux_codpes ?? ''}
              onChange={(e) => set('flux_codpes', e.target.value === '' ? null : Number(e.target.value))}
            />
            <FormControl
              type="number"
              disabled={disabled}
              placeholder="CodLoc"
              value={value.flux_codloc ?? ''}
              onChange={(e) => set('flux_codloc', e.target.value === '' ? null : Number(e.target.value))}
            />
          </div>
        </CadastroField>
        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 md:col-span-2">
          <span className="text-sm">Mínimo garantido (MG) ativo nesta farmácia</span>
          <Switch checked={value.mg_enabled} onCheckedChange={(v) => set('mg_enabled', v)} disabled={disabled} />
        </label>
        {value.mg_enabled ? (
          <>
            <CadastroField label="Modo MG">
              <FormSelect
                disabled={disabled}
                value={value.mg_mode}
                onChange={(v) => set('mg_mode', v as PharmacyBillingForm['mg_mode'])}
                options={[
                  { value: 'per_driver', label: 'Por entregador' },
                  { value: 'shared_pool', label: 'Pool compartilhado (1× MG/ciclo)' },
                ]}
              />
            </CadastroField>
            {value.mg_mode === 'shared_pool' ? (
              <CadastroField label="Rateio do pool">
                <FormSelect
                  disabled={disabled}
                  value={value.mg_pool_split_rule}
                  onChange={(v) => set('mg_pool_split_rule', v as PharmacyBillingForm['mg_pool_split_rule'])}
                  options={[
                    { value: 'by_deliveries', label: 'Proporcional às entregas' },
                    { value: 'equal', label: 'Igual entre entregadores' },
                  ]}
                />
              </CadastroField>
            ) : null}
          </>
        ) : null}
        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 md:col-span-2">
          <span>
            <span className="block text-sm">Cobrar diária configurada</span>
            <span className="block text-xs text-muted-foreground">
              Define valores da diária. Rateio entre lojas é configurado em Grupos de Rateio de Diárias.
            </span>
          </span>
          <Switch
            checked={value.daily_billing_enabled}
            onCheckedChange={(v) => set('daily_billing_enabled', v)}
            disabled={disabled}
          />
        </label>
        {value.daily_billing_enabled ? (
          <>
            <CadastroField label="Regra da cobrança">
              <FormSelect
                disabled={disabled}
                value={value.daily_billing_rule}
                onChange={(v) => set('daily_billing_rule', v as PharmacyBillingForm['daily_billing_rule'])}
                options={[
                  { value: 'per_driver_delivery_day', label: 'Por diária lançada no Financeiro' },
                  { value: 'fixed_per_driver_cycle', label: 'Quantidade contratada no ciclo' },
                ]}
              />
            </CadastroField>
            {value.daily_billing_rule === 'fixed_per_driver_cycle' ? (
              <CadastroField label="Qtd. diárias contratadas no ciclo">
                <FormControl
                  type="number"
                  min={0}
                  disabled={disabled}
                  value={value.daily_billing_quantity ?? ''}
                  onChange={(e) => set('daily_billing_quantity', e.target.value === '' ? null : Number(e.target.value))}
                />
              </CadastroField>
            ) : null}
            <CadastroField label="Valor cobrado da farmácia por diária (R$)">
              <BrCentsInput
                disabled={disabled}
                value={value.daily_billing_pharmacy_amount_cents}
                onChange={(cents) => set('daily_billing_pharmacy_amount_cents', cents)}
              />
            </CadastroField>
            <CadastroField label="Repasse ao entregador por diária (R$)">
              <BrCentsInput
                disabled={disabled}
                value={value.daily_billing_driver_payout_cents}
                onChange={(cents) => set('daily_billing_driver_payout_cents', cents)}
              />
            </CadastroField>
          </>
        ) : null}
        <label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 md:col-span-2">
          <span>
            <span className="block text-sm">Diária-base na escala (acerto de quinta)</span>
            <span className="block text-xs text-muted-foreground">
              Cobrança da farmácia por dia confirmado no acerto. O repasse ao entregador pode ser ajustado no acerto e
              sai no PIX de quinta, junto das entregas. Coexiste com a diária contratada; não entra no PIX de terça.
            </span>
          </span>
          <Switch
            checked={value.driver_day_base_enabled}
            onCheckedChange={(v) => set('driver_day_base_enabled', v)}
            disabled={disabled}
          />
        </label>
        {value.driver_day_base_enabled ? (
          <CadastroField label="Valor cobrado da farmácia por diária-base (R$)">
            <BrCentsInput
              disabled={disabled}
              value={value.driver_day_base_cents}
              onChange={(cents) => set('driver_day_base_cents', cents ?? 7000)}
            />
          </CadastroField>
        ) : null}
      </div>
    </CadastroSection>
  );
}
