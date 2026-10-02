# Reativa um servico Cloud Run inativado por deactivate-run-service.ps1.
# Restaura ingress, min-instances (se estava no backup) e bindings IAM publicos.
#
# Usage:
#   .\scripts\gcp\reactivate-run-service.ps1 -BackupDir scripts/gcp/backups/deactivate-20260606-1500 -ServiceName rh-kelly-whatsapp-bot
#   .\scripts\gcp\reactivate-run-service.ps1 -BackupDir ... -ServiceName rh-kelly-whatsapp-bot -DryRun

param(
  [Parameter(Mandatory = $true)]
  [string]$BackupDir,
  [Parameter(Mandatory = $true)]
  [string]$ServiceName,
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [switch]$DryRun
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$safeName = "$ServiceName-$Region" -replace '[^a-zA-Z0-9._-]', '_'
$iamPath = Join-Path $BackupDir "$safeName.iam.json"
$metaPath = Join-Path $BackupDir "$safeName.meta.json"

if (-not (Test-Path $iamPath)) { throw "Backup IAM nao encontrado: $iamPath" }

$ingress = "all"
$minInst = $null
if (Test-Path $metaPath) {
  $meta = Get-Content $metaPath -Raw | ConvertFrom-Json
  if ($meta.ingressBefore) { $ingress = $meta.ingressBefore }
  if ($meta.minInstancesBefore) { $minInst = $meta.minInstancesBefore }
}

$publicMembers = @()
$iamJson = Get-Content $iamPath -Raw | ConvertFrom-Json
foreach ($binding in $iamJson.bindings) {
  if ($binding.role -ne "roles/run.invoker") { continue }
  foreach ($member in $binding.members) {
    if ($member -eq "allUsers" -or $member -eq "allAuthenticatedUsers") {
      $publicMembers += $member
    }
  }
}

Write-Host "Reativando $ServiceName ($Region)"
Write-Host "  ingress -> $ingress"
Write-Host "  min-instances -> $(if ($minInst) { $minInst } else { '0 (nao alterado no meta)' })"
Write-Host "  IAM publico -> $($publicMembers -join ', ')"

if ($DryRun) {
  Write-Host "[DryRun] Nenhuma alteracao aplicada."
  exit 0
}

$readyRev = $null
if (Test-Path $metaPath) {
  $metaObj = Get-Content $metaPath -Raw | ConvertFrom-Json
  if ($metaObj.readyRevisionBefore) { $readyRev = $metaObj.readyRevisionBefore }
}
if (-not $readyRev) {
  $readyRev = gcloud run services describe $ServiceName `
    --project=$ProjectId --region=$Region `
    --format="value(status.latestReadyRevisionName)"
}

$updateArgs = @(
  "run", "services", "update", $ServiceName,
  "--project=$ProjectId",
  "--region=$Region",
  "--ingress=$ingress",
  "--remove-labels=legacy-status",
  "--no-traffic"
)
if ($minInst -and $minInst -ne "0") {
  $updateArgs += "--min-instances=$minInst"
}
& gcloud @updateArgs

if ($readyRev) {
  Write-Host "Fixando trafego em $readyRev..."
  gcloud run services update-traffic $ServiceName `
    --project=$ProjectId `
    --region=$Region `
    --to-revisions="${readyRev}=100" `
    --quiet
}

foreach ($member in $publicMembers) {
  Write-Host "Restaurando invoker: $member"
  gcloud run services add-iam-policy-binding $ServiceName `
    --project=$ProjectId `
    --region=$Region `
    --member=$member `
    --role=roles/run.invoker `
    --quiet
}

Write-Host "Servico reativado."
