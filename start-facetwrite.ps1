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

if (-not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
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
Write-Host ""

Write-Host "Starting FacetWrite..." -ForegroundColor Green
Write-Host "Frontend:        http://127.0.0.1:$clientPort/"
Write-Host "API health:      http://127.0.0.1:$apiPort/api/health"
Write-Host "Agent cards:     http://127.0.0.1:$apiPort/api/agent-cards"
Write-Host "Agent status:    http://127.0.0.1:$apiPort/api/settings/status"
Write-Host ""
Write-Host "Agent calls use mock fallback until Agent status reports provider online." -ForegroundColor DarkYellow
Write-Host "Keep this window open while using the app. Press Ctrl+C to stop." -ForegroundColor DarkGray
Write-Host ""

& npm.cmd run dev
