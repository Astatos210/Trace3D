# Downloads and installs a portable COLMAP build into <repo>/tools/colmap.
# The backend auto-detects tools/colmap/COLMAP.bat / bin/colmap.exe
# (see pipeline/colmap_runner.py).
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\setup_colmap.ps1
#
# Optional environment overrides:
#   COLMAP_VERSION   e.g. "3.9.1" (default; 4.2.0 crashed with 0xC0000409 on
#                    some CPUs) or "latest" to fetch the newest release
#   COLMAP_FLAVOR    "no-cuda"/"nocuda" (CPU-only, default) or "cuda" (NVIDIA)

$ErrorActionPreference = "Stop"
$ProgressPreference = 'SilentlyContinue'   # IWR is ~100x slower with the progress bar rendering

$RepoRoot = Split-Path -Parent $PSScriptRoot
$DestRoot = Join-Path $RepoRoot "tools\colmap"

# Already installed?
$Exe = Join-Path $DestRoot "bin\colmap.exe"
if (Test-Path $Exe) {
    Write-Host "COLMAP already installed at $Exe"
    & (Join-Path $DestRoot "COLMAP.bat") --help | Select-Object -First 2
    exit 0
}

# Resolve version: default is the pinned known-good release
$Version = $env:COLMAP_VERSION
if (-not $Version) { $Version = "3.9.1" }
if ($Version -eq "latest") {
    Write-Host "Resolving latest COLMAP release..."
    $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/colmap/colmap/releases/latest"
    $Version = $rel.tag_name
}
Write-Host "COLMAP version: $Version"

# Asset naming changed with the 4.x release series
$Flavor = if ($env:COLMAP_FLAVOR) { $env:COLMAP_FLAVOR } else { "no-cuda" }
if ([version]$Version -ge [version]"4.0.0") {
    $Asset = "colmap-x64-windows-$($Flavor -replace '^no-cuda$', 'nocuda').zip"
} else {
    $Asset = "COLMAP-$Version-windows-$Flavor.zip"
}

$Url = "https://github.com/colmap/colmap/releases/download/$Version/$Asset"
$Zip = Join-Path $env:TEMP $Asset

Write-Host "Downloading $Url ..."
Invoke-WebRequest -Uri $Url -OutFile $Zip

Write-Host "Extracting to $DestRoot ..."
$Tmp = Join-Path $env:TEMP "colmap-extract-$PID"
Expand-Archive -LiteralPath $Zip -DestinationPath $Tmp -Force

# The zip has a single top-level dir (4.x: none; 3.x: COLMAP-x.y-windows-no-cuda).
# Move the *contents* into DestRoot — moving a directory onto an existing
# directory would nest it instead of merging.
New-Item -ItemType Directory -Force -Path $DestRoot | Out-Null
$SrcDir = Join-Path $Tmp "*"
$Children = Get-ChildItem $Tmp
if ($Children.Count -eq 1 -and $Children[0].PSIsContainer) {
    $SrcDir = Join-Path $Children[0].FullName "*"
}
Copy-Item -Path $SrcDir -Destination $DestRoot -Recurse -Force
Remove-Item -Recurse -Force $Tmp, $Zip

Write-Host ""
Write-Host "Done. Verifying:"
& (Join-Path $DestRoot "COLMAP.bat") --help | Select-Object -First 2
Write-Host ""
Write-Host "Restart the backend so it picks up COLMAP; the health badge will show 'COLMAP: Ready'."
