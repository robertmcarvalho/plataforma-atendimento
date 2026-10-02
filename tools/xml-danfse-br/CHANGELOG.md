# Changelog

## 0.9.0 — 2026-07-25

Primeira versão standalone, extraída do módulo `nfse-danfse` do
[nfse-java-mcp](https://github.com/rafael-matos-dev/nfse-java-mcp) (histórico git preservado).

### Novidades
- **Layout reescrito no modelo obrigatório do Anexo I da NT 008/2026 v1.02**: cabeçalho
  "DANFSe v2.0" com município/ambiente gerador/tipo de ambiente, identificação com
  Emitente/Situação/Finalidade, blocos Destinatário e Intermediário (com as bandas
  "NÃO IDENTIFICADO NA NFS-e"), margens de 2mm, borda 1pt, divisórias 0,5pt, sombreamento 5%.
- **QR Code de 1,52 × 1,52 cm** com a URL oficial (`nfse.gov.br/ConsultaPublica/?tpc=1&chave=`)
  e o texto de autenticidade do item 2.4.3.
- **Fonte Liberation Sans embutida** (OFL 1.1, métrica da Arial exigida pela NT) — o PDF
  renderiza igual em qualquer visualizador; adeus base-14/Helvetica.
- **Novos campos lidos do XML**: tributação federal (IRRF, Contrib. Previdenciária, CSLL,
  PIS/COFINS com a regra v1.02 do `tpRetPisCofins`), totais aproximados dos tributos
  (`vTotTrib`/`pTotTrib`/`pTotTribSN` → linha obrigatória da Lei 12.741/2012), intermediário,
  destinatário (NT 009), regime especial, imunidade, suspensão de exigibilidade, benefício
  municipal, BC/alíquota/ISSQN apurado/total de retenções, informações complementares
  unificadas com pipes.
- **Leitor com navegação por escopo** (filho direto) — elimina ambiguidade entre `valores`
  e `IBSCBS` de `infNFSe` vs `infDPS`.
- **Novo overload** `DanfseGenerator.gerarPdf(xml[, config])` que infere o ambiente do
  `tpAmb` do próprio XML.
- **CLI standalone** (`xml-danfse-br-cli.jar`): XML → PDF via linha de comando, sem Maven.
- **Testes golden-file visuais**: regressão de layout pixel a pixel com tolerância;
  referências versionadas; `-Dgolden.update=true` para regenerar.

### Mudanças de compatibilidade (vs. nfse-danfse 0.4.5)
- Pacote renomeado: `br.com.nfse.danfse` → `br.com.xmldanfse`.
- Coordenada Maven: `io.github.rafael-matos-dev:nfse-danfse` → `io.github.rzmt:xml-danfse-br`.
- Propriedade de sistema: `nfse.danfse.ibge` → `xmldanfse.ibge`.
- Records `Danfse.*` reestruturados nos blocos da NT 008 (a facade `DanfseGenerator` e a
  `DanfseConfig` mantêm as assinaturas anteriores).
- Java mínimo: 17 (antes 21).
