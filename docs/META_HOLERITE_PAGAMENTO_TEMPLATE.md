# Template WhatsApp — recibo do entregador

Usado em **A pagar → recibo → Enviar recibo** no dia do PIX. O PDF **não** vai anexado: a mensagem leva só o **link** da página pública (`/public/recibo/{token}`), válido por **7 dias**. Links antigos em `/public/holerite/{token}` redirecionam automaticamente.

A plataforma **não cria** o modelo na Meta. Cadastre, aguarde aprovação UTILITY e depois informe o **nome** (env ou `app_settings`).

---

## 1. Onde criar

1. [WhatsApp Manager](https://business.facebook.com/wa/manage/message-templates/) → WABA do canal usado no workspace (inbox financeiro / operacional).
2. **Criar modelo** → categoria **Utilidade / UTILITY** → idioma **Português (BR)** `pt_BR`.

---

## 2. Conteúdo do modelo

| Campo | Valor |
|--------|--------|
| **Nome** | `flux_holerite_pagamento` |
| **Idioma** | `pt_BR` |
| **Categoria** | **Utilidade** / Utility |
| **Botões** | nenhum |
| **Mídia / PDF** | nenhum |

### Corpo (BODY)

Cole exatamente (5 variáveis, nesta ordem):

```
Flux Farma — pagamento {{1}}

Total do ciclo: {{2}}
Já pago em diárias: {{3}}
PIX de hoje: {{4}}

Demonstrativo (expira em 7 dias):
{{5}}

Dúvida? Responda esta conversa.
```

### Variáveis

| Placeholder | Significado | Exemplo na Meta |
|-------------|-------------|-----------------|
| `{{1}}` | Data do PIX (dd/mm/aaaa) | `27/08/2026` |
| `{{2}}` | Total do ciclo **com** diárias de terça | `R$ 1.280,33` |
| `{{3}}` | Já pago / trilha de diárias (abatido da quinta) | `R$ 140,00` |
| `{{4}}` | Valor deste PIX (quinta = restante; terça = a diária) | `R$ 1.140,33` |
| `{{5}}` | URL pública do recibo | `https://www.aetheraai.com.br/public/recibo/abc123` |

Na Meta, use esses exemplos na amostra. Variáveis não podem ficar vazias no envio.

---

## 3. Ligar na plataforma

Depois de **aprovado**:

1. Secret / env da API:

```
BILLING_PAYSLIP_WHATSAPP_TEMPLATE_NAME=flux_holerite_pagamento
BILLING_PAYSLIP_WHATSAPP_TEMPLATE_LANGUAGE=pt_BR
BILLING_PAYSLIP_TTL_DAYS=7
```

2. Ou `app_settings` chave `billing_payslip_whatsapp_template` (texto com o nome, ou JSON `{ "name": "flux_holerite_pagamento", "language": "pt_BR" }`).

O **nome do env tem prioridade**. Se o nome na Meta for outro, altere só o env — o código não hardcoda o WABA.

---

## 4. Uso

1. Financeiro → **A pagar** → clique no título do entregador.
2. Conferir o drawer (total com diárias, já pago, PIX quinta, por centro de custo / farmácia, descontos uma vez).
3. **Enviar recibo** — gera o link (revoga o anterior) e dispara o template se houver telefone no cadastro.
4. Sem telefone ou sem template aprovado: o link ainda é gerado; dá para **copiar**.
5. **Revogar link** invalida o token antes dos 7 dias.

---

## 5. Criar via API (opcional)

```bash
curl -X POST "https://graph.facebook.com/v21.0/<WABA_ID>/message_templates" \
  -H "Authorization: Bearer <META_ACCESS_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "flux_holerite_pagamento",
    "language": "pt_BR",
    "category": "UTILITY",
    "components": [
      {
        "type": "BODY",
        "text": "Flux Farma — pagamento {{1}}\n\nTotal do ciclo: {{2}}\nJá pago em diárias: {{3}}\nPIX de hoje: {{4}}\n\nDemonstrativo (expira em 7 dias):\n{{5}}\n\nDúvida? Responda esta conversa.",
        "example": {
          "body_text": [
            ["27/08/2026", "R$ 1.280,33", "R$ 140,00", "R$ 1.140,33", "https://www.aetheraai.com.br/public/recibo/abc123"]
          ]
        }
      }
    ]
  }'
```
