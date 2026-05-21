param(
  [int[]]$Ports = @(3000, 3001, 3002, 3003, 3004, 3005)
)

$ErrorActionPreference = "Stop"

function Stop-PidFile {
  param([string]$Name)
  $repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $pidFile = Join-Path $repoRoot ".run-logs\\$Name.pid"
  if (-not (Test-Path $pidFile)) { return }
  try {
    $targetPid = [int](Get-Content $pidFile -ErrorAction Stop | Select-Object -First 1)
    if ($targetPid -gt 0) {
      try {
        $p = Get-Process -Id $targetPid -ErrorAction Stop
        Write-Host "Stopping PID $targetPid ($($p.ProcessName)) from $Name.pid"
        try {
          Stop-Process -Id $targetPid -Force -ErrorAction Stop
        } catch {
          Write-Host "Stop-Process denied for PID $targetPid. Trying taskkill /F ..."
          cmd /c "taskkill /PID $targetPid /F" | Out-Null
        }
      } catch {
        Write-Host "PID $targetPid from $Name.pid not running"
      }
    }
  } finally {
    Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
  }
}

function Stop-PortListeners {
  param([int]$Port)

  $pids = @()
  try {
    $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop
    if ($conns) {
      $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    }
  } catch {
    # Some environments deny access to Get-NetTCPConnection without elevation.
    # Fallback to parsing netstat output (works in standard PowerShell).
    $lines = cmd /c "netstat -ano -p TCP | findstr :$Port"
    foreach ($line in $lines) {
      if ($line -match "LISTENING\s+(\d+)\s*$") {
        $pids += [int]$Matches[1]
      }
    }
    $pids = $pids | Select-Object -Unique
  }

  if (-not $pids -or $pids.Count -eq 0) {
    Write-Host "Port ${Port}: no LISTEN process found"
    return
  }

  foreach ($targetPid in $pids) {
    if ($targetPid -le 0) { continue }
    try {
      $p = Get-Process -Id $targetPid -ErrorAction Stop
      Write-Host "Stopping PID $targetPid ($($p.ProcessName)) listening on $Port"
      try {
        Stop-Process -Id $targetPid -Force -ErrorAction Stop
      } catch {
        Write-Host "Stop-Process denied for PID $targetPid on port $Port. Trying taskkill /F ..."
        cmd /c "taskkill /PID $targetPid /F" | Out-Null
      }
    } catch {
      Write-Host "Failed to stop PID ${targetPid} on port ${Port}: $($_.Exception.Message)"
    }
  }
}

Stop-PidFile -Name "web"
Stop-PidFile -Name "api-service"
Stop-PidFile -Name "webhook-service"
Stop-PidFile -Name "orchestrator-service"
Stop-PidFile -Name "scheduler-service"
Stop-PidFile -Name "campaign-worker"

foreach ($p in $Ports) { Stop-PortListeners -Port $p }
