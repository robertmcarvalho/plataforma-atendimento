# Cria alerta de billing quando Cloud Run ultrapassar limite mensal (BRL).
# Requer Billing Account Admin ou Budget Admin no projeto.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   $env:GCP_BILLING_ACCOUNT_ID = "012345-6789AB-DEF012"  # gcloud billing accounts list
#   $env:CLOUD_RUN_BUDGET_BRL = "300"
#   .\scripts\gcp\create-cloud-run-budget-alert.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$BillingAccountId = $env:GCP_BILLING_ACCOUNT_ID,
  [int]$BudgetBrl = $(if ($env:CLOUD_RUN_BUDGET_BRL) { [int]$env:CLOUD_RUN_BUDGET_BRL } else { 300 }),
  [string]$AlertEmail = $env:CLOUD_RUN_BUDGET_ALERT_EMAIL
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }
if (-not $BillingAccountId) {
  Write-Host "Contas de billing disponiveis:"
  gcloud billing accounts list --format="table(name,displayName,open)"
  throw "Set GCP_BILLING_ACCOUNT_ID (ex.: 012345-6789AB-DEF012)"
}

$budgetName = "flux-farma-cloud-run-pilot-$BudgetBrl-brl"
$projectNumber = gcloud projects describe $ProjectId --format="value(projectNumber)"
if (-not $projectNumber) { throw "Nao foi possivel obter projectNumber de $ProjectId" }

Write-Host "Criando budget Cloud Run: R$ $BudgetBrl/mes (projeto $ProjectId / $projectNumber) ..."

gcloud billing budgets create `
  --billing-account=$BillingAccountId `
  --display-name=$budgetName `
  --budget-amount="${BudgetBrl}BRL" `
  --filter-projects="projects/$projectNumber" `
  --filter-services="services/152E-C115-5142" `
  --threshold-rule=percent=0.5 `
  --threshold-rule=percent=0.9 `
  --threshold-rule=percent=1.0

if ($LASTEXITCODE -ne 0) {
  Write-Host "Falha ao criar budget. Habilite billingbudgets.googleapis.com e confira permissao Budget Admin." -ForegroundColor Red
  exit $LASTEXITCODE
}
Write-Host "Budget criado. SKU filter: Cloud Run (152E-C115-5142)."
if ($AlertEmail) {
  Write-Host "Configure notificacoes para $AlertEmail no Console > Billing > Budgets."
}
