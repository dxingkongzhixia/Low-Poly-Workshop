param(
  [string]$Tag = "pass",
  [string]$Views = "front,right,back,threequarter",
  [string]$Light = "neutral",
  [string]$Extra = "",
  [int]$W = 1200,
  [int]$H = 1300
)
$out = "D:\ROTK\three.js\img2threejs-work\shots"
New-Item -ItemType Directory -Force -Path $out | Out-Null
$chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe"
foreach ($v in $Views.Split(",")) {
  $file = Join-Path $out "$Tag-$v.png"
  if (Test-Path $file) { Remove-Item $file -Force }
  & $chrome --headless=new --disable-gpu --enable-unsafe-swiftshader --hide-scrollbars --no-sandbox `
    --window-size="$W,$H" --virtual-time-budget=15000 `
    --screenshot="$file" "http://localhost:8899/render/viewer.html?view=$v&light=$Light$Extra" 2>$null | Out-Null
  if (Test-Path $file) { Write-Output "OK $file $((Get-Item $file).Length)" } else { Write-Output "FAIL $v" }
}
