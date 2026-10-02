$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $repoRoot ".run-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Stop-ServiceByName {
  param([string]$Name, [int]$Port)

  $pidFile = Join-Path $logDir "$Name.pid"
  if (Test-Path $pidFile) {
    $targetPid = [int](Get-Content $pidFile | Select-Object -First 1)
    if ($targetPid -gt 0) {
      try {
        Stop-Process -Id $targetPid -Force -ErrorAction Stop
        Write-Host "Parado PID $targetPid ($Name)"
      } catch {
        cmd /c "taskkill /PID $targetPid /F" | Out-Null
      }
    }
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
  }

  $lines = cmd /c "netstat -ano -p TCP | findstr :$Port"
  foreach ($line in $lines) {
    if ($line -match "LISTENING\s+(\d+)\s*$") {
      $p = [int]$Matches[1]
      if ($p -gt 0) {
        try {
          Stop-Process -Id $p -Force -ErrorAction SilentlyContinue
          Write-Host "Parado listener porta $Port PID $p"
        } catch {}
      }
    }
  }
}

function Start-DaemonService {
  param([string]$Name, [string]$CmdLine)

  $outLog = Join-Path $logDir "$Name.out.log"
  $errLog = Join-Path $logDir "$Name.err.log"
  $pidFile = Join-Path $logDir "$Name.pid"

  Write-Host "Iniciando $Name ..."
  $p = Start-Process -FilePath "cmd.exe" -WorkingDirectory $repoRoot -ArgumentList @("/c", $CmdLine) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
  Set-Content -Path $pidFile -Value $p.Id
  Write-Host "$Name PID $($p.Id)"
  return $p.Id
}

Write-Host "== Reiniciando api-service e scheduler-service =="
Stop-ServiceByName -Name "api-service" -Port 3001
Stop-ServiceByName -Name "scheduler-service" -Port 3004

$apiCmdLine = "cd /d `"$repoRoot`" && set PORT=3001 && npm -w apps/api-service run dev"
$schCmdLine = "cd /d `"$repoRoot`" && set PORT=3004 && npm -w apps/scheduler-service run start"

Start-DaemonService -Name "api-service" -CmdLine $apiCmdLine | Out-Null
Start-DaemonService -Name "scheduler-service" -CmdLine $schCmdLine | Out-Null

Start-Sleep -Seconds 8

$apiUp = (cmd /c "netstat -ano -p TCP | findstr :3001") -match "LISTENING"
$schUp = (cmd /c "netstat -ano -p TCP | findstr :3004") -match "LISTENING"

Write-Host ""
Write-Host "api-service (3001): $(if ($apiUp) { 'OK' } else { 'NAO RESPONDEU' })"
Write-Host "scheduler-service (3004): $(if ($schUp) { 'OK' } else { 'NAO RESPONDEU' })"
Write-Host "Logs: $logDir"

if (-not $apiUp -or -not $schUp) { exit 1 }
