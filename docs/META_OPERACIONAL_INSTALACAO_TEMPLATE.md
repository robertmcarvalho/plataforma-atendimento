# Template WhatsApp — suporte à instalação (Operacional)

Template usado pelo **número Operacional Flux Farma** ao iniciar conversa com farmácia fora da janela de 24h (via Inbox → Nova conversa → Farmácia → Template Meta).

---

## 1. Onde criar

1. [Meta Business Suite](https://business.facebook.com/) → **Contas do WhatsApp** → WABA **Operacional** (`2227755071382283`).
2. **Ferramentas da conta** → **Modelos de mensagem**.

Alternativa: [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/) (selecione a WABA operacional, não a comercial).

---

## 2. Conteúdo do modelo

| Campo | Valor |
|--------|--------|
| **Nome** | `flux_operacional_instalacao` |
| **Idioma** | Português (Brasil) — `pt_BR` |
| **Categoria** | **Utilidade** / Utility |

### Corpo (BODY)

```
Olá, {{1}}.
Preciso de suporte para a instalação da plataforma na farmácia {{2}}.

Ficamos à disposição para fornecer informações adicionais.
```

### Variáveis

| Placeholder | Significado | Exemplo |
|-------------|-------------|---------|
| `{{1}}` | Nome do contato da farmácia | `Maria` |
| `{{2}}` | Nome fantasia cadastrado na plataforma | `Farmácia Central` |

Na Meta, informe exemplos: `Maria` e `Farmácia Central`.

---

## 3. Sincronizar na plataforma

Após aprovação na Meta:

1. **Configurações → Templates → Sincronizar Meta** (usa o canal WhatsApp padrão = Operacional), **ou**
2. Script de provisionamento:

```powershell
node scripts/one-off/provision-operacional-instalacao-template-prod.mjs
node scripts/one-off/provision-operacional-instalacao-template-prod.mjs --execute
node scripts/one-off/provision-operacional-instalacao-template-prod.mjs --execute --create-meta
```

O script `--create-meta` envia o modelo para análise na WABA operacional e grava/atualiza `message_templates`.

---

## 4. Uso no Inbox

1. Inbox (canal Operacional) → **Nova conversa**
2. Contato: **Farmácia**
3. Primeira mensagem: **Template Meta** → `Flux Operacional Instalacao`
4. Variáveis preenchidas automaticamente a partir do cadastro (contato expedição/gestor + nome fantasia)

Constante no código: `OPERATIONAL_INSTALACAO_TEMPLATE_META_NAME` em `apps/web/src/lib/operacao/operationalInstalacao.ts`.

---

## 5. Criar via API (opcional)

```bash
curl -X POST "https://graph.facebook.com/v21.0/2227755071382283/message_templates" \
  -H "Authorization: Bearer <META_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "flux_operacional_instalacao",
    "language": "pt_BR",
    "category": "UTILITY",
    "components": [
      {
        "type": "BODY",
        "text": "Olá, {{1}}.\nPreciso de suporte para a instalação da plataforma na farmácia {{2}}.\n\nFicamos à disposição para fornecer informações adicionais.",
        "example": {
          "body_text": [["Maria", "Farmácia Central"]]
        }
      }
    ]
  }'
```

Aguarde status **APPROVED** antes de enviar em produção.
