# Bootstrap Secret Manager from current Cloud Run env + rotate JWT/OTP keys.
# Does not print secret values. Requires gcloud auth.
param(
  [string]$ProjectId = $(if ($env:GCP_PROJECT_ID) { $env:GCP_PROJECT_ID } else { "rh-coopmob-bot" }),
  [string]$Region = $(if ($env:GCP_REGION) { $env:GCP_REGION } else { "us-central1" }),
  [string]$ServiceName = "flux-farma-api",
  [string]$RunServiceAccount = "713561463013-compute@developer.gserviceaccount.com"
)

$ErrorActionPreference = "Stop"

function New-RandomSecret([int]$Bytes = 32) {
  $buf = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buf)
  return [Convert]::ToBase64String($buf)
}

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
      Write-Host "Updated secret: $Name"
    } else {
      cmd /c "gcloud secrets create $Name --data-file=`"$tmp`" --project=$ProjectId --replication-policy=automatic" | Out-Null
      if ($LASTEXITCODE -ne 0) { throw "gcloud secrets create failed for $Name" }
      Write-Host "Created secret: $Name"
    }
  } finally {
    Remove-Item -Force $tmp -ErrorAction SilentlyContinue
  }

  cmd /c "gcloud secrets add-iam-policy-binding $Name --project=$ProjectId --member=serviceAccount:$RunServiceAccount --role=roles/secretmanager.secretAccessor --quiet" | Out-Null
}

Write-Host "Reading env from Cloud Run service $ServiceName..."
$json = gcloud run services describe $ServiceName --region=$Region --project=$ProjectId --format=json | ConvertFrom-Json
$map = @{}
foreach ($item in $json.spec.template.spec.containers[0].env) {
  if ($item.value) { $map[$item.name] = [string]$item.value }
}

$jwt = New-RandomSecret 48
$otp = New-RandomSecret 32
$integrations = if ($map["INTEGRATIONS_ENCRYPTION_KEY"]) { $map["INTEGRATIONS_ENCRYPTION_KEY"] } else { New-RandomSecret 32 }

$bindings = @{
  "supabase-url" = $map["SUPABASE_URL"]
  "supabase-sr" = $map["SUPABASE_SERVICE_ROLE_KEY"]
  "jwt-secret" = $jwt
  "integrations-encryption-key" = $integrations
  "leader-whatsapp-otp-secret" = $otp
  "meta-access-token" = $map["META_ACCESS_TOKEN"]
  "meta-verify-token" = $map["META_VERIFY_TOKEN"]
  "meta-phone-number-id" = $map["META_PHONE_NUMBER_ID"]
  "meta-app-id" = $map["META_APP_ID"]
  "meta-graph-app-access-token" = $map["META_GRAPH_APP_ACCESS_TOKEN"]
  "google-api-key" = $map["GOOGLE_API_KEY"]
}

foreach ($entry in $bindings.GetEnumerator()) {
  Set-SecretValue -Name $entry.Key -Value $entry.Value
}

Write-Host "Done. JWT and LEADER_WHATSAPP_OTP_SECRET were rotated. Re-deploy API with deploy-production-api.ps1"
