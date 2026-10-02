# xml-danfse-br CLI (portal-patched)

Runtime path in Cloud Run: `/opt/danfse/xml-danfse-br-cli.jar` (built in
`deploy/dockerfiles/api.Dockerfile` from `tools/xml-danfse-br`).

For local API without Docker, either:

1. Point `BILLING_DANFSE_LIB_JAR` at `tools/xml-danfse-br/target/xml-danfse-br-cli.jar`, or
2. Copy that jar here as `xml-danfse-br-cli.jar`.

Flag: `BILLING_DANFSE_LIB_ENABLED` (default `true`). See `PORTAL_PATCH.md`.
