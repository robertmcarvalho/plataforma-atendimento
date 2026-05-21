# Copiloto interno — arquitetura

## Visão geral

- O frontend (Inbox) chama apenas o backend: `POST /api/copilot/chat`.
- O backend (`apps/api-service`) monta um `CONTEXTO_JSON` com dados **somente leitura** do Supabase e envia ao **Google Gemini** usando a chave em variável de ambiente.
- Não há chamada ao Gemini a partir do browser; a chave **nunca** deve ir para o Next.js público.

## Fluxo

1. Autenticação JWT (`authenticate` no Fastify).
2. Feature flag `COPILOT_ENABLED` (desliga o endpoint sem deploy de código).
3. Rate limit por usuário (memória, janela de 1 minuto).
4. Se `conversation_id` for enviado: carregar contexto mínimo da conversa + mensagens recentes (CPF/telefone mascarados no JSON).
5. `gatherEntityToolResults`: buscas heurísticas (CPF, UUID, texto) em `drivers`, `pharmacies`, `leaders`; `financial_entries` apenas se o perfil tiver permissão financeira.
6. Chamada ao Gemini (`gemini-2.5-flash` por padrão, configurável via `GEMINI_MODEL`).
7. Auditoria: `writeAuditLog` com `action: copilot.query` e prévia curta da pergunta.

## RBAC

- Financeiro: `canViewFinancialData` em `apps/api-service/src/lib/copilotContext.ts` — roles `admin`, `supervisor`, `financial`, `operational` ou `permissions.financial.view`.
- Sem permissão: não há payload de lançamentos; pode aparecer nota no contexto para o modelo não inventar valores.

## Limitações do MVP

- Sem function-calling iterativo no Gemini: o servidor pré-coleta dados com heurísticas simples.
- Sem persistência de conversas do copiloto no banco (histórico no `sessionStorage` no cliente).
- O modelo não executa ações (PATCH/POST) — apenas texto de apoio.

## Critérios de avaliação interna (sugestão)

- **Aderência aos dados**: a resposta cita apenas fatos presentes no `CONTEXTO_JSON`?
- **Utilidade**: reduz tempo do atendente (menos cliques / menos consultas manuais)?
- **Segurança**: usuário sem permissão financeira não vê valores sensíveis?
- **Latência**: p95 abaixo do SLA interno definido pelo time?
- **Custo**: tokens médios por pergunta estáveis após ajustes de prompt?
