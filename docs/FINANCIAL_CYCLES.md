# Ciclos financeiros (diárias, descontos e apuração)

## Fonte de verdade

Regras por workspace em `app_settings.financial_discount_rules` (UI: Financeiro → Configuração regras).

O pacote `@plataforma/financial-cycle` centraliza:

- Data de **pagamento de diária** (`daily.daysOfWeek` + `submissionCutoffHour`)
- **Falta**: ciclo seg–dom do evento → pagamento no dia configurado (`absence`, kind `apuracao_cycle`)
- **Conferência** no seletor de data (dias de pagamento configurados)
- **Descrição sistêmica** vs motivo em `notes`

## Fluxo operacional

1. **Segunda**: apura faturamento do período **seg–dom da semana anterior**.
2. **Descontos** com parcela no dia de **liquidação** (ex.: quinta configurada em `absence.daysOfWeek`).
3. **Diárias**: crédito nos lotes configurados; terça costuma ser só diária; no dia de liquidação entram diárias + descontos.

## Campos em `financial_entries`

| Campo | Uso |
|-------|-----|
| `event_date` | Data do evento (falta) |
| `apuracao_start` / `apuracao_end` | Ciclo seg–dom apurado (falta) |
| `start_date` | Data de **pagamento** (parcela) |
| `notes` | Motivo do líder |
| `description` | Texto gerado pelo sistema |

## Recálculo em massa

- API: `POST /api/financial/entries/recalculate` body `{ "dry_run": true }`
- UI: Configuração regras → Simular / Recalcular em massa
- Script: `node scripts/recalculate-financial-entries.mjs --dry-run`

Usa **regras atuais** do workspace; não altera `status`, `created_at` nem aprovações.

## Migração

`041_financial_entry_cycle_fields.sql` adiciona `event_date`, `apuracao_start`, `apuracao_end`.
