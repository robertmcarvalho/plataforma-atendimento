# Verifica anotacoes de scaling dos servicos Flux Farma no Cloud Run.
# Usage: .\scripts\gcp\verify-run-scaling.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [ValidateSet('pilot', 'production')]
  [string]$Profile = 'pilot'
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

function Get-BrtNightWindow {
  . "$PSScriptRoot\lib\BrtNightWindow.ps1"
  return (Test-BrtOrchestratorNightWindow).InWindow
}

$nightMode = Get-BrtNightWindow

$expected = @{
  pilot = @{
    'flux-farma-scheduler'     = @{ min = '0'; throttle = 'true' }
    'flux-farma-orchestrator'  = @{ min = '1'; throttle = 'false' }
    'flux-farma-campaign'      = @{ min = '0'; throttle = 'true' }
    'flux-farma-webhook'       = @{ min = '1'; throttle = 'true' }
    'flux-farma-api'           = @{ min = '0'; throttle = 'true' }
    'flux-farma-web'           = @{ min = '0'; throttle = 'true' }
  }
  production = @{
    'flux-farma-scheduler'     = @{ min = '1'; throttle = 'false' }
    'flux-farma-orchestrator'  = @{ min = '1'; throttle = 'false' }
    'flux-farma-campaign'      = @{ min = '1'; throttle = 'false' }
    'flux-farma-webhook'       = @{ min = '0'; throttle = 'true' }
    'flux-farma-api'           = @{ min = '0'; throttle = 'true' }
    'flux-farma-web'           = @{ min = '0'; throttle = 'true' }
  }
}

$fail = $false
foreach ($svc in $expected[$Profile].Keys) {
  $json = gcloud run services describe $svc --project=$ProjectId --region=$Region --format=json | ConvertFrom-Json
  $ann = $json.spec.template.metadata.annotations
  $min = if ($ann.'autoscaling.knative.dev/minScale') { $ann.'autoscaling.knative.dev/minScale' } else { '0' }
  $thr = if ($ann.'run.googleapis.com/cpu-throttling') { $ann.'run.googleapis.com/cpu-throttling' } else { 'true' }
  $exp = $expected[$Profile][$svc]
  if ($Profile -eq 'pilot' -and $svc -eq 'flux-farma-orchestrator' -and $nightMode) {
    $exp = @{ min = '0'; throttle = $exp.throttle }
  }
  $ok = ($min -eq $exp.min) -and ($thr -eq $exp.throttle)
  if (-not $ok) { $fail = $true }
  $mark = if ($ok) { 'OK' } else { 'FAIL' }
  Write-Host "[$mark] $svc  min=$min (exp $($exp.min))  throttle=$thr (exp $($exp.throttle))"
}

if ($fail) {
  Write-Host "`nScaling divergente do perfil '$Profile'. Rode configure-workers-$Profile.ps1" -ForegroundColor Red
  exit 1
}

Write-Host "`nScaling OK para perfil '$Profile'." -ForegroundColor Green
