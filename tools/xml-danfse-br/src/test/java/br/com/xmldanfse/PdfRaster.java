package br.com.xmldanfse;

import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.rendering.PDFRenderer;

/** Rasteriza paginas de PDF para comparacao visual nos golden tests. */
final class PdfRaster {

    static final int DPI = 120;

    private PdfRaster() {
    }

    static BufferedImage pagina(byte[] pdf, int pagina) throws IOException {
        try (PDDocument doc = PDDocument.load(new ByteArrayInputStream(pdf))) {
            return new PDFRenderer(doc).renderImageWithDPI(pagina, DPI);
        }
    }
}
