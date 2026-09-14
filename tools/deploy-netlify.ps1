# Put the configurator on a permanent address.
#
#   Double-click "Deploy to Netlify.bat", or:
#   powershell -ExecutionPolicy Bypass -File tools\deploy-netlify.ps1
#
# WHY THIS EXISTS. A Cloudflare quick tunnel died three times in four days, each
# time with a new four-word name, so it could never be the link in an email.
# This puts the same folder somewhere that does not care whether this machine is
# awake, and keeps the per-configuration AR working - which a plain static host
# cannot do, because building a model for a product nobody has built before
# needs something that can run code.
#
# WHAT IT DOES NOT DO: sign you in. The first run opens a browser for you to
# authorise and to pick or create the site; every run after that is silent.
# Nobody but you should be creating accounts in your name.

param(
  [string]$Models = 'youk',
  [string]$Out = 'bundle-netlify',
  [switch]$Draft
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Fail($m) { Write-Host "`n  $m`n" -ForegroundColor Red; Read-Host 'Enter to close'; exit 1 }

if (-not (Test-Path (Join-Path $Models 'guided.json'))) {
  Fail "No guided.json in '$Models' - that is the option schema, and without it this would export a viewer rather than a configurator."
}

# THE BUNDLE IS BUILT FIRST, and locally, so that what goes up is a folder you
# could have opened yourself. `--ar-route` is what puts the route in the
# manifest; without it the page would fall back to AR of the opening product
# only, and nothing would say so until somebody was standing in a room.
Write-Host "`n  exporting the bundle..." -ForegroundColor Cyan
& node tools/export-bundle.mjs --guided --models $Models --ar-route --out $Out
if ($LASTEXITCODE -ne 0) { Fail 'the export failed, so there is nothing to deploy' }

$manifest = Get-Content (Join-Path $Out 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $manifest.ar.route) {
  Fail 'the exported manifest has no ar.route, so AR would cover only the opening product'
}
$models = (Get-ChildItem (Join-Path $Out 'models') -Filter *.glb).Count
Write-Host "  $models part models, AR route '$($manifest.ar.route)'"

# The function is bundled by Netlify, but building it here first turns a deploy
# failure into a local one - and prints the number that decides whether it fits.
Write-Host '  checking the function builds...' -ForegroundColor Cyan
$fn = Join-Path $env:TEMP 'confgr-ar-fn.mjs'
& npx --yes esbuild netlify/functions/ar.mjs --bundle --platform=node --format=esm --target=node20 --minify --outfile=$fn 2>&1 | Out-String | Write-Host
if (-not (Test-Path $fn)) { Fail 'the AR function does not bundle, so it would fail on Netlify instead of here' }
Write-Host ("  function {0} kB + {1} MB of models" -f
  [math]::Round((Get-Item $fn).Length / 1KB, 1),
  [math]::Round(((Get-ChildItem (Join-Path $Out 'models') -File | Measure-Object Length -Sum).Sum) / 1MB, 2))

Write-Host "`n  deploying..." -ForegroundColor Cyan
Write-Host '  (first run only: a browser will open for you to authorise and name the site)'
$args = @('--yes', 'netlify-cli', 'deploy')
if (-not $Draft) { $args += '--prod' }
& npx @args

if ($LASTEXITCODE -ne 0) {
  Fail 'the deploy did not finish. The URL above, if there is one, is a draft rather than the live site.'
}

Write-Host ''
Write-Host '  Done. The address Netlify printed above is permanent - it survives' -ForegroundColor Green
Write-Host '  this machine sleeping, and it does not change on the next deploy.' -ForegroundColor Green
Write-Host ''
Write-Host '  Before sending it to anybody: the site is PUBLIC until you put'
Write-Host '  Cloudflare Access in front of it. See NETLIFY.md.'
Write-Host ''
Read-Host '  Enter to close'
