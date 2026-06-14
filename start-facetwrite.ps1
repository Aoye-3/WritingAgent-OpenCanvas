param([switch] $NoInstall)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Get-LocalEnvValue {
  param([string] $Name)
  $envPath = Join-Path $root ".env.local"
  if (-not (Test-Path -LiteralPath $envPath)) { return $null }
  $line = Get-Content -LiteralPath $envPath | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -First 1
  if (-not $line) { return $null }
  return ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim().Trim('"')
}

function Get-ConfigValue {
  param([string] $Name, [string] $DefaultValue = "")
  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if ($processValue) { return $processValue }
  $localValue = Get-LocalEnvValue -Name $Name
  if ($localValue) { return $localValue }
  return $DefaultValue
}

function Test-PortInUse {
  param([int] $Port)
  return [bool] (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1)
}

function Get-FreeTcpPort {
  $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0)
  try {
    $listener.Start()
    return ([System.Net.IPEndPoint] $listener.LocalEndpoint).Port
  } finally {
    $listener.Stop()
  }
}

function Test-HttpOk {
  param([string] $Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch { return $false }
}

function Invoke-RuntimeScript {
  param([string] $Script, [string] $Action, [string[]] $ExtraArgs = @())
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script $Action @ExtraArgs
  if ($LASTEXITCODE -ne 0) { throw "Agent Runtime $Action failed with exit code $LASTEXITCODE." }
}

$clientPort = [int] (Get-ConfigValue -Name "VITE_PORT" -DefaultValue "3000")
$apiPort = [int] (Get-ConfigValue -Name "PORT" -DefaultValue "8837")
$runtimeMode = (Get-ConfigValue -Name "AGENT_RUNTIME_MODE" -DefaultValue "local").ToLowerInvariant()
if ($runtimeMode -notin @("local", "docker", "external")) {
  throw "AGENT_RUNTIME_MODE must be local, docker, or external."
}
$processRuntimeBaseUrl = [Environment]::GetEnvironmentVariable("AGENT_BACKEND_BASE_URL")
if ($runtimeMode -eq "local") {
  if ($processRuntimeBaseUrl) {
    $agentBackendBaseUrl = $processRuntimeBaseUrl.TrimEnd("/")
  } else {
    $configuredRuntimePort = [int] (Get-ConfigValue -Name "AGENT_RUNTIME_PORT" -DefaultValue "0")
    if ($configuredRuntimePort -eq 0) { $configuredRuntimePort = Get-FreeTcpPort }
    $agentBackendBaseUrl = "http://127.0.0.1:$configuredRuntimePort"
  }
} elseif ($runtimeMode -eq "docker") {
  $agentBackendBaseUrl = (Get-ConfigValue -Name "AGENT_BACKEND_BASE_URL" -DefaultValue "http://127.0.0.1:2026").TrimEnd("/")
} else {
  $agentBackendBaseUrl = (Get-ConfigValue -Name "AGENT_BACKEND_BASE_URL" -DefaultValue "").TrimEnd("/")
  if (-not $agentBackendBaseUrl) { throw "AGENT_BACKEND_BASE_URL is required when using an external Agent Runtime." }
}
$runtimeUri = [uri] $agentBackendBaseUrl
$runtimePort = $runtimeUri.Port
$agentBackendEnabled = (Get-ConfigValue -Name "AGENT_BACKEND_ENABLED" -DefaultValue "false") -match "^(true|1)$"
$configuredToolToken = Get-ConfigValue -Name "FACETWRITE_INTERNAL_TOOL_TOKEN"
if ($configuredToolToken) {
  $env:FACETWRITE_INTERNAL_TOOL_TOKEN = $configuredToolToken
  $generatedToolToken = $false
} elseif ($runtimeMode -eq "external") {
  throw "FACETWRITE_INTERNAL_TOOL_TOKEN is required when using an external Agent Runtime."
} else {
  $env:FACETWRITE_INTERNAL_TOOL_TOKEN = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
  $generatedToolToken = $true
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw "npm.cmd was not found. Install Node.js 22 or newer." }
if (-not $NoInstall -and -not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE." }
}
if (-not $agentBackendEnabled) {
  throw "Agent Runtime is required for the local launcher. Set AGENT_BACKEND_ENABLED=true in .env.local before starting FacetWrite."
}
if (Test-PortInUse -Port $clientPort) { throw "Frontend port $clientPort is already in use." }
if (Test-PortInUse -Port $apiPort) { throw "API port $apiPort is already in use." }

$env:AGENT_RUNTIME_MODE = $runtimeMode
$env:AGENT_BACKEND_BASE_URL = $agentBackendBaseUrl
$env:AGENT_RUNTIME_PORT = "$runtimePort"
$runtimeOwned = $false
$localRuntimeScript = "scripts\agent-runtime-local.ps1"
$dockerRuntimeScript = "scripts\agent-runtime.ps1"
$bridgeBaseUrl = "http://127.0.0.1:$apiPort"

function Start-SelectedAgentRuntime {
  switch ($runtimeMode) {
    "local" {
      if (Test-HttpOk -Url "$agentBackendBaseUrl/health") {
        if (-not $generatedToolToken) {
          Invoke-RuntimeScript -Script $localRuntimeScript -Action "status" -ExtraArgs @("-Port", "$runtimePort", "-BridgeBaseUrl", $bridgeBaseUrl)
          return
        }
        Invoke-RuntimeScript -Script $localRuntimeScript -Action "down" -ExtraArgs @("-Port", "$runtimePort", "-BridgeBaseUrl", $bridgeBaseUrl)
      }
      Invoke-RuntimeScript -Script $localRuntimeScript -Action "up" -ExtraArgs @("-Port", "$runtimePort", "-BridgeBaseUrl", $bridgeBaseUrl)
      $script:runtimeOwned = $true
    }
    "docker" {
      if (Test-HttpOk -Url "$agentBackendBaseUrl/health") {
        if (-not $generatedToolToken) { return }
        Invoke-RuntimeScript -Script $dockerRuntimeScript -Action "down"
      }
      Invoke-RuntimeScript -Script $dockerRuntimeScript -Action "up"
      $script:runtimeOwned = $true
    }
    "external" {
      if (-not (Test-HttpOk -Url "$agentBackendBaseUrl/health")) {
        throw "External Agent Runtime is not healthy at $agentBackendBaseUrl. FacetWrite does not manage its lifecycle."
      }
    }
  }
}

function Stop-SelectedAgentRuntime {
  if (-not $runtimeOwned) { return }
  if ($runtimeMode -eq "local") {
    Invoke-RuntimeScript -Script $localRuntimeScript -Action "down" -ExtraArgs @("-Port", "$runtimePort", "-BridgeBaseUrl", $bridgeBaseUrl)
  } elseif ($runtimeMode -eq "docker") {
    Invoke-RuntimeScript -Script $dockerRuntimeScript -Action "down"
  }
}

Write-Host "OpenCanvas local launcher" -ForegroundColor Cyan
Write-Host "Runtime mode: $runtimeMode"
Write-Host "Runtime URL:  $agentBackendBaseUrl"

try {
  Start-SelectedAgentRuntime
  if (-not (Test-HttpOk -Url "$agentBackendBaseUrl/health")) { throw "Agent Runtime did not become healthy at $agentBackendBaseUrl." }
  Write-Host "Frontend: http://127.0.0.1:$clientPort/" -ForegroundColor Green
  Write-Host "API:      http://127.0.0.1:$apiPort/api/health" -ForegroundColor Green
  & npm.cmd run dev:services
  if ($LASTEXITCODE -ne 0) { throw "OpenCanvas services exited with code $LASTEXITCODE." }
} finally {
  Stop-SelectedAgentRuntime
}
