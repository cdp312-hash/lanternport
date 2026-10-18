# Installs npm packages while keeping node_modules outside OneDrive.
# node_modules here is a junction to a folder under ~/.venvs, so OneDrive doesn't sync
# thousands of package files. The store folder must itself be named node_modules so Node can
# resolve packages from their real paths. npm replaces junctions, so this moves the folder back,
# runs npm, then moves it out again.
#
#   ./install.ps1                         # npm install
#   ./install.ps1 --save-dev some-package # any npm install arguments
#
# It never deletes anything: if the folders aren't in the expected state it stops and says why.

$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$link = Join-Path $here "node_modules"
$store = Join-Path $env:USERPROFILE ".venvs\lanternport-worker\node_modules"

$item = Get-Item $link -Force -ErrorAction SilentlyContinue
if ($item -and $item.LinkType -eq "Junction") {
    if ($item.Target -ne $store) { throw "$link points to $($item.Target), not $store. Fix it by hand." }
    $item.Attributes = $item.Attributes -band -bnot [IO.FileAttributes]::ReadOnly  # OneDrive can mark it read-only
    cmd /c rmdir "$link"  # removes only the link, never the folder it points to
    if (Test-Path $link) { throw "Couldn't remove the $link junction (is a dev server or editor using it?)" }
    if (Test-Path $store) { Move-Item $store $link }
} elseif ($item) {
    throw "$link is a real folder. Move or delete it yourself, then run this again."
} elseif (Test-Path $store) {
    throw "$store exists but isn't linked here. Check what uses it before removing it."
}

Push-Location $here
try {
    $ErrorActionPreference = "Continue"  # npm writes warnings to stderr; only the exit code matters
    & npm.cmd install --no-fund --no-audit @args
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -ne 0) { throw "npm install failed" }
} finally {
    Pop-Location
}

New-Item -ItemType Directory -Force (Split-Path $store) | Out-Null
Move-Item $link $store
New-Item -ItemType Junction -Path $link -Target $store | Out-Null
Write-Host "node_modules is a junction to $store"

