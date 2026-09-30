$py = "$env:LOCALAPPDATA\Programs\py312\python.exe"
$sk = "C:\Users\31273\.claude\skills\img2threejs"
$work = "D:\ROTK\three.js\img2threejs-work"
Set-Location $work
$statePath = ".img2threejs/state.json"

if (Test-Path $statePath) { Remove-Item $statePath -Force }

& $py "$sk\forge\state.py" init --state $statePath --reference reference.png --profile character --spec object-sculpt-spec.json | Out-Null

$rows = @(
  @("image-analysis",        "analysis/image-analysis.md",                       $null),
  @("reference-suitability", "analysis/reference-suitability.md",                $null),
  @("reference-admission",   "analysis/reference-admission.json",                $null),
  @("character-contract-read", "review/character-contract-and-action-ready.md",  $null),
  @("character-landmarks",   "analysis/anatomy.json",                            $null),
  @("local-spec-search",     "assessment.json",                                  $null),
  @("pre-spec-assessment",   "assessment.json",                                  $null),
  @("detail-inventory",      "analysis/detail-inventory.json",                   $null),
  @("projection-route",      $null, "Flat vector-like paint: every identity feature has a hard bounded boundary, which grimoire/review/gates_reference.md requires to be gated on GEOMETRY via vertex regions, never as a texture. There is no photographic albedo to recover, so camera solve + de-light + bake_projected_texture would only blur the boundaries the review depends on. The decision and its reasoning are recorded in assessment.json projectionRoute."),
  @("spec-authoring",        "object-sculpt-spec.json",                         $null),
  @("material-evidence",     $null, "The subject is flat paint and every material is correctly declared 'textureless' with per-material evidence, so there is no finish for extract_pbr_evidence.py to recover: solid albedo for flat paint is the recipe, and a patterned reference crop is the case this subject does not present. Declining the extraction is recorded in the materials' textureless.evidence entries."),
  @("material-spec-wiring",  "object-sculpt-spec.json",                         $null),
  @("strict-validation",     "review/strict-validation.txt",                    $null),
  @("build-current-pass",    "src/createObjectModel.ts",                        $null),
  @("render-capture",        "shots/final-front.png",                           $null),
  @("review-contract-read",  "review/gates-as-run.md",                          $null),
  @("tier1-diagnostics",     "review/tier1.txt",                                $null),
  @("multi-angle-review",    "review/multi-angle.json",                         $null),
  @("pass-gate-check",       "object-sculpt-spec.json",                         $null),
  @("ai-review-recorded",    "object-sculpt-spec.json",                         $null),
  @("pipeline-sync",         "object-sculpt-spec.json",                         $null),
  @("part-coverage",         "review/part-coverage.json",                       $null),
  @("action-ready",          "review/character-contract-and-action-ready.md",   $null),
  @("emission-target",       $null, "No emission target was requested. The user asked to see the reconstruction; a terminal GLB or other export is a separate, explicitly-selected whole-artifact transform and was not asked for."),
  @("plugin-gates",          $null, "No domain plugin serves this item. 'character' is an in-repo base module, not an installed plugin, and the pipeline names no domain: with no plugin the generic path applies and there is no plugin review gate to run. Declining is not a failure.")
)

foreach ($row in $rows) {
  $stepName = $row[0]
  $evidence = $row[1]
  $reason = $row[2]
  if ($reason) {
    $out = & $py "$sk\forge\state.py" mark $stepName --state $statePath --status skipped --reason $reason 2>&1 | Out-String
  } else {
    $out = & $py "$sk\forge\state.py" mark $stepName --state $statePath --evidence $evidence 2>&1 | Out-String
  }
  $line = ($out -split "`n" | Where-Object { $_ -match 'STATE|error' } | Select-Object -First 1)
  Write-Output ("{0,-24} {1}" -f $stepName, $line.Trim())
}
