# Rebuild the spec, regenerate the factory, transpile, and shoot the requested views.
param(
  [string]$Tag = "blockout",
  [string]$Views = "front,right,back,threequarter",
  [string]$Light = "neutral",
  [string]$PassId = ""
)
$py = "$env:LOCALAPPDATA\Programs\py312\python.exe"
$sk = "C:\Users\31273\.claude\skills\img2threejs"
$work = "D:\ROTK\three.js\img2threejs-work"
Set-Location $work

& $py "$work\author_spec.py" | Out-Null
$strict = (& $py "$sk\forge\stage2_spec\validate_sculpt_spec.py" "$work\object-sculpt-spec.json" --strict-quality 2>&1 | Out-String)
if ($strict -notmatch "(?m)^PASS") { Write-Output "STRICT QUALITY FAILED"; $strict; exit 1 }
Write-Output "strict: PASS"

& $py "$sk\forge\stage3_build\orchestrate_passes.py" sync "$work\object-sculpt-spec.json" --in-place 2>&1 | Out-Null

$args = @("$sk\forge\stage3_build\generate_threejs_factory.py", "$work\object-sculpt-spec.json", "--out", "$work\src\createObjectModel.ts", "--force")
if ($PassId -ne "") { $args += @("--pass-id", $PassId) }
$gen = & $py @args 2>&1
Write-Output "generated: $gen"

node "$work\tools\transpile.cjs" "$work\src\createObjectModel.ts" "$work\render\createObjectModel.js" 2>$null | Out-Null
& powershell -ExecutionPolicy Bypass -File "$work\tools\shot.ps1" -Tag $Tag -Views $Views -Light $Light
