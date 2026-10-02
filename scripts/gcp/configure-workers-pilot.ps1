# Perfil piloto / producao Flux Farma — custo otimizado.
# Aplica apos deploy de imagem para evitar regressao do configure-workers-production.ps1.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\configure-workers-pilot.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" })
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

Write-Host "Configurando workers (perfil piloto) em $ProjectId / $Region ..."

# Scheduler: Cloud Scheduler HTTP — scale to zero entre invocações.
gcloud run services update flux-farma-scheduler `
  --project=$ProjectId `
  --region=$Region `
  --min-instances=0 `
  --cpu-throttling

# Orchestrator + Webhook: Pub/Sub pull / webhook Meta — CPU contínua (latência inbox).
gcloud run services update flux-farma-orchestrator `
  --project=$ProjectId `
  --region=$Region `
  --min-instances=1 `
  --no-cpu-throttling

# Campaign: scale to zero quando sem campanhas ativas.
gcloud run services update flux-farma-campaign `
  --project=$ProjectId `
  --region=$Region `
  --min-instances=0 `
  --cpu-throttling

# Webhook: min=1 + cpu-throttling — ACK Meta com instância quente; CPU idle mais barato (~R$ 200/mês).
gcloud run services update flux-farma-webhook `
  --project=$ProjectId `
  --region=$Region `
  --min-instances=1 `
  --cpu-throttling

Write-Host "Perfil piloto aplicado. Valide: .\scripts\gcp\verify-run-scaling.ps1"
