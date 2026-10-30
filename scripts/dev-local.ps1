param([ValidateSet('start', 'stop')][string]$Action = 'start')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$localDir = Join-Path $projectRoot '.data/local'
$pidFile = Join-Path $localDir 'processes.json'
$pgCtl = Join-Path $localDir 'postgres/pgsql/bin/pg_ctl.exe'
$pgData = Join-Path $localDir 'pgdata'
$bunExe = Join-Path $localDir 'bin/bun.exe'

if (!(Test-Path $bunExe) -or !(Test-Path $pgData)) {
  throw 'Local services are not installed. See docs/local-development.md.'
}
if ($Action -eq 'stop') {
  if (Test-Path $pidFile) {
    foreach ($entry in @(Get-Content $pidFile -Raw | ConvertFrom-Json)) {
      $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.pid)" -ErrorAction SilentlyContinue
      if ($process -and $process.CreationDate.ToUniversalTime().Ticks -eq [long]$entry.created) {
        & taskkill.exe /PID $entry.pid /T /F | Out-Null
      }
    }
    Remove-Item -LiteralPath $pidFile
  }
  & $pgCtl -D $pgData status *> $null
  if ($LASTEXITCODE -eq 0) { & $pgCtl -D $pgData -m fast stop }
  Write-Host 'Project-local services stopped.'
  exit
}

$env:PATH = "$(Join-Path $localDir 'bin');$env:PATH"
& $pgCtl -D $pgData status *> $null
if ($LASTEXITCODE -ne 0) {
  & $pgCtl -D $pgData -l (Join-Path $localDir 'postgres.log') -o '-h 127.0.0.1 -p 5432' start
  if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start.' }
}
$processes = if (Test-Path $pidFile) { @(Get-Content $pidFile -Raw | ConvertFrom-Json) } else { @() }
function Start-LocalService([string]$Name, [string]$Executable, [string]$Arguments, [string]$Directory, [int]$Port = 0) {
  if ($Port -and (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)) {
    Write-Host "$Name already listens on port $Port."
    return
  }
  foreach ($entry in $script:processes | Where-Object { $_.name -eq $Name }) {
    $existing = Get-CimInstance Win32_Process -Filter "ProcessId = $($entry.pid)" -ErrorAction SilentlyContinue
    if ($existing -and $existing.CreationDate.ToUniversalTime().Ticks -eq [long]$entry.created) { return }
  }
  $service = Start-Process -FilePath $Executable -ArgumentList $Arguments -WorkingDirectory $Directory -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $localDir "$Name.log") -RedirectStandardError (Join-Path $localDir "$Name-errors.log")
  $started = Get-CimInstance Win32_Process -Filter "ProcessId = $($service.Id)"
  $script:processes = @($script:processes | Where-Object { $_.name -ne $Name }) + [pscustomobject]@{ name = $Name; pid = $service.Id; created = $started.CreationDate.ToUniversalTime().Ticks }
  $script:processes | ConvertTo-Json -AsArray | Set-Content -LiteralPath $pidFile
  Write-Host "Started $Name."
}
Start-LocalService 'mailpit' (Join-Path $localDir 'mailpit/mailpit.exe') '--listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --database mailpit.db' $localDir 8025
Start-LocalService 'admin' $bunExe '--bun run dev --host 127.0.0.1' (Join-Path $projectRoot 'apps/admin') 2480
Start-LocalService 'public' $bunExe '--bun run dev --port 3480' (Join-Path $projectRoot 'apps/public') 3480
Start-LocalService 'worker' $bunExe 'run dev' (Join-Path $projectRoot 'apps/worker')
Write-Host 'Starting apps. Homepage: http://localhost:3480 | Admin: http://localhost:2480 | Inbox: http://localhost:8025'
