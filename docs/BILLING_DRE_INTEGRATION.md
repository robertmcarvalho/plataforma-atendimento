# Billing × dash_dre_flux — mapeamento e próximos passos

Documento de referência cruzando o **dashboard DRE** (`dash_dre_flux/`) com o **módulo billing** da plataforma (`apps/api-service`, `apps/web`).

## Contexto

| Sistema | Papel hoje |
|---------|------------|
| **dash_dre_flux** | App FastAPI separada; ETL lê Excel de movimentos financeiros (CoopMob/Flux), classifica plano de contas, gera DRE financeiro/gerencial, ranking farmácias, conciliação e preditivo; persiste em Supabase (`dre_financeiro`, `dre_gerencial`, etc.) |
| **Plataforma billing** | Ciclo de apuração, acertos por entregador/farmácia, faturas AR, AP cooperados, despesas, comissões parceiro/líder, tesouraria e relatórios operacionais |

Os dois compartilham conceitos (Flux vs Coop, margem de serviço, farmácias como CC), mas **não estão integrados** no mesmo banco/UI.

---

## O que o dash_dre_flux faz (resumo)

1. **ETL** (`etl/process_data.py`, `process_coop.py`): importa planilha de movimentos; normaliza; classifica custo fixo/variável/não operacional; rateia por centro de custo/farmácia; calcula Simples Nacional.
2. **APIs** (`backend/main.py`): DRE financeiro, DRE gerencial, ranking farmácias, conciliação bancária, preditivo/valuation.
3. **Front** (`frontend/`): dashboards Chart.js com filtros por mês, entidade (Flux/Coop), farmácia.

---

## O que a plataforma já cobre

| Necessidade analítica | Status no billing | Onde |
|----------------------|-------------------|------|
| Receita por farmácia (entregas) | ✅ Parcial | `billing_settlements`, `billing_invoices`, sync `billing_delivery_records` |
| Repasse líquido cooperados | ✅ | Acertos + `billing_payables` + export PIX |
| Margem Flux (30% serviço) | ✅ | `billing_legal_entities.flux_service_margin_pct`, linhas `flux_cents` nos acertos |
| Comissão parceiro comercial | ✅ Fase 7 | `billing_commission_accruals` |
| Comissão líder (margem Flux) | ✅ Fase 7b | `billing_leader_commission_accruals` |
| Despesas / fornecedores / AP empresa | ✅ | `billing_expenses`, `billing_payables` (beneficiary ≠ driver) |
| INSS / seguradora cooperados | ✅ | Relatórios em `/billing/relatorios/*` |
| Tesouraria / conciliação bancária | ✅ Fase 8 | `billing_bank_movements`, vínculo manual com pagamentos |
| Pagamento PIX em lote (C6) | ✅ **Novo** | Template XLSX C6; emissão automática ao aprovar acertos |
| Plano de contas gerencial (fixo/variável) | ❌ | Só no dash ETL |
| DRE consolidado Flux+Coop | ❌ | Dash usa tabelas `dre_*` dedicadas |
| Upload Excel movimentos bancários históricos | ❌ no billing | Dash ETL; billing importa CSV/OFX por conta |
| Simples Nacional rateado | ❌ | Dash ETL |
| Preditivo / valuation | ❌ | Dash `predictive_data` |

**Cutover DRE Aethera:** `2026-07` — ver [BILLING_DRE_PLAN.md](./BILLING_DRE_PLAN.md)

---

### Template

Arquivo oficial: `apps/api-service/assets/billing/c6-template-pagar-salarios-via-pix.xlsx`  
Aba usada: **"PIX chave ou código"** (colunas: nome, chave PIX, valor, data pagamento, descrição).

### Quando gera

1. **Aprovar todos** os acertos de um ciclo (`POST …/settlements/approve-all`):
   - Gera faturas + AP cooperados (como antes)
   - Gera lote PIX automaticamente se houver AP
   - Resposta inclui `pix_batch` com `xlsx_base64` (template C6 por padrão)
   - UI baixa o `.xlsx` imediatamente

2. **Manual**: `/billing/relatorios/pagamento-pix` ou API `POST /reports/pix-batch/export`

### Qual template usar

Ordem de resolução:

1. Conta bancária selecionada na exportação (`billing_bank_accounts.pix_export_template`)
2. Conta marcada como **padrão** no workspace
3. Variável de ambiente `BILLING_DEFAULT_PIX_TEMPLATE`
4. Fallback: **`c6`**

Cadastre a conta C6 em **Billing → Tesouraria → Contas** com template **C6 Bank** e marque como padrão.

### Migration

`094_billing_c6_pix_template.sql` — adiciona `c6` ao CHECK de `pix_export_template`.  
Dev: `npm run billing:migrate:094`

---

## Viável agora (sem novo desenvolvimento grande)

- Fechar ciclo → aprovar acertos → **baixar XLSX C6** e subir no Web Banking PJ
- Acompanhar comissões parceiro/líder nos relatórios billing
- Conciliar pagamentos do lote com movimentos importados na tesouraria
- Usar cotas/INSS/seguradora dos relatórios billing para obrigações cooperado
- Continuar usando **dash_dre_flux** para DRE gerencial, Simples e preditivo até haver motor equivalente

---

## Gaps — o que seria uma “Fase 9” (DRE gerencial)

Para substituir ou unificar com o dash, seria necessário:

1. **Plano de contas** mapeável (`billing_chart_of_accounts`) com classificação fixo/variável/não operacional (reutilizar mapa do `process_data.py`).
2. **Motor de agregação** mensal: somar `billing_invoices` (receita), `billing_expenses` + AP empresa, settlements por farmácia/CC, comissões.
3. **Rateio** por farmácia / entidade legal (Flux vs Coop) — parte já existe nos acertos.
4. **API + UI** estilo dash: DRE financeiro, gerencial, ranking farmácias (pode consumir dados do workspace billing, não Supabase separado).
5. **Opcional**: importador do mesmo Excel que o dash usa, para conciliação histórica.

Prioridade sugerida: **(1) ranking farmácias receita/despesa** e **(2) DRE gerencial simplificado** a partir de dados já no billing — maior valor com menor esforço.

---

## Referências no repositório

| Item | Caminho |
|------|---------|
| Template C6 (cópia versionada) | `apps/api-service/assets/billing/c6-template-pagar-salarios-via-pix.xlsx` |
| Geração XLSX | `apps/api-service/src/lib/billingC6PixExport.ts` |
| Orquestração export / auto | `apps/api-service/src/lib/billingPixBatchExport.ts` |
| Hook pós-aprovação | `apps/api-service/src/routes/billing/settlements.ts` |
| Dash ETL | `dash_dre_flux/etl/process_data.py` |
| Roadmap billing | `docs/BILLING_MODULE_ROADMAP.md` |
