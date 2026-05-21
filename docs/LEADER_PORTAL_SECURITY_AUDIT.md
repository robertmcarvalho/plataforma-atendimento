# Auditoria de Segurança — Portal do Líder (`leader-portal.ts`)

**Data:** 2026-05-19  
**Escopo:** IDOR, isolamento multi-tenant, superfície de ataque  
**Método:** Revisão estática + smoke `scripts/security/leader-portal-idor-smoke.mjs`

---

## Resumo

| Classificação | Antes | Depois (patches aplicados) |
|---------------|-------|----------------------------|
| CRÍTICO | 4 | 0 (mitigados no código) |
| ALTO | 3 | 1 (stats import rows — validar em staging) |
| MÉDIO | 4 | 3 |
| BAIXO | 2 | 2 |

**Recomendação:** rodar smoke IDOR em staging após deploy; incluir segundo líder real (workspace B) para validação com UUIDs verdadeiros.

---

## Controles existentes (OK)

| Controle | Rotas |
|----------|-------|
| Autenticação JWT | Hook global `preHandler` |
| `leaderId` / `leaderWorkspaceId` do perfil | Hook — não confia no body |
| `isDriverInLeaderScope` | `drivers/:id`, `termination-requests`, `pre-registrations` (parcial) |
| Dev routes gated | `ENABLE_DEV_ROUTES === 'true'` |
| OTP rate limit | 3 / 15 min |
| OTP hash + tentativas | verify com max 5 |
| `LEADER_WHATSAPP_OTP_SECRET` obrigatório em produção | `resolveOtpSecret()` |
| Supply list scoped | `workspace_id` + `leader_id` |
| Termination list | `metadata->>leader_id` |

---

## Achados corrigidos neste ciclo

### LP-001 — CRÍTICO — POST `/absences` sem escopo de entregador/farmácia

- **Evidência:** insert em `financial_entries` só com `workspace_id`; `driver_id` / `pharmacy_id` arbitrários.
- **Impacto:** Lançamento financeiro indevido no workspace.
- **Correção:** `isDriverInLeaderScope` + `assertPharmaciesInLeaderScope`.
- **Bloqueava produção:** Sim.

### LP-002 — CRÍTICO — POST `/dailies` (mesmo padrão)

- **Correção:** idem LP-001.

### LP-003 — CRÍTICO — POST `/supply-requests` sem validação de rede

- **Correção:** escopo driver + farmácia.

### LP-004 — ALTO — PATCH `/supply-requests/:id` sem `leader_id`

- **Impacto:** Líder A alterava pedido do líder B (mesmo workspace).
- **Correção:** filtro `.eq('leader_id', leaderId)` em select/update.

### LP-005 — ALTO — `getLeaderManagedPharmacyIds` sem `workspace_id`

- **Impacto:** farmácias de outro tenant se links órfãos.
- **Correção:** re-filtro por `pharmacies.workspace_id` do líder.

### LP-006 — ALTO — GET `/pharmacies` sem `.eq('workspace_id')`

- **Correção:** filtro explícito.

### LP-007 — MÉDIO — PATCH/GET drivers sem `workspace_id` na query

- **Correção:** `.eq('workspace_id', leaderWorkspaceId)`.

### LP-008 — MÉDIO — `pending_tasks` desligamento sem `workspace_id`

- **Correção:** campo em insert.

### LP-009 — MÉDIO — OTP verify upsert `contacts` sem `workspace_id`

- **Correção:** `workspace_id` em update/upsert.

### LP-010 — MÉDIO — `/stats` agregações financeiras sem `workspace_id`

- **Correção:** filtro em `financial_entries` e `financial_import_rows`.

---

## Achados remanescentes (monitorar)

### LP-R01 — MÉDIO — Hook não exigia `role === 'leader'` — **corrigido**

- Agora retorna 403 se `role !== 'leader'` (exceto `platform_admin` / `platform_owner`).

### LP-R02 — MÉDIO — Flow runtime / tasks sem limite de loop

- Fora do arquivo; ver orchestrator `conversationFlowRuntime.ts`.

### LP-R03 — BAIXO — `debug_code` em OTP quando dev routes

- Mitigado se `ENABLE_DEV_ROUTES=false` em produção.

### LP-R04 — BAIXO — `/reminders/test` dispara lembretes globais

- Gated por dev routes; não expor em prod.

---

## Matriz de rotas (pós-correção)

| Rota | Escopo driver | Escopo farmácia | Escopo workspace | Escopo leader |
|------|---------------|-------------------|------------------|---------------|
| GET /me | — | — | implícito | sim |
| GET /drivers | rede | — | sim | — |
| GET /drivers/:id | sim | — | sim | — |
| PATCH /drivers/:id/schedule | sim | — | sim | — |
| POST /absences | sim | sim | sim | — |
| POST /dailies | sim | sim | sim | — |
| POST /supply-requests | sim | sim | sim | — |
| PATCH /supply-requests/:id | — | — | sim | sim |
| POST /termination-requests | sim | — | sim | metadata |
| POST /pre-registrations | — | sim | sim | — |

---

## Testes automatizados

```powershell
$env:API_BASE_URL="https://api-staging..."
$env:LEADER_A_EMAIL="lider-a@..."
$env:LEADER_A_PASSWORD="..."
# Opcional: UUID real de driver de outro workspace
$env:LEADER_B_DRIVER_ID="..."
node scripts/security/leader-portal-idor-smoke.mjs
```

Critério: todos os casos `PASS` com status 403/404.

---

## Rollback

Reverter commits em `leader-portal.ts` e `leaderPortalScope.ts` via deploy Cloud Run revision anterior.
