# Perfil ALTA ESCALA: min=1 + CPU 24h nos 3 workers (~R$ 900/mes Cloud Run).
# NAO usar no piloto Flux Farma — preferir configure-workers-pilot.ps1 (~R$ 160/mes).
#
# Usage: .\scripts\gcp\configure-workers-production.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" })
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$workers = @(
  "flux-farma-orchestrator",
  "flux-farma-scheduler",
  "flux-farma-campaign"
)

foreach ($svc in $workers) {
  Write-Host "Updating $svc ..."
  gcloud run services update $svc `
    --project=$ProjectId `
    --region=$Region `
    --min-instances=1 `
    --no-cpu-throttling
}

Write-Host "Workers updated."
