param(
  [switch] $SkipAgentBackend,
  [switch] $NoInstall
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Get-LocalEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  $envPath = Join-Path $root ".env.local"
  if (-not (Test-Path -LiteralPath $envPath)) {
    return $null
  }

  $line = Get-Content -LiteralPath $envPath |
    Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
    Select-Object -First 1

  if (-not $line) {
    return $null
  }

  return ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim().Trim('"')
}

function Get-ConfigValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [string] $DefaultValue = ""
  )

  $localValue = Get-LocalEnvValue -Name $Name
  if ($localValue) {
    return $localValue
  }

  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if ($processValue) {
    return $processValue
  }

  return $DefaultValue
}

function Test-PortInUse {
  param(
    [Parameter(Mandatory = $true)]
    [int] $Port
  )

  $connection = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
    Select-Object -First 1

  return [bool] $connection
}

function Test-CommandAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  return [bool] (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-HttpOk {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Ensure-AgentBackendBridgeEnv {
  $agentBackendEnvPath = Join-Path $root "AgentBackend\.env"
  if (-not (Test-Path -LiteralPath $agentBackendEnvPath)) {
    Write-Host "Warning: AgentBackend\.env was not found. Docker sidecar startup may fail until AgentBackend provider env is configured." -ForegroundColor Yellow
    return
  }

  $bridgeBaseUrl = Get-Content -LiteralPath $agentBackendEnvPath |
    Where-Object { $_ -match "^\s*FACETWRITE_INTERNAL_BASE_URL\s*=" } |
    Select-Object -First 1

  if (-not $bridgeBaseUrl) {
    Add-Content -LiteralPath $agentBackendEnvPath -Value "FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8787"
    Write-Host "Added FACETWRITE_INTERNAL_BASE_URL to AgentBackend\.env for ToolUse bridge callbacks." -ForegroundColor DarkYellow
  }
}

function Start-AgentBackendSidecar {
  if (-not (Test-CommandAvailable -Name "docker")) {
    throw "Docker was not found. Start Docker Desktop, make sure Docker is available in PATH, then run this launcher again."
  }

  Write-Host "Checking Docker daemon..." -ForegroundColor Cyan
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker daemon is not reachable. Start Docker Desktop and wait until it finishes starting, then run this launcher again."
  }

  Ensure-AgentBackendBridgeEnv

  Write-Host "Starting AgentBackend Docker sidecar..." -ForegroundColor Green
  $env:AGENT_BACKEND_ROOT = (Join-Path $root "AgentBackend")
  if (-not $env:HOME -and $env:USERPROFILE) {
    $env:HOME = $env:USERPROFILE
  }
  & docker compose -p agent-backend-dev -f "AgentBackend/docker/docker-compose-dev.yaml" up -d nginx frontend gateway
  if ($LASTEXITCODE -ne 0) {
    throw "AgentBackend Docker Compose startup failed with exit code $LASTEXITCODE."
  }

  $healthUrl = "http://127.0.0.1:2026/health"
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    if (Test-HttpOk -Url $healthUrl) {
      Write-Host "AgentBackend sidecar health: $healthUrl" -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "AgentBackend sidecar did not report healthy within the startup window. Check Docker Desktop containers/logs, then run this launcher again."
}

Write-Host ""
Write-Host "FacetWrite local launcher" -ForegroundColor Cyan
Write-Host "Project: $root"
Write-Host ""

if (-not (Test-Path -LiteralPath (Join-Path $root "package.json"))) {
  throw "package.json was not found. Please run this script from the FacetWrite project root."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm.cmd was not found. Please install Node.js, then run this launcher again."
}

if (-not $NoInstall -and -not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  Write-Host "Dependencies are missing. Installing now..." -ForegroundColor Yellow
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) {
    throw "Dependency installation failed with exit code $LASTEXITCODE."
  }
}

$clientPort = 5173
$apiPortValue = Get-ConfigValue -Name "PORT" -DefaultValue "8787"
$apiPort = [int] $apiPortValue
$providerId = Get-ConfigValue -Name "OPENAI_PROVIDER_ID" -DefaultValue "deepseek"
$model = Get-ConfigValue -Name "OPENAI_MODEL" -DefaultValue "deepseek-v4-flash"
$baseUrl = Get-ConfigValue -Name "OPENAI_BASE_URL" -DefaultValue "https://api.deepseek.com"
$apiKeyConfigured = [bool] (Get-ConfigValue -Name "OPENAI_API_KEY")
$agentBackendEnabled = (Get-ConfigValue -Name "AGENT_BACKEND_ENABLED" -DefaultValue "false") -match "^(true|1)$"
$agentBackendBaseUrl = Get-ConfigValue -Name "AGENT_BACKEND_BASE_URL" -DefaultValue "http://127.0.0.1:2026"

if (-not (Test-Path -LiteralPath (Join-Path $root ".env.local"))) {
  Write-Host "Warning: .env.local was not found. The API will use mock fallback unless provider settings are configured elsewhere." -ForegroundColor Yellow
}

if (Test-PortInUse -Port $clientPort) {
  Write-Host "Warning: port $clientPort is already in use. The Vite client may already be running, or startup may fail." -ForegroundColor Yellow
}

if (Test-PortInUse -Port $apiPort) {
  Write-Host "Warning: port $apiPort is already in use. The FacetWrite API may already be running, or startup may fail." -ForegroundColor Yellow
}

Write-Host "Runtime configuration" -ForegroundColor Cyan
Write-Host "Provider: $providerId"
Write-Host "Model:    $model"
Write-Host "Base URL: $baseUrl"
Write-Host "API key:  $(if ($apiKeyConfigured) { "configured" } else { "missing" })"
Write-Host "AgentBackend: $(if ($agentBackendEnabled) { "enabled at $agentBackendBaseUrl" } else { "disabled" })"
Write-Host ""

if ($agentBackendEnabled -and -not $SkipAgentBackend) {
  Start-AgentBackendSidecar
} elseif ($agentBackendEnabled -and $SkipAgentBackend) {
  Write-Host "Skipping AgentBackend sidecar startup because -SkipAgentBackend was provided." -ForegroundColor DarkYellow
}

Write-Host "Starting FacetWrite..." -ForegroundColor Green
Write-Host "Frontend:        http://127.0.0.1:$clientPort/"
Write-Host "API health:      http://127.0.0.1:$apiPort/api/health"
Write-Host "AgentBackend status: http://127.0.0.1:$apiPort/api/agent-backend/status"
Write-Host "AI Dashboard:    http://127.0.0.1:$clientPort/"
Write-Host "Agent cards:     http://127.0.0.1:$apiPort/api/agent-cards"
Write-Host "Agent status:    http://127.0.0.1:$apiPort/api/settings/status"
Write-Host ""
Write-Host "AgentBackend runtime is the primary acceptance path when enabled; provider/mock fallback is only a safety net." -ForegroundColor DarkYellow
Write-Host "Keep this window open while using the app. Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

& npm.cmd run dev
