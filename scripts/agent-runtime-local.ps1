param(
  [ValidateSet("up", "down", "status", "doctor")]
  [string] $Action = "status",

  [int] $Port = 8001,

  [string] $BridgeBaseUrl = ""
)

$ErrorActionPreference = "Stop"

$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$runtimeRoot = Join-Path $root "modules\agent-runtime"
$backendRoot = Join-Path $runtimeRoot "backend"
$logsRoot = Join-Path $runtimeRoot "logs"
$pidPath = Join-Path $logsRoot "agent-runtime-local.pid"
$metadataPath = Join-Path $logsRoot "agent-runtime-local.json"
$stdoutPath = Join-Path $logsRoot "gateway-local.out.log"
$stderrPath = Join-Path $logsRoot "gateway-local.err.log"
$healthUrl = "http://127.0.0.1:$Port/health"

if (-not $BridgeBaseUrl) {
  $apiPort = if ($env:PORT) { $env:PORT } else { "8837" }
  $BridgeBaseUrl = "http://127.0.0.1:$apiPort"
}
$BridgeBaseUrl = $BridgeBaseUrl.TrimEnd("/")

function Test-HttpOk {
  try {
    $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Get-OwnedProcess {
  if (-not (Test-Path -LiteralPath $pidPath)) { return $null }
  $pidValue = (Get-Content -LiteralPath $pidPath -Raw).Trim()
  if ($pidValue -notmatch "^\d+$") { return $null }
  return Get-Process -Id ([int] $pidValue) -ErrorAction SilentlyContinue
}

function Read-Metadata {
  if (-not (Test-Path -LiteralPath $metadataPath)) { return $null }
  try { return Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json } catch { return $null }
}

function Remove-OwnershipFiles {
  Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $metadataPath -Force -ErrorAction SilentlyContinue
}

function Assert-CompatibleOwner {
  $metadata = Read-Metadata
  if (-not $metadata) {
    throw "Port $Port already serves an unmanaged Agent Runtime. Stop it or use AGENT_RUNTIME_MODE=external."
  }
  if ($metadata.projectRoot -ne $root -or [int] $metadata.port -ne $Port -or $metadata.bridgeBaseUrl -ne $BridgeBaseUrl) {
    throw "The running local Agent Runtime uses incompatible project, port, or FacetWrite bridge settings."
  }
}

function Assert-Command {
  param([string] $Name, [string] $InstallHint)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if (-not $command) { throw "$Name was not found. $InstallHint" }
  return $command
}

function Invoke-Uv {
  param([string] $UvPath, [string[]] $Arguments, [switch] $Quiet)
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = "Continue"
  try {
    if ($Quiet) { & $UvPath @Arguments *> $null } else { & $UvPath @Arguments }
    return $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
}

function Ensure-LocalFile {
  param([string] $RelativePath, [string] $ExampleRelativePath = "", [switch] $AllowEmpty)
  $target = Join-Path $runtimeRoot $RelativePath
  if (Test-Path -LiteralPath $target) {
    if ((Get-Item -LiteralPath $target).PSIsContainer) {
      throw "$target must be a file, but a directory exists at that path."
    }
    return
  }
  $parent = Split-Path -Parent $target
  New-Item -ItemType Directory -Path $parent -Force | Out-Null
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

function Import-DotEnvFile {
  param([string] $Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -notmatch "^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$") { continue }
    $name = $Matches[1]
    $value = $Matches[2].Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($name)) {
      [Environment]::SetEnvironmentVariable($name, $value)
    }
  }
}

function Import-DotEnv {
  Import-DotEnvFile -Path (Join-Path $runtimeRoot ".env")
  Import-DotEnvFile -Path (Join-Path $root ".env.local")
}

function Initialize-Environment {
  Ensure-LocalFile -RelativePath ".env" -AllowEmpty
  Ensure-LocalFile -RelativePath "config.yaml" -ExampleRelativePath "config.example.yaml"
  Ensure-LocalFile -RelativePath "extensions_config.json" -ExampleRelativePath "extensions_config.example.json"
  New-Item -ItemType Directory -Path $logsRoot -Force | Out-Null
  $env:UV_CACHE_DIR = Join-Path $backendRoot ".uv-cache"
  $env:UV_PYTHON_INSTALL_DIR = Join-Path $backendRoot ".uv-python"
  New-Item -ItemType Directory -Path $env:UV_CACHE_DIR -Force | Out-Null
  New-Item -ItemType Directory -Path $env:UV_PYTHON_INSTALL_DIR -Force | Out-Null
  Import-DotEnv

  $node = Assert-Command "node" "Install Node.js 22 or newer."
  $npm = Assert-Command "npm.cmd" "Install Node.js 22 or newer."
  $npx = Assert-Command "npx.cmd" "Install Node.js 22 or newer."
  $uv = Assert-Command "uv" "Install uv from https://docs.astral.sh/uv/."
  $toolDirs = @($node.Source, $npm.Source, $npx.Source) | ForEach-Object { Split-Path -Parent $_ } | Select-Object -Unique
  $env:PATH = (($toolDirs + @($env:PATH)) -join [IO.Path]::PathSeparator)

  $env:DEER_FLOW_PROJECT_ROOT = $runtimeRoot
  $env:DEER_FLOW_HOME = Join-Path $backendRoot ".deer-flow"
  $env:DEER_FLOW_CONFIG_PATH = Join-Path $runtimeRoot "config.yaml"
  $env:DEER_FLOW_EXTENSIONS_CONFIG_PATH = Join-Path $runtimeRoot "extensions_config.json"
  $env:DEER_FLOW_SKILLS_PATH = Join-Path $runtimeRoot "skills"
  $env:DEER_FLOW_CHANNELS_LANGGRAPH_URL = "http://127.0.0.1:$Port/api"
  $env:DEER_FLOW_CHANNELS_GATEWAY_URL = "http://127.0.0.1:$Port"
  $env:FACETWRITE_INTERNAL_BASE_URL = $BridgeBaseUrl
  $env:PYTHONUTF8 = "1"
  $env:PYTHONIOENCODING = "utf-8"
  return $uv
}

function Stop-OwnedRuntime {
  $process = Get-OwnedProcess
  if ($process) {
    & taskkill.exe /PID $process.Id /T /F *> $null
  }
  Remove-OwnershipFiles
}

switch ($Action) {
  "doctor" {
    $uv = Initialize-Environment
    $pythonStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("python", "find", "3.12") -Quiet
    if ($pythonStatus -ne 0) { Write-Host "Python 3.12 is not installed yet; the first up command will install it." -ForegroundColor Yellow }
    Write-Host "Agent Runtime local prerequisites are available." -ForegroundColor Green
    Write-Host "Gateway: $healthUrl"
    Write-Host "Bridge:  $BridgeBaseUrl"
    exit 0
  }
  "status" {
    if (Test-HttpOk) {
      Assert-CompatibleOwner
      $process = Get-OwnedProcess
      Write-Host "Agent Runtime local Gateway is healthy at $healthUrl (PID $($process.Id))." -ForegroundColor Green
      exit 0
    }
    Write-Host "Agent Runtime local Gateway is stopped." -ForegroundColor DarkYellow
    exit 1
  }
  "down" {
    Stop-OwnedRuntime
    Write-Host "Agent Runtime local Gateway stopped." -ForegroundColor Green
    exit 0
  }
  "up" {
    if (Test-HttpOk) {
      Assert-CompatibleOwner
      Write-Host "Reusing the project-owned Agent Runtime local Gateway at $healthUrl." -ForegroundColor Cyan
      exit 0
    }
    if (Get-OwnedProcess) {
      throw "The project-owned Agent Runtime process is running but unhealthy. Run agent-runtime:down and inspect $stderrPath."
    }
    Remove-OwnershipFiles
    $uv = Initialize-Environment

    $pythonStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("python", "find", "3.12") -Quiet
    if ($pythonStatus -ne 0) {
      $installStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("python", "install", "3.12")
      if ($installStatus -ne 0) { throw "uv could not install Python 3.12." }
    }

    Push-Location $backendRoot
    try {
      $syncStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("sync", "--python", "3.12", "--locked", "--all-packages")
      if ($syncStatus -ne 0) { throw "Agent Runtime dependency synchronization failed." }
      $arguments = @(
        "run", "--python", "3.12", "--no-sync",
        "uvicorn", "app.gateway.app:app",
        "--host", "127.0.0.1", "--port", "$Port"
      )
      $process = Start-Process -FilePath $uv.Source -ArgumentList $arguments -WorkingDirectory $backendRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
    } finally {
      Pop-Location
    }

    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
    @{
      pid = $process.Id
      projectRoot = $root
      port = $Port
      bridgeBaseUrl = $BridgeBaseUrl
      startedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding utf8

    for ($attempt = 0; $attempt -lt 90; $attempt++) {
      if (Test-HttpOk) {
        Write-Host "Agent Runtime local Gateway is healthy at $healthUrl." -ForegroundColor Green
        exit 0
      }
      if ($process.HasExited) { break }
      Start-Sleep -Seconds 1
      $process.Refresh()
    }
    Stop-OwnedRuntime
    throw "Agent Runtime local Gateway did not become healthy. Inspect $stderrPath."
  }
}
