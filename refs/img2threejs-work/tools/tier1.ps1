$py = "$env:LOCALAPPDATA\Programs\py312\python.exe"
$sk = "C:\Users\31273\.claude\skills\img2threejs"
$work = "D:\ROTK\three.js\img2threejs-work"
Set-Location $work

$pairs = @(
  @("blockout", "blockout"),
  @("structural-pass", "structural"),
  @("form-refinement", "form"),
  @("material-pass", "material"),
  @("lighting-pass", "lighting")
)
foreach ($pair in $pairs) {
  $pass = $pair[0]; $tag = $pair[1]
  $args = @("$sk\forge\stage4_review\diagnose_render.py",
            "--reference", "$work\analysis\tight\front-tight.png",
            "--render", "$work\shots\$tag-front.png",
            "--spec", "$work\object-sculpt-spec.json",
            "--pass-id", $pass, "--in-place")
  if ($pass -eq "blockout") {
    $args += @("--map-stripped-render", "$work\shots\blockout-unlit-front.png")
  }
  $out = & $py @args 2>&1 | Out-String
  $head = ($out -split "`n" | Select-Object -First 2) -join " | "
  Write-Output "$pass => $head"
}
