package br.com.xmldanfse;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.OffsetDateTime;

/**
 * Modelo do DANFSe, extraido do XML autorizado da NFS-e ({@code <NFSe><infNFSe>}), com os blocos
 * do modelo oficial da NT 008/2026 (Anexo I). Campos tipados; a formatacao (mascaras, R$, datas)
 * e o preenchimento de "-" ausentes ficam no {@link DanfseHtmlRenderer}. Campos opcionais podem
 * ser {@code null}.
 */
public record Danfse(
    String chaveAcesso,
    boolean homologacao,
    Identificacao identificacao,
    Pessoa prestador,
    Pessoa tomador,
    Pessoa destinatario,
    Pessoa intermediario,
    Servico servico,
    TributacaoMunicipal tributacaoMunicipal,
    TributacaoFederal tributacaoFederal,
    IbsCbs ibsCbs,
    Valores valores,
    TotaisTributos totaisTributos,
    String informacoesComplementares
) {

    /** Identificacao da NFS-e e da DPS de origem + campos do cabecalho (2.1.2 e 2.4.3 da NT 008). */
    public record Identificacao(
        String numeroNfse,
        LocalDate competencia,
        OffsetDateTime emissaoNfse,
        String numeroDps,
        String serieDps,
        OffsetDateTime emissaoDps,
        String emitente,
        String situacao,
        String finalidade,
        String municipioEmissao,
        String ambienteGerador,
        String tipoAmbiente,
        String municipioPrestacao
    ) {
    }

    /** Prestador, tomador, destinatario ou intermediario. Documento sem mascara (so digitos). */
    public record Pessoa(
        String cnpj,
        String cpf,
        String nif,
        String inscricaoMunicipal,
        String nome,
        String telefone,
        String email,
        Endereco endereco,
        String regimeSimplesNacional,
        String regimeApuracaoSimplesNacional
    ) {
    }

    public record Endereco(
        String logradouro,
        String numero,
        String complemento,
        String bairro,
        String codigoMunicipio,
        String municipio,
        String uf,
        String cep
    ) {
    }

    /** Bloco "Servico Prestado" (2.1.7). */
    public record Servico(
        String codigoTributacaoNacional,
        String descricaoTributacaoNacional,
        String codigoTributacaoMunicipal,
        String descricaoTributacaoMunicipal,
        String codigoNbs,
        String descricaoNbs,
        String localPrestacao,
        /** UF derivada do codigo IBGE de prestacao (portal: Municipio / UF / Pais). */
        String ufPrestacao,
        String paisPrestacao,
        String descricao
    ) {
    }

    /** Bloco "Tributacao Municipal (ISSQN)" (2.1.8). */
    public record TributacaoMunicipal(
        String tipoTributacaoIssqn,
        String municipioIncidencia,
        /** UF derivada de cLocIncid (portal: Municipio / UF / Pais). */
        String ufIncidencia,
        String paisResultado,
        String regimeEspecial,
        String tipoImunidade,
        String suspensaoExigibilidade,
        String numeroProcessoSuspensao,
        String beneficioMunicipal,
        BigDecimal calculoBeneficioMunicipal,
        BigDecimal totalDeducoesReducoes,
        BigDecimal descontoIncondicionado,
        BigDecimal baseCalculo,
        BigDecimal aliquotaAplicada,
        String retencaoIssqn,
        BigDecimal issqnApurado
    ) {
    }

    /**
     * Bloco "Tributacao Federal (exceto CBS)" (2.1.9). Guarda os valores crus do XML; a regra da
     * v1.02 (tpRetPisCofins=1 soma vRetCSLL+vPis+vCofins nas retencoes e zera PIS/COFINS proprios)
     * e aplicada na renderizacao.
     */
    public record TributacaoFederal(
        BigDecimal valorRetidoIrrf,
        BigDecimal valorRetidoContribuicaoPrevidenciaria,
        BigDecimal valorRetidoCsll,
        BigDecimal valorPis,
        BigDecimal valorCofins,
        String tipoRetencaoPisCofins,
        String descricaoRetencaoPisCofins
    ) {
    }

    /** Bloco "Tributacao IBS/CBS" (2.1.10, NT 009 — best-effort ate o leiaute entrar em producao). */
    public record IbsCbs(
        String cst,
        String classificacaoTributaria,
        String indicadorOperacao,
        String codigoLocalIncidencia,
        String localIncidencia,
        BigDecimal exclusoesReducoesBase,
        BigDecimal baseCalculo,
        BigDecimal reducaoAliquotaUf,
        BigDecimal reducaoAliquotaMunicipio,
        BigDecimal reducaoAliquotaCbs,
        BigDecimal aliquotaIbsUf,
        BigDecimal aliquotaIbsMunicipio,
        BigDecimal aliquotaEfetivaMunicipio,
        BigDecimal valorIbsMunicipio,
        BigDecimal aliquotaEfetivaUf,
        BigDecimal valorIbsUf,
        BigDecimal valorTotalIbs,
        BigDecimal aliquotaCbs,
        BigDecimal aliquotaEfetivaCbs,
        BigDecimal valorTotalCbs,
        BigDecimal valorLiquidoComIbsCbs
    ) {
    }

    /** Bloco "Valor Total da NFS-e" (2.1.11). */
    public record Valores(
        BigDecimal valorServico,
        BigDecimal descontoIncondicionado,
        BigDecimal descontoCondicionado,
        BigDecimal totalRetencoes,
        BigDecimal valorLiquido
    ) {
    }

    /**
     * Totais aproximados dos tributos (Lei 12.741/2012), obrigatorios nas informacoes
     * complementares (Nota 10 da NT 008). O XML traz valores OU percentuais OU o percentual
     * unico do Simples Nacional; {@code naoInformado} corresponde a indTotTrib=0.
     */
    public record TotaisTributos(
        BigDecimal valorFederal,
        BigDecimal valorEstadual,
        BigDecimal valorMunicipal,
        BigDecimal percentualFederal,
        BigDecimal percentualEstadual,
        BigDecimal percentualMunicipal,
        BigDecimal percentualSimplesNacional,
        boolean naoInformado
    ) {
    }
}
