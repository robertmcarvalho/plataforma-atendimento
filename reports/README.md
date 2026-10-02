# `reports/` — saída local de scripts (gitignored)

Pasta para artefatos **gerados em máquina** — **não commitar**.

## Arquivos que podem permanecer

| Arquivo | Uso |
|---------|-----|
| `web-build-substitutions.json` | Deploy web (`scripts/deploy-production-*.mjs`) |
| `design-preferences.json` | Preferências UI / design system |
| `platform-owner-bootstrap.txt` | Credenciais bootstrap (smoke local) — **não compartilhar** |

## O que não guardar aqui

- Senhas ou tokens em texto (`*-password-reset.txt`)
- Logs de deploy antigos
- ZIPs de documentos / extrações DOCX
- Dumps JSON de import/sync pontuais

Scripts devem escrever em `reports/` apenas quando necessário; limpar periodicamente.
