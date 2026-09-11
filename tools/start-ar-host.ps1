# Put a bundle on the internet, with AR that follows the options.
#
#   Double-click "Start AR host.bat", or:
#   powershell -ExecutionPolicy Bypass -File tools\start-ar-host.ps1 [-Bundle <folder>]
#
# WHY THIS EXISTS. The AR route (5.25) only works while something is serving it
# over https: Scene Viewer fetches the model in its own process and cannot see a
# laptop's localhost, and Quick Look will not take a file:// page either. So a
# phone test needs two processes running - the host and a tunnel - and until now
# both were started by hand, by me, which meant the link died whenever this
# machine slept and only came back when somebody asked.
#
# NOT A DEPLOYMENT. A Cloudflare quick tunnel needs no account and costs
# nothing, and in exchange the subdomain is four random words that CHANGE EVERY
# TIME this is run. That is fine for holding a phone next to a laptop and no use
# at all for a link you send a client. The fix for that is a named tunnel on a
# domain, or a small paid host, and it is a decision about money rather than
# code.
#
# Closing this window stops both processes and the link goes dead.

param(
  [string]$Bundle = 'C:\Claude\bundle-config',
  [string]$Models = '',
  [int]$Port = 8124
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Models) { $Models = Join-Path $Bundle 'models' }

function Fail($message) { Write-Host "`n  $message`n" -ForegroundColor Red; Read-Host 'Enter to close'; exit 1 }

if (-not (Test-Path (Join-Path $Bundle 'manifest.json'))) {
  Fail "No manifest.json in $Bundle - is that a bundle folder?"
}

$manifest = Get-Content (Join-Path $Bundle 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $manifest.ar.route) {
  # Said plainly rather than left to be discovered on the phone. Without a route
  # in the manifest the page never asks this host to build anything, so AR is
  # offered for the opening product and withheld after that - which looks
  # exactly like this script not working.
  Write-Host "`n  NOTE: this bundle's manifest has no ar.route, so AR will still" -ForegroundColor Yellow
  Write-Host '  cover only the product it opens on. Re-export with --ar-route:' -ForegroundColor Yellow
  Write-Host "    node tools/export-bundle.mjs --guided --models youk --ar-route --out $Bundle`n" -ForegroundColor Yellow
}

$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
if (-not (Test-Path $cloudflared)) { Fail "cloudflared is not at $cloudflared" }

# Anything already holding the port is a previous run of this script, and
# leaving it there would serve a stale bundle from a URL that looks new.
Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

$logs = Join-Path $env:TEMP 'confgr-ar-host'
New-Item -ItemType Directory -Force -Path $logs | Out-Null
$serverOut = Join-Path $logs 'server.log'
$serverErr = Join-Path $logs 'server.err'
$tunnelOut = Join-Path $logs 'tunnel.log'
$tunnelErr = Join-Path $logs 'tunnel.err'
Remove-Item $serverOut, $serverErr, $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue

Write-Host "`n  bundle   $Bundle"
Write-Host "  models   $Models"
Write-Host "  starting the host..."

$server = Start-Process -FilePath node `
  -ArgumentList 'tools/serve-ar.mjs', $Bundle, "$Port", '--models', $Models `
  -WorkingDirectory $root -RedirectStandardOutput $serverOut -RedirectStandardError $serverErr `
  -WindowStyle Hidden -PassThru
Start-Sleep 3
if ($server.HasExited) { Write-Host (Get-Content $serverErr -Raw); Fail 'the host did not start' }

# THE LAN ADDRESS IS THE RELIABLE ONE, and it is printed whatever the tunnel
# does. A phone on the same wifi can open this machine directly, Scene Viewer is
# satisfied by any absolute http(s) URL (a LAN one included - that is what the
# 5.23 tests assert), and none of it depends on DNS, Cloudflare or the internet
# being in a good mood. The tunnel exists for a phone somewhere else.
$lan = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^(127\.|169\.254\.)' } |
  Select-Object -ExpandProperty IPAddress)
$lanUrl = if ($lan) { "http://$($lan[0]):$Port" } else { $null }

# A quick tunnel is TWO things that can fail apart: the tunnel registers with
# Cloudflare, and the random four-word name becomes resolvable. The second one
# really does fail - names have come back with AAAA records and NO A record, and
# this machine's resolver served nothing at all for them, so a tunnel whose own
# log said "Registered tunnel connection" was unreachable from the laptop that
# started it. Twice in a row, which is a pattern rather than a fluke.
#
# Since the name is thrown away on every run, the cure is to take another one -
# and to check for an IPv4 record BEFORE trusting it, because that is the thing
# that was actually missing and a plain fetch cannot tell "no A record" apart
# from "not propagated yet".
$url = $null
$tunnel = $null
$ok = $false

foreach ($attempt in 1..3) {
  if ($tunnel) {
    Write-Host "  that name is not resolving - taking another one (attempt $attempt)..."
    Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
    Remove-Item $tunnelOut, $tunnelErr -ErrorAction SilentlyContinue
    Start-Sleep 2
  } else {
    Write-Host '  opening the tunnel...'
  }

  $tunnel = Start-Process -FilePath $cloudflared -ArgumentList 'tunnel', '--url', "http://localhost:$Port" `
    -RedirectStandardOutput $tunnelOut -RedirectStandardError $tunnelErr -WindowStyle Hidden -PassThru

  # cloudflared prints the URL to stderr, inside a box, after a few seconds.
  $url = $null
  foreach ($wait in 1..30) {
    Start-Sleep 1
    $hit = Select-String -Path $tunnelErr, $tunnelOut -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -ErrorAction SilentlyContinue |
      Select-Object -Last 1
    if ($hit) { $url = $hit.Matches[0].Value; break }
  }
  if (-not $url) { Write-Host (Get-Content $tunnelErr -Raw); Fail 'the tunnel did not report a URL' }

  # Proved rather than assumed: a tunnel that is up and a host that answers are
  # two different things, and the useless version of this script is one that
  # prints a URL nobody has asked a question of. `manifest.json` rather than the
  # page, because it is the smallest thing that proves BOTH ends.
  $host4 = ([Uri]$url).Host
  foreach ($wait in 1..6) {
    $a = @(Resolve-DnsName $host4 -Type A -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -and $_.IPAddress -notmatch ':' })
    if (-not $a) { Start-Sleep 4; continue }
    try {
      if ((Invoke-WebRequest "$url/manifest.json" -UseBasicParsing -TimeoutSec 15).StatusCode -eq 200) {
        $ok = $true
        break
      }
    } catch { Start-Sleep 4 }
  }
  if ($ok) { break }
}

Write-Host ''
Write-Host '  ============================================================'
Write-Host '   ON YOUR OWN WIFI  (the one that always works)'
Write-Host "   $lanUrl" -ForegroundColor Green
Write-Host ''
Write-Host '   FROM ANYWHERE      (Cloudflare, new name every run)'
if ($ok) {
  Write-Host "   $url" -ForegroundColor Green
} else {
  Write-Host "   $url" -ForegroundColor DarkYellow
  Write-Host '   ^ three names tried and none resolved from this machine, so' -ForegroundColor DarkYellow
  Write-Host '     use the wifi address above. A phone may still reach it.' -ForegroundColor DarkYellow
}
Write-Host '  ============================================================'
Write-Host ''
Write-Host "  AR follows   $(if ($manifest.ar.route) { 'every option (route: ' + $manifest.ar.route + ')' } else { 'ONLY the opening product - see the note above' })"
Write-Host '  Either address is fine for AR: Scene Viewer wants an absolute'
Write-Host '  http(s) URL, and a wifi address is one.'
Write-Host ''
Write-Host '  Neither is a link to SEND anybody - the wifi one only works in'
Write-Host '  this house, and the Cloudflare name changes every run.'
Write-Host ''
Write-Host '  Closing this window stops both and both links go dead.'
Write-Host ''
try {
  ($(if ($ok) { $url } else { $lanUrl })) | Set-Clipboard
  Write-Host '  (the working one is on the clipboard)'
} catch { }
Write-Host ''
Read-Host '  Enter to stop'

Stop-Process -Id $tunnel.Id -Force -ErrorAction SilentlyContinue
Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
Write-Host '  stopped.'
