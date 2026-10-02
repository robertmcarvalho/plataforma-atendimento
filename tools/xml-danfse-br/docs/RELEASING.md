# Publicação (Maven Central + GitHub Releases)

## Setup único (feito uma vez, pelo mantenedor)

1. **Conta no Central Portal**: acesse <https://central.sonatype.com> e clique em
   **Sign in with GitHub**, logado no navegador como **`rzmt`** (contas do Central são
   independentes por conta GitHub). O namespace `io.github.rzmt` é criado e verificado
   automaticamente pelo SSO.
   - *Fallback* (se registrar por e-mail): **Add Namespace** → `io.github.rzmt` → o portal
     mostra uma chave `TEMP-...` → crie um repositório público com esse nome em `rzmt` →
     **Verify** → apague o repositório.
2. **Token de publicação**: no portal, avatar → **View Account** → **Generate User Token**.
   Guarde o par usuário/senha gerado.
3. **Chave GPG**:
   ```bash
   gpg --full-generate-key            # RSA 4096, e-mail da conta
   gpg --list-secret-keys --keyid-format long   # anote o KEYID
   gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>
   gpg --export-secret-keys --armor <KEYID>     # conteudo do secret GPG_PRIVATE_KEY
   ```
4. **Secrets do repositório** (`gh secret set` ou Settings → Secrets → Actions):
   | Secret | Valor |
   |---|---|
   | `CENTRAL_USERNAME` | usuário do token do passo 2 |
   | `CENTRAL_PASSWORD` | senha do token do passo 2 |
   | `GPG_PRIVATE_KEY`  | chave privada armored do passo 3 |
   | `GPG_PASSPHRASE`   | passphrase da chave |

## Cada release

1. Atualize `<version>` no `pom.xml` e o `CHANGELOG.md`.
2. Commit + tag + push:
   ```bash
   git commit -am "vX.Y.Z: ..."
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```
3. O workflow `release.yml` publica a lib no Maven Central (assinada) e anexa o fat-jar
   da CLI ao GitHub Release. A versão aparece em <https://central.sonatype.com/artifact/io.github.rzmt/xml-danfse-br>
   em minutos e no search.maven.org em algumas horas.

## Publicação manual (sem Actions)

```bash
# ~/.m2/settings.xml precisa do server id "central" com o token
mvn -Prelease clean deploy
mvn -Pcli -DskipTests package   # target/xml-danfse-br-cli.jar
```

> **Licenças**: o jar publicado no Central é MIT puro (OpenHTMLtoPDF/LGPL fica como
> dependência declarada). O fat-jar da CLI agrega bytecode LGPL, por isso é distribuído
> **somente** via GitHub Releases, acompanhado do `THIRD-PARTY.md`.
