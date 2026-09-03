# Build the first real YouK bay in the app and capture it.
#
#     powershell -ExecutionPolicy Bypass -File tools/probe-bay.ps1
#
# frame -> 900 shelf -> frame, driven by real clicks through the same
# raycast-to-attach path a user takes, then screenshotted. The point is that
# this cannot report success without having done the thing: it prints the app's
# own status line at each step, so "3 parts, 2 joints" is the app's claim, not
# this script's.
#
# electron/main.js loads localhost:5174 whenever the app is unpackaged, so vite
# must be up before electron starts. concurrently -k also kills vite on exit -
# a vite left listening on 5174 is what broke this twice.

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

# The app loads whatever .glb sits in test-assets. These ten are the parts
# add-snaps.py has given snap planes; the other 35 are still NO_SNAPS and would
# only clutter the palette. They are gitignored - derived supplier geometry.
"--- copying the ten snapped YouK components into test-assets ---"
foreach ($id in @('236746-leiterregal-ladder-depth-200mm','236748-ladder-depth-2000mm',
                  '236750-ladder-depth-320mm','236754-ladder-depth-320mm',
                  '236758-ladder-depth-320mm','236762-ladder-depth-320mm',
                  '008561-shelf-450mm-for-ladder-depth-320mm','008562-shelf-600mm-for-ladder-depth-320mm',
                  '008563-shelf-900mm-for-ladder-depth-320mm','008564-shelf-1200mm-for-ladder-depth-320mm')) {
  if (Test-Path "youk\$id.glb") { Copy-Item "youk\$id.glb" "test-assets\$id.glb" -Force }
  else { "  MISSING youk\$id.glb - run npm run youk:convert, then add-snaps.py" }
}

$env:CONFGR_DEMO = '236758-ladder-depth-320mm'
$env:CONFGR_CAPTURE = (Join-Path (Get-Location) 'youk\bay.png')
$env:CONFGR_CAPTURE_DELAY = '9000'
# Shelf onto the anchored frame, then a second frame onto the shelf's far plug.
# After the second frame the app should report 3 parts, 2 joints, 14 open points
# - 7 unused sockets on each frame, the shelf's two plugs both taken.
$env:CONFGR_CLICK = 'dump,part:008563,dump,marker:0,dump,part:236758,dump,marker:0,dump'

"--- running ---"
$out = & npx concurrently -k -s first "vite" "wait-on tcp:5174 && electron ." 2>&1 | Out-String
$out | Out-File (Join-Path (Get-Location) 'youk\bay-run.txt') -Encoding utf8

$out -split "`r?`n" | Where-Object { $_ -match '\[click\]|\[capture\]|\[renderer:error|ERROR|refus|blocked' } |
  Select-Object -First 60
"--- full log: youk\bay-run.txt ---"
