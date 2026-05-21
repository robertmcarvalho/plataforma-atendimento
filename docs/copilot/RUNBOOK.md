# Copiloto — runbook operacional

## Variáveis de ambiente (`apps/api-service`)

| Variável | Descrição |
|----------|-----------|
| `GOOGLE_API_KEY` ou `GEMINI_API_KEY` | Chave da API Gemini (Google AI Studio / projeto com billing). |
| `GEMINI_MODEL` | Padrão recomendado: `gemini-2.5-flash`. Alternativa econômica: `gemini-2.5-flash-lite`. |
| `COPILOT_ENABLED` | `true` (padrão) ou `false` / `0` / `off` para desligar o endpoint. |

## Rotação de chave

1. Gere uma nova chave no Google AI Studio / console do projeto.
2. Atualize o segredo no ambiente de deploy (nunca no Git).
3. Revogue a chave antiga após validar o health do serviço.

Se uma chave vazar (ex.: colada em chat ou ticket), **revogue imediatamente** e audite uso anômalo.

## Desligar emergência

- Defina `COPILOT_ENABLED=false` e reinicie o `api-service`.
- Opcional: remova temporariamente a chave para retornar `503` com mensagem clara.

## Limites

- Rate limit atual: **20 requisições por minuto por usuário** (memória local do processo). Em múltiplas réplicas, considerar Redis na evolução.

## Onde olhar em caso de erro

- Logs do Fastify no `api-service` (erros `Gemini HTTP ...`).
- Tabela `audit_logs` com `action = copilot.query` (quando a inserção estiver disponível no ambiente).

## Avaliação interna (sugestão)

- Manter uma planilha com 30–50 perguntas reais e a “resposta ouro”.
- Medir semanalmente: taxa de respostas úteis, latência p95, custo estimado por 1k chamadas.
