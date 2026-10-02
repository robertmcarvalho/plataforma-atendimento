# Teste de economia: webhook com min=1 + cpu-throttling (idle ~80% mais barato).
# NAO altera scheduler/orchestrator (precisam CPU 24h).
#
# Dry-run por padrao. Execute apos validar latencia ACK Meta:
#   $env:CONFIRM_WEBHOOK_CPU_THROTTLE="true"
#   .\scripts\gcp\optimize-webhook-cost-pilot.ps1 -Execute
#
# Reverter:
#   gcloud run services update flux-farma-webhook --no-cpu-throttling ...

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [switch]$Execute
)

if (-not $ProjectId) { throw "Set GCP_PROJECT_ID" }

$confirm = $env:CONFIRM_WEBHOOK_CPU_THROTTLE -eq "true"
if ($Execute -and -not $confirm) {
  throw "Defina CONFIRM_WEBHOOK_CPU_THROTTLE=true para executar"
}

$current = gcloud run services describe flux-farma-webhook --project=$ProjectId --region=$Region --format=json | ConvertFrom-Json
$thr = $current.spec.template.metadata.annotations.'run.googleapis.com/cpu-throttling'
$min = $current.spec.template.metadata.annotations.'autoscaling.knative.dev/minScale'

Write-Host "flux-farma-webhook atual: min=$min throttle=$thr"
Write-Host "Proposta: min=1 + --cpu-throttling (economia estimada ~US$ 35-40/mes vs CPU 24h)"
Write-Host "Risco: latencia no cold path / ACK Meta — monitorar apos aplicar."

if (-not $Execute) {
  Write-Host "`nDry-run. Para aplicar:"
  Write-Host '  $env:CONFIRM_WEBHOOK_CPU_THROTTLE="true"'
  Write-Host "  .\scripts\gcp\optimize-webhook-cost-pilot.ps1 -Execute"
  exit 0
}

gcloud run services update flux-farma-webhook `
  --project=$ProjectId `
  --region=$Region `
  --min-instances=1 `
  --cpu-throttling

Write-Host "Webhook atualizado. Valide webhook Meta e latencia de ACK nas proximas horas."
