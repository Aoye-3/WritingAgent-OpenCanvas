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

if ($Action -eq "status" -and (Test-Path -LiteralPath $metadataPath)) {
  try {
    $statusMetadata = Get-Content -LiteralPath $metadataPath -Raw | ConvertFrom-Json
    $Port = [int] $statusMetadata.port
    $BridgeBaseUrl = [string] $statusMetadata.bridgeBaseUrl
  } catch {}
}
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

function Get-ToolTokenFingerprint {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($env:FACETWRITE_INTERNAL_TOOL_TOKEN)
    return ([System.BitConverter]::ToString($sha256.ComputeHash($bytes))).Replace("-", "").ToLowerInvariant()
  } finally {
    $sha256.Dispose()
  }
}

function Get-SourceFingerprint {
  $sourceNewest = (Get-ChildItem -Path @(
    (Join-Path $backendRoot "app"),
    (Join-Path $backendRoot "packages\harness"),
    (Join-Path $runtimeRoot "skills"),
    (Join-Path $runtimeRoot "config.yaml")
  ) -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Extension -in @(".py", ".md", ".yaml", ".yml", ".json", ".toml") -and $_.FullName -notmatch "\\(__pycache__|\.pytest_cache|\.uv-cache|\.venv|node_modules)\\"
  } | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1).LastWriteTimeUtc
  if (-not $sourceNewest) { return "0" }
  return [DateTimeOffset]::new($sourceNewest).ToUnixTimeMilliseconds().ToString()
}

function Assert-PathInsideWorkspace {
  param([string] $Path, [string] $Label)
  $resolvedRoot = [IO.Path]::GetFullPath($root).TrimEnd('\') + '\'
  $resolvedPath = [IO.Path]::GetFullPath($Path)
  if (-not $resolvedPath.StartsWith($resolvedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label must stay inside $root, but resolved to $resolvedPath"
  }
  return $resolvedPath
}

function Assert-CompatibleOwner {
  $metadata = Read-Metadata
  if (-not $metadata) {
    throw "Port $Port already serves an unmanaged Agent Runtime. Stop it or use AGENT_RUNTIME_MODE=external."
  }
  $tokenFingerprint = if ($env:FACETWRITE_INTERNAL_TOOL_TOKEN) { Get-ToolTokenFingerprint } else { $null }
  $tokenMismatch = $tokenFingerprint -and $metadata.toolTokenFingerprint -ne $tokenFingerprint
  if ($metadata.projectRoot -ne $root -or [int] $metadata.port -ne $Port -or $metadata.bridgeBaseUrl -ne $BridgeBaseUrl -or $tokenMismatch) {
    throw "The running local Agent Runtime uses incompatible project, port, or FacetWrite bridge settings."
  }
  if (-not $metadata.runtimePython) {
    throw "The running local Agent Runtime does not declare its Python executable."
  }
  Assert-PathInsideWorkspace -Path ([string] $metadata.runtimePython) -Label "running Agent Runtime Python" | Out-Null
  if ($metadata.sourceFingerprint -ne (Get-SourceFingerprint)) {
    throw "Source files changed after the local Agent Runtime started."
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
  Assert-PathInsideWorkspace -Path $env:UV_CACHE_DIR -Label "uv cache" | Out-Null
  Assert-PathInsideWorkspace -Path $env:UV_PYTHON_INSTALL_DIR -Label "uv Python install directory" | Out-Null
  New-Item -ItemType Directory -Path $env:UV_CACHE_DIR -Force | Out-Null
  New-Item -ItemType Directory -Path $env:UV_PYTHON_INSTALL_DIR -Force | Out-Null
  Import-DotEnv
  if (-not $env:FACETWRITE_INTERNAL_TOOL_TOKEN) {
    throw "FACETWRITE_INTERNAL_TOOL_TOKEN is required so the Agent Runtime can authenticate to the FacetWrite Tool bridge."
  }

  $node = Assert-Command "node" "Install Node.js 22 or newer."
  $npm = Assert-Command "npm.cmd" "Install Node.js 22 or newer."
  $npx = Assert-Command "npx.cmd" "Install Node.js 22 or newer."
  $uv = Assert-Command "uv" "Install uv from https://docs.astral.sh/uv/."
  $toolDirs = @($node.Source, $npm.Source, $npx.Source) | ForEach-Object { Split-Path -Parent $_ } | Select-Object -Unique
  $currentPath = [Environment]::GetEnvironmentVariable("Path", "Process")
  [Environment]::SetEnvironmentVariable("PATH", $null, "Process")
  [Environment]::SetEnvironmentVariable("Path", $currentPath, "Process")
  $env:Path = (($toolDirs + @($currentPath)) -join [IO.Path]::PathSeparator)

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
    $pythonStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("python", "find", "--managed-python", "3.12") -Quiet
    if ($pythonStatus -ne 0) { Write-Host "Python 3.12 is not installed yet; the first up command will install it." -ForegroundColor Yellow }
    Write-Host "Agent Runtime local prerequisites are available." -ForegroundColor Green
    Write-Host "Gateway: $healthUrl"
    Write-Host "Bridge:  $BridgeBaseUrl"
    exit 0
  }
  "status" {
    Import-DotEnv
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
    Import-DotEnv
    if (Test-HttpOk) {
      try {
        Assert-CompatibleOwner
        Write-Host "Reusing the project-owned Agent Runtime local Gateway at $healthUrl." -ForegroundColor Cyan
        exit 0
      } catch {
        $ownerError = $_.Exception.Message
        $restartable = $ownerError -like "Source files changed*" -or
          $ownerError -like "The running local Agent Runtime does not declare its Python executable*" -or
          $ownerError -like "running Agent Runtime Python must stay inside*"
        if (-not $restartable) { throw }
        Stop-OwnedRuntime
      }
    }
    if (Get-OwnedProcess) {
      throw "The project-owned Agent Runtime process is running but unhealthy. Run agent-runtime:down and inspect $stderrPath."
    }
    Remove-OwnershipFiles
    $uv = Initialize-Environment

    $pythonStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("python", "find", "--managed-python", "3.12") -Quiet
    if ($pythonStatus -ne 0) {
      $installStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("python", "install", "3.12")
      if ($installStatus -ne 0) { throw "uv could not install Python 3.12." }
    }
    $managedPython = (& $uv.Source python find --managed-python 3.12).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $managedPython) { throw "uv could not resolve its workspace-managed Python 3.12." }
    Assert-PathInsideWorkspace -Path $managedPython -Label "managed Python" | Out-Null

    $venvRoot = Join-Path $backendRoot ".venv"
    $venvConfigPath = Join-Path $venvRoot "pyvenv.cfg"
    if (Test-Path -LiteralPath $venvConfigPath) {
      $pythonHomeLine = Get-Content -LiteralPath $venvConfigPath | Where-Object { $_ -match "^home\s*=\s*(.+)$" } | Select-Object -First 1
      if ($pythonHomeLine -and $pythonHomeLine -match "^home\s*=\s*(.+)$") {
        $pythonHome = $Matches[1].Trim()
        try { Assert-PathInsideWorkspace -Path $pythonHome -Label "virtualenv Python home" | Out-Null } catch {
          $resolvedVenvRoot = Assert-PathInsideWorkspace -Path $venvRoot -Label "virtualenv"
          Remove-Item -LiteralPath $resolvedVenvRoot -Recurse -Force
        }
      }
    }

    Push-Location $backendRoot
    try {
      $syncStatus = Invoke-Uv -UvPath $uv.Source -Arguments @("sync", "--python", $managedPython, "--locked", "--all-packages")
      if ($syncStatus -ne 0) { throw "Agent Runtime dependency synchronization failed." }
      $runtimePython = Join-Path $backendRoot ".venv\Scripts\python.exe"
      Assert-PathInsideWorkspace -Path $runtimePython -Label "Agent Runtime Python" | Out-Null
      if (-not (Test-Path -LiteralPath $runtimePython)) { throw "Agent Runtime Python executable is missing: $runtimePython" }
      $venvSitePackages = Join-Path $backendRoot ".venv\Lib\site-packages"
      $harnessPackage = Join-Path $backendRoot "packages\harness"
      $env:PYTHONPATH = (@($backendRoot, $harnessPackage, $venvSitePackages, $env:PYTHONPATH) | Where-Object { $_ }) -join [IO.Path]::PathSeparator
      $arguments = @(
        "-m", "uvicorn", "app.gateway.app:app",
        "--host", "127.0.0.1", "--port", "$Port"
      )
      $process = Start-Process -FilePath $runtimePython -ArgumentList $arguments -WorkingDirectory $backendRoot -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath -WindowStyle Hidden -PassThru
    } finally {
      Pop-Location
    }

    try {
      Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
      $metadataJson = @{
        pid = $process.Id
        projectRoot = $root
        port = $Port
        bridgeBaseUrl = $BridgeBaseUrl
        startedAt = (Get-Date).ToUniversalTime().ToString("o")
        sourceFingerprint = Get-SourceFingerprint
        runtimePython = $runtimePython
        toolTokenFingerprint = Get-ToolTokenFingerprint
      } | ConvertTo-Json
      [System.IO.File]::WriteAllText($metadataPath, $metadataJson, [System.Text.UTF8Encoding]::new($false))
    } catch {
      Stop-OwnedRuntime
      throw
    }

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
