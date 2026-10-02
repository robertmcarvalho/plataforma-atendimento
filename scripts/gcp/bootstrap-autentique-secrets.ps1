# Cria/atualiza secrets Autentique no GCP Secret Manager e referencia no Cloud Run (API + scheduler).
param(
  [string]$ProjectId = $(if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "rh-coopmob-bot" }),
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$ApiKeyFile = $(if ($env:AUTENTIQUE_API_KEY_FILE) { $env:AUTENTIQUE_API_KEY_FILE } else { "" }),
  [string]$WebhookSecretFile = $(if ($env:AUTENTIQUE_WEBHOOK_SECRET_FILE) { $env:AUTENTIQUE_WEBHOOK_SECRET_FILE } else { "" })
)

$ErrorActionPreference = "Stop"
$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")

if (-not $ApiKeyFile) {
  $defaultKey = Join-Path $repoRoot ".secrets\autentique-api-key.txt"
  if (Test-Path $defaultKey) { $ApiKeyFile = $defaultKey }
}
if (-not $WebhookSecretFile) {
  $defaultWh = Join-Path $repoRoot ".secrets\autentique-webhook-secret.txt"
  if (Test-Path $defaultWh) { $WebhookSecretFile = $defaultWh }
}
if (-not $ApiKeyFile -or -not (Test-Path $ApiKeyFile)) {
  throw "Defina AUTENTIQUE_API_KEY_FILE ou crie .secrets/autentique-api-key.txt"
}

function Set-SecretFromFile([string]$Name, [string]$FilePath) {
  $exists = $false
  cmd /c "gcloud secrets describe $Name --project=$ProjectId 2>nul" | Out-Null
  if ($LASTEXITCODE -eq 0) { $exists = $true }
  if ($exists) {
    cmd /c "gcloud secrets versions add $Name --data-file=`"$FilePath`" --project=$ProjectId"
  } else {
    cmd /c "gcloud secrets create $Name --data-file=`"$FilePath`" --project=$ProjectId --replication-policy=automatic"
  }
  if ($LASTEXITCODE -ne 0) { throw "Falha ao gravar secret $Name" }
  Write-Host "OK secret: $Name"
}

Set-SecretFromFile -Name "autentique-api-key" -FilePath $ApiKeyFile

if ($WebhookSecretFile -and (Test-Path $WebhookSecretFile)) {
  Set-SecretFromFile -Name "autentique-webhook-secret" -FilePath $WebhookSecretFile
} else {
  Write-Host "AVISO: AUTENTIQUE_WEBHOOK_SECRET não atualizado (arquivo ausente)."
}

$runSa = "713561463013-compute@developer.gserviceaccount.com"
foreach ($secret in @("autentique-api-key", "autentique-webhook-secret")) {
  cmd /c "gcloud secrets describe $secret --project=$ProjectId 2>nul" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    cmd /c "gcloud secrets add-iam-policy-binding $secret --project=$ProjectId --member=serviceAccount:$runSa --role=roles/secretmanager.secretAccessor --quiet" | Out-Null
  }
}

$apiSecrets = @(
  "SUPABASE_URL=supabase-url:latest",
  "SUPABASE_SERVICE_ROLE_KEY=supabase-sr:latest",
  "JWT_SECRET=jwt-secret:latest",
  "INTEGRATIONS_ENCRYPTION_KEY=integrations-encryption-key:latest",
  "LEADER_WHATSAPP_OTP_SECRET=leader-whatsapp-otp-secret:latest",
  "META_ACCESS_TOKEN=meta-access-token:latest",
  "META_VERIFY_TOKEN=meta-verify-token:latest",
  "META_PHONE_NUMBER_ID=meta-phone-number-id:latest",
  "META_APP_ID=meta-app-id:latest",
  "META_GRAPH_APP_ACCESS_TOKEN=meta-graph-app-access-token:latest",
  "GOOGLE_API_KEY=google-api-key:latest",
  "SMTP_PASS=smtp-pass:latest",
  "AUTENTIQUE_API_KEY=autentique-api-key:latest",
  "AUTENTIQUE_WEBHOOK_SECRET=autentique-webhook-secret:latest",
  "FLUX_DELIVERY_OAUTH_CLIENT_SECRET=flux-delivery-oauth-client-secret:latest",
  "FLUX_DELIVERY_USERNAME=flux-delivery-username:latest",
  "FLUX_DELIVERY_PASSWORD=flux-delivery-password:latest",
  "FLUX_MYSQL_PASSWORD=flux-mysql-password:latest"
) -join ","

$schedulerSecrets = @(
  "SUPABASE_URL=supabase-url:latest",
  "SUPABASE_SERVICE_ROLE_KEY=supabase-sr:latest",
  "FLUX_DELIVERY_OAUTH_CLIENT_SECRET=flux-delivery-oauth-client-secret:latest",
  "FLUX_DELIVERY_USERNAME=flux-delivery-username:latest",
  "FLUX_DELIVERY_PASSWORD=flux-delivery-password:latest",
  "AUTENTIQUE_API_KEY=autentique-api-key:latest",
  "SCHEDULER_JOB_TOKEN=scheduler-job-token:latest"
) -join ","

$envFile = Join-Path $repoRoot ".cloud-env-api-production.yaml"
if (-not (Test-Path $envFile)) { throw "Missing $envFile" }

Write-Host "Atualizando flux-farma-api..."
cmd /c "gcloud run services update flux-farma-api --project=$ProjectId --region=$Region --set-secrets=$apiSecrets --env-vars-file=$envFile --quiet"

Write-Host "Atualizando flux-farma-scheduler..."
cmd /c "gcloud run services update flux-farma-scheduler --project=$ProjectId --region=$Region --update-secrets=$schedulerSecrets --quiet"

Write-Host "Concluído. Verifique variáveis em: gcloud run services describe flux-farma-api --region=$Region --format=json"
