# Configurar template OTP do líder na Meta

Este guia cria o template que a API usa em `POST /api/leader-portal/whatsapp/otp/start`.

A plataforma envia o código de 6 dígitos no **body** e, para templates **Authentication + Copy code**, também no **botão** (exigência da Meta).

---

## 1. Onde criar

1. Abra [Meta Business Suite](https://business.facebook.com/) com a conta que administra o WhatsApp da **Flux Farma / Aethera**.
2. Menu **Configurações do negócio** (ícone de engrenagem) → **Contas do WhatsApp** → selecione a conta WABA usada na produção.
3. Aba **Ferramentas da conta** → **Modelos de mensagem** (Message templates).

Alternativa: [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/) direto nos modelos.

---

## 2. Criar o modelo (interface — recomendado)

1. **Criar modelo** / **Create template**.
2. **Categoria:** `Autenticação` / **Authentication** (não use Marketing).
3. **Nome do modelo:** `aethera_leader_otp`  
   - Apenas letras minúsculas, números e `_` (sem espaços, sem acentos).
   - Este nome vai em `LEADER_WHATSAPP_OTP_TEMPLATE_NAME`.
4. **Idioma:** `Português (Brasil)` → código `pt_BR` (igual a `LEADER_WHATSAPP_OTP_TEMPLATE_LANGUAGE`).

### Conteúdo (fluxo Authentication OTP)

A Meta **não deixa** texto livre no corpo; ela monta algo como:

> *123456* é o seu código de verificação.  
> Para sua segurança, não compartilhe este código.  
> Este código expira em 5 minutos.

No assistente de criação:

| Opção | Recomendação |
|--------|----------------|
| Tipo de OTP | **Copiar código** / Copy code |
| Aviso de segurança | **Sim** |
| Expiração do código | **5** minutos (alinha ao TTL da API) |
| Texto do botão | `Copiar código` (ou padrão localizado) |

5. **Enviar para análise** → aguarde status **Aprovado** (minutos a 24h; autenticação costuma ser rápida).

---

## 3. Conferir nome e idioma

Na lista de modelos, anote exatamente:

- **Nome:** ex. `aethera_leader_otp`
- **Idioma:** `pt_BR`
- **Status:** Aprovado
- **Categoria:** Authentication

Se o nome na Meta for diferente (ex. `aethera_leader_otp_v1`), use **o nome exato** na variável de ambiente.

---

## 4. Criar via API (opcional)

Se preferir API, use o **WhatsApp Business Account ID** (WABA) e token com permissão `whatsapp_business_management`.

```bash
curl -X POST "https://graph.facebook.com/v21.0/<WABA_ID>/message_templates" \
  -H "Authorization: Bearer <META_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "aethera_leader_otp",
    "language": "pt_BR",
    "category": "authentication",
    "message_send_ttl_seconds": 300,
    "components": [
      { "type": "body", "add_security_recommendation": true },
      { "type": "footer", "code_expiration_minutes": 5 },
      {
        "type": "buttons",
        "buttons": [{ "type": "otp", "otp_type": "copy_code", "text": "Copiar código" }]
      }
    ]
  }'
```

Resposta esperada: `"status": "PENDING"` → depois **APPROVED**.

Documentação Meta: [Authentication templates (copy code)](https://developers.facebook.com/docs/whatsapp/business-management-api/authentication-templates/copy-code-button-authentication-templates/).

---

## 5. Ligar na plataforma (Cloud Run)

Edite `.cloud-env-api-production.yaml` (ou variáveis no serviço `flux-farma-api`):

```yaml
LEADER_WHATSAPP_OTP_TEMPLATE_NAME: "aethera_leader_otp"
LEADER_WHATSAPP_OTP_TEMPLATE_LANGUAGE: "pt_BR"
```

Redeploy:

```powershell
.\scripts\gcp\deploy-production-api.ps1
```

A API já envia `body` + `button` com o código (padrão para copy code). Para desativar o botão: `LEADER_WHATSAPP_OTP_COPY_CODE_BUTTON=false` (só se o template não tiver botão).

---

## 6. Testar

1. Portal do líder → **Vincular WhatsApp** → número do líder (ex. `(34) 9671-0044`).
2. **Enviar código de verificação**.
3. No WhatsApp do líder deve chegar mensagem com código e botão **Copiar código**.

Diagnóstico no banco:

```powershell
node scripts/diagnose-leader-whatsapp-otp.mjs --url-file .secrets/production-db-url.txt --search robert
```

---

## Problemas comuns

| Sintoma | Causa | Ação |
|---------|--------|------|
| Modelo rejeitado | Categoria errada (Marketing) ou nome inválido | Recriar como **Authentication**, nome `aethera_leader_otp` |
| API: template não encontrado | Nome/idioma diferente do aprovado | Conferir nome exato e `pt_BR` |
| API OK, WhatsApp vazio | Template ainda pendente ou número sem WhatsApp | Aguardar aprovação; conferir DDI 55 |
| Erro no botão ao enviar | Template sem botão copy code | Criar template copy code ou `LEADER_WHATSAPP_OTP_COPY_CODE_BUTTON=false` |
| Só funciona em alguns números | App Meta em modo desenvolvimento | Adicionar número em **API Setup → test recipients** ou subir app para produção |

---

## Registro na Aethera (opcional)

Em **Configurações → Templates**, cadastre o mesmo nome em `meta_template_name` e status **approved** para campanhas futuras. O OTP do líder usa as variáveis de ambiente acima, não essa tabela.
