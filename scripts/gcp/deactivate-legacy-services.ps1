# Inativa (soft) os 11 servicos Cloud Run legados — SEM deletar.
# Fase A = staging; Fase B = producao legado.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\deactivate-legacy-services.ps1 -Phase A -DryRun
#   .\scripts\gcp\deactivate-legacy-services.ps1 -Phase A
#   .\scripts\gcp\deactivate-legacy-services.ps1 -Phase B

param(
  [ValidateSet("A", "B", "All")]
  [string]$Phase = "A",
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [switch]$DryRun
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$phaseA = @(
  @{ name = "coopmob-genai-mcp-staging"; region = "us-central1" },
  @{ name = "coopmob-panel-web-staging"; region = "us-central1" },
  @{ name = "rh-kelly-wa-staging"; region = "us-central1" },
  @{ name = "rh-kelly-agent-staging"; region = "us-central1" },
  @{ name = "coopmob-panel-api-staging"; region = "us-central1" },
  @{ name = "coopmob-doc-verifier-staging"; region = "us-central1" }
)

$phaseB = @(
  @{ name = "rh-kelly-whatsapp-bot"; region = "us-central1" },
  @{ name = "rh-kelly-agent"; region = "us-central1" },
  @{ name = "rh-kelly-agent"; region = "southamerica-east1" },
  @{ name = "coopmob-panel-api"; region = "us-central1" },
  @{ name = "doc-verifier"; region = "us-central1" }
)

$services = switch ($Phase) {
  "A"   { $phaseA }
  "B"   { $phaseB }
  "All" { $phaseA + $phaseB }
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
$backupDir = Join-Path $PSScriptRoot "backups/deactivate-legacy-$Phase-$ts"
$script = Join-Path $PSScriptRoot "deactivate-run-service.ps1"

Write-Host "Fase $Phase - $($services.Count) servico(s)"
Write-Host "Backup base: $backupDir"
if ($Phase -eq "B") {
  Write-Host ""
  Write-Host "ATENCAO Fase B: confirme webhook Meta em flux-farma-webhook antes de inativar rh-kelly-whatsapp-bot." -ForegroundColor Yellow
}

foreach ($svc in $services) {
  Write-Host ""
  Write-Host "=== $($svc.name) ($($svc.region)) ===" -ForegroundColor Cyan
  if ($DryRun) {
    & $script -ServiceName $svc.name -ProjectId $ProjectId -Region $svc.region -BackupDir $backupDir -DryRun
  } else {
    & $script -ServiceName $svc.name -ProjectId $ProjectId -Region $svc.region -BackupDir $backupDir
  }
  if ($LASTEXITCODE -ne 0 -and -not $DryRun) {
    throw "Falha ao inativar $($svc.name)"
  }
}

Write-Host ""
Write-Host "Concluido. Servicos permanecem no console com label legacy-status=inactive."
Write-Host "Listar inativos: gcloud run services list --filter=metadata.labels.legacy-status=inactive"
Write-Host ('Reativar: .\scripts\gcp\reactivate-run-service.ps1 -BackupDir ' + $backupDir + ' -ServiceName NOME -Region REGIAO')
