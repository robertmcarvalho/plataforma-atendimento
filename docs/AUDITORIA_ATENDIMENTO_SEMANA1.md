# Auditoria de atendimentos — semana 1 de produção

**Data:** 2026-06-17  
**Ambiente:** produção (`omhlb` / Flux Farma)  
**Janela analisada:** últimos 7 dias (+ revisão de código)  
**Script de auditoria:** `scripts/one-off/audit-attendance-week-prod.mjs`

---

## 1. Resumo executivo

Após uma semana de uso operacional, a plataforma apresenta **problemas estruturais** (não apenas cosméticos) em quatro áreas reportadas pelo time:

| Área | Severidade | Status em prod (7d) |
|------|------------|---------------------|
| Duplicação de atendimentos (mesmo telefone) | **P0** | 2 telefones com 2 conversas abertas simultâneas |
| Mensagem fora do horário (OOH) | **P0** | Apenas **1** conversa com tag `out_of_hours` na semana |
| Transferência entre setores | **P1** | Bloqueio na UI (lista de atendentes filtrada por setor) |
| Notas internas com autor errado | **P0** | Notas automáticas (SLA/bot) assinadas como **IVAN SOUZA SANTOS (líder)** — 85 notas em 7d |
| Bugs de chat / inbox | **P1** | Deep link ignorado, threads duplicadas visíveis, ordem de mensagens indefinida na API |

Este documento lista **todos os bugs identificados** (código + evidência) e uma **proposta de correção** priorizada em fases.

---

## 2. Evidências de produção (últimos 7 dias)

### 2.1 Volume

- **47** conversas criadas/atualizadas: 32 `open`, 15 `resolved`
- **0** mensagens outbound com status `failed`
- **0** contatos duplicados por dígitos normalizados (índice de telefone em contatos OK)

### 2.2 Duplicatas de atendimento aberto

| Telefone | Conversas abertas | Setores |
|----------|-------------------|---------|
| `5527988551464` | 2 | Atendimento Geral + *(sem setor)* |
| `5562981600030` | 2 | *(sem setor)* + Suporte Técnico |

### 2.3 Horário de atendimento configurado

| Recurso | Estado |
|---------|--------|
| Setores (Atendimento Geral, Financeiro, etc.) | `business_hours.weekly` **canônico** ✓ |
| Canal operacional "Atendimento Flux Farma" | `business_hours`: **null** |
| Canal comercial "Comercial Flux Farma" | `business_hours.weekly` presente |
| `workspace_out_of_hours_rules` | `is_active: false`, mas mensagem cadastrada |
| Conversas com tag `out_of_hours` (7d) | **1** |

### 2.4 Notas internas — autores (7 dias)

| Autor exibido | Papel | Quantidade | Observação |
|---------------|-------|------------|------------|
| IVAN SOUZA SANTOS | leader | **85** | Inclui notas `[SLA Tickets]` automáticas |
| Naiara de Sousa | sales | 17 | Notas manuais / portal comercial |
| Robert | admin | 1 | — |

**Amostra de nota automática com autor errado:**

```
[SLA Tickets] Escalonamento por SLA vencido — Ticket vencido no SLA...
autor exibido: IVAN SOUZA SANTOS (leader)
```

---

## 3. Catálogo de bugs

Legenda de severidade: **P0** crítico operacional · **P1** alto · **P2** médio · **P3** baixo/UX

---

### BUG-001 — Duplicação de conversas abertas para o mesmo telefone (P0)

**Sintoma:** Dois ou mais atendimentos abertos para o mesmo número; inbox mostra threads duplicadas.

**Evidência:** Seção 2.2; scripts `audit-commercial-phone-full-prod.mjs`, `audit-attendance-week-prod.mjs`.

**Causa raiz:**

1. **Sem constraint única** no banco para “uma conversa aberta/pending por contato” — apenas índice não-único (`037_conversations_workspace_channel.sql`).
2. **Check-then-insert** sem transação em:
   - `apps/orchestrator-service/src/handlers/persistInboundFast.ts`
   - `apps/orchestrator-service/src/legacyBotRuntime.ts` (`getActiveConversation` → `createConversation`)
   - `apps/api-service/src/routes/conversations.ts` (`POST /conversations/start`)
   - `apps/api-service/src/routes/commercial/leads.ts` (`POST /leads/:id/conversation/start`)
3. **Regras de reopen inconsistentes:** API staff cria nova conversa `open`; inbound reabre `resolved` — duas abertas coexistem.
4. **`maybeSingle()` com múltiplas abertas** retorna erro ignorado → nova conversa criada (efeito bola de neve).
5. Lookup por canal: conversa aberta no canal A não é encontrada no canal B.

**Arquivos:** `persistInboundFast.ts`, `legacyBotRuntime.ts`, `conversations.ts`, `leads.ts`, migration `037`.

---

### BUG-002 — Deep link `conversation_id` ignorado na inbox (P1)

**Sintoma:** Ao abrir chat pelo comercial (`/inbox?commercial_lead_id=…&conversation_id=…`), a inbox seleciona **outra** conversa (geralmente a primeira da lista).

**Causa raiz:** `useOperationalContext.ts` lê só `commercial_lead_id`; **`conversation_id` nunca é consumido** em `useInboxPageState` / `useInboxQueries`.

**Arquivos:** `CommercialChatDrawer.tsx`, `useOperationalContext.ts`, `useInboxQueries.ts`.

---

### BUG-003 — Lista da inbox exibe duplicatas sem deduplicação (P1)

**Sintoma:** Mesmo telefone aparece várias vezes no painel esquerdo.

**Causa raiz:** API retorna todas as conversas abertas; **sem agrupamento** por `contact_id` / `wa_phone` no front (`inboxListFilters.ts`).

**Relacionado:** BUG-001.

---

### BUG-004 — Mensagem fora do horário não enviada na primeira mensagem (P0)

**Sintoma:** Cliente manda WhatsApp fora do horário; bot **não** responde com aviso configurado.

**Evidência:** Apenas 1 conversa com tag `out_of_hours` em 7 dias; setores têm horário canônico configurado.

**Causa raiz:**

1. **OOH operacional só após roteamento de setor** — `maybeOutOfHoursNotice()` em `conversationSla.ts` é chamada **depois** que `sector_id` é definido (`legacyBotRuntime.ts` em `routeToSector*`). Mensagens **antes da triagem** não disparam OOH.
2. Se `attendant_id` já está setado, **todo o bot é ignorado** (`legacyBotRuntime.ts` ~177), incluindo OOH.
3. Canal operacional sem `business_hours` no config — não afeta setor, mas confunde operação.
4. Caminho comercial usa `channel.config.business_hours`; operacional usa `sectors.business_hours` + `workspace_out_of_hours_rules` — **configurações desconectadas**.

**Arquivos:** `conversationSla.ts`, `legacyBotRuntime.ts`, `commercialBotRuntime.ts`, `workspaceCatalogs.ts`.

---

### BUG-005 — Flag `is_active` da regra OOH ignorada no runtime (P2)

**Sintoma:** Operador desativa OOH no catálogo (`is_active: false`); mensagem ainda pode ser enviada via fallback `app_settings` / texto padrão.

**Causa raiz:** `maybeOutOfHoursNotice` usa `is_active` só para escolher template da regra; se inativa, **cai no fallback** e continua enviando.

**Evidência prod:** `workspace_out_of_hours_rules.is_active = false` com template preenchido.

**Arquivos:** `conversationSla.ts` vs simulação em `workspaceCatalogs.ts`.

---

### BUG-006 — Template OOH do catálogo/canal não usado no bot operacional (P2)

**Sintoma:** Texto configurado em “mensagens do canal” ou catálogo não aparece; outro texto (padrão ou `app_settings`) é enviado.

**Causa raiz:** Operacional lê `workspace_out_of_hours_rules` e `app_settings.auto_reply_out_of_hours`; **não** lê `workspace_flow_messages` nem `channel.config.messages.out_of_hours`.

**Arquivos:** `conversationSla.ts`, `commercialBotRuntime.ts` (comercial OK).

---

### BUG-007 — Transferência: atendentes de outros setores não aparecem (P1)

**Sintoma:** Ao transferir, não é possível escolher colega de outro setor.

**Causa raiz:** Modal chama `GET /api/users/attendants` **sem** `scope=workspace`. API filtra por setor do JWT (`users.ts` ~285-341). Admins veem todos; atendentes/supervisores só o próprio setor.

**Arquivos:** `useInboxQueries.ts` (~325), `users.ts`, `InboxModals.tsx`.

---

### BUG-008 — Transferência: lista de atendentes não filtra pelo setor destino (P2)

**Sintoma:** Ao mudar o setor no modal, a lista de atendentes não atualiza para aquele setor.

**Causa raiz:** `users` carregados uma vez; resposta **não inclui `sector_id`** por atendente; sem refetch ao mudar `transferSectorId`.

**Arquivos:** `InboxModals.tsx`, `users.ts`, `useInboxActions.ts`.

---

### BUG-009 — Transferência sem validação de permissão na API (P2)

**Sintoma:** Endpoint aceita transferência sem checar permissão `conversations.transfer`.

**Causa raiz:** `POST /api/conversations/:id/transfer` usa só `authenticate`.

**Arquivos:** `conversations.ts` (~550).

---

### BUG-010 — Notas automáticas assinadas por usuário aleatório (P0)

**Sintoma:** Notas de SLA, triagem e bot aparecem como escritas por líder, vendedor ou atendente “qualquer”.

**Evidência prod:** 85 notas de IVAN (leader) na semana, incluindo `[SLA Tickets]` automáticas.

**Causa raiz:** Cinco implementações usam `SELECT id FROM users … LIMIT 1` (sem `ORDER BY`) como `author_id` de “sistema”:

| Local | Função |
|-------|--------|
| `apps/api-service/src/routes/tasks.ts` | `resolveSystemNoteAuthorId()` — `is_active=true LIMIT 1` |
| `apps/scheduler-service/src/jobs/ticketsSlaJobs.ts` | idem |
| `apps/scheduler-service/src/jobs/queueSlaJobs.ts` | inline |
| `apps/scheduler-service/src/jobs/advanceTasksSlaJobs.ts` | inline |
| `apps/orchestrator-service/src/legacyBotRuntime.ts` | `getSystemNoteAuthorId()` — **primeiro user da tabela** (sem filtro ativo) |

Não existe usuário **“Sistema”** dedicado. O primeiro usuário criado (líder Ivan) vira autor de todas as notas automáticas.

---

### BUG-011 — Notas do portal do líder confundem autor com conteúdo (P2)

**Sintoma:** Nota de contexto mostra líder como autor; corpo menciona “Líder/contato”, “Entregador”.

**Causa raiz:** `leaderConversationStart.ts` usa `author_id = user.sub` do líder; corpo gerado por `formatConsolidatedAttendanceNote`.

**Arquivos:** `leaderConversationStart.ts`, `advanceDecisionFollowup.ts`.

---

### BUG-012 — Insert de nota sem `author_id` (P1)

**Sintoma:** Algumas notas de follow-up de adiantamento não persistem.

**Causa raiz:** `advanceRejectionFollowup.ts` faz `insert` **sem** `author_id` (NOT NULL).

**Arquivos:** `apps/orchestrator-service/src/lib/advanceRejectionFollowup.ts` (~158-162).

---

### BUG-013 — Notas do bot sem `workspace_id` (P2)

**Sintoma:** Risco de isolamento multi-tenant / RLS inconsistente.

**Causa raiz:** `createBotInternalNote()` em `legacyBotRuntime.ts` insere só `conversation_id`, `author_id`, `content`.

---

### BUG-014 — API de contato sem variantes de telefone (P1)

**Sintoma:** Mesmo número em formatos diferentes pode gerar contatos distintos ao iniciar conversa pela API.

**Causa raiz:** `conversations.ts` e `leads.ts` usam `.eq('wa_phone', waPhone)` exato; orchestrator usa `waPhoneLookupVariants`.

**Arquivos:** `conversations.ts`, `leads.ts` vs `legacyBotRuntime.ts`, `findCommercialLeadByPhone.ts`.

---

### BUG-015 — `primary_conversation_id` desatualizado com múltiplas conversas (P2)

**Sintoma:** CRM/comercial abre thread diferente da inbox.

**Causa raiz:** Staff/commercial start sempre sobrescreve `primary_conversation_id`; inbound só preenche se null.

**Arquivos:** `leads.ts`, `persistInboundFast.ts`, `legacyBotRuntime.ts`.

---

### BUG-016 — Mensagens na API sem ordenação garantida (P3)

**Sintoma:** Ordem incorreta ao carregar conversa (intermitente).

**Causa raiz:** `GET /api/conversations/:id` embede `messages` **sem** `.order()` (`conversations.ts` ~367).

**Mitigação atual:** front reordena em `inboxThread.ts`.

---

### BUG-017 — Histórico de notas sem humanização (P3)

**Sintoma:** Modal “Histórico” mostra texto cru `[SLA Tickets]…` enquanto o thread humaniza.

**Causa raiz:** `InboxModals.tsx` usa `n.content` direto; thread usa `humanizeInternalNoteContent`.

---

### BUG-018 — Vincular contato não mescla conversas duplicadas (P2)

**Sintoma:** Após resolver 409 de telefone duplicado, conversas abertas paralelas permanecem.

**Causa raiz:** `useInboxActions.ts` só atualiza `contact_id` da conversa atual.

---

### BUG-019 — Leader portal: múltiplas conversas abertas por setor (P2)

**Sintoma:** Líder pode ter mais de um atendimento aberto para o mesmo contato em setores diferentes.

**Causa raiz:** `POST /conversations/start` filtra existente por `sector_id` (`conversations.ts` ~741).

---

### BUG-020 — Realtime limitado à conversa ativa (P3)

**Sintoma:** Lista da inbox atrasa até 12s (poll) para novas mensagens em outras conversas.

**Causa raiz:** Supabase realtime só na conversa selecionada (`useInboxQueries.ts` ~307).

---

## 4. Proposta de correção (por fase)

### Fase 1 — Estabilização imediata (1–2 semanas, P0)

#### 1.1 Duplicatas de atendimento (BUG-001, 014, 015, 018)

| Ação | Detalhe |
|------|---------|
| **Migration** | Índice único parcial: `UNIQUE (workspace_id, contact_id) WHERE status IN ('open','pending')`. Opcional: incluir `workspace_channel_id` se política for por canal. |
| **Helper único** | `resolveOrCreateConversation()` em `packages/channel-runtime` ou `api-service/lib`, usado por orchestrator + API. |
| **Transação** | `SELECT … FOR UPDATE` no contato ou advisory lock por `(workspace_id, canonical_phone)` antes do insert. |
| **Alinhar reopen** | `POST /conversations/start` deve reutilizar `resolved` como inbound/commercial. |
| **Telefone** | Reutilizar `waPhoneLookupVariants` em todas as rotas API; retry em 23505 no insert de contato. |
| **Script one-off** | Mesclar duplicatas atuais (fechar conversa mais antiga, mover mensagens, atualizar `primary_conversation_id`). Base: `close-stale-duplicate-conversation-prod.mjs`. |
| **UI** | Ler `conversation_id` da URL (BUG-002); alerta visual se >1 open para mesmo telefone. |

#### 1.2 Notas internas — autor correto (BUG-010, 012, 013)

| Ação | Detalhe |
|------|---------|
| **Usuário sistema** | Criar `users` por workspace: nome **“Sistema”**, role técnica, `is_active=true`. |
| **Helper central** | `packages/operational-notes` ou `api-service/lib/systemNoteAuthor.ts` — única função `getSystemNoteAuthorId(workspaceId)`. |
| **Env** | `SYSTEM_NOTE_AUTHOR_ID` (workspace-scoped ou global) em API, scheduler, orchestrator. |
| **Migrar call sites** | Substituir 5 implementações duplicadas. |
| **Fix insert** | `advanceRejectionFollowup.ts`: sempre `author_id` + `workspace_id`. |
| **API** | Expor `source: 'manual' \| 'system'` e `author_id` no GET conversa. |
| **UI** | Notas sistema: label **“Sistema”** ou ícone bot; líder portal: **“Portal do Líder · {nome}”**. |

#### 1.3 OOH na primeira mensagem (BUG-004, 005, 006)

| Ação | Detalhe |
|------|---------|
| **Disparo antecipado** | Chamar `maybeOutOfHoursNotice` no **primeiro inbound** após criar/resolver conversa, usando setor default ou horário do workspace até triagem. |
| **Resolver unificado** | Função `resolveOutOfHoursMessage(workspaceId, channelId, sectorId)` — ordem: regra ativa → canal → setor → settings → default. |
| **Respeitar `is_active`** | Se regra global `is_active=false` **e** flag workspace `ooh_enabled=false`, não enviar. |
| **Não bloquear por attendant** | Enviar OOH mesmo com bot pausado, se ainda não houve tag `out_of_hours`. |
| **Métrica** | Log estruturado + tag `out_of_hours` para auditoria. |
| **Config** | Preencher `business_hours` no canal operacional ou documentar que OOH operacional = setor. |

---

### Fase 2 — Fluxo de transferência e inbox (1 semana, P1)

#### 2.1 Transferência cross-setor (BUG-007, 008, 009)

| Ação | Detalhe |
|------|---------|
| **Front** | `GET /api/users/attendants?scope=workspace` no modal de transferência (ou `scope=sector&sector_id={destino}`). |
| **Filtrar por setor** | Ao mudar setor destino, filtrar atendentes com `user_sectors` naquele setor. |
| **API** | Incluir `sector_ids[]` na resposta de attendants. |
| **Validação** | Opcional: exigir que `to_attendant_id` pertença ao `to_sector_id` (configurável). |
| **Permissão** | `requirePermission('conversations.transfer')` no endpoint. |
| **UX** | Limpar `transferAttendantId` ao mudar setor. |

#### 2.2 Inbox / chat (BUG-002, 003, 016, 017, 020)

| Ação | Detalhe |
|------|---------|
| Deep link `conversation_id` | `useInboxPageState`: se param presente, `setActiveId(conversation_id)`. |
| Dedupe lista | Agrupar por `contact.wa_phone` com badge “+N threads” ou auto-merge após Fase 1. |
| API order | `.order('created_at')` em messages no GET conversa. |
| Histórico | Aplicar `humanizeInternalNoteContent` no modal. |
| Realtime lista | Considerar canal SSE já existente (`useInboxEventStream`) para refresh imediato. |

---

### Fase 3 — Hardening e governança (2–3 semanas, P2–P3)

| Item | Ação |
|------|------|
| BUG-011 | Notas do líder: autor sistema + metadado `initiated_by_leader_id` |
| BUG-019 | Leader start: uma conversa aberta por contato (não por setor) |
| Observabilidade | Dashboard: duplicatas abertas, OOH enviados/dia, notas por `source` |
| Testes | E2E: inbound concorrente, OOH fora do horário, transfer cross-setor |
| Runbook | `docs/OPERACOES_ATENDIMENTO.md` — duplicata, merge manual, OOH |

---

## 5. Ordem de implementação sugerida

```
Sprint A (P0)
├── Migration unique open conversation + merge script prod
├── resolveOrCreateConversation (orchestrator + API)
├── Usuário Sistema + helper author_id único
└── OOH no primeiro inbound + is_active respeitado

Sprint B (P1)
├── Inbox: conversation_id deep link
├── Transfer: scope=workspace + filtro por setor
└── API contact phone variants

Sprint C (P2/P3)
├── UI dedupe / alertas
├── Permissões transfer
├── Histórico humanizado + message order API
└── Testes e documentação operacional
```

---

## 6. Critérios de aceite

| Bug | Aceite |
|-----|--------|
| Duplicatas | 0 telefones com >1 conversa `open/pending` após script + 7 dias sem regressão |
| OOH | Mensagem enviada em ≤30s do primeiro inbound fora do horário; tag `out_of_hours` |
| Transferência | Atendente do Setor A transfere para atendente listado no Setor B |
| Notas | 100% notas `[SLA…]` / bot com autor “Sistema”; manuais com JWT do operador |
| Inbox | Link comercial com `conversation_id` abre thread correta |

---

## 7. Scripts e referências

| Script | Uso |
|--------|-----|
| `scripts/one-off/audit-attendance-week-prod.mjs` | Auditoria semanal read-only |
| `scripts/one-off/audit-commercial-phone-full-prod.mjs` | Duplicata + latência por telefone |
| `scripts/one-off/audit-inbox-visibility-prod.mjs` | Visibilidade inbox vs banco |
| `scripts/one-off/close-stale-duplicate-conversation-prod.mjs` | Fechar duplicata manual |
| `scripts/one-off/sync-operational-channel-motor-prod.mjs` | Motor OOH/fila no canal operacional (prod) |
| `supabase/migrations/098_conversations_one_open_per_contact.sql` | Índice único open/pending por contato |
| `supabase/migrations/099_system_note_users.sql` | Usuário "Sistema" por workspace |
| `scripts/db/apply-migration-098-conversations-one-open.mjs` | Aplicar 098 em prod |
| `scripts/db/apply-migration-099-system-note-users.mjs` | Aplicar 099 em prod |

**Código principal:** `persistInboundFast.ts`, `legacyBotRuntime.ts`, `conversationSla.ts`, `conversations.ts`, `users.ts`, `tasks.ts`, `ticketsSlaJobs.ts`, `useInboxQueries.ts`, `InboxModals.tsx`.

---

## 8. Riscos da correção

| Risco | Mitigação |
|-------|-----------|
| Unique index falha se duplicatas existirem | Rodar merge **antes** da migration |
| OOH em excesso (spam) | Manter tag `out_of_hours` one-shot + cooldown 24h comercial |
| `scope=workspace` expõe nomes | OK para transferência interna; não expor dados sensíveis além do nome |
| Usuário Sistema em relatórios | Filtrar `source=system` em exports |

---

## 9. Comportamento esperado vs implementado (2026-06-17)

### Bugs corrigidos no código

| Bug | Correção |
|-----|----------|
| **001** | Migration `098` + lookup unificado por contato (`resolveConversation`, `mergeDuplicateOpenConversations`) |
| **002** | `conversation_id` na URL seleciona thread em `useInboxQueries` |
| **003** | `dedupeInboxConversationsByPhone` na lista da inbox |
| **004–006** | Motor do canal (`operationalChannelMessaging.ts`); `is_active` legado respeitado sem motor |
| **007–008** | Transferência com `scope=workspace` + filtro por setor destino |
| **009** | `requireConversationsTransfer` no POST transfer |
| **010–013** | `resolveSystemNoteAuthorId` / usuário Sistema (`099`) + `workspace_id` em notas bot |
| **014–015** | `waPhoneLookupVariants` na API + `updatePrimaryConversationIfActive` |
| **016** | Ordenação de `messages` no GET conversa |
| **017** | `humanizeInternalNoteContent` no modal Histórico |
| **018** | `merge_duplicate_open` ao vincular contato |
| **019** | Leader `/start` sem filtro por setor na conversa aberta |
| **020** | SSE inbox (`useInboxEventStream`) já complementa realtime |

### Deploy pendente

Aplicar migrations `098` e `099` em produção; deploy API + orchestrator + scheduler + web.

---

*Documento gerado a partir de auditoria de código + consulta read-only ao banco de produção. Revisar após implementação da Fase 1.*
