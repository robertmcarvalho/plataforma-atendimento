# IA — Uso e Privacidade

Este documento descreve **como as capacidades de IA são usadas** na plataforma e **quais dados podem ser processados** durante análises e sugestões, para orientar operação, compliance e troubleshooting.

---

## O que a IA faz (escopo)

- **Análise de sentimento e urgência** em mensagens **inbound** (cliente → operação).
- **Sugestão de resposta** (“Sugerir resposta”) para auxiliar o atendente no composer.
- **NPS preditivo** ao encerrar/resolver uma conversa (estimativa 0–10).
- **Agrupamento por tópico** (cluster) para identificar temas recorrentes (quando habilitado).

---

## Quais dados podem ser enviados ao provedor de IA

Dependendo da capacidade habilitada, a aplicação pode enviar ao provedor:

- **Trechos de mensagens recentes** da conversa (principalmente inbound).
- **Resumo** e/ou contexto do atendimento (ex.: setor, status, prioridade, dados do contato quando necessários para a resposta).
- **Resultados de ferramentas internas** (ex.: “entity_search” do copilot/contexto) usados apenas como base para gerar a sugestão.

### Dados que não devem ser expostos

- Não expor no texto final ao cliente: **dados internos de painel**, IDs, detalhes operacionais sensíveis e qualquer conteúdo que não esteja explicitamente presente no contexto permitido.
- A sugestão de resposta tem instrução para **não inventar fatos** e **não mencionar IA/Gemini/prompt**.

---

## Onde os resultados são armazenados

As análises são persistidas no banco (Postgres/Supabase):

- `messages.ai_sentiment`, `messages.ai_sentiment_score`
- `messages.ai_urgency`, `messages.ai_urgency_score`
- `messages.ai_analyzed_at`
- `conversations.ai_sentiment_last`
- `conversations.ai_urgency_score`
- `conversations.ai_nps_predicted`, `conversations.ai_nps_set_at`
- `conversations.ai_topic_id`, `conversations.ai_topic_set_at`, `conversations.ai_topic_embedding`
- `ai_topics` (centroids + metadados do cluster)

---

## Controles e flags

### Gate global

- `AI_ANALYSIS_ENABLED`
  - Quando desligado, as rotas de IA que dependem do provedor retornam indisponibilidade (ex.: 503) e o orchestrator não executa análise.

### Config por capacidade (runtime)

- `app_settings.ai_features_config` (JSON)
  - `sentiment`, `urgency`, `suggest_reply`, `nps_predicted`, `topic_clustering`
  - A UI pode respeitar essas flags em tempo de execução (ex.: não exibir botões/insights quando desabilitado).

### Flags de produto (frontend)

- `NEXT_PUBLIC_AI_ANALYSIS_BADGES`
  - Habilita badges (sentimento/urgência) e acordeão “Insights de IA” na Inbox.
- `NEXT_PUBLIC_AI_SUGGEST_REPLY`
  - Habilita o botão “Sugerir resposta” na Inbox.

---

## Regras de retenção / minimização (recomendação)

- Preferir **o menor contexto necessário** para cada capacidade.
- Evitar enviar anexos, mídia ou documentos inteiros (a menos que haja uma necessidade futura e consentimento/controles).
- Monitorar logs de auditoria para uso de “suggest_reply”.

---

## Troubleshooting rápido

- Botão “Sugerir resposta” retorna 503:
  - `AI_ANALYSIS_ENABLED` desligado **ou** `ai_features_config.suggest_reply=false` **ou** falta `GOOGLE_API_KEY/GEMINI_API_KEY`.
- “Insights de IA” não aparece:
  - `NEXT_PUBLIC_AI_ANALYSIS_BADGES=false` **ou** flags runtime desabilitadas **ou** não há dados IA na conversa.

