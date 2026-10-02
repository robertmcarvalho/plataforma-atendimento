package br.com.xmldanfse;

import java.io.ByteArrayInputStream;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

/**
 * Le o XML autorizado da NFS-e ({@code <NFSe><infNFSe>...<DPS><infDPS>}) e monta o {@link Danfse}
 * com os campos do modelo oficial da NT 008/2026. Combina o nivel administrativo (infNFSe: numeros,
 * municipios por nome, valores apurados, IBS/CBS totais) com a DPS embutida (prestador, tomador,
 * intermediario, servico, tributacao declarada). DOM do JDK (sem libs).
 *
 * <p>A navegacao usa filhos diretos ({@code child}/{@code descend}) nos pontos onde o mesmo nome
 * existe em niveis diferentes (ex.: {@code valores} e {@code IBSCBS} existem em infNFSe e em
 * infDPS) e busca em profundidade apenas dentro de escopos pequenos e sem ambiguidade.
 */
public final class NfseXmlReader {

    private NfseXmlReader() {
    }

    public static Danfse read(String xml) {
        Objects.requireNonNull(xml, "xml is required");
        try {
            Document doc = parse(xml);
            Element infNfse = firstByLocalName(doc.getDocumentElement(), "infNFSe");
            if (infNfse == null) {
                throw new DanfseException("XML nao contem elemento infNFSe (esperado o XML autorizado da NFS-e).");
            }
            Element dpsWrap = child(infNfse, "DPS");
            Element dps = dpsWrap != null ? child(dpsWrap, "infDPS") : firstByLocalName(infNfse, "infDPS");
            Element emit = child(infNfse, "emit");
            Element valoresNfse = child(infNfse, "valores");
            Element ibsCbsNfse = child(infNfse, "IBSCBS");
            Element prest = child(dps, "prest");
            Element toma = child(dps, "toma");
            Element interm = child(dps, "interm");
            Element serv = child(dps, "serv");
            Element valoresDps = child(dps, "valores");
            Element trib = child(valoresDps, "trib");
            Element tribMun = child(trib, "tribMun");
            Element tribFed = child(trib, "tribFed");
            Element totTrib = child(trib, "totTrib");
            Element ibsCbsDps = child(dps, "IBSCBS");
            Element dest = child(ibsCbsDps, "dest");
            Map<String, String> municipios = mapaMunicipios(infNfse, dps, serv, ibsCbsNfse);

            return new Danfse(
                chaveAcesso(infNfse),
                homologacao(dps),
                identificacao(infNfse, dps, ibsCbsDps),
                pessoa(emit, prest, municipios),
                pessoa(toma, null, municipios),
                pessoa(dest, null, municipios),
                pessoa(interm, null, municipios),
                servico(infNfse, serv),
                tributacaoMunicipal(infNfse, valoresNfse, dps, valoresDps, tribMun, prest),
                tributacaoFederal(tribFed),
                ibsCbs(ibsCbsNfse, ibsCbsDps, valoresNfse, valoresDps, tribFed),
                valores(valoresNfse, valoresDps),
                totaisTributos(totTrib),
                informacoesComplementares(infNfse, dps, serv, valoresNfse)
            );
        } catch (DanfseException exception) {
            throw exception;
        } catch (Exception exception) {
            throw new DanfseException("Nao foi possivel ler o XML da NFS-e.", exception);
        }
    }

    // Coleta pares codigo->nome de municipio que o proprio XML fornece (cLocIncid/xLocIncid,
    // cLocEmi/xLocEmi, cLocPrestacao/xLocPrestacao). Resolve o nome no endereco do prestador/tomador
    // quando o municipio for um desses (caso comum: prestador na cidade de emissao). Sem tabela IBGE.
    private static Map<String, String> mapaMunicipios(Element infNfse, Element dps, Element serv, Element ibsCbsNfse) {
        Map<String, String> mapa = new HashMap<>();
        addPar(mapa, childText(infNfse, "cLocIncid"), childText(infNfse, "xLocIncid"));
        addPar(mapa, childText(dps, "cLocEmi"), childText(infNfse, "xLocEmi"));
        Element locPrest = child(serv, "locPrest");
        addPar(mapa, childText(locPrest, "cLocPrestacao"), childText(infNfse, "xLocPrestacao"));
        addPar(mapa, text(ibsCbsNfse, "cLocalidadeIncid"), text(ibsCbsNfse, "xLocalidadeIncid"));
        return mapa;
    }

    private static void addPar(Map<String, String> mapa, String codigo, String nome) {
        if (codigo != null && nome != null && !codigo.isBlank() && !nome.isBlank()) {
            mapa.putIfAbsent(codigo, nome);
        }
    }

    // Indicador de ambiente = tpAmb da DPS (1=producao, 2=homologacao), conforme o XSD.
    // ATENCAO: NAO usar ambGer (= "ambiente gerador da NFS-e", outro conceito): uma nota de
    // producao pode ter ambGer=2 e tpAmb=1, e usar ambGer marcaria producao como homologacao
    // (estampando "SEM VALIDADE JURIDICA" numa nota valida).
    private static boolean homologacao(Element dps) {
        return "2".equals(childText(dps, "tpAmb"));
    }

    private static String chaveAcesso(Element infNfse) {
        String id = infNfse.getAttribute("Id");
        if (id == null || id.isBlank()) {
            return null;
        }
        return id.startsWith("NFS") ? id.substring(3) : id;
    }

    private static Danfse.Identificacao identificacao(Element infNfse, Element dps, Element ibsCbsDps) {
        return new Danfse.Identificacao(
            childText(infNfse, "nNFSe"),
            dateOrNull(childText(dps, "dCompet")),
            offsetOrNull(childText(infNfse, "dhProc")),
            childText(dps, "nDPS"),
            childText(dps, "serie"),
            offsetOrNull(childText(dps, "dhEmi")),
            emitente(childText(dps, "tpEmit")),
            situacao(childText(infNfse, "cStat")),
            childText(ibsCbsDps, "finNFSe"),
            childText(infNfse, "xLocEmi"),
            ambienteGerador(childText(infNfse, "ambGer")),
            tipoAmbiente(childText(dps, "tpAmb")),
            childText(infNfse, "xLocPrestacao")
        );
    }

    /**
     * Prestador (emit do infNFSe + regTrib da DPS) ou tomador/destinatario/intermediario (escopo
     * proprio da DPS). No emit o endereco fica direto em enderNac; nos demais ha um <end> com
     * endNac/endExt aninhado.
     */
    private static Danfse.Pessoa pessoa(Element escopo, Element prestRegTrib, Map<String, String> municipios) {
        if (escopo == null) {
            return null;
        }
        Element regTrib = prestRegTrib == null ? null : child(prestRegTrib, "regTrib");
        Danfse.Endereco endereco;
        Element enderNac = child(escopo, "enderNac");
        if (enderNac != null) {
            endereco = endereco(enderNac, enderNac, municipios);
        } else {
            Element end = child(escopo, "end");
            Element nac = end == null ? null : primeiroNaoNulo(child(end, "endNac"), child(end, "endExt"));
            endereco = end == null ? null : endereco(end, nac != null ? nac : end, municipios);
        }
        return new Danfse.Pessoa(
            childText(escopo, "CNPJ"),
            childText(escopo, "CPF"),
            childText(escopo, "NIF"),
            childText(escopo, "IM"),
            childText(escopo, "xNome"),
            childText(escopo, "fone"),
            childText(escopo, "email"),
            endereco,
            simplesNacional(childText(regTrib, "opSimpNac")),
            regimeApuracao(childText(regTrib, "regApTribSN"))
        );
    }

    private static Danfse.Endereco endereco(Element escopo, Element nac, Map<String, String> municipios) {
        String cMun = childText(nac, "cMun");
        String nomeMun = cMun != null ? municipios.getOrDefault(cMun, cMun) : null;
        return new Danfse.Endereco(
            childText(escopo, "xLgr"),
            childText(escopo, "nro"),
            childText(escopo, "xCpl"),
            childText(escopo, "xBairro"),
            cMun,
            nomeMun,
            primeiroNaoVazio(childText(escopo, "UF"), childText(nac, "UF")),
            primeiroNaoVazio(childText(nac, "CEP"), childText(nac, "cEndPost"))
        );
    }

    private static Danfse.Servico servico(Element infNfse, Element serv) {
        Element cServ = child(serv, "cServ");
        Element locPrest = child(serv, "locPrest");
        String cLocPrestacao = childText(locPrest, "cLocPrestacao");
        return new Danfse.Servico(
            childText(cServ, "cTribNac"),
            childText(infNfse, "xTribNac"),
            childText(cServ, "cTribMun"),
            childText(infNfse, "xTribMun"),
            childText(cServ, "cNBS"),
            childText(infNfse, "xNBS"),
            childText(infNfse, "xLocPrestacao"),
            ufFromCodigoMunicipio(cLocPrestacao),
            childText(locPrest, "cPaisPrestacao"),
            childText(cServ, "xDescServ")
        );
    }

    private static Danfse.TributacaoMunicipal tributacaoMunicipal(Element infNfse, Element valoresNfse,
            Element dps, Element valoresDps, Element tribMun, Element prest) {
        if (tribMun == null && valoresNfse == null) {
            return null;
        }
        Element exigSusp = child(tribMun, "exigSusp");
        Element bm = child(tribMun, "BM");
        Element vDedRed = child(valoresDps, "vDedRed");
        Element regTrib = child(prest, "regTrib");
        return new Danfse.TributacaoMunicipal(
            tributacaoIssqn(childText(tribMun, "tribISSQN")),
            childText(infNfse, "xLocIncid"),
            ufFromCodigoMunicipio(childText(infNfse, "cLocIncid")),
            childText(tribMun, "cPaisResult"),
            regimeEspecial(childText(regTrib, "regEspTrib")),
            tipoImunidade(childText(tribMun, "tpImunidade")),
            suspensao(childText(exigSusp, "tpSusp")),
            childText(exigSusp, "nProcesso"),
            childText(valoresNfse, "tpBM"),
            primeiroDecimal(childText(valoresNfse, "vCalcBM"), childText(bm, "vRedBCBM")),
            somaOuNull(
                primeiroDecimal(childText(vDedRed, "vDR"), childText(valoresNfse, "vCalcDR")),
                decimalOrNull(childText(valoresNfse, "vCalcReeRepRes"))),
            decimalOrNull(text(child(valoresDps, "vDescCondIncond"), "vDescIncond")),
            decimalOrNull(childText(valoresNfse, "vBC")),
            decimalOrNull(childText(valoresNfse, "pAliqAplic")),
            retencaoIssqn(childText(tribMun, "tpRetISSQN")),
            decimalOrNull(childText(valoresNfse, "vISSQN"))
        );
    }

    private static Danfse.TributacaoFederal tributacaoFederal(Element tribFed) {
        if (tribFed == null) {
            return null;
        }
        Element piscofins = child(tribFed, "piscofins");
        String tpRet = childText(piscofins, "tpRetPisCofins");
        return new Danfse.TributacaoFederal(
            decimalOrNull(childText(tribFed, "vRetIRRF")),
            decimalOrNull(childText(tribFed, "vRetCP")),
            decimalOrNull(childText(tribFed, "vRetCSLL")),
            decimalOrNull(childText(piscofins, "vPis")),
            decimalOrNull(childText(piscofins, "vCofins")),
            tpRet,
            retencaoPisCofins(tpRet)
        );
    }

    /**
     * IBS/CBS (NT 009, best-effort ate o leiaute entrar em producao): o declarado fica na DPS
     * (CST, cClassTrib, cIndOp) e o apurado no infNFSe (totCIBS, aliquotas, vTotNF). A "Exclusoes e
     * Reducoes da Base de Calculo" e o somatorio definido no item 2.4.5 da NT 008.
     */
    private static Danfse.IbsCbs ibsCbs(Element ibsCbsNfse, Element ibsCbsDps,
            Element valoresNfse, Element valoresDps, Element tribFed) {
        if (ibsCbsNfse == null && ibsCbsDps == null) {
            return null;
        }
        Element gIbsCbs = ibsCbsDps == null ? null : firstByLocalName(ibsCbsDps, "gIBSCBS");
        Element piscofins = child(tribFed, "piscofins");
        BigDecimal exclusoes = somaOuNull(
            decimalOrNull(text(child(valoresDps, "vDescCondIncond"), "vDescIncond")),
            decimalOrNull(childText(valoresNfse, "vCalcReeRepRes")),
            decimalOrNull(childText(valoresNfse, "vISSQN")),
            decimalOrNull(childText(piscofins, "vPis")),
            decimalOrNull(childText(piscofins, "vCofins")));
        return new Danfse.IbsCbs(
            text(gIbsCbs, "CST"),
            text(gIbsCbs, "cClassTrib"),
            childText(ibsCbsDps, "cIndOp"),
            text(ibsCbsNfse, "cLocalidadeIncid"),
            text(ibsCbsNfse, "xLocalidadeIncid"),
            exclusoes,
            decimalOrNull(text(child(ibsCbsNfse, "valores"), "vBC")),
            decimalOrNull(text(ibsCbsNfse, "pRedAliqUF")),
            decimalOrNull(text(ibsCbsNfse, "pRedAliqMun")),
            decimalOrNull(text(ibsCbsNfse, "pRedAliqCBS")),
            decimalOrNull(text(ibsCbsNfse, "pIBSUF")),
            decimalOrNull(text(ibsCbsNfse, "pIBSMun")),
            decimalOrNull(text(ibsCbsNfse, "pAliqEfetMun")),
            decimalOrNull(text(ibsCbsNfse, "vIBSMun")),
            decimalOrNull(text(ibsCbsNfse, "pAliqEfetUF")),
            decimalOrNull(text(ibsCbsNfse, "vIBSUF")),
            decimalOrNull(text(ibsCbsNfse, "vIBSTot")),
            decimalOrNull(text(ibsCbsNfse, "pCBS")),
            decimalOrNull(text(ibsCbsNfse, "pAliqEfetCBS")),
            decimalOrNull(text(ibsCbsNfse, "vCBS")),
            decimalOrNull(text(ibsCbsNfse, "vTotNF"))
        );
    }

    private static Danfse.Valores valores(Element valoresNfse, Element valoresDps) {
        Element vServPrest = child(valoresDps, "vServPrest");
        Element vDescCondIncond = child(valoresDps, "vDescCondIncond");
        return new Danfse.Valores(
            decimalOrNull(childText(vServPrest, "vServ")),
            decimalOrNull(childText(vDescCondIncond, "vDescIncond")),
            decimalOrNull(childText(vDescCondIncond, "vDescCond")),
            decimalOrNull(childText(valoresNfse, "vTotalRet")),
            decimalOrNull(childText(valoresNfse, "vLiq"))
        );
    }

    private static Danfse.TotaisTributos totaisTributos(Element totTrib) {
        if (totTrib == null) {
            return null;
        }
        Element vTotTrib = child(totTrib, "vTotTrib");
        Element pTotTrib = child(totTrib, "pTotTrib");
        return new Danfse.TotaisTributos(
            decimalOrNull(childText(vTotTrib, "vTotTribFed")),
            decimalOrNull(childText(vTotTrib, "vTotTribEst")),
            decimalOrNull(childText(vTotTrib, "vTotTribMun")),
            decimalOrNull(childText(pTotTrib, "pTotTribFed")),
            decimalOrNull(childText(pTotTrib, "pTotTribEst")),
            decimalOrNull(childText(pTotTrib, "pTotTribMun")),
            decimalOrNull(childText(totTrib, "pTotTribSN")),
            "0".equals(childText(totTrib, "indTotTrib"))
        );
    }

    /**
     * Uniao das informacoes complementares na ordem do item 2.4.5 da NT 008 (Inf. Cont.; NFS-e
     * Subst.; Doc. Ref.; Cod. Obra; Insc. Imob.; Cod. Evt.; Doc. Tec.; Num. Ped.; Item Ped.;
     * Inf. A. T. Mun.), separadas por pipes. A linha obrigatoria dos Totais Aproximados dos
     * Tributos e montada na renderizacao a partir de {@link Danfse#totaisTributos()}.
     */
    private static String informacoesComplementares(Element infNfse, Element dps, Element serv, Element valoresNfse) {
        Element infoCompl = firstByLocalName(serv, "infoCompl");
        Element subst = child(dps, "subst");
        Element obra = firstByLocalName(serv, "obra");
        List<String> partes = new ArrayList<>();
        add(partes, null, primeiroNaoVazio(childText(infoCompl, "xInfComp"), childText(dps, "xInfComp")));
        add(partes, "NFS-e Subst.: ", childText(subst, "chSubstda"));
        add(partes, "Doc. Ref.: ", text(infoCompl, "docRef"));
        add(partes, "Cod. Obra: ", primeiroNaoVazio(childText(obra, "cObra"), text(serv, "cObra")));
        add(partes, "Insc. Imob.: ", text(serv, "inscImobFisc"));
        add(partes, "Cod. Evt.: ", text(serv, "idAtvEvt"));
        add(partes, "Doc. Tec.: ", text(infoCompl, "idDocTec"));
        add(partes, "Inf. A. T. Mun.: ", childText(valoresNfse, "xOutInf"));
        return partes.isEmpty() ? null : String.join(" | ", partes);
    }

    private static void add(List<String> partes, String prefixo, String valor) {
        if (valor != null && !valor.isBlank()) {
            partes.add(prefixo == null ? valor.trim() : prefixo + valor.trim());
        }
    }

    // ---- mapeamentos de codigos para rotulos (fallback: o proprio codigo) ----
    // Preferencia portal Consulta Publica / NT 008: diacriticos e descricoes legiveis.

    private static String emitente(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Prestador";
            case "2" -> "Tomador";
            case "3" -> "Intermediário";
            default -> codigo;
        };
    }

    private static String situacao(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "100" -> "NFS-e Gerada";
            case "101" -> "NFS-e de Substituição Gerada";
            case "102" -> "NFS-e de Decisão Judicial";
            case "103" -> "NFS-e Avulsa";
            case "107" -> "NFS-e MEI";
            default -> codigo;
        };
    }

    private static String ambienteGerador(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Prefeitura";
            case "2" -> "Ambiente Nacional";
            default -> codigo;
        };
    }

    private static String tipoAmbiente(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Produção";
            case "2" -> "Produção Restrita";
            default -> codigo;
        };
    }

    private static String simplesNacional(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Não Optante";
            case "2" -> "Optante - Microempreendedor Individual (MEI)";
            case "3" -> "Optante - Microempresa ou Empresa de Pequeno Porte (ME/EPP)";
            default -> codigo;
        };
    }

    private static String regimeApuracao(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Regime de apuração dos tributos federais e municipal pelo Simples Nacional";
            case "2" -> "Regime de apuração dos tributos federais pelo Simples Nacional e ISSQN por fora do Simples Nacional";
            case "3" -> "Tributos federais e ISSQN por fora do Simples Nacional";
            default -> codigo;
        };
    }

    private static String regimeEspecial(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "0" -> "Nenhum";
            case "1" -> "Ato Cooperado (Cooperativa)";
            case "2" -> "Estimativa";
            case "3" -> "Microempresa Municipal";
            case "4" -> "Notário ou Registrador";
            case "5" -> "Profissional Autônomo";
            case "6" -> "Sociedade de Profissionais";
            default -> codigo;
        };
    }

    private static String tipoImunidade(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Patrimônio, renda ou serviços, uns dos outros";
            case "2" -> "Templos de qualquer culto";
            case "3" -> "Patrimônio, renda ou serviços dos partidos políticos, entidades sindicais e "
                + "instituições de educação e assistência social, sem fins lucrativos";
            case "4" -> "Livros, jornais, periódicos e o papel destinado a sua impressão";
            case "5" -> "Fonogramas e videofonogramas musicais produzidos no Brasil";
            default -> codigo;
        };
    }

    private static String suspensao(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Exigibilidade Suspensa por Decisão Judicial";
            case "2" -> "Exigibilidade Suspensa por Processo Administrativo";
            default -> codigo;
        };
    }

    private static String tributacaoIssqn(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Operação Tributável";
            case "2" -> "Imunidade";
            case "3" -> "Exportação de serviço";
            case "4" -> "Não Incidência";
            default -> codigo;
        };
    }

    private static String retencaoIssqn(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "Não Retido";
            case "2" -> "Retido pelo Tomador";
            case "3" -> "Retido pelo Intermediário";
            default -> codigo;
        };
    }

    private static String retencaoPisCofins(String codigo) {
        if (codigo == null) {
            return null;
        }
        return switch (codigo) {
            case "1" -> "PIS/COFINS Retido";
            case "2" -> "PIS/COFINS Não Retido";
            default -> codigo;
        };
    }

    /** UF a partir dos 2 primeiros digitos do codigo IBGE do municipio (7 digitos). */
    private static String ufFromCodigoMunicipio(String cMun) {
        if (cMun == null) {
            return null;
        }
        String digitos = cMun.replaceAll("\\D", "");
        if (digitos.length() < 2) {
            return null;
        }
        return switch (digitos.substring(0, 2)) {
            case "11" -> "RO";
            case "12" -> "AC";
            case "13" -> "AM";
            case "14" -> "RR";
            case "15" -> "PA";
            case "16" -> "AP";
            case "17" -> "TO";
            case "21" -> "MA";
            case "22" -> "PI";
            case "23" -> "CE";
            case "24" -> "RN";
            case "25" -> "PB";
            case "26" -> "PE";
            case "27" -> "AL";
            case "28" -> "SE";
            case "29" -> "BA";
            case "31" -> "MG";
            case "32" -> "ES";
            case "33" -> "RJ";
            case "35" -> "SP";
            case "41" -> "PR";
            case "42" -> "SC";
            case "43" -> "RS";
            case "50" -> "MS";
            case "51" -> "MT";
            case "52" -> "GO";
            case "53" -> "DF";
            default -> null;
        };
    }

    // ---- helpers DOM ----

    private static Document parse(String xml) throws Exception {
        DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
        factory.setNamespaceAware(true);
        factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
        factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
        factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
        factory.setExpandEntityReferences(false);
        return factory.newDocumentBuilder().parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8)));
    }

    /** Filho DIRETO por local name (sem descer na arvore) — seguro para nomes repetidos em niveis. */
    private static Element child(Element scope, String localName) {
        if (scope == null) {
            return null;
        }
        NodeList children = scope.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            if (children.item(i) instanceof Element element && localName.equals(localName(element))) {
                return element;
            }
        }
        return null;
    }

    /** Texto de um filho DIRETO. */
    private static String childText(Element scope, String localName) {
        return textOf(child(scope, localName));
    }

    /** Primeiro descendente por local name (depth-first). Usar apenas em escopos sem ambiguidade. */
    private static Element firstByLocalName(Element scope, String localName) {
        if (scope == null) {
            return null;
        }
        NodeList children = scope.getChildNodes();
        for (int i = 0; i < children.getLength(); i++) {
            Node node = children.item(i);
            if (node instanceof Element element) {
                if (localName.equals(localName(element))) {
                    return element;
                }
                Element nested = firstByLocalName(element, localName);
                if (nested != null) {
                    return nested;
                }
            }
        }
        return null;
    }

    /** Texto do primeiro descendente. Usar apenas em escopos pequenos e sem ambiguidade. */
    private static String text(Element scope, String localName) {
        return textOf(firstByLocalName(scope, localName));
    }

    private static String textOf(Element element) {
        if (element == null) {
            return null;
        }
        String content = element.getTextContent();
        return content == null || content.isBlank() ? null : content.trim();
    }

    private static String localName(Element element) {
        return element.getLocalName() != null ? element.getLocalName() : element.getTagName();
    }

    private static Element primeiroNaoNulo(Element a, Element b) {
        return a != null ? a : b;
    }

    private static String primeiroNaoVazio(String a, String b) {
        return a != null && !a.isBlank() ? a : b;
    }

    private static BigDecimal primeiroDecimal(String a, String b) {
        return a != null ? decimalOrNull(a) : decimalOrNull(b);
    }

    /** Soma ignorando nulls; retorna null se TODAS as parcelas forem null (campo ausente -> "-"). */
    private static BigDecimal somaOuNull(BigDecimal... parcelas) {
        BigDecimal soma = null;
        for (BigDecimal parcela : parcelas) {
            if (parcela != null) {
                soma = soma == null ? parcela : soma.add(parcela);
            }
        }
        return soma;
    }

    private static BigDecimal decimalOrNull(String value) {
        return value == null ? null : new BigDecimal(value.trim());
    }

    private static LocalDate dateOrNull(String value) {
        return value == null ? null : LocalDate.parse(value.trim());
    }

    private static OffsetDateTime offsetOrNull(String value) {
        return value == null ? null : OffsetDateTime.parse(value.trim());
    }
}
