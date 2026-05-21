/**
 * Templates de mensagem de USUARIO para cenarios avancados do copiloto.
 *
 * Hoje o endpoint `POST /api/copilot/chat` monta o userText com CONTEXTO_JSON + PERGUNTA_DO_ATENDENTE.
 * Estes templates servem para:
 * - documentar o contrato desejado quando existir fluxo de ticket / RAG / pos-fechamento;
 * - copiar ou compor no backend quando essas rotas forem implementadas.
 *
 * NAO coloque aqui valores ou SLAs como fonte de verdade: use dados reais do payload ou das tools.
 *
 * RAG / pgvector: nao esta ligado ao copiloto neste repositorio; os blocos 4A/4B sao especificacao.
 *
 * Prompt caching: o documento original cita cache estilo Anthropic; no projeto o LLM e multi-provedor
 * (Gemini, OpenAI, Azure, Mistral, Anthropic). Cache de contexto depende do provedor e da API usada
 * em `staffLlmInvoke` — nao assuma cache automatico.
 */

/** Bloco 2 (ajustado): briefing ao abrir ticket — preencha {{...}} no servidor antes de enviar ao modelo. */
export const COPILOT_USER_TICKET_BRIEFING_TEMPLATE = `[TAREFA: RESUMO DE TICKET]

Gere o briefing deste atendimento para o atendente que vai assumir. Use APENAS fatos presentes nas secoes abaixo ou obtidos via tools nesta conversa. Se um campo estiver ausente, diga "dado nao disponivel no contexto".

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DADOS DO CONTATO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Perfil: {{perfil}}
Nome: {{nome}}
Telefone/WhatsApp: {{telefone}}
Detalhes adicionais (JSON ou texto livre): {{detalhes_perfil}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
FINANCEIRO / FATURACAO (se aplicavel)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{bloco_financeiro}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
TICKET ATUAL
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ID: {{ticket_id}}
Setor: {{setor}}
Tipo de demanda: {{tipo_demanda}}
Mensagem do contato: "{{mensagem_inicial}}"
Aberto em: {{data_hora_abertura}}
SLA (se existir no sistema): {{sla_json}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HISTORICO DE TICKETS (se fornecido)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{historico_tickets}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OCORRENCIAS (se fornecido)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{ocorrencias}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ESTRUTURA DO BRIEFING (Markdown, sem inventar dados)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Resumo do contato
## Pontos de atencao
## Contexto do ticket
## Proxima acao recomendada (passos concretos verificaveis no sistema)
## Risco operacional (opcional; so se houver dados que sustentem)
`;

/**
 * Bloco 3 (ajustado): sugestao em tempo real.
 * O copiloto NAO executa estornos/adiantamentos/documentos; descreva o que o atendente pode fazer na UI.
 */
export const COPILOT_USER_REALTIME_ASSIST_TEMPLATE = `[TAREFA: SUGESTAO EM TEMPO REAL]

Acompanhe o atendimento. Analise a ultima mensagem do contato e ajude o atendente.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONTEXTO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Ticket ID: {{ticket_id}}
Perfil: {{perfil}}
Nome: {{nome}}
Tipo de demanda: {{tipo_demanda}}
SLA (se existir): {{sla_json}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
HISTORICO RECENTE (ate 10 trocas)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{historico_conversa}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ULTIMA MENSAGEM DO CONTATO
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
"{{ultima_mensagem}}"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DADOS RELEVANTES (só o que o sistema injetou ou tools retornaram)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{{dados_relevantes}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PRODUZA (Markdown)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
## Sentimento / tom (inferencia heuristica; nao apresente como metrica certificada)
## Rascunho de resposta para o contato (maximo 3 frases; sem dados nao confirmados)
## O que verificar agora (1 a 3 passos concretos)
## Proximos passos no sistema (texto; o copiloto nao executa acoes nem confirma lancamentos)
`;

/** Bloco 4A — gerar texto de consulta para busca semantica (embedding + vector store). */
export const COPILOT_USER_RAG_QUERY_TEMPLATE = `[TAREFA: GERAR QUERY RAG]

Com base na situacao abaixo, produza uma unica linha de busca (maximo 20 palavras, substantivos e termos tecnicos) para recuperar documentos na base de conhecimento.

Situacao: {{descricao_situacao}}
Tipo de demanda: {{tipo_demanda}}
Pergunta do atendente (se houver): "{{pergunta_atendente}}"

Responda APENAS com a query, sem explicacao.`;

/** Bloco 4B — sintese com chunks ja recuperados (similaridade e threshold no codigo de busca). */
export const COPILOT_USER_RAG_ANSWER_TEMPLATE = `[TAREFA: RESPOSTA COM BASE DE CONHECIMENTO]

Use APENAS os trechos abaixo. Se nao bastarem, diga que a informacao nao consta na base e sugira escalar ao supervisor.

Perfil: {{perfil}}
Tipo de demanda: {{tipo_demanda}}
Pergunta: "{{pergunta_atendente}}"

DOCUMENTOS:
{{chunks_texto}}

Responda em ate 5 linhas; cite a fonte indicada em cada trecho quando houver.`;

/** Bloco 5 — JSON pos-atendimento (para job futuro ao fechar ticket). */
export const COPILOT_USER_POST_CLOSE_SUMMARY_TEMPLATE = `[TAREFA: RESUMO POS-ATENDIMENTO]

Gere um unico objeto JSON valido (sem markdown) descrevendo o encerramento. Use apenas fatos do contexto abaixo.

Ticket: {{ticket_json}}
Conversa resumida ou transcricao controlada: {{conversa_ou_resumo}}
Acao registrada pelo atendente (se houver): {{acao_tomada}}
Resultado: {{resultado}}

Campos desejados no JSON:
ticket_id, perfil, tipo_demanda, setor, motivo_raiz, resolucao, descricao_resolucao,
valor_envolvido (null se desconhecido), sla flags se existirem dados, tempo_resolucao_minutos,
sentimento_geral (inferencia), tags (array), resumo_para_kb (string), licoes_aprendidas (opcional).
Nao inclua acoes_diretas_executadas a menos que o sistema tenha registrado esses eventos com IDs.`;
