# Plano de implantação — CRM Comercial (motor operacional + propostas PDF)

**Status:** implementado no código (branch atual). Requer migration `050` + deploy API/Web.

---

## 1. O que foi entregue

| Item | Arquivo / rota | Descrição |
|------|----------------|-----------|
| Perfis `commercial` / `sales` | `050_commercial_roles_and_ops.sql`, `commercialRoles.ts` | Roles criados por workspace; labels na UI (`roleLabels.ts`) |
| Temperatura unificada | `scoring.ts` + `commercialScoring.ts` | Mesma lógica (score default 50, mesmas faixas) |
| Motor operacional | `operationalDimensioning.ts` | `calcularDimensionamentoOperacional()` puro + testes |
| Viabilidade enriquecida | `enhancedViability.ts`, `POST /leads/:id/viability` | Flux (líder/entregadores) + motor financeiro |
| Proposta PDF | `proposalPdf.ts`, `GET /proposals/:id/pdf` | PDF gerado via PDFKit alinhado ao modelo Flux Farma |
| Valor do lead automático | `proposalService.ts` | Na geração da proposta: 12m × receita × **30%** (margem após 70% repasse) |
| Copiloto comercial | `commercialCopilotTools.ts`, `commercialCopilotPrompt.ts` | Tools: ficha, próxima ação, dimensionamento, preço cidade |
| Campos custom horários | `defaultSeed.ts` | perfil_cidade, horários seg–sex/sáb, delivery domingo |

---

## 2. Pré-requisitos de deploy

### 2.1 Migration 050

```bash
node scripts/apply-migration-050-commercial-ops.mjs --execute
```

Ou aplicar manualmente `supabase/migrations/050_commercial_roles_and_ops.sql`.

### 2.2 Feature flag e canal

- `commercial_crm_enabled = true` no workspace
- WhatsApp com `config.purpose = "commercial"` para conversas comerciais

### 2.3 Perfis de usuário

Em **Configurações → Usuários**, selecionar perfil **Comercial** ou **Vendas** (criados automaticamente ao abrir o módulo comercial).

---

## 3. Fluxo recomendado no funil (implementado)

```mermaid
flowchart LR
  A[Qualificar lead] --> B[Diagnóstico]
  B --> C[Aba Viabilidade]
  C --> D[Calcular dimensionamento]
  D --> E[Revisar preview]
  E --> F[Aprovar análise]
  F --> G[Gerar PDF]
```

| Fase | Ação | Endpoint |
|------|------|----------|
| Qualificação / Reunião | Preencher entregas/mês, perfil cidade e horários (editor na ficha) | `PATCH /leads/:id` |
| Diagnóstico+ | Aba **Viabilidade** visível; API retorna 403 antes deste estágio | — |
| Viabilidade | **Calcular dimensionamento** (exige ficha completa; sem defaults silenciosos) | `POST /leads/:id/viability` |
| Aprovação | Consultor clica **Aprovar análise** | `POST /leads/:id/dimensioning/confirm` |
| Proposta | **Gerar PDF** (usa snapshot aprovado, não recalcula) | `POST /proposals` |
| Envio | Baixar PDF | `GET /proposals/:id/pdf` |

**Fonte de dados:** 100% Aethera (Supabase) — `leaders`, `drivers`, `pharmacies.delivery_fee_cents`. Sem API Flux.

**Recalcular** dimensionamento limpa a aprovação (`confirmed_at = null`) — consultor deve aprovar novamente.

**Valor estimado do negócio:** preenchido automaticamente após o cálculo (`deal_value_cents`); exibido na UI somente com `operational_snapshot`.

### Validação local (antes do deploy)

```bash
node scripts/apply-migration-051-commercial-lead-optional.mjs --execute
cd apps/api-service && npm run test:commercial-dimensioning
cd apps/api-service && npm run dev
cd apps/web && npm run dev
```

Roteiro manual: novo lead mínimo (sem CNPJ/contato) → estágios até Reunião sem aba Viabilidade → Diagnóstico com checklist → editar horários (`type=time`) e volume → calcular → aprovar → PDF.

---

## 4. Motor operacional — entradas e saídas

**Entrada principal:** `calcularDimensionamentoOperacional(input)` em `operationalDimensioning.ts`.

**Preço por entrega:** ordem de precedência:
1. `valor_entrega_informado`
2. Média `delivery_fee_cents` das farmácias ativas na cidade (`lookupCityDeliveryPrice`)
3. `valor_entrega_padrao` (R$ 8,50 default)

**Testes:**

```bash
npm run test:commercial-dimensioning -w api-service
```

---

## 5. Copiloto comercial

Quando `commercial_lead_id` é enviado em `POST /api/copilot/chat`:

- System prompt comercial dedicado
- Tools operacionais + comerciais disponíveis
- Atalho **"Próxima ação"** → `suggest_commercial_next_action`

---

## 6. Ajustes pendentes (pós-deploy)

| Prioridade | Item |
|------------|------|
| Alta | Aplicar migration 050 em produção |
| Alta | Preencher `delivery_fee_cents` nas farmácias por cidade (melhora preço automático) |
| Média | UI para editar setup/mensalidade antes de gerar proposta |
| Média | Anexar PDF automaticamente no envio WhatsApp (`POST /proposals/:id/send`) |
| Baixa | Template Word (`Proposta_Royal_Farma.docx`) via docxtemplater (PDFKit já cobre envio) |
| Baixa | Config global comercial na UI (`valor_entrega_padrao`, mínimos) em `/commercial/settings` |

---

## 7. Validação pós-deploy

1. Criar usuário com perfil **Comercial** — deve aparecer no select
2. Lead Farmaxima: temperatura igual no pipeline e na ficha
3. Aba Viabilidade: dimensionamento + valor lead
4. Gerar proposta → baixar PDF → conferir entregadores e financeiro
5. Copiloto → "Próxima ação" → resposta com ações concretas

---

*Gerado em: implantação motor operacional CRM Comercial.*
