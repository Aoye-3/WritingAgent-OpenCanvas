param(
  [int] $StartupTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$entrypoint = Join-Path $root "start-opencanvas-shell.vbs"
$acceptanceScript = Join-Path $root "scripts\local-runtime-acceptance.mjs"
$metadataPath = Join-Path $root "modules\agent-runtime\logs\agent-runtime-local.json"
$servicePorts = @(17777, 17776)
$runtimePort = $null

function Get-ListeningPortOwners {
  param([int[]] $Ports)
  return @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -in $Ports })
}

function Get-OwnedAppShellProcessInfo {
  $escapedRoot = [regex]::Escape($root)
  return @(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq "electron.exe" -and $_.CommandLine -match $escapedRoot -and $_.CommandLine -match "app-shell/main\.mjs"
  })
}

function Get-LocalRuntimeMetadata {
  if (-not (Test-Path -LiteralPath $metadataPath)) { return $null }
  try { return Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json } catch { return $null }
}

function Wait-LocalRuntimeMetadata {
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $metadata = Get-LocalRuntimeMetadata
    if ($metadata -and $metadata.port) { return $metadata }
    Start-Sleep -Seconds 1
  }
  throw "Local Runtime metadata did not appear at $metadataPath within $StartupTimeoutSeconds seconds."
}

function Assert-DockerStopped {
  $dockerProcesses = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match "docker" })
  if ($dockerProcesses.Count -gt 0) {
    throw "Docker must be stopped before the local Runtime acceptance test. Running: $($dockerProcesses.ProcessName -join ', ')."
  }
  if (Get-ListeningPortOwners -Ports @(2026)) {
    throw "Port 2026 is listening before local Runtime acceptance. Stop the Docker Runtime first."
  }
}

function Wait-HttpReady {
  param([string] $Url)
  $deadline = (Get-Date).AddSeconds($StartupTimeoutSeconds)
  $lastError = "not attempted"
  while ((Get-Date) -lt $deadline) {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
      $output = & curl.exe --fail --silent --show-error --max-time 3 $Url 2>&1
      $curlExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($curlExitCode -eq 0) { return }
    $lastError = ($output | Out-String).Trim()
    Start-Sleep -Seconds 1
  }
  throw "$Url did not become ready within $StartupTimeoutSeconds seconds. Last error: $lastError"
}

function Stop-OwnedAppShell {
  $escapedRoot = [regex]::Escape($root)
  $portsToCheck = @($servicePorts)
  $metadata = Get-LocalRuntimeMetadata
  if ($metadata -and $metadata.port) { $portsToCheck += [int] $metadata.port }
  $electron = Get-OwnedAppShellProcessInfo
  foreach ($processInfo in $electron) {
    $process = Get-Process -Id $processInfo.ProcessId -ErrorAction SilentlyContinue
    if ($process -and $process.MainWindowHandle -ne 0) { $null = $process.CloseMainWindow() }
  }

  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ((Get-ListeningPortOwners -Ports $portsToCheck).Count -eq 0 -and (Get-OwnedAppShellProcessInfo).Count -eq 0) { return }
    Start-Sleep -Seconds 1
  }

  foreach ($processInfo in Get-OwnedAppShellProcessInfo) {
    Stop-Process -Id $processInfo.ProcessId -Force -ErrorAction SilentlyContinue
  }

  foreach ($listener in Get-ListeningPortOwners -Ports $portsToCheck) {
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($listener.OwningProcess)" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.CommandLine -match $escapedRoot) {
      Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    }
  }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root "scripts\agent-runtime-local.ps1") down *> $null
}

Assert-DockerStopped
$staleAppShell = Get-OwnedAppShellProcessInfo
if ($staleAppShell.Count -gt 0) {
  throw "A stale OpenCanvas App Shell process is running without the expected ports. Close it before acceptance."
}
$occupied = Get-ListeningPortOwners -Ports $servicePorts
if ($occupied.Count -gt 0) {
  throw "Local Runtime acceptance requires ports 17777 and 17776 to be free."
}

try {
  Push-Location $root
  try {
    & cscript.exe //nologo $entrypoint
  } finally {
    Pop-Location
  }

  $runtimeMetadata = Wait-LocalRuntimeMetadata
  $runtimePort = [int] $runtimeMetadata.port
  Wait-HttpReady -Url "http://127.0.0.1:$runtimePort/health"
  Wait-HttpReady -Url "http://127.0.0.1:17777/api/health"
  Wait-HttpReady -Url "http://127.0.0.1:17776"
  Assert-DockerStopped

  & node.exe $acceptanceScript
  if ($LASTEXITCODE -ne 0) { throw "Browser acceptance failed with exit code $LASTEXITCODE." }
} finally {
  Stop-OwnedAppShell
}

$cleanupPorts = @(17777, 17776, 2026)
if ($runtimePort) { $cleanupPorts += $runtimePort }
$remaining = Get-ListeningPortOwners -Ports $cleanupPorts
if ($remaining.Count -gt 0) {
  throw "Acceptance cleanup left service ports listening: $($remaining.LocalPort -join ', ')."
}

Write-Host "Local Runtime acceptance passed without Docker." -ForegroundColor Green
