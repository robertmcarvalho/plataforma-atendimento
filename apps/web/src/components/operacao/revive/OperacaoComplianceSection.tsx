'use client';

import { useMemo } from 'react';
import { BadgeCheck, Briefcase, ShieldCheck } from 'lucide-react';
import { AvatarInitials } from '@/components/ui/AvatarInitials';
import { ComplianceBadge } from '@/components/ui/ComplianceBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { OperacaoComplianceStatCard } from '@/components/operacao/revive/OperacaoComplianceStatCard';
import type { OpsComplianceRow } from '@/lib/ops/opsAnalyticsApi';

export function OperacaoComplianceSection({ rows, loading }: { rows: OpsComplianceRow[]; loading?: boolean }) {
  const total = rows.length || 1;

  const complianceStats = useMemo(() => {
    const cert = rows.filter((r) => r.cert_digital).length;
    const mei = rows.filter((r) => r.mei).length;
    const mat = rows.filter((r) => r.matricula_signed).length;
    return [
      {
        label: 'Certificado digital',
        icon: ShieldCheck,
        ok: cert,
        total: rows.length,
        pct: Math.round((cert / total) * 100),
      },
      {
        label: 'MEI ativo',
        icon: Briefcase,
        ok: mei,
        total: rows.length,
        pct: Math.round((mei / total) * 100),
      },
      {
        label: 'Matrícula emitida',
        icon: BadgeCheck,
        ok: mat,
        total: rows.length,
        pct: Math.round((mat / total) * 100),
      },
    ];
  }, [rows, total]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Compliance documental dos entregadores</h2>
        <span className="text-[11px] text-muted-foreground">{rows.length} entregadores ativos</span>
      </div>

      <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-3">
        {loading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl border border-border bg-surface" />
            ))
          : complianceStats.map((s) => (
              <OperacaoComplianceStatCard
                key={s.label}
                label={s.label}
                icon={s.icon}
                ok={s.ok}
                total={s.total}
                pct={s.pct}
              />
            ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState>{loading ? 'Carregando compliance…' : 'Nenhum entregador na carteira para compliance.'}</EmptyState>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-surface">
          <div className="max-h-[320px] overflow-x-auto overflow-y-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="sticky top-0 bg-background/80 text-[10px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Entregador</th>
                  <th className="px-2 py-2 text-left font-medium">Farmácia</th>
                  <th className="px-2 py-2 text-center font-medium">Cert. digital</th>
                  <th className="px-2 py-2 text-center font-medium">MEI</th>
                  <th className="px-4 py-2 text-center font-medium">Matrícula</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.driver_id} className="border-t border-border hover:bg-background/40">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        <AvatarInitials initials={r.initials} size="sm" className="bg-primary" />
                        <span className="font-medium">{r.name}</span>
                      </div>
                    </td>
                    <td className="px-2 py-2 text-muted-foreground">{r.pharmacy_name}</td>
                    <td className="px-2 py-2 text-center">
                      <ComplianceBadge ok={r.cert_digital} label={r.cert_digital ? 'Sim' : 'Não'} />
                    </td>
                    <td className="px-2 py-2 text-center">
                      <ComplianceBadge ok={r.mei} label={r.mei ? 'Sim' : 'Não'} />
                    </td>
                    <td className="px-4 py-2 text-center">
                      <ComplianceBadge ok={r.matricula_signed} label={r.matricula_signed ? 'Sim' : 'Não'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
