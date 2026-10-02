'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  FormControl,
  formControlTimeClassName,
  formTextareaClassName,
} from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { cadastroSwitchRowClassName } from '@/components/cadastro/CadastroPrimitives';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { DomainPill } from '@/components/ui/badges/DomainPill';
import { KpiCard } from '@/components/ui/KpiCard';
import { PageToolbar } from '@/components/ui/PageToolbar';
import { SurfacePanel } from '@/components/ui/SurfacePanel';
import { Sparkline } from '@/components/ui/Sparkline';
import {
  interactiveNavItem,
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
  semanticPillClass,
  settingsNavItem,
} from '@/lib/interactiveRow';
import { reviveOutlineButtonClassName, reviveTableRow, reviveTableRowClassName } from '@/lib/reviveSurfaces';
import { chartSeries } from '@/lib/chartTheme';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/Switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useThemePreference } from '@/hooks/useThemePreference';
import { cn } from '@/lib/utils';

export default function DesignSystemPage() {
  const { preference, setPreference } = useThemePreference();
  const [on, setOn] = useState(true);
  const [selectDemo, setSelectDemo] = useState('');

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-5xl space-y-8 p-6 pb-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Design system</h1>
          <p className="text-sm text-muted-foreground">
            Referência canônica: <code className="text-xs">apps/web</code> · ver{' '}
            <code className="text-xs">docs/REVIVE_DESIGN_SYSTEM.md</code>
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant={preference === 'light' ? 'default' : 'outline'} size="sm" onClick={() => setPreference('light')}>
            <Sun className="mr-1 h-4 w-4" /> Claro
          </Button>
          <Button variant={preference === 'dark' ? 'default' : 'outline'} size="sm" onClick={() => setPreference('dark')}>
            <Moon className="mr-1 h-4 w-4" /> Escuro
          </Button>
        </div>
      </div>

      <Tabs defaultValue="actions">
        <TabsList>
          <TabsTrigger value="actions">Ações</TabsTrigger>
          <TabsTrigger value="forms">Formulários</TabsTrigger>
          <TabsTrigger value="surfaces">Superfícies</TabsTrigger>
          <TabsTrigger value="overlays">Overlays</TabsTrigger>
        </TabsList>

        <TabsContent value="actions" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Botões</CardTitle>
              <CardDescription>Variantes shadcn</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Button>Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="outline">Outline</Button>
              <Button variant="ghost">Ghost</Button>
              <Button variant="destructive">Destructive</Button>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Badges</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge className="bg-success text-success-foreground">Success</Badge>
              <Badge className="bg-warning text-warning-foreground">Warning</Badge>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Avatars</CardTitle>
              <CardDescription>Fallback, imagem e grupo</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-6">
              <Avatar>
                <AvatarImage src="https://github.com/shadcn.png" alt="Avatar" />
                <AvatarFallback>CN</AvatarFallback>
              </Avatar>
              <Avatar size="sm">
                <AvatarFallback>SM</AvatarFallback>
              </Avatar>
              <Avatar size="lg">
                <AvatarFallback>LG</AvatarFallback>
              </Avatar>
              <AvatarGroup>
                <Avatar size="sm">
                  <AvatarFallback>A</AvatarFallback>
                </Avatar>
                <Avatar size="sm">
                  <AvatarFallback>B</AvatarFallback>
                </Avatar>
                <AvatarGroupCount>+3</AvatarGroupCount>
              </AvatarGroup>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forms" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>FormControl (canônico)</CardTitle>
              <CardDescription>
                Revive — `bg-background/40`, focus `primary/60`, switches em `bg-background`.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid max-w-2xl gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <SectionTitle>Texto md (h-9)</SectionTitle>
                <FormControl placeholder="Nome fantasia" />
              </div>
              <div className="space-y-1.5">
                <SectionTitle>Texto lg (h-10)</SectionTitle>
                <FormControl inputSize="lg" placeholder="Cadastro" />
              </div>
              <div className="space-y-1.5">
                <SectionTitle>Select</SectionTitle>
                <FormSelect
                  value={selectDemo}
                  onChange={setSelectDemo}
                  placeholder="Selecione…"
                  options={[
                    { value: '', label: 'Selecione…' },
                    { value: 'a', label: 'Opção A' },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <SectionTitle>Horário compacto</SectionTitle>
                <input type="time" defaultValue="08:00" className={formControlTimeClassName} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <SectionTitle>Textarea</SectionTitle>
                <textarea className={formTextareaClassName} rows={2} placeholder="Observações…" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <SectionTitle>Switch em campo</SectionTitle>
                <label className={cadastroSwitchRowClassName}>
                  <span className="text-xs text-muted-foreground">Ativo</span>
                  <Switch checked={on} onCheckedChange={setOn} />
                </label>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Linha interativa (listas / inbox)</CardTitle>
              <CardDescription>Padrão sidebar — `interactiveRow` em [`lib/interactiveRow.ts`](../../lib/interactiveRow.ts)</CardDescription>
            </CardHeader>
            <CardContent className="max-w-md space-y-2">
              <div className={cn('rounded-md border border-border px-3 py-2', interactiveRowSurface(false))}>
                <div className={interactiveRowPrimary(false)}>Hover — texto primário</div>
                <div className={cn('text-xs', interactiveRowSecondary(false))}>Secundário / preview</div>
              </div>
              <div className={cn('rounded-md border border-border px-3 py-2', interactiveRowSurface(true))}>
                <div className={interactiveRowPrimary(true)}>Ativo — texto primário</div>
                <div className={cn('text-xs', interactiveRowSecondary(true))}>Secundário legível no fundo azul</div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(['neutral', 'primary', 'success', 'warning', 'destructive', 'info'] as const).map((tone) => (
                    <span key={tone} className={semanticPillClass(tone, 'text-[10px]')}>
                      {tone}
                    </span>
                  ))}
                </div>
              </div>
              <button type="button" className={interactiveNavItem(false)}>
                <span>Pasta inativa (nav)</span>
                <span className="font-mono text-[10px]">8</span>
              </button>
              <button type="button" className={interactiveNavItem(true)}>
                <span>Pasta ativa (nav)</span>
                <span className="font-mono text-[10px]">12</span>
              </button>
              <button type="button" className={settingsNavItem(false)}>
                <span className="text-sm font-medium">Configurações — item inativo</span>
              </button>
              <button type="button" className={settingsNavItem(true)}>
                <span className="text-sm font-medium">Configurações — item selecionado</span>
              </button>
              <p className="pt-1 text-[10px] text-muted-foreground">
                Elementos clicáveis usam <code className="text-[10px]">sidebar-accent</code>. Fundos estáticos
                (cards, KPIs) podem usar <code className="text-[10px]">bg-surface</code> sem hover azul.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>shadcn Input (legado)</CardTitle>
              <CardDescription>Evitar em telas novas — preferir FormControl</CardDescription>
            </CardHeader>
            <CardContent className="max-w-sm space-y-4">
              <div className="space-y-2">
                <Label htmlFor="ds-input">Input</Label>
                <Input id="ds-input" placeholder="Texto de exemplo" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Operação (Configurações)</CardTitle>
              <CardDescription>Botões secundários outline — nunca <code className="text-xs">variant=&quot;secondary&quot;</code></CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="outline" size="xs" className={reviveOutlineButtonClassName}>
                + Adicionar passo
              </Button>
              <label className={cadastroSwitchRowClassName}>
                <span className="text-xs text-muted-foreground">Tipo ativo</span>
                <Switch checked onCheckedChange={() => undefined} />
              </label>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Tabela interativa</CardTitle>
              <CardDescription>
                Linhas clicáveis — <code className="text-xs">reviveTableRowClassName</code> /{' '}
                <code className="text-xs">reviveTableRow(active)</code> (Entregadores, Usuários)
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="overflow-hidden rounded-xl border border-border bg-surface">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-background text-left text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                      <th className="px-4 py-2">Nome</th>
                      <th className="px-4 py-2">Status</th>
                      <th className="px-4 py-2 text-right">Volume</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className={reviveTableRowClassName}>
                      <td className="px-4 py-3">WhatsApp</td>
                      <td className="px-4 py-3">
                        <Badge variant="outline">Ativo</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">128</td>
                    </tr>
                    <tr className={reviveTableRow(true)}>
                      <td className="px-4 py-3">E-mail</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary">Selecionado</Badge>
                      </td>
                      <td className="px-4 py-3 text-right font-mono">42</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="surfaces" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>PageToolbar + SurfacePanel + KpiCard</CardTitle>
              <CardDescription>Primitivos de página analytics</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <PageToolbar>
                <Button variant="outline" size="sm">Secundário</Button>
                <Button size="sm">Primário</Button>
              </PageToolbar>
              <SurfacePanel title="Painel" description="Substitui div rounded-xl bg-card">
                <p className="text-sm text-muted-foreground">Conteúdo do painel.</p>
              </SurfacePanel>
              <div className="grid max-w-md grid-cols-2 gap-2">
                <KpiCard title="SLA" value="98%" alert alertLevel="success" />
                <KpiCard title="TMA" value="3m" alert alertLevel="destructive" values={[1, 2, 1, 3, 2]} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Gráficos (chartTheme)</CardTitle>
              <CardDescription>Tokens `--chart-1`…`--chart-5` via Sparkline</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <Sparkline values={[2, 4, 3, 6, 5, 8]} chartColor={1} />
              <DomainPill tone="primary">DomainPill</DomainPill>
              <span className="text-xs text-muted-foreground">stroke: {chartSeries.primary}</span>
            </CardContent>
          </Card>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-background p-4 text-sm">background</div>
            <div className="rounded-xl border border-border bg-card p-4 text-sm">card</div>
            <div className="rounded-xl border border-border bg-muted p-4 text-sm">muted</div>
            <div className="rounded-xl border border-border bg-sidebar p-4 text-sm text-sidebar-foreground">sidebar</div>
            <div className="rounded-xl border border-border bg-card p-4 text-sm">card (painéis)</div>
            <div className="rounded-xl border border-primary bg-primary/10 p-4 text-sm text-primary">primary tint</div>
          </div>
          <Card>
            <CardHeader>
              <CardTitle>Separator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">Conteúdo acima</p>
              <Separator />
              <p className="text-sm text-muted-foreground">Conteúdo abaixo</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="overlays" className="space-y-4 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>Dialog</CardTitle>
              <CardDescription>Modal overlay shadcn</CardDescription>
            </CardHeader>
            <CardContent>
              <Dialog>
                <DialogTrigger render={<Button variant="outline" />}>Abrir dialog</DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Confirmar ação</DialogTitle>
                    <DialogDescription>
                      Exemplo de dialog com footer e tokens de popover/card.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline">Cancelar</Button>
                    <Button>Confirmar</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      </div>
    </div>
  );
}
