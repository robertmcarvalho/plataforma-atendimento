# Repara servico Cloud Run com revisao quebrada (Ready=False) apos inativacao.
# Fixa trafego na ultima revisao Ready; se necessario, cria revisao saudavel com --no-traffic.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\repair-run-service-traffic.ps1 -ServiceName rh-kelly-whatsapp-bot
#   .\scripts\gcp\repair-run-service-traffic.ps1 -ServiceName doc-verifier -DryRun

param(
  [Parameter(Mandatory = $true)]
  [string]$ServiceName,
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$TargetRevision,
  [switch]$DryRun
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$ready = if ($TargetRevision) { $TargetRevision } else {
  gcloud run services describe $ServiceName `
    --project=$ProjectId --region=$Region `
    --format="value(status.latestReadyRevisionName)"
}

$created = gcloud run services describe $ServiceName `
  --project=$ProjectId --region=$Region `
  --format="value(status.latestCreatedRevisionName)"

$image = $null
if ($ready) {
  $image = gcloud run revisions describe $ready `
    --project=$ProjectId --region=$Region `
    --format="value(spec.containers[0].image)" 2>$null
}

Write-Host "Servico: $ServiceName ($Region)"
Write-Host "Revisao Ready: $ready"
Write-Host "Revisao criada: $created"
Write-Host "Imagem Ready: $image"

if (-not $ready) { throw "Nenhuma revisao Ready encontrada." }

if ($DryRun) {
  Write-Host "[DryRun] Fixaria trafego em $ready; heal deploy com --no-traffic se latestCreated falhou."
  exit 0
}

$createdReady = $null
if ($created) {
  $createdReady = gcloud run revisions describe $created `
    --project=$ProjectId --region=$Region `
    --format="value(status.conditions[?type='Ready'].status)" 2>$null
}

if ($created -and $created -ne $ready -and $createdReady -ne "True" -and $image) {
  Write-Host "Heal deploy com mesma imagem (--no-traffic)..."
  gcloud run services update $ServiceName `
    --project=$ProjectId `
    --region=$Region `
    --image=$image `
    --ingress=internal `
    --no-traffic `
    --quiet
}

Write-Host "Fixando trafego em $ready..."
gcloud run services update-traffic $ServiceName `
  --project=$ProjectId `
  --region=$Region `
  --to-revisions="${ready}=100" `
  --quiet

$serviceReady = gcloud run services describe $ServiceName `
  --project=$ProjectId --region=$Region `
  --format="value(status.conditions[?type='Ready'].status)"
Write-Host "Service Ready: $serviceReady"
