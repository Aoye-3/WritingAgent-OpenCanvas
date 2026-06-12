param(
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

function Test-DockerImageAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Image
  )

  & docker image inspect $Image *> $null
  return $LASTEXITCODE -eq 0
}

function Ensure-AgentRuntimeLocalFile {
  param(
    [Parameter(Mandatory = $true)]
    [string] $RelativePath,

    [string] $ExampleRelativePath = "",

    [switch] $AllowEmptyFallback
  )

  $agentRuntimePath = Join-Path $root (Join-Path "modules\agent-runtime" $RelativePath)
  if (Test-Path -LiteralPath $agentRuntimePath) {
    $existingItem = Get-Item -LiteralPath $agentRuntimePath
    if (-not $existingItem.PSIsContainer) {
      return
    }

    $existingChildren = Get-ChildItem -LiteralPath $agentRuntimePath -Force | Select-Object -First 1
    if ($existingChildren) {
      throw "modules\agent-runtime\$RelativePath is a directory with contents. Move or remove it before starting Agent Runtime."
    }

    Remove-Item -LiteralPath $agentRuntimePath -Force
    Write-Host "Repaired empty directory at modules\agent-runtime\$RelativePath; Docker had likely created it for a missing file bind mount." -ForegroundColor DarkYellow
  }

  $legacyPath = Join-Path $root (Join-Path "AgentBackend" $RelativePath)
  if ($ExampleRelativePath) {
    $examplePath = Join-Path $root (Join-Path "modules\agent-runtime" $ExampleRelativePath)
  } else {
    $examplePath = "$agentRuntimePath.example"
  }
  $targetDir = Split-Path -Parent $agentRuntimePath
  if ($targetDir) {
    New-Item -ItemType Directory -Force $targetDir | Out-Null
  }

  if ((Test-Path -LiteralPath $legacyPath) -and -not (Get-Item -LiteralPath $legacyPath).PSIsContainer) {
    Copy-Item -LiteralPath $legacyPath -Destination $agentRuntimePath
    Write-Host "Migrated local Agent Runtime file from AgentBackend\$RelativePath to modules\agent-runtime\$RelativePath." -ForegroundColor DarkYellow
    return
  }

  if ((Test-Path -LiteralPath $examplePath) -and -not (Get-Item -LiteralPath $examplePath).PSIsContainer) {
    Copy-Item -LiteralPath $examplePath -Destination $agentRuntimePath
    Write-Host "Created modules\agent-runtime\$RelativePath from example. Review provider values before relying on live runtime tools." -ForegroundColor DarkYellow
    return
  }

  if ($AllowEmptyFallback) {
    New-Item -ItemType File -Force $agentRuntimePath | Out-Null
    Write-Host "Created empty modules\agent-runtime\$RelativePath because no legacy or example file was found." -ForegroundColor DarkYellow
    return
  }

  throw "modules\agent-runtime\$RelativePath was not found, and no legacy/example file was available to create it."
}

function Ensure-AgentRuntimeLocalEnv {
  Ensure-AgentRuntimeLocalFile -RelativePath ".env" -AllowEmptyFallback
  Ensure-AgentRuntimeLocalFile -RelativePath "frontend\.env" -AllowEmptyFallback
}

function Ensure-AgentRuntimeLocalConfig {
  Ensure-AgentRuntimeLocalFile -RelativePath "config.yaml" -ExampleRelativePath "config.example.yaml"
  Ensure-AgentRuntimeLocalFile -RelativePath "extensions_config.json" -ExampleRelativePath "extensions_config.example.json"
}

function Ensure-AgentRuntimeBridgeEnv {
  Ensure-AgentRuntimeLocalEnv
  Ensure-AgentRuntimeLocalConfig

  $agentRuntimeEnvPath = Join-Path $root "modules\agent-runtime\.env"
  if (-not (Test-Path -LiteralPath $agentRuntimeEnvPath)) {
    Write-Host "Warning: modules\agent-runtime\.env was not found. Docker sidecar startup may fail until Agent Runtime provider env is configured." -ForegroundColor Yellow
    return
  }

  $bridgeBaseUrl = Get-Content -LiteralPath $agentRuntimeEnvPath |
    Where-Object { $_ -match "^\s*FACETWRITE_INTERNAL_BASE_URL\s*=" } |
    Select-Object -First 1

  if (-not $bridgeBaseUrl) {
    Add-Content -LiteralPath $agentRuntimeEnvPath -Value "FACETWRITE_INTERNAL_BASE_URL=http://host.docker.internal:8837"
    Write-Host "Added FACETWRITE_INTERNAL_BASE_URL to modules\agent-runtime\.env for ToolUse bridge callbacks." -ForegroundColor DarkYellow
  }
}

function Start-AgentRuntimeSidecar {
  if (-not (Test-CommandAvailable -Name "docker")) {
    throw "Docker was not found. Start Docker Desktop, make sure Docker is available in PATH, then run this launcher again."
  }

  Write-Host "Checking Docker daemon..." -ForegroundColor Cyan
  & docker info *> $null
  if ($LASTEXITCODE -ne 0) {
    throw "Docker daemon is not reachable. Start Docker Desktop and wait until it finishes starting, then run this launcher again."
  }

  Ensure-AgentRuntimeBridgeEnv

  Write-Host "Starting Agent Runtime Docker sidecar..." -ForegroundColor Green
  $env:AGENT_RUNTIME_ROOT = (Join-Path $root "modules\agent-runtime")
  if (-not $env:HOME -and $env:USERPROFILE) {
    $env:HOME = $env:USERPROFILE
  }

  $localGatewayImage = Get-ConfigValue -Name "AGENT_RUNTIME_GATEWAY_IMAGE" -DefaultValue "facetwrite-agent-runtime-gateway:latest"
  $localFrontendImage = Get-ConfigValue -Name "AGENT_RUNTIME_FRONTEND_IMAGE" -DefaultValue "facetwrite-agent-runtime-frontend:latest"
  $composeFile = "modules/agent-runtime/docker/docker-compose-dev.yaml"
  if ((Test-DockerImageAvailable -Image $localGatewayImage) -and (Test-DockerImageAvailable -Image $localFrontendImage)) {
    $composeFile = "modules/agent-runtime/docker/docker-compose-local-images.yaml"
    Write-Host "Using local Agent Runtime images: $localGatewayImage, $localFrontendImage" -ForegroundColor Cyan
  } else {
    Write-Host "Local Agent Runtime images were not found. Docker will build runtime images from configured base images." -ForegroundColor DarkYellow
  }

  & docker compose -p facetwrite-agent-runtime -f $composeFile up -d nginx frontend gateway
  if ($LASTEXITCODE -ne 0) {
    throw "Agent Runtime Docker Compose startup failed with exit code $LASTEXITCODE."
  }

  $healthUrl = "http://127.0.0.1:2026/health"
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    if (Test-HttpOk -Url $healthUrl) {
      Write-Host "Agent Runtime sidecar health: $healthUrl" -ForegroundColor Green
      return
    }
    Start-Sleep -Seconds 2
  }

  throw "Agent Runtime sidecar did not report healthy within the startup window. Check Docker Desktop containers/logs, then run this launcher again."
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

$clientPortValue = Get-ConfigValue -Name "VITE_PORT" -DefaultValue "3000"
$clientPort = [int] $clientPortValue
$apiPortValue = Get-ConfigValue -Name "PORT" -DefaultValue "8837"
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

if (-not $agentBackendEnabled) {
  throw "Agent Runtime is required for the local launcher. Set AGENT_BACKEND_ENABLED=true in .env.local before starting FacetWrite."
}

if (Test-PortInUse -Port $clientPort) {
  throw "Frontend port $clientPort is already in use. Close the existing FacetWrite or Vite process before starting this workspace."
}

if (Test-PortInUse -Port $apiPort) {
  throw "API port $apiPort is already in use. Close the existing FacetWrite API process before starting this workspace."
}

Write-Host "Runtime configuration" -ForegroundColor Cyan
Write-Host "Provider: $providerId"
Write-Host "Model:    $model"
Write-Host "Base URL: $baseUrl"
Write-Host "API key:  $(if ($apiKeyConfigured) { "configured" } else { "missing" })"
Write-Host "Agent Runtime: $(if ($agentBackendEnabled) { "enabled at $agentBackendBaseUrl (AgentBackend adapter)" } else { "disabled" })"
Write-Host ""

Start-AgentRuntimeSidecar

Write-Host "Starting FacetWrite..." -ForegroundColor Green
Write-Host "Frontend:        http://127.0.0.1:$clientPort/"
Write-Host "API health:      http://127.0.0.1:$apiPort/api/health"
Write-Host "Agent Runtime status: http://127.0.0.1:$apiPort/api/agent-runtime/status"
Write-Host "AI Dashboard:    http://127.0.0.1:$clientPort/"
Write-Host "Agent cards:     http://127.0.0.1:$apiPort/api/agent-cards"
Write-Host "Agent status:    http://127.0.0.1:$apiPort/api/settings/status"
Write-Host ""
Write-Host "Agent Runtime is the primary acceptance path when enabled; provider/mock fallback is only a safety net." -ForegroundColor DarkYellow
Write-Host "Keep this window open while using the app. Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

& npm.cmd run dev:services
