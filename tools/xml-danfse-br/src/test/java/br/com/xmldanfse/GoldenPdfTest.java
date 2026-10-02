package br.com.xmldanfse;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.fail;

import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * Regressao visual do DANFSe: renderiza o PDF, rasteriza a pagina e compara com a imagem de
 * referencia em {@code src/test/resources/golden/} por percentual de pixels divergentes.
 *
 * <p>Tolerancia: um pixel "difere" quando algum canal RGB varia mais que {@value #DELTA_CANAL};
 * o teste falha quando mais de {@value #MAX_DIVERGENTES_PCT}% dos pixels diferem. Isso absorve
 * variacoes de antialiasing entre JDKs/OS sem deixar passar mudancas reais de layout.
 *
 * <p>Para (re)gerar as referencias: {@code mvn test -Dgolden.update=true} e revisar o git diff.
 * Em caso de falha, {@code target/golden-diff/} recebe {@code <caso>-actual.png} e
 * {@code <caso>-diff.png} (divergencias em magenta) para inspecao.
 */
class GoldenPdfTest {

    private static final int DELTA_CANAL = 24;
    private static final double MAX_DIVERGENTES_PCT = 0.8;

    @ParameterizedTest(name = "{0}")
    @CsvSource({
        "ficticio,      /nfse-exemplo-ficticio.xml, false",
        "ibscbs,        /nfse-exemplo-ibscbs.xml,   false",
        "completo,      /nfse-exemplo-completo.xml, false",
        "ficticio-logo, /nfse-exemplo-ficticio.xml, true",
    })
    void danfseIgualAoGolden(String caso, String recurso, boolean comLogo) throws Exception {
        String xml;
        try (var in = GoldenPdfTest.class.getResourceAsStream(recurso)) {
            xml = new String(in.readAllBytes(), StandardCharsets.UTF_8);
        }
        DanfseConfig config = comLogo ? DanfseConfig.comLogoEmitente(logoSintetico()) : DanfseConfig.vazio();
        byte[] pdf = DanfseGenerator.gerarPdf(xml, config);
        BufferedImage atual = PdfRaster.pagina(pdf, 0);

        Path referencia = Path.of("src/test/resources/golden", caso + ".png");
        if (Boolean.getBoolean("golden.update")) {
            Files.createDirectories(referencia.getParent());
            ImageIO.write(atual, "png", referencia.toFile());
            Assumptions.abort("referencia atualizada em " + referencia + " — revise o git diff e commite");
        }
        if (!Files.exists(referencia)) {
            gravarDebug(caso, atual, null);
            fail("referencia ausente: " + referencia + " — gere com mvn test -Dgolden.update=true");
        }

        BufferedImage golden = ImageIO.read(referencia.toFile());
        if (golden.getWidth() != atual.getWidth() || golden.getHeight() != atual.getHeight()) {
            gravarDebug(caso, atual, null);
            fail("dimensoes divergem: golden " + golden.getWidth() + "x" + golden.getHeight()
                + " vs atual " + atual.getWidth() + "x" + atual.getHeight());
        }

        BufferedImage diff = new BufferedImage(golden.getWidth(), golden.getHeight(), BufferedImage.TYPE_INT_RGB);
        long divergentes = 0;
        for (int y = 0; y < golden.getHeight(); y++) {
            for (int x = 0; x < golden.getWidth(); x++) {
                int a = golden.getRGB(x, y);
                int b = atual.getRGB(x, y);
                if (difere(a, b)) {
                    divergentes++;
                    diff.setRGB(x, y, 0xFF00FF);
                } else {
                    diff.setRGB(x, y, b);
                }
            }
        }
        double pct = 100.0 * divergentes / ((long) golden.getWidth() * golden.getHeight());
        if (pct > MAX_DIVERGENTES_PCT) {
            gravarDebug(caso, atual, diff);
            fail(String.format("layout divergiu do golden: %.3f%% dos pixels diferem (limite %.1f%%)"
                + " — veja target/golden-diff/%s-*.png", pct, MAX_DIVERGENTES_PCT, caso));
        }
        assertTrue(pct <= MAX_DIVERGENTES_PCT);
    }

    private static boolean difere(int rgbA, int rgbB) {
        int dr = Math.abs(((rgbA >> 16) & 0xFF) - ((rgbB >> 16) & 0xFF));
        int dg = Math.abs(((rgbA >> 8) & 0xFF) - ((rgbB >> 8) & 0xFF));
        int db = Math.abs((rgbA & 0xFF) - (rgbB & 0xFF));
        return Math.max(dr, Math.max(dg, db)) > DELTA_CANAL;
    }

    private static void gravarDebug(String caso, BufferedImage atual, BufferedImage diff) throws Exception {
        Path dir = Path.of("target", "golden-diff");
        Files.createDirectories(dir);
        ImageIO.write(atual, "png", dir.resolve(caso + "-actual.png").toFile());
        if (diff != null) {
            ImageIO.write(diff, "png", dir.resolve(caso + "-diff.png").toFile());
        }
    }

    /** Logo deterministico (sem I/O) para o caso com logo do emitente. */
    private static String logoSintetico() throws Exception {
        BufferedImage img = new BufferedImage(120, 48, BufferedImage.TYPE_INT_RGB);
        for (int y = 0; y < 48; y++) {
            for (int x = 0; x < 120; x++) {
                img.setRGB(x, y, x < 60 ? 0x1D4ED8 : 0xF59E0B);
            }
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        ImageIO.write(img, "png", out);
        return "data:image/png;base64," + Base64.getEncoder().encodeToString(out.toByteArray());
    }
}
