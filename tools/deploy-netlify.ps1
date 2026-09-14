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

# NOTHING MAY DIE SILENTLY. The first version of this script hit an unhandled
# terminating error and PowerShell exited mid-pipeline, which left cmd.exe
# asking "Terminate batch job (Y/N)?" - a prompt that names neither what failed
# nor that anything had. Matt saw only that. A trap costs four lines and is the
# difference between a bug report and a mystery.
trap {
  Write-Host "`n  Stopped: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "  at $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" -ForegroundColor DarkGray
  Write-Host ''
  Read-Host '  Enter to close'
  exit 1
}

<#
  Run a command that is not PowerShell, and judge it by its EXIT CODE.

  This is the whole of the bug above. Native programs write progress to stderr
  perfectly routinely - esbuild prints its summary there, node printed a
  deprecation warning there - and with $ErrorActionPreference = 'Stop', a
  native program's stderr becomes a TERMINATING ERROR the moment it is
  redirected into a PowerShell pipeline. So `esbuild ... 2>&1 | Write-Host`
  killed the script on a line that said "Done in 376ms".

  Exit codes are what these programs actually use to report failure, so that is
  what gets checked, and stderr goes to a log to be printed if it matters.
#>
function Invoke-Native {
  param([string]$What, [string]$Exe, [string[]]$Arguments, [string]$Log)
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    if ($Log) {
      & $Exe @Arguments 2> $Log
    } else {
      & $Exe @Arguments
    }
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($LASTEXITCODE -ne 0) {
    if ($Log -and (Test-Path $Log)) { Write-Host (Get-Content $Log -Raw) -ForegroundColor DarkGray }
    Fail "$What failed (exit code $LASTEXITCODE)"
  }
}

if (-not (Test-Path (Join-Path $Models 'guided.json'))) {
  Fail "No guided.json in '$Models' - that is the option schema, and without it this would export a viewer rather than a configurator."
}

# THE BUNDLE IS BUILT FIRST, and locally, so that what goes up is a folder you
# could have opened yourself. `--ar-route` is what puts the route in the
# manifest; without it the page would fall back to AR of the opening product
# only, and nothing would say so until somebody was standing in a room.
Write-Host "`n  exporting the bundle..." -ForegroundColor Cyan
Invoke-Native 'the export' 'node' @(
  'tools/export-bundle.mjs', '--guided', '--models', $Models, '--ar-route', '--out', $Out
)

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
Remove-Item $fn -ErrorAction SilentlyContinue
Invoke-Native 'the function bundle' 'npx' @(
  '--yes', 'esbuild', 'netlify/functions/ar.mjs', '--bundle', '--platform=node',
  '--format=esm', '--target=node20', '--minify', "--outfile=$fn"
) (Join-Path $env:TEMP 'confgr-esbuild.log')
if (-not (Test-Path $fn)) { Fail 'the AR function does not bundle, so it would fail on Netlify instead of here' }
Write-Host ("  function {0} kB + {1} MB of models" -f
  [math]::Round((Get-Item $fn).Length / 1KB, 1),
  [math]::Round(((Get-ChildItem (Join-Path $Out 'models') -File | Measure-Object Length -Sum).Sum) / 1MB, 2))

Write-Host "`n  deploying..." -ForegroundColor Cyan
Write-Host '  (first run only: a browser will open for you to authorise and name the site)'
# NOT $args: that is an automatic variable holding this script's own arguments,
# and writing to it is a quiet way to confuse the next person reading this.
$deploy = @('--yes', 'netlify-cli', 'deploy')
if (-not $Draft) { $deploy += '--prod' }

# NO stderr redirection here, deliberately. This one is INTERACTIVE on the
# first run - it opens a browser and asks which site to use - so its output has
# to reach the window rather than a log, and its prompts have to reach the
# keyboard.
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { & npx @deploy } finally { $ErrorActionPreference = $previous }

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
