$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$logDir = Join-Path $repoRoot ".run-logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$pidFile = Join-Path $logDir "web.pid"
if (Test-Path $pidFile) {
  $old = [int](Get-Content $pidFile | Select-Object -First 1)
  if ($old -gt 0) {
    try { Stop-Process -Id $old -Force -ErrorAction Stop } catch {}
  }
  Remove-Item -Force $pidFile -ErrorAction SilentlyContinue
}

$lines = cmd /c "netstat -ano -p TCP | findstr :3000"
foreach ($line in $lines) {
  if ($line -match "LISTENING\s+(\d+)\s*$") {
    $p = [int]$Matches[1]
    if ($p -gt 0) {
      try { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue } catch {}
    }
  }
}

$cmdLine = "cd /d `"$repoRoot`" && set PORT=3000 && set NEXT_PUBLIC_API_URL=http://localhost:3001 && npm -w apps/web run dev"
$outLog = Join-Path $logDir "web.out.log"
$errLog = Join-Path $logDir "web.err.log"

Write-Host "Iniciando web (dev) em http://localhost:3000 ..."
$p = Start-Process -FilePath "cmd.exe" -WorkingDirectory $repoRoot -ArgumentList @("/c", $cmdLine) -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
Set-Content -Path $pidFile -Value $p.Id
Write-Host "web PID $($p.Id)"

Start-Sleep -Seconds 15
$up = (cmd /c "netstat -ano -p TCP | findstr :3000") -match "LISTENING"
Write-Host "web (3000): $(if ($up) { 'OK' } else { 'ainda iniciando — veja .run-logs/web.out.log' })"
