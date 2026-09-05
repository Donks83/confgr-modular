# Every authored YouK joint, checked against the metal.
#
#     npm run joints
#
# One line per part: does its bearing face land on the rung, and does anything
# end up inside the rung. Run it after any change to youk/snap-spec.json - a
# wrong number there produces a model that assembles confidently and wrongly,
# and this is the only thing that would notice.

$py = 'tools/.venv-step/Scripts/python'
Set-Location (Join-Path $PSScriptRoot '..')
$f320 = 'youk/236758-ladder-depth-320mm.glb'
$f200 = 'youk/236746-leiterregal-ladder-depth-200mm.glb'
foreach ($job in @(
  @($f320, 'youk/008561-shelf-450mm-for-ladder-depth-320mm.glb', 'mount-left', 'rung-1-right'),
  @($f320, 'youk/008563-shelf-900mm-for-ladder-depth-320mm.glb', 'mount-left', 'rung-1-right'),
  @($f320, 'youk/008530-clothes-rail-600mm.glb', 'mount-left', 'rung-3-right'),
  @($f320, 'youk/008531-clothes-rail-900mm.glb', 'mount-left', 'rung-3-right'),
  @($f320, 'youk/008532-clothes-rail-1200mm.glb', 'mount-left', 'rung-3-right'),
  @($f320, 'youk/008538-hook-strip-for-ladder-width-450mm.glb', 'mount-left', 'rung-3-right'),
  @($f320, 'youk/008540-hook-strip-for-ladder-width-900mm.glb', 'mount-left', 'rung-3-right'),
  @($f320, 'youk/008541-hook-strip-for-ladder-width-1200mm.glb', 'mount-left', 'rung-3-right'),
  @($f320, 'youk/008537-hook-strip-for-ladder-depth-320mm.glb', 'mount', 'rung-1-right'),
  @($f320, 'youk/008543-rack-for-ladder-depth-320mm.glb', 'mount', 'rung-1-right'),
  @($f320, 'youk/008546-youboxx-set-3.glb', 'mount', 'rung-3-right'),
  @($f320, 'youk/008547-youboxx-set-4.glb', 'mount', 'rung-3-right'),
  @($f320, 'youk/008548-youboxx-set-5.glb', 'mount', 'rung-3-right'),
  @($f200, 'youk/008536-hook-strip-for-ladder-depth-200mm.glb', 'mount', 'rung-1-right'),
  @($f200, 'youk/008542-rack-for-ladder-depth-200mm.glb', 'mount', 'rung-1-right'),
  @($f200, 'youk/008545-youboxx-set-2.glb', 'mount', 'rung-3-right'),
  @($f200, 'youk/008549-newspaper-towel-rack-set-fpr-ladder-depth-200mm.glb', 'mount', 'rung-1-right')
)) {
  & $py tools/check-joint.py $job[0] $job[1] --socket $job[3] --plug $job[2] |
    Select-String -Pattern 'child  youk|seating:|inside the member|deepest'
}
