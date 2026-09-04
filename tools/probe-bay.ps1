# Build a real YouK bay in the app and capture it.
#
#     powershell -ExecutionPolicy Bypass -File tools/probe-bay.ps1
#
# frame -> 900 shelf -> frame, then a hung tray and hook strip, all driven by
# real clicks through the same raycast-to-attach path a user takes, and then
# screenshotted. The point is that this cannot report success without having
# done the thing: it prints the app's own status line at each step, so the part
# and joint counts are the app's claim, not this script's.
#
# For the geometry - does the metal actually fit - use tools/check-joint.py.
# This answers a different question: does the app let you build it.
#
# electron/main.js loads localhost:5174 whenever the app is unpackaged, so vite
# must be up before electron starts. concurrently -k also kills vite on exit -
# a vite left listening on 5174 is what broke this twice.

param([ValidateSet('bay', 'run')] [string]$Scenario = 'bay')

Set-Location (Join-Path $PSScriptRoot '..')

# Clear a stale vite first, otherwise the run fails on the port rather than on
# anything to do with the models.
$stale = Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue |
         Select-Object -ExpandProperty OwningProcess -Unique
foreach ($p in $stale) {
  $proc = Get-Process -Id $p -ErrorAction SilentlyContinue
  if ($proc) { "killing stale $($proc.ProcessName) $($proc.Id) on 5174"; Stop-Process -Id $p -Force }
}
if ($stale) { Start-Sleep -Seconds 1 }

# The app loads whatever .glb sits in test-assets. Take exactly the parts the
# spec has authored - anything else is still NO_SNAPS and would only clutter the
# palette. Reading the spec rather than a second list here means the two cannot
# drift apart. These copies are gitignored: derived supplier geometry.
$spec = Get-Content 'youk\snap-spec.json' -Raw | ConvertFrom-Json
$ids = @($spec.frames + $spec.span + $spec.hang | Select-Object -ExpandProperty id)
"--- copying $($ids.Count) snapped YouK components into test-assets ---"
foreach ($id in $ids) {
  if (Test-Path "youk\$id.glb") { Copy-Item "youk\$id.glb" "test-assets\$id.glb" -Force }
  else { "  MISSING youk\$id.glb - run the converter, then tools/add-snaps.py" }
}

$env:CONFGR_DEMO = '236758-ladder-depth-320mm'
$env:CONFGR_CAPTURE = (Join-Path (Get-Location) "youk\$Scenario.png")
$env:CONFGR_CAPTURE_DELAY = '11000'
# Shelf onto the anchored frame, a second frame onto the shelf's far plug, then
# a tray and a hook strip hung on whatever rung faces are still free. After the
# second frame the app should report 3 parts, 2 joints, 14 open points - 7
# unused sockets on each frame, the shelf's two plugs both taken.
# Marker order is per instance then per snap, so with the bay just built markers
# 0..6 are the first frame's free rung faces and 7..13 the second frame's. Two
# consequences worth choosing deliberately rather than taking marker 0 each time:
#   - the clothes rail goes on an INNER face (3), or it attaches to one frame
#     and its far plug dangles into open space. Correct behaviour, poor picture.
#   - the tray hangs 158.5mm below its hook, so on rung 1 it ends up through the
#     floor. Also correct, also a poor picture.
#
# The "run" scenario is the other question: a real YouK installation is several
# bays side by side, and the chain that makes one bay should make three without
# any new engine work. frame -> shelf -> frame -> shelf -> frame, then a shelf
# on the upper rungs of each bay. If the chain is right the frames come out
# evenly spaced and every shelf lands level; if it is not, the error compounds
# down the run and is obvious.
$clicks = @{
  bay = 'dump,part:008563,marker:0,dump,part:236758,marker:0,dump,' +
        'part:008531,marker:3,dump,part:008543,marker:5,dump,' +
        'part:008547,marker:2,dump,part:008537,marker:9,dump'
  run = 'part:008563,marker:0,part:236758,marker:0,dump,' +
        'part:008563,marker:7,part:236758,marker:0,dump,' +
        'part:008563,marker:3,part:008563,marker:10,dump,layout'
}
$env:CONFGR_CLICK = $clicks[$Scenario]

"--- running ---"
$out = & npx concurrently -k -s first "vite" "wait-on tcp:5174 && electron ." 2>&1 | Out-String
$out | Out-File (Join-Path (Get-Location) 'youk\bay-run.txt') -Encoding utf8

# The layout dump is multi-line, so its continuation lines carry no [click]
# prefix - match them too or the only interesting output gets filtered away.
$out -split "`r?`n" |
  Where-Object { $_ -match '\[click\]|\[capture\]|\[renderer:error|ERROR|refus|blocked|@ -?\d|instances$|connections$' } |
  Select-Object -First 80
"--- full log: youk\bay-run.txt ---"
