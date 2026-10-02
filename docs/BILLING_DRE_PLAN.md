# DRE gerencial Aethera — plano e implementação

**Cutover oficial:** `2026-07` (julho/2026)  
**Substitui:** `dash_dre_flux` para análise operacional (sem importação de histórico)  
**Relacionado:** [BILLING_MODULE_ROADMAP.md](./BILLING_MODULE_ROADMAP.md), [BILLING_DRE_INTEGRATION.md](./BILLING_DRE_INTEGRATION.md)

---

## 1. Princípios

| Regra | Implementação |
|-------|----------------|
| Dois DREs separados | APIs e UI com entidade `coop` \| `flux` |
| Competência | Mês civil via `apuracao_end` dos ciclos com acertos aprovados/pagos |
| Imposto na competência da receita | `billing_dre_tax_rules` × base de receita do mês |
| Pró-labore = custo Flux | AP `shareholder` + `category=pro_labore` + `legal_entity_type=flux` |
| Repasse cooperado = custo Coop | `net_driver_payout_cents` por farmácia |
| Rateio global → farmácia | ∝ receita da entidade (`coop_cents` ou `flux_cents`) por `pharmacy_id` |
| CC = agrupamento | Várias farmácias por CC; drill-down primário é farmácia |
| Período fechado | `billing_dre_periods.status=closed` bloqueia recálculo |

Meses anteriores a `2026-07` retornam aviso de cutover (sem dados).

---

## 2. Plano de contas (seed automático)

### CoopMob

| Código | Linha |
|--------|-------|
| C-REV | Receita entregas |
| C-CV-REP | Repasse cooperados |
| C-CV-COM | Comissões comerciais (parceiro `default_entity=coop`) |
| C-CF-INSS | INSS cooperados (provisão — v2 automática) |
| C-CF-ADM | Despesas administrativas |
| C-IMP-ISS | ISS (competência) |
| C-RES | Resultado |

### Flux Farma

| Código | Linha |
|--------|-------|
| F-REV | Receita serviço |
| F-CV-LID | Comissão líderes |
| F-CV-COM | Comissões comerciais Flux |
| F-CF-PL | Pró-labore sócios |
| F-CF-PRV | Prestadores internos |
| F-CF-ADM | Despesas administrativas |
| F-IMP-SNP | Simples Nacional (competência) |
| F-IMP-OUT | Outros tributos |
| F-RES | Resultado |

Contas criadas em `ensureDreAccounts()` na primeira apuração.

---

## 3. Fontes de dados

| Linha DRE | Fonte |
|-----------|-------|
| Receita Coop | `billing_settlements.coop_cents` |
| Receita Flux | `billing_settlements.flux_cents` |
| Repasse | `billing_settlements.net_driver_payout_cents` |
| Comissão líder | `billing_leader_commission_accruals` |
| Comissão parceiro | `billing_commission_accruals` + `default_entity` |
| Pró-labore | `billing_payables` (shareholder, pro_labore, flux) |
| Prestadores | `billing_payables` (internal_provider) |
| Despesas | `billing_expenses` (approved/paid), rateio CC → farmácias |
| Impostos | `billing_dre_tax_rules` (Simples Flux, ISS Coop) |
| INSS Coop | Base `buildInssAccountingReport` × alíquota `inss_cooperados` |

---

## 4. Rateio

1. **Direto por farmácia:** receita, repasse, comissão líder (já tem `pharmacy_id`).
2. **Despesa com `allocation` (CC %):** distribui dentro do CC ∝ receita das farmácias daquele CC.
3. **Despesa com `cost_center_id`:** idem.
4. **Despesa global:** ∝ receita entidade em todas as farmácias com receita no mês.
5. **Despesa `both`:** split via `entity_split_*` no tipo (default 50/50).
6. **Imposto:** ∝ receita por farmácia.

---

## 5. APIs

| Método | Rota | Descrição |
|--------|------|-----------|
| GET | `/api/billing/dre/config` | Cutover month |
| GET | `/api/billing/dre/{coop\|flux}?month=` | Relatório live |
| POST | `/api/billing/dre/{entity}/recalculate` | Persiste snapshot |
| POST | `/api/billing/dre/{entity}/close` | Fecha período |
| GET | `/api/billing/dre/{entity}/export?month=` | CSV download |
| GET | `/api/billing/dre/tax-rules` | Listar alíquotas |
| PATCH | `/api/billing/dre/tax-rules/:id` | Atualizar alíquota |
| POST | `/api/billing/dre/{entity}/reopen` | Reabre período |

---

## 6. UI

`/billing/relatorios/dre` — consolidado, farmácia, centro de custo, export CSV, fechar período.

`/billing/config?tab=impostos-dre` — alíquotas Simples, ISS e INSS cooperados.

---

## 7. Migration e deploy

```bash
npm run billing:migrate:095   # somente banco dev (ojzzx)
```

Tabelas: `billing_dre_accounts`, `billing_dre_tax_rules`, `billing_dre_periods`, `billing_dre_snapshots`, `billing_dre_snapshot_lines`.

---

## 8. Backlog (pós-MVP DRE)

- Export XLSX (opcional)
- Linha não operacional / distribuição de lucro
- DRE caixa (tesouraria) como visão auxiliar

---

## 9. Operação mensal recomendada

1. Fechar ciclos e aprovar acertos do mês  
2. Gerar folha empresa (pró-labore Flux)  
3. Lançar/aprovar despesas do mês  
4. Apurar comissões líder/parceiro  
5. Abrir DRE → Recalcular Coop e Flux  
6. Revisar por farmácia → Fechar período  
