param(
  [switch]$SkipBuild = $false,
  [int]$ApiPort = 3001,
  [int]$WebPort = 3000,
  [int]$WebhookPort = 3002,
  [int]$OrchestratorPort = 3003,
  [int]$SchedulerPort = 3004,
  [int]$CampaignPort = 3005,
  [ValidateSet('daemon', 'windows')][string]$Mode = 'daemon'
)

$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $repoRoot ".run-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Write-Host "Repo: $repoRoot"
Write-Host "API : http://localhost:$ApiPort"
Write-Host "WEB : http://localhost:$WebPort"
Write-Host "WHK : http://localhost:$WebhookPort"
Write-Host "ORC : http://localhost:$OrchestratorPort"
Write-Host "SCH : http://localhost:$SchedulerPort"
Write-Host "CMP : http://localhost:$CampaignPort"

function Assert-PathOrExplain([string]$Label, [string]$PathToCheck, [string]$BuildHint) {
  if (Test-Path $PathToCheck) { return $true }
  Write-Host ""
  Write-Host "ERRO: $Label nao encontrado:"
  Write-Host "  $PathToCheck"
  Write-Host ""
  Write-Host $BuildHint
  return $false
}

$apiDist = Join-Path $repoRoot "apps\\api-service\\dist\\index.js"
$webhookDist = Join-Path $repoRoot "apps\\webhook-service\\dist\\index.js"
$orcDist = Join-Path $repoRoot "apps\\orchestrator-service\\dist\\index.js"
$schDist = Join-Path $repoRoot "apps\\scheduler-service\\dist\\index.js"
$cmpDist = Join-Path $repoRoot "apps\\campaign-worker\\dist\\index.js"
$webBuildId = Join-Path $repoRoot "apps\\web\\.next_local\\BUILD_ID"
$webPrerenderManifest = Join-Path $repoRoot "apps\\web\\.next_local\\prerender-manifest.json"

if (-not $SkipBuild) {
  Write-Host "`n== Build api-service =="
  Push-Location $repoRoot
  try {
    npm -w apps/api-service run build
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ERRO: build do api-service falhou."
      Write-Host "Dica: rode: npm -w apps/api-service run build"
      exit 1
    }
  } finally {
    Pop-Location
  }

  Write-Host "`n== Build webhook-service =="
  Push-Location $repoRoot
  try {
    npm -w apps/webhook-service run build
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ERRO: build do webhook-service falhou."
      Write-Host "Dica: rode: npm -w apps/webhook-service run build"
      exit 1
    }
  } finally {
    Pop-Location
  }

  Write-Host "`n== Build orchestrator-service =="
  Push-Location $repoRoot
  try {
    npm -w apps/orchestrator-service run build
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ERRO: build do orchestrator-service falhou."
      Write-Host "Dica: rode: npm -w apps/orchestrator-service run build"
      exit 1
    }
  } finally {
    Pop-Location
  }

  Write-Host "`n== Build scheduler-service =="
  Push-Location $repoRoot
  try {
    npm -w apps/scheduler-service run build
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ERRO: build do scheduler-service falhou."
      Write-Host "Dica: rode: npm -w apps/scheduler-service run build"
      exit 1
    }
  } finally {
    Pop-Location
  }

  Write-Host "`n== Build campaign-worker =="
  Push-Location $repoRoot
  try {
    npm -w apps/campaign-worker run build
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ERRO: build do campaign-worker falhou."
      Write-Host "Dica: rode: npm -w apps/campaign-worker run build"
      exit 1
    }
  } finally {
    Pop-Location
  }

  Write-Host "`n== Build web =="
  Push-Location $repoRoot
  try {
    npm -w apps/web run build
    if ($LASTEXITCODE -ne 0) {
      Write-Host ""
      Write-Host "ERRO: build do web falhou."
      Write-Host ""
      Write-Host "Se isso for 'spawn EPERM' no Windows/OneDrive/antivirus, use o modo dev local:"
      Write-Host "  npm run dev:local"
      Write-Host ""
      Write-Host "Ou rode o repo fora do OneDrive e tente novamente."
      exit 1
    }
  } finally {
    Pop-Location
  }
} else {
  # In SkipBuild mode, fail fast if required artifacts are missing.
  if (-not (Assert-PathOrExplain "api-service dist" $apiDist "Rode: npm -w apps/api-service run build")) { exit 1 }
  if (-not (Assert-PathOrExplain "webhook-service dist" $webhookDist "Rode: npm -w apps/webhook-service run build")) { exit 1 }
  if (-not (Assert-PathOrExplain "orchestrator-service dist" $orcDist "Rode: npm -w apps/orchestrator-service run build")) { exit 1 }
  if (-not (Assert-PathOrExplain "scheduler-service dist" $schDist "Rode: npm -w apps/scheduler-service run build")) { exit 1 }
  if (-not (Assert-PathOrExplain "campaign-worker dist" $cmpDist "Rode: npm -w apps/campaign-worker run build")) { exit 1 }
  if (-not (Assert-PathOrExplain "web build" $webBuildId "Rode: npm -w apps/web run build")) { exit 1 }
  if (-not (Test-Path $webPrerenderManifest)) {
    Write-Host "Aviso: prerender-manifest.json ausente. Gerando manifesto minimo para permitir next start."
    Push-Location $repoRoot
    try {
      node scripts\\ensure-web-prerender-manifest.mjs | Out-Host
    } finally {
      Pop-Location
    }
  }
}

function Start-BackgroundService {
  param(
    [string]$Name,
    [int]$Port,
    [string]$WorkDir,
    [string]$CmdLine
  )

  $outLog = Join-Path $logDir "$Name.out.log"
  $errLog = Join-Path $logDir "$Name.err.log"
  $pidFile = Join-Path $logDir "$Name.pid"

  if ($Mode -eq 'windows') {
    Write-Host "Starting $Name (new window) ..."
    Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoExit", "-Command", $CmdLine) | Out-Null
    return
  }

  Write-Host "Starting $Name (daemon) ..."
  $p = Start-Process -FilePath "cmd.exe" -WorkingDirectory $WorkDir -ArgumentList @("/c", $CmdLine) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  Set-Content -Path $pidFile -Value $p.Id
}

function Assert-PortListening {
  param([int]$Port, [string]$Name)
  $hit = cmd /c "netstat -ano | findstr :$Port"
  if (-not $hit) {
    Write-Host ""
    Write-Host "ERRO: $Name nao iniciou na porta $Port."
    Write-Host "Veja logs em: $logDir"
    return $false
  }
  return $true
}

function Wait-PortListening {
  param(
    [int]$Port,
    [string]$Name,
    [int]$TimeoutSeconds = 25
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $hit = cmd /c "netstat -ano -p TCP | findstr :$Port"
    if ($hit -and ($hit -match "LISTENING")) { return $true }
    Start-Sleep -Milliseconds 500
  }

  return (Assert-PortListening -Port $Port -Name $Name)
}

Write-Host "`n== Starting api-service =="
$apiCmdLine = "cd /d `"$repoRoot`" && set PORT=$ApiPort && npm -w apps/api-service run start"
Start-BackgroundService -Name "api-service" -Port $ApiPort -WorkDir $repoRoot -CmdLine $apiCmdLine

Write-Host "== Starting webhook-service =="
$webhookCmdLine = "cd /d `"$repoRoot`" && set PORT=$WebhookPort && npm -w apps/webhook-service run start"
Start-BackgroundService -Name "webhook-service" -Port $WebhookPort -WorkDir $repoRoot -CmdLine $webhookCmdLine

Write-Host "== Starting orchestrator-service =="
$orcCmdLine = "cd /d `"$repoRoot`" && set PORT=$OrchestratorPort && npm -w apps/orchestrator-service run start"
Start-BackgroundService -Name "orchestrator-service" -Port $OrchestratorPort -WorkDir $repoRoot -CmdLine $orcCmdLine

Write-Host "== Starting scheduler-service =="
$schCmdLine = "cd /d `"$repoRoot`" && set PORT=$SchedulerPort && npm -w apps/scheduler-service run start"
Start-BackgroundService -Name "scheduler-service" -Port $SchedulerPort -WorkDir $repoRoot -CmdLine $schCmdLine

Write-Host "== Starting campaign-worker =="
$cmpCmdLine = "cd /d `"$repoRoot`" && set PORT=$CampaignPort && npm -w apps/campaign-worker run start"
Start-BackgroundService -Name "campaign-worker" -Port $CampaignPort -WorkDir $repoRoot -CmdLine $cmpCmdLine

Write-Host "== Starting web =="
$webCmdLine = "cd /d `"$repoRoot`" && set PORT=$WebPort && npm -w apps/web run start"
Start-BackgroundService -Name "web" -Port $WebPort -WorkDir $repoRoot -CmdLine $webCmdLine

if (-not (Wait-PortListening -Port $ApiPort -Name "api-service" -TimeoutSeconds 25)) { exit 1 }
if (-not (Wait-PortListening -Port $WebhookPort -Name "webhook-service" -TimeoutSeconds 25)) { exit 1 }
if (-not (Wait-PortListening -Port $OrchestratorPort -Name "orchestrator-service" -TimeoutSeconds 25)) { exit 1 }
if (-not (Wait-PortListening -Port $SchedulerPort -Name "scheduler-service" -TimeoutSeconds 25)) { exit 1 }
if (-not (Wait-PortListening -Port $CampaignPort -Name "campaign-worker" -TimeoutSeconds 25)) { exit 1 }
if (-not (Wait-PortListening -Port $WebPort -Name "web" -TimeoutSeconds 25)) { exit 1 }

Write-Host "`nPronto. Abra:"
Write-Host "  http://localhost:$WebPort/login"
Write-Host "  http://localhost:$WebPort/inbox"
