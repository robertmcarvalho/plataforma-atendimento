# Treinamento Operacional — Módulo Faturamento

Manual de uso da plataforma para o time financeiro (Flux Farma / CoopMob).

**Versão:** 1.0  
**Última atualização:** 2026-07-15  
**Público:** Gestor, Analista 1 (receitas), Analista 2 (pagamentos)  
**Documentos relacionados:** [FINANCEIRO_ONBOARDING_OPERACIONAL.md](./FINANCEIRO_ONBOARDING_OPERACIONAL.md), [FINANCIAL_CYCLES.md](./FINANCIAL_CYCLES.md)

---

## Como usar este manual

Cada capítulo traz, no final ou em blocos separados, o que cada papel faz:

| Sigla | Papel | Foco |
|-------|-------|------|
| **Gestor** | Direção e aprovações | Aprovar acertos, liberar bloqueios, fechar DRE |
| **A1** | Analista 1 — Receitas | Faturar, cobrar, baixar recebimentos, conciliar entradas |
| **A2** | Analista 2 — Pagamentos | Entregas, acertos, PIX, baixar pagamentos, conciliar saídas |

**Liliane** (tesouraria bancária) não acessa o sistema; recebe planilhas PIX aprovadas pelo Gestor e executa no C6.

**Acesso ao módulo:** menu lateral **Faturamento** (`/billing`). Papéis com acesso: `admin`, `supervisor`, `financial`.

---

## 1. Navegação do módulo

### 1.1 Menu principal (barra superior dentro de Faturamento)

| Tela | Caminho | Para que serve |
|------|---------|----------------|
| Visão geral | `/billing` | Resumo de contas a receber/pagar, alertas e desligamentos |
| Acertos | `/billing/acertos` | Ciclos semanais e conferência entregador × farmácia |
| Entregas | `/billing/entregas` | Conferir entregas importadas ou manuais |
| Faturamento | `/billing/faturamento` | Faturas CoopMob e Flux Farma |
| A receber | `/billing/receber` | Baixa de pagamentos das farmácias |
| A pagar | `/billing/pagar` | Repasses, folha, comissões e fornecedores |
| Despesas | `/billing/despesas` | Lançamentos fixos e variáveis |
| Cotas | `/billing/cotas` | Conta corrente dos cooperados |
| Capital coop. | `/billing/capital-cooperativo` | Extrato de cotas e recuperações |
| Conciliação | `/billing/conciliacao` | Extrato bancário × baixas registradas |
| Cadastros | `/billing/cadastros` | Prestadores, sócios e parceiros |
| Relatórios | `/billing/relatorios` | Exportações e telas regulatórias |
| Configurações | `/billing/config` | Entidades, CCs, tipos de despesa, bancos |

### 1.2 Telas complementares (não aparecem no menu, mas fazem parte do fluxo)

| Tela | Caminho | Observação |
|------|---------|------------|
| Integrações Flux | `/billing/integracoes` | Sincronizar entregas e validar CodPes/CodLoc |
| DRE gerencial | `/billing/dre` | Acesso pelo hub de Relatórios |
| Desligamento | `/billing/desligamento/[id]` | Abre a partir da Visão geral ou Operação |
| Faturamento na farmácia | `/pharmacies` (editar) | Seção **Faturamento** no cadastro |
| Diárias e faltas | `/financial` | Fonte das diárias consumidas no acerto |
| Relatório público farmácia | `/public/billing/[token]` | Link enviado à farmácia (sem login) |

### 1.3 Por papel — uso do menu

| Tela | Gestor | A1 | A2 |
|------|:------:|:--:|:--:|
| Visão geral | Consulta e alertas | Consulta AR | Consulta AP |
| Acertos | **Aprova** | Consulta faturas geradas | **Prepara e submete** |
| Entregas | — | — | **Valida** |
| Faturamento | Consulta | **Emite NF/boleto e envia** | — |
| A receber | — | **Baixa** | — |
| A pagar | **Libera bloqueados** | Consulta | **Baixa** |
| Despesas | Aprova valores altos | Confere recorrentes | **Lança** |
| Cotas | Decisões em desligamento | Consulta | Lança via Financeiro |
| Conciliação | **Valida pendências** | **Entradas** | **Saídas** |
| Cadastros | Aprova alterações | **Mantém** | Consulta |
| Relatórios | Fecha DRE | INSS, seguradora | PIX, folha, exportações |
| Configurações | **Aprova políticas** | Consulta | Consulta |

---

## 2. Configuração inicial (ordem obrigatória)

Configure **nesta ordem** antes do primeiro ciclo de acerto em produção.

```
1. Entidades jurídicas
2. Contas bancárias
3. Centros de custo + feriados + grupos de rateio de diárias
4. Farmácias (vínculo CC + regras de contrato)
5. Tipos de despesa (catálogo)
6. Fornecedores
7. Prestadores, sócios e parceiros
8. Comissão de líderes e impostos DRE
9. Integrações Flux
```

### 2.1 Entidades jurídicas

**Caminho:** Faturamento → Configurações → aba **Entidades** (`/billing/config?tab=entidades`)

Cadastre as duas empresas que faturam e pagam: **CoopMob** e **Flux Farma**.

| Campo | O que preencher |
|-------|-----------------|
| Razão social / Nome fantasia | Dados do contrato social |
| CNPJ | Sem pontuação ou com máscara (sistema normaliza) |
| Inscrições estadual/municipal | Quando aplicável |
| Regime tributário | Simples, Lucro Presumido, etc. |
| Endereço completo | Para NF e contratos |
| E-mail financeiro / comercial | Contatos de cobrança |
| Telefone | Contato operacional |
| Dados bancários | Banco, agência, conta, PIX |
| Split padrão Coop / Flux (%) | Quando a farmácia não tiver override |
| Margem Flux (%) | Base para comissão de líderes |
| Textos de fatura | Rodapé e observações padrão |

| Papel | Ação |
|-------|------|
| **Gestor** | Valida dados fiscais e bancários antes de ir a produção |
| **A1** | Confere e-mails e textos de cobrança |
| **A2** | Confere contas usadas em pagamentos PIX |

---

### 2.2 Contas bancárias

**Caminho:** Configurações → aba **Contas bancárias** (`?tab=contas-bancarias`)

| Campo | O que preencher |
|-------|-----------------|
| Entidade | CoopMob ou Flux Farma |
| Banco / Agência / Conta | Conta de operação |
| Conta padrão | Marcar a principal de cada entidade |
| Template PIX | Para C6: **C6 Bank (XLSX — PIX chave)** |
| Ativo | Desative contas encerradas |

| Papel | Ação |
|-------|------|
| **Gestor** | Aprova qual conta entra em cada lote PIX |
| **A1** | Informa conta de recebimento das farmácias (se diferente) |
| **A2** | Seleciona conta ao exportar PIX de pagamentos |

---

### 2.3 Centros de custo

**Caminho:** Configurações → aba **Centros de custo** (`?tab=centros`)

O centro de custo (CC) agrupa farmácias para faturamento, calendário e política de pagamento.

#### Campos do centro de custo

| Campo | O que preencher |
|-------|-----------------|
| Nome | Ex.: `FARMÁCIA INDIANA LJ 01` |
| Código | Sigla interna (ex.: `CC_IND_MG`) |
| CNPJ | Quando o CC representa um CNPJ de faturamento |
| Farmácia vinculada (lista) | Farmácias que pertencem a este CC |
| Farmácia representante | Loja que sai na fatura consolidada |
| Split Coop / Flux (%) | Deve somar 100% |
| Ativo | Desative CCs encerrados |

#### Calendário semanal (padrão do CC)

| Campo | Padrão operacional | Significado |
|-------|-------------------|-------------|
| Fechamento do ciclo | Domingo | Último dia da apuração seg–dom |
| Dia de conferência | Segunda | Revisão dos acertos |
| Dia de emissão da fatura | Segunda | Geração/envio NF+boleto |
| Vencimento da fatura | Quarta | Data de cobrança da farmácia |
| Deslocamento vencimento | Mesma semana | Semana seguinte, se configurado |
| Pagamento entregadores | Quinta | Data do PIX do acerto |
| Deslocamento pagamento | Mesma semana | Ajuste de semana |

#### Políticas de pagamento

| Campo | Opções | Efeito |
|-------|--------|--------|
| Condição de liberação do entregador | Fatura paga / Gestor libera / Ambos / Nenhuma | Bloqueia PIX até cumprir regra |
| Bloquear C6 sem baixa da fatura | Sim (padrão) | Payable fica bloqueado até A1 baixar recebimento |
| Permitir pagamento parcial | Não (padrão) | Pagamento integral do acerto |
| Política feriado — fatura | Postergar | Ajusta vencimento em feriado |
| Política feriado — entregador | Antecipar | Ajusta pagamento em feriado |
| Exigir justificativa gerencial | Sim | Ao liberar bloqueio manual |
| Tratamento padrão diária de cobertura | Pendente auditoria | Como cobrar diária no acerto |

#### Feriados

Na mesma aba, cadastre feriados nacionais, estaduais ou do workspace. O sistema usa essas datas para antecipar ou postergar vencimentos.

| Papel | Ação |
|-------|------|
| **Gestor** | Define calendário e políticas de bloqueio |
| **A1** | Cadastra CCs e vincula farmácias representantes |
| **A2** | Valida se farmácias do CC batem com operação |

---

### 2.4 Grupos de rateio de diárias

**Caminho:** mesma aba **Centros de custo**, seção **Grupos de rateio de diárias**

Use quando **várias farmácias do mesmo CC** dividem o valor de uma diária cobrada uma única vez.

| Campo | O que preencher |
|-------|-----------------|
| Nome do grupo | Ex.: `Polo Indiana — rateio diárias` |
| Centro de custo | CC gerencial do grupo |
| Farmácia representante | Quem aparece na fatura da diária |
| Valor cobrado da farmácia (R$) | Referência por diária |
| Repasse ao entregador (R$) | Referência de repasse |
| Regra de rateio | Igual entre as lojas selecionadas |
| Farmácias participantes | Marque todas as lojas que entram no rateio |
| Ativo | Desative grupos obsoletos |

**Pré-requisito:** farmácias já vinculadas ao CC e com diária habilitada na ficha.

| Papel | Ação |
|-------|------|
| **Gestor** | Aprova regra de rateio entre lojas |
| **A1** | Cria/edita grupos com A2 |
| **A2** | Indica quais lojas operam no mesmo polo |

---

### 2.5 Farmácia — seção Faturamento

**Caminho:** Cadastro → **Farmácias** → editar → seção **Faturamento**  
Também em **Nova farmácia** (`/pharmacies/new`).

| Campo | O que preencher |
|-------|-----------------|
| Centro de custo de faturamento | CC obrigatório para entrar no acerto |
| Escopo do contrato | CoopMob + Flux / só Coop / só Flux |
| E-mail de faturamento | Destino da cobrança e link do relatório |
| Split Coop / Flux (%) | Só quando escopo = ambos; override do CC |
| Mínimo de entregas | Piso para MG nesta loja |
| CodPes / CodLoc | Integração Flux Delivery |
| MG ativo | Liga mínimo garantido no acerto |
| Modo MG | Por entregador ou pool compartilhado (1× por ciclo) |
| Rateio do pool | Proporcional às entregas ou igual |
| Cobrar diária configurada | Liga cobrança automática no acerto |
| Regra da cobrança | Por diária no Financeiro ou quantidade fixa no ciclo |
| Qtd. diárias no ciclo | Quando regra = quantidade fixa |
| Valor cobrado da farmácia (R$) | Por diária |
| Repasse ao entregador (R$) | Por diária |

**Regra importante:** taxa por entrega e repasse ao entregador ficam na seção **Comercial** da farmácia; a seção **Faturamento** trata contrato, MG e diárias.

| Papel | Ação |
|-------|------|
| **Gestor** | Aprova MG, split e escopo Coop/Flux |
| **A1** | Preenche e-mail, CC e dados de cobrança |
| **A2** | Valida CodPes/CodLoc e regras de diária |

---

### 2.6 Tipos de despesa (catálogo)

**Caminho:** Configurações → aba **Tipos de despesa** (`?tab=tipos`)

Catálogo de categorias — **não é lançamento financeiro**. Use o botão de semear padrões se a lista estiver vazia.

| Campo | O que preencher |
|-------|-----------------|
| Nome | Ex.: Aluguel, Telefonia, Uniforme |
| Tipo | **Fixa** ou **Variável** |
| Entidade padrão | Coop / Flux / Ambas |
| Modo de alocação | Nenhum, por farmácia, entregador, entrega ou prestador |
| Recorrência | Semanal, mensal, anual (para fixas) |
| Natureza gerencial | Operacional, administrativo, financeiro, etc. |
| Grupo DRE | Onde aparece no demonstrativo |
| Política de alocação | Rateio por receita, CC direto, manual, etc. |
| Centro de custo padrão | CC sugerido ao lançar |
| Exige centro de custo | Obriga CC no lançamento |
| Afeta DRE | Se entra no demonstrativo |
| Ativo | Desative tipos obsoletos |

| Papel | Ação |
|-------|------|
| **Gestor** | Aprova classificação DRE e natureza |
| **A1** | Mantém catálogo alinhado ao contador |
| **A2** | Usa tipos corretos ao lançar despesas |

---

### 2.7 Fornecedores

**Caminho:** Configurações → aba **Fornecedores** (`?tab=fornecedores`)

| Campo | O que preencher |
|-------|-----------------|
| Nome / CPF ou CNPJ | Identificação do beneficiário |
| Categoria | Classificação interna |
| Chave PIX | Para pagamento |
| Ativo | Fornecedor em uso |

| Papel | Ação |
|-------|------|
| **Gestor** | — |
| **A1** | Cadastra fornecedores de serviços administrativos |
| **A2** | Cadastra fornecedores operacionais |

---

### 2.8 Cadastros — Prestadores, Sócios e Parceiros

**Caminho:** Faturamento → **Cadastros** (`/billing/cadastros`)

#### Prestadores internos (`?tab=prestadores`)

| Campo | O que preencher |
|-------|-----------------|
| Nome, CPF/CNPJ, cargo | Identificação |
| Contatos e endereço | Comunicação |
| PIX | Pagamento |
| Entidade pagadora | Coop ou Flux |
| Centro de custo padrão | Alocação de custo |
| Honorário mensal (R$) | Base da folha |
| Ativo | Vínculo vigente |

**Adiantamento a prestador** (na ficha do prestador): valor, parcelas, início do desconto, frequência (semanal/quinzenal/mensal). Gera conta corrente com compensação automática na folha.

#### Sócios (`?tab=socios`)

| Campo | O que preencher |
|-------|-----------------|
| Entidade | Coop ou Flux |
| Nome, CPF/CNPJ | Identificação |
| Participação (%) | Quadro societário |
| Pró-labore mensal (R$) | Base da folha |
| Administrador | Sim/não |
| PIX e contatos | Pagamento |
| Datas de vínculo | Início/fim |

#### Parceiros comerciais (`?tab=parceiros`)

| Campo | O que preencher |
|-------|-----------------|
| Papel | Vendedor, indicador ou ambos |
| Entidade padrão | Quem paga a comissão |
| Regra | % sobre negócio ou valor fixo por conversão |
| PIX e contatos | Pagamento |

| Papel | Ação |
|-------|------|
| **Gestor** | Aprova honorários, pró-labore e regras de comissão |
| **A1** | Mantém cadastros e documentação |
| **A2** | Consulta ao gerar folha e comissões |

---

### 2.9 Comissão de líderes e impostos DRE

**Comissão de líderes:** Configurações → `?tab=comissao-lideres`  
Percentual sobre a **margem Flux** por líder de operação.

**Impostos DRE:** Configurações → `?tab=impostos-dre`  
Alíquotas de ISS, Simples, INSS cooperados etc., com vigência por competência.

| Papel | Ação |
|-------|------|
| **Gestor** | Define percentuais e alíquotas |
| **A1** | Confere impacto em relatórios ao contador |
| **A2** | — |

---

### 2.10 Integrações Flux

**Caminho:** `/billing/integracoes` (digitar na barra ou favoritar)

| Integração | Função |
|------------|--------|
| Flux API | Sincronizar entregas do sistema de delivery |
| Flux MySQL | Importação alternativa de entregas |
| App externo | Conectores adicionais |

Valide **CodPes** e **CodLoc** de cada farmácia antes do primeiro acerto.

| Papel | Ação |
|-------|------|
| **Gestor** | — |
| **A1** | — |
| **A2** | **Executa sync**, confere entregas importadas |

---

## 3. Ciclo semanal de acerto

### 3.1 Visão da semana

```mermaid
flowchart LR
  DOM["Dom — ciclo fecha"]
  SEG["Seg — acertos + faturas"]
  TER["Ter — PIX diárias"]
  QUA["Qua — baixa recebimentos"]
  QUI["Qui — PIX acerto"]
  SEX["Sex — conciliação"]

  DOM --> SEG --> TER --> QUA --> QUI --> SEX
```

Dois fluxos em paralelo:

| | Diárias (terça) | Acerto semanal (quinta) |
|--|-----------------|-------------------------|
| Onde | `/financial` | `/billing` |
| Depende de fatura da farmácia? | **Não** | **Sim** (ou liberação do Gestor) |

### 3.2 Entregas

**Caminho:** `/billing/entregas`

| Ação | Gestor | A1 | A2 |
|------|:------:|:--:|:--:|
| Importar Flux / ATIVMOB | — | — | **Faz** |
| Conferir origem (API, manual, app) | — | — | **Faz** |
| Marcar como verificada | — | — | **Faz** |
| Corrigir farmácia/entregador errado | — | — | **Faz** |
| Lançamento manual excepcional | Aprova | — | **Faz** |

Filtros úteis: ciclo, farmácia, entregador, status de verificação.

### 3.3 Acertos

**Caminho:** `/billing/acertos`

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Criar ciclo (período seg–dom) | — | — | **Faz** |
| Revisar linhas por farmácia/entregador | Consulta | Consulta | **Faz** |
| Tratar alertas de MG e diárias | — | — | **Faz** |
| Submeter para revisão (`em revisão`) | — | — | **Faz** |
| **Aprovar todos** (`approve-all`) | **Faz** | — | — |

**O que o sistema faz ao aprovar todos:**
1. Aplica efeitos de cotas e recuperações cooperativas  
2. Gera faturas CoopMob e Flux Farma  
3. Gera contas a pagar dos entregadores  
4. Prepara lote PIX elegível  

Detalhe por farmácia: clique na linha → `/billing/acertos/ciclo/[ciclo]/farmacia/[farmácia]`.

### 3.4 Faturamento (faturas)

**Caminho:** `/billing/faturamento`

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Conferir faturas geradas | Consulta | **Faz** | — |
| Aprovar fatura na plataforma | — | **Faz** | — |
| Emitir NF-e / NFS-e | — | **Faz** (sistema externo) | — |
| Emitir boleto | — | **Faz** (sistema externo) | — |
| Enviar cobrança + link público | — | **Faz** | — |
| Cobrança ativa / 2ª via | — | **Faz** | — |

O **relatório público** (`/public/billing/[token]`) mostra o resumo CoopMob (Flux incluída quando aplicável). Copie o link na tela de faturamento ou A receber.

### 3.5 A receber

**Caminho:** `/billing/receber`

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Monitorar vencidos | Consulta | **Faz** | — |
| Registrar baixa (pagamento recebido) | — | **Faz** | — |
| Conferir saldo após baixa | — | **Faz** | — |

**Importante:** baixa **não é** conciliação. A baixa registra o recebimento; a conciliação casa com o extrato bancário na sexta.

### 3.6 A pagar

**Caminho:** `/billing/pagar`

Abas: **Entregadores** | **Operacional Coop** | **Operacional Flux** | **Outros**

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Conferir payables gerados pelo acerto | Consulta | Consulta | **Faz** |
| **Liberar bloqueados** (fatura não baixada) | **Faz** | — | Solicita |
| Aprovar título | — | Confere docs | **Faz** |
| Registrar baixa após PIX | — | — | **Faz** |
| Gerar folha mensal (sócios + prestadores) | Aprova | Confere valores | **Faz** |

Campos visíveis: descrição, entidade, CC, vencimento, bruto, compensações, líquido, saldo, status, situação no lote PIX.

### 3.7 Pagamento PIX (lote)

**Caminho:** `/billing/relatorios/pagamento-pix`

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Filtrar data de pagamento e entidade | — | — | **Faz** |
| Selecionar títulos elegíveis | — | — | **Faz** |
| Revisar alertas (CPF, PIX, bloqueio) | Consulta | — | **Faz** |
| Exportar planilha C6 | — | — | **Faz** |
| **Aprovar lote** | **Faz** | — | Envia à Liliane |
| Liliane executa no banco | — | — | — (externo) |
| Baixar títulos pagos | — | — | **Faz** |

**Regra:** Analista 2 **não** executa PIX no banco. Liliane sobe a planilha no C6.

### 3.8 Conciliação bancária

**Caminho:** `/billing/conciliacao`

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Importar extrato (Cora, C6, CSV, OFX) | — | — | **Faz** |
| Conciliar **entradas** | Valida | **Faz** | — |
| Conciliar **saídas** | Valida | — | **Faz** |
| Resolver pendências | **Faz** | Apoia | Apoia |

Formatos aceitos: Cora CSV, C6 CSV, CSV genérico, OFX.

---

## 4. Despesas

### 4.1 Lançamento

**Caminho:** `/billing/despesas`

| Campo | O que preencher |
|-------|-----------------|
| Descrição | Texto livre |
| Tipo (catálogo) | Fixa ou variável |
| Entidade pagadora | Coop / Flux / Ambas |
| Centro de custo | Obrigatório se o tipo exigir |
| Valor (R$) | Valor do título |
| Vencimento | Data de pagamento |
| Rateio | Igual, percentual ou valor por CC/farmácia/prestador |
| Recorrência | Para despesas fixas repetidas |
| Status | Rascunho → aprovado → pago |

Salvar gera automaticamente um título em **A pagar**.

| Papel | Ação |
|-------|------|
| **Gestor** | Aprova despesas acima da alçada |
| **A1** | Confere despesas administrativas e recorrentes (1ª semana do mês) |
| **A2** | **Lança** despesas operacionais e variáveis |

### 4.2 Geração de recorrentes

Despesas fixas mensais podem ser geradas em lote a partir do catálogo (ação na tela de Despesas). Revise valores antes de aprovar.

---

## 5. Cotas e capital cooperativo

### 5.1 Cotas (conta corrente do cooperado)

**Caminho:** `/billing/cotas`

| Função | Descrição |
|--------|-----------|
| Saldos | Integralizado, compensado, devolvido, saldo atual |
| Extrato | Movimentos por cooperado |
| Nova cota | Criada via módulo **Financeiro** (`/financial`) — billing exibe e integra no acerto |

| Papel | Ação |
|-------|------|
| **Gestor** | Decide compensar/devolver em desligamentos |
| **A1** | Consulta saldos para relatórios |
| **A2** | Acompanha integralizações e vencimentos |

### 5.2 Capital cooperativo

**Caminho:** `/billing/capital-cooperativo` ou exportação no hub de Relatórios

Extrato mensal: integralizações, compensações, devoluções, ajustes e recuperações. **Não entra na margem operacional da farmácia** no DRE.

| Papel | Ação |
|-------|------|
| **Gestor** | Valida fechamento mensal |
| **A1** | Exporta para contador |
| **A2** | Confere movimentos com acertos |

---

## 6. Comissões

### 6.1 Líderes de operação (margem Flux)

**Configuração:** `/billing/config?tab=comissao-lideres`  
**Relatório:** `/billing/relatorios/comissoes-lideres`

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Definir % por líder | **Faz** | — | — |
| Apurar competência | — | Confere | **Faz** |
| Gerar contas a pagar | Aprova | — | **Faz** |
| Exportar CSV | — | Envia contador | **Faz** |

Vencimento padrão: dia 15 do mês seguinte.

### 6.2 Parceiros comerciais

**Cadastro:** `/billing/cadastros?tab=parceiros`  
**Relatório:** `/billing/relatorios/comissoes`

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Cadastrar parceiro e regra | Aprova | **Faz** | — |
| Apurar provisões (leads ganhos) | — | Confere | **Faz** |
| Gerar AP consolidado | Aprova | — | **Faz** |

---

## 7. Relatórios regulatórios e gerenciais

**Hub:** `/billing/relatorios`

### 7.1 Exportações com filtros (Excel/CSV)

| Relatório | Conteúdo | Gestor | A1 | A2 |
|-----------|----------|:------:|:--:|:--:|
| Capital cooperativo | Cotas e recuperações | Valida | **Exporta** | Confere |
| Conta corrente de cotas | Saldos por cooperado | — | **Exporta** | — |
| Conta corrente de prestadores | Adiantamentos e saldos | — | **Exporta** | **Exporta** |

### 7.2 Telas dedicadas

| Relatório | Caminho | Conteúdo | Gestor | A1 | A2 |
|-----------|---------|----------|:------:|:--:|:--:|
| DRE gerencial | `/billing/dre` | Resultado por competência, Coop/Flux | **Fecha** | Exporta | Confere pré-requisitos |
| INSS — Contabilidade | `/billing/relatorios/inss-contabilidade` | Cooperados: nome, CPF, remuneração | — | **Envia contador** | — |
| INSS — Pró-labore sócios | `/billing/relatorios/inss-pro-labore-socios` | Lista de pró-labore | — | **Envia contador** | — |
| Seguradora | `/billing/relatorios/seguradora` | Ativos + desligados no mês | — | **Envia** | — |
| Pagamentos PIX | `/billing/relatorios/pagamento-pix` | Lote C6 | Aprova | — | **Prepara** |
| Comissões líderes | `/billing/relatorios/comissoes-lideres` | Margem e comissão | Aprova | Confere | **Apura** |
| Comissões parceiros | `/billing/relatorios/comissoes` | Por lead/negócio | Aprova | Confere | **Apura** |

**DRE — cutover:** competências a partir de **julho/2026**. Meses anteriores exibem aviso e não são recalculados.

**Pré-requisitos para fechar DRE:**
1. Ciclos aprovados no mês  
2. Folha gerada  
3. Despesas lançadas  
4. Comissões apuradas  
5. Impostos configurados  
6. Baixas e pendências de conciliação revisadas  

---

## 8. Desligamento de cooperado

**Caminho:** `/billing/desligamento/[id]` (abre da Visão geral ou fluxo de Operação)

Não há botão “novo desligamento” no Faturamento — a prévia é criada pelo fluxo operacional.

| Etapa | Gestor | A1 | A2 |
|-------|:------:|:--:|:--:|
| Conferir entregas e acertos pendentes | — | — | **Faz** |
| Decidir cotas (cancelar/compensar/devolver) | **Faz** | Apoia | **Faz** |
| Conferir adiantamentos e MG proporcional | — | — | **Faz** |
| Validar CPF, PIX e assinatura do termo | — | Confere docs | **Faz** |
| Marcar conferência OK | — | — | **Faz** |
| Gerar pagamento final | Aprova | — | **Faz** |

Bloqueios comuns: CPF/PIX ausente, termo não assinado, decisão de cota pendente.

---

## 9. Integração com o módulo Financeiro

O Financeiro (`/financial`) e o Faturamento trabalham juntos:

| Assunto | Onde lança | Onde aparece no acerto |
|---------|------------|------------------------|
| Diária de cobertura | `/financial` | Acerto + cobrança farmácia (se configurado) |
| Falta do entregador | `/financial` | Desconto no acerto |
| Adiantamento **entregador** | `/financial` | Compensação no acerto |
| Adiantamento **prestador** | Cadastro prestador | Folha / conta corrente |
| Nova cota (integralização) | `/financial` | Cotas + capital cooperativo |
| Parcelas diárias (terça) | `/financial` | Pagamento independente do acerto de quinta |

| Papel | Ação |
|-------|------|
| **Gestor** | Define exceções de cobrança de diária |
| **A1** | — |
| **A2** | **Levantamento segunda:** aprovar diárias, resolver pendências, preparar PIX terça |

---

## 10. Visão geral — alertas e KPIs

**Caminho:** `/billing`

Painéis: contas a receber, a pagar, atrasos, baixas pendentes de conciliação.

**Notificações** (clique leva à tela correta):

| Tipo de alerta | Significado | Quem resolve |
|----------------|-------------|--------------|
| MG / diária pendente | Revisar no acerto ou Financeiro | A2 |
| PIX bloqueado (fatura não paga) | Farmácia ainda não baixou | A1 baixa ou Gestor libera |
| Conciliação pendente | Baixa sem extrato | A1/A2 na sexta |
| Desligamento com pendências | Conferência incompleta | A2 + Gestor |

---

## 11. Calendário resumido

### Semanal

| Dia | A1 | A2 | Gestor |
|-----|----|----|--------|
| **Dom** | — | — | Ciclo fecha |
| **Seg** | NF, boleto, envio farmácias | Validar entregas; revisar e submeter acertos | **Aprovar acertos** |
| **Ter** | Cobrança ativa | Baixa diárias após Liliane | Aprovar lote diárias |
| **Qua** | **Baixa recebimentos** | Preparar PIX quinta | Liberar bloqueios |
| **Qui** | — | Baixa payables após Liliane | Aprovar lote acerto |
| **Sex** | Conciliação entradas | Conciliação saídas | Validar conciliação |

### Mensal

| Semana | A1 | A2 | Gestor |
|--------|----|----|--------|
| 1ª | Conferir despesas recorrentes | Folha + comissões líderes | Aprovar folha |
| 2ª | Validar comissões parceiros | Gerar AP comissões | Aprovar |
| 3ª | Revisar cadastros | Despesas variáveis | Aprovar despesas altas |
| Última | Pacote contador (INSS, seguradora) | Export DRE e capital coop. | **Fechar DRE** |

---

## 12. O que o sistema não faz

| Atividade | Onde é feita |
|-----------|--------------|
| Emissão de NF-e / NFS-e | Emissor externo (ex.: prefeitura/ERP) |
| Emissão de boleto | Banco ou emissor externo |
| Upload PIX no C6 | Liliane — internet banking |
| Cálculo de guia INSS | Contador (sistema só exporta bases) |
| Envio à seguradora | A1 exporta planilha e envia por e-mail |

---

## 13. Erros comuns e como resolver

| Problema | Causa provável | Solução |
|----------|----------------|---------|
| Farmácia não aparece no acerto | Sem CC ou inativa | Vincular CC na ficha da farmácia |
| Entregas não importam | CodPes/CodLoc errado | Corrigir farmácia + sync em Integrações |
| PIX entregador bloqueado | Fatura não baixada | A1 baixa em A receber ou Gestor libera |
| Diária não cobrada da farmácia | `charge_pharmacy` não definido | Resolver em Financeiro na segunda |
| CC sem farmácia representante | Cadastro incompleto | Configurações → Centros de custo |
| Tipo de despesa sem CC | `exige centro de custo` | Informar CC no lançamento |
| DRE não fecha | Ciclo ou folha pendente | Ver checklist cap. 7.2 |
| Grupo de rateio sem efeito | Farmácias não selecionadas | Revisar participantes do grupo |

---

## 14. Anexo — mapa completo de telas

| Caminho | Função principal |
|---------|------------------|
| `/billing` | Dashboard e alertas |
| `/billing/acertos` | Ciclos e acertos |
| `/billing/acertos/ciclo/.../farmacia/...` | Detalhe entregador × farmácia |
| `/billing/entregas` | Entregas do ciclo |
| `/billing/faturamento` | Faturas |
| `/billing/receber` | Contas a receber |
| `/billing/pagar` | Contas a pagar |
| `/billing/despesas` | Lançamentos de despesa |
| `/billing/cotas` | Cotas cooperados |
| `/billing/capital-cooperativo` | Capital cooperativo |
| `/billing/conciliacao` | Conciliação bancária |
| `/billing/cadastros` | Prestadores, sócios, parceiros |
| `/billing/relatorios` | Hub de relatórios |
| `/billing/config` | Configurações gerais |
| `/billing/config?tab=entidades` | CoopMob e Flux |
| `/billing/config?tab=centros` | CCs, rateio diárias, feriados |
| `/billing/config?tab=tipos` | Catálogo de despesas |
| `/billing/config?tab=fornecedores` | Fornecedores |
| `/billing/config?tab=contas-bancarias` | Contas e PIX |
| `/billing/config?tab=comissao-lideres` | % comissão líderes |
| `/billing/config?tab=impostos-dre` | Alíquotas DRE |
| `/billing/integracoes` | Flux API / MySQL |
| `/billing/dre` | DRE gerencial |
| `/billing/desligamento/[id]` | Desligamento |
| `/billing/relatorios/pagamento-pix` | Lote PIX C6 |
| `/billing/relatorios/inss-contabilidade` | INSS cooperados |
| `/billing/relatorios/inss-pro-labore-socios` | INSS pró-labore |
| `/billing/relatorios/seguradora` | Seguradora |
| `/billing/relatorios/comissoes-lideres` | Comissões líderes |
| `/billing/relatorios/comissoes` | Comissões parceiros |
| `/pharmacies` | Cadastro farmácia + faturamento |
| `/financial` | Diárias, faltas, adiantamentos entregador |
| `/public/billing/[token]` | Relatório público farmácia |

---

## 15. Checklist de go-live (configuração mínima)

Use antes do primeiro acerto real em produção:

- [ ] Entidades CoopMob e Flux cadastradas com CNPJ e banco  
- [ ] Conta bancária padrão + template C6 por entidade  
- [ ] Centros de custo criados com calendário (qua vencimento / qui pagamento)  
- [ ] Farmácias ativas vinculadas a CC com e-mail de faturamento  
- [ ] CodPes/CodLoc preenchidos nas farmácias com Flux  
- [ ] Integração testada (entregas aparecem em Entregas)  
- [ ] Catálogo de tipos de despesa semeado/revisado  
- [ ] Prestadores, sócios e parceiros ativos cadastrados  
- [ ] Comissão de líderes e impostos DRE configurados  
- [ ] Usuários A1, A2 e Gestor com papel `financial` ou `supervisor`  
- [ ] Liliane alinhada ao fluxo de aprovação antes do PIX  

---

*Para governança detalhada (RACI completo, segregação de funções e fluxos com Liliane), consulte [FINANCEIRO_ONBOARDING_OPERACIONAL.md](./FINANCEIRO_ONBOARDING_OPERACIONAL.md).*
