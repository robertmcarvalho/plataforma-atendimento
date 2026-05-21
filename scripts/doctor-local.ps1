param(
  [int]$ApiPort = 3001,
  [int]$WebPort = 3000
)

$ErrorActionPreference = "Continue"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "== $Title =="
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Set-Location $repoRoot

Write-Section "Versions"
try { node -v } catch {}
try { npm -v } catch {}

Write-Section "Ports (LISTEN)"
try {
  $c3000 = Get-NetTCPConnection -State Listen -LocalPort $WebPort -ErrorAction SilentlyContinue
  if ($c3000) {
    $c3000 | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize
  } else {
    Write-Host "Port ${WebPort}: not visible via Get-NetTCPConnection. Fallback netstat:"
    netstat -ano -p TCP | findstr (":$WebPort")
  }
} catch {
  Write-Host "Get-NetTCPConnection failed (maybe older Windows). Fallback netstat:"
  netstat -ano | findstr (":$WebPort")
}

try {
  $c3001 = Get-NetTCPConnection -State Listen -LocalPort $ApiPort -ErrorAction SilentlyContinue
  if ($c3001) {
    $c3001 | Select-Object LocalAddress,LocalPort,OwningProcess | Format-Table -AutoSize
  } else {
    Write-Host "Port ${ApiPort}: not visible via Get-NetTCPConnection. Fallback netstat:"
    netstat -ano -p TCP | findstr (":$ApiPort")
  }
} catch {
  netstat -ano | findstr (":$ApiPort")
}

Write-Section "Build Artifacts"
Write-Host ("api dist: " + (Test-Path "apps\\api-service\\dist\\index.js"))
Write-Host ("web build: " + (Test-Path "apps\\web\\.next_local\\BUILD_ID"))

Write-Section "Quick HTTP"
try {
  Write-Host "GET http://localhost:$ApiPort/health"
  curl.exe -sS -o NUL -w "api /health -> %{http_code}`n" "http://localhost:$ApiPort/health"
} catch {
  Write-Host "curl api failed: $($_.Exception.Message)"
}

try {
  Write-Host "GET http://localhost:$WebPort/login"
  curl.exe -sS -o NUL -w "web /login -> %{http_code}`n" "http://localhost:$WebPort/login"
} catch {
  Write-Host "curl web failed: $($_.Exception.Message)"
}

Write-Section "Notes"
Write-Host "Se o web standalone estiver FALSE, rode: npm -w apps/web run build"
Write-Host "Se /api/settings ou /api/conversations/:id/read estiver 500, aplique a migration 002: npm run db:ensure (precisa SUPABASE_DB_URL ou .secrets\\supabase-db-url.txt)"
Write-Host "Se der spawn EPERM no Windows/OneDrive, a correção mais comum é mover o repo para fora do OneDrive ou liberar node.exe no Controlled Folder Access/antivirus."
