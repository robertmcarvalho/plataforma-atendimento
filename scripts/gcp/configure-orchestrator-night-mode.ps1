# Habilita night mode via scheduler-service (cron interno + Run API PATCH).
# Desativa jobs Cloud Scheduler legados (PUT 404).
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\configure-orchestrator-night-mode.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$SchedulerRegion = $(if ($env:GCP_SCHEDULER_REGION) { $env:GCP_SCHEDULER_REGION } else { "us-central1" })
)

$ErrorActionPreference = 'Continue'
if (-not $ProjectId) { throw 'Set GCP_PROJECT_ID' }

$orchUrl = gcloud run services describe flux-farma-orchestrator --project=$ProjectId --region=$Region --format='value(status.url)'
if (-not $orchUrl) { throw 'URL do orchestrator nao encontrada' }

$schedulerSa = gcloud run services describe flux-farma-scheduler --project=$ProjectId --region=$Region --format='value(spec.template.spec.serviceAccountName)'
if (-not $schedulerSa) {
  $projectNumber = gcloud projects describe $ProjectId --format='value(projectNumber)'
  $schedulerSa = "$projectNumber-compute@developer.gserviceaccount.com"
}

Write-Host "Scheduler SA: $schedulerSa" -ForegroundColor Cyan
Write-Host "Orchestrator URL: $orchUrl"

gcloud projects add-iam-policy-binding $ProjectId `
  --member="serviceAccount:$schedulerSa" `
  --role='roles/run.admin' `
  --condition=None `
  --quiet | Out-Null

gcloud run services add-iam-policy-binding flux-farma-orchestrator `
  --project=$ProjectId `
  --region=$Region `
  --member="serviceAccount:$schedulerSa" `
  --role='roles/run.invoker' `
  --quiet | Out-Null

$envVars = "ORCHESTRATOR_NIGHT_MODE_ENABLED=true,ORCHESTRATOR_HEALTH_URL=$orchUrl,GCP_REGION=$Region,ORCHESTRATOR_RUN_SERVICE=flux-farma-orchestrator"
gcloud run services update flux-farma-scheduler `
  --project=$ProjectId `
  --region=$Region `
  --update-env-vars=$envVars `
  --quiet
if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar env do scheduler' }

$legacyJobs = @('flux-orchestrator-night-off', 'flux-orchestrator-night-warmup', 'flux-orchestrator-night-on')
foreach ($job in $legacyJobs) {
  gcloud scheduler jobs describe $job --location=$SchedulerRegion --project=$ProjectId 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    gcloud scheduler jobs delete $job --location=$SchedulerRegion --project=$ProjectId --quiet
    Write-Host "Removido job legado Cloud Scheduler: $job"
  }
}

Write-Host "`nNight mode configurado no scheduler-service." -ForegroundColor Green
Write-Host "Requer deploy da imagem scheduler com cron interno (orchestratorNightMode.ts)."
Write-Host "Apos deploy: npm run gcp:post-deploy:pilot"
