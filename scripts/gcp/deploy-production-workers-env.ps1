# Alinha webhook + orchestrator (e opcionalmente campaign/scheduler) ao Supabase de producao (Secret Manager).
# A API ja usa supabase-url/supabase-sr; workers legados ainda apontavam para ojzzx.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\deploy-production-workers-env.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" })
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$secrets = "SUPABASE_URL=supabase-url:latest,SUPABASE_SERVICE_ROLE_KEY=supabase-sr:latest"

Write-Host "Atualizando flux-farma-webhook (Supabase + META_VERIFY_TOKEN)..." -ForegroundColor Cyan
cmd /c "gcloud run services update flux-farma-webhook --project=$ProjectId --region=$Region --set-secrets=$secrets,META_VERIFY_TOKEN=meta-verify-token:latest --remove-env-vars=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,META_VERIFY_TOKEN --quiet"
if ($LASTEXITCODE -ne 0) { throw "webhook update failed" }

Write-Host "Atualizando flux-farma-orchestrator (Supabase + Meta)..." -ForegroundColor Cyan
$orchSecrets = "$secrets,META_ACCESS_TOKEN=meta-access-token:latest,META_PHONE_NUMBER_ID=meta-phone-number-id:latest,GOOGLE_API_KEY=google-api-key:latest"
cmd /c "gcloud run services update flux-farma-orchestrator --project=$ProjectId --region=$Region --set-secrets=$orchSecrets --remove-env-vars=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,META_ACCESS_TOKEN,META_PHONE_NUMBER_ID,GOOGLE_API_KEY --update-env-vars=ORCHESTRATOR_TARGET_INBOUND_ACK_MS=1000,ORCHESTRATOR_TARGET_MESSAGE_PERSISTED_MS=3000,ORCHESTRATOR_TARGET_BOT_REPLY_SENT_MS=5000,ORCHESTRATOR_TARGET_TOTAL_PROCESSING_MS=10000 --quiet"
if ($LASTEXITCODE -ne 0) { throw "orchestrator update failed" }

Write-Host "Atualizando flux-farma-campaign (Supabase)..." -ForegroundColor Cyan
cmd /c "gcloud run services update flux-farma-campaign --project=$ProjectId --region=$Region --set-secrets=$secrets --remove-env-vars=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY --quiet"
if ($LASTEXITCODE -ne 0) { Write-Host "AVISO: falha em flux-farma-campaign" -ForegroundColor Yellow }

# Scheduler: manter secrets Flux + Autentique (set-secrets substituiria tudo).
$schedulerSecrets = "$secrets,FLUX_DELIVERY_OAUTH_CLIENT_SECRET=flux-delivery-oauth-client-secret:latest,FLUX_DELIVERY_USERNAME=flux-delivery-username:latest,FLUX_DELIVERY_PASSWORD=flux-delivery-password:latest,AUTENTIQUE_API_KEY=autentique-api-key:latest,GOOGLE_API_KEY=google-api-key:latest"
Write-Host "Atualizando flux-farma-scheduler (Supabase + Flux + Autentique + Gemini)..." -ForegroundColor Cyan
cmd /c "gcloud run services update flux-farma-scheduler --project=$ProjectId --region=$Region --set-secrets=$schedulerSecrets --remove-env-vars=SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,GOOGLE_API_KEY --quiet"
if ($LASTEXITCODE -ne 0) { Write-Host "AVISO: falha em flux-farma-scheduler" -ForegroundColor Yellow }

Write-Host ""
Write-Host "Concluido. Rode: npm run gcp:post-deploy:pilot" -ForegroundColor Green
Write-Host "Meta callback URL: https://flux-farma-webhook-713561463013.us-central1.run.app/webhook"
