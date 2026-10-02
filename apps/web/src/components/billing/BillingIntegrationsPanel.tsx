'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Link2, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { cn } from '@/lib/utils';
import { apiErrorMessage, apiErrorPayload } from '@/lib/apiErrorMessage';
import {
  fetchFluxIntegrationStatus,
  reconcileFluxMysql,
  syncFluxDeliveries,
  syncFluxPharmacies,
} from '@/lib/billing/billingApi';
import {
  addBillingDeliveryNotificationSafe,
  compactJsonDetail,
} from '@/lib/billing/billingDeliveryNotifications';

function summarizeForStorage(value: unknown) {
  if (value == null || typeof value !== 'object') return value;
  const obj = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(obj)
      .filter(([, v]) => v == null || ['string', 'number', 'boolean'].includes(typeof v))
      .slice(0, 24)
  );
}

function defaultRange() {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(end.getUTCDate() - 7);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export function BillingIntegrationsPanel() {
  const range = defaultRange();
  const [dataInicio, setDataInicio] = useState(range.start);
  const [dataFim, setDataFim] = useState(range.end);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const statusQuery = useQuery({
    queryKey: ['billing', 'integrations', 'flux-status'],
    queryFn: fetchFluxIntegrationStatus,
  });

  const pharmacyMut = useMutation({
    mutationFn: (dryRun: boolean) => syncFluxPharmacies({ dry_run: dryRun }),
    onSuccess: (data, dryRun) => {
      setLastResult(JSON.stringify(data.result, null, 2));
      addBillingDeliveryNotificationSafe({
        kind: 'info',
        source: 'flux_api',
        title: dryRun ? 'Simulação de farmácias Flux concluída' : 'Sincronização de farmácias Flux concluída',
        message:
          data.operator_message ||
          'A rotina de farmácias Flux terminou. Confira o relatório técnico para ver vínculos atualizados e pendências.',
        detail: compactJsonDetail(summarizeForStorage(data.result)),
      });
    },
    onError: (error) => {
      const payload = apiErrorPayload(error) as { operator_message?: string } | null;
      addBillingDeliveryNotificationSafe({
        kind: 'error',
        source: 'flux_api',
        title: 'Falha na sincronização de farmácias Flux',
        message: payload?.operator_message || apiErrorMessage(error, 'Não foi possível sincronizar as farmácias Flux.'),
        detail: compactJsonDetail(
          payload ? { operator_message: payload.operator_message } : { message: String(error) }
        ),
      });
    },
  });

  const deliveryMut = useMutation({
    mutationFn: (dryRun: boolean) => syncFluxDeliveries({ data_inicio: dataInicio, data_fim: dataFim, dry_run: dryRun }),
    onSuccess: (data, dryRun) => {
      setLastResult(JSON.stringify(data.result, null, 2));
      addBillingDeliveryNotificationSafe({
        kind: 'success',
        source: 'flux_api',
        title: dryRun ? 'Simulação de entregas Flux concluída' : 'Importação de entregas Flux concluída',
        message:
          data.operator_message ||
          'A rotina de entregas da API Flux terminou. Confira pendências de farmácia, entregador ou registros inválidos no retorno técnico.',
        detail: compactJsonDetail(summarizeForStorage(data.result)),
      });
    },
    onError: (error) => {
      const payload = apiErrorPayload(error) as { operator_message?: string } | null;
      addBillingDeliveryNotificationSafe({
        kind: 'error',
        source: 'flux_api',
        title: 'Falha na importação de entregas Flux',
        message: payload?.operator_message || apiErrorMessage(error, 'Não foi possível importar entregas da API Flux.'),
        detail: compactJsonDetail(
          payload ? { operator_message: payload.operator_message } : { message: String(error) }
        ),
      });
    },
  });

  const mysqlMut = useMutation({
    mutationFn: (importMissing: boolean) =>
      reconcileFluxMysql({ data_inicio: dataInicio, data_fim: dataFim, import_missing: importMissing }),
    onSuccess: (data, importMissing) => {
      setLastResult(JSON.stringify(data, null, 2));
      addBillingDeliveryNotificationSafe({
        kind: data.imported > 0 ? 'success' : 'info',
        source: 'flux_mysql',
        title: importMissing ? 'Reconciliação MySQL importou faltantes' : 'Reconciliação MySQL concluída',
        message:
          data.operator_message ||
          `A comparação MySQL terminou. ${data.imported || 0} entregas faltantes foram importadas para o financeiro.`,
        detail: compactJsonDetail({
          imported: data.imported,
          operator_message: data.operator_message,
          ...summarizeForStorage(data.report),
        }),
      });
    },
    onError: (error) => {
      const payload = apiErrorPayload(error) as { operator_message?: string } | null;
      const raw =
        payload?.operator_message || apiErrorMessage(error, 'Não foi possível reconciliar entregas do MySQL Flux.');
      const isStorageQuota = /setItem|QuotaExceeded|exceeded the quota|Storage/i.test(raw);
      addBillingDeliveryNotificationSafe({
        kind: isStorageQuota ? 'warning' : 'error',
        source: 'flux_mysql',
        title: isStorageQuota ? 'Aviso no histórico local' : 'Falha na reconciliação MySQL',
        message: isStorageQuota
          ? 'A reconciliação pode ter concluído, mas o navegador não conseguiu gravar o histórico local (Storage cheio). Atualize a lista de entregas para confirmar.'
          : raw,
        detail: isStorageQuota
          ? undefined
          : compactJsonDetail(payload ? { operator_message: payload.operator_message } : { message: String(error) }),
      });
    },
  });

  const status = statusQuery.data;

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatusCard label="API Flux" ok={Boolean(status?.flux_api_configured)} />
        <StatusCard label="MySQL Flux" ok={Boolean(status?.mysql_configured)} />
        <StatusCard label="App externo" ok={Boolean(status?.external_app_enabled)} />
        <StatusCard label="API skip" ok={!status?.flux_api_skipped} hint="FLUX_DELIVERY_SKIP" />
      </div>

      <BillingSection title="Mapeamento farmácias Flux" icon={Link2}>
        <p className="mb-3 text-xs text-muted-foreground">
          Vincula <code className="text-[10px]">flux_codpes</code> / <code className="text-[10px]">flux_codloc</code> por
          CNPJ via <code className="text-[10px]">obter-todos-farmacias</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => pharmacyMut.mutate(true)} disabled={pharmacyMut.isPending}>
            Simular
          </Button>
          <Button size="sm" onClick={() => pharmacyMut.mutate(false)} disabled={pharmacyMut.isPending}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Sincronizar
          </Button>
        </div>
      </BillingSection>

      <BillingSection title="Sync entregas API Flux" icon={RefreshCw}>
        <div className="mb-3 flex flex-wrap items-end gap-3">
          <BillingField label="De">
            <FormControl type="date" inputSize="sm" className="mt-1 w-36" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} />
          </BillingField>
          <BillingField label="Até">
            <FormControl type="date" inputSize="sm" className="mt-1 w-36" value={dataFim} onChange={(e) => setDataFim(e.target.value)} />
          </BillingField>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => deliveryMut.mutate(true)} disabled={deliveryMut.isPending}>
            Simular
          </Button>
          <Button size="sm" onClick={() => deliveryMut.mutate(false)} disabled={deliveryMut.isPending}>
            Importar entregas
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Cron diário no scheduler (<code className="text-[10px]">FLUX_DELIVERY_SYNC_CRON</code>, default 06:30).
        </p>
      </BillingSection>

      <BillingSection title="Reconciliação MySQL Flux" icon={Database}>
        <p className="mb-3 text-xs text-muted-foreground">
          Compara <code className="text-[10px]">arqrotasite</code> (read-only) com registros{' '}
          <code className="text-[10px]">flux_api</code> / <code className="text-[10px]">flux_db</code>. Requer{' '}
          <code className="text-[10px]">FLUX_MYSQL_PASSWORD</code>.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => mysqlMut.mutate(false)} disabled={mysqlMut.isPending}>
            Comparar
          </Button>
          <Button size="sm" onClick={() => mysqlMut.mutate(true)} disabled={mysqlMut.isPending}>
            Comparar e importar faltantes
          </Button>
        </div>
      </BillingSection>

      <section className="rounded-lg border border-dashed border-border bg-background/40 p-4 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">Conector app externo</p>
        <p className="mt-1">
          POST <code>/api/billing/integrations/external/deliveries</code> com header{' '}
          <code>X-Billing-App-Token</code> e corpo{' '}
          <code>{`{ workspace_id, deliveries: [{ pharmacy_id, driver_id, delivered_at, external_id }] }`}</code>.
        </p>
        <p className="mt-1">Configure <code>BILLING_EXTERNAL_APP_TOKEN</code> no api-service.</p>
      </section>

      {lastResult ? (
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 text-[11px]">{lastResult}</pre>
      ) : null}
    </div>
  );
}

function StatusCard({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <p className="text-[10px] uppercase tracking-wider text-subtle-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-semibold', ok ? 'text-success' : 'text-muted-foreground')}>
        {ok ? 'Configurado' : 'Indisponível'}
      </p>
      {hint && !ok ? <p className="mt-0.5 text-[10px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
