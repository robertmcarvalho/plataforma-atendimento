# Configuração do domínio `aetheraai.com.br`



Guia operacional para o domínio **aetheraai.com.br** (Hostinger) da plataforma Flux Farma / Aethera em produção.



> **Status (2026-09-01): MIGRAÇÃO CONCLUÍDA** — `www.aetheraai.com.br` e `aetheraai.com.br` com SSL ativo (`CertificateProvisioned=True`, `Ready=True`). Usuário confirmou site funcionando. Cutover `.com.br` canônico aplicado em API, Supabase Auth, código e docs operacionais.



## Contexto



| Item | Valor atual |

|------|-------------|

| GCP project | `rh-coopmob-bot` |

| Região Cloud Run | `us-central1` |

| Web (Next.js) | `flux-farma-web` |

| API | `flux-farma-api` |

| Webhook WhatsApp | `flux-farma-webhook` |

| Domínio web anterior | `www.aetheraai.online` (perdido) |

| **Domínio canônico (Hostinger)** | **`www.aetheraai.com.br`** / `aetheraai.com.br` |

| Supabase produção | `omhlbavfsttwcnybzvcd` (`plataforma_atendimento`) |



### Estado atual (2026-09-01, pós-cutover)



**Domain mappings Cloud Run:**



| Domínio | Serviço | DomainRoutable | Certificado | Status |

|---------|---------|----------------|-------------|--------|

| `www.aetheraai.com.br` | `flux-farma-web` | **True** | **CertificateProvisioned** | Ativo, HTTPS OK |

| `aetheraai.com.br` (apex) | `flux-farma-web` | **True** | **CertificateProvisioned** | Ativo, HTTPS OK |



**Revisões deployadas na migração:**



| Serviço | Revisão |

|---------|---------|

| `flux-farma-api` | `flux-farma-api-00257-l8w` |

| `flux-farma-web` | `flux-farma-web-00175-5ml` |



**Env API (produção — verificado em Cloud Run):**



- `WEB_APP_URL` → `https://www.aetheraai.com.br/login`

- `ALLOWED_ORIGINS` → `https://www.aetheraai.com.br,https://aetheraai.com.br,https://app.aethera.ai,https://flux-farma-web-713561463013.us-central1.run.app,http://localhost:3020,http://localhost:3000,http://127.0.0.1:3020,http://127.0.0.1:3000` (`.online` removido)



**URLs Cloud Run em uso hoje:**



| Serviço | URL |

|---------|-----|

| Web | `https://flux-farma-web-713561463013.us-central1.run.app` |

| API | `https://flux-farma-api-713561463013.us-central1.run.app` |

| Webhook | `https://flux-farma-webhook-713561463013.us-central1.run.app` |



**Build web em produção:** `NEXT_PUBLIC_API_URL` aponta para a URL `run.app` da API (ver `reports/web-build-substitutions.json`), não para subdomínio customizado.



**Código:** [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts) reconhece hostnames `*.aetheraai.com.br` como produção.



---



## Inventário — checklist mestre



### 1. DNS (Hostinger)



- [x] Mappings GCP criados (`www` + apex)

- [x] Registros para `www.aetheraai.com.br` (CNAME → `ghs.googlehosted.com`)

- [x] SSL provisionado para `www` e apex (confirmado 2026-09-01)

- [ ] (Opcional) Subdomínio `api.aetheraai.com.br` se quiser URL amigável para API



### 2. GCP — Cloud Run domain mapping + SSL



- [x] Mapping `www.aetheraai.com.br` → `flux-farma-web`

- [x] Mapping `aetheraai.com.br` (apex) → `flux-farma-web`

- [x] Ownership Search Console / Webmaster

- [x] Certificado managed (`CertificateProvisioned = True`) — ambos `.com.br`

- [x] `post-deploy-pilot` executado após deploy web (2026-09-01)

- [x] Remover mapping legado `www.aetheraai.online` (2026-09-01 — ver abaixo)



### 3. Variáveis de ambiente — API (`flux-farma-api`)



Arquivos de referência: [`.cloud-env-api-production.yaml`](../.cloud-env-api-production.yaml), [`scripts/gcp/deploy-production-api.ps1`](../scripts/gcp/deploy-production-api.ps1)



| Variável | Status |

|----------|--------|

| `ALLOWED_ORIGINS` | **Feito** — `.com.br` + run.app + localhost |

| `WEB_APP_URL` | **Feito** — `https://www.aetheraai.com.br/login` |



### 4. Build web — `NEXT_PUBLIC_*`



| Variável | Status |

|----------|--------|

| `NEXT_PUBLIC_API_URL` | Mantém `run.app` — **não precisa mudar** |

| `NEXT_PUBLIC_SUPABASE_URL` | Não muda |

| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Não muda |



### 5. Código



| Arquivo | Status |

|---------|--------|

| [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts) | **Feito** — fallback `.com.br` |

| [`deploy/cloudrun/api.yaml`](../deploy/cloudrun/api.yaml) | **Feito** — template com `.com.br` |

| [`.cloud-env-api-production.example.yaml`](../.cloud-env-api-production.example.yaml) | **Feito** |

| Scripts deploy / smoke | **Feito** — URLs `.com.br` |



### 6. Supabase (Auth URL Configuration)



Projeto: `omhlbavfsttwcnybzvcd` → **Authentication → URL Configuration**



- [x] **Site URL:** `https://www.aetheraai.com.br`

- [x] **Redirect URLs:**

  - `https://www.aetheraai.com.br/**`

  - `https://aetheraai.com.br/**`

  - `https://flux-farma-web-713561463013.us-central1.run.app/**` (transição)

  - `http://localhost:3000/**`, `http://localhost:3020/**`, `http://127.0.0.1:3000/**`, `http://127.0.0.1:3020/**`



### 7. Meta / WhatsApp



| Item | Precisa mudar? |

|------|----------------|

| Callback webhook WhatsApp | **Não** — usa `run.app` do webhook |

| Templates com links públicos | **Automático** — via `WEB_APP_URL` |



### 8. Autentique



Webhook: `https://flux-farma-api-713561463013.us-central1.run.app/api/webhooks/autentique` — **não muda** enquanto API ficar em `run.app`.



### 9. E-mail / SMTP



Links de convite usam `WEB_APP_URL` — novos e-mails já apontam para `.com.br`.



### 10. Documentação



- [x] `DESIGN.md`, `STAGING_PROD_DATABASE_MAP.md`, `PRODUCTION_BOOTSTRAP.md`, scripts deploy — atualizados para `.com.br`

- [ ] (Opcional) Google Search Console — adicionar propriedade `aetheraai.com.br` se ainda não feito



---



## Remover mapping legado `.online`



**Concluído (2026-09-01).** Mapping `www.aetheraai.online` removido via `gcloud beta run domain-mappings delete`. Restam apenas `www.aetheraai.com.br` e `aetheraai.com.br`.



Referência (já executado):



```powershell

# Requer gcloud beta (ou Console GCP → Cloud Run → Domain mappings → Delete)

gcloud beta run domain-mappings delete `

  --domain=www.aetheraai.online `

  --project=rh-coopmob-bot `

  --region=us-central1

```



Alternativa via Console: **Cloud Run** → **flux-farma-web** → **Domain mappings** → excluir `www.aetheraai.online`.



---



## Validação (smoke test)



Ordem sugerida:



1. [x] `https://www.aetheraai.com.br` — carrega, certificado válido

2. [ ] Login com usuário de teste

3. [ ] Inbox / billing — sem erro CORS (DevTools → Network)

4. [ ] Link de convite / recibo público — URL usa `.com.br`

5. [ ] WhatsApp E2E — mensagem inbound

6. [ ] `GET https://flux-farma-api-713561463013.us-central1.run.app/health`



Scripts úteis:



```powershell

node scripts/one-off/audit-webhook-verify-prod.mjs

.\scripts\gcp\verify-run-scaling.ps1 -Profile pilot   # só se houve deploy de imagem

```



---



## Checklist ordenado (executar nesta ordem)



1. [x] Decidir URL canônica (`www.aetheraai.com.br`)

2. [x] Criar domain mapping GCP: `www.aetheraai.com.br` → `flux-farma-web`

3. [x] Configurar DNS Hostinger (CNAME `www`; apex com A/AAAA ou redirect)

4. [x] Aguardar SSL (`CertificateProvisioned`) e testar HTTPS

5. [x] Adicionar domínios `.com.br` em `ALLOWED_ORIGINS`

6. [x] Deploy API

7. [x] Atualizar Supabase Auth URL Configuration

8. [ ] Smoke completo: login, inbox, billing, link público recibo

9. [x] Atualizar `WEB_APP_URL` para `.com.br` + redeploy API

10. [x] Atualizar templates Meta/docs com URLs `.com.br`

11. [x] Código `api.ts` — suporte hostname `.com.br` + rebuild web

12. [ ] (Opcional) `api.aetheraai.com.br` + rebuild web

13. [ ] Remover mapping `.online` do GCP (manual — comando acima)



---



## Comandos de referência rápida



```powershell

# Listar mappings

$token = gcloud auth print-access-token

curl.exe -s -H "Authorization: Bearer $token" `

  "https://run.googleapis.com/v1/projects/rh-coopmob-bot/locations/us-central1/domainmappings"



# Deploy API (só se editar .cloud-env-api-production.yaml)

$env:GCP_PROJECT_ID = "rh-coopmob-bot"

.\scripts\gcp\deploy-production-api.ps1

```



---



## Documentos relacionados



- [DEPLOY_CLOUD_RUN.md](./DEPLOY_CLOUD_RUN.md)

- [GO_LIVE_CHECKLIST.md](./GO_LIVE_CHECKLIST.md)

- [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md)

- [AUTENTIQUE_SIGNATURE_SYNC.md](./AUTENTIQUE_SIGNATURE_SYNC.md)

- [scripts/gcp/README.md](../scripts/gcp/README.md)



---



*Atualizado em 2026-09-01. Migração concluída — domínio canônico `www.aetheraai.com.br`.*

