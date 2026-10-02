# Escala flux-farma-orchestrator para night mode (min=0) ou day mode (min=1 + CPU 24h).
#
# Usage:
#   .\scripts\gcp\orchestrator-night-scale.ps1 -Mode off
#   .\scripts\gcp\orchestrator-night-scale.ps1 -Mode on
#   .\scripts\gcp\orchestrator-night-scale.ps1 -Mode status

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('off', 'on', 'status')]
  [string]$Mode,

  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$Service = 'flux-farma-orchestrator'
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectId) { throw 'Set GCP_PROJECT_ID' }

function Get-BrtHour {
  . "$PSScriptRoot\lib\BrtNightWindow.ps1"
  $w = Test-BrtOrchestratorNightWindow
  return @{ Hour = $w.Hour; Now = $w.Now }
}

function Get-OrchestratorScaling {
  $json = gcloud run services describe $Service --project=$ProjectId --region=$Region --format=json | ConvertFrom-Json
  $ann = $json.spec.template.metadata.annotations
  return @{
    min = if ($ann.'autoscaling.knative.dev/minScale') { $ann.'autoscaling.knative.dev/minScale' } else { '0' }
    throttle = if ($ann.'run.googleapis.com/cpu-throttling') { $ann.'run.googleapis.com/cpu-throttling' } else { 'true' }
    url = $json.status.url
  }
}

$scaling = Get-OrchestratorScaling
$brt = Get-BrtHour

if ($Mode -eq 'status') {
  . "$PSScriptRoot\lib\BrtNightWindow.ps1"
  $night = (Test-BrtOrchestratorNightWindow).InWindow
  Write-Host "Service: $Service ($ProjectId / $Region)"
  Write-Host "BRT: $($brt.Now.ToString('yyyy-MM-dd HH:mm:ss'))  night_window=$night (22:00-06:00)"
  Write-Host "min-instances=$($scaling.min)  cpu-throttling=$($scaling.throttle)"
  Write-Host "url=$($scaling.url)"
  exit 0
}

if ($Mode -eq 'off') {
  Write-Host "Night OFF: $Service min-instances=0 (Pub/Sub retém mensagens) ..."
  gcloud run services update $Service `
    --project=$ProjectId `
    --region=$Region `
    --min-instances=0 `
    --cpu-throttling
  Write-Host 'OK — orchestrator scale-to-zero (noite).'
  exit 0
}

Write-Host "Night ON: $Service min-instances=1 + CPU 24h ..."
gcloud run services update $Service `
  --project=$ProjectId `
  --region=$Region `
  --min-instances=1 `
  --no-cpu-throttling

if ($scaling.url) {
  try {
    $resp = Invoke-WebRequest -Uri "$($scaling.url)/health" -UseBasicParsing -TimeoutSec 120
    Write-Host "Warmup /health -> $($resp.StatusCode)"
  } catch {
    Write-Warning "Warmup /health falhou (instancia pode subir no primeiro pull Pub/Sub): $($_.Exception.Message)"
  }
}

Write-Host 'OK — orchestrator perfil diurno (min=1, throttle=false).'
exit 0
