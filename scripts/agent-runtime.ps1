param(
  [ValidateSet("up", "up-local", "down", "status")]
  [string] $Action = "status"
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$runtimeRoot = Join-Path $root "modules\agent-runtime"
$env:AGENT_RUNTIME_ROOT = $runtimeRoot
if (-not $env:HOME -and $env:USERPROFILE) {
  $env:HOME = $env:USERPROFILE
}

function Get-LocalEnvValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name
  )

  $envPaths = @(
    (Join-Path $root ".env.local"),
    (Join-Path $runtimeRoot ".env")
  )

  foreach ($envPath in $envPaths) {
    if (-not (Test-Path -LiteralPath $envPath)) {
      continue
    }

    $line = Get-Content -LiteralPath $envPath |
      Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } |
      Select-Object -First 1

    if ($line) {
      return ($line -replace "^\s*$([regex]::Escape($Name))\s*=\s*", "").Trim().Trim('"')
    }
  }

  return $null
}

function Get-ConfigValue {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [string] $DefaultValue = ""
  )

  $processValue = [Environment]::GetEnvironmentVariable($Name)
  if ($processValue) {
    return $processValue
  }

  $localValue = Get-LocalEnvValue -Name $Name
  if ($localValue) {
    return $localValue
  }

  return $DefaultValue
}

function Ensure-AgentRuntimeFile {
  param([string] $RelativePath, [string] $ExampleRelativePath = "", [switch] $AllowEmpty)
  $target = Join-Path $runtimeRoot $RelativePath
  if (Test-Path -LiteralPath $target) {
    if ((Get-Item -LiteralPath $target).PSIsContainer) { throw "$target must be a file." }
    return
  }
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  if ($ExampleRelativePath) {
    $example = Join-Path $runtimeRoot $ExampleRelativePath
    if (Test-Path -LiteralPath $example) {
      Copy-Item -LiteralPath $example -Destination $target
      return
    }
  }
  if ($AllowEmpty) {
    New-Item -ItemType File -Path $target -Force | Out-Null
    return
  }
  throw "Missing Agent Runtime file: $target"
}

function Ensure-AgentRuntimeFiles {
  Ensure-AgentRuntimeFile -RelativePath ".env" -AllowEmpty
  Ensure-AgentRuntimeFile -RelativePath "frontend\.env" -AllowEmpty
  Ensure-AgentRuntimeFile -RelativePath "config.yaml" -ExampleRelativePath "config.example.yaml"
  Ensure-AgentRuntimeFile -RelativePath "extensions_config.json" -ExampleRelativePath "extensions_config.example.json"
}

function Test-DockerImageAvailable {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Image
  )

  & docker image inspect $Image *> $null
  return $LASTEXITCODE -eq 0
}

function Get-AgentRuntimeComposeFile {
  param(
    [switch] $PreferLocal
  )

  $localComposeFile = "modules/agent-runtime/docker/docker-compose-local-images.yaml"
  if ($PreferLocal) {
    return $localComposeFile
  }

  $localGatewayImage = Get-ConfigValue -Name "AGENT_RUNTIME_GATEWAY_IMAGE" -DefaultValue "facetwrite-agent-runtime-gateway:latest"
  $localFrontendImage = Get-ConfigValue -Name "AGENT_RUNTIME_FRONTEND_IMAGE" -DefaultValue "facetwrite-agent-runtime-frontend:latest"
  if ((Test-DockerImageAvailable -Image $localGatewayImage) -and (Test-DockerImageAvailable -Image $localFrontendImage)) {
    Write-Host "Using local Agent Runtime images: $localGatewayImage, $localFrontendImage" -ForegroundColor Cyan
    return $localComposeFile
  }

  Write-Host "Local Agent Runtime images were not found. Docker will build runtime images from configured base images." -ForegroundColor DarkYellow
  return "modules/agent-runtime/docker/docker-compose-dev.yaml"
}

if ($Action -eq "up" -or $Action -eq "up-local") {
  Ensure-AgentRuntimeFiles
}

$composeFile = Get-AgentRuntimeComposeFile -PreferLocal:($Action -eq "up-local")
$composeArgs = @("compose", "-p", "facetwrite-agent-runtime", "-f", $composeFile)

switch ($Action) {
  "up" {
    & docker @composeArgs up -d nginx frontend gateway
  }
  "up-local" {
    & docker @composeArgs up -d nginx frontend gateway
  }
  "down" {
    & docker @composeArgs down
  }
  "status" {
    & docker @composeArgs ps
  }
}

if ($LASTEXITCODE -ne 0) {
  throw "Agent Runtime Docker command failed with exit code $LASTEXITCODE."
}
