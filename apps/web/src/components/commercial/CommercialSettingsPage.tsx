'use client';

import { useCallback, useMemo, useState } from 'react';
import { useCatalogDraft } from '@/lib/commercial/useCatalogDraft';
import {
  Briefcase,
  ChevronRight,
  DollarSign,
  GripVertical,
  ListChecks,
  Plug,
  Plus,
  Trash2,
  Workflow,
  XOctagon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { CadastroBackLink } from '@/components/cadastro/CadastroPrimitives';
import { FormSelect } from '@/components/form/FormSelect';
import { PageHeader } from '@/components/ui/PageHeader';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { CommercialMotorSettingsPanel } from '@/components/commercial/CommercialMotorSettingsPanel';
import {
  useErpOptions,
  useFieldDefinitions,
  useLeads,
  useLossReasons,
  usePipelineStages,
  usePutErpOptions,
  usePutFieldDefinitions,
  usePutLossReasons,
  usePutPipelineStages,
} from '@/lib/commercial/useCommercialQueries';
import type { CommercialErpOption, CommercialStage, FieldDefinition, LossReason } from '@/lib/commercial/types';
import { settingsNavItem } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { SettingsMobileSectionPicker } from '@/components/settings/SettingsMobileSectionPicker';

const SECTIONS: {
  id: 'pipeline' | 'fields' | 'reasons' | 'pricing' | 'integrations';
  label: string;
  icon: LucideIcon;
  desc: string;
}[] = [
  { id: 'pipeline', label: 'Pipeline', icon: Workflow, desc: 'Estágios, cores e probabilidades' },
  { id: 'fields', label: 'Campos customizados', icon: ListChecks, desc: 'Campos extras nos leads' },
  { id: 'reasons', label: 'Motivos de perda', icon: XOctagon, desc: 'Catálogo para fechamento' },
  { id: 'pricing', label: 'Catálogo de preços', icon: DollarSign, desc: 'Faixas e pacotes (P2)' },
  { id: 'integrations', label: 'Integrações', icon: Plug, desc: 'Instagram, Flux' },
];

export function CommercialSettingsPage() {
  const { data: stages = [], isLoading } = usePipelineStages();
  const [active, setActive] = useState<(typeof SECTIONS)[number]['id']>('pipeline');

  return (
    <div>
      <CadastroBackLink href="/commercial">Voltar para comercial</CadastroBackLink>

      <PageHeader
        icon={Briefcase}
        eyebrow="Comercial"
        title="Configurações"
        description="Funil, campos e catálogos do CRM comercial."
      />

      {isLoading ? <CommercialListSkeleton rows={4} /> : null}

      <SettingsMobileSectionPicker
        value={active}
        onChange={(value) => setActive(value as (typeof SECTIONS)[number]['id'])}
        options={SECTIONS.map((s) => ({ value: s.id, label: s.label }))}
      />

      <div className="grid grid-cols-12 gap-6">
        <nav className="col-span-12 hidden space-y-0.5 lg:block lg:col-span-4 xl:col-span-3">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              className={settingsNavItem(active === s.id)}
            >
              <div
                className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-lg',
                  active === s.id ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                <s.icon className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{s.label}</div>
                <div className="truncate text-[10px] text-subtle-foreground">{s.desc}</div>
              </div>
              <ChevronRight
                className={cn('h-3.5 w-3.5', active === s.id ? 'text-primary' : 'text-subtle-foreground')}
              />
            </button>
          ))}
        </nav>

        <div className="col-span-12 space-y-4 lg:col-span-8 xl:col-span-9">
          {active === 'pipeline' ? <PipelinePanel stages={stages} /> : null}
          {active === 'fields' ? <FieldsPanel /> : null}
          {active === 'reasons' ? <ReasonsPanel /> : null}
          {active === 'pricing' ? <PricingPanel /> : null}
          {active === 'integrations' ? <IntegrationsPanel /> : null}
        </div>
      </div>
    </div>
  );
}

function PipelinePanel({ stages }: { stages: CommercialStage[] }) {
  const putStages = usePutPipelineStages();
  const { data: leadsRes } = useLeads({ limit: 1 });
  const leadsCount = leadsRes?.total ?? 0;
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const sorted = useMemo(() => [...stages].sort((a, b) => a.sort_order - b.sort_order), [stages]);

  const saveStages = useCallback(
    async (next: CommercialStage[]) => {
      await putStages.mutateAsync(next.map((s, i) => ({ ...s, sort_order: i })));
    },
    [putStages]
  );

  const { draft, msg, saving, patchLocal, replaceLocal, flush, saveNow } = useCatalogDraft(sorted, saveStages, {
    validate: (rows) => {
      if (rows.some((s) => !String(s.name || '').trim())) return null;
      return rows;
    },
  });

  const remove = (id: string) => {
    const target = draft.find((s) => s.id === id);
    if (target?.is_won || target?.is_lost || target?.is_entry) {
      setLocalMsg('Estágios de entrada, ganho e perdido não podem ser removidos.');
      return;
    }
    setLocalMsg(null);
    saveNow(draft.filter((s) => s.id !== id));
  };

  const handleDrop = (toIndex: number) => {
    if (dragIndex === null || dragIndex === toIndex) return;
    const next = [...draft];
    const [item] = next.splice(dragIndex, 1);
    next.splice(toIndex, 0, item!);
    setDragIndex(null);
    saveNow(next);
  };

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Estágios do pipeline</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Ordene, edite cores e probabilidades por estágio.</p>
        </div>
        <button
          type="button"
          onClick={() => {
            const maxOrder = draft.reduce((m, s) => Math.max(m, s.sort_order), -1);
            replaceLocal([
              ...draft,
              {
                id: `new-${Date.now()}`,
                name: '',
                color: '#6366f1',
                probability: 20,
                sort_order: maxOrder + 1,
              },
            ]);
          }}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow"
        >
          <Plus className="h-3.5 w-3.5" /> Estágio
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {draft.map((s, index) => (
          <div
            key={s.id}
            draggable
            onDragStart={() => setDragIndex(index)}
            onDragEnd={() => setDragIndex(null)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(index);
            }}
            className={cn(
              'flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2',
              dragIndex === index && 'opacity-50',
            )}
          >
            <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-subtle-foreground active:cursor-grabbing" />
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
            <input
              value={s.name}
              onChange={(e) => patchLocal(s.id, { name: e.target.value })}
              onBlur={() => flush()}
              placeholder="Nome do estágio"
              className="flex-1 bg-transparent text-sm outline-none"
            />
            <input
              type="color"
              value={s.color.startsWith('#') ? s.color : '#6366f1'}
              onChange={(e) => {
                patchLocal(s.id, { color: e.target.value });
                saveNow(draft.map((row) => (row.id === s.id ? { ...row, color: e.target.value } : row)));
              }}
              className="h-7 w-8 shrink-0 cursor-pointer rounded border border-border bg-transparent"
              title="Cor"
            />
            <input
              type="number"
              min={0}
              max={100}
              value={s.probability}
              onChange={(e) => patchLocal(s.id, { probability: Number(e.target.value) || 0 })}
              onBlur={() => flush()}
              className="w-16 rounded border border-border bg-background/40 px-2 py-1 text-right font-mono text-xs outline-none"
            />
            <span className="text-[10px] text-subtle-foreground">%</span>
            {s.is_won ? (
              <span className="rounded bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success">GANHO</span>
            ) : null}
            {s.is_lost ? (
              <span className="rounded bg-destructive/15 px-1.5 py-0.5 text-[9px] font-medium text-destructive">
                PERDIDO
              </span>
            ) : null}
            {s.is_entry ? (
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[9px] font-medium text-primary">ENTRADA</span>
            ) : null}
            {!s.is_won && !s.is_lost && !s.is_entry ? (
              <button
                type="button"
                onClick={() => remove(s.id)}
                className="rounded p-1 text-subtle-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {localMsg || msg ? <p className="mt-3 text-xs text-destructive">{localMsg || msg}</p> : null}
      {saving ? <p className="mt-2 text-[11px] text-muted-foreground">Salvando…</p> : null}
      <p className="mt-3 text-[11px] text-subtle-foreground">{leadsCount} leads no workspace</p>
    </div>
  );
}

function FieldsPanel() {
  const { data: fields = [] } = useFieldDefinitions();
  const putFields = usePutFieldDefinitions();

  const saveFields = useCallback(async (next: FieldDefinition[]) => {
    await putFields.mutateAsync(next);
  }, [putFields]);

  const { draft, msg, saving, patchLocal, replaceLocal, flush, saveNow } = useCatalogDraft(fields, saveFields, {
    validate: (rows) => {
      if (rows.some((f) => !String(f.slug || '').trim() || !String(f.label || '').trim())) return null;
      return rows;
    },
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Campos personalizados</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Renderizados no form de novo lead e na ficha.</p>
        </div>
        <button
          type="button"
          onClick={() =>
            replaceLocal([
              ...draft,
              {
                id: `field-${Date.now()}`,
                slug: '',
                label: '',
                type: 'text',
                required: false,
                sort_order: draft.length,
              },
            ])
          }
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow"
        >
          <Plus className="h-3.5 w-3.5" /> Campo
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-background/40 text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Slug</th>
              <th className="px-3 py-2 text-left">Label</th>
              <th className="px-3 py-2 text-left">Tipo</th>
              <th className="px-3 py-2 text-left">Obrig.</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {draft.map((f) => (
              <tr key={f.id} className="border-t border-border">
                <td className="px-3 py-2">
                  <input
                    value={f.slug}
                    onChange={(e) => patchLocal(f.id, { slug: e.target.value })}
                    onBlur={() => flush()}
                    placeholder="slug_campo"
                    className="w-full bg-transparent font-mono outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={f.label}
                    onChange={(e) => patchLocal(f.id, { label: e.target.value })}
                    onBlur={() => flush()}
                    placeholder="Rótulo"
                    className="w-full bg-transparent outline-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <FormSelect
                    size="sm"
                    value={f.type}
                    onChange={(v) => {
                      const next = draft.map((row) =>
                        row.id === f.id ? { ...row, type: v as FieldDefinition['type'] } : row
                      );
                      replaceLocal(next);
                      saveNow(next);
                    }}
                    options={[
                      { value: 'text', label: 'text' },
                      { value: 'number', label: 'number' },
                      { value: 'select', label: 'select' },
                      { value: 'date', label: 'date' },
                      { value: 'boolean', label: 'boolean' },
                    ]}
                    className="min-w-[5.5rem] border-0 bg-transparent px-0 shadow-none"
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    checked={f.required}
                    onChange={(e) => {
                      const next = draft.map((row) =>
                        row.id === f.id ? { ...row, required: e.target.checked } : row
                      );
                      saveNow(next);
                    }}
                  />
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    type="button"
                    onClick={() => saveNow(draft.filter((row) => row.id !== f.id))}
                    className="rounded p-1 text-subtle-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {msg ? <p className="mt-3 text-xs text-destructive">{msg}</p> : null}
      {saving ? <p className="mt-2 text-[11px] text-muted-foreground">Salvando…</p> : null}
    </div>
  );
}

function ReasonsPanel() {
  const { data: reasons = [] } = useLossReasons();
  const putReasons = usePutLossReasons();

  const saveReasons = useCallback(async (next: LossReason[]) => {
    await putReasons.mutateAsync(next);
  }, [putReasons]);

  const { draft, msg, saving, patchLocal, replaceLocal, flush, saveNow } = useCatalogDraft(reasons, saveReasons, {
    validate: (rows) => {
      if (rows.some((r) => !String(r.name || '').trim())) return null;
      return rows;
    },
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight">Motivos de perda</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Aparecem no modal ao marcar um lead como perdido.</p>
        </div>
        <button
          type="button"
          onClick={() => replaceLocal([...draft, { id: `loss-${Date.now()}`, name: '', active: true }])}
          className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow"
        >
          <Plus className="h-3.5 w-3.5" /> Motivo
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {draft.map((r) => (
          <div key={r.id} className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2">
            <input
              value={r.name}
              onChange={(e) => patchLocal(r.id, { name: e.target.value })}
              onBlur={() => flush()}
              placeholder="Motivo de perda"
              className="flex-1 bg-transparent text-sm outline-none"
            />
            <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <input
                type="checkbox"
                checked={r.active}
                onChange={(e) => {
                  const next = draft.map((row) => (row.id === r.id ? { ...row, active: e.target.checked } : row));
                  saveNow(next);
                }}
              />{' '}
              Ativo
            </label>
            <button
              type="button"
              onClick={() => saveNow(draft.filter((row) => row.id !== r.id))}
              className="rounded p-1 text-subtle-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
      {msg ? <p className="mt-3 text-xs text-destructive">{msg}</p> : null}
      {saving ? <p className="mt-2 text-[11px] text-muted-foreground">Salvando…</p> : null}
    </div>
  );
}

function PricingPanel() {
  const { data: erps = [] } = useErpOptions();
  const putErps = usePutErpOptions();

  const saveErps = useCallback(async (next: CommercialErpOption[]) => {
    await putErps.mutateAsync(next);
  }, [putErps]);

  const { draft, msg, saving, patchLocal, replaceLocal, flush, saveNow } = useCatalogDraft(erps, saveErps, {
    validate: (rows) => {
      if (rows.some((o) => !String(o.name || '').trim())) return null;
      return rows;
    },
  });

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center">
        <DollarSign className="mx-auto h-8 w-8 text-muted-foreground" />
        <h3 className="mt-3 text-sm font-semibold tracking-tight">Catálogo de preços</h3>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Faixas por volume, MDR e setup para o gerador de propostas. Disponível na fase P2.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold tracking-tight">ERPs de farmácia</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">Opções no cadastro de leads e importação Excel.</p>
          </div>
          <button
            type="button"
            onClick={() => replaceLocal([...draft, { id: `erp-${Date.now()}`, name: '', active: true }])}
            className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary-glow"
          >
            <Plus className="h-3.5 w-3.5" /> ERP
          </button>
        </div>
        <div className="mt-4 space-y-2">
          {draft.map((opt) => (
            <div
              key={opt.id}
              className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2"
            >
              <input
                value={opt.name}
                onChange={(e) => patchLocal(opt.id, { name: e.target.value })}
                onBlur={() => flush()}
                placeholder="Nome do ERP"
                className="flex-1 bg-transparent text-sm outline-none"
              />
              <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={opt.active}
                  onChange={(e) => {
                    const next = draft.map((row) =>
                      row.id === opt.id ? { ...row, active: e.target.checked } : row
                    );
                    saveNow(next);
                  }}
                />{' '}
                Ativo
              </label>
              <button
                type="button"
                onClick={() => saveNow(draft.filter((o) => o.id !== opt.id))}
                className="rounded p-1 text-subtle-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
        {msg ? <p className="mt-3 text-xs text-destructive">{msg}</p> : null}
        {saving ? <p className="mt-2 text-[11px] text-muted-foreground">Salvando…</p> : null}
      </div>
    </div>
  );
}

function IntegrationsPanel() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">Instagram Lead Ads</h3>
            <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">Conectado</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Webhook ativo. Último evento há 12 min.</p>
          <button
            type="button"
            className="mt-3 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs transition-colors hover:bg-sidebar-accent/60"
          >
            Ver logs
          </button>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">Flux · Viabilidade</h3>
            <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">OK</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Consultas de cobertura e volume disponíveis na ficha do lead.
          </p>
          <button
            type="button"
            className="mt-3 rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs transition-colors hover:bg-sidebar-accent/60"
          >
            Testar viabilidade
          </button>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">WhatsApp comercial</h3>
            <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">Canal separado</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Número comercial — não mistura com suporte.</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold tracking-tight">SDR (Automações)</h3>
            <span className="rounded bg-success/15 px-2 py-0.5 text-[10px] font-medium text-success">Fluxo publicado</span>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Binding em Automações → Fluxo SDR Comercial.</p>
          <Link
            href="/settings/automations"
            className="mt-3 inline-block rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs transition-colors hover:bg-sidebar-accent/60"
          >
            Abrir fluxos
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-4 text-sm font-semibold tracking-tight">Motor operacional</h3>
        <CommercialMotorSettingsPanel />
      </div>
    </div>
  );
}
