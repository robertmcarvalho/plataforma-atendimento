# Inativa um servico Cloud Run SEM apagar (reversivel).
# - Backup de describe + IAM
# - Remove IAM publico primeiro (sem nova revisao)
# - ingress=internal + labels com --no-traffic e mesma imagem da revisao Ready
# - Fixa trafego na revisao Ready (evita Ready=False por cold start falho)
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\deactivate-run-service.ps1 -ServiceName rh-kelly-whatsapp-bot
#   .\scripts\gcp\deactivate-run-service.ps1 -ServiceName rh-kelly-whatsapp-bot -DryRun

param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceName,
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$BackupDir,
  [switch]$DryRun
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

function Get-RunRevisionInfo {
  param([string]$Name, [string]$Project, [string]$Reg)
  $ready = gcloud run services describe $Name `
    --project=$Project --region=$Reg `
    --format="value(status.latestReadyRevisionName)"
  $created = gcloud run services describe $Name `
    --project=$Project --region=$Reg `
    --format="value(status.latestCreatedRevisionName)"
  $image = $null
  if ($ready) {
    $image = gcloud run revisions describe $ready `
      --project=$Project --region=$Reg `
      --format="value(spec.containers[0].image)" 2>$null
  }
  return @{ Ready = $ready; Created = $created; Image = $image }
}

function Repair-RunServiceTraffic {
  param(
    [string]$Name,
    [string]$Project,
    [string]$Reg,
    [string]$TargetRevision
  )
  if (-not $TargetRevision) {
    Write-Host "  AVISO: sem revisao Ready para fixar trafego." -ForegroundColor Yellow
    return
  }
  Write-Host "  Fixando trafego em $TargetRevision (100%)..."
  gcloud run services update-traffic $Name `
    --project=$Project `
    --region=$Reg `
    --to-revisions="${TargetRevision}=100" `
    --quiet
}

$ts = Get-Date -Format "yyyyMMdd-HHmmss"
if (-not $BackupDir) {
  $BackupDir = Join-Path $PSScriptRoot "backups/deactivate-$ts"
}

$safeName = "$ServiceName-$Region" -replace '[^a-zA-Z0-9._-]', '_'
$describePath = Join-Path $BackupDir "$safeName.describe.yaml"
$iamPath = Join-Path $BackupDir "$safeName.iam.json"
$metaPath = Join-Path $BackupDir "$safeName.meta.json"

Write-Host "Servico: $ServiceName ($Region) em $ProjectId"
Write-Host "Backup:  $BackupDir"

$revBefore = Get-RunRevisionInfo -Name $ServiceName -Project $ProjectId -Reg $Region

$ingress = gcloud run services describe $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --format="value(metadata.annotations.'run.googleapis.com/ingress')"

$minInst = gcloud run services describe $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --format="value(spec.template.metadata.annotations.'autoscaling.knative.dev/minScale')"

Write-Host "Ingress atual: $ingress"
Write-Host "Revisao Ready: $($revBefore.Ready)"
Write-Host "Imagem Ready: $($revBefore.Image)"
Write-Host "min-instances atual: $(if ($minInst) { $minInst } else { '0 (default)' })"

$publicMembers = @()
if (-not $DryRun) {
  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
  gcloud run services describe $ServiceName `
    --project=$ProjectId `
    --region=$Region `
    --format=yaml | Set-Content -Encoding utf8 $describePath
  gcloud run services get-iam-policy $ServiceName `
    --project=$ProjectId `
    --region=$Region `
    --format=json | Set-Content -Encoding utf8 $iamPath

  $iamJson = Get-Content $iamPath -Raw | ConvertFrom-Json
  foreach ($binding in $iamJson.bindings) {
    if ($binding.role -ne "roles/run.invoker") { continue }
    foreach ($member in $binding.members) {
      if ($member -eq "allUsers" -or $member -eq "allAuthenticatedUsers") {
        $publicMembers += $member
      }
    }
  }
} else {
  $publicMembers = @("allUsers")
}

$meta = @{
  serviceName         = $ServiceName
  region              = $Region
  projectId           = $ProjectId
  deactivatedAt       = (Get-Date).ToString("o")
  ingressBefore       = $ingress
  minInstancesBefore  = $minInst
  readyRevisionBefore = $revBefore.Ready
  imageBefore         = $revBefore.Image
  backupDir           = $BackupDir
} | ConvertTo-Json -Depth 4

if (-not $DryRun) {
  $meta | Set-Content -Encoding utf8 $metaPath
}

Write-Host ""
Write-Host "Acoes planejadas:"
Write-Host "  1. remover IAM publico: $($publicMembers -join ', ')"
Write-Host "  2. update --ingress=internal --no-traffic --image=<mesma da revisao Ready>"
Write-Host "  3. fixar trafego em $($revBefore.Ready)"

if ($DryRun) {
  Write-Host ""
  Write-Host "[DryRun] Nenhuma alteracao aplicada."
  exit 0
}

foreach ($member in $publicMembers) {
  Write-Host "Removendo invoker publico: $member"
  gcloud run services remove-iam-policy-binding $ServiceName `
    --project=$ProjectId `
    --region=$Region `
    --member=$member `
    --role=roles/run.invoker `
    --quiet 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "  (binding nao encontrado ou ja removido)" -ForegroundColor DarkYellow
  }
}

$updateArgs = @(
  "run", "services", "update", $ServiceName,
  "--project=$ProjectId",
  "--region=$Region",
  "--ingress=internal",
  "--min-instances=0",
  "--cpu-throttling",
  "--update-labels=legacy-status=inactive",
  "--no-traffic",
  "--quiet"
)
if ($revBefore.Image) {
  $updateArgs += "--image=$($revBefore.Image)"
}

Write-Host "Aplicando ingress=internal com --no-traffic..."
$updateOk = $true
& gcloud @updateArgs
if ($LASTEXITCODE -ne 0) {
  $updateOk = $false
  Write-Host "  Update retornou erro (IAM ja removido; trafego sera fixado)." -ForegroundColor Yellow
}

Repair-RunServiceTraffic -Name $ServiceName -Project $ProjectId -Reg $Region -TargetRevision $revBefore.Ready

$serviceReady = gcloud run services describe $ServiceName `
  --project=$ProjectId --region=$Region `
  --format="value(status.conditions[?type='Ready'].status)"

if (-not $updateOk) {
  Write-Host ""
  Write-Host "Servico inativado (IAM + trafego). Service Ready: $serviceReady" -ForegroundColor Yellow
} else {
  Write-Host ""
  Write-Host "Servico inativado (soft). Service Ready: $serviceReady"
}

Write-Host "Backup em: $BackupDir"
Write-Host "Reativar: .\scripts\gcp\reactivate-run-service.ps1 -BackupDir `"$BackupDir`" -ServiceName $ServiceName -Region $Region"
