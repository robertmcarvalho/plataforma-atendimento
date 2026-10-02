# Pausa / retoma integração Autentique (custo API GraphQL).
#
# Pausar (imediato, sem deploy):
#   .\scripts\gcp\pause-autentique.ps1
#
# Retomar quando decidir viabilidade:
#   .\scripts\gcp\pause-autentique.ps1 -Resume

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [switch]$Resume
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectId) { throw 'Defina GCP_PROJECT_ID' }

$jobId = 'flux-scheduler-signature-sync'

if ($Resume) {
  Write-Host 'Retomando Autentique...' -ForegroundColor Cyan
  gcloud scheduler jobs resume $jobId --project=$ProjectId --location=$Region
  gcloud run services update flux-farma-scheduler --project=$ProjectId --region=$Region `
    --update-env-vars=AUTENTIQUE_SYNC_ENABLED=true `
    --update-secrets=AUTENTIQUE_API_KEY=autentique-api-key:latest
  gcloud run services update flux-farma-api --project=$ProjectId --region=$Region `
    --update-env-vars=AUTENTIQUE_SYNC_ENABLED=true `
    --update-secrets=AUTENTIQUE_API_KEY=autentique-api-key:latest,AUTENTIQUE_WEBHOOK_SECRET=autentique-webhook-secret:latest
  Write-Host 'Autentique reativado. Valide uma reconciliação em Operação.' -ForegroundColor Green
} else {
  Write-Host 'Pausando Autentique (polling + API key)...' -ForegroundColor Yellow
  gcloud scheduler jobs pause $jobId --project=$ProjectId --location=$Region
  gcloud run services update flux-farma-scheduler --project=$ProjectId --region=$Region `
    --update-env-vars=AUTENTIQUE_SYNC_ENABLED=false `
    --remove-secrets=AUTENTIQUE_API_KEY
  gcloud run services update flux-farma-api --project=$ProjectId --region=$Region `
    --update-env-vars=AUTENTIQUE_SYNC_ENABLED=false `
    --remove-secrets=AUTENTIQUE_API_KEY
  Write-Host 'Autentique pausado. Job Cloud Scheduler PAUSED; chaves removidas dos serviços.' -ForegroundColor Green
}
