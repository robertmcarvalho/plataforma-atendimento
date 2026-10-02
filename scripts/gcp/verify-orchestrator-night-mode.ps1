# Valida jobs Cloud Scheduler do night mode e scaling esperado do orchestrator.
#
# Usage: .\scripts\gcp\verify-orchestrator-night-mode.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$SchedulerRegion = $(if ($env:GCP_SCHEDULER_REGION) { $env:GCP_SCHEDULER_REGION } else { "us-central1" }),
  [string]$Service = 'flux-farma-orchestrator'
)

$ErrorActionPreference = 'Continue'
if (-not $ProjectId) { throw 'Set GCP_PROJECT_ID' }

function Get-BrtNight {
  . "$PSScriptRoot\lib\BrtNightWindow.ps1"
  $w = Test-BrtOrchestratorNightWindow
  return @{ Night = $w.InWindow; Now = $w.Now; Hour = $w.Hour }
}

$fail = $false
$brt = Get-BrtNight
  Write-Host "BRT: $($brt.Now.ToString('yyyy-MM-dd HH:mm:ss'))  janela_noturna=$($brt.Night) (22:00-06:00)" -ForegroundColor Cyan

$jobs = @('flux-orchestrator-night-off', 'flux-orchestrator-night-warmup', 'flux-orchestrator-night-on')
$legacyPresent = $false
foreach ($job in $jobs) {
  gcloud scheduler jobs describe $job --location=$SchedulerRegion --project=$ProjectId 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "[WARN] job legado Cloud Scheduler ainda ativo: $job (deve usar cron no scheduler-service)" -ForegroundColor Yellow
    $legacyPresent = $true
  }
}
if (-not $legacyPresent) {
  Write-Host '[OK] sem jobs Cloud Scheduler legados (modo scheduler-service)' -ForegroundColor Green
}

$schedulerEnv = gcloud run services describe flux-farma-scheduler --project=$ProjectId --region=$Region --format=json | ConvertFrom-Json
$envList = $schedulerEnv.spec.template.spec.containers[0].env
$nightEnabled = ($envList | Where-Object { $_.name -eq 'ORCHESTRATOR_NIGHT_MODE_ENABLED' }).value
$healthUrl = ($envList | Where-Object { $_.name -eq 'ORCHESTRATOR_HEALTH_URL' }).value
if ($nightEnabled -eq 'true' -and $healthUrl) {
  Write-Host "[OK] scheduler ORCHESTRATOR_NIGHT_MODE_ENABLED=true  health=$healthUrl"
} else {
  Write-Host "[FAIL] scheduler sem night mode env (rode configure-orchestrator-night-mode.ps1)" -ForegroundColor Red
  $fail = $true
}

$json = gcloud run services describe $Service --project=$ProjectId --region=$Region --format=json | ConvertFrom-Json
$ann = $json.spec.template.metadata.annotations
$min = if ($ann.'autoscaling.knative.dev/minScale') { $ann.'autoscaling.knative.dev/minScale' } else { '0' }
$thr = if ($ann.'run.googleapis.com/cpu-throttling') { $ann.'run.googleapis.com/cpu-throttling' } else { 'true' }

if ($brt.Night) {
  $expMin = '0'
} else {
  $expMin = '1'
}
$expThr = if ($brt.Night) { 'true' } else { 'false' }

$scaleOk = ($min -eq $expMin)
if (-not $brt.Night -and $thr -ne 'false') { $scaleOk = $false }

if ($scaleOk) {
  Write-Host "[OK] $Service min=$min (exp $expMin) throttle=$thr (exp $expThr)" -ForegroundColor Green
} else {
  Write-Host "[FAIL] $Service min=$min (exp $expMin) throttle=$thr (exp $expThr)" -ForegroundColor Red
  $fail = $true
}

try {
  $undelivered = gcloud pubsub subscriptions describe whatsapp.inbound-sub --project=$ProjectId --format='value(numUndeliveredMessages)' 2>$null
  $undeliveredAuto = gcloud pubsub subscriptions describe whatsapp.inbound.auto-sub --project=$ProjectId --format='value(numUndeliveredMessages)' 2>$null
  Write-Host "Pub/Sub backlog: inbound-sub=$undelivered  inbound.auto-sub=$undeliveredAuto"
} catch {
  Write-Warning "Nao foi possivel ler backlog Pub/Sub: $($_.Exception.Message)"
}

if ($fail) {
  Write-Host "`nNight mode divergente." -ForegroundColor Red
  exit 1
}

Write-Host "`nNight mode OK." -ForegroundColor Green
exit 0
