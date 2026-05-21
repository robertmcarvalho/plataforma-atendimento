# Secrets locais (não versionar)

Esta pasta está no `.gitignore`. Copie os templates abaixo e preencha com valores do Supabase Dashboard / GCP Secret Manager.

| Arquivo | Uso |
|---------|-----|
| `production-api.env` | `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` do projeto **plataforma_atendimento** (`omhlb…`) |
| `production-db-url.txt` | Connection string pooler Postgres (produção) |
| `production-supabase-project-ref.txt` | Ref do projeto (`omhlbavfsttwcnybzvcd`) |
| `legacy-api.env` | Credenciais do projeto legado `ojzzx` (export pontual) |
| `legacy-db-url.txt` | Pooler do legado (quando reativado) |
| `staging-api.env` | Ambiente de QA (não confundir com produção) |
| `supabase-access-token.txt` | Token Management API (`sbp_…`) para scripts de projeto |
| `supabase-db-url.txt` | Pooler dev/local (`omhlb`) |

Nunca commitar senhas, service role keys, tokens Meta ou SMTP.
