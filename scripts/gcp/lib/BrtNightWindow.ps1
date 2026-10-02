# Janela noturna BRT do orchestrator (22:00–06:00).
function Test-BrtOrchestratorNightWindow {
  param([DateTime]$UtcNow = [DateTime]::UtcNow)
  $tz = [TimeZoneInfo]::FindSystemTimeZoneById('E. South America Standard Time')
  $brt = [TimeZoneInfo]::ConvertTimeFromUtc($UtcNow, $tz)
  $inWindow = ($brt.Hour -ge 22) -or ($brt.Hour -lt 6)
  return @{
    InWindow = $inWindow
    Now = $brt
    Hour = $brt.Hour
  }
}
