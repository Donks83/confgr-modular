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
  [ValidateSet('bay', 'run', 'mount', 'palette', 'stagger', 'shared', 'hooks', 'wallfixed',
               'cabinets', 'carcase', 'office', 'officetilt', 'officeclamp',
               'condition', 'timber')]
  [string]$Scenario = 'bay',
  # An ad-hoc click string, used INSTEAD of the named scenario. For working out
  # what a marker index actually refers to before writing a scenario around it -
  # marker order is per instance then per snap, so it shifts as the scene grows
  # and reading it off the source is guesswork. Nothing here should be committed
  # as a claim; promote it to a named scenario once it says something.
  # (Named -Steps, not -Clicks: PowerShell variable names are case-insensitive,
  # so a -Clicks parameter IS the $clicks scenario hashtable below, and the
  # hashtable literal silently overwrites whatever was passed in.)
  [string]$Steps = '',
  # Which part the app anchors the product on. Almost always the 1500 frame, but
  # a rule that says "not on a short ladder" cannot be tested on a tall one.
  [string]$Demo = '236758-ladder-depth-320mm',
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
# Every family, found rather than listed - see the same fix in
# tools/make-catalogue.mjs and why it is worth making. A named list here went
# stale twice, and the second time the app booted with 24 parts missing from the
# palette and nothing said so.
$ids = @($spec.PSObject.Properties |
         Where-Object { $_.Value -is [array] -and $_.Value.Count -and $_.Value[0].PSObject.Properties.Name -contains 'id' } |
         ForEach-Object { $_.Value } |
         Select-Object -ExpandProperty id)
"--- copying $($ids.Count) snapped YouK components into test-assets ---"
foreach ($id in $ids) {
  if (Test-Path "youk\$id.glb") { Copy-Item "youk\$id.glb" "test-assets\$id.glb" -Force }
  else { "  MISSING youk\$id.glb - run the converter, then tools/add-snaps.py" }
}

$env:CONFGR_DEMO = $Demo
$captureName = if ($Steps) { 'steps' } else { $Scenario }
$env:CONFGR_CAPTURE = (Join-Path (Get-Location) "youk\$captureName.png")
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
  palette = 'palette:76'
  # Timber. The claim is that a bay carries either a metal shelf or a timber one,
  # so this builds the bay with a TIMBER 900 and then hangs a metal 900 on the
  # rung above. If the two disagree about bay width the second one will not fit,
  # or will fit somewhere unintended - which is what a tenth of a millimetre in
  # the generator would have caused. Marker 3 is frame 1's rung-3 RIGHT face,
  # i.e. inside the bay: the free faces come out paired left/right per rung, so
  # even indices face out of the bay and odd ones into it. Read off the app, not
  # off the spec file - see the -Steps switch.
  timber = 'part:pws-timber-shelf-900mm-for-ladder-depth-320mm,marker:0,' +
           'part:236758,marker:0,choose:0,dump,' +
           'part:008563,marker:3,dump,layout'
  # Cabinet brackets. Two outer brackets on the two frames of a bay, which is
  # what a carcase sits on. They are hang parts - each mounts on ONE frame and
  # cantilevers - so each should add a part and a joint, and land 6.5mm below
  # its rung (8mm plate less the 1.5mm top sheet).
  cabinets = 'part:008563,marker:0,part:236758,marker:0,choose:0,dump,' +
             'part:008558,marker:0,dump,part:008558,marker:9,dump,layout'
  # The carcase, and the first vertical joint in the range. A bay, two cabinet
  # brackets, then a 900 box LAID ON them - it meets nothing edge-on, which the
  # engine refused outright until solveChildTransform learned about flat faces.
  #
  # Two things this has to show. The box must add a JOINT, not just a part: if
  # the count goes up without one it has been parked in free space and the
  # bracket socket was never used. And it must land centred on the bay at
  # 460.05, because its width is derived from the brackets' own plug offset -
  # if that derivation is wrong the far end hangs off the second bracket and
  # the picture looks fine from one side.
  # Markers 4 and 11 put both brackets on RUNG 3 of their own ladder. Taking 0
  # twice does not: the second bracket lands on the next free face, which is a
  # different rung, and a carcase across two brackets 355mm apart is not a
  # carcase. The `cabinets` scenario above has that flaw and its comment did not
  # notice - worth knowing before reading it as a passing check.
  carcase = 'part:008563,marker:0,part:236758,marker:0,choose:0,' +
            'part:008558,marker:4,part:008558,marker:11,dump,' +
            'part:pws-timber-cabinet-900mm-h450mm-for-ladder-depth-320mm,marker:0,' +
            'choices,choose:0,dump,layout'
  # The office solution, all four joints of it. Bay, a PLATE hooked on rung 3 of
  # each ladder, an ARM bolted to each plate, then the desktop laid on the arms.
  #
  # Every one of those is a different joint: the plate hooks a rung (hang), the
  # arm bolts to a face (bolted, and the family that exists because the arm was
  # once wrongly authored as hooking a rung), the desktop is laid on top
  # (vertical). Three of the five families in one four-part assembly.
  #
  # Numbers to watch: plates at 3.6 and 916.5 - mirrored, so the same part serves
  # both ladders - arms at 42.3 and 877.9, and the desktop CENTRED between them
  # at 460.1. That last one is the check that its width follows the whole chain
  # rather than one bracket: it was 890.1mm wide when the arm was thought to hook
  # a rung and it overshot the far arm by 54.5mm while looking entirely right.
  #
  # And z 145.0, not 0: a 600mm desktop on a 320mm ladder cannot sit centred on
  # its brackets, so its plugs hang 140mm behind its own middle and its back edge
  # lands on the wall line - step 6's tick and cross. Centred would put 140mm of
  # desk inside the wall and still look fine from the front.
  office = 'part:008563,marker:0,part:236758,marker:0,choose:0,' +
           'part:008551-base-brackets,marker:0,part:008551-base-brackets,marker:3,' +
           'part:008551-shelf-supports,marker:0,choose:0,' +
           'part:008551-shelf-supports,marker:1,choose:0,dump,' +
           'part:pws-timber-desktop-900mm-d600mm,marker:0,choices,choose:0,dump,layout'
  # The same desk as a drawing board. Identical clicks except `choose:1` at each
  # arm, which takes the tilted bolt hole instead of the level one - Kesseboehmer
  # sell both from the same kit and the plate's second hole pair is 9.000 degrees
  # off the first.
  #
  # Two things it proves. The arms drop from y 575.0 to 554.9, which is the roll
  # actually being applied rather than declared and ignored. And the desktop
  # RESOLVES at all: its underside is exactly vertical, the tilted arm's top face
  # is not, and the solver refused that pairing outright until it learned to
  # align two facings by the shortest arc instead of by yaw alone.
  officetilt = 'part:008563,marker:0,part:236758,marker:0,choose:0,' +
               'part:008551-base-brackets,marker:0,part:008551-base-brackets,marker:3,' +
               'part:008551-shelf-supports,marker:0,choose:1,' +
               'part:008551-shelf-supports,marker:1,choose:1,dump,' +
               'part:pws-timber-desktop-900mm-d600mm,marker:0,choose:0,dump,layout'
  # Office solution step 4: a CLAMPING ANGLE on each arm, before the desktop goes
  # on. It bolts to the arm's rear end through a vertical slot and stands up as
  # the upstand the board's back edge has to sit against - step 6's tick and
  # cross. Second part in the range to bolt to a face, and the first to prove a
  # part can host one bolted joint while being bolted on by another: the arm is
  # a `bolted` part on its web AND a bolted HOST on its end, two masks, one part.
  #
  # Numbers to watch: the angle's foot underside lands at 76.5mm above the arm's
  # base, which is the top of a 25mm board sitting on the 1.5mm packer. In world
  # terms with the arms at y 575.0 that is y 651.5 - Kesseboehmer's own 650.
  officeclamp = 'part:008563,marker:0,part:236758,marker:0,choose:0,' +
                'part:008551-base-brackets,marker:0,part:008551-base-brackets,marker:3,' +
                'part:008551-shelf-supports,marker:0,choose:0,' +
                'part:008551-shelf-supports,marker:1,choose:0,dump,' +
                'part:008551-clamping-angles,marker:0,' +
                'part:008551-clamping-angles,marker:0,dump,' +
                'part:pws-timber-desktop-900mm-d600mm,marker:0,choose:0,dump,layout'
  # The `condition` field's first use, on a 1500 frame. The office PLATE may only
  # be fitted at rung 3 and above, so a bare 1500 ladder should offer it FOUR
  # markers (rungs 3 and 4, two faces each) where a shelf gets twelve. If it
  # offers twelve the rule is not being read; if it offers none it is failing
  # closed on something and the message will say which.
  #
  # It was the ARM until the arm turned out not to touch a rung at all. The rule
  # is the same and it always belonged to whichever part meets the ladder.
  #
  # Run the other half by hand, because the anchor has to change:
  #     -Demo 236750-ladder-depth-320mm -Steps "part:008551-base-brackets,dump"
  # The 550 frame has only rungs 1 and 2, both forbidden, so the plate is
  # disabled outright - the knock-on Kesseboehmer's sheet implies and never
  # states, and with it the whole desk becomes unbuildable on a short ladder.
  condition = 'part:008551-base-brackets,marker:0,dump,layout'
  # The shoe rack, which joins nothing. Build a bay, then add a 900 rack: it
  # should go straight in without waiting for a marker, add NO joint, and land
  # centred on the bay. If the joint count goes up, it has been attached to
  # something and the whole point has been missed.
  wallfixed = 'part:008563,marker:0,part:236758,marker:0,choose:0,dump,' +
              'part:008555,dump,layout'
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
$env:CONFGR_CLICK = if ($Steps) { $Steps } else { $clicks[$Scenario] }
if ($Steps) { "--- ad-hoc steps, not scenario '$Scenario' ---" }

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
