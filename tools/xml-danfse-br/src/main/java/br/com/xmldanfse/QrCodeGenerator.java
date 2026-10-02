package br.com.xmldanfse;

import com.google.zxing.BarcodeFormat;
import com.google.zxing.EncodeHintType;
import com.google.zxing.common.BitMatrix;
import com.google.zxing.qrcode.QRCodeWriter;
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.util.Base64;
import java.util.Map;
import javax.imageio.ImageIO;

/**
 * Gera o QR Code do DANFSe como PNG embutido em data URI (para o template HTML).
 *
 * <p>O QR aponta para a consulta publica da NFS-e pela chave de acesso, no endereco definido
 * pelo item 2.4.3 da NT 008/2026 ({@code https://www.nfse.gov.br/ConsultaPublica/?tpc=1&chave=}).
 * Em homologacao (producao restrita) usa o host correspondente.
 */
public final class QrCodeGenerator {

    public static final String CONSULTA_PRODUCAO =
        "https://www.nfse.gov.br/ConsultaPublica/";
    public static final String CONSULTA_HOMOLOGACAO =
        "https://www.producaorestrita.nfse.gov.br/ConsultaPublica/";

    private QrCodeGenerator() {
    }

    /** URL de consulta publica (conforme NT 008, item 2.4.3) para a chave informada, por ambiente. */
    public static String consultaUrl(String chaveAcesso, boolean producao) {
        String base = producao ? CONSULTA_PRODUCAO : CONSULTA_HOMOLOGACAO;
        return base + "?tpc=1&chave=" + chaveAcesso;
    }

    /** Retorna o QR como data URI ({@code data:image/png;base64,...}) pronto para um <img src>. */
    public static String dataUri(String conteudo, int tamanhoPx) {
        try {
            QRCodeWriter writer = new QRCodeWriter();
            Map<EncodeHintType, Object> hints = Map.of(
                EncodeHintType.ERROR_CORRECTION, ErrorCorrectionLevel.M,
                EncodeHintType.MARGIN, 1,
                EncodeHintType.CHARACTER_SET, "UTF-8"
            );
            BitMatrix matrix = writer.encode(conteudo, BarcodeFormat.QR_CODE, tamanhoPx, tamanhoPx, hints);
            BufferedImage image = new BufferedImage(tamanhoPx, tamanhoPx, BufferedImage.TYPE_INT_RGB);
            for (int x = 0; x < tamanhoPx; x++) {
                for (int y = 0; y < tamanhoPx; y++) {
                    image.setRGB(x, y, matrix.get(x, y) ? 0x000000 : 0xFFFFFF);
                }
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            ImageIO.write(image, "png", out);
            return "data:image/png;base64," + Base64.getEncoder().encodeToString(out.toByteArray());
        } catch (Exception exception) {
            throw new DanfseException("Nao foi possivel gerar o QR Code do DANFSe.", exception);
        }
    }
}
