'use client';

import { useMemo, useState } from 'react';
import { BrCepInput, BrCnpjInput } from '@/components/form/BrInputs';
import { BrCentsInput } from '@/components/form/BrCentsInput';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { CadastroField, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { PharmacyCommercialTermsFields } from '@/components/cadastro/pharmacy/PharmacyCommercialTermsFields';
import { PharmacyDeliveryScheduleSection } from '@/components/cadastro/pharmacy/PharmacyDeliveryScheduleSection';
import {
  commercialReviveOutlineButtonClassName,
  commercialRevivePrimaryButtonClassName,
  commercialReviveSectionClassName,
} from '@/components/commercial/CommercialRevivePrimitives';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { onlyDigits } from '@/lib/brFormat';
import { fetchPublicCep } from '@/lib/commercial/commercialPublicApi';
import type { ContractOnboardingPatch } from '@/lib/commercial/commercialApi';
import { usePatchLeadContractOnboarding } from '@/lib/commercial/useCommercialQueries';
import type { PharmacyCommercialForm } from '@/lib/pharmacyCommercial';
import {
  deliveryScheduleFromLeadCustomFields,
  parsePharmacyDeliveryScheduleForEdit,
  serializePharmacyDeliveryScheduleForApi,
} from '@/lib/pharmacyDeliverySchedule';
import { hasSubmittedContractForm } from '@/lib/commercial/contractOnboardingDisplay';
import type { CommercialLead } from '@/lib/commercial/types';

type Props = {
  lead: CommercialLead;
};

export function CommercialContractSellerForm({ lead }: Props) {
  const patchMut = usePatchLeadContractOnboarding();
  const seller = lead.contract_onboarding?.seller;

  const [legalName, setLegalName] = useState(lead.legal_name || seller?.legal_name || '');
  const [tradeName, setTradeName] = useState(lead.trade_name || seller?.trade_name || '');
  const cnpjRef = lead.cnpj || '';
  const [commercial, setCommercial] = useState<PharmacyCommercialForm>({
    delivery_fee_cents: seller?.delivery_fee_cents ?? null,
    delivery_fee_driver_payout_cents: seller?.delivery_fee_driver_payout_cents ?? null,
    minimum_guaranteed_cents: seller?.minimum_guaranteed_cents ?? null,
    minimum_guaranteed_driver_payout_cents: seller?.minimum_guaranteed_driver_payout_cents ?? null,
  });
  const [setupCents, setSetupCents] = useState<number | null>(seller?.setup_cents ?? null);
  const [setupParcelado, setSetupParcelado] = useState(Boolean(seller?.setup_parcelado));
  const [setupParcelas, setSetupParcelas] = useState(String(seller?.setup_parcelas ?? ''));
  const [driversCount, setDriversCount] = useState(String(seller?.drivers_count ?? lead.drivers_count ?? ''));
  const [deliverySchedule, setDeliverySchedule] = useState<Record<string, unknown>>(() =>
    parsePharmacyDeliveryScheduleForEdit(
      seller?.delivery_schedule || deliveryScheduleFromLeadCustomFields(lead.custom_fields),
    ),
  );
  const deliveryHoursPrefilledFromLead =
    !seller?.delivery_schedule && lead.custom_fields?.delivery_hours_informed === true;
  const [pickupCep, setPickupCep] = useState(seller?.pickup_address_cep || lead.address_cep || '');
  const [pickupStreet, setPickupStreet] = useState(seller?.pickup_address_street || lead.address_street || '');
  const [pickupNumber, setPickupNumber] = useState(seller?.pickup_address_number || lead.address_number || '');
  const [pickupNeighborhood, setPickupNeighborhood] = useState(
    seller?.pickup_address_neighborhood || lead.address_neighborhood || '',
  );
  const [pickupComplement, setPickupComplement] = useState(seller?.pickup_address_complement || lead.address_complement || '');
  const [pickupCity, setPickupCity] = useState(seller?.pickup_city || lead.city || '');
  const [pickupState, setPickupState] = useState(seller?.pickup_state || lead.state || 'MG');
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const sellerChecklist = lead.seller_contract_checklist;
  const complete = lead.contract_onboarding_complete;

  const body = useMemo((): ContractOnboardingPatch => {
    let schedule: Record<string, unknown> | undefined;
    try {
      schedule = serializePharmacyDeliveryScheduleForApi(deliverySchedule);
    } catch {
      schedule = deliverySchedule;
    }
    return {
      legal_name: legalName.trim(),
      trade_name: tradeName.trim(),
      ...commercial,
      setup_cents: setupCents,
      setup_parcelado: setupParcelado,
      setup_parcelas: setupParcelado ? Number(setupParcelas) || null : null,
      drivers_count: driversCount ? Number(driversCount) : null,
      delivery_schedule: schedule,
      pickup_address_cep: onlyDigits(pickupCep),
      pickup_address_street: pickupStreet.trim(),
      pickup_address_number: pickupNumber.trim(),
      pickup_address_neighborhood: pickupNeighborhood.trim(),
      pickup_address_complement: pickupComplement.trim() || undefined,
      pickup_city: pickupCity.trim(),
      pickup_state: pickupState.trim().toUpperCase().slice(0, 2),
    };
  }, [
    legalName,
    tradeName,
    commercial,
    setupCents,
    setupParcelado,
    setupParcelas,
    driversCount,
    deliverySchedule,
    pickupCep,
    pickupStreet,
    pickupNumber,
    pickupNeighborhood,
    pickupComplement,
    pickupCity,
    pickupState,
  ]);

  const lookupPickupCep = async () => {
    const digits = onlyDigits(pickupCep);
    if (digits.length !== 8) return;
    const data = await fetchPublicCep(digits);
    if (data.not_found) return;
    if (data.street) setPickupStreet(data.street);
    if (data.neighborhood) setPickupNeighborhood(data.neighborhood);
    if (data.city) setPickupCity(data.city);
    if (data.state) setPickupState(data.state);
  };

  const handleSave = async () => {
    setErr(null);
    setSavedMsg(null);
    try {
      await patchMut.mutateAsync({ leadId: lead.id, body });
      setSavedMsg('Dados salvos.');
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setErr(apiErrorMessage(e));
    }
  };

  const awaitingPublicFormOnly =
    lead.contract_onboarding?.status === 'awaiting_lead' &&
    !hasSubmittedContractForm(lead) &&
    !lead.contract_checklist?.complete;

  if (awaitingPublicFormOnly) {
    return (
      <p className="text-xs text-muted-foreground">
        Aguardando o lead preencher o formulário público. Gere e envie o link acima.
      </p>
    );
  }

  return (
    <section className={commercialReviveSectionClassName}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Complemento do vendedor</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Consulte o CNPJ informado pelo lead e registre razão social e nome fantasia. Preencha condições
            comerciais, coleta e horários de delivery.
          </p>
        </div>
        {complete ? (
          <span className="rounded-md bg-success/15 px-2 py-1 text-xs font-medium text-success">Completo</span>
        ) : sellerChecklist ? (
          <span className="rounded-md bg-warning/15 px-2 py-1 text-xs font-medium text-warning">
            {sellerChecklist.percent}% do vendedor
          </span>
        ) : null}
      </div>

      <div className="space-y-5">
        <CadastroSection title="Cadastro (após consulta CNPJ)">
          <CadastroField label="CNPJ informado pelo lead">
            <BrCnpjInput value={cnpjRef} onChange={() => {}} disabled className="font-mono opacity-80" />
          </CadastroField>
          <CadastroField label="Razão social" required>
            <FormControl required value={legalName} onChange={(e) => setLegalName(e.target.value)} />
          </CadastroField>
          <CadastroField label="Nome fantasia" required>
            <FormControl required value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
          </CadastroField>
        </CadastroSection>

        <CadastroSection title="Condições financeiras">
          <PharmacyCommercialTermsFields value={commercial} onChange={setCommercial} />
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <CadastroField label="Valor setup" required>
              <BrCentsInput value={setupCents} onChange={setSetupCents} />
            </CadastroField>
            <CadastroField label="Qtd. entregadores" required>
              <FormControl
                type="number"
                min={1}
                value={driversCount}
                onChange={(e) => setDriversCount(e.target.value)}
              />
            </CadastroField>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={setupParcelado}
              onChange={(e) => setSetupParcelado(e.target.checked)}
            />
            Setup parcelado
          </label>
          {setupParcelado ? (
            <div className="mt-3 max-w-xs">
              <CadastroField label="Parcelas" required>
                <FormControl
                  type="number"
                  min={2}
                  max={48}
                  value={setupParcelas}
                  onChange={(e) => setSetupParcelas(e.target.value)}
                />
              </CadastroField>
            </div>
          ) : null}
        </CadastroSection>

        <CadastroSection title="Endereço de coleta">
          <CadastroField label="CEP" required>
            <div className="flex gap-2">
              <BrCepInput value={pickupCep} onChange={setPickupCep} required className="flex-1" />
              <button type="button" onClick={() => void lookupPickupCep()} className={commercialReviveOutlineButtonClassName}>
                Buscar
              </button>
            </div>
          </CadastroField>
          <CadastroField label="Logradouro" required>
            <FormControl required value={pickupStreet} onChange={(e) => setPickupStreet(e.target.value)} />
          </CadastroField>
          <div className="grid gap-4 sm:grid-cols-2">
            <CadastroField label="Número" required>
              <FormControl required value={pickupNumber} onChange={(e) => setPickupNumber(e.target.value)} />
            </CadastroField>
            <CadastroField label="Bairro" required>
              <FormControl required value={pickupNeighborhood} onChange={(e) => setPickupNeighborhood(e.target.value)} />
            </CadastroField>
          </div>
          <CadastroField label="Complemento">
            <FormControl value={pickupComplement} onChange={(e) => setPickupComplement(e.target.value)} />
          </CadastroField>
          <div className="grid gap-4 sm:grid-cols-2">
            <CadastroField label="UF" required>
              <FormSelect
                value={pickupState}
                onChange={setPickupState}
                options={['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'].map((uf) => ({
                  value: uf,
                  label: uf,
                }))}
              />
            </CadastroField>
            <CadastroField label="Cidade" required>
              <FormControl required value={pickupCity} onChange={(e) => setPickupCity(e.target.value)} />
            </CadastroField>
          </div>
        </CadastroSection>

        <CadastroSection title="Horários de delivery">
          {deliveryHoursPrefilledFromLead ? (
            <p className="mb-3 text-xs text-muted-foreground">
              Horários carregados da ficha do lead. Confirme ou ajuste se necessário.
            </p>
          ) : null}
          <PharmacyDeliveryScheduleSection value={deliverySchedule} onChange={setDeliverySchedule} />
        </CadastroSection>

        {err ? <p className="text-xs text-destructive">{err}</p> : null}
        {savedMsg ? <p className="text-xs text-success">{savedMsg}</p> : null}

        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={patchMut.isPending}
          className={commercialRevivePrimaryButtonClassName}
        >
          {patchMut.isPending ? 'Salvando…' : 'Salvar complemento'}
        </button>
      </div>
    </section>
  );
}
