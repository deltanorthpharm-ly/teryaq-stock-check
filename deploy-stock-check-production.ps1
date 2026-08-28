$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 5181
$HostName = "127.0.0.1"
$StartupScript = Join-Path $ProjectRoot "start-stock-check-production.bat"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Get-ListeningPids {
  param([int]$LocalPort)

  $connections = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) {
    return @()
  }

  return @($connections | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -gt 0 })
}

function Assert-HttpOk {
  param(
    [string]$Url,
    [string]$ExpectedContentType
  )

  $response = Invoke-WebRequest -Uri $Url -UseBasicParsing
  if ($response.StatusCode -ne 200) {
    throw "$Url returned HTTP $($response.StatusCode)"
  }

  $contentType = [string]$response.Headers["Content-Type"]
  if ($ExpectedContentType -and -not $contentType.StartsWith($ExpectedContentType)) {
    throw "$Url returned Content-Type '$contentType', expected '$ExpectedContentType'"
  }

  return $response
}

Set-Location $ProjectRoot

Write-Step "Building Teryaq Stock Check production output"
& npm.cmd run build
if ($LASTEXITCODE -ne 0) {
  throw "npm.cmd run build failed with exit code $LASTEXITCODE"
}

$serverEntry = Join-Path $ProjectRoot ".output\server\index.mjs"
if (-not (Test-Path $serverEntry)) {
  throw "Production server entry was not found: $serverEntry"
}

Write-Step "Stopping only the process listening on port $Port"
$oldPids = Get-ListeningPids -LocalPort $Port
if ($oldPids.Count -eq 0) {
  Write-Host "No process is currently listening on port $Port."
} else {
  foreach ($stockCheckPid in $oldPids) {
    Write-Host "Stopping PID $stockCheckPid on port $Port"
    Stop-Process -Id $stockCheckPid -Force
  }
}

Write-Step "Starting Teryaq Stock Check production server"
Start-Process -FilePath $StartupScript -WorkingDirectory $ProjectRoot -WindowStyle Hidden

$newPid = $null
for ($attempt = 1; $attempt -le 20; $attempt++) {
  Start-Sleep -Seconds 1
  $pids = Get-ListeningPids -LocalPort $Port
  if ($pids.Count -gt 0) {
    $newPid = $pids[0]
    break
  }
}

if (-not $newPid) {
  throw "Teryaq Stock Check did not start listening on port $Port."
}

$process = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -eq $newPid }
if (-not $process.CommandLine -or $process.CommandLine -notmatch "\.output[\\/]+server[\\/]+index\.mjs") {
  throw "Port $Port is not served by the expected production command. PID $newPid command: $($process.CommandLine)"
}

Write-Step "Verifying local production HTML and assets"
$baseUrl = "http://${HostName}:${Port}"
$htmlResponse = Assert-HttpOk -Url "$baseUrl/" -ExpectedContentType "text/html"
$html = $htmlResponse.Content

$cssPath = ([regex]::Match($html, "/assets/styles-[^""'<> ]+\.css")).Value
$jsPath = ([regex]::Match($html, "/assets/index-[^""'<> ]+\.js")).Value

if (-not $cssPath) {
  throw "No production CSS asset was referenced by the HTML."
}

if (-not $jsPath) {
  throw "No production JS asset was referenced by the HTML."
}

$cssResponse = Assert-HttpOk -Url "$baseUrl$cssPath" -ExpectedContentType "text/css"
$jsResponse = Assert-HttpOk -Url "$baseUrl$jsPath" -ExpectedContentType "text/javascript"

Write-Step "Deployment verification passed"
[pscustomobject]@{
  OldPids = ($oldPids -join ",")
  NewPid = $newPid
  CommandLine = $process.CommandLine
  CssAsset = $cssPath
  CssStatus = $cssResponse.StatusCode
  CssContentType = $cssResponse.Headers["Content-Type"]
  JsAsset = $jsPath
  JsStatus = $jsResponse.StatusCode
  JsContentType = $jsResponse.Headers["Content-Type"]
  Url = "$baseUrl/"
  Status = "OK"
} | Format-List
