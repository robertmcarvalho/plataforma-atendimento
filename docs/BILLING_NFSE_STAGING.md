# NFS-e — staging / homologação (Sprint 0)

Fundação do módulo NFS-e (Sefin Nacional). **Sem emissão em produção** e **sem deploy** `flux-farma-*` neste estágio.

## O que não tocar

| Recurso | Status |
|---------|--------|
| Cloud Run `flux-farma-*` / `rh-coopmob-bot` deploy | **Não** |
| Supabase produção `omhlbavfsttwcnybzvcd` | **Não** (migrations / writes) |
| Host Sefin `sefin.nfse.gov.br` | **Não** enquanto ambiente = `producao_restrita` |
| Commit automático | Só se pedido |

Escritas de DB: somente **billing-dev** via `scripts/lib/billingDbGuard.mjs` + `.secrets/billing-dev-db-url.txt` (nunca `production-db-url.txt`).

## Feature flags

| Flag | Default | Uso |
|------|---------|-----|
| `BILLING_NFSE_ENABLED` | **false** | Master off até homologação / go-live |
| `BILLING_NFSE_SAAS_ENABLED` | false | Perfis SaaS (Sprint 5) |
| `BILLING_NFSE_FORCE_PRODUCAO_RESTRITA` | opcional | Força bloqueio de host produção |

Documentado em `apps/api-service/.env.example`. Em produção Cloud Run a flag permanece `false` até cutover explícito.

## Como rodar contra billing-dev

1. Garantir `.secrets/billing-dev-db-url.txt` (ref **≠** `omhlb…`).
2. Aplicar migration:

```powershell
node scripts/one-off/apply-billing-nfse-foundation-dev.mjs --execute
```

Dry-run (só valida URL + mostra SQL path):

```powershell
node scripts/one-off/apply-billing-nfse-foundation-dev.mjs
```

3. Auditoria de cobertura fiscal das farmácias (D2):

```powershell
node scripts/one-off/audit-billing-nfse-tomador-coverage.mjs
```

4. Testes unitários (gate + config):

```powershell
cd apps/api-service
node --import tsx --test src/lib/billingNfseTomadorGate.test.ts src/lib/billingNfseConfig.test.ts
```

## Schema (migration `116_billing_nfse_foundation.sql`)

- `billing_nfse_issuer_configs` — Coop/Flux, default `producao_restrita`, IBGE Uberlândia `3170206`
- `billing_nfse_service_profiles` — `delivery` ativo; `saas_monthly` / `saas_per_delivery` **inactive**
- `billing_nfse_certificates` — metadados A1 + `secret_ref` (sem PEM em claro); view `billing_nfse_certificates_public`
- `billing_nfse_documents` — status por fatura / tentativa
- `pharmacies.municipal_registration`, `pharmacies.ibge_city_code`

Seeds delivery: CTN `26.01.01`, NBS `1.0702.00.00`, Coop ISS 3%, Flux SN, template com `{{cycle_start}}` / `{{cycle_end}}` / `{{pharmacy}}`.

## Audit D2 — campos tomador vs gate

| Campo gate | Coluna em `pharmacies` | Gap |
|------------|------------------------|-----|
| CNPJ | `cnpj` | Preencher / normalizar 14 dígitos |
| Razão social | `legal_name` | — |
| CEP | `address_cep` | Cobertura parcial típica |
| Logradouro / nº / bairro | `address_street` / `address_number` / `address_neighborhood` | Cobertura parcial |
| Município / UF | **`city` / `state`** (não há `address_city`/`address_state` na tabela) | Gate aceita também `address_*` se presentes no payload |
| Código IBGE | **Novo** `ibge_city_code` | Coluna criada; dados a backfill |
| Inscrição municipal | **Novo** `municipal_registration` | Coluna criada; **opcional** no gate (omitida no DPS se vazia) |

**Achado D2:** farmácias usam `city`/`state` (schema inicial), não `address_city`/`address_state` (esses existem em `billing_legal_entities`). Não adicionamos `address_city`/`address_state` em `pharmacies` neste sprint para evitar duplicidade — o gate resolve via `resolveTomadorCityState`.

Gate (lib): `billingNfseTomadorGate.ts` — IM do tomador **opcional** por default (`requireMunicipalRegistration` default `false`; passe `true` se o município exigir). Alinhado ao DPS (omite `toma.IM` quando vazia).

SQL de cobertura (também no script de audit):

```sql
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE length(regexp_replace(coalesce(cnpj,''), '\D', '', 'g')) = 14) AS has_cnpj,
  count(*) FILTER (WHERE nullif(trim(legal_name), '') IS NOT NULL) AS has_legal_name,
  count(*) FILTER (WHERE length(regexp_replace(coalesce(address_cep,''), '\D', '', 'g')) = 8) AS has_cep,
  count(*) FILTER (WHERE nullif(trim(address_street), '') IS NOT NULL) AS has_street,
  count(*) FILTER (WHERE nullif(trim(address_number), '') IS NOT NULL) AS has_number,
  count(*) FILTER (WHERE nullif(trim(address_neighborhood), '') IS NOT NULL) AS has_neighborhood,
  count(*) FILTER (WHERE nullif(trim(city), '') IS NOT NULL) AS has_city,
  count(*) FILTER (WHERE length(trim(coalesce(state, ''))) = 2) AS has_uf,
  count(*) FILTER (WHERE length(regexp_replace(coalesce(ibge_city_code,''), '\D', '', 'g')) = 7) AS has_ibge,
  count(*) FILTER (WHERE nullif(trim(municipal_registration), '') IS NOT NULL) AS has_im
FROM public.pharmacies
WHERE status = 'active';
```

## Checklist Sprint 0

- [x] Inventário D2 + gaps IBGE/IM/endereço documentados
- [x] Migration `116_billing_nfse_foundation.sql`
- [x] Seeds Coop/Flux delivery + SaaS inactive
- [x] Types + tomador gate + config skeleton + testes
- [x] Guard host Sefin produção sob `producao_restrita`
- [x] Flag `BILLING_NFSE_ENABLED` default false
- [x] Migration aplicada em billing-dev (`ojzzx…`) — 2 issuers, 6 profiles
- [ ] Backfill IBGE/endereço das farmácias (operacional — UI já expõe os campos; IM opcional)

### Cobertura billing-dev (audit D2, farmácias `active`)

| Métrica | Valor |
|---------|-------|
| Total ativas | 221 |
| CNPJ 14 dígitos | 218 |
| Cidade/UF | 204 |
| Endereço completo (CEP+logradouro+nº+bairro) | 36 |
| IBGE | **0** |
| IM | **0** |
| Prontas para o gate (IM opcional; faltam IBGE/endereço) | **0** |

## Sprint 1 — Config API + UI

Ainda **sem** approve/emit e **sem** Sefin produção. Configura emitentes/perfis/certificado (metadados) contra **billing-dev**.

### Endpoints (`requireBillingModule` + financialAuth)

| Método | Path | Auth |
|--------|------|------|
| GET | `/api/billing/nfse/config` | `requireFinancialView` |
| PUT/PATCH | `/api/billing/nfse/issuers/:entityType` (`coop`\|`flux`) | `requireFinancialManage` |
| PATCH | `/api/billing/nfse/profiles/:id` | `requireFinancialManage` |
| PUT | `/api/billing/nfse/issuers/:entityType/certificate` | `requireFinancialManage` |

Respostas de certificado **não** incluem PEM/`secret_ref` em claro — só `has_secret_ref` / metadados públicos.

`BILLING_NFSE_ENABLED` permanece **false** por default; a UI de config fica atrás do módulo billing (não exige a flag de emissão).

Ativar perfil SaaS (`active: true`) é **recusado** enquanto `BILLING_NFSE_SAAS_ENABLED` estiver off.

### UI

- `/billing/config?tab=nfse` — painel Coop/Flux (ambiente, auto-emit, série DPS, regime/SN, CTN/NBS/alíquota/template).
- Cadastro de farmácia: campos `ibge_city_code` e `municipal_registration` na seção de endereço.

### Certificado local

1. Em Config → NFS-e → Certificado, informe metadados (`subject_cn`, validade, thumbprint) e `secret_ref` (default `billing-nfse-coop-pfx` / `billing-nfse-flux-pfx`).
2. Coloque o PFX (e senha, se aplicável) fora do git, ex.: `.secrets/billing-nfse-coop-pfx` — ver `.secrets/README.md`.
3. Sprint 2 usará o `secret_ref` para assinar DPS; Sprint 1 só grava metadados.

### Smoke test local (billing-dev)

1. API e web apontando para billing-dev (`.secrets/billing-dev-api.env` / URL ≠ `omhlb…`).
2. Login com usuário financeiro (view/manage).
3. Abrir `http://localhost:3000/billing/config?tab=nfse` — deve listar Coop + Flux + perfis delivery.
4. Editar série DPS / IM do emitente Coop → Salvar → recarregar e confirmar persistência.
5. Editar perfil delivery (template) → Salvar.
6. Tentar ativar perfil SaaS → deve falhar com mensagem da flag (ou switch desabilitado na UI).
7. Salvar metadados de certificado → card deve mostrar `secret_ref ok` sem expor PEM.
8. Em `/pharmacies`, editar uma farmácia: preencher IBGE (IM opcional) → salvar → reabrir e confirmar.

Testes unitários:

```powershell
cd apps/api-service
node --import tsx --test src/lib/billingNfseTomadorGate.test.ts src/lib/billingNfseConfig.test.ts
```

### Checklist Sprint 1

- [x] Routes `billing/nfse.ts` + registro no aggregator
- [x] CRUD/read em `billingNfseConfig.ts` + validação
- [x] UI `/billing/config?tab=nfse`
- [x] Clients em `billingApi.ts`
- [x] Cadastro farmácia: IBGE + IM
- [x] Testes de validação de config
- [x] Doc atualizado

## Sprint 2 — DPS builder + assinatura + cliente Sefin (produção restrita)

**Sem** approve→emit (Sprint 3). **Sem** host `sefin.nfse.gov.br`. **Sem** deploy Cloud Run.

### Libs

| Arquivo | Papel |
|---------|--------|
| `billingNfseDpsBuilder.ts` | Monta XML DPS v1.01 (`infDPS`) a partir de fixture/invoice config |
| `billingNfseSigner.ts` | Carrega PFX (`.secrets/<secret_ref>`) e assina XMLDSig enveloped |
| `billingNfseSefinClient.ts` | mTLS POST `/SefinNacional/nfse`; hard-block hosts de produção |

Payload Sefin: JSON `{ "dpsXmlGZipB64": "<gzip+base64 do XML assinado>" }` em  
`https://sefin.producaorestrita.nfse.gov.br/SefinNacional/nfse`.

`tpAmb`: `2` em `producao_restrita`, `1` em `producao` (cliente **recusa** `producao` até `BILLING_NFSE_ALLOW_PRODUCAO=true` no go-live).

### Certificado A1 (local)

| Arquivo | Uso |
|---------|-----|
| `.secrets/billing-nfse-coop-pfx` (ou `.pfx` / `.p12`) | PFX Coop |
| `.secrets/billing-nfse-coop-pfx.password` | Senha (opcional) |
| `.secrets/billing-nfse-flux-pfx` (+ `.password`) | PFX Flux |

Env alternativas: `BILLING_NFSE_PFX_PASSWORD` ou `BILLING_NFSE_PFX_PASSWORD_BILLING_NFSE_COOP_PFX`.

Metadados continuam só na UI (`secret_ref`); o material **não** vai para o banco.

**Logs seguros:** nunca `JSON.stringify` de objetos `forge` / `tls.PeerCertificate` (ciclo `issuerCertificate`). Use `toPfxMaterialLogMeta()` (thumbprint, subject, notAfter).

### Smoke (script-only — preferido)

```powershell
# Dry-run: build (+ sign se PFX existir). Nunca POST.
$env:BILLING_NFSE_SMOKE = "1"
node --import tsx scripts/smoke-nfse-dps-sefin.mjs

# POST real em produção restrita (exige PFX)
$env:BILLING_NFSE_SMOKE = "1"
node --import tsx scripts/smoke-nfse-dps-sefin.mjs --execute
```

Sem `BILLING_NFSE_SMOKE=1` o script sai com skip. Sem PFX: gera XML unsigned e documenta o path; `--execute` é ignorado com graça.

Artefatos locais em `tmp/nfse-dps-*.xml` (não versionar).

### O que funciona sem cert vs com cert

| Capacidade | Sem PFX | Com PFX mock/teste | Com PFX A1 real |
|------------|---------|---------------------|-----------------|
| Build XML DPS | Sim | Sim | Sim |
| Assinatura XMLDSig | Não (skip) | Sim (unit/smoke) | Sim |
| Guard host produção | Sim | Sim | Sim |
| POST produção restrita | Skip | Falha mTLS/negócio (esperado) | Sim com `--execute` |
| Approve→emit | Não | Não | Sim (Sprint 3 + flag) |

### Testes

```powershell
cd apps/api-service
node --import tsx --test src/lib/billingNfseTomadorGate.test.ts src/lib/billingNfseConfig.test.ts src/lib/billingNfseDpsBuilder.test.ts src/lib/billingNfseSigner.test.ts src/lib/billingNfseSefinClient.test.ts
```

Fixture XML ilustrativa: `apps/api-service/src/lib/fixtures/nfse-dps-unsigned.fixture.xml`.

### Gaps XSD / Portal Nacional

- Pacote oficial `NFSe-ESQUEMAS_XSD-PRODREST-v1.01` **não** está versionado no repo — builder segue o layout v1.01 prático (manual contribuinte + DANFSe Coop/Flux).
- Grupo **IBSCBS / RTC** omitido nesta fase (delivery ISS clássico).
- Validação XSD automatizada fica para quando o zip oficial for adicionado a `assets/`.
- `cTribMun` e alíquota ISS explícita em `tribMun` não são obrigatórios no caminho atual (totTrib / SN).

### Checklist Sprint 2

- [x] `billingNfseDpsBuilder.ts` + testes/fixture
- [x] `billingNfseSigner.ts` (PFX + XMLDSig + gzip/base64)
- [x] `billingNfseSefinClient.ts` (mTLS + hard-block produção)
- [x] Smoke `scripts/smoke-nfse-dps-sefin.mjs` (dry-run default; `--execute` gated)
- [x] Doc staging atualizado
- [x] Approve→emit (Sprint 3)
- [ ] Deploy / omhlb / `sefin.nfse.gov.br` — **fora de escopo**

## Sprint 3 — approve + auto-emit + status + notifications

**Sem** host `sefin.nfse.gov.br`. **Sem** deploy Cloud Run. Escopo: billing-dev + produção restrita.

### Decisões travadas

| Regra | Comportamento |
|-------|----------------|
| Emit on approve | Após aprovar draft → tenta emitir DPS |
| Status da fatura | Permanece `approved` mesmo se NF falhar |
| Status NF | `billing_nfse_documents` = `pending` → `authorized` / `rejected` |
| Gate tomador | Bloqueia approve com **422** `NFSE_TOMADOR_INCOMPLETE` + `gaps[]` |
| Feature flag | Só com `BILLING_NFSE_ENABLED=true`; off = approve legado |

### Fluxo

1. `POST /api/billing/invoices/:id/approve`
2. Se flag on → `evaluateNfseTomadorGate(pharmacy)`; se gaps → 422 (fatura **não** aprova)
3. Update invoice → `approved`
4. Cria `billing_nfse_documents` (`pending`) + audit `NFSE_PENDING`
5. `billingNfseEmitEngine.tryEmitNfseDocument` (builder → sign → Sefin restrita)
6. Atualiza documento + audit `NFSE_AUTHORIZED` / `NFSE_REJECTED` / `NFSE_EMIT_FAILED` / `NFSE_CERT_MISSING`

Coop sem PFX: emissão falha com erro claro (`NFSE_CERT_MISSING`); Flux com A1 em `.secrets/billing-nfse-flux-pfx` segue o stack Sprint 2.

### UI

- `/billing/faturamento` — coluna **NFS-e** (badge pending/authorized/rejected)
- Dialog ao bloquear por tomador incompleto (lista de campos)

### Certificado Flux (local)

1. Copiar A1 para `.secrets/billing-nfse-flux-pfx.pfx` (gitignore)
2. Senha em `.secrets/billing-nfse-flux-pfx.password` (gitignore) — **nunca** no código/docs versionados
3. Metadados em billing-dev: `node scripts/one-off/upsert-billing-nfse-flux-cert-dev.mjs --execute`
4. **Apague** o PFX da raiz do repo após a cópia (risco de `git add` acidental)

### Smoke Flux (produção restrita)

```powershell
$env:BILLING_NFSE_SMOKE = "1"
$env:BILLING_NFSE_SMOKE_ENTITY = "flux"
node --import tsx scripts/smoke-nfse-dps-sefin.mjs
node --import tsx scripts/smoke-nfse-dps-sefin.mjs --execute
```

`--execute` com fixture pode retornar erro de negócio Sefin (ex. E1235 esquema) — OK para validar mTLS + POST. Não logar senha/PEM.

### Testes locais

```powershell
cd apps/api-service
$env:BILLING_NFSE_ENABLED = "true"   # só se quiser exercitar o gate no approve via API
node --import tsx --test src/lib/billingNfseTomadorGate.test.ts src/lib/billingNfseConfig.test.ts src/lib/billingNfseDpsBuilder.test.ts src/lib/billingNfseSigner.test.ts src/lib/billingNfseSefinClient.test.ts src/lib/billingNfseEmitEngine.test.ts
```

API local: apontar para billing-dev, setar `BILLING_NFSE_ENABLED=true`, aprovar fatura Flux com farmácia fiscal completa → badge NF + notificações em auditoria.

### Checklist Sprint 3

- [x] Wire `POST /invoices/:id/approve` + gate 422 `NFSE_TOMADOR_INCOMPLETE`
- [x] `billingNfseEmitEngine.ts` (pending + emit Flux/Coop)
- [x] Audit `NFSE_*`
- [x] Badge NF + dialog no `BillingInvoicesPanel`
- [x] Testes + doc staging
- [ ] Deploy / omhlb / `sefin.nfse.gov.br` — **fora de escopo**

## Sprint 4 — storage XML/PDF + download UI + reemit

**Sem** host `sefin.nfse.gov.br`. **Sem** deploy Cloud Run. Escopo: billing-dev + produção restrita.

### Decisões

| Item | Comportamento |
|------|----------------|
| Bucket | Privado `billing-nfse` (runtime `ensureBucket`, padrão `commercial-proposals`) |
| Paths | `{workspaceId}/{documentId}/dps.xml`, `nfse.xml`, `danfse.pdf` |
| On authorize | Persiste DPS assinado + NFS-e XML (POST ou GET Sefin) + PDF (ADN se disponível; senão **PDF auxiliar local** a partir do XML) |
| Download | `GET .../xml` e `.../pdf` com `requireFinancialView`; backfill sob demanda se path vazio |
| PDF / NT 008 | ADN `GET /danfse/{chave}` pode estar desativada — `billingNfseDanfsePdf.ts` gera documento auxiliar (não é layout oficial SEFIN) e grava em `danfse.pdf` |
| Reemit | Só `rejected` → novo `billing_nfse_documents` (attempt+1) + emit engine |
| Cancelamento | Fora deste sprint |

### Migration / apply billing-dev

```powershell
node scripts/one-off/apply-billing-nfse-storage-dev.mjs
node scripts/one-off/apply-billing-nfse-storage-dev.mjs --execute
```

SQL: `supabase/migrations/117_billing_nfse_storage.sql` (`dps_xml_storage_path`).

### API

| Método | Path | Auth |
|--------|------|------|
| GET | `/api/billing/nfse/documents/:id/xml` | `requireFinancialView` |
| GET | `/api/billing/nfse/documents/:id/pdf` | `requireFinancialView` |
| POST | `/api/billing/nfse/documents/:id/reemit` | `requireFinancialManage` |

### UI

`/billing/faturamento` — em NFS-e **authorized**: botões XML / PDF; em **rejected**: **Reemitir**.

### Smoke download (doc homologado)

Documento autorizado de referência: `34c1360c-464a-4de1-a15e-304563e6fc6f`.

```powershell
# 1) Coluna dps_xml_storage_path em billing-dev
node scripts/one-off/apply-billing-nfse-storage-dev.mjs --execute

# 2) Backfill Sefin/ADN se storage vazio + grava tmp/nfse-download-*.xml|pdf
node --import tsx scripts/one-off/smoke-billing-nfse-download-dev.mjs
node --import tsx scripts/one-off/smoke-billing-nfse-download-dev.mjs --execute
```

Requer `.secrets/billing-dev-api.env`, `.secrets/billing-dev-db-url.txt`, PFX Flux em `.secrets/billing-nfse-flux-pfx*`.

### Testes locais

```powershell
cd apps/api-service
node --import tsx --test src/lib/billingNfseTomadorGate.test.ts src/lib/billingNfseConfig.test.ts src/lib/billingNfseDpsBuilder.test.ts src/lib/billingNfseSigner.test.ts src/lib/billingNfseSefinClient.test.ts src/lib/billingNfseEmitEngine.test.ts src/lib/billingNfseStorage.test.ts src/lib/billingNfseDanfsePdf.test.ts
```

### Checklist Sprint 4

- [x] `billingNfseStorage.ts` + migration `117`
- [x] Persistência no authorize (DPS / NFS-e / DANFSe ou PDF auxiliar local)
- [x] Consulta Sefin GET + backfill PDF (ADN opcional + geração local a partir do XML)
- [x] Routes download + reemit
- [x] UI Faturamento (XML / PDF / Reemitir)
- [x] Testes paths + regras de reemit
- [x] Doc staging
- [ ] Deploy / omhlb / `sefin.nfse.gov.br` — **fora de escopo**

## Sprint 5 — perfis SaaS (feature-flagged)

Perfis `saas_monthly` e `saas_per_delivery` (seed inativos desde migration `116`). **Sem produto SaaS billing** — só resolução de perfil NFS-e pronta.

### Flags

| Flag | Default | Nota |
|------|---------|------|
| `BILLING_NFSE_ENABLED` | false | Master emissão |
| `BILLING_NFSE_SAAS_ENABLED` | false | Exige master on para `saas_enabled` na API/UI; ativa edição/ativação SaaS |

`isBillingNfseSaasEnabled()` = master **e** SaaS. Com SaaS off, `resolveInvoiceRevenueLine` / `pickServiceProfile` tratam SaaS como **delivery** (comportamento legado).

### Defaults SaaS

| Campo | Valor |
|-------|-------|
| CTN | `010501` |
| NBS | `1.1103.22.00` |
| Template mensal | `Disponibilização de tecnologia (SaaS mensal) — {{pharmacy}} — competência {{cycle_start}} a {{cycle_end}}` |
| Template por entrega | `Disponibilização de tecnologia (SaaS por entrega) — {{pharmacy}} — período {{cycle_start}} a {{cycle_end}}` |

Emitente típico: **Flux** (`entity_type` da fatura). Perfís seed existem em Coop e Flux; UI já lista ambos.

### `billing_invoices.revenue_line` (migration `118`)

Coluna nullable (`billing_nfse_revenue_line`). `NULL` = delivery.

Convenção alternativa (sem coluna): metadata de linha de fatura `nfse_revenue_line` ou `revenue_line`.

Aplicar só em billing-dev:

```powershell
node scripts/one-off/apply-billing-nfse-invoice-revenue-line-dev.mjs --execute
```

UAT opcional (marcar fatura Flux draft):

```sql
UPDATE public.billing_invoices
SET revenue_line = 'saas_monthly'
WHERE id = '<invoice_uuid>';
```

### UAT — como ligar as flags

API local / billing-dev (`.env` do `api-service`):

```powershell
$env:BILLING_NFSE_ENABLED = "true"
$env:BILLING_NFSE_SAAS_ENABLED = "true"
```

1. Abrir config NFS-e no billing → editar/ativar perfis SaaS Flux.
2. Setar `revenue_line` na fatura (SQL acima) **ou** metadata de linha.
3. Aprovar fatura com NFSE on → documento usa perfil SaaS (CTN/NBS/template SaaS).
4. Com flags off: só delivery; UI SaaS read-only; ativar SaaS via API retorna 403.

### Testes

```powershell
cd apps/api-service
node --import tsx --test src/lib/billingNfseConfig.test.ts src/lib/billingNfseEmitEngine.test.ts
```

### Checklist Sprint 5

- [x] Defaults CTN/NBS + templates distintos
- [x] `resolveInvoiceRevenueLine` + emit usa perfil por `revenue_line`
- [x] Migration `118` + script billing-dev
- [x] UI: editar SaaS só com flag on
- [x] Testes resolução + templates
- [x] Doc staging
- [ ] Produto SaaS billing (faturamento) — **fora de escopo**
- [ ] Deploy / omhlb / Cloud Run — **fora de escopo**

## Próximo (Sprint 6+)

Cancelamento de NFS-e autorizada / go-live produção — ainda sem produção aberta.
