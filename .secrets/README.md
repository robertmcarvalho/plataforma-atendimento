# Secrets locais (não versionar)

Esta pasta está no `.gitignore`. Copie os templates abaixo e preencha com valores do Supabase Dashboard / GCP Secret Manager.

| Arquivo | Uso |
|---------|-----|
| `production-api.env` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` do projeto **plataforma_atendimento** (`omhlb…`) |
| `production-db-url.txt` | Connection string pooler Postgres (produção) |
| `production-supabase-project-ref.txt` | Ref do projeto (`omhlbavfsttwcnybzvcd`) |
| `legacy-api.env` | Credenciais do projeto legado `ojzzx` (export pontual) |
| `legacy-db-url.txt` | Pooler do legado (quando reativado) |
| `staging-api.env` | Ambiente de QA (não confundir com produção) |
| `staging-supabase-db-url.txt` | Pooler Postgres staging — **deve ser ref `ojzzx`, nunca `omhlb`** |
| `billing-dev-db-url.txt` | **Destino de escrita** do módulo `/billing` (ojzzx ou Supabase dev dedicado). **Nunca** `omhlb`. |
| `billing-dev-api.env` | `SUPABASE_URL` + service role do projeto dev billing (API/web local) |
| `supabase-access-token.txt` | Token Management API (`sbp_…`) para scripts de projeto |
| `supabase-db-url.txt` | Pooler dev/local (`omhlb`) |

### Billing — proibido alterar produção

Durante o desenvolvimento do módulo `/billing`, **não** use `production-db-url.txt` como destino de INSERT/UPDATE/DELETE/migrations. Produção é **somente leitura** para o script `npm run billing:fixture:sample`. A guarda está em `scripts/lib/billingDbGuard.mjs`.

Exemplo de `billing-dev-db-url.txt` (substituir host/senha pelo projeto dev ou staging):

```
postgresql://postgres.[REF_DEV]:[SENHA]@aws-0-[região].pooler.supabase.com:6543/postgres
```

Nunca commitar senhas, service role keys, tokens Meta ou SMTP.

### NFS-e (homologação)

Migrations e seeds NFS-e: **somente** `billing-dev-db-url.txt`. Ver `docs/BILLING_NFSE_STAGING.md`.
Certificados A1 (PFX/senha) ficam fora do git (Secret Manager / arquivos locais gitignore) — a tabela `billing_nfse_certificates` guarda só metadados + `secret_ref`.

Exemplos locais (gitignore; criar manualmente):

| Arquivo / secret_ref | Uso |
|----------------------|-----|
| `billing-nfse-coop-pfx` (+ `.pfx` / `.password`) | PFX (ou material) do emitente Coop |
| `billing-nfse-flux-pfx` (+ `.pfx` / `.password`) | PFX do emitente Flux |

A UI em `/billing/config?tab=nfse` grava apenas metadados (`subject_cn`, validade, thumbprint, `secret_ref`).
**Nunca** versionar o PFX na raiz do repo — copie para `.secrets/` e apague o original da raiz.

### Cora — boletos (Integração Direta / mTLS)

Material local (gitignore via `.secrets/`):

| Arquivo / pasta | Uso |
|-----------------|-----|
| `cert_key_cora_production_2026_08_24_FLUX.zip` | ZIP original (Flux); **não** commit |
| `cora-flux-mtls/certificate.pem` + `private-key.key` | Par mTLS Flux (extraído do ZIP) |
| `cora-flux-client-id.txt` | `client_id` Flux (uma linha) — preferir também gravar via UI |
| `cora-flux.env.example` | Template sem valores (pode versionar o example) |
| `cora-coop-mtls/` (ainda não fornecido) | Par mTLS Coop + client_id correspondente |

**UI:** `/billing/config?tab=cora` — client_id, ambiente Stage/Produção, upload PEM, enabled.  
**Docs:** `docs/BILLING_CORA_BOLETOS.md`.  
**Nunca** versionar PEM/KEY/ZIP/client_id no source. Se o client_id foi exposto em chat, considere **rotação com a Cora**.

Stage usa hosts `matls-clients.api.stage.cora.com.br` — cert nomeado `production` pode **não** valer em Stage; confirmar com Cora.

### Flux Delivery / MySQL (produção Cloud Run)

Credenciais sensíveis ficam no **GCP Secret Manager** (projeto `rh-coopmob-bot`), não nesta pasta:

| Secret Manager | Env no `flux-farma-api` |
|----------------|-------------------------|
| `flux-delivery-oauth-client-secret` | `FLUX_DELIVERY_OAUTH_CLIENT_SECRET` |
| `flux-delivery-username` | `FLUX_DELIVERY_USERNAME` |
| `flux-delivery-password` | `FLUX_DELIVERY_PASSWORD` |
| `flux-mysql-password` | `FLUX_MYSQL_PASSWORD` |

Locais opcionais (gitignore): `flux-delivery-prod.env`, `flux-delivery-homolog.env` — ver `docs/FLUX_DELIVERY_INTEGRATION.md`.
