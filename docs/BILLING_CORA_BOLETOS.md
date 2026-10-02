# Cora — boletos (Integração Direta / mTLS)



Emissão manual de boletos registrados via API Cora v2, para faturas **Flux** (MVP). Coop em rodada posterior.



## Segurança



| Item | Onde fica | Nunca |

|------|-----------|-------|

| `certificate.pem` + `private-key.key` | `.secrets/<mtls_secret_ref>/` ou Secret Manager | Commit no git; coluna pública no DB |

| `client_id` | UI (`billing_cora_configs`) ou `.secrets/cora-flux-client-id.txt` | Hardcode no source commitável |

| Private key | Só arquivo local / SM | Texto claro em tabela |



Se o `client_id` foi exposto em chat/ticket, **considere rotação com a Cora** se a política deles exigir.



## Feature flag



| Flag | Default | Uso |

|------|---------|-----|

| `BILLING_CORA_ENABLED` | **false** | Master off até Stage validado |

| `BILLING_CORA_STATEMENT_SYNC_ENABLED` | **false** | Job/rota de sync extrato+saldo |

| `BILLING_CORA_STATEMENT_SYNC_WRITE` | **false** | Persistência + auto-reconcile (smoke = read-only) |



Também é preciso `enabled=true` na config da entidade Flux na UI.



## Extrato + saldo (sync diário MVP Flux)



Consulta `GET /bank-statement/statement` + `GET /third-party/account/balance` (mesmo mTLS do boleto).

Importa em `billing_bank_movements` com `external_id=cora:{transaction.id}` (alinhado ao CSV) e reusa `autoReconcileImportedMovements`.



| Item | Valor |

|------|-------|

| Agenda | Mon–Fri **18:00** `America/Sao_Paulo` (`flux-scheduler-cora-statement-sync`) |

| Janela | Últimos **3 dias** corridos (overlap) + cursor só avança no sucesso |

| Conta destino | `billing_cora_configs.bank_account_id` (PUT config) |

| Coop | Credenciais instaladas (2026-09-25); sync/emissão Coop ainda bloqueados no código |



### Coop — credenciais mTLS

- Config: `billing_cora_configs` Coop, `environment=production`, `mtls_secret_ref=cora-coop-mtls`, `enabled=false`.
- Local: `.secrets/cora-coop-mtls/` + `.secrets/cora-coop-client-id.txt` (client_id = CN do certificado).
- Cloud Run: secrets `cora-coop-mtls-certificate` / `cora-coop-mtls-private-key` montados em `/secrets/cora-coop-cert` e `/secrets/cora-coop-key`; env `BILLING_CORA_CERT_PATH_CORA_COOP_MTLS` / `BILLING_CORA_KEY_PATH_CORA_COOP_MTLS`.
- `BILLING_CORA_CERT_PATH` / `BILLING_CORA_KEY_PATH` (sem sufixo) valem **só** para `cora-flux-mtls`.
- Health-check read-only: `GET /api/billing/cora/configs/:entityType/balance` (financial manage).



Endpoints:



| Método | Path | Auth |

|--------|------|------|

| GET | `/api/billing/cora/sync/status` | JWT view |

| POST | `/api/billing/cora/sync/statement` | JWT manage (`dry_run` default true) |

| POST | `/api/billing/cora/sync/statement/job` | `X-Scheduler-Token` |



Smoke manual (read-only): `POST .../sync/statement` com `{ "dry_run": true, "force": true }`.



## Endpoints



| Método | Path | Uso |

|--------|------|-----|

| GET | `/api/billing/cora/config` | Listar configs (inclui termos do boleto) |

| PUT | `/api/billing/cora/configs/flux` | Salvar client_id, ambiente, enabled, multa/juros/PIX/templates, `bank_account_id` |

| PUT | `/api/billing/cora/configs/flux/mtls` | Upload PEM → `.secrets/` |

| POST | `/api/billing/invoices/:id/cora-bank-slip` | Emissão manual (usa config) |

| POST | `/api/billing/cora/webhooks/invoice-paid` | Stub (501) — liquidação futura |

| GET | `/api/billing/cora/sync/status` | Última sync extrato |

| POST | `/api/billing/cora/sync/statement` | Sync manual |

| POST | `/api/billing/cora/sync/statement/job` | Sync scheduler |



## Condições comerciais do boleto (config)



Persistidas em `billing_cora_configs` (migration `126_billing_cora_boleto_terms.sql`) e enviadas no `POST /v2/invoices`:



| Campo UI | Default | API Cora |

|----------|---------|----------|

| Multa (%) | **2** (`fine_mode=rate`) | `payment_terms.fine.rate` (0–100). Alternativa: `fine.amount` em centavos |

| Juros (% a.m.) | **1** | `payment_terms.interest.rate` (0–100, 2 casas). Docs Cora **não** explicitam se é a.m.; produto trata como **% ao mês** |

| Incluir QR PIX | **true** | `payment_forms: ["BANK_SLIP","PIX"]` (exige chave Pix na conta Cora). Off = omite o nó |

| Nome / descrição | templates com `{{cycle}}`, `{{invoice_id}}`, `{{pharmacy}}`, `{{cnpj}}` | `services[].name` (máx. 60) / `services[].description` (máx. **100**) |



`fine_mode=none` ou `interest_rate` vazio/null → nós omitidos no payload.



## Como configurar na UI



1. Aplique as migrations `125_billing_cora_bank_slips.sql` e `126_billing_cora_boleto_terms.sql` no ambiente alvo (nunca produção sem aprovação).

2. Abra `/billing/config?tab=cora`.

3. Em **Flux Farma** → **Editar**:

   - Ambiente: **Stage** (piloto)

   - **Client ID** (menu Conta Cora → Integrações via APIs)

   - `mtls_secret_ref`: `cora-flux-mtls` (default)

   - Marque **Integração habilitada**

   - Em **Condições do boleto**: multa, juros (% a.m.), PIX, templates de nome/descrição

4. Certificado:

   - Já em `.secrets/cora-flux-mtls/certificate.pem` + `private-key.key`, **ou**

   - Botão **Certificado** → colar PEM (grava só em `.secrets/`, gitignore)

5. API local: `BILLING_CORA_ENABLED=true` no `.env` do `api-service`.

6. Em `/billing/faturamento`, fatura Flux **aprovada** → **Emitir boleto**.



Sem redeploy após salvar client_id / ambiente / enabled / condições comerciais na UI (só precisa da API com a migration aplicada).



## Endpoints



| Método | Path | Uso |

|--------|------|-----|

| GET | `/api/billing/cora/config` | Listar configs (inclui termos do boleto) |

| PUT | `/api/billing/cora/configs/flux` | Salvar client_id, ambiente, enabled, multa/juros/PIX/templates |

| PUT | `/api/billing/cora/configs/flux/mtls` | Upload PEM → `.secrets/` |

| POST | `/api/billing/invoices/:id/cora-bank-slip` | Emissão manual (usa config) |

| POST | `/api/billing/cora/webhooks/invoice-paid` | Stub (501) — liquidação futura |



## Ambientes Cora



| Ambiente | Base URL |

|----------|----------|

| Stage | `https://matls-clients.api.stage.cora.com.br` |

| Produção | `https://matls-clients.api.cora.com.br` |



O pacote mTLS nomeado `production` pode **não** autenticar em Stage — confirme com a Cora se o token falhar.



## Bootstrap local



```

.secrets/cora-flux.env.example   # template (versionável via README; example sem valores)

.secrets/cora-flux-client-id.txt # gitignore — uma linha com o client_id

.secrets/cora-flux-mtls/

  certificate.pem

  private-key.key

```



Smoke **somente token** (não emite boleto):



```powershell

node apps/api-service/scripts/smoke-cora-token.mjs

```



## Testes unitários



```powershell

cd apps/api-service

npm run test:billing-cora

```



Mocks de HTTP — sem chamada real à Cora no CI. Cobrem builder com fine/interest/PIX/truncamento.



## NFS-e — PDF oficial (curto prazo)



No faturamento, para NFS-e autorizada com chave: link **Consulta pública** → portal gov (`ConsultaPublica`) para baixar o DANFSe oficial. O botão **PDF aux.** continua sendo o PDFKit interno (não oficial).



## Fora desta rodada



- Coop

- Webhook de liquidação (stub 501)

- Auto-emit no approve

- Nomeação amigável de downloads (próxima fase)

- Gerador DANFSe NT 008

- Deploy Cloud Run (pergunte ao operador após validar Stage)


