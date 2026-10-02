package br.com.xmldanfse;

import com.openhtmltopdf.outputdevice.helper.BaseRendererBuilder;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import java.util.Objects;

/**
 * Facade do modulo: gera o PDF do DANFSe a partir do XML autorizado da NFS-e, conforme o modelo
 * oficial da NT 008/2026 (Anexo I).
 *
 * <p>Fluxo: {@link NfseXmlReader} extrai o modelo, {@link QrCodeGenerator} produz o QR,
 * {@link DanfseHtmlRenderer} monta o XHTML e o OpenHTMLtoPDF rasteriza em PDF com a fonte
 * Liberation Sans embutida (metrica compativel com a Arial exigida pela NT, licenca OFL).
 */
public final class DanfseGenerator {

    private static volatile String logoDataUri;

    private DanfseGenerator() {
    }

    /**
     * Gera o PDF do DANFSe inferindo o ambiente do proprio XML ({@code tpAmb} da DPS):
     * producao usa a URL de consulta publica de producao no QR; producao restrita usa a de
     * homologacao e estampa "NFS-e SEM VALIDADE JURIDICA".
     */
    public static byte[] gerarPdf(String nfseXml) {
        return gerarPdf(nfseXml, DanfseConfig.vazio());
    }

    /** Como {@link #gerarPdf(String)}, com configuracao opcional (logo do emitente etc.). */
    public static byte[] gerarPdf(String nfseXml, DanfseConfig config) {
        Objects.requireNonNull(nfseXml, "nfseXml is required");
        Danfse danfse = NfseXmlReader.read(nfseXml);
        return gerar(danfse, !danfse.homologacao(), config);
    }

    /** Gera o PDF do DANFSe a partir do XML da NFS-e. {@code producao} controla a URL do QR. */
    public static byte[] gerarPdf(String nfseXml, boolean producao) {
        return gerarPdf(nfseXml, producao, DanfseConfig.vazio());
    }

    /** Como {@link #gerarPdf(String, boolean)}, com identificacao opcional do municipio. */
    public static byte[] gerarPdf(String nfseXml, boolean producao, DanfseConfig config) {
        Objects.requireNonNull(nfseXml, "nfseXml is required");
        return gerar(NfseXmlReader.read(nfseXml), producao, config);
    }

    private static byte[] gerar(Danfse danfse, boolean producao, DanfseConfig config) {
        // QR em bitmap de 300 px para nitidez de impressao; o CSS fixa 1,52 x 1,52 cm (NT 008).
        String qr = danfse.chaveAcesso() == null
            ? null
            : QrCodeGenerator.dataUri(QrCodeGenerator.consultaUrl(danfse.chaveAcesso(), producao), 300);
        String html = DanfseHtmlRenderer.render(danfse, qr, logoOficial(),
            config == null ? DanfseConfig.vazio() : config);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.useFastMode();
            builder.useFont(() -> fonte("LiberationSans-Regular.ttf"), "Liberation Sans",
                400, BaseRendererBuilder.FontStyle.NORMAL, true);
            builder.useFont(() -> fonte("LiberationSans-Bold.ttf"), "Liberation Sans",
                700, BaseRendererBuilder.FontStyle.NORMAL, true);
            builder.withHtmlContent(html, null);
            builder.toStream(out);
            builder.run();
            return out.toByteArray();
        } catch (Exception exception) {
            throw new DanfseException("Nao foi possivel gerar o PDF do DANFSe.", exception);
        }
    }

    /** Gera o PDF e grava no caminho informado, retornando os bytes. */
    public static byte[] gerarPdf(String nfseXml, boolean producao, Path saida) {
        return gerarPdf(nfseXml, producao, DanfseConfig.vazio(), saida);
    }

    public static byte[] gerarPdf(String nfseXml, boolean producao, DanfseConfig config, Path saida) {
        Objects.requireNonNull(saida, "saida is required");
        return gravar(gerarPdf(nfseXml, producao, config), saida);
    }

    /** Como {@link #gerarPdf(String, DanfseConfig)}, gravando no caminho informado. */
    public static byte[] gerarPdf(String nfseXml, DanfseConfig config, Path saida) {
        Objects.requireNonNull(saida, "saida is required");
        return gravar(gerarPdf(nfseXml, config), saida);
    }

    private static byte[] gravar(byte[] pdf, Path saida) {
        try {
            Path parent = saida.toAbsolutePath().normalize().getParent();
            if (parent != null) {
                Files.createDirectories(parent);
            }
            Files.write(saida, pdf);
        } catch (IOException exception) {
            throw new DanfseException("Nao foi possivel gravar o PDF do DANFSe em " + saida, exception);
        }
        return pdf;
    }

    /**
     * Le um arquivo de imagem (PNG/JPG/GIF/SVG) e devolve uma data URI pronta para o DANFSe
     * (ex.: logo do emitente). Util para CLI/MCP que recebem um caminho de arquivo.
     */
    public static String dataUriImagem(Path arquivo) {
        Objects.requireNonNull(arquivo, "arquivo is required");
        return ImagemDataUri.de(arquivo);
    }

    private static InputStream fonte(String nome) {
        InputStream in = DanfseGenerator.class.getResourceAsStream("/danfse/fonts/" + nome);
        if (in == null) {
            throw new DanfseException("Fonte nao encontrada no classpath: " + nome);
        }
        return in;
    }

    /** Logo oficial da NFS-e (CC BY-ND), embutido como data URI. Carregado uma vez do classpath. */
    private static String logoOficial() {
        String cached = logoDataUri;
        if (cached != null) {
            return cached;
        }
        try (InputStream in = DanfseGenerator.class.getResourceAsStream("/danfse/nfse-logo.png")) {
            if (in == null) {
                return null;
            }
            String uri = "data:image/png;base64," + Base64.getEncoder().encodeToString(in.readAllBytes());
            logoDataUri = uri;
            return uri;
        } catch (IOException exception) {
            return null;
        }
    }
}
