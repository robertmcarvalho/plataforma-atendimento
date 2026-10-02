package br.com.xmldanfse;

public class DanfseException extends RuntimeException {

    public DanfseException(String message) {
        super(message);
    }

    public DanfseException(String message, Throwable cause) {
        super(message, cause);
    }
}
