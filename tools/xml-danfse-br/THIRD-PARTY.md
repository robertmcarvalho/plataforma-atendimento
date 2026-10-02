# Componentes de terceiros do fat-jar da CLI (xml-danfse-br-cli.jar)

Este jar agrega, alem do codigo MIT do xml-danfse-br, os seguintes componentes:

| Componente | Licenca | Fonte |
|---|---|---|
| OpenHTMLtoPDF (openhtmltopdf-core / openhtmltopdf-pdfbox) | LGPL-2.1 | https://github.com/danfickle/openhtmltopdf |
| Apache PDFBox / FontBox / XmpBox | Apache-2.0 | https://pdfbox.apache.org |
| de.rototor.pdfbox:graphics2d | Apache-2.0 | https://github.com/rototor/pdfbox-graphics2d |
| ZXing core | Apache-2.0 | https://github.com/zxing/zxing |
| Liberation Sans (Regular/Bold) | SIL OFL 1.1 | https://github.com/liberationfonts/liberation-fonts |
| Logomarca oficial da NFS-e | CC BY-ND 3.0 (redistribuida sem modificacoes) | https://www.gov.br/nfse |

## Nota sobre a LGPL-2.1 (OpenHTMLtoPDF)

O OpenHTMLtoPDF e agregado neste fat-jar SEM modificacoes, apenas por conveniencia de
distribuicao da CLI. Os jars originais estao disponiveis no Maven Central
(`com.openhtmltopdf:openhtmltopdf-pdfbox:1.0.10`); qualquer pessoa pode reconstruir este
fat-jar substituindo a versao da biblioteca (build: `mvn -Pcli package` no repositorio
https://github.com/rzmt/xml-danfse-br), o que atende ao requisito de reversibilidade da LGPL.

A biblioteca `io.github.rzmt:xml-danfse-br` publicada no Maven Central e MIT pura e declara
o OpenHTMLtoPDF apenas como dependencia (link dinamico), sem agregacao.
