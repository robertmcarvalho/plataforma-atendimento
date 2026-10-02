# Integração Flux Delivery (cadastro de entregadores)

## Visão geral

Sincronização **somente leitura** da API de relatórios Flux Delivery para enriquecer a tabela `drivers` no Aethera.

| Ambiente | URL base |
|----------|----------|
| Homologação | `https://flux-delivery-homol.com.br` |
| Produção | `https://delivery-flux-it.com.br` |

Documentação de referência: `Documentação-API.pdf` (raiz do repositório).

## Credenciais

1. Copie o exemplo:
   - `.secrets/flux-delivery-homolog.env.example` → `.secrets/flux-delivery-homolog.env`
   - `.secrets/flux-delivery-prod.env.example` → `.secrets/flux-delivery-prod.env`
2. Preencha (não commitar):
   - `FLUX_DELIVERY_OAUTH_CLIENT_SECRET`
   - `FLUX_DELIVERY_USERNAME`
   - `FLUX_DELIVERY_PASSWORD`

OAuth: `POST /oauth2/token` (grant_type=password, Basic Auth client).

## Migration

Antes do primeiro `--apply`, aplique no Supabase:

```bash
# Arquivo
supabase/migrations/044_driver_flux_delivery_fields.sql
```

## Sync automático (produção)

O **scheduler-service** executa sync a cada **6 horas** (`0 */6 * * *` em `TZ`, padrão `America/Sao_Paulo`).

Variáveis no scheduler (mesmas credenciais da API + switches):

| Variável | Default | Descrição |
|----------|---------|-----------|
| `FLUX_DELIVERY_*` | — | OAuth + usuário Flux (produção) |
| `FLUX_SYNC_WORKSPACE_ID` | 1º workspace | Workspace alvo |
| `FLUX_DRIVER_SYNC_ENABLED` | `true` | `false` desliga o cron |
| `FLUX_DRIVER_SYNC_CRON` | `0 */6 * * *` | Expressão cron |
| `FLUX_DRIVER_SYNC_FORCE` | `false` | Sobrescreve campos já preenchidos no Aethera |
| `FLUX_DELIVERY_SKIP` | — | `true` ignora Flux (dev local) |

Logs: `[Cron] Flux driver sync: flux=… criados=… atualizados=…`

## Comandos manuais

```bash
# Homolog — simular
node scripts/one-off/sync-drivers-from-flux.mjs --env homolog --dry-run

# Homolog — gravar (usa DB de produção via .secrets/production-db-url.txt)
node scripts/one-off/sync-drivers-from-flux.mjs --env homolog --apply

# Produção Flux (após validar homolog)
node scripts/one-off/sync-drivers-from-flux.mjs --env prod --dry-run
node scripts/one-off/sync-drivers-from-flux.mjs --env prod --apply
```

Opções:

- `--force` — sobrescreve campos já preenchidos no Aethera (exceto metadados Flux)
- `FLUX_SYNC_WORKSPACE_ID` — workspace alvo (default: primeiro workspace)

Relatório: `reports/sync-drivers-flux-{homolog|prod}.json`

## Política de merge

| Situação | Ação |
|----------|------|
| Match por `flux_delivery_driver_id`, CPF ou telefone | Atualiza |
| Só na Flux | **Cria** entregador (`driver_type: fixed`, `status: active`) |
| Telefone igual, CPF diferente | Conflito no relatório, não aplica |
| Campo já preenchido no Aethera | Mantém (salvo `--force`) |
| `flux_delivery_*` | Sempre atualizado na sync |

## Campos novos no Aethera

Ver migration `044_driver_flux_delivery_fields.sql`: ID Flux, sync, WhatsApp, nascimento, CNH, tipo PIX, endereço completo, veículo.

## Viabilidade comercial (API)

O endpoint `POST /api/commercial/viability/check` consulta líderes ativos no workspace (cidade/UF) e, quando configurado, entregadores Flux na região. Retorna `503` se a API Flux estiver indisponível. Em desenvolvimento use `FLUX_DELIVERY_SKIP=true` para resposta local.

Variáveis no `api-service`: `FLUX_DELIVERY_*`, `COMMERCIAL_VIABILITY_CACHE_TTL_SEC`.

## Limpeza pós-homolog

```bash
# Drivers com ID Flux que não existem na API prod (dry-run)
node scripts/cleanup-flux-homolog-drivers.mjs --dry-run
node scripts/cleanup-flux-homolog-drivers.mjs --execute

# Leads smoke CRM
node scripts/cleanup-commercial-smoke-data.mjs --dry-run
node scripts/cleanup-commercial-smoke-data.mjs --execute

# Re-sync prod
node scripts/one-off/sync-drivers-from-flux.mjs --env prod --apply
```

Smoke prod: `npm run smoke:flux-delivery-prod -w api-service` (requer `.secrets/flux-delivery-prod.env`).

## API de relatórios (2026-06)

Fonte: `Documentação da API de Relatórios User Robert.pdf`.

| Recurso | Endpoint | Observação |
|---------|----------|------------|
| Farmácias | `GET /v1/relatorios/obter-todas-farmacias` | Retorna `farmacias[]` com `idLoja`, `nomeLoja`, `cnpj` |
| Entregadores | `GET /v1/relatorios/obter-todos-entregadores` | Retorna `entregadores[]` |
| Entregas | `GET /v1/relatorios/obter-todas-entregas` | Requer `dataInicial` e `dataFinal` no formato `yyyy-MM-dd HH:mm:ss` |

O endpoint antigo `GET /v1/relatorios/obter-entregas-por-periodo` retorna `404` em produção e não deve ser usado.

## Limitações (v1)

- Não importa valores de repasse (`ganhoPorEntrega`) — API de ganhos exige perfil entregador (403 com token SD).
- Não sincroniza farmácias nem vínculos entregador↔farmácia (use `scripts/link-drivers-pharmacies-from-escalas.mjs`).
- Não escreve dados na Flux.

## Checklist homolog → produção

1. [ ] Migration aplicada no banco alvo
2. [ ] `.secrets/flux-delivery-homolog.env` configurado
3. [ ] `--dry-run` homolog revisado (`reports/sync-drivers-flux-homolog.json`)
4. [ ] `--apply` homolog + amostra na ficha Web (`/drivers/[id]`)
5. [ ] Credenciais prod em `.secrets/flux-delivery-prod.env`
6. [ ] `--dry-run` / `--apply` prod
7. [ ] Smoke: 3 entregadores com badge “Sincronizado Flux”
