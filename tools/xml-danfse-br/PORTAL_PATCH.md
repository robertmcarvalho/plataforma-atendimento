# Patch portal (PoC Aethera / Flux Farma)

Fork local de [rzmt/xml-danfse-br](https://github.com/rzmt/xml-danfse-br) **v0.9.0** com preferência de textos ao PDF da Consulta Pública.

Vendorizado no monorepo a partir do upstream `ad22909` (licença MIT em `LICENSE`, atribuições em `NOTICE.md` / `THIRD-PARTY.md`).

## O que mudou

| Área | Antes (0.9.0) | Depois (portal-poc) |
|------|---------------|---------------------|
| Acentos / enums | ASCII (`Operacao Tributavel`, `Nao Retido`, `Producao`) | Diacríticos + SN completo |
| `cStat` | Código bruto (`100`) | `100`→`NFS-e Gerada` (+101/102/103/107) |
| Lei 12.741 | Imprime `pTotTribSN` (ex. 18,83%) | Faixas `Federais: -; Estaduais: -; Municipais: -;` |
| Zeros IBS | `-` quando ausente | `R$ 0,00` em exclusões / totais IBS |
| Local prestação / incidência | Só município | `Município / UF / -` (UF via IBGE) |
| Tomador Mun/UF (IBGE) | `Cidade - UF` | `Cidade / UF` |
| Regime especial `0` | Linha com `Nenhum` | Bloco omitido (como portal) |
| Município cabeçalho | `--municipio-nome` via CLI (mojibake no Windows) | Resolve no Java: `xLocEmi` + UF (ou IBGE); ignora override com mojibake |
| Canhoto (2.1.13) | Não implementado (opcional NT) | Rodapé: DATA CIENTIFICAÇÃO / IDENTIFICAÇÃO E ASSINATURA / N° NFS-e / CHAVE NFS-e |

## Encoding do município (cabeçalho)

Causa do bug: PowerShell passa argv em code page Windows; `Uberlândia` vira `UberlÃ¢ndia` na JVM mesmo com `-Dfile.encoding=UTF-8`.

Fix preferido: **não** depender do shell. `DanfseHtmlRenderer.municipioCabecalho()` usa `xLocEmi` + UF do emitente (já UTF-8 no XML). Fallback IBGE via `cMun` se o nome faltar. `--municipio-nome` só se não parecer mojibake.

PoC script (`poc-danfse-xml-danfse-br-delta.ps1`): por padrão **omite** `--municipio-nome`.

## Canhoto

Espelha o portal / Anexo I NT 008 §2.1.13: três colunas no rodapé (~0,67 cm); valor `nNFSe / chave` (sem prefixo `NFS`).

## Preenchimento A4 (layout)

Comparação raster com o PDF oficial DELTA (`317020…875.pdf`): o patched anterior usava ~82% da altura (folga inferior ~5 cm). Ajuste:

| CSS | Antes | Depois |
|-----|-------|--------|
| `@page` margin | 2 mm | **1,5 mm** (mín. NT 0,15 cm) |
| `.frame` | só borda | `min-height: 293,5 mm` |
| `.descserv` | 3,0 cm | **5,5 cm** |
| `.infocompl` | 4,5 cm | **7,0 cm** |

Objetivo: borda do quadro perto das margens do papel como na Consulta Pública.

## Build CLI

```powershell
# Maven 3.9+ / JDK 17+
mvn -Pcli -DskipTests package
# artefato: target/xml-danfse-br-cli.jar
```

PoC no monorepo: `scripts/one-off/poc-danfse-xml-danfse-br-delta.ps1 -UsePatched`.

## Não versionar

`target/` (fat-jar ~7 MB + deps). Sources + este patch sim.
