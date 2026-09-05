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

param(
  [ValidateSet('bay', 'run', 'mount', 'palette', 'stagger', 'shared', 'hooks')] [string]$Scenario = 'bay',
  # Price the bill of materials from the FICTIONAL example list, so a demo shows
  # the maths working. Off by default: the real catalogue has no prices yet and
  # the panel should say so rather than show invented ones.
  [switch]$ExamplePrices,
  # Capture the whole window rather than just the 3D canvas, so the bill of
  # materials panel is in the picture too.
  [switch]$WholeWindow
)

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
  # `choose:0` after the second frame is not decoration. The frame can meet the
  # shelf's free end by any of its four rung heights, and the app now ASKS
  # rather than taking the first silently - so a script written against the old
  # behaviour stalls with the chooser open. Taking option 0 is the lowest rung,
  # which is what the old code picked by accident, so the bay comes out level.
  #
  # Marker indices moved too, and for a good reason: a rung that carries a shelf
  # stays open underneath, so there are more live points than before.
  bay = 'dump,part:008563,marker:0,dump,part:236758,marker:0,choose:0,dump,' +
        'part:008531,marker:4,dump,part:008543,marker:6,dump,' +
        'part:008547,marker:2,dump,part:008537,marker:11,dump,layout'
  # Same reason for the choose:0 steps here: every frame joining a shelf's free
  # end is now a question, and a level run is the lowest rung each time.
  run = 'part:008563,marker:0,part:236758,marker:0,choose:0,dump,' +
        'part:008563,marker:8,part:236758,marker:0,choose:0,dump,' +
        'part:008563,marker:4,part:008563,marker:12,dump,layout,quote'
  # Floor standing vs floating. Builds a two-part product, reads the ground out
  # of the SCENE, drives the real dropdown, then reads it back. The `ground`
  # step reports grid and shadow-catcher visibility from three.js rather than
  # from React state, so a dropdown that changed and did nothing else shows up
  # as grid=true after mount:wall instead of as a pass.
  mount = 'part:008563,marker:0,ground,mount:wall,ground,mount:feet,ground,mount:floor,ground'
  # What the palette actually says. Kesseboehmer's English filenames drop the
  # height on four of the six ladders, so the model ids alone read as the same
  # part four times over. The label has to come from the catalogue, and this is
  # the only way to see it without squinting at a screenshot.
  palette = 'palette:26'
  # The width hook strips, which is what Matt was missing when he said the hooks
  # looked wrong. Build a bay, then hang a 900 strip across it: it should ask
  # nothing (one distinct outcome) and land level, spanning the same 920.1mm the
  # 900 shelf sets. If it turns up depthways on one frame, it went in the hang
  # family by mistake.
  hooks = 'part:008563,marker:0,part:236758,marker:0,choose:0,dump,' +
          'part:008540,marker:4,dump,layout'
  # The bug Matt hit. Anchor a 1500 frame, hang a 900 shelf on it, then offer a
  # second frame at the shelf's free end. The engine has always found several
  # placements there - one per rung of the arriving frame - and the UI used to
  # take the first silently, so only one of the staggered layouts in
  # Kesseboehmer's own photography was reachable. `choices` prints what is on
  # offer; `choose:3` takes a rung that is NOT the first, and `layout` proves
  # the second frame landed at a different height because of it.
  stagger = 'part:008563,marker:0,dump,part:236758,marker:0,choices,choose:3,dump,layout'
  # One rung, two parts. Kesseboehmer's suspension-elements and hook-rail sheets
  # both show a shelf resting on a rung with an accessory hooked over the SAME
  # rung hanging beneath, bolted together through a 1.5mm packer. The engine
  # used to close a rung the moment anything touched it, so this configuration
  # could not be built. Shelf on marker 0, then a rack aiming at the same rung.
  shared = 'part:008563,marker:0,dump,part:008543,marker:0,dump,layout'
}
$env:CONFGR_CLICK = $clicks[$Scenario]

if ($ExamplePrices) {
  # Generated on demand rather than committed. Invented prices in git are
  # indistinguishable from real ones a year later, and this takes a second.
  if (-not (Test-Path 'youk\catalogue.example.json')) { node tools/make-example-prices.mjs }
  $env:CONFGR_CATALOGUE = (Join-Path (Get-Location) 'youk\catalogue.example.json')
  "--- pricing from FICTIONAL example list: $($env:CONFGR_CATALOGUE) ---"
} else {
  Remove-Item Env:\CONFGR_CATALOGUE -ErrorAction SilentlyContinue
}

if ($WholeWindow) { $env:CONFGR_CAPTURE_WINDOW = '1' }
else { Remove-Item Env:\CONFGR_CAPTURE_WINDOW -ErrorAction SilentlyContinue }

"--- running ---"
$out = & npx concurrently -k -s first "vite" "wait-on tcp:5174 && electron ." 2>&1 | Out-String
$out | Out-File (Join-Path (Get-Location) 'youk\bay-run.txt') -Encoding utf8

# The layout dump is multi-line, so its continuation lines carry no [click]
# prefix - match them too or the only interesting output gets filtered away.
$out -split "`r?`n" |
  Where-Object { $_ -match '\[click\]|\[capture\]|\[renderer:error|ERROR|refus|blocked|@ -?\d|=>|instances$|connections$' } |
  Select-Object -First 80
"--- full log: youk\bay-run.txt ---"
