# Preset: setores e filas (Geral + Especializada)

Configuração recomendada para **Financeiro**, **Operacional**, **Atendimento Geral** e **Suporte Técnico**, com duas filas operacionais no canal WhatsApp.

Triagem do **líder** no WhatsApp (farmácia → entregador opcional → setor): ver [LEADER_WHATSAPP_INTAKE.md](./LEADER_WHATSAPP_INTAKE.md).

## Aplicar automaticamente (banco + canal)

Com `apps/api-service/.env` configurado:

```bash
npm run apply:sectors-queues-preset
```

Opções:

```bash
node scripts/apply-sectors-queues-preset.mjs --workspace-slug default --dry-run
node scripts/apply-sectors-queues-preset.mjs --channel-id <uuid-do-canal-whatsapp>
```

O script:

1. Cria ou reativa os **4 setores** na tabela `sectors` (por nome, no workspace).
2. Grava no **config do canal WhatsApp** setores, filas, demandas, SLA, horário e roteamento padrão.

## Modelo

| Camada | Itens |
|--------|--------|
| **Setores** (roteamento / inbox / bot) | Operacional, Atendimento Geral, Financeiro, Suporte Técnico |
| **Fila Geral** | Operacional + Atendimento Geral |
| **Fila Especializada** | Financeiro + Suporte Técnico (transbordo → Geral) |
| **Roteamento padrão** | Fila **Geral** |

## SLA sugerido (minutos, horário comercial)

### Por fila

| Fila | Setores | 1ª resposta | Tratamento | Resolução | Prioridade |
|------|---------|-------------|------------|-----------|------------|
| **Geral** | Operacional, Atendimento Geral | 25 | 120 | 480 (8h) | Média |
| **Especializada** | Financeiro, Suporte Técnico | 15 | 75 | 300 (5h) | Alta |

Transbordo: **Especializada** → **Geral** quando a fila estiver cheia.

### Por demanda (override no canal)

| Tipo | Exemplos | 1ª resposta | Tratamento | Resolução |
|------|----------|-------------|------------|-----------|
| Financeiro | repasse, fatura, contestação | 15 | 90 | 360 (6h) |
| Suporte técnico | app, plataforma, bug | 15 | 60 | 240 (4h) |
| Benefícios | vales, benefícios | 30 | 120 | 480 |
| Demais | operacional, MEI, escala | (herda SLA da fila) | | |

Ações padrão: alerta atendente → realocação no tratamento → escalação supervisor na resolução.

## Configuração manual na UI

Se preferir não usar o script:

1. **Setores no banco** — garantir os 4 nomes exatos via API/admin (o bot lista `sectors` ativos).
2. **Configurações → Canais → WhatsApp → Setores & Filas**
   - Cadastrar os 4 setores (mesmos nomes; IDs devem ser os UUIDs do banco se possível — o script faz o vínculo).
   - Fila **Geral**: marcar Operacional + Atendimento Geral; SLA 25 / 120 / 480.
   - Fila **Especializada**: marcar Financeiro + Suporte Técnico; SLA 15 / 75 / 300; transbordo **Geral**.
3. **Aba Demandas** — catálogo por setor (19 demandas no preset; ver `scripts/lib/operational-sectors-queues-preset.mjs`).
4. **Aba Roteamento** — fila padrão: **Geral**.
5. **Usuários → Filas WhatsApp** — por atendente: canal WhatsApp + setores em que atua.

## Horário comercial (preset)

- Seg–sex: 08:00–18:00  
- Sábado: 08:00–12:00  
- Domingo: fechado  
- Fuso: `America/Sao_Paulo`

## Conferência pós-deploy

- [ ] `GET /api/sectors` lista os 4 setores ativos  
- [ ] Canal WhatsApp: 2 filas e 4 setores na aba Setores & Filas  
- [ ] Mensagem de teste: menu mostra os 4 setores  
- [ ] Após escolher setor, lista de demandas coerente  
- [ ] Inbox filtra/roteia por `sector_id` correto  

## Referência no código

- Preset: `scripts/lib/operational-sectors-queues-preset.mjs`
- Triagem bot: `apps/orchestrator-service/src/guidedIntake.ts`
- Catálogo workspace: `apps/api-service/src/lib/workspaceCatalogDefaults.ts`
