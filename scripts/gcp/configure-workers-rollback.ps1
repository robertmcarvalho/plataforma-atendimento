# Restaura perfil caro (min=1 + CPU 24h nos 3 workers). Ultimo recurso.
# Usage: .\scripts\gcp\configure-workers-rollback.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" })
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

Write-Warning "Isso aumenta o custo Cloud Run para ~R$ 900/mes. Confirme antes de continuar."
& "$PSScriptRoot\configure-workers-production.ps1" -ProjectId $ProjectId -Region $Region
