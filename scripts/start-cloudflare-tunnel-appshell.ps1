param(
  [switch] $NoShell,
  [switch] $NoInstall,
  [int] $FrontendPort = 17776,
  [int] $ApiPort = 17777,
  [int] $StartupTimeoutSec = 180,
  [string] $CloudflaredPath = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $root

$logsRoot = Join-Path $root "logs"
New-Item -ItemType Directory -Force -Path $logsRoot | Out-Null

function Resolve-Cloudflared {
  if ($CloudflaredPath) {
    $candidate = Resolve-Path -LiteralPath $CloudflaredPath -ErrorAction SilentlyContinue
    if ($candidate) { return $candidate.Path }
    throw "cloudflared was not found at $CloudflaredPath."
  }
  $workspaceTool = Join-Path $root ".cloudflare-tools\cloudflared.exe"
  if (Test-Path -LiteralPath $workspaceTool) { return $workspaceTool }
  $pathTool = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if ($pathTool) { return $pathTool.Source }
  throw "cloudflared was not found. Put cloudflared.exe at .cloudflare-tools\cloudflared.exe or pass -CloudflaredPath."
}

function Test-HttpOk {
  param([string] $Url)
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 300
  } catch {
    return $false
  }
}

function Wait-HttpOk {
  param([string] $Url, [int] $TimeoutSec)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    if (Test-HttpOk -Url $Url) { return }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for $Url."
}

function Wait-TunnelUrl {
  param([string[]] $LogPath, [System.Diagnostics.Process] $Process, [int] $TimeoutSec)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  do {
    foreach ($path in $LogPath) {
      if (Test-Path -LiteralPath $path) {
        $content = Get-Content -LiteralPath $path -Raw
        if (-not [string]::IsNullOrWhiteSpace($content)) {
          $match = [regex]::Match($content, "https://[a-z0-9-]+\.trycloudflare\.com")
          if ($match.Success) { return $match.Value }
        }
      }
    }
    if ($Process -and $Process.HasExited) {
      $logs = foreach ($path in $LogPath) {
        if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Raw }
      }
      throw "cloudflared exited before printing a trycloudflare.com URL. Logs: $logs"
    }
    Start-Sleep -Seconds 1
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for cloudflared to print a trycloudflare.com URL."
}

if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
  throw "npm.cmd was not found. Install Node.js before starting the remote test shell."
}

if (-not $NoInstall -and -not (Test-Path -LiteralPath (Join-Path $root "node_modules"))) {
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { throw "Dependency installation failed with exit code $LASTEXITCODE." }
}

$cloudflared = Resolve-Cloudflared
$frontendUrl = "http://127.0.0.1:$FrontendPort"
$apiHealthUrl = "http://127.0.0.1:$ApiPort/api/health"

Write-Host "OpenCanvas Cloudflare Tunnel AppShell launcher" -ForegroundColor Cyan
Write-Host "Frontend: $frontendUrl"
Write-Host "API:      $apiHealthUrl"

if (-not $NoShell) {
  $shellOut = Join-Path $logsRoot "cloudflare-appshell.out.log"
  $shellErr = Join-Path $logsRoot "cloudflare-appshell.err.log"
  Remove-Item $shellOut, $shellErr -Force -ErrorAction SilentlyContinue
  $shellProcess = Start-Process -FilePath "npm.cmd" -ArgumentList @("run", "shell:dev") -WorkingDirectory $root -RedirectStandardOutput $shellOut -RedirectStandardError $shellErr -PassThru -WindowStyle Hidden
  Set-Content -Path (Join-Path $logsRoot "cloudflare-appshell.pid") -Value $shellProcess.Id
  Write-Host "Started App Shell launcher process: $($shellProcess.Id)"
} else {
  Write-Host "Reusing an already-running App Shell because -NoShell was supplied."
}

Wait-HttpOk -Url $apiHealthUrl -TimeoutSec $StartupTimeoutSec
Wait-HttpOk -Url $frontendUrl -TimeoutSec $StartupTimeoutSec

$tunnelOut = Join-Path $logsRoot "cloudflare-appshell-tunnel.out.log"
$tunnelErr = Join-Path $logsRoot "cloudflare-appshell-tunnel.err.log"
Remove-Item $tunnelOut, $tunnelErr -Force -ErrorAction SilentlyContinue
$tunnelProcess = Start-Process -FilePath $cloudflared -ArgumentList @("tunnel", "--url", $frontendUrl) -WorkingDirectory $root -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -PassThru -WindowStyle Hidden
Set-Content -Path (Join-Path $logsRoot "cloudflare-appshell-tunnel.pid") -Value $tunnelProcess.Id

$remoteUrl = Wait-TunnelUrl -LogPath @($tunnelErr, $tunnelOut) -Process $tunnelProcess -TimeoutSec 90
$remoteReachable = Test-HttpOk -Url $remoteUrl

Write-Host ""
Write-Host "Remote OpenCanvas URL:" -ForegroundColor Green
Write-Host $remoteUrl -ForegroundColor Green
Write-Host ""
Write-Host "Local App Shell frontend: $frontendUrl"
Write-Host "Local API health:        $apiHealthUrl"
Write-Host "cloudflared PID:         $($tunnelProcess.Id)"
Write-Host "Remote URL reachable:    $remoteReachable"
Write-Host ""
Write-Host "Stop the remote tunnel with:" -ForegroundColor Yellow
Write-Host "Stop-Process -Id $($tunnelProcess.Id) -Force"
Write-Host "Close the OpenCanvas App Shell window to stop the App Shell services."
