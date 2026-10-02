'use client';

import { useMemo } from 'react';
import { BadgeCheck, Briefcase, CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { IconTile } from '@/components/ui/IconTile';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ComplianceEntregador } from '@/lib/operacao/reviveCopy/operacaoReviveTypes';
import { cn } from '@/lib/utils';

const ComplianceBadge = ({ ok, label }: { ok: boolean; label: string }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium',
      ok ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'
    )}
  >
    {ok ? <CheckCircle2 className="h-3 w-3" strokeWidth={2} /> : <Circle className="h-3 w-3" strokeWidth={2} />}
    {label}
  </span>
);

export function ReviveComplianceSection({
  compliance,
  loading,
  pharmacyId,
  onPharmacyIdChange,
  pharmacies = [],
}: {
  compliance: ComplianceEntregador[];
  loading?: boolean;
  pharmacyId?: string;
  onPharmacyIdChange?: (id: string) => void;
  pharmacies?: Array<{ id: string; trade_name: string }>;
}) {
  const complianceStats = useMemo(() => {
    if (!compliance.length) return [];
    const total = compliance.length;
    const cert = compliance.filter((c) => c.certificadoDigital).length;
    const mei = compliance.filter((c) => c.mei).length;
    const mat = compliance.filter((c) => c.matricula).length;
    return [
      { label: 'Certificado digital', icon: ShieldCheck, tone: 'primary' as const, ok: cert, total, pct: Math.round((cert / total) * 100) },
      { label: 'MEI ativo', icon: Briefcase, tone: 'success' as const, ok: mei, total, pct: Math.round((mei / total) * 100) },
      { label: 'Matrícula emitida', icon: BadgeCheck, tone: 'warning' as const, ok: mat, total, pct: Math.round((mat / total) * 100) },
    ];
  }, [compliance]);

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={ShieldCheck} tone="success" size="sm" /> Compliance documental dos entregadores
        </h2>
        <div className="flex items-center gap-2">
          {onPharmacyIdChange && pharmacies.length > 0 ? (
            <ToolbarSelect
              wideMenu
              value={pharmacyId || ''}
              onChange={onPharmacyIdChange}
              aria-label="Filtrar compliance por farmácia"
              className="max-w-[12rem] truncate"
              options={[
                { value: '', label: 'Todas as farmácias' },
                ...pharmacies.map((p) => ({ value: p.id, label: p.trade_name })),
              ]}
            />
          ) : null}
          <span className="text-[11px] text-muted-foreground">{compliance.length} entregadores ativos</span>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)
          : compliance.length === 0
            ? (
                <div className="col-span-full rounded-xl border border-dashed border-border bg-surface/40 px-4 py-8 text-center text-xs text-muted-foreground">
                  Nenhum entregador ativo vinculado às farmácias da carteira.
                </div>
              )
            : complianceStats.map((s) => {
              const Icon = s.icon;
              return (
                <div key={s.label} className="rounded-xl border border-border bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <IconTile icon={Icon} tone={s.tone} />
                      <div>
                        <div className="text-[11px] text-muted-foreground">{s.label}</div>
                        <div className="font-mono text-lg font-semibold tracking-tight">
                          {s.ok}
                          <span className="text-muted-foreground">/{s.total}</span>
                        </div>
                      </div>
                    </div>
                    <div
                      className={cn(
                        'rounded-md px-2 py-0.5 font-mono text-xs font-semibold',
                        s.pct >= 90 ? 'bg-success/15 text-success' : s.pct >= 70 ? 'bg-warning/15 text-warning' : 'bg-destructive/15 text-destructive',
                      )}
                    >
                      {s.pct}%
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full transition-all', s.pct >= 90 ? 'bg-success' : s.pct >= 70 ? 'bg-warning' : 'bg-destructive')}
                      style={{ width: `${s.pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="max-h-[320px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background/80 text-[10px] uppercase tracking-wider text-subtle-foreground backdrop-blur">
              <tr>
                <th className="px-4 py-2 text-left font-medium">Entregador</th>
                <th className="px-2 py-2 text-left font-medium">Farmácia</th>
                <th className="px-2 py-2 text-center font-medium">Cert. digital</th>
                <th className="px-2 py-2 text-center font-medium">MEI</th>
                <th className="px-4 py-2 text-center font-medium">Matrícula</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Carregando compliance…
                  </td>
                </tr>
              ) : compliance.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-xs text-muted-foreground">
                    Sem registros de compliance para exibir.
                  </td>
                </tr>
              ) : (
                compliance.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-background/40">
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gradient-primary text-[10px] font-semibold text-primary-foreground">
                        {c.iniciais}
                      </div>
                      <span className="font-medium">{c.nome}</span>
                    </div>
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">{c.farmacia}</td>
                  <td className="px-2 py-2 text-center">
                    <ComplianceBadge ok={c.certificadoDigital} label={c.certificadoDigital ? 'Sim' : 'Não'} />
                  </td>
                  <td className="px-2 py-2 text-center">
                    <ComplianceBadge ok={c.mei} label={c.mei ? 'Sim' : 'Não'} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <ComplianceBadge ok={c.matricula} label={c.matricula ? 'Sim' : 'Não'} />
                  </td>
                </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
