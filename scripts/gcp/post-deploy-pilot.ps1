# Pos-deploy obrigatorio apos nova imagem nos servicos flux-farma-* (perfil piloto).
# Reaplica scaling de custo e valida. Falha se o perfil nao bater.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\post-deploy-pilot.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" })
)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot

Write-Host "=== Flux Farma: pos-deploy (perfil piloto) ===" -ForegroundColor Cyan

& "$here\configure-workers-pilot.ps1" -ProjectId $ProjectId -Region $Region
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

# Deploy noturno: reaplica min=0 no orchestrator se estivermos na janela 22:00-06:00 BRT.
try {
  . "$here\lib\BrtNightWindow.ps1"
  $night = Test-BrtOrchestratorNightWindow
  if ($night.InWindow) {
    Write-Host "Janela noturna BRT (22:00-06:00) - orchestrator volta para min=0 apos post-deploy." -ForegroundColor Yellow
    & "$here\orchestrator-night-scale.ps1" -Mode off -ProjectId $ProjectId -Region $Region
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }
} catch {
  Write-Warning "Nao foi possivel ajustar night mode pos-deploy: $($_.Exception.Message)"
}

& "$here\verify-run-scaling.ps1" -ProjectId $ProjectId -Region $Region -Profile pilot
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if (Test-Path "$here\configure-orchestrator-night-mode.ps1") {
  & "$here\configure-orchestrator-night-mode.ps1" -ProjectId $ProjectId -Region $Region
  if ($LASTEXITCODE -ne 0) { Write-Warning "configure-orchestrator-night-mode falhou; verifique env do scheduler" }
}

Write-Host "`nPos-deploy piloto concluido." -ForegroundColor Green
