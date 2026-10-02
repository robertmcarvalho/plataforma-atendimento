# Checklist de conformidade — NT 008/2026 v1.02 (Especificações Técnicas do DANFSe)

Fonte: [NT 008 v1.02, 14/07/2026 (PDF oficial)](https://www.gov.br/nfse/pt-br/biblioteca/documentacao-tecnica/rtc/nt-008-se-cgnfse-danfse-20260714-v1-02.pdf).
A API oficial de geração do DANFSe (`adn.nfse.gov.br/danfse`) será **sobrestada em 03/08/2026**.

Legenda de status: ✅ implementado · 🟡 parcial · ❌ pendente

## Regras gerais

| # | Requisito (item da NT) | Status |
|---|---|---|
| G1 | Campos representam o conteúdo das TAGs XML; **não imprimir informação que não conste do XML** (2.1) | ✅ |
| G2 | Campos sem informação no XML → preencher com traço `-` (Nota 12) | ✅ |
| G3 | Conteúdo que exceda o campo → reticências `...` (2.1, notas do 2.4.5) | ✅ |
| G4 | **Página única obrigatória** (2.2) | ✅ (testado) |
| G5 | A4 retrato mínimo, 210×297mm (2.2.1) | ✅ |
| G6 | Margens entre corpo impresso e borda do papel: mín 0,15cm, máx 0,20cm em cada lado (2.2.2) | ✅ |
| G7 | Linhas divisórias dos blocos: 0,5pt; borda da página: 1pt (2.2.3) | ✅ |
| G8 | Sombreamento cinza 5% no cabeçalho, títulos de bloco e campos "Emitente da NFS-e" e "Valor Líquido da NFS-e + IBS/CBS"; demais campos fundo branco (2.2.3) | ✅ |
| G9 | **Modelo do Anexo I obrigatório** — disposição dos campos deve obedecer ao anexo (2.2.4) | ✅ |
| G10 | Tamanhos/posições do item 2.4.5 são sugestão; tamanhos MÍNIMOS de fonte do item 2.4 são obrigatórios (2.1) | ✅ |

## Fontes (2.4)

| # | Requisito | Status |
|---|---|---|
| F1 | Arial para títulos/labels; Microsoft Sans Serif para conteúdos; preto sólido K100 | ✅ Liberation Sans embutida (métrica compatível com Arial, OFL-1.1); usada também no papel da MS Sans Serif (sem clone métrico livre) |
| F2 | Títulos de blocos: 7pt **negrito CAIXA ALTA** (2.4.1) | ✅ |
| F3 | Labels de campos: 6pt negrito, Primeira Letra Maiúscula (2.4.2) | ✅ |
| F4 | Labels do bloco de identificação: 7pt negrito CAIXA ALTA (2.4.2) | ✅ |
| F5 | Conteúdo dos campos: 7pt normal (2.4.3/2.4.4) | ✅ |

## Cabeçalho (2.4.3)

| # | Requisito | Status |
|---|---|---|
| C1 | Canto esquerdo: logomarca oficial da NFS-e | ✅ |
| C2 | Centro: "DANFSe v2.0" e abaixo "Documento Auxiliar da NFS-e", negrito, 9pt Arial | ✅ |
| C3 | Canto direito: Município do emitente (`xLocEmi` + UF) 8pt; "Ambiente Gerador" (`ambGer`) e "Tipo de Ambiente" (`tpAmb`) 6pt | ✅ |
| C4 | Município do cabeçalho NÃO exibido quando item do cód. tributação nacional = 99 (2.4.5) | ✅ |
| C5 | `tpAmb=2` → "NFS-e SEM VALIDADE JURÍDICA" negrito 9pt vermelho (M100/Y100) abaixo do título | ✅ (usa tpAmb, não ambGer) |
| C6 | QR Code ≥ 1,52 × 1,52 cm, canto direito (X 17,48 / Y 1,67) | ✅ |
| C7 | URL do QR: `https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=` + chave de acesso | ✅ |
| C8 | Abaixo do QR, em 3 linhas, 6pt: "A autenticidade desta NFS-e pode ser verificada pela leitura deste código QR ou pela consulta da chave de acesso no portal nacional da NFS-e" | ✅ |

## Blocos e campos (2.1 e 2.4.5) — caminho XML oficial

### Chave de acesso (2.1.1)
- Bloco único com 50 dígitos, `infNFSe/@Id` sem o prefixo "NFS" ✅

### Dados de identificação (2.1.2)
| Campo | XML | Status |
|---|---|---|
| Número da NFS-e | `infNFSe/nNFSe` | ✅ |
| Competência da NFS-e | `infDPS/dCompet` (DD/MM/AAAA) | ✅ |
| Data e Hora da emissão da NFS-e | `infNFSe/dhProc` (DD/MM/AAAA hh:mm:ss) | ✅ |
| Número da DPS | `infDPS/nDPS` | ✅ |
| Série da DPS | `infDPS/serie` | ✅ |
| Data e Hora da emissão da DPS | `infDPS/dhEmi` | ✅ |
| Emitente da NFS-e | `infDPS/tpEmit` (1=Prestador, 2=Tomador, 3=Intermediário) | ✅ |
| Situação da NFS-e | `infNFSe/cStat` | 🟡 código bruto exibido (tabela de descrições do leiaute pendente) |
| Finalidade | `infDPS/IBSCBS/finNFSe` (`-` quando ausente no leiaute 1.01) | 🟡 código bruto exibido |

### Prestador/Fornecedor (2.1.3) — `infDPS/prest`
CNPJ/CPF/NIF ✅ · Inscrição Municipal ✅ · Telefone ✅ · Nome ✅ · Município/UF ✅ · Código IBGE/CEP ✅ · Endereço* ✅ · Email* ✅ · Simples Nacional (`opSimpNac`) ✅ · Regime de Apuração SN (`regApTribSN`) ✅

### Tomador/Adquirente (2.1.4) — `infDPS/toma`
Mesmos campos (sem SN) ✅ · Ausente → linha única "TOMADOR/ADQUIRENTE DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" (Nota 2) ✅

### Destinatário da Operação (2.1.5) — `infDPS/IBSCBS/dest` (leiaute NT 009)
Ausente → linha única "DESTINATÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" ✅ · Igual ao tomador → "O DESTINATÁRIO É O PRÓPRIO TOMADOR/ADQUIRENTE DA OPERAÇÃO" (Nota 3) ✅

### Intermediário da Operação (2.1.6) — `infDPS/interm`
Presente → bloco completo ✅ · Ausente → linha única "INTERMEDIÁRIO DA OPERAÇÃO NÃO IDENTIFICADO NA NFS-e" ✅

### Serviço Prestado (2.1.7)
| Campo | XML | Status |
|---|---|---|
| Cód. Tributação Nacional/Municipal | `cServ/cTribNac` (nn.nn.nn) + `cTribMun` | ✅ |
| Código da NBS | `cServ/cNBS` (n.nnnn.nn.nn) | ✅ |
| Local da Prestação / UF / País | `infNFSe/xLocPrestacao` + `serv/locPrest/cPaisPrestacao` | 🟡 município + país; UF não exibida (não consta isolada no XML) |
| Descrição do Cód. Trib. (SEM label): se `xTribMun` ≠ "" usa municipal senão nacional (máx 170) | `infNFSe/xTribNac`/`xTribMun` | ✅ |
| Descrição do Serviço | `cServ/xDescServ` (máx 1300) | ✅ |

### Tributação Municipal ISSQN (2.1.8) — Nota 4: sem incidência → linha única "TRIBUTAÇÃO MUNICIPAL (ISSQN) - OPERAÇÃO NÃO SUJEITA AO ISSQN"
| Campo | XML | Status |
|---|---|---|
| Tipo de Tributação do ISSQN | `trib/tribMun/tribISSQN` (1-4) | ✅ |
| Município/UF/País de Incidência | `infNFSe/xLocIncid` + `cPaisResult` | ✅ |
| Regime Especial de Tributação** | `prest/regTrib/regEspTrib` (0-6, 9) | ✅ |
| Tipo de Imunidade** | `tribMun/tpImunidade` (1-5) | ✅ |
| Suspensão da Exigibilidade** | `tribMun/exigSusp/tpSusp` | ✅ |
| Nº Processo Suspensão** | `exigSusp/nProcesso` | ✅ |
| Benefício Municipal** | `infNFSe/valores/tpBM` | 🟡 código bruto exibido (descrições do leiaute pendentes) |
| Cálculo do BM** | `vCalcBM` ou `vRedBCBM` | ✅ |
| Total Deduções/Reduções** | `vDR`/`vCalcDR` + `vCalcReeRepRes` | ✅ |
| Desconto Incondicionado** | `valores/vDescIncond` | ✅ |
| BC ISSQN | `infNFSe/valores/vBC` | ✅ |
| Alíquota Aplicada | `infNFSe/valores/pAliqAplic` | ✅ |
| Retenção do ISSQN | `tribMun/tpRetISSQN` | ✅ |
| ISSQN Apurado | `infNFSe/valores/vISSQN` | ✅ |

(** linha suprimível quando TODOS os campos da linha estão vazios — Nota 5)

### Tributação Federal exceto CBS (2.1.9)
| Campo | XML / regra (v1.02!) | Status |
|---|---|---|
| IRRF | `trib/tribFed/vRetIRRF` | ✅ |
| Contribuição Previdenciária – Retida | `tribFed/vRetCP` | ✅ |
| Contribuições Sociais – Retidas | `tpRetPisCofins=1` → `vRetCSLL + vPis + vCofins`; senão → `vRetCSLL` | ✅ |
| PIS – Débito Apuração Própria*** | `tpRetPisCofins=1` → `0,00`; senão → `vPis` | ✅ |
| COFINS – Débito Apuração Própria*** | `tpRetPisCofins=1` → `0,00`; senão → `vCofins` | ✅ |
| Descrição Contrib. Sociais – Retidas | `tribFed/piscofins/tpRetPisCofins` (descrição, máx 35) | ✅ |

(*** linha impressa para competência até o fim do ano-calendário 2026 — Nota 6)

### Tributação IBS/CBS (2.1.10) — bloco condicional à presença de `IBSCBS`
CST/cClassTrib ✅ · Indicador Operação + Cód. IBGE/Município/UF Incidência ✅ · Exclusões e Reduções da BC (soma `vDescIncond+vCalcReeRepRes+vISSQN+vPis+vCofins`) ✅ · BC após exclusões (`IBSCBS/valores/vBC`) ✅ · Reduções de alíquota (pRedAliqUF/Mun/CBS) ✅ · Alíquotas IBS UF/Mun ✅ · Alíq. efetivas + valores apurados Mun/UF ✅ · `vIBSTot` ✅ · `pCBS`/`pAliqEfetCBS`/`vCBS` ✅

### Valor Total da NFS-e (2.1.11)
| Campo | XML | Status |
|---|---|---|
| Valor da Operação/Serviço | `valores/vServPrest/vServ` | ✅ |
| Desconto Incondicionado | `vDescIncond` | ✅ |
| Desconto Condicionado | `vDescCond` | ✅ |
| Total das Retenções (ISSQN/Federais) | `infNFSe/valores/vTotalRet` | ✅ |
| Valor Líquido da NFS-e | `infNFSe/valores/vLiq` | ✅ |
| Total do IBS/CBS | `vIBSTot + vCBS` | ✅ |
| Valor Líquido da NFS-e + IBS/CBS (sombreado) | `IBSCBS/totCIBS/vTotNF` | ✅ |

### Informações Complementares (2.1.12)
União dos campos na ordem: Inf. Cont.; NFS-e Subst. (`chSubstda`, Nota 7); Doc. Ref.; Cod. Obra / Insc. Imob. (Nota 8); Cod. Evt. (Nota 9); Doc. Tec.; Núm. Ped.; Item Ped.; Inf. A. T. Mun. — separados por pipes ` | ` ✅
**Obrigatório**: "Totais Aproximados dos Tributos cfe. Lei nº 12.741/2012: Federais: R$ ou % ; Estaduais: R$ ou % ; Municipais: R$ ou %" (`totTrib/vTotTrib*` ou `pTotTrib*` ou `pTotTribSN`, Nota 10) ✅

### Canhoto (2.1.13) — OPCIONAL (Nota 11)
Implementado no patch portal (rodapé: data / assinatura / nº+chave). Upstream 0.9.0 omitia (permitido pela NT).

## Outros (2.5)

| # | Requisito | Status |
|---|---|---|
| O1 | NFS-e cancelada → marca d'água diagonal "CANCELADA", ≥50pt, Arial, cinza K35 | ❌ roadmap (o XML autorizado sozinho não indica cancelamento; requer evento/flag externa) |
| O2 | NFS-e substituída → marca d'água "SUBSTITUÍDA" | ❌ roadmap |
| O3 | Limitações de impressora: reduzir apenas a altura de Informações Complementares | ✅ (n/a — PDF gerado usa margens da NT) |
