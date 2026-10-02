# Staging QA Runbook

Objetivo: aplicar e validar as migrations enterprise em staging antes de qualquer mudança em produção.

## Pré-requisitos

- Snapshot/backup do banco de staging criado e identificado.
- URL de banco de staging em `STAGING_SUPABASE_DB_URL`, `STAGING_DATABASE_URL`, `MIGRATION_STAGING_DB_URL` ou `.secrets/staging-supabase-db-url.txt`.
- Credenciais HTTP de admin de staging em `API_ADMIN_EMAIL` e `API_ADMIN_PASSWORD`.
- `API_BASE_URL` apontando para a API de staging.
- Confirmação explícita: `CONFIRM_STAGING_MIGRATIONS=true`.

## Criar Projeto Supabase Staging

Crie um access token no Supabase com permissão para organizações/projetos e salve localmente:

```powershell
New-Item -ItemType Directory -Force .secrets
Set-Content .secrets/supabase-access-token.txt "sbp_..."
```

Liste suas organizações:

```powershell
npm run staging:supabase:list-orgs
```

Salve o `slug` da organização escolhida:

```powershell
Set-Content .secrets/supabase-org-slug.txt "sua-org-slug"
```

Crie ou reaproveite o projeto staging:

```powershell
$env:CONFIRM_CREATE_SUPABASE_STAGING="true"
npm run staging:supabase:create -- --create
```

O script gera/salva:

- `.secrets/staging-db-password.txt`
- `.secrets/staging-supabase-project-ref.txt`
- `.secrets/staging-supabase-db-url.txt`

## Aplicar Migrations 033-036

Para um projeto staging recém-criado e vazio, aplique primeiro todas as migrations:

```powershell
npm run staging:migrate:all
$env:CONFIRM_STAGING_MIGRATIONS="true"
node scripts/apply-staging-governance-migrations.mjs --all --execute
```

Dry-run sem alterar banco:

```powershell
npm run staging:migrate:governance
```

Execução real em staging:

```powershell
$env:STAGING_SUPABASE_DB_URL="postgresql://..."
$env:CONFIRM_STAGING_MIGRATIONS="true"
npm run staging:migrate:governance -- --execute
```

Alternativa sem expor a URL no shell:

```powershell
New-Item -ItemType Directory -Force .secrets
Set-Content .secrets/staging-supabase-db-url.txt "postgresql://..."
$env:CONFIRM_STAGING_MIGRATIONS="true"
npm run staging:migrate:governance -- --execute
```

O runner aplica `033`, `034`, `035` e `036` em uma única transação. A `035` cria/prepara policies; a `036` desabilita RLS antes do commit, mantendo o rollout progressivo.

## Gates Pós-Migration

```powershell
npm run governance:workspace
npm run db:audit:governance
npm run governance:automations
```

Critérios de aceite:

- `governance:workspace` sem findings.
- `workspace_tables_without_workspace_index` vazio.
- Automations com `legacy_writes_frozen_by_default: true`.
- RLS pode permanecer desabilitado conforme rollout progressivo.

## Stress (somente staging)

```powershell
$env:API_BASE_URL="https://api-staging..."
$env:API_ADMIN_EMAIL="admin-staging@..."
$env:API_ADMIN_PASSWORD="..."
$env:STRESS_DURATION_SEC="60"
$env:STRESS_CONCURRENCY="20"
npm run stress:staging
```

Critérios: taxa de erro &lt; 5%, p95 &lt; 3000 ms. Não executar em produção.

## Pub/Sub inbound (stress de fila)

```powershell
$env:CONFIRM_STAGING_PUBSUB_STRESS="true"
$env:GCP_PROJECT_ID="..."
$env:STRESS_WORKSPACE_ID="<uuid>"
$env:STRESS_MESSAGE_COUNT="100"
npm run stress:staging:pubsub
```

## Chaos (suite + manual)

```powershell
$env:CONFIRM_STAGING_CHAOS="true"
$env:API_BASE_URL="https://api-staging..."
$env:WEBHOOK_BASE_URL="https://webhook-staging..."
$env:GCP_PROJECT_ID="..."
$env:STRESS_WORKSPACE_ID="..."
npm run chaos:staging
```

Runbook completo: [CHAOS_STAGING_RUNBOOK.md](./CHAOS_STAGING_RUNBOOK.md)

## Segurança — portal do líder (IDOR)

```powershell
$env:LEADER_A_EMAIL="lider@..."
$env:LEADER_A_PASSWORD="..."
# Opcional: UUID de entregador fora da rede do líder A
$env:LEADER_B_DRIVER_ID="..."
npm run security:leader-portal-idor
```

Ver relatório: [LEADER_PORTAL_SECURITY_AUDIT.md](./LEADER_PORTAL_SECURITY_AUDIT.md)

## Smokes Funcionais

```powershell
$env:API_BASE_URL="https://api-staging..."
$env:API_ADMIN_EMAIL="admin-staging@..."
$env:API_ADMIN_PASSWORD="..."
npm run smoke:ticketing-mcp-api
npm run smoke:financial-summary
npm run smoke:inbox-guided-api
npm run smoke:metrics-alerts-api
npm run smoke:ai-api
```

Smokes DB:

```powershell
npm run smoke:cadastro-db
npm run smoke:ticketing-sla-db
npm run smoke:multitenant-isolation-db
```

## QA Manual

Validar no navegador:

- Login e seleção de workspace.
- Inbox, leitura, envio e reabertura de conversa.
- Tickets, timeline, SLA e MCP.
- Cadastros: entregadores, farmácias, líderes e usuários.
- Financeiro: resumo, lançamentos e parcelas.
- Automações e configurações por webhook/canal.
- Copiloto/IA conforme flags habilitadas no ambiente.

## Leader mobile QA (`/lider/*`)

Testar em viewport **375×667** e **390×844** (Chrome DevTools ou dispositivo real), com usuário `role=leader`.

### Shell e navegação

- [ ] Botão menu (☰) abre/fecha sidebar; backdrop fecha ao toque.
- [ ] Sidebar fecha ao trocar de rota e com tecla Escape.
- [ ] Conteúdo ocupa largura útil sem scroll horizontal no shell.

### Rotas

| Rota | Verificar |
|------|-----------|
| `/lider` | KPIs e ações rápidas legíveis em coluna única |
| `/lider/farmacias`, `/lider/entregadores` | Lista → detalhe → Voltar; busca na lista |
| `/lider/diarias`, `/lider/faltas` | Formulário e resumo empilhados; campos usáveis com teclado virtual |
| `/lider/pre-cadastro`, `/lider/desligamento` | Formulário antes do histórico no mobile |
| `/lider/chat` | Lista de conversas ↔ thread com Voltar; Nova conversa via modal; composer com safe-area; OTP modal rolável (`max-h` 90dvh) |

### Regressão desktop (`≥1024px`)

- [ ] Sidebar fixa e redimensionável; layout master-detail e chat em 3 colunas inalterados.

## Rollback

Rollback operacional imediato para RLS:

```sql
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
  END LOOP;
END $$;
```

Para alterações de schema/dados, restaurar snapshot de staging se houver falha estrutural nas migrations.
