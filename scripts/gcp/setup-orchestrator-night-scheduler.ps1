# Cria Cloud Scheduler para night mode do orchestrator (LEGADO — preferir configure-orchestrator-night-mode.ps1).
# Os jobs HTTP com PUT na Run API v2 retornam 404; o caminho suportado e cron no scheduler-service.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\setup-orchestrator-night-scheduler.ps1
#   .\scripts\gcp\setup-orchestrator-night-scheduler.ps1 -Remove

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$SchedulerRegion = $(if ($env:GCP_SCHEDULER_REGION) { $env:GCP_SCHEDULER_REGION } else { "us-central1" }),
  [string]$Service = 'flux-farma-orchestrator',
  [string]$SaId = 'flux-orchestrator-night-scaler',
  [switch]$Remove
)

$ErrorActionPreference = 'Continue'
if (-not $ProjectId) { throw 'Set GCP_PROJECT_ID' }

$SaEmail = "$SaId@$ProjectId.iam.gserviceaccount.com"
$RunApi = "https://run.googleapis.com/v2/projects/$ProjectId/locations/$Region/services/$Service"
$JobOff = 'flux-orchestrator-night-off'
$JobWarm = 'flux-orchestrator-night-warmup'
$JobOn = 'flux-orchestrator-night-on'

function Ensure-Api([string]$Api) {
  gcloud services enable $Api --project=$ProjectId | Out-Null
}

function Remove-Job([string]$Name) {
  $exists = $false
  try {
    $null = gcloud scheduler jobs describe $Name --location=$SchedulerRegion --project=$ProjectId 2>&1
    $exists = ($LASTEXITCODE -eq 0)
  } catch {
    $exists = $false
  }
  if ($exists) {
    gcloud scheduler jobs delete $Name --location=$SchedulerRegion --project=$ProjectId --quiet
    Write-Host "Removed scheduler job $Name"
  }
}

if ($Remove) {
  Remove-Job $JobOff
  Remove-Job $JobWarm
  Remove-Job $JobOn
  Write-Host 'Night scheduler removido. Rode orchestrator-night-scale.ps1 -Mode on para min=1.'
  exit 0
}

Write-Host "=== Setup night mode orchestrator ($ProjectId) ===" -ForegroundColor Cyan

Ensure-Api 'cloudscheduler.googleapis.com'
Ensure-Api 'run.googleapis.com'
Ensure-Api 'iam.googleapis.com'

$saExists = $false
try {
  $null = gcloud iam service-accounts describe $SaEmail --project=$ProjectId 2>&1
  $saExists = ($LASTEXITCODE -eq 0)
} catch {
  $saExists = $false
}

if (-not $saExists) {
  gcloud iam service-accounts create $SaId `
    --project=$ProjectId `
    --display-name='Flux orchestrator night scaler'
  Write-Host "Created SA $SaEmail"
}

gcloud projects add-iam-policy-binding $ProjectId `
  --member="serviceAccount:$SaEmail" `
  --role='roles/run.admin' `
  --condition=None `
  --quiet | Out-Null

gcloud run services add-iam-policy-binding $Service `
  --project=$ProjectId `
  --region=$Region `
  --member="serviceAccount:$SaEmail" `
  --role='roles/run.invoker' `
  --quiet | Out-Null

$orchUrl = gcloud run services describe $Service --project=$ProjectId --region=$Region --format='value(status.url)'
if (-not $orchUrl) { throw "URL do servico $Service nao encontrada" }

$bodyOff = '{"template":{"scaling":{"minInstanceCount":0},"annotations":{"run.googleapis.com/cpu-throttling":"true"}}}'
$bodyOn = '{"template":{"scaling":{"minInstanceCount":1},"annotations":{"run.googleapis.com/cpu-throttling":"false","autoscaling.knative.dev/minScale":"1"}}}'
$maskOff = 'template.scaling.minInstanceCount,template.annotations'
$maskOn = 'template.scaling.minInstanceCount,template.annotations'

Remove-Job $JobOff
Remove-Job $JobWarm
Remove-Job $JobOn

gcloud scheduler jobs create http $JobOff `
  --project=$ProjectId `
  --location=$SchedulerRegion `
  --schedule='0 0 * * *' `
  --time-zone='America/Sao_Paulo' `
  --uri="${RunApi}?updateMask=${maskOff}" `
  --http-method=PUT `
  --headers='Content-Type=application/json' `
  --message-body=$bodyOff `
  --oauth-service-account-email=$SaEmail `
  --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform' `
  --description='00:00 BRT — orchestrator min=0 (mensagens no Pub/Sub)'
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar job $JobOff" }

gcloud scheduler jobs create http $JobWarm `
  --project=$ProjectId `
  --location=$SchedulerRegion `
  --schedule='55 5 * * *' `
  --time-zone='America/Sao_Paulo' `
  --uri="$orchUrl/health" `
  --http-method=GET `
  --oidc-service-account-email=$SaEmail `
  --oidc-token-audience=$orchUrl `
  --description='05:55 BRT — warmup cold start antes do expediente'
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar job $JobWarm" }

gcloud scheduler jobs create http $JobOn `
  --project=$ProjectId `
  --location=$SchedulerRegion `
  --schedule='0 6 * * *' `
  --time-zone='America/Sao_Paulo' `
  --uri="${RunApi}?updateMask=${maskOn}" `
  --http-method=PUT `
  --headers='Content-Type=application/json' `
  --message-body=$bodyOn `
  --oauth-service-account-email=$SaEmail `
  --oauth-token-scope='https://www.googleapis.com/auth/cloud-platform' `
  --description='06:00 BRT — orchestrator min=1 + CPU 24h'
if ($LASTEXITCODE -ne 0) { throw "Falha ao criar job $JobOn" }

Write-Host "`nScheduler jobs criados em $SchedulerRegion (America/Sao_Paulo):" -ForegroundColor Green
Write-Host "  - $JobOff   -> 00:00 min=0"
Write-Host "  - $JobWarm  -> 05:55 GET $orchUrl/health"
Write-Host "  - $JobOn    -> 06:00 min=1"
Write-Host "`nValide: .\scripts\gcp\verify-orchestrator-night-mode.ps1"
Write-Host "Rollback scheduler: .\scripts\gcp\setup-orchestrator-night-scheduler.ps1 -Remove"
