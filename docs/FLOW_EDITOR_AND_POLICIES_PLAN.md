# Plano — Editor de fluxo (estilo Revive) + políticas separadas (SaaS)

**Objetivo:** implementar no projeto a recomendação acordada:

- **Fluxo principal de atendimento** = editor em árvore (blocos + ramos), alinhado ao `project-revive-main`, persistido por `workspace` e executado pelo orchestrator.
- **Triagem por perfil** e **triagem com bot** = **altamente configuráveis** via presets editáveis + dados reais da API (setores, filas, canais).
- **Condição / ramo por resposta** = modelo explícito no DSL (não sequências lineares que misturam perfis).
- **Fora do horário**, **escalonamento SLA** e **pesquisa SAT/CSAT** = políticas operacionais do canal em `workspace_channels.config`; o wizard apenas cria/atacha os vínculos na UX.

**Regra de produto (triagem por perfil):** **entregador**, **farmácia** e **líder** devem **sempre** desencadear **sub-árvores distintas** (ramos paralelos a partir da identificação ou de um menu explícito). É proibido o anti-padrão do protótipo Revive `buildTriagemPorPerfilTemplate` que encadeia fluxos de entregador e farmácia na mesma lista linear do ramo “Não encontrado”.

**Relação com:** este documento permanece como referência técnica ativa para o **motor + modelo de ramificação** e o **desacoplamento** SLA/expediente/SAT.

---

## 0. Plano de implantação — recomendações (wizard + modelo + fallbacks)

Esta secção consolida **o que implantar** na UX e no motor, alinhado ao que **já existe** no SaaS (`routing_rules`, `bot_flows`, `automation_rules`, `conversation_flow_*`), sem prometer capacidades que a API ainda não persiste.

### 0.1 Cartão “modelo” no wizard ↔ artefactos reais

| Modelo (UX) | O que criar / referenciar | Notas |
|---------------|---------------------------|--------|
| **Em branco** | Rascunho vazio (`conversation_flow` ou só `routing_rules` conforme escolha do operador) | Sem preset de blocos. |
| **Triagem por perfil** | **Preset** de fluxo: `identify_contact` + **três ramos de perfil** + **não encontrado** + opcionalmente regras `routing_rules` espelhando prioridade | Ver §0.2 e §2.4. |
| **Triagem com bot** | `bot_flow` (mensagem + keywords) **e/ou** nós `ai_classify` / `prompt_choice` no DSL | Não duplicar lógica: ou catálogo + fluxo, ou só fluxo. |
| **Roteamento por palavra-chave** | `routing_rules` (já rico: perfil, keywords, setor/atendente) | Catch-all de baixa prioridade = fallback “não entendeu” a nível de regras. |
| **Fora do horário** / **CSAT** / **SLA** | Configuração operacional do webhook (`workspace_channels.config.messages`, `sla`, `operation`) | Não embutir no JSON da árvore como obrigatório. |

### 0.2 Triagem por perfil — topologia obrigatória (entregador · farmácia · líder)

Após identificar o contato (ou após pergunta “quem é você?” se **não encontrado**):

1. **Três ramos mutuamente exclusivos por perfil** (chaves estáveis sugeridas: `profile_driver`, `profile_pharmacy`, `profile_leader`). Cada ramo contém **apenas** a sequência adequ àquele perfil (ex.: farmácia: setores + demandas farmácia + fila; entregador: idem para entregador; líder: setores/demandas de líder ou atribuição simplificada).
2. **Ramo `not_found`** (ou `profile_unknown`): **não** repetir blocos de outro perfil em série. Fluxo: mensagem empática → **`prompt_choice`** ou **`switch_variable`** sobre `perfil_inicial` → **entrada numa das três sub-árvores** acima (cada uma clonada ou referenciada como sub-fluxo), **ou** sub-árvores dedicadas “cadastro entregador / farmácia / líder” se o produto exigir pré-cadastro diferenciado.
3. **“Não entendeu”** (NLU / resposta inválida): dentro de cada `prompt_text` / menu, prever **`switch_text`** ordenado (re-pergunta → menu fechado → `default_next` para humano/setor triagem ou mensagem fixa). Documentar no preset **um ramo `default` explícito** por nó de escolha.

### 0.3 Passos do wizard (alinhamento Revive × SaaS)

| Passo Revive | Conteúdo implantável | Melhoria vs protótipo |
|----------------|----------------------|------------------------|
| **Modelo** | Cartões como acima; descrição honesta do que será gravado | Evitar texto que implique IA/ramos que `bot_flow` não grava sozinho. |
| **Gatilho** | Mapear para `message_received` / `conversation_started` / eventos de `automation_rules` conforme tipo | Lista finita alinhada à API. |
| **Fluxo** | Editor em árvore (`revive_blocos`) + conversão para DSL v2; ou só `routing_rules` para modelo “só keywords” | Resumo lateral com **árvore** (não lista linear misturando perfis). |
| **Detalhes** | Nome, prioridade, canais (`workspace_channels`), publicação | Validação: “falta ramo default / falta catch-all”. |

### 0.4 Critério de rejeição na validação (publish)

- Falhar publicação se existir sequência **entregador → farmácia** (ou qualquer par de perfis) **sem** nó `prompt_choice` / `switch_variable` / ramo de `identify_contact` entre eles.
- Opcional: lint no editor `revive_blocos` que detecta blocos `criar-precadastro` com `tipo` diferentes sob o mesmo pai sem decisão intermédia.

---

## 1. Visão em camadas

```
┌─────────────────────────────────────────────────────────────────┐
│  UX (wizard opcional “pacote”)                                  │
│  Cria: Fluxo principal + links para políticas já existentes      │
└────────────────────────────┬────────────────────────────────────┘
                             │
     ┌───────────────────────┼───────────────────────┐
     ▼                       ▼                       ▼
┌─────────────┐    ┌─────────────────┐    ┌──────────────────────┐
│ Fluxo       │    │ Política        │    │ Automação / hook     │
│ conversação │    │ expediente      │    │ pós-evento           │
│ (JSON árvore)│   │ (workspace/     │    │ (ex.: CSAT em        │
│             │    │  channel)       │    │  conversation.       │
│             │    │                 │    │  resolved)           │
└──────┬──────┘    └────────┬────────┘    └──────────┬───────────┘
       │                    │                         │
       └────────────────────┼─────────────────────────┘
                            ▼
                  Orchestrator / scheduler
                  (ordem: expediente → fluxo → SLA timers paralelos → CSAT)
```

**Ordem sugerida no runtime (mensagem inbound):**

1. Resolver **fora do horário** (política): se aplicável, resposta automática e/ou bloqueio de bot — sem entrar nos ramos da árvore ou após um “gate” configurável.
2. Executar **nó atual do fluxo** (sessão mantém `flow_run`: `definition_version_id`, `current_node_id`, `variables`).
3. **SLA** continua sendo calculado pela conversa/ticket (políticas existentes); escalonamento **não depende** do ramo da triagem.
4. **CSAT** dispara por evento (`resolved`/`closed`), não como bloco obrigatório no meio da árvore.

---

## 2. Modelo de fluxo (DSL) — blocos e **ramificação por resposta**

### 2.1 Princípio

Todo bloco que **espera input do cliente** deve declarar **como** o próximo passo é escolhido:

- **Menu explícito** (botões/lista numerada): cada opção mapeia para um **branch_id** ou **target_node_id**.
- **Texto livre**: condições ordenadas (**primeira verdadeira vence**): regex, igualdade normalizada, intent IA (slot), ou expressão sobre variáveis.
- **Perfil já resolvido** (CRM): ramos vindos de **identificar contato** — no protótipo Revive apareciam como rótulos (“Encontrado · Entregador”, …). No SaaS os **rótulos** são configuráveis na UI, mas as **chaves de ramo** devem ser estáveis: `profile_driver`, `profile_pharmacy`, `profile_leader`, `not_found` (ou equivalente documentado). **Nunca** misturar numa única lista linear os passos de cadastro/triagem de **entregador** e **farmácia**; são **três sub-árvores** independentes após o nó de decisão de perfil.

### 2.2 Tipos de nó (MVP → expansão)

| Fase | Tipo | Função | Ramificação |
|------|------|--------|-------------|
| MVP | `gate_channel` | Opcional; só mensagens deste canal | continuação única ou despacho |
| MVP | `identify_contact` | Telefone/email/documento → perfil | ramos por **perfil + não encontrado** (configurável) |
| MVP | `send_message` | Texto/fixado | próximo sequencial |
| MVP | `prompt_choice` | Menu ao cliente | **mapa opção → próximo nó** |
| MVP | `prompt_text` | Pergunta aberta | grava variável; próximo sequencial **ou** `switch_text` |
| MVP | `switch_on_variable` | Ramifica por valor de variável | **casos** `when` + `default` |
| MVP | `switch_on_text` | Última mensagem inbound | lista **ordered rules** (contains/regex/equals) |
| MVP | `assign_sector` / `assign_queue` | Ligação a setor/fila do tenant | próximo sequencial |
| MVP | `apply_tag` | Tag conversa/contato | próximo sequencial |
| Fase 2 | `ai_classify` | IA → intent/slots | ramos por intent ou fallback |
| Fase 2 | `precadastro` | Fluxo cadastro driver/pharmacy | ramos por validação |
| Fase 2 | `sla_checkpoint` | Opcional: só **marca checkpoint**, não substitui política global | único |

### 2.3 Esquema JSON (conceitual)

```typescript
type FlowDefinition = {
  id: string;
  workspace_id: string;
  name: string;
  version: number;
  triggers: TriggerConfig[];           // ver §3
  entry_node_id: string;
  nodes: Record<string, FlowNode>;
};

type FlowNode =
  | SendMessageNode
  | IdentifyContactNode
  | PromptChoiceNode
  | PromptTextNode
  | SwitchVariableNode
  | SwitchTextNode
  | AssignSectorNode
  // ...
;

type PromptChoiceNode = {
  type: 'prompt_choice';
  prompt: LocalizedText;
  options: Array<{
    id: string;
    label: LocalizedText;
    next: string; // node id
  }>;
};

type SwitchVariableNode = {
  type: 'switch_variable';
  variable: string;
  cases: Array<{ match: string | string[]; next: string }>;
  default_next?: string;
};

type IdentifyContactNode = {
  type: 'identify_contact';
  source: 'phone' | 'email' | 'document';
  branches: Array<{
    key: string;       // obrigatório: profile_driver | profile_pharmacy | profile_leader (estável)
    label: string;    // UI (ex.: "Encontrado · Entregador")
    next: string;     // raiz da sub-árvore **só** para esse perfil
  }>;
  not_found_next: string; // leva a fluxo que pergunta perfil ou pré-cadastro; ver §2.4
};
```

**Regra:** nenhum fluxo “triagem perfil” válido deve encadear fluxos mutuamente exclusivos (entregador vs farmácia vs líder) **sem** passar por `prompt_choice`, `switch_variable` ou ramos distintos do `identify_contact`. Os três perfis **encontrados** são **três `next` diferentes** desde o nó de identificação (ou desde o primeiro `switch_variable` após `not_found`).

---

### 2.4 Preset “Triagem por perfil” (substituição do template Revive)

O ficheiro `project-revive-main/src/pages/automacao/templates.ts` (`buildTriagemPorPerfilTemplate`) serve só como **inspiração de blocos**, **não** como topologia final: o ramo “Não encontrado” **não** pode conter uma sequência única que mistura perguntas de entregador e farmácia.

**Topologia alvo ao importar / gerar preset:**

```
identify_contact
├── profile_driver    → [selecionar-setor → selecionar-demanda → atribuir-fila …]  (só entregador)
├── profile_pharmacy  → […]  (só farmácia)
├── profile_leader    → […]  (só líder)
└── not_found_next    → send_message
                        → prompt_choice (Entregador | Farmácia | Líder)
                            ├── opção Entregador   → merge/jump para sub-árvore profile_driver (ou duplicata controlada)
                            ├── opção Farmácia     → idem profile_pharmacy
                            └── opção Líder        → idem profile_leader
                        + ramo default: "não entendeu" → re-prompt ou assign_sector triagem
```

**Conversão `revive_blocos` → DSL:** mapear `identificar` com `ramos` “Encontrado · …” para as **quatro** chaves estáveis acima; ao serializar, **dividir** qualquer lista linear legacy que misture perfis (migração one-shot ou aviso na UI).

**Fallback “não entendeu”:** todo `prompt_choice` e, quando aplicável, `prompt_text` devem declarar `default_next` ou nó `switch_text` com última regra catch-all → setor de triagem / mensagem / handoff humano.

---

## 3. Gatilhos do fluxo (somente conversação)

Persistir **lista de triggers** na definição ou em tabela de associação:

| Trigger | Descrição |
|---------|-----------|
| `conversation_started` | Nova conversa |
| `message_received` | Cada inbound (com throttle opcional) |
| `keyword` | Palavras-chave no texto |
| `schedule_cron` | Uso raro dentro do fluxo; preferir automações globais |

**Webhook** como trigger de fluxo conversacional pode ser fase 2 (payload → injeta variáveis e pula para nó).

**Prioridade:** número por fluxo; em conflito, maior prioridade ou primeiro match documentado.

---

## 4. Políticas separadas (não são nós obrigatórios da árvore)

### 4.1 Fora do horário

- **Onde:** `business_hours` já existe por workspace/setor/usuário; estender ou criar **`workspace_channel.business_hours_override`** / política “mensagem fora expediente”.
- **Comportamento:** mensagem fixa + opcionalmente **não avançar** o fluxo ou **fluxo paralelo** “OOO apenas primeira mensagem”.
- **UX:** painel Canais / Serviço + link no wizard “pacote”.

### 4.2 Escalonamento SLA

- **Onde:** `sla_policies`, eventos SLA, regras de escalação já planejadas no doc revive.
- **Comportamento:** independente do ramo da triagem; opcionalmente **notificar canal** configurável no workspace.

### 4.3 Pesquisa SAT / CSAT

- **Onde:** `automation_rules` ou `conversation_hooks` com `event_type = conversation_resolved`.
- **Comportamento:** template de mensagem + janela de envio + armazenamento de resposta.
- **UX:** automações dedicadas + toggle “ativar CSAT” no wizard que só **referencia** `rule_id`.

---

## 5. Persistência e versionamento

### 5.1 Tabelas (proposta)

| Tabela | Conteúdo |
|--------|----------|
| `conversation_flow_definitions` | Metadados: workspace_id, name, active_version_id, priority_default |
| `conversation_flow_versions` | definition_json (DSL), status (`draft`/`published`), created_at, published_at |
| `conversation_flow_bindings` | Opcional: canal(es), trigger_type, keywords — migração `030_conversation_flow_bindings.sql` |
| `conversation_flow_sessions` | Por conversa: `flow_version_id`, `state` (jsonb); equivale ao conceito de “run” no runtime |

**Publicação:** apenas uma versão `published` por fluxo “ativo” por binding; histórico para rollback.

### 5.2 Migração desde estado atual

- Manter `bot_flows`, `routing_rules`, `automation_rules` funcionando.
- Introduzir **importador** dos fluxos simples atuais → DSL MVP (uma sprint técnica).
- Wizard atual (`settings/automations/new`) pode **delegar** para “tipo: fluxo conversacional” quando `kind === conversation_flow`.

---

## 6. API (api-service)

| Método | Descrição |
|--------|-----------|
| `GET/POST /api/conversation-flows/definitions` | Listar / criar definições |
| `GET /api/conversation-flows/definitions/:id/versions` | Versões (inclui `graph`) |
| `POST /api/conversation-flows/definitions/:id/versions` | Nova versão rascunho (`clone_from_version_id` opcional) |
| `PUT /api/conversation-flows/versions/:vid` | Atualizar rascunho (`graph` legado ou DSL v2) |
| `POST /api/conversation-flows/versions/:vid/publish` | Promover a published |
| `POST /api/conversation-flows/simulate` | Dry-run (`version_id`, `input`) — trace legado ou v2 |
| `GET/POST /api/conversation-flows/definitions/:id/bindings` | Listar / criar vínculos canal+gatilho (migration 030) |
| `PATCH /api/conversation-flows/bindings/:bindingId` | Atualizar vínculo |

Validação server-side do DAG: todos os `next` resolvem; sem ciclos não permitidos (ou política explícita); nós obrigatórios por tipo.

---

## 7. Runtime (orchestrator-service)

1. Carregar fluxo **published** aplicável (workspace): bindings ativos por prioridade ou definição `guided-intake`.
2. Modo **`flow`** em `flow_runtime_mode`: executor MVP processa DSL **v2** (`send_message`, `prompt_choice`, `prompt_text`, `switch_*`, pass-through `next`).
3. `conversation_flow_sessions` criado/atualizado a cada mensagem processada pelo bot (estado por conversa).
4. Executar até **yield** (precisa resposta humana ou aguardar cliente) ou fim do fluxo.
5. Integração **guidedIntake** / catálogo atual: avaliar **substituir gradualmente** por executor único que lê o DSL.

**Variáveis de sessão:** namespace por conversa (`vars.nome`, `vars.perfil`, …).

---

## 8. UI (apps/web)

### Fase A — Paridade Revive (somente fluxo)

1. Portar **`fluxo.ts`** (tipos + helpers de árvore) para pacote compartilhado ou `apps/web/src/lib/conversation-flow/`.
2. Portar **`PaletaBlocos`**, **`BlocoCard`**, **`BlocoConfig`** substituindo mocks por **`useQuery` sectors/channels/users/tags`**.
3. Nova rota **`/settings/automations/flows`** ou **`/settings/flows`** com lista + editor.
4. Editor: persistir JSON DSL; validação inline (ramos órfãos).

### Fase B — Ramificação por resposta na UI

1. Para blocos “pergunta/menu”: UI de **ligação cada opção → próximo bloco** (dropdown de nós ou drag destino).
2. Bloco **`switch`** gerado automaticamente quando usuário marca “avançar conforme resposta”.
3. Preview textual atualizado (como sidebar do Revive) mostrando **condição → ramo**.

### Fase C — Wizard pacote

1. Alinhar passos e cartões ao **§0** (modelos ↔ artefactos; triagem com **três ramos de perfil** + `not_found` + default “não entendeu”).
2. Passo final “Políticas”: toggles **Expediente** (link política), **SLA** (link política), **CSAT** (link automation_rule).
3. Sem duplicar lógica no JSON do fluxo.

### Configuração operacional do webhook (fonte de verdade)

- **Portal:** [`/settings?section=channels`](/settings?section=channels) — cada webhook edita perfis, setores, filas, demandas, SLA, horário, mensagens, roteamento e limites em `workspace_channels.config`.
- **API legado:** `GET/PUT /api/workspace-catalogs` permanece como fallback/importação durante migração; não é mais fonte primária para demanda/SLA/mensagens de intake.
- **Orquestrador:** `loadWorkspaceCatalog(workspaceId, workspaceChannelId?)` resolve primeiro `workspace_channels.config`; tabelas antigas entram apenas se o canal não tiver catálogo operacional.
- **Wizard de nova automação** ([`/settings/automations/new`](/settings/automations/new)): filtro em duas camadas (**tipo de canal** + **conexão** `workspace_channel_id`); prioridade do binding em três níveis (baixa/média/alta → valor numérico); links operacionais apontam para Canais; **Testar** só chama `POST /api/conversation-flows/simulate` quando existe `version_id` (sem simulação fictícia para outros tipos).

### Inventário Revive (`AutomacaoNova.tsx`) ↔ contratos atuais

Objetivo: deixar explícito o que **já persiste** no SaaS e o que **ainda exige** migração/endpoint novo (sem UI “morta”).

| Área no protótipo Revive | Estado no portal SaaS | Contrato / trabalho em falta |
|--------------------------|----------------------|------------------------------|
| Modelos (templates) e passos 1–4 | Wizard Next.js com modelos mapeados para `automation_rule`, `routing_rule`, `bot_flow`, `out_of_hours`, `conversation_flow` | Paridade visual total (grelha/cromática) é só CSS; **gatilhos extra** do Revive (abaixo) precisam de modelo de dados. |
| Gatilhos *Nova conversa* / *Mensagem* | `conversation_flow_bindings.trigger_type` + `wizard_meta.trigger` | OK para `conversation_flow`. |
| Gatilhos *Webhook*, *SLA crítico*, *Conversa resolvida* (cartões no Revive) | **Não expostos** no wizard atual (evita mock) | **Nova** extensão: `trigger_type` + tabela ou `automation_rules.event_type` + dispatcher; ou documentar reuso só via regras outbound existentes. |
| *Agendamento* (cron) | `automation_rules` com `trigger_type: schedule` | OK (`POST/PUT /api/automations`). |
| Condições / filtros (canal) | Duas camadas tipo + conexão; `workspace_channel_id` no binding | OK. Negeção `ne` no canal: ainda limitada pelo motor no binding (ver nota no wizard). |
| Chips multi-canal (vários WhatsApp de uma vez) | Várias linhas de filtro `channel eq` ou um binding por fluxo | Produto: N bindings vs. um binding multi-canal (exigiria array em `conversation_flow_bindings`). |
| Prioridade *baixa/média/alta* | Grava em `conversation_flow_bindings.priority` (10/50/90) + `wizard_meta.binding_priority` | OK (sem migração; escala numérica já existia). |
| Biblioteca de ações (IA, rotear, e-mail, …) | **Não** portada como paleta genérica; fluxo conversacional usa `revive_blocos` | Paridade Revive exigiria **mapeamento bloco→nó DSL** ou manter só o editor de árvore atual. |
| *Testar* sandbox com logs falsos | Removido; só `POST /api/conversation-flows/simulate` com `version_id` | Para **routing/bot/automation_rule**: `POST /api/workspace-catalogs/simulate-intake` cobre só triagem de catálogo; simulação genérica por tipo seria **novo** endpoint se for requisito. |
| Descrição da automação | `conversation_flow_definitions.description` no wizard | OK. |

**SLA webhook ↔ runtime:** o runtime usa `workspace_channels.config.sla` e `demands[].sla_override` como fonte primária. `workspace_sla_rules` fica como fallback temporário para workspaces ainda não migrados.

---

## 9. Entregas por sprint (sugestão)

| Sprint | Entrega |
|--------|---------|
| S1 | Migração DB + CRUD fluxos + JSON schema TS + validação DAG na API |
| S2 | Executor MVP no orchestrator (`send_message`, `prompt_choice`, `switch_variable`, `identify_contact` stub) + `flow_run` |
| S3 | UI editor árvore + binding canal/trigger + publish |
| S4 | Preset **Triagem por perfil**: importador gera **três sub-árvores** (`profile_driver` / `profile_pharmacy` / `profile_leader`) + `not_found` com **menu →** sub-árvore correta; **proibir** sequência linear mista (lint + validação publish); migrador opcional para graphs legacy |
| S5 | `switch_text` + `ai_classify` + simulate endpoint |
| S6 | Wizard pacote + docs operador |

---

## 10. Critérios de aceite

- [ ] Fluxo “triagem perfil” não possui dois cadastros linearmente exclusivos sem **nó de decisão**.
- [ ] **Entregador**, **farmácia** e **líder** disparam **sub-árvores separadas** desde `identify_contact` ou desde o **primeiro** `prompt_choice` / `switch_variable` após `not_found` (nunca uma única lista com passos dos três misturados).
- [ ] Cada `prompt_choice` / menu relevante tem **caminho explícito** para resposta inválida ou repetida (**“não entendeu”** / `default_next` ou regra catch-all documentada).
- [ ] Publicar fluxo não altera execuções já em andamento (runs antigas mantêm version_id).
- [ ] SLA dispara mesmo se cliente mudou de ramo no meio da triagem.
- [ ] CSAT não exige bloco na árvore para funcionar.
- [ ] Fora do horário configurável sem editar cada ramo da árvore.

---

## 11. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Executor duplicado (guidedIntake vs novo) | Feature flag por workspace; migração nó a nó |
| DAG quebrado pelo usuário | Validação na API + UI bloqueando publish |
| Performance IA por mensagem | Cache intent + timeout + fallback ramo |

---

*Documento vivo — revisar após primeira versão publicada do executor.*

---

## 12. Referência — anti-padrão a evitar (Revive `templates.ts`)

No protótipo, o ramo **“Não encontrado”** de `buildTriagemPorPerfilTemplate` empilha blocos de entregador **e** farmácia na mesma sequência. **Não replicar** no SaaS: o preset gerado pelo portal deve seguir **§0.2** e **§2.4**.
