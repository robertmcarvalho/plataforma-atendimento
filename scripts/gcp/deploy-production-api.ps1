# Deploy flux-farma-api to Cloud Run with Secret Manager references (production).
# Prerequisites: gcloud auth, secrets created in Secret Manager, full env preserved on update.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   $env:GCP_REGION = "us-central1"
#   $env:SERVICE_NAME = "flux-farma-api"
#   $env:ALLOWED_ORIGINS = "https://app.aethera.ai"
#   .\scripts\gcp\deploy-production-api.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$ServiceName = $(if ($env:SERVICE_NAME) { $env:SERVICE_NAME } else { "flux-farma-api" }),
  [string]$AllowedOrigins = $(if ($env:ALLOWED_ORIGINS) { $env:ALLOWED_ORIGINS } else {
    "https://www.aetheraai.online,https://aetheraai.online,https://app.aethera.ai,https://flux-farma-web-713561463013.us-central1.run.app,http://localhost:3020,http://localhost:3000,http://127.0.0.1:3020,http://127.0.0.1:3000"
  })
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$secrets = @(
  "SUPABASE_URL=supabase-url:latest",
  "SUPABASE_SERVICE_ROLE_KEY=supabase-sr:latest",
  "JWT_SECRET=jwt-secret:latest",
  "INTEGRATIONS_ENCRYPTION_KEY=integrations-encryption-key:latest",
  "LEADER_WHATSAPP_OTP_SECRET=leader-whatsapp-otp-secret:latest",
  "META_ACCESS_TOKEN=meta-access-token:latest",
  "META_VERIFY_TOKEN=meta-verify-token:latest",
  "META_PHONE_NUMBER_ID=meta-phone-number-id:latest",
  "META_APP_ID=meta-app-id:latest",
  "META_GRAPH_APP_ACCESS_TOKEN=meta-graph-app-access-token:latest",
  "GOOGLE_API_KEY=google-api-key:latest",
  "SMTP_PASS=smtp-pass:latest"
) -join ","

$envFile = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path ".cloud-env-api-production.yaml"
if (-not (Test-Path $envFile)) { throw "Missing $envFile - copy from repo root or set ALLOWED_ORIGINS in that file." }
$yaml = Get-Content $envFile -Raw
if ($AllowedOrigins -and $yaml -notmatch [regex]::Escape($AllowedOrigins.Split(',')[0])) {
  ($yaml -replace 'ALLOWED_ORIGINS:.*', "ALLOWED_ORIGINS: `"$AllowedOrigins`"") | Set-Content $envFile -NoNewline
}

Write-Host "Deploying $ServiceName to $Region (project $ProjectId)..."
cmd /c "gcloud run services update $ServiceName --project=$ProjectId --region=$Region --set-secrets=$secrets --env-vars-file=$envFile"
if ($LASTEXITCODE -ne 0) { throw "gcloud run services update failed with exit code $LASTEXITCODE" }

Write-Host "Done. Verify: gcloud run services describe $ServiceName --region=$Region --format='value(status.url)'"
