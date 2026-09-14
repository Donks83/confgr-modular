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
  [switch]$Draft,
  # Report what is and is not ready, and change nothing. Useful on its own, and
  # it is how this script gets tested without signing anybody in.
  [switch]$CheckOnly
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

# EVERYTHING IS WRITTEN DOWN, because the first two failures of this script were
# both diagnosed by guesswork from a screenshot. A transcript costs nothing and
# turns "it says Terminate batch job" into a file somebody can read.
$log = Join-Path $env:TEMP ('confgr-deploy-{0:yyyyMMdd-HHmmss}.log' -f (Get-Date))
try { Start-Transcript -Path $log -Force | Out-Null } catch { }
Write-Host "  log: $log" -ForegroundColor DarkGray

if (-not (Test-Path (Join-Path $Models 'guided.json'))) {
  Fail "No guided.json in '$Models' - that is the option schema, and without it this would export a viewer rather than a configurator."
}

<#
  ARE YOU SIGNED IN? Asked FIRST, and this is the whole of the second bug.

  Netlify's CLI signs you in by opening a browser and then waiting, silently,
  for as long as it takes. Run from a double-clicked batch window that looks
  identical to a hung program - so it gets Ctrl+C, and cmd.exe answers with
  "Terminate batch job (Y/N)?", which says nothing about Netlify, nothing about
  signing in, and nothing about the script having got as far as it did.

  Checked before the two minutes of exporting, too: being told to sign in should
  not cost a bundle build first.
#>
Write-Host '  checking you are signed in to Netlify...' -ForegroundColor Cyan
$statusLog = Join-Path $env:TEMP 'confgr-netlify-status.log'
$previous = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
try { & npx --yes netlify-cli status *> $statusLog } finally { $ErrorActionPreference = $previous }

# `??` is PowerShell 7 and the .bat launches Windows PowerShell 5.1, which
# would fail on it at PARSE time - before a single line ran, and therefore
# before the transcript, the trap, or any message at all. Exactly the failure
# this script keeps being caught by.
function Read-Log($path) {
  $text = Get-Content $path -Raw -ErrorAction SilentlyContinue
  if ($null -eq $text) { '' } else { $text }
}
$status = Read-Log $statusLog

if ($CheckOnly) {
  # Named precisely. "Signed in to Netlify" is ambiguous and the ambiguity is
  # the bug: the website and the command line tool sign in separately.
  Write-Host ("  command line tool signed in: {0}" -f $(if ($status -match 'Not logged in') { 'NO - it will ask for a token or open a browser' } else { 'yes' }))
  Write-Host "  models:    $Models"
  Write-Host "  publish:   $Out"
  Write-Host ''
  try { Stop-Transcript | Out-Null } catch { }
  exit 0
}

if ($status -match 'Not logged in') {
  <#
    TWO DIFFERENT SIGN-INS, and conflating them cost Matt an evening. He was
    signed in to app.netlify.com in Chrome, saw this script say "you are not
    signed in to Netlify", and reasonably replied that he was. He was right.
    The COMMAND LINE TOOL on this machine keeps its own token, in
    %APPDATA%\netlify, and a browser session is not it.

    So the message says which one, and offers the route that involves no
    waiting at all: a token pasted in. `netlify login` opens a browser and then
    blocks silently, which is the thing that already got Ctrl+C'd twice.
  #>
  Write-Host ''
  Write-Host '  Step 1 of 2: the Netlify COMMAND LINE TOOL on this PC is not' -ForegroundColor Yellow
  Write-Host '  signed in yet. That is separate from being signed in to' -ForegroundColor Yellow
  Write-Host '  netlify.com in your browser, which you may well already be.' -ForegroundColor Yellow
  Write-Host ''
  Write-Host '  Quickest way, no waiting:'
  Write-Host '    1. Open app.netlify.com/user/applications#personal-access-tokens'
  Write-Host '    2. "New access token", give it any name, copy it'
  Write-Host '    3. Paste it below'
  Write-Host ''
  Write-Host '  Or press Enter with nothing pasted, and a browser will open for'
  Write-Host '  you to click Authorise instead. That way WAITS SILENTLY until'
  Write-Host '  you have finished in the browser, which is normal - the silence'
  Write-Host '  is not a hang, so do not press Ctrl+C.' -ForegroundColor Yellow
  Write-Host ''
  $token = Read-Host '  Token (or Enter for the browser)'

  if ($token -and $token.Trim()) {
    # Held for this run only, in this process. Persisting somebody's token is
    # their decision to make deliberately, not a side effect of a deploy
    # script, and `setx` would put it in the registry for every program on the
    # machine to read.
    $env:NETLIFY_AUTH_TOKEN = $token.Trim()
    Write-Host '  using that token for this run' -ForegroundColor Green
    Write-Host '  (to avoid pasting it every time, set NETLIFY_AUTH_TOKEN as a'
    Write-Host '   Windows user environment variable yourself)'
  } else {
    Write-Host ''
    Write-Host '  opening the browser - click Authorise, then come back here...' -ForegroundColor Cyan
    $ErrorActionPreference = 'Continue'
    try { & npx --yes netlify-cli login } finally { $ErrorActionPreference = $previous }
  }

  try { & npx --yes netlify-cli status *> $statusLog } finally { $ErrorActionPreference = $previous }
  $status = Read-Log $statusLog
  if ($status -match 'Not logged in') {
    # The `+` stays at the END of the line: PowerShell ends the expression at a
    # line break, so a leading `+` on the next line is a parse error - which is
    # the third time this file has been caught by 5.1 syntax, and the third
    # time the parse check found it rather than Matt.
    Fail ('the command line tool still is not signed in. If you pasted a token, ' +
      'check it was copied whole; if you used the browser, check the Authorise step finished.')
  }
}

$account = ([regex]::Match($status, 'Email:\s*(\S+)')).Groups[1].Value
Write-Host ("  signed in{0}" -f $(if ($account) { " as $account" } else { '' })) -ForegroundColor Green

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

<#
  THE FUNCTION IS BUNDLED HERE, not by Netlify, for one reason: the alias.

  `@gltf-transform/functions` declares `sharp` as a dependency and never imports
  it - both mentions in its source are inside doc comments. But sharp is NATIVE,
  so Netlify's own bundler shipped it as an external module and the deployed
  function died on load, twice: first the Windows binary on a Linux runtime,
  then "libvips-cpp.so.8.18.6: cannot open shared object file". Two 502s for a
  library that is never called.

  Aliasing it to a stub here removes it from the graph entirely, so there is no
  native module left to get wrong. See netlify/build/sharp-stub.mjs.

  NOT MINIFIED, deliberately: Netlify reads `export const config` STATICALLY to
  learn which URLs the function claims, and static analysis of minified code is
  a risk taken for nothing - 1.3 MB either way, once gzipped over the wire.
#>
Write-Host '  bundling the function (without sharp)...' -ForegroundColor Cyan
$fn = 'netlify/functions/ar.mjs'
Remove-Item $fn -ErrorAction SilentlyContinue
Invoke-Native 'the function bundle' 'npx' @(
  '--yes', 'esbuild', 'netlify/build/ar.src.mjs', '--bundle', '--platform=node',
  '--format=esm', '--target=node20', "--outfile=$fn",
  '--alias:sharp=./netlify/build/sharp-stub.mjs'
) (Join-Path $env:TEMP 'confgr-esbuild.log')
if (-not (Test-Path $fn)) { Fail 'the AR function does not bundle, so it would fail on Netlify instead of here' }

# Asserted rather than assumed, because this exact import is what took the site
# down twice and the symptom was a 502 with no clue in it.
if ((Get-Content $fn -Raw) -match '(from|require\(|import\()\s*[''"]sharp[''"]') {
  Fail 'the bundle still imports sharp, so the deployed function would 502 on load'
}
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
