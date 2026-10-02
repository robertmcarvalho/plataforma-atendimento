# Plano de implementação — MG, diárias, pagamentos e desligamento

Este plano consolida as decisões discutidas para deixar o faturamento aderente à operação real: mínimo garantido por vínculo fixo, diárias integradas ao Financeiro, pagamentos por data, C6 por vencimento, ajuste por feriados/dias não úteis, regras de baixa da fatura da farmácia e acerto automático de desligamento.

## 1. Diretriz principal

O `Financeiro` deve continuar sendo a fonte de verdade para:

- diárias;
- faltas;
- folgas com cobertura;
- cotas;
- adiantamentos;
- descontos;
- outros lançamentos financeiros do entregador.

O `Faturamento` deve consumir esses lançamentos e aplicar:

- cobrança da farmácia;
- repasse ao entregador;
- custo absorvido pela operação;
- split Coop/Flux;
- notificações de auditoria;
- geração de AP e arquivos PIX/C6.

Isso evita duas fontes de verdade para a mesma diária ou falta.

## 2. MG por vínculo fixo mesmo sem entregas

### Regra

Se a farmácia estiver:

- com status `Ativa`;
- com MG habilitado;
- com entregador vinculado ativo/vigente;
- e o entregador for do tipo `Fixo`;

então o motor deve gerar acerto de MG mesmo que não existam entregas no ciclo.

Diarista não gera MG por vínculo. Diarista entra no acerto apenas por:

- entrega efetiva;
- diária aprovada;
- cobertura/folguista, conforme ocorrência.

### Vigência do vínculo

O cálculo deve respeitar:

- `driver_pharmacy_links.started_at`;
- `driver_pharmacy_links.ended_at`;
- status do entregador;
- status da farmácia.

Quando o entregador entra ou sai no meio do ciclo, o MG deve ser proporcional aos dias ativos, salvo se futuramente a operação decidir por contrato cobrar/pagar MG cheio. A recomendação inicial é usar proporcionalidade como regra padrão.

## 3. Diárias e folguistas

### Diária fixa/folguista

Na ficha da farmácia já existe o campo `Cobrar diária automática da farmácia`.

Esse campo deve ser usado também pelo motor de lançamento de diária de folguista:

- se a farmácia cobra diária automática, a diária de folguista já nasce marcada para cobrar da farmácia;
- o valor cobrado e o repasse seguem a configuração da ficha da farmácia;
- o acerto deve exibir a diária como linha de cobrança e repasse.

### Diária eventual/cobertura

Quando uma falta é coberta por:

- diarista contratado apenas para cobrir;
- entregador fixo de outra operação;
- outro entregador da base;

o lançamento pode ter três tratamentos:

- `Cobrar da farmácia`;
- `Absorver pela operação`;
- `Pendente de auditoria`.

Se não houver regra clara na farmácia, o padrão deve ser `Pendente de auditoria`.

### Ajuste recomendado em `financial_entries`

Adicionar campos para decisão de faturamento da diária:

- `daily_billing_treatment`: `charge_pharmacy`, `absorb_operation`, `pending_audit`;
- `daily_pharmacy_charge_amount`: valor a cobrar da farmácia;
- `daily_billing_decided_by`;
- `daily_billing_decided_at`;
- `daily_billing_notes`.

O Financeiro cria a diária; o Faturamento lê esses campos.

## 4. Pagamentos terça/quinta e C6

### Regra operacional desejada

Gerar um arquivo C6 por data de pagamento.

Padrão:

- **terça-feira**: lote apenas de diárias vencidas na terça;
- **quinta-feira**: pagamento semanal único, contendo acerto semanal, MG, entregas, descontos, cotas vencidas e diárias de quinta;
- **outras datas configuradas**: gerar arquivo próprio por data.

Importante: a diária de quinta não deve virar um segundo pagamento separado se ela pertence ao mesmo pagamento semanal. Ela deve entrar no pagamento único da quinta.

### Ajuste técnico

Hoje o AP cooperado e o C6 estão muito ligados ao ciclo. O ajuste necessário é fazer o AP e o PIX trabalharem por `due_date`.

O motor deve:

1. calcular todos os valores do ciclo;
2. separar o que vence na terça, quinta ou outra data;
3. agrupar por data de pagamento;
4. gerar um arquivo C6 para cada data;
5. permitir que o operador visualize a composição de cada lote antes de exportar.

### Exemplo

Para um ciclo fechado domingo:

- terça: `c6-pix-diarias-2026-06-23.xlsx`;
- quinta: `c6-pix-acerto-semanal-2026-06-25.xlsx`.

O arquivo da quinta inclui:

- entregas;
- MG;
- diárias de quinta;
- faltas/descontos aprovados;
- cotas/adiantamentos/uniformes vencidos;
- líquido final do entregador.

### Feriados e dias não úteis

O sistema deve prever calendário de feriados e uma política de ajuste de data de pagamento.

Exemplo: se o pagamento semanal cair na quinta-feira e houver feriado, a operação pode optar por antecipar o pagamento para quarta-feira.

Campos/configurações recomendadas:

- `Calendário de feriados`: nacional, estadual, municipal e feriados próprios da operação;
- `Política para pagamento em feriado`: antecipar para dia útil anterior, postergar para próximo dia útil ou manter data com liberação manual;
- `Política para vencimento de fatura em feriado`: antecipar, postergar ou manter;
- `Aplicar ajuste em C6`: sim/não;
- `Exigir confirmação do operador quando houver ajuste por feriado`: sim/não.

A recomendação inicial é:

- pagamentos aos entregadores: **antecipar para o dia útil anterior**;
- vencimento de fatura da farmácia: **postergar para o próximo dia útil**, salvo regra específica do centro de custo;
- C6: sempre usar a data efetiva ajustada;
- UI: exibir a data original e a data ajustada, por exemplo `quinta 25/06 ajustado para quarta 24/06 por feriado`.

O ajuste por feriado deve ser aplicado antes de agrupar os lotes C6 por data. Portanto, se a quinta for antecipada para quarta, o arquivo deve ser gerado como lote da quarta-feira, contendo o pagamento semanal único que originalmente seria de quinta.

## 5. Fechamento do ciclo, fatura da farmácia e liberação do pagamento

### Situação operacional 1 — pagamento na mesma semana

Alguns clientes seguem este fluxo:

1. ciclo fecha no domingo;
2. apuração/conferência ocorre na segunda-feira;
3. faturamento da farmácia também ocorre na segunda;
4. sistema gera nota fiscal e boleto;
5. vencimento da fatura da farmácia até quarta-feira;
6. pagamento do entregador é liberado na quinta-feira somente se a fatura da farmácia tiver baixa registrada;
7. se a farmácia não pagar até quarta, o pagamento do entregador fica bloqueado;
8. o pagamento é liberado quando houver baixa da fatura ou liberação manual do gestor.

### Situação operacional 2 — pagamento na semana seguinte

Outros clientes seguem o mesmo fluxo de fechamento, mas:

1. fatura vence na semana seguinte;
2. pagamento dos entregadores também ocorre na quinta-feira da semana seguinte.

### Onde configurar

A recomendação é configurar isso no **Centro de Custo**, porque o comportamento pode variar por grupo/cliente/operação.

Campos sugeridos no centro de custo:

- `Dia de fechamento do ciclo`: domingo;
- `Dia de apuração/conferência`: segunda;
- `Dia de faturamento da farmácia`: segunda;
- `Prazo de vencimento da fatura`: quarta da mesma semana ou quarta da semana seguinte;
- `Dia padrão de pagamento dos entregadores`: quinta;
- `Semana de pagamento dos entregadores`: mesma semana ou semana seguinte;
- `Condição para liberar pagamento`: baixa da fatura, liberação do gestor, ou ambos;
- `Permitir pagamento parcial por farmácia`: sim/não;
- `Bloquear C6 se fatura sem baixa`: sim/não;
- `Calendário de feriados aplicável`: nacional/estadual/municipal/customizado;
- `Política de feriado para fatura`: antecipar, postergar ou manter com confirmação;
- `Política de feriado para pagamento do entregador`: antecipar, postergar ou manter com confirmação;
- `Exigir justificativa em liberação manual`: sim/não.

### Regra de bloqueio

Antes de gerar/liberar o lote C6 da quinta, o sistema deve verificar:

- se a fatura da farmácia foi emitida;
- se a fatura tem vencimento configurado;
- se houve baixa de pagamento;
- se existe liberação manual do gestor;
- se há pendências de auditoria no acerto.

Se a fatura não estiver paga e não houver liberação do gestor, o pagamento dos entregadores daquela farmácia deve ficar bloqueado ou destacado como pendente.

Se a data do pagamento ou da fatura cair em feriado/dia não útil, o sistema deve calcular a data efetiva conforme a política do centro de custo antes de validar baixa, vencimento e exportação C6.

## 6. Desligamento do cooperado

Hoje já existe tarefa de revisão financeira no desligamento. A evolução proposta é transformar essa tarefa em uma prévia automática de acerto final.

### Prévia automática deve verificar

- entregas do ciclo em aberto;
- sync Flux API quando aplicável;
- sync MySQL Flux quando aplicável;
- diárias aprovadas e pendentes;
- faltas abonadas ou descontadas;
- MG proporcional até a data de saída;
- cotas já pagas;
- cotas pendentes;
- adiantamentos;
- uniforme, bag e outros descontos;
- PIX e dados cadastrais;
- faturas da farmácia relacionadas ao período;
- bloqueios por baixa pendente ou liberação do gestor.

### Cotas

No desligamento, o sistema deve:

- listar cotas já pagas pelo cooperado;
- calcular o valor a devolver;
- listar cotas pendentes;
- permitir decisão sobre cancelar, manter ou compensar pendências.

### Fluxo

1. Operação solicita/desencadeia desligamento.
2. Sistema encerra vínculos com `ended_at`.
3. Tarefa financeira é criada.
4. Sistema sincroniza entregas em aberto via integrações.
5. Sistema monta prévia automática do acerto final.
6. Operador confere.
7. Gestor libera se necessário.
8. Sistema gera AP e C6 do acerto final.

## 7. Notificações de auditoria

Todo caso fora do esperado deve gerar notificação para o operador do faturamento.

Alertas recomendados:

- fixo com MG e zero entregas, sem falta/folga registrada;
- farmácia ativa com MG habilitado, mas sem fixos vinculados;
- diária de cobertura sem decisão de cobrança;
- diária duplicada no mesmo dia/farmácia/entregador;
- vínculo alterado no ciclo sem datas confiáveis;
- farmácia inativa com entregas importadas;
- fatura da farmácia sem baixa antes do pagamento do entregador;
- lote C6 bloqueado por fatura pendente;
- data de pagamento alterada por feriado;
- feriado sem política configurada para o centro de custo;
- pagamento mantido em feriado sem confirmação manual;
- desligamento com ciclo aberto e integrações não sincronizadas;
- PIX ausente;
- CPF ausente;
- pendências de cotas no desligamento.

## 8. Critérios de aceite

### MG

- Recalcular ciclo gera MG para fixos vinculados mesmo sem entregas.
- Diarista vinculado não gera MG automático.
- Entrada/saída no ciclo proporcionaliza MG.

### Diárias

- Diária de folguista usa configuração da farmácia.
- Diária de cobertura eventual sem regra clara fica pendente de auditoria.
- Diária cobrada da farmácia aparece no acerto como cobrança e repasse.
- Diária absorvida aparece como custo interno, sem cobrança da farmácia.

### Pagamentos

- Sistema gera um lote C6 por data.
- Diária de terça aparece no lote de terça.
- Diária de quinta aparece no pagamento semanal único da quinta.
- Se a quinta for feriado e a política for antecipar, o pagamento semanal único é gerado na quarta-feira.
- A prévia do lote mostra data original, data efetiva e motivo do ajuste por feriado.
- Pagamento semanal pode ser bloqueado por fatura sem baixa.
- Gestor consegue liberar exceção.

### Centro de custo

- Centro de custo permite configurar vencimento da fatura e semana de pagamento dos entregadores.
- Centro de custo permite configurar política de feriados para fatura e pagamento do entregador.
- Clientes com pagamento na mesma semana e clientes com pagamento na semana seguinte funcionam sem alteração de código.

### Desligamento

- Prévia automática inclui entregas, MG proporcional, diárias, faltas, cotas, descontos e PIX.
- Sistema consulta Flux API/MySQL antes de calcular acerto final quando há ciclo aberto.
- Operador consegue conferir e liberar pagamento final.

## 9. Sequência de implementação sugerida

1. Criar migrations de campos de tratamento de diária, política de pagamento no centro de custo e calendário de feriados.
2. Ajustar ficha da farmácia e centro de custo na UI.
3. Criar UI para cadastro/edição de feriados e política de ajuste de datas.
4. Ajustar ocorrências/Financeiro para preencher decisão de faturamento da diária.
5. Ajustar motor de acertos para MG por vínculo fixo e zero entregas.
6. Ajustar AP/C6 para agrupar por data efetiva de vencimento/pagamento.
7. Implementar bloqueio por fatura sem baixa e liberação do gestor.
8. Implementar prévia automática de desligamento.
9. Implementar painel/notificações de auditoria.
10. Rodar validação local com ciclo real antes de produção.

## 10. Observação sobre produção

Antes de deploy em produção:

- validar com um ciclo real local;
- validar casos com Flux API, MySQL e ATIVMOB;
- validar cliente com pagamento na mesma semana;
- validar cliente com pagamento na semana seguinte;
- validar feriado na terça de diária;
- validar feriado na quinta de pagamento semanal;
- validar fatura com vencimento em feriado;
- validar desligamento de cooperado com cotas;
- validar export C6 por data;
- validar bloqueio por fatura sem baixa.
