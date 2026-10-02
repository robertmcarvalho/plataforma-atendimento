# Remove VPC connector orfao (nenhum Cloud Run referencia).
# Padrao: dry-run. Execute com CONFIRM_VPC_CONNECTOR_DELETE=true
#
# Usage:
#   .\scripts\gcp\remove-orphan-vpc-connector.ps1 -ConnectorName conn-wa-staging
#   $env:CONFIRM_VPC_CONNECTOR_DELETE="true"
#   .\scripts\gcp\remove-orphan-vpc-connector.ps1 -ConnectorName conn-wa-staging -Execute

param(
  [string]$ConnectorName = "conn-wa-staging",
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [switch]$Execute
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$confirm = $env:CONFIRM_VPC_CONNECTOR_DELETE -eq "true"
if ($Execute -and -not $confirm) {
  throw "Defina CONFIRM_VPC_CONNECTOR_DELETE=true para executar"
}

Write-Host "Verificando referencias ao connector $ConnectorName ..."

$services = gcloud run services list --project=$ProjectId --region=$Region --format="value(metadata.name)"
$refs = @()
foreach ($svc in $services) {
  $vpc = gcloud run services describe $svc --project=$ProjectId --region=$Region `
    --format="value(spec.template.metadata.annotations.'run.googleapis.com/vpc-access-connector')" 2>$null
  if ($vpc -and $vpc -like "*$ConnectorName*") { $refs += $svc }
}

if ($refs.Count -gt 0) {
  throw "Connector ainda em uso por: $($refs -join ', '). Abortando."
}

$state = gcloud compute networks vpc-access connectors describe $ConnectorName `
  --project=$ProjectId --region=$Region --format="value(state)" 2>$null

Write-Host "Estado atual: $state"
Write-Host "Nenhum servico Cloud Run referencia este connector."

if (-not $Execute) {
  Write-Host "Dry-run. Para remover:"
  Write-Host '  $env:CONFIRM_VPC_CONNECTOR_DELETE="true"'
  Write-Host "  .\scripts\gcp\remove-orphan-vpc-connector.ps1 -ConnectorName $ConnectorName -Execute"
  exit 0
}

Write-Host "Removendo connector $ConnectorName ..."
gcloud compute networks vpc-access connectors delete $ConnectorName `
  --project=$ProjectId `
  --region=$Region `
  --quiet

Write-Host "Connector removido."
