# Copiloto — prompts e política

## System prompt (fonte de verdade)

O texto completo do system prompt está em:

- [`apps/api-service/src/lib/copilotSystemPrompt.ts`](../../apps/api-service/src/lib/copilotSystemPrompt.ts) — constante `COPILOT_SYSTEM_PROMPT`.

Alterações de tom, idioma ou regras anti-alucinação devem ser feitas nesse arquivo e revisadas com o time de operação/compliance.

## Regras de negócio textuais (fase 2)

Quando for necessário documentar ciclos de diárias, descontos e políticas internas para o modelo, prefira:

1. Conteúdo curto versionado em Markdown neste diretório (ex.: `RULES_BUSINESS_PT.md`), **ou**
2. Registros em `app_settings` com chave dedicada, carregados no backend e injetados no prompt.

No MVP, o modelo responde com base no `CONTEXTO_JSON` + instruções do system prompt, sem base documental longa.

## Boas práticas

- Pedir ao modelo para citar apenas fatos presentes no `CONTEXTO_JSON`.
- Manter temperatura baixa (0,2–0,3) no `geminiClient`.
- Registrar revisões de prompt na descrição do PR.
