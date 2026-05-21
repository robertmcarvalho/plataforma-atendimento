param(
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
Write-Host "API : http://localhost:$ApiPort (dev)"
Write-Host "WEB : http://localhost:$WebPort (dev)"
Write-Host "WHK : http://localhost:$WebhookPort (dev)"
Write-Host "ORC : http://localhost:$OrchestratorPort (dev)"
Write-Host "SCH : http://localhost:$SchedulerPort (dev)"
Write-Host "CMP : http://localhost:$CampaignPort (dev)"

function Start-BackgroundService {
  param(
    [string]$Name,
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

function Wait-PortListening {
  param(
    [int]$Port,
    [string]$Name,
    [int]$TimeoutSeconds = 30
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $hit = cmd /c "netstat -ano -p TCP | findstr :$Port"
    if ($hit -and ($hit -match "LISTENING")) { return $true }
    Start-Sleep -Milliseconds 500
  }

  Write-Host ""
  Write-Host "ERRO: $Name nao iniciou na porta $Port."
  Write-Host "Veja logs em: $logDir"
  return $false
}

Write-Host "`n== Starting api-service (dev) =="
$apiCmdLine = "cd /d `"$repoRoot`" && set PORT=$ApiPort && npm -w apps/api-service run dev"
Start-BackgroundService -Name "api-service" -WorkDir $repoRoot -CmdLine $apiCmdLine

Write-Host "== Starting webhook-service (dev) =="
$webhookCmdLine = "cd /d `"$repoRoot`" && set PORT=$WebhookPort && npm -w apps/webhook-service run dev"
Start-BackgroundService -Name "webhook-service" -WorkDir $repoRoot -CmdLine $webhookCmdLine

Write-Host "== Starting orchestrator-service (dev) =="
$orcCmdLine = "cd /d `"$repoRoot`" && set PORT=$OrchestratorPort && npm -w apps/orchestrator-service run dev"
Start-BackgroundService -Name "orchestrator-service" -WorkDir $repoRoot -CmdLine $orcCmdLine

Write-Host "== Starting scheduler-service (dev) =="
$schCmdLine = "cd /d `"$repoRoot`" && set PORT=$SchedulerPort && npm -w apps/scheduler-service run dev"
Start-BackgroundService -Name "scheduler-service" -WorkDir $repoRoot -CmdLine $schCmdLine

Write-Host "== Starting campaign-worker (dev) =="
$cmpCmdLine = "cd /d `"$repoRoot`" && set PORT=$CampaignPort && npm -w apps/campaign-worker run dev"
Start-BackgroundService -Name "campaign-worker" -WorkDir $repoRoot -CmdLine $cmpCmdLine

if (-not (Wait-PortListening -Port $ApiPort -Name "api-service" -TimeoutSeconds 35)) { exit 1 }
if (-not (Wait-PortListening -Port $WebhookPort -Name "webhook-service" -TimeoutSeconds 35)) { exit 1 }
if (-not (Wait-PortListening -Port $OrchestratorPort -Name "orchestrator-service" -TimeoutSeconds 35)) { exit 1 }
if (-not (Wait-PortListening -Port $SchedulerPort -Name "scheduler-service" -TimeoutSeconds 35)) { exit 1 }
if (-not (Wait-PortListening -Port $CampaignPort -Name "campaign-worker" -TimeoutSeconds 35)) { exit 1 }

Write-Host "`nBackends prontos (dev)."
Write-Host "API : http://localhost:$ApiPort/health"
Write-Host ""
Write-Host "== Starting web (dev) =="
Write-Host "  http://localhost:$WebPort/login"
Write-Host "  http://localhost:$WebPort/inbox"
Write-Host ""
Write-Host "Dica debug Drawer:"
Write-Host "  http://localhost:$WebPort/drivers?debug_drawer=1"
Write-Host "  http://localhost:$WebPort/pharmacies?debug_drawer=1"
Write-Host "  http://localhost:$WebPort/leaders?debug_drawer=1"
Write-Host ""
Write-Host "Observacao:"
Write-Host "  Em alguns Windows/OneDrive/antivirus, o Next dev nao fica ativo quando iniciado como 'daemon' com stdout redirecionado."
Write-Host "  Por isso o web roda em foreground neste terminal. Para parar: Ctrl+C, depois rode: npm run stop:local"
Write-Host ""

Push-Location $repoRoot
try {
  $env:PORT = "$WebPort"
  $env:NEXT_PUBLIC_API_URL = "http://localhost:$ApiPort"
  npm -w apps/web run dev
} finally {
  Pop-Location
}
