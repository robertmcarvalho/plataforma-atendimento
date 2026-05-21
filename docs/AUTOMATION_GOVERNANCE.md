# Governança De Automações

## Decisão Oficial

A automação operacional padrão da plataforma é a configuração baseada em webhook/canal, persistida em `workspace_channels.config`.

Esse modelo é a fonte oficial para:

- canais e credenciais operacionais;
- setores e filas;
- demandas;
- mensagens do bot;
- SLA por fila/demanda;
- horário de atendimento;
- roteamento padrão;
- integrações de entrada WhatsApp, Instagram e e-mail.

## Classificação Dos Mecanismos Existentes

| Mecanismo | Status | Diretriz |
|---|---|---|
| `workspace_channels.config` | Oficial | Fonte primária para operação e intake |
| `conversation_flow_definitions` | Oficial controlado | Motor versionado para fluxos avançados quando vinculado ao canal |
| `conversation_flow_bindings` | Oficial incompleto | Manter; corrigir runtime para respeitar canal, trigger e keywords antes de expansão |
| `automation_rules` | Oficial para campanhas/eventos outbound | Manter para campanhas e rotinas, não para substituir configuração operacional do canal |
| `routing_rules` | Compatibilidade temporária | Migrar para configuração do webhook ou flow bindings |
| `bot_flows` | Legado temporário | Congelar novas criações e migrar mensagens para webhook/catálogos |
| `revive_blocos` | Formato de UI/draft | Manter como edição visual; runtime deve depender de DSL validada |
| `workspace_* catalogs` | Complementar/fallback | Usar durante transição; preferir dados do canal para operação de atendimento |

## Política De Depreciação

1. Nenhuma automação legada será removida sem inventário, backup e validação operacional.
2. Novas automações operacionais devem nascer em `workspace_channels.config`.
3. `routing_rules` e `bot_flows` ficam em modo compatibilidade até haver migração por workspace.
4. `automation_rules` permanece para campanhas/outbound e eventos não-interativos.
5. `revive_blocos` não é contrato de runtime; é estado visual de edição.
6. Toda publicação de fluxo deve gerar DSL executável ou binding verificável.

## Roadmap De Migração

### Fase 0: Congelamento Controlado

- Bloquear novas automações legadas em UI padrão.
- Manter leitura e execução para workspaces existentes.
- Registrar uso por workspace, tipo, última execução e dono operacional.

### Fase 1: Inventário E Classificação

- Exportar `routing_rules`, `bot_flows`, `automation_rules`, `conversation_flow_definitions` e bindings por workspace.
- Classificar cada item como ativo, sem uso recente, duplicado, conflitante ou candidato a migração.
- Cruzar com canais configurados em `workspace_channels`.

### Fase 2: Migração Assistida

- Migrar demandas, mensagens, SLA e roteamento para `workspace_channels.config`.
- Migrar fluxos avançados para `conversation_flow_definitions` com binding por canal.
- Manter fallback legado por workspace até validação de atendimento real.

### Fase 3: Remoção Controlada

- Desativar execução legada por workspace.
- Validar SLA, inbox, bot, campanhas e relatórios.
- Remover somente após janela aprovada, backup e rollback testado.

## Regras De Conflito

- Se webhook/canal e `routing_rules` divergirem, webhook/canal prevalece para operação nova.
- Se `conversation_flow_binding` publicado existir para o canal, ele pode assumir fluxo avançado, desde que respeite trigger e canal.
- `bot_flows` nunca deve sobrescrever demanda/SLA do webhook.
- `automation_rules` não deve modificar intake inbound; deve acionar campanhas ou eventos outbound.

## Critérios De Pronto

- Inventário por workspace com último uso/execução.
- Nenhum fluxo ativo sem dono.
- Nenhum mecanismo legado criado por UI padrão.
- Runtime documentado com ordem de decisão.
- Plano de rollback por workspace.
