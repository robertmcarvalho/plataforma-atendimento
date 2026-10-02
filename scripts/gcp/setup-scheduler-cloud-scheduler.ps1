# Cria/atualiza jobs Cloud Scheduler para flux-farma-scheduler (HTTP /jobs/*).
# Requer deploy da imagem com SCHEDULER_USE_CLOUD_SCHEDULER=true.
#
# Usage:
#   $env:GCP_PROJECT_ID = "rh-coopmob-bot"
#   .\scripts\gcp\setup-scheduler-cloud-scheduler.ps1

param(
  [string]$ProjectId = $env:GCP_PROJECT_ID,
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$JobToken = $env:SCHEDULER_JOB_TOKEN,
  [string]$RunServiceAccount = $(if ($env:GCP_RUN_SERVICE_ACCOUNT) { $env:GCP_RUN_SERVICE_ACCOUNT } else { "713561463013-compute@developer.gserviceaccount.com" }),
  [string]$SecretName = 'scheduler-job-token',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
if (-not $ProjectId) { throw 'Set GCP_PROJECT_ID' }

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$tokenReport = Join-Path $repoRoot 'reports\scheduler-cloud-scheduler-token.txt'

function Set-SecretValue([string]$Name, [string]$Value) {
  if (-not $Value) { throw "Empty value for secret $Name" }
  $exists = $false
  cmd /c "gcloud secrets describe $Name --project=$ProjectId 2>nul" | Out-Null
  if ($LASTEXITCODE -eq 0) { $exists = $true }

  $tmp = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tmp, $Value, [System.Text.UTF8Encoding]::new($false))
    if ($exists) {
      cmd /c "gcloud secrets versions add $Name --data-file=`"$tmp`" --project=$ProjectId" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "gcloud secrets versions add failed for $Name" }
      Write-Host "[secret] updated: $Name"
    } else {
      cmd /c "gcloud secrets create $Name --data-file=`"$tmp`" --project=$ProjectId --replication-policy=automatic" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "gcloud secrets create failed for $Name" }
      Write-Host "[secret] created: $Name"
    }
  } finally {
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
  }

  cmd /c "gcloud secrets add-iam-policy-binding $Name --project=$ProjectId --member=serviceAccount:$RunServiceAccount --role=roles/secretmanager.secretAccessor --quiet" | Out-Null
}

function Test-SchedulerJobExists([string]$JobId) {
  $prev = $ErrorActionPreference
  $ErrorActionPreference = 'SilentlyContinue'
  $out = gcloud scheduler jobs describe $JobId --location=$Region --project=$ProjectId 2>&1
  $ErrorActionPreference = $prev
  return $LASTEXITCODE -eq 0
}

$schedulerUrl = gcloud run services describe flux-farma-scheduler --project=$ProjectId --region=$Region --format='value(status.url)'
if (-not $schedulerUrl) { throw 'URL do scheduler nao encontrada' }

$jobDefs = @(
  @{ id = 'flux-scheduler-tick-minute'; schedule = '* * * * *'; path = 'tick-minute' },
  @{ id = 'flux-scheduler-tick-2min'; schedule = '*/2 * * * *'; path = 'tick-2min' },
  @{ id = 'flux-scheduler-tick-5min'; schedule = '*/5 * * * *'; path = 'tick-5min' },
  @{ id = 'flux-scheduler-financial-overdue'; schedule = '5 0 * * *'; path = 'financial-overdue' },
  @{ id = 'flux-scheduler-installment-weekly'; schedule = '0 8 * * 1'; path = 'installment-weekly' },
  @{ id = 'flux-scheduler-webhook-cleanup'; schedule = '0 3 * * 0'; path = 'webhook-cleanup' },
  @{ id = 'flux-scheduler-tickets-daily-report'; schedule = '0 18 * * *'; path = 'tickets-daily-report' },
  @{ id = 'flux-scheduler-driver-doc-expiry'; schedule = '15 6 * * *'; path = 'driver-doc-expiry' },
  @{ id = 'flux-scheduler-signature-sync'; schedule = '*/15 * * * *'; path = 'signature-sync' },
  @{ id = 'flux-scheduler-signature-deadline'; schedule = '30 7 * * *'; path = 'signature-deadline' },
  @{ id = 'flux-scheduler-flux-driver-sync'; schedule = '0 */6 * * *'; path = 'flux-driver-sync' },
  @{ id = 'flux-scheduler-flux-delivery-sync'; schedule = '30 6 * * *'; path = 'flux-delivery-sync' },
  @{ id = 'flux-scheduler-commercial-scoring'; schedule = '*/30 * * * *'; path = 'commercial-scoring' },
  @{ id = 'flux-scheduler-cora-statement-sync'; schedule = '0 18 * * 1-5'; path = 'cora-statement-sync' },
  @{ id = 'flux-scheduler-orchestrator-night-off'; schedule = '0 22 * * *'; path = 'orchestrator-night-off' },
  @{ id = 'flux-scheduler-orchestrator-night-warmup'; schedule = '55 5 * * *'; path = 'orchestrator-night-warmup' },
  @{ id = 'flux-scheduler-orchestrator-night-on'; schedule = '0 6 * * *'; path = 'orchestrator-night-on' }
)

if ($Remove) {
  foreach ($job in $jobDefs) {
    gcloud scheduler jobs delete $job.id --location=$Region --project=$ProjectId --quiet 2>$null
    Write-Host "Removido (se existia): $($job.id)"
  }
  Write-Host 'Cloud Scheduler jobs removidos.'
  exit 0
}

if (-not $JobToken -and (Test-Path $tokenReport)) {
  $line = Get-Content $tokenReport | Select-String '^token='
  if ($line) { $JobToken = $line.ToString().Replace('token=', '').Trim() }
}

if (-not $JobToken) {
  $bytes = New-Object byte[] 32
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
  $JobToken = [Convert]::ToBase64String($bytes) -replace '[+/=]', 'x'
}

New-Item -ItemType Directory -Force -Path (Split-Path $tokenReport) | Out-Null
Set-Content -Path $tokenReport -Value "generated_at=$(Get-Date -Format o)`ntoken=$JobToken`nsecret=$SecretName`n" -Encoding utf8
Write-Host "Token salvo em reports/scheduler-cloud-scheduler-token.txt (nao versionar)" -ForegroundColor Yellow

Write-Host "=== Secret Manager: $SecretName ===" -ForegroundColor Cyan
Set-SecretValue -Name $SecretName -Value $JobToken

Write-Host "=== Setup Cloud Scheduler -> $schedulerUrl ===" -ForegroundColor Cyan

gcloud run services update flux-farma-scheduler `
  --project=$ProjectId `
  --region=$Region `
  --update-env-vars=SCHEDULER_USE_CLOUD_SCHEDULER=true `
  --update-secrets="SCHEDULER_JOB_TOKEN=${SecretName}:latest" `
  --remove-env-vars=SCHEDULER_JOB_TOKEN `
  --min-instances=0 `
  --cpu-throttling `
  --quiet
if ($LASTEXITCODE -ne 0) { throw 'Falha ao atualizar scheduler' }

foreach ($job in $jobDefs) {
  $uri = "$schedulerUrl/jobs/$($job.path)"
  $headers = "X-Scheduler-Token=$JobToken"

  $exists = Test-SchedulerJobExists $job.id

  if ($exists) {
    gcloud scheduler jobs update http $job.id `
      --project=$ProjectId `
      --location=$Region `
      --schedule="$($job.schedule)" `
      --time-zone="America/Sao_Paulo" `
      --uri=$uri `
      --http-method=POST `
      --update-headers=$headers `
      --quiet
    Write-Host "[update] $($job.id) -> $($job.schedule)"
  } else {
    gcloud scheduler jobs create http $job.id `
      --project=$ProjectId `
      --location=$Region `
      --schedule="$($job.schedule)" `
      --time-zone="America/Sao_Paulo" `
      --uri=$uri `
      --http-method=POST `
      --headers=$headers `
      --quiet
    Write-Host "[create] $($job.id) -> $($job.schedule)"
  }
  if ($LASTEXITCODE -ne 0) { throw "Falha no job $($job.id)" }
}

Write-Host "`nCloud Scheduler configurado ($($jobDefs.Count) jobs)." -ForegroundColor Green
Write-Host "Valide: GET $schedulerUrl/health"
Write-Host "Token: Secret Manager '$SecretName' (Cloud Run) + header X-Scheduler-Token nos jobs."
Write-Host "Re-run sem rotacionar: `$env:SCHEDULER_JOB_TOKEN = (Get-Content reports\scheduler-cloud-scheduler-token.txt | Select-String '^token=').ToString().Replace('token=','').Trim()"
