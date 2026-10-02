# Design system — Revive (fonte canônica)

**Referência visual canônica:** `apps/web/` (protótipo Revive removido do repositório em 2026-06)

Não usar documentos antigos de “preferências Twitter/shadcn”, `design-preferences.json` nem variantes `PageHeader plain`.

## Mapeamento prototype → app

| Revive (legado) | Aethera (`apps/web`) |
|-----------------------------------|----------------------|
| `pages/EntregadorCadastro.tsx` | `app/(app)/drivers/new/page.tsx` |
| `pages/EntregadorFicha.tsx` | `app/(app)/drivers/[id]/page.tsx` |
| `pages/Entregadores.tsx` | `app/(app)/drivers/page.tsx` |
| `pages/FarmaciaCadastro.tsx` | `app/(app)/pharmacies/new/page.tsx` |
| `pages/FarmaciaFicha.tsx` | `app/(app)/pharmacies/[id]/page.tsx` |
| `pages/Farmacias.tsx` | `app/(app)/pharmacies/page.tsx` |
| `pages/Inbox.tsx` | `app/(app)/inbox/page.tsx` |
| `components/PageHeader.tsx` | `components/ui/PageHeader.tsx` |
| `components/ui/input.tsx` | `components/form/FormControl.tsx` |
| `components/ui/button.tsx` | `components/ui/button.tsx` |
| `components/ui/switch.tsx` | `components/ui/Switch.tsx` |
| `components/ui/select.tsx` | `components/form/FormSelect.tsx` |
| `Section` / `Field` inline | `components/cadastro/CadastroPrimitives.tsx` |
| KPI / tabela / cards listagem | `lib/reviveSurfaces.ts` |
| `index.css` tokens | `globals.css` + `theme-domain.css` |

## Tokens (dark)

- `--radius: 1.3rem`
- Fundo página: `bg-background` (#000)
- Seções cadastro/ficha: `bg-surface` (`--surface`, mais escuro que card)
- PageHeader / cards elevados: `bg-card`
- Inputs: `bg-background/40`, focus `border-primary/60` + `ring-primary/20`
- Switches / segmentado: container `bg-background` (sólido), borda `border-border`
- Labels: `text-xs font-medium text-muted-foreground`

## Regra de migração

Para cada tela: abrir o `.tsx` homólogo no Revive, copiar **classes e estrutura**, manter **dados e handlers** do Aethera.
