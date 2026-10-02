package br.com.xmldanfse;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * CLI standalone: converte o XML autorizado da NFS-e Nacional no PDF do DANFSe (NT 008/2026).
 *
 * <pre>
 * java -jar xml-danfse-br-cli.jar nota.xml [-o saida.pdf] [--logo-emitente logo.png]
 *      [--producao | --homologacao] [--municipio-nome "Nome - UF"] [-q]
 * </pre>
 *
 * <p>Sem {@code --producao}/{@code --homologacao}, o ambiente e inferido do {@code tpAmb} do
 * proprio XML. Codigos de saida: 0 = sucesso, 1 = erro de uso, 2 = erro na geracao.
 */
public final class Main {

    private Main() {
    }

    public static void main(String[] args) {
        System.exit(executar(args));
    }

    static int executar(String[] args) {
        Path entrada = null;
        Path saida = null;
        Path logoEmitente = null;
        String municipioNome = null;
        Boolean producao = null;
        boolean quiet = false;

        for (int i = 0; i < args.length; i++) {
            String arg = args[i];
            switch (arg) {
                case "--help", "-h" -> {
                    ajuda();
                    return 0;
                }
                case "--version", "-V" -> {
                    System.out.println("xml-danfse-br " + versao());
                    return 0;
                }
                case "-o", "--saida" -> {
                    if (++i >= args.length) {
                        return erroUso("falta o arquivo apos " + arg);
                    }
                    saida = Path.of(args[i]);
                }
                case "--logo-emitente" -> {
                    if (++i >= args.length) {
                        return erroUso("falta o arquivo apos --logo-emitente");
                    }
                    logoEmitente = Path.of(args[i]);
                }
                case "--municipio-nome" -> {
                    if (++i >= args.length) {
                        return erroUso("falta o valor apos --municipio-nome");
                    }
                    municipioNome = args[i];
                }
                case "--producao" -> producao = true;
                case "--homologacao" -> producao = false;
                case "-q", "--quiet" -> quiet = true;
                default -> {
                    if (arg.startsWith("-")) {
                        return erroUso("opcao desconhecida: " + arg);
                    }
                    if (entrada != null) {
                        return erroUso("mais de um XML de entrada informado");
                    }
                    entrada = Path.of(arg);
                }
            }
        }

        if (entrada == null) {
            ajuda();
            return 1;
        }
        if (!Files.isReadable(entrada)) {
            return erroUso("arquivo nao encontrado ou sem leitura: " + entrada);
        }
        if (saida == null) {
            String nome = entrada.getFileName().toString().replaceFirst("\\.[xX][mM][lL]$", "") + ".pdf";
            saida = entrada.toAbsolutePath().resolveSibling(nome);
        }

        try {
            String xml = Files.readString(entrada, StandardCharsets.UTF_8);
            String logoDataUri = logoEmitente == null ? null : DanfseGenerator.dataUriImagem(logoEmitente);
            DanfseConfig config = new DanfseConfig(municipioNome, null, null, null, null, logoDataUri);

            byte[] pdf = producao == null
                ? DanfseGenerator.gerarPdf(xml, config, saida)
                : DanfseGenerator.gerarPdf(xml, producao, config, saida);

            if (!quiet) {
                System.out.println("DANFSe gerado: " + saida + " (" + pdf.length + " bytes)");
            }
            return 0;
        } catch (Exception exception) {
            System.err.println("erro: " + mensagem(exception));
            return 2;
        }
    }

    private static String mensagem(Throwable t) {
        String m = t.getMessage();
        if (t.getCause() != null && t.getCause().getMessage() != null) {
            m = m + " (" + t.getCause().getMessage() + ")";
        }
        return m == null ? t.getClass().getSimpleName() : m;
    }

    private static int erroUso(String detalhe) {
        System.err.println("erro: " + detalhe);
        System.err.println("use --help para ver as opcoes");
        return 1;
    }

    private static String versao() {
        String v = Main.class.getPackage().getImplementationVersion();
        return v == null ? "dev" : v;
    }

    private static void ajuda() {
        System.out.println("""
            xml-danfse-br — gera o PDF do DANFSe a partir do XML autorizado da NFS-e Nacional
            (modelo oficial da NT 008/2026)

            uso:
              java -jar xml-danfse-br-cli.jar <nota.xml> [opcoes]

            opcoes:
              -o, --saida <arquivo.pdf>    caminho do PDF (padrao: mesmo nome do XML)
              --logo-emitente <imagem>     logo do prestador no cabecalho (PNG/JPG/SVG)
              --municipio-nome <texto>     sobrescreve o municipio do cabecalho
                                           (preferivel omitir: Java resolve de xLocEmi/IBGE)
              --producao                   forca URL de consulta do QR de producao
              --homologacao                forca URL de consulta de producao restrita
                                           (sem essas flags, o ambiente vem do tpAmb do XML)
              -q, --quiet                  nao imprime mensagem de sucesso
              -h, --help                   esta ajuda
              -V, --version                versao

            codigos de saida: 0 = ok, 1 = erro de uso, 2 = erro na geracao
            """);
    }
}
