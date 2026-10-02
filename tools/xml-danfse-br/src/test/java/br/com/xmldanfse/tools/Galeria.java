package br.com.xmldanfse.tools;

import br.com.xmldanfse.DanfseGenerator;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import javax.imageio.ImageIO;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;

/**
 * Gera as imagens da galeria do README em {@code docs/gallery/} a partir dos XMLs de exemplo.
 *
 * <p>Uso (da raiz do repositorio):
 * {@code mvn -q test-compile exec:java -Dexec.classpathScope=test -Dexec.mainClass=br.com.xmldanfse.tools.Galeria}
 * ou execute a classe pela IDE. Commite as imagens geradas apos revisar o diff.
 */
public final class Galeria {

    private Galeria() {
    }

    public static void main(String[] args) throws Exception {
        System.setProperty("xmldanfse.ibge", "false");
        Path resources = Path.of("src/test/resources");
        Path saida = Path.of("docs/gallery");
        Files.createDirectories(saida);
        for (String nome : new String[]{"nfse-exemplo-ficticio", "nfse-exemplo-ibscbs", "nfse-exemplo-completo"}) {
            String xml = Files.readString(resources.resolve(nome + ".xml"));
            byte[] pdf = DanfseGenerator.gerarPdf(xml);
            try (PDDocument doc = PDDocument.load(new ByteArrayInputStream(pdf))) {
                BufferedImage img = new PDFRenderer(doc).renderImageWithDPI(0, 150);
                Path png = saida.resolve(nome.replace("nfse-exemplo-", "danfse-") + ".png");
                ImageIO.write(img, "png", png.toFile());
                System.out.println("gerado: " + png);
            }
        }
    }
}
